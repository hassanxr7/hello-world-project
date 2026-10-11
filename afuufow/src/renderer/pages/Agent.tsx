import { useEffect, useState } from 'react';
import type { AgentStatusInfo } from '../../shared/ipc';
import { Bar, Card, Check, Field } from '../components/ui';
import { useL } from '../i18n';
import { call, patchSettings, useUi } from '../store';
import { SecretInput } from './Integrations';

const MODEL_HINTS = { anthropic: ['claude-sonnet-5-5', 'claude-haiku-5-5'], openai: ['gpt-4.1-mini', 'gpt-4.1'] } as const;

export function Agent() {
  const L = useL();
  const snap = useUi((s) => s.snap)!;
  const dl = useUi((s) => s.downloads['interpreter']);
  const a = snap.settings.agent;
  const [st, setSt] = useState<AgentStatusInfo | null>(null);
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => void call('agent.status').then(setSt);
  useEffect(refresh, [snap.settings.agent.provider, snap.settings.privacy.allowCloudLlm, snap.secretsPresent.join(','), dl?.done]);

  const installing = !!dl && !dl.done;
  const ready = !!st && st.installed && st.hasKey && st.cloudAllowed;
  const keyName = a.provider === 'anthropic' ? 'anthropic.key' : 'openai.key';

  return (
    <div className="col" style={{ gap: 14, maxWidth: 900 }}>
      <h2 style={{ margin: 0 }}>{L('Wakiilka hawlaha (Open Interpreter)', 'Task agent (Open Interpreter)')}</h2>
      <div className="okbox small">
        {L(
          'Wakiilku wuxuu qabtaa hawlo adag: kala saarista faylasha, magac-bedelka badan, qorista iyo fulinta amarro, iyo raadinta webka. Waxaad ku bilaabaysaa: “wakiilka: kala saar faylasha Downloads nooc ahaan”. Amar kasta oo uu rabo inuu fuliyo, waan ku weydiinayaa marka hore.',
          'The agent handles bigger jobs: sorting files, bulk renames, writing and running commands, web research. Start it with: “agent: sort my Downloads by type”. Every command it wants to run is shown to you for approval first.',
        )}
      </div>

      <Card title={L('1. Engine-ka', '1. Engine')}>
        <div className="col small">
          {st && !st.supported && <div className="warnbox">{L('Nidaamkan Open Interpreter ma taageero.', 'Open Interpreter has no release for this system.')}</div>}
          <div className="row">
            {st?.installed ? <span className="tag ok">{L('Rakiban', 'Installed')} v{st.version}</span> : <span className="tag">{L('Lama rakibin', 'Not installed')}</span>}
            <span className="muted">{L(`Nooca la hubiyay: v${st?.pinnedVersion ?? ''} · ${st?.sizeMb ?? 0} MB`, `Pinned version: v${st?.pinnedVersion ?? ''} · ${st?.sizeMb ?? 0} MB`)}</span>
          </div>
          {installing && <Bar value={dl!.total > 0 ? dl!.received / dl!.total : 0} />}
          {dl?.error && <div className="warnbox">{dl.error}</div>}
          <div className="row">
            {!st?.installed && <button className="btn primary" disabled={installing || !st?.supported} onClick={() => void call('agent.install')}>{installing ? '…' : L('Soo deji oo rakib', 'Download and install')}</button>}
            {installing && <button className="btn" onClick={() => void call('agent.cancelInstall')}>{L('Jooji', 'Cancel')}</button>}
            {st?.installed && <button className="btn danger" onClick={() => void call('agent.remove').then(refresh)}>{L('Ka saar', 'Remove')}</button>}
          </div>
          <div className="muted">{L('Waxaa laga soo dejiyaa GitHub Releases rasmiga ah; waxaa la hubiyaa SHA-256 la dhejiyay. Licence: Apache-2.0.', 'Downloaded from the official GitHub release and checked against a pinned SHA-256. Licence: Apache-2.0.')}</div>
        </div>
      </Card>

      <Card title={L('2. Moodelka AI (cloud)', '2. AI model (cloud)')}>
        <div className="col">
          <div className="grid g2">
            <Field label={L('Bixiyaha', 'Provider')}>
              <select value={a.provider} onChange={(e) => void patchSettings({ agent: { provider: e.target.value, model: MODEL_HINTS[e.target.value as 'anthropic' | 'openai'][0] } })}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI</option>
              </select>
            </Field>
            <Field label={L('Moodel', 'Model')}>
              <input type="text" list="agent-models" value={a.model} onChange={(e) => void patchSettings({ agent: { model: e.target.value.trim() } })} />
              <datalist id="agent-models">{MODEL_HINTS[a.provider].map((m) => <option key={m} value={m} />)}</datalist>
            </Field>
          </div>
          <SecretInput name={keyName} label={a.provider === 'anthropic' ? 'Anthropic API key' : 'OpenAI API key'} />
          <Check checked={snap.settings.privacy.allowCloudLlm} onChange={(v) => void patchSettings({ privacy: { allowCloudLlm: v } })}>
            {L('Oggolow cloud AI (codsigaaga iyo natiijooyinka amarrada waxaa loo diraa bixiyaha)', 'Allow cloud AI (your request and command output are sent to the provider)')}
          </Check>
          <div className="small muted">{L('Furahan wuxuu ka duwan yahay akoonka claude.ai/chatgpt; waxaa lagu bixiyaa API-ga (hoos eeg kharashka).', 'This key is separate from a claude.ai / ChatGPT subscription; the API is billed per use (see costs in docs/INTERPRETER.md).')}</div>
        </div>
      </Card>

      <Card title={L('3. Ammaan iyo xad', '3. Safety and limits')}>
        <div className="col">
          <Check checked={a.enabled} disabled={!ready && !a.enabled} onChange={(v) => void patchSettings({ agent: { enabled: v } })}>
            {L('Fur wakiilka', 'Turn the agent on')} {!ready && <span className="muted">({L('marka hore dhammaystir 1 iyo 2', 'finish steps 1 and 2 first')})</span>}
          </Check>
          <Field label={L('Galka shaqada (workspace)', 'Work folder (workspace)')}>
            <input type="text" value={a.workDir} placeholder={st?.workDir} onChange={(e) => void patchSettings({ agent: { workDir: e.target.value } })} />
          </Field>
          <div className="grid g2">
            <Field label={L('Ugu badnaan (daqiiqo)', 'Max minutes per task')}><input type="number" min={1} max={60} value={a.maxMinutes} onChange={(e) => void patchSettings({ agent: { maxMinutes: Number(e.target.value) } })} /></Field>
            <Field label={L('Ugu badnaan weydiimo oggolaansho', 'Max approval questions per task')}><input type="number" min={1} max={100} value={a.maxApprovals} onChange={(e) => void patchSettings({ agent: { maxApprovals: Number(e.target.value) } })} /></Field>
          </div>
          <Check checked={a.webSearch} onChange={(v) => void patchSettings({ agent: { webSearch: v } })}>{L('Oggolow raadinta webka (waxay kordhisaa halista “prompt injection”; tallaabooyinka ka dambeeya way adkaadaan)', 'Allow web search (raises prompt-injection risk; later steps then need strong verification)')}</Check>
          <Check checked={a.browser} onChange={(v) => void patchSettings({ agent: { browser: v } })}>{L('Browser (Playwright; wuxuu u baahan yahay Node.js) — tijaabo, weli lama xaqiijin', 'Browser (Playwright; needs Node.js) — experimental, not yet verified on Windows')}</Check>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{L('Amar kasta waan ku weydiinayaa; kaliya akhris fudud (liis faylasha galalka la oggolaaday) ayaa si toos ah u socda.', 'Every command is asked first; only plain read-only listings inside approved folders run without a question.')}</li>
            <li>{L('Tirtirid, fariin diris, lacag-bixin, rakibid, beddelka nidaamka, iyo xogta gaarka ah: waxay u baahan yihiin Windows Hello ama PIN-kaaga marka lagu daro “haa”.', 'Deleting, messaging, payments, installs, system changes and private data need Windows Hello or your PIN, plus a yes.')}</li>
            <li>{L('Amarro aad u halis badan (formatka disk-ga, tirtirka nidaamka) si buuxda ayaa loo didiyaa.', 'Catastrophic commands (formatting disks, wiping the system) are refused outright.')}</li>
            <li>{L('Waxa uu wakiilku sheego waa “warbixintiisa”, ma aha wax Afuufow xaqiijisay.', 'What the agent says is its own report, not something Afuufow verified.')}</li>
          </ul>
        </div>
      </Card>

      <Card title={L('4. Tijaabo', '4. Test')}>
        <div className="row">
          <button className="btn" disabled={busy || !ready} onClick={() => { setBusy(true); setTest(null); void call('agent.test').then(setTest).finally(() => setBusy(false)); }}>{busy ? '…' : L('Tijaabi wakiilka (kharash yar)', 'Test the agent (costs a few tokens)')}</button>
          {test && <span className={`tag ${test.ok ? 'ok' : 'err'}`}>{test.ok ? 'OK' : 'FAIL'}</span>}
          {test && <span className="small muted">{test.detail}</span>}
        </div>
      </Card>
    </div>
  );
}
