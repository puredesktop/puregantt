import type { GanttDocument, GanttTask } from '../types'

/**
 * A distilled snapshot of the plan for the document switcher: real bars on
 * the real date range, drawn as one self-contained SVG page. No app CSS or
 * scripts — the switcher renders it in a sandboxed miniature.
 */

const WIDTH = 900
const HEIGHT = 620
const PADDING = 48
const ROW_GAP = 10
const MAX_ROWS = 12
const BAR_COLORS = ['#7c5cbf', '#a58ad6', '#5b8def', '#58a08a', '#c98a4b']

function parseDay(value: string): number | null {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface PlacedTask {
  task: GanttTask
  start: number
  end: number
}

export function ganttSnapshotHtml(document: GanttDocument): string | null {
  const placed = document.tasks
    .map((task): PlacedTask | null => {
      const start = parseDay(task.start)
      const end = parseDay(task.end) ?? start
      if (start === null || end === null) return null
      return { task, start, end: Math.max(end, start) }
    })
    .filter((entry): entry is PlacedTask => entry !== null)
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_ROWS)
  if (!placed.length) return null

  const min = Math.min(...placed.map(entry => entry.start))
  const max = Math.max(...placed.map(entry => entry.end))
  const span = Math.max(max - min, 86_400_000)
  const plotWidth = WIDTH - PADDING * 2
  const rowHeight = Math.min(
    40,
    Math.floor((HEIGHT - PADDING * 2) / placed.length) - ROW_GAP,
  )
  const x = (time: number): number =>
    PADDING + ((time - min) / span) * plotWidth

  const phases = [
    ...new Set(placed.map(entry => entry.task.phase ?? '')),
  ]
  const colorFor = (task: GanttTask): string =>
    BAR_COLORS[Math.max(0, phases.indexOf(task.phase ?? '')) % BAR_COLORS.length]

  const grid = Array.from({ length: 5 }, (_, index) => {
    const gx = PADDING + (plotWidth * index) / 4
    return `<line x1="${gx}" y1="${PADDING - 16}" x2="${gx}" y2="${HEIGHT - PADDING + 8}" stroke="#e8e5ef" stroke-width="2"/>`
  }).join('')

  const rows = placed
    .map((entry, index) => {
      const y = PADDING + index * (rowHeight + ROW_GAP)
      const left = x(entry.start)
      const width = Math.max(x(entry.end) - left, rowHeight / 2)
      const color = colorFor(entry.task)
      if (entry.task.milestone) {
        const cx = left + rowHeight / 2
        const cy = y + rowHeight / 2
        const r = rowHeight / 2
        return `<path d="M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z" fill="${color}"/>`
      }
      const progress = Math.max(0, Math.min(1, (entry.task.progress ?? 0) / 100))
      const label =
        rowHeight >= 22
          ? `<text x="${left + 10}" y="${y + rowHeight / 2 + 5}" font-family="Archivo, system-ui, sans-serif" font-size="14" fill="#ffffff">${escapeXml(entry.task.name.slice(0, 28))}</text>`
          : ''
      return (
        `<rect x="${left}" y="${y}" width="${width}" height="${rowHeight}" rx="5" fill="${color}" opacity="0.45"/>` +
        (progress > 0
          ? `<rect x="${left}" y="${y}" width="${width * progress}" height="${rowHeight}" rx="5" fill="${color}"/>`
          : '') +
        label
      )
    })
    .join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;background:#ffffff}</style></head>
<body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">${grid}${rows}</svg></body></html>`
}
