import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { GanttDocument, GanttTask, GanttView, GanttViewControls } from '../types'
import { PUREGANTT_ATOMIC_TOOL_SCHEMAS } from './atomicToolSchemas'
import {
  AgentGanttToolError,
  EXPOSED_TOOL_NAMES,
  PUREGANTT_AGENT_TOOL_NAMES,
  PUREGANTT_ALL_ATOMIC_TOOL_NAMES,
  PUREGANTT_CORE_TOOL_NAMES,
  PUREGANTT_EXTENDED_TOOL_NAMES,
  PUREGANTT_FUNCTION_NAMES,
  PUREGANTT_META_TOOL_NAMES,
  type GanttAgentToolContext,
} from './catalog'
import {
  PUREGANTT_OPERATIONS_REGISTRY,
  buildPureGanttHandlers,
} from './operationsRegistry'

const RELEASE_VERBS = new Set([
  'send',
  'sends',
  'sending',
  'merge',
  'merges',
  'merging',
  'publish',
  'publishes',
  'publishing',
  'deposit',
  'deposits',
  'depositing',
  'deploy',
  'deploys',
  'deploying',
  'post',
  'posts',
  'posting',
])

function sampleDocument(overrides: Partial<GanttDocument> = {}): GanttDocument {
  const tasks: GanttTask[] = [
    {
      id: 'spec',
      name: 'Write Spec',
      start: '2026-05-01',
      end: '2026-05-05',
      progress: 100,
      phase: 'Discovery',
      owner: 'Ada',
    },
    {
      id: 'design',
      name: 'UI Design',
      start: '2026-05-06',
      end: '2026-05-10',
      progress: 60,
      dependencies: 'spec',
      phase: 'Design',
      owner: 'Bob',
    },
    {
      id: 'docs',
      name: 'Draft Docs',
      start: '2026-05-06',
      end: '2026-05-08',
      progress: 20,
      dependencies: 'spec',
      phase: 'Design',
      owner: 'Ada',
    },
    {
      id: 'build',
      name: 'Implement Core',
      start: '2026-05-11',
      end: '2026-05-15',
      progress: 0,
      dependencies: 'design',
      phase: 'Build',
      owner: 'Cara',
    },
    {
      id: 'launch',
      name: 'Release Launch',
      start: '2026-05-16',
      end: '2026-05-16',
      progress: 0,
      dependencies: 'build, docs',
      phase: 'Launch',
      owner: 'Ada',
      milestone: true,
    },
  ]

  return {
    schemaVersion: 1,
    title: 'Q2 Product Launch',
    viewMode: 'Month',
    phases: ['Discovery', 'Design', 'Build', 'Launch'],
    tasks,
    agentLog: [
      {
        id: 'log-1',
        at: '2026-05-01T10:00:00.000Z',
        agentName: 'PureGantt Assistant',
        tool: 'createTasks',
        summary: 'Seeded initial launch plan',
      },
    ],
    updatedAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  }
}

function makeHarness(initialDoc: GanttDocument = sampleDocument()) {
  let currentDoc = initialDoc
  let viewState: GanttView = {
    phaseFilter: 'all',
    density: 'comfortable',
    zoom: 'fit',
    showDependencies: true,
    showWeekends: false,
    showOwners: true,
  }

  const view: GanttViewControls = {
    get: () => ({ ...viewState }),
    set: patch => {
      viewState = { ...viewState, ...patch }
    },
    phases: () => currentDoc.phases ?? [],
  }

  const savedPaths: string[] = []
  const getCtx = (): GanttAgentToolContext => ({
    document: currentDoc,
    documentPath: '/workspace/q2-launch.gantt',
    view,
    setDocument: async updater => {
      currentDoc = updater(currentDoc)
      const path = '/workspace/q2-launch.gantt'
      savedPaths.push(path)
      return path
    },
  })

  return {
    getCtx,
    getDoc: () => currentDoc,
    getView: () => viewState,
    savedPaths,
  }
}

function invokeArgs(shortName: string, args: Record<string, unknown> = {}) {
  return {
    toolCallId: 'test-call',
    name: `gantt.${shortName}`,
    shortName,
    arguments: args,
  }
}

describe('PureGantt operationsRegistry invariants & manifest sync', () => {
  it('matches catalog lists, audit summary, and plugin.json 1:1', () => {
    const manifest = JSON.parse(readFileSync('plugin.json', 'utf8')) as {
      app: {
        agents: {
          tools: Array<{
            name: string
            description: string
            risk: string
            requiresApproval: boolean
            inputSchema: Record<string, unknown>
          }>
        }
      }
    }

    const summary = PUREGANTT_OPERATIONS_REGISTRY.auditSummary()
    expect(summary).toEqual({
      appSlug: 'gantt',
      functions: 4,
      coreTools: 3,
      extendedTools: 5,
      metaTools: 3,
      totalExposed: 10,
      totalAtomicTools: 8,
      totalRegistered: 12,
      schemaReductionPercent: -25,
    })

    expect(PUREGANTT_OPERATIONS_REGISTRY.exposedToolNames).toEqual([
      ...EXPOSED_TOOL_NAMES,
    ])
    expect([...PUREGANTT_AGENT_TOOL_NAMES]).toEqual([...EXPOSED_TOOL_NAMES])
    expect(
      PUREGANTT_OPERATIONS_REGISTRY.functions.map(f => f.name),
    ).toEqual([...PUREGANTT_FUNCTION_NAMES])
    expect(
      PUREGANTT_OPERATIONS_REGISTRY.coreTools.map(t => t.name),
    ).toEqual([...PUREGANTT_CORE_TOOL_NAMES])
    expect(PUREGANTT_OPERATIONS_REGISTRY.extendedToolNames).toEqual([
      ...PUREGANTT_EXTENDED_TOOL_NAMES,
    ])
    expect([...PUREGANTT_ALL_ATOMIC_TOOL_NAMES].sort()).toEqual(
      PUREGANTT_ATOMIC_TOOL_SCHEMAS.map(t => t.name).sort(),
    )
    expect(manifest.app.agents.tools).toEqual(
      PUREGANTT_OPERATIONS_REGISTRY.manifestTools,
    )
    expect(PUREGANTT_META_TOOL_NAMES).toEqual([
      'discoverAppTools',
      'callExtendedReadTool',
      'callExtendedTool',
    ])
  })

  it('satisfies manifest rules: descriptions >= 80 chars, explicit risk & booleans, no release verbs', () => {
    const validRisks = new Set([
      'read',
      'write',
      'destructive',
      'external',
      'release',
    ])

    for (const tool of PUREGANTT_OPERATIONS_REGISTRY.manifestTools) {
      const normalized = tool.description.trim().replace(/\s+/g, ' ')
      expect(
        normalized.length,
        `${tool.name} description too short (${normalized.length})`,
      ).toBeGreaterThanOrEqual(80)
      expect(typeof tool.requiresApproval).toBe('boolean')
      expect(validRisks.has(tool.risk)).toBe(true)

      const nameFirst =
        tool.name
          .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
          .split(/[^A-Za-z]+/)
          .find(Boolean)
          ?.toLowerCase() ?? ''
      const descFirst =
        normalized
          .split(/[^A-Za-z]+/)
          .find(Boolean)
          ?.toLowerCase() ?? ''

      expect(
        RELEASE_VERBS.has(nameFirst),
        `${tool.name} starts with release verb`,
      ).toBe(false)
      expect(
        RELEASE_VERBS.has(descFirst),
        `${tool.name} description starts with release verb`,
      ).toBe(false)
    }

    for (const fn of PUREGANTT_OPERATIONS_REGISTRY.functions) {
      expect(fn.name.startsWith('fn_')).toBe(true)
      const afterPrefix =
        fn.name
          .slice(3)
          .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
          .split(/[^A-Za-z]+/)
          .find(Boolean)
          ?.toLowerCase() ?? ''
      expect(RELEASE_VERBS.has(afterPrefix)).toBe(false)
    }

    for (const atomic of PUREGANTT_ATOMIC_TOOL_SCHEMAS) {
      expect(
        atomic.description.trim().replace(/\s+/g, ' ').length,
      ).toBeGreaterThanOrEqual(80)
      expect(typeof atomic.requiresApproval).toBe('boolean')
      expect(validRisks.has(atomic.risk)).toBe(true)
    }
  })

  it('builds one handler per exposed tool and none for extended tools directly', () => {
    const { getCtx } = makeHarness()
    const handlers = buildPureGanttHandlers(getCtx)
    expect(Object.keys(handlers).sort()).toEqual([...EXPOSED_TOOL_NAMES].sort())
    for (const extendedName of PUREGANTT_EXTENDED_TOOL_NAMES) {
      expect(handlers[extendedName]).toBeUndefined()
    }
  })
})

describe('PureGantt composite App Functions (fn_*)', () => {
  it('fn_timelineOverview compiles metadata, phase/owner breakdowns, critical chain, slack, overdue, conflicts, and changes', async () => {
    const { getCtx } = makeHarness()
    const handlers = buildPureGanttHandlers(getCtx)

    const res = await handlers.fn_timelineOverview(
      invokeArgs('fn_timelineOverview', { asOfDate: '2026-05-11' }),
    )
    const envelope = JSON.parse(res.content)
    expect(envelope.ok).toBe(true)
    expect(envelope.opClass).toBe('function')
    expect(envelope.function).toBe('fn_timelineOverview')
    expect(envelope.data.timeline.title).toBe('Q2 Product Launch')
    expect(envelope.data.timeline.span).toEqual({
      start: '2026-05-01',
      end: '2026-05-16',
      totalCalendarDays: 16,
    })

    // Critical chain: spec (5d) -> design (5d) -> build (5d) -> launch (1d) = 16d
    // docs is parallel (3d), finishing May 8 while launch starts May 16 => 7d slack
    expect(envelope.data.criticalChain.totalDurationDays).toBe(16)
    expect(envelope.data.criticalChain.criticalTaskIds).toEqual([
      'spec',
      'design',
      'build',
      'launch',
    ])
    expect(envelope.data.criticalChain.taskSlackDays.docs).toBe(7)
    expect(envelope.data.criticalChain.taskSlackDays.design).toBe(0)

    // Overdue as of 2026-05-11: design (end May 10, 60%) and docs (end May 8, 20%)
    expect(envelope.data.progress.overdueCount).toBe(2)
    expect(
      envelope.data.progress.overdueTasks.map((t: { id: string }) => t.id),
    ).toEqual(['docs', 'design'])
    expect(envelope.data.progress.completed).toBe(1)
    expect(envelope.data.progress.inProgress).toBe(2)
    expect(envelope.data.progress.notStarted).toBe(2)

    expect(envelope.data.phases).toHaveLength(4)
    expect(envelope.data.owners[0].owner).toBe('Ada')
    expect(envelope.data.owners[0].taskCount).toBe(3)
    expect(envelope.data.milestones).toHaveLength(1)
    expect(envelope.data.milestones[0].id).toBe('launch')
    expect(envelope.data.milestones[0].unfinishedPredecessorCount).toBe(3)
    expect(envelope.data.recentChanges).toHaveLength(1)
    expect(envelope.data.tasks).toHaveLength(5)
  })

  it('fn_timelineOverview handles filters, empty timelines, schedule conflicts, and invalid asOfDate', async () => {
    const conflictDoc = sampleDocument({
      tasks: [
        {
          id: 'a',
          name: 'Phase A',
          start: '2026-05-01',
          end: '2026-05-10',
          progress: 50,
          phase: 'Alpha',
          owner: 'Ada',
        },
        {
          id: 'b',
          name: 'Phase B',
          start: '2026-05-08',
          end: '2026-05-14',
          progress: 0,
          dependencies: 'a, ghost',
          phase: 'Beta',
          owner: 'Bob',
        },
      ],
    })
    const { getCtx } = makeHarness(conflictDoc)
    const handlers = buildPureGanttHandlers(getCtx)

    const res = await handlers.fn_timelineOverview(
      invokeArgs('fn_timelineOverview', { phase: 'beta', includeTasks: true }),
    )
    const env = JSON.parse(res.content)
    expect(env.data.tasks).toHaveLength(1)
    expect(env.data.tasks[0].id).toBe('b')
    expect(env.data.health.scheduleConflicts).toHaveLength(1)
    expect(env.data.health.scheduleConflicts[0].overlapDays).toBe(2)
    expect(env.data.health.danglingDependencies).toEqual([
      { taskId: 'b', taskName: 'Phase B', missingDependencyId: 'ghost' },
    ])

    await expect(
      handlers.fn_timelineOverview(
        invokeArgs('fn_timelineOverview', { asOfDate: '2026-02-30' }),
      ),
    ).rejects.toBeInstanceOf(AgentGanttToolError)

    const emptyHarness = makeHarness(sampleDocument({ tasks: [], agentLog: [] }))
    const emptyHandlers = buildPureGanttHandlers(emptyHarness.getCtx)
    const emptyRes = JSON.parse(
      (
        await emptyHandlers.fn_timelineOverview(
          invokeArgs('fn_timelineOverview', {}),
        )
      ).content,
    )
    expect(emptyRes.data.timeline.taskCount).toBe(0)
    expect(emptyRes.data.criticalChain.criticalTaskIds).toEqual([])
  })

  it('fn_analyzeBlockers traces direct, transitive, and root actionable blockers plus downstream impact', async () => {
    const { getCtx } = makeHarness()
    const handlers = buildPureGanttHandlers(getCtx)

    const res = await handlers.fn_analyzeBlockers(
      invokeArgs('fn_analyzeBlockers', {
        task: 'Release Launch',
        asOfDate: '2026-05-11',
      }),
    )
    const env = JSON.parse(res.content)
    expect(env.ok).toBe(true)
    expect(env.data.scope.mode).toBe('task')
    expect(env.data.targets).toHaveLength(1)

    const report = env.data.targets[0]
    expect(report.isBlocked).toBe(true)
    // Unfinished predecessors of launch: build (depth 1), docs (depth 1), design (depth 2). spec is 100% done!
    expect(report.blockerCount).toBe(3)
    expect(report.directBlockers.map((b: { id: string }) => b.id).sort()).toEqual([
      'build',
      'docs',
    ])
    // Root actionable blockers (no unfinished predecessors): design and docs
    expect(report.rootBlockers.map((b: { id: string }) => b.id).sort()).toEqual([
      'design',
      'docs',
    ])
    expect(report.rootBlockers.every((b: { overdue: boolean }) => b.overdue)).toBe(
      true,
    )

    // Inspecting 'design' shows downstream impact on 'build' and milestone 'launch'
    const designRes = JSON.parse(
      (
        await handlers.fn_analyzeBlockers(
          invokeArgs('fn_analyzeBlockers', {
            task: 'design',
            includeCompletedPredecessors: true,
          }),
        )
      ).content,
    )
    const designReport = designRes.data.targets[0]
    expect(designReport.isBlocked).toBe(false)
    expect(designReport.completedPredecessors).toHaveLength(1)
    expect(designReport.completedPredecessors[0].id).toBe('spec')
    expect(designReport.downstreamCount).toBe(2)
    expect(designReport.impactedMilestones).toHaveLength(1)
    expect(designReport.impactedMilestones[0].id).toBe('launch')
    expect(designReport.latestImpactedEnd).toBe('2026-05-16')

    // Default mode (no task/phase) analyzes milestones & terminals
    const defaultRes = JSON.parse(
      (
        await handlers.fn_analyzeBlockers(
          invokeArgs('fn_analyzeBlockers', {}),
        )
      ).content,
    )
    expect(defaultRes.data.scope.mode).toBe('milestones_and_terminals')
    expect(defaultRes.data.targets[0].task.id).toBe('launch')
    expect(defaultRes.data.globalRootBlockers.length).toBe(2)
  })

  it('fn_shiftSchedule supports cascade, dryRun, pinned deadlines, resolveConflicts, and anchorsOnly', async () => {
    const harness = makeHarness()
    const recordOperation = vi.fn()
    const handlers = buildPureGanttHandlers(harness.getCtx, { recordOperation })

    // 1. Dry-run cascade with pinned milestone: does NOT mutate or recordOperation
    const dryRes = JSON.parse(
      (
        await handlers.fn_shiftSchedule(
          invokeArgs('fn_shiftSchedule', {
            summary: 'Preview pushing UI Design out 5 days',
            tasks: ['design'],
            deltaDays: 5,
            pinMilestones: true,
            dryRun: true,
          }),
        )
      ).content,
    )
    expect(dryRes.data.dryRun).toBe(true)
    expect(dryRes.data.moved.map((m: { id: string }) => m.id)).toEqual([
      'design',
      'build',
    ])
    expect(dryRes.data.held).toEqual([
      expect.objectContaining({ id: 'launch', reason: 'pinned' }),
    ])
    // build moved to 2026-05-16..2026-05-20 which crosses pinned launch (2026-05-16)
    expect(dryRes.data.pinnedConflicts).toHaveLength(1)
    expect(dryRes.data.pinnedConflicts[0].pinnedTaskId).toBe('launch')
    expect(harness.savedPaths).toHaveLength(0)
    expect(recordOperation).not.toHaveBeenCalled()

    // 2. Real cascade shift using targetStart on 'design' -> moves design, build, launch
    const cascadeRes = JSON.parse(
      (
        await handlers.fn_shiftSchedule(
          invokeArgs('fn_shiftSchedule', {
            summary: 'Push UI Design start to May 10 and cascade ripple',
            tasks: ['UI Design'],
            targetStart: '2026-05-10',
          }),
        )
      ).content,
    )
    expect(cascadeRes.data.deltaDays).toBe(4)
    expect(cascadeRes.data.moved.map((m: { id: string }) => m.id)).toEqual([
      'design',
      'build',
      'launch',
    ])
    expect(harness.savedPaths).toHaveLength(1)
    expect(recordOperation).toHaveBeenCalledTimes(1)
    const afterDoc = harness.getDoc()
    expect(afterDoc.tasks.find(t => t.id === 'design')?.start).toBe('2026-05-10')
    expect(afterDoc.tasks.find(t => t.id === 'build')?.end).toBe('2026-05-19')
    expect(afterDoc.tasks.find(t => t.id === 'launch')?.start).toBe('2026-05-20')
    // Agent log recorded before/after for each of the 3 moved tasks
    expect(
      afterDoc.agentLog?.filter(e => e.tool === 'fn_shiftSchedule'),
    ).toHaveLength(3)

    // 3. resolveConflicts mode: shifting 'docs' (ends May 8) by +3 days -> May 11 still well before launch (May 20), so launch holds!
    const resolveRes = JSON.parse(
      (
        await handlers.fn_shiftSchedule(
          invokeArgs('fn_shiftSchedule', {
            summary: 'Slip Draft Docs by 3 days without moving launch',
            tasks: ['docs'],
            deltaDays: 3,
            rippleMode: 'resolveConflicts',
          }),
        )
      ).content,
    )
    expect(resolveRes.data.moved.map((m: { id: string }) => m.id)).toEqual(['docs'])
    expect(resolveRes.data.held).toEqual([
      expect.objectContaining({ id: 'launch', reason: 'noConflict' }),
    ])

    // 4. anchorsOnly by phase: shifts Design phase only and reports build & launch held
    const anchorOnlyRes = JSON.parse(
      (
        await handlers.fn_shiftSchedule(
          invokeArgs('fn_shiftSchedule', {
            summary: 'Nudge Design phase only',
            phase: 'Design',
            deltaDays: 1,
            rippleMode: 'anchorsOnly',
          }),
        )
      ).content,
    )
    expect(
      anchorOnlyRes.data.moved.map((m: { id: string }) => m.id).sort(),
    ).toEqual(['design', 'docs'])
    expect(
      anchorOnlyRes.data.held.map((h: { id: string }) => h.id).sort(),
    ).toEqual(['build', 'launch'])

    // 5. Validation errors
    await expect(
      handlers.fn_shiftSchedule(
        invokeArgs('fn_shiftSchedule', {
          summary: 'Conflict anchor and pin',
          tasks: ['design'],
          pinTasks: ['design'],
          deltaDays: 2,
        }),
      ),
    ).rejects.toThrow(/cannot be both/)
  })

  it('fn_buildPlan configures timeline settings and auto-schedules dependency graphs with skipWeekends & cycle checks', async () => {
    const emptyDoc: GanttDocument = {
      schemaVersion: 1,
      title: 'Untitled gantt',
      viewMode: 'Month',
      phases: [],
      tasks: [],
      updatedAt: '2026-05-01T00:00:00.000Z',
    }
    const harness = makeHarness(emptyDoc)
    const handlers = buildPureGanttHandlers(harness.getCtx)

    // 2026-05-01 is Friday. With skipWeekends: true:
    // t1: starts Fri May 1, 2 working days -> Fri May 1 .. Mon May 4
    // t2 (depends on t1): starts Tue May 5, 3 working days -> Tue May 5 .. Thu May 7
    // m1 (milestone, depends on t2): starts Fri May 8, end Fri May 8
    const res = JSON.parse(
      (
        await handlers.fn_buildPlan(
          invokeArgs('fn_buildPlan', {
            summary: 'Initial release schedule with working-day auto-scheduling',
            title: 'Alpha Release',
            viewMode: 'Week',
            phases: ['Planning', 'Delivery'],
            defaultStart: '2026-05-01',
            skipWeekends: true,
            tasks: [
              {
                id: 't1',
                name: 'Kickoff',
                durationDays: 2,
                phase: 'Planning',
                owner: 'Ada',
              },
              {
                id: 't2',
                name: 'Build Feature',
                durationDays: 3,
                dependencies: ['t1'],
                phase: 'Delivery',
                owner: 'Bob',
              },
              {
                id: 'm1',
                name: 'Ship Alpha',
                dependencies: ['t2'],
                phase: 'Launch',
                milestone: true,
              },
            ],
          }),
        )
      ).content,
    )

    expect(res.ok).toBe(true)
    expect(res.data.settingsApplied).toEqual({
      title: 'Alpha Release',
      viewMode: 'Week',
      phases: ['Planning', 'Delivery', 'Launch'],
    })
    expect(res.data.created).toEqual([
      expect.objectContaining({ id: 't1', start: '2026-05-01', end: '2026-05-04' }),
      expect.objectContaining({ id: 't2', start: '2026-05-05', end: '2026-05-07' }),
      expect.objectContaining({
        id: 'm1',
        start: '2026-05-08',
        end: '2026-05-08',
        milestone: true,
      }),
    ])
    expect(res.data.criticalChain.criticalTaskIds).toEqual(['t1', 't2', 'm1'])
    expect(harness.getDoc().title).toBe('Alpha Release')
    expect(harness.getDoc().agentLog?.[0].tool).toBe('fn_buildPlan')

    // Rejects dependency cycles cleanly without mutating
    const savedBefore = harness.savedPaths.length
    await expect(
      handlers.fn_buildPlan(
        invokeArgs('fn_buildPlan', {
          summary: 'Bad cyclic batch',
          defaultStart: '2026-05-11',
          tasks: [
            { id: 'x', name: 'X', durationDays: 2, dependencies: ['y'] },
            { id: 'y', name: 'Y', durationDays: 2, dependencies: ['x'] },
          ],
        }),
      ),
    ).rejects.toThrow(/loop/)
    expect(harness.savedPaths.length).toBe(savedBefore)
  })
})

describe('PureGantt core tools & escape-hatch routing/refusals', () => {
  it('executes all 3 core atomic tools directly with full lossless behavior', async () => {
    const harness = makeHarness()
    const handlers = buildPureGanttHandlers(harness.getCtx)

    const ctxRes = JSON.parse(
      (await handlers.getGanttContext(invokeArgs('getGanttContext'))).content,
    )
    expect(ctxRes.title).toBe('Q2 Product Launch')
    expect(ctxRes.taskCount).toBe(5)

    const createRes = JSON.parse(
      (
        await handlers.createTasks(
          invokeArgs('createTasks', {
            summary: 'Add QA pass',
            tasks: [
              {
                id: 'qa',
                name: 'QA Pass',
                start: '2026-05-15',
                end: '2026-05-16',
                dependencies: ['build'],
                phase: 'Build',
              },
            ],
          }),
        )
      ).content,
    )
    expect(createRes.created).toEqual([{ id: 'qa', name: 'QA Pass' }])

    const updateRes = JSON.parse(
      (
        await handlers.updateTasks(
          invokeArgs('updateTasks', {
            summary: 'Mark QA half done',
            updates: [{ task: 'qa', progress: 50 }],
          }),
        )
      ).content,
    )
    expect(updateRes.updated[0].progress).toBe(50)
  })

  it('discoverAppTools lists extended tools, supports category/query/name lookup, and routes all 5 extended tools', async () => {
    const harness = makeHarness()
    const handlers = buildPureGanttHandlers(harness.getCtx)

    const allExt = JSON.parse(
      (await handlers.discoverAppTools(invokeArgs('discoverAppTools', {})))
        .content,
    )
    expect(allExt.appSlug).toBe('gantt')
    expect(allExt.totalMatched).toBe(5)
    expect(
      allExt.operations.map((o: { name: string }) => o.name).sort(),
    ).toEqual([...PUREGANTT_EXTENDED_TOOL_NAMES].sort())

    const byName = JSON.parse(
      (
        await handlers.discoverAppTools(
          invokeArgs('discoverAppTools', {
            names: ['deleteTask', 'setView', 'fn_shiftSchedule', 'missing'],
          }),
        )
      ).content,
    )
    expect(byName.mode).toBe('describe')
    expect(byName.operations[0]).toMatchObject({
      name: 'deleteTask',
      found: true,
      risk: 'destructive',
      invokeVia: 'callExtendedTool',
      requiresConfirmDestructive: true,
    })
    expect(byName.operations[1]).toMatchObject({
      name: 'setView',
      found: true,
      invokeVia: 'callExtendedReadTool',
    })
    expect(byName.operations[2]).toMatchObject({
      name: 'fn_shiftSchedule',
      found: true,
      invokeVia: 'direct',
    })
    expect(byName.operations[3]).toMatchObject({ name: 'missing', found: false })

    // Extended read tools: listTasks, listGanttChanges, setView
    const listed = JSON.parse(
      (
        await handlers.callExtendedReadTool(
          invokeArgs('callExtendedReadTool', {
            tool: 'listTasks',
            arguments: { phase: 'Design' },
          }),
        )
      ).content,
    )
    expect(listed.tasks).toHaveLength(2)

    const changes = JSON.parse(
      (
        await handlers.callExtendedReadTool(
          invokeArgs('callExtendedReadTool', {
            tool: 'listGanttChanges',
            arguments: { limit: 5 },
          }),
        )
      ).content,
    )
    expect(changes.entries).toHaveLength(1)

    const viewOut = JSON.parse(
      (
        await handlers.callExtendedReadTool(
          invokeArgs('callExtendedReadTool', {
            tool: 'setView',
            arguments: { density: 'compact', showWeekends: true },
          }),
        )
      ).content,
    )
    expect(viewOut.view.density).toBe('compact')
    expect(harness.getView().showWeekends).toBe(true)

    // Extended write tool: setTimeline
    const timelineOut = JSON.parse(
      (
        await handlers.callExtendedTool(
          invokeArgs('callExtendedTool', {
            tool: 'setTimeline',
            arguments: {
              title: 'Q2 Updated Launch',
              viewMode: 'Week',
              summary: 'Rename timeline',
            },
          }),
        )
      ).content,
    )
    expect(timelineOut.applied.title).toBe('Q2 Updated Launch')
    expect(harness.getDoc().title).toBe('Q2 Updated Launch')

    // Extended destructive tool: deleteTask requires confirmDestructive: true
    const delOut = JSON.parse(
      (
        await handlers.callExtendedTool(
          invokeArgs('callExtendedTool', {
            tool: 'deleteTask',
            arguments: { task: 'docs' },
            confirmDestructive: true,
          }),
        )
      ).content,
    )
    expect(delOut.deleted).toEqual({ id: 'docs', name: 'Draft Docs' })
    expect(harness.getDoc().tasks.find(t => t.id === 'docs')).toBeUndefined()
    // Dependency reference to 'docs' was stripped from 'launch'
    expect(harness.getDoc().tasks.find(t => t.id === 'launch')?.dependencies).toBe(
      'build',
    )
  })

  it('enforces strict refusals on callExtendedReadTool and callExtendedTool, and runs beforeInvoke uniformly', async () => {
    const beforeInvoke = vi.fn()
    const recordOperation = vi.fn()
    const harness = makeHarness()
    const handlers = buildPureGanttHandlers(harness.getCtx, {
      beforeInvoke,
      recordOperation,
    })

    // callExtendedReadTool refusals
    await expect(
      handlers.callExtendedReadTool(
        invokeArgs('callExtendedReadTool', { tool: 'setTimeline' }),
      ),
    ).rejects.toThrow(/cannot run through callExtendedReadTool/)

    await expect(
      handlers.callExtendedReadTool(
        invokeArgs('callExtendedReadTool', { tool: 'deleteTask' }),
      ),
    ).rejects.toThrow(/cannot run through callExtendedReadTool/)

    await expect(
      handlers.callExtendedReadTool(
        invokeArgs('callExtendedReadTool', { tool: 'getGanttContext' }),
      ),
    ).rejects.toThrow(/already directly exposed/)

    await expect(
      handlers.callExtendedReadTool(
        invokeArgs('callExtendedReadTool', { tool: 'unknownTool' }),
      ),
    ).rejects.toThrow(/Unknown extended tool/)

    // callExtendedTool refusals
    await expect(
      handlers.callExtendedTool(
        invokeArgs('callExtendedTool', { tool: 'listTasks' }),
      ),
    ).rejects.toThrow(/read-only/)

    await expect(
      handlers.callExtendedTool(
        invokeArgs('callExtendedTool', { tool: 'deleteTask', arguments: { task: 'docs' } }),
      ),
    ).rejects.toThrow(/confirmDestructive: true/)

    await expect(
      handlers.callExtendedTool(
        invokeArgs('callExtendedTool', { tool: 'createTasks' }),
      ),
    ).rejects.toThrow(/already directly exposed/)

    await expect(
      handlers.callExtendedTool(
        invokeArgs('callExtendedTool', { tool: '' }),
      ),
    ).rejects.toThrow(/"tool" is required/)

    // beforeInvoke runs uniformly for direct, function, and extended calls
    await handlers.getGanttContext(invokeArgs('getGanttContext'))
    await handlers.fn_timelineOverview(invokeArgs('fn_timelineOverview', {}))
    await handlers.callExtendedReadTool(
      invokeArgs('callExtendedReadTool', { tool: 'listTasks' }),
    )
    await handlers.callExtendedTool(
      invokeArgs('callExtendedTool', {
        tool: 'setTimeline',
        arguments: { title: 'Renamed' },
      }),
    )

    expect(beforeInvoke).toHaveBeenCalledTimes(4)
    expect(beforeInvoke.mock.calls[0]![0]).toMatchObject({
      name: 'getGanttContext',
      opClass: 'tool',
      viaExtended: false,
    })
    expect(beforeInvoke.mock.calls[1]![0]).toMatchObject({
      name: 'fn_timelineOverview',
      opClass: 'function',
      viaExtended: false,
    })
    expect(beforeInvoke.mock.calls[2]![0]).toMatchObject({
      name: 'listTasks',
      opClass: 'tool',
      viaExtended: true,
    })
    expect(beforeInvoke.mock.calls[3]![0]).toMatchObject({
      name: 'setTimeline',
      opClass: 'tool',
      viaExtended: true,
    })
    // Only the extended mutating call triggered recordOperation (read function did not)
    expect(recordOperation).toHaveBeenCalledTimes(1)
  })
})
