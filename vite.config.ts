import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages serves this project from a sub-path, so assets must be requested
// relative to it. Locally the sub-path is absent, hence the mode switch.
// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/hololivedream-optimizer/' : '/',
  plugins: [react()],
}))
