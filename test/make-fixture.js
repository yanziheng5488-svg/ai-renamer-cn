'use strict'

/**
 * 用 Chromium 打印一份真实 PDF，作为测试样本
 * 运行：electron test/make-fixture.js
 */

const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 1000 })

  const html = `
    <html><head><meta charset="utf-8"><style>
      body { font-family: "Microsoft YaHei", sans-serif; padding: 40px; }
      h1 { font-size: 22px; } p { font-size: 14px; line-height: 1.8; }
    </style></head><body>
      <h1>2026 年第三季度工作总结</h1>
      <p>本季度完成了渠道拓展与产品迭代两项重点工作，营收同比增长 18%。</p>
      <p>下一阶段将重点推进客户服务体系的数字化改造。</p>
    </body></html>`

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

  const pdf = await win.webContents.printToPDF({ printBackground: true })
  const out = path.join(__dirname, 'fixtures', 'sample.pdf')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, pdf)
  console.log(`[fixture] ${out} (${pdf.length} bytes)`)

  app.quit()
})
