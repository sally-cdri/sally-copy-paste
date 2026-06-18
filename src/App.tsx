import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { filterClips } from './core/history'
import type { ClipItem } from './core/types'
import { accessibilityOk, promptAccessibility } from './app/paste'
import './App.css'

function KindIcon({ kind }: { kind: ClipItem['kind'] }) {
  if (kind === 'image') {
    return (
      <svg className="kicon" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
        <circle cx="6" cy="6.3" r="1.1" />
        <path d="M3 12l3.3-3.2 2.4 2.3 2-1.8 2.3 2.4" />
      </svg>
    )
  }
  if (kind === 'files') {
    return (
      <svg className="kicon" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.6 5.2a1 1 0 0 1 1-1h2.6l1.2 1.4h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
      </svg>
    )
  }
  return (
    <svg className="kicon" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="4.5" x2="13" y2="4.5" />
      <line x1="3" y1="8" x2="13" y2="8" />
      <line x1="3" y1="11.5" x2="10" y2="11.5" />
    </svg>
  )
}

export default function App() {
  const [items, setItems] = useState<ClipItem[]>([])
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [toast, setToast] = useState(false)
  const itemsRef = useRef<ClipItem[]>([])
  itemsRef.current = items
  const inputRef = useRef<HTMLInputElement>(null)
  const selRowRef = useRef<HTMLLIElement>(null)

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
      } else if (
        (e.key === 'Backspace' || e.key === 'Delete') &&
        (e.metaKey || query === '')
      ) {
        // 검색어가 비어 있거나 Cmd 조합일 때만 항목 삭제(검색 글자 삭제와 충돌 방지)
        const target = shown[sel]
        if (target) {
          e.preventDefault()
          void remove(target.id, shown.length)
        }
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

  // 화살표 이동 시 선택 항목이 보이도록 자동 스크롤
  useEffect(() => {
    selRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [sel, query, items])

  async function remove(id: string, shownLen: number) {
    await invoke('delete_clip', { id })
    await fetchHistory()
    setSel((s) => Math.min(s, Math.max(0, shownLen - 2)))
  }

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
  const selected = shown[sel]

  return (
    <main className="picker">
      <div className="dragbar" data-tauri-drag-region>
        <span className="grip" />
      </div>
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
            <li
              key={it.id}
              ref={i === sel ? selRowRef : null}
              className={`row ${i === sel ? 'is-sel' : ''}`}
              onClick={() => void choose(it)}
            >
              <KindIcon kind={it.kind} />
              {it.kind === 'image' && thumbs[it.id] ? (
                <img className="thumb" src={`data:image/png;base64,${thumbs[it.id]}`} alt="" />
              ) : (
                <span className="text">{it.preview || it.text}</span>
              )}
            </li>
          ))
        )}
      </ul>
      <div className="preview">
        {!selected ? (
          <span className="ph">선택된 항목이 없습니다</span>
        ) : selected.kind === 'image' ? (
          thumbs[selected.id] ? (
            <img src={`data:image/png;base64,${thumbs[selected.id]}`} alt="" />
          ) : (
            <span className="ph">[이미지]</span>
          )
        ) : selected.kind === 'files' ? (
          (selected.files ?? []).join('\n')
        ) : (
          selected.text || selected.preview
        )}
      </div>
      {toast && <div className="toast">복사되었습니다</div>}
    </main>
  )
}
