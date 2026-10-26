import type { DeferredGenerator } from 'react-inp-chunker';

type Rgb = readonly [number, number, number];

const MAX_ITERATIONS = 3000;
/** The whole set. Every pixel inside it costs all 3,000 iterations. */
const VIEW = { left: -2.2, right: 0.8, top: 0.9375, bottom: -0.9375 };

/**
 * Draws the Mandelbrot set one row of pixels at a time, yielding after
 * every row. Each row is a few milliseconds of math, so the browser never
 * waits longer than that to handle input or paint a frame.
 */
export function* drawMandelbrot(
  canvas: HTMLCanvasElement,
  palette: readonly Rgb[],
): DeferredGenerator<number> {
  const context = canvas.getContext('2d');
  if (context === null) return 0;

  const { width, height } = canvas;
  const row = context.createImageData(width, 1);

  for (let y = 0; y < height; y++) {
    const ci = VIEW.top + ((VIEW.bottom - VIEW.top) * y) / height;
    for (let x = 0; x < width; x++) {
      const cr = VIEW.left + ((VIEW.right - VIEW.left) * x) / width;
      let zr = 0;
      let zi = 0;
      let i = 0;
      while (zr * zr + zi * zi < 4 && i < MAX_ITERATIONS) {
        const nextZr = zr * zr - zi * zi + cr;
        zi = 2 * zr * zi + ci;
        zr = nextZr;
        i++;
      }
      // palette[0] is the inside of the set; the rest is a ramp from dark to
      // bright, so points that take longer to escape glow brighter.
      const inside = i === MAX_ITERATIONS;
      const shade =
        1 + Math.floor((Math.log(i) / Math.log(MAX_ITERATIONS)) * (palette.length - 2));
      const [r, g, b] = palette[inside ? 0 : shade] ?? [0, 0, 0];
      const offset = x * 4;
      row.data[offset] = r;
      row.data[offset + 1] = g;
      row.data[offset + 2] = b;
      row.data[offset + 3] = 255;
    }
    context.putImageData(row, 0, y);
    yield; // a row is done: a safe place to pause
  }
  return height;
}
