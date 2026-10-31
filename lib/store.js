'use strict'

/**
 * 配置与撤销记录持久化
 *
 * API Key 用 Electron 的 safeStorage 走系统凭据（Windows 上是 DPAPI），
 * 落盘的是密文，不写明文，避免配置文件和日志被翻出来时泄露。
 */

const fs = require('fs')
const path = require('path')

let app = null
let safeStorage = null
try {
  const electron = require('electron')
  app = electron.app
  safeStorage = electron.safeStorage
} catch (_) { /* 单元测试环境 */ }

const baseDir = () => {
  if (app) return app.getPath('userData')
  return path.join(process.env.APPDATA || process.cwd(), 'ai-renamer-cn')
}

const settingsPath = () => path.join(baseDir(), 'settings.json')
const undoPath = () => path.join(baseDir(), 'undo-log.json')

const DEFAULT_SETTINGS = {
  presetId: 'zhipu',
  perPreset: {},
  style: 'zh-dash',
  language: 'zh-CN',
  maxChars: 40,
  maxWords: 6,
  customPrompt: '',
  framesPerVideo: 3,
  concurrency: 3,
  recursive: false,
  prefix: '',
  suffix: '',
  lastFolders: []
}

function ensureDir () {
  const dir = baseDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function readJSON (file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (_) {
    return fallback
  }
}

function writeJSON (file, data) {
  ensureDir()
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

// ---------- 密钥加解密 ----------

function canEncrypt () {
  try {
    return Boolean(safeStorage && safeStorage.isEncryptionAvailable())
  } catch (_) {
    return false
  }
}

function encryptKey (plain) {
  if (!plain) return ''
  if (!canEncrypt()) return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
  try {
    return `enc:${safeStorage.encryptString(plain).toString('base64')}`
  } catch (_) {
    return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
  }
}

function decryptKey (stored) {
  if (!stored) return ''
  try {
    if (stored.startsWith('enc:')) {
      if (!canEncrypt()) return ''
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    }
    return stored
  } catch (_) {
    return ''
  }
}

// ---------- 设置读写 ----------

function loadSettings () {
  const raw = readJSON(settingsPath(), {})
  const merged = { ...DEFAULT_SETTINGS, ...raw }
  merged.perPreset = raw.perPreset || {}
  return merged
}

/**
 * 保存设置。apiKey 传进来是明文，落盘前加密。
 */
function saveSettings (patch) {
  const current = loadSettings()
  const next = { ...current, ...patch }

  if (patch && patch.perPreset) {
    next.perPreset = {}
    for (const [id, cfg] of Object.entries(patch.perPreset)) {
      next.perPreset[id] = {
        ...cfg,
        apiKey: encryptKey(cfg.apiKey || '')
      }
    }
  }

  writeJSON(settingsPath(), next)
  return publicSettings(next)
}

/** 返回给界面的版本：密钥解密成明文（只在本地渲染进程里用），并附带一个「是否已配置」标记 */
function publicSettings (s) {
  const perPreset = {}
  for (const [id, cfg] of Object.entries(s.perPreset || {})) {
    perPreset[id] = {
      baseURL: cfg.baseURL || '',
      model: cfg.model || '',
      apiKey: decryptKey(cfg.apiKey),
      hasKey: Boolean(cfg.apiKey)
    }
  }
  const { perPreset: _omit, ...rest } = s
  return { ...rest, perPreset }
}

function getPublicSettings () {
  return publicSettings(loadSettings())
}

// ---------- 撤销记录 ----------

const MAX_BATCHES = 20

function loadUndoLog () {
  return readJSON(undoPath(), { batches: [] })
}

function pushUndoBatch (batch) {
  const log = loadUndoLog()
  log.batches.unshift(batch)
  if (log.batches.length > MAX_BATCHES) log.batches.length = MAX_BATCHES
  writeJSON(undoPath(), log)
  return batch
}

function popUndoBatch (batchId) {
  const log = loadUndoLog()
  const idx = log.batches.findIndex(b => b.id === batchId)
  if (idx === -1) return null
  const [batch] = log.batches.splice(idx, 1)
  writeJSON(undoPath(), log)
  return batch
}

function listUndoBatches () {
  return loadUndoLog().batches
}

module.exports = {
  loadSettings,
  saveSettings,
  getPublicSettings,
  pushUndoBatch,
  popUndoBatch,
  listUndoBatches,
  canEncrypt
}
