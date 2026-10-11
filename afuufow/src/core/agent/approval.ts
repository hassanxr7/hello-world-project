/**
 * Decides what Afuufow does when the Open Interpreter engine asks "may I run this?".
 *
 * Principles (the owner's requirements):
 *  - Nothing that deletes files, sends messages, or spends money ever runs without an explicit yes from the owner;
 *    the riskiest classes additionally need Windows Hello / the owner PIN (strong verification).
 *  - Only a tiny allow-list of plain read-only commands inside approved folders runs without asking.
 *  - Content fetched from the web is untrusted: once the task has touched the web, every later state-changing step
 *    needs strong verification (prompt-injection guard).
 *  - A handful of catastrophic commands (formatting disks, wiping the system) are refused outright.
 *
 * IMPORTANT HONESTY NOTE: classifying free-form shell text can never be complete (a command can be obfuscated).
 * This is why the default is "ask for everything", the engine itself is configured to ask for every command, and the
 * owner sees the exact command before approving. The classifier only decides HOW MUCH verification is required.
 */

export type Category = 'delete' | 'delete_recursive' | 'payment' | 'messaging' | 'secrets' | 'netexec' | 'install' | 'system' | 'outside' | 'web' | 'unknown';

export interface ApprovalContext {
  /** Folders the owner approved for file work (and the agent workspace). */
  approvedFolders: string[];
  /** The web was touched earlier in this task. */
  webTainted: boolean;
}

export interface ToolLike {
  title: string;
  kind: string;
}

export type Verdict =
  | { action: 'allow'; reason: string }
  | { action: 'deny'; so: string; en: string; categories: Category[] }
  | { action: 'ask'; level: 'confirm' | 'strong'; categories: Category[]; so: string; en: string; detailSo: string; detailEn: string };

const CATASTROPHIC: RegExp[] = [
  /\bformat(\.com)?\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\bcipher\s+\/w\b/i,
  /\bbcdedit\b/i,
  /\bvssadmin\s+delete\b/i,
  /\bwevtutil\s+cl\b/i,
  /\bclear-eventlog\b/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+if=.*\bof=\/dev\//i,
  /\brm\s+(-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r?)\s+(--no-preserve-root\s+)?(\/|~|\*|\/\*)(\s|$|['"])/i,
  /\bremove-item\b[^|;]*-recurse[^|;]*\s['"]?[a-z]:[\\/]?['"]?(\s|$)/i,
  /\bremove-item\b[^|;]*-recurse[^|;]*[a-z]:[\\/]+(windows|program files|users)[\\/]*['"]?(\s|$)/i,
  /\b(rd|rmdir)\s+\/s[^|;]*\s['"]?[a-z]:[\\/]?['"]?(\s|$)/i,
  /\breg(\.exe)?\s+delete\s+hk(lm|ey_local_machine)\b/i,
];

const RX: Record<Exclude<Category, 'outside' | 'web' | 'unknown' | 'delete_recursive'>, RegExp> = {
  delete: /\b(rm|rmdir|rd|del|erase|remove-item|ri|unlink|shred|clear-recyclebin|trash(-put)?|git\s+clean|git\s+reset\s+--hard|move-item[^|;]*\$null)\b/i,
  payment: /\b(pay|payment|payments|checkout|purchase|buy\s+now|order\s+now|paypal|stripe|billing|credit[\s-]?card|card\s*number|cvv|iban|swift|wire\s+transfer|bank\s+transfer|send\s+money|zaad|evc\s*plus|edahab|m-?pesa|western\s+union|bitcoin|crypto\s*wallet)\b/i,
  messaging: /(\b(whatsapp|telegram|sms|send-mailmessage|smtp|sendmail|twilio|sendgrid|discord|messenger|signal-cli)\b|wa\.me|mailto:|slack\.com\/api|chat\.postmessage|webhook)/i,
  secrets: /(\.ssh\b|id_rsa|id_ed25519|\.aws\b|\.env\b|\bcredentials?\b|\bpasswords?\b|login\s+data|\bcookies\b|keychain|wallet\.dat|user\s+data[\\/]|microsoft[\\/]credentials|ntuser\.dat|\blsass\b|mimikatz|\bsecrets?\b|\btokens?\.json\b)/i,
  netexec: /((curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)[^|;]*\|\s*(sh|bash|iex|invoke-expression|powershell|pwsh|cmd)\b|\biex\b|invoke-expression|downloadstring|downloadfile\b.*\.(exe|ps1|bat|cmd|msi)|-enc(odedcommand)?\b|frombase64string|start-bitstransfer)/i,
  install: /\b(winget|choco|scoop|msiexec|pip3?\s+install|npm\s+(i|install)\s+(-g|--global)|apt(-get)?\s+install|setup\.exe|install(er)?\.exe)\b/i,
  system: /\b(reg(\.exe)?\s+(add|delete|import)|schtasks|sc(\.exe)?\s+(create|config|delete|stop)|netsh|powercfg|set-itemproperty\s+hk|shutdown|restart-computer|stop-computer|taskkill|stop-process|net\s+(user|localgroup)|icacls|takeown|setx|set-mppreference|add-mppreference|disable-\w+|set-executionpolicy|new-service|remove-service)\b/i,
};

const RECURSIVE = /(\s-r(f|\b)|\s-[a-z]*r[a-z]*f|\s\/s\b|-recurse\b|\s-force\b.*-recurse|\sgit\s+clean\s+-[a-z]*d)/i;

const SAFE_INNER = /^(ls|dir|pwd|whoami|hostname|date|get-childitem|gci|get-location|get-date|test-path|tree)(\s[^;&|<>`$()\n]*)?$/i;

const LABEL_SO: Record<Category, string> = {
  delete: 'TIRTIRID',
  delete_recursive: 'TIRTIRID FAAHFAAHSAN (galal oo dhan)',
  payment: 'LACAG-BIXIN',
  messaging: 'FARIIN DIRIS',
  secrets: 'XOG GAAR AH (furayaal/password)',
  netexec: 'SOO DEJIN IYO FULIN KOODH',
  install: 'RAKIBID SOFTWARE',
  system: 'BEDDELID NIDAAMKA',
  outside: 'meel ka baxsan galalka la oggolaaday',
  web: 'qoraal ka yimid webka',
  unknown: 'amar aan la aqoon',
};
const LABEL_EN: Record<Category, string> = {
  delete: 'DELETING files',
  delete_recursive: 'DELETING whole folders',
  payment: 'a PAYMENT',
  messaging: 'SENDING a message',
  secrets: 'PRIVATE DATA (keys/passwords)',
  netexec: 'DOWNLOADING and RUNNING code',
  install: 'INSTALLING software',
  system: 'CHANGING the system',
  outside: 'a place outside your approved folders',
  web: 'content from the web',
  unknown: 'an unknown action',
};

// The Windows engine shows paths inside its -Command argument with doubled backslashes (C:\\\\Users\\\\x); both forms mean the same path
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();

/** Pulls the inner command out of a shell wrapper the engine used (bash -lc '...', powershell -Command "..."). */
export function innerCommand(title: string): string {
  let t = title.trim();
  const w = /^(?:.*?\b(?:bash|sh|zsh)(?:\.exe)?["']?\s+-l?c\s+|.*?\b(?:powershell|pwsh)(?:\.exe)?["']?\s+(?:-\w+(?:\s+\w+)?\s+)*?-(?:command|c)\s+|.*?\bcmd(?:\.exe)?["']?\s+\/[ck]\s+)/i.exec(t);
  if (w) t = t.slice(w[0].length).trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) t = t.slice(1, -1);
  return t.trim();
}

/** Absolute paths mentioned in the command; `unresolved` is true when the command uses variables/~ we cannot resolve. */
export function pathsIn(cmd: string): { paths: string[]; unresolved: boolean } {
  const paths = new Set<string>();
  // quoted absolute paths first: they may contain spaces ("C:\\Users\\Hassan Mohamed\\Documents")
  const QUOTED = /(['"])((?:[A-Za-z]:[\\/]|\/)[^'"]*)\1/g;
  for (const m of cmd.matchAll(QUOTED)) paths.add(m[2]!);
  const rest = cmd.replace(QUOTED, ' ');
  for (const m of rest.matchAll(/[A-Za-z]:[\\/][^\s"'`|;&<>)]*/g)) paths.add(m[0]);
  for (const m of rest.matchAll(/(?:^|[\s'"=(])(\/[^\s"'`|;&<>)]+)/g)) paths.add(m[1]!);
  const unresolved = /(\$env:|\$home|\$\{?\w|%\w+%|(^|[\s'"=])~[\\/]?)/i.test(cmd);
  return { paths: [...paths], unresolved };
}

function inside(path: string, folders: string[]): boolean {
  const p = norm(path);
  if (p.includes('/../') || p.endsWith('/..')) return false;
  return folders.some((f) => {
    const n = norm(f);
    return !!n && (p === n || p.startsWith(n + '/'));
  });
}

function short(s: string, n = 400): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

export function classify(tool: ToolLike | null, ctx: ApprovalContext): Verdict {
  const unknownTool = !tool || !tool.title.trim();
  const title = tool?.title ?? '';
  const kind = tool?.kind ?? 'other';
  const cmd = innerCommand(title);

  if (unknownTool) {
    return ask('strong', ['unknown'], '(lama sheegin)', '(not reported)');
  }
  for (const rx of CATASTROPHIC) {
    if (rx.test(title) || rx.test(cmd)) {
      return {
        action: 'deny',
        categories: ['system'],
        so: 'Amarkan waa halis aad u weyn (wuxuu burburin karaa kombuyuutarka); ma fulinayo.',
        en: 'This command is far too dangerous (it could wreck the computer); refusing to run it.',
      };
    }
  }

  const cats = new Set<Category>();
  for (const [c, rx] of Object.entries(RX) as Array<[Category, RegExp]>) if (rx.test(title) || rx.test(cmd)) cats.add(c);
  if (kind === 'delete') cats.add('delete');
  if (cats.has('delete') && RECURSIVE.test(' ' + cmd)) cats.add('delete_recursive');
  // ACP kind "search" means searching/listing local files (the real engine reports Get-ChildItem that way on Windows); only "fetch" and web commands touch the web
  if (kind === 'fetch' || /\b(web_search|curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod|playwright|browser_)/i.test(title)) cats.add('web');

  const { paths, unresolved } = pathsIn(cmd);
  const outsidePath = paths.some((p) => !inside(p, ctx.approvedFolders));
  if (outsidePath || unresolved) cats.add('outside');

  // 1. plain read-only listing inside approved folders: no question
  if (kind !== 'delete' && cats.size === 0 && !ctx.webTainted && SAFE_INNER.test(cmd)) {
    return { action: 'allow', reason: 'read-only listing inside approved folders' };
  }

  const list = [...cats];
  // 2. how much verification
  let strong = false;
  for (const c of ['delete_recursive', 'payment', 'messaging', 'secrets', 'netexec', 'install', 'system'] as Category[]) if (cats.has(c)) strong = true;
  if (cats.has('delete') && cats.has('outside')) strong = true;
  const changesState = kind !== 'read' && kind !== 'search' && !SAFE_INNER.test(cmd);
  if (ctx.webTainted && changesState) strong = true;
  if (kind === 'other' && !cmd) strong = true;

  return ask(strong ? 'strong' : 'confirm', list, cmd || title, cmd || title, ctx.webTainted && changesState);

  function ask(level: 'confirm' | 'strong', categories: Category[], shown: string, shownEn: string, taint = false): Verdict {
    const named = categories.filter((c) => c !== 'unknown');
    const labelSo = named.map((c) => LABEL_SO[c]).join(', ');
    const labelEn = named.map((c) => LABEL_EN[c]).join(', ');
    const risky = named.filter((c) => c !== 'outside' && c !== 'web');
    const so =
      (risky.length > 0 ? `Wakiilku wuxuu rabaa inuu fuliyo amar: ${labelSo}. ` : 'Wakiilku wuxuu rabaa inuu fuliyo amar. ') +
      (taint ? 'Waxaa jira qoraal ka yimid webka, ka taxaddar. ' : '') +
      (level === 'strong' ? 'Waxay u baahan tahay Windows Hello ama PIN-kaaga. Ma oggol tahay?' : 'Ma oggol tahay?');
    const en =
      (risky.length > 0 ? `The agent wants to run a command involving ${labelEn}. ` : 'The agent wants to run a command. ') +
      (taint ? 'Content from the web is involved: be careful. ' : '') +
      (level === 'strong' ? 'This needs Windows Hello or your PIN. Do you allow it?' : 'Do you allow it?');
    return {
      action: 'ask',
      level,
      categories,
      so,
      en,
      detailSo: `Amarka: ${short(shown)}`,
      detailEn: `Command: ${short(shownEn)}`,
    };
  }
}
