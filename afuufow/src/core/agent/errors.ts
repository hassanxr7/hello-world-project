/**
 * The engine retries failed model calls and then ends the turn silently; the only trace is on its stderr.
 * This extracts a human explanation from that log (never includes keys).
 */
const ANSI = /\u001b\[[0-9;]*m/g;

export function explainEngineLog(log: string): { so: string; en: string } | null {
  const clean = log.replace(ANSI, '');
  const m = /sampling_error=\s*unexpected status (\d{3})[^\n]*?(?::\s*([^\n]*?))?(?:,\s*url:|\n|$)/i.exec(clean.split('\n').reverse().find((l) => /sampling_error/i.test(l)) ?? '');
  if (!m) return null;
  const code = Number(m[1]);
  const detail = (m[2] ?? '').slice(0, 160);
  if (code === 401 || code === 403) return { so: 'Furaha API-ga waa la diiday; hubi furaha iyo bixiyaha.', en: `The API key was rejected (HTTP ${code}); check the key and provider. ${detail}`.trim() };
  if (code === 404) return { so: 'Magaca moodelka lama helin; hubi magaca moodelka Settings → Wakiilka.', en: `Model not found (HTTP 404); check the model name. ${detail}`.trim() };
  if (code === 429) return { so: 'Xadka codsiyada ama credit-ka waa dhammaaday (HTTP 429).', en: `Rate limit or out of credit (HTTP 429). ${detail}`.trim() };
  if (code >= 500) return { so: `Bixiyaha AI wuu qaldamay (HTTP ${code}); dib isku day.`, en: `The AI provider had a server error (HTTP ${code}); try again. ${detail}`.trim() };
  return { so: `Bixiyaha AI wuu diiday codsiga (HTTP ${code}).`, en: `The AI provider refused the request (HTTP ${code}). ${detail}`.trim() };
}
