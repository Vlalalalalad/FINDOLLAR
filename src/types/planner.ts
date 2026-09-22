/** Calendar dates and times are floating local values, never UTC timestamps. */
export type TaskStatus = 'planned' | 'completed'
export type TaskPriority = 'none' | 'low' | 'medium' | 'high'
export type TaskFrequency = 'daily' | 'weekly' | 'monthly'

export interface TaskRecurrence {
  frequency: TaskFrequency
  interval: number
  /** JavaScript weekdays: Sunday = 0, Monday = 1. Used for weekly rules. */
  weekdays?: number[]
  /** Inclusive YYYY-MM-DD, or null for an open-ended series. */
  until: string | null
}

export interface Task {
  id: string
  user_id: string
  title: string
  description: string | null
  date: string | null
  /** Inclusive final civil day. Null/absent means the start day only. */
  end_date?: string | null
  /** User ordering within one priority; absent rows keep their normal order. */
  manual_order?: number | null
  time: string | null
  duration_minutes: number | null
  /** Opt-in completion at the scheduled end. Absent on older database schemas. */
  auto_complete?: boolean
  status: TaskStatus
  /** Server-stamped completion instant; edits never change it. */
  completed_at?: string | null
  priority: TaskPriority
  color: string
  /** Optional for compatibility with tasks created before the workspace update. */
  tags?: string[]
  /** Minutes before the occurrence. An empty array means no reminders. */
  reminders: number[]
  recurrence: TaskRecurrence | null
  created_at: string
  updated_at: string
}

export type TaskInput = Omit<Task, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'completed_at'>
export type TaskOccurrencePatch = Partial<Omit<TaskInput, 'recurrence' | 'status'>>

/** Only changed occurrences are persisted; future occurrences are projections. */
export interface TaskOverride {
  id: string
  user_id: string
  task_id: string
  /** Original date in the recurrence, preserved even when moved elsewhere. */
  occurrence_date: string
  patch: TaskOccurrencePatch
  status: TaskStatus | null
  completed_at?: string | null
  deleted: boolean
  created_at: string
  updated_at: string
}

export interface TaskOccurrence extends Task {
  /** Stable id derived from the template id and original recurrence date. */
  id: string
  taskId: string
  occurrenceDate: string | null
  isRecurring: boolean
}

export interface TaskReminderEvent {
  id: string
  occurrence: TaskOccurrence
  minutesBefore: number
  dueAt: Date
}
