# ZUNO'S LED GUIDE MAKER

VJ용 LED 인풋 / 아웃풋 가이드 제작 PWA. 아이폰(Safari, 홈 화면에 추가)과 데스크톱에서 쓰고, **오프라인에서도** 입력·수정·PNG 추출이 모두 됩니다.

흐름: 프로젝트 → LED → ① 인풋 가이드 → ② 아웃풋 가이드

---

## 1. 아이폰 홈 화면에 추가

1. Safari로 배포 주소(`https://<계정>.github.io/<저장소>/`)를 엽니다.
2. 비밀번호를 한 번 입력합니다.
3. 공유 버튼 → **홈 화면에 추가**를 누릅니다.
4. 홈 화면 아이콘으로 실행하면 전체화면 앱으로 열립니다.
5. **온라인 상태에서 한 번 실행해 두면** 앱 전체가 기기에 저장됩니다. 그 뒤로는 비행기 모드에서도 됩니다.

> Safari 탭과 홈 화면 앱은 저장 공간이 따로입니다. 실제 작업은 홈 화면 앱에서 하세요.

## 2. 비밀번호 설정 (SHA-256 해시)

평문 비밀번호는 코드와 저장소 어디에도 들어가지 않습니다. 해시만 빌드할 때 주입됩니다.

**가장 쉬운 방법 (GitHub CLI 로그인 상태):**

```bash
sh scripts/set-password.sh VJzuno/led-guide
```

비밀번호를 두 번 입력하면 해시만 GitHub Secret `VITE_PASS_HASH` 에 저장됩니다. 그다음 Actions 에서 배포를 다시 돌리면 적용됩니다.

**직접 하는 방법:**

```bash
npm run hash -- "원하는비밀번호"
# → 64자리 hex 출력
```

- **배포:** GitHub 저장소 → Settings → Secrets and variables → Actions → **New repository secret**
  - Name: `VITE_PASS_HASH`
  - Value: 위에서 나온 64자리 hex
- **로컬:** `.env.local` 파일에 `VITE_PASS_HASH=...`를 적습니다. 이 파일은 git에서 제외됩니다.
- 해시를 비워두면 잠금 화면 없이 바로 열립니다.

동작 방식:

- 기기에서 처음 열 때만 묻습니다. 통과하면 해제 상태를 localStorage와 IndexedDB 두 곳에 저장하므로, 앱을 업데이트해도 다시 묻지 않습니다.
- 5회 연속 틀리면 30초 동안 기다려야 합니다.
- 해시를 바꿔도 이미 해제된 기기는 다시 잠기지 않습니다.

> ⚠️ **이 잠금은 가벼운 접근 차단용입니다.** 정적 사이트라서 해시와 앱 코드는 누구나 내려받을 수 있습니다. 민감한 정보를 보호하는 보안 장치가 아닙니다.

## 3. iCloud 백업 (아이폰 ↔ Mac)

데이터는 각 기기 안(IndexedDB)에만 있습니다. 웹앱은 iCloud에 직접 붙을 수 없어서, **메뉴 → iCloud 백업** 화면으로 iCloud Drive를 거쳐 옮깁니다.

1. 작업한 기기에서 **iCloud에 저장**
   - 아이폰: 공유 창에서 "파일에 저장" → iCloud Drive (처음 한 번 `LED Guide` 폴더를 만들어 두면 다음부터 기본으로 열림)
   - Mac: 다운로드 폴더에 저장됨. Safari 설정 → 일반 → 파일 다운로드 위치를 iCloud Drive 폴더로 두면 편함
2. 다른 기기에서 **iCloud에서 불러오기** → 가장 최근 `LGM-backup_날짜_기기.json` 선택
3. 항목(프로젝트·LED)마다 **더 최근에 고친 쪽이 남습니다.** 이 기기에서 더 나중에 고친 건 덮어쓰지 않음

- 홈 화면과 메뉴 탭에 마지막 저장 시각, 그 뒤로 바뀐 항목 수가 표시되고, 6시간 넘게 저장 안 한 변경이 있으면 보라 점이 뜹니다.
- 내보낸 PNG·영상은 백업에 들어가지 않습니다. 저장할 때 "이미지/비디오 저장"으로 사진 앱에 넣으면 iCloud 사진으로 Mac에 자동 동기화됩니다.
- 예전 버전 백업도 `schemaVersion`을 보고 자동 변환됩니다.

## 3-1. VJ 도구 (홈 화면 "VJ 도구")

큐시트 메이커 · Border Maker · 3D 로고 루프 · VJ 근무일지가 이 앱 안에 함께 들어 있습니다 (`public/tools/*.html`). 오프라인에서도 열리고, 오른쪽 아래 **← 홈**으로 돌아옵니다. 각 도구 데이터도 아래 백업·동기화에 포함됩니다.

## 3-2. 구글 드라이브 동기화 (폰 ↔ PC)

메뉴 → **백업 · 동기화** → 구글 드라이브. 같은 구글 계정이면 폰·PC 어디서 고쳐도 **지금 동기화**로 맞춰집니다 (항목마다 더 최근에 고친 쪽이 남음). 로그인이 살아 있으면 앱을 열 때 자동으로 맞춥니다.

처음 한 번 구글 OAuth **클라이언트 ID**가 필요합니다 (무료, 약 5분):

1. [Google Cloud Console](https://console.cloud.google.com) → 새 프로젝트
2. API 및 서비스 → 라이브러리 → **Google Drive API** 사용 설정
3. OAuth 동의 화면 → 외부 → 앱 이름·이메일 → 범위에 `.../auth/drive.appdata` → 테스트 사용자에 본인 계정 추가
4. 사용자 인증 정보 → OAuth 클라이언트 ID → **웹 애플리케이션** → 승인된 JavaScript 원본에 `https://vjzuno.github.io` 추가
5. 나온 ID(`…apps.googleusercontent.com`)를 앱의 백업 · 동기화 화면에 붙여넣기 (폰·PC 각각 한 번)
   - 또는 GitHub 저장소 Settings → Secrets and variables → Actions → **Variables** 에 `VITE_GOOGLE_CLIENT_ID` 로 넣으면 다음 배포부터 모든 기기에 자동 적용

앱은 드라이브의 **앱 전용 숨김 폴더**(appDataFolder)만 읽고 씁니다. 다른 드라이브 파일은 볼 수 없습니다.

## 사용 팁

- **인풋맵 불러오기:** ① 인풋 가이드 맨 위 버튼. 인풋맵 이미지(PNG·JPG)나 Resolume Advanced Output 프리셋(`Documents/Resolume Arena/Presets/Advanced Output/*.xml`)을 고르면 면 이름·크기·위치·캔버스를 한 번에 채웁니다.
  - 이미지: 면 경계를 자동 감지하고 체커 간격으로 캐비닛 px를 추정합니다. 면 이름은 직접 입력 (감지 개수가 지금 면 개수와 같으면 기존 이름 유지). 원본 맵을 저장해 두면 프리뷰의 **인풋맵 겹쳐보기**로 반투명하게 겹쳐 검수할 수 있습니다 (출력엔 안 들어감).
  - XML: 프리셋 안의 Screen(실제 출력 / MAP / VCR …)을 고르면 슬라이스 이름·좌표가 그대로 들어옵니다. 꺼진 슬라이스와 서로 겹치는 슬라이스는 기본으로 빠집니다. 캐비닛 px는 XML에 없으니 직접 확인하세요.
  - 가로 한 줄 + 일정한 간격이면 자동 배치(앞 갭)로, 아니면 위치 고정(수동 배치)으로 들어갑니다.
- **수식 입력:** 숫자 칸에 `230/2`, `128*8+100`, `(1920-100)/2` 처럼 넣으면 계산된 값이 들어갑니다. 아이폰에서는 키보드 위에 `÷ × − + ( )` 버튼 줄이 뜹니다.
- **여러 개 선택:** 프로젝트·최근 화면의 **선택** 버튼 (PC는 Shift+클릭 범위, ⌘/Ctrl+클릭 하나씩). 프로젝트에서는 IN·OUT PNG 한꺼번에 내보내기 / 복제 / 휴지통, 최근에서는 묶어서 저장 / 삭제. 아이폰은 공유 창에 한꺼번에, PC는 ZIP 하나로 저장됩니다.
- **큰 LED 영상:** 기기 인코더 한도(보통 가로 4096)를 넘으면 비율을 유지한 채 가능한 최대 크기로 줄여서 저장합니다. PNG 는 원본 크기 그대로.

## 4. 업데이트 흐름

1. `main` 브랜치에 push하면 GitHub Actions가 빌드해서 Pages에 배포합니다.
2. 앱을 열면(온라인일 때) 새 버전을 백그라운드로 받습니다.
3. 화면 위에 **"업데이트 있음 → 새로고침"** 배너가 뜹니다. 누르면 새 버전이 적용됩니다.
4. 데이터(IndexedDB)와 잠금 해제 상태는 그대로 유지됩니다.

데이터 구조를 바꿀 때는 `src/types.ts`의 `SCHEMA_VERSION`을 올리고, `src/db.ts`의 `migrations`에 변환 함수를 추가합니다.

## 5. 처음 배포하기

```bash
git init && git add . && git commit -m "init"
git branch -M main
git remote add origin https://github.com/<계정>/<저장소>.git
git push -u origin main
```

그다음 GitHub 저장소에서:

1. Settings → Pages → Source를 **GitHub Actions**로 바꿉니다.
2. Secret `VITE_PASS_HASH`를 추가합니다 (2번 참고).
3. Actions 탭에서 배포가 끝나면 `https://<계정>.github.io/<저장소>/`로 접속합니다.

`BASE_PATH`는 워크플로가 저장소 이름으로 자동 설정합니다.

## 6. 개발

```bash
npm install
npm run dev       # 개발 서버 (서비스 워커 꺼짐)
npm run build     # 타입 체크 + 프로덕션 빌드 (dist/)
npm run preview   # 빌드 결과 확인 (서비스 워커 켜짐 → 오프라인 테스트)
```

### 색 바꾸기

- **앱 UI 색:** `src/theme.css` 맨 위 `:root` 변수
- **가이드 PNG 색:** `src/render.ts` 맨 위 `GUIDE_COLORS`
- **포인트 컬러:** 앱 안 메뉴 → 설정에서 바꿀 수 있습니다. UI와 PNG에 함께 적용됩니다.

### 구조

```
src/
  types.ts      데이터 스키마 (SCHEMA_VERSION)
  db.ts         IndexedDB + 마이그레이션 + 백업 가져오기
  store.ts      메모리 상태 + 자동 저장(디바운스)
  lock.ts       첫 실행 잠금
  layout.ts     인풋/아웃풋 좌표 계산, 파일명, 좌표 텍스트
  render.ts     Canvas 가이드 렌더러 (원본 해상도)
  export.ts     PNG 추출 / 공유 시트 / iOS 길게 눌러 저장 폴백
  ui/           화면 컴포넌트
```

폰트(Anton, IBM Plex Sans KR, JetBrains Mono)와 모든 라이브러리는 로컬에 번들되고, 서비스 워커가 프리캐시합니다. 외부 CDN은 쓰지 않습니다.
