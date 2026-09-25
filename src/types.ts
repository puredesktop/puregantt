import type { ResourceOpenEvent } from '@purescience/platform-ui/bridge/types'
import type { GANTT_VIEW_MODES } from './constants'

export type { ResourceOpenEvent }

export type GanttViewMode = (typeof GANTT_VIEW_MODES)[number]

export interface GanttTask {
  id: string
  name: string
  start: string
  end: string
  progress: number
  dependencies?: string
  custom_class?: string
  phase?: string
  owner?: string
  milestone?: boolean
}

export interface GanttDocument {
  schemaVersion: 1
  title: string
  viewMode: GanttViewMode
  phases?: string[]
  tasks: GanttTask[]
  /**
   * The agent log: every agent write recorded with before/after task
   * snapshots, newest first. The log — not a review queue — is the
   * accountability mechanism for agent tool writes; approval gates are
   * the shell's permissions.
   */
  agentLog?: GanttAgentLogEntry[]
  updatedAt: string
}

export interface GanttAgentLogEntry {
  id: string
  at: string
  agentName: string
  tool: string
  summary: string
  taskId?: string
  before?: GanttTask
  after?: GanttTask
}

export interface GanttPackageManifest {
  schemaVersion: 1
  appId: 'puregantt'
  slug: 'gantt'
  kind: 'gantt'
  name: string
  contentFile: string
  assetDirectories: string[]
  createdAt: string
  updatedAt: string
}

/**
 * The chart's exploration state: how the open timeline is being looked
 * at, not what it contains. Lives in the workspace, not the document.
 */
export interface GanttView {
  /** A phase name, or 'all'. */
  phaseFilter: string
  density: 'compact' | 'comfortable'
  zoom: 'fit' | 'detail' | 'wide'
  showDependencies: boolean
  showWeekends: boolean
  showOwners: boolean
}

/** Read and patch the view; the same setters the sidebar controls use. */
export interface GanttViewControls {
  get: () => GanttView
  set: (patch: Partial<GanttView>) => void
  /** The phase names the filter accepts right now. */
  phases: () => string[]
}

export interface GanttAppSettings {
  recentPaths?: string[]
}

export interface PlatformAppSettingsUpdateRequest {
  appSlug: string
  patch: Record<string, unknown>
}

export interface PureGanttBootState {
  appSettings: GanttAppSettings
}
