/**
 * Markup for the suite's agent activity layer: the refs an agent tool call names when it touches this item, so the
 * layer can mark it on screen. Refs are space-separated, so a value holding whitespace cannot be one and is left out.
 */
export function agentRefs(
  refs: ReadonlyArray<string | null | undefined | false>,
  label?: string | null,
): { 'data-agent-ref': string; 'data-agent-label'?: string } {
  const tag = refs.filter((ref): ref is string => typeof ref === 'string' && ref !== '' && !/\s/.test(ref)).join(' ')
  return label ? { 'data-agent-ref': tag, 'data-agent-label': label } : { 'data-agent-ref': tag }
}

/**
 * A task, as updateTasks (updates[].task) and deleteTask (task) name it — by id, or by name — and as createTasks
 * (tasks[].id) and listTasks' answer give its id. A name holding spaces cannot be a ref.
 */
export function taskRefs(task: { id: string; name: string }): ReturnType<typeof agentRefs> {
  return agentRefs([task.id, `task:${task.id}`, `id:${task.id}`, `task:${task.name}`], task.name)
}

/** A phase, as listTasks (phase), setTimeline (phases) and a task's phase name it. */
export function phaseRefs(phase: string): ReturnType<typeof agentRefs> {
  return agentRefs([`phase:${phase}`, `phases:${phase}`], phase)
}

/** The open timeline document, as its path appears in getGanttContext's answer; also `@open`, the surface a write naming nothing lands on. */
export function documentRefs(path: string | null, title?: string): ReturnType<typeof agentRefs> {
  return agentRefs(['@open', path, path && `path:${path}`], title)
}
