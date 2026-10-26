import { TableWrap } from '../components/TableWrap.tsx';
import { LINKS } from '../content/site.ts';

import './sections.css';

const CHOICES = [
  {
    situation: 'Your own JavaScript over a big list: filter, score, parse, format',
    answer: 'useChunkedTask',
    isThis: true,
  },
  {
    situation:
      "A long computation that isn't a list: a multi-pass algorithm, a layout, a canvas",
    answer: 'useDeferredTask',
    isThis: true,
  },
  {
    situation:
      'Pure number crunching on data you can hand to another thread, with no DOM access',
    answer:
      'A Web Worker. It runs in parallel, so the main thread never does the work at all',
    isThis: false,
  },
  {
    situation: 'React re-rendering a large tree',
    answer: 'startTransition or useDeferredValue',
    isThis: false,
  },
  {
    situation: 'Thousands of DOM nodes',
    answer: 'Virtualize the list, and render only what is on screen',
    isThis: false,
  },
  {
    situation: 'The same result for every user',
    answer: 'Compute it on the server or at build time',
    isThis: false,
  },
] as const;

const FAQ = [
  {
    question: 'Does it make my code faster?',
    answer:
      'No. The total time grows slightly, because the browser does other things in between. What changes is that the page keeps responding while the work runs.',
  },
  {
    question: 'Which time slice should I use?',
    answer:
      'Start with the default, 5 ms. Raise it to finish sooner with fewer pauses; lower it if typing still feels sticky. Keep it well under 50 ms, the point where a slice becomes a long task itself.',
  },
  {
    question: 'What if a single item takes 100 ms?',
    answer:
      'Then it blocks for 100 ms: pauses only happen between items. Break the item into smaller steps, or move it to useDeferredTask and yield inside it.',
  },
  {
    question: 'Does it work with server rendering?',
    answer:
      'Yes. On the server, both hooks render an idle state and never run your function. The work starts in the browser, inside an effect.',
  },
  {
    question: 'What happens when the component unmounts?',
    answer:
      'The task is cancelled. No more work runs, and no state updates happen after unmount.',
  },
  {
    question: 'Does it work in Safari?',
    answer:
      "Yes. Safari doesn't have scheduler.yield() yet, so the library yields with a MessageChannel message instead. Same behavior, with slightly less control over priority.",
  },
  {
    question: 'Why might an animation stutter in Chrome while the work runs?',
    answer: (
      <>
        Chrome runs <code>scheduler.yield()</code> continuations ahead of routine
        rendering, and{' '}
        <a href={LINKS.chromiumRenderingPriority}>
          boosts rendering after a delay or after user input
        </a>
        . So while nothing needs the screen, it paints less often; clicks and key presses
        still get through between slices, and their result is painted right away. The
        browser is choosing to finish your work sooner.
      </>
    ),
  },
] as const;

export function WhenToUse() {
  return (
    <section id="when-to-use" className="section" aria-labelledby="when-title">
      <div className="container">
        <div className="section__head">
          <h2 id="when-title">When to use it, and when not to</h2>
          <p>
            Chunking is one tool for a slow page. Reach for it when the slow part is your
            own JavaScript, running on the main thread.
          </p>
        </div>

        <TableWrap label="Which tool fits which kind of slowness">
          <table className="choices">
            <caption className="visually-hidden">
              Which tool fits which kind of slowness
            </caption>
            <thead>
              <tr>
                <th scope="col">If the slow part is</th>
                <th scope="col">Reach for</th>
              </tr>
            </thead>
            <tbody>
              {CHOICES.map((choice) => (
                <tr
                  key={choice.situation}
                  className={choice.isThis ? 'is-this' : undefined}
                >
                  <th scope="row">{choice.situation}</th>
                  <td>{choice.isThis ? <code>{choice.answer}</code> : choice.answer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>

        <h3 className="subhead faq__title">Questions</h3>
        <dl className="faq">
          {FAQ.map((item) => (
            <div key={item.question} className="faq__item">
              <dt>{item.question}</dt>
              <dd>{item.answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
