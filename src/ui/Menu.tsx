import { useState } from 'preact/hooks';
import { ask, notice, useStore, state, getProject, restoreProject, purgeProject, restoreLed, purgeLed, restoreBorder, purgeBorder, saveSettings, toast } from '../store';
import { SCHEMA_VERSION, PRESETS, type OutputPreset } from '../types';
import { saveToICloud, loadFromFile, lastBackupAt, lastLoadAt, changedSinceBackup, needsBackup, ago } from '../sync';
import { isIOS } from '../export';
import { createSample } from '../sample';
import { clickOn, setClickOn, tick } from '../click';
import { useEffect } from 'preact/hooks';
import { onFirebaseHost, cloudUser, cloudStatus, cloudError, cloudLastSync, cloudSignIn, cloudSignOut, cloudChecking, NEW_URL } from '../cloud';
import { clientId, clientFromBuild, setClientId, validClientId, isLinked, lastDriveSync, syncDrive, unlinkDrive, prepareDrive, useRedirect, redirectUri, resumeAfterRedirect, clearResume, takeDriveError } from '../gdrive';
import { TopBar, AppHeader, Seg, go, timeAgo } from './common';

declare const __APP_VERSION__: string;
export const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

export function Menu({ sub }: { sub?: string }) {
  if (sub === 'about') return <About />;
  if (sub === 'trash') return <Trash />;
  if (sub === 'backup') return <Backup />;
  if (sub === 'settings') return <Settings />;
  const items: [string, string, string][] = [
    ['/tool/cuesheet', '큐시트 메이커', '곡 번호·제목 썸네일 PNG'],
    ['/tool/framedelay', '프레임 딜레이 테스트', '소스 ↔ LED 지연 · AV 싱크 · 끊김 확인'],
    ['/recent', '최근 내보낸 파일', `${state.exportsMeta.length}개`],
    ['trash', '휴지통', '삭제한 프로젝트 / LED / 보더 복구'],
    ['backup', '동기화', onFirebaseHost() ? (cloudUser() ? `클라우드 동기화 · ${cloudUser()!.email}` : 'Google 로그인하면 폰·PC 실시간 동기화') : needsBackup() ? `바뀐 항목 ${changedSinceBackup()}개 · 동기화 필요` : isLinked() ? `구글 드라이브 ${ago(lastDriveSync())}` : `마지막 저장 ${ago(lastBackupAt())}`],
    ['settings', '설정', '포인트 컬러, 기본 프리셋'],
    ['about', 'About', '앱 소개'],
  ];
  return (
    <div class="screen has-header">
      <AppHeader title="더보기" />
      <div class="card">
        {items.map(([k, t, d]) => (
          <a key={k} class="list-item" href={k.startsWith('/') ? `#${k}` : `#/menu/${k}`}>
            <div class="grow"><div style="font-weight:600">{t}</div><div class="small muted">{d}</div></div>
            <span class="muted">›</span>
          </a>
        ))}
      </div>
      <div class="card" style="text-align:center">
        <div class="small muted">WHO'S MADE</div>
        <div style="font-family:var(--f-title);font-size:28px;letter-spacing:.04em;margin-top:4px">ZUNO</div>
        <div class="small" style="color:var(--accent);letter-spacing:.2em">VJ · SUPERVISION</div>
      </div>
      <div class="small muted num" style="text-align:center;margin-top:16px">v{VERSION} · schema {SCHEMA_VERSION}</div>
    </div>
  );
}

function About() {
  return (
    <div class="screen">
      <TopBar title="About" back="/menu" />
      <div class="card stack">
        <h3>Zuno Workspace</h3>
        <p class="muted" style="margin:0">VJ 작업 도구 모음. 프로젝트 안에서 LED 가이드(인풋·아웃풋)와 보더를 만들고, 3D 로고 · SPVS 보고서 · 큐시트까지 한 앱에서 씁니다.</p>
        <p class="muted" style="margin:0">모든 데이터는 이 기기 안(IndexedDB)에만 저장되며, 오프라인에서도 입력·수정·PNG 추출이 모두 됩니다. 기기를 바꾸거나 앱을 지우기 전에는 백업 · 복원에서 JSON으로 백업하세요.</p>
      </div>
      <div class="card">
        <div class="small muted">WHO'S MADE</div>
        <div style="font-family:var(--f-title);font-size:24px">ZUNO</div>
        <div class="small" style="color:var(--accent)">VJ · SUPERVISION</div>
        <div class="small muted num" style="margin-top:8px">v{VERSION}</div>
      </div>
    </div>
  );
}

function Trash() {
  useStore();
  const projects = state.projects.filter((p) => p.deletedAt);
  const leds = state.leds.filter((l) => l.deletedAt && !getProject(l.projectId)?.deletedAt);
  const borders = state.borders.filter((b) => b.deletedAt && !getProject(b.projectId)?.deletedAt);
  const empty = projects.length + leds.length + borders.length === 0;
  const purgeAll = async () => {
    if (!(await ask('휴지통을 비울까요?\n되돌릴 수 없습니다.', '비우기'))) return;
    for (const p of projects) await purgeProject(p.id);
    for (const l of leds) await purgeLed(l.id);
    for (const b of borders) await purgeBorder(b.id);
  };
  return (
    <div class="screen">
      <TopBar title="휴지통" back="/menu" right={!empty && <button class="btn danger" onClick={purgeAll}>비우기</button>} />
      {empty && <div class="card empty">비어 있습니다</div>}
      {projects.length > 0 && <div class="section-title">프로젝트</div>}
      {projects.length > 0 && <div class="card">
        {projects.map((p) => (
          <div key={p.id} class="list-item">
            <div class="grow"><div style="font-weight:600">{p.name}</div>
              <div class="small muted">LED {state.leds.filter((l) => l.projectId === p.id).length}개 · <span class="num">{timeAgo(p.deletedAt!)}</span></div></div>
            <button class="btn" onClick={() => { restoreProject(p.id); toast('복구됨'); }}>복구</button>
            <button class="btn icon ghost" style="color:var(--danger)" aria-label="영구 삭제"
              onClick={async () => { if (await ask('영구 삭제할까요?')) purgeProject(p.id); }}>✕</button>
          </div>
        ))}
      </div>}
      {leds.length > 0 && <div class="section-title">LED</div>}
      {leds.length > 0 && <div class="card">
        {leds.map((l) => (
          <div key={l.id} class="list-item">
            <div class="grow"><div style="font-weight:600">{l.number} {l.name}</div>
              <div class="small muted">{getProject(l.projectId)?.name} · <span class="num">{timeAgo(l.deletedAt!)}</span></div></div>
            <button class="btn" onClick={() => { restoreLed(l.id); toast('복구됨'); }}>복구</button>
            <button class="btn icon ghost" style="color:var(--danger)" aria-label="영구 삭제"
              onClick={async () => { if (await ask('영구 삭제할까요?')) purgeLed(l.id); }}>✕</button>
          </div>
        ))}
      </div>}
      {borders.length > 0 && <div class="section-title">보더</div>}
      {borders.length > 0 && <div class="card">
        {borders.map((b) => (
          <div key={b.id} class="list-item">
            <div class="grow"><div style="font-weight:600">{b.name}</div>
              <div class="small muted">{getProject(b.projectId)?.name} · <span class="num">{timeAgo(b.deletedAt!)}</span></div></div>
            <button class="btn" onClick={() => { restoreBorder(b.id); toast('복구됨'); }}>복구</button>
            <button class="btn icon ghost" style="color:var(--danger)" aria-label="영구 삭제"
              onClick={async () => { if (await ask('영구 삭제할까요?')) purgeBorder(b.id); }}>✕</button>
          </div>
        ))}
      </div>}
    </div>
  );
}

function Backup() {
  useStore();
  const [busy, setBusy] = useState(false);
  const changed = changedSinceBackup();
  const ios = isIOS();

  const save = async () => {
    setBusy(true);
    try { if (await saveToICloud()) toast(ios ? 'iCloud Drive에 저장했습니다' : '백업 파일을 저장했습니다'); }
    catch (e: any) { toast('저장 실패: ' + (e?.message || e)); }
    setBusy(false);
  };
  const load = async (e: Event) => {
    const inp = e.target as HTMLInputElement;
    const f = inp.files?.[0];
    inp.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const r = await loadFromFile(f);
      const total = r.added + r.updated + r.tools.length;
      await notice(
        `${r.from ? r.from + '에서 ' : ''}${timeAgo(r.exportedAt)}에 저장한 백업을 합쳤습니다.\n\nLED 새로 추가 ${r.added} · 최신으로 바뀜 ${r.updated} · 그대로 ${r.kept}` +
          (r.tools.length ? `\n도구: ${r.tools.join(', ')}` : '') +
          (total === 0 ? '\n\n이 기기가 이미 최신입니다.' : ''),
      );
    } catch (err: any) {
      toast('불러오기 실패: ' + (err?.message || err));
    }
    setBusy(false);
  };

  return (
    <div class="screen">
      <TopBar title={onFirebaseHost() ? '동기화' : '백업 · 동기화'} back="/menu" />

      {onFirebaseHost() ? <>
        <CloudCard />
        {/* iCloud 백업은 없앰. 예전 앱 데이터를 옮길 때만 쓰는 파일 불러오기·저장 (접어 둠) */}
        <details class="card file-backup">
          <summary><span style="font-weight:600">백업 파일</span> <span class="small muted">· 예전 앱 데이터 옮기기</span></summary>
          <div class="stack" style="margin-top:12px">
            <label class={'btn block' + (busy ? ' disabled' : '')}>백업 파일 불러오기
              <input type="file" accept="application/json,.json" style="display:none" disabled={busy} onChange={load} />
            </label>
            <button class="btn block" disabled={busy} onClick={save}>백업 파일로 저장</button>
            <div class="small muted"><code>ZUNO-backup_…json</code> 파일을 고르면 항목마다 더 최근에 고친 쪽이 남아요. 로그인돼 있으면 불러온 내용이 바로 다른 기기에도 들어가요.</div>
          </div>
        </details>
      </> : <><MoveCard /><DriveCard /><OldICloud /></>}
    </div>
  );

  function OldICloud() {
    return <>
      <div class="section-title">iCloud 파일 백업</div>

      <div class={'card stack' + (needsBackup() ? ' accent' : '')}>
        <div class="row">
          <div class="grow">
            <div style="font-weight:600">이 기기 → iCloud에 저장</div>
            <div class="small muted">마지막 저장 <b class="num">{ago(lastBackupAt())}</b>{changed > 0 && <> · 그 뒤로 바뀐 항목 <b class="num" style="color:var(--accent)">{changed}</b></>}</div>
          </div>
        </div>
        <button class="btn primary big block" disabled={busy} onClick={save}>☁︎ iCloud에 저장</button>
        <div class="small muted">
          {ios
            ? <>공유 창에서 <b>"파일에 저장" → iCloud Drive</b>를 고르세요. 처음 한 번 <b>Zuno Workspace</b> 같은 폴더를 만들어 두면 다음부터 그 폴더가 기본으로 열립니다.</>
            : <>Mac에서는 다운로드 폴더에 저장됩니다. Safari <b>설정 → 일반 → 파일 다운로드 위치</b>를 iCloud Drive 폴더로 바꿔두면 바로 아이폰과 공유됩니다.</>}
        </div>
      </div>

      <div class="card stack">
        <div style="font-weight:600">iCloud → 이 기기로 불러오기</div>
        <div class="small muted">마지막 불러오기 <b class="num">{ago(lastLoadAt())}</b></div>
        <label class={'btn big block' + (busy ? ' disabled' : '')}>☁︎ iCloud에서 불러오기
          <input type="file" accept="application/json,.json" style="display:none" disabled={busy} onChange={load} />
        </label>
        <div class="small muted">iCloud Drive에서 가장 최근 <code>ZUNO-backup_…json (예전 파일 LGM-backup_…도 돼요)</code> 파일을 고르세요. <b>항목마다 더 최근에 고친 쪽이 남습니다.</b> 이 기기에서 더 나중에 고친 건 덮어쓰지 않아요.</div>
      </div>

      <div class="card stack">
        <div style="font-weight:600">아이폰 ↔ Mac 쓰는 순서</div>
        <div class="small muted" style="line-height:1.7">
          1. 작업한 기기에서 <b>iCloud에 저장</b><br />
          2. 다른 기기에서 <b>iCloud에서 불러오기</b> → 방금 파일 선택<br />
          3. 그 기기에서 작업한 뒤 다시 저장 → 반대쪽에서 불러오기
        </div>
        <div class="small muted">내보낸 PNG·영상은 백업에 들어가지 않습니다. 저장할 때 <b>"이미지/비디오 저장"</b>으로 사진 앱에 넣으면 iCloud 사진으로 Mac에 자동으로 들어옵니다.</div>
      </div>
    </>;
  }
}


/** 클라우드 동기화 (Firebase): 구글 로그인 한 번 → 실시간으로 폰·PC 맞춤 */
function CloudCard() {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const u = cloudUser(), st = cloudStatus();
  const login = async () => {
    setBusy(true);
    try { await cloudSignIn(); } catch (e: any) { toast(e?.message || '로그인 실패'); }
    setBusy(false);
  };
  if (!u && cloudChecking()) return <div class="card small muted">로그인 확인 중…</div>;
  if (!u) return (
    <div class="card stack accent">
      <div style="font-weight:600">클라우드 동기화</div>
      <div class="small muted">Google 계정으로 로그인하면 폰·PC가 <b>실시간으로</b> 맞춰져요. 한 번 로그인하면 계속 유지돼요. LED·보더·프로젝트와 3D 로고·SPVS 보고서·큐시트 데이터가 모두 들어가요.</div>
      <button class="btn primary big block" disabled={busy || !s.online} onClick={login}>{busy ? '로그인 중…' : 'G  Google로 로그인'}</button>
      {!s.online && <div class="small" style="color:var(--danger)">오프라인이에요. 인터넷에 연결된 뒤 로그인하세요.</div>}
    </div>
  );
  const line = !s.online ? '오프라인 · 바뀐 내용은 이 기기에 모아 뒀다가 연결되면 올려요'
    : st === 'syncing' || st === 'connecting' ? '동기화 중…'
    : st === 'error' ? '오류: ' + cloudError()
    : `동기화됨 · ${ago(cloudLastSync())}`;
  return (
    <div class="card stack">
      <div class="row">
        <div class="grow">
          <div style="font-weight:600">클라우드 동기화 <span class="chip on" style="min-height:24px;margin-left:6px">켜짐</span></div>
          <div class="small muted" style="word-break:break-all">{u.email}</div>
        </div>
      </div>
      <div class="small" style={st === 'error' ? 'color:var(--danger)' : 'color:var(--text-2)'}>{line}</div>
      <div class="small muted">고치면 바로 올라가고, 다른 기기에서 바꾼 것도 바로 들어와요. 항목마다 <b>더 최근에 고친 쪽</b>이 남아요.</div>
      <button class="btn" onClick={async () => { if (await ask('로그아웃할까요?\n이 기기의 데이터는 그대로 남고, 동기화만 멈춰요.', '로그아웃')) cloudSignOut(); }}>로그아웃</button>
    </div>
  );
}

/** 예전 주소(GitHub Pages)에서: 새 주소로 옮기는 안내 */
function MoveCard() {
  return (
    <div class="card stack accent">
      <div style="font-weight:600">앱이 새 주소로 옮겼어요</div>
      <div class="small muted">새 주소에서는 커플앱처럼 <b>실시간 동기화</b>가 되고 로그인이 계속 유지돼요.</div>
      <div class="small muted" style="line-height:1.7">
        1. 아래 <b>iCloud에 저장</b>으로 이 기기 데이터를 백업 파일로 저장<br />
        2. <b>새 주소 열기</b> → 홈 화면에 추가 (예전 아이콘은 지워도 돼요)<br />
        3. 새 앱 → 더보기 → 백업 · 동기화 → <b>iCloud에서 불러오기</b>로 그 파일 선택<br />
        4. 새 앱에서 <b>Google로 로그인</b> → 다른 기기도 같은 계정으로 로그인
      </div>
      <a class="btn primary big block" href={NEW_URL} target="_blank" rel="noopener" style="text-decoration:none;display:grid;place-items:center">새 주소 열기 · zuno-workspace.web.app</a>
    </div>
  );
}

/** 구글 드라이브: 클라이언트 ID 설정 → 계정 연결 → 지금 동기화 */
function DriveCard() {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [editId, setEditId] = useState(false);
  const id = clientId();
  const linked = isLinked();
  const changed = changedSinceBackup();

  // PC 팝업은 클릭 순간에 바로 열려야 해서 미리 준비. 아이폰 리디렉션에서 돌아왔으면 이어서 동기화
  useEffect(() => {
    prepareDrive();
    const err = takeDriveError();
    if (err) toast(err);
    if (resumeAfterRedirect) { clearResume(); sync(false); }
  }, [id]);

  const sync = async (interactive = true) => {
    setBusy(true);
    try {
      const r = await syncDrive(interactive);
      const n = r.added + r.updated;
      await notice(r.first
        ? '구글 드라이브에 처음으로 올렸습니다.\n다른 기기(폰·PC)에서 같은 구글 계정으로 "지금 동기화"를 누르면 이 데이터가 합쳐집니다.'
        : `드라이브와 동기화했습니다.\n\n받아서 합친 LED: 새로 ${r.added} · 최신으로 ${r.updated}` + (r.tools.length ? `\n도구: ${r.tools.join(', ')}` : '') +
          (n + r.tools.length === 0 ? '\n\n이 기기가 이미 최신이었고, 변경 사항을 드라이브에 올렸습니다.' : ''));
    } catch (e: any) { if (!e?.redirecting) toast(e?.message || String(e)); else return; }
    setBusy(false);
  };
  const saveId = () => {
    if (!validClientId(draft)) { toast('클라이언트 ID 형식이 아니에요 (…apps.googleusercontent.com)'); return; }
    setClientId(draft); setDraft(''); setEditId(false); toast('저장했습니다. 이제 구글 계정을 연결하세요');
  };

  if (!id || editId) {
    return (
      <div class="card stack">
        <div style="font-weight:600">구글 드라이브 동기화</div>
        <div class="small muted">폰·PC 어디서 고쳐도 같은 구글 계정으로 맞춰집니다. LED 프로젝트와 큐시트·근무일지·Border Maker·3D 로고 데이터가 모두 들어가요. 처음 한 번 구글 OAuth 클라이언트 ID가 필요합니다.</div>
        <input class="input" value={draft} placeholder="1234…-abc.apps.googleusercontent.com" autoComplete="off" autoCapitalize="off" spellcheck={false}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)} aria-label="구글 OAuth 클라이언트 ID" />
        <div class="row">
          {editId && <button class="btn grow" onClick={() => { setEditId(false); setDraft(''); }}>취소</button>}
          <button class="btn primary grow" disabled={!draft.trim()} onClick={saveId}>클라이언트 ID 저장</button>
        </div>
        <details class="small muted drive-help">
          <summary>클라이언트 ID 만드는 법 (처음 한 번, 약 5분)</summary>
          <ol>
            <li><b>console.cloud.google.com</b> → 새 프로젝트 만들기 (예: ZUNO LED)</li>
            <li><b>API 및 서비스 → 라이브러리</b>에서 <b>Google Drive API</b> 사용 설정</li>
            <li><b>OAuth 동의 화면</b>: 외부 → 앱 이름·이메일 입력 → 범위에 <code>…/auth/drive.appdata</code> 추가 → 테스트 사용자에 본인 구글 계정 추가</li>
            <li><b>사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID</b> → 유형 <b>웹 애플리케이션</b></li>
            <li><b>승인된 JavaScript 원본</b>에 <code>{location.origin}</code> 추가 (PC에서 로컬로도 쓰면 <code>http://localhost:5174</code>도)</li>
            <li><b>승인된 리디렉션 URI</b>에 <code>{redirectUri()}</code> 추가 (아이폰 로그인용)</li>
            <li>만들어진 <b>클라이언트 ID</b>(…apps.googleusercontent.com)를 위 칸에 붙여넣기. 폰·PC 각각 한 번씩</li>
          </ol>
          <div>클라이언트 ID는 비밀번호가 아니라 공개되는 값이에요. 앱은 드라이브의 <b>앱 전용 숨김 폴더</b>만 쓰고, 다른 파일은 볼 수 없습니다.</div>
        </details>
      </div>
    );
  }

  return (
    <div class={'card stack' + (needsBackup() ? ' accent' : '')}>
      <div class="row">
        <div class="grow">
          <div style="font-weight:600">구글 드라이브 동기화 {linked && <span class="chip on" style="min-height:24px;margin-left:6px">연결됨</span>}</div>
          <div class="small muted">마지막 동기화 <b class="num">{ago(lastDriveSync())}</b>{changed > 0 && <> · 그 뒤로 바뀐 항목 <b class="num" style="color:var(--accent)">{changed}</b></>}</div>
        </div>
      </div>
      <button class="btn primary big block" disabled={busy || !s.online} onClick={() => sync(true)}>
        {busy ? '동기화 중…' : linked ? '⇅ 지금 동기화' : 'G  구글 계정 연결 · 동기화'}
      </button>
      {!s.online && <div class="small" style="color:var(--danger)">오프라인이라 동기화할 수 없어요. 작업은 계속 이 기기에 저장됩니다.</div>}
      {useRedirect() && !linked && <div class="small muted">아이폰은 구글 로그인 페이지로 이동했다가 자동으로 돌아와요. 구글 클라이언트의 <b>승인된 리디렉션 URI</b>에 <code class="mono">{redirectUri()}</code> 가 있어야 합니다.</div>}
      <div class="small muted"><b>온라인이면 자동</b>: 고치면 몇 초 뒤 올리고, 앱이 열려 있으면 30초마다 다른 기기 변경을 받아요. 항목마다 <b>더 최근에 고친 쪽</b>이 남아요. 구글 로그인은 약 1시간마다 만료돼서, 그때 뜨는 <b>다시 연결</b>을 한 번 누르면 이어서 자동으로 맞춰요.</div>
      <div class="row wrap">
        {linked && <button class="btn" disabled={busy} onClick={async () => { if (await ask('이 기기에서 구글 드라이브 연결을 해제할까요?\n드라이브의 백업 파일과 이 기기 데이터는 그대로 남습니다.', '해제')) unlinkDrive(); }}>연결 해제</button>}
        {!clientFromBuild() && <button class="btn ghost" onClick={() => setEditId(true)}>클라이언트 ID 바꾸기</button>}
      </div>
    </div>
  );
}

function ClickSetting() {
  const [on, setOn] = useState(clickOn());
  return (
    <div class="card stack">
      <div style="font-weight:600">클릭음</div>
      <div class="small muted">버튼을 누를 때 짧은 소리. 아이폰 무음 모드에서는 나지 않아요.</div>
      <Seg<'on' | 'off'> value={on ? 'on' : 'off'} onChange={(v) => { setClickOn(v === 'on'); setOn(v === 'on'); if (v === 'on') tick(); }}
        options={[['on', '켜기'], ['off', '끄기']]} />
    </div>
  );
}

const SWATCHES = ['#5613C8', '#A855F7', '#8B5CF6', '#D946EF', '#EC4899', '#F43F5E', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#3B82F6', '#FFFFFF'];

function Settings() {
  const s = useStore();
  return (
    <div class="screen">
      <TopBar title="설정" back="/menu" />
      <div class="card stack">
        <div style="font-weight:600">포인트 컬러</div>
        <div class="small muted">앱 화면과 가이드 PNG(브래킷·삼각형·원·대각선)에 함께 적용됩니다.</div>
        <div class="row wrap">
          {SWATCHES.map((c) => (
            <button key={c} aria-label={c} onClick={() => saveSettings({ accent: c })}
              style={{ width: '44px', height: '44px', borderRadius: '12px', background: c, border: s.settings.accent.toUpperCase() === c ? '3px solid #fff' : '1px solid var(--line)' }} />
          ))}
          <label class="btn" style="position:relative">직접 선택
            <input type="color" value={s.settings.accent} style="position:absolute;inset:0;opacity:0"
              onInput={(e) => saveSettings({ accent: (e.target as HTMLInputElement).value })} />
          </label>
        </div>
        <div class="mono small muted">{s.settings.accent}</div>
      </div>
      <div class="card stack">
        <div style="font-weight:600">로고 색</div>
        <div class="small muted">가이드 가운데 원 안의 ZUNO 로고</div>
        <Seg<'white' | 'accent'> value={s.settings.logoTint} onChange={(v) => saveSettings({ logoTint: v })}
          options={[['white', '화이트'], ['accent', '포인트 컬러']]} />
      </div>
      <div class="card stack">
        <div style="font-weight:600">새 LED 기본 출력 프리셋</div>
        <Seg<OutputPreset> value={s.settings.defaultPreset} onChange={(v) => saveSettings({ defaultPreset: v })}
          options={[...Object.entries(PRESETS).map(([k, p]) => [k, p.label] as [OutputPreset, string]), ['CUSTOM', '커스텀']]} />
      </div>
      <ClickSetting />
      <div class="card stack">
        <div style="font-weight:600">샘플 프로젝트</div>
        <button class="btn block" onClick={() => { const { led } = createSample(); go(`/led/${led.id}/in`); }}>샘플 프로젝트 추가</button>
      </div>
    </div>
  );
}
