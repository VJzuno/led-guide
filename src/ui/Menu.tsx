import { ask, useStore, state, getProject, restoreProject, purgeProject, restoreLed, purgeLed, saveSettings, toast, flush } from '../store';
import { importBackup, loadAll } from '../db';
import { SCHEMA_VERSION, PRESETS, type BackupFile, type OutputPreset } from '../types';
import { createSample } from '../sample';
import { TopBar, Seg, go, timeAgo } from './common';

declare const __APP_VERSION__: string;
export const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

export function Menu({ sub }: { sub?: string }) {
  if (sub === 'about') return <About />;
  if (sub === 'trash') return <Trash />;
  if (sub === 'backup') return <Backup />;
  if (sub === 'settings') return <Settings />;
  const items: [string, string, string][] = [
    ['about', 'About', '앱 소개'],
    ['trash', '휴지통', '삭제한 프로젝트 / LED 복구'],
    ['backup', '백업 · 복원', '전체 JSON 내보내기 / 가져오기'],
    ['settings', '설정', '포인트 컬러, 기본 프리셋'],
  ];
  return (
    <div class="screen">
      <TopBar title="메뉴" />
      <div class="card">
        {items.map(([k, t, d]) => (
          <a key={k} class="list-item" href={`#/menu/${k}`}>
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
        <h3>ZUNO'S LED GUIDE MAKER</h3>
        <p class="muted" style="margin:0">VJ용 LED 인풋 / 아웃풋 가이드 제작 도구. 프로젝트 → LED → ① 인풋 가이드 → ② 아웃풋 가이드 순서로 작업합니다.</p>
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
  const empty = projects.length + leds.length === 0;
  const purgeAll = async () => {
    if (!(await ask('휴지통을 비울까요?\n되돌릴 수 없습니다.', '비우기'))) return;
    for (const p of projects) await purgeProject(p.id);
    for (const l of leds) await purgeLed(l.id);
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
    </div>
  );
}

function Backup() {
  const doExport = async () => {
    await flush();
    const b: BackupFile = {
      app: 'zuno-led-guide-maker', schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(),
      settings: state.settings, projects: state.projects, leds: state.leds,
    };
    const blob = new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' });
    const d = new Date();
    const name = `zuno-led-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad/.test(navigator.userAgent)) {
      try { await navigator.share({ files: [file] }); return; } catch (e: any) { if (e?.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const doImport = async (e: Event) => {
    const inp = e.target as HTMLInputElement;
    const f = inp.files?.[0];
    inp.value = '';
    if (!f) return;
    try {
      const b = JSON.parse(await f.text()) as BackupFile;
      if (!(await ask(`프로젝트 ${b.projects?.length ?? 0}개, LED ${b.leds?.length ?? 0}개를 가져올까요?\n같은 항목은 백업 내용으로 덮어씁니다.`, '가져오기'))) return;
      await flush();
      await importBackup(b);
      const d = await loadAll();
      Object.assign(state, { projects: d.projects, leds: d.leds });
      if (b.settings) saveSettings(b.settings);
      toast('복원 완료');
      go('/projects');
    } catch (err: any) {
      alert('가져오기 실패: ' + (err?.message || err));
    }
  };
  return (
    <div class="screen">
      <TopBar title="백업 · 복원" back="/menu" />
      <div class="card stack">
        <div style="font-weight:600">전체 백업 (JSON)</div>
        <div class="small muted">모든 프로젝트·LED·설정. 내보낸 PNG 이미지는 포함되지 않습니다 (언제든 다시 렌더 가능).</div>
        <button class="btn primary block" onClick={doExport}>백업 파일 내보내기</button>
      </div>
      <div class="card stack">
        <div style="font-weight:600">복원</div>
        <div class="small muted">백업 JSON을 선택하면 기존 데이터에 합칩니다 (같은 항목은 덮어씀). 이전 버전 백업도 자동 변환됩니다.</div>
        <label class="btn block">백업 파일 가져오기<input type="file" accept="application/json,.json" style="display:none" onChange={doImport} /></label>
      </div>
    </div>
  );
}

const SWATCHES = ['#A855F7', '#8B5CF6', '#D946EF', '#EC4899', '#F43F5E', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#3B82F6', '#FFFFFF'];

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
      <div class="card stack">
        <div style="font-weight:600">샘플 프로젝트</div>
        <button class="btn block" onClick={() => { const { led } = createSample(); go(`/led/${led.id}/in`); }}>샘플 프로젝트 추가</button>
      </div>
    </div>
  );
}
