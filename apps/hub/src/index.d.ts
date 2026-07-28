/**
 * Types for the part of `partycod` that another TypeScript process embeds.
 *
 * The hub is plain JavaScript with JSDoc, on purpose: it is the thing an operator patches on their
 * own VPS at 2am, and a build step between them and the fix is a cost paid at the worst moment. That
 * choice stops at the module boundary, though — the desktop starts a hub in its own main process and
 * type-checks under `strict`, so the seam between the two needs declaring.
 *
 * Hand-written, and narrow by design: only what the desktop actually calls is here. A generated
 * surface would invite the desktop to reach further into the daemon than the two functions it needs,
 * and every extra name here is a coupling that has to survive the hub becoming a separate process
 * again on the day somebody runs it for a team.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';

/** Wire protocol version. Bumped when the shape of the hub's responses changes incompatibly. */
export const PROTOCOL_VERSION: number;

/** The port `partycod` listens on when nobody says otherwise. */
export const DEFAULT_PORT: number;

/** Address of the single local account. Reserved by RFC 2606, so it can never reach a mailbox. */
export const LOCAL_EMAIL: string;

export interface StartHubOptions {
  dbPath?: string;
  /** 0 picks a free port — which is what an embedded hub wants, so two copies never collide. */
  port?: number;
  host?: string;
  origins?: string[] | null;
  trustProxy?: boolean;
  rateLimit?: { limit?: number; windowMs?: number };
  publicUrl?: string | null;
  smtpUrl?: string | null;
  log?: (message: string) => void;
}

export interface RunningHub {
  server: Server;
  db: DatabaseSync;
  port: number;
  host: string;
  url: string;
  close: () => Promise<void>;
}

/** Open the database, wire the routes, listen. Resolves once the port is real. */
export function startHub(options?: StartHubOptions): Promise<RunningHub>;

/** A member as every hub response describes one. Never carries the password hash. */
export interface HubPublicMember {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  colorSlug: string;
  role: string;
  createdAt: number;
}

export interface HubSessionGrant {
  token: string;
  expiresAt: number;
  member: HubPublicMember;
}

/**
 * Find this machine's member, or make one, and open a session — the same grant registration and
 * login return, so nothing downstream can tell a local session from an earned one.
 *
 * Authority is filesystem access to `hub.db`, not a password: see the header of `local.js`.
 */
export function openLocalSession(
  db: DatabaseSync,
  options?: { displayName?: unknown },
  now?: number,
): HubSessionGrant;
