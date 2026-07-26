import type { CSSProperties } from 'react';
import type { IdentitySetName } from '@partyco/tokens';

/**
 * A project member as the UI needs them. Mirrors the `member` row in the hub DB; `colorSlug` is
 * assigned once on join and then immutable — the whole "who owns what at a glance" system depends
 * on it never changing under the user.
 */
export interface Member {
  id: string;
  /** Display name. */
  name: string;
  /** 1–2 characters shown inside the avatar. Derived from `name` if absent. */
  initials?: string;
  /** Identity palette slug, e.g. `teal`. Immutable after join. */
  colorSlug: string;
  status?: MemberStatus;
  /** Provider currently in use, for the small glyph next to presence. */
  providerId?: string;
  /** True for the local user. */
  isSelf?: boolean;
}

export type MemberStatus =
  | 'idle'
  | 'thinking'
  | 'editing'
  | 'running-tests'
  | 'in-merge-queue'
  | 'offline';

/**
 * The three — and only three — roles an identity colour may take. Spec §01. Returning CSS custom
 * property references rather than hexes keeps theme switching free: the same style object is
 * correct in dark and light.
 */
export function identityVar(slug: string, set: IdentitySetName = 'jewel'): string {
  return `var(--pc-id-${set}-${slug})`;
}

export function identityOnVar(slug: string, set: IdentitySetName = 'jewel'): string {
  return `var(--pc-id-${set}-${slug}-on)`;
}

export function identityGutterVar(slug: string, set: IdentitySetName = 'jewel'): string {
  return `var(--pc-id-${set}-${slug}-gutter)`;
}

/** Identity role #1 — avatar fill. */
export function avatarStyle(slug: string, set?: IdentitySetName): CSSProperties {
  return { background: identityVar(slug, set), color: identityOnVar(slug, set) };
}

/** Identity role #2 — 2px left edge marking an owned zone. */
export function zoneEdgeStyle(slug: string | null, set?: IdentitySetName): CSSProperties {
  return {
    borderLeft: `var(--pc-zone-edge-width) solid ${slug ? identityVar(slug, set) : 'transparent'}`,
  };
}

/** Identity role #3 — diff gutter tint. */
export function diffGutterStyle(slug: string, set?: IdentitySetName): CSSProperties {
  return {
    background: identityGutterVar(slug, set),
    borderLeft: `var(--pc-zone-edge-width) solid ${identityVar(slug, set)}`,
  };
}

export function identityAreaVar(slug: string, set: IdentitySetName = 'jewel'): string {
  return `var(--pc-id-${set}-${slug}-area)`;
}

/**
 * Identity role #4 — ownership area (the Leases map). The fill states "this member owns this";
 * the 2px left edge is the same marker used everywhere else.
 *
 * `outlineStatus` paints the REMAINING border with a status colour — the one place status and
 * identity share a box without competing, because the left edge stays identity's. Pass a status
 * token name (`'warning'`, `'danger'`, …) or omit for a neutral border.
 */
export function ownershipAreaStyle(
  slug: string,
  opts: { set?: IdentitySetName; outlineStatus?: 'success' | 'warning' | 'danger' | 'running' } = {},
): CSSProperties {
  const { set, outlineStatus } = opts;
  return {
    background: identityAreaVar(slug, set),
    border: `var(--pc-border-width) solid ${
      outlineStatus
        ? `color-mix(in srgb, var(--pc-status-${outlineStatus}) 45%, transparent)`
        : `color-mix(in srgb, ${identityVar(slug, set)} 28%, transparent)`
    }`,
    borderLeft: `var(--pc-zone-edge-width) solid ${identityVar(slug, set)}`,
  };
}

/** An unowned boundary on the ownership map: dashed, neutral, deliberately quiet. */
export function freeAreaStyle(): CSSProperties {
  return {
    background: 'var(--pc-bg-panel)',
    border: `var(--pc-border-width) dashed var(--pc-border)`,
  };
}

export function initialsOf(member: Pick<Member, 'name' | 'initials'>): string {
  if (member.initials) return member.initials;
  const parts = member.name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + second).toUpperCase();
}

export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  idle: 'Ожидает',
  thinking: 'Думает',
  editing: 'Правит',
  'running-tests': 'Гоняет тесты',
  'in-merge-queue': 'В очереди на влитие',
  offline: 'Офлайн',
};

/**
 * Status colour for a presence state. Spec §01 restricts status colour to dot / pill / text, so
 * callers must only use this for those three roles — never as a panel fill or a zone edge.
 */
export function memberStatusColor(status: MemberStatus): string {
  switch (status) {
    case 'thinking':
    case 'editing':
    case 'running-tests':
      return 'var(--pc-status-running)';
    case 'in-merge-queue':
      return 'var(--pc-status-warning)';
    case 'idle':
      return 'var(--pc-text-3)';
    case 'offline':
      return 'var(--pc-text-4)';
  }
}
