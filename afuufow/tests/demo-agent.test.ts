/**
 * Demo: the WHOLE Afuufow assistant (parser -> permissions -> approvals -> tool) driving the REAL Open Interpreter
 * engine over ACP. The only scripted part is the AI model's replies (so the demo is deterministic and free); the engine,
 * the approval questions and the file changes are real. Run:  AFU_DEMO=1 npx vitest run tests/demo-agent.test.ts
 * It writes docs/DEMO_AGENT_TRANSCRIPT.md.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/core/config/settings';
import { EngineManager, OpenInterpreterRunner } from '../src/main/interpreter/engine';
import { makeRig } from './helpers';

const RUN = process.env.AFU_DEMO === '1';
const tick = (ms = 400) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN)('demo: Afuufow + Open Interpreter', () => {
  let tmp: string;
  let server: http.Server;
  let port = 0;
  let script: Array<{ tool: string } | { text: string }> = [];

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afu-demo-'));
    server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        const r = script.shift() ?? { text: 'Waa dhammaaday.' };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (delta: object, fin: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`);
        if ('tool' in r) {
          chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + Math.random().toString(36).slice(2), type: 'function', function: { name: 'exec_command', arguments: JSON.stringify({ cmd: r.tool, yield_time_ms: 3000 }) } }] });
          chunk({}, 'tool_calls');
        } else {
          chunk({ role: 'assistant', content: r.text });
          chunk({}, 'stop');
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => { port = (server.address() as any).port; r(); }));
  }, 30_000);
  afterAll(() => { server?.close(); });

  it('runs the scenario and writes the transcript', async () => {
    const mgr = new EngineManager(path.join(tmp, 'interpreter'));
    await mgr.install(() => undefined);
    const work = path.join(tmp, 'Afuufow Workspace');
    fs.mkdirSync(path.join(work, 'Archive'), { recursive: true });
    fs.writeFileSync(path.join(work, 'invoice.pdf'), 'pdf');
    fs.writeFileSync(path.join(work, 'duugan.tmp'), 'old');
    fs.writeFileSync(path.join(work, 'warbixin.txt'), 'report');

    const settings0 = defaultSettings();
    settings0.agent.enabled = true;
    settings0.agent.workDir = work;
    const runner = new OpenInterpreterRunner({
      mgr, settings: () => settings0, secret: () => undefined, documentsDir: () => tmp, ownerName: () => 'Hassan Mohamed Mohamud',
      log: { info: () => undefined, warn: () => undefined },
      customProvider: { id: 'mock', name: 'Scripted demo model', baseUrl: `http://127.0.0.1:${port}/v1`, envKey: 'MOCK_KEY', wireApi: 'chat', apiKey: 'k', model: 'demo-model' },
    });
    const r = await makeRig({ agent: runner, settings: (s) => { s.agent.enabled = true; s.agent.workDir = work; s.privacy.allowCloudLlm = true; s.permissions.approvedFolders = [{ label: 'workspace', path: work }]; } });
    r.assurance.ownerFaceSeen(r.clock.t);
    const q = (s: string) => `'${s}'`;
    const ls = fs.readdirSync(work).sort().join(', ');

    const lines: string[] = [];
    const say = (who: string, t: string) => lines.push(`**${who}:** ${t}\n`);
    const seen = new Set<string>();
    const flush = () => {
      for (const e of r.events) {
        if (e.type === 'turn' && !seen.has(e.turn.id)) {
          seen.add(e.turn.id);
          say(e.turn.role === 'owner' ? 'Hassan' : e.turn.role === 'assistant' ? 'Afuufow' : 'Afuufow (shaashadda)', e.turn.text);
        }
      }
    };
    const listing = () => fs.readdirSync(work).sort().join(', ') + ' | Archive: ' + (fs.readdirSync(path.join(work, 'Archive')).join(', ') || '(maran)');
    const step = async (title: string, owner: string, answers: string[], modelScript: typeof script, afterNote: () => string) => {
      lines.push(`\n### ${title}\n`);
      lines.push('Faylasha ka hor: `' + listing() + '`\n');
      script = modelScript;
      const spokenFrom = r.speech.spoken.length;
      const done = r.a.handle(owner, { source: 'voice', speaker: 'owner' });
      flush();
      for (const a of answers) {
        await tick();
        flush();
        await r.a.handle(a, { source: 'voice', speaker: 'owner' });
      }
      await done;
      flush();
      lines.push('Codka Afuufow (TTS):\n' + r.speech.spoken.slice(spokenFrom).map((t) => '> 🔊 ' + t).join('\n') + '\n');
      lines.push('Faylasha kadib: `' + listing() + '`\n');
      lines.push('_' + afterNote() + '_\n');
    };
    void ls;

    lines.push('# Demo: Afuufow + Open Interpreter (engine dhab ah, moodel la qoray)\n');
    lines.push('> Xaqiiqo: **engine-ka Open Interpreter, ACP, weydiinta oggolaanshaha, iyo faylasha waa kuwo dhab ah.** Kaliya jawaabaha **moodelka AI waa la qoray** (scripted) si demo-gu u noqdo mid joogto ah oo bilaash ah. Moodel dhab ah (Claude/OpenAI) wuxuu go\'aamiyaa amarrada laftiisa; Afuufow oggolaanshaha ayuu weydiiyaa isla sidaas.\n');

    await step('1. Akhris fudud (su\'aal looma baahna)', 'Wakiilka: tus faylasha galka shaqada', [], [{ tool: `ls ${q(work)}` }, { text: 'Waxaa jira 3 fayl iyo galka Archive.' }], () => 'Liiska galka la oggolaaday waa akhris fudud, sidaas darteed si toos ah ayuu u socday.');
    await step('2. U guur fayl (oggolaansho: haa)', 'Wakiilka: u guur invoice.pdf galka Archive', ['haa'], [{ tool: `mv ${q(path.join(work, 'invoice.pdf'))} ${q(path.join(work, 'Archive', 'invoice.pdf'))}` }, { text: 'Waan u guuray invoice.pdf galka Archive.' }], () => 'Faylka dhab ahaan wuu guuray (eeg liiska kadib).');
    await step('3. Tirtirid (oggolaansho: maya)', 'Wakiilka: tirtir faylka duugan.tmp', ['maya'], [{ tool: `rm ${q(path.join(work, 'duugan.tmp'))}` }, { text: 'Ma tirtirin faylka sababtoo ah waad diidday.' }], () => 'Waxaa la weydiiyay TIRTIRID; jawaabta maya awgeed faylka wuu hadhay.');
    await step('4. Lacag-bixin (xaqiijin xooggan + maya)', 'Wakiilka: bixi biilka koronto', ['maya'], [{ tool: `echo checkout > ${q(path.join(work, 'paid.txt'))}` }, { text: 'Ma bixin lacagta.' }], () => 'Amarka lacag-bixinta wuxuu u baahday Windows Hello/PIN (xaqiijin xooggan) iyo "haa"; waa la diiday, wax lama fulin.');

    flush();
    const md = lines.join('\n');
    fs.writeFileSync(path.join(__dirname, '..', 'docs', 'DEMO_AGENT_TRANSCRIPT.md'), md);
    // the claims the transcript makes are checked against the real file system
    expect(fs.existsSync(path.join(work, 'Archive', 'invoice.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(work, 'invoice.pdf'))).toBe(false);
    expect(fs.existsSync(path.join(work, 'duugan.tmp'))).toBe(true);
    expect(fs.existsSync(path.join(work, 'paid.txt'))).toBe(false);
    expect(r.strongAuth.calls).toBe(1);
  }, 300_000);
});
