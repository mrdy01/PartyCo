import { useId, type ReactElement } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { Rich, type RichText } from '../Toast/rich.tsx';
import { SHELL_EVENT_TITLE, SHELL_EVENT_TONE, type ShellEvent } from '../AppShell/model.ts';
import s from './EventCard.module.css';

/**
 * Two, and the design means two: the card offers one affirmative move and one way out. A third
 * button turns an interruption into a form, and the person is in the middle of something else.
 */
const MAX_ACTIONS = 2;

export interface EventCardProps {
  /** One of the five interruptions. Everything the card draws comes from here. */
  event: ShellEvent;
  /**
   * The paragraph with typographic segments — a path in mono, a name in semibold.
   *
   * `ShellEvent.body` is a plain `string` today, and a plain `.ts` fixture cannot carry JSX, so a
   * caller that has segments passes them here and the card renders these instead. The moment
   * `body` in model.ts becomes `RichText` this prop is redundant and can go: `Rich` already
   * accepts a bare string, so `event.body` renders correctly either way.
   */
  body?: RichText | undefined;
  /**
   * Runs an action by its `id`.
   *
   * Omit it and `event.actions` are **not drawn**. The card is an interruption: «Наложить заново»
   * and «Отдать зону» read as the way out of it, and a person who presses one and gets nothing has
   * been told the tool is broken. The event itself is still worth showing without them — what
   * happened and what it means for my work is the larger half of the card — so the paragraph and
   * the aside stay and the footer simply loses its buttons.
   */
  onAction?: ((actionId: string) => void) | undefined;
  identitySet?: IdentitySetName | undefined;
  className?: string | undefined;
}

/**
 * One of the five events that may pull a person out of the conversation, as a card in the stream.
 *
 * Short by construction: what happened, what it means for my work, one first action. Anyone who
 * wants the mechanism opens the detail panel — that is what `GateRejectionPanel` is for.
 *
 * Colour discipline, because this is the surface where it is easiest to get wrong:
 *
 * · the status tone appears as a 7px dot and — when `emphasised` — as a 3px stripe along the
 *   **top** edge. Never a fill, never the left edge: the left edge is where a member's colour says
 *   "this is my zone", and the two must never be confusable (CONVENTIONS §5);
 * · `zone-requested` has no tone at all. A person is asking, not a mechanism reporting, so the dot
 *   gives way to the asker's avatar — identity role #1, the only identity colour on the card.
 *
 * There is no empty / loading / error state here on purpose: a card either exists or it does not,
 * and the three states belong to the stream that holds it.
 */
export function EventCard({
  event,
  body,
  onAction,
  identitySet,
  className,
}: EventCardProps): ReactElement {
  const titleId = useId();
  const tone = SHELL_EVENT_TONE[event.kind];
  const title = event.title ?? SHELL_EVENT_TITLE[event.kind];
  // No handler, no buttons — see the note on `onAction`.
  const actions = onAction ? (event.actions ?? []).slice(0, MAX_ACTIONS) : [];
  const hasFooter = actions.length > 0 || Boolean(event.aside);

  /* The asker's avatar wins over the dot: the card is about who is asking, not about a state. */
  const marker = event.member ? (
    <Avatar
      member={event.member}
      size="sm"
      identitySet={identitySet}
      label={event.member.name}
      className={s.avatar}
    />
  ) : tone ? (
    <span className={s.dot} data-tone={tone} aria-hidden="true" />
  ) : null;

  return (
    <article
      className={className ? `${s.root} ${className}` : s.root}
      aria-labelledby={titleId}
    >
      {/* Top edge only — see the note above. `neutral` covers an emphasised toneless event. */}
      {event.emphasised ? (
        <span className={s.stripe} data-tone={tone ?? 'neutral'} aria-hidden="true" />
      ) : null}

      <div className={s.inner}>
        <header className={s.head}>
          {marker}
          <span className={s.title} id={titleId}>
            {title}
          </span>
          {/* Relative age. Wall clock is not shown here and never reaches the agent. */}
          <span className={s.age}>{event.age}</span>
        </header>

        <p className={s.body}>
          <Rich value={body ?? event.body} />
        </p>

        {hasFooter ? (
          <div className={s.footer}>
            {actions.map((action) => (
              <Button
                key={action.id}
                variant={action.primary ? 'primary' : 'secondary'}
                size="lg"
                /* `actions` is empty unless `onAction` exists, so this is never a dead button. */
                onClick={() => onAction?.(action.id)}
              >
                {action.label}
              </Button>
            ))}
            {/* «Твоя зона этого теста не касается» — reassurance, not a control. */}
            {event.aside ? <span className={s.aside}>{event.aside}</span> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
