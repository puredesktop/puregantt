import type { GanttDocument, GanttViewControls } from '../types'

/**
 * Exposed PureGantt operations (must stay in sync 1:1 with `plugin.json` -> `app.agents.tools[].name`).
 *
 * 3-tier exposure (built on `@purescience/platform-ui/bridge/appFunctions`):
 *   1. 4 composite `function` workflows (`fn_*`) — replace multi-step timeline briefing,
 *      blocker/impact tracing, schedule ripple shifting, and plan-building round-trips
 *   2. 3 core atomic tools — essential read/write verbs (`getGanttContext`, `createTasks`, `updateTasks`)
 *   3. 3 universal escape-hatch meta-tools (`discoverAppTools`, `callExtendedReadTool`, `callExtendedTool`)
 *      providing full on-demand access to the remaining 5 specialist atomic tools.
 */
export const PUREGANTT_FUNCTION_NAMES = [
  'fn_timelineOverview',
  'fn_analyzeBlockers',
  'fn_shiftSchedule',
  'fn_buildPlan',
] as const

export const PUREGANTT_CORE_TOOL_NAMES = [
  'getGanttContext',
  'createTasks',
  'updateTasks',
] as const

export const PUREGANTT_META_TOOL_NAMES = [
  'discoverAppTools',
  'callExtendedReadTool',
  'callExtendedTool',
] as const

export const EXPOSED_TOOL_NAMES = [
  ...PUREGANTT_FUNCTION_NAMES,
  ...PUREGANTT_CORE_TOOL_NAMES,
  ...PUREGANTT_META_TOOL_NAMES,
] as const

/** Keep in sync with `plugin.json` -> `app.agents.tools[].name`. */
export const PUREGANTT_AGENT_TOOL_NAMES = EXPOSED_TOOL_NAMES

export const PUREGANTT_EXTENDED_TOOL_NAMES = [
  'listTasks',
  'listGanttChanges',
  'setView',
  'setTimeline',
  'deleteTask',
] as const

export const PUREGANTT_ALL_ATOMIC_TOOL_NAMES = [
  ...PUREGANTT_CORE_TOOL_NAMES,
  ...PUREGANTT_EXTENDED_TOOL_NAMES,
] as const

export const PUREGANTT_AGENT_LOG_LABEL = 'gantt'

export class AgentGanttToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentGanttToolError'
  }
}

/**
 * Reads and writes are direct. Every agent write lands on the timeline
 * immediately and is recorded in the document's agent log with
 * before/after task snapshots — the log, not a review queue, is the
 * accountability mechanism; approval gates are the shell's permissions.
 */
export interface GanttAgentToolContext {
  document: GanttDocument
  setDocument: (
    updater: (current: GanttDocument) => GanttDocument,
  ) => Promise<string>
  documentPath: string | null
  /** The chart's view controls; null until the workspace has mounted. */
  view: GanttViewControls | null
}
