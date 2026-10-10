import { useEffect, useRef } from 'react';
import { levels, useUi } from '../store';

const COLORS: Record<string, [string, string]> = {
  sleeping: ['#5b8cff', '#36d6c3'],
  listening: ['#36d6c3', '#3ddc97'],
  thinking: ['#a98bff', '#5b8cff'],
  executing: ['#ffb84d', '#ff8a4d'],
  speaking: ['#5b8cff', '#a98bff'],
  error: ['#ff5d6c', '#ff9a5d'],
  paused: ['#6b7699', '#8a94b3'],
};

/**
 * The orb is driven by REAL signals: the assistant's actual state, the microphone level while listening
 * and the output level of the speech actually being played. When nothing happens it only breathes.
 */
export function Avatar({ size = 260 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useUi((s) => s.state);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    ctx.scale(dpr, dpr);
    let raf = 0;
    let t0 = performance.now();
    let smooth = 0;
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const st = stateRef.current;
      const [c1, c2] = COLORS[st] ?? COLORS.sleeping!;
      const lvl = st === 'speaking' ? levels.tts : st === 'listening' ? levels.mic : 0;
      smooth += (Math.min(1, lvl * 4) - smooth) * 0.25;
      const cx = size / 2, cy = size / 2, base = size * 0.24;
      ctx.clearRect(0, 0, size, size);
      const breathe = st === 'paused' ? 0 : Math.sin(t * (st === 'sleeping' ? 1.1 : 2)) * 0.03;
      const r = base * (1 + breathe + smooth * 0.22);
      // glow
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.3);
      g.addColorStop(0, c1 + 'aa'); g.addColorStop(1, c1 + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 2.3, 0, Math.PI * 2); ctx.fill();
      // listening rings follow mic level
      if (st === 'listening') {
        for (let i = 0; i < 3; i++) {
          const k = ((t * 0.8 + i / 3) % 1);
          ctx.strokeStyle = c2 + Math.floor((1 - k) * 160 * (0.3 + smooth)).toString(16).padStart(2, '0');
          ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, r * (1.1 + k * (0.9 + smooth)), 0, Math.PI * 2); ctx.stroke();
        }
      }
      // speaking: radial bars follow output level
      if (st === 'speaking') {
        const n = 56;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + t * 0.4;
          const len = 6 + (0.35 + smooth * 1.3) * 26 * (0.5 + 0.5 * Math.sin(t * 9 + i * 1.7));
          ctx.strokeStyle = c2; ctx.lineWidth = 3; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r * 1.15), cy + Math.sin(a) * (r * 1.15)); ctx.lineTo(cx + Math.cos(a) * (r * 1.15 + len), cy + Math.sin(a) * (r * 1.15 + len)); ctx.stroke();
        }
      }
      // thinking: rotating arcs
      if (st === 'thinking') {
        ctx.lineWidth = 4; ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          ctx.strokeStyle = i % 2 ? c2 : c1; const a = t * (1.6 + i * 0.5) * (i % 2 ? -1 : 1);
          ctx.beginPath(); ctx.arc(cx, cy, r * (1.3 + i * 0.22), a, a + 1.5); ctx.stroke();
        }
      }
      // executing: orbiting dots
      if (st === 'executing') {
        for (let i = 0; i < 6; i++) {
          const a = t * 2.2 + (i * Math.PI) / 3;
          ctx.fillStyle = i % 2 ? c1 : c2; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 1.5, cy + Math.sin(a) * r * 1.5, 5, 0, Math.PI * 2); ctx.fill();
        }
      }
      const jitter = st === 'error' ? Math.sin(t * 40) * 2.5 : 0;
      const body = ctx.createRadialGradient(cx - r * 0.3 + jitter, cy - r * 0.35, r * 0.1, cx, cy, r);
      body.addColorStop(0, '#ffffff'); body.addColorStop(0.25, c2); body.addColorStop(1, c1);
      ctx.fillStyle = body; ctx.globalAlpha = st === 'paused' ? 0.55 : 1;
      ctx.beginPath(); ctx.arc(cx + jitter, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = `700 ${r * 0.9}px Segoe UI, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('A', cx + jitter, cy + r * 0.04);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} style={{ width: size, height: size }} aria-label={`Afuufow: ${state}`} />;
}
