'use strict'

/**
 * 文件扫描
 *
 * 决定「哪些文件能被处理」，以及每个文件归到哪一类。
 * 分类直接决定后面喂给模型的是图片、视频帧还是正文。
 */

const fs = require('fs')
const fsp = fs.promises
const path = require('path')

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif', '.tif', '.tiff'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.mts', '.m2ts'])
const DOC_EXTS = new Set(['.pdf', '.docx', '.xlsx', '.txt', '.md', '.markdown', '.csv', '.json', '.xml', '.yml', '.yaml', '.html', '.htm', '.log'])
const CODE_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
  '.py', '.rb', '.php', '.java', '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.go', '.rs',
  '.swift', '.kt', '.scala', '.lua', '.pl', '.r', '.dart', '.sql', '.sh', '.bash',
  '.bat', '.cmd', '.ps1', '.css', '.scss', '.less'
])

/** 整个大类 */
const ALL_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS, ...DOC_EXTS, ...CODE_EXTS])

const MAX_FILES = 5000

function kindOf (ext) {
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (CODE_EXTS.has(ext)) return 'code'
  if (DOC_EXTS.has(ext)) return 'doc'
  return null
}

const KIND_LABEL = {
  image: '图片',
  video: '视频',
  doc: '文档',
  code: '代码'
}

function isSupported (filePath) {
  return ALL_EXTS.has(path.extname(filePath).toLowerCase())
}

function formatSize (bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

let seq = 0

function makeItem (filePath, stat) {
  const ext = path.extname(filePath).toLowerCase()
  const kind = kindOf(ext)
  return {
    id: `f${++seq}`,
    path: filePath,
    dir: path.dirname(filePath),
    fileName: path.basename(filePath),
    baseName: path.basename(filePath, ext),
    ext,
    kind,
    kindLabel: KIND_LABEL[kind] || '其他',
    size: stat.size,
    sizeText: formatSize(stat.size),
    mtime: stat.mtimeMs,
    mtimeText: new Date(stat.mtimeMs).toLocaleString('zh-CN', { hour12: false }),
    // 处理状态：pending 待生成 / running 生成中 / done 已生成 / error 失败 / renamed 已重命名
    status: 'pending',
    newName: '',
    error: '',
    selected: true
  }
}

/**
 * 扫描目录
 * @param {string} dir
 * @param {object} opts
 * @param {boolean} opts.recursive 是否包含子目录
 * @param {(n:number)=>void} opts.onProgress
 */
async function scanDirectory (dir, { recursive = false, onProgress } = {}) {
  const results = []
  const skipped = { unsupported: 0, hidden: 0 }

  async function walk (current) {
    if (results.length >= MAX_FILES) return
    let entries
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch (_) {
      return
    }

    // 目录在前、文件在后，并且按名称自然排序，观感更顺
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
    })

    for (const entry of entries) {
      if (results.length >= MAX_FILES) return

      if (entry.name.startsWith('.') || entry.name.startsWith('~$') || entry.name === 'Thumbs.db') {
        skipped.hidden++
        continue
      }

      const full = path.join(current, entry.name)

      if (entry.isDirectory()) {
        if (recursive) await walk(full)
        continue
      }

      if (!entry.isFile()) continue

      if (!isSupported(full)) {
        skipped.unsupported++
        continue
      }

      try {
        const stat = await fsp.stat(full)
        results.push(makeItem(full, stat))
        if (onProgress && results.length % 50 === 0) onProgress(results.length)
      } catch (_) { /* 权限问题或文件已消失，跳过 */ }
    }
  }

  await walk(dir)
  return { files: results, skipped, limited: results.length >= MAX_FILES }
}

/** 扫描用户直接拖入/选中的一批路径 */
async function scanPaths (paths) {
  const results = []
  const seen = new Set()
  let skippedUnsupported = 0

  for (const p of paths) {
    let stat
    try {
      stat = await fsp.stat(p)
    } catch (_) {
      continue
    }
    if (stat.isDirectory()) {
      const r = await scanDirectory(p, { recursive: false })
      for (const f of r.files) {
        if (!seen.has(f.path)) { seen.add(f.path); results.push(f) }
      }
      skippedUnsupported += r.skipped.unsupported
    } else if (stat.isFile()) {
      if (!isSupported(p)) { skippedUnsupported++; continue }
      if (seen.has(p)) continue
      seen.add(p)
      results.push(makeItem(p, stat))
    }
  }

  return { files: results, skipped: { unsupported: skippedUnsupported }, limited: false }
}

module.exports = {
  scanDirectory,
  scanPaths,
  makeItem,
  isSupported,
  kindOf,
  KIND_LABEL,
  formatSize,
  ALL_EXTS,
  MAX_FILES
}
