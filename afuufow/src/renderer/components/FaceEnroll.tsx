import { useEffect, useState } from 'react';
import { useL } from '../i18n';
import { call, useUi } from '../store';
import { Bar } from './ui';

export function FaceStep({ label, onFinished }: { label?: string; onFinished?: () => void }) {
  const L = useL();
  const snap = useUi((s) => s.snap)!;
  const e = useUi((s) => s.enroll);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ matchThreshold: number; unknownCeiling: number } | null>(null);
  useEffect(() => {
    return () => {
      if (running) void call('face.enrollCancel');
    };
  }, [running]);
  const prog = e?.kind === 'face' ? e : null;
  return (
    <div className="col">
      <p className="muted">{L('Kamaradda waxaa loo isticmaalaa oo kaliya in lagu aqoonsado joogitaankaaga iyo in lagu salaamo. Sawirrada lama kaydiyo; tirooyin sir ah oo kaliya ayaa la kaydiyaa. Waa ikhtiyaari.', 'The camera is only used to recognise your presence and greet you. No images are saved; only encrypted numeric templates. This is optional.')}</p>
      {snap.faceEnrolled && !running && <div className="okbox">{L(`Wajigaaga waa la diiwaangeliyay (${snap.faceSamples} muunad).`, `Your face is enrolled (${snap.faceSamples} samples).`)} {done && <span className="small">({L('xadka', 'threshold')} {done.matchThreshold}/{done.unknownCeiling})</span>}</div>}
      {!running ? (
        <div className="row">
          <button className="btn primary" onClick={() => void call('face.enrollStart', label).then(() => setRunning(true))}>{snap.faceEnrolled ? L('Dib u diiwaangeli', 'Re-enroll') : L('Bilow diiwaangelinta wajiga', 'Start face enrollment')}</button>
          {snap.faceEnrolled && <button className="btn danger" onClick={() => void call('face.delete')}>{L('Tirtir', 'Delete')}</button>}
        </div>
      ) : (
        <div className="col">
          <div className="warnbox small">{L('Kamaraddu hadda waa shaqeynaysaa. Hal qof oo kaliya (adiga) ha ku jiro muuqaalka.', 'The camera is on now. Only one person (you) should be in view.')}</div>
          {prog ? (
            <>
              <Bar value={prog.progress.total / prog.progress.target} />
              <div><b>{prog.progress.total}/{prog.progress.target}</b> — {L(prog.progress.hintSo, prog.progress.hintEn)}</div>
              <div className="small muted">{L('Iftiin:', 'Light:')} {prog.luminance !== undefined ? Math.round(prog.luminance * 100) + '%' : '—'} · {prog.faceVisible ? L('wajiga waa la arkay', 'face detected') : L('wajiga lama arko', 'no face detected')} · {L('wejiyada:', 'poses:')} {JSON.stringify(prog.progress.pose)} · {L('iftiinka:', 'lighting:')} {JSON.stringify(prog.progress.lighting)}</div>
              {prog.lastRejected && <div className="warnbox small">{L(prog.lastRejected.so, prog.lastRejected.en)}</div>}
            </>
          ) : <div className="muted">{L('Waa la diyaarinayaa… (moodelka wajiga ayaa la soo qaadayaa)', 'Preparing… (loading the face model)')}</div>}
          <div className="row">
            <button className="btn primary" disabled={!prog?.progress.complete} onClick={() => void call('face.enrollFinish').then((r) => { setDone(r); setRunning(false); onFinished?.(); })}>{L('Dhammee', 'Finish')}</button>
            <button className="btn" onClick={() => void call('face.enrollCancel').then(() => setRunning(false))}>{L('Jooji', 'Cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

