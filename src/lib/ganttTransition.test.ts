import { expect, it, vi } from 'vitest'
import { createGanttTransition } from './ganttTransition'
it('keeps the outgoing timeline when its save fails', async () => {
  const transitions = createGanttTransition()
  const commit = vi.fn(),
    fail = vi.fn()
  await transitions.run(
    async () => 'new',
    async () => {
      throw new Error('EIO')
    },
    commit,
    fail,
  )
  expect(commit).not.toHaveBeenCalled()
  expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'EIO' }))
})
it('discards a slow earlier read after a newer timeline lands', async () => {
  const transitions = createGanttTransition()
  const commit = vi.fn(),
    flush = vi.fn(async () => {}),
    fail = vi.fn()
  let resolve!: (value: string) => void
  const old = transitions.run(
    () =>
      new Promise<string>(yes => {
        resolve = yes
      }),
    flush,
    commit,
    fail,
  )
  await transitions.run(async () => 'new', flush, commit, fail)
  resolve('old')
  await old
  expect(commit.mock.calls).toEqual([['new']])
  expect(flush).toHaveBeenCalledTimes(1)
})
it('discards a pending transition after edits cancel it', async () => {
  const transitions = createGanttTransition()
  const commit = vi.fn()
  let finish!: () => void
  const pending = transitions.run(
    async () => 'new',
    () =>
      new Promise<void>(yes => {
        finish = yes
      }),
    commit,
    vi.fn(),
  )
  await Promise.resolve()
  transitions.cancel()
  finish()
  await pending
  expect(commit).not.toHaveBeenCalled()
})
