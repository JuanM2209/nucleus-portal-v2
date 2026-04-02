'use client';

import { useRef, useEffect } from 'react';

interface NucleusOrbProps {
  size?: number;
  className?: string;
}

export function NucleusOrb({ size = 300, className = '' }: NucleusOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const modeRef = useRef<'sphere' | 'text'>('sphere');
  const morphRef = useRef(0);
  const shockwaveRef = useRef(0);
  const mouseRef = useRef({ x: -999, y: -999, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const RADIUS = size * 0.30;
    const COUNT = 1000;
    const TEXT = 'NUCLEUS';

    /* ─── Build text target positions ─── */
    const offscreen = document.createElement('canvas');
    const fontSize = size * 0.13;
    offscreen.width = size;
    offscreen.height = size;
    const offCtx = offscreen.getContext('2d')!;
    offCtx.fillStyle = '#fff';
    offCtx.font = `800 ${fontSize}px "Inter", "Manrope", system-ui, sans-serif`;
    offCtx.textAlign = 'center';
    offCtx.textBaseline = 'middle';
    // Manual letter spacing via character-by-character rendering
    const chars = TEXT.split('');
    const spacing = fontSize * 0.12;
    const totalWidth = offCtx.measureText(TEXT).width + spacing * (chars.length - 1);
    let xPos = (size - totalWidth) / 2;
    for (const ch of chars) {
      offCtx.fillText(ch, xPos + offCtx.measureText(ch).width / 2, size / 2);
      xPos += offCtx.measureText(ch).width + spacing;
    }

    const imgData = offCtx.getImageData(0, 0, size, size).data;
    const textPoints: { x: number; y: number }[] = [];
    for (let py = 0; py < size; py += 3) {
      for (let px = 0; px < size; px += 3) {
        if (imgData[(py * size + px) * 4 + 3] > 100) {
          textPoints.push({ x: px - cx, y: py - cy });
        }
      }
    }

    /* ─── Particle class ─── */
    class Particle {
      // Sphere position
      sx: number; sy: number; sz: number;
      // Text target position
      tx: number; ty: number; tz: number;
      // Current position
      x: number; y: number; z: number;
      // Visual
      baseSize: number; alpha: number; phase: number;
      // Color type (0 = blue, 1 = green, 2 = white)
      colorType: number;

      constructor() {
        // Distribute on sphere surface
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        this.sx = RADIUS * Math.sin(phi) * Math.cos(theta);
        this.sy = RADIUS * Math.sin(phi) * Math.sin(theta);
        this.sz = RADIUS * Math.cos(phi);

        // Map to text position
        const tp = textPoints.length > 0
          ? textPoints[Math.floor(Math.random() * textPoints.length)]
          : { x: 0, y: 0 };
        this.tx = tp.x * 0.9;
        this.ty = tp.y * 0.9;
        this.tz = (Math.random() - 0.5) * 12;

        this.x = this.sx;
        this.y = this.sy;
        this.z = this.sz;

        this.baseSize = Math.random() * 1.6 + 0.4;
        this.alpha = Math.random() * 0.5 + 0.3;
        this.phase = Math.random() * Math.PI * 2;
        this.colorType = Math.random() < 0.6 ? 0 : Math.random() < 0.5 ? 1 : 2;
      }

      update(ts: number, morph: number, mouseDistort: { dx: number; dy: number; strength: number }) {
        // Natural drift (sphere mode)
        const drift = 1 - morph;
        const nx = Math.cos(ts * 0.0008 + this.phase) * 2 * drift;
        const ny = Math.sin(ts * 0.001 + this.phase) * 2 * drift;

        // Target position based on morph
        let targetX = this.sx * (1 - morph) + this.tx * morph;
        let targetY = this.sy * (1 - morph) + this.ty * morph;
        const targetZ = this.sz * (1 - morph) + this.tz * morph;

        // Mouse deformation (sphere mode only)
        if (mouseDistort.strength > 0.01 && morph < 0.5) {
          const distToMouse = Math.sqrt(
            (this.x - mouseDistort.dx) ** 2 + (this.y - mouseDistort.dy) ** 2
          );
          const influence = Math.max(0, 1 - distToMouse / (RADIUS * 1.2));
          const pushStrength = influence * mouseDistort.strength * 35;
          const angle = Math.atan2(this.y - mouseDistort.dy, this.x - mouseDistort.dx);
          targetX += Math.cos(angle) * pushStrength;
          targetY += Math.sin(angle) * pushStrength;
        }

        // Smooth interpolation
        const speed = morph > 0.01 && morph < 0.99 ? 0.1 : 0.06;
        this.x += (targetX + nx - this.x) * speed;
        this.y += (targetY + ny - this.y) * speed;
        this.z += (targetZ - this.z) * speed;
      }

      draw(ctx: CanvasRenderingContext2D, rotY: number, morph: number, pulse: number) {
        // 3D rotation (reduced when in text mode)
        const rotAmount = 1 - morph;
        const cos = Math.cos(rotY * rotAmount);
        const sin = Math.sin(rotY * rotAmount);
        const dx = this.x * cos - this.z * sin;
        const dz = this.x * sin + this.z * cos;

        // Perspective projection
        const perspective = 600 / (600 + dz);
        const px = cx + dx * perspective;
        const py = cy + this.y * perspective;
        const pr = this.baseSize * perspective;

        // Depth-based visibility
        const depthFade = morph > 0.5 ? 1 : Math.max(0.15, 1 - Math.abs(dz) / (RADIUS * 1.8));

        // Color
        let r: number, g: number, b: number;
        if (this.colorType === 1) {
          // Green (tertiary)
          r = 78; g = 222; b = 163;
        } else if (this.colorType === 2) {
          // White
          r = 220; g = 230; b = 255;
        } else {
          // Blue (primary)
          r = 173; g = 198; b = 255;
        }

        const alpha = this.alpha * depthFade * (0.7 + pulse * 0.3);

        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fill();
      }
    }

    const particles = Array.from({ length: COUNT }, () => new Particle());

    /* ─── Mouse handlers ─── */
    function handleMouseMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left - cx;
      mouseRef.current.y = e.clientY - rect.top - cy;
      mouseRef.current.active = true;
    }
    function handleMouseLeave() {
      mouseRef.current.active = false;
    }
    function handleClick() {
      modeRef.current = modeRef.current === 'sphere' ? 'text' : 'sphere';
      shockwaveRef.current = 1.0;
    }

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('click', handleClick);

    /* ─── Animation loop ─── */
    function animate(ts: number) {
      ctx!.clearRect(0, 0, size, size);

      // Morph interpolation
      const targetMorph = modeRef.current === 'text' ? 1 : 0;
      morphRef.current += (targetMorph - morphRef.current) * 0.12;
      const morph = morphRef.current;

      const pulse = 0.7 + Math.sin(ts * 0.001) * 0.3;

      // Mouse distortion
      const mouseDistort = {
        dx: mouseRef.current.x,
        dy: mouseRef.current.y,
        strength: mouseRef.current.active ? 1 : 0,
      };

      /* ── Shockwave effect on click ── */
      if (shockwaveRef.current > 0.01) {
        shockwaveRef.current *= 0.92;
        const swRadius = (1 - shockwaveRef.current) * RADIUS * 3.5;
        ctx!.beginPath();
        ctx!.arc(cx, cy, swRadius, 0, Math.PI * 2);
        ctx!.strokeStyle = `rgba(78, 222, 163, ${shockwaveRef.current * 0.5})`;
        ctx!.lineWidth = 2;
        ctx!.stroke();

        // Flash
        if (shockwaveRef.current > 0.5) {
          const flashGrd = ctx!.createRadialGradient(cx, cy, 0, cx, cy, RADIUS * 2.5);
          flashGrd.addColorStop(0, `rgba(173, 198, 255, ${shockwaveRef.current * 0.12})`);
          flashGrd.addColorStop(1, 'rgba(0,0,0,0)');
          ctx!.fillStyle = flashGrd;
          ctx!.fillRect(0, 0, size, size);
        }
      }

      /* ── Core glow (breathes) ── */
      const coreGlow = ctx!.createRadialGradient(cx, cy, 0, cx, cy, RADIUS * 1.2);
      coreGlow.addColorStop(0, `rgba(77, 142, 255, ${0.06 * pulse})`);
      coreGlow.addColorStop(0.5, `rgba(78, 222, 163, ${0.03 * pulse})`);
      coreGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx!.fillStyle = coreGlow;
      ctx!.fillRect(0, 0, size, size);

      /* ── Particles ── */
      const rotY = ts * 0.0004;
      for (const p of particles) {
        p.update(ts, morph, mouseDistort);
        p.draw(ctx!, rotY, morph, pulse);
      }

      /* ── Text mode: overlay crisp NUCLEUS text with glow ── */
      if (morph > 0.3) {
        const textAlpha = Math.min(1, (morph - 0.3) / 0.4);

        // Shimmer sweep across text
        const shimmerX = Math.sin(ts * 0.0005) * size * 0.35;
        const shimmerGrad = ctx!.createLinearGradient(
          cx + shimmerX - size * 0.2, cy,
          cx + shimmerX + size * 0.2, cy
        );
        shimmerGrad.addColorStop(0, `rgba(173, 198, 255, 0)`);
        shimmerGrad.addColorStop(0.5, `rgba(255, 255, 255, ${0.15 * textAlpha})`);
        shimmerGrad.addColorStop(1, `rgba(173, 198, 255, 0)`);

        ctx!.save();
        // Glow layer
        ctx!.shadowBlur = 25;
        ctx!.shadowColor = `rgba(78, 222, 163, ${0.3 * pulse * textAlpha})`;
        ctx!.fillStyle = `rgba(220, 235, 255, ${0.9 * textAlpha})`;
        ctx!.font = `800 ${fontSize}px "Inter", "Manrope", system-ui, sans-serif`;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'middle';

        // Render with letter spacing
        const textChars = TEXT.split('');
        const charSpacing = fontSize * 0.12;
        const measured = ctx!.measureText(TEXT).width + charSpacing * (textChars.length - 1);
        let drawX = cx - measured / 2;
        for (const ch of textChars) {
          const charW = ctx!.measureText(ch).width;
          ctx!.fillText(ch, drawX + charW / 2, cy);
          drawX += charW + charSpacing;
        }

        // Second pass: outer blue glow
        ctx!.shadowBlur = 50;
        ctx!.shadowColor = `rgba(77, 142, 255, ${0.2 * pulse * textAlpha})`;
        ctx!.fillStyle = `rgba(255, 255, 255, ${0.08 * textAlpha})`;
        drawX = cx - measured / 2;
        for (const ch of textChars) {
          const charW = ctx!.measureText(ch).width;
          ctx!.fillText(ch, drawX + charW / 2, cy);
          drawX += charW + charSpacing;
        }
        ctx!.restore();

        // Underline accent bar
        const barW = size * 0.24;
        const barY = cy + fontSize * 0.6;
        const barGrad = ctx!.createLinearGradient(cx - barW, barY, cx + barW, barY);
        barGrad.addColorStop(0, 'rgba(78, 222, 163, 0)');
        barGrad.addColorStop(0.2, `rgba(78, 222, 163, ${0.5 * textAlpha * pulse})`);
        barGrad.addColorStop(0.5, `rgba(173, 198, 255, ${0.4 * textAlpha * pulse})`);
        barGrad.addColorStop(0.8, `rgba(78, 222, 163, ${0.5 * textAlpha * pulse})`);
        barGrad.addColorStop(1, 'rgba(78, 222, 163, 0)');
        ctx!.fillStyle = barGrad;
        ctx!.fillRect(cx - barW, barY, barW * 2, 2);

        // Subtitle: "TYRION INTEGRATION" below
        const subAlpha = textAlpha * 0.4;
        ctx!.fillStyle = `rgba(78, 222, 163, ${subAlpha})`;
        ctx!.font = `700 ${fontSize * 0.22}px "JetBrains Mono", monospace`;
        ctx!.textAlign = 'center';
        ctx!.fillText('TYRION  INTEGRATION', cx, barY + fontSize * 0.38);
      }

      animRef.current = requestAnimationFrame(animate);
    }

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('click', handleClick);
    };
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      className={`cursor-pointer ${className}`}
      title="Click to morph"
      style={{ width: size, height: size }}
    />
  );
}
