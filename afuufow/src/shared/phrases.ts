/**
 * Fixed Somali phrases required by the product specification.
 * These strings are intentionally centralised so tests can assert them verbatim.
 * Do not "improve" or paraphrase them: the owner asked for these exact words.
 */

export interface OwnerNames {
  /** e.g. "Hassan Mohamed Mohamud" */
  fullName: string;
  /** e.g. "Hassan Mohamed" — used after "Mudane" */
  greetingName: string;
  /** e.g. "Boss Hassan XR" */
  nickname: string;
}

export const DEFAULT_OWNER: OwnerNames = {
  fullName: 'Hassan Mohamed Mohamud',
  greetingName: 'Hassan Mohamed',
  nickname: 'Boss Hassan XR',
};

/** “Mudane Hassan Mohamed, Boss Hassan XR, waan taaganahay.” */
export function greetingPhrase(o: OwnerNames): string {
  return `Mudane ${o.greetingName}, ${o.nickname}, waan taaganahay.`;
}

/** Response to “Fariiso.” — “Waan fadhiistay Boss. Maxaan qabtaa? Shaqo ii dir.” */
export const FARIISO_RESPONSE = 'Waan fadhiistay Boss. Maxaan qabtaa? Shaqo ii dir.';

/** First sentence(s) spoken to an unrecognised person. */
export function visitorIntroPhrase(o: OwnerNames): string {
  return (
    `Salaan. Waxaan ahay Afuufow, caawiyaha ${o.nickname}. Wajigaaga ma aqoonsan. ` +
    `Waxaad isticmaalaysaa laptop-ka Boss-kayga. ` +
    `Fadlan magacaaga ii sheeg iyo sida aad oggolaanshaha ku heshay.`
  );
}

/** Consent / disclosure notice. Spoken BEFORE any visitor response is recorded. */
export function visitorConsentPhrase(_o: OwnerNames): string {
  return 'Magaca iyo jawaabta aad bixiso waxaa loo kaydin doonaa si Hassan loogu wargeliyo.';
}

/**
 * Extra disclosure sentences. They are appended ONLY when the owner enabled the
 * corresponding option, so that nothing is stored that the visitor was not told about.
 */
export const VISITOR_SNAPSHOT_DISCLOSURE =
  'Sawir kamaradda laga qaaday ayaa sidoo kale la kaydin doonaa.';
export const VISITOR_AUDIO_DISCLOSURE = 'Codkaaga duuban ayaa sidoo kale la kaydin doonaa.';

export const VISITOR_THANKS = 'Mahadsanid. Fariintaada waan gaarsiin doonaa.';
export const VISITOR_DECLINED_ACK = 'Waa hagaag. Waan xusuusan doonaa inaanad jawaab bixin.';
export const VISITOR_NO_ACCESS =
  'Ma geli karo macluumaadka gaarka ah ee Boss-ka, mana fulin karo amarro. Waxaan kaliya qori karaa fariintaada.';

/** Stop-style commands that must interrupt immediately. */
export const STOP_WORDS_SO = ['jooji', 'sug', 'aamus', 'ha hadlin', 'xidho codka', 'tegayaa'] as const;
