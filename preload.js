'use strict'

/**
 * 渲染进程与主进程之间的桥
 * 只暴露明确列出的方法，不把 ipcRenderer 整个丢给页面
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron')

// 主进程可能在页面刚加载完就发来「要打开的文件夹」，
// 那时渲染进程还没来得及注册监听器，消息会丢。这里先缓存，等注册时再补发。
let pendingOpenPaths = null
let openPathsHandler = null

ipcRenderer.on('app:openPaths', (_e, paths) => {
  if (openPathsHandler) openPathsHandler(paths)
  else pendingOpenPaths = paths
})

contextBridge.exposeInMainWorld('api', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),

  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: patch => ipcRenderer.invoke('settings:save', patch),

  // 选择文件
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  scanFolder: (folderPath, recursive) => ipcRenderer.invoke('files:scanFolder', { folderPath, recursive }),
  scanPaths: paths => ipcRenderer.invoke('files:scanPaths', paths),
  reveal: p => ipcRenderer.invoke('shell:revealFirst', p),
  openExternal: url => ipcRenderer.invoke('shell:openExternal', url),
  openPath: p => ipcRenderer.invoke('shell:openPath', p),
  thumb: p => ipcRenderer.invoke('file:thumb', p),
  pathForFile: file => {
    try {
      return webUtils.getPathForFile(file)
    } catch (_) {
      return ''
    }
  },

  // 模型
  listModels: cfg => ipcRenderer.invoke('model:list', cfg),
  testModel: cfg => ipcRenderer.invoke('model:test', cfg),

  // 重命名
  generate: payload => ipcRenderer.invoke('rename:generate', payload),
  cancel: () => ipcRenderer.invoke('rename:cancel'),
  apply: plans => ipcRenderer.invoke('rename:apply', plans),
  undo: batchId => ipcRenderer.invoke('rename:undo', batchId),

  // 事件订阅
  onProgress: cb => {
    const h = (_e, data) => cb(data)
    ipcRenderer.on('rename:progress', h)
    return () => ipcRenderer.removeListener('rename:progress', h)
  },
  onScanProgress: cb => {
    const h = (_e, data) => cb(data)
    ipcRenderer.on('scan:progress', h)
    return () => ipcRenderer.removeListener('scan:progress', h)
  },
  onOpenPaths: cb => {
    openPathsHandler = cb
    if (pendingOpenPaths) {
      const pending = pendingOpenPaths
      pendingOpenPaths = null
      cb(pending)
    }
  }
})
