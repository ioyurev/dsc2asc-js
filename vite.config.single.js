import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'fs';

// Читаем package.json для получения имени и версии
const packageJsonContent = fs.readFileSync('./package.json', 'utf8');
const packageJson = JSON.parse(packageJsonContent);
const fileName = `${packageJson.name}-v${packageJson.version}.html`;

export default defineConfig({
 base: './',
 plugins: [
    viteSingleFile({
      removeViteModuleLoader: true,
      useRecommendedBuildConfig: true
    })
  ],
  server: {
    port: 5173,
    host: true,
    open: true
  },
  build: {
    outDir: 'dist-single',
    minify: 'terser',
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'iife'
      }
    },
    chunkSizeWarningLimit: 1000
  },
  optimizeDeps: {
    include: ['chart.js', 'jszip']
  }
});
