import { z, cancelled, failed, unverified, type ToolDef } from './framework';
import type { Services } from './services';

export function makeAgentTools(s: Services): ToolDef<any>[] {
  return [
    {
      // 'private': needs the owner to be recognised first. Every command the agent wants to run is approved one by one on top of this.
      meta: { name: 'agent.task', risk: 'private', readOnly: false, permissionKey: 'agent.task' },
      description:
        'Delegate a multi-step computer task (organise or rename many files, work across folders, run scripts, research on the web) to the Open Interpreter task agent. Use ONLY when no other tool can do it. The owner approves every command it wants to run.',
      schema: z.object({ goal: z.string().min(3).max(2000) }),
      describe: (i: { goal: string }) => `Agent task: ${i.goal.slice(0, 80)}`,
      timeoutMs: 65 * 60_000,
      async run(input: { goal: string }, rt) {
        const st = s.settings();
        if (!s.agent || !st.agent.enabled) {
          return failed('Wakiilka (Open Interpreter) weli lama furin. Ka fur Settings → Wakiilka.', 'The task agent (Open Interpreter) is not enabled. Turn it on in Settings → Agent.');
        }
        if (!st.privacy.allowCloudLlm) {
          return failed('Wakiilku wuxuu u baahan yahay cloud AI. Ka fur "Oggolow cloud AI" Qarsoodi & Xog.', 'The agent needs a cloud AI model. Enable "Allow cloud AI" in Privacy & Data.');
        }
        if (!rt.ask) return failed('Ma weydiin karo oggolaansho; wax lama fulin.', 'Cannot ask for approval here; nothing was done.');
        const ready = await s.agent.status();
        if (!ready.ready) return failed(`Wakiilka ma diyaar aha: ${ready.detail}`, `The agent is not ready: ${ready.detail}`);

        const out = await s.agent.run(input.goal, { signal: rt.signal, onProgress: (m) => rt.progress(m), ask: (q) => rt.ask!({ level: q.level, so: q.so, en: q.en, detailSo: q.detailSo, detailEn: q.detailEn }) });
        const st2 = out.stats;
        const tally = `(${st2.allowed} oggolaaday, ${st2.denied} la diiday, ${st2.autoAllowed} akhris fudud)`;
        const tallyEn = `(${st2.allowed} approved, ${st2.denied} declined, ${st2.autoAllowed} plain read-only)`;
        const data = { untrusted: true, agent: { asked: st2.asked, allowed: st2.allowed, denied: st2.denied, commands: st2.commands } };
        if (out.status === 'cancelled') return cancelled(data);
        if (out.status === 'failed') {
          const why = out.error === 'timeout' ? 'waqtigii waa dhammaaday' : (out.error ?? 'cilad aan la aqoon');
          return failed(`Wakiilku ma dhammaystirin: ${why}. ${out.text}`.trim(), `The agent did not finish: ${out.error ?? 'unknown error'}. ${out.text}`.trim(), data);
        }
        // The agent's own claim is NOT verified by Afuufow, so it is reported as the agent's report, never as a confirmed fact.
        return unverified(
          `Wakiilku wuxuu sheegay: ${out.text || 'wuu dhammeeyay'} ${tally}`,
          `The agent reports: ${out.text || 'finished'} ${tallyEn}`,
          'agent self-report (not checked by Afuufow)',
          data,
        );
      },
    },
  ];
}
