/** Merge disjoint edits against a fresh revision without overwriting another editor. */
export function mergeEditorChanges<T extends object>(baseline: T, edited: T, latest: T) {
  const patch: Partial<T> = {}
  const conflicts: (keyof T)[] = []
  for (const key of Object.keys(edited) as (keyof T)[]) {
    const before = JSON.stringify(baseline[key]), wanted = JSON.stringify(edited[key]), current = JSON.stringify(latest[key])
    if (wanted === before || wanted === current) continue
    if (current !== before) conflicts.push(key)
    else patch[key] = edited[key]
  }
  return { patch, conflicts }
}
