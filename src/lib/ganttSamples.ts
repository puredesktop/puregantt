import type { GanttDocument } from '../types'

type SampleKey =
  | 'product'
  | 'campus'
  | 'software'
  | 'research'
  | 'publication'
  | 'conference'
  | 'grant'
  | 'exhibition'

export interface GanttSample {
  key: SampleKey
  label: string
  document: GanttDocument
}

/** No bundled sample projects. */
export const GANTT_SAMPLES: GanttSample[] = []
