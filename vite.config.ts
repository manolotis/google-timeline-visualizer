import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The import worker (src/import/worker.ts) is a module worker that lazily
  // loads the reference data as separate chunks, which needs ES output
  worker: { format: 'es' },
});
