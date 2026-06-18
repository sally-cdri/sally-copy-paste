import { describe, it, expect } from 'vitest'
import { filterClips } from './history'
import type { ClipItem } from './types'

function textItem(id: string, text: string): ClipItem {
  return { id, kind: 'text', text, preview: text, created_at: Number(id) }
}

function filesItem(id: string, files: string[], preview: string): ClipItem {
  return { id, kind: 'files', files, preview, created_at: Number(id) }
}

describe('filterClips', () => {
  it('빈 쿼리는 전체', () => {
    const list = [textItem('1', 'apple'), textItem('2', 'banana')]
    expect(filterClips(list, '')).toHaveLength(2)
  })

  it('대소문자 무시 부분일치 (text)', () => {
    const list = [textItem('1', 'Apple'), textItem('2', 'banana')]
    expect(filterClips(list, 'app').map((c) => c.id)).toEqual(['1'])
  })

  it('preview 기반 검색', () => {
    const list = [
      { id: '1', kind: 'image' as const, preview: '[이미지]', created_at: 0 },
      textItem('2', 'hello'),
    ]
    expect(filterClips(list, '이미지').map((c) => c.id)).toEqual(['1'])
  })

  it('files 항목의 파일명 검색', () => {
    const list = [
      filesItem('1', ['/Users/sally/document.pdf', '/Users/sally/photo.png'], 'document.pdf, photo.png'),
      textItem('2', 'hello'),
    ]
    expect(filterClips(list, 'photo').map((c) => c.id)).toEqual(['1'])
  })

  it('일치 없으면 빈 배열', () => {
    const list = [textItem('1', 'apple'), textItem('2', 'banana')]
    expect(filterClips(list, 'xyz')).toHaveLength(0)
  })

  it('트림된 쿼리로 검색', () => {
    const list = [textItem('1', 'hello world')]
    expect(filterClips(list, '  hello  ').map((c) => c.id)).toEqual(['1'])
  })
})
