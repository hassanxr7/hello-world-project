import { useState } from 'react';
import { call, useUi } from '../store';
import { useL } from '../i18n';

/** Step-up identity check for sensitive actions: owner PIN (always available) or Windows Hello (when available). */
export function AuthModal() {
  const auth = useUi((s) => s.auth);
  const L = useL();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!auth) return null;
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const ok = await call('auth.verifyPin', pin);
      if (!ok) setErr(L('PIN-ku waa khaldan yahay.', 'Wrong PIN.'));
      setPin('');
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="card col">
        <h2>{L('Xaqiijin loo baahan yahay', 'Verification required')}</h2>
        <div className="muted">{auth.reason}</div>
        {auth.pinSet ? (
          <>
            <input type="password" inputMode="numeric" autoFocus value={pin} placeholder="PIN" onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && pin && void submit()} />
            {err && <div className="errbox small">{err}</div>}
            <div className="row">
              <button className="btn primary" disabled={!pin || busy} onClick={() => void submit()}>{L('Xaqiiji', 'Verify')}</button>
              {auth.allowHello && (
                <button className="btn" disabled={busy} onClick={() => { setBusy(true); void call('auth.hello').then((r) => !r.available && setErr(L('Windows Hello ma diyaar aha: ', 'Windows Hello unavailable: ') + r.result)).finally(() => setBusy(false)); }}>Windows Hello</button>
              )}
              <button className="btn ghost" onClick={() => void call('auth.cancel')}>{L('Jooji', 'Cancel')}</button>
            </div>
          </>
        ) : (
          <>
            <div className="warnbox small">{L('PIN lama dejin. Dejiso Settings → Ogolaansho.', 'No PIN is set. Set one under Permissions.')}</div>
            <button className="btn" onClick={() => void call('auth.cancel')}>{L('Xidh', 'Close')}</button>
          </>
        )}
      </div>
    </div>
  );
}
