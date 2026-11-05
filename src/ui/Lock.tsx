import { useEffect, useState } from 'preact/hooks';
import { tryUnlock, waitRemaining, failsSoFar, MAX_FAILS } from '../lock';

export function Lock({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [wait, setWait] = useState(waitRemaining());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait(waitRemaining()), 250);
    return () => clearInterval(t);
  }, [wait > 0]);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy || wait > 0 || !pw) return;
    setBusy(true);
    const r = await tryUnlock(pw);
    setBusy(false);
    if (r === 'ok') return onUnlock();
    setPw('');
    if (r === 'wait') { setWait(waitRemaining()); setMsg('5회 틀렸습니다. 잠시 후 다시 시도하세요.'); }
    else setMsg(`비밀번호가 다릅니다 (${failsSoFar()}/${MAX_FAILS})`);
  };

  return (
    <form class="lock" onSubmit={submit}>
      <div class="hero-title">ZUNO'S<br />LED GUIDE<br /><em>MAKER</em></div>
      <input class="input" type="password" autoFocus placeholder="비밀번호" value={pw} autoComplete="current-password"
        disabled={wait > 0} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
      <button class="btn primary big block" style="margin-top:12px" disabled={wait > 0 || busy || !pw}>
        {wait > 0 ? `${Math.ceil(wait / 1000)}초 후 다시 시도` : '열기'}
      </button>
      <div class="small" style={{ marginTop: '12px', minHeight: '20px', color: msg ? 'var(--accent)' : 'var(--soft)' }}>
        {msg || '이 기기에서 한 번만 입력하면 됩니다.'}
      </div>
    </form>
  );
}
