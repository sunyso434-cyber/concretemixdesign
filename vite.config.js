import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'fix-html-paths',
      closeBundle() {
        const htmlPath = path.resolve(__dirname, 'build/renderer/index.html')
        let html = fs.readFileSync(htmlPath, 'utf-8')
        html = html.replace(/src="\/assets\//g, 'src="./assets/')
        html = html.replace(/href="\/assets\//g, 'href="./assets/')
        fs.writeFileSync(htmlPath, html)
        console.log('Fixed HTML asset paths for portable build')
      }
    }
  ],
  server: {
    port: 3000
  },
  build: {
    outDir: 'build/renderer',
    base: './'
  }
})
