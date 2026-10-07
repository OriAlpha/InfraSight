import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Automatically load environment variables from the project root .env
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const backendPort = env.PORT || 9000;
  
  let clientPort = 5173;
  if (env.CLIENT_PORT) {
    clientPort = Number(env.CLIENT_PORT);
  } else if (env.CLIENT_URL) {
    try {
      clientPort = Number(new URL(env.CLIENT_URL).port) || 5173;
    } catch {}
  }

  return {
    plugins: [react()],
    server: {
      port: clientPort,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: 'hidden',
    },
  };
});
