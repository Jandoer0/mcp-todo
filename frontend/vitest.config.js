import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Отдельный конфиг для vitest: без VitePWA и прочих прод-плагинов.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    include: ['src/**/*.test.{js,jsx}'],
  },
})
