const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// 计算文件的SHA512哈希
function calculateSHA512(filePath) {
  const fileBuffer = fs.readFileSync(filePath)
  const hashSum = crypto.createHash('sha512')
  hashSum.update(fileBuffer)
  return hashSum.digest('hex')
}

// 获取文件大小
function getFileSize(filePath) {
  return fs.statSync(filePath).size
}

// 生成latest.yml内容
function generateLatestYml() {
  const exePath = path.join(__dirname, 'dist-1.0.2', '混凝土配合比设计软件-1.0.2-x64.exe')

  if (!fs.existsSync(exePath)) {
    console.error('安装包文件不存在:', exePath)
    return
  }

  const sha512 = calculateSHA512(exePath)
  const size = getFileSize(exePath)
  const version = '1.0.2'
  const releaseDate = new Date().toISOString()

  const ymlContent = `version: ${version}
files:
  - url: 混凝土配合比设计软件-${version}-x64.exe
    sha512: ${sha512}
    size: ${size}
path: 混凝土配合比设计软件-${version}-x64.exe
sha512: ${sha512}
releaseDate: '${releaseDate}'
`

  const ymlPath = path.join(__dirname, 'dist-1.0.2', 'latest.yml')
  fs.writeFileSync(ymlPath, ymlContent, 'utf8')

  console.log('latest.yml 已生成:', ymlPath)
  console.log('SHA512:', sha512)
  console.log('文件大小:', size, 'bytes')
}

generateLatestYml()