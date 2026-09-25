/** Must match `plugin.json` `app.slug`. */
export const GANTT_APP_SLUG = 'gantt'

/** Canonical Gantt document: a `.gantt` package folder. */
export const GANTT_PACKAGE_SUFFIX = '.gantt'

/** The timeline document inside a `.gantt` package. */
export const GANTT_DOCUMENT_FILE = 'gantt.gantt.json'

/** Package manifest file. */
export const GANTT_MANIFEST_FILE = 'manifest.json'

/** Durable package folder for exported artifacts. */
export const GANTT_EXPORTS_DIR = 'assets/exports'

/** Debounced autosave delay for timeline packages. */
export const AUTOSAVE_DELAY_MS = 600

export const GANTT_VIEW_MODES = ['Day', 'Week', 'Month', 'Year'] as const
