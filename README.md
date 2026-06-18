# sally-copy-paste

macOS 클립보드 매니저 — 복사 기록(텍스트·이미지)을 Cmd+Shift+V로 띄워 골라 붙여넣기.

## 개발 실행
```bash
npm install
npm run tauri dev
```

## 빌드
```bash
npm run tauri build
```

## 권한
자동 붙여넣기는 **시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용(Accessibility)**에서 앱을 허용해야 동작합니다. 미허용 시 클립보드 복사까지만 됩니다.

## 사용
- 어디서든 복사하면 자동 기록(최근 200개, 디스크 저장)
- **Cmd+Shift+V**로 기록 팝업 → 검색/↑↓/Enter로 선택 → 직전 앱에 자동 붙여넣기
- Esc 또는 바깥 클릭으로 닫기
