import { InpScale } from '../components/InpScale.tsx';
import { LINKS } from '../content/site.ts';

import './sections.css';

export function Why() {
  return (
    <section id="why" className="section" aria-labelledby="why-title">
      <div className="container">
        <div className="section__head">
          <h2 id="why-title">Why your UI freezes</h2>
          <p>
            One thread runs your JavaScript, handles every click and key press, and paints
            the screen. It can only do one of those at a time.
          </p>
        </div>

        <div className="split">
          <div className="prose">
            <p>
              While a function runs, everything else waits. Filter 20,000 rows, parse a
              large CSV or build a search index, and the main thread can be busy for
              hundreds of milliseconds. A click in that window sits in a queue. Typed
              characters don't appear. Spinners stop spinning.
            </p>
            <p>
              Browsers call any task over 50 ms a <a href={LINKS.longTasks}>long task</a>.
              Your users call it a frozen page.
            </p>

            <h3 className="subhead">What INP measures</h3>
            <p>
              <a href={LINKS.inp}>Interaction to Next Paint (INP)</a> is the Core Web
              Vital for responsiveness. For each click, tap or key press, it measures the
              time until the screen shows the result, and it reports one of the slowest of
              the whole visit. An interaction that lands during a long task has to wait
              for that task to end, which is the most common way to fail it.
            </p>
            <InpScale />
          </div>

          <div className="callout">
            <h3 id="culprits-title" className="callout__title">
              Work that typically causes it
            </h3>
            <ul className="callout__list">
              <li>Filtering, sorting or grouping thousands of rows in the browser</li>
              <li>Parsing CSV, JSON or Markdown you just loaded</li>
              <li>Building a search index, or diffing two documents</li>
              <li>Computing chart data or a layout</li>
              <li>Highlighting, formatting or validating a long document</li>
            </ul>
          </div>
        </div>

        <div className="objective">
          <h3 className="objective__title">What this library is for</h3>
          <p>
            One job: let that work happen without blocking the person using your app.
            react-inp-chunker doesn't make the work faster. It makes sure the work never
            holds the main thread for more than a few milliseconds at a time, so the
            browser can answer the user in between.
          </p>
        </div>
      </div>
    </section>
  );
}
