#!/usr/bin/env bash
# 릴리스 자동화: 버전 올리기 → 커밋/push → 유니버설 빌드 → 태그 → GitHub Release
# 사용:
#   bash scripts/release.sh <x.y.z> ["변경 내용 한 줄"]
#   npm run release -- <x.y.z> ["변경 내용 한 줄"]
set -euo pipefail

VERSION="${1:-}"
NOTE="${2:-}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "사용법: bash scripts/release.sh <x.y.z> [\"변경 내용\"]" >&2
  exit 1
fi

# 저장소 루트로 이동
cd "$(dirname "$0")/.."
# cargo PATH 확보(있으면)
# shellcheck disable=SC1091
source "$HOME/.cargo/env" 2>/dev/null || true

TAG="v$VERSION"

# 안전장치: 커밋 안 된 변경/중복 태그 확인
if [[ -n "$(git status --porcelain)" ]]; then
  echo "작업트리에 커밋되지 않은 변경이 있습니다. 먼저 정리한 뒤 다시 실행하세요." >&2
  git status --short >&2
  exit 1
fi
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "태그 $TAG 가 이미 존재합니다." >&2
  exit 1
fi

echo "▶ 버전 $VERSION 으로 변경"
node -e '
const fs = require("fs");
const v = process.argv[1];
for (const f of ["package.json", "src-tauri/tauri.conf.json"]) {
  let t = fs.readFileSync(f, "utf8");
  t = t.replace(/("version":\s*")[0-9]+\.[0-9]+\.[0-9]+(")/, `$1${v}$2`);
  fs.writeFileSync(f, t);
}
' "$VERSION"

git add package.json src-tauri/tauri.conf.json
git commit -q -m "chore: 버전 $VERSION"
git push origin HEAD

echo "▶ 유니버설 빌드 중… (몇 분 소요)"
npm run tauri build -- --target universal-apple-darwin

DMG="src-tauri/target/universal-apple-darwin/release/bundle/dmg/sally-copy-paste_${VERSION}_universal.dmg"
if [[ ! -f "$DMG" ]]; then
  echo "dmg 를 찾지 못했습니다: $DMG" >&2
  exit 1
fi

echo "▶ 태그 + Release 게시"
git tag "$TAG"
git push origin "$TAG"

NOTES_FILE="$(mktemp)"
cat > "$NOTES_FILE" <<EOF
## 변경 사항
${NOTE:-- (변경 내용)}

## 설치
1. 아래 \`sally-copy-paste_${VERSION}_universal.dmg\` 다운로드 → 앱을 응용 프로그램으로 드래그
2. 첫 실행: **앱 우클릭 → 열기**(서명 안 된 앱이라 더블클릭은 막힘). 안 되면 터미널:
   \`xattr -dr com.apple.quarantine /Applications/sally-copy-paste.app\`
3. 시스템 설정 → 개인정보 보호 및 보안 → **손쉬운 사용**에서 켜기

## 사용
- 복사(Cmd+C)/Finder 파일 복사 → 자동 기록
- \`Cmd+Shift+V\` 또는 메뉴바 아이콘 클릭 → 팝업 (상단 바를 끌어 이동)
- ↑/↓ + Enter(또는 클릭)로 선택해 붙여넣기 · 하단 패널에서 전체 내용 확인 · 타이핑으로 검색 · Delete로 삭제 · Esc로 닫기
- 종료: 메뉴바 아이콘 우클릭 → 종료
EOF

gh release create "$TAG" "$DMG" --title "sally-copy-paste $TAG" --notes-file "$NOTES_FILE"
echo "✅ 완료: $(gh release view "$TAG" --json url --jq .url)"
echo "   공유 링크: https://github.com/sally-cdri/sally-copy-paste/releases/latest"
