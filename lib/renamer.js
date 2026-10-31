'use strict'

/**
 * 重命名执行引擎
 *
 * 两件事：生成新名字（调模型）、真正落盘改名。
 *
 * 批量改名有个容易翻车的点：同一批里 A→B 而 B→C 时，如果按顺序直接改，
 * A→B 会失败（B 还在）。所以这里分两阶段：
 *   阶段一：所有文件先改成临时名，腾出位置
 *   阶段二：临时名改成最终名
 * 中途出错会尽力回滚，并且整个过程写撤销日志。
 */

const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')

const providers = require('./providers')
const readers = require('./readers')
const frames = require('./frames')
const scanner = require('./scanner')
const { buildPrompt } = require('./prompt')
const { buildName, makeUniqueName } = require('./namer')

// ---------- 并发池 ----------

async function pool (items, limit, worker) {
  let cursor = 0
  const n = Math.max(1, Math.min(limit, items.length))
  const runners = Array.from({ length: n }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      await worker(items[idx], idx)
    }
  })
  await Promise.all(runners)
}

// ---------- 生成新名字 ----------

/**
 * @param {object} opts
 * @param {Array} opts.files      文件项
 * @param {object} opts.settings  模型与命名设置
 * @param {(e:object)=>void} opts.onEvent 进度回调
 * @param {()=>boolean} opts.isAborted
 */
async function generateNames ({ files, settings, onEvent = () => {}, isAborted = () => false }) {
  const {
    protocol,
    baseURL,
    apiKey,
    model,
    style,
    language,
    maxChars,
    maxWords,
    customPrompt,
    prefix,
    suffix,
    framesPerVideo,
    concurrency,
    ffmpegPath,
    ffprobePath
  } = settings

  const total = files.length
  let finished = 0

  // 同批次内也去重，避免十几张图都叫「海边日落」
  const usedNames = new Map() // dir -> Set(lowercase full name)

  const getUsedSet = dir => {
    if (!usedNames.has(dir)) {
      const set = new Set()
      try {
        for (const name of fs.readdirSync(dir)) set.add(name.toLowerCase())
      } catch (_) { /* 目录读不到就算了 */ }
      usedNames.set(dir, set)
    }
    return usedNames.get(dir)
  }

  await pool(files, concurrency || 3, async file => {
    if (isAborted()) return

    onEvent({ type: 'file-start', id: file.id, fileName: file.fileName })

    try {
      const images = []
      let content = ''
      let frameNote = ''
      let duration = 0

      if (file.kind === 'image') {
        images.push(file.path)
      } else if (file.kind === 'video') {
        const r = await frames.extractFrames(file.path, {
          frames: framesPerVideo || 3,
          ffmpegPath: ffmpegPath || 'ffmpeg',
          ffprobePath: ffprobePath || 'ffprobe'
        })
        images.push(...r.images)
        duration = r.duration
        frameNote = `${r.count} 帧`
        file._frameDir = r.dir
      } else {
        const r = await readers.readFileContent(file.path)
        content = r.text
        if (!content) {
          throw new Error(r.note || '这个文件里没有可读取的文字内容')
        }
      }

      const prompt = buildPrompt({
        kind: file.kind === 'image' ? 'image' : file.kind === 'video' ? 'video' : 'text',
        language,
        maxChars,
        maxWords,
        customPrompt,
        style,
        content,
        frameCount: images.length,
        duration,
        fileName: file.fileName
      })

      const raw = await providers.chat({
        protocol,
        baseURL,
        apiKey,
        model,
        prompt,
        images,
        timeout: 180000
      })

      const built = buildName(raw, {
        style,
        maxChars,
        maxWords,
        ext: file.ext,
        prefix: prefix || '',
        suffix: suffix || ''
      })

      if (!built.ok) throw new Error(built.reason || '模型没有给出可用名字')

      // 目录内 + 批次内双重去重
      const used = getUsedSet(file.dir)
      const fullName = makeUniqueName(built.name, file.ext, used)

      finished++
      onEvent({
        type: 'file-done',
        id: file.id,
        newName: fullName,
        raw: String(raw).trim().slice(0, 120),
        frameNote,
        finished,
        total
      })
    } catch (err) {
      const e = providers.explainError(err, { baseURL })
      finished++
      onEvent({
        type: 'file-error',
        id: file.id,
        error: e.message,
        code: e.code,
        finished,
        total
      })
    } finally {
      if (file._frameDir) {
        await frames.cleanup(file._frameDir)
        delete file._frameDir
      }
    }
  })

  return { finished, total }
}

// ---------- 落盘改名 ----------

const tmpName = ext => `.airenamer-${crypto.randomUUID().slice(0, 8)}${ext}`

/**
 * 执行改名
 * @param {Array<{path:string,newName:string}>} plans
 * @returns {Promise<{ ok:Array, failed:Array }>}
 */
async function applyRenames (plans) {
  const ok = []
  const failed = []
  const staged = []

  // 阶段一：先挪到临时名
  for (const p of plans) {
    const dir = path.dirname(p.path)
    const ext = path.extname(p.path)
    const tmp = path.join(dir, tmpName(ext))
    try {
      if (!fs.existsSync(p.path)) throw new Error('文件已不存在')
      await fsp.rename(p.path, tmp)
      staged.push({ ...p, tmp })
    } catch (err) {
      failed.push({ ...p, error: `准备改名失败：${err.message}` })
    }
  }

  // 阶段二：临时名 → 最终名
  for (const s of staged) {
    const target = path.join(path.dirname(s.path), s.newName)
    try {
      // 极少数情况下目标在这期间被占用
      let finalPath = target
      if (fs.existsSync(target)) {
        const ext = path.extname(s.newName)
        const base = path.basename(s.newName, ext)
        let i = 2
        while (fs.existsSync(finalPath) && i < 9999) {
          finalPath = path.join(path.dirname(s.path), `${base}(${i})${ext}`)
          i++
        }
      }
      await fsp.rename(s.tmp, finalPath)
      ok.push({ from: s.path, to: finalPath, originalName: path.basename(s.path), newName: path.basename(finalPath) })
    } catch (err) {
      // 改名失败，把临时名还原
      try {
        await fsp.rename(s.tmp, s.path)
      } catch (_) { /* 还原也失败就只能保留临时名，日志里能查到 */ }
      failed.push({ ...s, error: `改名失败：${err.message}` })
    }
  }

  return { ok, failed }
}

/**
 * 撤销：把 to 改回 from（同样两阶段，防止对调冲突）
 */
async function undoRenames (records) {
  const reversed = records
    .filter(r => r && r.to && r.from)
    .reverse()

  const ok = []
  const failed = []
  const staged = []

  for (const r of reversed) {
    try {
      if (!fs.existsSync(r.to)) throw new Error('文件已不在原位置，可能被手动移动或删除了')
      const tmp = path.join(path.dirname(r.to), tmpName(path.extname(r.to)))
      await fsp.rename(r.to, tmp)
      staged.push({ ...r, tmp })
    } catch (err) {
      failed.push({ ...r, error: err.message })
    }
  }

  for (const s of staged) {
    try {
      if (fs.existsSync(s.from)) {
        throw new Error('原文件名已被其他文件占用')
      }
      await fsp.rename(s.tmp, s.from)
      ok.push(s)
    } catch (err) {
      try { await fsp.rename(s.tmp, s.to) } catch (_) { /* ignore */ }
      failed.push({ ...s, error: err.message })
    }
  }

  return { ok, failed }
}

module.exports = { generateNames, applyRenames, undoRenames, pool }
