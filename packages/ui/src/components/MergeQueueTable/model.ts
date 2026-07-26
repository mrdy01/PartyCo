/**
 * The merge-queue vocabulary, in one place.
 *
 * Screen 2.4 draws the same handful of facts in five different components — the header, the lane
 * diagram, the table, the rejection card and the patch panel — and they must not drift. So the
 * types live here rather than inside whichever component happened to need them first, and every
 * component on the screen imports from this module.
 *
 * Wording rule that outranks convenience: the UI never says «отклонён». A gate is a mechanism, not
 * a reviewer, so the row says «не пропущен гейтом». `GATE_REASON_TITLE` is the only place that text
 * exists.
 */
import type { RichText } from '../Toast/rich.tsx';
import type { ResolutionStep } from '../ResolutionPath/ResolutionPath.tsx';
import type { HistoryNode } from '../HistoryStrip/HistoryStrip.tsx';
import type { LeaseMode } from '../FileTreeRow/FileTreeRow.tsx';
import type { Member } from '../../identity.ts';

/* ------------------------------------------------------------------ lanes */

/**
 * Where the patch physically is. The design calls this «Полоса» and gives it its own column,
 * because "which checks are even running on me right now" is a different question from "what is
 * happening to me" — a patch can be waiting *and* already through fast lane.
 *
 * `fast` and `full` are the two check lanes; `merge` and `trunk` are the two terminal placements.
 */
export type MergeLane =
  | 'waiting'
  | 'fast'
  | 'fast-ok'
  | 'rebase'
  | 'full'
  | 'merge'
  | 'trunk'
  | 'rejected';

/** Latin on purpose — it is a placement code, like the lease mode letters. */
export const MERGE_LANE_BADGE: Record<MergeLane, string> = {
  waiting: 'Ожидание',
  fast: 'Fast',
  'fast-ok': 'Fast ok',
  rebase: 'Rebase',
  full: 'Full',
  merge: 'Merge',
  trunk: 'Trunk',
  rejected: 'Fast ✕',
};

/** Spelled out for assistive tech — the chip alone is unreadable aloud. */
export const MERGE_LANE_LABEL: Record<MergeLane, string> = {
  waiting: 'ждёт очереди',
  fast: 'идёт fast lane',
  'fast-ok': 'fast lane пройден',
  rebase: 'переносится на свежий trunk',
  full: 'идёт full lane',
  merge: 'вливается в trunk',
  trunk: 'в trunk',
  rejected: 'не пропущен гейтом',
};

/** Which status colour the lane chip carries. Status colour as pill — role #2, allowed. */
export const MERGE_LANE_STATUS: Record<MergeLane, 'success' | 'warning' | 'danger' | 'running' | 'neutral'> =
  {
    waiting: 'neutral',
    fast: 'running',
    'fast-ok': 'success',
    rebase: 'warning',
    full: 'running',
    merge: 'running',
    trunk: 'success',
    rejected: 'danger',
  };

/* ----------------------------------------------------------------- states */

/**
 * What is happening to the patch. Read in the «Состояние» column, one row at a time.
 *
 * `rebasing` is deliberately distinct from `checking`: a rebase moves the patch onto a fresher
 * trunk and invalidates whatever the checks had already proved, so conflating the two would let the
 * row claim progress it no longer has.
 */
export type MergeQueueState =
  | 'waiting'
  | 'fast-passed'
  | 'rebasing'
  | 'checking'
  | 'merging'
  | 'merged'
  | 'rejected';

export const MERGE_QUEUE_STATE_LABEL: Record<MergeQueueState, string> = {
  waiting: 'ждёт',
  'fast-passed': 'fast lane пройден',
  rebasing: 'rebasing на свежий trunk',
  checking: 'проверки идут',
  merging: 'вливается в trunk',
  merged: 'влит',
  rejected: 'не пропущен гейтом',
};

export const MERGE_QUEUE_STATE_STATUS: Record<
  MergeQueueState,
  'success' | 'warning' | 'danger' | 'running' | 'neutral'
> = {
  waiting: 'neutral',
  'fast-passed': 'success',
  rebasing: 'warning',
  checking: 'running',
  merging: 'running',
  merged: 'success',
  rejected: 'danger',
};

/* ----------------------------------------------------------------- checks */

export type MergeCheckState = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export const MERGE_CHECK_STATE_LABEL: Record<MergeCheckState, string> = {
  pending: 'в очереди',
  running: 'идёт',
  passed: 'прошла',
  failed: 'упала',
  skipped: 'пропущена',
};

/**
 * One gate check.
 *
 * `id` is the machine name and `label` is what the design paints — they are identical today
 * (`affected tests`, `write-continuity`) and stay separate anyway, because the label is a UI string
 * and the id is a protocol value. Check names are Latin on purpose: they name programs, not actions.
 *
 * Progress is `done`/`total` rather than a percentage so the row can print «96/312» and the bar can
 * derive its width from the same pair — the design shows both and they must never disagree.
 */
export interface MergeCheck {
  id: string;
  label: string;
  lane: 'fast' | 'full';
  state: MergeCheckState;
  done?: number;
  total?: number;
  /** Already humanised: «0.4 с», «6.1 с». Never a timestamp — wall clock stays away from the agent. */
  duration?: string;
  /** One short line of why it failed: «2 из 88», «граница нарушена». */
  failure?: string;
  /** Extra note the lane chip carries next to the name: «1 отказ». */
  note?: string;
  /** Present only when there is somewhere to go. A check with no log renders no link. */
  logHref?: string;
  diffHref?: string;
}

/** Progress of a running check as the row and the chip both draw it. */
export function checkProgress(check: MergeCheck): { pct: number; label: string } | null {
  if (check.done == null || check.total == null || check.total <= 0) return null;
  return {
    pct: Math.max(0, Math.min(100, Math.round((check.done / check.total) * 100))),
    label: `${check.done}/${check.total}`,
  };
}

/* ------------------------------------------------------------ gate refusal */

/**
 * Why the gate did not let the patch through. These are protocol values, not prose: the same three
 * strings appear in the daemon's events, so the UI shows them verbatim as a code chip and puts the
 * human sentence next to it rather than instead of it.
 */
export type GateReasonCode =
  | 'intervening_write'
  | 'guarded_without_continuous_lease'
  | 'checks_failed';

/** The short human title. Never «отклонён» — see the module header. */
export const GATE_REASON_TITLE: Record<GateReasonCode, string> = {
  intervening_write: 'пока патч ехал',
  guarded_without_continuous_lease: 'lease держался не непрерывно',
  checks_failed: 'упали проверки',
};

/** A write that landed in the same paths while the patch stood in the queue. */
export interface InterveningWrite {
  id: string;
  author: Member;
  path: string;
  added?: number;
  removed?: number;
  /** Relative age, already humanised: «11 мин назад». */
  ago: string;
}

/**
 * Everything the expanded rejection needs. One shape for all three reasons: each reason fills the
 * fields it has and leaves the rest out, so the card is data-driven rather than three forks.
 *
 * `…Data` because the component that draws it is called `GateRejection`, and the barrel refuses to
 * export one name twice — deliberately, since a shadowed export is invisible until it bites.
 */
export interface GateRejectionData {
  code: GateReasonCode;
  /** What the code points at — the guarded file, usually. Mono, next to the code chip. */
  subject?: string;
  /** The paragraph. Rich because the design bolds and monospaces inside the sentence. */
  explanation: RichText;
  /** `intervening_write` — who wrote what, while the patch was queued. */
  writes?: readonly InterveningWrite[];
  /** `checks_failed` — the checks that failed, with their log and diff links. */
  failedChecks?: readonly MergeCheck[];
  /** `checks_failed` — the rule's own output. Two mono lines. Never raw git, never `<<<<<<<`. */
  output?: readonly string[];
  /** `guarded_without_continuous_lease` — the continuity strip that proves the gap. */
  history?: readonly HistoryNode[];
  /** Ways out, same grammar as an incident. */
  steps: readonly ResolutionStep[];
  /** The tone-setting footnote. «Это не выговор…» */
  footnote?: string;
}

/* -------------------------------------------------------------------- row */

export interface MergeQueueDiff {
  added: number;
  removed: number;
}

/**
 * One patch in the queue.
 *
 * `position` is 1-based; a merged row keeps its number in the data and the table draws a check
 * instead, because the row is about to leave and renumbering it first would make everything below
 * jump twice.
 */
export interface MergeQueueRow {
  id: string;
  position: number;
  /** Branch name — how the queue identifies the patch. */
  branch: string;
  /** Claim id as the daemon knows it: `c-2284`. */
  claimId: string;
  /** What the claim is about, in plain Russian. */
  claimTitle: string;
  author: Member;
  /** Boundary the patch touches: `services/matchmaker`. */
  boundary: string;
  /** Lease mode held on that boundary — the R/I/X/G badge next to it. */
  leaseMode: LeaseMode;
  diff: MergeQueueDiff;
  state: MergeQueueState;
  lane: MergeLane;
  checks: readonly MergeCheck[];
  /** Trailer after the state: «fast lane пройден за 9 с · ждёт очереди», «база отставала на 12». */
  stateNote?: string;
  /** `merged` — the sha it landed as. */
  mergedSha?: string;
  /** `rejected` — how long ago, relative: «2 мин назад». */
  rejectedAgo?: string;
  /** `rejected` — the payload the expanded row draws. */
  rejection?: GateRejectionData;
  /** The local user's own patch: the design says «ждёт · твой патч». */
  own?: boolean;
  /** Patch id shown in the detail panel header: `p-5512`. */
  patchId?: string;
}

/** The check currently in flight, if any — what the «Состояние» cell shows a live bar for. */
export function runningCheck(row: MergeQueueRow): MergeCheck | null {
  return row.checks.find((check) => check.state === 'running') ?? null;
}

/* ------------------------------------------------------------------ trunk */

/**
 * Trunk health as the screen header states it.
 *
 * Only two values, because the header is a verdict and a verdict has no middle: either the trunk
 * builds or it does not. Anything softer would let a broken trunk read as a warning.
 */
export type TrunkState = 'green' | 'red';

export interface TrunkHealthData {
  state: TrunkState;
  /** Short sha of the last commit that was green. */
  lastGreenSha: string;
  /** Relative age of that commit: «9 мин», «только что». Never a clock time. */
  lastGreenAgo: string;
  /** Who landed it. */
  lastGreenAuthor?: string;
  /** How many patches are in the queue. One source for rail, titlebar, header and status bar. */
  depth: number;
  /** Relative estimate: «~7 мин». For the human only — it never reaches the agent's context. */
  drainEta?: string;
  /** p95 of the fast lane: «17 с». */
  fastLaneP95?: string;
  /** Gate refusals today. Amber when non-zero — a count, not a verdict. */
  rejectionsToday?: number;
}
