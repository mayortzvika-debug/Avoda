import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type TaskStatus = 'חדש' | 'בטיפול' | 'ממתין' | 'דחוף' | 'בוצע'
type View = 'dashboard' | 'processes' | 'events' | 'integrations' | 'activity'
type CalendarMode = 'week' | 'day'

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

const STORAGE_KEY = 'bat-yam-hq-local-state-v5'
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
    tasks: Array.isArray(project.tasks) ? project.tasks.map((task) => ({
      ...task,
      owner: task.owner || UNASSIGNED_OWNER,
      status: normalizeTaskStatus(task.status),
    })) : [],
  }))
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
    const currentDate = new Date(startDate)
    currentDate.setDate(startDate.getDate() + index)
    return currentDate.toISOString().slice(0, 10)
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
    script.addEventListener(
      'load',
      () => {
        script.dataset.ready = 'true'
        resolve()
      },
      { once: true },
    )
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true })
    document.body.appendChild(script)
  })
}

function App() {
  const googleTokenClientRef = useRef<ReturnType<NonNullable<NonNullable<NonNullable<typeof window.google>['accounts']>['oauth2']>['initTokenClient']> | null>(null)
  const googleAccessTokenRef = useRef('')

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
  const [showProjectModal, setShowProjectModal] = useState<{ mode: 'create' | 'edit', project?: Project } | null>(null)
  const [projectForm, setProjectForm] = useState({ name: '', description: '', color: '#3b82f6', milestones: '', kpis: '', stakeholders: '', targetDate: '' })
  const [filter, setFilter] = useState<'all' | TaskStatus>('all')
  const [focusedProjectId, setFocusedProjectId] = useState<string | 'all'>('all')
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('week')
  const [selectedDate, setSelectedDate] = useState('2026-03-24')
  const [taskForm, setTaskForm] = useState({
    title: '',
    dueDate: '',
    projectId: INITIAL_PROJECTS[0].id,
    status: DEFAULT_STATUS,
  })
  const [eventForm, setEventForm] = useState({
    title: '',
    date: '',
    projectId: INITIAL_PROJECTS[0].id,
    description: '',
  })
  const [editingTask, setEditingTask] = useState<{
    projectId: string
    taskId: string
    title: string
    owner: string
    dueDate: string
    status: TaskStatus
    notes?: string
    notesUpdatedAt?: string
  } | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  useEffect(() => {
    const savedState = window.localStorage.getItem(STORAGE_KEY)
    if (!savedState) return

    try {
      const parsed = JSON.parse(savedState) as PersistedState

      if (parsed.projects?.length) {
        const loadedProjects = sanitizeProjects(parsed.projects)
        const hasTzvika = loadedProjects.some((p) => p.id === 'tzvika')
        if (!hasTzvika) {
          loadedProjects.push({ id: 'tzvika', name: 'צביקה', color: '#f59e0b', tasks: [] })
          loadedProjects.push({ id: 'mayor', name: 'לשכת ראש העיר', color: '#10b981', tasks: [] })
          const emIdx = loadedProjects.findIndex((p) => p.id === 'emergency')
          if (emIdx !== -1) {
            const em = loadedProjects.splice(emIdx, 1)[0]
            loadedProjects.push(em)
          }
        }
        setProjects(loadedProjects)
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

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ projects, events, activity, googleProfile, selectedGoogleTaskListId, googleEvents }),
    )
  }, [projects, events, activity, googleProfile, selectedGoogleTaskListId, googleEvents])

  useEffect(() => {
    if (googleProfile && GOOGLE_CLIENT_ID) {
      ensureGoogleServices().then(() => {
        if (!googleAccessTokenRef.current) {
          requestGoogleAccessToken('').then(() => refreshGoogleTasksContext()).catch(() => {})
        }
      }).catch(() => {})
    }
  }, [googleProfile])

  const appendActivity = (action: string, details: string) => {
    setActivity((current) => [
      {
        id: createId('activity'),
        action,
        details,
        createdAt: getNowLabel(),
      },
      ...current,
    ])
  }

  const ensureGoogleServices = async () => {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('חסר VITE_GOOGLE_CLIENT_ID')
    }

    await loadScript('google-identity-services', 'https://accounts.google.com/gsi/client')

    if (!window.google?.accounts?.oauth2) {
      throw new Error('טעינת שירות Google נכשלה.')
    }

    if (!googleTokenClientRef.current) {
      googleTokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_TASKS_SCOPES,
      })
    }
  }

  const requestGoogleAccessToken = async (prompt: '' | 'consent' = '') => {
    await ensureGoogleServices()

    if (!googleTokenClientRef.current) {
      throw new Error('חיבור Google Tasks לא זמין כרגע.')
    }

    return new Promise<string>((resolve, reject) => {
      googleTokenClientRef.current!.callback = (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'חיבור Google Tasks נכשל.'))
          return
        }

        googleAccessTokenRef.current = response.access_token
        resolve(response.access_token)
      }

      googleTokenClientRef.current!.error_callback = () => {
        reject(new Error('אישור Google Tasks בוטל או נכשל.'))
      }

      googleTokenClientRef.current!.requestAccessToken({
        prompt: googleAccessTokenRef.current ? '' : prompt || 'consent',
      })
    })
  }

  const googleApiRequest = async <T,>(url: string, init?: RequestInit) => {
    const accessToken = googleAccessTokenRef.current || (await requestGoogleAccessToken())
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Google request failed: ${response.status}`)
    }

    if (response.status === 204) {
      return null as T
    }

    return (await response.json()) as T
  }

  const refreshGoogleTasksContext = async () => {
    const timeMin = new Date()
    timeMin.setDate(timeMin.getDate() - 14)
    const timeMax = new Date()
    timeMax.setDate(timeMax.getDate() + 30)

    const [listsResponse, profileResponse, calendarsResponse] = await Promise.all([
      googleApiRequest<{ items?: GoogleTaskList[] }>('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100').catch((e) => { console.error('Tasks API Error:', e); return { items: [] } }),
      googleApiRequest<GoogleProfile>('https://www.googleapis.com/oauth2/v3/userinfo').catch((e) => { console.error('Profile API Error:', e); return { name: 'משתמש', email: '' } }),
      googleApiRequest<{ items?: Array<{ id: string }> }>('https://www.googleapis.com/calendar/v3/users/me/calendarList').catch((e) => { console.error('CalendarList API Error:', e); return { items: [] } }),
    ])

    const nextLists = listsResponse.items ?? []
    setGoogleProfile((current) => current ?? profileResponse)
    setGoogleTasksLists(nextLists)
    setSelectedGoogleTaskListId((current) => current || nextLists[0]?.id || '')

    const calendarIds = (calendarsResponse.items ?? []).map((cal) => cal.id).slice(0, 30) // Limit to 30 calendars max to avoid rate limits
    const allEventsPromises = calendarIds.map((calId) =>
      googleApiRequest<{ items?: GoogleEvent[] }>(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${timeMin.toISOString()}&timeMax=${timeMax.toISOString()}&singleEvents=true&orderBy=startTime`
      ).catch((e) => { console.error(`Events API Error for ${calId}:`, e); return { items: [] } })
    )

    const allEventsResponses = await Promise.all(allEventsPromises)
    const evts = allEventsResponses.flatMap((res) => res.items ?? [])
    setGoogleEvents(evts)

    setGoogleMessage(
      nextLists.length > 0
        ? `נתונים עודכנו: ${nextLists.length} רשימות משימות ו-${evts.length} אירועים מ-${calendarIds.length} יומנים בגוגל.`
        : 'החשבון מחובר בהצלחה.',
    )

    return { profile: profileResponse, lists: nextLists, events: evts }
  }

  const allTasks = useMemo(
    () =>
      projects.flatMap((project) =>
        project.tasks.map((task) => ({
          ...task,
          projectId: project.id,
          projectName: project.name,
        })),
      ),
    [projects],
  )
  const completedTasks = allTasks.filter((task) => task.status === 'בוצע').length
  const openTasks = allTasks.filter((task) => task.status !== 'בוצע').length
  const urgentTasks = allTasks.filter((task) => task.status === 'דחוף').length
  const waitingTasks = allTasks.filter((task) => task.status === 'ממתין').length
  const unassignedTasks = allTasks.filter((task) => task.owner === UNASSIGNED_OWNER).length
  const progress = allTasks.length === 0 ? 0 : Math.round((completedTasks / allTasks.length) * 100)
  const visibleProjects = projects
    .filter((project) => focusedProjectId === 'all' || project.id === focusedProjectId)
    .map((project) => ({
      ...project,
      tasks: filter === 'all' ? project.tasks : project.tasks.filter((task) => task.status === filter),
    }))
    .filter((project) => project.tasks.length > 0)
  
  const sortedEvents = [...events].sort((a, b) => a.date.localeCompare(b.date))
  const weekDates = getWeekDates(selectedDate)
  const syncProject = projects.find((project) => project.id === syncProjectId) ?? projects[0]
  const selectedGoogleTaskList = googleTasksLists.find((list) => list.id === selectedGoogleTaskListId)

  const calendarEntries = (calendarMode === 'day' ? [selectedDate] : weekDates).map((date) => {
    const dayLocalEvents = sortedEvents.filter((event) => event.date === date)
    const dayGoogleEvents = googleEvents.filter((ge) => {
      const gDate = ge.start?.date || (ge.start?.dateTime && ge.start.dateTime.slice(0, 10))
      return gDate === date
    })
    return {
      label: formatCalendarLabel(date),
      date,
      events: dayLocalEvents,
      googleEvents: dayGoogleEvents
    }
  })

  const updateTaskStatus = (projectId: string, taskId: string, nextStatus: TaskStatus) => {
    setProjects((currentProjects) =>
      currentProjects.map((currentProject) => {
        if (currentProject.id !== projectId) return currentProject
        return {
          ...currentProject,
          tasks: currentProject.tasks.map((currentTask) =>
            currentTask.id === taskId ? { ...currentTask, status: nextStatus } : currentTask,
          ),
        }
      }),
    )
  }

  const cycleStatus = (projectId: string, taskId: string) => {
    const project = projects.find((item) => item.id === projectId)
    const task = project?.tasks.find((item) => item.id === taskId)
    if (!project || !task) return

    const currentIndex = STATUS_ORDER.indexOf(task.status)
    const nextStatus = STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length]

    setProjects((currentProjects) =>
      currentProjects.map((currentProject) => {
        if (currentProject.id !== projectId) return currentProject

        return {
          ...currentProject,
          tasks: currentProject.tasks.map((currentTask) =>
            currentTask.id === taskId ? { ...currentTask, status: nextStatus } : currentTask,
          ),
        }
      }),
    )

    appendActivity('עדכון סטטוס משימה', `${task.title} הועברה לסטטוס ${nextStatus}`)
  }

  const handleTaskSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!taskForm.title.trim() || !taskForm.dueDate) return

    const project = projects.find((item) => item.id === taskForm.projectId)
    if (!project) return

    const nextTask: Task = {
      id: createId('task'),
      title: taskForm.title.trim(),
      dueDate: taskForm.dueDate,
      owner: UNASSIGNED_OWNER,
      status: taskForm.status,
    }

    setProjects((currentProjects) =>
      currentProjects.map((currentProject) =>
        currentProject.id === taskForm.projectId
          ? { ...currentProject, tasks: [nextTask, ...currentProject.tasks] }
          : currentProject,
      ),
    )

    appendActivity('יצירת משימה', `נוספה המשימה "${nextTask.title}" לפרויקט ${project.name} ללא שיוך בעלים`)
    setTaskForm((current) => ({
      ...current,
      title: '',
      dueDate: '',
      status: 'חדש',
    }))
  }

  const handleEventSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!eventForm.title.trim() || !eventForm.date || !eventForm.description.trim()) return

    const relatedProject = projects.find((project) => project.id === eventForm.projectId)
    const nextEvent: EventItem = {
      id: createId('event'),
      title: eventForm.title.trim(),
      date: eventForm.date,
      projectId: eventForm.projectId,
      description: eventForm.description.trim(),
      createdAt: getNowLabel(),
    }

    setEvents((current) => [nextEvent, ...current])
    appendActivity('אירוע חדש', `נוסף האירוע "${nextEvent.title}" עבור ${relatedProject?.name ?? 'פרויקט לא ידוע'}`)
    setEventForm((current) => ({
      ...current,
      title: '',
      date: '',
      description: '',
    }))
  }

  const handleProjectSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!projectForm.name.trim()) return

    if (showProjectModal?.mode === 'create') {
      const newProject: Project = {
        id: createId('project'),
        name: projectForm.name.trim(),
        description: projectForm.description.trim(),
        color: projectForm.color,
        milestones: projectForm.milestones.trim(),
        kpis: projectForm.kpis.trim(),
        stakeholders: projectForm.stakeholders.trim(),
        targetDate: projectForm.targetDate,
        tasks: [],
      }
      setProjects([...projects, newProject])
      appendActivity('תהליך חדש', `נוצר תהליך חדש בשם "${newProject.name}"`)
    } else if (showProjectModal?.mode === 'edit' && showProjectModal.project) {
      setProjects(current => current.map(p => 
        p.id === showProjectModal.project!.id 
          ? { 
              ...p, 
              name: projectForm.name.trim(), 
              description: projectForm.description.trim(), 
              color: projectForm.color,
              milestones: projectForm.milestones.trim(),
              kpis: projectForm.kpis.trim(),
              stakeholders: projectForm.stakeholders.trim(),
              targetDate: projectForm.targetDate
            } 
          : p
      ))
      appendActivity('עדכון תהליך', `התהליך "${projectForm.name}" עודכן`)
    }
    
    setShowProjectModal(null)
  }

  const deleteProject = (projectId: string) => {
    if (!confirm('האם אתה בטוח שברצונך למחוק תהליך זה? כל המשימות שבו יימחקו!')) return
    const proj = projects.find(p => p.id === projectId)
    setProjects(current => current.filter(p => p.id !== projectId))
    if (proj) appendActivity('מחיקת תהליך', `התהליך "${proj.name}" נמחק לצמיתות`)
  }

  const openProjectTasks = (projectId: string) => {
    setFocusedProjectId(projectId)
    setView('dashboard')
  }

  const handleBulkImport = (e: React.FormEvent) => {
    e.preventDefault()
    
    const targetProjectId = bulkProjectId || projects[0]?.id
    if (!bulkImportText.trim() || !targetProjectId) return

    const lines = bulkImportText.split('\n').map(l => l.replace(/^[-\*•\d\.\s\[\]]+/, '').trim()).filter(Boolean)
    if (lines.length === 0) return

    const newTasks: Task[] = lines.map(title => ({
      id: createId('task-bulk'),
      title,
      status: 'חדש',
      dueDate: getNowLabel().split(' ')[0],
      projectId: targetProjectId,
      projectName: projects.find(p => p.id === targetProjectId)?.name || '',
      owner: UNASSIGNED_OWNER
    }))

    setProjects(current => current.map(p => 
      p.id === targetProjectId ? { ...p, tasks: [...newTasks, ...p.tasks] } : p
    ))
    
    appendActivity('ייבוא המוני', `יובאו ${newTasks.length} משימות מתצורה חופשית`)
    setShowGlobalAddModal(false)
    setBulkImportText('')
    setBulkProjectId('')
  }

  const resetBoardFocus = () => {
    setFocusedProjectId('all')
    setFilter('all')
  }

  const startEditingTask = (projectId: string, task: Task) => {
    setEditingTask({
      projectId,
      taskId: task.id,
      title: task.title,
      owner: task.owner,
      dueDate: task.dueDate,
      status: task.status,
      notes: task.notes || '',
      notesUpdatedAt: task.notesUpdatedAt,
    })
  }

  const saveTaskEdits = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingTask) return

    const project = projects.find((item) => item.id === editingTask.projectId)
    const currentTask = project?.tasks.find((item) => item.id === editingTask.taskId)
    if (!project || !currentTask) return

    const updatedTask: Task = {
      ...currentTask,
      title: editingTask.title.trim(),
      owner: editingTask.owner.trim() || UNASSIGNED_OWNER,
      dueDate: editingTask.dueDate,
      status: editingTask.status,
      notes: editingTask.notes?.trim() || undefined,
      notesUpdatedAt: (editingTask.notes !== currentTask.notes) ? getNowLabel() : currentTask.notesUpdatedAt
    }

    if (!updatedTask.title || !updatedTask.dueDate) return

    setProjects((currentProjects) =>
      currentProjects.map((currentProject) => {
        if (currentProject.id !== editingTask.projectId) return currentProject

        return {
          ...currentProject,
          tasks: currentProject.tasks.map((task) => (task.id === editingTask.taskId ? updatedTask : task)),
        }
      }),
    )

    appendActivity('עריכת משימה', `עודכנה המשימה "${updatedTask.title}" בפרויקט ${project.name}`)
    setEditingTask(null)
  }

  const connectGoogleTasks = async () => {
    setGoogleTasksBusy(true)

    try {
      const prompt = googleAccessTokenRef.current ? '' : 'consent'
      await requestGoogleAccessToken(prompt)
      const context = await refreshGoogleTasksContext()
      appendActivity('חיבור Google Tasks', `${context.profile.name} חיבר/ה את Google Tasks למערכת`)
    } catch (error) {
      setGoogleMessage(error instanceof Error ? error.message : 'החיבור ל-Google Tasks נכשל.')
    } finally {
      setGoogleTasksBusy(false)
    }
  }

  const connectGoogleProfile = async () => {
    setGoogleTasksBusy(true)

    try {
      await requestGoogleAccessToken('consent')
      const context = await refreshGoogleTasksContext()
      appendActivity('התחברות Google', `${context.profile.name} התחבר/ה למערכת`)
    } catch (error) {
      setGoogleMessage(error instanceof Error ? error.message : 'ההתחברות ל-Google נכשלה.')
    } finally {
      setGoogleTasksBusy(false)
    }
  }

  const refreshGoogleTasksLists = async () => {
    setGoogleTasksBusy(true)

    try {
      await refreshGoogleTasksContext()
    } catch (error) {
      setGoogleMessage(error instanceof Error ? error.message : 'רענון רשימות Google Tasks נכשל.')
    } finally {
      setGoogleTasksBusy(false)
    }
  }

  const syncProjectToGoogleTasks = async () => {
    if (!syncProject || !selectedGoogleTaskListId) {
      setGoogleMessage('יש לבחור רשימת Google Tasks ופרויקט לפני הייצוא.')
      return
    }

    setGoogleTasksBusy(true)

    try {
      const existingTasksResponse = await googleApiRequest<{ items?: Array<{ title: string }> }>(
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(selectedGoogleTaskListId)}/tasks?showCompleted=true&showHidden=true&maxResults=100`,
      )

      const existingTitles = new Set((existingTasksResponse.items ?? []).map((task) => task.title))
      const pendingTasks = syncProject.tasks.filter((task) => !existingTitles.has(`${syncProject.name} | ${task.title}`))

      await Promise.all(
        pendingTasks.map((task) =>
          googleApiRequest(
            `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(selectedGoogleTaskListId)}/tasks`,
            {
              method: 'POST',
              body: JSON.stringify({
                title: `${syncProject.name} | ${task.title}`,
                notes: `בעלים: ${task.owner}\nסטטוס מקומי: ${task.status}\nפרויקט: ${syncProject.name}`,
                due: new Date(`${task.dueDate}T09:00:00`).toISOString(),
                status: task.status === 'בוצע' ? 'completed' : 'needsAction',
                ...(task.status === 'בוצע' ? { completed: new Date().toISOString() } : {}),
              }),
            },
          ),
        ),
      )

      setGoogleMessage(
        pendingTasks.length > 0
          ? `יוצאו ${pendingTasks.length} משימות לפרויקט ${syncProject.name} ב-Google Tasks`
          : `לא נמצאו משימות חדשות לייצוא עבור ${syncProject.name}`,
      )
      appendActivity('סנכרון Google Tasks', `בוצע ייצוא של ${pendingTasks.length} משימות מתוך ${syncProject.name}`)
      await refreshGoogleTasksContext()
    } catch (error) {
      setGoogleMessage(error instanceof Error ? error.message : 'סנכרון Google Tasks נכשל.')
    } finally {
      setGoogleTasksBusy(false)
    }
  }

  const disconnectGoogle = () => {
    if (googleProfile) {
      appendActivity('התנתקות Google', `${googleProfile.name} התנתק/ה מהמערכת`)
    }

    const accessToken = googleAccessTokenRef.current
    if (accessToken) {
      window.google?.accounts?.oauth2?.revoke?.(accessToken)
    }

    googleAccessTokenRef.current = ''
    window.google?.accounts?.id?.disableAutoSelect?.()
    setGoogleProfile(null)
    setGoogleTasksLists([])
    setSelectedGoogleTaskListId('')
    setGoogleTasksBusy(false)
    setGoogleMessage('החיבור הוסר מהמכשיר הזה.')
  }

  return (
    <div className="app-shell" dir="rtl">
      <header className="topbar">
        <div>
          <p className="eyebrow">מטה משימות</p>
          <h1>לוח ניהול עירוני</h1>
          <p className="subhead">מערכת מקומית עם חיבור ל-Google Calendar ול-Google Tasks.</p>
        </div>
        <div className="summary-chip">
          <span>{allTasks.length} משימות</span>
          <strong>{progress}% הושלם</strong>
        </div>
      </header>

      <nav className="tabbar" aria-label="ניווט ראשי">
        {(Object.keys(VIEW_LABELS) as View[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={view === tab ? 'tab-button active' : 'tab-button'}
            onClick={() => setView(tab)}
          >
            {VIEW_LABELS[tab]}
          </button>
        ))}
      </nav>

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

          <section className="panel toolbar-panel compact-toolbar">
            <div className="toolbar-stack">
              <div className="board-actions board-actions-compact" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                <div className="view-toggle">
                  <button type="button" className={dashboardLayout === 'list' ? 'tab-button active' : 'tab-button'} onClick={() => setDashboardLayout('list')}>
                    רשימה
                  </button>
                  <button type="button" className={dashboardLayout === 'kanban' ? 'tab-button active' : 'tab-button'} onClick={() => setDashboardLayout('kanban')}>
                    קנבן
                  </button>
                </div>
                <label className="toolbar-field">
                  <span>סטטוס</span>
                  <select className="field-input compact" value={filter} onChange={(event) => setFilter(event.target.value as 'all' | TaskStatus)}>
                    <option value="all">כל הסטטוסים</option>
                    {STATUS_ORDER.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="toolbar-field">
                  <span>תחום</span>
                  <select className="field-input compact" value={focusedProjectId} onChange={(event) => setFocusedProjectId(event.target.value)}>
                    <option value="all">כל התחומים</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className={`ghost-button compact-action ${showCompleted ? 'active' : ''}`} onClick={() => setShowCompleted(!showCompleted)} style={{ alignSelf: 'flex-end' }}>
                  {showCompleted ? 'הסתר בוצעו' : 'הצג בוצעו'}
                </button>
                <button type="button" className="ghost-button compact-action" onClick={resetBoardFocus} style={{ alignSelf: 'flex-end' }}>
                  איפוס
                </button>
              </div>
            </div>
          </section>

          {dashboardLayout === 'list' ? (
            visibleProjects.map((project) => (
              <section className="project-card" key={project.id}>
                <div className="project-header">
                  <div className="project-title">
                    <span className="project-dot" style={{ backgroundColor: project.color }} />
                    <h3>{project.name}</h3>
                  </div>
                  <span className="task-count">{project.tasks.length} פריטים</span>
                </div>

                <div className="task-list">
                  {project.tasks.filter((task) => showCompleted || task.status !== 'בוצע').map((task) => {
                    const meta = STATUS_META[normalizeTaskStatus(task.status)]
                    const isDone = task.status === 'בוצע'

                    return (
                      <article className="task-row" key={task.id} style={{ opacity: isDone ? 0.6 : 1 }}>
                        <div className="task-main-wrap">
                          <input 
                            type="checkbox" 
                            className="task-list-checkbox" 
                            checked={isDone} 
                            onChange={(e) => updateTaskStatus(project.id, task.id, e.target.checked ? 'בוצע' : 'חדש')}
                          />
                          <div className="task-main">
                            <h4>{task.title}</h4>
                            <p>שיוך: {task.owner} | יעד: {task.dueDate}</p>
                            {task.notes && (
                              <p style={{ fontSize: '13px', marginTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '500px' }}>
                                📝 {task.notes}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="task-actions">
                          <button type="button" className="ghost-button small-button" onClick={() => startEditingTask(project.id, task)}>
                            עריכה
                          </button>
                          <button type="button" className={`status-pill ${meta.tone}`} onClick={() => cycleStatus(project.id, task.id)}>
                            {meta.label}
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))
          ) : (
            <div className="kanban-board">
              {STATUS_ORDER.map((statusColumn) => {
                const columnTasks = allTasks.filter(t => t.status === statusColumn && (focusedProjectId === 'all' || t.projectId === focusedProjectId) && (showCompleted || t.status !== 'בוצע'))
                
                return (
                  <div className="kanban-column" key={statusColumn}>
                    <div className="kanban-column-header">
                      <span>{statusColumn}</span>
                      <span className="kanban-column-count">{columnTasks.length}</span>
                    </div>
                    <div 
                      className={`kanban-dropzone`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const data = e.dataTransfer.getData('text/plain');
                        if (!data) return;
                        const { pId, tId } = JSON.parse(data);
                        if (pId && tId) updateTaskStatus(pId, tId, statusColumn);
                      }}
                    >
                      {columnTasks.map(task => {
                        const meta = STATUS_META[normalizeTaskStatus(task.status)]
                        const pColor = projects.find(p => p.id === task.projectId)?.color || '#38bdf8'

                        return (
                          <div 
                            key={task.id} 
                            className="kanban-task-card"
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', JSON.stringify({ pId: task.projectId, tId: task.id }))
                            }}
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
                               <button type="button" className="ghost-button small-button" onClick={() => startEditingTask(task.projectId, task as Task)}>
                                עריכה
                              </button>
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

      {view === 'processes' && (
        <main className="board">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>ניהול תהליכים ויעדים</h2>
            <button 
              type="button" 
              className="primary-button" 
              onClick={() => {
                setProjectForm({ name: '', description: '', color: '#3b82f6', milestones: '', kpis: '', stakeholders: '', targetDate: '' })
                setShowProjectModal({ mode: 'create' })
              }}
            >
              הוספת תהליך חדש
            </button>
          </div>
          {projects.map((project) => {
            const done = project.tasks.filter((task) => task.status === 'בוצע').length
            const projectProgress = project.tasks.length === 0 ? 0 : Math.round((done / project.tasks.length) * 100)

            return (
              <section className="panel process-card" key={project.id}>
                <div className="process-header" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div className="project-title" style={{ marginBottom: '8px' }}>
                      <span className="project-dot" style={{ backgroundColor: project.color }} />
                      <h3>{project.name}</h3>
                    </div>
                    {project.description && (
                      <p style={{ margin: '0 0 16px 0', maxWidth: '600px', lineHeight: 1.5, color: 'var(--text-main)' }}>
                        {project.description}
                      </p>
                    )}
                    <p className="muted-line">{done} מתוך {project.tasks.length} משימות הושלמו</p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <button type="button" className="primary-button small-button" onClick={() => openProjectTasks(project.id)}>
                      מעבר למשימות
                    </button>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        type="button" 
                        className="ghost-button small-button" 
                        onClick={() => {
                          setProjectForm({ 
                            name: project.name, 
                            description: project.description || '', 
                            color: project.color,
                            milestones: project.milestones || '',
                            kpis: project.kpis || '',
                            stakeholders: project.stakeholders || '',
                            targetDate: project.targetDate || ''
                          })
                          setShowProjectModal({ mode: 'edit', project })
                        }}
                      >
                        עריכה
                      </button>
                      <button type="button" className="ghost-button small-button" style={{ color: '#f87171' }} onClick={() => deleteProject(project.id)}>
                        מחיקה
                      </button>
                    </div>
                  </div>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${projectProgress}%`, backgroundColor: project.color }} />
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginTop: '16px' }}>
                  {project.milestones && (
                    <div style={{ background: 'rgba(59, 130, 246, 0.03)', padding: '12px', borderRadius: '12px', border: '1px solid var(--surface-border)' }}>
                      <strong style={{ display: 'block', marginBottom: '8px', color: 'var(--primary)', fontSize: '14px' }}>🎯 אבני דרך מרכזיות</strong>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.4' }}>{project.milestones}</div>
                    </div>
                  )}
                  
                  {(project.kpis || project.stakeholders || project.targetDate) && (
                    <div style={{ background: 'rgba(59, 130, 246, 0.03)', padding: '12px', borderRadius: '12px', border: '1px solid var(--surface-border)' }}>
                      <strong style={{ display: 'block', marginBottom: '8px', color: 'var(--primary)', fontSize: '14px' }}>📋 מדדים ושותפים</strong>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                        {project.targetDate && (
                          <div><strong>📅 תאריך יעד:</strong> {new Date(project.targetDate).toLocaleDateString('he-IL')}</div>
                        )}
                        {project.kpis && (
                          <div><strong>📊 יעדים/KPIs:</strong> {project.kpis}</div>
                        )}
                        {project.stakeholders && (
                          <div><strong>👥 שותפים:</strong> {project.stakeholders}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="process-stats" style={{ marginTop: '16px' }}>
                  <span>{projectProgress}% התקדמות</span>
                  <span>{project.tasks.filter((task) => task.status === 'דחוף').length} דחופות</span>
                  <span>{project.tasks.filter((task) => task.status === 'ממתין').length} ממתינות</span>
                  <span>{project.tasks.filter((task) => task.owner === UNASSIGNED_OWNER).length} לא משויכות</span>
                </div>
              </section>
            )
          })}
        </main>
      )}

      {view === 'integrations' && (
        <main className="board">
          <div className="integration-grid">
            <section className="panel google-panel">
              <div className="section-head">
                <h3>חיבור Google</h3>
                <p>התחברות לחשבון שלך כדי לסנכרן מול Google Tasks ו-Google Calendar.</p>
              </div>
              {googleProfile ? (
                <div className="google-connected">
                  <div className="google-user">
                    {googleProfile.picture ? <img src={googleProfile.picture} alt={googleProfile.name} className="google-avatar" /> : null}
                    <div>
                      <strong>{googleProfile.name}</strong>
                      <p>{googleProfile.email}</p>
                    </div>
                  </div>
                  <button type="button" className="ghost-button" onClick={disconnectGoogle} disabled={googleTasksBusy}>
                    התנתקות
                  </button>
                </div>
              ) : GOOGLE_CLIENT_ID ? (
                <div className="google-signin-wrap">
                  <button type="button" className="primary-button" onClick={() => void connectGoogleProfile()} disabled={googleTasksBusy}>
                    {googleTasksBusy ? 'טוען...' : 'התחברות עם Google'}
                  </button>
                </div>
              ) : (
                <div className="info-box">
                  <strong>החיבור מוכן בקוד אבל חסר Client ID.</strong>
                  <p>ברגע שתוסיף `VITE_GOOGLE_CLIENT_ID`, כפתור ההתחברות יופיע כאן.</p>
                </div>
              )}
              {googleMessage ? <p className="muted-line">{googleMessage}</p> : null}
            </section>
            
            <section className="panel microsoft-panel">
              <div className="section-head">
                <h3>סנכרון מיידי</h3>
                <p>ייצוא משימות ישירות לתוך Google Tasks דרך האתר.</p>
              </div>
              {googleProfile ? (
                <div className="integration-stack">
                  <div className="microsoft-actions">
                    <select className="field-input compact" value={syncProjectId} onChange={(event) => setSyncProjectId(event.target.value)}>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                    <select className="field-input compact" value={selectedGoogleTaskListId} onChange={(event) => setSelectedGoogleTaskListId(event.target.value)}>
                      <option value="">בחר רשימת Google Tasks</option>
                      {googleTasksLists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.title}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="ghost-button" onClick={() => void connectGoogleTasks()} disabled={googleTasksBusy}>
                      {googleTasksBusy ? 'טוען...' : 'אישור Google Tasks'}
                    </button>
                    <button type="button" className="ghost-button" onClick={() => void refreshGoogleTasksLists()} disabled={googleTasksBusy}>
                      רענון נתונים
                    </button>
                    <button type="button" className="primary-button" onClick={() => void syncProjectToGoogleTasks()} disabled={googleTasksBusy || !selectedGoogleTaskListId}>
                      ייצוא משימות
                    </button>
                  </div>
                </div>
              ) : (
                <div className="info-box">
                  <strong>יש להתחבר קודם לגוגל.</strong>
                  <p>לאחר ההתחברות תוכל לייצא משימות בלחיצת כפתור.</p>
                </div>
              )}
            </section>
          </div>
        </main>
      )}

      {view === 'events' && (
        <main className="board">
          <section className="panel calendar-panel">
            <div className="section-head">
              <h3>לשונית יומן</h3>
              <p>תצוגה שבועית עם איחוד אוטומטי של אירועים מקומיים ואירועי Google Calendar.</p>
            </div>
            <div className="calendar-toolbar">
              <div className="mode-switch">
                <button type="button" className={calendarMode === 'week' ? 'tab-button active' : 'tab-button'} onClick={() => setCalendarMode('week')}>
                  שבועי
                </button>
                <button type="button" className={calendarMode === 'day' ? 'tab-button active' : 'tab-button'} onClick={() => setCalendarMode('day')}>
                  יומי
                </button>
              </div>
              <input className="field-input compact calendar-date-input" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
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
                        const project = projects.find((projectItem) => projectItem.id === item.projectId)
                        return (
                          <div className="calendar-event" key={item.id}>
                            <strong>{item.title}</strong>
                            <span>{project?.name ?? 'ללא תחום'}</span>
                          </div>
                        )
                      })}
                      {entry.googleEvents.map((item) => (
                        <div className="calendar-event" key={item.id} style={{ borderColor: '#4285F4', backgroundColor: 'rgba(66, 133, 244, 0.1)' }}>
                          <strong>📅 {item.summary}</strong>
                          <span>Google Calendar</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-line">אין אירועים ביום הזה.</p>
                  )}
                </article>
              ))}
            </div>
          </section>

          <div className="event-layout">
            <section className="panel">
              <div className="section-head">
                <h3>הוספת אירוע יומן מקומי</h3>
                <p>פעולה פנימית בתוך הלוח הזו (מערכת עצמאית).</p>
              </div>
              <form className="event-form" onSubmit={handleEventSubmit}>
                <input className="field-input" type="text" placeholder="שם האירוע" value={eventForm.title} onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))} />
                <input className="field-input" type="date" value={eventForm.date} onChange={(event) => setEventForm((current) => ({ ...current, date: event.target.value }))} />
                <select className="field-input" value={eventForm.projectId} onChange={(event) => setEventForm((current) => ({ ...current, projectId: event.target.value }))}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <textarea className="field-input field-textarea" placeholder="תיאור קצר או הערות" value={eventForm.description} onChange={(event) => setEventForm((current) => ({ ...current, description: event.target.value }))} />
                <button type="submit" className="primary-button">
                  שמירת אירוע
                </button>
              </form>
            </section>
          </div>

          <div style={{ marginTop: '20px', padding: '10px', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--text-main)', fontSize: '12px', borderRadius: '12px', direction: 'ltr', textAlign: 'left', overflowX: 'auto', maxHeight: '300px' }}>
            <strong>Debug Info:</strong><br/>
            Calendar Mode: {calendarMode}<br/>
            Selected Date: {selectedDate}<br/>
            Google Auth: {googleProfile ? 'Connected' : 'Disconnected'}<br/>
            Raw Google Events Count: {googleEvents.length}<br/>
            First 20 Google Events:<br/>
            {googleEvents.slice(0, 20).map(e => (
              <div key={e.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.1)', paddingBottom: '4px', marginBottom: '4px' }}>
                Summary: {e.summary}<br/>
                Start: {e.start?.dateTime || e.start?.date}<br/>
                End: {e.end?.dateTime || e.end?.date}
              </div>
            ))}
          </div>
        </main>
      )}

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

      <button className="fab-button" onClick={() => setShowGlobalAddModal('single')} title="הוספת משימות">+</button>

      {showGlobalAddModal && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowGlobalAddModal(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-label="יצירת משימות" onClick={(event) => event.stopPropagation()}>
            <div className="section-head" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '16px' }}>
                <button 
                  type="button" 
                  className={showGlobalAddModal === 'single' ? 'tab-button active' : 'tab-button'} 
                  onClick={() => setShowGlobalAddModal('single')}
                >
                  משימה בודדת
                </button>
                <button 
                  type="button" 
                  className={showGlobalAddModal === 'bulk' ? 'tab-button active' : 'tab-button'} 
                  onClick={() => setShowGlobalAddModal('bulk')}
                >
                  ייבוא חכם (הדבקת טקסט)
                </button>
                <button 
                  type="button" 
                  className="tab-button"
                  style={{ color: '#3b82f6', fontWeight: 600 }}
                  onClick={() => {
                    setShowGlobalAddModal(false)
                    setProjectForm({ name: '', description: '', color: '#3b82f6', milestones: '', kpis: '', stakeholders: '', targetDate: '' })
                    setShowProjectModal({ mode: 'create' })
                  }}
                >
                  + נושא (תהליך) חדש
                </button>
              </div>
            </div>

            {showGlobalAddModal === 'single' ? (
              <form className="event-form" onSubmit={(e) => { handleTaskSubmit(e); setShowGlobalAddModal(false) }}>
                <input
                  className="field-input"
                  type="text"
                  placeholder="שם המשימה"
                  required
                  value={taskForm.title}
                  onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))}
                />
                <input
                  className="field-input"
                  type="date"
                  required
                  value={taskForm.dueDate}
                  onChange={(event) => setTaskForm((current) => ({ ...current, dueDate: event.target.value }))}
                />
                <select
                  className="field-input"
                  value={taskForm.projectId}
                  onChange={(event) => setTaskForm((current) => ({ ...current, projectId: event.target.value }))}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <select
                  className="field-input"
                  value={taskForm.status}
                  onChange={(event) => setTaskForm((current) => ({ ...current, status: event.target.value as TaskStatus }))}
                >
                  {STATUS_ORDER.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <div className="modal-actions">
                  <button type="button" className="ghost-button" onClick={() => setShowGlobalAddModal(false)}>
                    ביטול
                  </button>
                  <button type="submit" className="primary-button">
                    שמירת משימה
                  </button>
                </div>
              </form>
            ) : (
              <form className="event-form" onSubmit={handleBulkImport}>
                <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                  <span>הדבק טקסט או רשימת בולטים</span>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px 0' }}>המערכת תיקח כל שורה, תנקה סימוני בולטים של Gemini ותהפוך למשימה נפרדת.</p>
                  <textarea 
                    className="field-input field-textarea" 
                    placeholder="- משימה ראשונה להיט&#10;- משימה שנייה&#10;- משימה שלישית..." 
                    value={bulkImportText} 
                    onChange={(e) => setBulkImportText(e.target.value)} 
                    style={{ minHeight: '180px' }}
                    required
                  />
                </div>
                <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                  <span>לאיזה תהליך/פרויקט לשייך את כולן?</span>
                  <select
                    className="field-input"
                    value={bulkProjectId || projects[0]?.id || ''}
                    onChange={(event) => setBulkProjectId(event.target.value)}
                  >
                    {!bulkProjectId && <option value="" disabled>בחר פרויקט...</option>}
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="modal-actions" style={{ gridColumn: '1 / -1' }}>
                  <button type="button" className="ghost-button" onClick={() => setShowGlobalAddModal(false)}>
                    ביטול
                  </button>
                  <button type="submit" className="primary-button" disabled={!bulkImportText.trim() || (!bulkProjectId && !projects[0]?.id)}>
                    ייבוא כרשימת משימות
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}

      {editingTask && (
        <div className="modal-backdrop" role="presentation" onClick={() => setEditingTask(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-label="עריכת משימה" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <h3>עריכת משימה</h3>
              <p>מכאן גם משייכים בעלים למשימה שלא שויכה עדיין.</p>
            </div>
            <form className="event-form" onSubmit={saveTaskEdits}>
              <input className="field-input" type="text" value={editingTask.title} onChange={(event) => setEditingTask((current) => (current ? { ...current, title: event.target.value } : current))} />
              <input className="field-input" type="text" value={editingTask.owner} onChange={(event) => setEditingTask((current) => (current ? { ...current, owner: event.target.value } : current))} placeholder="שם בעלים או לא משויך" />
              <input className="field-input" type="date" value={editingTask.dueDate} onChange={(event) => setEditingTask((current) => (current ? { ...current, dueDate: event.target.value } : current))} />
              <select className="field-input" value={editingTask.status} onChange={(event) => setEditingTask((current) => (current ? { ...current, status: event.target.value as TaskStatus } : current))}>
                {STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>הערות ועדכונים</span>
                <textarea 
                  className="field-input field-textarea" 
                  style={{ minHeight: '80px' }}
                  placeholder="הוסף למשימה הערות, סיכומים ועדכונים שוטפים..." 
                  value={editingTask.notes || ''} 
                  onChange={(event) => setEditingTask((current) => (current ? { ...current, notes: event.target.value } : current))} 
                />
                {editingTask.notesUpdatedAt && (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                    הערות עודכנו לאחרונה: {editingTask.notesUpdatedAt}
                  </span>
                )}
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost-button" onClick={() => setEditingTask(null)}>
                  ביטול
                </button>
                <button type="submit" className="primary-button">
                  שמירת שינויים
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showProjectModal && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowProjectModal(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-label="ניהול תהליך" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <h3>{showProjectModal.mode === 'create' ? 'יצירת תהליך חדש' : 'עריכת תהליך'}</h3>
              <p>התהליך משמש כמסגרת אסטרטגית המאגדת בתוכה משימות נגזרות.</p>
            </div>
            <form className="event-form" onSubmit={handleProjectSubmit}>
              <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>שם התהליך / יעד</span>
                <input 
                  className="field-input" 
                  type="text" 
                  required
                  placeholder="לדוגמה: שדרוג חזות העיר מרכז" 
                  value={projectForm.name} 
                  onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} 
                />
              </div>
              <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>מטרות ואסטרטגיה</span>
                <textarea 
                  className="field-input field-textarea" 
                  placeholder="פירוט המטרות, משאבים נדרשים וכו'..." 
                  value={projectForm.description} 
                  onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })} 
                />
              </div>
              <div className="toolbar-field" style={{ gridColumn: '1 / -1' }}>
                <span>אבני דרך מרכזיות</span>
                <textarea 
                  className="field-input field-textarea" 
                  style={{ minHeight: '60px' }}
                  placeholder="רשימת אבני הדרך המרכזיות בתהליך..." 
                  value={projectForm.milestones} 
                  onChange={(e) => setProjectForm({ ...projectForm, milestones: e.target.value })} 
                />
              </div>
              <div className="toolbar-field">
                <span>מדדי הצלחה (KPIs)</span>
                <input 
                  className="field-input" 
                  type="text" 
                  placeholder="לדוג': 100 נרשמים, 20% חיסכון..." 
                  value={projectForm.kpis} 
                  onChange={(e) => setProjectForm({ ...projectForm, kpis: e.target.value })} 
                />
              </div>
              <div className="toolbar-field">
                <span>שותפים ומעורבים</span>
                <input 
                  className="field-input" 
                  type="text" 
                  placeholder="לדוג': מחלקת הנדסה, גזברות..." 
                  value={projectForm.stakeholders} 
                  onChange={(e) => setProjectForm({ ...projectForm, stakeholders: e.target.value })} 
                />
              </div>
              <div className="toolbar-field">
                <span>תאריך יעד לסיום תהליך</span>
                <input 
                  className="field-input" 
                  type="date" 
                  value={projectForm.targetDate} 
                  onChange={(e) => setProjectForm({ ...projectForm, targetDate: e.target.value })} 
                />
              </div>
              <div className="toolbar-field">
                <span>צבע זיהוי</span>
                <input 
                  className="field-input" 
                  type="color" 
                  style={{ height: '50px', padding: '4px' }}
                  value={projectForm.color} 
                  onChange={(e) => setProjectForm({ ...projectForm, color: e.target.value })} 
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost-button" onClick={() => setShowProjectModal(null)}>
                  ביטול
                </button>
                <button type="submit" className="primary-button">
                  {showProjectModal.mode === 'create' ? 'יצירת תהליך' : 'שמירת שינויים'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
