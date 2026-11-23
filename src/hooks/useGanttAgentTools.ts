import { useMemo, useRef } from 'react'
import {
  usePlatformAgentTools,
  type AgentToolHandler,
} from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  AgentGanttToolError,
  EXPOSED_TOOL_NAMES,
  PUREGANTT_AGENT_LOG_LABEL,
  type GanttAgentToolContext,
} from '../agents/catalog'
import { buildPureGanttHandlers } from '../agents/operationsRegistry'

/**
 * Registers PureGantt's exposed agent operations (composite `fn_*` functions,
 * core atomic tools, and universal escape-hatch meta-tools) with the shell.
 */
export function useGanttAgentTools(
  ready: boolean,
  context: GanttAgentToolContext,
): void {
  const contextRef = useRef(context)
  contextRef.current = context

  const registryHandlersRef = useRef<Record<string, AgentToolHandler> | null>(
    null,
  )
  if (!registryHandlersRef.current) {
    registryHandlersRef.current = buildPureGanttHandlers(
      () => contextRef.current,
    )
  }

  // Statically keyed over EXPOSED_TOOL_NAMES so scripts/check-manifests.mjs
  // verifies every exposed manifest tool has a registered handler.
  const exposedHandlers = useMemo(
    () =>
      Object.fromEntries(
        EXPOSED_TOOL_NAMES.map(name => [
          name,
          async (invoke: Parameters<AgentToolHandler>[0]) =>
            registryHandlersRef.current![name]!(invoke),
        ]),
      ),
    [],
  )

  usePlatformAgentTools({
    ready,
    tools: EXPOSED_TOOL_NAMES,
    logLabel: PUREGANTT_AGENT_LOG_LABEL,
    errorType: AgentGanttToolError,
    handlers: exposedHandlers,
  })
}
