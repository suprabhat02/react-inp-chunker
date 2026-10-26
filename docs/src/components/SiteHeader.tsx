import { LINKS, NAV } from '../content/site.ts';
import { useActiveSection } from '../lib/useActiveSection.ts';
import { ChunkMark, GitHubIcon } from './Icons.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

import './site-header.css';

const SECTION_IDS = NAV.map((item) => item.id);

export function SiteHeader() {
  const active = useActiveSection(SECTION_IDS);

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <a className="site-header__brand" href="#top">
          <ChunkMark />
          <span>react-inp-chunker</span>
        </a>
        <nav className="site-header__nav" aria-label="Sections">
          <ul>
            {NAV.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={active === item.id ? 'location' : undefined}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="site-header__actions">
          <ThemeToggle />
          <a
            className="icon-button"
            href={LINKS.repo}
            aria-label="react-inp-chunker on GitHub"
          >
            <GitHubIcon />
          </a>
        </div>
      </div>
    </header>
  );
}
