import { useId, useState, type ReactElement, type ReactNode, type Ref } from 'react';
import { Icon } from '@partyco/icons';
import { IconButton } from '../IconButton/IconButton.tsx';
import {
  LEASE_MODE_BADGE,
  LEASE_MODE_LABEL,
  type LeaseMode,
} from '../FileTreeRow/FileTreeRow.tsx';
import s from './ModeMatrix.module.css';

/**
 * What happens when two leases meet **on the same boundary**. Three outcomes, not two: `conditional`
 * exists because a policy may allow a pair only after a gate is lifted, and a matrix that could not
 * say so would force callers to fork the component.
 */
export type ModeCompatibility = 'ok' | 'deny' | 'conditional';

/** Row = the mode already held, column = the mode being requested. Symmetric in the default table. */
export type ModeCompatibilityMatrix = Readonly<
  Record<LeaseMode, Readonly<Record<LeaseMode, ModeCompatibility>>>
>;

/** Axis order. `R` first on purpose: the only row that is green all the way across. */
export const MODE_MATRIX_ORDER: readonly LeaseMode[] = ['read', 'impl', 'interface', 'guarded'];

/**
 * The rule of the screen, as a table. Shared read coexists with everything; any two claims that can
 * write — `I`, `X`, `G` — serialise. This is per boundary: two agents holding `I` on *different*
 * modules never see this matrix at all, which is what the note underneath says out loud.
 */
export const MODE_COMPATIBILITY: ModeCompatibilityMatrix = {
  read: { read: 'ok', impl: 'ok', interface: 'ok', guarded: 'ok' },
  impl: { read: 'ok', impl: 'deny', interface: 'deny', guarded: 'deny' },
  interface: { read: 'ok', impl: 'deny', interface: 'deny', guarded: 'deny' },
  guarded: { read: 'ok', impl: 'deny', interface: 'deny', guarded: 'deny' },
};

/** The glyph inside a cell. Never colour alone — this is what a colour-blind reader gets. */
export const MODE_COMPATIBILITY_GLYPH: Record<ModeCompatibility, string> = {
  ok: '✓',
  deny: '✕',
  conditional: '!',
};

/** One line per mode, so the letter code stops being a riddle the first time it is met. */
export const LEASE_MODE_GLOSS: Record<LeaseMode, string> = {
  read: 'Читают все и одновременно — заявка ничего не запирает.',
  impl: 'Внутренности модуля правит один, экспорт границы не меняется.',
  interface: 'Меняется контракт границы — правка расходится по зависимым модулям.',
  guarded: 'Путь под замком: запись только после явного снятия гейта.',
};

export interface ModeMatrixLabels {
  /** Header text and the accessible name of the disclosure control. */
  title: string;
  /** Table caption — screen-reader only, states the scope of the whole grid. */
  caption: string;
  /** Column of row headers, announced before the letters. */
  axisHeld: string;
  /** Row of column headers. */
  axisRequested: string;
  expand: string;
  collapse: string;
  close: string;
  legendTitle: string;
  /** Spoken form of a cell outcome — the letter grid is mute without it. */
  verdict: Record<ModeCompatibility, string>;
}

export type ModeMatrixLabelsInput = Partial<Omit<ModeMatrixLabels, 'verdict'>> & {
  verdict?: Partial<Record<ModeCompatibility, string>>;
};

export const MODE_MATRIX_LABELS: ModeMatrixLabels = {
  title: 'Совместимость режимов',
  caption: 'Совместимость режимов lease на одной границе',
  axisHeld: 'Уже держат',
  axisRequested: 'Просят',
  expand: 'Показать справку по режимам',
  collapse: 'Скрыть справку по режимам',
  close: 'Закрыть справку',
  legendTitle: 'Режимы',
  verdict: {
    ok: 'совместимы',
    deny: 'конфликт',
    conditional: 'с условием',
  },
};

function mergeLabels(input?: ModeMatrixLabelsInput): ModeMatrixLabels {
  if (!input) return MODE_MATRIX_LABELS;
  return {
    ...MODE_MATRIX_LABELS,
    ...input,
    verdict: { ...MODE_MATRIX_LABELS.verdict, ...input.verdict },
  };
}

/**
 * `inline` sits in a sidebar or a panel and keeps the surrounding rhythm; `popover` is the same
 * content lifted onto a raised surface with a shadow, for a tooltip or a floating help card.
 */
export type ModeMatrixVariant = 'inline' | 'popover';

export interface ModeMatrixProps {
  /** Axis order. Pass a subset to show a two-mode excerpt next to a single lease. */
  modes?: readonly LeaseMode[] | undefined;
  /** Override the rules — a project with a looser policy can hand in its own table. */
  matrix?: ModeCompatibilityMatrix | undefined;
  variant?: ModeMatrixVariant | undefined;
  /** Header with the twisty. Off gives a bare grid for embedding under someone else's heading. */
  showHeader?: boolean | undefined;
  /** The design's sidebar row: a disclosure that costs one line when closed. */
  collapsible?: boolean | undefined;
  /** Controlled open state. Leave out and the component keeps its own. */
  expanded?: boolean | undefined;
  defaultExpanded?: boolean | undefined;
  onExpandedChange?: ((expanded: boolean) => void) | undefined;
  /**
   * Trailing text in the header, right-aligned — the design's collapsed sidebar row ends in
   * «R I X G», so the folded line still says what the card is about. Omit for a bare header.
   */
  headerHint?: ReactNode | undefined;
  /** Renders the ✕ in the header. Omit and no close control is drawn. */
  onClose?: (() => void) | undefined;
  /** Ring the row and the column of one mode — used when the help opens from a specific lease. */
  highlightMode?: LeaseMode | undefined;
  /** The «different boundaries never conflict» paragraph. The point of the whole screen. */
  showNote?: boolean | undefined;
  note?: ReactNode | undefined;
  /** Mode names plus a one-line gloss each. */
  showLegend?: boolean | undefined;
  labels?: ModeMatrixLabelsInput | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
}

/**
 * The 4×4 mode-compatibility card. Small, self-contained and embeddable: the lease table, the
 * ownership map sidebar and the lease detail panel all need to answer the same question, and none
 * of them should own the answer.
 *
 * Colour never carries meaning alone — every cell holds a glyph and a spoken verdict, and the axes
 * spell their letters out for assistive tech. Status colour appears as a small tinted pill and an
 * outline, which is what §5 allows; identity colour has no business here at all, because a mode is
 * not a person.
 */
export function ModeMatrix({
  modes = MODE_MATRIX_ORDER,
  matrix = MODE_COMPATIBILITY,
  variant = 'inline',
  showHeader = true,
  collapsible = false,
  expanded,
  defaultExpanded = true,
  onExpandedChange,
  headerHint,
  onClose,
  highlightMode,
  showNote = true,
  note,
  showLegend = true,
  labels: labelsInput,
  className,
  ref,
}: ModeMatrixProps): ReactElement {
  const labels = mergeLabels(labelsInput);
  const bodyId = useId();
  const [selfExpanded, setSelfExpanded] = useState(defaultExpanded);

  const open = !collapsible || (expanded === undefined ? selfExpanded : expanded);

  const toggle = (): void => {
    const next = !open;
    if (expanded === undefined) setSelfExpanded(next);
    onExpandedChange?.(next);
  };

  const header = showHeader ? (
    <div className={s.header}>
      {collapsible ? (
        <button
          type="button"
          className={s.disclosure}
          aria-expanded={open}
          // Only while the body exists: a reference to a removed node is worse than no reference.
          aria-controls={open ? bodyId : undefined}
          onClick={toggle}
          title={open ? labels.collapse : labels.expand}
        >
          <Icon
            name="chevron-right"
            className={`${s.twisty} ${open ? s.twistyOpen : ''}`}
          />
          <span className={s.title}>{labels.title}</span>
        </button>
      ) : (
        <span className={s.titleStatic}>
          <Icon name="lease" className={s.titleGlyph} />
          <span className={s.title}>{labels.title}</span>
        </span>
      )}
      {headerHint !== undefined ? <span className={s.headerHint}>{headerHint}</span> : null}
      {onClose ? (
        <IconButton
          icon="close"
          label={labels.close}
          variant="ghost"
          size="sm"
          className={s.close}
          onClick={onClose}
        />
      ) : null}
    </div>
  ) : null;

  /**
   * Only the outcomes this table actually uses. A key that promises a third outcome the grid never
   * shows sends the reader hunting for a cell that is not there.
   */
  const usedVerdicts = (Object.keys(MODE_COMPATIBILITY_GLYPH) as ModeCompatibility[]).filter(
    (verdict) => modes.some((held) => modes.some((req) => matrix[held][req] === verdict)),
  );

  const defaultNote = (
    <>
      Матрица — для <b className={s.noteStrong}>одной</b> границы. Разные границы не конфликтуют
      никогда: два агента спокойно держат <span className={s.noteCode}>I</span> на разных модулях,
      сериализуется только работа над интерфейсом одного.
    </>
  );

  return (
    <section
      ref={ref}
      className={[s.root, className ?? ''].filter(Boolean).join(' ')}
      data-variant={variant}
      data-open={open}
    >
      {header}
      {open ? (
        <div className={s.body} id={bodyId}>
          <table className={s.grid}>
            <caption className={s.srOnly}>{labels.caption}</caption>
            <thead>
              <tr>
                <td className={s.corner} />
                {modes.map((mode) => (
                  <th
                    key={mode}
                    scope="col"
                    className={`${s.colHead} ${mode === highlightMode ? s.axisActive : ''}`}
                  >
                    <span aria-hidden="true">{LEASE_MODE_BADGE[mode]}</span>
                    {/* Which axis this is, spelled out: the two letters alone are identical aloud. */}
                    <span className={s.srOnly}>
                      {labels.axisRequested}: {LEASE_MODE_LABEL[mode]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modes.map((held) => (
                <tr key={held}>
                  <th
                    scope="row"
                    className={`${s.rowHead} ${held === highlightMode ? s.axisActive : ''}`}
                  >
                    <span aria-hidden="true">{LEASE_MODE_BADGE[held]}</span>
                    <span className={s.srOnly}>
                      {labels.axisHeld}: {LEASE_MODE_LABEL[held]}
                    </span>
                  </th>
                  {modes.map((requested) => {
                    const verdict = matrix[held][requested];
                    const spoken = labels.verdict[verdict];
                    const highlighted =
                      highlightMode !== undefined &&
                      (held === highlightMode || requested === highlightMode);
                    return (
                      <td key={requested} className={s.cell}>
                        <span
                          className={`${s.chip} ${highlighted ? s.chipHighlight : ''}`}
                          data-verdict={verdict}
                          title={`${LEASE_MODE_LABEL[held]} + ${LEASE_MODE_LABEL[requested]} — ${spoken}`}
                        >
                          <span aria-hidden="true">{MODE_COMPATIBILITY_GLYPH[verdict]}</span>
                          <span className={s.srOnly}>{spoken}</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* The glyph key. Without it the ✓/✕ pair is learned by colour, which is the thing we
              are explicitly not doing. */}
          <p className={s.verdictKey}>
            {usedVerdicts.map((verdict) => (
              <span key={verdict} className={s.verdictKeyItem} data-verdict={verdict}>
                <span className={s.verdictKeyGlyph} aria-hidden="true">
                  {MODE_COMPATIBILITY_GLYPH[verdict]}
                </span>
                {labels.verdict[verdict]}
              </span>
            ))}
          </p>

          {showNote ? <p className={s.note}>{note ?? defaultNote}</p> : null}

          {showLegend ? (
            <div className={s.legend}>
              <span className={s.legendTitle}>{labels.legendTitle}</span>
              <dl className={s.legendList}>
                {modes.map((mode) => (
                  <div key={mode} className={s.legendItem}>
                    <dt className={s.legendKey}>{LEASE_MODE_BADGE[mode]}</dt>
                    <dd className={s.legendText}>
                      <span className={s.legendName}>{LEASE_MODE_LABEL[mode]}</span> —{' '}
                      {LEASE_MODE_GLOSS[mode]}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
