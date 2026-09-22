export type OrganizationKind = 'note' | 'goal'
export type OrganizationPageKind = 'notes' | 'goals' | 'mixed'
export type GoalPeriod = 'none' | 'year' | 'custom'

export interface GoalItem {
  id: string
  title: string
  completed: boolean
}

export interface GoalData {
  /** A missing value is an active legacy goal; checklist completion is separate. */
  completed?: boolean
  period: GoalPeriod
  year: number | null
  startDate: string | null
  endDate: string | null
  items: GoalItem[]
}

/** Each record kind owns its payload; future kinds can extend this envelope. */
export interface OrganizationData {
  goal?: GoalData
}

export interface OrganizationEntry {
  id: string
  user_id: string
  page_id: string | null
  kind: OrganizationKind
  title: string
  description: string
  date: string | null
  tags: string[]
  data: OrganizationData
  created_at: string
  updated_at: string
}

export interface OrganizationPage {
  id: string
  user_id: string
  title: string
  kind: OrganizationPageKind
  created_at: string
  updated_at: string
}

export type OrganizationEntryInput = Pick<OrganizationEntry, 'page_id' | 'kind' | 'title' | 'description' | 'date' | 'tags' | 'data'>
export type OrganizationPageInput = Pick<OrganizationPage, 'title' | 'kind'>

export function emptyGoalData(): GoalData {
  return { period: 'none', year: null, startDate: null, endDate: null, items: [] }
}

export function goalProgress(entry: OrganizationEntry) {
  const items = entry.data.goal?.items ?? []
  const completed = items.filter(item => item.completed).length
  return { completed, total: items.length, percent: items.length ? Math.round(completed / items.length * 100) : 0 }
}
