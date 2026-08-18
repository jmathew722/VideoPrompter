import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built app can be served from any static sub-path.
  base: './',
  plugins: [react(), tailwindcss()],
})
