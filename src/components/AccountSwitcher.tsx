import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Plus, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAccountPress } from '../hooks/useAccountPress'
import { useOverlayBack } from '../hooks/useOverlayBack'
import { usePresence } from '../hooks/usePresence'
import { accountLabel, type SavedAccount } from '../lib/accountSessions'
import { accountActionAt } from '../lib/accountPressHit'
import { Button, Card, Input, Label, Modal, useConfirm } from './ui'

function AddAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addAccount } = useAuth()
  const [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef(false)
  // Every opening starts as a new account entry. Reset before the modal paints
  // so the previous email/password cannot briefly reappear.
  useLayoutEffect(() => { setEmail(''); setPassword(''); setError('') }, [open])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await addAccount(email.trim(), password); setPassword(''); onClose() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не вдалося додати акаунт.') }
    finally { pending.current = false; setBusy(false) }
  }
  return <Modal open={open} onClose={() => { if (!pending.current) onClose() }} title="Додати акаунт">
    <form className="flex flex-col gap-4" autoComplete="off" onSubmit={submit}>
      <p className="text-sm text-text-muted">Окрема авторизація на цьому пристрої. Дані акаунтів не об’єднуються.</p>
      <Label>Email<Input type="email" name="add-account-email" autoComplete="off" required value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></Label>
      <Label>Пароль<Input type="password" name="add-account-password" autoComplete="new-password" required value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></Label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? 'Вхід…' : 'Додати та перейти'}</Button>
    </form>
  </Modal>
}

export function AccountManager({ compact = false }: { compact?: boolean }) {
  const { accounts, user, switchAccount, removeAccount, accountStorageError } = useAuth()
  const [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const { confirm, ConfirmDialog } = useConfirm()
  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не вдалося змінити акаунт.') }
    finally { setBusy(false) }
  }
  if (compact && !accounts.length) return null
  const content = <>
    <h2 className="mb-3 font-display font-semibold text-text">Акаунти на цьому пристрої</h2>
    <div className="flex flex-col gap-1">
      {accounts.map(account => <div key={account.id} className="flex min-w-0 items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void run(() => switchAccount(account.id))} aria-current={account.id === user?.id ? 'true' : undefined}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text hover:bg-surface-2">
          <span className="min-w-0 flex-1"><span className="block truncate">{accountLabel(account)}</span><span className="block truncate text-xs text-text-muted">{account.email}</span></span>{account.id === user?.id && <Check size={17} className="shrink-0 text-primary" aria-label="Активний акаунт" />}
        </button>
        <button type="button" disabled={busy} aria-label={`Прибрати з пристрою: ${account.email}`} className="rounded-lg p-3 text-text-muted hover:bg-surface-2" onClick={async () => {
          if (await confirm('Прибрати збережену авторизацію цього акаунта з пристрою? Сам акаунт і його дані залишаться.', { confirmLabel: 'Прибрати' })) void run(() => removeAccount(account.id))
        }}><X size={17} /></button>
      </div>)}
      {!compact && <Button type="button" variant="ghost" disabled={busy} onClick={() => setAdding(true)}><Plus size={17} />Додати акаунт</Button>}
    </div>
    {(error || accountStorageError) && <p role="alert" className="mt-2 text-sm text-danger">{error || accountStorageError}</p>}
    <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
    {ConfirmDialog}
  </>
  return compact ? <div className="mb-4">{content}</div> : <Card>{content}</Card>
}

export function useAccountSwitcher() {
  const { accounts, user, switchAccount } = useAuth()
  const [anchor, setAnchor] = useState<DOMRect | null>(null), [dragTarget, setDragTarget] = useState<string | null>(null)
  const [menuAccounts, setMenuAccounts] = useState<SavedAccount[]>([])
  const [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  const menuPresent = usePresence(!!anchor, 140)
  const renderedAnchor = useRef<DOMRect | null>(null)
  if (anchor) renderedAnchor.current = anchor
  const close = () => { if (!pending.current) { setAnchor(null); setDragTarget(null) } }
  useOverlayBack(!!anchor, close)
  const select = async (id: string) => {
    if (pending.current) return
    if (id === user?.id) { close(); return }
    pending.current = true; setBusy(true); setError('')
    try { await switchAccount(id); setAnchor(null) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не вдалося перемкнути акаунт.') }
    finally { pending.current = false; setBusy(false) }
  }
  const selectAction = (action: string) => {
    if (action === 'add') { setAnchor(null); setDragTarget(null); setAdding(true); return }
    if (action.startsWith('account:')) {
      setAnchor(null)
      setDragTarget(null)
      void select(action.slice('account:'.length))
    }
  }
  const bind = useAccountPress({
    onOpen: rect => { setError(''); setDragTarget(null); setMenuAccounts(accounts); setAnchor(rect) },
    onHover: setDragTarget,
    onSelect: selectAction,
    getActionAt: (x, y) => accountActionAt(panel.current, x, y),
  })
  useEffect(() => {
    if (!anchor) return
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && !panel.current?.contains(event.target)
        && !event.target.closest('[data-account-trigger]') && !pending.current) {
        setAnchor(null)
        setDragTarget(null)
      }
    }
    document.addEventListener('pointerdown', outside)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending.current) { setAnchor(null); setDragTarget(null) }
    }
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [anchor])
  const menuAnchor = anchor ?? renderedAnchor.current
  const overlay = <>
    {menuPresent && menuAnchor && createPortal(<div ref={panel} role="dialog" aria-label="Перемкнути акаунт" aria-hidden={!anchor}
      data-state={anchor ? 'open' : 'closed'} onKeyDown={event => { if (event.key === 'Escape') close() }}
      onClickCapture={bind.onMenuClickCapture}
      onContextMenu={event => { if (window.matchMedia('(pointer: coarse)').matches) event.preventDefault() }}
      className="account-switcher-menu fixed z-[70] overflow-y-auto rounded-2xl border border-border bg-surface/95 p-1.5 text-text shadow-xl backdrop-blur-xl"
      style={{ right: Math.max(12, window.innerWidth - menuAnchor.right), bottom: window.innerHeight - menuAnchor.top + 8, width: 'min(256px, calc(100vw - 36px))', maxHeight: Math.max(80, menuAnchor.top - 20) }}>
      <button type="button" data-account-switcher-action="add" data-drag-target={dragTarget === 'add' || undefined} disabled={busy}
        className="account-switcher-action flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-primary hover:bg-surface-2"
        onPointerDown={event => bind.onMenuPointerDown(event, 'add')} onLostPointerCapture={bind.onMenuLostPointerCapture}
        onClick={() => selectAction('add')}><Plus size={17} className="shrink-0" />Додати акаунт</button>
      {menuAccounts.map(account => {
        const action = `account:${account.id}`
        return <button type="button" key={account.id} data-account-switcher-action={action} data-drag-target={dragTarget === action || undefined} disabled={busy}
          onPointerDown={event => bind.onMenuPointerDown(event, action)} onLostPointerCapture={bind.onMenuLostPointerCapture}
          onClick={() => selectAction(action)} aria-current={account.id === user?.id ? 'true' : undefined}
          className={`account-switcher-action mt-0.5 flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2 ${account.id === user?.id ? 'text-primary' : 'text-text'}`}>
          <span className="min-w-0 break-words leading-snug">{accountLabel(account)}</span>
        </button>
      })}
      {error && <p role="alert" className="p-2 text-sm text-danger">{error}</p>}
    </div>, document.body)}
    <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
  </>
  return { bind, open: !!anchor, overlay }
}
