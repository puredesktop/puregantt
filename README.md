<p><img src="docs/assets/app-icon.svg" width="88" height="88" alt="puregantt icon"></p>

# puregantt

## App documentation

Plan project timelines with dates, progress, owners, phases, and dependencies.

1. Create a plan and add your tasks with start and end dates.
2. Assign owners, group tasks into phases, and record dependencies and progress.
3. Review the timeline and save the editable plan as a `.gantt` package.

Read the [app guide](docs/app-guide.md) for usage and development requirements. This app runs within [puredesktop](https://puredesktop.ai).

## Open source and contributions

A Gantt planning app based on open-source projects including [React](https://github.com/facebook/react) and [styled-components](https://github.com/styled-components/styled-components). This snapshot implements its Gantt workspace in the app source; no separate upstream Gantt library is declared.

Anyone may use, study, modify, and share this software under the applicable licenses.
We welcome pull requests, bug reports, documentation improvements, and new ideas.
See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.

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
