import { useState } from 'react';
import { Card, Check, Field } from '../components/ui';
import { useL, useT } from '../i18n';
import { call, notify, patchSettings, useUi } from '../store';

export function SecretInput({ name, label, placeholder }: { name: string; label: string; placeholder?: string }) {
  const snap = useUi((s) => s.snap)!;
  const L = useL();
  const [v, setV] = useState('');
  const has = snap.secretsPresent.includes(name);
  return (
    <Field label={label} hint={L('Waxaa lagu kaydiyaa Windows data protection (DPAPI); weligeed lagama muujiyo.', 'Stored with Windows data protection (DPAPI); never shown again.')}>
      <div className="row">
        <input type="password" value={v} placeholder={has ? '••••••••  ' + L('(la kaydiyay)', '(stored)') : placeholder} onChange={(e) => setV(e.target.value)} />
        <button className="btn sm" disabled={!v} onClick={() => void call('secret.set', { name, value: v }).then(() => { setV(''); notify('info', 'La kaydiyay.', 'Saved.'); })}>{L('Kaydi', 'Save')}</button>
        {has && <button className="btn sm danger" onClick={() => void call('secret.delete', name)}>{L('Tirtir', 'Remove')}</button>}
      </div>
    </Field>
  );
}

function TestButton({ kind, label }: { kind: Parameters<typeof call<'diag.test'>>[1]; label: string }) {
  const [r, setR] = useState<{ ok: boolean; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="row">
      <button className="btn sm" disabled={busy} onClick={() => { setBusy(true); void call('diag.test', kind).then(setR).finally(() => setBusy(false)); }}>{busy ? '…' : label}</button>
      {r && <span className={`tag ${r.ok ? 'ok' : 'err'}`}>{r.ok ? 'OK' : 'FAIL'}</span>}
      {r && <span className="small muted">{r.detail}</span>}
    </div>
  );
}

export function Integrations() {
  const snap = useUi((s) => s.snap)!;
  const s = snap.settings;
  const L = useL();
  const t = useT();
  const p = s.providers;
  return (
    <div className="col">
      <h1>{t('nav.integrations')}</h1>
      <div className="grid g2">
        <Card title={L('Aqoonsiga codka (Speech-to-Text)', 'Speech recognition (STT)')}>
          <div className="col">
            <Field label={L('Bixiye', 'Provider')}>
              <select value={p.stt.primary} onChange={(e) => void patchSettings({ providers: { stt: { primary: e.target.value } } })}>
                <option value="azure">Azure AI Speech (so-SO) — {L('cloud', 'cloud')}</option>
                <option value="openai">OpenAI-compatible /audio/transcriptions</option>
                <option value="local">{L('Maxali (Whisper) — Soomaali daciif', 'On-device Whisper — weak for Somali')}</option>
              </select>
            </Field>
            <Field label={L('Bixiye gurmad', 'Fallback')}>
              <select value={p.stt.fallback} onChange={(e) => void patchSettings({ providers: { stt: { fallback: e.target.value } } })}>
                <option value="none">—</option><option value="local">{L('Maxali', 'On-device')}</option><option value="azure">Azure</option><option value="openai">OpenAI-compatible</option>
              </select>
            </Field>
            <div className="grid g2">
              <Field label="Azure region"><input type="text" value={p.stt.azureRegion} onChange={(e) => void patchSettings({ providers: { stt: { azureRegion: e.target.value.trim() }, tts: { azureRegion: e.target.value.trim() } } })} /></Field>
              <Field label={L('Luqadda Azure', 'Azure language')}><input type="text" value={p.stt.azureLanguage} onChange={(e) => void patchSettings({ providers: { stt: { azureLanguage: e.target.value.trim() } } })} /></Field>
            </div>
            <SecretInput name="azure.speech.key" label="Azure Speech key" />
            <div className="grid g2">
              <Field label="OpenAI-compatible base URL"><input type="text" value={p.stt.openaiBaseUrl} onChange={(e) => void patchSettings({ providers: { stt: { openaiBaseUrl: e.target.value.trim() } } })} /></Field>
              <Field label={L('Moodel', 'Model')}><input type="text" value={p.stt.openaiModel} onChange={(e) => void patchSettings({ providers: { stt: { openaiModel: e.target.value.trim() } } })} /></Field>
            </div>
            <SecretInput name="openai.key" label="OpenAI-compatible API key" />
            <TestButton kind="stt" label={L('Tijaabi aqoonsiga codka', 'Test recognition')} />
            <div className="small muted">{L('Cloud wuxuu u baahan yahay in aad ka furto Qarsoodi → “Oggolow cloud STT”. Codka waxaa loo diraa bixiyaha.', 'Cloud needs Privacy → “Allow cloud STT”. Your voice is then sent to the provider.')}</div>
          </div>
        </Card>
        <Card title={L('Codka jawaabta (Text-to-Speech)', 'Speech output (TTS)')}>
          <div className="col">
            <Field label={L('Codka Soomaaliga (nin)', 'Somali voice (male)')}>
              <select value={p.tts.azureVoice} onChange={(e) => void patchSettings({ providers: { tts: { azureVoice: e.target.value } } })}>
                <option value="so-SO-MuuseNeural">so-SO-MuuseNeural ({L('nin', 'male')})</option>
                <option value="so-SO-UbaxNeural">so-SO-UbaxNeural ({L('dumar', 'female')})</option>
              </select>
            </Field>
            <Field label={L('Xawaaraha hadalka', 'Speaking rate')}><input type="number" min={0.5} max={2} step={0.1} value={p.tts.rate} onChange={(e) => void patchSettings({ providers: { tts: { rate: Number(e.target.value) } } })} /></Field>
            <Field label={L('Codka Ingiriisiga ee offline (SAPI)', 'Offline English voice hint (SAPI)')}><input type="text" value={p.tts.sapiVoiceHint} onChange={(e) => void patchSettings({ providers: { tts: { sapiVoiceHint: e.target.value } } })} /></Field>
            <TestButton kind="tts" label={L('Tijaabi codka cloud', 'Test cloud voice')} />
            <TestButton kind="speak" label={L('Ku dheh jumlad tijaabo', 'Speak a test sentence')} />
            <div className="warnbox small">{L('Windows ma lahan cod Soomaali ah oo offline ah. Markii internetka ama furaha la waayo, jawaabaha Soomaaliga qoraal ahaan ayay ka muuqdaan; Ingiriisiga waa la hadli karaa (SAPI).', 'Windows has no offline Somali voice. Without internet or a key, Somali replies are shown as text only; English can still be spoken (SAPI).')}</div>
          </div>
        </Card>
        <Card title={L('Maskaxda AI', 'AI model')}>
          <div className="col">
            <Field label={L('Bixiye', 'Provider')}>
              <select value={p.llm.primary} onChange={(e) => void patchSettings({ providers: { llm: { primary: e.target.value } } })}>
                <option value="ollama">Ollama ({L('maxali', 'local')})</option>
                <option value="openai">OpenAI-compatible ({L('cloud ama maxali', 'cloud or local')})</option>
                <option value="anthropic">Anthropic (cloud)</option>
              </select>
            </Field>
            <div className="grid g2">
              <Field label="Ollama URL"><input type="text" value={p.llm.ollamaBaseUrl} onChange={(e) => void patchSettings({ providers: { llm: { ollamaBaseUrl: e.target.value.trim() } } })} /></Field>
              <Field label={L('Moodel Ollama', 'Ollama model')}><input type="text" value={p.llm.ollamaModel} onChange={(e) => void patchSettings({ providers: { llm: { ollamaModel: e.target.value.trim() } } })} /></Field>
              <Field label="OpenAI-compatible URL"><input type="text" value={p.llm.openaiBaseUrl} onChange={(e) => void patchSettings({ providers: { llm: { openaiBaseUrl: e.target.value.trim() } } })} /></Field>
              <Field label={L('Moodel', 'Model')}><input type="text" value={p.llm.openaiModel} onChange={(e) => void patchSettings({ providers: { llm: { openaiModel: e.target.value.trim() } } })} /></Field>
              <Field label={L('Moodel Anthropic', 'Anthropic model')}><input type="text" value={p.llm.anthropicModel} onChange={(e) => void patchSettings({ providers: { llm: { anthropicModel: e.target.value.trim() } } })} /></Field>
            </div>
            <SecretInput name="anthropic.key" label="Anthropic API key" />
            <TestButton kind="llm" label={L('Tijaabi AI-ga', 'Test AI')} />
            <div className="small muted">{L('Moodellada yaryar ee maxaliga ah Soomaaliga si fiican ma u hadlaan; moodel cloud ah ayaa ka fiican. Cloud-ka ka fur Qarsoodi.', 'Small local models speak Somali only moderately; a cloud model is better. Enable cloud under Privacy.')}</div>
          </div>
        </Card>
        <Card title="WhatsApp">
          <div className="col">
            <Check checked={s.integrations.whatsapp.enabled} onChange={(v) => void patchSettings({ integrations: { whatsapp: { enabled: v } } })}>{L('Daar WhatsApp', 'Enable WhatsApp')}</Check>
            <Field label={L('Nooca', 'Mode')}>
              <select value={s.integrations.whatsapp.mode} onChange={(e) => void patchSettings({ integrations: { whatsapp: { mode: e.target.value } } })}>
                <option value="web">WhatsApp Web ({L('qoraal + dir + xaqiijin', 'draft + send + verification')})</option>
                <option value="desktop">WhatsApp Desktop ({L('diyaarin kaliya, ma diro', 'draft only, never sends')})</option>
              </select>
            </Field>
            <div className="row">
              <button className="btn" onClick={() => void call('whatsapp.show')}>{L('Fur WhatsApp / scan QR', 'Open WhatsApp / scan QR')}</button>
              <button className="btn danger" onClick={() => confirm(L('Ka bax WhatsApp?', 'Sign out of WhatsApp in Afuufow?')) && void call('whatsapp.logout')}>{L('Ka bax', 'Sign out')}</button>
            </div>
            <TestButton kind="whatsapp" label={L('Hubi xaaladda', 'Check status')} />
            <div className="warnbox small">{L('Digniin: WhatsApp xaddiduu isticmaalka otomaatig ah ee adeegyadiisa; waxaa laga yaabaa in akoonka la xaddido. Afuufow waxay dirtaa keliya amarkaaga, hal fariin markiiba, xaddi saacadeed ayaa jira (20/saac). Kala dooro Web ama Desktop.', 'Warning: WhatsApp’s terms restrict automated use of its service, and accounts can be limited. Afuufow only sends on your explicit command, one message at a time, with a limit of 20 per hour. The WhatsApp Web selectors are not verified against the live site and may need updates.')}</div>
          </div>
        </Card>
        <Card title="YouTube">
          <div className="col">
            <Field label={L('Ku daaq', 'Play in')}>
              <select value={s.integrations.youtube.playIn} onChange={(e) => void patchSettings({ integrations: { youtube: { playIn: e.target.value } } })}>
                <option value="app">{L('Daaqadda Afuufow (waa la xaqiijin karaa)', 'Afuufow player window (playback verifiable)')}</option>
                <option value="browser">{L('Browser-ka caadiga ah (lama xaqiijin karo)', 'Default browser (not verifiable)')}</option>
              </select>
            </Field>
            <Check checked={s.integrations.youtube.useApi} onChange={(v) => void patchSettings({ integrations: { youtube: { useApi: v } } })}>{L('Isticmaal YouTube Data API (ka xasiloon)', 'Use the YouTube Data API (more stable than page parsing)')}</Check>
            <SecretInput name="youtube.apikey" label="YouTube Data API key" />
            <TestButton kind="youtube" label={L('Tijaabi raadinta', 'Test search')} />
          </div>
        </Card>
        <Card title={L('Raadinta & browser-ka', 'Search & browser')}>
          <div className="col">
            <Field label={L('Mashiinka raadinta', 'Search engine')}>
              <select value={s.integrations.searchEngine} onChange={(e) => void patchSettings({ integrations: { searchEngine: e.target.value } })}>
                <option value="google">Google</option><option value="bing">Bing</option><option value="duckduckgo">DuckDuckGo</option>
              </select>
            </Field>
            <Field label="Browser">
              <select value={s.integrations.browser} onChange={(e) => void patchSettings({ integrations: { browser: e.target.value } })}>
                <option value="default">{L('Caadi', 'Default')}</option><option value="chrome">Chrome</option><option value="edge">Edge</option><option value="firefox">Firefox</option>
              </select>
            </Field>
          </div>
        </Card>
      </div>
    </div>
  );
}
