import { describe, expect, it } from 'vitest'
import { createDefaultGanttDocument } from './ganttDocument'
import { GANTT_SAMPLES } from './ganttSamples'
import { ganttSnapshotHtml } from './ganttSnapshot'
import type { GanttDocument } from '../types'

function populated(title: string): GanttDocument {
  const sample = GANTT_SAMPLES[0].document
  return {
    ...createDefaultGanttDocument(title),
    tasks: sample.tasks.map(task => ({ ...task })),
  }
}

describe('ganttSnapshotHtml', () => {
  it('draws one bar per task on the real date range', () => {
    const doc = populated('Launch timeline')
    const html = ganttSnapshotHtml(doc)!
    expect(html).toContain('<svg')
    const bars = html.match(/opacity="0.45"/g) ?? []
    expect(bars.length).toBe(doc.tasks.filter(t => !t.milestone).length)
  })

  it('renders milestones as diamonds', () => {
    const doc = populated('T')
    doc.tasks[0].milestone = true
    const html = ganttSnapshotHtml(doc)!
    expect(html).toContain('<path d="M ')
  })

  it('returns null for an empty or dateless plan', () => {
    expect(ganttSnapshotHtml(createDefaultGanttDocument('T'))).toBeNull()
    const doc = populated('T')
    doc.tasks = [
      {
        id: 'x',
        name: 'No dates',
        start: 'not-a-date',
        end: 'nope',
        progress: 0,
      },
    ]
    expect(ganttSnapshotHtml(doc)).toBeNull()
  })

  it('escapes task names', () => {
    const doc = populated('T')
    const bar = doc.tasks.find(task => !task.milestone)!
    bar.name = '<script>alert(1)</script>'
    const html = ganttSnapshotHtml(doc)!
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;')
  })
})
