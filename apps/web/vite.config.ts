import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/agentguard-ai/' : '/',
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:4001'
    }
  }
})
