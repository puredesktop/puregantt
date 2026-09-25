import {
  agentToolErrorContent,
  formatAgentToolJson,
  readAgentToolStringArg,
} from '@purescience/platform-ui/bridge/agentToolHelpers'
import type { AgentToolHandlerResult } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { GANTT_VIEW_MODES } from '../constants'
import { isIsoDate } from '../lib/ganttDates'
import {
  dependencyIds,
  findDependencyCycle,
  joinDependencies,
  removeTask,
} from '../lib/ganttDependencies'
import { appendGanttAgentLog, normalizePhases } from '../lib/ganttDocument'
import type {
  GanttDocument,
  GanttTask,
  GanttView,
  GanttViewMode,
} from '../types'
import type { GanttAgentToolContext } from './catalog'

const TASK_CAP = 100

function cycleMessage(cycle: string[]): string {
  return `That would make tasks wait on each other in a loop: ${cycle.join(
    ' -> ',
  )}. Dependencies must flow one way; drop one link in the loop and resend.`
}

function slugifyTaskId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task'
  )
}

function uniqueTaskId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let index = 2
  while (taken.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

function taskByRef(
  document: GanttDocument,
  ref: string | null | undefined,
): GanttTask | undefined {
  if (!ref?.trim()) return undefined
  const lowered = ref.trim().toLowerCase()
  const exact = document.tasks.find(task => task.id === ref.trim())
  if (exact) return exact
  const matches = document.tasks.filter(task => task.name.toLowerCase() === lowered)
  return matches.length === 1 ? matches[0] : undefined
}

function taskView(task: GanttTask): Record<string, unknown> {
  return {
    id: task.id,
    name: task.name,
    start: task.start,
    end: task.end,
    progress: task.progress,
    ...(task.dependencies ? { dependencies: dependencyIds(task) } : {}),
    ...(task.phase ? { phase: task.phase } : {}),
    ...(task.owner ? { owner: task.owner } : {}),
    ...(task.milestone ? { milestone: true } : {}),
  }
}

export function getGanttContextHandler(
  context: GanttAgentToolContext,
): AgentToolHandlerResult {
  const document = context.document
  const starts = document.tasks.map(task => task.start).sort()
  const ends = document.tasks.map(task => task.end).sort()
  return {
    content: formatAgentToolJson({
      title: document.title,
      documentPath: context.documentPath,
      viewMode: document.viewMode,
      phases: document.phases ?? [],
      taskCount: document.tasks.length,
      span:
        document.tasks.length > 0
          ? { start: starts[0], end: ends[ends.length - 1] }
          : null,
      agentLogEntries: (document.agentLog ?? []).length,
      ...(context.view ? { view: context.view.get() } : {}),
    }),
  }
}

const DENSITIES = ['compact', 'comfortable'] as const
const ZOOMS = ['fit', 'detail', 'wide'] as const

/**
 * Change how the chart is looked at — filter, density, zoom, overlays.
 * A view change is not a document write: nothing is saved or logged.
 */
export function setViewHandler(
  context: GanttAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const view = context.view
  if (!view) {
    return agentToolErrorContent('The chart has not mounted yet; try again.')
  }
  const patch: Partial<GanttView> = {}
  const phaseFilter = readAgentToolStringArg(args, 'phaseFilter')
  if (phaseFilter !== null && phaseFilter !== undefined) {
    const wanted = phaseFilter.trim()
    const phases = view.phases()
    const match =
      /^all$/i.test(wanted) || wanted === ''
        ? 'all'
        : phases.find(phase => phase.toLowerCase() === wanted.toLowerCase())
    if (!match) {
      return agentToolErrorContent(
        `No phase called "${wanted}". Phases: ${phases.join(', ') || 'none'}. Pass "all" to clear the filter.`,
      )
    }
    patch.phaseFilter = match
  }
  const density = readAgentToolStringArg(args, 'density')?.trim().toLowerCase()
  if (density) {
    if (!(DENSITIES as readonly string[]).includes(density)) {
      return agentToolErrorContent(`density must be one of: ${DENSITIES.join(', ')}.`)
    }
    patch.density = density as GanttView['density']
  }
  const zoom = readAgentToolStringArg(args, 'zoom')?.trim().toLowerCase()
  if (zoom) {
    if (!(ZOOMS as readonly string[]).includes(zoom)) {
      return agentToolErrorContent(`zoom must be one of: ${ZOOMS.join(', ')}.`)
    }
    patch.zoom = zoom as GanttView['zoom']
  }
  for (const key of ['showDependencies', 'showWeekends', 'showOwners'] as const) {
    if (typeof args[key] === 'boolean') patch[key] = args[key]
  }
  if (!Object.keys(patch).length) {
    return agentToolErrorContent(
      'Pass at least one of: phaseFilter, density, zoom, showDependencies, showWeekends, showOwners.',
    )
  }
  view.set(patch)
  return {
    content: formatAgentToolJson({
      view: view.get(),
      note: 'View only — the timeline itself is unchanged and nothing was saved.',
    }),
  }
}

export function listTasksHandler(
  context: GanttAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const document = context.document
  const phase = readAgentToolStringArg(args, 'phase')?.trim().toLowerCase()
  const tasks = document.tasks.filter(
    task => !phase || (task.phase ?? '').toLowerCase() === phase,
  )
  return {
    content: formatAgentToolJson({
      tasks: tasks.map(taskView),
      ...(phase ? { phase } : {}),
    }),
  }
}

export function listGanttChangesHandler(
  context: GanttAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const rawLimit = args.limit
  const limit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(100, Math.floor(rawLimit)))
      : 25
  const entries = (context.document.agentLog ?? []).slice(0, limit)
  return {
    content: formatAgentToolJson({
      entries: entries.map(entry => ({
        at: entry.at,
        tool: entry.tool,
        agentName: entry.agentName,
        summary: entry.summary,
        ...(entry.taskId ? { taskId: entry.taskId } : {}),
      })),
      note: 'The agent log: every agent write with before/after task snapshots, newest first. Check it before repeating work another agent already did.',
    }),
  }
}

interface TaskInput {
  name: string
  start: string
  end: string
  id?: string
  progress?: number
  dependencies?: string[]
  phase?: string
  owner?: string
  milestone?: boolean
}

function readTasksArg(args: Record<string, unknown>): TaskInput[] | string {
  const raw = args.tasks
  if (!Array.isArray(raw) || raw.length === 0) {
    return 'Pass "tasks": an array of {name, start, end, …}.'
  }
  if (raw.length > TASK_CAP) {
    return `At most ${TASK_CAP} tasks per call.`
  }
  const tasks: TaskInput[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Every task must be an object.'
    const candidate = item as Record<string, unknown>
    const name =
      typeof candidate.name === 'string' ? candidate.name.trim() : ''
    const start =
      typeof candidate.start === 'string' ? candidate.start.trim() : ''
    const end = typeof candidate.end === 'string' ? candidate.end.trim() : ''
    if (!name) return 'Every task needs a "name".'
    if (!isIsoDate(start) || !isIsoDate(end)) {
      return `Task "${name}": start and end must be YYYY-MM-DD dates.`
    }
    if (end < start) {
      return `Task "${name}": end ${end} is before start ${start}.`
    }
    tasks.push({
      name,
      start,
      end,
      id:
        typeof candidate.id === 'string' && candidate.id.trim()
          ? candidate.id.trim()
          : undefined,
      progress:
        typeof candidate.progress === 'number' &&
        Number.isFinite(candidate.progress)
          ? Math.max(0, Math.min(100, Math.round(candidate.progress)))
          : undefined,
      dependencies: Array.isArray(candidate.dependencies)
        ? candidate.dependencies
            .filter((dep): dep is string => typeof dep === 'string')
            .map(dep => dep.trim())
            .filter(Boolean)
        : undefined,
      phase:
        typeof candidate.phase === 'string' && candidate.phase.trim()
          ? candidate.phase.trim()
          : undefined,
      owner:
        typeof candidate.owner === 'string' && candidate.owner.trim()
          ? candidate.owner.trim()
          : undefined,
      milestone: candidate.milestone === true,
    })
  }
  return tasks
}

export async function createTasksHandler(
  context: GanttAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const summary = readAgentToolStringArg(args, 'summary')
  if (!summary?.trim()) {
    return agentToolErrorContent(
      'Pass "summary": one sentence on what the tasks are and why.',
    )
  }
  const inputs = readTasksArg(args)
  if (typeof inputs === 'string') return agentToolErrorContent(inputs)

  const document = context.document
  const taken = new Set(document.tasks.map(task => task.id))
  const created: GanttTask[] = []
  for (const input of inputs) {
    const id = uniqueTaskId(input.id ?? slugifyTaskId(input.name), taken)
    taken.add(id)
    created.push({
      id,
      name: input.name,
      start: input.start,
      end: input.end,
      progress: input.progress ?? 0,
      ...(input.dependencies?.length
        ? { dependencies: joinDependencies(input.dependencies) }
        : {}),
      ...(input.phase ? { phase: input.phase } : {}),
      ...(input.owner ? { owner: input.owner } : {}),
      ...(input.milestone ? { milestone: true } : {}),
    })
  }
  // Dependencies must resolve against existing tasks or this batch.
  for (const task of created) {
    for (const dep of dependencyIds(task)) {
      if (!taken.has(dep)) {
        return agentToolErrorContent(
          `Task "${task.name}" depends on unknown task id "${dep}". listTasks names the ids.`,
        )
      }
    }
  }
  const cycle = findDependencyCycle([...document.tasks, ...created])
  if (cycle) return agentToolErrorContent(cycleMessage(cycle))

  const path = await context.setDocument(current => {
    let next: GanttDocument = {
      ...current,
      tasks: [...current.tasks, ...created],
    }
    next = appendGanttAgentLog(next, {
      agentName: 'PureGantt Assistant',
      tool: 'createTasks',
      summary: summary.trim(),
    })
    return next
  })
  return {
    content: formatAgentToolJson({
      created: created.map(task => ({ id: task.id, name: task.name })),
      artifactPaths: [path],
      note: 'Written to the timeline and recorded in the agent log.',
    }),
  }
}

interface TaskPatchInput {
  task: string
  patch: Partial<GanttTask>
}

export async function updateTasksHandler(
  context: GanttAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const document = context.document
  const summary = readAgentToolStringArg(args, 'summary')
  if (!summary?.trim()) {
    return agentToolErrorContent(
      'Pass "summary": one sentence on what the changes do and why.',
    )
  }
  const raw = args.updates
  if (!Array.isArray(raw) || raw.length === 0) {
    return agentToolErrorContent(
      'Pass "updates": an array of {task, …fields to change}.',
    )
  }
  if (raw.length > TASK_CAP) {
    return agentToolErrorContent(`At most ${TASK_CAP} updates per call.`)
  }
  const known = new Set(document.tasks.map(item => item.id))
  const patches: TaskPatchInput[] = []
  const patchedIds = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return agentToolErrorContent('Every update must be an object.')
    }
    const candidate = item as Record<string, unknown>
    const ref =
      typeof candidate.task === 'string' ? candidate.task.trim() : ''
    const task = taskByRef(document, ref)
    if (!task) {
      return agentToolErrorContent(
        `No task matching "${ref}". listTasks names them.`,
      )
    }
    if (patchedIds.has(task.id)) {
      return agentToolErrorContent(
        `Task "${task.name}" appears twice in the batch.`,
      )
    }
    patchedIds.add(task.id)
    const patch: Partial<GanttTask> = {}
    const name =
      typeof candidate.name === 'string' ? candidate.name.trim() : ''
    if (name) patch.name = name
    for (const key of ['start', 'end'] as const) {
      const value =
        typeof candidate[key] === 'string'
          ? (candidate[key] as string).trim()
          : ''
      if (value) {
        if (!isIsoDate(value)) {
          return agentToolErrorContent(
            `Task "${task.name}": ${key} must be a YYYY-MM-DD date.`,
          )
        }
        patch[key] = value
      }
    }
    const nextStart = patch.start ?? task.start
    const nextEnd = patch.end ?? task.end
    if (nextEnd < nextStart) {
      return agentToolErrorContent(
        `Task "${task.name}": end ${nextEnd} would be before start ${nextStart}.`,
      )
    }
    if (
      typeof candidate.progress === 'number' &&
      Number.isFinite(candidate.progress)
    ) {
      patch.progress = Math.max(
        0,
        Math.min(100, Math.round(candidate.progress)),
      )
    }
    if (Array.isArray(candidate.dependencies)) {
      const deps = candidate.dependencies
        .filter((dep): dep is string => typeof dep === 'string')
        .map(dep => dep.trim())
        .filter(Boolean)
      for (const dep of deps) {
        if (dep === task.id) {
          return agentToolErrorContent(
            `Task "${task.name}" cannot depend on itself.`,
          )
        }
        if (!known.has(dep)) {
          return agentToolErrorContent(`Unknown dependency id "${dep}".`)
        }
      }
      patch.dependencies = joinDependencies(deps)
    }
    const phase = readAgentToolStringArg(candidate, 'phase')
    if (phase !== null && phase !== undefined) {
      patch.phase = phase.trim() || undefined
    }
    const owner = readAgentToolStringArg(candidate, 'owner')
    if (owner !== null && owner !== undefined) {
      patch.owner = owner.trim() || undefined
    }
    if (typeof candidate.milestone === 'boolean') {
      patch.milestone = candidate.milestone
    }
    if (!Object.keys(patch).length) {
      return agentToolErrorContent(
        `Task "${task.name}": pass at least one field to change.`,
      )
    }
    patches.push({ task: task.id, patch })
  }

  const byId = new Map(document.tasks.map(item => [item.id, item]))
  const results: GanttTask[] = []
  const dateChanged = new Set<string>()
  for (const { task: id, patch } of patches) {
    const before = byId.get(id)!
    const after: GanttTask = { ...before, ...patch }
    if (patch.start || patch.end) dateChanged.add(id)
    results.push(after)
  }
  const cycle = findDependencyCycle(
    document.tasks.map(item => {
      const patched = patches.find(entry => entry.task === item.id)
      return patched ? { ...item, ...patched.patch } : item
    }),
  )
  if (cycle) return agentToolErrorContent(cycleMessage(cycle))
  const untouchedDependents = document.tasks
    .filter(
      item =>
        !patchedIds.has(item.id) &&
        dependencyIds(item).some(dep => dateChanged.has(dep)),
    )
    .map(item => item.name)

  const path = await context.setDocument(current => {
    let next: GanttDocument = {
      ...current,
      tasks: current.tasks.map(item => {
        const patched = patches.find(entry => entry.task === item.id)
        return patched ? { ...item, ...patched.patch } : item
      }),
    }
    for (const { task: id, patch } of patches) {
      const before = byId.get(id)!
      next = appendGanttAgentLog(next, {
        agentName: 'PureGantt Assistant',
        tool: 'updateTasks',
        summary: summary.trim(),
        taskId: id,
        before,
        after: { ...before, ...patch },
      })
    }
    return next
  })
  return {
    content: formatAgentToolJson({
      updated: results.map(taskView),
      artifactPaths: [path],
      ...(untouchedDependents.length
        ? {
            note: `Dates changed; dependent tasks NOT in this batch were not moved: ${untouchedDependents.join(', ')}. Update them if the ripple applies.`,
          }
        : {}),
    }),
  }
}

export async function deleteTaskHandler(
  context: GanttAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const document = context.document
  const task = taskByRef(document, readAgentToolStringArg(args, 'task'))
  if (!task) {
    return agentToolErrorContent(
      'Pass "task": a task id or name. listTasks names them.',
    )
  }
  const before = { ...task }
  const path = await context.setDocument(current => {
    let next: GanttDocument = {
      ...current,
      tasks: removeTask(current.tasks, task.id),
    }
    next = appendGanttAgentLog(next, {
      agentName: 'PureGantt Assistant',
      tool: 'deleteTask',
      summary: `Deleted ${task.name}`,
      taskId: task.id,
      before,
    })
    return next
  })
  return {
    content: formatAgentToolJson({
      deleted: { id: task.id, name: task.name },
      artifactPaths: [path],
      note: 'Removed from the timeline and from other tasks’ dependencies; recorded in the agent log.',
    }),
  }
}

export async function setTimelineHandler(
  context: GanttAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const patch: Partial<GanttDocument> = {}
  const title = readAgentToolStringArg(args, 'title')?.trim()
  if (title) patch.title = title
  const viewMode = readAgentToolStringArg(args, 'viewMode')
  if (viewMode) {
    if (!(GANTT_VIEW_MODES as readonly string[]).includes(viewMode)) {
      return agentToolErrorContent(
        `viewMode must be one of ${GANTT_VIEW_MODES.join(', ')}.`,
      )
    }
    patch.viewMode = viewMode as GanttViewMode
  }
  // An empty list clears the phase list; tasks keep their own phase names.
  if (Array.isArray(args.phases)) patch.phases = normalizePhases(args.phases)
  if (!Object.keys(patch).length) {
    return agentToolErrorContent(
      'Pass at least one of: title, viewMode, phases.',
    )
  }
  const summary =
    readAgentToolStringArg(args, 'summary')?.trim() ||
    'Updated the timeline settings'
  const path = await context.setDocument(current => {
    let next: GanttDocument = { ...current, ...patch }
    next = appendGanttAgentLog(next, {
      agentName: 'PureGantt Assistant',
      tool: 'setTimeline',
      summary,
    })
    return next
  })
  return {
    content: formatAgentToolJson({ applied: patch, artifactPaths: [path] }),
  }
}
