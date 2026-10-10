import { useState } from 'react';
import type { DiagnosticItem } from '../../shared/ipc';
import { Card } from '../components/ui';
import { useL, useT } from '../i18n';
import { call } from '../store';

export function Troubleshoot() {
  const L = useL();
  const t = useT();
  const [items, setItems] = useState<DiagnosticItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    void call('diag.run').then(setItems).finally(() => setBusy(false));
  };
  return (
    <div className="col">
      <h1>{t('nav.help')}</h1>
      <Card title={L('Hubinta nidaamka', 'System check')} right={<button className="btn primary" disabled={busy} onClick={run}>{busy ? '…' : L('Orod hubinta', 'Run checks')}</button>}>
        {!items && <div className="muted">{L('Riix “Orod hubinta” si aad u aragto maykarafoonka, kamaradda, furayaasha, internetka, Ollama, iyo moodellada.', 'Press “Run checks” to test the microphone, camera, keys, internet, Ollama and models.')}</div>}
        {items && (
          <table>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td style={{ width: 28 }}><span className={`dot ${i.ok === null ? '' : i.ok ? 'ok' : 'err'}`} /></td>
                  <td><b>{i.title}</b><div className="small muted">{i.detail}</div>{i.ok === false && <div className="small" style={{ color: 'var(--warn)' }}>➜ {L(i.fixSo, i.fixEn)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={() => void call('app.openLogs')}>{L('Fur faylasha log-ka', 'Open log folder')}</button></div>
      </Card>
      <div className="grid g2">
        <Card title={L('Xaddidaadaha runta ah', 'Honest boundaries')}>
          <ul className="small">
            <li>{L('Afuufow waa barnaamij ka shaqeeya KADIB marka aad gasho Windows. Ma daawan karto, ma dhegeysan karto, lamana bedeli karto shaashadda furitaanka (lock screen) iyo furaha Windows.', 'Afuufow is an ordinary program that runs AFTER you sign in to Windows. It cannot watch or listen before sign-in, cannot bypass or replace the lock screen, and is not a Windows credential.')}</li>
            <li>{L('Aqoonsiga wajiga waa shakhsiyeyn iyo joogitaan; kuma filna ficillada xasaasiga ah (PIN/Hello ayaa loo baahan yahay).', 'Face recognition is for personalisation and presence; it is not enough for sensitive actions (PIN/Hello is required).')}</li>
            <li>{L('Hubinta sawirka (liveness) waa mid kooban: sawir ayaa la joojin karaa, muuqaal la ciyaarayo ama deepfake ma joojiso.', 'The anti-photo check is limited: it can reject a still photo, not a replayed video or a deepfake.')}</li>
            <li>{L('Aqoonsiga codka Soomaaliga ee maxaliga ah (Whisper) aad buu u liita (eeg docs/SPEECH_EVALUATION). Soomaaliga fiican wuxuu u baahan yahay cloud (Azure) iyo furaha.', 'On-device Somali recognition (Whisper) is very poor (see docs/SPEECH_EVALUATION). Good Somali needs the cloud (Azure) and its key.')}</li>
            <li>{L('Selectors-ka WhatsApp Web iyo YouTube waa isbeddelaan karaan; marka ay is bedelaan Afuufow waxay sheegi doontaa cilad, mana ku sheegi doonto guul been ah.', 'WhatsApp Web and YouTube pages change; when they do, Afuufow reports a failure instead of claiming success.')}</li>
          </ul>
        </Card>
        <Card title={L('Cilladaha caadiga ah', 'Common problems')}>
          <ul className="small">
            <li><b>{L('Maykarafoon ma shaqeeyo', 'Microphone does not work')}:</b> {L('Windows Settings → Privacy → Microphone → u oggolow barnaamijyada desktop-ka.', 'Windows Settings → Privacy → Microphone → allow desktop apps.')}</li>
            <li><b>{L('Kamarad la xiray', 'Camera blocked')}:</b> {L('Settings → Privacy → Camera.', 'Settings → Privacy → Camera.')}</li>
            <li><b>{L('Ereyga “Afuufow” lama aqoonsado', 'Wake word not detected')}:</b> {L('Soo deji moodelka KWS (Setup) ama ku celi “Deji erayga” (Dejinta).', 'Download the KWS model (Setup) or run “Calibrate wake word” (Settings).')}</li>
            <li><b>{L('Soomaali cod ma maqlo', 'No Somali voice')}:</b> {L('Gali furaha Azure Speech oo oggolow cloud TTS.', 'Enter your Azure Speech key and allow cloud TTS.')}</li>
            <li><b>Ollama:</b> {L('Rakib ollama.com, kadib: ollama pull gemma3:4b.', 'Install from ollama.com, then: ollama pull gemma3:4b.')}</li>
            <li><b>{L('Ma bilaabmo marka Windows furmo', 'Does not start with Windows')}:</b> {L('Fur “Bilow marka Windows furmo” (Dejinta) — Task Manager → Startup apps.', 'Turn on “Start with Windows” (Settings) — and check Task Manager → Startup apps.')}</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
