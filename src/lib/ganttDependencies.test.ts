import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import {
  addDependency,
  dependencyIds,
  findDependencyCycle,
  joinDependencies,
  removeDependency,
  removeTask,
  wouldCreateCycle,
} from './ganttDependencies'
import { GANTT_SAMPLES } from './ganttSamples'

function task(id: string, dependencies?: string): GanttTask {
  return {
    id,
    name: id,
    start: '2026-07-01',
    end: '2026-07-02',
    progress: 0,
    ...(dependencies ? { dependencies } : {}),
  }
}

describe('dependency ids', () => {
  it('splits and rejoins the comma list', () => {
    expect(dependencyIds(task('x', ' a , b,,c '))).toEqual(['a', 'b', 'c'])
    expect(dependencyIds(task('x'))).toEqual([])
    expect(joinDependencies(['a', ' b ', 'a', ''])).toBe('a, b')
    expect(joinDependencies([])).toBeUndefined()
  })
})

describe('findDependencyCycle', () => {
  it('returns null for a DAG and for unknown ids', () => {
    expect(
      findDependencyCycle([task('a'), task('b', 'a'), task('c', 'a, b')]),
    ).toBeNull()
    expect(findDependencyCycle([task('a', 'ghost')])).toBeNull()
  })

  it('names the closing chain', () => {
    expect(findDependencyCycle([task('a', 'c'), task('b', 'a'), task('c', 'b')]))
      .toEqual(['a', 'c', 'b', 'a'])
    expect(findDependencyCycle([task('a', 'a')])).toEqual(['a', 'a'])
  })

  it('ships samples that are cycle-free with resolvable dependencies', () => {
    for (const sample of GANTT_SAMPLES) {
      const ids = new Set(sample.document.tasks.map(item => item.id))
      for (const item of sample.document.tasks) {
        for (const dep of dependencyIds(item)) {
          expect(ids.has(dep), `${sample.key}: ${item.id} -> ${dep}`).toBe(true)
        }
      }
      expect(findDependencyCycle(sample.document.tasks)).toBeNull()
    }
  })
})

describe('addDependency / removeDependency', () => {
  it('links target after source once', () => {
    const tasks = [task('a'), task('b')]
    const linked = addDependency(tasks, 'a', 'b')
    expect(linked[1].dependencies).toBe('a')
    expect(addDependency(linked, 'a', 'b')).toBe(linked)
  })

  it('refuses self links, unknown ids and cycles by returning the same array', () => {
    const tasks = [task('a'), task('b', 'a')]
    expect(addDependency(tasks, 'a', 'a')).toBe(tasks)
    expect(addDependency(tasks, 'ghost', 'a')).toBe(tasks)
    expect(addDependency(tasks, 'b', 'a')).toBe(tasks)
    expect(wouldCreateCycle(tasks, 'a', 'b')).toBe(true)
    expect(wouldCreateCycle(tasks, 'b', 'a')).toBe(false)
  })

  it('removes one link and leaves other tasks untouched', () => {
    const tasks = [task('a'), task('b', 'a'), task('c', 'a, b')]
    const next = removeDependency(tasks, 'a', 'c')
    expect(next[2].dependencies).toBe('b')
    expect(next[1]).toBe(tasks[1])
  })
})

describe('removeTask', () => {
  it('drops the task and strips it from every dependency list', () => {
    const tasks = [task('a'), task('b', 'a'), task('c', 'a, b')]
    const next = removeTask(tasks, 'a')
    expect(next.map(item => item.id)).toEqual(['b', 'c'])
    expect(next[0].dependencies).toBeUndefined()
    expect(next[1].dependencies).toBe('b')
  })
})
