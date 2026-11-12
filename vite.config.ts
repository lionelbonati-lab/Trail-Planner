import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base relative : fonctionne sur GitHub Pages (/Trail-Planner/) comme en local.
export default defineConfig({
  base: './',
  plugins: [react()],
})
