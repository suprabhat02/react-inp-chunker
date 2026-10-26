import { LINKS } from '../content/site.ts';

import './sections.css';

const STEPS = [
  {
    title: 'Work for one slice',
    body: 'Process items until the time slice is used up: 5 ms by default.',
  },
  {
    title: 'Yield',
    body: 'Hand the main thread back to the browser.',
  },
  {
    title: 'Let the browser respond',
    body: 'It runs the clicks and key presses waiting in line, and paints a frame if one is due.',
  },
  {
    title: 'Resume',
    body: 'Pick up at the next item. Repeat until everything is done.',
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="section" aria-labelledby="how-title">
      <div className="container">
        <div className="section__head">
          <h2 id="how-title">How it works</h2>
          <p>
            The same work, cut into slices. After each slice the browser gets the thread
            back, then the work carries on exactly where it stopped.
          </p>
        </div>

        <ol className="loop">
          {STEPS.map((step) => (
            <li key={step.title} className="loop__step">
              <h3 className="loop__title">{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="split split--even">
          <div className="prose">
            <h3 className="subhead">How it yields</h3>
            <p>It uses the best tool each browser has, in this order:</p>
            <ol className="fallbacks">
              <li>
                <a href={LINKS.schedulerYield}>
                  <code>scheduler.yield()</code>
                </a>{' '}
                in Chrome 129+, Edge 129+ and Firefox 142+. It's made for exactly this:
                your work resumes ahead of other queued tasks.
              </li>
              <li>
                A <code>MessageChannel</code> message in Safari and older browsers. Unlike
                nested timers, it isn't held back to a 4 ms minimum.
              </li>
              <li>
                <code>setTimeout(0)</code> as the last resort.
              </li>
            </ol>
            <p>
              And where the browser can say that input is waiting, through{' '}
              <code>navigator.scheduling.isInputPending()</code>, it yields early: the
              moment input arrives, not at the end of the slice.
            </p>
          </div>

          <div className="prose">
            <h3 className="subhead">What you get</h3>
            <ul className="checks">
              <li>
                <strong>Progress you can show.</strong> <code>processed</code> and{' '}
                <code>total</code> update once per slice, not once per item, so rendering
                them stays cheap.
              </li>
              <li>
                <strong>Pause, resume and cancel</strong>, at any point.
              </li>
              <li>
                <strong>Cleanup you don't write.</strong> Unmounting, or passing new
                items, cancels the old run. No state updates after unmount.
              </li>
              <li>
                <strong>Server rendering.</strong> Hooks render an idle state on the
                server and only start working in the browser.
              </li>
              <li>
                <strong>Plain TypeScript underneath.</strong> The engine in{' '}
                <code>react-inp-chunker/core</code> works without React.
              </li>
            </ul>
          </div>
        </div>

        <p className="tradeoff">
          <strong>The trade-off:</strong> the work takes a little longer in total, because
          the browser does other things in between. A few extra milliseconds overall, in
          exchange for a page that never stops responding.
        </p>
      </div>
    </section>
  );
}
