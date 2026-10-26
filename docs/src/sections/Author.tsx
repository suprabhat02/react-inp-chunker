import { useState } from 'react';

import { GitHubIcon, StarIcon } from '../components/Icons.tsx';
import { LINKS } from '../content/site.ts';

import './author.css';

const AVATAR_URL = 'https://avatars.githubusercontent.com/u/68507226?v=4&s=192';

/** The GitHub avatar, or initials if it can't load (offline, blocked, or a network policy). */
function Avatar() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="author__photo author__photo--initials" aria-hidden="true">
        SK
      </span>
    );
  }
  return (
    <img
      className="author__photo"
      src={AVATAR_URL}
      alt=""
      width={96}
      height={96}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

const PROFILES = [
  { label: 'Portfolio', detail: 'suprabhat-dev.com', href: LINKS.portfolio },
  { label: 'GitHub', detail: '@suprabhat02', href: LINKS.github },
  { label: 'X', detail: '@SuprabhatKarn97', href: LINKS.x },
  { label: 'npm', detail: '~suprabhat02', href: LINKS.npmProfile },
] as const;

export function Author() {
  return (
    <section id="author" className="section" aria-labelledby="author-title">
      <div className="container">
        <h2 id="author-title" className="author__heading">
          About the author
        </h2>

        <div className="author">
          <Avatar />
          <div className="author__body">
            <h3 className="author__name">Suprabhat Kumar</h3>
            <p className="author__role">Senior Frontend Engineer</p>
            <p className="author__bio">
              Suprabhat has spent more than six years building React and TypeScript
              applications, from analytics dashboards to component libraries. He cares
              about an internet that works for everyone, on any device, any connection and
              with any ability, and builds open-source tools that make fast, accessible
              interfaces easier to ship. react-inp-chunker comes from that: heavy screens
              shouldn't punish the people using them.
            </p>
            <ul className="author__links" aria-label="Suprabhat Kumar elsewhere">
              {PROFILES.map((profile) => (
                <li key={profile.label}>
                  <a href={profile.href}>
                    <span className="author__link-label">{profile.label}</span>
                    <span className="author__link-detail">{profile.detail}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="author__more">
          <div className="author__project">
            <h3 className="author__more-title">Also by Suprabhat</h3>
            <p>
              <a href={LINKS.smartCopy}>
                <strong>react-smart-copy</strong>
              </a>
              : copy and paste interactions for React, with copy states, rich content,
              tables and images. The copy buttons on this page run on it.
            </p>
          </div>
          <div className="author__star">
            <h3 className="author__more-title">Found this useful?</h3>
            <p>A star on GitHub helps other developers find react-inp-chunker.</p>
            <a className="button button--primary author__star-button" href={LINKS.repo}>
              <StarIcon />
              Star on GitHub
            </a>
            <a className="button author__star-button" href={LINKS.issues}>
              <GitHubIcon size={16} />
              Report an issue
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
