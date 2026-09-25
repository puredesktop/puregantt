import type { GanttTask } from '../types'

/**
 * Dependency rules shared by the UI and the agent tools — both edit the
 * same task list through these functions, so a link the chart refuses is
 * a link the drawer refuses too.
 *
 * A task's `dependencies` is a comma-joined list of task ids it waits on.
 */

export function dependencyIds(task: Pick<GanttTask, 'dependencies'>): string[] {
  return (task.dependencies ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
}

/** Back to the stored form; `undefined` when the list is empty. */
export function joinDependencies(ids: string[]): string | undefined {
  const unique = [...new Set(ids.map(id => id.trim()).filter(Boolean))]
  return unique.length ? unique.join(', ') : undefined
}

/**
 * The first dependency cycle in the task list, as the chain of ids that
 * closes on itself (`['a', 'b', 'a']`), or `null` when the graph is a DAG.
 * Ids that name no task are skipped — they cannot close a cycle.
 */
export function findDependencyCycle(
  tasks: readonly Pick<GanttTask, 'id' | 'dependencies'>[],
): string[] | null {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (id: string, path: string[]): string[] | null => {
    const mark = state.get(id)
    if (mark === 'done') return null
    if (mark === 'visiting') {
      return [...path.slice(path.indexOf(id)), id]
    }
    const task = byId.get(id)
    if (!task) return null
    state.set(id, 'visiting')
    for (const dep of dependencyIds(task)) {
      if (!byId.has(dep)) continue
      const cycle = visit(dep, [...path, id])
      if (cycle) return cycle
    }
    state.set(id, 'done')
    return null
  }

  for (const task of tasks) {
    const cycle = visit(task.id, [])
    if (cycle) return cycle
  }
  return null
}

/** Would making `taskId` wait on `dependencyId` close a cycle? */
export function wouldCreateCycle(
  tasks: readonly Pick<GanttTask, 'id' | 'dependencies'>[],
  taskId: string,
  dependencyId: string,
): boolean {
  if (taskId === dependencyId) return true
  const trial = tasks.map(task =>
    task.id === taskId
      ? {
          id: task.id,
          dependencies: joinDependencies([...dependencyIds(task), dependencyId]),
        }
      : task,
  )
  return findDependencyCycle(trial) !== null
}

/**
 * Make `targetId` wait on `sourceId`. Returns the same array when the link
 * already exists, the ids are unknown, or the link would close a cycle —
 * callers compare identity to learn whether anything changed.
 */
export function addDependency(
  tasks: GanttTask[],
  sourceId: string,
  targetId: string,
): GanttTask[] {
  if (sourceId === targetId) return tasks
  const target = tasks.find(task => task.id === targetId)
  if (!target || !tasks.some(task => task.id === sourceId)) return tasks
  const existing = dependencyIds(target)
  if (existing.includes(sourceId)) return tasks
  if (wouldCreateCycle(tasks, targetId, sourceId)) return tasks
  return tasks.map(task =>
    task.id === targetId
      ? { ...task, dependencies: joinDependencies([...existing, sourceId]) }
      : task,
  )
}

/** Stop `targetId` waiting on `sourceId`. */
export function removeDependency(
  tasks: GanttTask[],
  sourceId: string,
  targetId: string,
): GanttTask[] {
  return tasks.map(task => {
    if (task.id !== targetId) return task
    const next = joinDependencies(
      dependencyIds(task).filter(id => id !== sourceId),
    )
    return next === task.dependencies ? task : { ...task, dependencies: next }
  })
}

/** Drop a task and every reference other tasks hold to it. */
export function removeTask(tasks: GanttTask[], taskId: string): GanttTask[] {
  return tasks
    .filter(task => task.id !== taskId)
    .map(task => {
      const next = joinDependencies(
        dependencyIds(task).filter(id => id !== taskId),
      )
      return next === task.dependencies ? task : { ...task, dependencies: next }
    })
}
