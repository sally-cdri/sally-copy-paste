# sally-copy-paste (클립보드 매니저) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 복사한 텍스트·이미지를 자동 기록하고, 전역 핫키(Cmd+Shift+V)로 띄운 피커에서 골라 원래 앱에 자동 붙여넣는 macOS 클립보드 매니저.

**Architecture:** Tauri v2(React/TS + Rust). 플랫폼 독립 히스토리 로직은 `src/core`(단위 테스트), 클립보드 모니터/전역 핫키/자동 붙여넣기는 Rust + 플러그인. 클립보드는 CrossCopy `tauri-plugin-clipboard`(모니터링 + 텍스트/base64 PNG read·write) 하나로 처리.

**Tech Stack:** Tauri v2, React+TS+Vite, Vitest, `tauri-plugin-clipboard`(+`tauri-plugin-clipboard-api`), `@tauri-apps/plugin-global-shortcut`, `@tauri-apps/plugin-fs`, Rust `core-graphics`·`objc2-app-kit`·`macos-accessibility-client`.

## Global Constraints

- Tauri **v2**. 플러그인/커맨드/설정은 `src-tauri/src/lib.rs`의 `run()` 빌더에 작성. `invoke`는 `@tauri-apps/api/core`.
- 권한은 v2 capabilities(`src-tauri/capabilities/default.json`).
- 전역 핫키: **Cmd+Shift+V**(`CommandOrControl+Shift+V` / Rust `Modifiers::SUPER|SHIFT, Code::KeyV`). 핸들러는 `Pressed`에서만 동작.
- 자동 붙여넣기: 직전 프런트 앱(`NSWorkspace.frontmostApplication`)을 핫키 시점에 캡처 → 선택 시 클립보드 write → 창 hide → 직전 앱 재활성 → ~60ms 지연 → CGEvent로 Cmd+V. **접근성(Accessibility) 권한 필요**(`macos-accessibility-client`로 확인/프롬프트). 미허용 시 클립보드 복사만.
- 이미지: CrossCopy의 **base64 PNG**로 read/write. 디스크엔 PNG 파일로 저장(appdata).
- 히스토리 상한 **200개**, 동일 내용 재복사는 맨 위로(중복 제거).
- 메뉴바/Dock 아이콘 없음: macOS `ActivationPolicy::Accessory`.
- 커밋 메시지에 Claude/AI 표기·이모지 금지.
- DRY / YAGNI / TDD / 잦은 커밋.

## File Structure

```
sally-copy-paste/
  src/
    core/
      types.ts          # ClipItem, ClipType
      history.ts        # addClip(dedup/cap), filterClips
      history.test.ts
    app/
      clipboard.ts      # CrossCopy 래퍼: startListening, onTextUpdate, onImageUpdate, write*
      storage.ts        # 히스토리 JSON 로드/저장 + 이미지 PNG 파일 저장/경로
      paste.ts          # invoke 래퍼: pasteSelected(), accessibility 확인
    App.tsx             # 피커 UI + 부트스트랩(모니터 구독→히스토리, 렌더, 선택→붙여넣기)
    main.tsx
  src-tauri/
    src/lib.rs          # 플러그인 등록 + Accessory + 전역핫키(직전앱 캡처+창 show) + paste 커맨드 + accessibility 커맨드
    Cargo.toml
    capabilities/default.json
    tauri.conf.json     # popup 창 설정
```

---

### Task 1: 스캐폴딩 + 테스트 러너

**Files:** 전체 Tauri v2 React-TS 프로젝트(`/Users/sally/sally-copy-paste`로 병합), `package.json`(test 스크립트), `src/core/smoke.test.ts`

**Interfaces:** Consumes: 없음 / Produces: 동작하는 Tauri v2 프로젝트 + `npm test`(Vitest)

- [ ] **Step 1: 프로젝트 생성 (비대화식)**

`/Users/sally`에서:
```bash
cd /Users/sally
npm create tauri-app@latest scp-tmp -- --template react-ts --manager npm
# 프롬프트 남으면 identifier = com.sally.copypaste
rsync -a --exclude .git scp-tmp/ sally-copy-paste/
rm -rf scp-tmp
cd sally-copy-paste && npm install
```
`docs/`와 `.git`은 보존(rsync `--exclude .git`).

- [ ] **Step 2: vitest 설치 + 스크립트**
```bash
npm install -D vitest
```
`package.json` scripts에 추가:
```json
"test": "vitest run",
"test:watch": "vitest"
```
`vite.config.ts`의 import를 `from "vitest/config"`로 바꾸고 `test: { include: ["src/**/*.test.ts"] }` 추가.

- [ ] **Step 3: 스모크 테스트** — `src/core/smoke.test.ts`
```ts
import { describe, it, expect } from 'vitest'
describe('smoke', () => {
  it('테스트 러너 동작', () => { expect(1 + 1).toBe(2) })
})
```

- [ ] **Step 4: 검증**
Run: `npm test` → Expected: 1 passed. `cargo check --manifest-path src-tauri/Cargo.toml`(첫 빌드 수 분) 성공.

- [ ] **Step 5: 커밋**
```bash
git add -A && git commit -m "chore: Tauri v2 React-TS 스캐폴딩 + vitest"
```

---

### Task 2: Core 타입 + 히스토리 로직 (TDD)

**Files:** Create `src/core/types.ts`, `src/core/history.ts`, Test `src/core/history.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `type ClipType = 'text' | 'image'`; `interface ClipItem { id: string; type: ClipType; dedupKey: string; text?: string; imagePath?: string; preview: string; createdAt: number }`
  - `history.ts`: `addClip(list: ClipItem[], item: ClipItem, max?: number): ClipItem[]`, `filterClips(list: ClipItem[], query: string): ClipItem[]`, `MAX_ITEMS = 200`

- [ ] **Step 1: 타입** — `src/core/types.ts`
```ts
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
```

- [ ] **Step 2: 실패 테스트** — `src/core/history.test.ts`
```ts
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
```

- [ ] **Step 3: 테스트 실패 확인** — Run: `npm test -- history` → FAIL("addClip is not a function")

- [ ] **Step 4: 구현** — `src/core/history.ts`
```ts
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
```

- [ ] **Step 5: 통과 확인** — Run: `npm test -- history` → PASS

- [ ] **Step 6: 커밋**
```bash
git add src/core/types.ts src/core/history.ts src/core/history.test.ts
git commit -m "feat: 클립 히스토리 타입 및 add/dedup/cap·filter 로직"
```

---

### Task 3: 플러그인 설치 + Rust 등록 + Accessory + capabilities

**Files:** Modify `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`

**Interfaces:** Produces: clipboard·global-shortcut·fs 플러그인 등록, Accessory 정책, popup 창 설정.

- [ ] **Step 1: JS/플러그인 추가**
```bash
cd /Users/sally/sally-copy-paste
npm run tauri add global-shortcut
npm run tauri add fs
npm i tauri-plugin-clipboard-api
cargo add tauri-plugin-clipboard --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Cargo.toml 네이티브 의존성 추가**
`src-tauri/Cargo.toml` `[dependencies]`에 추가(타깃 macOS):
```toml
core-graphics = "0.24"
objc2 = "0.6"
objc2-app-kit = "0.3"
objc2-foundation = "0.3"
macos-accessibility-client = "0.0.1"
```
그리고 `tauri = { version = "2", features = ["tray-icon"] }`가 아니어도 됨 — 트레이 미사용. (기본 tauri 유지)

- [ ] **Step 3: lib.rs 플러그인 등록 + Accessory**
`src-tauri/src/lib.rs` `run()` 빌더(이미 `tauri add`가 일부 `.plugin()` 추가):
```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
(global-shortcut 핸들러·paste 커맨드는 Task 5~6에서 추가.)

- [ ] **Step 4: capabilities** — `src-tauri/capabilities/default.json` permissions:
```json
[
  "core:default",
  "global-shortcut:allow-register",
  "global-shortcut:allow-unregister",
  "global-shortcut:allow-is-registered",
  "fs:default",
  "fs:allow-app-write",
  "fs:allow-app-read",
  "clipboard:default"
]
```
설치된 `tauri-plugin-clipboard`의 `permissions/` 폴더를 열어 정확한 식별자(`clipboard:allow-start-monitor`, `clipboard:allow-read-text`, `clipboard:allow-read-image-base64`, `clipboard:allow-write-text`, `clipboard:allow-write-image-base64`, `clipboard:allow-has-text`, `clipboard:allow-has-image` 등)를 확인해 필요한 것을 추가/교정한다. (문서가 얇으므로 생성된 권한 파일이 근거.)

- [ ] **Step 5: tauri.conf.json popup 창**
`app.windows`를 단일 popup으로:
```json
"windows": [
  {
    "label": "popup",
    "width": 620,
    "height": 420,
    "center": true,
    "resizable": false,
    "decorations": false,
    "alwaysOnTop": true,
    "visible": false,
    "transparent": true,
    "skipTaskbar": true
  }
],
```
그리고 `app`에 `"macOSPrivateApi": true` 추가(투명 창).

- [ ] **Step 6: 검증** — Run: `cargo check --manifest-path src-tauri/Cargo.toml`(크레이트 다운로드로 수 분) 성공. `npx tsc --noEmit` 클린.

- [ ] **Step 7: 커밋**
```bash
git add -A
git commit -m "feat: clipboard/global-shortcut/fs 플러그인 + Accessory + popup 창 설정"
```

---

### Task 4: 클립보드 래퍼 (TS)

**Files:** Create `src/app/clipboard.ts`

**Interfaces:**
- Consumes: `tauri-plugin-clipboard-api`
- Produces:
  - `startClipboardMonitor(): Promise<() => void>` — 모니터 시작, 정지 함수 반환
  - `onText(cb: (text: string) => void): Promise<() => void>`
  - `onImage(cb: (base64png: string) => void): Promise<() => void>`
  - `writeClipboardText(text: string): Promise<void>`
  - `writeClipboardImage(base64png: string): Promise<void>`

- [ ] **Step 1: 작성** — `src/app/clipboard.ts`
```ts
import {
  startListening,
  onTextUpdate,
  onImageUpdate,
  writeText,
  writeImageBase64,
} from 'tauri-plugin-clipboard-api'

export async function startClipboardMonitor(): Promise<() => void> {
  return startListening()
}

export function onText(cb: (text: string) => void): Promise<() => void> {
  return onTextUpdate(cb)
}

export function onImage(cb: (base64png: string) => void): Promise<() => void> {
  return onImageUpdate(cb)
}

export function writeClipboardText(text: string): Promise<void> {
  return writeText(text)
}

export function writeClipboardImage(base64png: string): Promise<void> {
  return writeImageBase64(base64png)
}
```
설치된 `tauri-plugin-clipboard-api`의 export 이름이 위와 다르면(버전차) 실제 export에 맞춰 교정한다(예: `startListening`이 `startMonitor`일 수 있음 — 패키지 d.ts 확인).

- [ ] **Step 2: 타입체크** — Run: `npx tsc --noEmit` → 클린

- [ ] **Step 3: 커밋**
```bash
git add src/app/clipboard.ts
git commit -m "feat: 클립보드 모니터/읽기/쓰기 래퍼"
```

---

### Task 5: 저장 래퍼 (TS)

**Files:** Create `src/app/storage.ts`

**Interfaces:**
- Consumes: `@tauri-apps/plugin-fs`, `@tauri-apps/api/core`, `ClipItem`
- Produces:
  - `loadHistory(): Promise<ClipItem[]>`
  - `saveHistory(list: ClipItem[]): Promise<void>`
  - `saveImagePng(id: string, base64png: string): Promise<string>` — 파일 저장 후 경로 반환
  - `readImageDataUrl(path: string): Promise<string>` — 썸네일 표시용 data URL

- [ ] **Step 1: 작성** — `src/app/storage.ts`
```ts
import {
  writeFile,
  readFile,
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  BaseDirectory,
} from '@tauri-apps/plugin-fs'
import type { ClipItem } from '../core/types'

const HISTORY = 'history.json'
const IMG_DIR = 'images'

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export async function loadHistory(): Promise<ClipItem[]> {
  try {
    if (!(await exists(HISTORY, { baseDir: BaseDirectory.AppData }))) return []
    const txt = await readTextFile(HISTORY, { baseDir: BaseDirectory.AppData })
    return JSON.parse(txt) as ClipItem[]
  } catch {
    return []
  }
}

export async function saveHistory(list: ClipItem[]): Promise<void> {
  await writeTextFile(HISTORY, JSON.stringify(list), { baseDir: BaseDirectory.AppData })
}

export async function saveImagePng(id: string, base64png: string): Promise<string> {
  if (!(await exists(IMG_DIR, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(IMG_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
  }
  const path = `${IMG_DIR}/${id}.png`
  await writeFile(path, b64ToBytes(base64png), { baseDir: BaseDirectory.AppData })
  return path
}

export async function readImageDataUrl(path: string): Promise<string> {
  const bytes = await readFile(path, { baseDir: BaseDirectory.AppData })
  return `data:image/png;base64,${bytesToB64(bytes)}`
}
```

- [ ] **Step 2: 타입체크** — Run: `npx tsc --noEmit` → 클린 (fs export 이름이 다르면 설치된 plugin-fs d.ts에 맞춰 교정)

- [ ] **Step 3: 커밋**
```bash
git add src/app/storage.ts
git commit -m "feat: 히스토리 JSON 저장 + 이미지 PNG 파일 저장 래퍼"
```

---

### Task 6: Rust — 전역 핫키(직전 앱 캡처 + 창 표시) + paste 커맨드 + 접근성

**Files:** Modify `src-tauri/src/lib.rs`

**Interfaces:**
- Produces (invoke 커맨드):
  - `accessibility_ok() -> bool` / `accessibility_prompt()`
  - `paste_selected()` — 직전 앱 재활성 + Cmd+V (창 hide는 JS에서 먼저 호출)
- 동작: Cmd+Shift+V → 직전 프런트 앱 캡처(state) → popup 창 show+focus.

- [ ] **Step 1: 직전 앱 캡처 + paste 커맨드 + 핫키 구현** — `src-tauri/src/lib.rs`에 추가/통합
```rust
use std::sync::Mutex;
use tauri::{Manager, Emitter};
use tauri_plugin_global_shortcut::{Builder as GsBuilder, Code, Modifiers, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};

// 직전 프런트 앱 보관
#[derive(Default)]
struct PrevApp(Mutex<Option<i32>>); // pid

#[cfg(target_os = "macos")]
fn frontmost_pid() -> Option<i32> {
    unsafe {
        let ws = NSWorkspace::sharedWorkspace();
        ws.frontmostApplication().map(|a| a.processIdentifier())
    }
}

#[cfg(target_os = "macos")]
fn activate_pid(pid: i32) {
    unsafe {
        if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
            // macOS 14+에서 activate(options:) deprecated → activate() 우선, 안 되면 옵션 버전
            app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
        }
    }
}

#[cfg(target_os = "macos")]
fn send_cmd_v() {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    if let Ok(src) = CGEventSource::new(CGEventSourceStateID::CombinedSessionState) {
        let v: core_graphics::event::CGKeyCode = 0x09;
        if let (Ok(down), Ok(up)) = (
            CGEvent::new_keyboard_event(src.clone(), v, true),
            CGEvent::new_keyboard_event(src, v, false),
        ) {
            down.set_flags(CGEventFlags::CGEventFlagCommand);
            up.set_flags(CGEventFlags::CGEventFlagCommand);
            down.post(CGEventTapLocation::HID);
            up.post(CGEventTapLocation::HID);
        }
    }
}

#[tauri::command]
fn accessibility_ok() -> bool {
    #[cfg(target_os = "macos")]
    { macos_accessibility_client::accessibility::application_is_trusted() }
    #[cfg(not(target_os = "macos"))]
    { true }
}

#[tauri::command]
fn accessibility_prompt() {
    #[cfg(target_os = "macos")]
    { macos_accessibility_client::accessibility::application_is_trusted_with_prompt(); }
}

#[tauri::command]
fn paste_selected(state: tauri::State<PrevApp>) {
    #[cfg(target_os = "macos")]
    {
        let pid = *state.0.lock().unwrap();
        if let Some(pid) = pid {
            activate_pid(pid);
        }
        std::thread::sleep(std::time::Duration::from_millis(70));
        send_cmd_v();
    }
}
```
빌더에 핫키 + 커맨드 + state 등록:
```rust
let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyV);
tauri::Builder::default()
    .manage(PrevApp::default())
    .plugin(tauri_plugin_clipboard::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(
        GsBuilder::new()
            .with_handler(move |app, sc, event| {
                if event.state() == ShortcutState::Pressed && sc == &shortcut {
                    #[cfg(target_os = "macos")]
                    {
                        let pid = frontmost_pid();
                        *app.state::<PrevApp>().0.lock().unwrap() = pid;
                    }
                    if let Some(w) = app.get_webview_window("popup") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.emit("popup-shown", ());
                    }
                }
            })
            .build(),
    )
    .setup(move |app| {
        #[cfg(target_os = "macos")]
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        app.global_shortcut().register(shortcut)?;
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![accessibility_ok, accessibility_prompt, paste_selected])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```
(`tauri_plugin_global_shortcut::GlobalShortcutExt`의 `global_shortcut()` 사용 위해 `use tauri_plugin_global_shortcut::GlobalShortcutExt;` 추가.)

- [ ] **Step 2: 검증** — Run: `cargo check --manifest-path src-tauri/Cargo.toml` 성공. (objc2/core-graphics API 시그니처가 버전차로 다르면 컴파일 에러 메시지에 맞춰 교정 — 특히 `activateWithOptions`/`processIdentifier`/`CGKeyCode` 경로. 해결 불가하면 BLOCKED 보고.)

- [ ] **Step 3: 커밋**
```bash
git add src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: 전역핫키(직전앱 캡처+창 표시) + 자동붙여넣기/접근성 커맨드"
```

---

### Task 7: paste 래퍼 (TS)

**Files:** Create `src/app/paste.ts`

**Interfaces:**
- Consumes: `@tauri-apps/api/core` invoke (`accessibility_ok`, `accessibility_prompt`, `paste_selected`)
- Produces: `accessibilityOk()`, `promptAccessibility()`, `pasteSelected()`

- [ ] **Step 1: 작성** — `src/app/paste.ts`
```ts
import { invoke } from '@tauri-apps/api/core'

export const accessibilityOk = () => invoke<boolean>('accessibility_ok')
export const promptAccessibility = () => invoke<void>('accessibility_prompt')
export const pasteSelected = () => invoke<void>('paste_selected')
```

- [ ] **Step 2: 타입체크** — Run: `npx tsc --noEmit` 클린

- [ ] **Step 3: 커밋**
```bash
git add src/app/paste.ts
git commit -m "feat: 붙여넣기/접근성 invoke 래퍼"
```

---

### Task 8: 피커 UI + 부트스트랩 통합

**Files:** Modify `src/App.tsx`, `src/App.css`(신규 스타일)

**Interfaces:** Consumes: `addClip`/`filterClips`(core), `clipboard.ts`, `storage.ts`, `paste.ts`, `@tauri-apps/api/window`

- [ ] **Step 1: App.tsx 작성** (핵심 로직 + UI)
```tsx
import { useEffect, useState, useRef, useCallback } from 'react'
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
    void (async () => {
      setItems(await loadHistory())
      if (!(await accessibilityOk())) void promptAccessibility()
      await startClipboardMonitor()
      await onText((text) => {
        if (!text) return
        push({ id: newId(), type: 'text', dedupKey: text, text, preview: text.slice(0, 200), createdAt: Date.now() })
      })
      await onImage(async (b64) => {
        const id = newId()
        try {
          const path = await saveImagePng(id, b64)
          push({ id, type: 'image', dedupKey: `img:${b64.length}:${b64.slice(0, 32)}`, imagePath: path, preview: '[이미지]', createdAt: Date.now() })
        } catch {
          /* 저장 실패 무시 */
        }
      })
    })()
  }, [push])

  const win = getCurrentWindow()

  // 창 표시될 때 검색 초기화 + 선택 0
  useEffect(() => {
    const un = win.listen('popup-shown', () => { setQuery(''); setSel(0) })
    return () => { void un.then((f) => f()) }
  }, [win])

  // blur/Esc 시 숨김
  useEffect(() => {
    const unFocus = win.onFocusChanged(({ payload: focused }) => { if (!focused) void win.hide() })
    const onKey = (e: KeyboardEvent) => {
      const shown = filterClips(itemsRef.current, query)
      if (e.key === 'Escape') void win.hide()
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, shown.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
      else if (e.key === 'Enter') { e.preventDefault(); void choose(shown[sel]) }
    }
    window.addEventListener('keydown', onKey)
    return () => { void unFocus.then((f) => f()); window.removeEventListener('keydown', onKey) }
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
      await writeClipboardImage(url.split(',')[1])
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
```

- [ ] **Step 2: App.css** — 최소 스타일(피커: 반투명 카드, 검색 인풋, 선택 행 강조, 썸네일). 예:
```css
:root { font-family: -apple-system, 'Apple SD Gothic Neo', sans-serif; }
html, body, #root { height: 100%; margin: 0; }
.picker { height: 100%; display: flex; flex-direction: column; background: rgba(30,30,32,0.96); color: #f2f2f2; border-radius: 12px; overflow: hidden; }
.search { border: none; outline: none; padding: 12px 14px; font-size: 15px; background: transparent; color: inherit; border-bottom: 1px solid rgba(255,255,255,0.1); }
.list { flex: 1; overflow-y: auto; list-style: none; margin: 0; padding: 6px; }
.row { padding: 8px 10px; border-radius: 8px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row.is-sel { background: #3b6ea5; }
.thumb { max-height: 48px; border-radius: 4px; display: block; }
.empty { padding: 20px; text-align: center; color: #999; }
```

- [ ] **Step 3: main.tsx 확인** — `App`을 `./App`에서 import(스캐폴드 기본). StrictMode 유지 가능.

- [ ] **Step 4: 타입체크 + 테스트** — Run: `npx tsc --noEmit && npm test` → 타입 클린, core 테스트 PASS.

- [ ] **Step 5: 빌드 확인 (수동 GUI)** — Run: `npm run tauri dev` (GUI). 수동:
  1. 앱 실행(Dock 아이콘 없음). 접근성 권한 프롬프트 → 시스템 설정에서 허용.
  2. 아무 데서나 텍스트 복사 → 기록에 쌓임. 이미지 복사 → 썸네일.
  3. Cmd+Shift+V → 피커 등장. 검색/↑↓/Enter.
  4. 항목 선택 → 피커 사라지고 직전 앱에 자동 붙여넣기.
  5. Esc/바깥 클릭 → 피커 숨김.

- [ ] **Step 6: 커밋**
```bash
git add src/App.tsx src/App.css
git commit -m "feat: 피커 UI + 클립보드 모니터/저장/자동붙여넣기 통합"
```

---

### Task 9: 마무리 — README + 빌드

**Files:** Create `README.md`

- [ ] **Step 1: README** — 실행/빌드/접근성 권한/핫키 안내
```markdown
# sally-copy-paste

macOS 클립보드 매니저 — 복사 기록(텍스트·이미지)을 Cmd+Shift+V로 띄워 골라 붙여넣기.

## 개발 실행
\`\`\`bash
npm install
npm run tauri dev
\`\`\`

## 빌드
\`\`\`bash
npm run tauri build
\`\`\`

## 권한
자동 붙여넣기는 **시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용(Accessibility)**에서 앱을 허용해야 동작합니다. 미허용 시 클립보드 복사까지만 됩니다.

## 사용
- 어디서든 복사하면 자동 기록(최근 200개, 디스크 저장)
- **Cmd+Shift+V**로 기록 팝업 → 검색/↑↓/Enter로 선택 → 직전 앱에 자동 붙여넣기
- Esc 또는 바깥 클릭으로 닫기
```

- [ ] **Step 2: 프로덕션 빌드 (수동)** — Run: `npm run tauri build` → `.app`/`.dmg` 생성. (서명 미설정 시 비서명 빌드 — 개인 사용 OK)

- [ ] **Step 3: 커밋**
```bash
git add README.md
git commit -m "docs: README (실행/빌드/권한/사용)"
```

---

## Self-Review

**Spec coverage:**
- 전역 핫키 팝업 → Task 6(Rust 핫키), Task 8(UI) ✓
- 자동 붙여넣기(접근성) → Task 6(paste 커맨드/접근성), Task 7(래퍼), Task 8(choose→pasteSelected) ✓
- 텍스트·이미지 → Task 4(read/write), Task 5(이미지 PNG 저장), Task 8(썸네일/쓰기) ✓
- 디스크 영구 저장 + 200 상한 + 중복제거 → Task 2(addClip), Task 5(saveHistory) ✓
- 클립보드 모니터 → Task 4(startClipboardMonitor/onText/onImage), Task 8(구독→push) ✓
- Accessory(Dock 없음)·popup 창 → Task 3 ✓

**Placeholder scan:** 모든 코드 단계에 실제 코드. TBD 없음. (플러그인 export/objc2 시그니처 버전차는 "설치본/컴파일 에러에 맞춰 교정" 지시로 명시 — 추정 금지.)

**Type consistency:** `ClipItem`(id/type/dedupKey/text?/imagePath?/preview/createdAt), `addClip(list,item,max)`, `filterClips(list,query)`, clipboard 래퍼 시그니처, `pasteSelected()`가 Task 2/4/5/7/8에서 일관.

**알려진 위험(구현 중 검증):**
- CrossCopy 플러그인 권한 식별자/JS export 이름 → 설치된 `permissions/`·`.d.ts`로 확정.
- macOS 14+ `activateWithOptions` deprecated → 동작 이상 시 non-activating panel 방식 검토.
- objc2/core-graphics 버전별 API 시그니처 → cargo 컴파일 에러 기준 교정.
- 투명 창은 `macOSPrivateApi: true` 필요.
