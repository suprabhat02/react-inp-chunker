import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from https://suprabhat02.github.io/react-inp-chunker/ — a
  // GitHub Pages project site, not a custom domain, so every asset URL
  // needs this prefix or they'll 404 in production.
  base: '/react-inp-chunker/',
});
