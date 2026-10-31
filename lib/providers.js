'use strict'

/**
 * 模型调用层
 *
 * 两条协议：
 *   openai —— 国产厂商的事实标准（/v1/chat/completions），一套代码通吃
 *            阿里百炼、智谱、硅基流动、DeepSeek、Kimi、豆包、混元、千帆、MiniMax、阶跃
 *   ollama —— 本地 Ollama 的原生接口（/api/generate，图片走 images 字段）
 *
 * 图片统一在本地压缩后再上传：手机原图动辄 8MB，base64 之后更大，
 * 很多接口限制 10MB 会直接失败。用 Electron 自带的 nativeImage 缩放，
 * 不额外引入 sharp 这类需要编译的依赖。
 */

const fs = require('fs')
const fsp = fs.promises
const path = require('path')

const DEFAULT_TIMEOUT = 120000
const MAX_IMAGE_EDGE = 1024
const JPEG_QUALITY = 82

// ---------- 图片处理 ----------

let nativeImage = null
try {
  nativeImage = require('electron').nativeImage
} catch (_) {
  nativeImage = null // 非 Electron 环境（单元测试）降级为原图直传
}

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.avif': 'image/avif'
}

/**
 * 读取图片并压缩为 base64（不带 data 前缀）
 * @returns {Promise<string>}
 */
async function encodeImage (filePath) {
  if (nativeImage) {
    try {
      const img = nativeImage.createFromPath(filePath)
      if (!img.isEmpty()) {
        const size = img.getSize()
        const longEdge = Math.max(size.width, size.height)
        let out = img
        if (longEdge > MAX_IMAGE_EDGE) {
          const scale = MAX_IMAGE_EDGE / longEdge
          out = img.resize({
            width: Math.round(size.width * scale),
            height: Math.round(size.height * scale),
            quality: 'good'
          })
        }
        const buf = out.toJPEG(JPEG_QUALITY)
        if (buf && buf.length > 0) return buf.toString('base64')
      }
    } catch (_) {
      // 落到下面的原图直传
    }
  }
  const raw = await fsp.readFile(filePath)
  return raw.toString('base64')
}

function mimeOf (filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'image/jpeg'
}

// ---------- 错误信息中文化 ----------

/**
 * 把接口返回的英文报错翻译成用户能看懂的中文提示
 */
function explainError (err, { baseURL = '', providerName = '' } = {}) {
  const status = err?.status || err?.response?.status
  const raw = err?.serverMessage || err?.message || String(err)

  if (status === 401 || /invalid.*(api.?key|token)|unauthorized|authentication/i.test(raw)) {
    return { message: 'API Key 无效或已过期，请到服务商控制台重新复制一个', code: 'AUTH' }
  }
  if (status === 403 || /forbidden|permission|not authorized|no permission/i.test(raw)) {
    return { message: '没有权限调用该模型，可能未开通或未实名认证', code: 'FORBIDDEN' }
  }
  if (status === 404 || /model.*not.*(found|exist)|no such model|invalid model/i.test(raw)) {
    return { message: '接口地址或模型名不存在，请检查「接口地址」和「模型」两项', code: 'NOT_FOUND' }
  }
  if (status === 429 || /rate.?limit|too many requests|quota|insufficient/i.test(raw)) {
    return { message: '请求太频繁或额度已用尽，请稍后再试', code: 'RATE_LIMIT' }
  }
  if (/ECONNREFUSED|fetch failed|connect ECONN|ENOTFOUND|EAI_AGAIN/i.test(raw)) {
    const local = /127\.0\.0\.1|localhost/.test(baseURL)
    return {
      message: local
        ? '连接不上本地服务，请确认 Ollama / LM Studio 已经启动'
        : '连接不上服务器，请检查网络或接口地址是否正确',
      code: 'NETWORK'
    }
  }
  if (/timeout|ETIMEDOUT|aborted/i.test(raw)) {
    return { message: '请求超时，可能是网络慢或图片太大，可减少抽帧数后重试', code: 'TIMEOUT' }
  }
  if (status === 400 && /image|vision|multimodal/i.test(raw)) {
    return { message: '该模型不支持看图，请换一个视觉模型（名字里带 vl / vision 的）', code: 'NO_VISION' }
  }
  if (status === 400) {
    return { message: `请求被拒绝：${raw.slice(0, 200)}`, code: 'BAD_REQUEST' }
  }
  return { message: `${providerName ? providerName + '：' : ''}${raw.slice(0, 300)}`, code: 'UNKNOWN' }
}

// ---------- HTTP ----------

async function postJSON (url, body, headers = {}, timeout = DEFAULT_TIMEOUT) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch (_) { /* 非 JSON 响应 */ }

    if (!res.ok) {
      const serverMessage =
        json?.error?.message ||
        json?.error ||
        json?.message ||
        json?.msg ||
        (typeof json === 'string' ? json : text.slice(0, 400))
      const e = new Error(typeof serverMessage === 'string' ? serverMessage : JSON.stringify(serverMessage))
      e.status = res.status
      e.serverMessage = typeof serverMessage === 'string' ? serverMessage : JSON.stringify(serverMessage)
      throw e
    }
    if (json === null) {
      throw new Error(`服务器返回了非 JSON 内容：${text.slice(0, 200)}`)
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

async function getJSON (url, headers = {}, timeout = 20000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch (_) { /* ignore */ }
    if (!res.ok) {
      const msg = json?.error?.message || json?.error || text.slice(0, 200)
      const e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      e.status = res.status
      e.serverMessage = typeof msg === 'string' ? msg : JSON.stringify(msg)
      throw e
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

// ---------- 协议实现 ----------

const joinURL = (base, suffix) => {
  const b = String(base || '').replace(/\/+$/, '')
  return `${b}${suffix}`
}

/**
 * OpenAI 兼容协议
 */
async function callOpenAI ({ baseURL, apiKey, model, prompt, images = [], timeout }) {
  const content = [{ type: 'text', text: prompt }]

  for (const img of images) {
    const b64 = await encodeImage(img)
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mimeOf(img)};base64,${b64}` }
    })
  }

  const body = {
    model,
    messages: [{ role: 'user', content }],
    temperature: 0.3,
    stream: false
  }

  const headers = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const json = await postJSON(joinURL(baseURL, '/chat/completions'), body, headers, timeout)

  const choice = json?.choices?.[0]
  const text =
    choice?.message?.content ??
    choice?.delta?.content ??
    choice?.text ??
    json?.output?.text ??
    ''

  if (typeof text !== 'string' || !text.trim()) {
    const reason = choice?.finish_reason || json?.error?.message || '模型没有返回内容'
    throw new Error(`模型返回为空（${reason}）`)
  }
  return text
}

/**
 * Ollama 原生协议
 */
async function callOllama ({ baseURL, model, prompt, images = [], timeout }) {
  const body = {
    model,
    prompt,
    stream: false,
    options: { temperature: 0.3 }
  }

  if (images.length) {
    body.images = []
    for (const img of images) {
      body.images.push(await encodeImage(img))
    }
  }

  const json = await postJSON(joinURL(baseURL, '/api/generate'), body, {}, timeout)
  const text = json?.response || ''
  if (!text.trim()) throw new Error('模型返回为空')
  return text
}

/**
 * 统一入口
 */
async function chat (opts) {
  const { protocol, timeout } = opts
  if (protocol === 'ollama') return callOllama(opts)
  return callOpenAI(opts)
}

// ---------- 模型列表 ----------

async function listModels ({ protocol, baseURL, apiKey }) {
  if (!baseURL) throw new Error('请先填写接口地址')

  if (protocol === 'ollama') {
    const json = await getJSON(joinURL(baseURL, '/api/tags'), {}, 8000)
    return (json?.models || []).map(m => ({ name: m.name, size: m.size }))
  }

  const headers = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const json = await getJSON(joinURL(baseURL, '/models'), headers, 15000)
  const arr = json?.data || json?.models || []
  return arr.map(m => ({
    name: typeof m === 'string' ? m : (m.id || m.name || ''),
    owned: m?.owned_by || ''
  })).filter(m => m.name)
}

// ---------- 连接测试 ----------

/**
 * 用一张 1x1 的纯色图做最小请求，验证 Key / 地址 / 模型是否都通
 */
async function testConnection ({ protocol, baseURL, apiKey, model, vision = true }) {
  const started = Date.now()
  try {
    const prompt = '只回复两个字：可用'
    const images = []
    const text = await chat({
      protocol,
      baseURL,
      apiKey,
      model,
      prompt,
      images,
      timeout: 30000
    })
    return {
      ok: true,
      ms: Date.now() - started,
      sample: String(text).trim().slice(0, 50),
      visionTested: false
    }
  } catch (err) {
    const e = explainError(err, { baseURL })
    return { ok: false, ...e, raw: String(err.message || err) }
  }
}

module.exports = {
  chat,
  listModels,
  testConnection,
  encodeImage,
  explainError,
  MAX_IMAGE_EDGE
}
