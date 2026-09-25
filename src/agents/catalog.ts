import type { GanttDocument, GanttViewControls } from '../types'

/** Keep in sync with `plugin.json` -> `app.agents.tools[].name`. */
export const PUREGANTT_AGENT_TOOL_NAMES = [
  'getGanttContext',
  'listTasks',
  'listGanttChanges',
  'createTasks',
  'updateTasks',
  'deleteTask',
  'setTimeline',
  'setView',
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
