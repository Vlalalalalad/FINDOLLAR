/** A single same-route history entry represents the currently open overlay stack. */
export const OVERLAY_HISTORY_KEY = '__findossarOverlay'

type HistoryValue = Record<string, unknown> | null
type Overlay = { id: string; close: () => void; dismissKeyboard?: () => boolean }
export interface OverlayHistoryEnvironment {
  state: () => HistoryValue
  url: () => string
  push: (state: Record<string, unknown>) => void
  back: () => void
  forward: () => void
  listen: (handler: (event: { stopImmediatePropagation: () => void }) => void) => void
  defer: (callback: () => void) => void
}

/** Kept independent of React so nested panels and delayed exit animations agree. */
export function createOverlayHistory(environment: OverlayHistoryEnvironment, session: string) {
  const overlays: Overlay[] = []
  let anchor: { url: string; key: unknown; idx: unknown } | null = null
  let armed = false
  let removing = false
  let cleanupQueued = false
  const marker = () => environment.state()?.[OVERLAY_HISTORY_KEY] === session
  const snapshot = () => ({ url: environment.url(), key: environment.state()?.key, idx: environment.state()?.idx, marker: marker() })
  let previous = snapshot()
  let forwardingStale: ReturnType<typeof snapshot> | null = null
  const atAnchor = () => anchor?.url === environment.url()
    && anchor.key === environment.state()?.key && anchor.idx === environment.state()?.idx

  const arm = () => {
    if (!overlays.length || removing) return
    const state = environment.state()
    anchor = { url: environment.url(), key: state?.key, idx: state?.idx }
    // Router-owned key, idx and usr are deliberately preserved. These entries
    // are consumed before its popstate listener sees them.
    if (!marker()) environment.push({ ...state, [OVERLAY_HISTORY_KEY]: session })
    armed = true
    previous = snapshot()
  }

  environment.listen(event => {
    const current = snapshot()
    const cameFromBase = !previous.marker && previous.url === current.url && previous.key === current.key && previous.idx === current.idx
    previous = current
    if (forwardingStale) {
      const atDuplicateBase = !current.marker && forwardingStale.url === current.url && forwardingStale.key === current.key && forwardingStale.idx === current.idx
      forwardingStale = null
      if (atDuplicateBase && !overlays.length) {
        // Forward at the end of history can land on a closed sentinel with no
        // later entry. A subsequent Back skips its adjacent duplicate base.
        event.stopImmediatePropagation()
        environment.back()
        return
      }
    }
    if (removing) {
      removing = false
      if (atAnchor()) {
        event.stopImmediatePropagation()
        arm()
        return
      }
    }
    if (marker()) {
      // A normal route change may leave an overlay entry behind it. Skip only
      // our own same-session sentinel, revealing the original route below it.
      if (!armed || !overlays.length || anchor?.url !== environment.url()) {
        event.stopImmediatePropagation()
        armed = false
        if (cameFromBase) { forwardingStale = current; environment.forward() }
        else environment.back()
      }
      return
    }
    if (!armed || !atAnchor()) { armed = false; return }
    event.stopImmediatePropagation()
    armed = false
    const overlay = overlays[overlays.length - 1]
    if (!overlay) return
    // Android normally consumes Back to dismiss the IME without a popstate.
    // This fallback handles browsers which deliver both actions to the page.
    if (overlay.dismissKeyboard?.()) { arm(); return }
    overlays.pop()
    overlay.close()
    arm()
  })

  return {
    register(overlay: Overlay) {
      const existing = overlays.findIndex(item => item.id === overlay.id)
      if (existing >= 0) overlays.splice(existing, 1)
      overlays.push(overlay)
      arm()
      let active = true
      return () => {
        if (!active) return
        active = false
        const index = overlays.indexOf(overlay)
        if (index >= 0) overlays.splice(index, 1)
        if (overlays.length || cleanupQueued) return
        cleanupQueued = true
        // Coalesce StrictMode remounts, replacing panels and same-event route
        // navigation before deciding whether our entry still needs removal.
        environment.defer(() => {
          cleanupQueued = false
          if (overlays.length || removing) return
          if (!marker()) { armed = false; previous = snapshot(); return }
          armed = false
          removing = true
          environment.back()
        })
      }
    },
  }
}
