import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GanttDocument, GanttViewControls } from '../types'
import { createDefaultGanttDocument } from '../lib/ganttDocument'
import { GanttWorkspace } from './GanttWorkspace'

vi.mock('../bridge/platformBridge', async importOriginal => ({ ...(await importOriginal<object>()), openAgentDrawer: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root, container: HTMLDivElement
const plan: GanttDocument = {
  ...createDefaultGanttDocument(),
  title: 'Launch',
  tasks: [{ id: 'one', name: 'First task', start: '2026-11-02', end: '2026-11-09', progress: 0 }],
}
const props = () => ({
  document: plan, documentPath: '/Documents/launch.gantt', status: 'Saved.', error: null, onChange: vi.fn(), onCommitTitle: vi.fn(),
  onNew: vi.fn(), onLoadSample: vi.fn(), viewRef: createRef<GanttViewControls>(),
})
const shell = () => container.querySelector('.gantt-shell')!

beforeEach(async () => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<GanttWorkspace {...props()} compact />))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

it('held in a page, the plan has the box, and everything else stays mounted', () => {
  expect(shell().getAttribute('data-compact')).toBe('plan')
  expect(container.querySelector('.gantt-sidebar')).toBeTruthy()
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Timeline title"]')?.value).toBe('Launch')
  expect(container.textContent).toContain('First task')
})

it('a selected task opens beside the plan', async () => {
  const row = [...container.querySelectorAll<HTMLElement>('.gantt-project-timeline button, .gantt-project-timeline [role="button"]')].find(item => item.textContent?.includes('First task'))!
  await act(async () => row.click())
  expect(shell().getAttribute('data-compact')).toBe('with-selected')
  expect(container.querySelector('.gantt-selected-details')?.hasAttribute('open')).toBe(true)
})

it('Full app gives the whole app back with the same nodes and nothing marked', async () => {
  const title = container.querySelector('input[aria-label="Timeline title"]')
  await act(async () => root.render(<GanttWorkspace {...props()} compact={false} />))
  expect(container.querySelector('input[aria-label="Timeline title"]')).toBe(title)
  expect(container.querySelector('[data-compact]')).toBeNull()
})
