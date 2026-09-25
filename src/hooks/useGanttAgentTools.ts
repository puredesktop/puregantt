import { useRef } from 'react'
import { usePlatformAgentTools } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  AgentGanttToolError,
  PUREGANTT_AGENT_LOG_LABEL,
  PUREGANTT_AGENT_TOOL_NAMES,
  type GanttAgentToolContext,
} from '../agents/catalog'
import {
  createTasksHandler,
  deleteTaskHandler,
  getGanttContextHandler,
  listGanttChangesHandler,
  listTasksHandler,
  setTimelineHandler,
  setViewHandler,
  updateTasksHandler,
} from '../agents/handlers'

export function useGanttAgentTools(
  ready: boolean,
  context: GanttAgentToolContext,
): void {
  const contextRef = useRef(context)
  contextRef.current = context

  usePlatformAgentTools({
    ready,
    tools: PUREGANTT_AGENT_TOOL_NAMES,
    logLabel: PUREGANTT_AGENT_LOG_LABEL,
    errorType: AgentGanttToolError,
    handlers: {
      getGanttContext: async () => getGanttContextHandler(contextRef.current),
      listTasks: async invoke =>
        listTasksHandler(contextRef.current, invoke.arguments ?? {}),
      listGanttChanges: async invoke =>
        listGanttChangesHandler(contextRef.current, invoke.arguments ?? {}),
      createTasks: async invoke =>
        createTasksHandler(contextRef.current, invoke.arguments ?? {}),
      updateTasks: async invoke =>
        updateTasksHandler(contextRef.current, invoke.arguments ?? {}),
      deleteTask: async invoke =>
        deleteTaskHandler(contextRef.current, invoke.arguments ?? {}),
      setTimeline: async invoke =>
        setTimelineHandler(contextRef.current, invoke.arguments ?? {}),
      setView: async invoke =>
        setViewHandler(contextRef.current, invoke.arguments ?? {}),
    },
  })
}
