import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/web'),
    },
  },

  build: {
    outDir: 'dist',
    // Limpa a pasta a cada build. Sem isso os bundles antigos se acumulam
    // (havia 22 deles no servidor antes desta refatoracao).
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Separa as bibliotecas grandes do codigo da aplicacao para que um
        // deploy de correcao nao invalide o cache de tudo. Antes o build saia
        // como um unico arquivo de 1 MB, baixado inteiro a cada versao.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('@azure')) return 'msal';
          return 'vendor';
        },
      },
    },
  },

  server: {
    port: 3000,
    host: '0.0.0.0',
    // Em desenvolvimento o front roda na 3000 e a API na 3333. O proxy evita
    // ter que lidar com CORS e mantem as chamadas em /api nos dois ambientes.
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: true,
      },
    },
  },
});
