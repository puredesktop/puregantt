import {
  GANTT_DOCUMENT_FILE,
  GANTT_EXPORTS_DIR,
  GANTT_MANIFEST_FILE,
  GANTT_PACKAGE_SUFFIX,
} from '../constants'

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/g, '')
}

export function splitParentPath(path: string): {
  parent: string
  name: string
} {
  const parts = trimTrailingSlash(path).split('/')
  const name = parts.pop() ?? ''
  return {
    parent: parts.join('/') || '/',
    name,
  }
}

export function isGanttPackagePath(path: string): boolean {
  return trimTrailingSlash(path).toLowerCase().endsWith(GANTT_PACKAGE_SUFFIX)
}

export function ganttTitleFromPath(path: string): string {
  const { name } = splitParentPath(path)
  if (name.toLowerCase().endsWith(GANTT_PACKAGE_SUFFIX)) {
    return name.slice(0, -GANTT_PACKAGE_SUFFIX.length) || 'Untitled gantt'
  }
  return name.replace(/\.json$/i, '') || 'Untitled gantt'
}

/**
 * The `.gantt` package a path belongs to: the folder itself, or the
 * package around a member file such as `gantt.gantt.json`. `null` for a
 * loose file — that is an import, never something to autosave into.
 */
export function resolveGanttPackagePath(path: string): string | null {
  const trimmed = trimTrailingSlash(path)
  if (isGanttPackagePath(trimmed)) return trimmed
  const { parent } = splitParentPath(trimmed)
  return parent !== '/' && isGanttPackagePath(parent) ? parent : null
}

export function ganttPackageContentPath(packagePath: string): string {
  return `${trimTrailingSlash(packagePath)}/${GANTT_DOCUMENT_FILE}`
}

export function ganttPackageManifestPath(packagePath: string): string {
  return `${trimTrailingSlash(packagePath)}/${GANTT_MANIFEST_FILE}`
}

export function ganttPackageExportsPath(packagePath: string): string {
  return `${trimTrailingSlash(packagePath)}/${GANTT_EXPORTS_DIR}`
}
