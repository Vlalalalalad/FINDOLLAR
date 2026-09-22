/** Use the finger's current viewport coordinates, not the touchstart target. */
export function accountActionAt(panel: HTMLElement | null, x: number, y: number): string | null {
  if (!panel) return null
  for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-account-action]')) {
    const rect = button.getBoundingClientRect()
    if (!button.disabled && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom)
      return button.dataset.accountAction ?? null
  }
  return null
}
