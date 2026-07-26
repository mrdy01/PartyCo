import type { ReactElement } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import { Icon } from '@partyco/icons';
import { Avatar } from '../Avatar/Avatar.tsx';
import {
  MEMBER_ACTIVITY_LABEL,
  MEMBER_ACTIVITY_TONE,
  SHELL_VIEWS,
  type ProjectMember,
  type ShellView,
} from '../AppShell/model.ts';
import s from './ContextRail.module.css';

/** Status colour of the presence dot on the local user's avatar. Dot role only. */
export type ContextRailPresence = 'success' | 'warning' | 'danger' | 'running';

export interface ContextRailLabels {
  /** Accessible name of the `<nav>`. */
  nav: string;
  /** Accessible name of the `+` button. Starting a task and starting a conversation are one act. */
  newTask: string;
}

export const CONTEXT_RAIL_LABELS: ContextRailLabels = {
  nav: 'Разделы проекта',
  newTask: 'Новая задача',
};

export interface ContextRailProps {
  /** Which of `SHELL_VIEWS` is open. */
  view: ShellView;
  onViewChange?: ((view: ShellView) => void) | undefined;
  /** 1–2 characters for the project square, e.g. «Х». */
  projectInitial: string;
  onNewTask?: (() => void) | undefined;
  /** The local user, pinned to the bottom. */
  self: ProjectMember;
  /**
   * Overrides the presence dot's colour. By default it follows `self.activity` through
   * `MEMBER_ACTIVITY_TONE`, so the rail and the team panel can never disagree about the same
   * person. `null` removes the dot — a dot is a claim that something is happening.
   */
  presenceTone?: ContextRailPresence | null | undefined;
  identitySet?: IdentitySetName | undefined;
  labels?: Partial<ContextRailLabels> | undefined;
  className?: string | undefined;
}

/** Field-by-field, so an explicit `undefined` in a partial override cannot erase a default. */
function mergeLabels(labels: Partial<ContextRailLabels> | undefined): ContextRailLabels {
  if (!labels) return CONTEXT_RAIL_LABELS;
  return {
    nav: labels.nav ?? CONTEXT_RAIL_LABELS.nav,
    newTask: labels.newTask ?? CONTEXT_RAIL_LABELS.newTask,
  };
}

/**
 * The rail is 52px of permanent chrome, and it is deliberately short.
 *
 * Four destinations, all from `SHELL_VIEWS`. The merge queue is not one of them — a queue is a
 * state, not a place, so it lives as a tab inside «Владение» and as cards in the stream. Settings
 * is the fourth destination and sits at the foot with the gear, where chrome settings belong; the
 * three that are about the work stay together at the top.
 *
 * `NavRail` is not forked and not replaced: it keeps its badges, its connection dot and the three
 * original screens.
 */
export function ContextRail({
  view,
  onViewChange,
  projectInitial,
  onNewTask,
  self,
  presenceTone,
  identitySet,
  labels,
  className,
}: ContextRailProps): ReactElement {
  const text = mergeLabels(labels);

  const workViews = SHELL_VIEWS.filter((item) => item.id !== 'settings');
  const settingsView = SHELL_VIEWS.find((item) => item.id === 'settings');

  const activity = self.activity;
  const derivedTone = activity ? MEMBER_ACTIVITY_TONE[activity] : null;
  const tone = presenceTone === undefined ? derivedTone : presenceTone;
  const selfName = activity ? `${self.name} · ${MEMBER_ACTIVITY_LABEL[activity]}` : self.name;

  function renderItem(item: (typeof SHELL_VIEWS)[number]): ReactElement {
    const active = item.id === view;
    return (
      <li key={item.id} className={s.listItem}>
        <button
          type="button"
          className={s.item}
          data-active={active || undefined}
          {...(active ? { 'aria-current': 'page' as const } : {})}
          onClick={() => onViewChange?.(item.id)}
          aria-label={item.label}
          title={item.label}
        >
          <Icon name={item.icon} className={s.icon} />
        </button>
      </li>
    );
  }

  return (
    <div className={className ? `${s.rail} ${className}` : s.rail}>
      <span className={s.project} aria-hidden="true">
        <span className={s.projectInitial}>{projectInitial}</span>
      </span>

      <button
        type="button"
        className={s.newTask}
        onClick={onNewTask}
        aria-label={text.newTask}
        title={text.newTask}
      >
        <Icon name="plus" className={s.newTaskIcon} strokeWidth={1.5} />
      </button>

      <nav className={s.nav} aria-label={text.nav}>
        <ul className={s.list}>{workViews.map(renderItem)}</ul>
        {settingsView ? <ul className={s.footList}>{renderItem(settingsView)}</ul> : null}
      </nav>

      <span className={s.self}>
        <Avatar
          member={self}
          size="md"
          label={selfName}
          className={s.selfAvatar}
          {...(identitySet ? { identitySet } : {})}
        />
        {tone ? <span className={s.presence} data-tone={tone} aria-hidden="true" /> : null}
      </span>
    </div>
  );
}
