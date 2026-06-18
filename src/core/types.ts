export type ClipKind = 'text' | 'image' | 'files'

export interface ClipItem {
  id: string
  kind: ClipKind
  text?: string | null
  image_path?: string | null
  files?: string[] | null
  preview: string
  created_at: number
}
