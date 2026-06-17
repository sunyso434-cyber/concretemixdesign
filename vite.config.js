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
        // 1. 修复 index.html 中的绝对路径（<script src=...> 和 <link href=...>）
        const htmlPath = path.resolve(__dirname, 'build/renderer/index.html')
        let html = fs.readFileSync(htmlPath, 'utf-8')
        html = html.replace(/src="\/assets\//g, 'src="./assets/')
        html = html.replace(/href="\/assets\//g, 'href="./assets/')
        fs.writeFileSync(htmlPath, html)
        console.log('Fixed HTML asset paths for portable build')

        // 2. 修复 vendor chunk 中 Vite 5 dynamic preload helper 的路径解析
        // Vite 5 会在 chunk 中 inline 一个 R1=function(e){return"/"+e} 路径解析函数，
        // 把所有依赖路径强制加 "/" 前缀转为绝对 URL。在 Electron 的 file:// 协议下，
        // /assets/xxx.css 会被解析为 file:///C:/assets/xxx.css（C盘根目录），找不到文件，
        // 触发 "Unable to preload CSS for ..." 错误并白屏。
        // 改 "./" + e 让路径保持相对，配合 file:// 协议正确解析到 app.asar 内部。
        const assetsDir = path.resolve(__dirname, 'build/renderer/assets')
        const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'))
        let fixedChunks = 0
        for (const file of jsFiles) {
          const filePath = path.join(assetsDir, file)
          let content = fs.readFileSync(filePath, 'utf-8')
          if (content.includes('R1=function(e){return"/"+e}')) {
            content = content.replaceAll(
              'R1=function(e){return"/"+e}',
              'R1=function(e){return"./"+e}'
            )
            fs.writeFileSync(filePath, content)
            fixedChunks++
            console.log(`  -> Fixed R1 path resolver in ${file}`)
          }
        }
        if (fixedChunks > 0) {
          console.log(`Fixed R1 path resolver in ${fixedChunks} chunk(s) for file:// protocol`)
        }
      }
    }
  ],
  server: {
    port: 3000
  },
  build: {
    outDir: 'build/renderer',
    base: './',
    // 关闭 modulePreload polyfill：Electron 内嵌 Chromium，原生支持 modulepreload。
    // 开启 polyfill 时，Vite 在 JS 运行时动态创建 <link rel="stylesheet"> 标签预加载 CSS，
    // 但它解析为绝对 file:// URL，在 asar 内部无法正确加载，触发
    // "Unable to preload CSS for ..." 错误并白屏。CSS 已通过 index.html 中的
    // <link rel="stylesheet"> 加载，无需重复 preload。
    // 禁用 modulePreload（而不是仅关 polyfill）：
    // polyfill:false 仍会让 Vite 在 JS 运行时动态创建 <link rel="stylesheet"> 预加载 CSS，
    // helper 把路径解析为绝对 file:// URL，在 asar 内部无法正确加载。
    // 设为 false 彻底禁用 modulePreload 链接生成，CSS 已通过 index.html 中
    // 的 <link rel="stylesheet"> 加载。
    modulePreload: false
  }
})
