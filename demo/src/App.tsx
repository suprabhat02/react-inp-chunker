import { BlockingVsChunked } from './BlockingVsChunked';
import { DeferredDemo } from './DeferredDemo';
import { Heartbeat } from './Heartbeat';

export default function App() {
  return (
    <main>
      <header>
        <h1>react-inp-chunker</h1>
        <p>
          Headless React hooks that chunk heavy synchronous work and yield to
          the main thread, so a long update never costs you Interaction to
          Next Paint.{' '}
          <a href="https://github.com/suprabhat02/react-inp-chunker">
            Source &amp; docs on GitHub
          </a>
          .
        </p>
      </header>

      <Heartbeat />
      <BlockingVsChunked />
      <DeferredDemo />
    </main>
  );
}
