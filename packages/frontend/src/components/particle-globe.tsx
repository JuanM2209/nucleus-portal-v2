'use client';

import { useRef, useEffect } from 'react';

interface ParticleGlobeProps {
  readonly className?: string;
  readonly text?: string;
  readonly particleCount?: number;
  readonly glowColor?: string;
  readonly interactive?: boolean;
}

interface GlobeState {
  mode: 'sphere' | 'text';
  morphProgress: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  particles: any[];
  mouseX: number;
  mouseY: number;
  isHovering: boolean;
  rotY: number;
  rotX: number;
  breathPhase: number;
}

export function ParticleGlobe({
  className = '',
  text = 'Nucleus',
  particleCount = 1800,
  glowColor = 'rgba(145, 255, 235, 1)',
  interactive = true,
}: ParticleGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const stateRef = useRef<GlobeState>({
    mode: 'sphere',
    morphProgress: 0,
    particles: [],
    mouseX: 0,
    mouseY: 0,
    isHovering: false,
    rotY: 0,
    rotX: 0,
    breathPhase: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Capture non-null references for use in closures
    const cvs = canvas;
    const c = ctx;

    const state = stateRef.current;
    const PERSPECTIVE = 700;
    const LERP_SPEED = 0.18;
    const ROTATION_SPEED = 0.002;
    const BREATH_SPEED = 0.008;
    const BREATH_AMOUNT = 0.03;
    const NOISE_AMOUNT = 0.4;

    // --- Particle ---
    class Particle {
      sx: number;
      sy: number;
      sz: number;
      tx: number;
      ty: number;
      tz: number;
      x: number;
      y: number;
      z: number;
      size: number;
      alpha: number;
      shimmerOffset: number;
      shimmerSpeed: number;

      constructor(sx: number, sy: number, sz: number) {
        this.sx = sx;
        this.sy = sy;
        this.sz = sz;
        this.tx = sx;
        this.ty = sy;
        this.tz = sz;
        this.x = sx;
        this.y = sy;
        this.z = sz;
        this.size = 1.2 + Math.random() * 0.8;
        this.alpha = 0.4 + Math.random() * 0.6;
        this.shimmerOffset = Math.random() * Math.PI * 2;
        this.shimmerSpeed = 0.01 + Math.random() * 0.02;
      }

      update(time: number, breathScale: number) {
        const target =
          state.mode === 'sphere'
            ? { x: this.sx * breathScale, y: this.sy * breathScale, z: this.sz * breathScale }
            : { x: this.tx, y: this.ty, z: this.tz };

        const noise = Math.sin(time * this.shimmerSpeed + this.shimmerOffset) * NOISE_AMOUNT;

        this.x += (target.x + noise - this.x) * LERP_SPEED;
        this.y += (target.y + noise - this.y) * LERP_SPEED;
        this.z += (target.z - this.z) * LERP_SPEED;
      }
    }

    // --- Build sphere positions ---
    function buildSpherePositions(count: number, radius: number): Array<{ x: number; y: number; z: number }> {
      const positions: Array<{ x: number; y: number; z: number }> = [];
      const goldenRatio = (1 + Math.sqrt(5)) / 2;
      for (let i = 0; i < count; i++) {
        const theta = Math.acos(1 - (2 * (i + 0.5)) / count);
        const phi = (2 * Math.PI * i) / goldenRatio;
        positions.push({
          x: radius * Math.sin(theta) * Math.cos(phi),
          y: radius * Math.sin(theta) * Math.sin(phi),
          z: radius * Math.cos(theta),
        });
      }
      return positions;
    }

    // --- Build text targets ---
    function buildTextTargets(
      word: string,
      count: number,
      canvasWidth: number,
    ): Array<{ x: number; y: number; z: number }> {
      const offscreen = document.createElement('canvas');
      const fontSize = Math.min(canvasWidth * 0.18, 180);
      offscreen.width = canvasWidth;
      offscreen.height = fontSize * 2;
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) return [];

      offCtx.fillStyle = '#fff';
      offCtx.font = `bold ${fontSize}px "Inter", "SF Pro Display", system-ui, sans-serif`;
      offCtx.textAlign = 'center';
      offCtx.textBaseline = 'middle';
      offCtx.fillText(word, offscreen.width / 2, offscreen.height / 2);

      const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
      const pixels = imageData.data;
      const hitPoints: Array<{ x: number; y: number }> = [];

      const step = 3;
      for (let py = 0; py < offscreen.height; py += step) {
        for (let px = 0; px < offscreen.width; px += step) {
          const idx = (py * offscreen.width + px) * 4;
          if (pixels[idx + 3] > 128) {
            hitPoints.push({
              x: px - offscreen.width / 2,
              y: py - offscreen.height / 2,
            });
          }
        }
      }

      const targets: Array<{ x: number; y: number; z: number }> = [];
      for (let i = 0; i < count; i++) {
        if (hitPoints.length === 0) {
          targets.push({ x: 0, y: 0, z: (Math.random() - 0.5) * 20 });
        } else {
          const pt = hitPoints[i % hitPoints.length];
          targets.push({
            x: pt.x,
            y: pt.y,
            z: (Math.random() - 0.5) * 30,
          });
        }
      }
      return targets;
    }

    // --- Resize ---
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cvs.width = cvs.clientWidth * dpr;
      cvs.height = cvs.clientHeight * dpr;
      c.scale(dpr, dpr);
    }

    // --- Init particles ---
    function initParticles() {
      const w = cvs.clientWidth;
      const h = cvs.clientHeight;
      const radius = Math.min(w, h) * 0.3;
      const spherePos = buildSpherePositions(particleCount, radius);
      const textTargets = buildTextTargets(text, particleCount, w);

      state.particles = spherePos.map((pos, i) => {
        const p = new Particle(pos.x, pos.y, pos.z);
        if (textTargets[i]) {
          p.tx = textTargets[i].x;
          p.ty = textTargets[i].y;
          p.tz = textTargets[i].z;
        }
        return p;
      });
    }

    // --- Rotate point ---
    function rotateY(x: number, z: number, angle: number): { x: number; z: number } {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return { x: x * cos - z * sin, z: x * sin + z * cos };
    }

    function rotateX(y: number, z: number, angle: number): { y: number; z: number } {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return { y: y * cos - z * sin, z: y * sin + z * cos };
    }

    // --- Render ---
    let time = 0;

    function render() {
      const w = cvs.clientWidth;
      const h = cvs.clientHeight;

      time += 1;
      state.rotY += ROTATION_SPEED;
      state.rotX = Math.sin(time * 0.001) * 0.15;
      state.breathPhase += BREATH_SPEED;
      const breathScale = 1 + Math.sin(state.breathPhase) * BREATH_AMOUNT;

      c.clearRect(0, 0, w, h);

      // Background radial glow
      const bgGrad = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
      bgGrad.addColorStop(0, 'rgba(0, 40, 40, 0.25)');
      bgGrad.addColorStop(0.5, 'rgba(0, 15, 20, 0.1)');
      bgGrad.addColorStop(1, 'transparent');
      c.fillStyle = bgGrad;
      c.fillRect(0, 0, w, h);

      // Update and project particles
      const projected: Array<{
        screenX: number;
        screenY: number;
        scale: number;
        alpha: number;
        size: number;
        depth: number;
      }> = [];

      for (const p of state.particles) {
        p.update(time, breathScale);

        // Apply rotation
        const ry = rotateY(p.x, p.z, state.rotY);
        const rx = rotateX(p.y, ry.z, state.rotX);

        const depth = rx.z;
        const projScale = PERSPECTIVE / (PERSPECTIVE + depth);
        const screenX = w / 2 + ry.x * projScale;
        const screenY = h / 2 + rx.y * projScale;

        // Shimmer
        const shimmer = 0.7 + 0.3 * Math.sin(time * p.shimmerSpeed + p.shimmerOffset);

        // Mouse proximity boost
        let proximityBoost = 0;
        if (state.isHovering) {
          const dx = screenX - state.mouseX;
          const dy = screenY - state.mouseY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            proximityBoost = (1 - dist / 120) * 0.5;
          }
        }

        projected.push({
          screenX,
          screenY,
          scale: projScale,
          alpha: p.alpha * shimmer * projScale + proximityBoost,
          size: p.size * projScale,
          depth,
        });
      }

      // Sort by depth (back to front)
      projected.sort((a, b) => b.depth - a.depth);

      // Draw particles
      c.shadowColor = glowColor;

      for (const pt of projected) {
        const a = Math.min(pt.alpha, 1);
        c.globalAlpha = a;
        c.shadowBlur = 6 * pt.scale;

        c.beginPath();
        c.arc(pt.screenX, pt.screenY, Math.max(pt.size, 0.5), 0, Math.PI * 2);
        c.fillStyle = glowColor;
        c.fill();
      }

      // Reset
      c.globalAlpha = 1;
      c.shadowBlur = 0;

      animationRef.current = requestAnimationFrame(render);
    }

    // --- Event handlers ---
    function handleResize() {
      resize();
      initParticles();
    }

    function handleMouseMove(e: MouseEvent) {
      const rect = cvs.getBoundingClientRect();
      state.mouseX = e.clientX - rect.left;
      state.mouseY = e.clientY - rect.top;
      state.isHovering = true;
    }

    function handleMouseLeave() {
      state.isHovering = false;
    }

    function handleClick() {
      if (!interactive) return;
      state.mode = state.mode === 'sphere' ? 'text' : 'sphere';
    }

    // --- Bootstrap ---
    resize();
    initParticles();
    animationRef.current = requestAnimationFrame(render);

    window.addEventListener('resize', handleResize);
    cvs.addEventListener('mousemove', handleMouseMove);
    cvs.addEventListener('mouseleave', handleMouseLeave);
    cvs.addEventListener('click', handleClick);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', handleResize);
      cvs.removeEventListener('mousemove', handleMouseMove);
      cvs.removeEventListener('mouseleave', handleMouseLeave);
      cvs.removeEventListener('click', handleClick);
    };
  }, [particleCount, text, glowColor, interactive]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}
