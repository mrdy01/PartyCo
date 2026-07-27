/*
 * GENERATED barrel — do not edit by hand.
 * Rebuild with: node packages/ui/scripts/gen-barrel.mjs
 */

export { ThemeProvider, useTheme, type ThemeApi, type ThemeState, type ThemeProviderProps } from './theme.tsx';
export * from './identity.ts';

export {
  ActivityStream,
  type ActivityStreamProps,
  type ActivityEvent,
  type ActivityResultTone,
} from './components/ActivityStream/index.ts';
export {
  AgentModeSelector,
  AGENT_MODES,
  AGENT_MODE_LABEL,
  AGENT_MODE_SHORT_LABEL,
  AGENT_MODE_ALLOWANCE,
  AGENT_MODE_ALLOWANCE_FULL,
  AGENT_MODE_SCOPE,
  AGENT_MODE_ICON,
  isAutonomous,
  type AgentMode,
  type AgentModeSelectorVariant,
  type AgentModeSelectorProps,
} from './components/AgentModeSelector/index.ts';
export {
  AgentSessionPanel,
  SCOPE_ENFORCEMENT_LABEL,
  type AgentSessionPanelProps,
  type AgentSessionError,
  type ScopeEnforcementCoverage,
  type SessionTurn,
  type SessionUserTurn,
  type SessionReasoningTurn,
  type SessionAssistantTurn,
  type SessionToolTurn,
  type SessionEditTurn,
  type SessionProposalTurn,
  type SessionToolResult,
  type SessionToolState,
  type SessionResultTone,
  type SessionModel,
  type SessionContextChip,
  type SessionShortcutHint,
} from './components/AgentSessionPanel/index.ts';
export {
  AppShell,
  type AppShellProps,
  ZONE_WORD,
  ZONE_TERM_HINT,
  AGENT_MODE_PLAIN_LABEL,
  PROJECT_ROLES,
  PROJECT_ROLE_LABEL,
  PROJECT_ROLE_TITLE,
  PROJECT_ROLE_ABILITY,
  INVITABLE_ROLES,
  MEMBER_ACTIVITY_LABEL,
  MEMBER_ACTIVITY_TONE,
  SHELL_VIEWS,
  SHELL_CONNECTION_LABEL,
  SHELL_CONNECTION_TONE,
  SHELL_TRUNK_LABEL,
  SHELL_EVENT_TITLE,
  SHELL_EVENT_TONE,
  INVITE_STATUS_LABEL,
  INVITE_STATUS_TONE,
  INVITE_LIFETIME_LABEL,
  INVITE_SEATS_LABEL,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_GROUPS,
  INVITE_CODE_GROUP_SIZE,
  FIRST_RUN_PROVIDERS,
  KEY_GUARANTEE,
  KEY_GUARANTEE_STORAGE,
  type ProjectRole,
  type MemberActivity,
  type ProjectMember,
  type ShellView,
  type ShellConnectionKind,
  type ShellTrunkState,
  type ShellStatusDetail,
  type ShellStatus,
  type ShellEventKind,
  type ShellEventAction,
  type ShellEvent,
  type WorkStep,
  type PromptItem,
  type ReplyItem,
  type WorkItem,
  type PresenceItem,
  type RunItem,
  type EventItem,
  type ConversationItem,
  type ComposerContext,
  type ZoneState,
  type ZoneTreeNode,
  type ZoneCardData,
  type ZoneTableRow,
  type OwnershipTab,
  type FileViewerLine,
  type FileViewerModel,
  type InviteChannel,
  type InviteStatus,
  type InviteRecord,
  type InviteLifetime,
  type InviteSeats,
  type FirstRunProvider,
} from './components/AppShell/index.ts';
export {
  AppTitleBar,
  APP_TITLE_BAR_LABELS,
  type AppTitleBarProps,
  type AppTitleBarLabels,
  type AppTitleBarLabelsInput,
} from './components/AppTitleBar/index.ts';
export {
  AuthPanel,
  AUTH_MODES,
  AUTH_PANEL_LABELS,
  displayNameFromEmail,
  type AuthPanelProps,
  type AuthPanelChrome,
  type AuthPanelLabels,
  type AuthPanelLabelsInput,
  type AuthMode,
  type AuthSubmit,
} from './components/AuthPanel/index.ts';
export {
  AutoRevertNotice,
  AUTO_REVERT_NOTICE_LABELS,
  AUTO_REVERT_REASSURANCE,
  type AutoRevertNoticeProps,
  type AutoRevertNoticeLabels,
  type AutoRevertNoticeState,
} from './components/AutoRevertNotice/index.ts';
export {
  Avatar,
  AvatarCount,
  type AvatarProps,
  type AvatarCountProps,
  type AvatarSize,
} from './components/Avatar/index.ts';
export {
  AvatarStack,
  type AvatarStackProps,
} from './components/AvatarStack/index.ts';
export {
  Badge,
  type BadgeProps,
  type BadgeStatus,
} from './components/Badge/index.ts';
export {
  BoundaryTree,
  visibleBoundaryRows,
  BOUNDARY_SCOPES,
  BOUNDARY_SCOPE_LABEL,
  type BoundaryTreeProps,
  type BoundaryTreeLabels,
  type BoundaryRow,
  type BoundaryStatusRow,
  type BoundaryStatusTone,
  type BoundaryScope,
  type VisibleBoundaryRowsOptions,
} from './components/BoundaryTree/index.ts';
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './components/Button/index.ts';
export {
  Checkbox,
  type CheckboxProps,
} from './components/Checkbox/index.ts';
export {
  CommandPalette,
  type CommandPaletteProps,
  type CommandPaletteGroup,
  type CommandPaletteItem,
  type CommandPaletteHint,
} from './components/CommandPalette/index.ts';
export {
  Composer,
  COMPOSER_COPY,
  type ComposerProps,
  type ComposerCopy,
  type ComposerVariant,
  type ComposerModeMenuApi,
} from './components/Composer/index.ts';
export {
  ContextRail,
  CONTEXT_RAIL_LABELS,
  type ContextRailProps,
  type ContextRailLabels,
  type ContextRailPresence,
} from './components/ContextRail/index.ts';
export {
  Conversation,
  CONVERSATION_COPY,
  type ConversationProps,
  type ConversationCopy,
  type ConversationCopyInput,
  type ConversationEmptyCopy,
  type ConversationErrorCopy,
  type ConversationState,
  type ConversationVariant,
} from './components/Conversation/index.ts';
export {
  CredentialGuarantee,
  type CredentialGuaranteeProps,
} from './components/CredentialGuarantee/index.ts';
export {
  DiffViewer,
  type DiffViewerProps,
  type DiffViewerLabels,
  type DiffViewMode,
  type DiffFile,
  type DiffHunk,
  type DiffHunkStatus,
  type DiffLine,
  type DiffComment,
} from './components/DiffViewer/index.ts';
export {
  EditorPane,
  type EditorPaneProps,
  type EditorLine,
  type EditorBreadcrumb,
  type EditorLease,
  type EditorAgentBadge,
  type EditorCheck,
  type EditorFooter,
} from './components/EditorPane/index.ts';
export {
  EmptyState,
  StateActionButton,
  type EmptyStateProps,
  type StateAction,
  type StateActionButtonProps,
} from './components/EmptyState/index.ts';
export {
  ErrorState,
  type ErrorStateProps,
} from './components/ErrorState/index.ts';
export {
  EventCard,
  type EventCardProps,
} from './components/EventCard/index.ts';
export {
  FileTree,
  visibleFileTreeRows,
  type FileTreeProps,
  type FileTreeLabels,
} from './components/FileTree/index.ts';
export {
  FileTreeRow,
  LEASE_MODE_BADGE,
  LEASE_MODE_LABEL,
  type FileTreeRowProps,
  type FileTreeRowData,
  type LeaseMode,
} from './components/FileTreeRow/index.ts';
export {
  FileViewer,
  type FileViewerProps,
  type FileViewerLabels,
  type FileViewerState,
} from './components/FileViewer/index.ts';
export {
  FirstRun,
  FIRST_RUN_COPY,
  FIRST_RUN_STEP_COUNT,
  type FirstRunProps,
  type FirstRunStep,
  type FirstRunKeySubmit,
  type FirstRunCopy,
  type FirstRunCopyInput,
  type FirstRunFolderCopy,
  type FirstRunKeyCopy,
} from './components/FirstRun/index.ts';
export {
  ForeignZoneNotice,
  type ForeignZoneNoticeProps,
} from './components/ForeignZoneNotice/index.ts';
export {
  GateRejection,
  GATE_REJECTION_LABELS,
  type GateRejectionProps,
  type GateRejectionLabels,
  type GateRejectionLabelsInput,
} from './components/GateRejection/index.ts';
export {
  GateRejectionPanel,
  GATE_REJECTION_PANEL_COPY,
  type GateRejectionPanelProps,
  type GateRejectionPanelState,
  type GateRejectionPanelCopy,
  type GateRejectionPanelCopyInput,
} from './components/GateRejectionPanel/index.ts';
export {
  HandoffInbox,
  type HandoffInboxProps,
  type HandoffInboxLabels,
  type HandoffRequest,
  type OutgoingHandoffRequest,
} from './components/HandoffInbox/index.ts';
export {
  HistoryStrip,
  type HistoryStripProps,
  type HistoryNode,
  type HistoryConnector,
  type HistoryTone,
} from './components/HistoryStrip/index.ts';
export {
  IconButton,
  type IconButtonProps,
} from './components/IconButton/index.ts';
export {
  IncidentModal,
  type IncidentModalProps,
  type IncidentParticipant,
  type IncidentFlag,
} from './components/IncidentModal/index.ts';
export {
  Input,
  type InputProps,
} from './components/Input/index.ts';
export {
  InvitePanel,
  INVITE_PANEL_LABELS,
  type InvitePanelProps,
  type InvitePanelLabels,
  type InvitePanelLabelsInput,
  type InvitePanelState,
  type InvitePanelVariant,
} from './components/InvitePanel/index.ts';
export {
  JoinProject,
  JOIN_PROJECT_LABELS,
  type JoinProjectProps,
  type JoinProjectLabels,
  type JoinProjectLabelsInput,
  type JoinProjectState,
} from './components/JoinProject/index.ts';
export {
  Kbd,
  type KbdProps,
} from './components/Kbd/index.ts';
export {
  LaneDiagram,
  LANE_DIAGRAM_LABELS,
  checkTone,
  type LaneDiagramProps,
  type LaneDiagramLabels,
  type LaneDiagramLabelsInput,
  type LaneSpec,
  type LaneTrailing,
  type LaneChipTone,
} from './components/LaneDiagram/index.ts';
export {
  LeaseChip,
  formatLeaseRemaining,
  LEASE_WARN_BELOW_MS,
  LEASE_CRITICAL_BELOW_MS,
  type LeaseChipProps,
  type LeaseUrgency,
} from './components/LeaseChip/index.ts';
export {
  LeaseDetail,
  type LeaseDetailProps,
  type LeaseDetailLabels,
  type LeaseDetailData,
  type LeaseDetailFile,
  type LeaseHistoryEntry,
  type LeaseHistoryTone,
} from './components/LeaseDetail/index.ts';
export {
  LeaseScreenStates,
  LEASE_SCREEN_STATE_COPY,
  LEASE_TABLE_SKELETON_COLUMNS,
  type LeaseScreenStatesProps,
  type LeaseScreenState,
  type LeaseScreenStateCopy,
  type LeaseScreenStateCopyInput,
} from './components/LeaseScreenStates/index.ts';
export {
  LeaseTable,
  LEASE_TABLE_LABELS,
  LEASE_STATE_GROUP,
  LEASE_STATE_TONE,
  type LeaseTableProps,
  type LeaseRow,
  type LeaseRowAction,
  type LeaseRowState,
  type LeaseStateGroup,
  type LeaseGrouping,
  type LeaseTone,
  type LeaseTableLabels,
  type LeaseTableLabelsInput,
  type GuardedPath,
  type GuardedPathsSummary,
} from './components/LeaseTable/index.ts';
export {
  LoadingState,
  type LoadingStateProps,
  type LoadingStateColumn,
  type LoadingStateFade,
} from './components/LoadingState/index.ts';
export {
  MergeQueueStates,
  MERGE_QUEUE_STATE_COPY,
  MERGE_QUEUE_SKELETON_COLUMNS,
  type MergeQueueStatesProps,
  type MergeQueueScreenState,
  type MergeQueueMetric,
  type MergeQueueStateCopy,
  type MergeQueueStateCopyInput,
} from './components/MergeQueueStates/index.ts';
export {
  MergeQueueTable,
  MERGE_QUEUE_LABELS,
  type MergeQueueTableProps,
  type MergeQueueLabels,
  type MergeQueueLabelsInput,
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
} from './components/MergeQueueTable/index.ts';
export {
  ModeMatrix,
  MODE_MATRIX_ORDER,
  MODE_COMPATIBILITY,
  MODE_COMPATIBILITY_GLYPH,
  MODE_MATRIX_LABELS,
  LEASE_MODE_GLOSS,
  type ModeMatrixProps,
  type ModeMatrixVariant,
  type ModeMatrixLabels,
  type ModeMatrixLabelsInput,
  type ModeCompatibility,
  type ModeCompatibilityMatrix,
} from './components/ModeMatrix/index.ts';
export {
  ModelPicker,
  formatContextWindow,
  type ModelPickerProps,
  type ModelProviderGroup,
  type ModelOption,
  type ModelCapability,
} from './components/ModelPicker/index.ts';
export {
  NavRail,
  type NavRailProps,
  type NavRailItem,
  type NavRailBadge,
  type NavRailConnectionHealth,
} from './components/NavRail/index.ts';
export {
  OwnershipBar,
  type OwnershipBarProps,
  type OwnershipShare,
} from './components/OwnershipBar/index.ts';
export {
  OwnershipMap,
  packOwnershipLines,
  OWNERSHIP_MAP_COLOR_BY,
  OWNERSHIP_MAP_LABELS,
  OWNERSHIP_AGE_BUCKETS,
  OWNERSHIP_MODE_NAME,
  type OwnershipMapProps,
  type OwnershipMapRow,
  type OwnershipMapLine,
  type OwnershipMapColorBy,
  type OwnershipMapTone,
  type OwnershipMapError,
  type OwnershipMapLabels,
  type OwnershipMapLabelsInput,
  type OwnershipAgeBucket,
} from './components/OwnershipMap/index.ts';
export {
  OwnershipSummary,
  type OwnershipSummaryProps,
} from './components/OwnershipSummary/index.ts';
export {
  PatchDetail,
  PATCH_DETAIL_LABELS,
  type PatchDetailProps,
  type PatchDetailLabels,
  type PatchFile,
  type PatchHistoryEntry,
  type PatchHistoryTone,
} from './components/PatchDetail/index.ts';
export {
  PendingDecisions,
  type PendingDecisionsProps,
  type PendingDecision,
} from './components/PendingDecisions/index.ts';
export {
  PresenceRow,
  type PresenceRowProps,
} from './components/PresenceRow/index.ts';
export {
  ProviderGlyph,
  type ProviderGlyphProps,
  type ProviderGlyphVariant,
} from './components/ProviderGlyph/index.ts';
export {
  ProviderSetup,
  PROVIDER_SETUP_COPY,
  PROVIDER_POLICY_SELECTABLE,
  PROVIDER_POLICY_LABEL,
  PROVIDER_POLICY_TONE,
  type ProviderSetupProps,
  type ProviderSetupItem,
  type ProviderSetupState,
  type ProviderSetupCopy,
  type ProviderSetupCopyInput,
  type ProviderMode,
  type ProviderPolicyStatus,
  type ProviderTransportInfo,
  type ProviderCliDetection,
} from './components/ProviderSetup/index.ts';
export {
  ResolutionPath,
  type ResolutionPathProps,
  type ResolutionStep,
  type ResolutionStepAction,
} from './components/ResolutionPath/index.ts';
export {
  SearchField,
  type SearchFieldProps,
} from './components/SearchField/index.ts';
export {
  Select,
  type SelectProps,
  type SelectOption,
} from './components/Select/index.ts';
export {
  SessionFrame,
  type SessionFrameProps,
  type SessionActivityItem,
  type SessionActivityState,
} from './components/SessionFrame/index.ts';
export {
  ShellTitleBar,
  SHELL_TITLE_BAR_LABELS,
  type ShellTitleBarProps,
  type ShellTitleBarLabels,
} from './components/ShellTitleBar/index.ts';
export {
  SignInScreen,
  SIGN_IN_COPY,
  type SignInScreenProps,
  type SignInCopy,
  type SignInCopyInput,
} from './components/SignInScreen/index.ts';
export {
  Skeleton,
  type SkeletonProps,
  type SkeletonVariant,
  type SkeletonRadius,
} from './components/Skeleton/index.ts';
export {
  StatusBar,
  CONNECTION_LABEL,
  formatTokens,
  leaseWord,
  type StatusBarProps,
  type StatusBarVariant,
  type StatusBarDock,
  type ConnectionMode,
  type LeaseTally,
  type TrunkIndicator,
} from './components/StatusBar/index.ts';
export {
  StatusLine,
  STATUS_LINE_LABELS,
  type StatusLineProps,
  type StatusLineLabels,
} from './components/StatusLine/index.ts';
export {
  Switch,
  type SwitchProps,
} from './components/Switch/index.ts';
export {
  Tab,
  type TabProps,
  type TabKind,
} from './components/Tab/index.ts';
export {
  Tabs,
  type TabsProps,
  type TabItem,
  type TabsZoneNotice,
} from './components/Tabs/index.ts';
export {
  TeamPanel,
  TEAM_PANEL_LABELS,
  type TeamPanelProps,
  type TeamPanelLabels,
  type TeamPanelLabelsInput,
  type TeamPanelState,
} from './components/TeamPanel/index.ts';
export {
  Toast,
  type ToastProps,
  type ToastAction,
  type ToastVariant,
  type RichText,
  type TextSegment,
  Rich,
  type RichProps,
} from './components/Toast/index.ts';
export {
  ToastStack,
  type ToastStackProps,
  type ToastItem,
  type ToastPlacement,
} from './components/ToastStack/index.ts';
export {
  TrunkHealth,
  TRUNK_HEALTH_LABELS,
  type TrunkHealthProps,
  type TrunkHealthLabels,
  type TrunkHealthLabelsInput,
  type TrunkMerge,
  type TrunkOwner,
} from './components/TrunkHealth/index.ts';
export {
  WorkSummary,
  WORK_SUMMARY_COPY,
  type WorkSummaryProps,
  type WorkSummaryCopy,
  type WorkSummaryVariant,
  type WorkStepsState,
} from './components/WorkSummary/index.ts';
export {
  ZoneBoard,
  ZONE_BOARD_LABELS,
  ZONE_BOARD_TABS,
  type ZoneBoardProps,
  type ZoneBoardState,
  type ZoneBoardLabels,
  type ZoneBoardLabelsInput,
  type ZoneBoardColumnLabels,
} from './components/ZoneBoard/index.ts';
export {
  ZoneTree,
  visibleZoneTreeRows,
  type ZoneTreeProps,
  type ZoneTreeLabels,
  type ZoneTreeState,
} from './components/ZoneTree/index.ts';
