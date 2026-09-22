import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calendarMarkerState,
  hasActiveCalendarMarker,
  selectAdjacentMonth,
  selectAdjacentWeek,
} from '../src/lib/planner.ts'

test('week navigation selects by target week position relative to today', () => {
  const today = '2026-09-16'
  assert.equal(selectAdjacentWeek(today, 1, today), '2026-09-21')
  assert.equal(selectAdjacentWeek('2026-09-21', 1, today), '2026-09-28')
  assert.equal(selectAdjacentWeek('2026-09-28', -1, today), '2026-09-21')
  assert.equal(selectAdjacentWeek('2026-09-21', -1, today), today)
  assert.equal(selectAdjacentWeek(today, -1, today), '2026-09-13')
  assert.equal(selectAdjacentWeek('2026-09-13', -1, today), '2026-09-06')
  assert.equal(selectAdjacentWeek('2026-09-06', 1, today), '2026-09-13')
  assert.equal(selectAdjacentWeek('2026-09-13', 1, today), today)
})

test('month navigation selects first, today, or computed final day', () => {
  const today = '2026-09-20'
  assert.equal(selectAdjacentMonth(today, 1, today), '2026-10-01')
  assert.equal(selectAdjacentMonth('2026-10-01', 1, today), '2026-11-01')
  assert.equal(selectAdjacentMonth('2026-11-01', -1, today), '2026-10-01')
  assert.equal(selectAdjacentMonth('2026-10-01', -1, today), today)
  assert.equal(selectAdjacentMonth(today, -1, today), '2026-08-31')
  assert.equal(selectAdjacentMonth('2026-08-31', -1, today), '2026-07-31')
  assert.equal(selectAdjacentMonth('2026-07-31', 1, today), '2026-08-31')
  assert.equal(selectAdjacentMonth('2026-08-31', 1, today), today)
  assert.equal(selectAdjacentMonth('2024-03-15', -1, '2024-03-15'), '2024-02-29')
  assert.equal(selectAdjacentMonth('2023-03-15', -1, '2023-03-15'), '2023-02-28')
  assert.equal(selectAdjacentMonth('2026-05-15', -1, '2026-05-15'), '2026-04-30')
})

const occurrence = (patch = {}) => ({
  id: 'range', taskId: 'range', occurrenceDate: '2026-09-10', isRecurring: false,
  date: '2026-09-10', end_date: '2026-09-15', status: 'planned', color: '#10b981',
  ...patch,
})

test('an ongoing multi-day plan leaves muted history and no future markers', () => {
  const task = occurrence()
  for (const date of ['2026-09-10', '2026-09-11', '2026-09-12']) {
    assert.equal(calendarMarkerState(task, date, '2026-09-13'), 'inactive')
  }
  assert.equal(calendarMarkerState(task, '2026-09-13', '2026-09-13'), 'active')
  assert.equal(calendarMarkerState(task, '2026-09-14', '2026-09-13'), null)
  assert.equal(calendarMarkerState(task, '2026-09-15', '2026-09-13'), null)
})

test('an overdue multi-day plan keeps only its end date active', () => {
  const task = occurrence()
  for (const date of ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']) {
    assert.equal(calendarMarkerState(task, date, '2026-09-17'), 'inactive')
    assert.equal(hasActiveCalendarMarker(task, date, '2026-09-17'), false)
  }
  assert.equal(calendarMarkerState(task, '2026-09-15', '2026-09-17'), 'active')
  assert.equal(hasActiveCalendarMarker(task, '2026-09-15', '2026-09-17'), true)
})

test('completed ranges and unrelated single-day plans preserve their markers', () => {
  assert.equal(calendarMarkerState(occurrence({ status: 'completed' }), '2026-09-12', '2026-09-13'), 'active')
  assert.equal(calendarMarkerState(occurrence({ id: 'other', date: '2026-09-14', end_date: null }), '2026-09-14', '2026-09-13'), 'active')
})
