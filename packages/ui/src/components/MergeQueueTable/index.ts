export {
  MergeQueueTable,
  MERGE_QUEUE_LABELS,
  type MergeQueueTableProps,
  type MergeQueueLabels,
  type MergeQueueLabelsInput,
} from './MergeQueueTable.tsx';

/*
 * The screen's shared vocabulary. It lives next to the table because the table was the first
 * consumer, but the header, the lane diagram, the rejection card and the patch panel all import
 * from here — so the barrel has to carry it whole.
 */
export {
  MERGE_LANE_BADGE,
  MERGE_LANE_LABEL,
  MERGE_LANE_STATUS,
  MERGE_QUEUE_STATE_LABEL,
  MERGE_QUEUE_STATE_STATUS,
  MERGE_CHECK_STATE_LABEL,
  GATE_REASON_TITLE,
  checkProgress,
  runningCheck,
  type MergeLane,
  type MergeQueueState,
  type MergeCheckState,
  type MergeCheck,
  type GateReasonCode,
  type InterveningWrite,
  type GateRejectionData,
  type MergeQueueDiff,
  type MergeQueueRow,
  type TrunkState,
  type TrunkHealthData,
} from './model.ts';
