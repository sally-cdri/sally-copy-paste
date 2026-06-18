import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { addClip, filterClips } from './core/history'
import type { ClipItem } from './core/types'
import { startClipboardMonitor, onText, onImage, writeClipboardText, writeClipboardImage } from './app/clipboard'
import { loadHistory, saveHistory, saveImagePng, readImageDataUrl } from './app/storage'
import { accessibilityOk, promptAccessibility, pasteSelected } from './app/paste'
import './App.css'

let counter = 0
function newId(): string {
  counter += 1
  return `${Date.now()}-${counter}`
}

export default function App() {
  const [items, setItems] = useState<ClipItem[]>([])
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const itemsRef = useRef<ClipItem[]>([])
  itemsRef.current = items

  const push = useCallback((it: ClipItem) => {
    setItems((prev) => {
      const next = addClip(prev, it)
      void saveHistory(next)
      return next
    })
  }, [])

  // 부트스트랩: 기존 기록 로드 + 모니터 시작 + 구독
  useEffect(() => {
    let cancelled = false
    const cleanups: Array<() => void> = []
    void (async () => {
      setItems(await loadHistory())
      if (!(await accessibilityOk())) void promptAccessibility()
      const stop = await startClipboardMonitor()
      const unText = await onText((text) => {
        if (!text) return
        push({ id: newId(), type: 'text', dedupKey: text, text, preview: text.slice(0, 200), createdAt: Date.now() })
      })
      const unImage = await onImage(async (b64) => {
        const id = newId()
        try {
          const path = await saveImagePng(id, b64)
          push({ id, type: 'image', dedupKey: `img:${b64.length}:${b64.slice(0, 32)}`, imagePath: path, preview: '[이미지]', createdAt: Date.now() })
        } catch {
          /* 저장 실패 무시 */
        }
      })
      // StrictMode 등으로 이미 정리됐으면 즉시 해제, 아니면 cleanup에 등록(이중 구독 방지)
      if (cancelled) {
        stop(); unText(); unImage()
      } else {
        cleanups.push(stop, unText, unImage)
      }
    })()
    return () => {
      cancelled = true
      cleanups.forEach((f) => f())
    }
  }, [push])

  // 동일 창 핸들을 메모이즈 — 렌더마다 Tauri 리스너 재등록 방지
  const win = useMemo(() => getCurrentWindow(), [])

  // 창 표시될 때 검색 초기화 + 선택 0 (1회 등록)
  useEffect(() => {
    const un = win.listen('popup-shown', () => { setQuery(''); setSel(0) })
    return () => { void un.then((f) => f()) }
  }, [win])

  // blur 시 숨김 (Tauri 리스너 — 1회 등록)
  useEffect(() => {
    const unFocus = win.onFocusChanged(({ payload: focused }) => { if (!focused) void win.hide() })
    return () => { void unFocus.then((f) => f()) }
  }, [win])

  // 키보드 탐색 (DOM 전용 — 최신 query/sel 클로저를 위해 매 렌더 재등록)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shown = filterClips(itemsRef.current, query)
      if (e.key === 'Escape') void win.hide()
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, shown.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
      else if (e.key === 'Enter') { e.preventDefault(); void choose(shown[sel]) }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  })

  // 이미지 썸네일 lazy 로드
  useEffect(() => {
    items.forEach((it) => {
      if (it.type === 'image' && it.imagePath && !thumbs[it.id]) {
        void readImageDataUrl(it.imagePath).then((url) => setThumbs((t) => ({ ...t, [it.id]: url })))
      }
    })
  }, [items, thumbs])

  async function choose(it: ClipItem | undefined) {
    if (!it) return
    if (it.type === 'text' && it.text != null) await writeClipboardText(it.text)
    else if (it.type === 'image' && it.imagePath) {
      const url = thumbs[it.id] ?? (await readImageDataUrl(it.imagePath))
      const b64 = url.split(',')[1]
      if (b64) await writeClipboardImage(b64)
    }
    await win.hide()
    await pasteSelected()
  }

  const shown = filterClips(items, query)

  return (
    <main className="picker">
      <input
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
              {it.type === 'image' && thumbs[it.id] ? (
                <img className="thumb" src={thumbs[it.id]} alt="" />
              ) : (
                <span className="text">{it.preview || it.text}</span>
              )}
            </li>
          ))
        )}
      </ul>
    </main>
  )
}
