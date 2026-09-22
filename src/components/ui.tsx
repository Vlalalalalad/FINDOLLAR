import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
  type RefObject,
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  Children,
  isValidElement,
} from 'react'
import { ChevronDown, Check, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { usePresence } from '../hooks/usePresence'
import { useOverlayBack } from '../hooks/useOverlayBack'

export function Button({
  className,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-display text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        variant === 'primary' && 'bg-primary text-white hover:bg-primary-dark',
        variant === 'secondary' && 'border border-border bg-surface-2 text-text hover:bg-surface-3',
        variant === 'ghost' && 'text-text-muted hover:bg-surface-2',
        variant === 'danger' && 'bg-danger/10 text-danger hover:bg-danger/20',
        className
      )}
      {...props}
    />
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        'w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted transition-[border-color,box-shadow] duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-primary/40',
        props.className
      )}
    />
  )
}

export function Select({
  value,
  onChange,
  children,
  className,
  disabled,
  required,
}: {
  value: string
  onChange: (e: { target: { value: string } }) => void
  children: ReactNode
  className?: string
  disabled?: boolean
  required?: boolean
}) {
  const [open, setOpen] = useState(false)
  const menuPresent = usePresence(open, 140)
  const ref = useRef<HTMLDivElement>(null)

  const options = Children.toArray(children)
    .filter(isValidElement)
    .map(child => {
      const props = child.props as { value?: string; children?: ReactNode; disabled?: boolean }
      return { value: props.value ?? '', label: props.children, disabled: props.disabled }
    })
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    if (!open) return
    const onClickAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickAway)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={clsx('relative', className)}>
      {/* Прихований required-інпут — тільки щоб форма могла показати
          браузерну валідацію "заповніть поле", якщо required і нічого не обрано. */}
      {required && (
        <input tabIndex={-1} value={value} required onChange={() => {}} className="absolute h-0 w-full opacity-0" />
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-left text-sm text-text transition-[color,background-color,border-color,box-shadow] duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
      >
        <span className="truncate">{selected?.label ?? '—'}</span>
        <ChevronDown size={15} className={clsx('shrink-0 text-text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {menuPresent && (
        <div
          data-state={open ? 'open' : 'closed'}
          className="motion-popover absolute left-0 top-full z-50 mt-1 max-h-60 w-full min-w-max overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {options.map((o, i) => (
            <button
              key={`${o.value}-${i}`}
              type="button"
              disabled={o.disabled}
              onClick={() => {
                onChange({ target: { value: o.value } })
                setOpen(false)
              }}
              className={clsx(
                'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:opacity-40',
                o.value === value ? 'bg-primary/10 font-semibold text-primary' : 'text-text hover:bg-surface-2'
              )}
            >
              <span className="truncate">{o.label}</span>
              {o.value === value && <Check size={14} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        'w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted transition-[border-color,box-shadow] duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-primary/40',
        props.className
      )}
    />
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-text-muted">{children}</label>
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('rounded-xl border border-border bg-surface p-5', className)}>{children}</div>
}

export function Badge({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 font-display text-xs font-semibold"
      style={color ? { backgroundColor: `${color}1A`, color } : undefined}
    >
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
      <p className="font-display text-sm font-semibold text-text">{title}</p>
      {description && <p className="mt-1 max-w-xs text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

type ModalStackLevel = 'default' | 'top'

type ModalLayerEntry = {
  open: boolean
  stackLevel: ModalStackLevel
  order: number
}

type ModalLayerSnapshot = {
  active: boolean
  presentCount: number
  topId: symbol | null
  topZ: number
  zById: ReadonlyMap<symbol, number>
}

const modalLayerEntries = new Map<symbol, ModalLayerEntry>()
const modalLayerListeners = new Set<() => void>()
let modalLayerOrder = 0
let modalLayerSnapshot: ModalLayerSnapshot = {
  active: false,
  presentCount: 0,
  topId: null,
  topZ: 50,
  zById: new Map(),
}

const subscribeModalLayers = (listener: () => void) => {
  modalLayerListeners.add(listener)
  return () => {
    modalLayerListeners.delete(listener)
  }
}

const getModalLayerSnapshot = () => modalLayerSnapshot

const publishModalLayers = () => {
  const byLevel = (stackLevel: ModalStackLevel) =>
    [...modalLayerEntries.entries()]
      .filter(([, entry]) => entry.stackLevel === stackLevel)
      .sort(([, a], [, b]) => a.order - b.order)

  const zById = new Map<symbol, number>()
  byLevel('default').forEach(([id], index) => zById.set(id, 50 + index * 2))
  byLevel('top').forEach(([id], index) => zById.set(id, 70 + index * 2))

  let topId: symbol | null = null
  let topZ = 50
  zById.forEach((z, id) => {
    if (topId === null || z > topZ) {
      topId = id
      topZ = z
    }
  })

  modalLayerSnapshot = {
    active: [...modalLayerEntries.values()].some(entry => entry.open),
    presentCount: modalLayerEntries.size,
    topId,
    topZ,
    zById,
  }
  modalLayerListeners.forEach(listener => listener())
}

const updateModalLayer = (id: symbol, open: boolean, stackLevel: ModalStackLevel) => {
  const current = modalLayerEntries.get(id)
  const order = !current || (open && !current.open) ? ++modalLayerOrder : current.order
  if (current && current.open === open && current.stackLevel === stackLevel && current.order === order) return
  modalLayerEntries.set(id, { open, stackLevel, order })
  publishModalLayers()
}

const removeModalLayer = (id: symbol) => {
  if (!modalLayerEntries.delete(id)) return
  publishModalLayers()
}

/**
 * One shared backdrop serves the whole modal stack. During a details -> edit
 * hand-off the old and new panels can cross-fade, while this layer never
 * closes, so the page behind them cannot flash into view or lose its blur.
 */
export function ModalBackdropHost() {
  const layers = useSyncExternalStore(subscribeModalLayers, getModalLayerSnapshot, getModalLayerSnapshot)
  const baseBackdropPresent = usePresence(layers.active, 160)
  const stackBackdropActive = layers.active && layers.presentCount > 1
  const stackBackdropPresent = usePresence(stackBackdropActive, 160)
  const lastStackZ = useRef(51)
  if (layers.topId !== null) lastStackZ.current = layers.topZ - 1

  if (!baseBackdropPresent && !stackBackdropPresent) return null
  return createPortal(
    <>
      {baseBackdropPresent && (
        <div
          aria-hidden="true"
          data-state={layers.active ? 'open' : 'closed'}
          className="motion-modal-backdrop pointer-events-none fixed inset-0 bg-black/40 backdrop-blur-sm"
          style={{ zIndex: 49 }}
        />
      )}
      {stackBackdropPresent && (
        <div
          aria-hidden="true"
          data-state={stackBackdropActive ? 'open' : 'closed'}
          className="motion-modal-backdrop pointer-events-none fixed inset-0 bg-black/40 backdrop-blur-sm"
          style={{ zIndex: lastStackZ.current }}
        />
      )}
    </>,
    document.body
  )
}

let openModalCount = 0

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  contentRef,
  onContentScroll,
  onTitleLongPress,
  stackLevel = 'default',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  contentRef?: RefObject<HTMLDivElement>
  onContentScroll?: (e: UIEvent<HTMLDivElement>) => void
  onTitleLongPress?: () => void
  stackLevel?: ModalStackLevel
}) {
  const modalPresent = usePresence(open, 160)
  const layerId = useRef(Symbol('modal-layer')).current
  const openRef = useRef(open)
  const stackLevelRef = useRef(stackLevel)
  openRef.current = open
  stackLevelRef.current = stackLevel
  const layers = useSyncExternalStore(subscribeModalLayers, getModalLayerSnapshot, getModalLayerSnapshot)
  const layerZ = layers.zById.get(layerId) ?? (stackLevel === 'top' ? 70 : 50)
  const isTopLayer = layers.topId === layerId
  const backdropRef = useRef<HTMLDivElement>(null)
  useOverlayBack(open && isTopLayer, onClose, { keyboardRootRef: backdropRef })
  const renderedContent = useRef({ title, children, footer })
  if (open) renderedContent.current = { title, children, footer }

  // Keep a closing panel in the stack for its exit motion, but mark only
  // genuinely open panels as keeping the shared backdrop visible.
  useLayoutEffect(() => {
    if (!modalPresent) return
    updateModalLayer(layerId, openRef.current, stackLevelRef.current)
    return () => removeModalLayer(layerId)
  }, [layerId, modalPresent])

  useLayoutEffect(() => {
    if (modalPresent) updateModalLayer(layerId, open, stackLevel)
  }, [layerId, modalPresent, open, stackLevel])

  useEffect(() => {
    const backdrop = backdropRef.current
    if (!backdrop) return
    if (open && isTopLayer) backdrop.removeAttribute('inert')
    else backdrop.setAttribute('inert', '')
  }, [modalPresent, open, isTopLayer])

  // Поки хоч одна модалка відкрита — сторінка під нею не повинна
  // прокручуватись. Лічильник, а не "запам'ятати попереднє значення
  // overflow", свідомо: модалки тепер регулярно стоять одна над одною
  // (деталі + підтвердження, деталі + редагування), і хто з них
  // закриється першим — непередбачувано. Якщо кожна сама відновлює
  // "своє" попереднє значення, та, що закрилась останньою, може
  // повернути сторінці чуже "hidden" — і прокрутка ламається назавжди,
  // без перезавантаження сторінки. Лічильник несприйнятливий до порядку:
  // overflow чіпається лише на переході 0→1 і 1→0.
  useEffect(() => {
    if (!modalPresent) return
    openModalCount += 1
    document.body.style.overflow = 'hidden'
    return () => {
      openModalCount = Math.max(0, openModalCount - 1)
      if (openModalCount === 0) document.body.style.overflow = ''
    }
  }, [modalPresent])

  const titlePressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTitlePress = () => {
    if (titlePressTimer.current !== null) {
      clearTimeout(titlePressTimer.current)
      titlePressTimer.current = null
    }
  }
  const startTitlePress = () => {
    if (!onTitleLongPress) return
    clearTitlePress()
    titlePressTimer.current = setTimeout(() => {
      titlePressTimer.current = null
      onTitleLongPress()
    }, 600)
  }

  useEffect(() => {
    if (!open) clearTitlePress()
    return clearTitlePress
  }, [open])

  if (!modalPresent) return null
  const displayed = renderedContent.current
  return createPortal(
    <div
      ref={backdropRef}
      data-state={open ? 'open' : 'closed'}
      aria-hidden={!open || !isTopLayer}
      className={clsx(
        'fixed inset-0 flex items-end justify-center sm:items-center',
        (!open || !isTopLayer) && 'pointer-events-none'
      )}
      style={{ zIndex: layerZ }}
      onClick={open && isTopLayer ? onClose : undefined}
    >
      <div
        data-state={open ? 'open' : 'closed'}
        role="dialog"
        aria-modal="true"
        className="motion-modal-panel flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-surface shadow-xl sm:rounded-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Прокручується тільки цей блок, не сторінка під модалкою — тож
            "прокрутити догори" стосується саме його, а не window. */}
        <div ref={contentRef} data-modal-scroll-container onScroll={onContentScroll} className="overflow-y-auto p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2
              className={clsx('select-none font-display text-lg font-bold text-text', onTitleLongPress && 'touch-manipulation')}
              onPointerDown={onTitleLongPress ? startTitlePress : undefined}
              onPointerUp={onTitleLongPress ? clearTitlePress : undefined}
              onPointerLeave={onTitleLongPress ? clearTitlePress : undefined}
              onPointerCancel={onTitleLongPress ? clearTitlePress : undefined}
              onContextMenu={onTitleLongPress ? e => e.preventDefault() : undefined}
            >
              {displayed.title}
            </h2>
            <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted transition-[color,background-color,transform] duration-150 ease-out hover:bg-surface-2 active:scale-95">
              <X size={18} />
            </button>
          </div>
          {displayed.children}
        </div>
        {/* footer — свідомо поза прокручуваним блоком: не їде разом з
            контентом, лишається на місці, скільки б не гортав. */}
        {displayed.footer && <div className="shrink-0 border-t border-border p-4">{displayed.footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/**
 * Замінює браузерний confirm() власним діалогом у стилі застосунку.
 * Використання:
 *   const { confirm, ConfirmDialog } = useConfirm()
 *   ...
 *   onClick={async () => { if (await confirm('Видалити?')) remove(id) }}
 *   ...
 *   return <>...{ConfirmDialog}</>
 */
export function useConfirm() {
  const [state, setState] = useState<{
    message: string
    confirmLabel: string
    danger: boolean
    resolve: (value: boolean) => void
  } | null>(null)

  const confirm = useCallback(
    (message: string, options?: { confirmLabel?: string; danger?: boolean }) =>
      new Promise<boolean>(resolve => {
        setState({
          message,
          confirmLabel: options?.confirmLabel ?? 'Видалити',
          danger: options?.danger ?? true,
          resolve,
        })
      }),
    []
  )

  const respond = (value: boolean) => {
    state?.resolve(value)
    setState(null)
  }

  const ConfirmDialog = (
    <Modal open={!!state} onClose={() => respond(false)} title="Підтвердження" stackLevel="top">
      <div className="flex flex-col gap-5">
        <p className="text-sm text-text">{state?.message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => respond(false)}>
            Скасувати
          </Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => respond(true)}>
            {state?.confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )

  return { confirm, ConfirmDialog }
}
