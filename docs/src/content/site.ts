export const PACKAGE_NAME = 'react-inp-chunker';
export const INSTALL_COMMAND = `npm install ${PACKAGE_NAME}`;

export const LINKS = {
  repo: 'https://github.com/suprabhat02/react-inp-chunker',
  npm: 'https://www.npmjs.com/package/react-inp-chunker',
  changelog: 'https://github.com/suprabhat02/react-inp-chunker/blob/main/CHANGELOG.md',
  issues: 'https://github.com/suprabhat02/react-inp-chunker/issues',
  support: 'https://github.com/suprabhat02/react-inp-chunker/blob/main/SUPPORT.md',
  security: 'https://github.com/suprabhat02/react-inp-chunker/blob/main/SECURITY.md',
  license: 'https://github.com/suprabhat02/react-inp-chunker/blob/main/LICENSE',
  portfolio: 'https://suprabhat-dev.com/',
  github: 'https://github.com/suprabhat02',
  x: 'https://x.com/SuprabhatKarn97',
  npmProfile: 'https://www.npmjs.com/~suprabhat02',
  smartCopy: 'https://suprabhat02.github.io/react-smart-copy/',
  inp: 'https://web.dev/articles/inp',
  schedulerYield: 'https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield',
  longTasks: 'https://developer.mozilla.org/en-US/docs/Glossary/Long_task',
  chromiumRenderingPriority:
    'https://lists.w3.org/Archives/Public/public-web-perf/2024Sep/0002.html',
} as const;

export interface NavItem {
  readonly id: string;
  readonly label: string;
}

/** Page sections, in order. Each id is the section's anchor. */
export const NAV: readonly NavItem[] = [
  { id: 'why', label: 'Why' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'playground', label: 'Playground' },
  { id: 'get-started', label: 'Get started' },
  { id: 'api', label: 'API' },
  { id: 'production', label: 'Production' },
  { id: 'when-to-use', label: 'When to use it' },
  { id: 'author', label: 'Author' },
];
