import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'חדש' | 'בטיפול' | 'ממתין' | 'דחוף' | 'בוצע'
type View = 'dashboard' | 'processes' | 'events' | 'integrations' | 'activity'
type CalendarMode = 'week' | 'day'
type SortField = 'dueDate' | 'status' | 'title'

type GoogleEvent = {
  id: string
  summary: string
  start: { date?: string; dateTime?: string }
  end: { date?: string; dateTime?: string }
  htmlLink?: string
}

type Task = {
  id: string
  title: string
  dueDate: string
  owner: string
  status: TaskStatus
  notes?: string
  notesUpdatedAt?: string
}

interface Project {
  id: string
  name: string
  color: string
  description?: string
  milestones?: string
  kpis?: string
  stakeholders?: string
  targetDate?: string
  tasks: Task[]
}

type EventItem = {
  id: string
  title: string
  date: string
  projectId: string
  description: string
  createdAt: string
}

type ActivityItem = {
  id: string
  action: string
  details: string
  createdAt: string
}

type GoogleProfile = {
  name: string
  email: string
  picture?: string
}

type GoogleTaskList = {
  id: string
  title: string
}

type PersistedState = {
  projects?: Project[]
  events?: EventItem[]
  activity?: ActivityItem[]
  googleProfile?: GoogleProfile | null
  selectedGoogleTaskListId?: string
  googleEvents?: GoogleEvent[]
  darkMode?: boolean
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: Record<string, unknown>) => void
          renderButton: (container: HTMLElement, options: Record<string, unknown>) => void
          disableAutoSelect?: () => void
        }
        oauth2?: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback?: (response: { access_token?: string; error?: string; error_description?: string }) => void
            error_callback?: (error: { type?: string }) => void
          }) => {
            callback?: (response: { access_token?: string; error?: string; error_description?: string }) => void
            error_callback?: (error: { type?: string }) => void
            requestAccessToken: (options?: { prompt?: string }) => void
          }
          revoke?: (token: string, done?: () => void) => void
        }
      }
    }
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'bat-yam-hq-local-state-v6'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const GOOGLE_TASKS_SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
].join(' ')
const UNASSIGNED_OWNER = 'לא משויך'
const DEFAULT_STATUS: TaskStatus = 'חדש'

const STATUS_ORDER: TaskStatus[] = ['חדש', 'בטיפול', 'ממתין', 'דחוף', 'בוצע']
const VIEW_LABELS: Record<View, string> = {
  dashboard: 'משימות',
  processes: 'תהליכים',
  events: 'יומן',
  integrations: 'חיבורים וסנכרון',
  activity: 'יומן פעולות',
}

const STATUS_META: Record<TaskStatus, { label: string; tone: string }> = {
  'חדש': { label: 'חדש', tone: 'status-new' },
  'בטיפול': { label: 'בטיפול', tone: 'status-active' },
  'ממתין': { label: 'ממתין', tone: 'status-waiting' },
  'דחוף': { label: 'דחוף', tone: 'status-urgent' },
  'בוצע': { label: 'בוצע', tone: 'status-done' },
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && value in STATUS_META
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  return isTaskStatus(value) ? value : DEFAULT_STATUS
}

function sanitizeProjects(projects: Project[]) {
  if (!Array.isArray(projects)) return []
  return projects.map((project) => ({
    ...project,
    tasks: Array.isArray(project.tasks)
      ? project.tasks.map((task) => ({
          ...task,
          owner: task.owner || UNASSIGNED_OWNER,
          status: normalizeTaskStatus(task.status),
        }))
      : [],
  }))
}

function progressColor(pct: number): string {
  if (pct < 33) return '#ef4444'
  if (pct < 66) return '#f59e0b'
  return '#10b981'
}

const INITIAL_PROJECTS: Project[] = [
  {
    id: 'project-100',
    name: 'פרויקט ה-100',
    color: '#7c3aed',
    tasks: [
      { id: 'p100-1', title: 'סגירת לוגו ומיתוג לכלים', dueDate: '2026-03-26', owner: UNASSIGNED_OWNER, status: 'בטיפול' },
      { id: 'p100-2', title: 'סגירת חוזים מול כלל האמנים', dueDate: '2026-03-26', owner: UNASSIGNED_OWNER, status: 'ממתין' },
      { id: 'p100-3', title: 'הסטת כספי פיס (מול גלית)', dueDate: '2026-03-25', owner: UNASSIGNED_OWNER, status: 'בטיפול' },
      { id: 'p100-4', title: 'קידום רכב ה-100', dueDate: '2026-03-26', owner: UNASSIGNED_OWNER, status: 'בטיפול' },
      { id: 'p100-5', title: 'לוחות פרסום על עמודי חשמל', dueDate: '2026-03-26', owner: UNASSIGNED_OWNER, status: 'ממתין' },
    ],
  },
  {
    id: 'beach',
    name: 'חוף הים',
    color: '#0f766e',
    tasks: [
      { id: 'beach-1', title: 'בניית תמונת מצב חוף כוללת', dueDate: '2026-03-24', owner: UNASSIGNED_OWNER, status: 'בטיפול' },
      { id: 'beach-2', title: 'תקציר מנהלים: אי מלאכותי', dueDate: '2026-03-26', owner: UNASSIGNED_OWNER, status: 'חדש' },
      { id: 'beach-3', title: 'בחינת פארק מים מתנפח', dueDate: '2026-03-26', owner: UNASSIGNED_OWNER, status: 'בטיפול' },
      { id: 'beach-4', title: 'פגישה עם נדל"ן שצ"פ נורדאו', dueDate: '2026-03-24', owner: UNASSIGNED_OWNER, status: 'ממתין' },
    ],
  },
  {
    id: 'young',
    name: 'צעירים',
    color: '#2563eb',
    tasks: [
      { id: 'young-1', title: 'שולחנות עגולים לתרבות ופנאי', dueDate: '2026-03-24', owner: UNASSIGNED_OWNER, status: 'דחוף' },
      { id: 'young-2', title: 'קידום סקר צעירים', dueDate: '2026-03-25', owner: UNASSIGNED_OWNER, status: 'בטיפול' },
      { id: 'young-3', title: 'תיאום עם מיכל פרויקטים', dueDate: '2026-03-25', owner: UNASSIGNED_OWNER, status: 'ממתין' },
    ],
  },
  {
    id: 'tzvika',
    name: 'צביקה',
    color: '#f59e0b',
    tasks: [],
  },
  {
    id: 'mayor',
    name: 'לשכת ראש העיר',
    color: '#10b981',
    tasks: [],
  },
  {
    id: 'emergency',
    name: 'חירום',
    color: '#b91c1c',
    tasks: [
      { id: 'em-1', title: 'חינוך מיוחד - פעילות הפגה', dueDate: '2026-03-22', owner: UNASSIGNED_OWNER, status: 'דחוף' },
      { id: 'em-2', title: 'בדיקת ערכות מגן', dueDate: '2026-03-24', owner: UNASSIGNED_OWNER, status: 'בטיפול' },
      { id: 'em-3', title: "התקנת מערכת 'תמונת מצב' מבצעית", dueDate: '2026-03-22', owner: UNASSIGNED_OWNER, status: 'דחוף' },
    ],
  },
]

const INITIAL_EVENTS: EventItem[] = [
  {
    id: 'ev-1',
    title: 'ישיבת היערכות רבעונית',
    date: '2026-03-29',
    projectId: 'emergency',
    description: 'מעבר על סטטוס משימות פתוחות והיערכות לחודש הבא.',
    createdAt: '2026-03-24 09:00',
  },
]

const INITIAL_ACTIVITY: ActivityItem[] = [
  {
    id: 'ac-1',
    action: 'אתחול מערכת',
    details: 'נטענו נתוני ברירת המחדל של הלוח המקומי.',
    createdAt: '2026-03-24 08:55',
  },
]

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function getNowLabel() {
  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date())
}

function getWeekDates(dateString: string) {
  const baseDate = new Date(`${dateString}T00:00:00`)
  const offset = (baseDate.getDay() + 7) % 7
  const startDate = new Date(baseDate)
  startDate.setDate(baseDate.getDate() - offset)
  return Array.from({ length: 7 }, (_, index) => {
    const d = new Date(startDate)
    d.setDate(startDate.getDate() + index)
    return d.toISOString().slice(0, 10)
  })
}

function formatCalendarLabel(dateString: string) {
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(`${dateString}T00:00:00`))
}

async function loadScript(id: string, src: string) {
  const existing = document.getElementById(id) as HTMLScriptElement | null
  if (existing) {
    if (existing.dataset.ready === 'true') return
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true })
    })
    return
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.id = id
    script.src = src
    script.async = true
    script.defer = true
    script.addEventListener('load', () => { script.dataset.ready = 'true'; resolve() }, { once: true })
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true })
    document.body.appendChild(script)
  })
}

// ─── PWA Notification helper ──────────────────────────────────────────────────

async function scheduleEmergencyNotification(urgentCount: number) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return
  if (Notification.permission === 'denied') return

  if (Notification.permission !== 'granted') {
    const result = await Notification.requestPermission()
    if (result !== 'granted') return
  }

  if (urgentCount === 0) return

  const reg = await navigator.serviceWorker.ready.catch(() => null)
  if (!reg) return

  // Schedule a notification for 08:00 tomorrow; for demo we show immediately if >0
  new Notification('Bat Yam HQ — חירום', {
    body: `יש ${urgentCount} משימות דחופות פתוחות בקטגוריית חירום`,
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: 'emergency-daily',
  })
}

// ─── Sort tasks helper ────────────────────────────────────────────────────────

function sortTasks(tasks: Task[], sortBy: SortField): Task[] {
  return [...tasks].sort((a, b) => {
    if (sortBy === 'dueDate') return a.dueDate.localeCompare(b.dueDate)
    if (sortBy === 'status') return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    return a.title.localeCompare(b.title, 'he')
  })
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const googleTokenClientRef = useRef<ReturnType<NonNullable<NonNullable<NonNullable<typeof window.google>['accounts']>['oauth2']>['initTokenClient']> | null>(null)
  const googleAccessTokenRef = useRef('')

  // ── Dark mode (שיפור 4) ──────────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = window.localStorage.getItem('bat-yam-dark')
    if (saved !== null) return saved === 'true'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    window.localStorage.setItem('bat-yam-dark', String(darkMode))
  }, [darkMode])

  // ── Core state ───────────────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS)
  const [events, setEvents] = useState<EventItem[]>(INITIAL_EVENTS)
  const [activity, setActivity] = useState<ActivityItem[]>(INITIAL_ACTIVITY)
  const [googleProfile, setGoogleProfile] = useState<GoogleProfile | null>(null)
  const [googleEvents, setGoogleEvents] = useState<GoogleEvent[]>([])
  const [googleMessage, setGoogleMessage] = useState('')
  const [googleTasksLists, setGoogleTasksLists] = useState<GoogleTaskList[]>([])
  const [selectedGoogleTaskListId, setSelectedGoogleTaskListId] = useState('')
  const [syncProjectId, setSyncProjectId] = useState(INITIAL_PROJECTS[0].id)
  const [googleTasksBusy, setGoogleTasksBusy] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [dashboardLayout, setDashboardLayout] = useState<'list' | 'kanban'>('kanban')
  const [showGlobalAddModal, setShowGlobalAddModal] = useState<false | 'single' | 'bulk'>(false)
  const [bulkImportText, setBulkImportText] = useState('')
  const [bulkProjectId, setBulkProjectId] = useState('')
  const [showProjectModal, setShowProjectModal] = useState<{ mode: 'create' | 'edit'; project?: Project } | null>(null)
  const [projectForm, setProjectForm] = useState({ name: '', description: '', color: '#3b82f6', milestones: '', kpis: '', stakeholders: '', targetDate: '' })
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('week')
  const [selectedDate, setSelectedDate] = useState('2026-03-24')
  const [editingTask, setEditingTask] = useState<{
    projectId: string; taskId: string; title: string; owner: string
    dueDate: string; status: TaskStatus; notes?: string; notesUpdatedAt?: string
  } | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  // ── שיפור 2 — Filter & Sort ───────────────────────────────────────────────
  const [filterStatus, setFilterStatus] = useState<'all' | TaskStatus>('all')
  const [filterProject, setFilterProject] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortField>('dueDate')

  // ── Add task form ─────────────────────────────────────────────────────────
  const [taskForm, setTaskForm] = useState({ title: '', dueDate: '', projectId: INITIAL_PROJECTS[0].id, status: DEFAULT_STATUS })
  const [eventForm, setEventForm] = useState({ title: '', date: '', projectId: INITIAL_PROJECTS[0].id, description: '' })

  // ── Load from localStorage (שיפור 1) ──────────────────────────────────────
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) {
      // Fallback: try to load from tasks.json (legacy)
      fetch('/tasks.json')
        .then((r) => r.json())
        .catch(() => null)
      return
    }
    try {
      const parsed = JSON.parse(saved) as PersistedState
      if (parsed.projects?.length) {
        const loaded = sanitizeProjects(parsed.projects)
        const hasTzvika = loaded.some((p) => p.id === 'tzvika')
        if (!hasTzvika) {
          loaded.push({ id: 'tzvika', name: 'צביקה', color: '#f59e0b', tasks: [] })
          loaded.push({ id: 'mayor', name: 'לשכת ראש העיר', color: '#10b981', tasks: [] })
          const emIdx = loaded.findIndex((p) => p.id === 'emergency')
          if (emIdx !== -1) { const em = loaded.splice(emIdx, 1)[0]; loaded.push(em) }
        }
        setProjects(loaded)
      }
      if (parsed.events?.length) setEvents(parsed.events)
      if (parsed.activity?.length) setActivity(parsed.activity)
      if (parsed.googleProfile) setGoogleProfile(parsed.googleProfile)
      if (parsed.selectedGoogleTaskListId) setSelectedGoogleTaskListId(parsed.selectedGoogleTaskListId)
      if (parsed.googleEvents) setGoogleEvents(parsed.googleEvents)
    } catch {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  // ── Auto-save to localStorage (שיפור 1) ───────────────────────────────────
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      projects, events, activity, googleProfile, selectedGoogleTaskListId, googleEvents,
    }))
  }, [projects, events, activity, googleProfile, selectedGoogleTaskListId, googleEvents])

  // ── Auto-reconnect Google ─────────────────────────────────────────────────
  useEffect(() => {
    if (googleProfile && GOOGLE_CLIENT_ID) {
      ensureGoogleServices().then(() => {
        if (!googleAccessTokenRef.current) {
          requestGoogleAccessToken('').then(() => refreshGoogleTasksContext()).catch(() => {})
        }
      }).catch(() => {})
    }
  }, [googleProfile])

  // ── PWA daily notification for emergency tasks (שיפור 5) ─────────────────
  const notifiedRef = useRef(false)
  useEffect(() => {
    if (notifiedRef.current) return
    const emergencyProject = projects.find((p) => p.id === 'emergency')
    if (!emergencyProject) return
    const urgentCount = emergencyProject.tasks.filter((t) => t.status !== 'בוצע').length
    if (urgentCount > 0) {
      notifiedRef.current = true
      // Request permission on first meaningful interaction
      window.addEventListener('click', () => scheduleEmergencyNotification(urgentCount), { once: true })
    }
  }, [projects])

  // ─── Derived state ────────────────────────────────────────────────────────

  const allTasks = useMemo(
    () => projects.flatMap((p) => p.tasks.map((t) => ({ ...t, projectId: p.id, projectName: p.name }))),
    [projects],
  )

  const completedTasks = allTasks.filter((t) => t.status === 'בוצע').length
  const openTasks = allTasks.filter((t) => t.status !== 'בוצע').length
  const urgentTasks = allTasks.filter((t) => t.status === 'דחוף').length
  const unassignedTasks = allTasks.filter((t) => t.owner === UNASSIGNED_OWNER).length
  const progress = allTasks.length === 0 ? 0 : Math.round((completedTasks / allTasks.length) * 100)

  // שיפור 2 — apply filter + sort
  const visibleProjects = useMemo(() => {
    return projects
      .filter((p) => filterProject === 'all' || p.id === filterProject)
      .map((p) => {
        let tasks = filterStatus === 'all' ? p.tasks : p.tasks.filter((t) => t.status === filterStatus)
        if (!showCompleted) tasks = tasks.filter((t) => t.status !== 'בוצע')
        tasks = sortTasks(tasks, sortBy)
        return { ...p, tasks }
      })
      .filter((p) => p.tasks.length > 0)
  }, [projects, filterProject, filterStatus, showCompleted, sortBy])

  const sortedEvents = [...events].sort((a, b) => a.date.localeCompare(b.date))
  const weekDates = getWeekDates(selectedDate)
  const syncProject = projects.find((p) => p.id === syncProjectId) ?? projects[0]
  const selectedGoogleTaskList = googleTasksLists.find((l) => l.id === selectedGoogleTaskListId)

  const calendarEntries = (calendarMode === 'day' ? [selectedDate] : weekDates).map((date) => ({
    label: formatCalendarLabel(date),
    date,
    events: sortedEvents.filter((e) => e.date === date),
    googleEvents: googleEvents.filter((ge) => {
      const d = ge.start?.date || ge.start?.dateTime?.slice(0, 10)
      return d === date
    }),
  }))

  // ─── Mutations ────────────────────────────────────────────────────────────

  const appendActivity = (action: string, details: string) =>
    setActivity((cur) => [{ id: createId('activity'), action, details, createdAt: getNowLabel() }, ...cur])

  const updateTaskStatus = (projectId: string, taskId: string, nextStatus: TaskStatus) =>
    setProjects((cur) => cur.map((p) =>
      p.id !== projectId ? p : { ...p, tasks: p.tasks.map((t) => t.id === taskId ? { ...t, status: nextStatus } : t) }
    ))

  const deleteTask = (projectId: string, taskId: string) => {
    const task = projects.find((p) => p.id === projectId)?.tasks.find((t) => t.id === taskId)
    setProjects((cur) => cur.map((p) =>
      p.id !== projectId ? p : { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) }
    ))
    if (task) appendActivity('מחיקת משימה', `המשימה "${task.title}" נמחקה`)
  }

  const cycleStatus = (projectId: string, taskId: string) => {
    const project = projects.find((p) => p.id === projectId)
    const task = project?.tasks.find((t) => t.id === taskId)
    if (!project || !task) return
    const nextStatus = STATUS_ORDER[(STATUS_ORDER.indexOf(task.status) + 1) % STATUS_ORDER.length]
    updateTaskStatus(projectId, taskId, nextStatus)
    appendActivity('עדכון סטטוס', `${task.title} → ${nextStatus}`)
  }

  const handleTaskSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!taskForm.title.trim() || !taskForm.dueDate) return
    const project = projects.find((p) => p.id === taskForm.projectId)
    if (!project) return
    const next: Task = { id: createId('task'), title: taskForm.title.trim(), dueDate: taskForm.dueDate, owner: UNASSIGNED_OWNER, status: taskForm.status }
    setProjects((cur) => cur.map((p) => p.id === taskForm.projectId ? { ...p, tasks: [next, ...p.tasks] } : p))
    appendActivity('יצירת משימה', `נוספה "${next.title}" לפרויקט ${project.name}`)
    setTaskForm((cur) => ({ ...cur, title: '', dueDate: '', status: DEFAULT_STATUS }))
  }

  const handleEventSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!eventForm.title.trim() || !eventForm.date || !eventForm.description.trim()) return
    const project = projects.find((p) => p.id === eventForm.projectId)
    const next: EventItem = { id: createId('event'), title: eventForm.title.trim(), date: eventForm.date, projectId: eventForm.projectId, description: eventForm.description.trim(), createdAt: getNowLabel() }
    setEvents((cur) => [next, ...cur])
    appendActivity('אירוע חדש', `נוסף "${next.title}" עבור ${project?.name ?? '?'}`)
    setEventForm((cur) => ({ ...cur, title: '', date: '', description: '' }))
  }

  const handleProjectSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!projectForm.name.trim()) return
    if (showProjectModal?.mode === 'create') {
      const p: Project = { id: createId('project'), name: projectForm.name.trim(), description: projectForm.description.trim(), color: projectForm.color, milestones: projectForm.milestones.trim(), kpis: projectForm.kpis.trim(), stakeholders: projectForm.stakeholders.trim(), targetDate: projectForm.targetDate, tasks: [] }
      setProjects((cur) => [...cur, p])
      appendActivity('תהליך חדש', `נוצר "${p.name}"`)
    } else if (showProjectModal?.mode === 'edit' && showProjectModal.project) {
      setProjects((cur) => cur.map((p) =>
        p.id !== showProjectModal.project!.id ? p : { ...p, name: projectForm.name.trim(), description: projectForm.description.trim(), color: projectForm.color, milestones: projectForm.milestones.trim(), kpis: projectForm.kpis.trim(), stakeholders: projectForm.stakeholders.trim(), targetDate: projectForm.targetDate }
      ))
      appendActivity('עדכון תהליך', `"${projectForm.name}" עודכן`)
    }
    setShowProjectModal(null)
  }

  const deleteProject = (projectId: string) => {
    if (!confirm('למחוק תהליך זה? כל המשימות שבו יימחקו!')) return
    const proj = projects.find((p) => p.id === projectId)
    setProjects((cur) => cur.filter((p) => p.id !== projectId))
    if (proj) appendActivity('מחיקת תהליך', `"${proj.name}" נמחק`)
  }

  const openProjectTasks = (projectId: string) => { setFilterProject(projectId); setView('dashboard') }

  const handleBulkImport = (e: React.FormEvent) => {
    e.preventDefault()
    const targetId = bulkProjectId || projects[0]?.id
    if (!bulkImportText.trim() || !targetId) return
    const lines = bulkImportText.split('\n').map((l) => l.replace(/^[-*•\d.\s[\]]+/, '').trim()).filter(Boolean)
    if (!lines.length) return
    const newTasks: Task[] = lines.map((title) => ({ id: createId('task-bulk'), title, status: DEFAULT_STATUS, dueDate: new Date().toISOString().slice(0, 10), owner: UNASSIGNED_OWNER }))
    setProjects((cur) => cur.map((p) => p.id === targetId ? { ...p, tasks: [...newTasks, ...p.tasks] } : p))
    appendActivity('ייבוא המוני', `יובאו ${newTasks.length} משימות`)
    setShowGlobalAddModal(false)
    setBulkImportText('')
    setBulkProjectId('')
  }

  const resetFilters = () => { setFilterProject('all'); setFilterStatus('all'); setSortBy('dueDate') }

  const startEditingTask = (projectId: string, task: Task) =>
    setEditingTask({ projectId, taskId: task.id, title: task.title, owner: task.owner, dueDate: task.dueDate, status: task.status, notes: task.notes || '', notesUpdatedAt: task.notesUpdatedAt })

  const saveTaskEdits = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editingTask) return
    const project = projects.find((p) => p.id === editingTask.projectId)
    const current = project?.tasks.find((t) => t.id === editingTask.taskId)
    if (!project || !current) return
    const updated: Task = {
      ...current,
      title: editingTask.title.trim(),
      owner: editingTask.owner.trim() || UNASSIGNED_OWNER,
      dueDate: editingTask.dueDate,
      status: editingTask.status,
      notes: editingTask.notes?.trim() || undefined,
      notesUpdatedAt: editingTask.notes !== current.notes ? getNowLabel() : current.notesUpdatedAt,
    }
    if (!updated.title || !updated.dueDate) return
    setProjects((cur) => cur.map((p) =>
      p.id !== editingTask.projectId ? p : { ...p, tasks: p.tasks.map((t) => t.id === editingTask.taskId ? updated : t) }
    ))
    appendActivity('עריכת משימה', `עודכנה "${updated.title}" בפרויקט ${project.name}`)
    setEditingTask(null)
  }

  // ─── Google ───────────────────────────────────────────────────────────────

  const ensureGoogleServices = async () => {
    if (!GOOGLE_CLIENT_ID) throw new Error('חסר VITE_GOOGLE_CLIENT_ID')
    await loadScript('google-identity-services', 'https://accounts.google.com/gsi/client')
    if (!window.google?.accounts?.oauth2) throw new Error('טעינת שירות Google נכשלה.')
    if (!googleTokenClientRef.current) {
      googleTokenClientRef.current = window.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: GOOGLE_TASKS_SCOPES })
    }
  }

  const requestGoogleAccessToken = async (prompt: '' | 'consent' = '') => {
    await ensureGoogleServices()
    if (!googleTokenClientRef.current) throw new Error('חיבור Google Tasks לא זמין.')
    return new Promise<string>((resolve, reject) => {
      googleTokenClientRef.current!.callback = (response) => {
        if (response.error || !response.access_token) { reject(new Error(response.error_description || response.error || 'נכשל.')); return }
        googleAccessTokenRef.current = response.access_token
        resolve(response.access_token)
      }
      googleTokenClientRef.current!.error_callback = () => reject(new Error('בוטל.'))
      googleTokenClientRef.current!.requestAccessToken({ prompt: googleAccessTokenRef.current ? '' : prompt || 'consent' })
    })
  }

  const googleApiRequest = async <T,>(url: string, init?: RequestInit) => {
    const token = googleAccessTokenRef.current || (await requestGoogleAccessToken())
    const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) } })
    if (!r.ok) throw new Error((await r.text()) || `Google request failed: ${r.status}`)
    if (r.status === 204) return null as T
    return (await r.json()) as T
  }

  const refreshGoogleTasksContext = async () => {
    const timeMin = new Date(); timeMin.setDate(timeMin.getDate() - 14)
    const timeMax = new Date(); timeMax.setDate(timeMax.getDate() + 30)
    const [listsRes, profileRes, calsRes] = await Promise.all([
      googleApiRequest<{ items?: GoogleTaskList[] }>('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100').catch(() => ({ items: [] })),
      googleApiRequest<GoogleProfile>('https://www.googleapis.com/oauth2/v3/userinfo').catch(() => ({ name: 'משתמש', email: '' })),
      googleApiRequest<{ items?: Array<{ id: string }> }>('https://www.googleapis.com/calendar/v3/users/me/calendarList').catch(() => ({ items: [] })),
    ])
    const nextLists = listsRes.items ?? []
    setGoogleProfile((cur) => cur ?? profileRes)
    setGoogleTasksLists(nextLists)
    setSelectedGoogleTaskListId((cur) => cur || nextLists[0]?.id || '')
    const calIds = (calsRes.items ?? []).map((c) => c.id).slice(0, 30)
    const evtResponses = await Promise.all(calIds.map((calId) =>
      googleApiRequest<{ items?: GoogleEvent[] }>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${timeMin.toISOString()}&timeMax=${timeMax.toISOString()}&singleEvents=true&orderBy=startTime`).catch(() => ({ items: [] }))
    ))
    const evts = evtResponses.flatMap((r) => r.items ?? [])
    setGoogleEvents(evts)
    setGoogleMessage(nextLists.length > 0 ? `נתונים עודכנו: ${nextLists.length} רשימות, ${evts.length} אירועים` : 'מחובר.')
    return { profile: profileRes, lists: nextLists, events: evts }
  }

  const connectGoogleProfile = async () => {
    setGoogleTasksBusy(true)
    try { const ctx = await (async () => { await requestGoogleAccessToken('consent'); return refreshGoogleTasksContext() })(); appendActivity('התחברות Google', `${ctx.profile.name} התחבר/ה`) }
    catch (err) { setGoogleMessage(err instanceof Error ? err.message : 'נכשל.') }
    finally { setGoogleTasksBusy(false) }
  }

  const connectGoogleTasks = async () => {
    setGoogleTasksBusy(true)
    try { const ctx = await (async () => { await requestGoogleAccessToken(googleAccessTokenRef.current ? '' : 'consent'); return refreshGoogleTasksContext() })(); appendActivity('חיבור Tasks', `${ctx.profile.name}`) }
    catch (err) { setGoogleMessage(err instanceof Error ? err.message : 'נכשל.') }
    finally { setGoogleTasksBusy(false) }
  }

  const refreshGoogleTasksLists = async () => {
    setGoogleTasksBusy(true)
    try { await refreshGoogleTasksContext() } catch (err) { setGoogleMessage(err instanceof Error ? err.message : 'נכשל.') } finally { setGoogleTasksBusy(false) }
  }

  const syncProjectToGoogleTasks = async () => {
    if (!syncProject || !selectedGoogleTaskListId) { setGoogleMessage('יש לבחור רשימה ופרויקט.'); return }
    setGoogleTasksBusy(true)
    try {
      const existing = await googleApiRequest<{ items?: Array<{ title: string }> }>(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(selectedGoogleTaskListId)}/tasks?showCompleted=true&showHidden=true&maxResults=100`)
      const existingTitles = new Set((existing.items ?? []).map((t) => t.title))
      const pending = syncProject.tasks.filter((t) => !existingTitles.has(`${syncProject.name} | ${t.title}`))
      await Promise.all(pending.map((t) => googleApiRequest(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(selectedGoogleTaskListId)}/tasks`, { method: 'POST', body: JSON.stringify({ title: `${syncProject.name} | ${t.title}`, notes: `בעלים: ${t.owner}\nסטטוס: ${t.status}`, due: new Date(`${t.dueDate}T09:00:00`).toISOString(), status: t.status === 'בוצע' ? 'completed' : 'needsAction', ...(t.status === 'בוצע' ? { completed: new Date().toISOString() } : {}) }) })))
      setGoogleMessage(pending.length > 0 ? `יוצאו ${pending.length} משימות` : 'אין משימות חדשות לייצוא')
      appendActivity('סנכרון Tasks', `ייצא ${pending.length} משימות מ-${syncProject.name}`)
      await refreshGoogleTasksContext()
    } catch (err) { setGoogleMessage(err instanceof Error ? err.message : 'נכשל.') } finally { setGoogleTasksBusy(false) }
  }

  const disconnectGoogle = () => {
    if (googleProfile) appendActivity('התנתקות Google', `${googleProfile.name} התנתק/ה`)
    if (googleAccessTokenRef.current) window.google?.accounts?.oauth2?.revoke?.(googleAccessTokenRef.current)
    googleAccessTokenRef.current = ''
    window.google?.accounts?.id?.disableAutoSelect?.()
    setGoogleProfile(null); setGoogleTasksLists([]); setSelectedGoogleTaskListId(''); setGoogleTasksBusy(false)
    setGoogleMessage('החיבור הוסר.')
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="app-shell" dir="rtl">
      {/* ── Header ── */}
      <header className="topbar">
        <div>
          <p className="eyebrow">מטה משימות</p>
          <h1>לוח ניהול עירוני</h1>
          <p className="subhead">מערכת מקומית עם חיבור ל-Google Calendar ול-Google Tasks.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Dark mode toggle — שיפור 4 */}
          <button
            type="button"
            className="ghost-button small-button"
            onClick={() => setDarkMode((d) => !d)}
            title={darkMode ? 'מצב בהיר' : 'מצב כהה'}
            style={{ fontSize: '20px', padding: '8px 12px', borderRadius: '12px' }}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
          <div className="summary-chip">
            <span>{allTasks.length} משימות</span>
            <strong>{progress}% הושלם</strong>
          </div>
        </div>
      </header>

      <nav className="tabbar" aria-label="ניווט ראשי">
        {(Object.keys(VIEW_LABELS) as View[]).map((tab) => (
          <button key={tab} type="button" className={view === tab ? 'tab-button active' : 'tab-button'} onClick={() => setView(tab)}>
            {VIEW_LABELS[tab]}
          </button>
        ))}
      </nav>

      {/* ════════════════════ DASHBOARD ════════════════════ */}
      {view === 'dashboard' && (
        <main className="board">
          <section className="hero-card">
            <div>
              <h2>לוח אישי וקומפקטי</h2>
              <p>סינון הסטטוסים מרוכז במקום אחד, רשימות תחת פרויקטים, ותצוגת קנבן מתקדמת.</p>
            </div>
            <div className="hero-metrics">
              <span>פתוחות: {openTasks}</span>
              <span>דחופות: {urgentTasks}</span>
              <span>לא משויכות: {unassignedTasks}</span>
            </div>
          </section>

          {/* שיפור 2 — Toolbar with filter + sort */}
          <section className="panel toolbar-panel compact-toolbar">
            <div className="toolbar-stack">
              <div className="board-actions board-actions-compact" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                <div className="view-toggle">
                  <button type="button" className={dashboardLayout === 'list' ? 'tab-button active' : 'tab-button'} onClick={() => setDashboardLayout('list')}>רשימה</button>
                  <button type="button" className={dashboardLayout === 'kanban' ? 'tab-button active' : 'tab-button'} onClick={() => setDashboardLayout('kanban')}>קנבן</button>
                </div>
                <label className="toolbar-field">
                  <span>סטטוס</span>
                  <select className="field-input compact" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'all' | TaskStatus)}>
                    <option value="all">כל הסטטוסים</option>
                    {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="toolbar-field">
                  <span>תחום</span>
                  <select className="field-input compact" value={filterProject} onChange={(e) => setFilterProject(e.target.value)}>
                    <option value="all">כל התחומים</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="toolbar-field">
                  <span>מיון לפי</span>
                  <select className="field-input compact" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortField)}>
                    <option value="dueDate">תאריך יעד</option>
                    <option value="status">עדיפות</option>
                    <option value="title">שם</option>
                  </select>
                </label>
                <button type="button" className={`ghost-button compact-action ${showCompleted ? 'active' : ''}`} onClick={() => setShowCompleted((v) => !v)} style={{ alignSelf: 'flex-end' }}>
                  {showCompleted ? 'הסתר בוצעו' : 'הצג בוצעו'}
                </button>
                <button type="button" className="ghost-button compact-action" onClick={resetFilters} style={{ alignSelf: 'flex-end' }}>
                  נקה סינון
                </button>
              </div>
            </div>
          </section>

          {/* List view */}
          {dashboardLayout === 'list' ? (
            visibleProjects.map((project) => {
              // שיפור 3 — Progress bar per category
              const allProjectTasks = projects.find((p) => p.id === project.id)?.tasks ?? []
              const donePct = allProjectTasks.length === 0 ? 0 : Math.round((allProjectTasks.filter((t) => t.status === 'בוצע').length / allProjectTasks.length) * 100)
              const barColor = progressColor(donePct)

              return (
                <section className="project-card" key={project.id}>
                  <div className="project-header">
                    <div className="project-title">
                      <span className="project-dot" style={{ backgroundColor: project.color }} />
                      <h3>{project.name}</h3>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      {/* שיפור 3 — progress bar in card header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '80px', height: '6px', background: 'var(--surface-border)', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${donePct}%`, background: barColor, borderRadius: '999px', transition: 'width 0.6s ease' }} />
                        </div>
                        <span style={{ fontSize: '12px', color: barColor, fontWeight: 700 }}>{donePct}%</span>
                      </div>
                      <span className="task-count">{project.tasks.length} פריטים</span>
                    </div>
                  </div>

                  <div className="task-list">
                    {project.tasks.map((task) => {
                      const meta = STATUS_META[normalizeTaskStatus(task.status)]
                      const isDone = task.status === 'בוצע'
                      return (
                        <article className="task-row" key={task.id} style={{ opacity: isDone ? 0.6 : 1 }}>
                          <div className="task-main-wrap">
                            <input
                              type="checkbox"
                              className="task-list-checkbox"
                              checked={isDone}
                              onChange={(e) => updateTaskStatus(project.id, task.id, e.target.checked ? 'בוצע' : DEFAULT_STATUS)}
                            />
                            <div className="task-main">
                              <h4 style={{ textDecoration: isDone ? 'line-through' : 'none' }}>{task.title}</h4>
                              <p>שיוך: {task.owner} | יעד: {task.dueDate}</p>
                              {task.notes && (
                                <p style={{ fontSize: '13px', marginTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '500px' }}>
                                  📝 {task.notes}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="task-actions">
                            <button type="button" className="ghost-button small-button" onClick={() => startEditingTask(project.id, task)}>עריכה</button>
                            <button type="button" className="ghost-button small-button" style={{ color: '#f87171' }} onClick={() => deleteTask(project.id, task.id)}>מחיקה</button>
                            <button type="button" className={`status-pill ${meta.tone}`} onClick={() => cycleStatus(project.id, task.id)}>{meta.label}</button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              )
            })
          ) : (
            /* Kanban view */
            <div className="kanban-board">
              {STATUS_ORDER.map((col) => {
                const colTasks = allTasks.filter(
                  (t) => t.status === col &&
                    (filterProject === 'all' || t.projectId === filterProject) &&
                    (filterStatus === 'all' || t.status === filterStatus) &&
                    (showCompleted || t.status !== 'בוצע')
                )
                return (
                  <div className="kanban-column" key={col}>
                    <div className="kanban-column-header">
                      <span>{col}</span>
                      <span className="kanban-column-count">{colTasks.length}</span>
                    </div>
                    <div
                      className="kanban-dropzone"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        const data = e.dataTransfer.getData('text/plain')
                        if (!data) return
                        const { pId, tId } = JSON.parse(data)
                        if (pId && tId) updateTaskStatus(pId, tId, col)
                      }}
                    >
                      {colTasks.map((task) => {
                        const pColor = projects.find((p) => p.id === task.projectId)?.color || '#38bdf8'
                        return (
                          <div
                            key={task.id}
                            className="kanban-task-card"
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ pId: task.projectId, tId: task.id }))}
                          >
                            <div className="kanban-task-meta">
                              <span style={{ color: pColor, fontWeight: 600 }}>{task.projectName}</span>
                              <span>{task.dueDate}</span>
                            </div>
                            <div className="kanban-task-title">{task.title}</div>
                            {task.notes && (
                              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                📝 {task.notes}
                              </div>
                            )}
                            <div className="kanban-task-actions">
                              <button type="button" className="ghost-button small-button" onClick={() => startEditingTask(task.projectId, task as Task)}>עריכה</button>
                              <button type="button" className="ghost-button small-button" style={{ color: '#f87171' }} onClick={() => deleteTask(task.projectId, task.id)}>מחיקה</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </main>
      )}

      {/* ════════════════════ PROCESSES ════════════════════ */}
      {view === 'processes' && (
        <main className="board">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>ניהול תהליכים ויעדים</h2>
            <button type="button" className="primary-button" onClick={() => { setProjectForm({ name: '', description: '', color: '#3b82f6', milestones: '', kpis: '', stakeholders: '', targetDate: '' }); setShowProjectModal({ mode: 'create' }) }}>
              הוספת תהליך חדש
            </button>
          </div>
          {projects.map((project) => {
            const done = project.tasks.filter((t) => t.status === 'בוצע').length
            const pct = project.tasks.length === 0 ? 0 : Math.round((done / project.tasks.length) * 100)
            const barColor = progressColor(pct)

            return (
              <section className="panel process-card" key={project.id}>
                <div className="process-header" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div className="project-title" style={{ marginBottom: '8px' }}>
                      <span className="project-dot" style={{ backgroundColor: project.color }} />
                      <h3>{project.name}</h3>
                    </div>
                    {project.description && <p style={{ margin: '0 0 16px 0', maxWidth: '600px', lineHeight: 1.5 }}>{project.description}</p>}
                    <p className="muted-line">{done} מתוך {project.tasks.length} משימות הושלמו</p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <button type="button" className="primary-button small-button" onClick={() => openProjectTasks(project.id)}>מעבר למשימות</button>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="button" className="ghost-button small-button" onClick={() => { setProjectForm({ name: project.name, description: project.description || '', color: project.color, milestones: project.milestones || '', kpis: project.kpis || '', stakeholders: project.stakeholders || '', targetDate: project.targetDate || '' }); setShowProjectModal({ mode: 'edit', project }) }}>עריכה</button>
                      <button type="button" className="ghost-button small-button" style={{ color: '#f87171' }} onClick={() => deleteProject(project.id)}>מחיקה</button>
                    </div>
                  </div>
                </div>

                {/* שיפור 3 — dynamic progress bar */}
                <div style={{ margin: '16px 0 8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="progress-bar" style={{ flex: 1, margin: 0 }}>
                    <div className="progress-fill" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                  </div>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: barColor, minWidth: '38px', textAlign: 'left' }}>{pct}%</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginTop: '16px' }}>
                  {project.milestones && (
                    <div style={{ background: 'rgba(59, 130, 246, 0.03)', padding: '12px', borderRadius: '12px', border: '1px solid var(--surface-border)' }}>
                      <strong style={{ display: 'block', marginBottom: '8px', color: 'var(--primary)', fontSize: '14px' }}>🎯 אבני דרך</strong>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.4' }}>{project.milestones}</div>
                    </div>
                  )}
                  {(project.kpis || project.stakeholders || project.targetDate) && (
                    <div style={{ background: 'rgba(59, 130, 246, 0.03)', padding: '12px', borderRadius: '12px', border: '1px solid var(--surface-border)' }}>
                      <strong style={{ display: 'block', marginBottom: '8px', color: 'var(--primary)', fontSize: '14px' }}>📋 מדדים ושותפים</strong>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                        {project.targetDate && <div><strong>📅 יעד:</strong> {new Date(project.targetDate).toLocaleDateString('he-IL')}</div>}
                        {project.kpis && <div><strong>📊 KPIs:</strong> {project.kpis}</div>}
                        {project.stakeholders && <div><strong>👥 שותפים:</strong> {project.stakeholders}</div>}
                      </div>
                    </div>
                  )}
                </div>

                <div className="process-stats" style={{ marginTop: '16px' }}>
                  <span>{project.tasks.filter((t) => t.status === 'דחוף').length} דחופות</span>
                  <span>{project.tasks.filter((t) => t.status === 'ממתין').length} ממתינות</span>
                  <span>{project.tasks.filter((t) => t.owner === UNASSIGNED_OWNER).length} לא משויכות</span>
                </div>
              </section>
            )
          })}
        </main>
      )}

      {/* ════════════════════ INTEGRATIONS ════════════════════ */}
      {view === 'integrations' && (
        <main className="board">
          <div className="integration-grid">
            <section className="panel google-panel">
              <div className="section-head">
                <h3>חיבור Google</h3>
                <p>התחברות לחשבון לסנכרון עם Google Tasks ו-Google Calendar.</p>
              </div>
              {googleProfile ? (
                <div className="google-connected">
                  <div className="google-user">
                    {googleProfile.picture && <img src={googleProfile.picture} alt={googleProfile.name} className="google-avatar" />}
                    <div><strong>{googleProfile.name}</strong><p>{googleProfile.email}</p></div>
                  </div>
                  <button type="button" className="ghost-button" onClick={disconnectGoogle} disabled={googleTasksBusy}>התנתקות</button>
                </div>
              ) : GOOGLE_CLIENT_ID ? (
                <div className="google-signin-wrap">
                  <button type="button" className="primary-button" onClick={() => void connectGoogleProfile()} disabled={googleTasksBusy}>
                    {googleTasksBusy ? 'טוען...' : 'התחברות עם Google'}
                  </button>
                </div>
              ) : (
                <div className="info-box">
                  <strong>החיבור מוכן אבל חסר Client ID.</strong>
                  <p>הוסף `VITE_GOOGLE_CLIENT_ID` ל-.env</p>
                </div>
              )}
              {googleMessage && <p className="muted-line">{googleMessage}</p>}
            </section>

            <section className="panel microsoft-panel">
              <div className="section-head">
                <h3>סנכרון מיידי</h3>
                <p>ייצוא משימות ישירות ל-Google Tasks.</p>
              </div>
              {googleProfile ? (
                <div className="integration-stack">
                  <div className="microsoft-actions">
                    <select className="field-input compact" value={syncProjectId} onChange={(e) => setSyncProjectId(e.target.value)}>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <select className="field-input compact" value={selectedGoogleTaskListId} onChange={(e) => setSelectedGoogleTaskListId(e.target.value)}>
                      <option value="">בחר רשימת Google Tasks</option>
                      {googleTasksLists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                    </select>
                    <button type="button" className="ghost-button" onClick={() => void connectGoogleTasks()} disabled={googleTasksBusy}>{googleTasksBusy ? 'טוען...' : 'אישור Tasks'}</button>
                    <button type="button" className="ghost-button" onClick={() => void refreshGoogleTasksLists()} disabled={googleTasksBusy}>רענון</button>
                    <button type="button" className="primary-button" onClick={() => void syncProjectToGoogleTasks()} disabled={googleTasksBusy || !selectedGoogleTaskListId}>ייצוא</button>
                  </div>
                </div>
              ) : (
                <div className="info-box"><strong>יש להתחבר קודם לגוגל.</strong></div>
              )}
              {selectedGoogleTaskList && <p className="muted-line">רשימה: {selectedGoogleTaskList.title}</p>}
            </section>
          </div>
        </main>
      )}

      {/* ════════════════════ EVENTS ════════════════════ */}
      {view === 'events' && (
        <main className="board">
          <section className="panel calendar-panel">
            <div className="section-head">
              <h3>יומן</h3>
              <p>תצוגה שבועית עם אירועים מקומיים ו-Google Calendar.</p>
            </div>
            <div className="calendar-toolbar">
              <div className="mode-switch">
                <button type="button" className={calendarMode === 'week' ? 'tab-button active' : 'tab-button'} onClick={() => setCalendarMode('week')}>שבועי</button>
                <button type="button" className={calendarMode === 'day' ? 'tab-button active' : 'tab-button'} onClick={() => setCalendarMode('day')}>יומי</button>
              </div>
              <input className="field-input compact calendar-date-input" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
            </div>
            <div className={calendarMode === 'day' ? 'calendar-grid calendar-grid-day' : 'calendar-grid'}>
              {calendarEntries.map((entry) => (
                <article className="calendar-card" key={entry.date}>
                  <div className="calendar-card-head">
                    <h4>{entry.label}</h4>
                    <span>{entry.date}</span>
                  </div>
                  {entry.events.length > 0 || entry.googleEvents.length > 0 ? (
                    <div className="calendar-events-wrap">
                      {entry.events.map((item) => {
                        const p = projects.find((proj) => proj.id === item.projectId)
                        return (
                          <div className="calendar-event" key={item.id}>
                            <strong>{item.title}</strong>
                            <span>{p?.name ?? 'ללא תחום'}</span>
                          </div>
                        )
                      })}
                      {entry.googleEvents.map((item) => (
                        <div className="calendar-event" key={item.id} style={{ borderColor: '#4285F4', backgroundColor: 'rgba(66,133,244,0.1)' }}>
                          <strong>📅 {item.summary}</strong>
                          <span>Google Calendar</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-line">אין אירועים.</p>
                  )}
                </article>
              ))}
            </div>
          </section>

          <div className="event-layout">
            <section className="panel">
              <div className="section-head">
                <h3>הוספת אירוע</h3>
              </div>
              <form className="event-form" onSubmit={handleEventSubmit}>
                <input className="field-input" type="text" placeholder="שם האירוע" value={eventForm.title} onChange={(e) => setEventForm((c) => ({ ...c, title: e.target.value }))} />
                <input className="field-input" type="date" value={eventForm.date} onChange={(e) => setEventForm((c) => ({ ...c, date: e.target.value }))} />
                <select className="field-input" value={eventForm.projectId} onChange={(e) => setEventForm((c) => ({ ...c, projectId: e.target.value }))}>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <textarea className="field-input field-textarea" placeholder="תיאור" value={eventForm.description} onChange={(e) => setEventForm((c) => ({ ...c, description: e.target.value }))} />
                <button type="submit" className="primary-button">שמירת אירוע</button>
              </form>
            </section>
          </div>
        </main>
      )}

      {/* ════════════════════ ACTIVITY ════════════════════ */}
      {view === 'activity' && (
        <main className="board">
          <section className="panel">
            <div className="section-head">
              <h3>יומן פעולות</h3>
              <p>תיעוד אוטומטי של עריכות, אירועים וחיבורים.</p>
            </div>
            <div className="stack-list">
              {activity.map((item) => (
                <article className="list-card" key={item.id}>
                  <div className="list-card-head">
                    <h4>{item.action}</h4>
                    <span>{item.createdAt}</span>
                  </div>
                  <p>{item.details}</p>
                </article>
              ))}
            </div>
          </section>
        </main>
      )}

      {/* FAB */}
      <button className="fab-button" onClick={() => setShowGlobalAddModal('single')} title="הוספת משימה">+</button>

      {/* ════════ MODAL: Add task / bulk ════════ */}
      {showGlobalAddModal && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowGlobalAddModal(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-label="יצירת משימות" onClick={(e) => e.stopPropagation()}>
            <div className="section-head" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--surface-border)', paddingBottom: '16px', flexWrap: 'wrap' }}>
                <button type="button" className={showGlobalAddModal === 'single' ? 'tab-button active' : 'tab-button'} onClick={() => setShowGlobalAddModal('single')}>משימה בודדת</button>
                <button type="button" className={showGlobalAddModal === 'bulk' ? 'tab-button active' : 'tab-button'} onClick={() => setShowGlobalAddModal('bulk')}>ייבוא חכם</button>
                <button type="button" className="tab-button" style={{ color: 'var(--primary)', fontWeight: 600 }} onClick={() => { setShowGlobalAddModal(false); setProjectForm({ name: '', description: '', color: '#3b82f6', milestones: '', kpis: '', stakeholders: '', targetDate: '' }); setShowProjectModal({ mode: 'create' }) }}>+ תהליך חדש</button>
              </div>
            </div>

            {showGlobalAddModal === 'single' ? (
              <form className="event-form" onSubmit={(e) => { handleTaskSubmit(e); setShowGlobalAddModal(false) }}>
                <input className="field-input" type="text" placeholder="שם המשימה" required value={taskForm.title} onChange={(e) => setTaskForm((c) => ({ ...c, title: e.target.value }))} />
                <input className="field-input" type="date" required value={taskForm.dueDate} onChange={(e) => setTaskForm((c) => ({ ...c, dueDate: e.target.value }))} />
                <select className="field-input" value={taskForm.projectId} onChange={(e) => setTaskForm((c) => ({ ...c, projectId: e.target.value }))}>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="field-input" value={taskForm.status} onChange={(e) => setTaskForm((c) => ({ ...c, status: e.target.value as TaskStatus }))}>
                  {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <div className="modal-actions">
                  <button type="button" className="ghost-button" onClick={() => setShowGlobalAddModal(false)}>ביטול</button>
                  <button type="submit" className="primary-button">שמירת משימה</button>
                </div>
              </form>
            ) : (
              <form className="event-form" onSubmit={handleBulkImport}>
                <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                  <span>הדבק טקסט חופשי — כל שורה תהיה משימה</span>
                  <textarea className="field-input field-textarea" placeholder="- משימה א׳&#10;- משימה ב׳" value={bulkImportText} onChange={(e) => setBulkImportText(e.target.value)} style={{ minHeight: '180px' }} required />
                </div>
                <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                  <span>שיוך לתהליך</span>
                  <select className="field-input" value={bulkProjectId || projects[0]?.id || ''} onChange={(e) => setBulkProjectId(e.target.value)}>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="modal-actions" style={{ gridColumn: '1 / -1' }}>
                  <button type="button" className="ghost-button" onClick={() => setShowGlobalAddModal(false)}>ביטול</button>
                  <button type="submit" className="primary-button" disabled={!bulkImportText.trim()}>ייבוא</button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}

      {/* ════════ MODAL: Edit task ════════ */}
      {editingTask && (
        <div className="modal-backdrop" role="presentation" onClick={() => setEditingTask(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-label="עריכת משימה" onClick={(e) => e.stopPropagation()}>
            <div className="section-head">
              <h3>עריכת משימה</h3>
              <p>עדכן כותרת, בעלים, תאריך, סטטוס והערות.</p>
            </div>
            <form className="event-form" onSubmit={saveTaskEdits}>
              <input className="field-input" type="text" value={editingTask.title} onChange={(e) => setEditingTask((c) => c ? { ...c, title: e.target.value } : c)} />
              <input className="field-input" type="text" value={editingTask.owner} onChange={(e) => setEditingTask((c) => c ? { ...c, owner: e.target.value } : c)} placeholder="שם בעלים" />
              <input className="field-input" type="date" value={editingTask.dueDate} onChange={(e) => setEditingTask((c) => c ? { ...c, dueDate: e.target.value } : c)} />
              <select className="field-input" value={editingTask.status} onChange={(e) => setEditingTask((c) => c ? { ...c, status: e.target.value as TaskStatus } : c)}>
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>הערות</span>
                <textarea className="field-input field-textarea" style={{ minHeight: '80px' }} placeholder="הערות שוטפות..." value={editingTask.notes || ''} onChange={(e) => setEditingTask((c) => c ? { ...c, notes: e.target.value } : c)} />
                {editingTask.notesUpdatedAt && <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>עודכן: {editingTask.notesUpdatedAt}</span>}
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost-button" onClick={() => setEditingTask(null)}>ביטול</button>
                <button type="submit" className="primary-button">שמירת שינויים</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* ════════ MODAL: Project ════════ */}
      {showProjectModal && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowProjectModal(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-label="ניהול תהליך" onClick={(e) => e.stopPropagation()}>
            <div className="section-head">
              <h3>{showProjectModal.mode === 'create' ? 'יצירת תהליך חדש' : 'עריכת תהליך'}</h3>
            </div>
            <form className="event-form" onSubmit={handleProjectSubmit}>
              <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>שם התהליך</span>
                <input className="field-input" type="text" required placeholder="שם התהליך" value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} />
              </div>
              <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>מטרות ואסטרטגיה</span>
                <textarea className="field-input field-textarea" placeholder="פירוט..." value={projectForm.description} onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })} />
              </div>
              <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>אבני דרך</span>
                <textarea className="field-input field-textarea" style={{ minHeight: '60px' }} placeholder="אבני דרך..." value={projectForm.milestones} onChange={(e) => setProjectForm({ ...projectForm, milestones: e.target.value })} />
              </div>
              <div className="toolbar-field">
                <span>KPIs</span>
                <input className="field-input" type="text" placeholder="מדדים..." value={projectForm.kpis} onChange={(e) => setProjectForm({ ...projectForm, kpis: e.target.value })} />
              </div>
              <div className="toolbar-field">
                <span>שותפים</span>
                <input className="field-input" type="text" placeholder="גורמים..." value={projectForm.stakeholders} onChange={(e) => setProjectForm({ ...projectForm, stakeholders: e.target.value })} />
              </div>
              <div className="toolbar-field">
                <span>תאריך יעד</span>
                <input className="field-input" type="date" value={projectForm.targetDate} onChange={(e) => setProjectForm({ ...projectForm, targetDate: e.target.value })} />
              </div>
              <div className="toolbar-field">
                <span>צבע</span>
                <input className="field-input" type="color" style={{ height: '50px', padding: '4px' }} value={projectForm.color} onChange={(e) => setProjectForm({ ...projectForm, color: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost-button" onClick={() => setShowProjectModal(null)}>ביטול</button>
                <button type="submit" className="primary-button">{showProjectModal.mode === 'create' ? 'יצירת תהליך' : 'שמירת שינויים'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
