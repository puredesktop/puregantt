import type { GanttDocument } from '../types'
import { threeWayMerge } from './threeWayMerge'

/** A plain list merged by value: what either added stays, what either took away goes. */
function mergeValues(base: string[] = [], local: string[] = [], remote: string[] = []): string[] {
  const added = remote.filter(value => !base.includes(value) && !local.includes(value))
  return [...local.filter(value => remote.includes(value) || !base.includes(value)), ...added]
}

/**
 * Two copies' work on one plan: task by task, and field by field inside a task. How a copy is zoomed in time stays its
 * own. Phases are a plain list of names, merged by name.
 */
export function mergeGantts(base: GanttDocument, local: GanttDocument, remote: GanttDocument): GanttDocument {
  const merged = threeWayMerge(base, local, remote, { ownFields: ['viewMode'] })
  const phases = mergeValues(base.phases, local.phases, remote.phases)
  return phases.length || merged.phases ? { ...merged, phases } : merged
}
