const fs   = require('fs')
const path = require('path')

const dist = path.join(__dirname, 'dist')
if (fs.existsSync(dist)) fs.rmSync(dist, { recursive: true })
fs.mkdirSync(dist)

const files = [
  ['manifest.json',     'manifest.json'],
  ['popup.html',        'popup.html'],
  ['src/popup.js',      'popup.js'],
  ['src/background.js', 'background.js'],
  ['src/content.js',    'content.js'],
]

files.forEach(([src, dest]) => {
  const srcPath  = path.join(__dirname, src)
  const destPath = path.join(dist, dest)
  if (!fs.existsSync(srcPath)) {
    console.error(`❌ 파일 없음: ${src}`)
    process.exit(1)
  }
  fs.copyFileSync(srcPath, destPath)
  console.log(`✅ ${src} → dist/${dest}`)
})

console.log('\n🎉 빌드 완료! dist/ 폴더를 Chrome에 로드하세요.')