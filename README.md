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

## 3. 백업 · 복원

모든 데이터는 기기 안(IndexedDB)에만 있습니다. 첫 실행 때 `navigator.storage.persist()`로 영구 저장도 요청합니다.

- **백업:** 메뉴 → 백업 · 복원 → **백업 파일 내보내기**
  - 아이폰에서는 공유 시트가 뜹니다 → "파일에 저장"
  - 프로젝트, LED, 설정이 전부 담긴 JSON 파일입니다. 내보낸 PNG 이미지는 빠집니다 (언제든 다시 렌더할 수 있음).
- **복원:** 같은 화면 → **백업 파일 가져오기**
  - 기존 데이터에 합칩니다. id가 같은 항목은 백업 내용으로 덮어씁니다.
  - 예전 버전 백업도 `schemaVersion`을 보고 자동으로 변환합니다.
- 기기를 바꾸거나 앱을 지우기 전에는 꼭 백업하세요. iOS는 오래 쓰지 않은 웹앱 데이터를 지울 수 있습니다.

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
