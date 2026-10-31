'use strict'

/**
 * 中文命名规范化引擎
 *
 * 这是相对原项目改动最大的部分。原版用 change-case 做 camelCase/kebabCase 转换，
 * 但 change-case 是按 ASCII 空格和大小写规则工作的，对中文完全无效：
 *   kebabCase('夏天海边日落') === '夏天海边日落'
 * 而且它不认识中文标点、不会处理 Windows 非法字符、不会按「字数」截断。
 *
 * 这里的做法：
 *   1) 清洗模型输出（去掉解释、引号、代码块、多余标签、误带的扩展名）
 *   2) 把文本切成「词元」：只保留字母/数字/汉字，其余一律视为分隔符
 *   3) 按命名风格把词元重新拼接
 *   4) 按字数截断、去掉首尾分隔符、规避 Windows 保留名
 */

// ---------- 命名风格 ----------

const STYLES = [
  { id: 'zh-dash', label: '短横连接', desc: '夏天海边-日落 → 夏天-海边-日落', sep: '-', lang: 'zh' },
  { id: 'zh-underscore', label: '下划线连接', desc: '夏天_海边_日落', sep: '_', lang: 'zh' },
  { id: 'zh-space', label: '空格连接', desc: '夏天 海边 日落', sep: ' ', lang: 'zh' },
  { id: 'zh-plain', label: '连写（不加分隔）', desc: '夏天海边日落', sep: '', lang: 'zh' },
  { id: 'kebab-case', label: '英文短横（kebab-case）', desc: 'summer-beach-sunset', sep: '-', lang: 'en' },
  { id: 'snake_case', label: '英文下划线（snake_case）', desc: 'summer_beach_sunset', sep: '_', lang: 'en' },
  { id: 'camelCase', label: '英文驼峰（camelCase）', desc: 'summerBeachSunset', sep: '', lang: 'en' },
  { id: 'PascalCase', label: '英文帕斯卡（PascalCase）', desc: 'SummerBeachSunset', sep: '', lang: 'en' },
  { id: 'raw', label: '不做风格处理', desc: '模型给什么就用什么（仅清理非法字符）', sep: ' ', lang: 'any' }
]

const getStyle = id => STYLES.find(s => s.id === id) || STYLES[0]

// ---------- 字符判定 ----------

const RE_WORD = /[\p{L}\p{N}]/u
const RE_CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/
const RE_CJK_ONLY = /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]+$/
const RE_LATIN = /[A-Za-z]/

// Windows 文件名保留字
const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
])

// 常见扩展名（用于剥掉模型误带的 .jpg 之类）
const KNOWN_EXTS = [
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tif', '.tiff', '.heic', '.avif',
  '.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg',
  '.pdf', '.txt', '.md', '.markdown', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.csv', '.json', '.xml', '.yaml', '.yml', '.html', '.htm', '.css', '.js', '.ts',
  '.py', '.java', '.c', '.cpp', '.go', '.rs', '.sh', '.log', '.zip', '.rar', '.7z'
]

// ---------- 输出清洗 ----------

/** 模型爱说的开场白，出现在行首就要整行优先排除 */
const FILLER_PREFIXES = [
  'here is', 'here\'s', 'the filename', 'filename:', 'file name', 'output:',
  '文件名', '新的文件名', '新文件名', '名称', '命名', '建议', '答案', '结果'
]

/**
 * 从多行输出里挑选最像文件名的一行
 */
function pickBestLine (text) {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

  if (lines.length <= 1) return lines[0] || ''

  // 去掉明显是解释/代码块的干扰行
  const candidates = lines.filter(line => {
    if (/^```/.test(line)) return false
    const lower = line.toLowerCase()
    if (FILLER_PREFIXES.some(p => lower.startsWith(p))) return false
    if (/^[-*•]\s/.test(line) && line.length > 60) return false
    return true
  })

  const pool = candidates.length ? candidates : lines

  // 优先选「短且不含句号」的行——文件名很少是一句完整的话
  const scored = pool
    .map((line, i) => {
      let score = 0
      if (line.length <= 40) score += 3
      if (line.length <= 20) score += 2
      if (/\s/.test(line)) score -= 1
      if (/[。！？，；]/.test(line)) score -= 3
      if (/[：:]/.test(line)) score -= 2
      return { line, score, i }
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)

  return scored[0].line
}

/**
 * 清洗模型返回的原始文本
 */
function cleanModelOutput (input, { originalExt = '' } = {}) {
  if (!input || typeof input !== 'string') return ''

  let text = input.trim()

  // 去掉 ``` 代码块包裹
  text = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')

  text = pickBestLine(text)

  // 去掉「文件名：xxx」这类前缀
  text = text.replace(/^\s*(?:新的?文件[名称]|文件[名称]|filename|file\s*name|name|output|结果|答案)\s*[:：]\s*/i, '')

  // 去掉行首编号 1. / 1、/ (1) / ①
  text = text.replace(/^\s*(?:\(\d+\)|（\d+）|\d+\s*[.、．)）]|[①-⑳])\s*/, '')

  // 去掉成对包裹的引号/书名号/括号（可能嵌套一层）
  const wrappers = [
    ['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'],
    ['「', '」'], ['『', '』'], ['《', '》'], ['【', '】'],
    ['(', ')'], ['（', '）'], ['[', ']'], ['`', '`'], ['*', '*'], ['**', '**']
  ]
  for (let pass = 0; pass < 2; pass++) {
    for (const [open, close] of wrappers) {
      if (text.length > open.length + close.length &&
          text.startsWith(open) && text.endsWith(close)) {
        text = text.slice(open.length, text.length - close.length).trim()
      }
    }
  }

  // 去掉 markdown 强调符号
  text = text.replace(/\*\*|__|~~|`/g, '')

  // 去掉误带的扩展名（重复两遍以处理 a.jpg.jpg 这种）
  const lower = text.toLowerCase()
  for (let pass = 0; pass < 2; pass++) {
    for (const ext of KNOWN_EXTS) {
      if (text.toLowerCase().endsWith(ext) && text.length > ext.length) {
        text = text.slice(0, text.length - ext.length).trim()
        break
      }
    }
  }
  if (originalExt && text.toLowerCase().endsWith(originalExt.toLowerCase())) {
    text = text.slice(0, text.length - originalExt.length).trim()
  }

  // 去掉句末标点
  text = text.replace(/[。．.，,；;、\s]+$/g, '')

  return text.trim()
}

// ---------- 分词 ----------

/**
 * 切成词元：只保留文字/数字，其余字符一律作为分隔符丢弃
 * 这样中文标点、全角符号、Windows 非法字符 < > : " / \ | ? * 全部自然被清掉
 */
function tokenize (text) {
  const tokens = []
  let buf = ''
  for (const ch of text.normalize('NFC')) {
    if (RE_WORD.test(ch)) {
      buf += ch
    } else if (buf) {
      tokens.push(buf)
      buf = ''
    }
  }
  if (buf) tokens.push(buf)
  return tokens
}

/** 英文风格的单词大小写处理 */
function applyCase (tokens, styleId) {
  if (styleId === 'camelCase' || styleId === 'PascalCase') {
    return tokens.map((t, i) => {
      if (!RE_LATIN.test(t)) return t // 中文词元不动
      const lower = t.toLowerCase()
      if (styleId === 'camelCase' && i === 0) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
  }
  if (styleId === 'kebab-case' || styleId === 'snake_case') {
    return tokens.map(t => (RE_LATIN.test(t) ? t.toLowerCase() : t))
  }
  return tokens
}

// ---------- 截断 ----------

const charLen = s => Array.from(s).length

/** 按「字」截断，尽量不切断英文单词 */
function truncateByChars (text, max) {
  if (!max || max <= 0) return text
  const chars = Array.from(text)
  if (chars.length <= max) return text
  let cut = chars.slice(0, max).join('')
  // 如果正好切在一个英文单词中间，回退到上一个分隔符
  const nextChar = chars[max]
  const lastChar = cut.slice(-1)
  if (/[A-Za-z]/.test(lastChar) && /[A-Za-z]/.test(nextChar || '')) {
    const idx = cut.search(/[A-Za-z]+$/)
    if (idx > 0) cut = cut.slice(0, idx)
  }
  return cut
}

// ---------- 主函数 ----------

/**
 * 把模型输出变成合法的文件名（不含扩展名）
 *
 * @param {string} raw            模型原始输出
 * @param {object} opts
 * @param {string} opts.style     命名风格 id
 * @param {number} opts.maxChars  最大字数（0 = 不限）
 * @param {number} opts.maxWords  最大词数（0 = 不限）
 * @param {string} opts.ext       原文件扩展名（用于剥掉误带的后缀）
 * @param {string} opts.prefix    自定义前缀（如 "2026-10-27"）
 * @param {string} opts.suffix    自定义后缀
 * @returns {{ ok: boolean, name: string, reason?: string, tokens?: string[] }}
 */
function buildName (raw, opts = {}) {
  const {
    style = 'zh-dash',
    maxChars = 40,
    maxWords = 6,
    ext = '',
    prefix = '',
    suffix = ''
  } = opts

  const styleDef = getStyle(style)
  const cleaned = cleanModelOutput(raw, { originalExt: ext })

  if (!cleaned) {
    return { ok: false, name: '', reason: '模型没有返回有效内容' }
  }

  let tokens = tokenize(cleaned)

  // 去掉纯标点/空白产生的空词元
  tokens = tokens.filter(Boolean)

  if (!tokens.length) {
    return { ok: false, name: '', reason: '输出中没有可用的文字（可能只有符号）' }
  }

  // 过滤掉模型偶尔带出的「文件」「图片」这类空壳词
  const SHELL_WORDS = new Set(['文件', '图片', '照片', '图像', '视频', 'file', 'image', 'photo', 'video', 'untitled', '未命名'])
  if (tokens.length > 1) {
    const filtered = tokens.filter(t => !SHELL_WORDS.has(t.toLowerCase()))
    if (filtered.length) tokens = filtered
  }

  if (maxWords > 0 && tokens.length > maxWords) {
    tokens = tokens.slice(0, maxWords)
  }

  tokens = applyCase(tokens, style)

  let body
  if (styleDef.id === 'raw') {
    body = cleaned
  } else if (styleDef.sep === '' && (styleDef.id === 'camelCase' || styleDef.id === 'PascalCase')) {
    body = tokens.join('')
  } else {
    body = tokens.join(styleDef.sep)
  }

  // 截断到字数上限
  if (maxChars > 0) {
    body = truncateByChars(body, maxChars)
  }

  // 收尾：去掉首尾分隔符、点号、空格
  body = body.replace(/^[\s\-_.]+|[\s\-_.]+$/g, '')

  // 拼前后缀
  let name = body
  if (prefix) name = `${prefix}${styleDef.sep || '-'}${name}`
  if (suffix) name = `${name}${styleDef.sep || '-'}${suffix}`

  // 兜底：如果清完什么都没了、或者整串仍然含非法字符
  name = sanitizeFilename(name)

  if (!name) {
    return { ok: false, name: '', reason: '清理后文件名为空' }
  }

  // Windows 保留字
  if (RESERVED.has(name.toUpperCase())) {
    name = `${name}_1`
  }

  return { ok: true, name, tokens }
}

/**
 * 最终防线：清掉 Windows / macOS 不允许的字符，处理保留名与首尾
 */
function sanitizeFilename (name) {
  if (!name) return ''
  let out = String(name)
    // 控制字符
    .replace(/[\u0000-\u001F\u007F]/g, '')
    // Windows 非法字符
    .replace(/[<>:"/\\|?*]/g, '')
    // 换行/制表
    .replace(/[\r\n\t]/g, ' ')
    // 连续空格
    .replace(/\s{2,}/g, ' ')
    // 首尾的点和空格（Windows 不允许文件名以点或空格结尾）
    .replace(/^[\s.]+/g, '')
    .replace(/[\s.]+$/g, '')
    .trim()

  if (!out) return ''

  // 兜底长度，避免超过文件系统限制
  if (charLen(out) > 180) out = truncateByChars(out, 180).replace(/[\s\-_.]+$/g, '')

  return out
}

/**
 * 生成重名规避用的名字：照片.jpg → 照片(2).jpg
 */
function makeUniqueName (desired, ext, usedSet) {
  const key = n => n.toLowerCase()
  let candidate = `${desired}${ext}`
  if (!usedSet.has(key(candidate))) {
    usedSet.add(key(candidate))
    return candidate
  }
  for (let i = 2; i <= 9999; i++) {
    candidate = `${desired}(${i})${ext}`
    if (!usedSet.has(key(candidate))) {
      usedSet.add(key(candidate))
      return candidate
    }
  }
  const fallback = `${desired}_${Date.now()}${ext}`
  usedSet.add(key(fallback))
  return fallback
}

module.exports = {
  STYLES,
  getStyle,
  cleanModelOutput,
  tokenize,
  buildName,
  sanitizeFilename,
  makeUniqueName,
  truncateByChars,
  charLen
}
