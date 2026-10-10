import { useState } from 'react';
import { Card, fmtTime } from '../components/ui';
import { useL, useT } from '../i18n';
import { call, useUi } from '../store';

const tone = (s: string) => (s === 'verified' ? 'ok' : s === 'unverified' ? 'warn' : s === 'running' ? 'warn' : 'err');

export function History() {
  const L = useL();
  const t = useT();
  const turns = useUi((s) => s.turns);
  const actions = useUi((s) => s.actions);
  const [tab, setTab] = useState<'chat' | 'actions'>('actions');
  const download = (name: string, data: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = name;
    a.click();
  };
  return (
    <div className="col">
      <h1>{t('nav.history')}</h1>
      <div className="row">
        <button className={`btn ${tab === 'actions' ? 'primary' : ''}`} onClick={() => setTab('actions')}>{L('Ficillada la fuliyay', 'Executed actions')}</button>
        <button className={`btn ${tab === 'chat' ? 'primary' : ''}`} onClick={() => setTab('chat')}>{L('Wada-hadalka', 'Conversation')}</button>
      </div>
      {tab === 'actions' ? (
        <Card
          title={L('Diiwaanka ficillada', 'Action log')}
          right={
            <div className="row">
              <button className="btn sm" onClick={async () => download('afuufow-actions.json', await call('actions.export'))}>{t('export')}</button>
              <button className="btn sm danger" onClick={() => confirm(L('Ma tirtirtaa diiwaanka?', 'Clear the action log?')) && void call('actions.clear').then(() => location.reload())}>{L('Nadiifi', 'Clear')}</button>
            </div>
          }
        >
          <p className="muted small">{L('“Xaqiijiyay” macnaheedu waa in natiijada la arkay. “Aan la xaqiijin” macnaheedu waa in amarka la diray laakiin natiijada lama arki karin.', '“verified” means the outcome was observed. “unverified” means the command was sent but the result could not be observed.')}</p>
          <table>
            <thead><tr><th>{L('Waqti', 'Time')}</th><th>{L('Qalab', 'Tool')}</th><th>{L('Faahfaahin', 'What')}</th><th>{L('Natiijo', 'Result')}</th><th>{L('Sida loo oggolaaday', 'Authorised by')}</th></tr></thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}>
                  <td className="small">{fmtTime(a.at)}</td>
                  <td className="mono">{a.tool}</td>
                  <td>{a.summary}<div className="small muted">{a.message}</div></td>
                  <td><span className={`tag ${tone(a.status)}`}>{a.status}</span><div className="small muted">{a.verification}</div></td>
                  <td className="small">{a.decidedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {actions.length === 0 && <div className="muted">{L('Wax ficil ah lama fulin weli.', 'No actions yet.')}</div>}
        </Card>
      ) : (
        <Card title={L('Wada-hadalka la kaydiyay', 'Stored conversation')} right={<button className="btn sm danger" onClick={() => confirm(L('Ma tirtirtaa taariikhda?', 'Clear conversation history?')) && void call('history.clear').then(() => location.reload())}>{L('Nadiifi', 'Clear')}</button>}>
          <div className="col">
            {turns.map((m) => (
              <div key={m.id}><span className="muted small">{fmtTime(m.at)} · {m.role}{m.source === 'voice' ? ' 🎙' : ''}</span><div>{m.text}</div></div>
            ))}
            {turns.length === 0 && <div className="muted">{L('Taariikh ma jirto (ama muddada kaydinta waa 0).', 'No history (or retention is set to 0 days).')}</div>}
          </div>
        </Card>
      )}
    </div>
  );
}
