export type ClipType = 'text' | 'image'

export interface ClipItem {
  id: string
  type: ClipType
  dedupKey: string // 동일 내용 판별용 (text=본문, image=내용 해시)
  text?: string // type==='text'
  imagePath?: string // type==='image' 저장 파일 경로
  preview: string // 목록 표시용 (텍스트 요약 또는 라벨)
  createdAt: number
}
