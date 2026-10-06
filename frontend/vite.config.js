import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/sse': 'http://localhost:8000',
      '/messages': 'http://localhost:8000',
    },
  },
})
