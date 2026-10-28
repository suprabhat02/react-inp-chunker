import { CodeBlock } from '../components/CodeBlock.tsx';
import { TableWrap } from '../components/TableWrap.tsx';
import { GUARANTEES, SIZES, SUPPORT } from '../content/production.ts';
import { LINKS } from '../content/site.ts';

import './sections.css';

const VERIFY_PROVENANCE = `# Every release is built in public and signed.
npm audit signatures
gh attestation verify "$(npm pack react-inp-chunker --silent)" \\
  -R suprabhat02/react-inp-chunker`;

export function Production() {
  return (
    <section id="production" className="section" aria-labelledby="production-title">
      <div className="container">
        <div className="section__head">
          <h2 id="production-title">Running it in production</h2>
          <p>
            What this package promises, what it costs, and how each claim is checked. Every
            row below corresponds to a job that runs on every push.
          </p>
        </div>

        <h3 className="subhead">What it supports</h3>
        <TableWrap label="Supported versions and how each is verified">
          <table className="support-table">
            <caption className="visually-hidden">
              Supported versions, and the check that proves each
            </caption>
            <thead>
              <tr>
                <th scope="col">Dependency</th>
                <th scope="col">Supported</th>
                <th scope="col">Proven by</th>
              </tr>
            </thead>
            <tbody>
              {SUPPORT.map((row) => (
                <tr key={row.what}>
                  <th scope="row">{row.what}</th>
                  <td>{row.supported}</td>
                  <td className="support-table__proof">{row.provenBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <p className="muted production__note">
          Dropping any of these is a breaking change. The{' '}
          <a href={LINKS.support}>support policy</a> has the versioning rules.
        </p>

        <div className="split split--even">
          <div className="prose">
            <h3 className="subhead">What it costs</h3>
            <TableWrap label="Bundle size">
              <table>
                <caption className="visually-hidden">Bundle size by entry point</caption>
                <thead>
                  <tr>
                    <th scope="col">What you import</th>
                    <th scope="col">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {SIZES.map((row) => (
                    <tr key={row.name}>
                      <th scope="row">{row.name}</th>
                      <td className="production__size">{row.size}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p>
              Minified and compressed, with no dependencies of its own. CI fails if a
              change pushes any of them over budget.
            </p>
            <p>
              Development warnings are not in those numbers, and not in your bundle: the{' '}
              <code>production</code> export condition — which webpack, Vite, Rspack and
              Parcel all set — resolves to a build with them compiled out.
            </p>
          </div>

          <div className="prose">
            <h3 className="subhead">Supply chain</h3>
            <ul className="checks">
              <li>
                <strong>Published from CI</strong> through npm Trusted Publishing, so no
                long-lived token exists to leak.
              </li>
              <li>
                <strong>Signed provenance</strong> on every release: you can verify the
                commit and the workflow that built it.
              </li>
              <li>
                <strong>No runtime dependencies</strong>, so there is no transitive tree to
                audit.
              </li>
              <li>
                <strong>Actions pinned to commits</strong>, never to movable tags.
              </li>
              <li>
                <strong>CI fails on any known vulnerability</strong>, at any severity, in
                runtime and development dependencies alike.
              </li>
            </ul>
            <CodeBlock
              code={VERIFY_PROVENANCE}
              title="Verify a release yourself"
              copyLabel="provenance commands"
            />
          </div>
        </div>

        <h3 className="subhead">What it guarantees</h3>
        <ul className="guarantees">
          {GUARANTEES.map((item) => (
            <li key={item.title} className="guarantees__item">
              <h4 className="guarantees__title">{item.title}</h4>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>

        <div className="objective production__measured">
          <h3 className="objective__title">Measured, not asserted</h3>
          <p>
            In Chromium, 600 ms of work run through the engine left a user-blocking task
            waiting <strong>3 ms</strong> at worst. The same work unchunked:{' '}
            <strong>598 ms</strong>. Both numbers come from a test that runs on every push,
            in a real browser, and repeats itself with <code>scheduler.yield()</code> hidden
            so the Safari path is covered too.
          </p>
        </div>
      </div>
    </section>
  );
}
