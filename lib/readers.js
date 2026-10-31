'use strict'

/**
 * 文本内容读取
 *
 * 原项目直接 fs.readFile(filePath, 'utf8')，在中文 Windows 上遇到 GBK/GB18030
 * 编码的 txt 会整篇乱码。国内大量老资料、导出的聊天记录、政府/企业文档都是 GBK，
 * 所以这里做编码嗅探。
 */

const fs = require('fs').promises
const path = require('path')

const MAX_TEXT_CHARS = 6000 // 送给模型的正文上限，太多既费 token 又干扰判断

/** 判断 Buffer 是否为合法 UTF-8 */
function isValidUTF8 (buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return true
  } catch (_) {
    return false
  }
}

/**
 * 解码文本，自动识别 BOM / UTF-8 / GBK
 */
function decodeBuffer (buf) {
  // BOM 优先
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return { text: buf.slice(3).toString('utf8'), encoding: 'UTF-8 (BOM)' }
  }
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    try {
      return { text: new TextDecoder('utf-16le').decode(buf.slice(2)), encoding: 'UTF-16LE' }
    } catch (_) { /* 继续 */ }
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    try {
      return { text: new TextDecoder('utf-16be').decode(buf.slice(2)), encoding: 'UTF-16BE' }
    } catch (_) { /* 继续 */ }
  }

  if (isValidUTF8(buf)) {
    return { text: buf.toString('utf8'), encoding: 'UTF-8' }
  }

  // 退回 GB18030（兼容 GBK / GB2312，是中文 Windows 的默认代码页）
  for (const enc of ['gb18030', 'gbk', 'big5']) {
    try {
      return { text: new TextDecoder(enc).decode(buf), encoding: enc.toUpperCase() }
    } catch (_) { /* 试下一个 */ }
  }

  return { text: buf.toString('latin1'), encoding: 'Latin-1' }
}

/** 清理正文：合并空白、去掉大量重复空行 */
function tidyText (text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 智能截取：开头 + 结尾各取一半，比只取开头更能抓到文档主题 */
function smartSlice (text, limit = MAX_TEXT_CHARS) {
  if (text.length <= limit) return text
  const head = Math.floor(limit * 0.7)
  const tail = limit - head
  return `${text.slice(0, head)}\n\n……（中间省略）……\n\n${text.slice(-tail)}`
}

/**
 * 读取 PDF。pdf-parse 内部是 pdf.js，能解析文本层；
 * 扫描件（纯图片 PDF）没有文本层，会返回空字符串，需要提示用户。
 */
async function readPDF (filePath) {
  let pdfParse
  try {
    pdfParse = require('pdf-parse')
  } catch (_) {
    throw new Error('PDF 解析组件未安装，暂时无法处理 PDF')
  }
  const buf = await fs.readFile(filePath)
  const data = await pdfParse(buf)
  return {
    text: tidyText(data.text || ''),
    pages: data.numpages || 0,
    isScanned: !(data.text || '').trim()
  }
}

/**
 * 读取 Word(.docx)。
 * docx 本质是个 zip，正文在 word/document.xml 里，剥掉标签就是纯文本。
 * 老版 .doc（二进制格式）无法这样解，需要提示用户。
 */
async function readDOCX (filePath) {
  const JSZip = require('jszip')
  const buf = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buf)
  const doc = zip.file('word/document.xml')
  if (!doc) throw new Error('这个 Word 文件结构异常，读不出正文')

  const xml = await doc.async('string')
  const text = xml
    .replace(/<w:p[^>]*>/g, '\n')       // 段落 → 换行
    .replace(/<w:tab[^>]*\/>/g, ' ')     // 制表符
    .replace(/<w:br[^>]*\/>/g, '\n')     // 手动换行
    .replace(/<[^>]+>/g, '')             // 其余标签全部剥掉
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")

  return tidyText(text)
}

/**
 * 读取 Excel(.xlsx)：把工作簿里所有单元格的文字拼起来，
 * 这样即使表格只有标题行也能大致判断主题。
 */
async function readXLSX (filePath) {
  const JSZip = require('jszip')
  const buf = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buf)

  const stringsFile = zip.file('xl/sharedStrings.xml')
  const parts = []
  if (stringsFile) {
    const xml = await stringsFile.async('string')
    const matches = xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []
    for (const m of matches) {
      const t = m.replace(/<[^>]+>/g, '').trim()
      if (t) parts.push(t)
    }
  }

  // 工作表名字往往就是主题（如「2026 年 3 月销售明细」）
  const wb = zip.file('xl/workbook.xml')
  if (wb) {
    const xml = await wb.async('string')
    const names = xml.match(/<sheet[^>]*name="([^"]*)"/g) || []
    const sheetNames = names.map(s => s.replace(/.*name="([^"]*)".*/, '$1')).filter(Boolean)
    if (sheetNames.length) parts.unshift(`工作表：${sheetNames.join('、')}`)
  }

  return tidyText(parts.join(' '))
}

/**
 * 读取文件文本内容
 * @returns {Promise<{ text: string, encoding: string, note?: string }>}
 */
async function readFileContent (filePath, { limit = MAX_TEXT_CHARS } = {}) {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.pdf') {
    const r = await readPDF(filePath)
    if (r.isScanned) {
      return { text: '', encoding: 'PDF', note: '这是扫描版 PDF，里面没有文字层，需要视觉模型才能识别' }
    }
    return { text: smartSlice(r.text, limit), encoding: 'PDF', note: `${r.pages} 页` }
  }

  if (ext === '.docx') {
    const text = await readDOCX(filePath)
    return { text: smartSlice(text, limit), encoding: 'DOCX' }
  }

  if (ext === '.doc') {
    throw new Error('不支持旧版 .doc 格式，请用 Word 另存为 .docx 后再试')
  }

  if (ext === '.xlsx') {
    const text = await readXLSX(filePath)
    return { text: smartSlice(text, limit), encoding: 'XLSX' }
  }

  const buf = await fs.readFile(filePath)

  // 大文件只读前若干字节，避免把 500MB 的日志整个塞进来
  const maxBytes = 512 * 1024
  const slice = buf.length > maxBytes ? buf.slice(0, maxBytes) : buf

  const { text, encoding } = decodeBuffer(slice)
  const cleaned = tidyText(text)

  return {
    text: smartSlice(cleaned, limit),
    encoding,
    truncated: buf.length > maxBytes
  }
}

/**
 * 粗略判断一个文件是否是纯文本（用于避免对二进制文件瞎读）
 */
function looksBinary (buf) {
  const n = Math.min(buf.length, 4096)
  let control = 0
  for (let i = 0; i < n; i++) {
    const b = buf[i]
    if (b === 0) return true
    if (b < 7 || (b > 13 && b < 32)) control++
  }
  return control / Math.max(1, n) > 0.1
}

module.exports = { readFileContent, decodeBuffer, tidyText, smartSlice, looksBinary }
