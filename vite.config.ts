import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/Chess-Notation-Reader/',
  plugins: [react()],
  optimizeDeps: {
    include: ['tesseract.js'],
  },
  build: {
    rollupOptions: {
      // The @anthropic-ai/sdk agent-toolset is a Node-only module (bash, fs, crypto)
      // that is only dynamically imported at runtime by EnvironmentWorker — a server-
      // side class we never call.  Marking it external keeps it out of the browser
      // bundle entirely; the dead code path stays dead at runtime.
      external: (id: string) => id.includes('agent-toolset'),
    },
  },
});
