import {
  GANTT_APP_SLUG,
  GANTT_DOCUMENT_FILE,
  GANTT_EXPORTS_DIR,
} from '../constants'
import { isIsoDate } from './ganttDates'
import type {
  GanttAgentLogEntry,
  GanttDocument,
  GanttPackageManifest,
  GanttTask,
  GanttViewMode,
} from '../types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isViewMode(value: unknown): value is GanttViewMode {
  return (
    value === 'Day' || value === 'Week' || value === 'Month' || value === 'Year'
  )
}

export function normalizePhases(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .filter((phase): phase is string => typeof phase === 'string')
    .map(phase => phase.trim())
    .filter(phase => {
      if (!phase) return false
      const key = phase.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export const DEFAULT_GANTT_TITLE = 'Untitled gantt'

/**
 * A new timeline is empty: no tasks, no phases, no invented owners. Sample
 * plans exist (`ganttSamples.ts`) but only land when the user asks for one.
 */
export function createDefaultGanttDocument(
  title = DEFAULT_GANTT_TITLE,
): GanttDocument {
  return {
    schemaVersion: 1,
    title,
    viewMode: 'Month',
    phases: [],
    tasks: [],
    updatedAt: new Date().toISOString(),
  }
}

function normalizeTask(value: unknown, index: number): GanttTask | null {
  if (!isRecord(value)) return null
  const id =
    typeof value.id === 'string' && value.id.trim()
      ? value.id.trim()
      : `task-${index + 1}`
  const name =
    typeof value.name === 'string' && value.name.trim()
      ? value.name.trim()
      : `Task ${index + 1}`
  // A task the chart cannot place is dropped; an unplaceable end collapses
  // onto the start so the task survives as a one-day bar.
  const start =
    typeof value.start === 'string' && isIsoDate(value.start.trim())
      ? value.start.trim()
      : ''
  if (!start) return null
  const end =
    typeof value.end === 'string' && isIsoDate(value.end.trim())
      ? value.end.trim()
      : start
  const progressNumber =
    typeof value.progress === 'number' && Number.isFinite(value.progress)
      ? value.progress
      : 0
  return {
    id,
    name,
    start,
    end: end < start ? start : end,
    progress: Math.max(0, Math.min(100, Math.round(progressNumber))),
    dependencies:
      typeof value.dependencies === 'string' && value.dependencies.trim()
        ? value.dependencies.trim()
        : undefined,
    custom_class:
      typeof value.custom_class === 'string' && value.custom_class.trim()
        ? value.custom_class.trim()
        : undefined,
    phase:
      typeof value.phase === 'string' && value.phase.trim()
        ? value.phase.trim()
        : undefined,
    owner:
      typeof value.owner === 'string' && value.owner.trim()
        ? value.owner.trim()
        : undefined,
    milestone: value.milestone === true,
  }
}

export function parseGanttDocument(raw: string): GanttDocument {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) {
    throw new Error('Not a Gantt timeline: expected a JSON object.')
  }
  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1) {
    throw new Error(`Unsupported Gantt schema version: ${String(parsed.schemaVersion)}`)
  }
  const tasks = Array.isArray(parsed.tasks)
    ? parsed.tasks
        .map((task, index) => normalizeTask(task, index))
        .filter((task): task is GanttTask => Boolean(task))
    : []
  return {
    schemaVersion: 1,
    title:
      typeof parsed.title === 'string' && parsed.title.trim()
        ? parsed.title.trim()
        : DEFAULT_GANTT_TITLE,
    viewMode: isViewMode(parsed.viewMode) ? parsed.viewMode : 'Month',
    phases: normalizePhases(parsed.phases),
    tasks,
    agentLog: normalizeAgentLog(parsed.agentLog),
    updatedAt:
      typeof parsed.updatedAt === 'string'
        ? parsed.updatedAt
        : new Date().toISOString(),
  }
}

export function serializeGanttDocument(document: GanttDocument): string {
  return `${JSON.stringify(
    {
      ...document,
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`
}

export function createGanttPackageManifest(
  packagePath: string | null,
  document: GanttDocument,
  existing?: GanttPackageManifest | null,
): GanttPackageManifest {
  const now = new Date().toISOString()
  const name =
    document.title.trim() ||
    packagePath
      ?.replace(/\/+$/g, '')
      .split('/')
      .pop()
      ?.replace(/\.gantt$/i, '') ||
    DEFAULT_GANTT_TITLE
  return {
    schemaVersion: 1,
    appId: 'puregantt',
    slug: GANTT_APP_SLUG,
    kind: 'gantt',
    name,
    contentFile: GANTT_DOCUMENT_FILE,
    assetDirectories: [GANTT_EXPORTS_DIR],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

export function serializeGanttPackageManifest(
  manifest: GanttPackageManifest,
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

const AGENT_LOG_CAP = 200
let agentLogCounter = 0

function normalizeAgentLog(value: unknown): GanttAgentLogEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries = value.flatMap((item): GanttAgentLogEntry[] => {
    if (!isRecord(item)) return []
    if (
      typeof item.id !== 'string' ||
      typeof item.at !== 'string' ||
      typeof item.agentName !== 'string' ||
      typeof item.tool !== 'string' ||
      typeof item.summary !== 'string'
    ) {
      return []
    }
    const before = normalizeTask(item.before, 0)
    const after = normalizeTask(item.after, 0)
    return [
      {
        id: item.id,
        at: item.at,
        agentName: item.agentName,
        tool: item.tool,
        summary: item.summary,
        ...(typeof item.taskId === 'string' ? { taskId: item.taskId } : {}),
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
      },
    ]
  })
  return entries.length ? entries : undefined
}

/** Append one agent-log entry, newest first, capped. */
export function appendGanttAgentLog(
  document: GanttDocument,
  entry: Omit<GanttAgentLogEntry, 'id' | 'at'>,
): GanttDocument {
  agentLogCounter += 1
  const record: GanttAgentLogEntry = {
    ...entry,
    id: `agent-log-${Date.now()}-${agentLogCounter}`,
    at: new Date().toISOString(),
  }
  return {
    ...document,
    agentLog: [record, ...(document.agentLog ?? [])].slice(0, AGENT_LOG_CAP),
    updatedAt: new Date().toISOString(),
  }
}
