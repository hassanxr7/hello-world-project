import { useL, useT } from '../i18n';
import { call, useUi } from '../store';

/** Microphone / camera / speaker switches. The dot shows what is REALLY happening (capturing), not just the setting. */
export function DeviceToggles() {
  const d = useUi((s) => s.snap?.devices);
  const t = useT();
  const L = useL();
  if (!d) return null;
  const mk = (label: string, enabled: boolean, capturing: boolean, onClick: () => void, title: string) => {
    const bad = enabled && !capturing;
    return (
      <button className={`toggle ${enabled ? (bad ? 'warn' : 'on') : ''}`} onClick={onClick} title={title} aria-pressed={enabled}>
        <span className={`dot ${enabled ? (bad ? 'err' : 'ok live') : ''}`} />
        <b>{label}</b>
        <span className="muted small">{enabled ? (capturing ? t('capturing') : L('khalad', 'problem')) : t('off')}</span>
      </button>
    );
  };
  return (
    <div className="row">
      {mk(t('mic'), d.micEnabled, d.micCapturing, () => void call('mic.set', !d.micEnabled).catch(() => undefined), L('Hakiso/bilow dhegaysiga isla markiiba', 'Pause/resume listening immediately'))}
      {mk(t('camera'), d.cameraEnabled, d.cameraCapturing, () => void call('cam.set', !d.cameraEnabled).catch(() => undefined), L('Hakiso/bilow kamaradda isla markiiba', 'Pause/resume the camera immediately'))}
      <button className={`toggle ${d.speakerEnabled ? 'on' : ''}`} onClick={() => void call('speaker.set', !d.speakerEnabled)} aria-pressed={d.speakerEnabled}>
        <span className={`dot ${d.speakerEnabled ? 'ok' : ''}`} />
        <b>{t('speaker')}</b>
        <span className="muted small">{d.speakerEnabled ? t('on') : t('off')}</span>
      </button>
    </div>
  );
}
