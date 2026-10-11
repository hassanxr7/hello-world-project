import { describe, expect, it } from 'vitest';
import type { AgentRunner } from '../src/core/agent/runner';
import type { AgentOutcome, AgentQuestion } from '../src/core/agent/session';
import { parseCommand } from '../src/core/nlu/parser';
import { makeRig } from './helpers';

const Q = (level: 'confirm' | 'strong', cmd = 'Remove-Item C:\\Users\\Hassan\\Downloads\\old.txt'): AgentQuestion => ({
  level, so: 'Wakiilku wuxuu rabaa inuu fuliyo amar: TIRTIRID. Ma oggol tahay?', en: 'The agent wants to run a command: DELETING files. Do you allow it?',
  detailSo: `Amarka: ${cmd}`, detailEn: `Command: ${cmd}`, categories: ['delete'],
});

class FakeAgent implements AgentRunner {
  answers: boolean[] = [];
  goals: string[] = [];
  waiting: Array<() => void> = [];
  constructor(private questions: AgentQuestion[], private text = 'Faylka duugan waa la tirtiray.') {}
  async status() { return { ready: true, detail: 'ok' }; }
  async run(goal: string, o: { signal: AbortSignal; onProgress: (m: string) => void; ask: (q: AgentQuestion, s: AbortSignal) => Promise<boolean> }): Promise<AgentOutcome> {
    this.goals.push(goal);
    const stats = { asked: 0, allowed: 0, denied: 0, autoAllowed: 0, commands: [] as string[] };
    for (const q of this.questions) {
      stats.asked++;
      const yes = await o.ask(q, o.signal);
      this.answers.push(yes);
      if (yes) { stats.allowed++; stats.commands.push(q.detailSo); } else stats.denied++;
    }
    return { status: 'completed', text: this.text, stats };
  }
}

const setup = async (agent: FakeAgent, patch?: (s: any) => void) => {
  const r = await makeRig({ agent, settings: (s) => { s.agent.enabled = true; s.privacy.allowCloudLlm = true; patch?.(s); } });
  r.assurance.ownerFaceSeen(r.clock.t); // the owner is in front of the camera
  return r;
};
const tick = () => new Promise((res) => setTimeout(res, 15));

describe('agent triggers', () => {
  it.each([
    ['wakiilka: kala saar faylasha Downloads', 'kala saar faylasha Downloads'],
    ['Afuufow, agent organise my downloads folder', 'organise my downloads folder'],
    ['open interpreter, rename all the photos', 'rename all the photos'],
    ['interpreter find large files', 'find large files'],
  ])('"%s" starts an agent task', (text, goal) => {
    const r = parseCommand(text);
    expect(r.intent).toEqual({ type: 'agent_task', goal });
  });
  it('a bare keyword or an ordinary command does not', () => {
    expect(parseCommand('agent').intent.type).not.toBe('agent_task');
    expect(parseCommand('Chrome fur').intent.type).toBe('open_app');
  });
});

describe('agent task through the assistant', () => {
  it('asks the owner about the command; a spoken yes lets it run; the result is the agent\'s report, not a verified fact', async () => {
    const agent = new FakeAgent([Q('confirm')]);
    const r = await setup(agent);
    const done = r.a.handle('wakiilka: tirtir faylka duugan', { source: 'text' });
    await tick();
    // the question and the exact command are visible while the agent waits
    expect(r.speech.spoken.join(' ')).toContain('Ma oggol tahay?');
    expect(r.events.some((e) => e.type === 'turn' && e.turn.text.includes('old.txt'))).toBe(true);
    expect(r.events.some((e) => e.type === 'pending')).toBe(true);
    await r.a.handle('haa', { source: 'text' });
    await done;
    expect(agent.answers).toEqual([true]);
    const spoken = r.speech.spoken.join(' ');
    expect(spoken).toContain('Wakiilku wuxuu sheegay');
    expect(spoken).toContain('1 oggolaaday');
    const rec = r.actionLog.list(5).find((x) => x.tool === 'agent.task');
    expect(rec?.status).toBe('unverified'); // the agent's own claim is never recorded as verified
  });
  it('"maya" refuses', async () => {
    const agent = new FakeAgent([Q('confirm')]);
    const r = await setup(agent);
    const done = r.a.handle('agent: delete the old file', { source: 'text' });
    await tick();
    await r.a.handle('maya', { source: 'text' });
    await done;
    expect(agent.answers).toEqual([false]);
  });
  it('an unclear reply is never permission; the question stays open', async () => {
    const agent = new FakeAgent([Q('confirm')]);
    const r = await setup(agent);
    const done = r.a.handle('agent: delete the old file', { source: 'text' });
    await tick();
    await r.a.handle('hmm waa hagaag laakiin ha fulin', { source: 'text' }); // contains a negation
    await tick();
    expect(agent.answers).toEqual([false]); // negation = no
    await done;
  });
  it('a different command while waiting does not queue behind the agent and is not permission', async () => {
    const agent = new FakeAgent([Q('confirm')]);
    const r = await setup(agent);
    const done = r.a.handle('agent: delete the old file', { source: 'text' });
    await tick();
    await r.a.handle('Chrome fur', { source: 'text' });
    await tick();
    expect(agent.answers).toEqual([]); // still waiting
    expect(r.platform.opened).toEqual([]); // the unrelated command did not run behind the agent
    await r.a.handle('maya', { source: 'text' });
    await done;
    expect(agent.answers).toEqual([false]);
  });
  it('"jooji" refuses the pending question and stops the task', async () => {
    const agent = new FakeAgent([Q('confirm'), Q('confirm')]);
    const r = await setup(agent);
    const done = r.a.handle('agent: delete the old files', { source: 'text' });
    await tick();
    await r.a.handle('jooji', { source: 'text' });
    await done;
    expect(agent.answers[0]).toBe(false);
  });
  it('strong questions need Windows Hello/PIN first; if it fails the answer is no and the owner is not even asked', async () => {
    const agent = new FakeAgent([Q('strong')]);
    const r = await setup(agent);
    r.strongAuth.result = false;
    await r.a.handle('agent: pay the invoice', { source: 'text' });
    expect(r.strongAuth.calls).toBe(1);
    expect(agent.answers).toEqual([false]);
  });
  it('strong questions: after verification the owner still has to say yes', async () => {
    const agent = new FakeAgent([Q('strong')]);
    const r = await setup(agent);
    r.strongAuth.result = true;
    const done = r.a.handle('agent: pay the invoice', { source: 'text' });
    await tick();
    expect(r.strongAuth.calls).toBe(1);
    expect(agent.answers).toEqual([]);
    await r.a.handle('haa', { source: 'text' });
    await done;
    expect(agent.answers).toEqual([true]);
  });
  it('a stranger\'s voice cannot approve', async () => {
    const agent = new FakeAgent([Q('confirm')]);
    const r = await setup(agent, (s) => { s.voiceId.enabled = true; });
    const done = r.a.handle('agent: delete the old file', { source: 'text' });
    await tick();
    await r.a.handle('haa', { source: 'voice', speaker: 'other' });
    await tick();
    expect(agent.answers).toEqual([]);
    await r.a.handle('maya', { source: 'text' });
    await done;
  });
  it('opens a reply window so the owner can answer without the wake word', async () => {
    const agent = new FakeAgent([Q('confirm')]);
    const r = await setup(agent);
    const done = r.a.handle('agent: delete the old file', { source: 'text' });
    await tick();
    expect(r.events.some((e) => e.type === 'listen')).toBe(true);
    await r.a.handle('maya', { source: 'text' });
    await done;
  });
  it('is blocked until the owner turned the agent on and allowed cloud AI', async () => {
    const off = await setup(new FakeAgent([]), (s) => { s.agent.enabled = false; });
    await off.a.handle('agent: do something', { source: 'text' });
    expect(off.speech.spoken.join(' ')).toContain('Settings → Wakiilka');
    const nocloud = await setup(new FakeAgent([]), (s) => { s.privacy.allowCloudLlm = false; });
    await nocloud.a.handle('agent: do something', { source: 'text' });
    expect(nocloud.speech.spoken.join(' ')).toContain('cloud AI');
  });
  it('requires the owner to be recognised first (private tool)', async () => {
    const agent = new FakeAgent([]);
    const r = await makeRig({ agent, settings: (s) => { s.agent.enabled = true; s.privacy.allowCloudLlm = true; } });
    r.assurance.reset();
    await r.a.handle('agent: do something', { source: 'text' });
    expect(agent.goals).toEqual([]);
  });
  it('the agent\'s output is treated as untrusted: a message cannot be sent in the same task context', async () => {
    const agent = new FakeAgent([]);
    const r = await setup(agent);
    await r.a.handle('agent: do something', { source: 'text' });
    const rec = r.actionLog.list(5).find((x) => x.tool === 'agent.task');
    expect(rec).toBeTruthy();
    expect(r.wa.sent).toEqual([]);
  });
});
