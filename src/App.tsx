import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { filterClips } from './core/history'
import type { ClipItem } from './core/types'
import { accessibilityOk, promptAccessibility } from './app/paste'
import './App.css'

export default function App() {
  const [items, setItems] = useState<ClipItem[]>([])
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [toast, setToast] = useState(false)
  const itemsRef = useRef<ClipItem[]>([])
  itemsRef.current = items
  const inputRef = useRef<HTMLInputElement>(null)

  const win = useMemo(() => getCurrentWindow(), [])

  const fetchHistory = useCallback(async () => {
    const list = await invoke<ClipItem[]>('get_history')
    setItems(list)
  }, [])

  // 부트스트랩: 기록 로드 + 접근성 확인
  useEffect(() => {
    void (async () => {
      await fetchHistory()
      if (!(await accessibilityOk())) void promptAccessibility()
    })()
  }, [fetchHistory])

  // history-updated 이벤트 구독
  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null

    void win.listen('history-updated', () => {
      void fetchHistory()
    }).then((fn) => {
      if (cancelled) {
        fn()
      } else {
        unlisten = fn
      }
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [win, fetchHistory])

  // popup-shown 이벤트 구독
  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null

    void win.listen('popup-shown', () => {
      setQuery('')
      setSel(0)
      setToast(false)
      void fetchHistory()
      inputRef.current?.focus()
    }).then((fn) => {
      if (cancelled) {
        fn()
      } else {
        unlisten = fn
      }
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [win, fetchHistory])

  // blur 시 숨김
  useEffect(() => {
    const unFocus = win.onFocusChanged(({ payload: focused }) => {
      if (!focused) void win.hide()
    })
    return () => { void unFocus.then((f) => f()) }
  }, [win])

  // 키보드 탐색 (최신 query/sel 클로저를 위해 매 렌더 재등록)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shown = filterClips(itemsRef.current, query)
      if (e.key === 'Escape') {
        void win.hide()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSel((s) => Math.min(s + 1, shown.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSel((s) => Math.max(s - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        void choose(shown[sel])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  })

  // 이미지 썸네일 lazy 로드
  useEffect(() => {
    items.forEach((it) => {
      if (it.kind === 'image' && it.image_path && !thumbs[it.id]) {
        void invoke<string | null>('clip_image_b64', { id: it.id }).then((b64) => {
          if (b64) setThumbs((t) => ({ ...t, [it.id]: b64 }))
        })
      }
    })
  }, [items, thumbs])

  async function choose(it: ClipItem | undefined) {
    if (!it) return
    // 앱 내에서 "복사되었습니다" 토스트를 잠깐 보여준 뒤 닫고 붙여넣기
    setToast(true)
    await new Promise((r) => setTimeout(r, 800))
    setToast(false)
    await win.hide()
    await invoke('paste_clip', { id: it.id })
  }

  const shown = filterClips(items, query)

  return (
    <main className="picker">
      <input
        ref={inputRef}
        className="search"
        autoFocus
        placeholder="검색…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setSel(0) }}
      />
      <ul className="list">
        {shown.length === 0 ? (
          <li className="empty">기록이 없습니다</li>
        ) : (
          shown.map((it, i) => (
            <li key={it.id} className={`row ${i === sel ? 'is-sel' : ''}`} onClick={() => void choose(it)}>
              {it.kind === 'image' && thumbs[it.id] ? (
                <img className="thumb" src={`data:image/png;base64,${thumbs[it.id]}`} alt="" />
              ) : it.kind === 'image' ? (
                <span className="text">{it.preview}</span>
              ) : it.kind === 'files' ? (
                <span className="text">{it.preview}</span>
              ) : (
                <span className="text">{it.preview || it.text}</span>
              )}
            </li>
          ))
        )}
      </ul>
      {toast && <div className="toast">복사되었습니다</div>}
    </main>
  )
}
