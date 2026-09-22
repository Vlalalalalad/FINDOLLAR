import type { TaskPriority } from '../types/planner'

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: 'Без пріоритету', low: 'Низький', medium: 'Середній', high: 'Високий',
}

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  none: 'var(--color-text-muted)',
  low: 'var(--planner-priority-blue, #4f8fdf)',
  medium: 'var(--planner-priority-yellow, #c99a22)',
  high: 'var(--color-danger)',
}

export const PRIORITY_OPTIONS: readonly TaskPriority[] = ['high', 'medium', 'low', 'none']
