import { CodeBlock } from '../components/CodeBlock.tsx';
import { DeferredDemo } from '../components/DeferredDemo.tsx';
import { InstallCommand } from '../components/InstallCommand.tsx';
import chunkedBasic from '../examples/chunked-basic.tsx?raw';
import chunkedControls from '../examples/chunked-controls.tsx?raw';
import coreBasic from '../examples/core-basic.ts?raw';
import deferredBasic from '../examples/deferred-basic.tsx?raw';
import { displaySource } from '../lib/highlight.ts';

import './sections.css';

export function GetStarted() {
  return (
    <section id="get-started" className="section" aria-labelledby="get-started-title">
      <div className="container">
        <div className="section__head">
          <h2 id="get-started-title">Get started</h2>
          <p>Install it, then hand the slow part of a component to a hook.</p>
        </div>

        <div className="guide">
          <div className="guide__block">
            <div className="prose">
              <h3>Install</h3>
              <p>
                Works with React 18 and 19, any bundler, ESM or CommonJS. TypeScript types
                are included, and there are no other dependencies.
              </p>
            </div>
            <div>
              <InstallCommand />
            </div>
          </div>

          <div className="guide__block">
            <div className="prose">
              <h3>Process a list</h3>
              <p>
                Give <code>useChunkedTask</code> your items and the function to run on
                each one. It starts right away and works in slices; your component
                re-renders with progress after each slice, and gets every result when it's
                done.
              </p>
              <ul>
                <li>
                  Keep <code>rows</code> stable. A new array means new work, so the task
                  starts over. Wrap derived arrays in <code>useMemo</code>.
                </li>
                <li>
                  <code>scoreRow</code> can be a new function on every render. The hook
                  always calls the latest one, without restarting.
                </li>
              </ul>
            </div>
            <CodeBlock code={displaySource(chunkedBasic)} title="ScoredRows.tsx" />
          </div>

          <div className="guide__block">
            <div className="prose">
              <h3>Start it yourself, pause, cancel</h3>
              <p>
                With <code>autoStart: false</code>, nothing runs until you call{' '}
                <code>start()</code>. <code>onItem</code> hands you each result as it's
                made, so you can stream results instead of waiting for the end.
              </p>
            </div>
            <CodeBlock code={displaySource(chunkedControls)} title="CsvExport.tsx" />
          </div>

          <div className="guide__block">
            <div className="prose">
              <h3>Work that isn't a list</h3>
              <p>
                For a long computation that isn't one function over an array, use{' '}
                <code>useDeferredTask</code> with a generator, and write{' '}
                <code>yield</code> wherever it's safe to pause. The code from one{' '}
                <code>yield</code> to the next runs in one go; the hook decides when to
                actually pause, based on the time slice.
              </p>
            </div>
            <CodeBlock code={displaySource(deferredBasic)} title="SearchStatus.tsx" />
          </div>

          <div className="guide__block guide__block--wide">
            <div className="prose">
              <h3>Try it: a canvas drawn in slices</h3>
              <p>
                This is <code>useDeferredTask</code> drawing the Mandelbrot set, one row
                of pixels per <code>yield</code>. Pause it halfway, or scroll and type
                while it draws.
              </p>
            </div>
            <DeferredDemo />
          </div>

          <div className="guide__block">
            <div className="prose">
              <h3>Without React</h3>
              <p>
                The same engine, from <code>react-inp-chunker/core</code>: for plain
                TypeScript, a Web Worker, or a Node script.
              </p>
            </div>
            <CodeBlock code={displaySource(coreBasic)} title="score-rows.ts" />
          </div>

          <div className="guide__block guide__block--wide">
            <div className="prose">
              <h3>Good to know</h3>
            </div>
            <ul className="tips">
              <li>
                <strong>Keep each item small.</strong> Pauses can only happen between
                items. An item that takes 100 ms still blocks for 100 ms: split it into
                smaller steps, or move it to <code>useDeferredTask</code> and{' '}
                <code>yield</code> inside it.
              </li>
              <li>
                <strong>Start with the default slice.</strong> 5 ms is close to what
                React's own scheduler uses. A bigger slice finishes sooner with fewer
                pauses; keep it well under 50 ms.
              </li>
              <li>
                <strong>Results arrive at the end.</strong> <code>results</code> is set
                once the task finishes. To use results while it's still running, take them
                from <code>onItem</code>.
              </li>
              <li>
                <strong>Errors become state.</strong> If your function throws, the task
                stops with <code>status: 'error'</code>, and what was thrown is in{' '}
                <code>error</code>.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
