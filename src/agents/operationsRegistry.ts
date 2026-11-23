import {
  createAppOperationsRegistry,
  defineAppTool,
  type AppAtomicToolDefinition,
  type BuildHandlersOptions,
} from '@purescience/platform-ui/bridge/appFunctions'
import type {
  AgentToolHandler,
  AgentToolHandlerResult,
} from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { PUREGANTT_ATOMIC_TOOL_SCHEMAS } from './atomicToolSchemas'
import { AgentGanttToolError, type GanttAgentToolContext } from './catalog'
import { PUREGANTT_FUNCTIONS } from './functions'
import {
  createTasksHandler,
  deleteTaskHandler,
  getGanttContextHandler,
  listGanttChangesHandler,
  listTasksHandler,
  setTimelineHandler,
  setViewHandler,
  updateTasksHandler,
} from './handlers'

type AtomicRunner = (
  ctx: GanttAgentToolContext,
  args: Record<string, unknown>,
) => Promise<AgentToolHandlerResult>

const ATOMIC_RUNNERS: Record<string, AtomicRunner> = {
  getGanttContext: async ctx => getGanttContextHandler(ctx),
  listTasks: async (ctx, args) => listTasksHandler(ctx, args),
  listGanttChanges: async (ctx, args) => listGanttChangesHandler(ctx, args),
  createTasks: async (ctx, args) => createTasksHandler(ctx, args),
  updateTasks: async (ctx, args) => updateTasksHandler(ctx, args),
  deleteTask: async (ctx, args) => deleteTaskHandler(ctx, args),
  setTimeline: async (ctx, args) => setTimelineHandler(ctx, args),
  setView: async (ctx, args) => setViewHandler(ctx, args),
}

const atomicTools: AppAtomicToolDefinition<GanttAgentToolContext>[] =
  PUREGANTT_ATOMIC_TOOL_SCHEMAS.map(schema =>
    defineAppTool<GanttAgentToolContext>({
      ...schema,
      run: async (ctx, args) => {
        const runner = ATOMIC_RUNNERS[schema.name]
        if (!runner) {
          throw new AgentGanttToolError(
            `Missing atomic tool handler for "${schema.name}".`,
          )
        }
        return runner(ctx, args)
      },
    }),
  )

/**
 * PureGantt's unified Operations Registry built on `@purescience/platform-ui/bridge/appFunctions`:
 *   - 4 composite `function` workflows (`fn_*`, always exposed)
 *   - 3 core atomic tools (`getGanttContext`, `createTasks`, `updateTasks`, always exposed)
 *   - 3 universal escape-hatch meta-tools (always exposed)
 *   - 5 extended specialist atomic tools (hidden by default, 100% reachable on demand)
 */
export const PUREGANTT_OPERATIONS_REGISTRY =
  createAppOperationsRegistry<GanttAgentToolContext>({
    appSlug: 'gantt',
    appName: 'PureGantt',
    functions: PUREGANTT_FUNCTIONS,
    tools: atomicTools,
  })

export function buildPureGanttHandlers(
  getCtx: () => GanttAgentToolContext,
  options: BuildHandlersOptions<GanttAgentToolContext> = {},
): Record<string, AgentToolHandler> {
  return PUREGANTT_OPERATIONS_REGISTRY.buildHandlers(getCtx, {
    createError: message => new AgentGanttToolError(message),
    ...options,
  })
}
