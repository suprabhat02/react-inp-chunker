import {
  type ApiRow,
  CHUNKED_ARGS,
  CHUNKED_OPTIONS,
  CHUNKED_RETURNS,
  CORE_EXPORTS,
  DEFERRED_ARGS,
  DEFERRED_RETURNS,
  STATUSES,
} from '../content/api.ts';

import { TableWrap } from '../components/TableWrap.tsx';

import './sections.css';

function ApiTable({
  caption,
  rows,
  showDefaults = false,
}: {
  readonly caption: string;
  readonly rows: readonly ApiRow[];
  readonly showDefaults?: boolean;
}) {
  return (
    <TableWrap label={caption}>
      <table className="api-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            {showDefaults ? <th scope="col">Default</th> : null}
            <th scope="col">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>
                <code>{row.name}</code>
              </td>
              <td>
                <code>{row.type}</code>
              </td>
              {showDefaults ? (
                <td>
                  {row.defaultValue !== undefined ? <code>{row.defaultValue}</code> : '—'}
                </td>
              ) : null}
              <td>{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function ApiReference() {
  return (
    <section id="api" className="section" aria-labelledby="api-title">
      <div className="container">
        <div className="section__head">
          <h2 id="api-title">API</h2>
          <p>
            Two hooks from <code>react-inp-chunker</code>, and the engine underneath them
            from <code>react-inp-chunker/core</code>.
          </p>
        </div>

        <div className="api">
          <article className="api__entry" aria-labelledby="api-chunked">
            <h3 id="api-chunked" className="api__signature">
              <code>useChunkedTask(items, processItem, options?)</code>
            </h3>
            <p>Runs a function over every item of an array, in slices.</p>
            <h4 className="api__table-title">Arguments</h4>
            <ApiTable
              caption="useChunkedTask arguments"
              rows={CHUNKED_ARGS}
              showDefaults
            />
            <h4 className="api__table-title">Options</h4>
            <ApiTable
              caption="useChunkedTask options"
              rows={CHUNKED_OPTIONS}
              showDefaults
            />
            <h4 className="api__table-title">Returns</h4>
            <ApiTable caption="useChunkedTask return value" rows={CHUNKED_RETURNS} />
          </article>

          <article className="api__entry" aria-labelledby="api-deferred">
            <h3 id="api-deferred" className="api__signature">
              <code>useDeferredTask(task, deps, options?)</code>
            </h3>
            <p>Runs a generator function in slices, pausing only at its yields.</p>
            <h4 className="api__table-title">Arguments</h4>
            <ApiTable
              caption="useDeferredTask arguments"
              rows={DEFERRED_ARGS}
              showDefaults
            />
            <h4 className="api__table-title">Returns</h4>
            <ApiTable caption="useDeferredTask return value" rows={DEFERRED_RETURNS} />
          </article>

          <article className="api__entry" aria-labelledby="api-status">
            <h3 id="api-status" className="api__signature">
              Status
            </h3>
            <p>
              Every task is used once. It starts <code>idle</code> or{' '}
              <code>processing</code>, and ends in exactly one of <code>done</code>,{' '}
              <code>cancelled</code> or <code>error</code>. To run again, give the hook
              new inputs.
            </p>
            <p className="lifecycle" aria-label="Status flow">
              <code>idle</code> → <code>processing</code> ⇄ <code>paused</code> →{' '}
              <code>done</code> | <code>cancelled</code> | <code>error</code>
            </p>
            <TableWrap label="Statuses">
              <table>
                <caption className="visually-hidden">Statuses</caption>
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {STATUSES.map((entry) => (
                    <tr key={entry.status}>
                      <td>
                        <code>{entry.status}</code>
                      </td>
                      <td>{entry.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </article>

          <article className="api__entry" aria-labelledby="api-core">
            <h3 id="api-core" className="api__signature">
              <code>react-inp-chunker/core</code>
            </h3>
            <p>
              No React import anywhere in it. Use it in plain TypeScript, in a Web Worker,
              or to build your own bindings.
            </p>
            <ApiTable caption="Core exports" rows={CORE_EXPORTS} />
          </article>
        </div>
      </div>
    </section>
  );
}
