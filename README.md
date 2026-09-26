<p><img src="docs/assets/app-icon.svg" width="88" height="88" alt="puregantt icon"></p>

# puregantt

**Plan tasks, dependencies, and delivery dates.** An app for [puredesktop](https://puredesktop.ai).

[Get started](#getting-started) · [App guide](docs/app-guide.md) · [Develop](docs/development.md) · [Developer account](https://puredesktop.ai/developers)

## What it does

A project timeline planner for tasks with dates, owners, phases, progress, and dependencies. Use it to organize a delivery plan, see how work overlaps, and update the plan as schedules change.

## Requirements

Use a compatible [puredesktop](https://puredesktop.ai) build for desktop integration, storage, and the app drawer. Developer setup is covered in the [development guide](docs/development.md).

Create a local plan with your own tasks. Agent assistance uses the host’s configured agent service.

## Getting started

1. Create a plan and add your tasks with start and end dates.
2. Assign owners, group tasks into phases, and record dependencies and progress.
3. Review the timeline and save the editable plan as a `.gantt` package.

## App layout

| Area | What you use it for |
| --- | --- |
| **Task list and timeline** | Read tasks alongside their date spans and dependency connections. |
| **Task editing** | Change task dates, owners, progress, and other details. |
| **Phases and plan controls** | Group work into phases and adjust the timeline’s view. |
| **Dependency controls** | Connect tasks and inspect how a change affects dependent work. |

The app also uses the shared [puredesktop](https://puredesktop.ai) shell and drawer agent. Panels can vary with the current view and selection.

## Working with the agent

Open the app’s drawer in [puredesktop](https://puredesktop.ai) and describe what you want to do. For example:

> List the tasks in this plan.
>
> Move the selected task to next week.

The app exposes 8 tools, including `getGanttContext`, `listTasks`, `listGanttChanges`. See [agents.md](agents.md) for workflows and [plugin.json](plugin.json) for the complete tool schemas and approval flags. Some actions apply directly, while approval-marked actions ask first. Check the result in the app after a change.

## Files and data

Plans are saved as editable `.gantt` packages, including tasks, dates, phases, owners, progress, and dependencies.

## Develop and customize

We welcome **developers and vibecoders alike**. Fork puregantt, add a feature, or use what you learn to build a new app.

| Develop your way | Workflow |
| --- | --- |
| **Claude Code, Codex, or your editor** | Open the app’s source folder, read `README.md`, `plugin.json`, `package.json`, and `agents.md`, then make changes and run the app’s checks. Test inside [puredesktop](https://puredesktop.ai) with matching shared platform packages. |
| **purefactory** | Choose **Start building** for a new app, or select an available app project to extend it. Use **Open folder** for external tools and **Open app** to test. |
| **App drawer** | Request a local app change where app-development integration is available. Make clear whether you want to change the app itself or its current document. |

Use **Share** in purefactory to create a `.pureapp` package, then **Settings → System → Install an app → Choose package…** to load it in current builds. Source availability and integration vary by host build.

Follow the [development guide](docs/development.md) for Claude Code/Codex commands, app-specific setup and checks, and packaging. A standalone browser preview does not provide every desktop service.

## Documentation and limitations

| Guide | What it covers |
| --- | --- |
| [App guide](docs/app-guide.md) | App overview, source layout, and usage. |
| [Development guide](docs/development.md) | External coding tools, purefactory, checks, and installation. |
| [Agent guide](agents.md) | App-specific agent workflows and constraints. |

Review dependent dates after changing a schedule. The current timeline is implemented with local React components; Frappe Gantt is an acknowledged earlier foundation.

## Contributing and marketplace

We welcome **developers and vibecoders alike**. Go to [puredesktop.ai](https://puredesktop.ai) and [create a developer account](https://puredesktop.ai/developers) to join the developer community and submit your app for review.

Bring improvements to this app, develop a fork, or build something entirely new. We welcome **open-source and proprietary projects alike** to the [puredesktop](https://puredesktop.ai) marketplace. Support for **paid apps is coming soon**, so you will be able to charge for your apps if you choose. Forks and redistributed dependencies must follow their applicable licenses.

For developer access, app submissions, or marketplace questions, contact [info@puredesktop.ai](mailto:info@puredesktop.ai).

Anyone may use, study, modify, and share this app under its applicable licenses. We welcome pull requests, bug reports, and documentation improvements. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits and license

A Gantt planning app based on open-source projects including [React](https://github.com/facebook/react) and [styled-components](https://github.com/styled-components/styled-components). This snapshot implements its Gantt workspace in the app source; no separate upstream Gantt library is declared.

### License

Original code by pure.science inc is licensed under the [MIT License](LICENSE).
Copyright (c) 2026 pure.science inc. Third-party code, dependencies, and assets retain their own licenses and copyright notices.

### Major open-source projects

| Project / source | Homepage or documentation | Support the maintainers |
| --- | --- | --- |
| [frappe/gantt](https://github.com/frappe/gantt) | [Homepage / docs](https://frappe.io/gantt) | — |
| [react/react](https://github.com/react/react) | [Homepage / docs](https://react.dev) | — |
| [styled-components/styled-components](https://github.com/styled-components/styled-components) | [Homepage / docs](https://styled-components.com) | [GitHub Sponsors](https://github.com/sponsors/quantizor) · [Open Collective](https://opencollective.com/styled-components) |

Thank you to these projects and their contributors. Additional direct dependencies,
upstream links, and asset notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Earlier Gantt foundation

The retained development metadata identifies [Frappe Gantt](https://github.com/frappe/gantt)
(MIT) as the original Gantt foundation. We acknowledge that open-source project
and its contributors. The app renders its Gantt workspace with local React
components and does not declare Frappe Gantt as a current package dependency.
