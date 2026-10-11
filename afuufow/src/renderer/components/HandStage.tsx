import { useEffect, useRef, useState } from 'react';
import { FINGERS, FINGERTIPS, PALM, type HandView, HandTracker, projectHand } from '../../core/vision/hands';
import { useL } from '../i18n';
import { call, subscribeHands, useUi } from '../store';
import { Avatar } from './Avatar';

export const OPEN_HANDS_EVENT = 'afu:hands-open';
const VIDEO_ASPECT = 4 / 3;

function css(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Draws Afuufow's glowing "AI hands" over the screen, following the real hands the camera sees. */
function draw(ctx: CanvasRenderingContext2D, v: HandView, W: number, H: number, c1: string, c2: string, t: number) {
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const h of v.hands) {
    const { pts: P, unit: u } = projectHand(h, W, H, VIDEO_ASPECT);
    const glow = u * 0.05;
    // palm
    const g = ctx.createLinearGradient(P[0]![0], P[0]![1], P[9]![0], P[9]![1]);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.beginPath();
    PALM.forEach((i, k) => (k === 0 ? ctx.moveTo(P[i]![0], P[i]![1]) : ctx.lineTo(P[i]![0], P[i]![1])));
    ctx.closePath();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = g;
    ctx.lineWidth = u * 0.012;
    ctx.shadowBlur = glow;
    ctx.shadowColor = c2;
    ctx.stroke();
    // fingers: three tapering segments each
    for (const f of FINGERS) {
      for (let k = 0; k < 3; k++) {
        const a = P[f[k]!]!;
        const b = P[f[k + 1]!]!;
        const sg = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
        sg.addColorStop(0, c1);
        sg.addColorStop(1, c2);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = sg;
        ctx.lineWidth = u * (0.03 - k * 0.0045);
        ctx.shadowBlur = glow;
        ctx.shadowColor = c2;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    }
    // joints and glowing fingertips
    ctx.shadowBlur = glow * 0.6;
    for (let i = 0; i < 21; i++) {
      const tip = (FINGERTIPS as readonly number[]).includes(i);
      const pulse = tip ? 1 + 0.18 * Math.sin(t * 5 + i) : 1;
      ctx.globalAlpha = tip ? 1 : 0.8;
      ctx.fillStyle = tip ? '#ffffff' : c1;
      ctx.beginPath();
      ctx.arc(P[i]![0], P[i]![1], u * (tip ? 0.016 : i === 0 ? 0.022 : 0.01) * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export function HandStage() {
  const L = useL();
  const mode = useUi((s) => s.snap?.settings.camera.handStage ?? 'off');
  const camOn = useUi((s) => !!s.snap?.devices.cameraCapturing);
  const blocked = useUi((s) => !!s.pending || !!s.auth);
  const tracker = useRef(new HandTracker());
  const view = useRef<HandView>({ active: false, waving: false, hands: [] });
  const lastFrameAt = useRef(0);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const close = () => {
    tracker.current.dismiss();
    view.current = { active: false, waving: false, hands: [] };
    setOpen(false);
    void call('hands.stage', false);
  };

  // hand frames from the camera worker (numbers only)
  useEffect(() => {
    const off = subscribeHands((f) => {
      if (modeRef.current === 'off') return;
      lastFrameAt.current = Date.now();
      const v = tracker.current.update(f);
      view.current = v;
      setOpen((p) => (p === v.active ? p : v.active));
      setSeen((p) => (p === v.hands.length > 0 ? p : v.hands.length > 0));
    });
    return () => void off();
  }, []);

  // mode changes, camera off: close and forget
  useEffect(() => {
    tracker.current.setAuto(mode === 'auto');
    if (mode === 'off' || !camOn) {
      tracker.current.reset();
      view.current = { active: false, waving: false, hands: [] };
      setOpen(false);
    }
  }, [mode, camOn]);

  // the "AI hands" button: opens the stage by hand
  useEffect(() => {
    const on = () => {
      if (modeRef.current === 'off') return;
      tracker.current.setManual(true);
      setOpen(true);
      void call('hands.stage', true);
    };
    window.addEventListener(OPEN_HANDS_EVENT, on);
    return () => window.removeEventListener(OPEN_HANDS_EVENT, on);
  }, []);

  // lets the hold timer run out when frames stop (hands left the picture)
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => {
      if (Date.now() - lastFrameAt.current > 400) {
        const v = tracker.current.idle(Date.now());
        view.current = v;
        if (!v.active) setOpen(false);
        if (v.hands.length === 0) setSeen(false);
      }
    }, 300);
    return () => clearInterval(id);
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  const show = open && !blocked && camOn;

  // drawing loop
  useEffect(() => {
    if (!show) return;
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(window.innerWidth * dpr);
      c.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const c1 = css('--accent', '#5b8cff');
    const c2 = css('--accent2', '#36d6c3');
    const loop = (now: number) => {
      draw(ctx, view.current, window.innerWidth, window.innerHeight, c1, c2, now / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [show]);

  if (!show) return null;
  return (
    <div className="handstage" role="dialog" aria-label={L('Gacmaha AI ee Afuufow', "Afuufow's AI hands")}>
      <canvas ref={canvas} className="handcanvas" />
      <div className="handhead">
        <Avatar size={72} />
        <div>
          <div className="handtitle">{L('Afuufow · Gacmaha AI', 'Afuufow · AI hands')}</div>
          <div className="muted small">{L('Gacmahaaga ayaan raacayaa. Riix Esc si aad u xidho.', 'I follow your hands. Press Esc to close.')}</div>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={close}>✕ {L('Xidh', 'Close')}</button>
      </div>
      {!seen && <div className="handhint">{L('Gacmahaaga ku soo bandhig kamaradda 🖐', 'Show your hands to the camera 🖐')}</div>}
    </div>
  );
}
