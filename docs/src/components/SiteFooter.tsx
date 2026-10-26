import { LINKS } from '../content/site.ts';
import { ChunkMark } from './Icons.tsx';

import './site-footer.css';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <p className="site-footer__brand">
          <ChunkMark size={18} />
          <span>
            react-inp-chunker, MIT licensed. Made by{' '}
            <a href={LINKS.portfolio}>Suprabhat Kumar</a>.
          </span>
        </p>
        <nav aria-label="Project">
          <ul className="site-footer__links">
            <li>
              <a href={LINKS.repo}>GitHub</a>
            </li>
            <li>
              <a href={LINKS.npm}>npm</a>
            </li>
            <li>
              <a href={LINKS.changelog}>Changelog</a>
            </li>
            <li>
              <a href={LINKS.license}>License</a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
