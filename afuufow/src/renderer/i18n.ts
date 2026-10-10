import { useUi } from './store';

type Dict = Record<string, { so: string; en: string }>;

export const D: Dict = {
  app: { so: 'Afuufow', en: 'Afuufow' },
  'nav.home': { so: 'Guriga', en: 'Home' },
  'nav.history': { so: 'Taariikh & Ficillo', en: 'History & Actions' },
  'nav.memory': { so: 'Milkiilaha & Xusuusta', en: 'Owner & Memory' },
  'nav.visitors': { so: 'Booqdayaal', en: 'Visitors' },
  'nav.integrations': { so: 'Isku-xirka', en: 'Integrations' },
  'nav.permissions': { so: 'Ogolaansho', en: 'Permissions' },
  'nav.privacy': { so: 'Qarsoodi & Xog', en: 'Privacy & Data' },
  'nav.setup': { so: 'Dejinta koowaad (Setup)', en: 'First-run setup' },
  'nav.help': { so: 'Cilad-bixin', en: 'Troubleshooting' },
  'nav.settings': { so: 'Dejinta guud', en: 'Settings' },
  'state.sleeping': { so: 'Waan sugayaa', en: 'Waiting' },
  'state.listening': { so: 'Dhegaysanaya', en: 'Listening' },
  'state.thinking': { so: 'Wuu fikirayaa', en: 'Thinking' },
  'state.executing': { so: 'Wuu fulinayaa', en: 'Working' },
  'state.speaking': { so: 'Wuu hadlayaa', en: 'Speaking' },
  'state.error': { so: 'Cilad', en: 'Error' },
  'state.paused': { so: 'La hakiyay', en: 'Paused' },
  mic: { so: 'Maykarafoon', en: 'Microphone' },
  camera: { so: 'Kamarad', en: 'Camera' },
  speaker: { so: 'Isbeekar', en: 'Speaker' },
  on: { so: 'Furan', en: 'On' },
  off: { so: 'Dansan', en: 'Off' },
  capturing: { so: 'wuu qabanayaa', en: 'capturing' },
  idle: { so: 'ma shaqeynayo', en: 'not capturing' },
  type: { so: 'Qor amar ama su’aal…', en: 'Type a command or question…' },
  send: { so: 'Dir', en: 'Send' },
  stop: { so: 'Jooji', en: 'Stop' },
  cancel: { so: 'Jooji hawsha', en: 'Cancel task' },
  ptt: { so: 'Ku hadal', en: 'Push to talk' },
  task: { so: 'Hawsha hadda', en: 'Current task' },
  notask: { so: 'Hawl socota ma jirto', en: 'No task running' },
  yes: { so: 'Haa', en: 'Yes' },
  no: { so: 'Maya', en: 'No' },
  transcript: { so: 'Wada-hadalka', en: 'Conversation' },
  draft: { so: 'Qoraalka la diyaariyay', en: 'Prepared draft' },
  copy: { so: 'Koobiyee', en: 'Copy' },
  save: { so: 'Kaydi', en: 'Save' },
  delete: { so: 'Tirtir', en: 'Delete' },
  edit: { so: 'Wax ka beddel', en: 'Edit' },
  add: { so: 'Ku dar', en: 'Add' },
  export: { so: 'Dhoofi (export)', en: 'Export' },
  test: { so: 'Tijaabi', en: 'Test' },
  next: { so: 'Xiga', en: 'Next' },
  back: { so: 'Dib', en: 'Back' },
  skip: { so: 'Ka bood', en: 'Skip' },
  finish: { so: 'Dhammee', en: 'Finish' },
  theme: { so: 'Muuqaal', en: 'Theme' },
  dark: { so: 'Madow', en: 'Dark' },
  light: { so: 'Iftiin', en: 'Light' },
  system: { so: 'Nidaamka', en: 'System' },
  language: { so: 'Luqadda UI', en: 'UI language' },
  quit: { so: 'Ka bax Afuufow', en: 'Exit Afuufow' },
  'quit.note': { so: 'Afuufow waxay ku sii shaqeysaa tray-ga marka daaqadda la xidho.', en: 'Afuufow keeps running in the tray when you close this window.' },
  'home.try': { so: 'Tijaabi: “Afuufow, Chrome fur”, “Downloads-ka fur”, “Ahmed u qor: …”, “Ii shid heesta …”', en: 'Try: “Afuufow, Chrome fur”, “Downloads-ka fur”, “Ahmed u qor: …”, “Ii shid heesta …”' },
  'status.title': { so: 'Xaaladda', en: 'Status' },
  'status.assurance': { so: 'Aqoonsiga', en: 'Identity' },
  'assurance.none': { so: 'Lama aqoonsan', en: 'Not verified' },
  'assurance.voice': { so: 'Cod kaliya (xaddidan)', en: 'Voice only (limited)' },
  'assurance.presence': { so: 'Wajiga la aqoonsaday', en: 'Face recognised' },
  'assurance.strong': { so: 'PIN / Windows Hello', en: 'PIN / Windows Hello' },
  'presence.visitor': { so: 'Qof aan la aqoonsan ayaa jooga', en: 'An unrecognised person is present' },
  'presence.owner': { so: 'Boss ayaa jooga', en: 'Owner present' },
  'presence.none': { so: 'Qof lama arko', en: 'Nobody in view' },
  'presence.uncertain': { so: 'Ma hubo (iftiinka hagaaji)', en: 'Unsure (improve lighting)' },
  wake: { so: 'Ereyga toosinta', en: 'Wake word' },
  'needs.setup': { so: 'Marka hore dhammee Dejinta (Setup).', en: 'Complete Setup first.' },
};

export function useLang(): 'so' | 'en' {
  return useUi((s) => s.snap?.settings.general.uiLanguage ?? 'so');
}

export function useT() {
  const lang = useLang();
  return (key: string, vars?: Record<string, string | number>) => {
    const e = D[key];
    let s = e ? e[lang] : key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}

/** Pick a bilingual pair according to the UI language. */
export function useL() {
  const lang = useLang();
  return (so: string, en: string) => (lang === 'so' ? so : en);
}
