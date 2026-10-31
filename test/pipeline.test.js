'use strict'

/**
 * 端到端链路测试（本地模拟模型服务，不联网、不依赖 API Key）
 *
 * 验证的是我们自己这层：提示词是否发出、图片是否编码、返回内容是否被正确清洗、
 * 命名是否落盘、重名是否处理、撤销是否可用。
 */

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { generateNames, applyRenames, undoRenames } = require('../lib/renamer')

let pass = 0
let fail = 0

function ok (cond, label, extra = '') {
  if (cond) { pass++ } else { fail++; console.log(`  ✗ ${label} ${extra}`) }
}

// 1x1 透明 PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let receivedOllama = []
let receivedOpenAI = []

/** 模拟 Ollama（/api/generate）与 OpenAI 兼容（/v1/chat/completions）两套接口 */
function startMockServer () {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        const json = body ? JSON.parse(body) : {}

        if (req.url === '/api/tags') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ models: [{ name: 'mock-vl:latest' }] }))
          return
        }

        if (req.url === '/api/generate') {
          receivedOllama.push(json)
          // 故意带上前缀、引号、扩展名，模拟真实模型的啰嗦输出
          const name = json.images && json.images.length
            ? '文件名：“海边日落”.jpg'
            : '文件名：项目周报-第三期'
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ response: name, done: true }))
          return
        }

        if (req.url === '/v1/chat/completions') {
          receivedOpenAI.push(json)
          const hasImage = JSON.stringify(json.messages).includes('image_url')
          const content = hasImage ? '**夏天-海滩-合影**' : '季度-财务报表'
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }]
          }))
          return
        }

        res.writeHead(404)
        res.end('{}')
      })
    })

    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port })
    })
  })
}

async function main () {
  const { server, port } = await startMockServer()
  const base = `http://127.0.0.1:${port}`

  const dir = path.join(os.tmpdir(), `pl-test-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'IMG_0001.png'), PNG_1PX)
  fs.writeFileSync(path.join(dir, 'IMG_0002.png'), PNG_1PX)
  fs.writeFileSync(path.join(dir, 'weekly.txt'), '本周完成了接口联调，下周进入测试阶段。')
  fs.writeFileSync(path.join(dir, 'finance.txt'), '第一季度营业收入与成本明细。')

  const files = [
    { id: 'f1', path: path.join(dir, 'IMG_0001.png'), dir, fileName: 'IMG_0001.png', baseName: 'IMG_0001', ext: '.png', kind: 'image', status: 'pending' },
    { id: 'f2', path: path.join(dir, 'IMG_0002.png'), dir, fileName: 'IMG_0002.png', baseName: 'IMG_0002', ext: '.png', kind: 'image', status: 'pending' },
    { id: 'f3', path: path.join(dir, 'weekly.txt'), dir, fileName: 'weekly.txt', baseName: 'weekly', ext: '.txt', kind: 'doc', status: 'pending' },
    { id: 'f4', path: path.join(dir, 'finance.txt'), dir, fileName: 'finance.txt', baseName: 'finance', ext: '.txt', kind: 'doc', status: 'pending' }
  ]

  console.log('\n=== 一、Ollama 协议全链路 ===')

  const events = []
  const result = await generateNames({
    files,
    settings: {
      protocol: 'ollama',
      baseURL: base,
      apiKey: '',
      model: 'mock-vl:latest',
      style: 'zh-dash',
      language: 'zh-CN',
      maxChars: 40,
      maxWords: 6,
      customPrompt: '',
      framesPerVideo: 3,
      concurrency: 2,
      prefix: ''
    },
    onEvent: e => events.push(e)
  })

  ok(result.finished === 4, '四个文件都处理了', `finished=${result.finished}`)
  ok(events.filter(e => e.type === 'file-done').length === 4, '四个都返回成功')
  ok(events.filter(e => e.type === 'file-error').length === 0, '没有失败')

  const done = new Map(events.filter(e => e.type === 'file-done').map(e => [e.id, e.newName]))

  ok(done.get('f1') === '海边日落.png', '图片名清洗正确（去前缀引号扩展名）', done.get('f1'))
  ok(done.get('f3') === '项目周报-第三期.txt', '文本名带短横分隔', done.get('f3'))

  // 两张图内容一样，第二张应该自动加序号
  ok(done.get('f2') === '海边日落(2).png', '重复名字自动加序号', done.get('f2'))

  console.log('\n=== 二、请求内容检查 ===')

  const imgReq = receivedOllama.find(r => r.images)
  ok(Boolean(imgReq), '图片请求带上了 images 字段')
  ok(imgReq && imgReq.images.length === 1, '一张图对应一个 image')
  ok(imgReq && typeof imgReq.images[0] === 'string' && imgReq.images[0].length > 20, '图片是 base64 字符串')
  ok(imgReq && !imgReq.images[0].startsWith('data:'), 'Ollama 的图片不带 data: 前缀')

  const txtReq = receivedOllama.find(r => !r.images)
  ok(txtReq && txtReq.prompt.includes('本周完成了接口联调'), '文本文件正文被放进提示词')
  ok(txtReq && txtReq.prompt.includes('简体中文'), '提示词要求输出简体中文')
  ok(txtReq && txtReq.prompt.includes('短横线'), '提示词要求用短横线断词')
  ok(txtReq && txtReq.prompt.includes('只输出文件名本身'), '提示词有输出约束')

  console.log('\n=== 三、OpenAI 兼容协议 ===')

  receivedOpenAI.length = 0
  const files2 = [
    { id: 'g1', path: path.join(dir, 'IMG_0001.png'), dir, fileName: 'IMG_0001.png', baseName: 'IMG_0001', ext: '.png', kind: 'image', status: 'pending' },
    { id: 'g2', path: path.join(dir, 'finance.txt'), dir, fileName: 'finance.txt', baseName: 'finance', ext: '.txt', kind: 'doc', status: 'pending' }
  ]
  // 清掉上一轮已生成的名字，模拟重新生成
  const events2 = []
  await generateNames({
    files: files2,
    settings: {
      protocol: 'openai',
      baseURL: `${base}/v1`,
      apiKey: 'test-key',
      model: 'glm-4v-flash',
      style: 'zh-dash',
      language: 'zh-CN',
      maxChars: 40,
      maxWords: 6,
      customPrompt: '只写主体',
      framesPerVideo: 3,
      concurrency: 1,
      prefix: ''
    },
    onEvent: e => events2.push(e)
  })

  const oaDone = new Map(events2.filter(e => e.type === 'file-done').map(e => [e.id, e.newName]))
  // 这一轮是新批次，目录里没有同名文件，所以不加序号（批内去重已在第一轮验证）
  ok(oaDone.get('g1') === '夏天-海滩-合影.png', 'OpenAI 协议出图正常（markdown 星号被清掉）', oaDone.get('g1'))
  ok(oaDone.get('g2') === '季度-财务报表.txt', 'OpenAI 协议文本正常', oaDone.get('g2'))

  const oaImgReq = receivedOpenAI.find(r => JSON.stringify(r.messages).includes('image_url'))
  ok(Boolean(oaImgReq), 'OpenAI 请求包含 image_url')
  const urlPart = oaImgReq && oaImgReq.messages[0].content.find(c => c.type === 'image_url')
  ok(urlPart && urlPart.image_url.url.startsWith('data:image/'), '图片用 data URI 形式')
  ok(oaImgReq && oaImgReq.messages[0].content[0].type === 'text', '文本部分排在图片前')
  ok(oaImgReq && oaImgReq.model === 'glm-4v-flash', '模型名正确传递')

  console.log('\n=== 四、落盘与撤销 ===')

  const plans = [
    { path: path.join(dir, 'IMG_0001.png'), newName: '海边日落.png' },
    { path: path.join(dir, 'weekly.txt'), newName: '项目周报-第三期.txt' }
  ]
  const applied = await applyRenames(plans)
  ok(applied.ok.length === 2, '两个文件改名成功')
  ok(fs.existsSync(path.join(dir, '海边日落.png')), '图片已改名')
  ok(fs.existsSync(path.join(dir, '项目周报-第三期.txt')), '文本已改名')

  const undone = await undoRenames(applied.ok.map(r => ({ from: r.from, to: r.to })))
  ok(undone.ok.length === 2, '撤销成功')
  ok(fs.existsSync(path.join(dir, 'IMG_0001.png')), '文件回到原名')
  ok(fs.existsSync(path.join(dir, 'weekly.txt')), '文本回到原名')

  console.log('\n=== 五、异常处理 ===')

  const badEvents = []
  const badFiles = [
    { id: 'x1', path: path.join(dir, '不存在.txt'), dir, fileName: '不存在.txt', baseName: '不存在', ext: '.txt', kind: 'doc', status: 'pending' }
  ]
  await generateNames({
    files: badFiles,
    settings: {
      protocol: 'openai',
      baseURL: `${base}/v1`,
      apiKey: '',
      model: 'm',
      style: 'zh-dash',
      language: 'zh-CN',
      maxChars: 40,
      maxWords: 6,
      customPrompt: '',
      framesPerVideo: 3,
      concurrency: 1
    },
    onEvent: e => badEvents.push(e)
  })
  const errEvent = badEvents.find(e => e.type === 'file-error')
  ok(Boolean(errEvent), '文件不存在时报告失败而不是崩掉')
  ok(errEvent && /不存在|无法|系统找不到/i.test(errEvent.error), '错误信息可读', errEvent && errEvent.error)

  server.close()
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) {}

  console.log(`\n${'='.repeat(50)}`)
  console.log(`通过 ${pass} 项，失败 ${fail} 项`)
  console.log('='.repeat(50) + '\n')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
