'use strict'

/**
 * 提示词构造
 *
 * 原项目的 prompt 是英文的（"Generate filename: Use kebabCase ... English only"），
 * 本地模型和小参数模型看到英文指令，往往就直接返回英文文件名。
 * 这里整段改成中文指令，并要求输出简体中文，才能稳定拿到中文名。
 */

const LANGUAGES = [
  { id: 'zh-CN', label: '简体中文', native: '简体中文' },
  { id: 'zh-TW', label: '繁体中文', native: '繁體中文' },
  { id: 'en', label: '英文', native: 'English' },
  { id: 'ja', label: '日文', native: '日本語' },
  { id: 'auto', label: '跟随内容', native: null }
]

const getLanguage = id => LANGUAGES.find(l => l.id === id) || LANGUAGES[0]

/** 把字数上限换算成「词数」的软性建议，让模型先自己收敛 */
function wordHint (maxWords) {
  if (!maxWords || maxWords <= 0) return '尽量精炼，不要罗列所有细节'
  if (maxWords <= 2) return `最多 ${maxWords} 个词，非常简短`
  return `用 ${Math.max(2, maxWords - 1)}～${maxWords} 个词`
}

/**
 * 分隔符说明
 *
 * 中文没有词间空格，如果只靠本地后处理，模型吐出「夏天海边日落」这样一整串时，
 * 分隔符设置就完全无效了。所以这里明确告诉模型按哪种方式断词，
 * 后处理再负责兜底和统一。
 */
const SEPARATOR_HINT = {
  'zh-dash': '词与词之间用短横线「-」连接，例如：夏天-海边-日落',
  'zh-underscore': '词与词之间用下划线「_」连接，例如：夏天_海边_日落',
  'zh-space': '词与词之间用空格分开，例如：夏天 海边 日落',
  'zh-plain': '不要加任何分隔符，把词直接连起来，例如：夏天海边日落',
  'kebab-case': '词与词之间用小写短横线连接，例如：summer-beach-sunset',
  snake_case: '词与词之间用小写下划线连接，例如：summer_beach_sunset',
  camelCase: '用英文驼峰写法，例如：summerBeachSunset',
  PascalCase: '用英文帕斯卡写法，例如：SummerBeachSunset',
  raw: ''
}

/**
 * 主体规则块
 */
function buildRules ({ language, maxChars, maxWords, customPrompt, style }) {
  const lang = getLanguage(language)
  const rules = []

  if (lang.native) {
    rules.push(`必须使用${lang.native}，不要用其他语言（人名、品牌名、专有名词可保留原文）`)
  } else {
    rules.push('使用与内容一致的语言')
  }

  rules.push(`${wordHint(maxWords)}，概括主要内容，不要把所有细节都写进去`)

  if (maxChars > 0) rules.push(`总长度不超过 ${maxChars} 个字`)

  const sepHint = SEPARATOR_HINT[style]
  if (sepHint) rules.push(sepHint)

  rules.push('不要使用其他标点符号（逗号、句号、问号等一律不要）')
  rules.push('不要出现「文件名」「图片」「照片」「视频」「未命名」这类没有信息量的词')
  rules.push('不要带扩展名，不要加引号，不要加序号')
  rules.push('不要解释，不要寒暄，不要输出多余内容')

  const lines = ['你是文件命名助手。请根据下面提供的内容，起一个合适的文件名。', '', '命名要求：']
  rules.forEach((r, i) => lines.push(`${i + 1}. ${r}`))

  if (customPrompt && customPrompt.trim()) {
    lines.push('')
    lines.push('额外要求（优先级更高）：')
    lines.push(customPrompt.trim())
  }

  lines.push('')
  lines.push('只输出文件名本身，一行，不要任何其他文字。')

  return lines.join('\n')
}

/**
 * 构造完整提示词
 *
 * @param {object} opts
 * @param {'image'|'video'|'text'} opts.kind
 * @param {string} opts.language
 * @param {number} opts.maxChars
 * @param {number} opts.maxWords
 * @param {string} opts.customPrompt
 * @param {string} opts.content      文本类文件的内容
 * @param {number} opts.frameCount   视频帧数
 * @param {number} opts.duration     视频时长（秒）
 * @param {string} opts.fileName     原文件名（作为弱参考）
 */
function buildPrompt (opts = {}) {
  const {
    kind = 'text',
    language = 'zh-CN',
    maxChars = 40,
    maxWords = 6,
    customPrompt = '',
    style = 'zh-dash',
    content = '',
    frameCount = 0,
    duration = 0,
    fileName = ''
  } = opts

  const parts = []

  if (kind === 'image') {
    parts.push('这是一张图片，请仔细观察画面内容。')
    parts.push('')
  } else if (kind === 'video') {
    const dur = duration > 0 ? `时长约 ${duration.toFixed(0)} 秒` : ''
    parts.push(`这是同一个视频里按时间顺序抽取的 ${frameCount} 帧画面${dur ? `（${dur}）` : ''}。`)
    parts.push('请综合这几帧，判断视频拍的是什么场景、事件或主题。')
    parts.push('')
  }

  parts.push(buildRules({ language, maxChars, maxWords, customPrompt, style }))

  if (kind === 'text' && content) {
    parts.push('')
    parts.push('文件内容：')
    parts.push('"""')
    parts.push(content)
    parts.push('"""')
  }

  if (fileName) {
    parts.push('')
    parts.push(`（原文件名仅作参考，不必沿用：${fileName}）`)
  }

  return parts.join('\n')
}

/** 视频抽帧时给模型的一句上下文，替代原项目英文的 videoPrompt */
function buildVideoIntro ({ frameCount, duration }) {
  const dur = duration > 0 ? `，总时长约 ${duration.toFixed(1)} 秒` : ''
  return `以下是从同一段视频按时间均匀抽取的 ${frameCount} 帧画面${dur}。`
}

module.exports = { LANGUAGES, getLanguage, buildPrompt, buildVideoIntro }
