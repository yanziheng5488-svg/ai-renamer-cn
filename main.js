'use strict'

/**
 * 智名 · AI 文件重命名
 * Copyright (C) 2026 智名项目贡献者
 *
 * 本文件是 GPL-3.0 作品。完整许可证见项目根目录 LICENSE。
 *
 * 本项目衍生自 ai-renamer（作者 Ozgur Ozer，https://github.com/ozgrozer/ai-renamer，GPL-3.0），
 * 于 2026 年 10 月做了大幅修改：新增桌面界面，重写中文命名引擎、多厂商模型接入层、
 * 文档解析与改名/撤销机制。来源与改动详情见 NOTICE.md。
 */

/**
 * Electron 主进程
 *
 * 只做三件事：开窗口、接渲染进程的请求、把重活交给 lib/ 里的纯逻辑模块。
 * 所有文件系统操作都在主进程，渲染进程拿不到 Node 能力（contextIsolation 开启）。
 */

const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, webUtils, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const scanner = require('./lib/scanner')
const providers = require('./lib/providers')
const frames = require('./lib/frames')
const store = require('./lib/store')
const { generateNames, applyRenames, undoRenames } = require('./lib/renamer')
const { PRESETS, findPreset } = require('./lib/presets')
const { STYLES } = require('./lib/namer')
const { LANGUAGES } = require('./lib/prompt')

let mainWindow = null
let abortFlag = false
let busy = false

// 配置目录固定成英文路径。
// 默认会按 productName（「智名 AI 文件重命名」）建中文目录，遇到编码或权限问题容易出岔子，
// 而且用户也不容易找到。这里统一放到 %APPDATA%\AiRenamerCN。
app.setPath('userData', path.join(app.getPath('appData'), 'AiRenamerCN'))

// ---------- 窗口 ----------

/** 从命令行参数里找要打开的文件/文件夹（拖到图标上启动时会带上） */
function findLaunchPath () {
  const args = process.argv.slice(app.isPackaged ? 1 : 2)
  for (const a of args) {
    if (!a || a.startsWith('--')) continue
    if (a === '.') continue
    try {
      if (fs.existsSync(a)) return a
    } catch (_) { /* 忽略非法路径 */ }
  }
  return null
}

function createWindow () {
  // 按屏幕可用区域定尺寸。高分屏（如 175% 缩放）下逻辑宽度可能只有 1100 左右，
  // 写死 1400 会被系统裁掉一截，所以这里按比例算。
  const { workAreaSize } = screen.getPrimaryDisplay()
  const winWidth = Math.min(1400, Math.max(980, Math.round(workAreaSize.width * 0.94)))
  const winHeight = Math.min(900, Math.max(640, Math.round(workAreaSize.height * 0.94)))

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 960,
    minHeight: 620,
    center: true,
    show: false,
    backgroundColor: '#f6f7f9',
    title: '智名 · AI 文件重命名',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#ffffff',
      symbolColor: '#4a5568',
      height: 46
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // 支持「把文件/文件夹拖到程序图标上」直接打开
  const launchPath = findLaunchPath()
  mainWindow.webContents.once('did-finish-load', () => {
    if (launchPath) send('app:openPaths', [launchPath])
  })

  mainWindow.on('closed', () => { mainWindow = null })

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  // 开发辅助：--exec=<脚本> 可在页面里执行一段脚本，--screenshot=<路径> 随后截图退出
  // 默认只在未打包时可用；打包后需要显式设置 AIRENAMER_DEV=1 才会启用
  const devMode = !app.isPackaged || process.env.AIRENAMER_DEV === '1'
  const shotArg = devMode ? process.argv.find(a => a.startsWith('--screenshot=')) : null
  const execArg = devMode ? process.argv.find(a => a.startsWith('--exec=')) : null
  if (shotArg || execArg) {
    const out = shotArg ? shotArg.slice('--screenshot='.length) : ''
    const delay = Number((process.argv.find(a => a.startsWith('--shot-delay=')) || '').split('=')[1]) || 1600
    mainWindow.webContents.once('did-finish-load', async () => {
      if (execArg) {
        try {
          const script = fs.readFileSync(execArg.slice('--exec='.length), 'utf8')
          const r = await mainWindow.webContents.executeJavaScript(script)
          console.log(`[exec] ${JSON.stringify(r)}`)
        } catch (err) {
          console.error('[exec] failed', err.message)
        }
      }
      setTimeout(async () => {
        if (out) {
          try {
            const img = await mainWindow.webContents.capturePage()
            fs.writeFileSync(out, img.toPNG())
            console.log(`[screenshot] ${out}`)
          } catch (err) {
            console.error('[screenshot] failed', err)
          }
        }
        app.quit()
      }, delay)
    })
  }

  // 开发辅助：把渲染进程的报错打到主进程控制台
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`)
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

const send = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

// ---------- 基础信息 ----------

ipcMain.handle('app:bootstrap', async () => {
  const ff = await frames.checkFFmpeg()
  return {
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
    ffmpeg: ff,
    presets: PRESETS,
    styles: STYLES,
    languages: LANGUAGES,
    settings: store.getPublicSettings(),
    encryptionAvailable: store.canEncrypt(),
    undoBatches: store.listUndoBatches().map(b => ({
      id: b.id, time: b.time, count: b.count
    }))
  }
})

ipcMain.handle('shell:openExternal', (_e, url) => {
  if (/^https?:/.test(url)) shell.openExternal(url)
  return true
})

ipcMain.handle('shell:showItem', (_e, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath)
  return true
})

ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p))

ipcMain.handle('file:thumb', async (_e, filePath) => {
  try {
    const img = nativeImage.createFromPath(filePath)
    if (img.isEmpty()) return null
    const size = img.getSize()
    const edge = Math.max(size.width, size.height)
    const scale = edge > 96 ? 96 / edge : 1
    const thumb = img.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'good'
    })
    return thumb.toDataURL()
  } catch (_) {
    return null
  }
})

ipcMain.handle('path:fromFile', (_e, file) => {
  try {
    return webUtils.getPathForFile(file)
  } catch (_) {
    return ''
  }
})

// ---------- 设置 ----------

ipcMain.handle('settings:get', () => store.getPublicSettings())

ipcMain.handle('settings:save', (_e, patch) => store.saveSettings(patch))

// ---------- 选择文件 ----------

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择要处理的文件夹',
    properties: ['openDirectory'],
    buttonLabel: '使用这个文件夹'
  })
  if (r.canceled || !r.filePaths.length) return null
  return r.filePaths[0]
})

ipcMain.handle('dialog:pickFiles', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择文件',
    properties: ['openFile', 'multiSelections'],
    buttonLabel: '添加'
  })
  if (r.canceled) return []
  return r.filePaths
})

ipcMain.handle('files:scanFolder', async (_e, { folderPath, recursive }) => {
  if (!folderPath || !fs.existsSync(folderPath)) {
    throw new Error('文件夹不存在')
  }
  const t0 = Date.now()
  const r = await scanner.scanDirectory(folderPath, {
    recursive: Boolean(recursive),
    onProgress: n => send('scan:progress', { count: n })
  })
  return { ...r, ms: Date.now() - t0 }
})

ipcMain.handle('files:scanPaths', async (_e, paths) => {
  const list = Array.isArray(paths) ? paths.filter(Boolean) : []
  if (!list.length) return { files: [], skipped: { unsupported: 0 } }
  return scanner.scanPaths(list)
})

ipcMain.handle('files:revealFirst', (_e, p) => {
  if (p && fs.existsSync(p)) shell.showItemInFolder(p)
})

// ---------- 模型 ----------

ipcMain.handle('model:list', async (_e, cfg) => {
  try {
    const list = await providers.listModels({
      protocol: cfg.protocol || 'openai',
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey
    })
    return { ok: true, models: list }
  } catch (err) {
    return { ok: false, ...providers.explainError(err, { baseURL: cfg.baseURL }) }
  }
})

ipcMain.handle('model:test', async (_e, cfg) => {
  return providers.testConnection({
    protocol: cfg.protocol || 'openai',
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    model: cfg.model
  })
})

// ---------- 生成名字 ----------

ipcMain.handle('rename:cancel', () => {
  abortFlag = true
  return true
})

ipcMain.handle('rename:generate', async (_e, { files, settings }) => {
  if (busy) return { ok: false, message: '上一批还在处理中，请稍候' }
  busy = true
  abortFlag = false

  // 主进程这边持有文件对象，渲染进程只传 id + 必要字段
  const items = files.map(f => ({ ...f }))

  try {
    const preset = findPreset(settings.presetId)
    const cfg = settings.perPreset?.[settings.presetId] || {}

    const merged = {
      protocol: preset.protocol,
      baseURL: cfg.baseURL || preset.baseURL,
      apiKey: cfg.apiKey || '',
      model: cfg.model || (preset.models[0] && preset.models[0].name) || '',
      style: settings.style,
      language: settings.language,
      maxChars: Number(settings.maxChars) || 40,
      maxWords: Number(settings.maxWords) || 6,
      customPrompt: settings.customPrompt || '',
      prefix: settings.prefix || '',
      suffix: settings.suffix || '',
      framesPerVideo: Number(settings.framesPerVideo) || 3,
      concurrency: Math.max(1, Math.min(8, Number(settings.concurrency) || 3)),
      ffmpegPath: settings.ffmpegPath || 'ffmpeg',
      ffprobePath: settings.ffprobePath || 'ffprobe'
    }

    if (!merged.model) {
      return { ok: false, message: '还没有选择模型，请先在右侧选择服务商和模型' }
    }
    if (preset.protocol === 'openai' && !merged.baseURL) {
      return { ok: false, message: '接口地址为空，请填写服务的 API 地址' }
    }

    const result = await generateNames({
      files: items,
      settings: merged,
      onEvent: e => send('rename:progress', e),
      isAborted: () => abortFlag
    })

    return { ok: true, aborted: abortFlag, finished: result.finished, total: result.total }
  } catch (err) {
    return { ok: false, message: providers.explainError(err).message }
  } finally {
    busy = false
    abortFlag = false
  }
})

// ---------- 执行改名 ----------

ipcMain.handle('rename:apply', async (_e, plans) => {
  if (busy) return { success: false, message: '正在处理，请稍候' }
  if (!Array.isArray(plans) || !plans.length) {
    return { success: false, message: '没有要改名的文件' }
  }

  busy = true
  try {
    const result = await applyRenames(plans)
    if (!result.ok.length) {
      return {
        success: false,
        message: result.failed[0]?.error || '全部改名失败',
        renamed: [],
        failed: result.failed
      }
    }

    const batch = {
      id: crypto.randomUUID(),
      time: Date.now(),
      count: result.ok.length,
      records: result.ok.map(r => ({
        from: r.from,
        to: r.to,
        originalName: r.originalName,
        newName: r.newName
      }))
    }
    store.pushUndoBatch(batch)

    return {
      success: true,
      batchId: batch.id,
      renamed: result.ok,
      failed: result.failed
    }
  } catch (err) {
    return { success: false, message: err.message, renamed: [], failed: [] }
  } finally {
    busy = false
  }
})

ipcMain.handle('rename:undo', async (_e, batchId) => {
  if (busy) return { success: false, message: '正在处理，请稍候' }
  busy = true
  try {
    const batch = store.popUndoBatch(batchId)
    if (!batch) return { success: false, message: '找不到这条撤销记录' }

    const result = await undoRenames(batch.records)

    // 部分失败的话，把失败的记录留成一条新记录，方便再试一次
    if (result.failed.length) {
      store.pushUndoBatch({
        id: crypto.randomUUID(),
        time: Date.now(),
        count: result.failed.length,
        records: result.failed.map(f => ({
          from: f.from, to: f.to, originalName: f.originalName, newName: f.newName
        }))
      })
    }

    return {
      success: result.ok.length > 0,
      restored: result.ok.length,
      restoredList: result.ok,
      failed: result.failed,
      message: result.ok.length ? '' : (result.failed[0]?.error || '没有可还原的文件')
    }
  } catch (err) {
    return { success: false, message: err.message, restored: 0, restoredList: [], failed: [] }
  } finally {
    busy = false
  }
})
