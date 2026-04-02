'use client';

import { useRef, useEffect, useCallback } from 'react';

/* ─────────────────────────────────────────────────────────
 * LoginSphere — Hero sphere for the login page
 *
 * Click cycle:  sphere  →  "NUCLEUS"  →  sphere  →  "TYRION INTEGRATION"  →  sphere  → ...
 * Each transition includes a shockwave + smooth morph.
 * ───────────────────────────────────────────────────────── */

type SphereMode = 'sphere' | 'nucleus' | 'tyrion';

interface LoginSphereProps {
  readonly className?: string;
  readonly onModeChange?: (mode: SphereMode) => void;
}

export function LoginSphere({ className = '', onModeChange }: LoginSphereProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const modeRef = useRef<SphereMode>('sphere');
  const morphRef = useRef(0);
  const shockwaveRef = useRef(0);
  const mouseRef = useRef({ x: -999, y: -999, active: false });
  const textRef = useRef('NUCLEUS');
  const textPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const particlesRef = useRef<any[]>([]);
  const pendingTextChange = useRef<string | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const onModeChangeRef = useRef(onModeChange);

  useEffect(() => { onModeChangeRef.current = onModeChange; }, [onModeChange]);

  const clickSequence = useRef<SphereMode[]>([
    'nucleus', 'sphere', 'tyrion', 'sphere',
  ]);
  const clickIndex = useRef(0);

  const handleClickAction = useCallback(() => {
    const next = clickSequence.current[clickIndex.current % clickSequence.current.length];
    clickIndex.current += 1;

    if (next === 'sphere') {
      modeRef.current = 'sphere';
    } else {
      if (modeRef.current !== 'sphere') {
        modeRef.current = 'sphere';
        pendingTextChange.current = next === 'nucleus' ? 'NUCLEUS' : 'TYRION';
      } else {
        textRef.current = next === 'nucleus' ? 'NUCLEUS' : 'TYRION';
        modeRef.current = next;
      }
    }

    shockwaveRef.current = 1.0;
    onModeChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas!.clientWidth || 500;
      const h = canvas!.clientHeight || 500;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };
    }
    resize();

    const cx = () => sizeRef.current.w / 2;
    const cy = () => sizeRef.current.h / 2;
    const radius = () => Math.min(sizeRef.current.w, sizeRef.current.h) * 0.36;

    /* ─── Text target builder ─── */
    function buildTextTargets(word: string): Array<{ x: number; y: number }> {
      const w = sizeRef.current.w || 500;
      const h = sizeRef.current.h || 500;
      const offscreen = document.createElement('canvas');
      const fontSize = Math.min(w * 0.09, 85);
      offscreen.width = w;
      offscreen.height = h;
      const offCtx = offscreen.getContext('2d')!;
      offCtx.fillStyle = '#fff';
      offCtx.font = `800 ${fontSize}px "Manrope", "Inter", system-ui, sans-serif`;
      offCtx.textAlign = 'center';
      offCtx.textBaseline = 'middle';

      if (word === 'TYRION') {
        // Two lines: TYRION + INTEGRATION, same size
        const lineGap = fontSize * 0.6;
        offCtx.fillText('TYRION', w / 2, h / 2 - lineGap / 2);
        offCtx.fillText('INTEGRATION', w / 2, h / 2 + lineGap / 2 + fontSize * 0.15);
      } else {
        offCtx.fillText(word, w / 2, h / 2);
      }

      const imgData = offCtx.getImageData(0, 0, w, h).data;
      const pts: Array<{ x: number; y: number }> = [];
      const step = 3;
      for (let py = 0; py < h; py += step) {
        for (let px = 0; px < w; px += step) {
          if (imgData[(py * w + px) * 4 + 3] > 100) {
            pts.push({ x: px - w / 2, y: py - h / 2 });
          }
        }
      }
      return pts;
    }

    /* ─── Particle ─── */
    const COUNT = 2400;

    class ParticleImpl {
      sx: number; sy: number; sz: number;
      tx: number; ty: number; tz: number;
      x: number; y: number; z: number;
      baseSize: number; alpha: number; phase: number;
      colorType: number;

      constructor(i: number) {
        const R = radius();
        const golden = (1 + Math.sqrt(5)) / 2;
        const theta = Math.acos(1 - (2 * (i + 0.5)) / COUNT);
        const phi = (2 * Math.PI * i) / golden;
        this.sx = R * Math.sin(theta) * Math.cos(phi);
        this.sy = R * Math.sin(theta) * Math.sin(phi);
        this.sz = R * Math.cos(theta);

        this.tx = this.sx;
        this.ty = this.sy;
        this.tz = (Math.random() - 0.5) * 12;

        this.x = this.sx + (Math.random() - 0.5) * 160;
        this.y = this.sy + (Math.random() - 0.5) * 160;
        this.z = this.sz;

        this.baseSize = Math.random() * 1.5 + 0.5;
        this.alpha = Math.random() * 0.5 + 0.35;
        this.phase = Math.random() * Math.PI * 2;
        this.colorType = Math.random() < 0.55 ? 0 : Math.random() < 0.5 ? 1 : 2;
      }

      assignTextTarget(pts: Array<{ x: number; y: number }>) {
        if (pts.length > 0) {
          const pt = pts[Math.floor(Math.random() * pts.length)];
          this.tx = pt.x;
          this.ty = pt.y;
        } else {
          this.tx = (Math.random() - 0.5) * 50;
          this.ty = (Math.random() - 0.5) * 20;
        }
        this.tz = (Math.random() - 0.5) * 8;
      }

      update(ts: number, morph: number, mouseD: { dx: number; dy: number; str: number }) {
        const drift = 1 - morph;
        // Richer drift motion — dual-axis sinusoidal with varying speeds
        const nx = (Math.cos(ts * 0.0006 + this.phase) + Math.sin(ts * 0.0003 + this.phase * 1.7) * 0.5) * 2.0 * drift;
        const ny = (Math.sin(ts * 0.0008 + this.phase) + Math.cos(ts * 0.0004 + this.phase * 1.3) * 0.5) * 2.0 * drift;

        const R = radius();
        let targetX = this.sx * (1 - morph) + this.tx * morph;
        let targetY = this.sy * (1 - morph) + this.ty * morph;
        const targetZ = this.sz * (1 - morph) + this.tz * morph;

        // Mouse deformation
        if (mouseD.str > 0.01 && morph < 0.3) {
          const d = Math.sqrt((this.x - mouseD.dx) ** 2 + (this.y - mouseD.dy) ** 2);
          const inf = Math.max(0, 1 - d / (R * 1.3));
          const push = inf * mouseD.str * 35;
          const angle = Math.atan2(this.y - mouseD.dy, this.x - mouseD.dx);
          targetX += Math.cos(angle) * push;
          targetY += Math.sin(angle) * push;
        }

        const speed = morph > 0.01 && morph < 0.99 ? 0.07 : 0.045;
        this.x += (targetX + nx - this.x) * speed;
        this.y += (targetY + ny - this.y) * speed;
        this.z += (targetZ - this.z) * speed;
      }

      draw(ctx: CanvasRenderingContext2D, rotY: number, rotX: number, morph: number, pulse: number) {
        const R = radius();
        const rotAmount = 1 - morph * 0.85;

        // Y rotation
        const cosY = Math.cos(rotY * rotAmount);
        const sinY = Math.sin(rotY * rotAmount);
        let dx = this.x * cosY - this.z * sinY;
        let dz = this.x * sinY + this.z * cosY;

        // X rotation (subtle tilt)
        const cosX = Math.cos(rotX * rotAmount);
        const sinX = Math.sin(rotX * rotAmount);
        const dy = this.y * cosX - dz * sinX;
        dz = this.y * sinX + dz * cosX;

        const perspective = 600 / (600 + dz);
        const w = sizeRef.current.w;
        const h = sizeRef.current.h;
        const px = w / 2 + dx * perspective;
        const py = h / 2 + dy * perspective;
        const pr = this.baseSize * perspective;

        const depthFade = morph > 0.5 ? 1 : Math.max(0.12, 1 - Math.abs(dz) / (R * 1.8));

        let r: number, g: number, b: number;
        if (this.colorType === 1) { r = 78; g = 222; b = 163; }
        else if (this.colorType === 2) { r = 220; g = 230; b = 255; }
        else { r = 173; g = 198; b = 255; }

        const a = this.alpha * depthFade * (0.7 + pulse * 0.3);

        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
        ctx.fill();
      }
    }

    type Particle = ParticleImpl;

    /* ─── Init ─── */
    const textPts = buildTextTargets(textRef.current);
    textPointsRef.current = textPts;

    const particles: Particle[] = Array.from({ length: COUNT }, (_, i) => {
      const p = new ParticleImpl(i);
      p.assignTextTarget(textPts);
      return p;
    });
    particlesRef.current = particles;

    /* ─── Mouse handlers ─── */
    function handleMouseMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left - sizeRef.current.w / 2;
      mouseRef.current.y = e.clientY - rect.top - sizeRef.current.h / 2;
      mouseRef.current.active = true;
    }
    function handleMouseLeave() { mouseRef.current.active = false; }
    function handleClick() { handleClickAction(); }

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('click', handleClick);

    /* ─── Animation ─── */
    function animate(ts: number) {
      const { w, h } = sizeRef.current;
      ctx!.clearRect(0, 0, w, h);

      // Handle pending text change
      if (pendingTextChange.current && morphRef.current < 0.05) {
        textRef.current = pendingTextChange.current;
        const newPts = buildTextTargets(pendingTextChange.current);
        textPointsRef.current = newPts;
        for (const p of particlesRef.current) {
          (p as ParticleImpl).assignTextTarget(newPts);
        }
        modeRef.current = pendingTextChange.current === 'NUCLEUS' ? 'nucleus' : 'tyrion';
        pendingTextChange.current = null;
        shockwaveRef.current = 0.8;
      }

      const targetMorph = modeRef.current === 'sphere' ? 0 : 1;
      morphRef.current += (targetMorph - morphRef.current) * 0.06;
      const morph = morphRef.current;

      const pulse = 0.7 + Math.sin(ts * 0.0012) * 0.3;
      const breathScale = 1 + Math.sin(ts * 0.0008) * 0.02;

      const mouseDistort = {
        dx: mouseRef.current.x,
        dy: mouseRef.current.y,
        str: mouseRef.current.active ? 1 : 0,
      };

      /* ── Shockwave ── */
      if (shockwaveRef.current > 0.01) {
        shockwaveRef.current *= 0.93;
        const R = radius();
        const swR = (1 - shockwaveRef.current) * R * 3.5;
        ctx!.beginPath();
        ctx!.arc(w / 2, h / 2, swR, 0, Math.PI * 2);
        ctx!.strokeStyle = `rgba(78, 222, 163, ${shockwaveRef.current * 0.35})`;
        ctx!.lineWidth = 1.5;
        ctx!.stroke();

        const swR2 = (1 - shockwaveRef.current) * R * 4.5;
        ctx!.beginPath();
        ctx!.arc(w / 2, h / 2, swR2, 0, Math.PI * 2);
        ctx!.strokeStyle = `rgba(173, 198, 255, ${shockwaveRef.current * 0.15})`;
        ctx!.lineWidth = 1;
        ctx!.stroke();

        if (shockwaveRef.current > 0.5) {
          const flashGrd = ctx!.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, R * 2.5);
          flashGrd.addColorStop(0, `rgba(173, 198, 255, ${shockwaveRef.current * 0.06})`);
          flashGrd.addColorStop(1, 'rgba(0,0,0,0)');
          ctx!.fillStyle = flashGrd;
          ctx!.fillRect(0, 0, w, h);
        }
      }

      /* ── Core glow (breathing) ── */
      const R = radius();
      const glowR = R * 1.5 * breathScale;
      const coreGlow = ctx!.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, glowR);
      coreGlow.addColorStop(0, `rgba(77, 142, 255, ${0.07 * pulse})`);
      coreGlow.addColorStop(0.35, `rgba(78, 222, 163, ${0.03 * pulse})`);
      coreGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx!.fillStyle = coreGlow;
      ctx!.fillRect(0, 0, w, h);

      /* ── Particles ── */
      // Faster rotation + subtle X-axis tilt
      const rotY = ts * 0.0005;
      const rotX = Math.sin(ts * 0.0003) * 0.12;
      for (const p of particles) {
        (p as ParticleImpl).update(ts, morph, mouseDistort);
        (p as ParticleImpl).draw(ctx!, rotY, rotX, morph, pulse);
      }

      /* ── Text overlay when morphed ── */
      if (morph > 0.4) {
        const textAlpha = Math.min(1, (morph - 0.4) / 0.3);
        const fontSize = Math.min(w * 0.09, 85);

        ctx!.save();
        ctx!.shadowBlur = 25;
        ctx!.shadowColor = `rgba(78, 222, 163, ${0.2 * pulse * textAlpha})`;
        ctx!.fillStyle = `rgba(220, 235, 255, ${0.8 * textAlpha})`;
        ctx!.font = `800 ${fontSize}px "Manrope", "Inter", system-ui, sans-serif`;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'middle';

        if (modeRef.current === 'tyrion') {
          // Two lines, same font size: TYRION + INTEGRATION
          const lineGap = fontSize * 0.6;
          ctx!.fillText('TYRION', w / 2, h / 2 - lineGap / 2);
          ctx!.fillText('INTEGRATION', w / 2, h / 2 + lineGap / 2 + fontSize * 0.15);
          // Glow pass
          ctx!.shadowBlur = 50;
          ctx!.shadowColor = `rgba(77, 142, 255, ${0.12 * pulse * textAlpha})`;
          ctx!.fillStyle = `rgba(255, 255, 255, ${0.04 * textAlpha})`;
          ctx!.fillText('TYRION', w / 2, h / 2 - lineGap / 2);
          ctx!.fillText('INTEGRATION', w / 2, h / 2 + lineGap / 2 + fontSize * 0.15);
        } else {
          // Single line: NUCLEUS
          ctx!.fillText('NUCLEUS', w / 2, h / 2);
          ctx!.shadowBlur = 50;
          ctx!.shadowColor = `rgba(77, 142, 255, ${0.12 * pulse * textAlpha})`;
          ctx!.fillStyle = `rgba(255, 255, 255, ${0.04 * textAlpha})`;
          ctx!.fillText('NUCLEUS', w / 2, h / 2);
        }
        ctx!.restore();
      }

      animRef.current = requestAnimationFrame(animate);
    }

    animRef.current = requestAnimationFrame(animate);

    function handleResize() {
      resize();
      const pts = buildTextTargets(textRef.current);
      textPointsRef.current = pts;
      for (const p of particlesRef.current) {
        (p as ParticleImpl).assignTextTarget(pts);
      }
    }

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('click', handleClick);
    };
  }, [handleClickAction]);

  return (
    <canvas
      ref={canvasRef}
      className={`cursor-pointer ${className}`}
      title="Click to interact"
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}
