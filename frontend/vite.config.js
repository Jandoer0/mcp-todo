import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// During local dev, proxy API/MCP calls to the backend on :8000.
// In production the container serves everything from one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/sse': 'http://localhost:8000',
      '/messages': 'http://localhost:8000',
    },
  },
  build: {
    outDir: 'dist',
  },
})
