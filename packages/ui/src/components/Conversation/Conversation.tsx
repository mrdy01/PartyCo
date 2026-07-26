import { Fragment, type ReactElement, type ReactNode } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import { zoneEdgeStyle } from '../../identity.ts';
import type { ConversationItem, ShellEvent } from '../AppShell/model.ts';
import { Avatar, type AvatarSize } from '../Avatar/Avatar.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import { WorkSummary } from '../WorkSummary/WorkSummary.tsx';
import styles from './Conversation.module.css';

/** Mandatory states of the stream, per CONVENTIONS §6. */
export type ConversationState = 'ready' | 'loading' | 'error';

/**
 * `wide` — the 640px centred column (export lines 585–622).
 * `narrow` — the same ribbon inside the 560px pane of screen 04 (lines 784–801).
 */
export type ConversationVariant = 'wide' | 'narrow';

export interface ConversationEmptyCopy {
  title: string;
  body: string;
  /** Sits under the composer, not under the greeting — screen 08, line 1340. */
  footnote?: string | undefined;
}

export interface ConversationErrorCopy {
  title: string;
  body: string;
  retry: string;
}

export interface ConversationCopy {
  /** Accessible name of the stream. */
  streamLabel: string;
  loading: string;
  empty: ConversationEmptyCopy;
  error: ConversationErrorCopy;
}

/**
 * Deliberately impersonal. The greeting the design draws — «С чего начнём, Иван?» — carries the
 * user's name, which is data; it arrives through `copy.empty`, and these defaults only keep the
 * component from rendering a blank rectangle if nobody passes anything.
 */
export const CONVERSATION_COPY: ConversationCopy = {
  streamLabel: 'Разговор',
  loading: 'Загружаем разговор',
  empty: {
    title: 'С чего начнём?',
    body: 'Опиши задачу словами. Агент сам возьмёт нужную зону, напишет код и отправит на проверку — а если зона занята кем-то из команды, скажет об этом до начала.',
  },
  error: {
    title: 'Не получилось показать разговор',
    body: 'Хаб не ответил. Твоя работа на месте — и правки, и зона. Это только просмотр.',
    retry: 'Попробовать снова',
  },
};

/** Per-block override. Merged one level deeper than the top object — see `mergeCopy`. */
export interface ConversationCopyInput {
  streamLabel?: string | undefined;
  loading?: string | undefined;
  empty?: Partial<ConversationEmptyCopy> | undefined;
  error?: Partial<ConversationErrorCopy> | undefined;
}

/**
 * A shallow `{...defaults, ...input}` would let `{ empty: { title } }` erase the body and the
 * footnote. Each block is merged on its own — this exact mistake once wiped a whole copy block.
 */
function mergeCopy(input: ConversationCopyInput | undefined): ConversationCopy {
  if (!input) return CONVERSATION_COPY;
  return {
    streamLabel: input.streamLabel ?? CONVERSATION_COPY.streamLabel,
    loading: input.loading ?? CONVERSATION_COPY.loading,
    empty: { ...CONVERSATION_COPY.empty, ...input.empty },
    error: { ...CONVERSATION_COPY.error, ...input.error },
  };
}

export interface ConversationProps {
  items: readonly ConversationItem[];
  state?: ConversationState | undefined;
  variant?: ConversationVariant | undefined;
  /**
   * Renders an `event` item. This component draws nothing for events on purpose — the event card
   * is `EventCard`'s job, and a second implementation of it here would be a fork.
   */
  renderEvent?: ((event: ShellEvent) => ReactNode) | undefined;
  /** Expands / collapses a `work` row by its item id. */
  onToggleWork?: ((id: string) => void) | undefined;
  /** «посмотреть дифф» on a `work` row. */
  onOpenDiff?: ((id: string) => void) | undefined;
  onRetry?: (() => void) | undefined;
  /**
   * Which identity palette the member colours come from. Every surface that paints a person —
   * avatars here, the presence card's 2px left edge — has to be told the same set, or the
   * colour-blind palette switches on the event cards and leaves the ribbon on the jewel one.
   */
  identitySet?: IdentitySetName | undefined;
  /**
   * Rendered under the stream and **outside** the scroll — this is where `Composer` goes. Keeping
   * it here rather than in the caller is what guarantees it lands on the same 640px column.
   */
  footer?: ReactNode;
  copy?: ConversationCopyInput | undefined;
  className?: string | undefined;
}

type StreamMode = 'ready' | 'empty' | 'loading' | 'error';

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The conversation: one column, everything else on demand.
 *
 * Six kinds of item share the ribbon — what the person asked, what the agent answered, what it did,
 * what a teammate did, what is running, and the five interruptions. Co-presence is an item in the
 * stream and not a permanent panel, which is the inversion the whole revision is about.
 */
export function Conversation({
  items,
  state = 'ready',
  variant = 'wide',
  renderEvent,
  onToggleWork,
  onOpenDiff,
  onRetry,
  identitySet,
  footer,
  copy,
  className,
}: ConversationProps): ReactElement {
  const text = mergeCopy(copy);
  const isEmpty = items.length === 0;
  const mode: StreamMode = state === 'ready' ? (isEmpty ? 'empty' : 'ready') : state;

  const avatarSize: AvatarSize = variant === 'narrow' ? 'sm' : 'md';

  const renderItem = (item: ConversationItem): ReactNode => {
    switch (item.kind) {
      case 'prompt':
        return (
          <div key={item.id} className={styles.prompt}>
            <Avatar member={item.author} size={avatarSize} identitySet={identitySet} />
            <p className={styles.promptText}>{item.text}</p>
          </div>
        );

      case 'reply':
        return (
          <p key={item.id} className={styles.reply}>
            {item.text}
          </p>
        );

      case 'work':
        return (
          <WorkSummary
            key={item.id}
            id={item.id}
            summary={item.summary}
            added={item.added}
            removed={item.removed}
            diffLabel={item.diffLabel}
            steps={item.steps}
            expanded={item.expanded}
            variant={variant}
            onToggle={onToggleWork ? () => onToggleWork(item.id) : undefined}
            onOpenDiff={onOpenDiff ? () => onOpenDiff(item.id) : undefined}
          />
        );

      case 'presence':
        return (
          <div
            key={item.id}
            className={styles.presence}
            style={zoneEdgeStyle(item.member.colorSlug, identitySet)}
          >
            <Avatar member={item.member} size="sm" identitySet={identitySet} decorative />
            <div className={styles.presenceBody}>
              <p className={styles.presenceText}>{item.text}</p>
              <span className={styles.presenceMeta}>{item.meta}</span>
            </div>
          </div>
        );

      case 'run':
        return (
          <div key={item.id} className={styles.run}>
            <span className={styles.runDot} aria-hidden="true" />
            <span className={styles.runLabel}>{item.label}</span>
            {item.hint ? <span className={styles.runHint}>{item.hint}</span> : null}
          </div>
        );

      case 'event':
        return <Fragment key={item.id}>{renderEvent?.(item.event)}</Fragment>;
    }
  };

  let body: ReactNode;
  if (mode === 'loading') {
    body = <LoadingState rows={4} withGlyph withMeta label={text.loading} />;
  } else if (mode === 'error') {
    body = (
      <ErrorState
        title={text.error.title}
        description={text.error.body}
        {...(onRetry ? { onRetry, retryLabel: text.error.retry } : {})}
      />
    );
  } else if (mode === 'empty') {
    body = (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>{text.empty.title}</h2>
        <p className={styles.emptyBody}>{text.empty.body}</p>
      </div>
    );
  } else {
    body = items.map(renderItem);
  }

  const footnote = mode === 'empty' ? text.empty.footnote : undefined;
  const hasFooter = Boolean(footer) || Boolean(footnote);

  return (
    <div className={cx(styles.root, className)} data-variant={variant}>
      <div className={styles.stream} data-mode={mode}>
        {/*
          `log` only while there is a ribbon to announce. `LoadingState` is already a `status` and
          `ErrorState` an `alert`; nesting either inside a live region makes screen readers
          announce the same thing twice.
        */}
        <div
          className={styles.column}
          {...(mode === 'ready' ? { role: 'log', 'aria-label': text.streamLabel } : {})}
        >
          {body}
        </div>
      </div>
      {hasFooter ? (
        <div className={styles.footer}>
          <div className={styles.footerColumn}>
            {footer}
            {footnote ? <span className={styles.footnote}>{footnote}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
