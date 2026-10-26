import { Playground } from '../playground/Playground.tsx';

export function PlaygroundSection() {
  return (
    <section id="playground" className="section" aria-labelledby="playground-title">
      <div className="container">
        <div className="section__head">
          <h2 id="playground-title">Playground</h2>
          <p>
            Feel the difference before reading any code. Run the same work both ways, and
            type in the box while it runs. Every number here is measured live, in your
            browser.
          </p>
        </div>
        <Playground />
      </div>
    </section>
  );
}
