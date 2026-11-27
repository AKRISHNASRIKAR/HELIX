'use client';

import { useEffect, useRef } from 'react';

/**
 * A slowly rotating double helix of particles drawn on canvas. Data streams
 * (small dots with trails) flow in from the edges and dissolve into the
 * strands. The helix leans toward the pointer and particles near it are
 * pushed aside. Colours come from the theme tokens, re-read when the theme
 * changes, so it works in dark and light. Draws one still frame when the
 * viewer prefers reduced motion, and pauses while off screen.
 */

interface Stream {
  /** Start, control and end points of a quadratic curve (end is on the helix axis). */
  sx: number;
  sy: number;
  c: number;
  ey: number;
  p: number;
  speed: number;
  trail: { x: number; y: number }[];
}

function readColors() {
  const s = getComputedStyle(document.documentElement);
  // Fallback is the page text colour, so there is never a hard-coded colour.
  const text = getComputedStyle(document.body).color;
  const v = (name: string) => s.getPropertyValue(name).trim() || text;
  return { ink: v('--series-1'), muted: v('--series-2') };
}

export function HelixCanvas({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let colors = readColors();
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let visible = true;
    let t = 0;
    let last = performance.now();
    const pointer = { x: 0.5, y: 0.5, active: false, px: -9999, py: -9999 };
    const lean = { x: 0, y: 0 };
    const streams: Stream[] = [];

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) draw(0);
    };

    const spawn = () => {
      const fromLeft = Math.random() < 0.5;
      streams.push({
        sx: fromLeft ? -10 : w + 10,
        sy: Math.random() * h,
        c: (Math.random() - 0.5) * h * 0.6,
        ey: h * (0.15 + Math.random() * 0.7),
        p: 0,
        speed: 0.00035 + Math.random() * 0.00035,
        trail: [],
      });
    };

    function draw(dt: number) {
      ctx!.clearRect(0, 0, w, h);
      const cx = w * 0.5 + lean.x * 40;
      const radius = Math.min(w * 0.17, 120);
      const N = 64;
      const top = h * 0.06;
      const span = h * 0.88;
      const turns = 2.4;
      const tilt = lean.x * 0.35;

      // Strand points, with depth (z) for size and alpha.
      const a: { x: number; y: number; z: number }[] = [];
      const b: { x: number; y: number; z: number }[] = [];
      for (let i = 0; i < N; i++) {
        const p = i / (N - 1);
        const y0 = top + p * span;
        const ang = p * Math.PI * 2 * turns + t * 0.45;
        const xOff = (y0 - h / 2) * tilt * 0.3;
        for (const [list, phase] of [
          [a, 0],
          [b, Math.PI],
        ] as const) {
          let x = cx + xOff + Math.cos(ang + phase) * radius;
          let y = y0 + lean.y * 18 * Math.sin(ang + phase);
          const z = Math.sin(ang + phase);
          // Push particles away from the pointer.
          const dx = x - pointer.px;
          const dy = y - pointer.py;
          const d2 = dx * dx + dy * dy;
          if (d2 < 9000) {
            const f = (1 - d2 / 9000) * 18;
            const d = Math.sqrt(d2) || 1;
            x += (dx / d) * f;
            y += (dy / d) * f;
          }
          list.push({ x, y, z });
        }
      }

      // Rungs between the strands.
      ctx!.lineWidth = 1;
      ctx!.strokeStyle = colors.muted;
      for (let i = 0; i < N; i += 3) {
        const p = a[i];
        const q = b[i];
        if (!p || !q) continue;
        const depth = (p.z + q.z) / 2;
        ctx!.globalAlpha = 0.08 + 0.12 * (1 - Math.abs(depth));
        ctx!.beginPath();
        ctx!.moveTo(p.x, p.y);
        ctx!.lineTo(q.x, q.y);
        ctx!.stroke();
        // A small "packet" sliding along some rungs.
        if (i % 9 === 0) {
          const k = (Math.sin(t * 1.4 + i) + 1) / 2;
          ctx!.globalAlpha = 0.5;
          ctx!.fillStyle = colors.ink;
          ctx!.beginPath();
          ctx!.arc(p.x + (q.x - p.x) * k, p.y + (q.y - p.y) * k, 1.4, 0, Math.PI * 2);
          ctx!.fill();
        }
      }

      // Strand particles, back to front.
      const all = [...a, ...b].sort((m, n) => m.z - n.z);
      for (const p of all) {
        const near = (p.z + 1) / 2; // 0 back .. 1 front
        ctx!.globalAlpha = 0.18 + near * 0.82;
        ctx!.fillStyle = near > 0.5 ? colors.ink : colors.muted;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, 1.1 + near * 2.4, 0, Math.PI * 2);
        ctx!.fill();
      }

      // Data streams flowing into the helix.
      for (let i = streams.length - 1; i >= 0; i--) {
        const st = streams[i];
        if (!st) continue;
        st.p += st.speed * dt;
        if (st.p >= 1) {
          streams.splice(i, 1);
          continue;
        }
        const u = st.p;
        const mx = (st.sx + cx) / 2;
        const my = (st.sy + st.ey) / 2 + st.c;
        const x = (1 - u) * (1 - u) * st.sx + 2 * (1 - u) * u * mx + u * u * cx;
        const y = (1 - u) * (1 - u) * st.sy + 2 * (1 - u) * u * my + u * u * st.ey;
        st.trail.push({ x, y });
        if (st.trail.length > 22) st.trail.shift();
        // Fade out as the stream reaches the helix: the data "joins" it.
        const life = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
        ctx!.strokeStyle = colors.ink;
        for (let j = 1; j < st.trail.length; j++) {
          const from = st.trail[j - 1]!;
          const to = st.trail[j]!;
          ctx!.globalAlpha = (j / st.trail.length) * 0.35 * life;
          ctx!.beginPath();
          ctx!.moveTo(from.x, from.y);
          ctx!.lineTo(to.x, to.y);
          ctx!.stroke();
        }
        ctx!.globalAlpha = 0.9 * life;
        ctx!.fillStyle = colors.ink;
        ctx!.beginPath();
        ctx!.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min(48, now - last);
      last = now;
      t += dt / 1000;
      const tx = pointer.active ? (pointer.x - 0.5) * 2 : 0;
      const ty = pointer.active ? (pointer.y - 0.5) * 2 : 0;
      lean.x += (tx - lean.x) * 0.04;
      lean.y += (ty - lean.y) * 0.04;
      if (streams.length < 12 && Math.random() < 0.04) spawn();
      draw(dt);
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.px = e.clientX - r.left;
      pointer.py = e.clientY - r.top;
      pointer.x = pointer.px / r.width;
      pointer.y = pointer.py / r.height;
      pointer.active = pointer.x >= 0 && pointer.x <= 1 && pointer.y >= 0 && pointer.y <= 1;
      if (!pointer.active) {
        pointer.px = -9999;
        pointer.py = -9999;
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    io.observe(canvas);
    const mo = new MutationObserver(() => {
      colors = readColors();
      if (reduce) draw(0);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    resize();
    if (reduce) {
      t = 1.2;
      draw(0);
    } else {
      window.addEventListener('pointermove', onMove, { passive: true });
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return <canvas ref={ref} className={`block h-full w-full ${className}`} aria-hidden />;
}
