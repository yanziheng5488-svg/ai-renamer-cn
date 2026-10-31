'use strict'

/**
 * 生成应用图标：把 assets/icon.html 渲染成多尺寸 PNG，再打包成 .ico
 * 运行：electron scripts/make-icon.js
 */

const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const SIZES = [16, 24, 32, 48, 64, 128, 256]

/** 把若干 PNG 打包成 ICO（Windows Vista 起支持内嵌 PNG 数据） */
function buildICO (entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)      // reserved
  header.writeUInt16LE(1, 2)      // type = icon
  header.writeUInt16LE(count, 4)  // 图像数量

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count

  entries.forEach((e, i) => {
    const p = i * 16
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, p + 0)  // 宽（0 表示 256）
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, p + 1)  // 高
    dir.writeUInt8(0, p + 2)                            // 调色板数
    dir.writeUInt8(0, p + 3)                            // 保留
    dir.writeUInt16LE(1, p + 4)                         // 色彩平面
    dir.writeUInt16LE(32, p + 6)                        // 位深
    dir.writeUInt32LE(e.png.length, p + 8)              // 数据长度
    dir.writeUInt32LE(offset, p + 12)                   // 数据偏移
    offset += e.png.length
  })

  return Buffer.concat([header, dir, ...entries.map(e => e.png)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false }
  })

  await win.loadFile(path.join(__dirname, '..', 'assets', 'icon.html'))
  await new Promise(r => setTimeout(r, 700))

  const shot = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 })
  const base = nativeImage.createFromBuffer(shot.toPNG())

  const outDir = path.join(__dirname, '..', 'assets')
  fs.mkdirSync(outDir, { recursive: true })

  const entries = []
  for (const size of SIZES) {
    const img = size === 256 ? base : base.resize({ width: size, height: size, quality: 'best' })
    const png = img.toPNG()
    entries.push({ size, png })
    if (size === 256) fs.writeFileSync(path.join(outDir, 'icon.png'), png)
  }

  const ico = buildICO(entries)
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)
  console.log(`[icon] icon.ico ${ico.length} bytes, sizes: ${SIZES.join(',')}`)

  app.quit()
})
