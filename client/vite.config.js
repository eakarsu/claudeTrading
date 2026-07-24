import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = globalThis.process?.env?.SERVER_PORT || 3001;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
