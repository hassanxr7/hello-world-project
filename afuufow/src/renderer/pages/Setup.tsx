import { useEffect, useState } from 'react';
import type { ModelStatus } from '../../shared/ipc';
import { Bar, Card, Check, Field } from '../components/ui';
import { useL } from '../i18n';
import { PinSetter } from './Permissions';
import { FaceStep } from '../components/FaceEnroll';
import { call, notify, patchSettings, useUi } from '../store';

const STEPS = ['welcome', 'owner', 'services', 'models', 'mic', 'face', 'voice', 'perm', 'integ', 'finish'] as const;
type Step = (typeof STEPS)[number];

function Models({ ids }: { ids: string[] }) {
  const L = useL();
  const dl = useUi((s) => s.downloads);
  const snap = useUi((s) => s.snap);
  const [list, setList] = useState<ModelStatus[]>([]);
  useEffect(() => {
    void call('models.status').then(setList);
  }, [dl, snap?.mlCaps]);
  return (
    <div className="col">
      {list.filter((m) => ids.includes(m.id)).map((m) => {
        const d = dl[m.id];
        const busy = d && !d.done;
        return (
          <div key={m.id} className="card" style={{ padding: 12 }}>
            <div className="row"><b>{m.title}</b><span className="muted small">{m.sizeMb} MB</span><span className="spacer" />
              {m.installed ? <><span className="tag ok">{L('Rakiban', 'Installed')}</span><button className="btn sm danger" onClick={() => void call('models.remove', m.id)}>{L('Ka saar', 'Remove')}</button></> : <button className="btn sm primary" disabled={!!busy} onClick={() => void call('models.download', m.id)}>{busy ? '…' : L('Soo deji', 'Download')}</button>}
            </div>
            <div className="small muted">{m.purpose}</div>
            {busy && <Bar value={d.received / d.total} />}
            {d?.error && <div className="errbox small">{d.error}</div>}
          </div>
        );
      })}
    </div>
  );
}

function VoiceStep() {
  const L = useL();
  const snap = useUi((s) => s.snap)!;
  const e = useUi((s) => s.enroll);
  const [running, setRunning] = useState(false);
  const prog = e?.kind === 'voice' ? e : null;
  return (
    <div className="col">
      <p className="muted">{L('Codka waxaa loo isticmaalaa in lagu shaandheeyo hadalka (kan Boss ma aha → waa la iska indhatiraa). Cod keliya KUMA OGOLAAN ficillada xasaasiga ah ama akhrinta macluumaadka gaarka ah. Waa ikhtiyaari.', 'Your voice is used to filter speech (a clearly different speaker is ignored). A voice match alone NEVER authorises sensitive actions or reading private details. Optional.')}</p>
      {!snap.mlCaps.speaker && <div className="warnbox small">{L('Marka hore soo deji moodelka codka (tallaabada Moodellada).', 'First download the speaker model (Models step).')}</div>}
      {snap.voiceEnrolled && !running && <div className="okbox">{L('Codkaaga waa la diiwaangeliyay.', 'Your voice is enrolled.')}</div>}
      {!running ? (
        <div className="row">
          <button className="btn primary" disabled={!snap.mlCaps.speaker || !snap.mlCaps.vad} onClick={() => void call('voice.enrollStart').then(() => setRunning(true))}>{L('Bilow diiwaangelinta codka', 'Start voice enrollment')}</button>
          {snap.voiceEnrolled && <button className="btn danger" onClick={() => void call('voice.delete')}>{L('Tirtir', 'Delete')}</button>}
        </div>
      ) : (
        <div className="col">
          {prog && <><Bar value={prog.progress.total / prog.progress.target} /><div><b>{prog.progress.total}/{prog.progress.target}</b> — {L(prog.progress.hintSo, prog.progress.hintEn)}</div>{prog.lastRejected && <div className="warnbox small">{L(prog.lastRejected.so, prog.lastRejected.en)}</div>}</>}
          <div className="row">
            <button className="btn primary" disabled={!prog?.progress.complete} onClick={() => void call('voice.enrollFinish').then(() => setRunning(false))}>{L('Dhammee', 'Finish')}</button>
            <button className="btn" onClick={() => void call('voice.enrollCancel').then(() => setRunning(false))}>{L('Jooji', 'Cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Setup({ onDone }: { onDone: () => void }) {
  const L = useL();
  const snap = useUi((s) => s.snap)!;
  const s = snap.settings;
  const [step, setStep] = useState<Step>('welcome');
  const [owner, setOwner] = useState(snap.owner);
  const [folders, setFolders] = useState(true);
  const [startMic, setStartMic] = useState(false);
  const [startCam, setStartCam] = useState(false);
  const [busy, setBusy] = useState(false);
  const idx = STEPS.indexOf(step);
  const names: Record<Step, string> = {
    welcome: L('Soo dhawow', 'Welcome'), owner: L('Aqoonsiga', 'Identity'), services: L('Adeegyada', 'Services'), models: L('Moodellada', 'Models'), mic: L('Codka', 'Voice'),
    face: L('Wajiga', 'Face'), voice: L('Codkaaga', 'Your voice'), perm: L('Ogolaansho', 'Permissions'), integ: L('Isku-xirka', 'Integrations'), finish: L('Dhammaad', 'Finish'),
  };
  const nav = (
    <div className="row" style={{ marginTop: 14 }}>
      <button className="btn" disabled={idx === 0} onClick={() => setStep(STEPS[idx - 1]!)}>{L('Dib', 'Back')}</button>
      <span className="spacer" />
      {idx < STEPS.length - 1 && <button className="btn primary" onClick={() => { if (step === 'owner') void call('profile.set', owner); setStep(STEPS[idx + 1]!); }}>{L('Xiga', 'Next')}</button>}
    </div>
  );
  return (
    <div className="col">
      <h1>{L('Dejinta koowaad', 'First-run setup')}</h1>
      <div className="steps">{STEPS.map((x, i) => <span key={x} className={`s ${x === step ? 'active' : i < idx ? 'done' : ''}`}>{i + 1}. {names[x]}</span>)}</div>
      {step === 'welcome' && (
        <Card title={L('Soo dhawow, Mudane Hassan', 'Welcome, Mudane Hassan')}>
          <div className="col">
            <Field label={L('Luqadda ISBARBARDHIGA', 'Interface language')}>
              <select value={s.general.uiLanguage} onChange={(e) => void patchSettings({ general: { uiLanguage: e.target.value } })}><option value="so">Soomaali</option><option value="en">English</option></select>
            </Field>
            <div className="okbox small">{L('Afuufow waxay shaqeysaa gadaal marka aad gasho Windows, waxay fulisaa amarradaada codka ama qoraalka, waxayna ku hadlaysaa Soomaali.', 'Afuufow runs in the background after you sign in to Windows, executes your voice or text commands, and speaks Somali.')}</div>
            <div className="warnbox small">
              <b>{L('Xaddidaadaha runta ah:', 'Honest boundaries:')}</b>
              <ul>
                <li>{L('Ma shaqeyn karto ka hor intaadan gelin Windows, ma bedeli karto shaashadda furitaanka, mana aha furaha Windows.', 'It cannot work before Windows sign-in, cannot bypass the lock screen, and is not a Windows credential.')}</li>
                <li>{L('Kamarad iyo maykarafoon waxay bilaabmaan oo kaliya marka aad furto, waxaana la hakin karaa isla markiiba.', 'Camera and microphone only start when you turn them on, and can be paused instantly.')}</li>
                <li>{L('Soomaaliga fiican wuxuu u baahan yahay adeeg cloud ah (Azure Speech) iyo internet. Maxaliga ah aad buu u liita.', 'Good Somali needs a cloud service (Azure Speech) and internet. On-device Somali is very weak.')}</li>
              </ul>
            </div>
          </div>
          {nav}
        </Card>
      )}
      {step === 'owner' && (
        <Card title={L('Aqoonsigaaga', 'Your identity')}>
          <div className="grid g2">
            <Field label={L('Magaca buuxa', 'Full name')}><input type="text" value={owner.fullName} onChange={(e) => setOwner({ ...owner, fullName: e.target.value })} /></Field>
            <Field label={L('Magaca salaanta (kadib “Mudane”)', 'Greeting name')}><input type="text" value={owner.greetingName} onChange={(e) => setOwner({ ...owner, greetingName: e.target.value })} /></Field>
            <Field label={L('Naanaysta', 'Nickname')}><input type="text" value={owner.nickname} onChange={(e) => setOwner({ ...owner, nickname: e.target.value })} /></Field>
          </div>
          <p className="okbox small">“Mudane {owner.greetingName}, {owner.nickname}, waan taaganahay.”</p>
          <p className="muted small">{L('Waxaa lagu kaydiyaa sir ahaan; dib ayuu u soo noqdaa marka Afuufow dib u bilaabmo.', 'Stored encrypted; it persists across restarts.')}</p>
          {nav}
        </Card>
      )}
      {step === 'services' && (
        <Card title={L('Adeegyada codka & AI', 'Speech & AI services')}>
          <div className="col">
            <p className="muted small">{L('Si Afuufow ugu hadasho Soomaali dabiici ah waxaad u baahan tahay furaha Azure Speech (xor ah ilaa xadka bilaha; eeg docs/COSTS). Waxaad kale oo isticmaali kartaa Ollama (maxali) AI-ga.', 'To speak natural Somali you need an Azure Speech key (free tier exists; see docs/COSTS). The AI can run locally with Ollama.')}</p>
            <Check checked={s.privacy.allowCloudStt} onChange={(v) => void patchSettings({ privacy: { allowCloudStt: v } })}>{L('Oggolow cloud aqoonsiga codka (codkaaga waa loo diraa Microsoft)', 'Allow cloud recognition (your voice goes to Microsoft)')}</Check>
            <Check checked={s.privacy.allowCloudTts} onChange={(v) => void patchSettings({ privacy: { allowCloudTts: v } })}>{L('Oggolow cloud codka jawaabta (qoraalka waa loo diraa Microsoft)', 'Allow cloud voice output (text goes to Microsoft)')}</Check>
            <Check checked={s.privacy.allowCloudLlm} onChange={(v) => void patchSettings({ privacy: { allowCloudLlm: v } })}>{L('Oggolow AI cloud (haddii aanad isticmaalin Ollama)', 'Allow cloud AI (if you do not use Ollama)')}</Check>
            <div className="small muted">{L('Furaha iyo bixiyayaasha: tab-ka Isku-xirka. Halkan waxaad ku dhigi kartaa furaha Azure:', 'Providers and keys live under Integrations. You can paste the Azure key here:')}</div>
            <AzureKey />
            <div className="row">
              <TestRow kind="stt" label={L('Tijaabi aqoonsiga', 'Test recognition')} />
              <TestRow kind="tts" label={L('Tijaabi codka', 'Test voice')} />
              <TestRow kind="llm" label={L('Tijaabi AI', 'Test AI')} />
            </div>
          </div>
          {nav}
        </Card>
      )}
      {step === 'models' && (
        <Card title={L('Moodellada maxaliga ah', 'On-device models')}>
          <p className="muted small">{L('Waxaa laga soo dejiyaa GitHub (sherpa-onnx) oo la hubiyaa SHA-256. Lagu talinayo: VAD + Wake word.', 'Downloaded from GitHub (sherpa-onnx) and verified with SHA-256. Recommended: VAD + wake word.')}</p>
          <Models ids={['vad', 'kws', 'speaker', 'whisper-small']} />
          {nav}
        </Card>
      )}
      {step === 'mic' && (
        <Card title={L('Maykarafoon & ereyga “Afuufow”', 'Microphone & the “Afuufow” wake word')}>
          <div className="col">
            <Check checked={s.audio.wakeWordEnabled} onChange={(v) => void patchSettings({ audio: { wakeWordEnabled: v } })}>{L('Dhegayso ereyga “Afuufow” (waa maxali haddii KWS la rakibay)', 'Listen for “Afuufow” (on-device when KWS is installed)')}</Check>
            <div className="small muted">{L('Waxaad kale oo isticmaali kartaa badhanka ku hadal (Ctrl+Alt+Space) ama qoraalka.', 'You can also use push-to-talk (Ctrl+Alt+Space) or typing.')}</div>
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => { setBusy(true); notify('info', 'Dheh “Afuufow” 3 jeer.', 'Say “Afuufow” 3 times.'); void call('wake.calibrate').then((h) => notify('info', `Waxaa la maqlay: ${h.join(', ') || '—'}`, `Heard: ${h.join(', ') || '—'}`)).finally(() => setBusy(false)); }}>{busy ? '…' : L('Deji erayga (3 jeer)', 'Calibrate the word (3×)')}</button>
            </div>
          </div>
          {nav}
        </Card>
      )}
      {step === 'face' && <Card title={L('Diiwaangelinta wajiga (ikhtiyaari)', 'Face enrollment (optional)')}><FaceStep />{nav}</Card>}
      {step === 'voice' && <Card title={L('Diiwaangelinta codka (ikhtiyaari)', 'Voice enrollment (optional)')}><VoiceStep />{nav}</Card>}
      {step === 'perm' && (
        <Card title={L('Ogolaansho', 'Permissions')}>
          <div className="col">
            <PinSetter />
            <Check checked={folders} onChange={setFolders}>{L('U oggolow Afuufow inay raadiso/furto Downloads, Documents, Desktop', 'Let Afuufow search/open Downloads, Documents and Desktop')}</Check>
            <Check checked={s.visitors.enabled} onChange={(v) => void patchSettings({ visitors: { enabled: v } })}>{L('Weydii qof aan la aqoonsan marka kamaraddu daawato (wuxuu u baahan yahay kamarad + maykarafoon)', 'Question unrecognised people when the camera is on (needs camera + microphone)')}</Check>
            <div className="small muted">{L('Xiriiriyaasha WhatsApp ku dar: Milkiilaha & Xusuusta → Xiriiriyaasha. Goobo/barnaamijyo dheeraad ah: Ogolaansho.', 'Add WhatsApp contacts under Owner & Memory → Contacts. More folders/apps: Permissions.')}</div>
          </div>
          {nav}
        </Card>
      )}
      {step === 'integ' && (
        <Card title={L('WhatsApp & YouTube', 'WhatsApp & YouTube')}>
          <div className="col">
            <Check checked={s.integrations.whatsapp.enabled} onChange={(v) => void patchSettings({ integrations: { whatsapp: { enabled: v } } })}>{L('Daar WhatsApp Web (waxaad scan-garayn doontaa QR hal mar)', 'Enable WhatsApp Web (you scan a QR code once)')}</Check>
            <button className="btn" disabled={!s.integrations.whatsapp.enabled} onClick={() => void call('whatsapp.show')}>{L('Fur WhatsApp oo scan garee QR', 'Open WhatsApp and scan the QR')}</button>
            <div className="warnbox small">{L('WhatsApp wuxuu xaddidaa isticmaalka otomaatig ah; akoonka waa la xaddidi karaa. Afuufow waxay dirtaa oo kaliya amarkaaga.', 'WhatsApp restricts automated use and may limit accounts. Afuufow only sends on your command.')}</div>
            <Field label={L('YouTube — ku daaq', 'YouTube — play in')}>
              <select value={s.integrations.youtube.playIn} onChange={(e) => void patchSettings({ integrations: { youtube: { playIn: e.target.value } } })}>
                <option value="app">{L('Daaqadda Afuufow (waa la xaqiijin karaa)', 'Afuufow window (verifiable)')}</option><option value="browser">{L('Browser-ka', 'Browser')}</option>
              </select>
            </Field>
          </div>
          {nav}
        </Card>
      )}
      {step === 'finish' && (
        <Card title={L('Dhammaad', 'Finish')}>
          <div className="col">
            <Check checked={s.general.startWithWindows} onChange={(v) => void call('app.setLoginItem', v)}>{L('Bilow marka aan Windows galo (gadaal, tray)', 'Start after I sign in to Windows (background, tray)')}</Check>
            <Check checked={startMic} onChange={setStartMic}>{L('Daar dhegaysiga maykarafoonka hadda', 'Turn on listening now')}</Check>
            <Check checked={startCam} disabled={!snap.faceEnrolled} onChange={setStartCam}>{L('Daar kamaradda (aqoonsi + booqdayaal) hadda', 'Turn on the camera (recognition + visitors) now')}</Check>
            <div className="small muted">{L('Waad hakin kartaa mar kasta: badhamada Maykarafoon/Kamarad ee kor, ama tray-ga.', 'You can pause anything at any time: the Microphone/Camera buttons at the top, or the tray menu.')}</div>
            <ul className="small">
              <li>{snap.pinSet ? '✔' : '○'} PIN</li><li>{snap.faceEnrolled ? '✔' : '○'} {L('Wajiga', 'Face')}</li><li>{snap.voiceEnrolled ? '✔' : '○'} {L('Codka', 'Voice')}</li>
              <li>{snap.mlCaps.vad ? '✔' : '○'} VAD · {snap.mlCaps.kws ? '✔' : '○'} KWS</li><li>{snap.secretsPresent.includes('azure.speech.key') ? '✔' : '○'} Azure key</li>
            </ul>
            <button className="btn primary" disabled={busy} onClick={async () => {
              setBusy(true);
              await call('app.completeSetup', { approveDefaultFolders: folders });
              if (startMic) await call('mic.set', true).catch(() => undefined);
              if (startCam) await call('cam.set', true).catch(() => undefined);
              setBusy(false);
              onDone();
            }}>{L('Dhammee dejinta', 'Complete setup')}</button>
          </div>
          <div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={() => setStep('integ')}>{L('Dib', 'Back')}</button></div>
        </Card>
      )}
    </div>
  );
}

function AzureKey() {
  const L = useL();
  const [k, setK] = useState('');
  const snap = useUi((s) => s.snap)!;
  const has = snap.secretsPresent.includes('azure.speech.key');
  return (
    <div className="grid g2">
      <Field label="Azure region"><input type="text" value={snap.settings.providers.stt.azureRegion} onChange={(e) => void patchSettings({ providers: { stt: { azureRegion: e.target.value.trim() }, tts: { azureRegion: e.target.value.trim() } } })} /></Field>
      <Field label="Azure Speech key">
        <div className="row"><input type="password" value={k} placeholder={has ? '•••••• ' + L('(la kaydiyay)', '(stored)') : ''} onChange={(e) => setK(e.target.value)} /><button className="btn sm" disabled={!k} onClick={() => void call('secret.set', { name: 'azure.speech.key', value: k }).then(() => setK(''))}>{L('Kaydi', 'Save')}</button></div>
      </Field>
    </div>
  );
}

function TestRow({ kind, label }: { kind: 'stt' | 'tts' | 'llm'; label: string }) {
  const [r, setR] = useState<{ ok: boolean; detail: string } | null>(null);
  return (
    <div className="col" style={{ minWidth: 200 }}>
      <button className="btn sm" onClick={() => void call('diag.test', kind).then(setR)}>{label}</button>
      {r && <span className={`small ${r.ok ? '' : 'muted'}`}>{r.ok ? '✔ ' : '✖ '}{r.detail}</span>}
    </div>
  );
}
