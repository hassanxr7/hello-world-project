import { Card, Check, Field } from '../components/ui';
import { useL, useT } from '../i18n';
import { call, patchSettings, useUi } from '../store';

export function Privacy() {
  const L = useL();
  const t = useT();
  const snap = useUi((s) => s.snap)!;
  const s = snap.settings;
  const r = s.privacy.retention;
  const set = (k: string, v: number) => void patchSettings({ privacy: { retention: { [k]: v } } });
  const row = (what: string, where: string, cloud: boolean) => (
    <tr><td>{what}</td><td><span className={`tag ${cloud ? 'warn' : 'ok'}`}>{where}</span></td></tr>
  );
  const p = s.providers;
  return (
    <div className="col">
      <h1>{t('nav.privacy')}</h1>
      <div className="grid g2">
        <Card title={L('Maxaa meel loo diraa?', 'What leaves this computer?')}>
          <table>
            <tbody>
              {row(L('Codkaaga (aqoonsiga)', 'Your voice (recognition)'), p.stt.primary === 'local' ? L('Maxali', 'Local') : s.privacy.allowCloudStt ? `${p.stt.primary} — cloud` : L('La xiray (cloud dansan)', 'Blocked (cloud off)'), p.stt.primary !== 'local' && s.privacy.allowCloudStt)}
              {row(L('Qoraalka la hadlayo (TTS)', 'Text to be spoken (TTS)'), s.privacy.allowCloudTts ? 'Azure — cloud' : L('La xiray', 'Blocked'), s.privacy.allowCloudTts)}
              {row(L('Su’aalaha AI', 'AI questions'), p.llm.primary === 'ollama' ? L('Maxali (Ollama)', 'Local (Ollama)') : s.privacy.allowCloudLlm ? `${p.llm.primary} — cloud` : L('La xiray', 'Blocked'), p.llm.primary !== 'ollama' && s.privacy.allowCloudLlm)}
              {row(L('Sawirrada kamaradda', 'Camera frames'), L('Maxali kaliya — lama kaydiyo', 'Local only — never stored'), false)}
              {row(L('Ereyga toosinta (Afuufow)', 'Wake word'), snap.mlCaps.kws ? L('Maxali (KWS)', 'Local (KWS)') : s.audio.wakeEngine === 'cloud' ? L('Cloud — dhammaan hadalka dhegeysi', 'Cloud — all nearby speech!') : L('Maxali (Whisper)', 'Local (Whisper)'), s.audio.wakeEngine === 'cloud' && !snap.mlCaps.kws)}
              {row(L('Dhammaan xogta kale', 'All other data'), L('Maxali, sir ahaan (AES-256 + DPAPI)', 'Local, encrypted (AES-256 + DPAPI)'), false)}
            </tbody>
          </table>
          <div className="col" style={{ marginTop: 10 }}>
            <Check checked={s.privacy.allowCloudStt} onChange={(v) => void patchSettings({ privacy: { allowCloudStt: v } })}>{L('Oggolow cloud-ka aqoonsiga codka (codka waa la diraa Microsoft/OpenAI)', 'Allow cloud speech recognition (your voice is sent to Microsoft/OpenAI)')}</Check>
            <Check checked={s.privacy.allowCloudTts} onChange={(v) => void patchSettings({ privacy: { allowCloudTts: v } })}>{L('Oggolow cloud-ka codka jawaabta (qoraalka waa la diraa Microsoft)', 'Allow cloud speech synthesis (the text is sent to Microsoft)')}</Check>
            <Check checked={s.privacy.allowCloudLlm} onChange={(v) => void patchSettings({ privacy: { allowCloudLlm: v } })}>{L('Oggolow AI cloud (su’aalahaaga ayaa la diraa)', 'Allow cloud AI (your questions are sent to the provider)')}</Check>
            <Check checked={s.privacy.allowScreenContentToCloud} onChange={(v) => void patchSettings({ privacy: { allowScreenContentToCloud: v } })}>{L('Oggolow in qoraalka shaashadda loo diro AI cloud', 'Allow screen text to be sent to a cloud AI')}</Check>
            <Check checked={s.audio.wakeEngine === 'cloud'} onChange={(v) => void patchSettings({ audio: { wakeEngine: v ? 'cloud' : 'local' } })}>{L('Ogow ereyga toosinta ee cloud (DIGNIIN: hadalka dhow oo dhan ayaa la diraa)', 'Cloud wake-word detection (WARNING: all nearby speech is sent)')}</Check>
          </div>
        </Card>
        <Card title={L('Muddada kaydinta', 'Retention')}>
          <p className="muted small">{L('0 = ha kaydin. Xogta ka weyn waa la tirtiraa si toos ah.', '0 = keep nothing. Older data is removed automatically.')}</p>
          <div className="grid g2">
            <Field label={L('Wada-hadalka (maalmo)', 'Conversation (days)')}><input type="number" min={0} value={r.historyDays} onChange={(e) => set('historyDays', Number(e.target.value))} /></Field>
            <Field label={L('Diiwaanka ficillada (maalmo)', 'Action log (days)')}><input type="number" min={0} value={r.actionLogDays} onChange={(e) => set('actionLogDays', Number(e.target.value))} /></Field>
            <Field label={L('Booqdayaasha (maalmo)', 'Visitor events (days)')}><input type="number" min={0} value={r.visitorDays} onChange={(e) => set('visitorDays', Number(e.target.value))} /></Field>
            <Field label={L('Sawirrada booqdayaasha (maalmo)', 'Visitor snapshots (days)')}><input type="number" min={0} value={r.snapshotDays} onChange={(e) => set('snapshotDays', Number(e.target.value))} /></Field>
          </div>
        </Card>
        <Card title={L('Wajiga & codka', 'Face & voice templates')}>
          <div className="col">
            <div>{L('Wajiga:', 'Face:')} <b>{snap.faceEnrolled ? `${snap.faceSamples} ${L('muunad', 'samples')}` : L('lama diiwaangelin', 'not enrolled')}</b> · {L('Codka:', 'Voice:')} <b>{snap.voiceEnrolled ? L('la diiwaangeliyay', 'enrolled') : L('lama diiwaangelin', 'not enrolled')}</b></div>
            <div className="small muted">{L('Waxaa la kaydiyaa tirooyin sir ah oo kaliya (ma aha sawir). Wajiga iyo codka ma aha furaha Windows.', 'Only encrypted numeric templates are stored (no pictures). They are not a Windows credential.')}</div>
            <div className="row">
              <button className="btn danger" disabled={!snap.faceEnrolled} onClick={() => confirm(L('Tirtir wajiga?', 'Delete face template?')) && void call('face.delete')}>{L('Tirtir wajiga', 'Delete face')}</button>
              <button className="btn danger" disabled={!snap.voiceEnrolled} onClick={() => confirm(L('Tirtir codka?', 'Delete voice template?')) && void call('voice.delete')}>{L('Tirtir codka', 'Delete voice')}</button>
            </div>
          </div>
        </Card>
        <Card title={L('Tirtir dhammaan', 'Delete everything')}>
          <div className="col">
            <div className="small muted">{L('Waxay tirtirtaa xusuusta, taariikhda, booqdayaasha, wajiga, codka, furayaasha, iyo galitaanka WhatsApp. Afuufow dib ayay u bilaabmaysaa.', 'Deletes memory, history, visitors, face, voice, keys and the WhatsApp sign-in. Afuufow then restarts.')}</div>
            <button className="btn danger" onClick={() => confirm(L('Tani dib looma celin karo. Sii wad?', 'This cannot be undone. Continue?')) && void call('data.deleteEverything')}>{L('Tirtir xogta oo dhan', 'Delete all my data')}</button>
          </div>
        </Card>
      </div>
    </div>
  );
}
