/** Use the finger's current viewport coordinates, not the touchstart target. */
export function accountActionAt(
  panel: HTMLElement | null,
  x: number,
  y: number,
  hitTestDocument: Pick<Document, 'elementFromPoint'> = document,
): string | null {
  if (!panel) return null
  const target = hitTestDocument.elementFromPoint(x, y)
  const row = target?.closest<HTMLElement>('[data-account-switcher-action]') ?? null
  if (!row || !panel.contains(row) || (row as HTMLButtonElement).disabled) return null
  return row.dataset.accountSwitcherAction ?? null
}
