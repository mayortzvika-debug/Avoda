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

type Domain = {
  id: string
  name: string
  color: string
  tasks: Task[]
}

type Process = {
  id: string
  domainId: string
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
  domainId: string
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
  domains?: Domain[]
  processes?: Process[]
  events?: EventItem[]
  activity?: ActivityItem[]
  googleProfile?: GoogleProfile | null
  selectedGoogleTaskListId?: string
  googleEvents?: GoogleEvent[]
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

const STORAGE_KEY = 'bat-yam-hq-local-state-v7'
const OLD_STORAGE_KEY = 'bat-yam-hq-local-state-v6'
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

function sanitizeTasks(tasks: unknown[]): Task[] {
  if (!Array.isArray(tasks)) return []
  return tasks.map((t) => {
    const task = t as Task
    return { ...task, owner: task.owner || UNASSIGNED_OWNER, status: normalizeTaskStatus(task.status) }
  })
}

function sanitizeDomains(raw: unknown[]): Domain[] {
  if (!Array.isArray(raw)) return []
  return raw.map((d) => {
    const domain = d as Domain
    return { ...domain, tasks: sanitizeTasks(domain.tasks ?? []) }
  })
}

function sanitizeProcesses(raw: unknown[]): Process[] {
  if (!Array.isArray(raw)) return []
  return raw.map((p) => {
    const proc = p as Process
    return { ...proc, tasks: sanitizeTasks(proc.tasks ?? []) }
  })
}

function progressColor(pct: number): string {
  if (pct < 33) return '#ef4444'
  if (pct < 66) return '#f59e0b'
  return '#10b981'
}

// ─── Initial data ─────────────────────────────────────────────────────────────

const INITIAL_DOMAINS: Domain[] = [
  {
    id: 'd-100',
    name: '100 שנה לבת ים',
    color: '#7c3aed',
    tasks: [],
  },
  {
    id: 'd-young',
    name: 'אסטרטגיית צעירים',
    color: '#2563eb',
    tasks: [
      { id: 'young-1', title: 'שולחנות עגולים לתרבות ופנאי', dueDate: '2026-03-24', owner: UNASSIGNED_OWNER, status: 'דחוף' },
      { id: 'young-2', title: 'קידום סקר צעירים', dueDate: '2026-03-25', owner: UNASSIGNED_OWNER, status: 'בטיפול' },
      { id: 'young-3', title: 'תיאום עם מיכל פרויקטים', dueDate: '2026-03-25', owner: UNASSIGNED_OWNER, status: 'ממתין' },
    ],
  },
  {
    id: 'd-beach',
    name: 'חוף הים וחכ"ל',
    color: '#0f766e',
    tasks: [
      { id: 'beach-1', title: 'בניית תמונת מצב חוף כוללת', dueDate: '2026-03-24', owner: UNASSIGNED_OWNER, status: 'בטיפול' },
      { id: 'beach-2', title: 'תקציר מנהלים: אי מלאכותי', dueDate: '2026-03-26', owner: UNASSIGNED_OWNER, status: 'חדש' },
      { id: 'beach-3', title: 'בחינת פארק מים מתנפח', dueDate: '2026-03-26', owner: UNASSIGNED_OWNER, status: 'בטיפול' },
      { id: 'beach-4', title: 'פגישה עם נדל"ן שצ"פ נורדאו', dueDate: '2026-03-24', owner: UNASSIGNED_OWNER, status: 'ממתין' },
    ],
  },
  {
    id: 'd-mayor',
    name: 'לשכת ראש העיר',
    color: '#10b981',
    tasks: [],
  },
  {
    id: 'd-emergency',
    name: 'חירום',
    color: '#b91c1c',
    tasks: [
      { id: 'em-1', title: 'חינוך מיוחד - פעילות הפגה', dueDate: '2026-03-22', owner: UNASSIGNED_OWNER, status: 'דחוף' },
      { id: 'em-2', title: 'בדיקת ערכות מגן', dueDate: '2026-03-24', owner: UNASSIGNED_OWNER, status: 'בטיפול' },
      { id: 'em-3', title: "התקנת מערכת 'תמונת מצב' מבצעית", dueDate: '2026-03-22', owner: UNASSIGNED_OWNER, status: 'דחוף' },
    ],
  },
  {
    id: 'd-tzvika',
    name: 'נושאים לצביקה',
    color: '#f59e0b',
    tasks: [],
  },
]

const INITIAL_PROCESSES: Process[] = [
  {
    id: 'proc-100',
    domainId: 'd-100',
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
]

const INITIAL_EVENTS: EventItem[] = [
  {
    id: 'ev-1',
    title: 'ישיבת היערכות רבעונית',
    date: '2026-03-29',
    domainId: 'd-emergency',
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
  new Notification('Bat Yam HQ — חירום', {
    body: `יש ${urgentCount} משימות דחופות פתוחות בתחום חירום`,
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: 'emergency-daily',
  })
}

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

  // ── Dark mode ─────────────────────────────────────────────────────────────
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
  const [domains, setDomains] = useState<Domain[]>(INITIAL_DOMAINS)
  const [processes, setProcesses] = useState<Process[]>(INITIAL_PROCESSES)
  const [events, setEvents] = useState<EventItem[]>(INITIAL_EVENTS)
  const [activity, setActivity] = useState<ActivityItem[]>(INITIAL_ACTIVITY)
  const [googleProfile, setGoogleProfile] = useState<GoogleProfile | null>(null)
  const [googleEvents, setGoogleEvents] = useState<GoogleEvent[]>([])
  const [googleMessage, setGoogleMessage] = useState('')
  const [googleTasksLists, setGoogleTasksLists] = useState<GoogleTaskList[]>([])
  const [selectedGoogleTaskListId, setSelectedGoogleTaskListId] = useState('')
  const [syncSourceId, setSyncSourceId] = useState('d-100')
  const [googleTasksBusy, setGoogleTasksBusy] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [dashboardLayout, setDashboardLayout] = useState<'list' | 'kanban'>('kanban')
  const [showGlobalAddModal, setShowGlobalAddModal] = useState<false | 'single' | 'bulk'>(false)
  const [bulkImportText, setBulkImportText] = useState('')
  const [bulkDomainId, setBulkDomainId] = useState('')
  const [bulkProcessId, setBulkProcessId] = useState('')
  const [showProcessModal, setShowProcessModal] = useState<{ mode: 'create'; domainId: string } | { mode: 'edit'; process: Process } | null>(null)
  const [processForm, setProcessForm] = useState({ name: '', description: '', color: '#3b82f6', milestones: '', kpis: '', stakeholders: '', targetDate: '' })
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('week')
  const [selectedDate, setSelectedDate] = useState('2026-03-24')
  const [editingTask, setEditingTask] = useState<{
    domainId: string
    processId: string   // '' = direct domain task
    taskId: string
    title: string
    owner: string
    dueDate: string
    status: TaskStatus
    notes?: string
    notesUpdatedAt?: string
    newProcessId: string  // '' = direct, processId = in process (for reassignment)
  } | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'all' | TaskStatus>('all')
  const [filterDomain, setFilterDomain] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortField>('dueDate')
  const [taskForm, setTaskForm] = useState({ title: '', dueDate: '', domainId: INITIAL_DOMAINS[0].id, processId: '', status: DEFAULT_STATUS })
  const [eventForm, setEventForm] = useState({ title: '', date: '', domainId: INITIAL_DOMAINS[0].id, description: '' })

  // ── Load from localStorage ───────────────────────────────────────────────
  useEffect(() => {
    // Try new v7 key first
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as PersistedState
        if (parsed.domains?.length) setDomains(sanitizeDomains(parsed.domains))
        if (parsed.processes?.length) setProcesses(sanitizeProcesses(parsed.processes))
        if (parsed.events?.length) setEvents(parsed.events)
        if (parsed.activity?.length) setActivity(parsed.activity)
        if (parsed.googleProfile) setGoogleProfile(parsed.googleProfile)
        if (parsed.selectedGoogleTaskListId) setSelectedGoogleTaskListId(parsed.selectedGoogleTaskListId)
        if (parsed.googleEvents) setGoogleEvents(parsed.googleEvents)
        return
      } catch {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    }
    // Try migrating from v6
    const oldSaved = window.localStorage.getItem(OLD_STORAGE_KEY)
    if (oldSaved) {
      try {
        const parsed = JSON.parse(oldSaved) as { projects?: Array<{ id: string; name: string; color: string; tasks: Task[]; description?: string; milestones?: string; kpis?: string; stakeholders?: string; targetDate?: string }>; events?: Array<EventItem & { projectId?: string }>; activity?: ActivityItem[]; googleProfile?: GoogleProfile | null; selectedGoogleTaskListId?: string; googleEvents?: GoogleEvent[] }
        if (parsed.projects?.length) {
          // Map old projects to new structure
          const newDomains: Domain[] = INITIAL_DOMAINS.map((d) => ({ ...d, tasks: [] }))
          const newProcesses: Process[] = []
          for (const proj of parsed.projects) {
            if (proj.id === 'project-100') {
              newProcesses.push({ id: 'proc-100', domainId: 'd-100', name: proj.name, color: proj.color, description: proj.description, milestones: proj.milestones, kpis: proj.kpis, stakeholders: proj.stakeholders, targetDate: proj.targetDate, tasks: sanitizeTasks(proj.tasks) })
            } else {
              const domainMap: Record<string, string> = { beach: 'd-beach', young: 'd-young', tzvika: 'd-tzvika', mayor: 'd-mayor', emergency: 'd-emergency' }
              const did = domainMap[proj.id]
              if (did) {
                const idx = newDomains.findIndex((d) => d.id === did)
                if (idx !== -1) newDomains[idx] = { ...newDomains[idx], tasks: sanitizeTasks(proj.tasks) }
              }
            }
          }
          setDomains(newDomains)
          if (newProcesses.length) setProcesses(newProcesses)
        }
        if (parsed.events?.length) {
          const migratedEvents: EventItem[] = parsed.events.map((ev) => {
            const domainMap: Record<string, string> = { beach: 'd-beach', young: 'd-young', tzvika: 'd-tzvika', mayor: 'd-mayor', emergency: 'd-emergency', 'project-100': 'd-100' }
            return { ...ev, domainId: (ev as EventItem & { projectId?: string }).projectId ? (domainMap[(ev as EventItem & { projectId?: string }).projectId!] ?? 'd-mayor') : ev.domainId }
          })
          setEvents(migratedEvents)
        }
        if (parsed.activity?.length) setActivity(parsed.activity)
        if (parsed.googleProfile) setGoogleProfile(parsed.googleProfile)
        if (parsed.selectedGoogleTaskListId) setSelectedGoogleTaskListId(parsed.selectedGoogleTaskListId)
        if (parsed.googleEvents) setGoogleEvents(parsed.googleEvents)
      } catch {
        // ignore
      }
    }
  }, [])

  // ── Auto-save ────────────────────────────────────────────────────────────
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      domains, processes, events, activity, googleProfile, selectedGoogleTaskListId, googleEvents,
    }))
  }, [domains, processes, events, activity, googleProfile, selectedGoogleTaskListId, googleEvents])

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

  // ── PWA emergency notification ────────────────────────────────────────────
  const notifiedRef = useRef(false)
  useEffect(() => {
    if (notifiedRef.current) return
    const emergencyDomain = domains.find((d) => d.id === 'd-emergency')
    if (!emergencyDomain) return
    const urgentCount = emergencyDomain.tasks.filter((t) => t.status !== 'בוצע').length
    if (urgentCount > 0) {
      notifiedRef.current = true
      window.addEventListener('click', () => scheduleEmergencyNotification(urgentCount), { once: true })
    }
  }, [domains])

  // ─── Derived state ────────────────────────────────────────────────────────

  // Flat list of all tasks with domain/process info
  const allTasks = useMemo(() => [
    ...domains.flatMap((d) => d.tasks.map((t) => ({ ...t, domainId: d.id, domainName: d.name, domainColor: d.color, processId: '', processName: '' }))),
    ...processes.flatMap((p) => {
      const domain = domains.find((d) => d.id === p.domainId)
      return p.tasks.map((t) => ({ ...t, domainId: p.domainId, domainName: domain?.name ?? '', domainColor: domain?.color ?? p.color, processId: p.id, processName: p.name }))
    }),
  ], [domains, processes])

  const completedTasks = allTasks.filter((t) => t.status === 'בוצע').length
  const openTasks = allTasks.filter((t) => t.status !== 'בוצע').length
  const urgentTasks = allTasks.filter((t) => t.status === 'דחוף').length
  const unassignedTasks = allTasks.filter((t) => t.owner === UNASSIGNED_OWNER).length
  const progress = allTasks.length === 0 ? 0 : Math.round((completedTasks / allTasks.length) * 100)

  const sortedEvents = [...events].sort((a, b) => a.date.localeCompare(b.date))
  const weekDates = getWeekDates(selectedDate)

  const calendarEntries = (calendarMode === 'day' ? [selectedDate] : weekDates).map((date) => ({
    label: formatCalendarLabel(date),
    date,
    events: sortedEvents.filter((e) => e.date === date),
    googleEvents: googleEvents.filter((ge) => {
      const d = ge.start?.date || ge.start?.dateTime?.slice(0, 10)
      return d === date
    }),
  }))

  const selectedGoogleTaskList = googleTasksLists.find((l) => l.id === selectedGoogleTaskListId)

  // Processes filtered by domain
  const domainProcesses = useMemo(() => (domainId: string) => processes.filter((p) => p.domainId === domainId), [processes])

  // ─── Mutations ────────────────────────────────────────────────────────────

  const appendActivity = (action: string, details: string) =>
    setActivity((cur) => [{ id: createId('activity'), action, details, createdAt: getNowLabel() }, ...cur])

  // Update a task in domains or processes
  const updateTaskInPlace = (domainId: string, processId: string, taskId: string, updater: (t: Task) => Task) => {
    if (processId) {
      setProcesses((cur) => cur.map((p) =>
        p.id !== processId ? p : { ...p, tasks: p.tasks.map((t) => t.id === taskId ? updater(t) : t) }
      ))
    } else {
      setDomains((cur) => cur.map((d) =>
        d.id !== domainId ? d : { ...d, tasks: d.tasks.map((t) => t.id === taskId ? updater(t) : t) }
      ))
    }
  }

  const updateTaskStatus = (domainId: string, processId: string, taskId: string, nextStatus: TaskStatus) =>
    updateTaskInPlace(domainId, processId, taskId, (t) => ({ ...t, status: nextStatus }))

  const deleteTask = (domainId: string, processId: string, taskId: string) => {
    let title = ''
    if (processId) {
      setProcesses((cur) => cur.map((p) => {
        if (p.id !== processId) return p
        title = p.tasks.find((t) => t.id === taskId)?.title ?? ''
        return { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) }
      }))
    } else {
      setDomains((cur) => cur.map((d) => {
        if (d.id !== domainId) return d
        title = d.tasks.find((t) => t.id === taskId)?.title ?? ''
        return { ...d, tasks: d.tasks.filter((t) => t.id !== taskId) }
      }))
    }
    if (title) appendActivity('מחיקת משימה', `המשימה "${title}" נמחקה`)
  }

  const cycleStatus = (domainId: string, processId: string, taskId: string) => {
    const task = allTasks.find((t) => t.id === taskId)
    if (!task) return
    const nextStatus = STATUS_ORDER[(STATUS_ORDER.indexOf(task.status) + 1) % STATUS_ORDER.length]
    updateTaskStatus(domainId, processId, taskId, nextStatus)
    appendActivity('עדכון סטטוס', `${task.title} → ${nextStatus}`)
  }

  const handleTaskSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!taskForm.title.trim() || !taskForm.dueDate) return
    const next: Task = { id: createId('task'), title: taskForm.title.trim(), dueDate: taskForm.dueDate, owner: UNASSIGNED_OWNER, status: taskForm.status }
    if (taskForm.processId) {
      const proc = processes.find((p) => p.id === taskForm.processId)
      if (!proc) return
      setProcesses((cur) => cur.map((p) => p.id === taskForm.processId ? { ...p, tasks: [next, ...p.tasks] } : p))
      appendActivity('יצירת משימה', `נוספה "${next.title}" לתהליך ${proc.name}`)
    } else {
      const domain = domains.find((d) => d.id === taskForm.domainId)
      if (!domain) return
      setDomains((cur) => cur.map((d) => d.id === taskForm.domainId ? { ...d, tasks: [next, ...d.tasks] } : d))
      appendActivity('יצירת משימה', `נוספה "${next.title}" לתחום ${domain.name}`)
    }
    setTaskForm((cur) => ({ ...cur, title: '', dueDate: '', status: DEFAULT_STATUS }))
  }

  const handleEventSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!eventForm.title.trim() || !eventForm.date || !eventForm.description.trim()) return
    const domain = domains.find((d) => d.id === eventForm.domainId)
    const next: EventItem = { id: createId('event'), title: eventForm.title.trim(), date: eventForm.date, domainId: eventForm.domainId, description: eventForm.description.trim(), createdAt: getNowLabel() }
    setEvents((cur) => [next, ...cur])
    appendActivity('אירוע חדש', `נוסף "${next.title}" עבור ${domain?.name ?? '?'}`)
    setEventForm((cur) => ({ ...cur, title: '', date: '', description: '' }))
  }

  const handleProcessSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!processForm.name.trim()) return
    if (showProcessModal?.mode === 'create') {
      const p: Process = { id: createId('proc'), domainId: showProcessModal.domainId, name: processForm.name.trim(), color: processForm.color, description: processForm.description.trim() || undefined, milestones: processForm.milestones.trim() || undefined, kpis: processForm.kpis.trim() || undefined, stakeholders: processForm.stakeholders.trim() || undefined, targetDate: processForm.targetDate || undefined, tasks: [] }
      setProcesses((cur) => [...cur, p])
      appendActivity('תהליך חדש', `נוצר "${p.name}"`)
    } else if (showProcessModal?.mode === 'edit') {
      const proc = showProcessModal.process
      setProcesses((cur) => cur.map((p) =>
        p.id !== proc.id ? p : { ...p, name: processForm.name.trim(), description: processForm.description.trim() || undefined, color: processForm.color, milestones: processForm.milestones.trim() || undefined, kpis: processForm.kpis.trim() || undefined, stakeholders: processForm.stakeholders.trim() || undefined, targetDate: processForm.targetDate || undefined }
      ))
      appendActivity('עדכון תהליך', `"${processForm.name}" עודכן`)
    }
    setShowProcessModal(null)
  }

  const deleteProcess = (processId: string) => {
    const proc = processes.find((p) => p.id === processId)
    if (!proc) return
    if (!confirm('למחוק תהליך זה? המשימות יועברו לתחום הישיר.')) return
    // Move tasks to domain direct tasks
    if (proc.tasks.length > 0) {
      setDomains((cur) => cur.map((d) =>
        d.id !== proc.domainId ? d : { ...d, tasks: [...proc.tasks, ...d.tasks] }
      ))
    }
    setProcesses((cur) => cur.filter((p) => p.id !== processId))
    appendActivity('מחיקת תהליך', `"${proc.name}" נמחק`)
  }

  const handleBulkImport = (e: React.FormEvent) => {
    e.preventDefault()
    const targetDomainId = bulkDomainId || domains[0]?.id
    if (!bulkImportText.trim() || !targetDomainId) return
    const lines = bulkImportText.split('\n').map((l) => l.replace(/^[-*•\d.\s[\]]+/, '').trim()).filter(Boolean)
    if (!lines.length) return
    const newTasks: Task[] = lines.map((title) => ({ id: createId('task-bulk'), title, status: DEFAULT_STATUS, dueDate: new Date().toISOString().slice(0, 10), owner: UNASSIGNED_OWNER }))
    if (bulkProcessId) {
      setProcesses((cur) => cur.map((p) => p.id === bulkProcessId ? { ...p, tasks: [...newTasks, ...p.tasks] } : p))
    } else {
      setDomains((cur) => cur.map((d) => d.id === targetDomainId ? { ...d, tasks: [...newTasks, ...d.tasks] } : d))
    }
    appendActivity('ייבוא המוני', `יובאו ${newTasks.length} משימות`)
    setShowGlobalAddModal(false)
    setBulkImportText('')
    setBulkDomainId('')
    setBulkProcessId('')
  }

  const resetFilters = () => { setFilterDomain('all'); setFilterStatus('all'); setSortBy('dueDate') }

  const startEditingTask = (domainId: string, processId: string, task: Task) =>
    setEditingTask({ domainId, processId, taskId: task.id, title: task.title, owner: task.owner, dueDate: task.dueDate, status: task.status, notes: task.notes || '', notesUpdatedAt: task.notesUpdatedAt, newProcessId: processId })

  const saveTaskEdits = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editingTask) return
    const { domainId, processId, taskId, newProcessId } = editingTask
    const updated: Task = {
      id: taskId,
      title: editingTask.title.trim(),
      owner: editingTask.owner.trim() || UNASSIGNED_OWNER,
      dueDate: editingTask.dueDate,
      status: editingTask.status,
      notes: editingTask.notes?.trim() || undefined,
      notesUpdatedAt: editingTask.notes !== (allTasks.find((t) => t.id === taskId)?.notes || '') ? getNowLabel() : editingTask.notesUpdatedAt,
    }
    if (!updated.title || !updated.dueDate) return

    const isMoving = newProcessId !== processId
    if (!isMoving) {
      // In-place update
      updateTaskInPlace(domainId, processId, taskId, () => updated)
    } else {
      // Remove from old container, add to new container
      if (processId) {
        setProcesses((cur) => cur.map((p) => p.id !== processId ? p : { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) }))
      } else {
        setDomains((cur) => cur.map((d) => d.id !== domainId ? d : { ...d, tasks: d.tasks.filter((t) => t.id !== taskId) }))
      }
      if (newProcessId) {
        setProcesses((cur) => cur.map((p) => p.id !== newProcessId ? p : { ...p, tasks: [updated, ...p.tasks] }))
      } else {
        setDomains((cur) => cur.map((d) => d.id !== domainId ? d : { ...d, tasks: [updated, ...d.tasks] }))
      }
    }
    appendActivity('עריכת משימה', `עודכנה "${updated.title}"`)
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

  const syncToGoogleTasks = async () => {
    if (!selectedGoogleTaskListId) { setGoogleMessage('יש לבחור רשימה.'); return }
    setGoogleTasksBusy(true)
    try {
      // Collect tasks from the selected source
      const sourceDomain = domains.find((d) => d.id === syncSourceId)
      const sourceProcess = processes.find((p) => p.id === syncSourceId)
      const sourceName = sourceDomain?.name ?? sourceProcess?.name ?? 'לא ידוע'
      const sourceTasks = sourceDomain
        ? [...sourceDomain.tasks, ...processes.filter((p) => p.domainId === sourceDomain.id).flatMap((p) => p.tasks)]
        : (sourceProcess?.tasks ?? [])
      const existing = await googleApiRequest<{ items?: Array<{ title: string }> }>(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(selectedGoogleTaskListId)}/tasks?showCompleted=true&showHidden=true&maxResults=100`)
      const existingTitles = new Set((existing.items ?? []).map((t) => t.title))
      const pending = sourceTasks.filter((t) => !existingTitles.has(`${sourceName} | ${t.title}`))
      await Promise.all(pending.map((t) => googleApiRequest(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(selectedGoogleTaskListId)}/tasks`, { method: 'POST', body: JSON.stringify({ title: `${sourceName} | ${t.title}`, notes: `בעלים: ${t.owner}\nסטטוס: ${t.status}`, due: new Date(`${t.dueDate}T09:00:00`).toISOString(), status: t.status === 'בוצע' ? 'completed' : 'needsAction', ...(t.status === 'בוצע' ? { completed: new Date().toISOString() } : {}) }) })))
      setGoogleMessage(pending.length > 0 ? `יוצאו ${pending.length} משימות` : 'אין משימות חדשות לייצוא')
      appendActivity('סנכרון Tasks', `ייצא ${pending.length} משימות מ-${sourceName}`)
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

  // For dashboard list view: per-domain view
  const visibleDomains = useMemo(() => {
    return domains
      .filter((d) => filterDomain === 'all' || d.id === filterDomain)
      .map((d) => {
        let directTasks = filterStatus === 'all' ? d.tasks : d.tasks.filter((t) => t.status === filterStatus)
        if (!showCompleted) directTasks = directTasks.filter((t) => t.status !== 'בוצע')
        directTasks = sortTasks(directTasks, sortBy)
        const domainProcs = processes
          .filter((p) => p.domainId === d.id)
          .map((p) => {
            let procTasks = filterStatus === 'all' ? p.tasks : p.tasks.filter((t) => t.status === filterStatus)
            if (!showCompleted) procTasks = procTasks.filter((t) => t.status !== 'בוצע')
            procTasks = sortTasks(procTasks, sortBy)
            return { ...p, tasks: procTasks }
          })
          .filter((p) => p.tasks.length > 0)
        return { ...d, tasks: directTasks, domainProcs }
      })
      .filter((d) => d.tasks.length > 0 || d.domainProcs.length > 0)
  }, [domains, processes, filterDomain, filterStatus, showCompleted, sortBy])

  const openEditProcessModal = (proc: Process) => {
    setProcessForm({ name: proc.name, description: proc.description || '', color: proc.color, milestones: proc.milestones || '', kpis: proc.kpis || '', stakeholders: proc.stakeholders || '', targetDate: proc.targetDate || '' })
    setShowProcessModal({ mode: 'edit', process: proc })
  }

  const openCreateProcessModal = (domainId: string) => {
    setProcessForm({ name: '', description: '', color: '#3b82f6', milestones: '', kpis: '', stakeholders: '', targetDate: '' })
    setShowProcessModal({ mode: 'create', domainId })
  }

  const TaskRow = ({ task, domainId, processId, domainColor }: { task: Task; domainId: string; processId: string; domainColor: string }) => {
    const meta = STATUS_META[normalizeTaskStatus(task.status)]
    const isDone = task.status === 'בוצע'
    return (
      <article className="task-row" key={task.id} style={{ opacity: isDone ? 0.6 : 1 }}>
        <div className="task-main-wrap">
          <input
            type="checkbox"
            className="task-list-checkbox"
            checked={isDone}
            onChange={(e) => updateTaskStatus(domainId, processId, task.id, e.target.checked ? 'בוצע' : DEFAULT_STATUS)}
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
          <button type="button" className="ghost-button small-button" onClick={() => startEditingTask(domainId, processId, task)}>עריכה</button>
          <button type="button" className="ghost-button small-button" style={{ color: '#f87171' }} onClick={() => deleteTask(domainId, processId, task.id)}>מחיקה</button>
          <button type="button" className={`status-pill ${meta.tone}`} onClick={() => cycleStatus(domainId, processId, task.id)} style={{ borderColor: domainColor }}>{meta.label}</button>
        </div>
      </article>
    )
  }

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
              <p>סינון לפי תחום ותהליך, תצוגת רשימה היררכית ותצוגת קנבן.</p>
            </div>
            <div className="hero-metrics">
              <span>פתוחות: {openTasks}</span>
              <span>דחופות: {urgentTasks}</span>
              <span>לא משויכות: {unassignedTasks}</span>
            </div>
          </section>

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
                  <select className="field-input compact" value={filterDomain} onChange={(e) => setFilterDomain(e.target.value)}>
                    <option value="all">כל התחומים</option>
                    {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
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

          {/* List view — domain → process → tasks hierarchy */}
          {dashboardLayout === 'list' ? (
            visibleDomains.map((domain) => {
              const domainAllTasks = [...domain.tasks, ...domain.domainProcs.flatMap((p) => p.tasks)]
              const donePct = domainAllTasks.length === 0 ? 0 : Math.round((domainAllTasks.filter((t) => t.status === 'בוצע').length / domainAllTasks.length) * 100)
              const barColor = progressColor(donePct)
              return (
                <section className="project-card" key={domain.id} style={{ borderTop: `4px solid ${domain.color}` }}>
                  <div className="project-header">
                    <div className="project-title">
                      <span className="project-dot" style={{ backgroundColor: domain.color }} />
                      <h3>{domain.name}</h3>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '80px', height: '6px', background: 'var(--surface-border)', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${donePct}%`, background: barColor, borderRadius: '999px', transition: 'width 0.6s ease' }} />
                        </div>
                        <span style={{ fontSize: '12px', color: barColor, fontWeight: 700 }}>{donePct}%</span>
                      </div>
                      <span className="task-count">{domainAllTasks.length} פריטים</span>
                    </div>
                  </div>

                  {/* Direct domain tasks */}
                  {domain.tasks.length > 0 && (
                    <div className="task-list">
                      {domain.tasks.map((task) => (
                        <TaskRow key={task.id} task={task} domainId={domain.id} processId="" domainColor={domain.color} />
                      ))}
                    </div>
                  )}

                  {/* Processes within domain */}
                  {domain.domainProcs.map((proc) => (
                    <div key={proc.id} style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed var(--surface-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: proc.color, display: 'inline-block' }} />
                        <span style={{ fontWeight: 600, fontSize: '14px' }}>תהליך: {proc.name}</span>
                        <span className="task-count" style={{ marginRight: 'auto' }}>{proc.tasks.length} משימות</span>
                      </div>
                      <div className="task-list">
                        {proc.tasks.map((task) => (
                          <TaskRow key={task.id} task={task} domainId={domain.id} processId={proc.id} domainColor={proc.color} />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              )
            })
          ) : (
            /* Kanban view */
            <div className="kanban-board">
              {STATUS_ORDER.map((col) => {
                const colTasks = allTasks.filter(
                  (t) => t.status === col &&
                    (filterDomain === 'all' || t.domainId === filterDomain) &&
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
                        const { dId, pId, tId } = JSON.parse(data)
                        if (tId) updateTaskStatus(dId, pId ?? '', tId, col)
                      }}
                    >
                      {colTasks.map((task) => (
                        <div
                          key={task.id}
                          className="kanban-task-card"
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ dId: task.domainId, pId: task.processId || null, tId: task.id }))}
                        >
                          <div className="kanban-task-meta">
                            <span style={{ color: task.domainColor, fontWeight: 600 }}>{task.processName ? `${task.domainName} / ${task.processName}` : task.domainName}</span>
                            <span>{task.dueDate}</span>
                          </div>
                          <div className="kanban-task-title">{task.title}</div>
                          {task.notes && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              📝 {task.notes}
                            </div>
                          )}
                          <div className="kanban-task-actions">
                            <button type="button" className="ghost-button small-button" onClick={() => startEditingTask(task.domainId, task.processId, task as Task)}>עריכה</button>
                            <button type="button" className="ghost-button small-button" style={{ color: '#f87171' }} onClick={() => deleteTask(task.domainId, task.processId, task.id)}>מחיקה</button>
                          </div>
                        </div>
                      ))}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h2 style={{ margin: 0 }}>ניהול תהליכים לפי תחומים</h2>
          </div>

          {domains.map((domain) => {
            const domainProcs = domainProcesses(domain.id)
            return (
              <section key={domain.id} style={{ marginBottom: '32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', borderBottom: `3px solid ${domain.color}`, paddingBottom: '10px' }}>
                  <span style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: domain.color, display: 'inline-block' }} />
                  <h3 style={{ margin: 0, fontSize: '18px' }}>{domain.name}</h3>
                  <span className="task-count">{domain.tasks.length} משימות ישירות</span>
                  <button
                    type="button"
                    className="primary-button small-button"
                    style={{ marginRight: 'auto', backgroundColor: domain.color }}
                    onClick={() => openCreateProcessModal(domain.id)}
                  >
                    + תהליך חדש
                  </button>
                </div>

                {domainProcs.length === 0 && (
                  <p className="muted-line" style={{ paddingRight: '8px' }}>אין תהליכים בתחום זה.</p>
                )}

                {domainProcs.map((proc) => {
                  const done = proc.tasks.filter((t) => t.status === 'בוצע').length
                  const pct = proc.tasks.length === 0 ? 0 : Math.round((done / proc.tasks.length) * 100)
                  const barColor = progressColor(pct)

                  return (
                    <section className="panel process-card" key={proc.id} style={{ marginBottom: '16px' }}>
                      <div className="process-header" style={{ alignItems: 'flex-start' }}>
                        <div>
                          <div className="project-title" style={{ marginBottom: '8px' }}>
                            <span className="project-dot" style={{ backgroundColor: proc.color }} />
                            <h4 style={{ margin: 0 }}>{proc.name}</h4>
                          </div>
                          {proc.description && <p style={{ margin: '0 0 12px 0', maxWidth: '600px', lineHeight: 1.5, fontSize: '14px' }}>{proc.description}</p>}
                          <p className="muted-line">{done} מתוך {proc.tasks.length} משימות הושלמו</p>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexDirection: 'column', alignItems: 'flex-end' }}>
                          <button type="button" className="primary-button small-button" onClick={() => { setFilterDomain(domain.id); setView('dashboard') }}>מעבר למשימות</button>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button type="button" className="ghost-button small-button" onClick={() => openEditProcessModal(proc)}>עריכה</button>
                            <button type="button" className="ghost-button small-button" style={{ color: '#f87171' }} onClick={() => deleteProcess(proc.id)}>מחיקה</button>
                          </div>
                        </div>
                      </div>

                      <div style={{ margin: '12px 0 8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div className="progress-bar" style={{ flex: 1, margin: 0 }}>
                          <div className="progress-fill" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                        </div>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: barColor, minWidth: '38px', textAlign: 'left' }}>{pct}%</span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '12px' }}>
                        {proc.milestones && (
                          <div style={{ background: 'rgba(59, 130, 246, 0.03)', padding: '12px', borderRadius: '12px', border: '1px solid var(--surface-border)' }}>
                            <strong style={{ display: 'block', marginBottom: '8px', color: 'var(--primary)', fontSize: '13px' }}>🎯 אבני דרך</strong>
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.4' }}>{proc.milestones}</div>
                          </div>
                        )}
                        {(proc.kpis || proc.stakeholders || proc.targetDate) && (
                          <div style={{ background: 'rgba(59, 130, 246, 0.03)', padding: '12px', borderRadius: '12px', border: '1px solid var(--surface-border)' }}>
                            <strong style={{ display: 'block', marginBottom: '8px', color: 'var(--primary)', fontSize: '13px' }}>📋 מדדים ושותפים</strong>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
                              {proc.targetDate && <div><strong>📅 יעד:</strong> {new Date(proc.targetDate).toLocaleDateString('he-IL')}</div>}
                              {proc.kpis && <div><strong>📊 KPIs:</strong> {proc.kpis}</div>}
                              {proc.stakeholders && <div><strong>👥 שותפים:</strong> {proc.stakeholders}</div>}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="process-stats" style={{ marginTop: '12px' }}>
                        <span>{proc.tasks.filter((t) => t.status === 'דחוף').length} דחופות</span>
                        <span>{proc.tasks.filter((t) => t.status === 'ממתין').length} ממתינות</span>
                        <span>{proc.tasks.filter((t) => t.owner === UNASSIGNED_OWNER).length} לא משויכות</span>
                      </div>
                    </section>
                  )
                })}
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
                    <select className="field-input compact" value={syncSourceId} onChange={(e) => setSyncSourceId(e.target.value)}>
                      <optgroup label="תחומים">
                        {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </optgroup>
                      <optgroup label="תהליכים">
                        {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </optgroup>
                    </select>
                    <select className="field-input compact" value={selectedGoogleTaskListId} onChange={(e) => setSelectedGoogleTaskListId(e.target.value)}>
                      <option value="">בחר רשימת Google Tasks</option>
                      {googleTasksLists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                    </select>
                    <button type="button" className="ghost-button" onClick={() => void connectGoogleTasks()} disabled={googleTasksBusy}>{googleTasksBusy ? 'טוען...' : 'אישור Tasks'}</button>
                    <button type="button" className="ghost-button" onClick={() => void refreshGoogleTasksLists()} disabled={googleTasksBusy}>רענון</button>
                    <button type="button" className="primary-button" onClick={() => void syncToGoogleTasks()} disabled={googleTasksBusy || !selectedGoogleTaskListId}>ייצוא</button>
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
                        const d = domains.find((dom) => dom.id === item.domainId)
                        return (
                          <div className="calendar-event" key={item.id}>
                            <strong>{item.title}</strong>
                            <span>{d?.name ?? 'ללא תחום'}</span>
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
                <select className="field-input" value={eventForm.domainId} onChange={(e) => setEventForm((c) => ({ ...c, domainId: e.target.value }))}>
                  {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
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
                <button type="button" className="tab-button" style={{ color: 'var(--primary)', fontWeight: 600 }} onClick={() => { setShowGlobalAddModal(false); openCreateProcessModal(domains[0]?.id) }}>+ תהליך חדש</button>
              </div>
            </div>

            {showGlobalAddModal === 'single' ? (
              <form className="event-form" onSubmit={(e) => { handleTaskSubmit(e); setShowGlobalAddModal(false) }}>
                <label className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                  <span>שם המשימה</span>
                  <input className="field-input" type="text" placeholder="שם המשימה" required value={taskForm.title} onChange={(e) => setTaskForm((c) => ({ ...c, title: e.target.value }))} />
                </label>
                <label className="toolbar-field">
                  <span>תאריך יעד</span>
                  <input className="field-input" type="date" required value={taskForm.dueDate} onChange={(e) => setTaskForm((c) => ({ ...c, dueDate: e.target.value }))} />
                </label>
                <label className="toolbar-field">
                  <span>תחום</span>
                  <select className="field-input" value={taskForm.domainId} onChange={(e) => setTaskForm((c) => ({ ...c, domainId: e.target.value, processId: '' }))}>
                    {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
                <label className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                  <span>תהליך (לא חובה)</span>
                  <select className="field-input" value={taskForm.processId} onChange={(e) => setTaskForm((c) => ({ ...c, processId: e.target.value }))}>
                    <option value="">— ללא תהליך (ישיר לתחום) —</option>
                    {processes.filter((p) => p.domainId === taskForm.domainId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="toolbar-field">
                  <span>סטטוס</span>
                  <select className="field-input" value={taskForm.status} onChange={(e) => setTaskForm((c) => ({ ...c, status: e.target.value as TaskStatus }))}>
                    {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <div className="modal-actions" style={{ gridColumn: '1 / -1' }}>
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
                <div className="toolbar-field">
                  <span>תחום</span>
                  <select className="field-input" value={bulkDomainId || domains[0]?.id || ''} onChange={(e) => { setBulkDomainId(e.target.value); setBulkProcessId('') }}>
                    {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="toolbar-field">
                  <span>תהליך (לא חובה)</span>
                  <select className="field-input" value={bulkProcessId} onChange={(e) => setBulkProcessId(e.target.value)}>
                    <option value="">— ללא תהליך —</option>
                    {processes.filter((p) => p.domainId === (bulkDomainId || domains[0]?.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
            </div>
            <form className="event-form" onSubmit={saveTaskEdits}>
              <label className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>כותרת</span>
                <input className="field-input" type="text" value={editingTask.title} onChange={(e) => setEditingTask((c) => c ? { ...c, title: e.target.value } : c)} />
              </label>
              <label className="toolbar-field">
                <span>בעלים</span>
                <input className="field-input" type="text" value={editingTask.owner} onChange={(e) => setEditingTask((c) => c ? { ...c, owner: e.target.value } : c)} placeholder="שם בעלים" />
              </label>
              <label className="toolbar-field">
                <span>תאריך יעד</span>
                <input className="field-input" type="date" value={editingTask.dueDate} onChange={(e) => setEditingTask((c) => c ? { ...c, dueDate: e.target.value } : c)} />
              </label>
              <label className="toolbar-field">
                <span>סטטוס</span>
                <select className="field-input" value={editingTask.status} onChange={(e) => setEditingTask((c) => c ? { ...c, status: e.target.value as TaskStatus } : c)}>
                  {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>שיוך לתהליך (לא חובה)</span>
                <select className="field-input" value={editingTask.newProcessId} onChange={(e) => setEditingTask((c) => c ? { ...c, newProcessId: e.target.value } : c)}>
                  <option value="">— ללא תהליך (ישיר לתחום) —</option>
                  {processes.filter((p) => p.domainId === editingTask.domainId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>הערות</span>
                <textarea className="field-input field-textarea" style={{ minHeight: '80px' }} placeholder="הערות שוטפות..." value={editingTask.notes || ''} onChange={(e) => setEditingTask((c) => c ? { ...c, notes: e.target.value } : c)} />
                {editingTask.notesUpdatedAt && <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>עודכן: {editingTask.notesUpdatedAt}</span>}
              </div>
              <div className="modal-actions" style={{ gridColumn: '1 / -1' }}>
                <button type="button" className="ghost-button" onClick={() => setEditingTask(null)}>ביטול</button>
                <button type="submit" className="primary-button">שמירת שינויים</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* ════════ MODAL: Process ════════ */}
      {showProcessModal && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowProcessModal(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-label="ניהול תהליך" onClick={(e) => e.stopPropagation()}>
            <div className="section-head">
              <h3>{showProcessModal.mode === 'create' ? 'יצירת תהליך חדש' : 'עריכת תהליך'}</h3>
              {showProcessModal.mode === 'create' && (
                <p>
                  {domains.find((d) => d.id === showProcessModal.domainId)?.name}
                  {' '}
                  <select
                    className="field-input compact"
                    style={{ display: 'inline-block', width: 'auto', marginRight: '4px' }}
                    value={showProcessModal.domainId}
                    onChange={(e) => setShowProcessModal({ mode: 'create', domainId: e.target.value })}
                  >
                    {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </p>
              )}
            </div>
            <form className="event-form" onSubmit={handleProcessSubmit}>
              <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>שם התהליך</span>
                <input className="field-input" type="text" required placeholder="שם התהליך" value={processForm.name} onChange={(e) => setProcessForm({ ...processForm, name: e.target.value })} />
              </div>
              <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>מטרות ואסטרטגיה</span>
                <textarea className="field-input field-textarea" placeholder="פירוט..." value={processForm.description} onChange={(e) => setProcessForm({ ...processForm, description: e.target.value })} />
              </div>
              <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>אבני דרך</span>
                <textarea className="field-input field-textarea" style={{ minHeight: '60px' }} placeholder="אבני דרך..." value={processForm.milestones} onChange={(e) => setProcessForm({ ...processForm, milestones: e.target.value })} />
              </div>
              <div className="toolbar-field">
                <span>KPIs</span>
                <input className="field-input" type="text" placeholder="מדדים..." value={processForm.kpis} onChange={(e) => setProcessForm({ ...processForm, kpis: e.target.value })} />
              </div>
              <div className="toolbar-field">
                <span>שותפים</span>
                <input className="field-input" type="text" placeholder="גורמים..." value={processForm.stakeholders} onChange={(e) => setProcessForm({ ...processForm, stakeholders: e.target.value })} />
              </div>
              <div className="toolbar-field">
                <span>תאריך יעד</span>
                <input className="field-input" type="date" value={processForm.targetDate} onChange={(e) => setProcessForm({ ...processForm, targetDate: e.target.value })} />
              </div>
              <div className="toolbar-field">
                <span>צבע</span>
                <input className="field-input" type="color" style={{ height: '50px', padding: '4px' }} value={processForm.color} onChange={(e) => setProcessForm({ ...processForm, color: e.target.value })} />
              </div>
              <div className="modal-actions" style={{ gridColumn: '1 / -1' }}>
                <button type="button" className="ghost-button" onClick={() => setShowProcessModal(null)}>ביטול</button>
                <button type="submit" className="primary-button">{showProcessModal.mode === 'create' ? 'יצירת תהליך' : 'שמירת שינויים'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
