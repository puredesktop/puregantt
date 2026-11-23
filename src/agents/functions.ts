import {
  defineAppFunction,
  type AppFunctionDefinition,
} from '@purescience/platform-ui/bridge/appFunctions'
import { GANTT_VIEW_MODES } from '../constants'
import {
  diffDays,
  isIsoDate,
  parseDate,
  shiftDate,
  todayDate,
} from '../lib/ganttDates'
import {
  dependencyIds,
  findDependencyCycle,
  joinDependencies,
} from '../lib/ganttDependencies'
import { appendGanttAgentLog, normalizePhases } from '../lib/ganttDocument'
import type { GanttDocument, GanttTask, GanttViewMode } from '../types'
import { AgentGanttToolError, type GanttAgentToolContext } from './catalog'
import {
  cycleMessage,
  slugifyTaskId,
  taskByRef,
  taskView,
  uniqueTaskId,
} from './handlers'

const TASK_CAP = 100

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function inclusiveDurationDays(start: string, end: string): number {
  return Math.max(1, diffDays(parseDate(start), parseDate(end)) + 1)
}

function isWeekend(iso: string): boolean {
  const day = parseDate(iso).getDay()
  return day === 0 || day === 6
}

function nextWorkingDay(iso: string): string {
  let current = iso
  while (isWeekend(current)) {
    current = shiftDate(current, 1)
  }
  return current
}

function addDurationDays(
  start: string,
  durationDays: number,
  skipWeekends: boolean,
): string {
  const days = Math.max(1, Math.floor(durationDays))
  if (!skipWeekends) {
    return shiftDate(start, days - 1)
  }
  let current = nextWorkingDay(start)
  let remaining = days - 1
  while (remaining > 0) {
    current = shiftDate(current, 1)
    if (!isWeekend(current)) remaining -= 1
  }
  return current
}

function documentSpan(
  tasks: readonly GanttTask[],
): { start: string; end: string; totalCalendarDays: number } | null {
  if (tasks.length === 0) return null
  const starts = tasks.map(t => t.start).sort()
  const ends = tasks.map(t => t.end).sort()
  const start = starts[0]!
  const end = ends[ends.length - 1]!
  return {
    start,
    end,
    totalCalendarDays: inclusiveDurationDays(start, end),
  }
}

interface ScheduleConflict {
  taskId: string
  taskName: string
  taskStart: string
  predecessorId: string
  predecessorName: string
  predecessorEnd: string
  overlapDays: number
}

interface DanglingDependency {
  taskId: string
  taskName: string
  missingDependencyId: string
}

interface ScheduleGraphAnalysis {
  byId: Map<string, GanttTask>
  preds: Map<string, string[]>
  succs: Map<string, string[]>
  topoOrder: string[]
  cycle: string[] | null
  danglingDependencies: DanglingDependency[]
  scheduleConflicts: ScheduleConflict[]
  slackDays: Map<string, number>
  criticalTaskIds: string[]
  criticalDurationDays: number
}

function analyzeScheduleGraph(
  tasks: readonly GanttTask[],
): ScheduleGraphAnalysis {
  const byId = new Map<string, GanttTask>()
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const task of tasks) {
    byId.set(task.id, task)
    preds.set(task.id, [])
    succs.set(task.id, [])
  }

  const danglingDependencies: DanglingDependency[] = []
  const scheduleConflicts: ScheduleConflict[] = []

  for (const task of tasks) {
    for (const depId of dependencyIds(task)) {
      const pred = byId.get(depId)
      if (!pred) {
        danglingDependencies.push({
          taskId: task.id,
          taskName: task.name,
          missingDependencyId: depId,
        })
        continue
      }
      preds.get(task.id)!.push(depId)
      succs.get(depId)!.push(task.id)
      if (task.start < pred.end) {
        scheduleConflicts.push({
          taskId: task.id,
          taskName: task.name,
          taskStart: task.start,
          predecessorId: pred.id,
          predecessorName: pred.name,
          predecessorEnd: pred.end,
          overlapDays: diffDays(parseDate(task.start), parseDate(pred.end)),
        })
      }
    }
  }

  const cycle = findDependencyCycle(tasks)

  // Kahn's topological sort (deterministic tie-breaking by start date then id)
  const inDegree = new Map<string, number>()
  for (const task of tasks) {
    inDegree.set(task.id, preds.get(task.id)!.length)
  }
  const ready = tasks
    .filter(t => (inDegree.get(t.id) ?? 0) === 0)
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    .map(t => t.id)

  const topoOrder: string[] = []
  while (ready.length > 0) {
    const id = ready.shift()!
    topoOrder.push(id)
    for (const succId of succs.get(id) ?? []) {
      const nextDeg = (inDegree.get(succId) ?? 1) - 1
      inDegree.set(succId, nextDeg)
      if (nextDeg === 0) {
        ready.push(succId)
        ready.sort((a, b) => {
          const ta = byId.get(a)!
          const tb = byId.get(b)!
          return ta.start.localeCompare(tb.start) || a.localeCompare(b)
        })
      }
    }
  }
  // If a pre-existing broken document has a cycle, append remaining tasks deterministically
  if (topoOrder.length < tasks.length) {
    const inTopo = new Set(topoOrder)
    for (const task of tasks) {
      if (!inTopo.has(task.id)) topoOrder.push(task.id)
    }
  }

  const slackDays = new Map<string, number>()
  let criticalTaskIds: string[] = []
  let criticalDurationDays = 0

  if (tasks.length > 0 && !cycle) {
    const origin = parseDate(tasks.map(t => t.start).sort()[0]!)
    const dur = new Map<string, number>()
    const es = new Map<string, number>()
    const ef = new Map<string, number>()

    for (const id of topoOrder) {
      const task = byId.get(id)!
      const d = inclusiveDurationDays(task.start, task.end)
      dur.set(id, d)
      const schedStart = diffDays(origin, parseDate(task.start))
      const taskPreds = preds.get(id)!
      const earliestStart =
        taskPreds.length === 0
          ? schedStart
          : Math.max(schedStart, ...taskPreds.map(p => ef.get(p) ?? 0))
      es.set(id, earliestStart)
      ef.set(id, earliestStart + d)
    }

    let projectFinish = 0
    for (const finish of ef.values()) {
      if (finish > projectFinish) projectFinish = finish
    }
    criticalDurationDays = projectFinish

    const ls = new Map<string, number>()
    const lf = new Map<string, number>()
    for (let i = topoOrder.length - 1; i >= 0; i -= 1) {
      const id = topoOrder[i]!
      const taskSuccs = succs.get(id)!
      const latestFinish =
        taskSuccs.length === 0
          ? projectFinish
          : Math.min(...taskSuccs.map(s => ls.get(s) ?? projectFinish))
      lf.set(id, latestFinish)
      ls.set(id, latestFinish - dur.get(id)!)
      slackDays.set(id, Math.max(0, ls.get(id)! - es.get(id)!))
    }

    // Reconstruct the primary critical chain ending at projectFinish
    const finishCandidates = topoOrder
      .filter(id => ef.get(id) === projectFinish && slackDays.get(id) === 0)
      .sort((a, b) => {
        const ta = byId.get(a)!
        const tb = byId.get(b)!
        return tb.end.localeCompare(ta.end) || a.localeCompare(b)
      })

    if (finishCandidates.length > 0) {
      const chain: string[] = []
      let cursor: string | null = finishCandidates[0]!
      const visited = new Set<string>()
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor)
        chain.push(cursor)
        const curEs: number = es.get(cursor)!
        const critPreds: string[] = (preds.get(cursor) ?? [])
          .filter(p => slackDays.get(p) === 0 && ef.get(p) === curEs)
          .sort((a, b) => (ef.get(b) ?? 0) - (ef.get(a) ?? 0) || a.localeCompare(b))
        cursor = critPreds[0] ?? null
      }
      criticalTaskIds = chain.reverse()
    }
  }

  return {
    byId,
    preds,
    succs,
    topoOrder,
    cycle,
    danglingDependencies,
    scheduleConflicts,
    slackDays,
    criticalTaskIds,
    criticalDurationDays,
  }
}

function collectTransitive(
  startId: string,
  adjacency: Map<string, string[]>,
): Map<string, number> {
  const distances = new Map<string, number>()
  const queue: Array<[string, number]> = [[startId, 0]]
  while (queue.length > 0) {
    const [current, depth] = queue.shift()!
    for (const next of adjacency.get(current) ?? []) {
      const nextDepth = depth + 1
      const existing = distances.get(next)
      if (existing === undefined || nextDepth < existing) {
        distances.set(next, nextDepth)
        queue.push([next, nextDepth])
      }
    }
  }
  return distances
}

/**
 * Composite workflow 1: `fn_timelineOverview`
 * Replaces `getGanttContext` + `listTasks` + `listGanttChanges` + manual CPM/health math in one call.
 */
const fnTimelineOverview = defineAppFunction<GanttAgentToolContext>({
  name: 'fn_timelineOverview',
  category: 'analysis',
  risk: 'read',
  requiresApproval: false,
  replaces: ['getGanttContext', 'listTasks', 'listGanttChanges'],
  description:
    'Compile a complete PureGantt timeline briefing in one call: document metadata, chart view state, date span, completion and overdue statistics, phase and owner breakdowns, milestones, deterministic critical-path and slack analysis, dependency conflict audit, optional task listing, and recent agent-log changes. Prefer this over chaining getGanttContext, listTasks, and listGanttChanges.',
  inputSchema: {
    type: 'object',
    properties: {
      phase: {
        type: 'string',
        description:
          'Optional phase name filter (case-insensitive) applied to the returned tasks array.',
      },
      owner: {
        type: 'string',
        description:
          'Optional owner name filter (case-insensitive) applied to the returned tasks array.',
      },
      asOfDate: {
        type: 'string',
        description:
          'Optional reference date (YYYY-MM-DD) used to detect overdue tasks (defaults to today).',
      },
      includeTasks: {
        type: 'boolean',
        description:
          'Include the full or filtered task list enriched with duration and slack days (default true).',
      },
      recentChangesLimit: {
        type: 'number',
        description:
          'Maximum recent agent-log entries to include (default 10, max 50; set 0 to omit).',
      },
    },
  },
  run: async (ctx, args) => {
    const doc = ctx.document
    const rawAsOf =
      typeof args.asOfDate === 'string' && args.asOfDate.trim()
        ? args.asOfDate.trim()
        : todayDate()
    if (!isIsoDate(rawAsOf)) {
      throw new AgentGanttToolError(
        `"asOfDate" must be a real YYYY-MM-DD calendar date (got "${rawAsOf}").`,
      )
    }
    const phaseFilter =
      typeof args.phase === 'string' ? args.phase.trim().toLowerCase() : ''
    const ownerFilter =
      typeof args.owner === 'string' ? args.owner.trim().toLowerCase() : ''
    const includeTasks = args.includeTasks !== false
    const recentChangesLimit = clampInt(args.recentChangesLimit, 10, 0, 50)

    const graph = analyzeScheduleGraph(doc.tasks)
    const span = documentSpan(doc.tasks)

    let completed = 0
    let inProgress = 0
    let notStarted = 0
    let progressSum = 0
    let weightedProgressSum = 0
    let totalTaskDays = 0
    const overdueTasks: Array<Record<string, unknown>> = []

    for (const task of doc.tasks) {
      const dur = inclusiveDurationDays(task.start, task.end)
      totalTaskDays += dur
      progressSum += task.progress
      weightedProgressSum += task.progress * dur
      if (task.progress >= 100) completed += 1
      else if (task.progress > 0) inProgress += 1
      else notStarted += 1

      if (task.progress < 100 && task.end < rawAsOf) {
        overdueTasks.push({
          id: task.id,
          name: task.name,
          end: task.end,
          daysOverdue: diffDays(parseDate(task.end), parseDate(rawAsOf)),
          progress: task.progress,
          ...(task.phase ? { phase: task.phase } : {}),
          ...(task.owner ? { owner: task.owner } : {}),
        })
      }
    }
    overdueTasks.sort((a, b) =>
      String(a.end).localeCompare(String(b.end)),
    )

    const averageProgress =
      doc.tasks.length > 0 ? Math.round(progressSum / doc.tasks.length) : 0
    const durationWeightedProgress =
      totalTaskDays > 0 ? Math.round(weightedProgressSum / totalTaskDays) : 0

    // Phase breakdown in declared order + any extra task phases + Unphased
    const phaseOrder: string[] = [...(doc.phases ?? [])]
    const knownPhaseKeys = new Set(phaseOrder.map(p => p.toLowerCase()))
    const tasksByPhaseKey = new Map<string, { label: string; tasks: GanttTask[] }>()
    for (const p of phaseOrder) {
      tasksByPhaseKey.set(p.toLowerCase(), { label: p, tasks: [] })
    }
    for (const task of doc.tasks) {
      const label = task.phase?.trim() || 'Unphased'
      const key = label.toLowerCase()
      if (!tasksByPhaseKey.has(key)) {
        tasksByPhaseKey.set(key, { label, tasks: [] })
        if (!knownPhaseKeys.has(key)) {
          knownPhaseKeys.add(key)
          phaseOrder.push(label)
        }
      }
      tasksByPhaseKey.get(key)!.tasks.push(task)
    }

    const phaseSummaries = phaseOrder
      .map(label => tasksByPhaseKey.get(label.toLowerCase())!)
      .filter(group => group.tasks.length > 0 || (doc.phases ?? []).includes(group.label))
      .map(group => {
        const groupSpan = documentSpan(group.tasks)
        const groupCompleted = group.tasks.filter(t => t.progress >= 100).length
        const groupMilestones = group.tasks.filter(t => t.milestone).length
        const avg =
          group.tasks.length > 0
            ? Math.round(
                group.tasks.reduce((sum, t) => sum + t.progress, 0) /
                  group.tasks.length,
              )
            : 0
        return {
          phase: group.label,
          taskCount: group.tasks.length,
          completedCount: groupCompleted,
          milestoneCount: groupMilestones,
          averageProgress: avg,
          span: groupSpan ? { start: groupSpan.start, end: groupSpan.end } : null,
        }
      })

    // Owner workload breakdown
    const ownerMap = new Map<
      string,
      {
        owner: string
        taskCount: number
        activeCount: number
        completedCount: number
        totalDurationDays: number
        overdueCount: number
      }
    >()
    let unassignedCount = 0
    for (const task of doc.tasks) {
      const owner = task.owner?.trim()
      if (!owner) {
        unassignedCount += 1
        continue
      }
      const key = owner.toLowerCase()
      const existing = ownerMap.get(key) ?? {
        owner,
        taskCount: 0,
        activeCount: 0,
        completedCount: 0,
        totalDurationDays: 0,
        overdueCount: 0,
      }
      existing.taskCount += 1
      if (task.progress >= 100) existing.completedCount += 1
      else existing.activeCount += 1
      existing.totalDurationDays += inclusiveDurationDays(task.start, task.end)
      if (task.progress < 100 && task.end < rawAsOf) existing.overdueCount += 1
      ownerMap.set(key, existing)
    }
    const owners = [...ownerMap.values()].sort(
      (a, b) => b.taskCount - a.taskCount || a.owner.localeCompare(b.owner),
    )

    // Milestones summary
    const milestones = doc.tasks
      .filter(t => t.milestone)
      .sort((a, b) => a.end.localeCompare(b.end) || a.name.localeCompare(b.name))
      .map(task => {
        const upstream = collectTransitive(task.id, graph.preds)
        const unfinishedPredecessorCount = [...upstream.keys()].filter(
          id => (graph.byId.get(id)?.progress ?? 100) < 100,
        ).length
        return {
          ...taskView(task),
          slackDays: graph.slackDays.get(task.id) ?? 0,
          unfinishedPredecessorCount,
        }
      })

    const criticalSet = new Set(graph.criticalTaskIds)
    const criticalTasks = graph.criticalTaskIds
      .map(id => graph.byId.get(id))
      .filter((t): t is GanttTask => Boolean(t))
      .map(task => ({
        id: task.id,
        name: task.name,
        start: task.start,
        end: task.end,
        durationDays: inclusiveDurationDays(task.start, task.end),
        progress: task.progress,
        ...(task.phase ? { phase: task.phase } : {}),
        ...(task.owner ? { owner: task.owner } : {}),
      }))

    const taskSlackDays = Object.fromEntries(graph.slackDays.entries())

    const filteredTasks = includeTasks
      ? doc.tasks
          .filter(
            task =>
              (!phaseFilter ||
                (task.phase ?? '').toLowerCase() === phaseFilter) &&
              (!ownerFilter ||
                (task.owner ?? '').toLowerCase() === ownerFilter),
          )
          .map(task => ({
            ...taskView(task),
            durationDays: inclusiveDurationDays(task.start, task.end),
            slackDays: graph.slackDays.get(task.id) ?? 0,
            isCritical: criticalSet.has(task.id),
          }))
      : undefined

    const recentChanges =
      recentChangesLimit > 0
        ? (doc.agentLog ?? []).slice(0, recentChangesLimit).map(entry => ({
            at: entry.at,
            tool: entry.tool,
            agentName: entry.agentName,
            summary: entry.summary,
            ...(entry.taskId ? { taskId: entry.taskId } : {}),
          }))
        : []

    const summary =
      doc.tasks.length === 0
        ? `Timeline "${doc.title}" is empty (0 tasks, viewMode: ${doc.viewMode}).`
        : `Timeline "${doc.title}": ${doc.tasks.length} task(s) (${span!.start} to ${span!.end}, ${durationWeightedProgress}% weighted progress, ${overdueTasks.length} overdue, ${graph.criticalTaskIds.length} on critical chain, ${graph.scheduleConflicts.length} dependency conflict(s)).`

    return {
      summary,
      mutated: false,
      data: {
        timeline: {
          title: doc.title,
          documentPath: ctx.documentPath,
          viewMode: doc.viewMode,
          phases: doc.phases ?? [],
          taskCount: doc.tasks.length,
          milestoneCount: milestones.length,
          span,
          agentLogEntries: (doc.agentLog ?? []).length,
          ...(ctx.view ? { view: ctx.view.get() } : {}),
        },
        progress: {
          asOfDate: rawAsOf,
          averageProgress,
          durationWeightedProgress,
          completed,
          inProgress,
          notStarted,
          overdueCount: overdueTasks.length,
          overdueTasks,
        },
        phases: phaseSummaries,
        owners,
        unassignedCount,
        milestones,
        criticalChain: {
          totalDurationDays: graph.criticalDurationDays,
          criticalTaskIds: graph.criticalTaskIds,
          criticalTasks,
          taskSlackDays,
        },
        health: {
          dependencyCycle: graph.cycle,
          scheduleConflicts: graph.scheduleConflicts,
          danglingDependencies: graph.danglingDependencies,
        },
        ...(includeTasks
          ? {
              taskFilter: {
                ...(phaseFilter ? { phase: phaseFilter } : {}),
                ...(ownerFilter ? { owner: ownerFilter } : {}),
              },
              tasks: filteredTasks,
            }
          : {}),
        recentChanges,
      },
    }
  },
})

/**
 * Composite workflow 2: `fn_analyzeBlockers`
 * Replaces `listTasks` + manual transitive DAG traversal for upstream blockers & downstream slip impact.
 */
const fnAnalyzeBlockers = defineAppFunction<GanttAgentToolContext>({
  name: 'fn_analyzeBlockers',
  category: 'dependencies',
  risk: 'read',
  requiresApproval: false,
  replaces: ['listTasks', 'getGanttContext'],
  description:
    'Trace upstream blockers and downstream schedule impact across PureGantt dependency chains in one call for a specific task (by id or name), an entire phase, or all milestones and terminal deliverables. Identifies direct and transitive unfinished predecessors, root actionable blockers, overdue blockers, dependency date conflicts, and every downstream task or milestone impacted by a slip.',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description:
          'Optional target task id or exact task name to inspect. Omit together with phase to inspect all milestones and terminal deliverables.',
      },
      phase: {
        type: 'string',
        description:
          'Optional phase name (case-insensitive) to analyze all tasks within that phase.',
      },
      asOfDate: {
        type: 'string',
        description:
          'Optional reference date (YYYY-MM-DD) used to flag overdue blockers (defaults to today).',
      },
      includeCompletedPredecessors: {
        type: 'boolean',
        description:
          'Include completed (progress = 100) upstream predecessors alongside unfinished blockers (default false).',
      },
    },
  },
  run: async (ctx, args) => {
    const doc = ctx.document
    const rawAsOf =
      typeof args.asOfDate === 'string' && args.asOfDate.trim()
        ? args.asOfDate.trim()
        : todayDate()
    if (!isIsoDate(rawAsOf)) {
      throw new AgentGanttToolError(
        `"asOfDate" must be a real YYYY-MM-DD calendar date (got "${rawAsOf}").`,
      )
    }
    const taskRef = typeof args.task === 'string' ? args.task.trim() : ''
    const phaseRef = typeof args.phase === 'string' ? args.phase.trim() : ''
    const includeCompleted = args.includeCompletedPredecessors === true

    const graph = analyzeScheduleGraph(doc.tasks)

    let targets: GanttTask[]
    let mode: 'task' | 'phase' | 'milestones_and_terminals'
    if (taskRef) {
      const matched = taskByRef(doc, taskRef)
      if (!matched) {
        throw new AgentGanttToolError(
          `No task matching "${taskRef}". Check task ids or names via fn_timelineOverview or listTasks.`,
        )
      }
      targets = [matched]
      mode = 'task'
    } else if (phaseRef) {
      const lowered = phaseRef.toLowerCase()
      targets = doc.tasks.filter(
        t => (t.phase ?? '').toLowerCase() === lowered,
      )
      if (targets.length === 0) {
        throw new AgentGanttToolError(
          `No tasks found in phase "${phaseRef}".`,
        )
      }
      mode = 'phase'
    } else {
      const milestonesAndTerminals = doc.tasks.filter(
        t => t.milestone || (graph.succs.get(t.id)?.length ?? 0) === 0,
      )
      targets = milestonesAndTerminals.sort(
        (a, b) => a.end.localeCompare(b.end) || a.name.localeCompare(b.name),
      )
      mode = 'milestones_and_terminals'
    }

    const globalRootCounts = new Map<string, { task: GanttTask; blocksTargets: string[] }>()

    const targetReports = targets.map(target => {
      const upstreamDistances = collectTransitive(target.id, graph.preds)
      const downstreamDistances = collectTransitive(target.id, graph.succs)

      const unfinishedIds = [...upstreamDistances.keys()].filter(
        id => (graph.byId.get(id)?.progress ?? 100) < 100,
      )
      const unfinishedSet = new Set(unfinishedIds)

      const describeBlocker = (id: string) => {
        const t = graph.byId.get(id)!
        const depth = upstreamDistances.get(id) ?? 1
        const hasUnfinishedPred = (graph.preds.get(id) ?? []).some(
          p => (graph.byId.get(p)?.progress ?? 100) < 100,
        )
        const isRootBlocker = !hasUnfinishedPred
        return {
          ...taskView(t),
          id: t.id,
          end: t.end,
          depth,
          overdue: t.end < rawAsOf,
          daysOverdue:
            t.end < rawAsOf
              ? diffDays(parseDate(t.end), parseDate(rawAsOf))
              : 0,
          slackDays: graph.slackDays.get(t.id) ?? 0,
          isRootBlocker,
        }
      }

      const allBlockers = unfinishedIds
        .map(describeBlocker)
        .sort(
          (a, b) =>
            Number(b.isRootBlocker) - Number(a.isRootBlocker) ||
            a.end.localeCompare(b.end) ||
            a.depth - b.depth,
        )

      const directBlockers = allBlockers.filter(b => b.depth === 1)
      const rootBlockers = allBlockers.filter(b => b.isRootBlocker)

      for (const rb of rootBlockers) {
        const rbTask = graph.byId.get(rb.id)!
        const entry = globalRootCounts.get(rbTask.id) ?? {
          task: rbTask,
          blocksTargets: [],
        }
        entry.blocksTargets.push(target.id)
        globalRootCounts.set(rbTask.id, entry)
      }

      const completedPredecessors = includeCompleted
        ? [...upstreamDistances.entries()]
            .filter(([id]) => !unfinishedSet.has(id))
            .map(([id, depth]) => ({
              ...taskView(graph.byId.get(id)!),
              depth,
            }))
        : undefined

      const allDownstream = [...downstreamDistances.entries()]
        .map(([id, depth]) => {
          const t = graph.byId.get(id)!
          return {
            ...taskView(t),
            id: t.id,
            start: t.start,
            end: t.end,
            ...(t.milestone ? { milestone: true as const } : {}),
            depth,
            slackDays: graph.slackDays.get(t.id) ?? 0,
          }
        })
        .sort(
          (a, b) => a.depth - b.depth || a.start.localeCompare(b.start),
        )

      const directDependents = allDownstream.filter(d => d.depth === 1)
      const impactedMilestones = allDownstream.filter(d => d.milestone === true)

      const involvedIds = new Set<string>([
        target.id,
        ...upstreamDistances.keys(),
        ...downstreamDistances.keys(),
      ])
      const chainConflicts = graph.scheduleConflicts.filter(
        c => involvedIds.has(c.taskId) && involvedIds.has(c.predecessorId),
      )

      const impactedEnds = [
        target.end,
        ...allDownstream.map(d => d.end),
      ].sort()
      const latestImpactedEnd = impactedEnds[impactedEnds.length - 1]!

      return {
        task: {
          ...taskView(target),
          slackDays: graph.slackDays.get(target.id) ?? 0,
        },
        isBlocked: allBlockers.length > 0,
        blockerCount: allBlockers.length,
        directBlockers,
        rootBlockers,
        allBlockers,
        ...(includeCompleted ? { completedPredecessors } : {}),
        downstreamCount: allDownstream.length,
        directDependents,
        allDownstream,
        impactedMilestones,
        latestImpactedEnd,
        chainConflicts,
      }
    })

    const globalRootBlockers = [...globalRootCounts.values()]
      .sort(
        (a, b) =>
          b.blocksTargets.length - a.blocksTargets.length ||
          a.task.end.localeCompare(b.task.end),
      )
      .map(({ task, blocksTargets }) => ({
        ...taskView(task),
        overdue: task.end < rawAsOf,
        blocksTargetCount: blocksTargets.length,
        blocksTargets,
      }))

    const blockedTargetCount = targetReports.filter(r => r.isBlocked).length
    const summary =
      targets.length === 1
        ? `Blocker trace for "${targets[0]!.name}": ${targetReports[0]!.blockerCount} unfinished predecessor(s) (${targetReports[0]!.rootBlockers.length} root actionable), ${targetReports[0]!.downstreamCount} downstream dependent(s).`
        : `Blocker trace (${mode}, ${targets.length} target(s)): ${blockedTargetCount} blocked, ${globalRootBlockers.length} unique root actionable blocker(s).`

    return {
      summary,
      mutated: false,
      data: {
        scope: {
          mode,
          ...(taskRef ? { task: taskRef } : {}),
          ...(phaseRef ? { phase: phaseRef } : {}),
          targetCount: targets.length,
          asOfDate: rawAsOf,
        },
        targets: targetReports,
        globalRootBlockers,
      },
    }
  },
})

type RippleMode = 'cascade' | 'resolveConflicts' | 'anchorsOnly'

/**
 * Composite workflow 3: `fn_shiftSchedule`
 * Replaces `listTasks` + manual date arithmetic + `updateTasks` in one deterministic atomic call.
 */
const fnShiftSchedule = defineAppFunction<GanttAgentToolContext>({
  name: 'fn_shiftSchedule',
  category: 'scheduling',
  risk: 'write',
  requiresApproval: true,
  replaces: ['listTasks', 'updateTasks'],
  description:
    'Shift one or more anchor tasks (or an entire phase) forward or backward by a number of calendar days or to a new target start date, deterministically carrying the ripple through dependent tasks in a single atomic batch. Supports cascade, conflict-only, or anchor-only ripple modes, pinned-deadline protection, dry-run diff previews, and full before/after agent-log recording.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'One-line explanation of what moved and why (recorded in the agent log).',
      },
      tasks: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Task ids or exact task names to use as shift anchors (provide tasks, phase, or both).',
      },
      phase: {
        type: 'string',
        description:
          'Optional phase name (case-insensitive); all tasks in this phase are included as shift anchors.',
      },
      deltaDays: {
        type: 'number',
        description:
          'Whole calendar days to shift (positive pushes later, negative pulls earlier). Provide deltaDays or targetStart.',
      },
      targetStart: {
        type: 'string',
        description:
          'New YYYY-MM-DD start date for the earliest anchor task; deltaDays is computed automatically from that anchor.',
      },
      rippleMode: {
        type: 'string',
        enum: ['cascade', 'resolveConflicts', 'anchorsOnly'],
        description:
          'How dependent tasks respond: "cascade" (default, shifts all transitive dependents by deltaDays), "resolveConflicts" (pushes dependents only as needed to clear predecessor overlap), or "anchorsOnly" (moves only anchors and reports downstream impact).',
      },
      pinTasks: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional task ids or exact names whose dates are fixed and must not move during the ripple.',
      },
      pinMilestones: {
        type: 'boolean',
        description:
          'Keep downstream milestone tasks fixed during the ripple (default false).',
      },
      dryRun: {
        type: 'boolean',
        description:
          'Preview the exact before/after date diff and any pinned-deadline conflicts without saving or logging (default false).',
      },
    },
    required: ['summary'],
  },
  run: async (ctx, args) => {
    const doc = ctx.document
    const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
    if (!summary) {
      throw new AgentGanttToolError(
        'Pass "summary": one sentence explaining the schedule shift and why.',
      )
    }

    const rippleModeRaw =
      typeof args.rippleMode === 'string' ? args.rippleMode.trim() : 'cascade'
    if (
      rippleModeRaw !== 'cascade' &&
      rippleModeRaw !== 'resolveConflicts' &&
      rippleModeRaw !== 'anchorsOnly'
    ) {
      throw new AgentGanttToolError(
        'rippleMode must be one of: cascade, resolveConflicts, anchorsOnly.',
      )
    }
    const rippleMode: RippleMode = rippleModeRaw
    const dryRun = args.dryRun === true
    const pinMilestones = args.pinMilestones === true

    const anchorIds = new Set<string>()
    if (Array.isArray(args.tasks)) {
      for (const rawRef of args.tasks) {
        if (typeof rawRef !== 'string' || !rawRef.trim()) continue
        const found = taskByRef(doc, rawRef)
        if (!found) {
          throw new AgentGanttToolError(
            `No anchor task matching "${rawRef}". Check task ids or names via fn_timelineOverview.`,
          )
        }
        anchorIds.add(found.id)
      }
    }
    if (typeof args.phase === 'string' && args.phase.trim()) {
      const wantedPhase = args.phase.trim().toLowerCase()
      const inPhase = doc.tasks.filter(
        t => (t.phase ?? '').toLowerCase() === wantedPhase,
      )
      if (inPhase.length === 0) {
        throw new AgentGanttToolError(
          `No tasks found in phase "${args.phase.trim()}".`,
        )
      }
      for (const task of inPhase) anchorIds.add(task.id)
    }
    if (anchorIds.size === 0) {
      throw new AgentGanttToolError(
        'Provide at least one anchor via "tasks" (array of ids/names) or "phase".',
      )
    }

    const explicitPinnedIds = new Set<string>()
    if (Array.isArray(args.pinTasks)) {
      for (const rawRef of args.pinTasks) {
        if (typeof rawRef !== 'string' || !rawRef.trim()) continue
        const found = taskByRef(doc, rawRef)
        if (!found) {
          throw new AgentGanttToolError(
            `No pinned task matching "${rawRef}".`,
          )
        }
        if (anchorIds.has(found.id)) {
          throw new AgentGanttToolError(
            `Task "${found.name}" cannot be both a shift anchor and in pinTasks.`,
          )
        }
        explicitPinnedIds.add(found.id)
      }
    }

    const hasDelta = args.deltaDays !== undefined
    const hasTargetStart =
      typeof args.targetStart === 'string' && args.targetStart.trim().length > 0
    if (hasDelta && hasTargetStart) {
      throw new AgentGanttToolError(
        'Pass either "deltaDays" or "targetStart", not both.',
      )
    }
    if (!hasDelta && !hasTargetStart) {
      throw new AgentGanttToolError(
        'Pass "deltaDays" (whole integer days) or "targetStart" (YYYY-MM-DD).',
      )
    }

    let deltaDays: number
    if (hasDelta) {
      if (
        typeof args.deltaDays !== 'number' ||
        !Number.isFinite(args.deltaDays) ||
        !Number.isInteger(args.deltaDays)
      ) {
        throw new AgentGanttToolError('"deltaDays" must be a whole integer.')
      }
      deltaDays = args.deltaDays
    } else {
      const targetStart = (args.targetStart as string).trim()
      if (!isIsoDate(targetStart)) {
        throw new AgentGanttToolError(
          `"targetStart" must be a real YYYY-MM-DD calendar date (got "${targetStart}").`,
        )
      }
      const earliestAnchorStart = doc.tasks
        .filter(t => anchorIds.has(t.id))
        .map(t => t.start)
        .sort()[0]!
      deltaDays = diffDays(parseDate(earliestAnchorStart), parseDate(targetStart))
    }

    const spanBefore = documentSpan(doc.tasks)
    if (deltaDays === 0) {
      return {
        summary: `No schedule shift needed (deltaDays is 0).`,
        mutated: false,
        data: {
          dryRun,
          deltaDays: 0,
          rippleMode,
          moved: [],
          held: [],
          pinnedConflicts: [],
          spanBefore,
          spanAfter: spanBefore,
        },
      }
    }

    const graph = analyzeScheduleGraph(doc.tasks)
    const isPinned = (task: GanttTask): boolean =>
      explicitPinnedIds.has(task.id) ||
      (pinMilestones && Boolean(task.milestone) && !anchorIds.has(task.id))

    const shifts = new Map<string, number>()
    const held: Array<{ id: string; name: string; start: string; end: string; reason: string }> =
      []
    const heldIds = new Set<string>()
    const recordHeld = (task: GanttTask, reason: string) => {
      if (heldIds.has(task.id) || shifts.has(task.id)) return
      heldIds.add(task.id)
      held.push({
        id: task.id,
        name: task.name,
        start: task.start,
        end: task.end,
        reason,
      })
    }

    for (const id of anchorIds) {
      shifts.set(id, deltaDays)
    }

    if (rippleMode === 'cascade') {
      const queue = [...anchorIds]
      const visited = new Set<string>(anchorIds)
      while (queue.length > 0) {
        const current = queue.shift()!
        for (const succId of graph.succs.get(current) ?? []) {
          const succTask = graph.byId.get(succId)!
          if (isPinned(succTask)) {
            recordHeld(succTask, 'pinned')
            continue
          }
          if (!visited.has(succId)) {
            visited.add(succId)
            shifts.set(succId, deltaDays)
            queue.push(succId)
          }
        }
      }
    } else if (rippleMode === 'resolveConflicts') {
      const downstreamReachable = new Set<string>()
      for (const anchorId of anchorIds) {
        for (const depId of collectTransitive(anchorId, graph.succs).keys()) {
          if (!anchorIds.has(depId)) downstreamReachable.add(depId)
        }
      }
      for (const id of graph.topoOrder) {
        if (!downstreamReachable.has(id)) continue
        const task = graph.byId.get(id)!
        let requiredShift = 0
        for (const predId of graph.preds.get(id) ?? []) {
          const predShift = shifts.get(predId)
          if (!predShift || predShift <= 0) continue
          const pred = graph.byId.get(predId)!
          const predAfterEnd = shiftDate(pred.end, predShift)
          // Preserve strict next-day handoff if there was at least a 1-day gap before,
          // or same-day handoff if the dependent previously started on pred.end.
          const minAllowedStart =
            pred.end < task.start
              ? shiftDate(predAfterEnd, 1)
              : predAfterEnd
          if (task.start < minAllowedStart) {
            const needed = diffDays(
              parseDate(task.start),
              parseDate(minAllowedStart),
            )
            if (needed > requiredShift) requiredShift = needed
          }
        }
        if (requiredShift > 0) {
          if (isPinned(task)) {
            recordHeld(task, 'pinned')
          } else {
            shifts.set(id, requiredShift)
          }
        } else {
          recordHeld(task, 'noConflict')
        }
      }
    } else {
      // anchorsOnly: report every transitive downstream dependent as held
      for (const anchorId of anchorIds) {
        for (const depId of collectTransitive(anchorId, graph.succs).keys()) {
          if (!anchorIds.has(depId)) {
            recordHeld(graph.byId.get(depId)!, 'anchorsOnly')
          }
        }
      }
    }

    const updatedTasks: GanttTask[] = doc.tasks.map(task => {
      const delta = shifts.get(task.id)
      if (!delta) return task
      return {
        ...task,
        start: shiftDate(task.start, delta),
        end: shiftDate(task.end, delta),
      }
    })
    const updatedById = new Map(updatedTasks.map(t => [t.id, t]))

    // Check pinned deadline conflicts and post-shift schedule conflicts
    const pinnedConflicts: Array<{
      pinnedTaskId: string
      pinnedTaskName: string
      pinnedStart: string
      predecessorId: string
      predecessorName: string
      predecessorNewEnd: string
      overlapDays: number
    }> = []

    for (const task of doc.tasks) {
      if (!isPinned(task)) continue
      for (const predId of graph.preds.get(task.id) ?? []) {
        if (!shifts.has(predId)) continue
        const predAfter = updatedById.get(predId)!
        if (predAfter.end > task.start) {
          pinnedConflicts.push({
            pinnedTaskId: task.id,
            pinnedTaskName: task.name,
            pinnedStart: task.start,
            predecessorId: predAfter.id,
            predecessorName: predAfter.name,
            predecessorNewEnd: predAfter.end,
            overlapDays: diffDays(parseDate(task.start), parseDate(predAfter.end)),
          })
        }
      }
    }

    const postGraph = analyzeScheduleGraph(updatedTasks)
    const spanAfter = documentSpan(updatedTasks)
    const moved = doc.tasks
      .filter(task => shifts.has(task.id))
      .map(before => {
        const after = updatedById.get(before.id)!
        return {
          id: before.id,
          name: before.name,
          role: anchorIds.has(before.id) ? 'anchor' : 'ripple',
          deltaDays: shifts.get(before.id)!,
          before: { start: before.start, end: before.end },
          after: { start: after.start, end: after.end },
        }
      })

    if (dryRun) {
      const drySummary = `Dry run (${rippleMode}, ${deltaDays > 0 ? `+${deltaDays}` : deltaDays}d): would move ${moved.length} task(s), hold ${held.length}, with ${pinnedConflicts.length} pinned conflict(s).`
      return {
        summary: drySummary,
        mutated: false,
        data: {
          dryRun: true,
          deltaDays,
          rippleMode,
          moved,
          held,
          pinnedConflicts,
          scheduleConflictsAfter: postGraph.scheduleConflicts,
          spanBefore,
          spanAfter,
        },
      }
    }

    const path = await ctx.setDocument(current => {
      const currentById = new Map(current.tasks.map(t => [t.id, t]))
      let next: GanttDocument = {
        ...current,
        tasks: current.tasks.map(task => {
          const delta = shifts.get(task.id)
          if (!delta) return task
          return {
            ...task,
            start: shiftDate(task.start, delta),
            end: shiftDate(task.end, delta),
          }
        }),
      }
      for (const entry of moved) {
        const before = currentById.get(entry.id)
        if (!before) continue
        const after: GanttTask = {
          ...before,
          start: shiftDate(before.start, entry.deltaDays),
          end: shiftDate(before.end, entry.deltaDays),
        }
        next = appendGanttAgentLog(next, {
          agentName: 'PureGantt Assistant',
          tool: 'fn_shiftSchedule',
          summary,
          taskId: before.id,
          before,
          after,
        })
      }
      return next
    })

    const direction = deltaDays > 0 ? `+${deltaDays}d` : `${deltaDays}d`
    const resultSummary = `Shifted ${moved.length} task(s) by ${direction} (${rippleMode}); ${held.length} held${pinnedConflicts.length ? `, ${pinnedConflicts.length} pinned conflict(s)` : ''}.`

    return {
      summary: resultSummary,
      mutated: true,
      data: {
        dryRun: false,
        deltaDays,
        rippleMode,
        moved,
        held,
        pinnedConflicts,
        scheduleConflictsAfter: postGraph.scheduleConflicts,
        spanBefore,
        spanAfter,
        artifactPaths: [path],
      },
    }
  },
})

interface PlanTaskDraft {
  id: string
  name: string
  start?: string
  end?: string
  durationDays?: number
  progress: number
  dependencies: string[]
  phase?: string
  owner?: string
  milestone: boolean
}

/**
 * Composite workflow 4: `fn_buildPlan`
 * Replaces `setTimeline` + `createTasks` + manual dependency/duration date math in one atomic call.
 */
const fnBuildPlan = defineAppFunction<GanttAgentToolContext>({
  name: 'fn_buildPlan',
  category: 'planning',
  risk: 'write',
  requiresApproval: true,
  replaces: ['setTimeline', 'createTasks'],
  description:
    'Build or extend a PureGantt project plan in a single atomic call: optionally configure timeline metadata (title, view mode, phases) and add a validated task graph with explicit dates or durationDays and automatic finish-to-start dependency scheduling (optionally skipping weekends). Refuses invalid dates, unknown dependencies, or cycles, and records the change in the agent log.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'One-line summary of the plan being created or extended (recorded in the agent log).',
      },
      title: {
        type: 'string',
        description: 'Optional timeline title to set.',
      },
      viewMode: {
        type: 'string',
        enum: ['Day', 'Week', 'Month', 'Year'],
        description: 'Optional timeline view mode to set.',
      },
      phases: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional ordered phase list to set on the timeline.',
      },
      mergePhases: {
        type: 'boolean',
        description:
          'When true (default), appends any new phase names used by created tasks to the timeline phase list.',
      },
      defaultStart: {
        type: 'string',
        description:
          'Optional fallback YYYY-MM-DD start date used for tasks that omit both start and dependencies.',
      },
      skipWeekends: {
        type: 'boolean',
        description:
          'When auto-computing dates from durationDays or predecessor finishes, land on Monday-Friday working days (default false).',
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            id: { type: 'string' },
            start: {
              type: 'string',
              description:
                'YYYY-MM-DD start date. Omit to auto-start after dependencies or on defaultStart.',
            },
            end: {
              type: 'string',
              description:
                'YYYY-MM-DD end date. Omit when supplying durationDays or milestone: true.',
            },
            durationDays: {
              type: 'number',
              description:
                'Positive whole number of inclusive days used to compute end from start when end is omitted.',
            },
            progress: { type: 'number' },
            dependencies: {
              type: 'array',
              items: { type: 'string' },
            },
            phase: { type: 'string' },
            owner: { type: 'string' },
            milestone: { type: 'boolean' },
          },
          required: ['name'],
        },
        description:
          'Ordered list of 1 to 100 tasks to add with explicit dates or durationDays + dependencies.',
      },
    },
    required: ['summary', 'tasks'],
  },
  run: async (ctx, args) => {
    const doc = ctx.document
    const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
    if (!summary) {
      throw new AgentGanttToolError(
        'Pass "summary": one sentence explaining the plan being built.',
      )
    }

    const rawTasks = args.tasks
    if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
      throw new AgentGanttToolError(
        'Pass "tasks": a non-empty array of tasks to add.',
      )
    }
    if (rawTasks.length > TASK_CAP) {
      throw new AgentGanttToolError(`At most ${TASK_CAP} tasks per call.`)
    }

    const title =
      typeof args.title === 'string' && args.title.trim()
        ? args.title.trim()
        : undefined
    const viewModeRaw =
      typeof args.viewMode === 'string' && args.viewMode.trim()
        ? args.viewMode.trim()
        : undefined
    if (viewModeRaw && !(GANTT_VIEW_MODES as readonly string[]).includes(viewModeRaw)) {
      throw new AgentGanttToolError(
        `viewMode must be one of ${GANTT_VIEW_MODES.join(', ')}.`,
      )
    }
    const viewMode = viewModeRaw as GanttViewMode | undefined

    const defaultStart =
      typeof args.defaultStart === 'string' && args.defaultStart.trim()
        ? args.defaultStart.trim()
        : undefined
    if (defaultStart && !isIsoDate(defaultStart)) {
      throw new AgentGanttToolError(
        `"defaultStart" must be a real YYYY-MM-DD calendar date (got "${defaultStart}").`,
      )
    }

    const skipWeekends = args.skipWeekends === true
    const mergePhases = args.mergePhases !== false

    const taken = new Set(doc.tasks.map(t => t.id))
    const drafts: PlanTaskDraft[] = []

    for (const raw of rawTasks) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new AgentGanttToolError('Every task in "tasks" must be an object.')
      }
      const candidate = raw as Record<string, unknown>
      const name =
        typeof candidate.name === 'string' ? candidate.name.trim() : ''
      if (!name) {
        throw new AgentGanttToolError('Every task needs a non-empty "name".')
      }
      const start =
        typeof candidate.start === 'string' && candidate.start.trim()
          ? candidate.start.trim()
          : undefined
      if (start && !isIsoDate(start)) {
        throw new AgentGanttToolError(
          `Task "${name}": start "${start}" must be a real YYYY-MM-DD date.`,
        )
      }
      const end =
        typeof candidate.end === 'string' && candidate.end.trim()
          ? candidate.end.trim()
          : undefined
      if (end && !isIsoDate(end)) {
        throw new AgentGanttToolError(
          `Task "${name}": end "${end}" must be a real YYYY-MM-DD date.`,
        )
      }
      let durationDays: number | undefined
      if (candidate.durationDays !== undefined) {
        if (
          typeof candidate.durationDays !== 'number' ||
          !Number.isFinite(candidate.durationDays) ||
          candidate.durationDays < 1 ||
          !Number.isInteger(candidate.durationDays)
        ) {
          throw new AgentGanttToolError(
            `Task "${name}": durationDays must be a positive integer.`,
          )
        }
        durationDays = candidate.durationDays
      }
      const requestedId =
        typeof candidate.id === 'string' && candidate.id.trim()
          ? candidate.id.trim()
          : undefined
      const id = uniqueTaskId(requestedId ?? slugifyTaskId(name), taken)
      taken.add(id)

      const dependencies = Array.isArray(candidate.dependencies)
        ? candidate.dependencies
            .filter((d): d is string => typeof d === 'string')
            .map(d => d.trim())
            .filter(Boolean)
        : []

      drafts.push({
        id,
        name,
        start,
        end,
        durationDays,
        progress:
          typeof candidate.progress === 'number' &&
          Number.isFinite(candidate.progress)
            ? Math.max(0, Math.min(100, Math.round(candidate.progress)))
            : 0,
        dependencies,
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

    // Validate all dependencies exist and graph is acyclic before scheduling
    for (const draft of drafts) {
      for (const dep of draft.dependencies) {
        if (dep === draft.id) {
          throw new AgentGanttToolError(
            `Task "${draft.name}" cannot depend on itself.`,
          )
        }
        if (!taken.has(dep)) {
          throw new AgentGanttToolError(
            `Task "${draft.name}" depends on unknown task id "${dep}".`,
          )
        }
      }
    }

    const cycle = findDependencyCycle([
      ...doc.tasks,
      ...drafts.map(d => ({
        id: d.id,
        dependencies: joinDependencies(d.dependencies),
      })),
    ])
    if (cycle) {
      throw new AgentGanttToolError(cycleMessage(cycle))
    }

    // Resolve dates in topological order across drafts
    const resolvedById = new Map<string, GanttTask>(
      doc.tasks.map(t => [t.id, t]),
    )
    const draftById = new Map<string, PlanTaskDraft>(
      drafts.map(d => [d.id, d]),
    )

    const resolveDraft = (id: string): GanttTask => {
      const existing = resolvedById.get(id)
      if (existing) return existing
      const draft = draftById.get(id)!
      const resolvedPreds = draft.dependencies.map(depId => resolveDraft(depId))

      let start = draft.start
      if (!start) {
        if (resolvedPreds.length > 0) {
          const latestPredEnd = resolvedPreds
            .map(p => p.end)
            .sort()
            .at(-1)!
          const dayAfter = shiftDate(latestPredEnd, 1)
          start = skipWeekends ? nextWorkingDay(dayAfter) : dayAfter
        } else if (defaultStart) {
          start = skipWeekends ? nextWorkingDay(defaultStart) : defaultStart
        } else {
          throw new AgentGanttToolError(
            `Task "${draft.name}" needs either "start", "dependencies", or plan-level "defaultStart".`,
          )
        }
      }

      let end = draft.end
      if (!end) {
        if (draft.durationDays !== undefined) {
          end = addDurationDays(start, draft.durationDays, skipWeekends)
        } else if (draft.milestone) {
          end = start
        } else {
          throw new AgentGanttToolError(
            `Task "${draft.name}" needs either "end", "durationDays", or "milestone: true".`,
          )
        }
      }

      if (end < start) {
        throw new AgentGanttToolError(
          `Task "${draft.name}": end ${end} is before start ${start}.`,
        )
      }

      const createdTask: GanttTask = {
        id: draft.id,
        name: draft.name,
        start,
        end,
        progress: draft.progress,
        ...(draft.dependencies.length
          ? { dependencies: joinDependencies(draft.dependencies) }
          : {}),
        ...(draft.phase ? { phase: draft.phase } : {}),
        ...(draft.owner ? { owner: draft.owner } : {}),
        ...(draft.milestone ? { milestone: true } : {}),
      }
      resolvedById.set(id, createdTask)
      return createdTask
    }

    const created: GanttTask[] = drafts.map(d => resolveDraft(d.id))

    const explicitPhases = Array.isArray(args.phases)
      ? normalizePhases(args.phases)
      : undefined
    const taskPhases = created
      .map(t => t.phase)
      .filter((p): p is string => Boolean(p))

    const settingsApplied: Record<string, unknown> = {}
    if (title) settingsApplied.title = title
    if (viewMode) settingsApplied.viewMode = viewMode

    const path = await ctx.setDocument(current => {
      let nextPhases = current.phases
      if (explicitPhases !== undefined) {
        nextPhases = mergePhases
          ? normalizePhases([...explicitPhases, ...taskPhases])
          : explicitPhases
        settingsApplied.phases = nextPhases
      } else if (mergePhases && taskPhases.length > 0) {
        const merged = normalizePhases([...(current.phases ?? []), ...taskPhases])
        if (merged.length !== (current.phases ?? []).length) {
          nextPhases = merged
          settingsApplied.phases = nextPhases
        }
      }

      let next: GanttDocument = {
        ...current,
        ...(title ? { title } : {}),
        ...(viewMode ? { viewMode } : {}),
        ...(nextPhases !== undefined ? { phases: nextPhases } : {}),
        tasks: [...current.tasks, ...created],
      }
      next = appendGanttAgentLog(next, {
        agentName: 'PureGantt Assistant',
        tool: 'fn_buildPlan',
        summary,
      })
      return next
    })

    const combinedTasks = [...doc.tasks, ...created]
    const span = documentSpan(combinedTasks)
    const graph = analyzeScheduleGraph(combinedTasks)

    const resultSummary = `Built plan "${title ?? doc.title}": added ${created.length} task(s)${span ? ` (${span.start} to ${span.end})` : ''}; critical chain spans ${graph.criticalDurationDays}d across ${graph.criticalTaskIds.length} task(s).`

    return {
      summary: resultSummary,
      mutated: true,
      data: {
        settingsApplied,
        created: created.map(taskView),
        span,
        criticalChain: {
          totalDurationDays: graph.criticalDurationDays,
          criticalTaskIds: graph.criticalTaskIds,
        },
        artifactPaths: [path],
      },
    }
  },
})

export const PUREGANTT_FUNCTIONS: readonly AppFunctionDefinition<GanttAgentToolContext>[] =
  [fnTimelineOverview, fnAnalyzeBlockers, fnShiftSchedule, fnBuildPlan]
