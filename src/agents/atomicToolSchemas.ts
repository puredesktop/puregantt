import type {
  AppAtomicToolDefinition,
  AppOperationExposure,
  AppOperationRisk,
} from '@purescience/platform-ui/bridge/appFunctions'

/**
 * Lossless catalog of all 8 PureGantt atomic tool schemas extracted from `plugin.json`.
 *
 * Each entry declares:
 *   - `category`: clean domain grouping for `discoverAppTools`
 *   - `exposure`: `'always'` (3 core read/write tools) or `'extended'` (5 specialist tools)
 *   - explicit `risk` and `requiresApproval` satisfying `scripts/check-manifests.mjs`
 */
export type PureGanttAtomicToolSchema = Omit<
  AppAtomicToolDefinition<unknown>,
  'opClass' | 'run'
> & {
  exposure: AppOperationExposure
  risk: AppOperationRisk
}

export const PUREGANTT_ATOMIC_TOOL_SCHEMAS: readonly PureGanttAtomicToolSchema[] =
  [
    // ---- Core atomic tools (exposure: 'always') ----------------------------
    {
      name: 'getGanttContext',
      category: 'context',
      exposure: 'always',
      risk: 'read',
      requiresApproval: false,
      description:
        'Call this first. Returns the timeline: title, path, view mode, phases, task count, date span, agent-log size, and the chart view (phase filter, density, zoom, overlays).',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'createTasks',
      category: 'tasks',
      exposure: 'always',
      risk: 'write',
      requiresApproval: true,
      description:
        'Add tasks to the timeline: name, start and end (YYYY-MM-DD), optional id, progress, dependencies (existing or in-batch ids), phase, owner, milestone. Ids are derived from names when omitted. Dependencies must flow one way: a batch that closes a loop is refused. Recorded in the agent log. Pass a one-line summary \u2014 it is the line the user reads in the log.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
          },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                },
                start: {
                  type: 'string',
                },
                end: {
                  type: 'string',
                },
                id: {
                  type: 'string',
                },
                progress: {
                  type: 'number',
                },
                dependencies: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                },
                phase: {
                  type: 'string',
                },
                owner: {
                  type: 'string',
                },
                milestone: {
                  type: 'boolean',
                },
              },
              required: ['name', 'start', 'end'],
            },
          },
        },
        required: ['summary', 'tasks'],
      },
    },
    {
      name: 'updateTasks',
      category: 'tasks',
      exposure: 'always',
      risk: 'write',
      requiresApproval: true,
      description:
        "Edit tasks in one batch: each update names a task (id or name) and the fields to change \u2014 dates, progress, dependencies, phase, owner, milestone, name. One call carries a whole ripple. Dependent tasks outside the batch are named in the result but never moved automatically; a dependency change that closes a loop is refused. Each task's before/after is recorded in the agent log under the shared summary.",
      inputSchema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
          },
          updates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                task: {
                  type: 'string',
                },
                name: {
                  type: 'string',
                },
                start: {
                  type: 'string',
                },
                end: {
                  type: 'string',
                },
                progress: {
                  type: 'number',
                },
                dependencies: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                },
                phase: {
                  type: 'string',
                },
                owner: {
                  type: 'string',
                },
                milestone: {
                  type: 'boolean',
                },
              },
              required: ['task'],
            },
          },
        },
        required: ['summary', 'updates'],
      },
    },

    // ---- Extended specialist atomic tools (exposure: 'extended') -----------
    {
      name: 'listTasks',
      category: 'tasks',
      exposure: 'extended',
      risk: 'read',
      requiresApproval: false,
      description:
        'List the tasks with ids, names, dates (YYYY-MM-DD), progress, dependencies, phase, owner, and milestone flags. Optionally filtered to one phase.',
      inputSchema: {
        type: 'object',
        properties: {
          phase: {
            type: 'string',
          },
        },
      },
    },
    {
      name: 'listGanttChanges',
      category: 'audit',
      exposure: 'extended',
      risk: 'read',
      requiresApproval: false,
      description:
        'The agent log: recent agent writes to the timeline, newest first, with tool, summary, and task. Check it before repeating work another agent already did.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
          },
        },
      },
    },
    {
      name: 'setView',
      category: 'view',
      exposure: 'extended',
      risk: 'read',
      requiresApproval: false,
      description:
        'Change how the chart is looked at, without touching the timeline: filter to one phase (or "all"), density, zoom, and the links/weekends/owners overlays. Same controls as the sidebar. Not saved, not logged.',
      inputSchema: {
        type: 'object',
        properties: {
          phaseFilter: {
            type: 'string',
            description: 'A phase name from getGanttContext, or "all".',
          },
          density: {
            type: 'string',
            enum: ['compact', 'comfortable'],
          },
          zoom: {
            type: 'string',
            enum: ['fit', 'detail', 'wide'],
          },
          showDependencies: {
            type: 'boolean',
          },
          showWeekends: {
            type: 'boolean',
          },
          showOwners: {
            type: 'boolean',
          },
        },
      },
    },
    {
      name: 'setTimeline',
      category: 'timeline',
      exposure: 'extended',
      risk: 'write',
      requiresApproval: true,
      description:
        'Update timeline settings: title, view mode (Day, Week, Month, Year), or the phase list (an empty list clears it; tasks keep their own phase names). Recorded in the agent log.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
          },
          viewMode: {
            type: 'string',
          },
          phases: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          summary: {
            type: 'string',
          },
        },
      },
    },
    {
      name: 'deleteTask',
      category: 'tasks',
      exposure: 'extended',
      risk: 'destructive',
      requiresApproval: true,
      description:
        "Remove one task by id or name, and strip it from other tasks' dependencies. Recorded in the agent log with the removed task snapshot.",
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
          },
        },
        required: ['task'],
      },
    },
  ]
