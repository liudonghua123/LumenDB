import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/mcp': 'http://127.0.0.1:8000',
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'zustand', 'framer-motion'],
          charts: ['echarts', 'echarts-for-react'],
          editor: ['@uiw/react-codemirror', '@codemirror/lang-sql', '@codemirror/state', '@codemirror/view'],
          markdown: ['react-markdown'],
        },
      },
    },
  },
})
