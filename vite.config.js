import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // works on GitHub Pages under /<repo-name>/
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
