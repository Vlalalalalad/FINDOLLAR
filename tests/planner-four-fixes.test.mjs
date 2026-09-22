import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('notification toggle owns its account state and keeps the knob inside the track', async () => {
  const source = await read('src/components/planner/PlannerReminders.tsx')
  assert.match(source, /const enabled = stateOwnerId === user\?\.id && state\.enabled/)
  assert.match(source, /setStateOwnerId\(user\.id\)/)
  assert.match(source, /overflow-hidden/)
  assert.match(source, /absolute left-0\.5 top-0\.5/)
  assert.match(source, /enabled \? 'translate-x-6' : 'translate-x-0'/)
})

test('mobile Enter remains a line break while desktop Enter submission stays explicit', async () => {
  const source = await read('src/components/planner/PlannerComposer.tsx')
  const handler = source.slice(source.indexOf('const textKeyDown'), source.indexOf('const setDate'))
  assert.match(handler, /matchMedia\('\(pointer: coarse\)'\)\.matches\) return/)
  assert.match(handler, /if \(event\.shiftKey\)/)
  assert.match(handler, /event\.preventDefault\(\)\s+void submit\(\)/)
  assert.ok(handler.indexOf("matchMedia('(pointer: coarse)')") < handler.lastIndexOf('void submit()'))
  assert.equal((source.match(/enterKeyHint="enter"/g) ?? []).length, 2)
})

test('closing an editor clears every retained edit draft without saving it', async () => {
  const source = await read('src/components/planner/PlannerComposer.tsx')
  const start = source.indexOf('const close = () =>')
  const close = source.slice(start, source.indexOf('useOverlayBack(open', start))
  assert.match(close, /if \(editing\)/)
  assert.match(close, /recordRetained\.clear\(\)/)
  assert.match(close, /retained\.clear\(\)/)
  assert.match(close, /conversionRef\.current = null/)
  assert.doesNotMatch(close, /updateTask|saveOccurrence|onUpdateRecord/)
})

test('planner load failures recover silently and render as a fixed compact notice', async () => {
  const [table, context, page, styles] = await Promise.all([
    read('src/hooks/useSupabaseTable.ts'),
    read('src/context/PlannerContext.tsx'),
    read('src/pages/Plans.tsx'),
    read('src/components/planner/planner.css'),
  ])
  assert.match(table, /supabase\.auth\.refreshSession\(\)/)
  assert.match(table, /retryTransient/)
  assert.match(table, /refreshOnFocus/)
  assert.match(context, /recoverSession: true, retryTransient: true, refreshOnFocus: true/)
  assert.match(context, /Сесію не вдалося відновити\. Увійдіть повторно\./)
  assert.match(page, /className="planner-error-toast"/)
  assert.doesNotMatch(page, /my-3 rounded-xl border border-danger\/30/)
  assert.match(styles, /\.planner-error-toast \{ position: fixed;/)
})
