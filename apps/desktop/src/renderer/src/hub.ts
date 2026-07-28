/**
 * Client for the `partycod` hub.
 *
 * The first piece of this product that talks to something real instead of a fixture. Everything on
 * the screens is still demo data; the member sitting behind the session is not.
 *
 * Deliberately tiny and dependency-free, like the hub itself: a self-hosted box is only as
 * maintainable as the number of things its owner has to update on their own server.
 */

/**
 * The four role words, taken from `@partyco/ui` rather than declared a second time here.
 *
 * They are the same four the hub stores, and the import is type-only, so it erases: nothing at
 * runtime in this file depends on the component package. Two hand-written copies of one union is how
 * a fifth role ends up existing on one side of the wire only.
 */
import type { ProjectRole } from '@partyco/ui';

export interface HubMember {
  id: string;
  /**
   * `null` when the hub refused to show it — which is most of the time.
   *
   * `GET /v1/members`, the project roster and `POST /v1/projects/members` all replace other people's
   * addresses with `null` unless the caller is an owner or a maintainer; only the caller's own row
   * always carries one (`auth.js` → `publicMember`, `index.js:191`, `projects.js` →
   * `publicProjectMember`). Typing this `string` was a promise the wire does not keep: nothing reads
   * it today, so nothing is broken yet, but the first line of code to print it would have printed
   * the four characters `null` into a team panel with no type error to stop it.
   */
  email: string | null;
  handle: string;
  displayName: string;
  /** Assigned once on registration and immutable — the whole ownership-at-a-glance system rests on it. */
  colorSlug: string;
  role: 'owner' | 'maintainer' | 'member' | 'observer';
  createdAt: number;
}

/**
 * `member` is the caller's **own** row, and that is why its `email` narrows back to a string here:
 * the hub redacts other people's addresses, never yours (`index.js:191`, `publicProjectMember`).
 * Without this the widening of {@link HubMember.email} would spread a `null` into the one place the
 * hub guarantees an address, and the shell would grow fallbacks for a case that cannot happen.
 */
export type HubSelf = HubMember & { email: string };

export interface HubSession {
  token: string;
  expiresAt: number;
  member: HubSelf;
  hubUrl: string;
  /**
   * Which of the two ways in produced this session.
   *
   * `local` is the hub the desktop starts for this machine and signs into without a password;
   * `hub` is one somebody typed an address and a password for. The difference is invisible in every
   * request — a local session is an ordinary session, deliberately — and matters in exactly one
   * place: what the settings screen offers next to the member's own name. «Выйти» from an account
   * that regenerates itself on the next launch, while clearing the working folder and the provider
   * keys on the way out, is a control that does harm and no good; «Работать командой» is the move a
   * person on the local hub actually has.
   *
   * A stored session written before this field existed reads back as `hub`, which is what it was.
   */
  kind: 'local' | 'hub';
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
  const result = await request<{ token: string; expiresAt: number; member: HubSelf }>(
    hubUrl,
    '/v1/auth/register',
    { method: 'POST', body },
  );
  return { ...result, hubUrl: normalise(hubUrl), kind: 'hub' };
}

export async function login(
  hubUrl: string,
  input: { email: string; password: string },
): Promise<HubSession> {
  const result = await request<{ token: string; expiresAt: number; member: HubSelf }>(
    hubUrl,
    '/v1/auth/login',
    { method: 'POST', body: input },
  );
  return { ...result, hubUrl: normalise(hubUrl), kind: 'hub' };
}

/** Whoever the token belongs to — your own row, so the address is there. */
export async function me(hubUrl: string, token: string): Promise<HubSelf> {
  const result = await request<{ member: HubSelf }>(hubUrl, '/v1/auth/me', {
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
): Promise<{ member: HubSelf; invite: HubInvite; alreadyRedeemed: boolean }> {
  return request(hubUrl, '/v1/invites/redeem', { method: 'POST', body: { code }, token });
}

/* --------------------------------------------------------------------- projects */

/**
 * A project as the hub hands it to somebody who is **in** it.
 *
 * The field to read twice is `role`. It is not the project's role and not the caller's role on the
 * hub — it is what the caller is *inside this project*, and the hub only ever produces this shape
 * for a member of it (a stranger gets 404, never 403). A hub maintainer who was never added to the
 * project has no standing here at all, so reading `member.role` when this is the question is the
 * mistake this comment exists to prevent.
 */
export interface HubProject {
  id: string;
  name: string;
  slug: string;
  /** Member id of whoever created it. */
  createdBy: string;
  createdAt: number;
  /** Always `null` today: the column exists, nothing in the hub sets it, and the API says so. */
  archivedAt: number | null;
  /** The **caller's** role in this project. Not `HubMember.role`, which is their role on the hub. */
  role: ProjectRole;
  /** When the caller joined this project. */
  joinedAt: number;
  memberCount: number;
}

/**
 * One line of a project roster: the person as the hub publishes them everywhere, plus what they are
 * **here**.
 *
 * Both roles travel on the same object on purpose, because that is what the hub sends, and they are
 * different facts: `role` (inherited from `HubMember`) is the hub-level role — the one that decides
 * who may hand out seats — and `projectRole` is this project's. Four words match, the meanings do
 * not.
 *
 * `email` is `null` for other people unless the caller may see addresses; that redaction is decided
 * by the **hub** role, exactly as in `GET /v1/members`.
 */
export interface HubProjectMember extends HubMember {
  projectRole: ProjectRole;
  /** When this person joined the project. */
  joinedAt: number;
}

/** The projects the caller is in. Not every project on the hub — an empty list is a normal answer. */
export async function projects(hubUrl: string, token: string): Promise<HubProject[]> {
  const result = await request<{ projects: HubProject[] }>(hubUrl, '/v1/projects', {
    method: 'GET',
    token,
  });
  return result.projects;
}

/** Create one. The caller becomes its owner — the project role, not the hub's. */
export async function createProject(
  hubUrl: string,
  token: string,
  input: { name: string },
): Promise<HubProject> {
  const result = await request<{ project: HubProject }>(hubUrl, '/v1/projects', {
    method: 'POST',
    body: input,
    token,
  });
  return result.project;
}

/**
 * The roster of one project, with the project itself.
 *
 * The id travels in the query string because the hub's router matches `"METHOD /path"` exactly and
 * has no path parameters — `/v1/projects/:id/members` does not exist there.
 */
export async function projectMembers(
  hubUrl: string,
  token: string,
  projectId: string,
): Promise<{ project: HubProject; members: HubProjectMember[] }> {
  return request(hubUrl, `/v1/projects/members?projectId=${encodeURIComponent(projectId)}`, {
    method: 'GET',
    token,
  });
}

/**
 * Put somebody in a project, with a role in it.
 *
 * `role` here is the role **in the project**; whoever is being added keeps whatever they are on the
 * hub. Repeating the identical call is a success that changes nothing; the same person with a
 * *different* role is a `409 role_conflict` and arrives as a `HubError` with the hub's own sentence,
 * because this endpoint does not change roles and no other one does either.
 */
export async function addProjectMember(
  hubUrl: string,
  token: string,
  input: { projectId: string; memberId: string; role: ProjectRole },
): Promise<HubProjectMember> {
  const result = await request<{ member: HubProjectMember; alreadyMember: boolean }>(
    hubUrl,
    '/v1/projects/members',
    { method: 'POST', body: input, token },
  );
  return result.member;
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
    /*
     * Only a chosen session is ever written here, so anything read back is a `hub` one — including
     * rows stored before the field existed. Normalising on read rather than trusting the stored
     * value also closes the sillier case: a hand-edited `local` in localStorage would otherwise turn
     * a team account's settings screen into one that offers to join a team it is already in.
     */
    return { ...parsed, kind: 'hub' };
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
