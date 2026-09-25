import { createGanttTransition } from './lib/ganttTransition'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppFrame } from '@purescience/platform-bridge/components/AppFrame'
import { EmptyState } from '@purescience/platform-ui/components/common/feedback/EmptyState'
import { usePlatformBridge } from '@purescience/platform-ui/bridge/react/usePlatformBridge'
import { usePlatformViewportResource } from '@purescience/platform-ui/bridge/react/usePlatformViewportResource'
import {
  useDocumentLifecycle,
  type DocumentLifecycle,
} from '@purescience/platform-ui/bridge/react/useDocumentLifecycle'
import { useDocumentHotkeys } from '@purescience/platform-ui/bridge/react/useDocumentHotkeys'
import {
  DocumentHeaderActions,
  DocumentSwitcher,
} from '@purescience/platform-ui/components/common/documents'
import { isStandaloneDevMode, readTextFile } from './bridge/platformBridge'
import { ganttSnapshotHtml } from './lib/ganttSnapshot'
import { GanttWorkspace } from './components/GanttWorkspace'
import {
  AUTOSAVE_DELAY_MS,
  GANTT_APP_SLUG,
  GANTT_DOCUMENT_FILE,
  GANTT_EXPORTS_DIR,
  GANTT_MANIFEST_FILE,
  GANTT_PACKAGE_SUFFIX,
} from './constants'
import { usePureGanttBoot } from './hooks/usePureGanttBoot'
import { useGanttAgentTools } from './hooks/useGanttAgentTools'
import {
  DEFAULT_GANTT_TITLE,
  createDefaultGanttDocument,
  createGanttPackageManifest,
  parseGanttDocument,
  serializeGanttDocument,
  serializeGanttPackageManifest,
} from './lib/ganttDocument'
import {
  ganttPackageContentPath,
  ganttTitleFromPath,
  resolveGanttPackagePath,
} from './lib/ganttPaths'
import type {
  GanttDocument,
  GanttViewControls,
  ResourceOpenEvent,
} from './types'

function fileNameFromPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
}

export function App(): React.ReactElement {
  const { error: bridgeError, ready, meta } = usePlatformBridge()
  const standaloneDev = isStandaloneDevMode()
  const bootReady = ready || standaloneDev
  const { boot, bootError } = usePureGanttBoot(bootReady)
  const { resource: viewportResource, clearResource } =
    usePlatformViewportResource(ready && !standaloneDev, meta)

  if (bridgeError && !standaloneDev) {
    return (
      <AppFrame>
        <EmptyState
          tone="error"
          title="Bridge unavailable"
          message={bridgeError.message}
        />
      </AppFrame>
    )
  }

  if (!bootReady || !boot) {
    const message = bootError
      ? bootError.message
      : ready
      ? 'Loading Gantt settings...'
      : 'Waiting for PureScience shell bridge...'

    return (
      <AppFrame>
        <EmptyState
          tone={bootError ? 'error' : 'neutral'}
          title={bootError ? 'Boot failed' : 'PureGantt'}
          message={message}
        />
      </AppFrame>
    )
  }

  return (
    <GanttDocumentApp
      ready={ready}
      viewportResource={viewportResource}
      onViewportResourceHandled={clearResource}
    />
  )
}

interface GanttDocumentAppProps {
  ready: boolean
  viewportResource: ResourceOpenEvent | null
  onViewportResourceHandled: () => void
}

function GanttDocumentApp({
  ready,
  viewportResource,
  onViewportResourceHandled,
}: GanttDocumentAppProps): React.ReactElement {
  const [document, setDocument] = useState<GanttDocument>(() =>
    createDefaultGanttDocument(),
  )
  const [documentPath, setDocumentPath] = useState<string | null>(null)
  const [status, setStatus] = useState('Add a task to start planning.')
  const [error, setError] = useState<string | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)

  // The live document. Kept current synchronously by every writer so agent
  // tool handlers, which run between renders, never build on a stale copy.
  const documentRef = useRef(document)
  useEffect(() => {
    documentRef.current = document
  }, [document])
  const documentPathRef = useRef<string | null>(documentPath)
  useEffect(() => {
    documentPathRef.current = documentPath
  }, [documentPath])
  // What serialize writes: the document of the package the lifecycle is
  // bound to. A switch flushes the outgoing package before rebinding, so
  // the incoming document must never land here early.
  const boundPathRef = useRef<string | null>(null)
  const boundDocumentRef = useRef(document)
  // The workspace's view controls, assigned by the workspace every render
  // so the setView tool drives the same state as the sidebar.
  const viewRef = useRef<GanttViewControls | null>(null)
  // Set when a document should become a draft as soon as it has rendered —
  // the lifecycle names drafts from the rendered title, so marking dirty
  // before that render would file it under the previous document's name.
  const persistAfterCommitRef = useRef(false)
  // Assigned right after the hook below; every callback reads it lazily.
  const lifecycleRef = useRef<DocumentLifecycle | null>(null)
  const transitions = useRef(createGanttTransition())
  useEffect(() => () => transitions.current.cancel(), [])
  const transitionError = useCallback((error: unknown) => {
    setError(error instanceof Error ? error.message : String(error))
    setStatus('Could not switch timeline. Current timeline kept.')
  }, [])

  /**
   * Replace the open timeline with an unbound one. The outgoing package is
   * flushed first — resetting the lifecycle drops its pending autosave.
   */
  const startTimeline = useCallback(
    (seed: GanttDocument, nextStatus: string, persist: boolean) => {
      setSwitcherOpen(false)
      const lifecycle = lifecycleRef.current!
      void transitions.current.run(
        async () => seed,
        () => lifecycle.flush({ throwOnError: true }),
        () => {
          boundPathRef.current = null
          boundDocumentRef.current = seed
          documentRef.current = seed
          lifecycle.reset()
          persistAfterCommitRef.current = persist
          setDocument(seed)
          setDocumentPath(null)
          setError(null)
          setStatus(nextStatus)
        },
        transitionError,
      )
    },
    [],
  )

  const createNewGantt = useCallback(() => {
    startTimeline(createDefaultGanttDocument(), 'New timeline.', false)
  }, [startTimeline])

  // A sample is an explicit ask: it becomes its own new draft, never the
  // contents of whichever timeline happened to be open.
  const loadSample = useCallback(
    (sample: GanttDocument) => {
      startTimeline(
        { ...sample, updatedAt: new Date().toISOString() },
        `Loaded the "${sample.title}" sample as a new draft.`,
        true,
      )
    },
    [startTimeline],
  )

  const openGanttPath = useCallback(
    async (path: string, external = false): Promise<void> => {
      const packagePath = resolveGanttPackagePath(path)
      if (!external && packagePath && boundPathRef.current === packagePath) {
        setSwitcherOpen(false)
        return
      }
      setError(null)
      setStatus('Opening...')
      const lifecycle = lifecycleRef.current!
      await transitions.current.run(
        async () =>
          parseGanttDocument(
            await readTextFile(
              packagePath ? ganttPackageContentPath(packagePath) : path,
            ),
          ),
        () =>
          external
            ? Promise.resolve()
            : lifecycle.flush({ throwOnError: true }),
        nextDocument => {
          boundPathRef.current = packagePath
          boundDocumentRef.current = nextDocument
          documentRef.current = nextDocument
          documentPathRef.current = packagePath
          if (packagePath)
            lifecycle.adopt(packagePath, { title: nextDocument.title })
          else {
            lifecycle.reset()
            persistAfterCommitRef.current = true
          }
          setDocument(nextDocument)
          setDocumentPath(packagePath)
          setSwitcherOpen(false)
          setStatus(
            packagePath
              ? `Opened ${ganttTitleFromPath(packagePath)}`
              : `Imported ${ganttTitleFromPath(path)} as a new draft.`,
          )
        },
        transitionError,
      )
    },
    [transitionError],
  )

  const lifecycle = useDocumentLifecycle({
    appSlug: GANTT_APP_SLUG,
    suffix: GANTT_PACKAGE_SUFFIX,
    kind: 'package',
    suggestedTitle: document.title,
    debounceMs: AUTOSAVE_DELAY_MS,
    onSaved: () => setStatus('Saved.'),
    // An agent or another app rewrote the open package on disk. Reload
    // unless the user has unsaved edits here.
    onExternalChange: ({ path, dirty }) => {
      if (dirty || path !== documentPathRef.current) return
      void openGanttPath(path, true)
    },
    serialize: () => {
      const current = boundDocumentRef.current
      return [
        {
          name: GANTT_MANIFEST_FILE,
          content: serializeGanttPackageManifest(
            createGanttPackageManifest(boundPathRef.current, current),
          ),
        },
        { name: GANTT_DOCUMENT_FILE, content: serializeGanttDocument(current) },
        { name: `${GANTT_EXPORTS_DIR}/.keep`, content: '' },
      ]
    },
  })
  lifecycleRef.current = lifecycle

  useEffect(() => {
    const path = viewportResource?.path?.trim()
    if (!ready || !path) return
    void openGanttPath(path).finally(onViewportResourceHandled)
  }, [ready, viewportResource, onViewportResourceHandled, openGanttPath])

  useEffect(() => {
    const path = lifecycle.doc.path
    if (!path || boundPathRef.current === path) return
    boundPathRef.current = path
    setDocumentPath(path)
  }, [lifecycle.doc.path])

  const updateDocument = useCallback((nextDocument: GanttDocument) => {
    transitions.current.cancel()
    setDocument(nextDocument)
    documentRef.current = nextDocument
    boundDocumentRef.current = nextDocument
    lifecycleRef.current!.markDirty()
    setStatus('Saving changes...')
  }, [])

  useEffect(() => {
    if (!persistAfterCommitRef.current) return
    persistAfterCommitRef.current = false
    lifecycleRef.current!.markDirty()
  }, [document])

  const saveDocument = useCallback(async (): Promise<string | null> => {
    boundDocumentRef.current = documentRef.current
    const lifecycle = lifecycleRef.current!
    const path = await lifecycle.ensureDraft()
    if (!path) return null
    try {
      await lifecycle.flush({ throwOnError: true })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return null
    }
    setStatus('Saved.')
    return path
  }, [])

  // Agent tool writes take the same path as UI edits, then wait until that
  // path is durable so the tool can return the artifact it changed.
  const applyAgentUpdate = useCallback(
    async (updater: (current: GanttDocument) => GanttDocument) => {
      updateDocument(updater(documentRef.current))
      const path = await saveDocument()
      if (!path) throw new Error('The timeline could not be saved.')
      return path
    },
    [saveDocument, updateDocument],
  )

  useGanttAgentTools(ready, {
    document,
    setDocument: applyAgentUpdate,
    documentPath,
    view: viewRef.current,
  })

  const commitTitle = useCallback((title: string) => {
    const trimmed = title.trim() || DEFAULT_GANTT_TITLE
    if (
      lifecycleRef.current!.doc.status === 'filed' &&
      trimmed !== lifecycleRef.current!.doc.title
    ) {
      void lifecycleRef.current!.rename(trimmed)
    }
  }, [])

  useDocumentHotkeys({
    onSave: () => void saveDocument(),
    onNew: createNewGantt,
    onOpen: () => setSwitcherOpen(true),
  })

  // Switcher snapshots: real bars from the real plan, drawn as an SVG page.
  const loadGanttPreview = useCallback(
    async (item: {
      path: string
      kind: 'package' | 'file'
    }): Promise<{ kind: 'html'; html: string; title?: string } | null> => {
      if (item.kind !== 'package') return null
      try {
        const parsed = parseGanttDocument(
          await readTextFile(ganttPackageContentPath(item.path)),
        )
        const html = ganttSnapshotHtml(parsed)
        return html ? { kind: 'html', html, title: parsed.title } : null
      } catch {
        return null
      }
    },
    [],
  )

  return (
    <AppFrame
      data-app={GANTT_APP_SLUG}
      identityAppSlug={GANTT_APP_SLUG}
      headerDocumentName={
        document.title?.trim() || (lifecycle.doc.path ? fileNameFromPath(lifecycle.doc.path) : undefined)
      }
      headerActions={
        <DocumentHeaderActions
          lifecycle={lifecycle}
          title={document.title || DEFAULT_GANTT_TITLE}
          onOpenSwitcher={() => setSwitcherOpen(true)}
        />
      }
    >
      <GanttWorkspace
        document={document}
        documentPath={documentPath}
        status={lifecycle.doc.error ?? error ?? status}
        error={lifecycle.doc.error ?? error}
        onChange={updateDocument}
        onCommitTitle={commitTitle}
        onNew={createNewGantt}
        onLoadSample={loadSample}
        viewRef={viewRef}
      />
      <DocumentSwitcher
        appSlug={GANTT_APP_SLUG}
        suffixes={[GANTT_PACKAGE_SUFFIX]}
        variant="modal"
        loadPreview={loadGanttPreview}
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        onOpenDocument={path => {
          setSwitcherOpen(false)
          void openGanttPath(path)
        }}
        onCreateNew={createNewGantt}
        newLabel="New timeline"
        title="Open a timeline"
        itemNoun="timeline"
      />
    </AppFrame>
  )
}
