'use strict'

/**
 * 视频抽帧
 *
 * 相对原项目的两处关键修正：
 *  1. 原版把临时目录写死为 `/tmp/ai-renamer/...`，在 Windows 上根本无法创建，
 *     视频重命名功能等于直接坏掉。这里改用系统临时目录。
 *  2. 原版 numFrames = Math.min(frames, Math.floor(duration))，
 *     遇到时长不足 1 秒的视频会得到 0 帧，接着除零产生 Infinity/NaN，
 *     ffmpeg 参数非法导致整条流程报错。这里做了下限保护。
 */

const fs = require('fs')
const fsp = fs.promises
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const crypto = require('crypto')

const FFMPEG_TIMEOUT = 120000

function run (bin, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(stderr || err.message)
        e.stderr = stderr
        e.code = err.code
        reject(e)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

/** 探测 ffmpeg 是否可用 */
async function checkFFmpeg (ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe') {
  try {
    const { stdout } = await run(ffmpegPath, ['-version'], 10000)
    const first = String(stdout).split('\n')[0] || ''
    return { ok: true, version: first.trim() }
  } catch (err) {
    return {
      ok: false,
      message: '没有找到 ffmpeg，视频类文件暂时无法处理。图片和文本文件不受影响。'
    }
  }
}

/** 读取视频时长（秒） */
async function getDuration (inputFile, ffprobePath = 'ffprobe') {
  try {
    const { stdout } = await run(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputFile
    ], 20000)
    const d = parseFloat(String(stdout).trim())
    return Number.isFinite(d) && d > 0 ? d : 0
  } catch (_) {
    return 0
  }
}

/**
 * 均匀抽取 n 帧
 * @returns {Promise<{ images: string[], dir: string, duration: number, count: number }>}
 */
async function extractFrames (inputFile, { frames = 3, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe' } = {}) {
  const duration = await getDuration(inputFile, ffprobePath)

  // 时长未知时保守取 1 帧，避免除零
  const want = Math.max(1, Math.min(Number(frames) || 3, 10))
  let count = want
  if (duration > 0) {
    count = Math.max(1, Math.min(want, Math.ceil(duration)))
  }

  const dir = path.join(os.tmpdir(), 'ai-renamer-cn', crypto.randomUUID())
  await fsp.mkdir(dir, { recursive: true })

  const images = []
  try {
    for (let i = 0; i < count; i++) {
      // 取每个时间片的中间位置，避开片头黑场和片尾
      const t = duration > 0 ? (duration * (i + 0.5)) / count : 0
      const out = path.join(dir, `frame_${String(i + 1).padStart(3, '0')}.jpg`)
      const args = []
      if (t > 0) args.push('-ss', t.toFixed(3))
      args.push(
        '-i', inputFile,
        '-frames:v', '1',
        '-vf', 'scale=1024:-2:force_original_aspect_ratio=decrease',
        '-q:v', '4',
        '-y', out
      )
      await run(ffmpegPath, args, FFMPEG_TIMEOUT)
      if (fs.existsSync(out) && fs.statSync(out).size > 0) {
        images.push(out)
      }
    }
  } catch (err) {
    await cleanup(dir)
    throw new Error(`视频抽帧失败：${String(err.message).slice(0, 200)}`)
  }

  if (!images.length) {
    await cleanup(dir)
    throw new Error('没能从这个视频里抽到画面，文件可能已损坏或格式不被支持')
  }

  return { images, dir, duration, count: images.length }
}

async function cleanup (dir) {
  if (!dir) return
  try {
    await fsp.rm(dir, { recursive: true, force: true })
  } catch (_) { /* 清理失败不影响主流程 */ }
}

module.exports = { extractFrames, cleanup, checkFFmpeg, getDuration }
