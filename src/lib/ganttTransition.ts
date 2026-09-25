/** App-owned open ordering: read, save outgoing content, then bind as one commit. */
export function createGanttTransition() {
  let generation = 0
  return {
    cancel() {
      generation += 1
    },
    async run<T>(
      load: () => Promise<T>,
      flush: () => Promise<void>,
      commit: (value: T) => void,
      fail: (error: unknown) => void,
    ): Promise<void> {
      const ticket = ++generation
      try {
        const value = await load()
        if (ticket !== generation) return
        await flush()
        if (ticket !== generation) return
        commit(value)
      } catch (error) {
        if (ticket === generation) fail(error)
      }
    },
  }
}
