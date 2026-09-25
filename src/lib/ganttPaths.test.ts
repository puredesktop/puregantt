import { describe, expect, it } from 'vitest'
import {
  ganttPackageContentPath,
  ganttPackageExportsPath,
  ganttPackageManifestPath,
  ganttTitleFromPath,
  isGanttPackagePath,
  resolveGanttPackagePath,
} from './ganttPaths'

describe('gantt package paths', () => {
  it('recognizes .gantt package folders', () => {
    expect(isGanttPackagePath('/tmp/Roadmap.gantt')).toBe(true)
    expect(isGanttPackagePath('/tmp/Roadmap.gantt/')).toBe(true)
    expect(isGanttPackagePath('/tmp/Roadmap.json')).toBe(false)
  })

  it('resolves package member paths', () => {
    const packagePath = '/tmp/Roadmap.gantt/'
    expect(ganttPackageContentPath(packagePath)).toBe(
      '/tmp/Roadmap.gantt/gantt.gantt.json',
    )
    expect(ganttPackageManifestPath(packagePath)).toBe(
      '/tmp/Roadmap.gantt/manifest.json',
    )
    expect(ganttPackageExportsPath(packagePath)).toBe(
      '/tmp/Roadmap.gantt/assets/exports',
    )
  })

  it('derives titles from packages and json files', () => {
    expect(ganttTitleFromPath('/tmp/Research.gantt')).toBe('Research')
    expect(ganttTitleFromPath('/tmp/Research.json')).toBe('Research')
  })

  it('resolves member files to their package and refuses loose files', () => {
    expect(resolveGanttPackagePath('/tmp/Roadmap.gantt')).toBe('/tmp/Roadmap.gantt')
    expect(resolveGanttPackagePath('/tmp/Roadmap.gantt/')).toBe('/tmp/Roadmap.gantt')
    expect(resolveGanttPackagePath('/tmp/Roadmap.gantt/gantt.gantt.json')).toBe(
      '/tmp/Roadmap.gantt',
    )
    expect(resolveGanttPackagePath('/tmp/Roadmap.gantt/manifest.json')).toBe(
      '/tmp/Roadmap.gantt',
    )
    expect(resolveGanttPackagePath('/tmp/loose.gantt.json')).toBeNull()
    expect(resolveGanttPackagePath('/tmp/Roadmap.json')).toBeNull()
  })
})
