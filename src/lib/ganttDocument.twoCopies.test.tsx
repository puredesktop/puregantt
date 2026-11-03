// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeShell } from '../test/fakeShell'
import { openTwoCopies } from '../test/twoCopies'
import type { GanttDocument, GanttTask } from '../types'
import { createDefaultGanttDocument, parseGanttDocument, serializeGanttDocument } from './ganttDocument'
import { mergeGantts } from './ganttMerge'

vi.mock('@purescience/platform-ui/bridge/documents.mjs', async () => (await import('../test/fakeShell')).fakeDocumentsModule)
vi.mock('@purescience/platform-ui/bridge/workspace.mjs', async () => (await import('../test/fakeShell')).fakeWorkspaceModule)
vi.mock('@purescience/platform-ui/bridge/client.mjs', async () => (await import('../test/fakeShell')).fakeClientModule)

/** Two live copies of PureGantt over one package, each with the real lifecycle, conditional write and merge. */
const task = (id: string, name = id): GanttTask => ({ id, name, start: '2026-11-02', end: '2026-11-09', progress: 0 })
const plan = (): GanttDocument => ({ ...createDefaultGanttDocument(), title: 'Launch', phases: ['Build'], tasks: [task('one'), task('two')] })
const config = {
  contentFile: 'gantt.gantt.json',
  files: (document: GanttDocument) => [{ name: 'gantt.gantt.json', content: serializeGanttDocument(document) }],
  parse: parseGanttDocument,
  merge: mergeGantts,
}
const rename = (id: string, name: string) => (document: GanttDocument): GanttDocument => ({ ...document, tasks: document.tasks.map(item => (item.id === id ? { ...item, name } : item)) })
const add = (id: string) => (document: GanttDocument): GanttDocument => ({ ...document, tasks: [...document.tasks, task(id)] })
const remove = (id: string) => (document: GanttDocument): GanttDocument => ({ ...document, tasks: document.tasks.filter(item => item.id !== id) })
const nameOf = (document: GanttDocument, id: string) => document.tasks.find(item => item.id === id)?.name
const ids = (document: GanttDocument) => document.tasks.map(item => item.id).sort()

let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined; fakeShell.reset() })
async function two() {
  const copies = await openTwoCopies(plan(), config)
  close = copies.close
  return copies
}

describe('two copies, one after the other', () => {
  it('a change in one reaches the other when it has nothing unsaved', async () => {
    const { a, b, settled, onDisk } = await two()
    await a.edit(rename('one', 'From A'))
    await settled()
    expect(nameOf(onDisk(), 'one')).toBe('From A')
    expect(nameOf(b.document(), 'one')).toBe('From A')
  })
})

describe('two copies at the same moment', () => {
  it('both change different tasks: both stay, on disk and in each copy, and no save is left refused', async () => {
    const { a, b, together, settled, onDisk } = await two()
    await together(rename('one', 'From A'), rename('two', 'From B'))
    await settled()
    for (const document of [onDisk(), a.document(), b.document()]) {
      expect(nameOf(document, 'one')).toBe('From A')
      expect(nameOf(document, 'two')).toBe('From B')
    }
    expect(a.lifecycle().doc.error).toBeNull()
    expect(b.lifecycle().doc.error).toBeNull()
  })

  it('both add a task: both stay', async () => {
    const { together, settled, onDisk } = await two()
    await together(add('from-a'), add('from-b'))
    await settled()
    expect(ids(onDisk())).toEqual(['from-a', 'from-b', 'one', 'two'])
  })

  it('one removes a task while the other changes another: it stays removed', async () => {
    const { together, settled, onDisk } = await two()
    await together(remove('two'), rename('one', 'From B'))
    await settled()
    expect(ids(onDisk())).toEqual(['one'])
    expect(nameOf(onDisk(), 'one')).toBe('From B')
  })

  it('both add a phase: both stay', async () => {
    const { together, settled, onDisk } = await two()
    await together(document => ({ ...document, phases: [...(document.phases ?? []), 'Test'] }), document => ({ ...document, phases: [...(document.phases ?? []), 'Ship'] }))
    await settled()
    expect([...(onDisk().phases ?? [])].sort()).toEqual(['Build', 'Ship', 'Test'])
  })

  it('both move the same task\'s end and its progress: both fields stay', async () => {
    const { together, settled, onDisk } = await two()
    const patch = (fields: Partial<GanttTask>) => (document: GanttDocument): GanttDocument => ({ ...document, tasks: document.tasks.map(item => (item.id === 'one' ? { ...item, ...fields } : item)) })
    await together(patch({ end: '2026-12-01' }), patch({ progress: 50 }))
    await settled()
    expect(onDisk().tasks.find(item => item.id === 'one')).toMatchObject({ end: '2026-12-01', progress: 50 })
  })

  it('both log an agent write: both entries stay', async () => {
    const { together, settled, onDisk } = await two()
    const log = (id: string) => (document: GanttDocument): GanttDocument => ({ ...document, agentLog: [{ id, at: '2026-11-02', agentName: 'Agent', tool: 'addTask', summary: id }, ...(document.agentLog ?? [])] })
    await together(log('from-a'), log('from-b'))
    await settled()
    expect((onDisk().agentLog ?? []).map(entry => entry.id).sort()).toEqual(['from-a', 'from-b'])
  })

  it('how a copy is zoomed in time stays its own', () => {
    const base = plan()
    expect(mergeGantts(base, { ...base, viewMode: 'Day' }, { ...base, viewMode: 'Year' }).viewMode).toBe('Day')
    expect(mergeGantts(base, base, { ...base, viewMode: 'Year' }).viewMode).toBe(base.viewMode)
  })
})
