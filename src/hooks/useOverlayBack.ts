import { useId, useLayoutEffect, useRef, type RefObject } from 'react'
import { createOverlayHistory } from '../lib/overlayHistory'

let manager: ReturnType<typeof createOverlayHistory> | undefined
function browserHistory() {
  return manager ??= createOverlayHistory({
    state: () => window.history.state,
    url: () => window.location.href,
    push: state => window.history.pushState(state, '', window.location.href),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    listen: handler => window.addEventListener('popstate', handler, { capture: true }),
    defer: callback => queueMicrotask(callback),
  }, crypto.randomUUID())
}

function dismissSoftwareKeyboard(root: HTMLElement | null | undefined) {
  const field = document.activeElement
  if (!(field instanceof HTMLElement)
    || !field.matches('textarea, input:not([type="checkbox"]):not([type="radio"]), [contenteditable="true"]')
    || !window.matchMedia('(any-pointer: coarse)').matches) return false
  const viewport = window.visualViewport
  if (viewport && Math.abs(viewport.scale - 1) > .02) return false
  const inset = viewport ? Math.max(window.innerHeight, document.documentElement.clientHeight) - viewport.height - viewport.offsetTop : 0
  if (root?.dataset.keyboard !== 'open' && inset < 80) return false
  field.blur()
  return true
}

/** Open panels consume Back before route history; closing a panel removes its entry. */
export function useOverlayBack(open: boolean, onClose: () => void, options: { keyboardRootRef?: RefObject<HTMLElement> } = {}) {
  const id = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const keyboardRef = useRef(options.keyboardRootRef)
  keyboardRef.current = options.keyboardRootRef
  useLayoutEffect(() => {
    if (!open) return
    return browserHistory().register({ id, close: () => closeRef.current(), dismissKeyboard: () => dismissSoftwareKeyboard(keyboardRef.current?.current) })
  }, [open, id])
}
