#!/bin/sh
# 앱 비밀번호를 입력받아 SHA-256 해시만 GitHub Secret(VITE_PASS_HASH)에 저장합니다.
# 비밀번호 자체는 화면·파일·기록 어디에도 남지 않습니다.
# 사용법: sh scripts/set-password.sh [owner/repo]   (GitHub CLI 로그인 필요)
GH="${GH:-gh}"
REPO="${1:-VJzuno/led-guide}"

printf '앱 비밀번호 입력 (화면에 안 보임): '
stty -echo; read -r P1; stty echo; echo
printf '한 번 더 입력: '
stty -echo; read -r P2; stty echo; echo

if [ -z "$P1" ]; then echo '비어 있습니다. 다시 실행하세요.'; exit 1; fi
if [ "$P1" != "$P2" ]; then echo '두 비밀번호가 다릅니다. 다시 실행하세요.'; exit 1; fi

H=$(printf '%s' "$P1" | shasum -a 256 | cut -d' ' -f1)
unset P1 P2
printf '%s' "$H" | "$GH" secret set VITE_PASS_HASH -R "$REPO" && echo '✓ 비밀번호 해시를 GitHub에 저장했습니다. 이 창은 닫아도 됩니다.'
