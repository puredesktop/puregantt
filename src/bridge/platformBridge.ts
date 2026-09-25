// The single bridge surface for PureGantt. Components never call
// `bridge.call` directly; every shell capability this app uses is a named
// helper here, and method names always come from `PLATFORM_BRIDGE_METHODS`.
import { bridge } from '@purescience/platform-ui/bridge/client'
import { toggleAgentDrawer } from '@purescience/platform-ui/bridge/workspace'
import { PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/methods'
import { GANTT_APP_SLUG } from '../constants'
import type {
  GanttAppSettings,
  PlatformAppSettingsUpdateRequest,
} from '../types'

export { bridge }

const STANDALONE_SETTINGS_KEY = 'purescience:puregantt:settings'

export function isStandaloneDevMode(): boolean {
  return import.meta.env.DEV && window.parent === window
}

function readStandaloneJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeStandaloneJson(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value))
}

export async function fetchGanttSettings(): Promise<GanttAppSettings> {
  if (isStandaloneDevMode()) {
    return readStandaloneJson<GanttAppSettings>(STANDALONE_SETTINGS_KEY, {})
  }

  return bridge.call<GanttAppSettings>(
    PLATFORM_BRIDGE_METHODS.SETTINGS_APP_GET,
    [GANTT_APP_SLUG],
  )
}

export async function updateGanttSettings(
  patch: Partial<GanttAppSettings>,
): Promise<GanttAppSettings> {
  if (isStandaloneDevMode()) {
    const nextSettings = {
      ...readStandaloneJson<GanttAppSettings>(STANDALONE_SETTINGS_KEY, {}),
      ...patch,
    }
    writeStandaloneJson(STANDALONE_SETTINGS_KEY, nextSettings)
    return nextSettings
  }

  const request: PlatformAppSettingsUpdateRequest = {
    appSlug: GANTT_APP_SLUG,
    patch,
  }
  return bridge.call<GanttAppSettings>(
    PLATFORM_BRIDGE_METHODS.SETTINGS_APP_UPDATE,
    [request],
  )
}

export async function readTextFile(path: string): Promise<string> {
  return bridge.call<string>(PLATFORM_BRIDGE_METHODS.FS_READ, [path])
}

/**
 * Open the shell's agent drawer — the one place to talk to the timeline.
 * The drawer's agent drives this app through its declared tools.
 */
export async function openAgentDrawer(): Promise<void> {
  if (isStandaloneDevMode()) return
  await toggleAgentDrawer({ open: true })
}
