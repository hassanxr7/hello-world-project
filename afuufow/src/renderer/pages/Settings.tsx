import { useState } from 'react';
import { Card, Check, Field } from '../components/ui';
import { useL, useT } from '../i18n';
import { call, notify, patchSettings, useUi } from '../store';

export function Settings() {
  const L = useL();
  const t = useT();
  const snap = useUi((s) => s.snap)!;
  const s = snap.settings;
  const [busy, setBusy] = useState(false);
  return (
    <div className="col">
      <h1>{t('nav.settings')}</h1>
      <div className="grid g2">
        <Card title={L('Muuqaalka & luqadda', 'Appearance & language')}>
          <div className="col">
            <Field label={t('theme')}>
              <select value={s.general.theme} onChange={(e) => void patchSettings({ general: { theme: e.target.value } })}>
                <option value="dark">{t('dark')}</option><option value="light">{t('light')}</option><option value="system">{t('system')}</option>
              </select>
            </Field>
            <Field label={t('language')}>
              <select value={s.general.uiLanguage} onChange={(e) => void patchSettings({ general: { uiLanguage: e.target.value } })}>
                <option value="so">Soomaali</option><option value="en">English</option>
              </select>
            </Field>
            <Field label={L('Luqadda Afuufow ku hadlayo', 'Language Afuufow speaks')}>
              <select value={s.general.speechLanguage} onChange={(e) => void patchSettings({ general: { speechLanguage: e.target.value } })}>
                <option value="so">Soomaali ({L('caadi', 'default')})</option><option value="en">English</option>
              </select>
            </Field>
          </div>
        </Card>
        <Card title={L('Bilaabista & gadaal', 'Startup & background')}>
          <div className="col">
            <Check checked={s.general.startWithWindows} onChange={(v) => void call('app.setLoginItem', v)}>{L('Bilow marka aan Windows galo', 'Start after I sign in to Windows')}</Check>
            <Check checked={s.general.startHidden} onChange={(v) => void patchSettings({ general: { startHidden: v } })}>{L('Ku bilow gadaal (tray) — daaqadda ha furmin', 'Start in the background (tray) — do not open the window')}</Check>
            <div className="small muted">{L('Marka daaqadda la xidho Afuufow waxay ku sii shaqeysaa tray-ga. Ka bax adigoo isticmaalaya badhanka hoose ama tray-ga.', 'Closing the window keeps Afuufow running in the tray. Use the button below or the tray menu to exit.')}</div>
            <button className="btn danger" onClick={() => void call('app.quit')}>{t('quit')}</button>
          </div>
        </Card>
        <Card title={L('Codka & ereyga toosinta', 'Voice & wake word')}>
          <div className="col">
            <Check checked={s.audio.wakeWordEnabled} onChange={(v) => void patchSettings({ audio: { wakeWordEnabled: v } })}>{L('Dhegayso “Afuufow”', 'Listen for “Afuufow”')}</Check>
            <div className="small muted">{L('Waxaa loo isticmaalaa moodelka KWS ee maxaliga ah (ma dirto codka). Haddii uusan rakibnayn, Whisper ayaa la isticmaalayaa.', 'Uses the on-device KWS model (audio is not sent anywhere). Without it, on-device Whisper is used.')}</div>
            <button className="btn" disabled={busy || !s.setupComplete} onClick={() => { setBusy(true); notify('info', 'Dheh “Afuufow” 3 jeer.', 'Say “Afuufow” 3 times.'); void call('wake.calibrate').then((h) => notify('info', `Waxaa la maqlay: ${h.join(', ') || '—'}`, `Heard: ${h.join(', ') || '—'}`)).finally(() => setBusy(false)); }}>{L('Deji erayga (3 jeer ku dheh)', 'Calibrate wake word (say it 3×)')}</button>
            <div className="small muted">{L('Aliases:', 'Learned spellings:')} {s.audio.wakeAliases.join(', ') || '—'}</div>
            <Check checked={s.audio.bargeIn} onChange={(v) => void patchSettings({ audio: { bargeIn: v } })}>{L('Ogow in la jaro marka uu hadlayo (barge-in)', 'Allow interrupting while it speaks (barge-in)')}</Check>
            <Field label={L('Xooggaaga codka', 'Output volume')}><input type="number" min={0} max={1} step={0.1} value={s.audio.ttsVolume} onChange={(e) => void patchSettings({ audio: { ttsVolume: Number(e.target.value) } })} /></Field>
            <Field label={L('Xasaasiyadda VAD', 'VAD sensitivity')} hint={L('Hoose = wax badan ayuu qabtaa; sare = waxoogaa ayuu seegaa', 'Lower = picks up more; higher = misses quiet speech')}><input type="number" min={0.1} max={0.95} step={0.05} value={s.audio.vadThreshold} onChange={(e) => void patchSettings({ audio: { vadThreshold: Number(e.target.value) } })} /></Field>
          </div>
        </Card>
        <Card title={L('Furayaasha degdega ah', 'Global shortcuts')}>
          <div className="col">
            <Field label={L('Ku hadal (push-to-talk, riix mar bilow/mar jooji)', 'Push-to-talk (press to start / stop)')}><input type="text" value={s.general.pushToTalkShortcut} onChange={(e) => void patchSettings({ general: { pushToTalkShortcut: e.target.value } })} /></Field>
            <Field label={L('Jooji hadalka/hawsha', 'Stop speech / task')}><input type="text" value={s.general.stopShortcut} onChange={(e) => void patchSettings({ general: { stopShortcut: e.target.value } })} /></Field>
            <Field label={L('Muuji daaqadda', 'Show window')}><input type="text" value={s.general.showWindowShortcut} onChange={(e) => void patchSettings({ general: { showWindowShortcut: e.target.value } })} /></Field>
            <div className="small muted">{L('Qaabka Electron: Control+Alt+Space …', 'Electron format: Control+Alt+Space …')}</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
