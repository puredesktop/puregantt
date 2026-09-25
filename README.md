# puregantt

## Open source and contributions

A Gantt planning app based on open-source projects including [React](https://github.com/facebook/react) and [styled-components](https://github.com/styled-components/styled-components). This snapshot implements its Gantt workspace in the app source; no separate upstream Gantt library is declared.

Anyone may use, study, modify, and share this software under the applicable licenses.
We welcome pull requests, bug reports, documentation improvements, and new ideas.
See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.

### License

Original code by pure.science inc is licensed under the [MIT License](LICENSE).
Copyright (c) 2026 pure.science inc. Third-party code, dependencies, and assets retain their own licenses and copyright notices.

### Major open-source projects

- [react](https://github.com/react/react).
- [react-dom](https://github.com/react/react).
- [styled-components](https://github.com/styled-components/styled-components).

Thank you to these projects and their contributors. Additional direct dependencies,
upstream links, and asset notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Snapshot and development context

Based on a cleaned snapshot from [Nikau-Dev/puregantt](https://github.com/Nikau-Dev/puregantt) at
commit `66767fe34380e998f94ee106ef5c011c4efaf36f` (main branch snapshot, 2026-09-25).
This repository begins with one clean initial commit; previous Git history was not copied.
Bundled demo datasets, saved development records, and identifying personal examples were removed or anonymized.

This is a PureDesktop app source repository. Local `@purescience/platform-*`
dependencies refer to shared packages in the parent suite and are not included here.
Use the matching PureDesktop development environment and the app's existing scripts;
this snapshot alone is not a complete standalone desktop application.


### Earlier Gantt foundation

The retained development metadata identifies [Frappe Gantt](https://github.com/frappe/gantt)
(MIT) as the original Gantt foundation. We acknowledge that open-source project
and its contributors. This snapshot renders its Gantt workspace with local React
components and does not declare Frappe Gantt as a current package dependency.
