# sally-copy-paste (클립보드 매니저) — 설계 문서

- 작성일: 2026-06-17
- 상태: 승인됨 (MVP 설계)

## 목표

복사한 항목(텍스트·이미지)을 자동으로 기록해 두고, 전역 핫키로 띄운 목록에서
골라 **원래 작업하던 앱에 바로 붙여넣는** macOS 데스크톱 앱.

## 기술 스택

- **Tauri v2** (Rust + React + TypeScript + Vite), Vitest. 직전 프로젝트와 동일 패턴.

## 핵심 동작 (확정)

- 전역 핫키(기본 **Cmd+Shift+V**)로 피커 팝업을 띄운다.
- 항목을 고르면 **자동 붙여넣기**: 이전 앱으로 포커스를 복귀시키고 Cmd+V를 입력한다 (macOS 접근성 권한 필요).
- 기록은 **디스크에 영구 저장**(재시작 후에도 유지). 최근 200개만 유지.
- **텍스트·이미지 모두** 지원.

## 아키텍처

```
[Rust (네이티브)]
 - 클립보드 모니터: NSPasteboard changeCount 폴링(~0.7s) → 변하면 텍스트/이미지 읽어 프론트로 이벤트 emit
 - 전역 핫키 등록(Cmd+Shift+V) → 피커 창 show + 직전 프런트 앱 기억
 - paste 커맨드: 직전 앱으로 포커스 복귀 + Cmd+V 키 입력(접근성)
[Core (TS, 단위 테스트 대상)]
 - 히스토리 로직: add / 중복제거(동일 내용은 맨 위로) / 상한 200 / 타입(text|image)
[UI (React/TS)]
 - 피커: 검색 필터 + 목록(텍스트 스니펫·이미지 썸네일) + 키보드 탐색(↑↓/Enter/Esc)
[저장]
 - 텍스트·메타: 로컬 store(JSON)
 - 이미지: appdata/images/<id>.png 파일 (메타에 경로 참조)
```

### 단위 경계
- `core/history.ts`: 순수 히스토리 로직(목록 + add/dedup/cap). 플랫폼 독립 → 단위 테스트.
- `core/types.ts`: `ClipItem`(id, type, text?, imagePath?, preview, createdAt) 등 타입.
- `app/clipboard.ts`: Tauri 클립보드 읽기/쓰기 + 모니터 이벤트 구독 래퍼.
- `app/paste.ts`: 붙여넣기(포커스 복귀 + Cmd+V) invoke 래퍼.
- `app/storage.ts`: 히스토리/이미지 저장·로드 래퍼.
- `src-tauri/src/lib.rs`: changeCount 폴링 모니터, 전역 핫키, paste 커맨드, 창 show/hide.

## 데이터 흐름

1. 사용자가 어디서든 복사 → changeCount 변경 → Rust 모니터가 읽어 `clip-added` 이벤트(텍스트 또는 이미지 바이트) emit.
2. 프론트가 이벤트 수신 → 이미지면 파일로 저장 → `ClipItem` 생성 → 히스토리에 add(중복제거·상한) → 저장.
3. 사용자가 Cmd+Shift+V → 피커 창 표시(직전 앱 기억). 검색/키보드로 항목 선택.
4. 선택 → 항목을 클립보드에 write → 피커 숨김 → 직전 앱 포커스 복귀 → Cmd+V 입력 → 붙여넣기 완료.

## 권한 (macOS)

- **접근성(Accessibility)**: 자동 붙여넣기(키 입력 시뮬레이션 + 앱 활성화)에 필요. 첫 사용 시 안내, 미허용 시 "클립보드에 복사만" 폴백.
- 전역 핫키 등록은 별도 권한 불필요.

## 에러 처리

- 접근성 미허용 → 자동 붙여넣기 대신 클립보드 복사만 하고 안내 메시지.
- 이미지 저장 실패 → 해당 항목 건너뛰고 다음 진행.
- 클립보드 읽기 실패(빈/비지원 형식) → 무시.
- 동일 내용 재복사 → 새 항목 추가 대신 기존 항목을 맨 위로.

## 테스트

- Core(히스토리 add/dedup/cap, 타입) → Vitest 단위 테스트.
- 네이티브(모니터/핫키/paste)는 빌드 확인 + 수동 검증(키 입력·포커스 복귀는 GUI 수동).

## MVP에서 의도적으로 제외 (이후)

- 핫키 커스터마이즈 UI (MVP는 고정 Cmd+Shift+V)
- 즐겨찾기/핀 고정, 태그, 동기화
- 이미지 외 리치 포맷(RTF/파일 등) — MVP는 plain text + image(PNG)
- 항목 수동 삭제/정리 UI는 최소(전체 지우기 정도)

## 알려진 기술 확인 필요 (구현 계획에서 검증)

- Tauri v2 클립보드 모니터링: 공식 `clipboard-manager`는 읽기/쓰기만(이벤트 없음) →
  changeCount 폴링을 Rust에서 직접 구현하거나 커뮤니티 `tauri-plugin-clipboard`(모니터 지원) 사용.
- 자동 붙여넣기: 직전 앱 활성화 + Cmd+V 입력 방법(CGEvent 또는 osascript `keystroke`) — 접근성 전제.
- 전역 핫키: `tauri-plugin-global-shortcut`.
