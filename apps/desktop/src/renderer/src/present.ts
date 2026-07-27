/**
 * Hub JSON → the shapes the UI renders.
 *
 * The hub deals in facts: a role slug, a seat count, a millisecond timestamp. The interface shows a
 * sentence — «1 из 5 · ещё 21 час». Somebody has to turn one into the other, and it is deliberately
 * this side of the wire: `packages/ui` components take render-ready props and know nothing about the
 * network (CONVENTIONS §8), while the hub stays free to serve a second client without carrying
 * anyone's Russian grammar.
 *
 * Nothing here invents facts. Where the hub does not know something — whether a letter was actually
 * sent, for instance — the string says so rather than implying the happy case.
 */

import { initialsOf, type InviteRecord, type ProjectMember } from '@partyco/ui';
import type { HubInvite, HubMember, HubProjectMember } from './hub.ts';

/**
 * A member as the shell needs them.
 *
 * `displayName` becomes `name`, initials are derived rather than stored, and `colorSlug` is passed
 * through untouched — it was assigned once at registration and every avatar, zone edge and diff
 * gutter in the product agrees with it by construction rather than by convention.
 */
export function toProjectMember(member: HubMember, selfId?: string): ProjectMember {
  return {
    id: member.id,
    name: member.displayName,
    initials: initialsOf({ name: member.displayName }),
    colorSlug: member.colorSlug,
    handle: member.handle,
    // The hub role. Correct for the hub's own roster and **wrong** for a project's — see
    // `toProjectRosterMember`, which is what a project panel must use.
    role: member.role,
    ...(member.id === selfId ? { isSelf: true } : {}),
  };
}

/**
 * The same person, as a **project** panel must show them.
 *
 * There are two roles and one word for them. `HubMember.role` says what somebody may do on the hub —
 * hand out seats, see other people's addresses. `HubProjectMember.projectRole` says what they may do
 * in one project. They are frequently different, and the panel that shows the wrong one is not
 * slightly off: it tells an observer they are a maintainer, which is a claim about permission.
 *
 * Two functions rather than a flag, because a caller that has a `HubProjectMember` can only reach
 * for this one, and a caller that has a plain `HubMember` cannot reach for it at all. The type
 * system makes the choice instead of the reader remembering it.
 */
export function toProjectRosterMember(
  member: HubProjectMember,
  selfId?: string,
): ProjectMember {
  return { ...toProjectMember(member, selfId), role: member.projectRole };
}

/** Russian plural forms: 1 час, 2 часа, 5 часов. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A duration a person can act on — the largest unit that still says something useful.
 *
 * Rounded down, never up: «ещё 21 час» on something that expires in 21 h 50 min is a promise the
 * hub keeps. The other way round it is not.
 */
export function humanDuration(ms: number): string {
  if (ms < MINUTE) return 'меньше минуты';
  if (ms < HOUR) {
    const n = Math.floor(ms / MINUTE);
    return `${n} ${plural(n, 'минута', 'минуты', 'минут')}`;
  }
  if (ms < DAY) {
    const n = Math.floor(ms / HOUR);
    return `${n} ${plural(n, 'час', 'часа', 'часов')}`;
  }
  const n = Math.floor(ms / DAY);
  return `${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

/** «10 минут назад». */
export function humanAge(at: number, now: number): string {
  const delta = Math.max(0, now - at);
  return delta < MINUTE ? 'только что' : `${humanDuration(delta)} назад`;
}

/**
 * The right-hand note on an invitation row.
 *
 * The email case is the one worth reading twice: the hub has no SMTP client, so it never claims a
 * letter went out. Either the operator configured a mail server and sending is still unimplemented,
 * or there is no mail at all — and in both cases the honest instruction is «the link is yours to
 * send». A row that said «письмо ушло» would be the interface lying about the service.
 */
export function inviteMeta(invite: HubInvite, now: number): string {
  if (invite.status === 'revoked') return 'отменено';
  if (invite.status === 'expired') return 'истекло';
  if (invite.status === 'exhausted') {
    return invite.maxUses == null ? 'мест больше нет' : `${invite.usedCount} из ${invite.maxUses} · мест больше нет`;
  }
  if (invite.status === 'accepted') {
    return invite.channel === 'email' ? `принято ${humanAge(invite.createdAt, now)}` : 'принято';
  }

  // Still open.
  const parts: string[] = [];
  if (invite.channel === 'code') {
    parts.push(invite.maxUses == null ? `${invite.usedCount} принято` : `${invite.usedCount} из ${invite.maxUses}`);
  } else {
    parts.push('ссылка готова — отправь её сам');
  }
  if (invite.expiresAt != null) {
    const left = invite.expiresAt - now;
    parts.push(left > 0 ? `ещё ${humanDuration(left)}` : 'срок вышел');
  } else if (invite.channel === 'code') {
    parts.push('без срока');
  }
  return parts.join(' · ');
}

/**
 * One invitation, ready to render.
 *
 * The identity is the code when there is one and the address otherwise: a redacted row (somebody
 * may read the list but may not hand out seats) has neither a code nor a stable server id, so the
 * creation timestamp is the last resort — it keeps React keys stable within one response.
 */
export function toInviteRecord(invite: HubInvite, now: number): InviteRecord {
  const open = invite.status === 'pending';
  return {
    id: invite.code ?? invite.email ?? `invite-${invite.createdAt}`,
    channel: invite.channel,
    ...(invite.email ? { email: invite.email } : {}),
    ...(invite.code ? { code: invite.code } : {}),
    role: invite.role,
    status: invite.status,
    meta: inviteMeta(invite, now),
    ...(open && invite.code ? { action: { id: 'revoke', label: 'Отменить' } } : {}),
  };
}

/** Only the owner and maintainers may hand out seats — the same gate the hub enforces. */
export function canManageInvites(member: Pick<HubMember, 'role'>): boolean {
  return member.role === 'owner' || member.role === 'maintainer';
}
