import type { ReactNode } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import { avatarStyle, diffGutterStyle, type Member } from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import {
  EditorPane,
  type EditorBreadcrumb,
  type EditorLine,
} from '../EditorPane/EditorPane.tsx';
import styles from './ForeignZoneNotice.module.css';

export interface ForeignZoneNoticeProps {
  /** The member who holds the boundary. Supplies every colour on this surface. */
  holder: Member;
  breadcrumb: EditorBreadcrumb;
  lines: readonly EditorLine[];
  /** Boundary path named in the sentence. Defaults to `breadcrumb.boundary`. */
  boundaryPath?: string | undefined;
  /** Lease class letter, e.g. `X`. */
  leaseSymbol?: string | undefined;
  /** «интерфейсный lease» — the words before the class letter. */
  leaseKindLabel?: string | undefined;
  /** «неактивна 29 мин · TTL 12 с». Live value, recomputed by the caller. */
  leaseLine?: string | undefined;
  /** «claim c-2291 «диспетчер RP-работ»» */
  claimLine?: string | undefined;
  /** The sentence that does the actual work. Override only to change the grammar. */
  explanation?: string | undefined;
  /** Replaces the assembled first line entirely, when the caller knows better declensions. */
  headline?: ReactNode | undefined;
  onRequestHandover?: (() => void) | undefined;
  onOpenReadCopy?: (() => void) | undefined;
  requestLabel?: string | undefined;
  readCopyLabel?: string | undefined;
  /** «запрос уйдёт в её inbox» */
  actionHint?: string | undefined;
  readOnlyLabel?: string | undefined;
  /** «курсор отключён» */
  cursorLabel?: string | undefined;
  /** «Марина правит этот файл сейчас». Defaults to the holder's first name plus that wording. */
  footerNote?: string | undefined;
  noticeLabel?: string | undefined;
  identitySet?: IdentitySetName | undefined;
  className?: string | undefined;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * The calm read-only state: the open file sits inside somebody else's boundary.
 *
 * Deliberately unalarming — no danger colour, no warning glyph, no «доступ запрещён». The tint is
 * the holder's identity colour (role #3), the lock is neutral chrome, and the copy says the same
 * thing the mechanics say: reading is free, writing waits for the lease, and here are two ways
 * forward. The design's own note for this block reads «спокойно, без тревоги, с выходом».
 */
export function ForeignZoneNotice({
  holder,
  breadcrumb,
  lines,
  boundaryPath,
  leaseSymbol = 'X',
  leaseKindLabel = 'интерфейсный lease',
  leaseLine,
  claimLine,
  explanation = 'Читать можно всё. Записать нельзя, пока lease у неё — так работает механика, а не запрет от человека.',
  headline,
  onRequestHandover,
  onOpenReadCopy,
  requestLabel = 'Запросить передачу',
  readCopyLabel = 'Открыть копию для чтения',
  actionHint = 'запрос уйдёт в её inbox',
  readOnlyLabel = 'только чтение',
  cursorLabel = 'курсор отключён',
  footerNote,
  noticeLabel = 'Файл в зоне другого участника',
  identitySet,
  className,
}: ForeignZoneNoticeProps): React.ReactElement {
  const path = boundaryPath ?? breadcrumb.boundary;
  const note = footerNote ?? `${firstName(holder.name)} правит этот файл сейчас`;
  const meta = [leaseLine, claimLine].filter(Boolean).join(' · ');

  const banner = (
    // Identity role #3 — the holder's colour as a gutter-strength tint plus their edge.
    <section
      className={styles.banner}
      style={diffGutterStyle(holder.colorSlug, identitySet)}
      aria-label={noticeLabel}
    >
      <Avatar member={holder} size="sm" identitySet={identitySet} decorative />
      <div className={styles.body}>
        <div className={styles.headGroup}>
          <p className={styles.headline}>
            {headline ?? (
              <>
                Границу <code className={styles.code}>{path}</code> держит {holder.name} —{' '}
                {leaseKindLabel}{' '}
                {/* Identity role #1 — the class letter rides an avatar-shaped chip rather than
                    borrowing the holder's colour as text. */}
                <span
                  className={styles.symbol}
                  style={avatarStyle(holder.colorSlug, identitySet)}
                  title={`${leaseKindLabel} ${leaseSymbol}`}
                >
                  {leaseSymbol}
                </span>
              </>
            )}
          </p>
          {meta ? <p className={styles.meta}>{meta}</p> : null}
        </div>

        <p className={styles.explanation}>{explanation}</p>

        <div className={styles.actions}>
          <Button size="sm" variant="secondary" onClick={onRequestHandover}>
            {requestLabel}
          </Button>
          <Button size="sm" variant="ghost" className={styles.outlined} onClick={onOpenReadCopy}>
            {readCopyLabel}
          </Button>
          <span className={styles.hint}>{actionHint}</span>
        </div>
      </div>
    </section>
  );

  return (
    <EditorPane
      owner={holder}
      breadcrumb={breadcrumb}
      lines={lines}
      identitySet={identitySet}
      readOnly
      readOnlyLabel={readOnlyLabel}
      banner={banner}
      className={className ? `${styles.card} ${className}` : styles.card}
      footer={{
        caret: cursorLabel,
        end: (
          <span className={styles.footNote}>
            <Avatar member={holder} size="xs" identitySet={identitySet} decorative />
            <span>{note}</span>
          </span>
        ),
      }}
    />
  );
}
