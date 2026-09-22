import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Palette } from 'lucide-react'
import clsx from 'clsx'
import { usePresence } from '../hooks/usePresence'
import { useAuth } from '../context/AuthContext'
import { accountStorage } from '../lib/accountStorage'

export const COLOR_PRESETS: readonly string[] = [
  '#0E8F6E',
  '#2E93C9',
  '#C98A1D',
  '#B5432E',
  '#C25B9E',
  '#7C5FD1',
  '#6B6A63',
]

const LAST_CUSTOM_COLOR_KEY = 'findossar-last-custom-color'

type HsvColor = { h: number; s: number; v: number }

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

function normalizeHex(value: string) {
  const candidate = value.trim().toUpperCase()
  const withHash = candidate.startsWith('#') ? candidate : `#${candidate}`
  return /^#[0-9A-F]{6}$/.test(withHash) ? withHash : null
}

function readLastCustomColor(userId: string) {
  if (typeof window === 'undefined') return null
  try {
    return normalizeHex(accountStorage(userId).getItem(LAST_CUSTOM_COLOR_KEY) ?? '')
  } catch {
    return null
  }
}

function saveCustomColor(userId: string, color: string) {
  if (typeof window === 'undefined') return
  try {
    accountStorage(userId).setItem(LAST_CUSTOM_COLOR_KEY, color)
  } catch {
    // The picker remains usable when storage is unavailable.
  }
}

function hexToHsv(hex: string): HsvColor {
  const normalized = normalizeHex(hex) ?? COLOR_PRESETS[0]
  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min

  let hue = 0
  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }
  if (hue < 0) hue += 360

  return { h: hue, s: max === 0 ? 0 : delta / max, v: max }
}

function hsvToHex({ h, s, v }: HsvColor) {
  const hue = ((h % 360) + 360) % 360
  const saturation = clamp(s)
  const value = clamp(v)
  const chroma = value * saturation
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const match = value - chroma

  let red = 0
  let green = 0
  let blue = 0
  if (hue < 60) [red, green] = [chroma, x]
  else if (hue < 120) [red, green] = [x, chroma]
  else if (hue < 180) [green, blue] = [chroma, x]
  else if (hue < 240) [green, blue] = [x, chroma]
  else if (hue < 300) [red, blue] = [x, chroma]
  else [red, blue] = [chroma, x]

  const channel = (part: number) => Math.round((part + match) * 255).toString(16).padStart(2, '0')
  return `#${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase()
}

function colorIconClass(hex: string | null) {
  if (!hex) return 'text-text-muted'
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return red * 0.299 + green * 0.587 + blue * 0.114 > 165 ? 'text-black/70' : 'text-white'
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const { user } = useAuth()
  const rememberCustomColor = (color: string) => saveCustomColor(user?.id ?? 'signed-out', color)
  const selectedColor = normalizeHex(value) ?? COLOR_PRESETS[0]
  const selectedPreset = COLOR_PRESETS.includes(selectedColor)
  const customSelected = !selectedPreset
  const seedRef = useRef<{ custom: string | null; picker: string } | null>(null)
  if (!seedRef.current) {
    const stored = readLastCustomColor(user?.id ?? 'signed-out')
    seedRef.current = { custom: stored, picker: customSelected ? selectedColor : stored ?? selectedColor }
  }

  const [lastCustomColor, setLastCustomColor] = useState<string | null>(seedRef.current.custom)
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(seedRef.current!.picker))
  const [hexDraft, setHexDraft] = useState(seedRef.current.picker)
  const [pickerOpen, setPickerOpen] = useState(false)
  const panelPresent = usePresence(pickerOpen, 180)
  const panelId = useId()
  const activePointerRef = useRef<number | null>(null)
  const pendingHsvRef = useRef<HsvColor | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const hsvRef = useRef(hsv)
  hsvRef.current = hsv
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current)
    }
  }, [])

  const commitCustomHsv = (nextColor: HsvColor, persist = false) => {
    const next = { h: ((nextColor.h % 360) + 360) % 360, s: clamp(nextColor.s), v: clamp(nextColor.v) }
    const hex = hsvToHex(next)
    hsvRef.current = next
    setHsv(next)
    setHexDraft(hex)
    setLastCustomColor(hex)
    if (persist) rememberCustomColor(hex)
    onChange(hex)
  }

  const commitCustomHex = (hex: string) => {
    const normalized = normalizeHex(hex)
    if (!normalized) return false
    const next = hexToHsv(normalized)
    hsvRef.current = next
    setHsv(next)
    setHexDraft(normalized)
    setLastCustomColor(normalized)
    rememberCustomColor(normalized)
    onChange(normalized)
    return true
  }

  const closePicker = () => {
    const active = document.activeElement
    if (active instanceof HTMLElement && rootRef.current?.contains(active)) active.blur()
    setPickerOpen(false)
  }

  useEffect(() => {
    if (!pickerOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !rootRef.current?.contains(target)) {
        const active = document.activeElement
        if (active instanceof HTMLElement && rootRef.current?.contains(active)) active.blur()
        setPickerOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
  }, [pickerOpen])

  useEffect(() => {
    if (!pickerOpen) return
    const panel = panelRef.current
    const scroller = panel?.closest<HTMLElement>('[data-modal-scroll-container]')
    if (!panel || !scroller) return

    let cancelled = false
    let revealed = false
    let frame = 0

    const cancelPendingReveal = () => {
      cancelled = true
    }

    const revealPanel = () => {
      if (cancelled || revealed) return
      revealed = true
      frame = window.requestAnimationFrame(() => {
        const panelRect = panel.getBoundingClientRect()
        const scrollerRect = scroller.getBoundingClientRect()
        const visualViewport = window.visualViewport
        const viewportTop = visualViewport?.offsetTop ?? 0
        const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight)
        const margin = 14
        const safeTop = Math.max(scrollerRect.top, viewportTop) + margin
        const safeBottom = Math.min(scrollerRect.bottom, viewportBottom) - margin

        let delta = 0
        if (panelRect.bottom > safeBottom) delta = panelRect.bottom - safeBottom
        else if (panelRect.top < safeTop) delta = panelRect.top - safeTop
        if (Math.abs(delta) < 1) return

        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        const nextTop = Math.min(maxScrollTop, Math.max(0, scroller.scrollTop + delta))
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        scroller.scrollTo({ top: nextTop, behavior: reduceMotion ? 'auto' : 'smooth' })
      })
    }

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target === panel && event.propertyName === 'grid-template-rows') revealPanel()
    }

    panel.addEventListener('transitionend', handleTransitionEnd)
    scroller.addEventListener('pointerdown', cancelPendingReveal, { passive: true })
    scroller.addEventListener('wheel', cancelPendingReveal, { passive: true })
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(revealPanel, reduceMotion ? 0 : 230)

    return () => {
      window.clearTimeout(timer)
      window.cancelAnimationFrame(frame)
      panel.removeEventListener('transitionend', handleTransitionEnd)
      scroller.removeEventListener('pointerdown', cancelPendingReveal)
      scroller.removeEventListener('wheel', cancelPendingReveal)
    }
  }, [pickerOpen])

  const applyPresetColor = (color: string) => {
    const normalized = normalizeHex(color)
    if (!normalized) return
    closePicker()
    onChange(normalized)
  }

  const handlePaletteClick = () => {
    if (customSelected) {
      const current = hexToHsv(selectedColor)
      hsvRef.current = current
      setHsv(current)
      setHexDraft(selectedColor)
      setPickerOpen(open => !open)
      return
    }

    // First tap restores the remembered custom color. Once selected, the
    // following tap opens the editor at exactly that saved color.
    if (lastCustomColor && selectedColor !== lastCustomColor) {
      setHsv(hexToHsv(lastCustomColor))
      setHexDraft(lastCustomColor)
      onChange(lastCustomColor)
      return
    }
    setPickerOpen(open => !open)
  }

  const saturationValueAt = (clientX: number, clientY: number, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      h: hsvRef.current.h,
      s: clamp((clientX - rect.left) / rect.width),
      v: 1 - clamp((clientY - rect.top) / rect.height),
    }
  }

  const scheduleSaturationValue = (next: HsvColor) => {
    pendingHsvRef.current = next
    if (animationFrameRef.current !== null) return
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      const queued = pendingHsvRef.current
      pendingHsvRef.current = null
      if (queued) commitCustomHsv(queued)
    })
  }

  const handleSvPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    activePointerRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    const next = saturationValueAt(event.clientX, event.clientY, event.currentTarget)
    if (next) commitCustomHsv(next, true)
  }

  const handleSvPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return
    const next = saturationValueAt(event.clientX, event.clientY, event.currentTarget)
    if (next) scheduleSaturationValue(next)
  }

  const handleSvPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return
    activePointerRef.current = null
    const queued = pendingHsvRef.current
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = null
    pendingHsvRef.current = null
    if (queued) commitCustomHsv(queued)
    rememberCustomColor(hsvToHex(queued ?? hsvRef.current))
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleSvKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02
    let next = hsv
    if (event.key === 'ArrowLeft') next = { ...hsv, s: hsv.s - step }
    else if (event.key === 'ArrowRight') next = { ...hsv, s: hsv.s + step }
    else if (event.key === 'ArrowUp') next = { ...hsv, v: hsv.v + step }
    else if (event.key === 'ArrowDown') next = { ...hsv, v: hsv.v - step }
    else return
    event.preventDefault()
    commitCustomHsv(next, true)
  }

  const handleHexChange = (event: ChangeEvent<HTMLInputElement>) => {
    let next = event.target.value.toUpperCase().replace(/[^#0-9A-F]/g, '')
    if (next && !next.startsWith('#')) next = `#${next}`
    next = next.slice(0, 7)
    setHexDraft(next)
    const normalized = normalizeHex(next)
    if (normalized) commitCustomHex(normalized)
  }

  const finishHexEdit = () => {
    if (!commitCustomHex(hexDraft)) setHexDraft(lastCustomColor ?? hsvToHex(hsv))
  }

  const renderSelectionRing = (color: string) => (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-full border-2"
      style={{ borderColor: color }}
    />
  )

  const paletteDisplayColor = customSelected ? selectedColor : lastCustomColor
  const selectedPresetIndex = COLOR_PRESETS.indexOf(selectedColor)
  const compactPresetColors = selectedPresetIndex >= 5
    ? [...COLOR_PRESETS.slice(0, 4), selectedColor]
    : COLOR_PRESETS.slice(0, 5)

  return (
    <div
      ref={rootRef}
      className="relative flex flex-col"
      onKeyDown={event => {
        if (event.key === 'Escape' && pickerOpen) {
          event.stopPropagation()
          closePicker()
        }
      }}
    >
      <div className="flex items-center justify-between gap-0.5 py-1">
        {COLOR_PRESETS.map(color => {
          const selected = selectedColor === color
          return (
            <div
              key={color}
              className={clsx(
                'relative h-9 w-9 shrink-0 min-[320px]:h-10 min-[320px]:w-10 min-[420px]:h-11 min-[420px]:w-11',
                !compactPresetColors.includes(color) && 'hidden min-[420px]:block',
                selected && 'z-10'
              )}
            >
              <button
                type="button"
                aria-label={`Вибрати колір ${color}`}
                aria-pressed={selected}
                onClick={() => applyPresetColor(color)}
                className="relative h-full w-full rounded-full transition-transform duration-150 ease-out active:scale-95"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-1 rounded-full"
                  style={{ backgroundColor: color }}
                />
              </button>
              {selected && renderSelectionRing(color)}
            </div>
          )
        })}

        <div className={clsx('relative h-9 w-9 shrink-0 min-[320px]:h-10 min-[320px]:w-10 min-[420px]:h-11 min-[420px]:w-11', customSelected && 'z-10')}>
          <button
            type="button"
            aria-label={
              customSelected
                ? pickerOpen ? 'Закрити палітру' : 'Змінити власний колір'
                : lastCustomColor
                  ? 'Вибрати збережений власний колір'
                  : 'Відкрити палітру власного кольору'
            }
            aria-pressed={customSelected}
            aria-expanded={pickerOpen}
            aria-controls={panelId}
            onClick={handlePaletteClick}
            className="relative h-full w-full rounded-full transition-transform duration-150 ease-out active:scale-95"
          >
            <span
              aria-hidden="true"
              className={clsx(
                'pointer-events-none absolute inset-1 rounded-full border bg-surface-2',
                paletteDisplayColor ? 'border-transparent' : 'border-border'
              )}
              style={{ backgroundColor: paletteDisplayColor ?? undefined }}
            />
            <Palette
              size={16}
              className={clsx('pointer-events-none absolute inset-0 m-auto drop-shadow-sm', colorIconClass(paletteDisplayColor))}
            />
          </button>
          {customSelected && renderSelectionRing(selectedColor)}
        </div>
      </div>

      {panelPresent && (
        <div
          ref={panelRef}
          id={panelId}
          data-state={pickerOpen ? 'open' : 'closed'}
          aria-hidden={!pickerOpen}
          className="color-picker-panel"
        >
          <div className="min-h-0 overflow-hidden">
            <div className="rounded-xl border border-border bg-surface-2/70 p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-text">Власний колір</span>
                <button
                  type="button"
                  disabled={!pickerOpen}
                  onClick={closePicker}
                  className="min-h-10 rounded-md px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                >
                  Готово
                </button>
              </div>

              <div
                role="slider"
                tabIndex={pickerOpen ? 0 : -1}
                aria-label="Насиченість і яскравість кольору"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(hsv.s * 100)}
                aria-valuetext={`${Math.round(hsv.s * 100)}% насиченості, ${Math.round(hsv.v * 100)}% яскравості`}
                onPointerDown={handleSvPointerDown}
                onPointerMove={handleSvPointerMove}
                onPointerUp={handleSvPointerEnd}
                onPointerCancel={handleSvPointerEnd}
                onKeyDown={handleSvKeyDown}
                className="relative h-40 w-full cursor-crosshair touch-none overflow-hidden rounded-lg border border-border outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:h-44"
                style={{
                  backgroundColor: `hsl(${hsv.h} 100% 50%)`,
                  backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
                }}
              >
                <span
                  className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
                  style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
                />
              </div>

              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-text-muted">
                  <span>Відтінок</span>
                  <span>{Math.round(hsv.h)}°</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="359"
                  step="1"
                  value={Math.round(hsv.h)}
                  disabled={!pickerOpen}
                  onChange={event => commitCustomHsv({ ...hsv, h: Number(event.target.value) })}
                  onPointerUp={() => rememberCustomColor(hsvToHex(hsvRef.current))}
                  onPointerCancel={() => rememberCustomColor(hsvToHex(hsvRef.current))}
                  onKeyUp={() => rememberCustomColor(hsvToHex(hsvRef.current))}
                  onBlur={() => rememberCustomColor(hsvToHex(hsvRef.current))}
                  aria-label="Відтінок кольору"
                  className="color-hue-range w-full"
                  style={{ '--picker-hue': hsv.h } as CSSProperties}
                />
              </div>

              <div className="mt-3 flex items-end gap-2.5">
                <span
                  aria-hidden="true"
                  className="mb-0.5 h-9 w-9 shrink-0 rounded-full border border-border shadow-sm"
                  style={{ backgroundColor: hsvToHex(hsv) }}
                />
                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-[11px] font-medium text-text-muted">HEX-код</span>
                  <input
                    type="text"
                    value={hexDraft}
                    maxLength={7}
                    disabled={!pickerOpen}
                    spellCheck={false}
                    autoCapitalize="characters"
                    autoComplete="off"
                    inputMode="text"
                    aria-invalid={!normalizeHex(hexDraft)}
                    onChange={handleHexChange}
                    onBlur={finishHexEdit}
                    onKeyDown={event => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      finishHexEdit()
                      event.currentTarget.blur()
                    }}
                    className={clsx(
                      'w-full rounded-lg border bg-surface px-3 py-2 font-mono text-sm uppercase text-text outline-none transition-colors focus:ring-2 focus:ring-primary/30',
                      normalizeHex(hexDraft) ? 'border-border' : 'border-danger'
                    )}
                    placeholder="#E07A5F"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
