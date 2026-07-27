/**
 * Projects for `partycod`: creation, membership, roles inside one project.
 *
 * A project is the unit everything later in the architecture hangs off — lanes, claims,
 * leases, the merge gate. None of that exists yet. What exists here is exactly two things:
 * a project has a name and an identity, and it has people in it. Nothing in this file
 * invents a repository path, a trunk ref or a policy bundle that no subsystem produces.
 *
 * Three rules are load-bearing and must survive future edits:
 *
 *  1. **A project you are not in answers 404, not 403.** Membership is checked by JOINing
 *     the caller into the very SELECT that fetches the project, so "no such project" and
 *     "not yours" are literally the same code path and cannot drift apart. 403 would tell
 *     an outsider that a project exists, who its neighbours are naming things, and would
 *     turn `GET /v1/projects/members` into an id oracle.
 *  2. **The creator's `owner` row is written in the same transaction as the project.**
 *     A crash between the two would leave a project nobody belongs to: invisible to every
 *     list (they all go through the membership JOIN) and impossible to join.
 *  3. **Addresses are redacted by HUB role, not by project role.** `GET /v1/members`
 *     already hides other people's email from a plain member; if this endpoint decided by
 *     project role instead, anyone could create their own project, add the team to it and
 *     read every address — the same export that rule exists to prevent.
 *
 * Dependency direction: index.js → projects.js → auth.js → invites.js, plus http.js for
 * the error type. No cycles, so unlike `invites.js` (which cannot reach back into
 * `auth.js`) this module imports what it needs instead of declaring twins of it —
 * `publicMember` in particular, because it is the single place that builds member JSON and
 * therefore the single place that keeps `password_hash` out of every response at once.
 *
 * The hub stays a coordination plane: a project row is a name and a roster. It grants
 * nobody access to anyone's machine, files or provider keys.
 */

import crypto from 'node:crypto';

import { publicMember } from './auth.js';
import { HttpError } from './http.js';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/** @typedef {import('./db.js').MemberRow} MemberRow */
/** @typedef {import('./db.js').ProjectRow} ProjectRow */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * Roles inside one project. Deliberately the same four words as the hub-level roles and
 * deliberately a **different** thing: the hub's `owner` owns the installation, a project's
 * `owner` owns one project. A hub maintainer with no row in `project_member` has no
 * standing in that project at all.
 * @type {readonly string[]}
 */
export const PROJECT_ROLES = Object.freeze(['owner', 'maintainer', 'member', 'observer']);

/** Who may add people to a project. Checked against the caller's role IN THAT project. */
const PROJECT_MANAGER_ROLES = Object.freeze(['owner', 'maintainer']);

/** Longest project name we accept. Refused rather than silently cut: a truncated name is a
 *  name the person did not choose, and they cannot rename it — there is no such endpoint. */
const NAME_MAX = 64;

/** Longest slug stem before the collision suffix. */
const SLUG_MAX = 48;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * The single answer for "this project is not yours to look at". Unknown id and somebody
 * else's project both produce it — see rule 1 in the header.
 * @returns {HttpError}
 */
function projectNotFound() {
  return new HttpError(404, 'project_not_found', 'Такого проекта нет.');
}

// ---------------------------------------------------------------------------
// Name and slug
// ---------------------------------------------------------------------------

/**
 * @param {unknown} raw
 * @returns {string}
 * @throws {HttpError} 400 invalid_name
 */
export function normalizeProjectName(raw) {
  if (typeof raw !== 'string') {
    throw new HttpError(400, 'invalid_name', 'Дайте проекту имя.');
  }
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length === 0) {
    throw new HttpError(400, 'invalid_name', 'Дайте проекту имя.');
  }
  if (name.length > NAME_MAX) {
    throw new HttpError(400, 'invalid_name', `Имя проекта — не длиннее ${NAME_MAX} знаков.`);
  }
  return name;
}

/**
 * Name → slug stem: lower case, `[a-z0-9-]`, collapsed separators, capped.
 *
 * The same shape as `deriveHandle` in auth.js, and the same honest consequence: an entirely
 * non-latin name ("Хайтейл") has nothing left after the filter and falls back to `project`,
 * then `project-2`. Transliteration is not done here because a made-up romanisation table is
 * a guess about somebody's name, and the display `name` keeps the original untouched.
 *
 * @param {string} name normalised
 * @returns {string}
 */
export function slugFromName(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return base.length > 0 ? base : 'project';
}

/**
 * A slug nobody else has. Collisions get a numeric suffix (`atlas`, `atlas-2`, `atlas-3`),
 * exactly like handles.
 *
 * **Must be called inside an open write transaction.** The uniqueness it returns is only
 * true while the write lock is held; outside one, two simultaneous creations of "Атлас"
 * would both see `atlas` free.
 *
 * @param {DatabaseSync} db
 * @param {string} name normalised
 * @returns {string}
 */
export function deriveSlug(db, name) {
  const base = slugFromName(name);
  const taken = db.prepare('SELECT 1 FROM project WHERE slug = ?');
  if (!taken.get(base)) return base;
  for (let i = 2; i < 10000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.get(candidate)) return candidate;
  }
  // Unreachable in a hub with a handful of projects; still better than looping forever.
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/**
 * JSON form of a project, built in one place so every endpoint agrees on it.
 *
 * `role` and `joinedAt` describe **the caller**, not the project: this shape only ever
 * reaches somebody who is in the project, because the query that produces it joins them in.
 *
 * @param {ProjectRow & { viewer_role?: string, viewer_joined_at?: number, member_count?: number }} row
 */
export function publicProject(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
    // Always null today: nothing in this service archives a project. The column is the
    // §9.1 slot for when something does, not a state the API can currently reach.
    archivedAt: row.archived_at == null ? null : Number(row.archived_at),
    role: row.viewer_role,
    joinedAt: Number(row.viewer_joined_at),
    memberCount: Number(row.member_count),
  };
}

/**
 * The membership JOIN is the access check. Every read of a project goes through it, so
 * there is no query in this file that can return a project to a stranger.
 */
const SELECT_PROJECT = `
  SELECT p.*,
         pm.role AS viewer_role,
         pm.joined_at AS viewer_joined_at,
         (SELECT count(*) FROM project_member c WHERE c.project_id = p.id) AS member_count
    FROM project p
    JOIN project_member pm ON pm.project_id = p.id AND pm.member_id = ?`;

/**
 * @param {unknown} raw
 * @returns {string}
 * @throws {HttpError} 400 invalid_project
 */
function normalizeProjectId(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new HttpError(400, 'invalid_project', 'Укажите проект.');
  }
  return raw.trim();
}

/**
 * Fetch a project as seen by one member, or refuse with the 404 that says nothing.
 *
 * @param {DatabaseSync} db
 * @param {string} projectId
 * @param {string} memberId
 * @returns {ProjectRow & { viewer_role: string, viewer_joined_at: number, member_count: number }}
 * @throws {HttpError} 404 project_not_found
 */
function requireProject(db, projectId, memberId) {
  const row = db.prepare(`${SELECT_PROJECT} WHERE p.id = ?`).get(memberId, projectId);
  if (!row) throw projectNotFound();
  return /** @type {any} */ (row);
}

// ---------------------------------------------------------------------------
// Create and list
// ---------------------------------------------------------------------------

/**
 * Create a project. The caller becomes its `owner`.
 *
 * Any signed-in member may do this, including a hub observer: a project they create is
 * empty and contains nothing but themselves, and refusing would be a policy the owner has
 * not asked for. What an observer still cannot do is get into anybody else's project.
 *
 * Nothing creates a project implicitly — not registration, not the first login. An entity
 * that appears without anyone asking for it is exactly the invented data this product is
 * getting rid of.
 *
 * @param {DatabaseSync} db
 * @param {MemberRow} actor
 * @param {{ name?: unknown }} input
 * @param {number} [now]
 * @returns {ReturnType<typeof publicProject>}
 */
export function createProject(db, actor, input, now = Date.now()) {
  const name = normalizeProjectName(input?.name);
  const id = crypto.randomUUID();

  db.exec('BEGIN IMMEDIATE');
  try {
    // Inside the lock, so the SELECT that says "atlas is free" and the INSERT that takes it
    // cannot be separated by another writer.
    const slug = deriveSlug(db, name);

    db.prepare(
      `INSERT INTO project(id, name, slug, created_by, created_at, archived_at)
       VALUES(?, ?, ?, ?, ?, NULL)`,
    ).run(id, name, slug, actor.id, now);

    // Same transaction as the project itself — see rule 2 in the header.
    db.prepare(
      'INSERT INTO project_member(project_id, member_id, role, joined_at) VALUES(?, ?, ?, ?)',
    ).run(id, actor.id, 'owner', now);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return publicProject(requireProject(db, id, actor.id));
}

/**
 * Projects the caller is in. Not "all projects": a hub can hold several teams' work, and a
 * list of names you are not part of is information the hub has no reason to hand out.
 *
 * @param {DatabaseSync} db
 * @param {MemberRow} actor
 * @returns {Array<ReturnType<typeof publicProject>>}
 */
export function listProjects(db, actor) {
  const rows = db.prepare(`${SELECT_PROJECT} ORDER BY p.created_at, p.id`).all(actor.id);
  return rows.map((row) => publicProject(/** @type {any} */ (row)));
}

// ---------------------------------------------------------------------------
// Members of a project
// ---------------------------------------------------------------------------

/**
 * One row of a project roster: the person as `publicMember` builds them, plus what they are
 * in this project. `role` is their role on the HUB, `projectRole` is their role here — two
 * different things that happen to share four words.
 *
 * @param {MemberRow & { project_role: string, joined_at: number }} row
 * @param {string} actorId
 * @param {boolean} showEmails
 */
function publicProjectMember(row, actorId, showEmails) {
  const member = publicMember(row);
  const visible = showEmails || member.id === actorId ? member : { ...member, email: null };
  return { ...visible, projectRole: row.project_role, joinedAt: Number(row.joined_at) };
}

/**
 * The roster of one project. Requires membership: somebody else's project is a 404.
 *
 * @param {DatabaseSync} db
 * @param {MemberRow} actor
 * @param {unknown} rawProjectId
 * @param {{ showEmails?: boolean }} [options] `showEmails` is decided by the caller's HUB
 *   role, the same way `GET /v1/members` decides it — see rule 3 in the header.
 * @returns {{ project: ReturnType<typeof publicProject>, members: Array<ReturnType<typeof publicProjectMember>> }}
 */
export function listProjectMembers(db, actor, rawProjectId, options = {}) {
  const projectId = normalizeProjectId(rawProjectId);
  const project = requireProject(db, projectId, actor.id);
  const showEmails = options.showEmails === true;

  const rows = db
    .prepare(
      `SELECT m.*, pm.role AS project_role, pm.joined_at AS joined_at
         FROM project_member pm
         JOIN member m ON m.id = pm.member_id
        WHERE pm.project_id = ?
        ORDER BY pm.joined_at, m.id`,
    )
    .all(projectId);

  return {
    project: publicProject(project),
    members: rows.map((row) => publicProjectMember(/** @type {any} */ (row), actor.id, showEmails)),
  };
}

/**
 * Add somebody to a project.
 *
 * Repeating the exact same call is a success and changes nothing (`alreadyMember: true`), so
 * a client that lost the response can simply repeat itself. Adding a person who is already
 * in the project **with a different role** is a 409 instead: that request is not the one
 * that already succeeded, and silently ignoring it would tell the caller their change went
 * through when it did not. Changing a role is not something this endpoint does, and there is
 * no other endpoint that does it yet — so the message says so rather than pointing at a
 * remedy that does not exist.
 *
 * @param {DatabaseSync} db
 * @param {MemberRow} actor
 * @param {{ projectId?: unknown, memberId?: unknown, role?: unknown }} input
 * @param {{ showEmails?: boolean }} [options]
 * @param {number} [now]
 * @returns {{ project: ReturnType<typeof publicProject>, member: ReturnType<typeof publicProjectMember>, alreadyMember: boolean }}
 */
export function addProjectMember(db, actor, input, options = {}, now = Date.now()) {
  const projectId = normalizeProjectId(input?.projectId);

  // Authorisation before validation, the same order invites.js uses: otherwise a stranger
  // learns from the error which ids are projects and which member ids exist.
  const project = requireProject(db, projectId, actor.id);
  if (!PROJECT_MANAGER_ROLES.includes(project.viewer_role)) {
    throw new HttpError(403, 'forbidden', 'Добавлять людей в проект может владелец проекта или мейнтейнер.');
  }

  const role = input?.role;
  if (typeof role !== 'string' || !PROJECT_ROLES.includes(role)) {
    throw new HttpError(
      400,
      'invalid_role',
      'Выберите роль в проекте: владелец, мейнтейнер, участник или только смотрит.',
    );
  }
  // A maintainer handing out `owner` would be a way to grow rights past their own: they
  // cannot make themselves an owner (that request collides with their existing row), but
  // without this they could make an accomplice one.
  if (role === 'owner' && project.viewer_role !== 'owner') {
    throw new HttpError(403, 'forbidden', 'Назначить владельца проекта может только владелец.');
  }

  const memberId =
    typeof input?.memberId === 'string' && input.memberId.trim().length > 0 ? input.memberId.trim() : null;
  if (memberId === null) {
    throw new HttpError(400, 'invalid_member', 'Укажите, кого добавляем.');
  }

  // The foreign key would catch this too, but as a 500 with SQLite's words in the log.
  // Who is on the hub is already readable by every signed-in member, so this leaks nothing.
  const target = /** @type {MemberRow|undefined} */ (
    db.prepare('SELECT * FROM member WHERE id = ?').get(memberId)
  );
  if (!target) {
    throw new HttpError(404, 'member_not_found', 'Такого участника на хабе нет.');
  }

  /** @type {boolean} */
  let alreadyMember;

  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db
      .prepare('SELECT role FROM project_member WHERE project_id = ? AND member_id = ?')
      .get(projectId, memberId);

    if (existing) {
      if (existing.role !== role) {
        throw new HttpError(
          409,
          'role_conflict',
          'Этот человек уже в проекте с другой ролью. Сменить роль этой ручкой нельзя.',
        );
      }
      alreadyMember = true;
    } else {
      db.prepare(
        'INSERT INTO project_member(project_id, member_id, role, joined_at) VALUES(?, ?, ?, ?)',
      ).run(projectId, memberId, role, now);
      alreadyMember = false;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const row = /** @type {any} */ (
    db
      .prepare(
        `SELECT m.*, pm.role AS project_role, pm.joined_at AS joined_at
           FROM project_member pm
           JOIN member m ON m.id = pm.member_id
          WHERE pm.project_id = ? AND pm.member_id = ?`,
      )
      .get(projectId, memberId)
  );

  return {
    project: publicProject(requireProject(db, projectId, actor.id)),
    member: publicProjectMember(row, actor.id, options.showEmails === true),
    alreadyMember,
  };
}
