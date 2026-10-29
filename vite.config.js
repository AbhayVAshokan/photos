import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    watch: { ignored: ['**/data/**', '**/.thumbs/**', '**/photos.db*'] },
  },
});
