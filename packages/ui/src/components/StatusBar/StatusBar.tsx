import { Fragment, type ReactElement, type ReactNode } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import { Icon } from '@partyco/icons';
import { avatarStyle } from '../../identity.ts';
import {
  AGENT_MODE_LABEL,
  isAutonomous,
  type AgentMode,
} from '../AgentModeSelector/AgentModeSelector.tsx';
import styles from './StatusBar.module.css';

/** How this client reaches the hub. Mirrors `connectivity-options.md`. */
export type ConnectionMode = 'lan' | 'p2p' | 'relay' | 'vps';

export const CONNECTION_LABEL: Record<ConnectionMode, string> = {
  lan: 'LAN',
  p2p: 'P2P',
  relay: 'Relay',
  vps: 'VPS',
};

/**
 * Connection health as a status colour — dot only, per spec §01. Relay is the honest "works, but
 * you are paying latency for it" case, hence warning rather than success.
 */
function connectionStatusVar(mode: ConnectionMode): string {
  switch (mode) {
    case 'lan':
    case 'p2p':
      return 'var(--pc-status-success)';
    case 'vps':
      return 'var(--pc-status-running)';
    case 'relay':
      return 'var(--pc-status-warning)';
  }
}

/** Active leases held by one member. The square uses identity role #1 (avatar fill). */
export interface LeaseTally {
  /** Identity palette slug of the holder. */
  colorSlug: string;
  count: number;
  /** Holder name, for the accessible label. */
  name?: string;
}

/**
 * Trunk health, reduced to one dot and one word.
 *
 * Added for screen 2.4, where the queue depth alone is not enough: «5 в очереди» reads the same
 * whether the trunk builds or not, and "is the trunk green" is the question the bar is glanced at
 * for. Status colour as dot + text — roles #1 and #3, no fill, no edge.
 */
export interface TrunkIndicator {
  state: 'green' | 'red';
  /** «ствол зелёный» / «ствол красный». The bar never invents its own wording. */
  label: string;
}

/**
 * A · всё подряд — every fact, left to right.
 * B · три зоны — connection left, "me" in the middle, money and mode right. The design's pick.
 * C · с полосой расхода — tokens as a filling gauge, for quota-bound subscriptions.
 */
export type StatusBarVariant = 'all' | 'zones' | 'meter';

/**
 * `panel` — a boxed bar sitting inside a page, as the design-system page shows it.
 * `bottom` — welded to the bottom edge of the window: no radius, a single hairline on top.
 */
export type StatusBarDock = 'panel' | 'bottom';

export interface StatusBarProps {
  variant?: StatusBarVariant;
  /** Where the bar lives. `bottom` drops the box so it reads as part of the window chrome. */
  dock?: StatusBarDock;
  /** Transport in use. */
  connection: ConnectionMode;
  /** True when the transport is a direct dial rather than a relayed hop. */
  direct?: boolean;
  /**
   * Word for a direct dial. Suffixed in `all` (`LAN direct`), prefixed in the zoned variants
   * (`прямое · LAN · 1 мс`), because there it opens the connection zone.
   */
  directLabel?: string;
  latencyMs: number;
  /**
   * Suffix appended to the latency number verbatim — include the leading space if the language
   * wants one (`' мс'`). Default keeps the design-system's tight `4ms`.
   */
  latencyUnit?: string;
  /** Working branch / worktree, e.g. `wt/ivan`. */
  branch: string;
  /** Branch this worktree was cut from, shown as `← trunk`. */
  baseBranch?: string;
  /** Active leases, grouped by holder. */
  leases?: readonly LeaseTally[];
  /** Depth of the merge queue. */
  queueDepth: number;
  /** Trunk health next to the depth. Omit on screens that do not answer for the trunk. */
  trunk?: TrunkIndicator | undefined;
  /** Open incidents. Rendered only above zero — an empty bar must not carry a red zero. */
  incidents?: number;
  /** Makes the incident cluster a real button, e.g. to open the incident panel. */
  onIncidentsClick?: () => void;
  /**
   * Monotonic hub state version. First-class, not decoration: the product never shows an agent's
   * wall-clock deadline, so this counter plus relative ages is how a human tells "am I looking at
   * the same world as everyone else" (см. docs/architecture.md).
   */
  stateVersion?: number;
  /** Caption before `stateVersion`. A protocol field name, hence not translated by default. */
  stateVersionLabel?: string;
  /** Active model id as the provider reports it. */
  model: string;
  /** One-letter provider badge, e.g. `A` for Anthropic. */
  providerInitial?: string;
  /** Tokens spent in this session. */
  tokens: number;
  /** Quota, when there is one — turns the token readout into a gauge in the `meter` variant. */
  tokenBudget?: number;
  /** Pre-formatted spend, e.g. `$0.38`. Formatting is the caller's business, not the bar's. */
  cost?: string;
  agentMode: AgentMode;
  identitySet?: IdentitySetName;
  /** Word before the merge-queue depth. */
  queueLabel?: string;
  label?: string;
  className?: string;
}

/** `42700 → "42.7k"`. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  const k = count / 1000;
  return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}k`;
}

/**
 * `lease` / `leases`.
 *
 * The term is Latin on purpose, like `claim`, `trunk`, `gate` and `fast lane` already are in this
 * UI: it names a mechanism, not an everyday object, and it is the same word the protocol and the
 * database use. That decision deleted the three-branch Russian declension this function used to
 * carry — «1 лиз / 2 лиза / 5 лизов» — and with it a whole class of off-by-one wording bugs.
 */
export function leaseWord(count: number): string {
  return count === 1 ? 'lease' : 'leases';
}

function totalLeases(leases: readonly LeaseTally[] | undefined): number {
  return (leases ?? []).reduce((sum, item) => sum + item.count, 0);
}

/** Russian plural for «инцидент». Kept module-local — the bar is the only place that needs it. */
function incidentWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'инцидент';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'инцидента';
  return 'инцидентов';
}

/**
 * One-line session status bar: connection, latency, branch, leases, merge queue, model, spend and
 * the agent mode. All mono, one row, geometry from the density tokens.
 */
export function StatusBar({
  variant = 'zones',
  dock = 'panel',
  connection,
  direct = false,
  directLabel = 'direct',
  latencyMs,
  latencyUnit = 'ms',
  branch,
  baseBranch,
  leases,
  queueDepth,
  trunk,
  incidents = 0,
  onIncidentsClick,
  stateVersion,
  stateVersionLabel = 'state_version',
  model,
  providerInitial,
  tokens,
  tokenBudget,
  cost,
  agentMode,
  identitySet,
  queueLabel = 'очередь',
  label = 'Статус сессии',
  className,
}: StatusBarProps): ReactElement {
  const leaseCount = totalLeases(leases);
  const connectionName = CONNECTION_LABEL[connection];
  const latency = `${latencyMs}${latencyUnit}`;
  /** In the zoned variants the direct dial opens the line, as the workspace shell shows it. */
  const connectionText = `${direct ? `${directLabel} · ` : ''}${connectionName} · ${latency}`;
  const connectionLabel = `Связь · ${connectionName}${direct ? ` ${directLabel}` : ''}, задержка ${latencyMs} мс`;

  const root = className ? `${styles.bar} ${className}` : styles.bar;

  if (variant === 'all') {
    const parts: ReactNode[] = [
      <span
        key="conn"
        className={styles.connection}
        role="group"
        aria-label={`Связь · ${connectionName}${direct ? ` ${directLabel}` : ''}`}
      >
        <span className={styles.dot} style={{ background: connectionStatusVar(connection) }} />
        {connectionName}
        {direct ? ` ${directLabel}` : ''}
      </span>,
      <span key="latency" className={styles.value} aria-label={`Задержка ${latencyMs} мс`}>
        {latency}
      </span>,
      <span key="branch" className={styles.strong}>
        {branch}
      </span>,
      <span key="leases" className={styles.value}>
        {leaseCount} {leaseWord(leaseCount)}
      </span>,
      <span key="queue" className={styles.value}>
        {queueLabel} {queueDepth}
      </span>,
      ...(trunk ? [<Trunk key="trunk" trunk={trunk} />] : []),
      <span key="model" className={styles.value}>
        {model}
      </span>,
      <span key="spend" className={styles.value}>
        {formatTokens(tokens)}
        {cost ? ` · ${cost}` : ''}
      </span>,
      <ModeText key="mode" mode={agentMode} />,
    ];
    return (
      <div
        className={root}
        data-variant={variant}
        data-dock={dock}
        role="group"
        aria-label={label}
      >
        {parts.map((part, index) => (
          <Fragment key={index}>
            {index > 0 ? (
              <span className={styles.separator} aria-hidden="true">
                ·
              </span>
            ) : null}
            {part}
          </Fragment>
        ))}
      </div>
    );
  }

  if (variant === 'meter') {
    const used = tokenBudget && tokenBudget > 0 ? Math.min(1, tokens / tokenBudget) : 0;
    return (
      <div
        className={root}
        data-variant={variant}
        data-dock={dock}
        role="group"
        aria-label={label}
      >
        <span className={styles.connection} role="group" aria-label={connectionLabel}>
          <span className={styles.dot} style={{ background: connectionStatusVar(connection) }} />
          <span className={styles.value}>{connectionText}</span>
        </span>
        <span className={styles.divider} aria-hidden="true" />
        <span className={styles.strong}>{branch}</span>
        <LeaseChips leases={leases} identitySet={identitySet} detailed />
        <span
          className={styles.gauge}
          role="group"
          aria-label={
            tokenBudget
              ? `Токены ${tokens} из ${tokenBudget}`
              : `Токены ${tokens}${cost ? `, ${cost}` : ''}`
          }
        >
          <span className={styles.gaugeText}>
            {formatTokens(tokens)}
            {tokenBudget ? ` / ${formatTokens(tokenBudget)}` : ''}
            {cost ? ` · ${cost}` : ''}
          </span>
          {tokenBudget ? (
            <span className={styles.gaugeTrack} aria-hidden="true">
              <span className={styles.gaugeFill} style={{ width: `${used * 100}%` }} />
            </span>
          ) : null}
        </span>
        <ModePill mode={agentMode} />
      </div>
    );
  }

  return (
    <div className={root} data-variant={variant} data-dock={dock} role="group" aria-label={label}>
      <span className={styles.connection} role="group" aria-label={connectionLabel}>
        <span className={styles.dot} style={{ background: connectionStatusVar(connection) }} />
        <span className={styles.value}>{connectionText}</span>
      </span>
      <span className={styles.divider} aria-hidden="true" />
      <span className={styles.branch}>
        <Icon name="branch" className={styles.icon} />
        <span className={styles.strong}>{branch}</span>
        {baseBranch ? (
          <span className={styles.baseBranch}>
            <span aria-hidden="true">← </span>
            <span className={styles.srOnly}>отведена от </span>
            {baseBranch}
          </span>
        ) : null}
      </span>
      <LeaseChips leases={leases} identitySet={identitySet} />
      <span className={styles.queue}>
        <span className={styles.value}>{queueLabel}</span>
        <span className={styles.strong}>{queueDepth}</span>
      </span>
      {trunk ? <Trunk trunk={trunk} /> : null}
      <Incidents count={incidents} {...(onIncidentsClick ? { onClick: onIncidentsClick } : {})} />
      {stateVersion !== undefined ? (
        <span
          className={styles.stateVersion}
          role="group"
          aria-label={`Версия состояния ${stateVersion}`}
        >
          <span className={styles.caption} aria-hidden="true">
            {stateVersionLabel}
          </span>
          <span className={styles.value}>{stateVersion}</span>
        </span>
      ) : null}
      <span className={styles.model}>
        {providerInitial ? (
          <span className={styles.providerBadge} aria-hidden="true">
            {providerInitial}
          </span>
        ) : null}
        <span className={styles.value}>{model}</span>
      </span>
      <span className={styles.spend} role="group" aria-label={`Расход ${formatTokens(tokens)}${cost ? `, ${cost}` : ''}`}>
        <span className={styles.value}>{formatTokens(tokens)}</span>
        {cost ? (
          <>
            <span className={styles.separator} aria-hidden="true">
              ·
            </span>
            <span className={styles.strong}>{cost}</span>
          </>
        ) : null}
      </span>
      <ModePill mode={agentMode} />
    </div>
  );
}

function Trunk({ trunk }: { trunk: TrunkIndicator }): ReactElement {
  return (
    <span className={styles.trunk} data-state={trunk.state}>
      <span className={styles.trunkDot} aria-hidden="true" />
      {trunk.label}
    </span>
  );
}

function LeaseChips({
  leases,
  identitySet,
  detailed = false,
}: {
  leases: readonly LeaseTally[] | undefined;
  identitySet: IdentitySetName | undefined;
  detailed?: boolean;
}): ReactElement | null {
  if (!leases || leases.length === 0) return null;
  const total = totalLeases(leases);

  if (!detailed) {
    const first = leases[0];
    return (
      <span
        className={styles.leases}
        role="group"
        aria-label={`Активных lease: ${total}`}
      >
        {first ? (
          <span className={styles.chip} style={avatarStyle(first.colorSlug, identitySet)} />
        ) : null}
        <span className={styles.value}>
          {total} {leaseWord(total)}
        </span>
      </span>
    );
  }

  return (
    <span className={styles.leases} role="group" aria-label={`Активных lease: ${total}`}>
      {leases.map((item) => (
        <Fragment key={item.colorSlug}>
          <span
            className={styles.chip}
            style={avatarStyle(item.colorSlug, identitySet)}
            title={item.name}
          />
          <span className={styles.value}>{item.count}</span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Open incidents — status colour as glyph + text, never as a fill. Silent at zero: a bar that
 * always carries a red field teaches people to stop seeing red.
 */
function Incidents({ count, onClick }: { count: number; onClick?: () => void }): ReactElement | null {
  if (count <= 0) return null;
  const body = (
    <>
      <Icon name="incident" className={styles.incidentIcon} />
      <span>
        {count} {incidentWord(count)}
      </span>
    </>
  );
  if (!onClick) {
    return (
      <span className={styles.incidents} role="status">
        {body}
      </span>
    );
  }
  return (
    <button type="button" className={styles.incidentsButton} onClick={onClick}>
      {body}
    </button>
  );
}

/** Mode as plain status text — variant A, where every field is a bare word. */
function ModeText({ mode }: { mode: AgentMode }): ReactElement {
  return (
    <span className={styles.modeText} data-mode={mode} role="status">
      {AGENT_MODE_LABEL[mode]}
    </span>
  );
}

/** Mode as a pill — the autonomous mode keeps its pulsing dot here too. */
function ModePill({ mode }: { mode: AgentMode }): ReactElement {
  return (
    <span className={styles.modePill} data-mode={mode} role="status">
      {isAutonomous(mode) ? <span className={styles.modeDot} /> : null}
      {AGENT_MODE_LABEL[mode]}
    </span>
  );
}
