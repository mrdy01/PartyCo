import type { ReactElement, ReactNode } from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { zoneEdgeStyle, type Member } from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import {
  LEASE_MODE_BADGE,
  LEASE_MODE_LABEL,
  type LeaseMode,
} from '../FileTreeRow/FileTreeRow.tsx';
import s from './HandoffInbox.module.css';

/**
 * Somebody wants a lease I currently hold. The card never argues with the person: it states the
 * overlap that makes the second lease impossible, and leaves the decision unhurried.
 */
export interface HandoffRequest {
  id: string;
  /** Who is asking. Supplies the avatar and the 2px identity edge of the card. */
  requester: Member;
  /** Mode they need — `impl`, `interface`, … Rendered as its single-letter code. */
  mode: LeaseMode;
  /** Boundary the request is about, e.g. `packages/economy`. */
  boundary: string;
  /** Claim identifier the request belongs to, e.g. `c-2299`. */
  claimId?: string | undefined;
  /** What the claim is trying to do, in the requester's own words. */
  claimTitle?: string | undefined;
  /** How long it has been waiting, e.g. «ждёт 6 мин». Status text — never a countdown scare. */
  waitedFor?: string | undefined;
  /** Symbol or module the two claims collide on, e.g. `Money`. Drives the default explanation. */
  overlapOn?: string | undefined;
  /** Replaces the generated explanation when a request needs its own wording. */
  explanation?: ReactNode;
}

/** A request I sent for somebody else's lease. */
export interface OutgoingHandoffRequest {
  id: string;
  /** Who holds the lease I asked for. Supplies the avatar and the identity edge. */
  holder: Member;
  mode: LeaseMode;
  boundary: string;
  waitedFor?: string | undefined;
  /**
   * The honest advisory: their lease is drifting toward its TTL on its own, so the boundary may
   * free itself and the request may never need an answer. The one place the two live lists on the
   * screen are tied into a single piece of advice.
   */
  advisory?: string | undefined;
}

export interface HandoffInboxLabels {
  /** Panel heading. */
  title: string;
  /** Sub-heading above my own requests. */
  outgoingTitle: string;
  /** «Тимур просит …» — the verb between the requester and the mode code. */
  asksFor: string;
  /** «у Марины · X на rp-jobs» — the preposition opening an outgoing row. */
  heldBy: string;
  grant: string;
  afterCurrentTask: string;
  decline: string;
  cancelOutgoing: string;
  /** Closing sentence of the explanation. Deliberately about the mechanism, not the person. */
  mechanismNote: string;
  empty: string;
  emptyDescription: string;
  loading: string;
  retry: string;
  errorDescription: string;
}

const DEFAULT_LABELS: HandoffInboxLabels = {
  title: 'Запросы на передачу',
  outgoingTitle: 'Мои исходящие',
  asksFor: 'просит',
  heldBy: 'у',
  grant: 'Передать',
  afterCurrentTask: 'После текущей задачи',
  decline: 'Отказать',
  cancelOutgoing: 'Отменить запрос',
  mechanismNote: 'Это механика, не отказ от человека — решать можно спокойно.',
  empty: 'Никто не ждёт границу',
  emptyDescription: 'Твои leases никому не мешают прямо сейчас.',
  loading: 'Загружаю запросы…',
  retry: 'Повторить',
  errorDescription: 'Запросы живут в журнале хаба — ни один не потерян, пока список недоступен.',
};

export interface HandoffInboxProps {
  /** Requests for leases I hold. */
  incoming?: readonly HandoffRequest[] | undefined;
  /** Requests I sent for leases other people hold. */
  outgoing?: readonly OutgoingHandoffRequest[] | undefined;
  identitySet?: IdentitySetName | undefined;
  /** Hand the lease over now. */
  onGrant?: ((id: string) => void) | undefined;
  /** Queue the handover behind whatever I am doing — the answer that costs nobody anything. */
  onDefer?: ((id: string) => void) | undefined;
  /** Say no. Stays a quiet, bordered control: refusing is legitimate, not shameful. */
  onDecline?: ((id: string) => void) | undefined;
  /** Withdraw one of my own requests. */
  onCancelOutgoing?: ((id: string) => void) | undefined;
  loading?: boolean | undefined;
  /** Human-readable failure, rendered instead of the lists. */
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  labels?: Partial<HandoffInboxLabels> | undefined;
  className?: string | undefined;
}

/** `packages/economy`, `Money`, `I` — a code fragment inside a Russian sentence. */
function Code({ children }: { children: ReactNode }): ReactElement {
  return <span className={s.code}>{children}</span>;
}

function ModeCode({ mode }: { mode: LeaseMode }): ReactElement {
  return (
    <span className={s.code} title={LEASE_MODE_LABEL[mode]} aria-label={LEASE_MODE_LABEL[mode]}>
      {LEASE_MODE_BADGE[mode]}
    </span>
  );
}

/**
 * Incoming handovers and my own outgoing ones.
 *
 * The socially sharp surface of the product, so the copy carries one rule: every sentence is about
 * the mechanism (an overlap, a TTL, an epoch), never about the person asking. «Передать» is the one
 * affirmative action; «После текущей задачи» exists so that "not now" does not have to become "no".
 */
export function HandoffInbox({
  incoming = [],
  outgoing = [],
  identitySet,
  onGrant,
  onDefer,
  onDecline,
  onCancelOutgoing,
  loading = false,
  error = null,
  onRetry,
  labels,
  className,
}: HandoffInboxProps): ReactElement {
  const text: HandoffInboxLabels = { ...DEFAULT_LABELS, ...labels };
  const hasIncomingActions = Boolean(onGrant || onDefer || onDecline);

  return (
    <section
      className={className ? `${s.panel} ${className}` : s.panel}
      aria-label={text.title}
    >
      <header className={s.head}>
        <h3 className={s.headTitle}>{text.title}</h3>
        {!loading && !error && incoming.length > 0 ? (
          <span className={s.count} aria-label={`${text.title}: ${incoming.length}`}>
            {incoming.length}
          </span>
        ) : null}
      </header>

      <div className={s.body}>
        {loading ? (
          <LoadingState rows={2} withMeta label={text.loading} />
        ) : error ? (
          <ErrorState
            title={error}
            description={text.errorDescription}
            retryLabel={text.retry}
            {...(onRetry ? { onRetry } : {})}
          />
        ) : incoming.length === 0 && outgoing.length === 0 ? (
          <EmptyState title={text.empty} description={text.emptyDescription} icon="lease" />
        ) : (
          <>
            {incoming.length > 0 ? (
              <ul className={s.list}>
                {incoming.map((request) => (
                  <li
                    key={request.id}
                    className={s.card}
                    style={zoneEdgeStyle(request.requester.colorSlug, identitySet)}
                  >
                    <div className={s.cardHead}>
                      <Avatar member={request.requester} size="sm" identitySet={identitySet} decorative />
                      <div className={s.cardTitleBlock}>
                        <p className={s.cardTitle}>
                          {request.requester.name} {text.asksFor} <ModeCode mode={request.mode} />{' '}
                          на <Code>{request.boundary}</Code>
                        </p>
                        {request.claimId || request.claimTitle ? (
                          <p className={s.cardClaim}>
                            {request.claimId}
                            {request.claimId && request.claimTitle ? ' · ' : ''}
                            {request.claimTitle ? `«${request.claimTitle}»` : null}
                          </p>
                        ) : null}
                      </div>
                      {request.waitedFor ? (
                        <span className={s.waited}>{request.waitedFor}</span>
                      ) : null}
                    </div>

                    <p className={s.reason}>
                      {request.explanation ?? (
                        <>
                          {request.overlapOn ? (
                            <>
                              Пересечение по <Code>{request.overlapOn}</Code>: взять{' '}
                              <ModeCode mode={request.mode} /> поверх твоего lease нельзя, пока он
                              держится.{' '}
                            </>
                          ) : (
                            <>
                              Взять <ModeCode mode={request.mode} /> на <Code>{request.boundary}</Code>{' '}
                              нельзя, пока твой lease держится.{' '}
                            </>
                          )}
                          {text.mechanismNote}
                        </>
                      )}
                    </p>

                    {hasIncomingActions ? (
                      <div className={s.actions}>
                        {onGrant ? (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => onGrant(request.id)}
                            aria-label={`${text.grant} · ${request.boundary}`}
                          >
                            {text.grant}
                          </Button>
                        ) : null}
                        {onDefer ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onDefer(request.id)}
                            aria-label={`${text.afterCurrentTask} · ${request.boundary}`}
                          >
                            {text.afterCurrentTask}
                          </Button>
                        ) : null}
                        {onDecline ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={s.quiet}
                            onClick={() => onDecline(request.id)}
                            aria-label={`${text.decline} · ${request.boundary}`}
                          >
                            {text.decline}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {outgoing.length > 0 ? (
              <section className={s.outgoing} aria-label={text.outgoingTitle}>
                <h4 className={s.subTitle}>
                  {text.outgoingTitle} · {outgoing.length}
                </h4>
                <ul className={s.list}>
                  {outgoing.map((request) => (
                    <li
                      key={request.id}
                      className={`${s.card} ${s.cardQuiet}`}
                      style={zoneEdgeStyle(request.holder.colorSlug, identitySet)}
                    >
                      <div className={s.outgoingHead}>
                        <Avatar
                          member={request.holder}
                          size="xs"
                          identitySet={identitySet}
                          decorative
                        />
                        <span className={s.outgoingTitle}>
                          {text.heldBy} {request.holder.name} · <ModeCode mode={request.mode} /> на{' '}
                          <Code>{request.boundary}</Code>
                        </span>
                        {request.waitedFor ? (
                          <span className={s.waitedQuiet}>{request.waitedFor}</span>
                        ) : null}
                      </div>

                      {request.advisory ? (
                        <p className={s.advisory}>
                          <Icon name="clock" className={s.advisoryGlyph} />
                          <span>{request.advisory}</span>
                        </p>
                      ) : null}

                      {onCancelOutgoing ? (
                        <div className={s.actions}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={s.quiet}
                            onClick={() => onCancelOutgoing(request.id)}
                            aria-label={`${text.cancelOutgoing} · ${request.boundary}`}
                          >
                            {text.cancelOutgoing}
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
