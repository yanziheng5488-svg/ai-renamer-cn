'use strict'

/**
 * 本地模拟模型服务（仅用于开发自测，不参与打包）
 * 模拟 OpenAI 兼容接口，按提示词里的关键词返回不同中文名，
 * 用来验证界面 → 主进程 → 模型 → 命名 → 回填 这条完整链路。
 *
 * 启动：node test/mock-server.js [port]
 */

const http = require('http')

const PORT = Number(process.argv[2]) || 8899

const RULES = [
  { kw: ['渠道', '复盘'], name: 'Q3-渠道复盘-会议记录' },
  { kw: ['周报', '联调', '缺陷'], name: '项目周报-第三周' },
  { kw: ['销售', '销售额', '营收'], name: '2026年3月-销售数据' },
  { kw: ['需求文档', '批量导入'], name: '产品需求文档-V2' },
  { kw: ['工作总结', '季度'], name: '2026年三季度-工作总结' },
  { kw: ['会议', '参会'], name: '部门会议-纪要' }
]

const IMAGE_NAMES = [
  '海边日落-沙滩剪影',
  '办公桌-产品特写',
  '城市夜景-车流',
  '户外-绿植特写',
  'screen-recording-界面截图',
  '活动现场-舞台灯光'
]

let imgCursor = 0

function pickName (body) {
  const text = JSON.stringify(body)
  const hasImage = text.includes('image_url') || text.includes('"images"')

  for (const r of RULES) {
    if (r.kw.some(k => text.includes(k))) {
      if (hasImage) break
      return r.name
    }
  }

  if (hasImage) {
    const n = IMAGE_NAMES[imgCursor % IMAGE_NAMES.length]
    imgCursor++
    return n
  }

  return '综合资料-整理稿'
}

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    let body = {}
    try { body = raw ? JSON.parse(raw) : {} } catch (_) { /* ignore */ }

    if (req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        data: [
          { id: 'mock-vl-72b', owned_by: 'mock' },
          { id: 'mock-text-7b', owned_by: 'mock' }
        ]
      }))
      return
    }

    if (req.url.startsWith('/v1/chat/completions')) {
      const name = pickName(body)
      // 模拟真实模型偶尔的啰嗦：加前缀和引号，检验清洗逻辑
      const content = `文件名：${name}`
      // 每个请求延迟一点，模拟真实网络耗时，方便观察进度条
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          id: 'mock',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 20 }
        }))
      }, 350)
      return
    }

    if (req.url.startsWith('/api/tags')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ models: [{ name: 'mock-vl:latest' }] }))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end('{"error":"not found"}')
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] listening on http://127.0.0.1:${PORT}/v1`)
})
