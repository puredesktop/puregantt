import { useCallback, useEffect, useState } from 'react'
import { fetchGanttSettings } from '../bridge/platformBridge'
import type { PureGanttBootState } from '../types'

interface UsePureGanttBootResult {
  boot: PureGanttBootState | null
  bootError: Error | null
  booting: boolean
  reloadBoot: () => void
}

export function usePureGanttBoot(ready: boolean): UsePureGanttBootResult {
  const [boot, setBoot] = useState<PureGanttBootState | null>(null)
  const [bootError, setBootError] = useState<Error | null>(null)
  const [booting, setBooting] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const reloadBoot = useCallback(() => {
    setReloadToken(current => current + 1)
  }, [])

  useEffect(() => {
    if (!ready) return

    let cancelled = false

    async function load(): Promise<void> {
      setBooting(true)
      setBootError(null)
      try {
        const appSettings = await fetchGanttSettings()
        if (!cancelled) setBoot({ appSettings })
      } catch (error) {
        if (cancelled) return
        setBoot(null)
        setBootError(error instanceof Error ? error : new Error(String(error)))
      } finally {
        if (!cancelled) setBooting(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [ready, reloadToken])

  return { boot, bootError, booting, reloadBoot }
}
