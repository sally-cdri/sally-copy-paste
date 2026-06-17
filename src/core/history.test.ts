import { describe, it, expect } from 'vitest'
import { addClip, filterClips } from './history'
import type { ClipItem } from './types'

function item(id: string, text: string): ClipItem {
  return { id, type: 'text', dedupKey: text, text, preview: text, createdAt: Number(id) }
}

describe('addClip', () => {
  it('새 항목을 맨 앞에 추가한다', () => {
    const r = addClip([item('1', 'a')], item('2', 'b'))
    expect(r.map((c) => c.id)).toEqual(['2', '1'])
  })

  it('동일 내용(dedupKey)은 기존 것을 제거하고 맨 앞으로', () => {
    const r = addClip([item('1', 'a'), item('2', 'b')], item('3', 'a'))
    expect(r.map((c) => c.id)).toEqual(['3', '2'])
    expect(r).toHaveLength(2)
  })

  it('상한을 넘으면 오래된 것을 버린다', () => {
    const r = addClip([item('1', 'a'), item('2', 'b')], item('3', 'c'), 2)
    expect(r.map((c) => c.id)).toEqual(['3', '1'])
  })
})

describe('filterClips', () => {
  it('빈 쿼리는 전체', () => {
    const list = [item('1', 'apple'), item('2', 'banana')]
    expect(filterClips(list, '')).toHaveLength(2)
  })
  it('대소문자 무시 부분일치', () => {
    const list = [item('1', 'Apple'), item('2', 'banana')]
    expect(filterClips(list, 'app').map((c) => c.id)).toEqual(['1'])
  })
})
