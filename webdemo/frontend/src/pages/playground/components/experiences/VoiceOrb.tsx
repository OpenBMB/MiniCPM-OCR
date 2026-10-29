/**
 * Ring voiceprint visualization (Canvas).
 *
 * Purpose: a recognizable circular voiceprint — a center glow plus a ring of gradient bars that move with the spectrum (purple→blue by angle). While idle a bright band flows around the circle; while speaking each band grows with its energy. The center is a microphone core that pulses with volume (a lucide icon). Drawn imperatively with Canvas + rAF. The radius is min(width, height) so it stays a circle; color comes from the `--primary` token and adapts in dark mode.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { Mic } from 'lucide-react';
import type { VizFrame } from '../../hooks/useRealtimeSession';

interface VoiceOrbProps {
  /** Mutable ref for a spectrum frame (written directly at 60fps; see VizFrame); bar height and the center pulse are both read directly in the canvas rAF */
  viz: RefObject<VizFrame>;
  /** Whether it is active (listening/playing) */
  active: boolean;
  className?: string;
}

/**
 * Ring voiceprint.
 */
export function VoiceOrb({ viz, active, className }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coreRef = useRef<HTMLSpanElement>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;

    const c = readPrimaryHsl();
    let phase = 0;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== Math.round(cw * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const cx = cw / 2;
      const cy = ch / 2;
      const size = Math.min(cw, ch);
      const r0 = size * 0.3;
      const maxLen = size * 0.16;
      const data = viz.current.bars;
      const act = activeRef.current;
      const n = data.length || 40;

      // Center glow
      const glow = ctx.createRadialGradient(cx, cy, size * 0.08, cx, cy, size * 0.5);
      glow.addColorStop(0, `hsla(${c.h},${c.s}%,${c.l}%,0.2)`);
      glow.addColorStop(1, `hsla(${c.h},${c.s}%,${c.l}%,0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, cw, ch);

      // Spectrum bar ring
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i += 1) {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const energy = data[i] ?? 0;
        // Idle: a bright band flows around the circle; speaking: add per-band energy
        const idle = act ? 0.05 : 0.16 + 0.13 * Math.sin(phase * 1.6 - i * 0.5);
        const len = Math.max(3, (idle + energy) * maxLen);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        ctx.beginPath();
        ctx.moveTo(cx + cos * r0, cy + sin * r0);
        ctx.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
        const hue = c.h + (i / n) * 36;
        ctx.strokeStyle = `hsla(${hue},${c.s}%,${c.l}%,${0.5 + energy * 0.5})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // The center core pulses with volume: write style directly on the same frame as the bar ring, so this does not trigger a React render every frame
      if (coreRef.current) {
        coreRef.current.style.transform = `scale(${1 + Math.min(viz.current.level, 1) * 0.16})`;
      }

      phase += act ? 0.06 : 0.03;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [viz]);

  return (
    <div className={`relative aspect-square ${className ?? ''}`}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
      {/* Center core: breathing halo + gradient circle + microphone, pulsing with volume */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          aria-hidden
          className="absolute h-[42%] w-[42%] rounded-full bg-primary/30 blur-md motion-safe:animate-[map-breathe_3s_ease-in-out_infinite]"
        />
        <span
          ref={coreRef}
          className="relative flex h-[32%] w-[32%] items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-xl shadow-primary/40 ring-8 ring-primary/10 will-change-transform"
        >
          <Mic className="h-2/5 w-2/5" strokeWidth={2} />
        </span>
      </div>
    </div>
  );
}

/** Read the --primary design token (an HSL triple) as numbers */
function readPrimaryHsl(): { h: number; s: number; l: number } {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  const m = raw.match(/([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!m) return { h: 255, s: 80, l: 60 };
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}
