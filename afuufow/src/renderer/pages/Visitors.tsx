import { useEffect, useState } from 'react';
import type { SessionEvent, VisitorEvent } from '../../core/visitors/log';
import { FaceStep } from '../components/FaceEnroll';
import { Card, fmtTime } from '../components/ui';
import { useL, useT } from '../i18n';
import { call, useUi } from '../store';

const consentTag = (c: string) => (c === 'responded_after_notice' ? 'ok' : c === 'declined' ? 'warn' : 'err');

export function Visitors() {
  const L = useL();
  const t = useT();
  const tick = useUi((s) => s.visitorsTick);
  const snap = useUi((s) => s.snap)!;
  const [ev, setEv] = useState<VisitorEvent[]>([]);
  const [ses, setSes] = useState<SessionEvent[]>([]);
  const [imgs, setImgs] = useState<Record<string, string | null>>({});
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const load = async () => {
    const r = await call('visitors.list');
    setEv(r.events);
    setSes(r.session);
  };
  useEffect(() => {
    void load();
  }, [tick]);
  const consentLabel = (c: string) =>
    ({ responded_after_notice: L('Wuu jawaabay kadib ogeysiiska', 'Answered after the notice'), declined: L('Wuu diiday', 'Declined'), no_response: L('Jawaab ma bixin', 'No response'), not_asked: L('Lama weydiin', 'Not asked'), interrupted: L('Waa la jaray', 'Interrupted') })[c] ?? c;
  return (
    <div className="col">
      <h1>{t('nav.visitors')}</h1>
      <div className="warnbox small">
        {L('Kamaraddu waxay diiwaangelisaa oo kaliya in qof aan la aqoonsan uu muuqday. Taasi ma caddeyso in uu laptop-ka furay. Dhacdooyinka Windows (lock/unlock) waxaa lagu qoray liis gooni ah hoose.', 'The camera only records that an unrecognised person was visible. That is not proof they unlocked or used the laptop. Windows lock/unlock events are listed separately below.')}
        {!snap.settings.visitors.enabled && <b> {L('Ogeysiis-weydiinta booqdayaasha waa dansan tahay (Ogolaansho).', 'Visitor questions are turned off (Permissions).')}</b>}
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => void call('visitors.report')}>🔊 {L('Ii akhri warbixinta', 'Read the report aloud')}</button>
        <button className="btn" onClick={async () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([await call('visitors.export')], { type: 'application/json' })); a.download = 'afuufow-visitors.json'; a.click(); }}>{t('export')}</button>
        <button className="btn danger" onClick={() => confirm(L('Ma tirtirtaa dhammaan booqdayaasha iyo sawirradooda?', 'Delete all visitor events and snapshots?')) && void call('visitors.deleteAll')}>{L('Tirtir dhammaan', 'Delete all')}</button>
      </div>
      {enrolling && (
        <Card title={L(`Diiwaangelinta wajiga: ${enrolling}`, `Face enrollment: ${enrolling}`)} right={<button className="btn sm" onClick={() => setEnrolling(null)}>✕</button>}>
          <div className="warnbox small" style={{ marginBottom: 8 }}>{L('Qofkani waa inuu jiraa oo oggolaado. Kadib, Afuufow ma weydiin doonto qofkan oo ma ahan booqde.', 'This person must be present and agree. Afterwards Afuufow will recognise them and will not treat them as a visitor.')}</div>
          <FaceStep label={enrolling} onFinished={() => setEnrolling(null)} />
        </Card>
      )}
      {ev.length === 0 && <Card><div className="muted">{L('Booqdayaal lama diiwaangelin.', 'No visitor events recorded.')}</div></Card>}
      {ev.map((e) => (
        <Card key={e.id} title={fmtTime(e.at)} right={<span className={`tag ${consentTag(e.consent)}`}>{consentLabel(e.consent)}</span>}>
          <div className="grid g2">
            <div className="col small">
              <div><span className="muted">{L('Kamarad:', 'Camera:')}</span> {L('Wajiga lama aqoonsan', 'face not recognised')} ({e.recognitionState}{e.recognitionConfidence !== null ? `, ${L('isku-ekaanshaha milkiilaha', 'similarity to owner')} ${e.recognitionConfidence.toFixed(2)}` : ''})</div>
              <div><span className="muted">{L('Magaca is-sheegay:', 'Self-reported name:')}</span> <b>{e.selfReportedName ?? '—'}</b> <span className="tag warn">{L('aan la xaqiijin', 'unverified')}</span></div>
              <div><span className="muted">{L('Ogeysiiska la sheegay:', 'Notice spoken:')}</span> {e.noticeSpokenAt ? new Date(e.noticeSpokenAt).toLocaleTimeString() : L('maya', 'no')} {e.disclosures.length ? `(+ ${e.disclosures.join(', ')})` : ''}</div>
              {e.transcript && <div className="okbox">“{e.transcript}”</div>}
              {e.markedKnownAs && <div>🏷 {L('La calaamadeeyay:', 'Labelled:')} <b>{e.markedKnownAs}</b> <span className="muted">({L('aqoonsi mustaqbal u baahan hoosgal wajiga gooni ah', 'future recognition needs a separate face enrollment')})</span></div>}
              {e.ownerNote && <div>📝 {e.ownerNote}</div>}
              {ses.filter((s) => Math.abs(s.at - e.at) < 10 * 60_000).map((s) => (
                <div key={s.id} className="muted">🪟 Windows: {s.kind} {new Date(s.at).toLocaleTimeString()} ({s.source})</div>
              ))}
            </div>
            <div className="col">
              {e.snapshotId && (
                imgs[e.id] ? <img className="snap" src={imgs[e.id]!} alt="visitor snapshot" /> : <button className="btn sm" onClick={async () => setImgs({ ...imgs, [e.id]: await call('visitors.snapshot', e.id) })}>{L('Tus sawirka la sheegay', 'Show the disclosed snapshot')}</button>
              )}
              <div className="row">
                <button className="btn sm" onClick={() => { const n = prompt(L('Qoraal ku dar', 'Add a note'), e.ownerNote ?? ''); if (n !== null) void call('visitors.note', { id: e.id, note: n }).then(load); }}>📝 {L('Qoraal', 'Note')}</button>
                <button className="btn sm" onClick={() => { const n = prompt(L('Magaca qofka la yaqaan', 'Name of the known person'), e.markedKnownAs ?? e.selfReportedName ?? ''); if (n) void call('visitors.markKnown', { id: e.id, label: n }).then(load); }}>🏷 {L('U calaamadee la yaqaan', 'Mark as known')}</button>
                {e.markedKnownAs && <button className="btn sm" onClick={() => setEnrolling(e.markedKnownAs)}>👤 {L('Diiwaangeli wajigooda (jooga)', 'Enroll their face (must be present)')}</button>}
                <button className="btn sm danger" onClick={() => void call('visitors.delete', e.id).then(load)}>{t('delete')}</button>
              </div>
              {!e.reported && <span className="tag warn">{L('Wali lama sheegin', 'Not reported yet')}</span>}
            </div>
          </div>
        </Card>
      ))}
      <Card title={L('Dhacdooyinka Windows (gooni ah)', 'Windows session events (separate)')}>
        <table>
          <thead><tr><th>{L('Waqti', 'Time')}</th><th>{L('Nooc', 'Kind')}</th><th>{L('Isha', 'Source')}</th><th /></tr></thead>
          <tbody>{ses.slice(0, 60).map((s) => <tr key={s.id}><td className="small">{fmtTime(s.at)}</td><td>{s.kind}</td><td className="small">{s.source}</td><td className="small muted">{s.detail}</td></tr>)}</tbody>
        </table>
        <p className="small muted">{L('Isha “power-monitor” waxay shaqeysaa marka Afuufow socoto. Diiwaanka Amniga ee Windows (event-log) wuxuu u baahan yahay xuquuq sare, markaa badanaa lama heli karo.', 'The “power-monitor” source works while Afuufow runs. The Windows Security event log needs elevated rights, so it is usually unavailable.')}</p>
      </Card>
    </div>
  );
}
