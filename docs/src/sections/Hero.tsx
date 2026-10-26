import { HeroTrace } from '../components/HeroTrace.tsx';
import { InstallCommand } from '../components/InstallCommand.tsx';

import './hero.css';

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="container">
        <div className="hero__intro">
          <h1 id="hero-title" className="hero__title">
            Run heavy JavaScript without freezing your React app.
          </h1>
          <p className="hero__lede">
            react-inp-chunker splits long-running work into slices of a few milliseconds
            and hands the main thread back to the browser between them. Clicks, typing and
            scrolling stay instant while the work runs, and your Interaction to Next Paint
            (INP) stays in the green.
          </p>
          <div className="hero__actions">
            <InstallCommand />
            <a className="button button--primary" href="#playground">
              Open the playground
            </a>
            <a className="button" href="#get-started">
              Read the guide
            </a>
          </div>
          <p className="hero__facts">
            For React 18 and 19. About 2 kB compressed, no dependencies, TypeScript types
            included, safe to server-render.
          </p>
        </div>
        <HeroTrace />
      </div>
    </section>
  );
}
