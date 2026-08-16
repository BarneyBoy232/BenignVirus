import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite + React config for the projectBV cloud dashboard (deployed on Vercel).
export default defineConfig({
  plugins: [react()],
})
