'use strict'

/**
 * 打包脚本
 *
 * 直接用 electron-packager 命令的话，它会去 GitHub 下载 Electron 发行包，
 * 国内网络经常失败。这里默认走 npmmirror 镜像，并允许用环境变量覆盖。
 *
 * 运行：npm run build
 */

const path = require('path')
const { packager } = require('@electron/packager')

const root = path.join(__dirname, '..')

process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/'
process.env.ELECTRON_CUSTOM_DIR = process.env.ELECTRON_CUSTOM_DIR || '{{ version }}'

async function main () {
  const started = Date.now()

  const paths = await packager({
    dir: root,
    name: '智名',
    platform: 'win32',
    arch: 'x64',
    out: path.join(root, 'dist'),
    icon: path.join(root, 'assets', 'icon.ico'),
    appVersion: '1.0.0',
    buildVersion: '1.0.0',
    overwrite: true,
    asar: true,
    prune: true,
    // 测试、图标生成脚本、打包产物不进安装包
    ignore: [
      /^\/dist($|\/)/,
      /^\/test($|\/)/,
      /^\/scripts($|\/)/,
      /^\/\.workbuddy($|\/)/,
      /^\/README\.md$/
    ],
    win32metadata: {
      CompanyName: '智名',
      FileDescription: 'AI 文件重命名 · 中文桌面版',
      ProductName: '智名',
      InternalName: '智名',
      OriginalFilename: '智名.exe'
    }
  })

  console.log(`\n打包完成，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
  for (const p of paths) console.log(`  ${p}`)
}

main().catch(err => {
  console.error('打包失败：', err.message)
  if (/ENOTFOUND|ECONNREFUSED|fetch failed/i.test(err.message)) {
    console.error('提示：下载 Electron 发行包失败。可以先把 ELECTRON_MIRROR 换成可用的镜像后重试。')
  }
  process.exit(1)
})
