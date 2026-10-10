import { useEffect, useState } from 'react';
import type { MemoryFact } from '../../core/memory/memory';
import type { Contact } from '../../shared/types';
import { Card, Check, Field } from '../components/ui';
import { useL, useT } from '../i18n';
import { call, notify, useUi } from '../store';

export function Memory() {
  const L = useL();
  const t = useT();
  const snap = useUi((s) => s.snap)!;
  const [o, setO] = useState(snap.owner);
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [newFact, setNewFact] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [edit, setEdit] = useState<Partial<Contact> & { aliasText?: string }>({});
  const load = async () => {
    const m = await call('memory.get');
    setFacts(m.facts);
    setContacts(await call('contacts.list'));
  };
  useEffect(() => {
    void load();
  }, []);
  const saveContact = async () => {
    if (!edit.displayName || !edit.phone) return notify('warn', 'Magac iyo lambar ayaa loo baahan yahay.', 'Name and phone number are required.');
    await call('contacts.upsert', {
      id: edit.id,
      displayName: edit.displayName,
      aliases: (edit.aliasText ?? '').split(',').map((x) => x.trim()).filter(Boolean),
      phone: edit.phone,
      approved: !!edit.approved,
      fastSend: !!edit.approved && !!edit.fastSend,
    });
    setEdit({});
    await load();
  };
  return (
    <div className="col">
      <h1>{t('nav.memory')}</h1>
      <div className="grid g2">
        <Card title={L('Aqoonsiga Milkiilaha', 'Owner identity')}>
          <div className="col">
            <Field label={L('Magaca buuxa', 'Full name')}><input type="text" value={o.fullName} onChange={(e) => setO({ ...o, fullName: e.target.value })} /></Field>
            <Field label={L('Magaca salaanta (kadib “Mudane”)', 'Greeting name (after “Mudane”)')}><input type="text" value={o.greetingName} onChange={(e) => setO({ ...o, greetingName: e.target.value })} /></Field>
            <Field label={L('Naanaysta la door bidey', 'Preferred nickname')}><input type="text" value={o.nickname} onChange={(e) => setO({ ...o, nickname: e.target.value })} /></Field>
            <div className="small muted">{L('Salaanta:', 'Greeting:')} <b>“Mudane {o.greetingName}, {o.nickname}, waan taaganahay.”</b></div>
            <button className="btn primary" onClick={() => void call('profile.set', o).then(() => notify('info', 'La kaydiyay.', 'Saved.'))}>{t('save')}</button>
          </div>
        </Card>
        <Card title={L('Xusuusta la xaqiijiyay', 'Verified memory')} right={<span className="tag ok">{L('Boss kaliya', 'owner only')}</span>}>
          <p className="muted small">{L('Waxyaabaha halkan ku jira Boss ayaa sheegay/oggolaaday. Waxa ay sheegaan dadka kale (booqdayaasha) halkan lagu ma kaydiyo; waxay ku jiraan tab-ka Booqdayaal oo la calaamadeeyay “is-sheegay”.', 'Everything here was stated or approved by the owner. What other people say (visitors) is never stored here; it stays in the Visitors tab, marked “self-reported”.')}</p>
          <div className="col">
            {facts.filter((f) => f.trust === 'owner').map((f) => (
              <div key={f.id} className="row">
                <input type="text" defaultValue={f.text} onBlur={(e) => e.target.value !== f.text && void call('memory.correctFact', { id: f.id, text: e.target.value }).then(load)} />
                <button className="btn sm danger" onClick={() => void call('memory.deleteFact', f.id).then(load)}>{t('delete')}</button>
              </div>
            ))}
            <div className="row">
              <input type="text" placeholder={L('Xusuus cusub…', 'New memory…')} value={newFact} onChange={(e) => setNewFact(e.target.value)} />
              <button className="btn" onClick={() => newFact.trim() && void call('memory.addFact', newFact.trim()).then(() => { setNewFact(''); return load(); })}>{t('add')}</button>
            </div>
            <div className="row">
              <button className="btn sm" onClick={async () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([await call('memory.export')], { type: 'application/json' })); a.download = 'afuufow-memory.json'; a.click(); }}>{t('export')}</button>
              <button className="btn sm danger" onClick={() => confirm(L('Ma tirtirtaa XUSUUSTA oo dhan?', 'Delete ALL memory?')) && void call('memory.wipe').then(load)}>{L('Tirtir xusuusta oo dhan', 'Delete all memory')}</button>
            </div>
          </div>
        </Card>
      </div>
      <Card title={L('Xiriiriyaasha la oggolaaday & naanaysaha', 'Approved contacts & aliases')}>
        <p className="muted small">{L('Fariimaha waxaa lagu diri karaa oo kaliya xiriiriyaasha halkan ku jira oo la oggolaaday. Magacyada (Axmed/Ahmed) waa la isku tilmaamayaa, laakiin marka laba isku mid yihiin waan ku weydiinayaa.', 'Messages can only go to contacts listed here and approved. Spellings (Axmed/Ahmed) are matched, but if two match I ask you which one.')}</p>
        <table>
          <thead><tr><th>{L('Magac', 'Name')}</th><th>{L('Naanaysyo', 'Aliases')}</th><th>{L('Lambar', 'Phone')}</th><th>{L('La oggolaaday', 'Approved')}</th><th>{L('Dir degdeg', 'Fast-send')}</th><th /></tr></thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td>{c.displayName}</td><td className="small">{c.aliases.join(', ')}</td><td className="mono">+{c.phone}</td>
                <td>{c.approved ? <span className="tag ok">✔</span> : <span className="tag warn">—</span>}</td>
                <td>{c.fastSend ? <span className="tag warn">⚡</span> : '—'}</td>
                <td className="row"><button className="btn sm" onClick={() => setEdit({ ...c, aliasText: c.aliases.join(', ') })}>{t('edit')}</button><button className="btn sm danger" onClick={() => void call('contacts.delete', c.id).then(load)}>{t('delete')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>{edit.id ? L('Wax ka beddel xiriirka', 'Edit contact') : L('Xiriir cusub', 'New contact')}</h3>
        <div className="grid g3">
          <Field label={L('Magac', 'Name')}><input type="text" value={edit.displayName ?? ''} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} /></Field>
          <Field label={L('Naanaysyo (kala saar “,”)', 'Aliases (comma separated)')}><input type="text" value={edit.aliasText ?? ''} onChange={(e) => setEdit({ ...edit, aliasText: e.target.value })} /></Field>
          <Field label={L('Lambarka WhatsApp (tusaale 252611234567)', 'WhatsApp number (e.g. 252611234567)')}><input type="text" value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value.replace(/[^\d+ ]/g, '') })} /></Field>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <Check checked={!!edit.approved} onChange={(v) => setEdit({ ...edit, approved: v, fastSend: v ? edit.fastSend : false })}>{L('Fariimo ha loo diri karo', 'May receive messages')}</Check>
          <Check checked={!!edit.fastSend} disabled={!edit.approved} onChange={(v) => setEdit({ ...edit, fastSend: v })}>{L('Dir degdeg ah (“u qor” isla markiiba wuu diraa)', 'Fast-send (“u qor” sends immediately)')}</Check>
          <span className="spacer" />
          <button className="btn primary" onClick={() => void saveContact()}>{t('save')}</button>
          {edit.id && <button className="btn" onClick={() => setEdit({})}>{L('Jooji', 'Cancel')}</button>}
        </div>
        {edit.fastSend && <div className="warnbox small" style={{ marginTop: 8 }}>{L('Dir degdeg ah wuxuu shaqeynayaa kaliya haddii Ogolaansho → Fariimaha → “Degdeg” la doorto.', 'Fast-send only takes effect when Permissions → Messaging → “Fast” mode is selected.')}</div>}
      </Card>
    </div>
  );
}
