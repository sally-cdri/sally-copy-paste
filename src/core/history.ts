import type { ClipItem } from './types'

export function filterClips(list: ClipItem[], query: string): ClipItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((c) => {
    const text = (c.text ?? c.preview).toLowerCase()
    const files = (c.files ?? []).join(' ').toLowerCase()
    return text.includes(q) || files.includes(q)
  })
}
