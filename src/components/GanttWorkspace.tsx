import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  type PointerEvent,
  type UIEvent,
  type WheelEvent,
} from 'react'
import { openAgentDrawer } from '../bridge/platformBridge'
import {
  addDays,
  diffDays,
  formatDate,
  parseDate,
  todayDate,
} from '../lib/ganttDates'
import {
  addDependency as linkTasks,
  dependencyIds,
  findDependencyCycle,
  removeDependency as unlinkTasks,
  removeTask,
} from '../lib/ganttDependencies'
import { GANTT_SAMPLES } from '../lib/ganttSamples'
import { GANTT_VIEW_MODES } from '../constants'
import type {
  GanttDocument,
  GanttTask,
  GanttView,
  GanttViewControls,
  GanttViewMode,
} from '../types'
import './GanttWorkspace.css'

interface GanttWorkspaceProps {
  document: GanttDocument
  documentPath: string | null
  status: string
  error: string | null
  onChange: (document: GanttDocument) => void
  onCommitTitle: (title: string) => void
  onNew: () => void
  /** A sample opens as its own new draft — never over the open timeline. */
  onLoadSample: (document: GanttDocument) => void
  /** Assigned every render so the drawer's setView tool shares this state. */
  viewRef: RefObject<GanttViewControls | null>
}

type Density = 'compact' | 'comfortable'
type Zoom = 'fit' | 'detail' | 'wide'
type EditSurface = 'bar' | 'label'
type TimelineStyle = CSSProperties & Record<`--${string}`, string | number>
type DragMode = 'move' | 'resize-start' | 'resize-end'

interface ActiveDrag {
  taskId: string
  mode: DragMode
  originX: number
  originY: number
  initialVisibleIndex: number
  currentVisibleIndex: number
  initialStart: Date
  initialEnd: Date
  pointerId?: number
  moved: boolean
}

interface LinkDrag {
  sourceId: string
  startX: number
  startY: number
  currentX: number
  currentY: number
}

interface CanvasPan {
  originX: number
  originY: number
  scrollLeft: number
  scrollTop: number
}


const MIN_GESTURE_ZOOM = 0.5
const MAX_GESTURE_ZOOM = 2.5
const PHASE_KEYS = [
  'planning',
  'discovery',
  'build',
  'review',
  'launch',
  'strategy',
  'validation',
  'marketing',
  'editorial',
  'production',
  'writing',
  'approvals',
  'procurement',
  'construction',
  'infrastructure',
  'fitout',
] as const

type PhaseKey = (typeof PHASE_KEYS)[number]

function startOfWeek(date: Date): Date {
  const next = new Date(date)
  const day = next.getDay()
  next.setDate(next.getDate() - day)
  return next
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1)
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function endOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 11, 31)
}

function nextTaskId(tasks: GanttTask[]): string {
  let index = tasks.length + 1
  const ids = new Set(tasks.map(task => task.id))
  while (ids.has(`task-${index}`)) index += 1
  return `task-${index}`
}

function fileNameFromPath(path: string | null): string {
  if (!path) return 'Draft package'
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
}

function taskPhase(task: GanttTask): string {
  return (
    task.phase?.trim() || task.custom_class?.replace(/^task-/, '') || 'Work'
  )
}

function taskPhaseInputValue(task: GanttTask): string {
  return task.phase === undefined ? taskPhase(task) : task.phase
}

function phaseKey(phase: string): PhaseKey {
  const normalized = phase.trim().toLowerCase()
  if (normalized.includes('discover') || normalized.includes('research')) {
    return 'discovery'
  }
  if (
    normalized.includes('build') ||
    normalized.includes('develop') ||
    normalized.includes('prototype')
  ) {
    return 'build'
  }
  if (normalized.includes('review') || normalized.includes('inspect')) {
    return 'review'
  }
  if (normalized.includes('launch') || normalized.includes('release')) {
    return 'launch'
  }
  if (normalized.includes('strategy') || normalized.includes('market')) {
    return normalized.includes('market') ? 'marketing' : 'strategy'
  }
  if (normalized.includes('valid') || normalized.includes('test')) {
    return 'validation'
  }
  if (normalized.includes('edit')) return 'editorial'
  if (normalized.includes('prod')) return 'production'
  if (normalized.includes('writ')) return 'writing'
  if (normalized.includes('approv') || normalized.includes('permit')) {
    return 'approvals'
  }
  if (normalized.includes('procure')) return 'procurement'
  if (normalized.includes('construct') || normalized.includes('site')) {
    return 'construction'
  }
  if (normalized.includes('infra') || normalized.includes('utilit')) {
    return 'infrastructure'
  }
  if (normalized.includes('fit')) return 'fitout'

  let hash = 0
  for (const char of phase) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PHASE_KEYS[hash % PHASE_KEYS.length]
}

function phaseColor(phase: string, tone: 'fill' | 'edge' = 'fill'): string {
  return `var(--gantt-phase-${phaseKey(phase)}-${tone})`
}

function clampGestureZoom(value: number): number {
  return Math.max(MIN_GESTURE_ZOOM, Math.min(MAX_GESTURE_ZOOM, value))
}

function scaleFor(
  viewMode: GanttViewMode,
  zoom: Zoom,
  gestureZoom: number,
): number {
  const base =
    viewMode === 'Day'
      ? 34
      : viewMode === 'Week'
      ? 18
      : viewMode === 'Month'
      ? 10
      : 4
  const presetScale =
    zoom === 'fit' ? base : zoom === 'detail' ? base * 1.35 : base * 0.72
  return presetScale * gestureZoom
}

function tickStepFor(viewMode: GanttViewMode): number {
  if (viewMode === 'Day') return 1
  if (viewMode === 'Week') return 7
  if (viewMode === 'Month') return 14
  return 30
}

function tickLabel(date: Date, viewMode: GanttViewMode): string {
  if (viewMode === 'Day') {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
  if (viewMode === 'Week') {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
  if (viewMode === 'Month') {
    return date.toLocaleDateString([], { month: 'short' })
  }
  return date.toLocaleDateString([], { month: 'short', year: 'numeric' })
}

function defaultTaskDuration(viewMode: GanttViewMode): number {
  if (viewMode === 'Day') return 1
  if (viewMode === 'Week') return 5
  if (viewMode === 'Month') return 10
  return 30
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  )
}

function insertTaskAtVisibleIndex(
  tasks: GanttTask[],
  visibleTasks: GanttTask[],
  task: GanttTask,
  targetVisibleIndex: number,
): GanttTask[] {
  if (!visibleTasks.length) return [...tasks, task]
  const boundedTargetIndex = Math.max(
    0,
    Math.min(visibleTasks.length, targetVisibleIndex),
  )

  if (boundedTargetIndex >= visibleTasks.length) {
    const lastVisibleTask = visibleTasks[visibleTasks.length - 1]
    const lastVisibleIndex = tasks.findIndex(
      item => item.id === lastVisibleTask.id,
    )
    const nextTasks = [...tasks]
    nextTasks.splice(lastVisibleIndex + 1, 0, task)
    return nextTasks
  }

  const targetTask = visibleTasks[boundedTargetIndex]
  const targetTaskIndex = tasks.findIndex(item => item.id === targetTask.id)
  const nextTasks = [...tasks]
  nextTasks.splice(Math.max(0, targetTaskIndex), 0, task)
  return nextTasks
}

function swapTaskWithVisibleIndex(
  tasks: GanttTask[],
  visibleTasks: GanttTask[],
  taskId: string,
  targetVisibleIndex: number,
): GanttTask[] {
  const boundedTargetIndex = Math.max(
    0,
    Math.min(visibleTasks.length - 1, targetVisibleIndex),
  )
  const targetTask = visibleTasks[boundedTargetIndex]
  if (!targetTask || targetTask.id === taskId) return tasks

  const sourceIndex = tasks.findIndex(task => task.id === taskId)
  const targetIndex = tasks.findIndex(task => task.id === targetTask.id)
  if (sourceIndex === -1 || targetIndex === -1) return tasks

  const nextTasks = [...tasks]
  nextTasks[sourceIndex] = tasks[targetIndex]
  nextTasks[targetIndex] = tasks[sourceIndex]
  return nextTasks
}

export function GanttWorkspace({
  document,
  documentPath,
  status,
  error,
  onChange,
  onCommitTitle,
  onNew,
  onLoadSample,
  viewRef,
}: GanttWorkspaceProps): React.ReactElement {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  // A refused edit (a dependency loop) explained in the footer until the
  // next change.
  const [notice, setNotice] = useState<string | null>(null)
  const [progressTaskId, setProgressTaskId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [phaseFilter, setPhaseFilter] = useState('all')
  const [density, setDensity] = useState<Density>('comfortable')
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [gestureZoom, setGestureZoom] = useState(1)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTaskName, setEditingTaskName] = useState('')
  const [editingSurface, setEditingSurface] = useState<EditSurface>('bar')
  const [showDependencies, setShowDependencies] = useState(true)
  const [showWeekends, setShowWeekends] = useState(true)
  const [showOwners, setShowOwners] = useState(true)
  const [selectedDependencyKey, setSelectedDependencyKey] = useState<
    string | null
  >(null)
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null)
  const [linkTargetTaskId, setLinkTargetTaskId] = useState<string | null>(null)
  const [isCanvasPanning, setIsCanvasPanning] = useState(false)
  const activeDragRef = useRef<ActiveDrag | null>(null)
  const canvasPanRef = useRef<CanvasPan | null>(null)
  const documentRef = useRef(document)
  const selectedNameInputRef = useRef<HTMLInputElement | null>(null)
  const inlineNameInputRef = useRef<HTMLInputElement | null>(null)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const timelineBodyRef = useRef<HTMLDivElement | null>(null)
  const taskLabelsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    documentRef.current = document
  }, [document])

  const syncTaskLabelScroll = (scrollTop: number): void => {
    if (!taskLabelsRef.current) return
    taskLabelsRef.current.style.transform = `translateY(${-scrollTop}px)`
  }

  const handleTimelineScroll = (
    event: UIEvent<HTMLDivElement>,
  ): void => {
    syncTaskLabelScroll(event.currentTarget.scrollTop)
  }

  const handleTaskLabelsWheel = (
    event: WheelEvent<HTMLDivElement>,
  ): void => {
    const scrollTarget = timelineScrollRef.current
    if (!scrollTarget || event.deltaY === 0) return
    event.preventDefault()
    scrollTarget.scrollTop += event.deltaY
    syncTaskLabelScroll(scrollTarget.scrollTop)
  }

  const selectedTask = document.tasks.find(task => task.id === selectedTaskId)
  const taskCount = document.tasks.length
  const completedCount = document.tasks.filter(
    task => task.progress >= 100,
  ).length
  const averageProgress =
    taskCount === 0
      ? 0
      : Math.round(
          document.tasks.reduce((sum, task) => sum + task.progress, 0) /
            taskCount,
        )

  const phases = useMemo(() => {
    const seen = new Set<string>()
    return [...(document.phases ?? []), ...document.tasks.map(taskPhase)]
      .map(phase => phase.trim())
      .filter(phase => {
        if (!phase) return false
        const key = phase.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort()
  }, [document.phases, document.tasks])
  const owners = useMemo(() => {
    const seen = new Set<string>()
    return document.tasks
      .map(task => task.owner?.trim() ?? '')
      .filter(owner => {
        if (!owner) return false
        const key = owner.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort()
  }, [document.tasks])
  const phaseListId = useId()
  const ownerListId = useId()

  const dependencyCount = useMemo(
    () =>
      document.tasks.reduce((sum, task) => sum + dependencyIds(task).length, 0),
    [document.tasks],
  )

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return document.tasks.filter(task => {
      if (phaseFilter !== 'all' && taskPhase(task) !== phaseFilter) return false
      if (!needle) return true
      return [task.name, task.id, task.owner, taskPhase(task)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [document.tasks, phaseFilter, query])
  const filteredTasksRef = useRef(filteredTasks)

  useEffect(() => {
    filteredTasksRef.current = filteredTasks
  }, [filteredTasks])


  const timeline = useMemo(() => {
    const source = document.tasks.length ? document.tasks : []
    const starts = source.map(task => parseDate(task.start))
    const ends = source.map(task => parseDate(task.end))
    const min =
      starts.length > 0
        ? new Date(Math.min(...starts.map(date => date.getTime())))
        : parseDate(todayDate())
    const max =
      ends.length > 0
        ? new Date(Math.max(...ends.map(date => date.getTime())))
        : addDays(min, 30)
    const start =
      document.viewMode === 'Day'
        ? startOfWeek(min)
        : document.viewMode === 'Year'
        ? startOfYear(min)
        : startOfMonth(min)
    const end =
      document.viewMode === 'Year'
        ? endOfYear(max)
        : document.viewMode === 'Day'
        ? addDays(max, 7)
        : endOfMonth(max)
    const days = Math.max(1, diffDays(start, end) + 1)
    const scale = scaleFor(document.viewMode, zoom, gestureZoom)
    const rowHeight = density === 'compact' ? 36 : 48
    const labelWidth = 260
    const chartWidth = Math.max(days * scale, 720)
    const bodyHeight = Math.max(filteredTasks.length * rowHeight, 240)
    const tickStep = tickStepFor(document.viewMode)
    const ticks = []
    for (let offset = 0; offset <= days; offset += tickStep) {
      const date = addDays(start, offset)
      ticks.push({ offset, date, label: tickLabel(date, document.viewMode) })
    }
    const weekends = []
    for (let offset = 0; offset < days; offset += 1) {
      const date = addDays(start, offset)
      if (date.getDay() === 0 || date.getDay() === 6) weekends.push(offset)
    }
    const todayOffset = diffDays(start, parseDate(todayDate()))
    return {
      start,
      days,
      scale,
      rowHeight,
      labelWidth,
      chartWidth,
      bodyHeight,
      ticks,
      weekends,
      todayOffset,
    }
  }, [
    density,
    document.tasks,
    document.viewMode,
    filteredTasks.length,
    gestureZoom,
    zoom,
  ])

  const visibleTaskMap = useMemo(
    () =>
      new Map(filteredTasks.map((task, index) => [task.id, { task, index }])),
    [filteredTasks],
  )

  const dependencyLines = useMemo(() => {
    if (!showDependencies) return []
    return filteredTasks.flatMap((target, targetIndex) =>
      dependencyIds(target).flatMap(sourceId => {
        const source = visibleTaskMap.get(sourceId)
        if (!source) return []
        const sourceEnd = diffDays(timeline.start, parseDate(source.task.end))
        const targetStart = diffDays(timeline.start, parseDate(target.start))
        const y1 = source.index * timeline.rowHeight + timeline.rowHeight / 2
        const y2 = targetIndex * timeline.rowHeight + timeline.rowHeight / 2
        const x1 = Math.max(0, sourceEnd * timeline.scale)
        const x2 = Math.max(0, targetStart * timeline.scale)
        const mid = Math.max(x1 + 16, x2 - 16)
        return [
          {
            key: `${sourceId}->${target.id}`,
            sourceId,
            targetId: target.id,
            points: `${x1},${y1} ${mid},${y1} ${mid},${y2} ${x2},${y2}`,
          },
        ]
      }),
    )
  }, [filteredTasks, showDependencies, timeline, visibleTaskMap])

  const updateDocument = (patch: Partial<GanttDocument>): void => {
    const nextDocument = {
      ...documentRef.current,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    documentRef.current = nextDocument
    setNotice(null)
    onChange(nextDocument)
  }

  const cycleNotice = (cycle: string[]): string =>
    `Not linked: ${cycle.join(' → ')} would wait on each other in a loop.`

  const createPhase = (): void => {
    const rawName = window.prompt('New phase name')
    const phaseName = rawName?.trim()
    if (!phaseName) return

    const existingPhase = phases.find(
      phase => phase.toLowerCase() === phaseName.toLowerCase(),
    )
    if (existingPhase) {
      setPhaseFilter(existingPhase)
      return
    }

    updateDocument({
      phases: [...(documentRef.current.phases ?? []), phaseName],
    })
    setPhaseFilter(phaseName)
  }

  const updateTask = (taskId: string, patch: Partial<GanttTask>): void => {
    updateDocument({
      tasks: documentRef.current.tasks.map(task =>
        task.id === taskId ? { ...task, ...patch } : task,
      ),
    })
  }

  const beginTaskNameEdit = (
    task: GanttTask,
    surface: EditSurface = 'bar',
  ): void => {
    setSelectedTaskId(task.id)
    setProgressTaskId(task.id)
    setEditingTaskId(task.id)
    setEditingTaskName(task.name)
    setEditingSurface(surface)
  }

  const commitTaskNameEdit = (): void => {
    if (!editingTaskId) return
    const currentTask = documentRef.current.tasks.find(
      task => task.id === editingTaskId,
    )
    const nextName = editingTaskName.trim() || currentTask?.name || 'Untitled task'
    updateTask(editingTaskId, { name: nextName })
    setEditingTaskId(null)
    setEditingTaskName('')
  }

  const cancelTaskNameEdit = (): void => {
    setEditingTaskId(null)
    setEditingTaskName('')
  }

  useEffect(() => {
    if (!editingTaskId) return
    inlineNameInputRef.current?.focus()
    inlineNameInputRef.current?.select()
  }, [editingTaskId])

  const applyTaskDrag = (
    drag: ActiveDrag,
    clientX: number,
    clientY: number,
  ): void => {
    const deltaDays = Math.round((clientX - drag.originX) / timeline.scale)
    const deltaRows =
      drag.mode === 'move'
        ? Math.round((clientY - drag.originY) / timeline.rowHeight)
        : 0
    const targetVisibleIndex = Math.max(
      0,
      Math.min(
        filteredTasksRef.current.length - 1,
        drag.initialVisibleIndex + deltaRows,
      ),
    )
    const changedRows =
      drag.mode === 'move' && targetVisibleIndex !== drag.currentVisibleIndex
    if (deltaDays === 0 && !changedRows && !drag.moved) return
    drag.moved = true

    if (drag.mode === 'move') {
      const patchedTasks = documentRef.current.tasks.map(task =>
        task.id === drag.taskId
          ? {
              ...task,
              start: formatDate(addDays(drag.initialStart, deltaDays)),
              end: formatDate(addDays(drag.initialEnd, deltaDays)),
            }
          : task,
      )
      const nextTasks = changedRows
        ? swapTaskWithVisibleIndex(
            patchedTasks,
            filteredTasksRef.current,
            drag.taskId,
            targetVisibleIndex,
          )
        : patchedTasks
      drag.currentVisibleIndex = targetVisibleIndex
      updateDocument({ tasks: nextTasks })
      return
    }

    if (drag.mode === 'resize-start') {
      const nextStart = addDays(drag.initialStart, deltaDays)
      const boundedStart =
        nextStart.getTime() > drag.initialEnd.getTime()
          ? drag.initialEnd
          : nextStart
      updateTask(drag.taskId, { start: formatDate(boundedStart) })
      return
    }

    const nextEnd = addDays(drag.initialEnd, deltaDays)
    const boundedEnd =
      nextEnd.getTime() < drag.initialStart.getTime()
        ? drag.initialStart
        : nextEnd
    updateTask(drag.taskId, { end: formatDate(boundedEnd) })
  }

  const windowMouseMove = (event: globalThis.MouseEvent): void => {
    const drag = activeDragRef.current
    if (!drag) return
    event.preventDefault()
    applyTaskDrag(drag, event.clientX, event.clientY)
  }

  const windowMouseUp = (): void => {
    activeDragRef.current = null
    window.removeEventListener('mousemove', windowMouseMove)
    window.removeEventListener('mouseup', windowMouseUp)
  }

  const startTaskDrag = (
    task: GanttTask,
    mode: DragMode,
    event: PointerEvent<HTMLElement>,
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    setSelectedTaskId(task.id)
    setProgressTaskId(task.id)
    const visibleIndex = Math.max(
      0,
      filteredTasksRef.current.findIndex(item => item.id === task.id),
    )
    const captureTarget =
      event.currentTarget.closest<HTMLElement>('.gantt-task-bar') ??
      event.currentTarget
    captureTarget.focus()
    captureTarget.setPointerCapture(event.pointerId)
    activeDragRef.current = {
      taskId: task.id,
      mode,
      originX: event.clientX,
      originY: event.clientY,
      initialVisibleIndex: visibleIndex,
      currentVisibleIndex: visibleIndex,
      initialStart: parseDate(task.start),
      initialEnd: parseDate(task.end),
      pointerId: event.pointerId,
      moved: false,
    }
  }

  const dragModeFromPoint = (
    target: HTMLElement,
    clientX: number,
    task: GanttTask,
    forceResizeEnd = false,
  ): DragMode => {
    if (forceResizeEnd) return 'resize-end'
    if (task.milestone) return 'move'
    const rect = target.getBoundingClientRect()
    const edgeSize = Math.min(22, rect.width / 3)
    if (clientX - rect.left <= edgeSize) return 'resize-start'
    if (rect.right - clientX <= edgeSize) return 'resize-end'
    return 'move'
  }

  const moveTaskDrag = (event: PointerEvent<HTMLElement>): void => {
    const drag = activeDragRef.current
    if (!drag) return
    event.preventDefault()
    applyTaskDrag(drag, event.clientX, event.clientY)
  }

  const endTaskDrag = (event: PointerEvent<HTMLElement>): void => {
    const drag = activeDragRef.current
    if (!drag) return
    if (
      drag.pointerId !== undefined &&
      event.currentTarget.hasPointerCapture(drag.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(drag.pointerId)
    }
    activeDragRef.current = null
  }

  const startTaskMouseDrag = (
    task: GanttTask,
    mode: DragMode,
    event: MouseEvent<HTMLElement>,
  ): void => {
    if (activeDragRef.current) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedTaskId(task.id)
    setProgressTaskId(task.id)
    const visibleIndex = Math.max(
      0,
      filteredTasksRef.current.findIndex(item => item.id === task.id),
    )
    event.currentTarget.focus()
    activeDragRef.current = {
      taskId: task.id,
      mode,
      originX: event.clientX,
      originY: event.clientY,
      initialVisibleIndex: visibleIndex,
      currentVisibleIndex: visibleIndex,
      initialStart: parseDate(task.start),
      initialEnd: parseDate(task.end),
      moved: false,
    }
    window.addEventListener('mousemove', windowMouseMove)
    window.addEventListener('mouseup', windowMouseUp)
  }

  const nudgeTask = (
    task: GanttTask,
    days: number,
    mode: 'move' | 'resize-end',
  ): void => {
    if (mode === 'resize-end') {
      const nextEnd = addDays(parseDate(task.end), days)
      const boundedEnd =
        nextEnd.getTime() < parseDate(task.start).getTime()
          ? parseDate(task.start)
          : nextEnd
      updateTask(task.id, { end: formatDate(boundedEnd) })
      return
    }
    updateTask(task.id, {
      start: formatDate(addDays(parseDate(task.start), days)),
      end: formatDate(addDays(parseDate(task.end), days)),
    })
  }

  const handleTaskKeyDown = (
    task: GanttTask,
    event: KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    nudgeTask(task, direction, event.shiftKey ? 'resize-end' : 'move')
  }

  const loadSample = (key: string): void => {
    const sample = GANTT_SAMPLES.find(item => item.key === key)
    if (!sample) return
    setSelectedTaskId(null)
    setProgressTaskId(null)
    setSelectedDependencyKey(null)
    setEditingTaskId(null)
    setPhaseFilter('all')
    setQuery('')
    setNotice(null)
    onLoadSample({
      ...sample.document,
      phases: [...(sample.document.phases ?? [])],
      tasks: sample.document.tasks.map(task => ({ ...task })),
    })
  }

  const addTask = (name = 'New task'): void => {
    const id = nextTaskId(document.tasks)
    const start = selectedTask?.end ?? todayDate()
    const task: GanttTask = {
      id,
      name,
      start,
      end: start,
      progress: 0,
      dependencies: selectedTask?.id,
      custom_class: 'task-build',
      phase: selectedTask ? taskPhase(selectedTask) : 'Planning',
      owner: selectedTask?.owner ?? '',
    }
    setSelectedTaskId(id)
    setProgressTaskId(id)
    setSelectedDependencyKey(null)
    setEditingTaskId(id)
    setEditingTaskName(name)
    setEditingSurface('bar')
    updateDocument({ tasks: [...document.tasks, task] })
  }

  const addTaskAtChartPoint = (
    clientX: number,
    clientY: number,
    target: HTMLDivElement,
  ): void => {
    const rect = target.getBoundingClientRect()
    const chartX = Math.max(0, clientX - rect.left)
    const chartY = Math.max(0, clientY - rect.top)
    const startOffset = Math.max(
      0,
      Math.min(timeline.days - 1, Math.floor(chartX / timeline.scale)),
    )
    const rowIndex = Math.max(0, Math.floor(chartY / timeline.rowHeight))
    const start = formatDate(addDays(timeline.start, startOffset))
    const end = formatDate(
      addDays(parseDate(start), defaultTaskDuration(document.viewMode) - 1),
    )
    const id = nextTaskId(documentRef.current.tasks)
    const inheritedPhase =
      phaseFilter !== 'all'
        ? phaseFilter
        : selectedTask
        ? taskPhase(selectedTask)
        : 'Planning'
    const task: GanttTask = {
      id,
      name: `New task ${documentRef.current.tasks.length + 1}`,
      start,
      end,
      progress: 0,
      dependencies: selectedTask?.id,
      custom_class: 'task-build',
      phase: inheritedPhase,
      owner: selectedTask?.owner ?? '',
    }
    setQuery('')
    setSelectedTaskId(id)
    setProgressTaskId(id)
    setSelectedDependencyKey(null)
    setEditingTaskId(id)
    setEditingTaskName(task.name)
    setEditingSurface('bar')
    updateDocument({
      tasks: insertTaskAtVisibleIndex(
        documentRef.current.tasks,
        filteredTasksRef.current,
        task,
        rowIndex,
      ),
    })
  }

  // The drawer's setView tool and the sidebar controls share this state.
  viewRef.current = {
    get: (): GanttView => ({
      phaseFilter,
      density,
      zoom,
      showDependencies,
      showWeekends,
      showOwners,
    }),
    set: (patch: Partial<GanttView>) => {
      if (patch.phaseFilter !== undefined) setPhaseFilter(patch.phaseFilter)
      if (patch.density !== undefined) setDensity(patch.density)
      if (patch.zoom !== undefined) {
        setZoom(patch.zoom)
        setGestureZoom(1)
      }
      if (patch.showDependencies !== undefined)
        setShowDependencies(patch.showDependencies)
      if (patch.showWeekends !== undefined) setShowWeekends(patch.showWeekends)
      if (patch.showOwners !== undefined) setShowOwners(patch.showOwners)
    },
    phases: () => phases,
  }

  const handleTimelineBodyClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('.gantt-task-bar')
    ) {
      return
    }
    setSelectedDependencyKey(null)
    setProgressTaskId(null)
  }

  const handleTimelineBodyDoubleClick = (
    event: MouseEvent<HTMLDivElement>,
  ): void => {
    if (event.target !== event.currentTarget) return
    setSelectedDependencyKey(null)
    addTaskAtChartPoint(event.clientX, event.clientY, event.currentTarget)
  }

  const startCanvasPan = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || event.button !== 0) return
    const scrollTarget = timelineScrollRef.current
    if (!scrollTarget) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    canvasPanRef.current = {
      originX: event.clientX,
      originY: event.clientY,
      scrollLeft: scrollTarget.scrollLeft,
      scrollTop: scrollTarget.scrollTop,
    }
    setIsCanvasPanning(true)
  }

  const moveCanvasPan = (event: PointerEvent<HTMLDivElement>): void => {
    const pan = canvasPanRef.current
    const scrollTarget = timelineScrollRef.current
    if (!pan || !scrollTarget) return
    event.preventDefault()
    scrollTarget.scrollLeft = pan.scrollLeft - (event.clientX - pan.originX)
    scrollTarget.scrollTop = pan.scrollTop - (event.clientY - pan.originY)
  }

  const endCanvasPan = (event: PointerEvent<HTMLDivElement>): void => {
    if (!canvasPanRef.current) return
    event.preventDefault()
    canvasPanRef.current = null
    setIsCanvasPanning(false)
  }

  const chartPointFromClient = (clientX: number, clientY: number) => {
    const body = timelineBodyRef.current
    if (!body) return null
    const rect = body.getBoundingClientRect()
    return {
      x: Math.max(0, clientX - rect.left),
      y: Math.max(0, clientY - rect.top),
    }
  }

  const linkTargetFromPoint = (
    clientX: number,
    clientY: number,
    sourceId: string,
  ): string | null => {
    const target = globalThis.document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('.gantt-task-bar')
    const targetId = target?.dataset.taskId ?? null
    return targetId && targetId !== sourceId ? targetId : null
  }

  const startLinkDrag = (
    sourceId: string,
    event: PointerEvent<HTMLButtonElement>,
  ): void => {
    const start = chartPointFromClient(event.clientX, event.clientY)
    if (!start) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedTaskId(sourceId)
    setSelectedDependencyKey(null)
    setLinkTargetTaskId(null)
    setLinkDrag({
      sourceId,
      startX: start.x,
      startY: start.y,
      currentX: start.x,
      currentY: start.y,
    })
  }

  const moveLinkDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!linkDrag) return
    const point = chartPointFromClient(event.clientX, event.clientY)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    setLinkTargetTaskId(
      linkTargetFromPoint(event.clientX, event.clientY, linkDrag.sourceId),
    )
    setLinkDrag({ ...linkDrag, currentX: point.x, currentY: point.y })
  }

  const endLinkDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!linkDrag) return
    event.preventDefault()
    event.stopPropagation()
    const targetId =
      linkTargetTaskId ??
      linkTargetFromPoint(event.clientX, event.clientY, linkDrag.sourceId)
    if (targetId) addDependency(linkDrag.sourceId, targetId)
    setLinkDrag(null)
    setLinkTargetTaskId(null)
  }

  const removeDependency = (sourceId: string, targetId: string): void => {
    updateDocument({
      tasks: unlinkTasks(documentRef.current.tasks, sourceId, targetId),
    })
  }

  const addDependency = (sourceId: string, targetId: string): void => {
    if (sourceId === targetId) return
    const tasks = documentRef.current.tasks
    const target = tasks.find(task => task.id === targetId)
    if (!target) return
    if (dependencyIds(target).includes(sourceId)) {
      setSelectedTaskId(null)
      setProgressTaskId(null)
      setSelectedDependencyKey(`${sourceId}->${targetId}`)
      return
    }
    const nextTasks = linkTasks(tasks, sourceId, targetId)
    if (nextTasks === tasks) {
      const cycle = findDependencyCycle([
        ...tasks.filter(task => task.id !== targetId),
        { ...target, dependencies: [...dependencyIds(target), sourceId].join(', ') },
      ])
      setNotice(
        cycle
          ? cycleNotice(cycle)
          : 'Not linked: one of the tasks no longer exists.',
      )
      return
    }
    updateDocument({ tasks: nextTasks })
    setSelectedTaskId(null)
    setProgressTaskId(null)
    setSelectedDependencyKey(`${sourceId}->${targetId}`)
  }

  const editDependencies = (taskId: string, value: string): void => {
    const nextTasks = documentRef.current.tasks.map(task =>
      task.id === taskId ? { ...task, dependencies: value } : task,
    )
    const cycle = findDependencyCycle(nextTasks)
    if (cycle) {
      setNotice(cycleNotice(cycle))
      return
    }
    updateDocument({ tasks: nextTasks })
  }

  const deleteSelectedDependency = (): void => {
    if (!selectedDependencyKey) return
    const [sourceId, targetId] = selectedDependencyKey.split('->')
    if (!sourceId || !targetId) return
    setSelectedDependencyKey(null)
    removeDependency(sourceId, targetId)
  }

  const deleteTask = (taskId: string): void => {
    setSelectedTaskId(currentTaskId =>
      currentTaskId === taskId ? null : currentTaskId,
    )
    setProgressTaskId(currentTaskId =>
      currentTaskId === taskId ? null : currentTaskId,
    )
    setSelectedDependencyKey(currentKey => {
      if (!currentKey) return currentKey
      const [sourceId, targetId] = currentKey.split('->')
      return sourceId === taskId || targetId === taskId ? null : currentKey
    })
    updateDocument({ tasks: removeTask(documentRef.current.tasks, taskId) })
  }

  const deleteSelected = (): void => {
    if (selectedDependencyKey) {
      deleteSelectedDependency()
      return
    }
    if (!selectedTaskId) return
    deleteTask(selectedTaskId)
  }

  useEffect(() => {
    const scrollTarget = timelineScrollRef.current
    if (!scrollTarget) return undefined

    const handleWheel = (event: globalThis.WheelEvent): void => {
      const isZoomGesture = event.ctrlKey || event.metaKey || event.altKey
      if (!isZoomGesture) return

      event.preventDefault()
      event.stopPropagation()

      const rect = scrollTarget.getBoundingClientRect()
      const localX = event.clientX - rect.left - timeline.labelWidth
      const chartX = Math.max(0, scrollTarget.scrollLeft + localX)
      const zoomDelta = Math.exp(-event.deltaY * 0.002)
      const nextGestureZoom = clampGestureZoom(gestureZoom * zoomDelta)
      if (nextGestureZoom === gestureZoom) return

      const ratio = nextGestureZoom / gestureZoom
      setGestureZoom(nextGestureZoom)
      window.requestAnimationFrame(() => {
        scrollTarget.scrollLeft = Math.max(0, chartX * ratio - localX)
      })
    }

    scrollTarget.addEventListener('wheel', handleWheel, { passive: false })
    return () => scrollTarget.removeEventListener('wheel', handleWheel)
  }, [gestureZoom, timeline.labelWidth])

  useEffect(() => {
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return
      // ⌘N / ⌘S / ⌘O belong to the document hotkeys; a bare "n" adds a task,
      // a modified one must not also add one to the timeline being left.
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'Escape') {
        setSelectedTaskId(null)
        setProgressTaskId(null)
        setSelectedDependencyKey(null)
        setLinkDrag(null)
        setLinkTargetTaskId(null)
        return
      }

      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault()
        addTask()
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelected()
        return
      }

      if (!selectedTask) return

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        nudgeTask(
          selectedTask,
          event.key === 'ArrowLeft' ? -1 : 1,
          event.shiftKey ? 'resize-end' : 'move',
        )
        return
      }

      if (event.key === 'e' || event.key === 'E') {
        event.preventDefault()
        beginTaskNameEdit(selectedTask)
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  })

  return (
    <main className="gantt-shell" data-app="gantt">
      <aside
        className="gantt-sidebar"
        data-chrome="sidebar"
        aria-label="Timeline controls"
      >
        <section className="gantt-title-block">
          <input
            aria-label="Timeline title"
            className="gantt-title-input"
            value={document.title}
            onBlur={() => onCommitTitle(document.title)}
            onChange={event => updateDocument({ title: event.target.value })}
          />
          <div className="gantt-path" data-chrome="meta">
            {fileNameFromPath(documentPath)}
          </div>
        </section>

        <section className="gantt-stats" aria-label="Overview">
          <div>
            <strong>{taskCount}</strong>
            <span data-chrome="section-label">tasks</span>
          </div>
          <div>
            <strong>{dependencyCount}</strong>
            <span data-chrome="section-label">links</span>
          </div>
          <div>
            <strong>{averageProgress}%</strong>
            <span data-chrome="section-label">done</span>
          </div>
        </section>

        {GANTT_SAMPLES.length > 0 && <section className="gantt-control-group gantt-sample-group">
          <label htmlFor="sample-select" data-chrome="section-label">
            Project samples
          </label>
          <div className="gantt-row">
            <select
              id="sample-select"
              value=""
              aria-label="Open a sample plan as a new draft"
              onChange={event => loadSample(event.target.value)}
            >
              <option value="" disabled>
                Open sample as new draft
              </option>
              {GANTT_SAMPLES.map(sample => (
                <option key={sample.key} value={sample.key}>
                  {sample.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={onNew}>
              New
            </button>
          </div>
        </section>}

        <section className="gantt-control-group gantt-compact-grid">
          <label htmlFor="view-select" data-chrome="section-label">
            View
          </label>
          <label htmlFor="task-search" data-chrome="section-label">
            Find
          </label>
          <select
            id="view-select"
            value={document.viewMode}
            onChange={event =>
              updateDocument({
                viewMode: event.target.value as GanttViewMode,
              })
            }
          >
            {GANTT_VIEW_MODES.map(mode => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
          <input
            id="task-search"
            value={query}
            placeholder="Task, owner, phase"
            onChange={event => setQuery(event.target.value)}
          />
          <select
            aria-label="Zoom"
            value={zoom}
            onChange={event => {
              setZoom(event.target.value as Zoom)
              setGestureZoom(1)
            }}
          >
            <option value="fit">Fit</option>
            <option value="detail">Detail</option>
            <option value="wide">Wide</option>
          </select>
          <div className="gantt-phase-filter-row">
            <select
              aria-label="Phase filter"
              value={phaseFilter}
              onChange={event => setPhaseFilter(event.target.value)}
            >
              <option value="all">All phases</option>
              {phases.map(phase => (
                <option key={phase} value={phase}>
                  {phase}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="gantt-button-secondary gantt-phase-new"
              onClick={createPhase}
            >
              New phase
            </button>
          </div>
        </section>

        <section className="gantt-control-group gantt-display-row">
          <div
            className="gantt-segmented gantt-density-toggle"
            role="group"
            aria-label="Density"
          >
            <button
              type="button"
              className={density === 'compact' ? 'is-active' : ''}
              onClick={() => setDensity('compact')}
            >
              Compact
            </button>
            <button
              type="button"
              className={density === 'comfortable' ? 'is-active' : ''}
              onClick={() => setDensity('comfortable')}
            >
              Roomy
            </button>
          </div>
          <div className="gantt-check-row">
            <label className="gantt-check">
              <input
                type="checkbox"
                checked={showDependencies}
                onChange={event => setShowDependencies(event.target.checked)}
              />
              Links
            </label>
            <label className="gantt-check">
              <input
                type="checkbox"
                checked={showWeekends}
                onChange={event => setShowWeekends(event.target.checked)}
              />
              Weekends
            </label>
            <label className="gantt-check">
              <input
                type="checkbox"
                checked={showOwners}
                onChange={event => setShowOwners(event.target.checked)}
              />
              Owners
            </label>
          </div>
        </section>

        <section className="gantt-control-group">
          <div className="gantt-button-grid">
            <button
              type="button"
              className="gantt-button-primary"
              onClick={() => addTask()}
            >
              Add task
            </button>
            <button
              type="button"
              className="gantt-button-danger"
              disabled={!selectedTask && !selectedDependencyKey}
              onClick={deleteSelected}
            >
              Delete
            </button>
          </div>
        </section>

        <details className="gantt-control-group gantt-selected-details">
          <summary>
            <span className="gantt-selected-kicker">Selected</span>
            {selectedTask ? <strong>{selectedTask.name}</strong> : null}
            <span className="gantt-selected-chevron" aria-hidden="true" />
          </summary>
          {selectedTask ? (
            <div className="gantt-selected">
              <label>
                Name
                <input
                  ref={selectedNameInputRef}
                  value={selectedTask.name}
                  onChange={event =>
                    updateTask(selectedTask.id, { name: event.target.value })
                  }
                />
              </label>
              <div className="gantt-two-column">
                <label>
                  Start
                  <input
                    type="date"
                    value={selectedTask.start}
                    onChange={event =>
                      updateTask(selectedTask.id, { start: event.target.value })
                    }
                  />
                </label>
                <label>
                  End
                  <input
                    type="date"
                    value={selectedTask.end}
                    onChange={event =>
                      updateTask(selectedTask.id, { end: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="gantt-two-column">
                <label>
                  Phase
                  <input
                    value={taskPhase(selectedTask)}
                    onChange={event =>
                      updateTask(selectedTask.id, { phase: event.target.value })
                    }
                  />
                </label>
                <label>
                  Owner
                  <input
                    list={ownerListId}
                    value={selectedTask.owner ?? ''}
                    onChange={event =>
                      updateTask(selectedTask.id, { owner: event.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                Progress
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={selectedTask.progress}
                  onChange={event =>
                    updateTask(selectedTask.id, {
                      progress: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Dependencies
                <input
                  value={selectedTask.dependencies ?? ''}
                  placeholder="task-id, other-id"
                  onChange={event =>
                    editDependencies(selectedTask.id, event.target.value)
                  }
                />
              </label>
              <label className="gantt-check">
                <input
                  type="checkbox"
                  checked={selectedTask.milestone === true}
                  onChange={event =>
                    updateTask(selectedTask.id, {
                      milestone: event.target.checked,
                    })
                  }
                />
                Milestone
              </label>
            </div>
          ) : (
            <p className="gantt-muted">Select a task on the timeline.</p>
          )}
        </details>

        <footer className="gantt-status" data-chrome="meta">
          <span>{error ?? notice ?? status}</span>
          <span>{completedCount} complete</span>
        </footer>
      </aside>

      <section className="gantt-canvas" aria-label="Gantt timeline">
        <datalist id={phaseListId}>
          {phases.map(phase => (
            <option key={phase} value={phase} />
          ))}
        </datalist>
        <datalist id={ownerListId}>
          {owners.map(owner => (
            <option key={owner} value={owner} />
          ))}
        </datalist>
        <div className="gantt-chart-panel" data-chrome="paper">
          <div className="gantt-chart-head">
            <div>
              <strong>{document.title}</strong>
              <span data-chrome="meta">{filteredTasks.length} visible tasks</span>
            </div>
            <div className="gantt-legend">
              {phases.slice(0, 6).map(phase => (
                <span key={phase}>
                  <i
                    style={
                      {
                        '--task-color': phaseColor(phase),
                        '--task-edge': phaseColor(phase, 'edge'),
                      } as TimelineStyle
                    }
                  />
                  {phase}
                </span>
              ))}
            </div>
          </div>
          <div className="gantt-agent-bar">
            <span>
              Plan, re-plan, ask what is blocking, or change the view from
              the agent drawer.
            </span>
            <button type="button" onClick={() => void openAgentDrawer()}>
              Ask the agent
            </button>
          </div>
          <div className="gantt-project-timeline">
            <div
              className="gantt-timeline-label-head"
              style={{ width: timeline.labelWidth }}
            >
              <span>Task</span>
              <button type="button" onClick={() => addTask()}>
                + New
              </button>
            </div>
            <div
              ref={timelineScrollRef}
              className="gantt-timeline-scroll"
              onScroll={handleTimelineScroll}
              style={
                {
                  '--gantt-label-width': `${timeline.labelWidth}px`,
                  '--gantt-chart-width': `${timeline.chartWidth}px`,
                  '--gantt-body-height': `${timeline.bodyHeight}px`,
                  '--gantt-row-height': `${timeline.rowHeight}px`,
                } as TimelineStyle
              }
            >
              <div className="gantt-timeline-header">
                {timeline.ticks.map(tick => (
                  <div
                    key={`${tick.offset}-${tick.label}`}
                    className="gantt-tick"
                    style={{ left: tick.offset * timeline.scale }}
                  >
                    {tick.label}
                  </div>
                ))}
                {timeline.todayOffset >= 0 &&
                timeline.todayOffset <= timeline.days ? (
                  <div
                    className="gantt-today-marker"
                    style={{ left: timeline.todayOffset * timeline.scale }}
                  >
                    {String(parseDate(todayDate()).getDate()).padStart(2, '0')}
                  </div>
                ) : null}
              </div>
              <div
                ref={timelineBodyRef}
                className={`gantt-timeline-body ${
                  isCanvasPanning ? 'is-panning' : ''
                }`}
                onClick={handleTimelineBodyClick}
                onDoubleClick={handleTimelineBodyDoubleClick}
                onPointerDown={startCanvasPan}
                onPointerMove={moveCanvasPan}
                onPointerUp={endCanvasPan}
                onPointerCancel={endCanvasPan}
              >
                {showWeekends
                  ? timeline.weekends.map(offset => (
                      <div
                        key={offset}
                        className="gantt-weekend"
                        style={{
                          left: offset * timeline.scale,
                          width: timeline.scale,
                        }}
                      />
                    ))
                  : null}
                {timeline.todayOffset >= 0 &&
                timeline.todayOffset <= timeline.days ? (
                  <div
                    className="gantt-today-line"
                    style={{ left: timeline.todayOffset * timeline.scale }}
                  />
                ) : null}
                {dependencyLines.length || linkDrag ? (
                  <svg
                    className="gantt-dependencies"
                    width={timeline.chartWidth}
                    height={timeline.bodyHeight}
                    viewBox={`0 0 ${timeline.chartWidth} ${timeline.bodyHeight}`}
                    aria-label="Task dependencies"
                  >
                    <defs>
                      <marker
                        id="gantt-arrow"
                        viewBox="0 0 7 7"
                        refX="6"
                        refY="3.5"
                        markerWidth="7"
                        markerHeight="7"
                        markerUnits="userSpaceOnUse"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0.5 0.5 L 6 3.5 L 0.5 6.5 z" />
                      </marker>
                    </defs>
                    {dependencyLines.map(line => {
                      const selected = line.key === selectedDependencyKey
                      return (
                        <g key={line.key}>
                          <polyline
                            className="gantt-dependency-hit"
                            points={line.points}
                            onClick={event => {
                              event.preventDefault()
                              event.stopPropagation()
                              setSelectedTaskId(null)
                              setProgressTaskId(null)
                              setSelectedDependencyKey(line.key)
                            }}
                          />
                          <polyline
                            className={`gantt-dependency-line ${
                              selected ? 'is-selected' : ''
                            }`}
                            points={line.points}
                          />
                        </g>
                      )
                    })}
                    {linkDrag ? (
                      <polyline
                        className="gantt-dependency-preview"
                        points={`${linkDrag.startX},${linkDrag.startY} ${Math.max(
                          linkDrag.startX + 18,
                          linkDrag.currentX,
                        )},${linkDrag.startY} ${Math.max(
                          linkDrag.startX + 18,
                          linkDrag.currentX,
                        )},${linkDrag.currentY} ${linkDrag.currentX},${linkDrag.currentY}`}
                      />
                    ) : null}
                  </svg>
                ) : null}
                {filteredTasks.map((task, index) => {
                  const startOffset = Math.max(
                    0,
                    diffDays(timeline.start, parseDate(task.start)),
                  )
                  const duration = Math.max(
                    1,
                    diffDays(parseDate(task.start), parseDate(task.end)) + 1,
                  )
                  const left = startOffset * timeline.scale
                  const width = Math.max(duration * timeline.scale, 16)
                  const top = index * timeline.rowHeight + 7
                  const color = phaseColor(taskPhase(task))
                  const edgeColor = phaseColor(taskPhase(task), 'edge')
                  const selected = task.id === selectedTaskId
                  return (
                    <div
                      key={task.id}
                      role="button"
                      tabIndex={0}
                      data-task-id={task.id}
                      aria-label={`${task.name} (${task.start} to ${task.end})`}
                      className={`gantt-task-bar ${
                        selected ? 'is-selected' : ''
                      } ${
                        task.id === linkTargetTaskId ? 'is-link-target' : ''
                      } ${task.milestone ? 'is-milestone' : ''}`}
                      style={
                        {
                          left,
                          top,
                          width: task.milestone ? 26 : width,
                          height: timeline.rowHeight - 14,
                          '--task-color': color,
                          '--task-edge': edgeColor,
                        } as TimelineStyle
                      }
                      onDoubleClick={event => {
                        event.preventDefault()
                        event.stopPropagation()
                        beginTaskNameEdit(task)
                      }}
                      onPointerDown={event =>
                        startTaskDrag(
                          task,
                          dragModeFromPoint(
                            event.currentTarget,
                            event.clientX,
                            task,
                            event.shiftKey,
                          ),
                          event,
                        )
                      }
                      onPointerMove={moveTaskDrag}
                      onPointerUp={endTaskDrag}
                      onPointerCancel={endTaskDrag}
                      onMouseDown={event =>
                        startTaskMouseDrag(
                          task,
                          dragModeFromPoint(
                            event.currentTarget,
                            event.clientX,
                            task,
                            event.shiftKey,
                          ),
                          event,
                        )
                      }
                      onKeyDown={event => handleTaskKeyDown(task, event)}
                      onClick={() => {
                        setSelectedDependencyKey(null)
                        setSelectedTaskId(task.id)
                        setProgressTaskId(task.id)
                      }}
                      title={`${task.name} (${task.start} to ${task.end})`}
                    >
                      {!task.milestone ? (
                        <span
                          className="gantt-resize-handle is-start"
                          aria-hidden="true"
                        />
                      ) : null}
                      <span
                        className="gantt-task-progress"
                        style={{ width: `${task.progress}%` }}
                      />
                      {editingTaskId === task.id && editingSurface === 'bar' ? (
                        <input
                          ref={inlineNameInputRef}
                          className="gantt-inline-name"
                          value={editingTaskName}
                          onChange={event =>
                            setEditingTaskName(event.target.value)
                          }
                          onBlur={commitTaskNameEdit}
                          onClick={event => event.stopPropagation()}
                          onMouseDown={event => event.stopPropagation()}
                          onPointerDown={event => event.stopPropagation()}
                          onKeyDown={event => {
                            event.stopPropagation()
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              commitTaskNameEdit()
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelTaskNameEdit()
                            }
                          }}
                        />
                      ) : (
                        <span className="gantt-task-title">
                          {task.milestone ? '◆' : task.name}
                        </span>
                      )}
                      {!task.milestone &&
                      (progressTaskId === task.id ||
                        editingTaskId === task.id) ? (
                        <span
                          className="gantt-inline-progress-control"
                          onClick={event => event.stopPropagation()}
                          onMouseDown={event => event.stopPropagation()}
                          onPointerDown={event => event.stopPropagation()}
                          onKeyDown={event => event.stopPropagation()}
                        >
                          <input
                            type="range"
                            min="0"
                            max="100"
                            aria-label={`Progress for ${task.name}`}
                            className="gantt-inline-progress"
                            value={task.progress}
                            onChange={event =>
                              updateTask(task.id, {
                                progress: Number(event.target.value),
                              })
                            }
                          />
                          <span className="gantt-inline-progress-value">
                            {task.progress}%
                          </span>
                        </span>
                      ) : null}
                      {!task.milestone ? (
                        <button
                          type="button"
                          className="gantt-link-outlet"
                          aria-label={`Create dependency from ${task.name}`}
                          title="Drag to another task to link"
                          onClick={event => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onMouseDown={event => event.stopPropagation()}
                          onPointerDown={event => startLinkDrag(task.id, event)}
                          onPointerMove={moveLinkDrag}
                          onPointerUp={endLinkDrag}
                          onPointerCancel={event => {
                            event.preventDefault()
                            event.stopPropagation()
                            setLinkDrag(null)
                            setLinkTargetTaskId(null)
                          }}
                        />
                      ) : null}
                      {!task.milestone ? (
                        <span
                          className="gantt-resize-handle is-end"
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
            <div
              ref={taskLabelsRef}
              className="gantt-task-labels"
              onWheel={handleTaskLabelsWheel}
            >
              {filteredTasks.map(task => (
                <div
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  className={`gantt-task-label ${
                    task.id === selectedTaskId ? 'is-selected' : ''
                  }`}
                  style={{ height: timeline.rowHeight }}
                  onClick={() => {
                    setSelectedDependencyKey(null)
                    setProgressTaskId(null)
                    setSelectedTaskId(task.id)
                  }}
                  onDoubleClick={event => {
                    event.preventDefault()
                    beginTaskNameEdit(task, 'label')
                  }}
                  onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    if (isEditableTarget(event.target)) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedDependencyKey(null)
                      setProgressTaskId(null)
                      setSelectedTaskId(task.id)
                    }
                  }}
                >
                  {editingTaskId === task.id && editingSurface === 'label' ? (
                    <input
                      ref={inlineNameInputRef}
                      className="gantt-label-inline-name"
                      value={editingTaskName}
                      onChange={event => setEditingTaskName(event.target.value)}
                      onBlur={commitTaskNameEdit}
                      onClick={event => event.stopPropagation()}
                      onKeyDown={event => {
                        event.stopPropagation()
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitTaskNameEdit()
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelTaskNameEdit()
                        }
                      }}
                    />
                  ) : (
                    <strong>{task.name}</strong>
                  )}
                  {task.id === selectedTaskId ? (
                    <button
                      type="button"
                      className="gantt-label-delete"
                      aria-label={`Delete ${task.name}`}
                      title="Delete task"
                      onClick={event => {
                        event.preventDefault()
                        event.stopPropagation()
                        deleteTask(task.id)
                      }}
                      onDoubleClick={event => event.stopPropagation()}
                      onMouseDown={event => event.stopPropagation()}
                      onKeyDown={event => event.stopPropagation()}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        focusable="false"
                      >
                        <path d="M8 7V5.5C8 4.7 8.7 4 9.5 4h5c.8 0 1.5.7 1.5 1.5V7" />
                        <path d="M5 7h14" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M7 7l.8 12.2c.1.8.7 1.3 1.5 1.3h5.4c.8 0 1.4-.5 1.5-1.3L17 7" />
                      </svg>
                    </button>
                  ) : null}
                  {task.id === selectedTaskId ? (
                    <div className="gantt-label-meta-edit">
                      <span className="gantt-label-phase-combo">
                        <input
                          aria-label={`Phase for ${task.name}`}
                          className="gantt-label-phase-input"
                          list={phaseListId}
                          value={taskPhaseInputValue(task)}
                          onChange={event =>
                            updateTask(task.id, { phase: event.target.value })
                          }
                          onClick={event => event.stopPropagation()}
                          onDoubleClick={event => event.stopPropagation()}
                          onMouseDown={event => event.stopPropagation()}
                          onKeyDown={event => {
                            event.stopPropagation()
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              event.currentTarget.blur()
                            }
                          }}
                        />
                        <select
                          aria-label={`Choose phase for ${task.name}`}
                          className="gantt-label-phase-select"
                          value={
                            phases.includes(taskPhaseInputValue(task))
                              ? taskPhaseInputValue(task)
                              : ''
                          }
                          onChange={event => {
                            if (event.target.value) {
                              updateTask(task.id, { phase: event.target.value })
                            }
                          }}
                          onClick={event => event.stopPropagation()}
                          onDoubleClick={event => event.stopPropagation()}
                          onMouseDown={event => event.stopPropagation()}
                          onKeyDown={event => event.stopPropagation()}
                        >
                          <option value="" disabled>
                            Phase
                          </option>
                          {phases.map(phase => (
                            <option key={phase} value={phase}>
                              {phase}
                            </option>
                          ))}
                        </select>
                      </span>
                      {showOwners ? (
                        <span className="gantt-label-owner-combo">
                          <input
                            aria-label={`Owner for ${task.name}`}
                            className="gantt-label-owner-input"
                            list={ownerListId}
                            value={task.owner ?? ''}
                            placeholder="Owner"
                            onChange={event =>
                              updateTask(task.id, { owner: event.target.value })
                            }
                            onClick={event => event.stopPropagation()}
                            onDoubleClick={event => event.stopPropagation()}
                            onMouseDown={event => event.stopPropagation()}
                            onKeyDown={event => {
                              event.stopPropagation()
                              if (event.key === 'Escape') {
                                event.preventDefault()
                                event.currentTarget.blur()
                              }
                            }}
                          />
                          <select
                            aria-label={`Choose owner for ${task.name}`}
                            className="gantt-label-owner-select"
                            value={
                              owners.includes(task.owner ?? '')
                                ? task.owner ?? ''
                                : ''
                            }
                            onChange={event =>
                              updateTask(task.id, {
                                owner: event.target.value,
                              })
                            }
                            onClick={event => event.stopPropagation()}
                            onDoubleClick={event => event.stopPropagation()}
                            onMouseDown={event => event.stopPropagation()}
                            onKeyDown={event => event.stopPropagation()}
                          >
                            <option value="" disabled>
                              Owner
                            </option>
                            {owners.map(owner => (
                              <option key={owner} value={owner}>
                                {owner}
                              </option>
                            ))}
                          </select>
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span>
                      {taskPhase(task)}
                      {showOwners && task.owner ? ` · ${task.owner}` : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
          {!filteredTasks.length ? (
            <div className="gantt-empty">
              <strong>
                {document.tasks.length ? 'No matching tasks' : 'No tasks yet'}
              </strong>
              <span>
                {document.tasks.length
                  ? 'Clear the search or phase filter to see the plan.'
                  : 'Add a task, double-click the chart, or ask the agent.'}
              </span>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
