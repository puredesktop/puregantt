import { describe, expect, it } from 'vitest'
import {
  appendGanttAgentLog,
  createDefaultGanttDocument,
  createGanttPackageManifest,
  parseGanttDocument,
  serializeGanttDocument,
} from './ganttDocument'
import type { GanttTask } from '../types'

const TASK: GanttTask = {
  id: 'brief',
  name: 'Research brief',
  start: '2026-07-01',
  end: '2026-07-10',
  progress: 40,
  phase: 'Discovery',
  owner: 'Maya',
}

describe('gantt document', () => {
  it('creates an EMPTY default timeline — no sample tasks, phases or owners', () => {
    const document = createDefaultGanttDocument()
    expect(document.schemaVersion).toBe(1)
    expect(document.viewMode).toBe('Month')
    expect(document.title).toBe('Untitled gantt')
    expect(document.tasks).toEqual([])
    expect(document.phases).toEqual([])
    expect(document.agentLog).toBeUndefined()
  })

  it('never falls back to sample content when a file is not a timeline', () => {
    expect(() => parseGanttDocument('"just a string"')).toThrow()
    expect(() => parseGanttDocument('[]')).toThrow()
    expect(() => parseGanttDocument('not json')).toThrow()
    const empty = parseGanttDocument('{}')
    expect(empty.tasks).toEqual([])
    expect(empty.title).toBe('Untitled gantt')
  })

  it('drops tasks the chart cannot place and collapses a bad end onto the start', () => {
    const document = parseGanttDocument(
      JSON.stringify({
        tasks: [
          { id: 'ok', name: 'Fine', start: '2026-07-01', end: '2026-07-03' },
          { id: 'bad-end', name: 'Bad end', start: '2026-07-01', end: '2026-02-30' },
          { id: 'no-start', name: 'No start', end: '2026-07-03' },
          { id: 'bad-start', name: 'Bad start', start: 'July 1', end: '2026-07-03' },
        ],
      }),
    )
    expect(document.tasks.map(task => task.id)).toEqual(['ok', 'bad-end'])
    expect(document.tasks[1]).toMatchObject({ start: '2026-07-01', end: '2026-07-01' })
  })

  it('normalizes parsed task data', () => {
    const document = parseGanttDocument(
      JSON.stringify({
        title: 'Program',
        viewMode: 'Week',
        tasks: [
          {
            id: ' a ',
            name: ' Build ',
            start: '2026-07-01',
            end: '2026-07-07',
            progress: 135,
            dependencies: ' x ',
          },
        ],
      }),
    )
    expect(document.title).toBe('Program')
    expect(document.tasks[0]).toMatchObject({
      id: 'a',
      name: 'Build',
      progress: 100,
      dependencies: 'x',
    })
  })

  it('normalizes saved phase names', () => {
    const document = parseGanttDocument(
      JSON.stringify({
        title: 'Program',
        phases: [' Planning ', 'Build', 'planning', '', 42],
        tasks: [],
      }),
    )
    expect(document.phases).toEqual(['Planning', 'Build'])
  })

  it('serializes stable json with an updated timestamp', () => {
    const document = { ...createDefaultGanttDocument('Roadmap'), tasks: [TASK] }
    const parsed = parseGanttDocument(serializeGanttDocument(document))
    expect(parsed.title).toBe('Roadmap')
    expect(parsed.tasks).toEqual([{ ...TASK, milestone: false }])
  })

  it('creates a package manifest with asset directories', () => {
    const manifest = createGanttPackageManifest(
      '/tmp/Roadmap.gantt',
      createDefaultGanttDocument('Roadmap'),
    )
    expect(manifest).toMatchObject({
      appId: 'puregantt',
      slug: 'gantt',
      kind: 'gantt',
      contentFile: 'gantt.gantt.json',
      assetDirectories: ['assets/exports'],
    })
  })
})

describe('agent log', () => {
  it('appends capped log entries and round-trips them through parse', () => {
    let document = { ...createDefaultGanttDocument('Log test'), tasks: [TASK] }
    const task = TASK
    document = appendGanttAgentLog(document, {
      agentName: 'PureGantt Assistant',
      tool: 'updateTask',
      summary: 'Pushed the research brief out a week.',
      taskId: task.id,
      before: task,
      after: { ...task, end: '2030-01-02' },
    })
    expect(document.agentLog).toHaveLength(1)
    const reloaded = parseGanttDocument(serializeGanttDocument(document))
    expect(reloaded.agentLog?.[0]).toMatchObject({
      tool: 'updateTask',
      summary: 'Pushed the research brief out a week.',
      taskId: task.id,
    })
    expect(reloaded.agentLog?.[0]?.before?.id).toBe(task.id)
    expect(reloaded.agentLog?.[0]?.after?.end).toBe('2030-01-02')
  })
})
