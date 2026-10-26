import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';

import { App } from './App.tsx';

const container = document.getElementById('root');
if (container === null) throw new Error('index.html is missing #root.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
