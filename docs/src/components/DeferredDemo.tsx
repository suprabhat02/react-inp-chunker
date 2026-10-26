import { useEffect, useRef, useState } from 'react';
import { useDeferredTask } from 'react-inp-chunker';

import { drawMandelbrot } from '../examples/mandelbrot.ts';
import mandelbrotSource from '../examples/mandelbrot.ts?raw';
import { CodeBlock } from './CodeBlock.tsx';

import './deferred-demo.css';

type Rgb = readonly [number, number, number];

/**
 * The page's own colors, turned into RGB for ImageData by letting the
 * canvas resolve them: CSS custom properties hold OKLCH, which ImageData
 * can't take directly.
 */
function themePalette(steps: number): readonly Rgb[] {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => styles.getPropertyValue(name).trim() || '#808080';
  const canvas = document.createElement('canvas');
  canvas.width = steps;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return [[0, 0, 0]];
  const gradient = context.createLinearGradient(0, 0, steps, 0);
  gradient.addColorStop(0, color('--bg-sunken'));
  gradient.addColorStop(0.45, color('--accent'));
  gradient.addColorStop(0.8, color('--accent-2'));
  gradient.addColorStop(1, color('--text'));
  context.fillStyle = gradient;
  context.fillRect(0, 0, steps, 1);
  const pixels = context.getImageData(0, 0, steps, 1).data;
  const ramp: Rgb[] = [];
  for (let i = 0; i < steps; i++) {
    ramp.push([pixels[i * 4] ?? 0, pixels[i * 4 + 1] ?? 0, pixels[i * 4 + 2] ?? 0]);
  }
  // Index 0 is the inside of the set, drawn in the page's own background.
  return [ramp[0] ?? [0, 0, 0], ...ramp];
}

export function DeferredDemo() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);
  const pendingStart = useRef(false);

  const drawing = useDeferredTask(
    () => {
      const element = canvas.current;
      if (element === null) throw new Error('The canvas is not mounted.');
      return drawMandelbrot(element, themePalette(128));
    },
    [run],
    { autoStart: false },
  );
  const { start } = drawing;

  useEffect(() => {
    if (!pendingStart.current) return;
    pendingStart.current = false;
    start();
  }, [run, start]);

  const draw = () => {
    const element = canvas.current;
    element?.getContext('2d')?.clearRect(0, 0, element.width, element.height);
    pendingStart.current = true;
    setRun((value) => value + 1);
  };

  return (
    <div className="deferred-demo">
      <div className="deferred-demo__stage">
        <canvas
          ref={canvas}
          className="deferred-demo__canvas"
          width={960}
          height={600}
          role="img"
          aria-label="A detail of the Mandelbrot set, drawn row by row"
        />
        <div className="deferred-demo__controls">
          <button
            type="button"
            className="button button--primary"
            onClick={draw}
            disabled={drawing.isProcessing || drawing.isPaused}
          >
            {drawing.isDone || drawing.isCancelled ? 'Draw again' : 'Draw'}
          </button>
          <button
            type="button"
            className="button"
            onClick={drawing.pause}
            disabled={!drawing.isProcessing}
          >
            Pause
          </button>
          <button
            type="button"
            className="button"
            onClick={drawing.resume}
            disabled={!drawing.isPaused}
          >
            Resume
          </button>
          <button
            type="button"
            className="button"
            onClick={drawing.cancel}
            disabled={!drawing.isProcessing && !drawing.isPaused}
          >
            Cancel
          </button>
          <p className="deferred-demo__status" role="status">
            {drawing.isIdle && run === 0
              ? 'Press Draw, then try scrolling or typing while it draws.'
              : null}
            {drawing.isProcessing ? 'Drawing, one row per slice…' : null}
            {drawing.isPaused ? 'Paused. Nothing runs until you resume.' : null}
            {drawing.isDone ? `Done: ${String(drawing.value)} rows drawn.` : null}
            {drawing.isCancelled ? 'Cancelled.' : null}
            {drawing.isError ? "Couldn't draw." : null}
          </p>
        </div>
      </div>
      <details className="deferred-demo__source">
        <summary>The generator behind this demo</summary>
        <CodeBlock
          code={mandelbrotSource.trim()}
          title="mandelbrot.ts"
          copyLabel="Mandelbrot generator"
        />
      </details>
    </div>
  );
}
