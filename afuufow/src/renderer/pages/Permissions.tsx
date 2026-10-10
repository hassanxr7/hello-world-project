import { useEffect, useState } from 'react';
import type { Contact, PermissionGrant } from '../../shared/types';
import { Card, Check, Field, fmtTime } from '../components/ui';
import { useL, useT } from '../i18n';
import { call, notify, patchSettings, useUi } from '../store';

export function PinSetter() {
  const L = useL();
  const snap = useUi((s) => s.snap)!;
  const [pin, setPin] = useState('');
  return (
    <Field label={L('PIN-ka milkiilaha (4–12 lambar)', 'Owner PIN (4–12 digits)')} hint={L('Waxaa loo isticmaalaa ficillada xasaasiga ah (tirtirid, rakibaad, wadaagid). Waxaa lagu kaydiyaa hash ahaan.', 'Used for sensitive actions (deleting, installing, sharing). Stored only as a salted hash.')}>
      <div className="row">
        <input type="password" inputMode="numeric" value={pin} placeholder={snap.pinSet ? '•••• ' + L('(la dejiyay)', '(set)') : ''} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        <button className="btn sm primary" disabled={pin.length < 4} onClick={() => void call('auth.setPin', pin).then(() => { setPin(''); notify('info', 'PIN waa la dejiyay.', 'PIN set.'); })}>{snap.pinSet ? L('Beddel', 'Change') : L('Deji', 'Set')}</button>
      </div>
    </Field>
  );
}

export function Permissions() {
  const L = useL();
  const t = useT();
  const snap = useUi((s) => s.snap)!;
  const s = snap.settings;
  const [grants, setGrants] = useState<PermissionGrant[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [folder, setFolder] = useState({ label: '', path: '' });
  const [app, setApp] = useState('');
  const load = async () => {
    setGrants(await call('grants.list'));
    setContacts(await call('contacts.list'));
  };
  useEffect(() => {
    void load();
  }, []);
  const perm = s.permissions;
  return (
    <div className="col">
      <h1>{t('nav.permissions')}</h1>
      <div className="grid g2">
        <Card title={L('Barnaamijyada', 'Applications')}>
          <div className="col">
            <Field label={L('Maxaan furi karaa?', 'What may I open?')}>
              <select value={perm.appPolicy} onChange={(e) => void patchSettings({ permissions: { appPolicy: e.target.value } })}>
                <option value="any">{L('Barnaamij kasta oo la rakibay (degdeg)', 'Any installed application (prompt)')}</option>
                <option value="allowlist">{L('Kuwa liiska ku jira oo kaliya', 'Only the approved list')}</option>
              </select>
            </Field>
            {perm.appPolicy === 'allowlist' && (
              <>
                <div className="row">{perm.approvedApps.map((a) => <span key={a} className="pill">{a} <a href="#" onClick={(e) => { e.preventDefault(); void patchSettings({ permissions: { approvedApps: perm.approvedApps.filter((x) => x !== a) } }); }}>✕</a></span>)}</div>
                <div className="row"><input type="text" placeholder="Chrome" value={app} onChange={(e) => setApp(e.target.value)} /><button className="btn sm" onClick={() => { if (app.trim()) { void patchSettings({ permissions: { approvedApps: [...perm.approvedApps, app.trim()] } }); setApp(''); } }}>{t('add')}</button></div>
              </>
            )}
            <div className="small muted">{L('Furista barnaamijyada iyo ciyaarista muuqaalada waa “caadi”: isla markiiba ayay dhacaan.', 'Opening apps and playing media is “routine”: it runs immediately.')}</div>
          </div>
        </Card>
        <Card title={L('Goobaha fayllada la oggolaaday', 'Approved file locations')}>
          <div className="col">
            {perm.approvedFolders.map((f) => (
              <div key={f.path} className="row"><b>{f.label}</b><span className="mono muted">{f.path}</span><span className="spacer" /><button className="btn sm danger" onClick={() => void patchSettings({ permissions: { approvedFolders: perm.approvedFolders.filter((x) => x.path !== f.path) } })}>{t('delete')}</button></div>
            ))}
            <div className="grid g2">
              <input type="text" placeholder={L('Calaamad (Downloads)', 'Label (Downloads)')} value={folder.label} onChange={(e) => setFolder({ ...folder, label: e.target.value })} />
              <input type="text" placeholder="C:\Users\You\Downloads" value={folder.path} onChange={(e) => setFolder({ ...folder, path: e.target.value })} />
            </div>
            <button className="btn sm" onClick={() => { if (folder.label && /^[A-Za-z]:\\/.test(folder.path)) { void patchSettings({ permissions: { approvedFolders: [...perm.approvedFolders.filter((x) => x.path !== folder.path), { label: folder.label, path: folder.path }] } }); setFolder({ label: '', path: '' }); } else notify('warn', 'Geli jid buuxa (C:\\…).', 'Enter a full path (C:\\…).'); }}>{t('add')}</button>
            <div className="small muted">{L('Raadinta fayllada iyo furista waxay shaqeysaa kaliya goobahan gudahooda. Faylasha la fuliyo (exe, bat…) lama furo.', 'File search and opening only work inside these locations. Executable files (exe, bat…) are never opened.')}</div>
          </div>
        </Card>
        <Card title={L('Fariimaha', 'Messaging')}>
          <div className="col">
            <Field label={L('Habka diridda', 'Sending mode')}>
              <select value={perm.messaging.mode} onChange={(e) => void patchSettings({ permissions: { messaging: { mode: e.target.value } } })}>
                <option value="explicit">{L('Si cad: “u dir” ayaa diraya; “u qor” wuu ku weydiiyaa', 'Explicit: “u dir” sends; “u qor” asks once')}</option>
                <option value="fast">{L('Degdeg: xiriirrada fast-send waxay u diraan “u qor” isla markiiba', 'Fast: fast-send contacts send immediately on “u qor”')}</option>
              </select>
            </Field>
            <Check checked={perm.messaging.requirePresenceToSend} onChange={(v) => void patchSettings({ permissions: { messaging: { requirePresenceToSend: v } } })}>{L('Dir kaliya marka kamaraddu aqoonsato (marka kamaradda/codka la isticmaalayo)', 'Send only when the camera recognises me (when camera/voice ID is used)')}</Check>
            <h3>{L('Xiriirrada degdeg-dirka', 'Fast-send contacts')}</h3>
            {contacts.filter((c) => c.approved).map((c) => (
              <Check key={c.id} checked={c.fastSend} onChange={(v) => void call('grants.setFastSend', { contactId: c.id, on: v }).then(load)}>{c.displayName}</Check>
            ))}
            {contacts.filter((c) => c.approved).length === 0 && <div className="muted small">{L('Xiriir la oggolaaday ma jiro (Milkiilaha & Xusuusta).', 'No approved contacts yet (Owner & Memory).')}</div>}
          </div>
        </Card>
        <Card title={L('Xaqiijinta xooggan', 'Strong authentication')}>
          <div className="col">
            <PinSetter />
            <Field label={L('Habka', 'Method')}>
              <select value={perm.strongAuth.method} onChange={(e) => void patchSettings({ permissions: { strongAuth: { method: e.target.value } } })}>
                <option value="pin">PIN ({L('lagu talinayo', 'recommended')})</option>
                <option value="either">PIN + Windows Hello ({L('tijaabo', 'experimental')})</option>
                <option value="hello">Windows Hello ({L('tijaabo', 'experimental')})</option>
              </select>
            </Field>
            <div className="small muted">{L('Tirtirid fayl, rakibid software, wadaagid macluumaad xasaasi ah waxay u baahan yihiin PIN/Hello iyo “haa” cad. Lacag bixin, beddelidda amniga Windows iyo amar shell-ka ah waa MAMNUUC: Afuufow ma fulin karto.', 'Deleting files, installing software and sharing sensitive info require PIN/Hello plus an explicit “yes”. Payments, changing Windows security and arbitrary shell commands are FORBIDDEN: Afuufow cannot do them.')}</div>
          </div>
        </Card>
      </div>
      <Card title={L('Ogolaanshaha joogtada ah', 'Standing permissions')} right={<button className="btn sm danger" onClick={() => void call('grants.revokeAll').then(load)}>{L('Jooji dhammaan', 'Revoke all')}</button>}>
        <table>
          <thead><tr><th>{L('Ogolaansho', 'Permission')}</th><th>{L('La bilaabay', 'Created')}</th><th /></tr></thead>
          <tbody>
            {grants.map((g) => (<tr key={g.id}><td className="mono">{g.key}<div className="small muted">{g.note}</div></td><td className="small">{fmtTime(g.createdAt)}</td><td><button className="btn sm danger" onClick={() => void call('grants.revoke', g.id).then(load)}>{L('Jooji', 'Revoke')}</button></td></tr>))}
          </tbody>
        </table>
        {grants.length === 0 && <div className="muted">{L('Ogolaansho joogto ah ma jiro.', 'No standing permissions.')}</div>}
      </Card>
      <Card title={L('Booqdayaasha & aqoonsiga', 'Visitors & recognition')}>
        <div className="grid g2">
          <div className="col">
            <Check checked={s.visitors.enabled} onChange={(v) => void patchSettings({ visitors: { enabled: v } })}>{L('Weydii qof aan la aqoonsan (wuxuu u baahan yahay kamarad + maykarafoon + isbeekar)', 'Question unrecognised people (needs camera + microphone + speaker)')}</Check>
            <Field label={L('Sawirka booqdaha', 'Visitor snapshot')}>
              <select value={s.visitors.snapshot} onChange={(e) => void patchSettings({ visitors: { snapshot: e.target.value } })}>
                <option value="off">{L('Ha kaydin', 'Never save')}</option>
                <option value="disclosed">{L('Hal sawir, kadib ogeysiis cad', 'One still frame, after a spoken notice')}</option>
              </select>
            </Field>
            <Check checked={s.visitors.saveAudio} onChange={(v) => void patchSettings({ visitors: { saveAudio: v } })}>{L('Kaydi jawaabta codka (ogeysiis cad ayaa la sheegayaa)', 'Save the audio of their reply (a spoken notice is added)')}</Check>
            <Field label={L('Joojinta dib-u-weydiinta (daqiiqo)', 'Do not re-question for (minutes)')}><input type="number" min={1} value={s.visitors.cooldownMin} onChange={(e) => void patchSettings({ visitors: { cooldownMin: Number(e.target.value) } })} /></Field>
          </div>
          <div className="col">
            <Field label={L('Xadka aqoonsiga wajiga (≥ waa Boss)', 'Face match threshold (≥ = owner)')} hint={L('Waxaa si toos ah loo soo jeediyay marka la diiwaangelinayo. Marka u dhexeysa labada xad = “ma hubo”.', 'Suggested automatically at enrollment. Between the two limits = “uncertain”.')}><input type="number" step={0.01} min={0.3} max={0.95} value={s.camera.matchThreshold} onChange={(e) => void patchSettings({ camera: { matchThreshold: Number(e.target.value) } })} /></Field>
            <Field label={L('Xadka “qof kale” (≤)', '“Someone else” limit (≤)')}><input type="number" step={0.01} min={0.1} max={0.9} value={s.camera.unknownCeiling} onChange={(e) => void patchSettings({ camera: { unknownCeiling: Number(e.target.value) } })} /></Field>
            <Check checked={s.camera.requireLiveness} onChange={(v) => void patchSettings({ camera: { requireLiveness: v } })}>{L('Ku dar hubinta sawirka (anti-spoof). Ma joojin karto muuqaal duubay.', 'Anti-photo check (liveness). Does not stop a replayed video.')}</Check>
            <Field label={L('Joojinta salaanta (daqiiqo)', 'Greeting cooldown (minutes)')}><input type="number" min={1} value={s.camera.greetingCooldownMin} onChange={(e) => void patchSettings({ camera: { greetingCooldownMin: Number(e.target.value) } })} /></Field>
            <Field label={L('Waqtiga ka bixitaanka (ilbiriqsi)', 'Leave detection (seconds)')}><input type="number" min={5} value={s.camera.leaveAfterSec} onChange={(e) => void patchSettings({ camera: { leaveAfterSec: Number(e.target.value) } })} /></Field>
          </div>
        </div>
      </Card>
    </div>
  );
}
