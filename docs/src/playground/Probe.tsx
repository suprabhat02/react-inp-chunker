import { memo, useEffect, useId, useRef, useState } from 'react';

interface ProbeProps {
  /** Called with the input's own timestamp for every key press and pointer press. */
  readonly onInteraction: (eventTimeStamp: number) => void;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Things to poke while a run is going: a text box, a counter, and a dial
 * that moves on requestAnimationFrame. All three only respond when the
 * main thread is free. The dial is updated by writing straight to the
 * element on each frame, so watching it costs no React renders.
 */
export const Probe = memo(function Probe({ onInteraction }: ProbeProps) {
  const [clicks, setClicks] = useState(0);
  const [reduceMotion] = useState(prefersReducedMotion);
  const dial = useRef<HTMLSpanElement>(null);
  const inputId = useId();

  useEffect(() => {
    const element = dial.current;
    if (element === null) return;
    let frame = 0;
    let rafId = requestAnimationFrame(function turn(now) {
      frame += 1;
      if (reduceMotion) {
        // No spinning: a frame counter shows the same thing without motion.
        element.textContent = String(frame % 10_000).padStart(4, '0');
      } else {
        element.style.transform = `rotate(${((now / 4) % 360).toFixed(1)}deg)`;
      }
      rafId = requestAnimationFrame(turn);
    });
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [reduceMotion]);

  return (
    <div className="probe">
      <div className="probe__field">
        <label className="field-label" htmlFor={inputId}>
          Type here while it runs
        </label>
        <input
          id={inputId}
          className="text-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Keep typing"
          onKeyDown={(event) => {
            onInteraction(event.timeStamp);
          }}
        />
      </div>
      <button
        type="button"
        className="button probe__counter"
        onPointerDown={(event) => {
          onInteraction(event.timeStamp);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onInteraction(event.timeStamp);
        }}
        onClick={() => {
          setClicks((count) => count + 1);
        }}
      >
        Clicked <span className="probe__count">{clicks}</span> times
      </button>
      <div className="probe__dial-wrap">
        <span
          className={reduceMotion ? 'probe__dial probe__dial--counter' : 'probe__dial'}
          ref={dial}
          aria-hidden="true"
        />
        <span className="probe__dial-label">
          {reduceMotion ? 'Counts every frame' : 'Turns on every frame'}
        </span>
      </div>
    </div>
  );
});
