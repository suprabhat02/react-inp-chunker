import { SiteFooter } from './components/SiteFooter.tsx';
import { SiteHeader } from './components/SiteHeader.tsx';
import { ApiReference } from './sections/ApiReference.tsx';
import { Author } from './sections/Author.tsx';
import { GetStarted } from './sections/GetStarted.tsx';
import { Hero } from './sections/Hero.tsx';
import { HowItWorks } from './sections/HowItWorks.tsx';
import { PlaygroundSection } from './sections/PlaygroundSection.tsx';
import { WhenToUse } from './sections/WhenToUse.tsx';
import { Why } from './sections/Why.tsx';

export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        <span id="top" />
        <Hero />
        <Why />
        <HowItWorks />
        <PlaygroundSection />
        <GetStarted />
        <ApiReference />
        <WhenToUse />
        <Author />
      </main>
      <SiteFooter />
    </>
  );
}
