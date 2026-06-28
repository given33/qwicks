// src/renderer-mqpet/src/useFrameLoop.ts
import { useEffect, useRef } from 'react';

// requestAnimationFrame loop calling cb(dtMs) every frame. cb is stable via ref.
export function useFrameLoop(cb: (dtMs: number) => void, active = true): void {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = now - last;
      last = now;
      cbRef.current(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}
