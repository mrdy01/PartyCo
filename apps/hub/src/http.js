/**
 * HTTP plumbing for `partycod`: routing, body parsing, CORS, rate limiting, error shape.
 *
 * Everything a client can see is produced here. Two consequences worth stating out loud:
 *   - every error leaves as `{ error: { code, message } }` with a Russian message and no
 *     internals — SQL text, table names and stack traces stop at the 500 handler;
 *   - the service speaks plain HTTP. That is a deliberate simplification for a self-hosted
 *     box, and it means passwords cross this socket in the clear. On a VPS it MUST sit
 *     behind a TLS terminator; see README.
 */

import http from 'node:http';

/**
 * Client-visible failure. Anything else that escapes a handler becomes a generic 500.
 */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message Russian, human, no internals.
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.expose = true;
    /** Extra response headers, e.g. `Retry-After` on a 429. @type {Record<string, string>} */
    this.headers = {};
  }
}

/** Request bodies are tiny by nature here; anything larger is a mistake or an attack. */
const MAX_BODY_BYTES = 64 * 1024;

/** Default dev-preview origin of the Electron renderer. */
export const DEFAULT_DEV_ORIGIN = 'http://localhost:5273';

/**
 * Parse `PARTYCOD_ORIGINS`.
 *
 * @param {string|undefined} raw comma-separated list
 * @returns {string[]|null} explicit allowlist, or null to use the loopback-any-port default
 */
export function parseOrigins(raw) {
  if (typeof raw !== 'string') return null;
  const list = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : null;
}

/** `http://localhost:1234`, `http://127.0.0.1`, `http://[::1]:5273` — any port. */
const LOOPBACK_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

/**
 * Is this Origin allowed to read our responses?
 *
 * With no explicit allowlist we accept any loopback origin on any port — the renderer's
 * dev preview picks its port at random, so pinning one would break `npm run dev` on the
 * second run. That is safe because loopback means "already on this machine". Once
 * `PARTYCOD_ORIGINS` is set, only those exact origins pass and the loopback rule is gone:
 * a hub on a VPS should not be readable by whatever is running on a visitor's localhost.
 *
 * @param {string|undefined} origin
 * @param {string[]|null} allowlist
 * @returns {boolean}
 */
export function isAllowedOrigin(origin, allowlist) {
  if (typeof origin !== 'string' || origin.length === 0) return false;
  const normalized = origin.replace(/\/+$/, '');
  // No wildcard entry is honoured: an allowlist is a list. A magic '*' in an environment
  // variable is exactly the kind of "temporary" that outlives the person who set it.
  if (allowlist) return allowlist.includes(normalized);
  return normalized === DEFAULT_DEV_ORIGIN || LOOPBACK_ORIGIN_RE.test(normalized);
}

/**
 * Best-effort client address, used only as a rate-limit key.
 *
 * `X-Forwarded-For` is attacker-controlled, so it is ignored unless the operator opts in —
 * and they must, because behind a reverse proxy every request otherwise arrives from
 * 127.0.0.1 and ten people share one bucket.
 *
 * @param {http.IncomingMessage} req
 * @param {boolean} trustProxy
 * @returns {string}
 */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof first === 'string' && first.length > 0) {
      const candidate = first.split(',')[0].trim();
      if (candidate) return candidate;
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Fixed-window-per-key attempt limiter, in memory.
 *
 * In memory is the honest scope: it resets on restart and does not span replicas. For a
 * 2–10 person self-hosted hub that is enough to stop online password guessing, which is
 * what it is for. It is not a defence against a botnet, and pretending otherwise would
 * mean a Redis the owner has to run.
 *
 * @param {{ limit?: number, windowMs?: number }} [options]
 */
export function createRateLimiter({ limit = 10, windowMs = 60_000 } = {}) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  /** @param {number} now */
  function sweep(now) {
    for (const [key, stamps] of hits) {
      const live = stamps.filter((t) => now - t < windowMs);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  }

  return {
    /**
     * Record an attempt.
     * @param {string} key
     * @param {number} [now]
     * @returns {{ allowed: boolean, retryAfterSec: number }}
     */
    check(key, now = Date.now()) {
      const stamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (stamps.length >= limit) {
        hits.set(key, stamps);
        const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - stamps[0])) / 1000));
        return { allowed: false, retryAfterSec };
      }
      stamps.push(now);
      hits.set(key, stamps);
      // Keys are IPs, so the map is bounded by distinct callers; sweep anyway so a scan
      // from many addresses cannot leave entries behind forever.
      if (hits.size > 1024) sweep(now);
      return { allowed: true, retryAfterSec: 0 };
    },
    /** Test/ops hook. */
    reset() {
      hits.clear();
    },
    get size() {
      return hits.size;
    },
  };
}

/**
 * Read and JSON-parse a request body, bounded.
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, 'body_too_large', 'Запрос слишком большой.'));
      return;
    }

    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type && type !== 'application/json') {
      // Also the reason a cross-site "simple request" cannot reach these endpoints without
      // a preflight the browser will refuse.
      reject(new HttpError(415, 'unsupported_media_type', 'Тело запроса должно быть JSON.'));
      return;
    }

    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (/** @type {Error} */ err) => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(err);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new HttpError(413, 'body_too_large', 'Запрос слишком большой.'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', () => fail(new HttpError(400, 'bad_request', 'Не удалось прочитать запрос.')));

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw.length === 0) {
        resolve({});
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        reject(new HttpError(400, 'invalid_json', 'Тело запроса — не JSON.'));
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        reject(new HttpError(400, 'invalid_json', 'Тело запроса должно быть объектом JSON.'));
        return;
      }
      resolve(parsed);
    });
  });
}

/**
 * Extract a bearer token. Scheme match is case-insensitive per RFC 6750.
 * @param {http.IncomingMessage} req
 * @returns {string|null}
 */
export function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^bearer[ \t]+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, body, headers = {}) {
  if (res.writableEnded) return;
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Record<string, string>} [headers]
 */
export function sendError(res, status, code, message, headers = {}) {
  sendJson(res, status, { error: { code, message } }, headers);
}

/**
 * @typedef {object} RequestContext
 * @property {http.IncomingMessage} req
 * @property {http.ServerResponse} res
 * @property {URL} url
 * @property {string} ip
 * @property {string|null} token
 * @property {() => Promise<Record<string, unknown>>} body
 */

/**
 * @typedef {(ctx: RequestContext) => Promise<{ status: number, body?: unknown }> | { status: number, body?: unknown }} RouteHandler
 */

/**
 * Build the request listener.
 *
 * @param {object} options
 * @param {Record<string, RouteHandler>} options.routes keyed `"METHOD /path"`
 * @param {string[]|null} [options.origins] explicit CORS allowlist; null = loopback default
 * @param {boolean} [options.trustProxy]
 * @param {(msg: string) => void} [options.logError]
 * @returns {http.RequestListener}
 */
export function createRequestListener({ routes, origins = null, trustProxy = false, logError = console.error }) {
  const known = new Map(Object.entries(routes));
  const allowedMethodsByPath = new Map();
  for (const key of known.keys()) {
    const [method, path] = key.split(' ');
    allowedMethodsByPath.set(path, [...(allowedMethodsByPath.get(path) ?? []), method]);
  }

  return async function listener(req, res) {
    const origin = /** @type {string|undefined} */ (req.headers.origin);
    /** @type {Record<string, string>} */
    const headers = {
      // Always vary: the same URL answers differently depending on Origin, and a shared
      // cache that missed this would hand one origin another's CORS headers.
      vary: 'Origin',
      'x-content-type-options': 'nosniff',
      // Tokens and member records are not cacheable by anyone, ever.
      'cache-control': 'no-store',
    };
    if (isAllowedOrigin(origin, origins)) {
      headers['access-control-allow-origin'] = /** @type {string} */ (origin);
    }

    let url;
    try {
      url = new URL(req.url ?? '/', 'http://hub.invalid');
    } catch {
      sendError(res, 400, 'bad_request', 'Некорректный адрес запроса.', headers);
      return;
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      if (!headers['access-control-allow-origin']) {
        sendError(res, 403, 'origin_not_allowed', 'Этот источник не разрешён.', headers);
        return;
      }
      const allow = allowedMethodsByPath.get(path);
      res.writeHead(204, {
        ...headers,
        'access-control-allow-methods': `${(allow ?? ['GET', 'POST']).join(', ')}, OPTIONS`,
        'access-control-allow-headers': 'Content-Type, Authorization',
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }

    const handler = known.get(`${method} ${path}`);
    if (!handler) {
      if (allowedMethodsByPath.has(path)) {
        sendError(res, 405, 'method_not_allowed', 'Этот метод здесь не поддерживается.', {
          ...headers,
          allow: `${allowedMethodsByPath.get(path).join(', ')}, OPTIONS`,
        });
      } else {
        sendError(res, 404, 'not_found', 'Такого адреса нет.', headers);
      }
      return;
    }

    /** @type {Promise<Record<string, unknown>>|null} */
    let bodyPromise = null;

    try {
      const result = await handler({
        req,
        res,
        url,
        ip: clientIp(req, trustProxy),
        token: bearerToken(req),
        body: () => (bodyPromise ??= readJsonBody(req)),
      });

      if (result.status === 204) {
        res.writeHead(204, headers);
        res.end();
        return;
      }
      sendJson(res, result.status, result.body, headers);
    } catch (err) {
      if (err && /** @type {any} */ (err).expose) {
        const e = /** @type {HttpError} */ (err);
        sendError(res, e.status, e.code, e.message, { ...headers, ...(e.headers ?? {}) });
        return;
      }
      // Unexpected: the operator gets the detail in the journal, the client gets nothing.
      logError(`[partycod] unhandled error on ${method} ${path}: ${err instanceof Error ? err.stack : String(err)}`);
      sendError(res, 500, 'internal_error', 'Внутренняя ошибка сервиса.', headers);
    }
  };
}

/**
 * @param {Parameters<typeof createRequestListener>[0]} options
 * @returns {http.Server}
 */
export function createHttpServer(options) {
  const server = http.createServer(createRequestListener(options));
  // Bound the slow-client surface; a legitimate request here is a few hundred bytes.
  server.headersTimeout = 10_000;
  server.requestTimeout = 20_000;
  return server;
}
