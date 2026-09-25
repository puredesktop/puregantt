# Third-party notices

A Gantt planning app based on open-source projects including [React](https://github.com/facebook/react) and [styled-components](https://github.com/styled-components/styled-components). This snapshot implements its Gantt workspace in the app source; no separate upstream Gantt library is declared.

Dependencies and bundled assets retain their upstream licenses. The MIT license
for original pure.science inc code does not relicense third-party material.

## Direct external runtime dependencies

This list covers dependencies declared by the snapshot package manifests, including
nested packages where present. It is not a complete transitive dependency inventory.
Consult the installed version’s license and notices before redistributing dependencies.

| Package | Declared version | Upstream |
| --- | --- | --- |
| `react` | `^19.1.0` | [react](https://github.com/react/react) |
| `react-dom` | `^19.1.0` | [react-dom](https://github.com/react/react) |
| `styled-components` | `^6.1.18` | [styled-components](https://github.com/styled-components/styled-components) |

### Earlier Gantt foundation

The retained development metadata identifies [Frappe Gantt](https://github.com/frappe/gantt)
(MIT) as the original Gantt foundation. We acknowledge that open-source project
and its contributors. This snapshot renders its Gantt workspace with local React
components and does not declare Frappe Gantt as a current package dependency.
