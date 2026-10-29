/**
 * 环形声纹可视化（Canvas）。
 *
 * 用途：有辨识度的圆形声纹——中心辉光 + 一圈随频谱律动的渐变柱（按角度紫→蓝），待机时
 * 亮带沿圆周旋转流动、说话时各频段随能量放大；中心是随音量脉动的麦克风核心（lucide 图标）。
 * Canvas + rAF 命令式绘制，半径取 min(宽,高) 保证正圆；颜色取自 `--primary` 令牌，暗色自适配。
 */

import { useEffect, useRef, type RefObject } from 'react';
import { Mic } from 'lucide-react';
import type { VizFrame } from '../../hooks/useRealtimeSession';

interface VoiceOrbProps {
  /** 频谱帧的可变引用（60fps 直写，见 VizFrame）；柱高与中心脉动都在画布 rAF 里直接读 */
  viz: RefObject<VizFrame>;
  /** 是否活跃（聆听/播放） */
  active: boolean;
  className?: string;
}

/**
 * 环形声纹。
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

      // 中心辉光
      const glow = ctx.createRadialGradient(cx, cy, size * 0.08, cx, cy, size * 0.5);
      glow.addColorStop(0, `hsla(${c.h},${c.s}%,${c.l}%,0.2)`);
      glow.addColorStop(1, `hsla(${c.h},${c.s}%,${c.l}%,0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, cw, ch);

      // 频谱柱环
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i += 1) {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const energy = data[i] ?? 0;
        // 待机：亮带沿圆周旋转流动；说话：叠加频段能量
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

      // 中心核心随音量脉动：与柱环同帧直接写 style，避免为此每帧触发一次 React 渲染
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
      {/* 中心核心：呼吸光环 + 渐变圆 + 麦克风，随音量脉动 */}
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

/** 读取 --primary 设计令牌（HSL 三元组）为数值 */
function readPrimaryHsl(): { h: number; s: number; l: number } {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  const m = raw.match(/([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!m) return { h: 255, s: 80, l: 60 };
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}
