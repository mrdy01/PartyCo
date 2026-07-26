/**
 * Client for the `partycod` hub.
 *
 * The first piece of this product that talks to something real instead of a fixture. Everything on
 * the screens is still demo data; the member sitting behind the session is not.
 *
 * Deliberately tiny and dependency-free, like the hub itself: a self-hosted box is only as
 * maintainable as the number of things its owner has to update on their own server.
 */

export interface HubMember {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  /** Assigned once on registration and immutable — the whole ownership-at-a-glance system rests on it. */
  colorSlug: string;
  role: 'owner' | 'maintainer' | 'member' | 'observer';
  createdAt: number;
}

export interface HubSession {
  token: string;
  expiresAt: number;
  member: HubMember;
  hubUrl: string;
}

/**
 * An invitation as the hub returns it — raw facts, not a rendered row.
 *
 * `code` and `joinUrl` come back `null` for somebody who may read the list but may not hand out
 * seats: a live code is a credential, and the hub redacts rather than trusting the client to hide
 * it. The Russian sentence a person reads («1 из 5 · ещё 21 час») is assembled on this side, by
 * `inviteMeta` — the hub deals in numbers and timestamps.
 */
export interface HubInvite {
  code: string | null;
  joinUrl: string | null;
  channel: 'email' | 'code';
  email: string | null;
  role: HubMember['role'];
  status: 'pending' | 'accepted' | 'expired' | 'revoked' | 'exhausted';
  createdBy: string;
  createdAt: number;
  expiresAt: number | null;
  usedCount: number;
  maxUses: number | null;
  revokedAt: number | null;
}

/** What `POST /v1/invites` adds on top of the invitation itself. */
export interface HubInviteCreated {
  invite: HubInvite;
  /** Always false today — the hub has no SMTP client and does not pretend otherwise. */
  mailSent: boolean;
  /** True when SMTP is configured but sending is still unimplemented. */
  mailPending?: boolean;
}

/**
 * A refusal the human is meant to read.
 *
 * `code` is the hub's machine value (`invalid_credentials`, `email_taken`, `rate_limited`, …) and
 * `message` is its Russian sentence. The UI shows the sentence; the code exists so callers can
 * branch without matching on prose.
 */
export class HubError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'HubError';
    this.code = code;
    this.status = status;
  }
}

/** Default address. Overridable on the sign-in panel — a self-hosted product must allow that. */
export const DEFAULT_HUB_URL = 'http://127.0.0.1:7717';

const SESSION_KEY = 'partyco.session';

function normalise(hubUrl: string): string {
  const trimmed = hubUrl.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : DEFAULT_HUB_URL;
}

async function request<T>(
  hubUrl: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; token?: string },
): Promise<T> {
  const headers: Record<string, string> = {};
  // The hub answers 415 without this: it is what keeps a cross-site "simple request" from reaching
  // the auth endpoints without a preflight.
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers['Authorization'] = `Bearer ${init.token}`;

  let response: Response;
  try {
    response = await fetch(`${normalise(hubUrl)}${path}`, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    // A dead socket is the single most likely failure on a self-hosted product, and «Failed to
    // fetch» tells the human nothing about what to do.
    throw new HubError(
      'unreachable',
      `Хаб не отвечает по адресу ${normalise(hubUrl)}. Проверь, что он запущен и адрес верный.`,
      0,
    );
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new HubError(
      error?.code ?? 'unknown',
      error?.message ?? `Хаб ответил ошибкой ${response.status}.`,
      response.status,
    );
  }

  return payload as T;
}

export async function register(
  hubUrl: string,
  input: { email: string; password: string; displayName?: string; inviteCode?: string },
): Promise<HubSession> {
  const body: Record<string, string> = { email: input.email, password: input.password };
  if (input.displayName) body['displayName'] = input.displayName;
  // Sent only when there is one. An invitation the hub cannot honour fails the registration
  // outright rather than quietly producing an ordinary member — the person was told they were
  // being given a role, and silently not giving it is the worse answer.
  if (input.inviteCode) body['inviteCode'] = input.inviteCode;
  const result = await request<{ token: string; expiresAt: number; member: HubMember }>(
    hubUrl,
    '/v1/auth/register',
    { method: 'POST', body },
  );
  return { ...result, hubUrl: normalise(hubUrl) };
}

export async function login(
  hubUrl: string,
  input: { email: string; password: string },
): Promise<HubSession> {
  const result = await request<{ token: string; expiresAt: number; member: HubMember }>(
    hubUrl,
    '/v1/auth/login',
    { method: 'POST', body: input },
  );
  return { ...result, hubUrl: normalise(hubUrl) };
}

export async function me(hubUrl: string, token: string): Promise<HubMember> {
  const result = await request<{ member: HubMember }>(hubUrl, '/v1/auth/me', {
    method: 'GET',
    token,
  });
  return result.member;
}

export async function logout(hubUrl: string, token: string): Promise<void> {
  await request<void>(hubUrl, '/v1/auth/logout', { method: 'POST', token });
}

/* ------------------------------------------------------------- team and invitations */

export async function members(hubUrl: string, token: string): Promise<HubMember[]> {
  const result = await request<{ members: HubMember[] }>(hubUrl, '/v1/members', {
    method: 'GET',
    token,
  });
  return result.members;
}

export async function invites(hubUrl: string, token: string): Promise<HubInvite[]> {
  const result = await request<{ invites: HubInvite[] }>(hubUrl, '/v1/invites', {
    method: 'GET',
    token,
  });
  return result.invites;
}

export async function createInvite(
  hubUrl: string,
  token: string,
  input: {
    role: HubMember['role'];
    email?: string;
    lifetime?: 'day' | 'week' | 'forever';
    seats?: 'one' | 'five' | 'any';
  },
): Promise<HubInviteCreated> {
  return request<HubInviteCreated>(hubUrl, '/v1/invites', { method: 'POST', body: input, token });
}

export async function revokeInvite(
  hubUrl: string,
  token: string,
  code: string,
): Promise<HubInvite> {
  const result = await request<{ invite: HubInvite }>(hubUrl, '/v1/invites/revoke', {
    method: 'POST',
    body: { code },
    token,
  });
  return result.invite;
}

/**
 * Ask, without an account, whether a code is worth typing an email address for.
 *
 * Answers `{ valid: false }` for every code that will not work — expired, revoked, used up,
 * never existed — because anything more specific would sort a guesser's attempts for them. It
 * shares the hub's password-guessing budget for the same reason.
 */
export async function peekInvite(
  hubUrl: string,
  code: string,
): Promise<{ valid: boolean; role?: HubMember['role']; projectName?: string }> {
  return request(hubUrl, `/v1/invites/peek?code=${encodeURIComponent(code)}`, { method: 'GET' });
}

/** Take a seat with an account that already exists. Idempotent — redeeming twice is not an error. */
export async function redeemInvite(
  hubUrl: string,
  token: string,
  code: string,
): Promise<{ member: HubMember; invite: HubInvite; alreadyRedeemed: boolean }> {
  return request(hubUrl, '/v1/invites/redeem', { method: 'POST', body: { code }, token });
}

/* ------------------------------------------------------- session persistence */

/**
 * The session lives in `localStorage`, not in a cookie: the renderer runs under a strict CSP with no
 * external origins, and the token is only ever sent to the hub the member chose.
 *
 * It is stored as-is because it *is* the credential — hashing it here would protect nothing, since
 * whatever can read this storage can also read the hashed value and replay it.
 */
export function readStoredSession(): HubSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HubSession;
    if (!parsed?.token || !parsed?.member?.id) return null;
    if (typeof parsed.expiresAt === 'number' && parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeSession(session: HubSession | null): void {
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Losing the "stay signed in" convenience must never stop somebody from signing in.
  }
}
