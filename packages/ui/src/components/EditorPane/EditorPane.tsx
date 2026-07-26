import { Fragment, type ReactNode } from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { avatarStyle, diffGutterStyle, type Member } from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tabs, type TabItem } from '../Tabs/Tabs.tsx';
import styles from './EditorPane.module.css';

/**
 * One rendered line of the open file. The pane never parses a patch — the caller hands it lines
 * that already know their number and whether the agent just added them.
 */
export interface EditorLine {
  /** Line number as it appears in the file. Also the React key, so it must be unique. */
  n: number;
  text: string;
  /** `added` paints the success tint, the success edge and the success line number. */
  kind?: 'added' | undefined;
}

/** project › boundary › dir… › file. The boundary segment carries the owner's colour swatch. */
export interface EditorBreadcrumb {
  project: string;
  /** Boundary (zone) path, e.g. `packages/economy`. */
  boundary: string;
  /** Directories between the boundary and the file. */
  dirs?: readonly string[] | undefined;
  file: string;
}

/** The «I · твой lease» chip. `symbol` is the lease class letter, `label` the wording next to it. */
export interface EditorLease {
  symbol: string;
  label: string;
}

/** Floating «твой агент писал 4 с назад» badge over the top-right of the code. */
export interface EditorAgentBadge {
  member: Member;
  text: string;
}

export interface EditorCheck {
  label: string;
  /** Defaults to true — the clean state the design draws. */
  ok?: boolean | undefined;
}

export interface EditorFooter {
  /** «Стр 129, Кол 22» */
  caret?: string | undefined;
  added?: number | undefined;
  removed?: number | undefined;
  /** «миникарта выкл» */
  minimap?: string | undefined;
  /** Right-aligned typecheck verdict. Ignored when `end` is given. */
  check?: EditorCheck | undefined;
  /** Right-aligned custom content, replacing `check`. */
  end?: ReactNode | undefined;
}

export interface EditorPaneProps {
  /** Member holding the boundary the open file lives in. Supplies all three identity roles. */
  owner: Member;
  breadcrumb: EditorBreadcrumb;
  lines: readonly EditorLine[];
  /** Tab strip. Omitted → no strip (the embedded foreign-zone card has none). */
  tabs?: readonly TabItem[] | undefined;
  activeTabId?: string | undefined;
  onSelectTab?: ((id: string) => void) | undefined;
  onCloseTab?: ((id: string) => void) | undefined;
  onNewTab?: (() => void) | undefined;
  /** Everyone who might own a zone, so a tab can resolve its `zoneOwnerId`. */
  members?: readonly Member[] | undefined;
  identitySet?: IdentitySetName | undefined;
  lease?: EditorLease | undefined;
  /** «TypeScript · UTF-8 · LF» */
  meta?: string | undefined;
  /** Read-only: lock chip in the header, dimmed code, no text cursor. */
  readOnly?: boolean | undefined;
  readOnlyLabel?: string | undefined;
  /** Explanatory strip between the breadcrumb and the code — see `ForeignZoneNotice`. */
  banner?: ReactNode | undefined;
  agentBadge?: EditorAgentBadge | undefined;
  footer?: EditorFooter | undefined;
  /** Accessible name of the scrollable code area. */
  codeLabel?: string | undefined;
  breadcrumbLabel?: string | undefined;
  className?: string | undefined;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The centre of the workspace: tab strip, breadcrumb, code with the owner's edge and gutter, the
 * floating "your agent just wrote here" badge and the status footer.
 *
 * Everything colourful in it is one of the two sanctioned palettes: the boundary owner's identity
 * colour (edge + gutter tint + swatch + lease chip, all through the identity helpers) and the
 * success status colour on the diff markers.
 */
export function EditorPane({
  owner,
  breadcrumb,
  lines,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  members,
  identitySet,
  lease,
  meta,
  readOnly = false,
  readOnlyLabel = 'только чтение',
  banner,
  agentBadge,
  footer,
  codeLabel = 'Код файла',
  breadcrumbLabel = 'Путь к файлу',
  className,
}: EditorPaneProps): React.ReactElement {
  const showTabs = tabs !== undefined && tabs.length > 0 && activeTabId !== undefined && onSelectTab !== undefined;
  const dirs = breadcrumb.dirs ?? [];

  const separator = <Icon name="chevron-right" className={styles.sep} />;

  const footerEnd =
    footer?.end ??
    (footer?.check ? (
      <span className={styles.check} data-ok={footer.check.ok === false ? 'false' : 'true'}>
        <Icon name={footer.check.ok === false ? 'close' : 'check'} className={styles.checkGlyph} />
        <span>{footer.check.label}</span>
      </span>
    ) : null);

  return (
    <section className={cx(styles.root, className)}>
      {showTabs ? (
        <Tabs
          tabs={tabs}
          activeId={activeTabId}
          onSelect={onSelectTab}
          onClose={onCloseTab}
          onNewTab={onNewTab}
          members={members}
          identitySet={identitySet}
        />
      ) : null}

      <div className={styles.header}>
        <nav className={styles.crumbs} aria-label={breadcrumbLabel}>
          <span className={styles.crumb}>{breadcrumb.project}</span>
          {separator}
          <span className={styles.boundary}>
            {/* Identity role #1 — a swatch is an avatar without initials. */}
            <span
              className={styles.swatch}
              style={avatarStyle(owner.colorSlug, identitySet)}
              aria-hidden="true"
            />
            <span className={styles.crumbBoundary}>{breadcrumb.boundary}</span>
          </span>
          {separator}
          {dirs.map((dir) => (
            <Fragment key={dir}>
              <span className={styles.crumb}>{dir}</span>
              {separator}
            </Fragment>
          ))}
          <span className={styles.crumbFile} aria-current="page">
            {breadcrumb.file}
          </span>
        </nav>

        <span className={styles.headerEnd}>
          {lease ? (
            // Identity role #3 — gutter-strength tint plus the owner's edge, never a solid fill.
            <span
              className={styles.lease}
              style={diffGutterStyle(owner.colorSlug, identitySet)}
              title={`${lease.symbol} · ${lease.label} · ${owner.name}`}
            >
              <span className={styles.leaseSymbol} style={avatarStyle(owner.colorSlug, identitySet)}>
                {lease.symbol}
              </span>
              <span className={styles.leaseLabel}>{lease.label}</span>
            </span>
          ) : null}
          {readOnly ? (
            <span className={styles.lock}>
              <Icon name="lease" className={styles.lockGlyph} />
              <span>{readOnlyLabel}</span>
            </span>
          ) : null}
          {meta ? <span className={styles.meta}>{meta}</span> : null}
        </span>
      </div>

      {banner ? <div className={styles.banner}>{banner}</div> : null}

      <div className={styles.body} data-dim={readOnly ? 'true' : undefined}>
        {/* Identity role #3 again: the 2px owner edge on the far left plus the tinted gutter. */}
        <div
          className={styles.gutter}
          style={diffGutterStyle(owner.colorSlug, identitySet)}
          aria-hidden="true"
        >
          {lines.map((line) => (
            <span
              key={line.n}
              className={cx(styles.num, line.kind === 'added' && styles.numAdded)}
            >
              {line.n}
            </span>
          ))}
        </div>

        <pre
          className={styles.code}
          data-readonly={readOnly ? 'true' : undefined}
          role="region"
          aria-label={codeLabel}
          aria-readonly={readOnly || undefined}
          tabIndex={0}
        >
          <code className={styles.codeInner}>
            {lines.map((line) => (
              <span
                key={line.n}
                className={cx(styles.line, line.kind === 'added' && styles.lineAdded)}
              >
                {line.text}
              </span>
            ))}
          </code>
        </pre>

        {agentBadge ? (
          <div className={styles.badge}>
            <Avatar member={agentBadge.member} size="xs" identitySet={identitySet} decorative />
            <span className={styles.badgeText}>{agentBadge.text}</span>
          </div>
        ) : null}
      </div>

      {footer ? (
        <div className={styles.footer}>
          {footer.caret ? <span className={styles.footItem}>{footer.caret}</span> : null}
          {footer.added !== undefined || footer.removed !== undefined ? (
            <span className={styles.footDiff}>{`+${footer.added ?? 0} −${footer.removed ?? 0}`}</span>
          ) : null}
          {footer.minimap ? <span className={styles.footItem}>{footer.minimap}</span> : null}
          {footerEnd ? <span className={styles.footerEnd}>{footerEnd}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
