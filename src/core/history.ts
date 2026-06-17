import type { ClipItem } from './types'

export const MAX_ITEMS = 200

export function addClip(list: ClipItem[], item: ClipItem, max = MAX_ITEMS): ClipItem[] {
  const without = list.filter((c) => c.dedupKey !== item.dedupKey)
  return [item, ...without].slice(0, max)
}

export function filterClips(list: ClipItem[], query: string): ClipItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((c) => (c.text ?? c.preview).toLowerCase().includes(q))
}
