import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { DeviceToggles } from '../components/Controls';
import { Card } from '../components/ui';
import { useL, useT } from '../i18n';
import { call, useLevels, useUi } from '../store';

export function Home() {
  const t = useT();
  const L = useL();
  const turns = useUi((s) => s.turns);
  const task = useUi((s) => s.task);
  const pending = useUi((s) => s.pending);
  const draft = useUi((s) => s.draft);
  const state = useUi((s) => s.state);
  const snap = useUi((s) => s.snap);
  const lv = useLevels();
  const [text, setText] = useState('');
  const [freeText, setFreeText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, pending]);
  if (!snap) return null;
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    void call('cmd.text', v);
  };
  const p = snap.presence;
  const presenceLabel = p.visitorPresent ? t('presence.visitor') : p.ownerPresent ? t('presence.owner') : p.uncertain ? t('presence.uncertain') : t('presence.none');
  return (
    <div className="hero">
      <div className="col">
        <Card>
          <div className="avatarBox">
            <Avatar size={250} />
            <div style={{ fontSize: 18, fontWeight: 700 }}>{t('state.' + state)}</div>
            <div className="bar" style={{ width: 200 }} title={L('Heerka maykarafoonka (dhab ah)', 'Live microphone level')}>
              <i style={{ width: `${Math.min(100, lv.mic * 400)}%` }} />
            </div>
            <div className="row">
              <button className="btn danger" onClick={() => void call('cmd.stop')}>■ {t('stop')}</button>
              <button className="btn" onClick={() => void call('cmd.pttToggle')} disabled={!snap.settings.audio.micEnabled} title="Ctrl+Alt+Space">🎙 {t('ptt')}</button>
            </div>
          </div>
        </Card>
        <Card title={t('status.title')}>
          <div className="col small">
            <DeviceToggles />
            <div className="row"><span className="muted">{t('status.assurance')}:</span> <b>{t('assurance.' + snap.assurance)}</b></div>
            <div className="row"><span className={`dot ${p.visitorPresent ? 'err' : p.ownerPresent ? 'ok' : ''}`} /> {presenceLabel}</div>
            <div className="row"><span className="muted">{t('wake')}:</span> <b>{snap.settings.audio.wakeWordEnabled ? `“${snap.settings.audio.wakeWord}” ${snap.mlCaps.kws ? '(KWS)' : snap.mlCaps.asr ? '(Whisper)' : L('(moodel ma jiro)', '(no model)')}` : t('off')}</b></div>
          </div>
        </Card>
        {!snap.settings.setupComplete && <div className="warnbox">{t('needs.setup')}</div>}
      </div>
      <div className="card chat">
        <div className="row" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>{t('transcript')}</h2>
          <span className="spacer" />
          <span className="muted small">{t('home.try')}</span>
        </div>
        <div className="msgs" aria-live="polite">
          {turns.length === 0 && <div className="muted">{L('Waxaan diyaar u ahay, Boss.', 'Ready when you are, Boss.')}</div>}
          {turns.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              {m.text}
              <div className="meta">{new Date(m.at).toLocaleTimeString()}{m.source === 'voice' ? ' · 🎙' : ''}</div>
            </div>
          ))}
          {pending && (
            <div className="ask">
              <b>{L(pending.promptSo, pending.promptEn)}</b>
              {pending.kind === 'confirm' && (
                <div className="row">
                  <button className="btn primary" onClick={() => void call('cmd.answer', { yes: true })}>{t('yes')}</button>
                  <button className="btn" onClick={() => void call('cmd.answer', { yes: false })}>{t('no')}</button>
                </div>
              )}
              {pending.kind === 'choose' && (
                <div className="row">
                  {pending.options?.map((o, i) => (
                    <button key={i} className="btn" onClick={() => void call('cmd.answer', { choice: i })}>{i + 1}. {o}</button>
                  ))}
                </div>
              )}
              {pending.kind === 'text' && (
                <div className="row">
                  <input type="text" value={freeText} onChange={(e) => setFreeText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && freeText.trim()) { void call('cmd.answer', { text: freeText.trim() }); setFreeText(''); } }} />
                  <button className="btn primary" onClick={() => { if (freeText.trim()) { void call('cmd.answer', { text: freeText.trim() }); setFreeText(''); } }}>{t('send')}</button>
                </div>
              )}
            </div>
          )}
          <div ref={end} />
        </div>
        {task && (
          <div className="ask" style={{ borderColor: 'var(--warn)' }}>
            <div className="row">
              <span className="dot warn live" /> <b>{t('task')}:</b> <span>{task.label}</span>
              <span className="spacer" />
              <button className="btn danger sm" onClick={() => void call('cmd.cancelTask')}>{t('cancel')}</button>
            </div>
            {task.steps.length > 0 && <div className="small muted">{task.steps.slice(-3).join(' → ')}</div>}
          </div>
        )}
        {draft && (
          <div className="ask">
            <div className="row"><b>{t('draft')}</b><span className="spacer" />
              <button className="btn sm" onClick={() => void navigator.clipboard.writeText(draft)}>{t('copy')}</button>
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{draft}</div>
          </div>
        )}
        <div className="composer">
          <input type="text" value={text} placeholder={t('type')} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} aria-label={t('type')} />
          <button className="btn primary" onClick={submit}>{t('send')}</button>
        </div>
      </div>
    </div>
  );
}
