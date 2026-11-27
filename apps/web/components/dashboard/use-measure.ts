'use client';

import { useEffect, useRef, useState } from 'react';

/** Width of an element, tracked with a ResizeObserver (so SVG charts draw in real pixels). */
export function useMeasuredWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Calls `fn` at most once per `ms` (for sound ticks fired by many marks at once). */
export function makeThrottle(ms: number) {
  let last = 0;
  return (fn: () => void) => {
    const now = performance.now();
    if (now - last < ms) return;
    last = now;
    fn();
  };
}
