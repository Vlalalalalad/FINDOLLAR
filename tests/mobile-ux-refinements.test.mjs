import assert from 'node:assert/strict'
import test from 'node:test'
import { ACCOUNT_SESSIONS_KEY, accountLabel, accountMetadata, readAccountSessions, rememberAccount, setSavedAccountProfileName } from '../src/lib/accountSessions.ts'
import { deliberateLeftSwipeThreshold } from '../src/lib/plannerGestures.ts'
import { accountActionAt } from '../src/lib/accountPressHit.ts'

test('account label uses the saved profile full_name and falls back safely', () => {
  assert.equal(accountLabel({ id: '1', email: 'mail@example.com', full_name: '  Основний  ' }), 'Основний')
  assert.equal(accountLabel({ id: '1', email: 'mail@example.com' }), 'Без назви')
  assert.equal(accountLabel({ id: '1', email: '' }), 'Без назви')
})

test('direct note delete swipe uses a deliberate 22 percent threshold', () => {
  assert.equal(deliberateLeftSwipeThreshold(360, true), 79.2)
  assert.equal(deliberateLeftSwipeThreshold(420, true), 92.4)
  assert.ok(deliberateLeftSwipeThreshold(360, true) < deliberateLeftSwipeThreshold(360, false))
})

test('saved account names remain attached to their own user IDs across session refreshes', () => {
  const values = new Map()
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  globalThis.window = { dispatchEvent() {} }
  const session = (id, email) => ({ user: { id, email }, access_token: `access-${id}`, refresh_token: `refresh-${id}` })
  rememberAccount(session('a', 'a@example.com'))
  rememberAccount(session('b', 'b@example.com'))
  setSavedAccountProfileName('a', 'Тест')
  setSavedAccountProfileName('b', 'Робочий')
  rememberAccount(session('a', 'a@example.com'))
  assert.deepEqual(accountMetadata().map(account => account.id), ['a', 'b'])
  assert.deepEqual(Object.fromEntries(accountMetadata().map(account => [account.id, accountLabel(account)])), { a: 'Тест', b: 'Робочий' })
  rememberAccount(session('b', 'b@example.com'))
  assert.deepEqual(accountMetadata().map(account => account.id), ['a', 'b'])
  setSavedAccountProfileName('b', 'Основа')
  assert.equal(accountMetadata().find(account => account.id === 'b')?.full_name, 'Основа')
  assert.equal(accountMetadata().find(account => account.id === 'a')?.full_name, 'Тест')
})

test('previous local displayName metadata is read as the same profile name', () => {
  const values = new Map()
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  values.set(ACCOUNT_SESSIONS_KEY, JSON.stringify([
    { id: 'a', email: 'a@example.com', displayName: ' Старий запис ', access_token: 'test', refresh_token: 'test' },
  ]))
  assert.equal(readAccountSessions()[0].full_name, 'Старий запис')
})

test('drag hit test follows add and account rows and clears outside them', () => {
  const row = (action, top, disabled = false) => ({
    dataset: { accountAction: action }, disabled,
    getBoundingClientRect: () => ({ left: 100, right: 350, top, bottom: top + 44 }),
  })
  const panel = { querySelectorAll: () => [row('add', 100), row('account:a', 144), row('account:b', 188)] }
  assert.equal(accountActionAt(panel, 150, 120), 'add')
  assert.equal(accountActionAt(panel, 150, 170), 'account:a')
  assert.equal(accountActionAt(panel, 150, 210), 'account:b')
  assert.equal(accountActionAt(panel, 150, 170), 'account:a')
  assert.equal(accountActionAt(panel, 150, 260), null)
  assert.equal(accountActionAt(panel, 80, 120), null)
  assert.equal(accountActionAt({ querySelectorAll: () => [row('add', 100, true)] }, 150, 120), null)
})
