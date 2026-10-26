import { useEffect, useRef, useState } from 'react';

/**
 * The actual proof this demo exists to show. A pure-CSS animation would
 * keep running on the compositor thread even while JS blocks the main
 * thread — which would make for a nice-looking but dishonest demo. This
 * ticks a counter from a requestAnimationFrame loop instead: it can only
 * advance when the main thread is free to run JS. If a "blocking" run
 * below ever cedes the thread, this stalls. If a "chunked" run yields
 * properly, this keeps ticking right through it.
 */
export function Heartbeat() {
  const [frames, setFrames] = useState(0);
  const lastTickAt = useRef<number | null>(null);
  const [worstGapMs, setWorstGapMs] = useState(0);

  useEffect(() => {
    let rafId: number;
    const tick = (now: number) => {
      // A gap only exists once there's a previous tick to measure from —
      // on the very first frame there's nothing to compare against, so
      // skip recording one rather than measuring against an arbitrary
      // ref-init timestamp (which would itself be a render-time read of
      // performance.now(), the exact impure-render pattern this avoids).
      if (lastTickAt.current !== null) {
        const gap = now - lastTickAt.current;
        setWorstGapMs((worst) => Math.max(worst, gap));
      }
      lastTickAt.current = now;
      setFrames((f) => f + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className="heartbeat">
      <span className="heartbeat__dot" aria-hidden="true" />
      <span>
        Main thread heartbeat: <strong>{frames}</strong> frames
      </span>
      <span className="heartbeat__gap">
        worst gap so far: <strong>{worstGapMs.toFixed(0)}ms</strong>
      </span>
      <button
        type="button"
        className="heartbeat__reset"
        onClick={() => {
          setWorstGapMs(0);
        }}
      >
        reset worst gap
      </button>
    </div>
  );
}
