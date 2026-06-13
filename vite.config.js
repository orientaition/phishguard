import { defineConfig } from 'vite'
import { resolve } from 'path'
import { copyFileSync, mkdirSync } from 'fs'

export default defineConfig({
  plugins: [
    {
      name: 'copy-extension-files',
      closeBundle() {
        mkdirSync(resolve(__dirname, 'dist'), { recursive: true })
        const files = ['manifest.json', 'popup.html', 'src/content.js', 'src/background.js']
        const dests = ['manifest.json',  'popup.html', 'content.js',     'background.js']
        files.forEach((src, i) => {
          copyFileSync(resolve(__dirname, src), resolve(__dirname, 'dist/' + dests[i]))
        })
        console.log('✅ 모든 파일 dist/ 복사 완료')
      }
    }
  ],
  // React 번들 불필요 — 파일 복사만
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: {} }, // 번들할 JS 없음
  },
})