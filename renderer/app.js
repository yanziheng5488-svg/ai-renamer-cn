'use strict'

/* ============================================================
   渲染进程逻辑
   ============================================================ */

const $ = sel => document.querySelector(sel)
const $$ = sel => Array.from(document.querySelectorAll(sel))
// 注意：不能写成 const api = window.api。
// window.api 由 contextBridge 注入，是不可配置的全局属性，
// 顶层再声明同名 const 会直接抛 SyntaxError: Identifier 'api' has already been declared
const bridge = window.api

const STATUS_TEXT = {
  pending: '待生成',
  running: '生成中',
  done: '已生成',
  error: '失败',
  renamed: '已改名'
}

const ICON = {
  image: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 4.5-4.5 3.5 3.5 3-2.5L20 18"/></svg>',
  video: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="13" height="14" rx="2"/><path d="m15.5 10 6-3.5v11l-6-3.5"/></svg>',
  doc: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  code: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 8-5 4 5 4M16 8l5 4-5 4M13.5 5l-3 14"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 7l5 5-5 5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
}

const state = {
  files: [],
  byId: new Map(),
  settings: {},
  presets: [],
  styles: [],
  languages: [],
  running: false,
  batchId: null,
  undoBatches: [],
  progress: { finished: 0, total: 0 },
  rowMap: new Map(),
  thumbCache: new Map(),
  search: '',
  ffmpegOk: false,
  modelList: [],
  activePresetId: ''
}

let saveTimer = null
let thumbObserver = null

/* ============================================================
   初始化
   ============================================================ */

async function init () {
  const boot = await bridge.bootstrap()

  state.settings = boot.settings
  state.presets = boot.presets
  state.styles = boot.styles
  state.languages = boot.languages
  state.undoBatches = boot.undoBatches || []
  state.ffmpegOk = Boolean(boot.ffmpeg && boot.ffmpeg.ok)

  $('#appVersion').textContent = `v${boot.version}`
  $('#ffmpegState').textContent = state.ffmpegOk ? '视频功能可用' : '未检测到 ffmpeg'
  $('#ffmpegState').title = boot.ffmpeg?.version || boot.ffmpeg?.message || ''

  fillPresets()
  fillStyles()
  fillLanguages()
  applySettingsToUI()
  bindEvents()
  updateUndoButton()
  updateButtons()
  refreshChip()

  // 首次使用：如果这个服务商没有 Key，给个提示
  const preset = currentPreset()
  const cfg = state.settings.perPreset?.[preset.id]
  if (!cfg || !cfg.apiKey) {
    const note = $('#presetNote')
    if (note) {
      note.innerHTML = `还没有填 API Key。${preset.keyUrl ? '点右上角「去申请」可以免费拿一个。' : ''}`
    }
  }
}

function fillPresets () {
  const sel = $('#presetSelect')
  sel.innerHTML = ''
  state.presets.forEach(p => {
    const o = document.createElement('option')
    o.value = p.id
    o.textContent = `${p.name}　·　${p.vendor}`
    sel.appendChild(o)
  })
  sel.value = state.settings.presetId || state.presets[0].id
}

function fillStyles () {
  const sel = $('#styleSelect')
  sel.innerHTML = ''
  state.styles.forEach(s => {
    const o = document.createElement('option')
    o.value = s.id
    o.textContent = s.label
    o.title = s.desc
    sel.appendChild(o)
  })
}

function fillLanguages () {
  const sel = $('#languageSelect')
  sel.innerHTML = ''
  state.languages.forEach(l => {
    const o = document.createElement('option')
    o.value = l.id
    o.textContent = l.label
    sel.appendChild(o)
  })
}

function applySettingsToUI () {
  const s = state.settings
  $('#styleSelect').value = s.style || 'zh-dash'
  $('#languageSelect').value = s.language || 'zh-CN'
  $('#maxCharsInput').value = s.maxChars ?? 40
  $('#maxWordsInput').value = s.maxWords ?? 6
  $('#customPromptInput').value = s.customPrompt || ''
  $('#framesInput').value = s.framesPerVideo ?? 3
  $('#concurrencyInput').value = s.concurrency ?? 3
  $('#recursiveCheck').checked = Boolean(s.recursive)
  $('#prefixInput').value = s.prefix || ''
  loadPresetIntoUI(s.presetId || state.presets[0].id)
  updateStyleTip()
}

/* ============================================================
   服务商 / 模型
   ============================================================ */

function currentPreset () {
  const id = $('#presetSelect').value
  return state.presets.find(p => p.id === id) || state.presets[0]
}

function presetConfig (id) {
  if (!state.settings.perPreset) state.settings.perPreset = {}
  if (!state.settings.perPreset[id]) {
    state.settings.perPreset[id] = { baseURL: '', model: '', apiKey: '' }
  }
  return state.settings.perPreset[id]
}

/**
 * 切换服务商时，把上次用过的地址/模型/Key 填回来
 */
function loadPresetIntoUI (presetId) {
  const preset = state.presets.find(p => p.id === presetId) || state.presets[0]
  const cfg = presetConfig(preset.id)

  state.activePresetId = preset.id
  $('#presetSelect').value = preset.id
  $('#baseURLInput').value = cfg.baseURL || preset.baseURL || ''
  $('#modelInput').value = cfg.model || (preset.models[0] && preset.models[0].name) || ''
  $('#apiKeyInput').value = cfg.apiKey || ''
  $('#apiKeyInput').placeholder = preset.protocol === 'ollama' ? '本地服务不需要填' : '粘贴你的 API Key'

  const keyLink = $('#keyLink')
  if (preset.keyUrl) {
    keyLink.style.display = ''
    keyLink.dataset.url = preset.keyUrl
  } else {
    keyLink.style.display = 'none'
  }

  $('#presetNote').textContent = preset.note || ''
  $('#testResult').textContent = ''
  $('#testResult').className = 'test-result'
  $('#modelState').textContent = '未连接'
  $('#modelState').className = 'panel-hint'

  state.modelList = (preset.models || []).map(m => ({
    name: m.name,
    tag: m.vision ? '看图' : '文字',
    free: /免费/.test(m.label || '')
  }))

  closeModelDropdown()
  refreshChip()
}

function refreshChip () {
  const preset = currentPreset()
  const model = $('#modelInput').value.trim()
  const chip = $('#modelChip')
  if (!model) {
    chip.textContent = '未配置模型'
    chip.className = 'model-chip warn'
    return
  }
  const hasKey = preset.protocol === 'ollama' || Boolean($('#apiKeyInput').value.trim())
  chip.textContent = `${preset.name} · ${model}`
  chip.className = `model-chip ${hasKey ? 'ok' : 'warn'}`
  chip.title = hasKey ? '当前使用的模型' : '已选模型，但还没填 API Key'
}

function openModelDropdown () {
  const dd = $('#modelDropdown')
  dd.innerHTML = ''

  const list = state.modelList.length
    ? state.modelList
    : [{ name: '(没有可选项，直接手填模型名)' }]

  list.forEach(m => {
    const item = document.createElement('div')
    item.className = 'dropdown-item'
    if (m.name === $('#modelInput').value) item.classList.add('active')

    const label = document.createElement('span')
    label.textContent = m.name
    item.appendChild(label)

    if (m.tag) {
      const tag = document.createElement('span')
      tag.className = `tag ${m.tag === '看图' ? 'vision' : ''}`
      tag.textContent = m.tag
      item.appendChild(tag)
    }
    if (m.free) {
      const tag = document.createElement('span')
      tag.className = 'tag free'
      tag.textContent = '免费'
      item.appendChild(tag)
    }

    item.addEventListener('mousedown', ev => {
      ev.preventDefault()
      if (m.name.startsWith('(')) return
      $('#modelInput').value = m.name
      closeModelDropdown()
      onModelChanged()
    })
    dd.appendChild(item)
  })

  dd.hidden = false
}

function closeModelDropdown () {
  $('#modelDropdown').hidden = true
}

function onModelChanged () {
  const preset = currentPreset()
  presetConfig(preset.id).model = $('#modelInput').value.trim()
  refreshChip()
  queueSave()
}

async function refreshModelList () {
  const preset = currentPreset()
  const btn = $('#btnRefreshModels')
  btn.textContent = '读取中…'
  btn.disabled = true

  const res = await bridge.listModels({
    protocol: preset.protocol,
    baseURL: $('#baseURLInput').value.trim(),
    apiKey: $('#apiKeyInput').value.trim()
  })

  btn.textContent = '刷新列表'
  btn.disabled = false

  if (!res.ok) {
    toast(res.message || '读取模型列表失败', 'err', 4200)
    return
  }

  if (!res.models.length) {
    toast('这个服务没有返回可用的模型', 'warn')
    return
  }

  state.modelList = res.models.map(m => ({ name: m.name, tag: '' }))
  toast(`读取到 ${res.models.length} 个模型`, 'ok')
  openModelDropdown()
}

async function testConnection () {
  const preset = currentPreset()
  const btn = $('#btnTest')
  const out = $('#testResult')
  const model = $('#modelInput').value.trim()

  if (!model) { toast('请先填写模型名称', 'warn'); return }

  btn.disabled = true
  btn.textContent = '测试中…'
  out.className = 'test-result'
  out.textContent = '正在请求模型…'

  const res = await bridge.testModel({
    protocol: preset.protocol,
    baseURL: $('#baseURLInput').value.trim(),
    apiKey: $('#apiKeyInput').value.trim(),
    model
  })

  btn.disabled = false
  btn.textContent = '测试连接'

  if (res.ok) {
    out.className = 'test-result ok'
    out.textContent = `连通正常 · ${(res.ms / 1000).toFixed(1)}s`
    $('#modelState').textContent = '已连接'
    $('#modelState').className = 'panel-hint ok'
    toast('连接成功，可以开始生成名字了', 'ok')
    refreshChip()
  } else {
    out.className = 'test-result err'
    out.textContent = res.message
    $('#modelState').textContent = '连接失败'
    $('#modelState').className = 'panel-hint err'
  }
}

/* ============================================================
   设置保存
   ============================================================ */

function collectSettings () {
  const presetId = $('#presetSelect').value
  const perPreset = { ...(state.settings.perPreset || {}) }

  // 当前服务商的输入框内容始终以界面为准，避免刚填完 Key 还没保存就点生成
  perPreset[presetId] = {
    baseURL: $('#baseURLInput').value.trim(),
    model: $('#modelInput').value.trim(),
    apiKey: $('#apiKeyInput').value.trim()
  }

  return {
    presetId,
    perPreset,
    style: $('#styleSelect').value,
    language: $('#languageSelect').value,
    maxChars: Number($('#maxCharsInput').value) || 40,
    maxWords: Number($('#maxWordsInput').value) || 6,
    customPrompt: $('#customPromptInput').value,
    framesPerVideo: Number($('#framesInput').value) || 3,
    concurrency: Number($('#concurrencyInput').value) || 3,
    recursive: $('#recursiveCheck').checked,
    prefix: $('#prefixInput').value.trim(),
    suffix: ''
  }
}

function queueSave () {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    const s = collectSettings()
    state.settings = await bridge.saveSettings(s)
    refreshChip()
  }, 420)
}

function updateStyleTip () {
  const id = $('#styleSelect').value
  const s = state.styles.find(x => x.id === id)
  $('#styleTip').textContent = s ? s.desc : ''
}

/* ============================================================
   文件列表
   ============================================================ */

function mergeFiles (incoming) {
  const existing = new Set(state.files.map(f => f.path.toLowerCase()))
  let added = 0
  for (const f of incoming) {
    if (existing.has(f.path.toLowerCase())) continue
    existing.add(f.path.toLowerCase())
    state.files.push(f)
    state.byId.set(f.id, f)
    added++
  }
  if (added) renderTable()
  return added
}

function selectedFiles () {
  return state.files.filter(f => f.selected)
}

function visibleFiles () {
  if (!state.search) return state.files
  const q = state.search.toLowerCase()
  return state.files.filter(f => f.fileName.toLowerCase().includes(q))
}

function renderTable () {
  const tbody = $('#fileTbody')
  tbody.innerHTML = ''
  state.rowMap.clear()

  if (!state.files.length) {
    $('#emptyState').hidden = false
    $('#fileTable').hidden = true
    updateProgress(0, 0)
    updateButtons()
    return
  }

  $('#emptyState').hidden = true
  $('#fileTable').hidden = false

  const frag = document.createDocumentFragment()
  for (const file of state.files) {
    const tr = createRow(file)
    state.rowMap.set(file.id, tr)
    frag.appendChild(tr)
  }
  tbody.appendChild(frag)

  applySearchFilter()
  updateSelectAll()
  updateProgress(state.progress.finished, state.progress.total)
  updateButtons()
  observeThumbs()
}

function createRow (file) {
  const tr = document.createElement('tr')
  tr.dataset.id = file.id
  tr.classList.toggle('is-selected', file.selected)

  // 勾选
  const tdCheck = document.createElement('td')
  tdCheck.className = 'col-check'
  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.checked = file.selected
  cb.addEventListener('change', () => {
    file.selected = cb.checked
    tr.classList.toggle('is-selected', file.selected)
    updateSelectAll()
    updateButtons()
  })
  tdCheck.appendChild(cb)
  tr.appendChild(tdCheck)

  // 缩略图
  const tdThumb = document.createElement('td')
  tdThumb.className = 'col-thumb'
  const thumb = document.createElement('div')
  thumb.className = 'thumb'
  thumb.dataset.path = file.path
  if (file.kind === 'image') {
    thumb.innerHTML = ICON.image
    thumb.dataset.lazy = '1'
  } else {
    thumb.innerHTML = ICON[file.kind] || ICON.doc
  }
  tdThumb.appendChild(thumb)
  tr.appendChild(tdThumb)

  // 原文件名
  const tdName = document.createElement('td')
  tdName.className = 'col-name'
  const nameCell = document.createElement('div')
  nameCell.className = 'name-cell'
  const nameMain = document.createElement('div')
  nameMain.className = 'name-main'
  nameMain.textContent = file.fileName
  nameMain.title = file.path
  const meta = document.createElement('div')
  meta.className = 'name-meta'
  const typeBadge = document.createElement('span')
  typeBadge.className = `badge-type ${file.kind}`
  typeBadge.textContent = file.kindLabel
  const sizeSpan = document.createElement('span')
  sizeSpan.textContent = file.sizeText
  meta.appendChild(typeBadge)
  meta.appendChild(sizeSpan)
  nameCell.appendChild(nameMain)
  nameCell.appendChild(meta)
  tdName.appendChild(nameCell)
  tr.appendChild(tdName)

  // 箭头
  const tdArrow = document.createElement('td')
  tdArrow.className = 'col-arrow arrow-cell'
  tdArrow.innerHTML = ICON.arrow
  tr.appendChild(tdArrow)

  // 新文件名
  const tdNew = document.createElement('td')
  tdNew.className = 'col-new'
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'new-input'
  input.value = file.newName || ''
  input.placeholder = file.status === 'error' ? file.error : '待生成'
  input.spellcheck = false
  input.addEventListener('input', () => {
    file.newName = input.value.trim()
    input.classList.toggle('filled', Boolean(file.newName))
    if (file.status !== 'renamed') {
      file.status = file.newName ? 'done' : 'pending'
      updateRowStatus(file)
    }
    updateButtons()
  })
  input.addEventListener('blur', () => { input.value = file.newName })
  tdNew.appendChild(input)
  tr.appendChild(tdNew)

  // 状态
  const tdStatus = document.createElement('td')
  tdStatus.className = 'col-status'
  tdStatus.appendChild(buildStatusEl(file))
  tr.appendChild(tdStatus)

  // 行操作
  const tdAct = document.createElement('td')
  tdAct.className = 'col-act'
  const actBtn = document.createElement('button')
  actBtn.className = 'row-act'
  actBtn.title = '在文件夹中显示'
  actBtn.innerHTML = ICON.folder
  actBtn.addEventListener('click', () => bridge.reveal(file.path))
  tdAct.appendChild(actBtn)
  tr.appendChild(tdAct)

  if (file.newName) input.classList.add('filled')
  tr.classList.toggle('is-error', file.status === 'error')
  tr.classList.toggle('is-running', file.status === 'running')

  return tr
}

function buildStatusEl (file) {
  const box = document.createElement('div')
  box.className = `status-cell status-${file.status}`
  const dot = document.createElement('span')
  dot.className = 'status-dot'
  const txt = document.createElement('span')
  txt.textContent = STATUS_TEXT[file.status] || ''
  box.appendChild(dot)
  box.appendChild(txt)
  if (file.status === 'error' && file.error) box.title = file.error
  return box
}

function updateRowStatus (file) {
  const tr = state.rowMap.get(file.id)
  if (!tr) return
  const cell = tr.querySelector('.col-status')
  cell.innerHTML = ''
  cell.appendChild(buildStatusEl(file))
  tr.classList.toggle('is-error', file.status === 'error')
  tr.classList.toggle('is-running', file.status === 'running')
}

function updateRow (file) {
  const tr = state.rowMap.get(file.id)
  if (!tr) return
  const input = tr.querySelector('.new-input')
  if (input && document.activeElement !== input) {
    input.value = file.newName || ''
    input.classList.toggle('filled', Boolean(file.newName))
  }
  if (input) {
    const ph = file.status === 'error'
      ? (file.error || '失败')
      : file.status === 'renamed' ? '已改名' : '待生成'
    input.placeholder = ph
    input.disabled = file.status === 'renamed'
  }
  const nameMain = tr.querySelector('.name-main')
  if (nameMain && nameMain.textContent !== file.fileName) {
    nameMain.textContent = file.fileName
    nameMain.title = file.path
  }
  const thumb = tr.querySelector('.thumb')
  if (thumb && thumb.dataset.path !== file.path) {
    thumb.dataset.path = file.path
    state.thumbCache.delete(file.path)
    if (file.kind === 'image') {
      thumb.innerHTML = ICON.image
      thumb.dataset.lazy = '1'
      observeThumbs()
    }
  }
  updateRowStatus(file)
}

/* ---------- 缩略图懒加载 ---------- */

function observeThumbs () {
  if (!thumbObserver) {
    thumbObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const el = entry.target
        thumbObserver.unobserve(el)
        loadThumb(el)
      }
    }, { root: $('#tableWrap'), rootMargin: '120px' })
  }
  $$('.thumb[data-lazy="1"]').forEach(el => {
    el.dataset.lazy = '0'
    thumbObserver.observe(el)
  })
}

async function loadThumb (el) {
  const p = el.dataset.path
  if (!p) return
  if (state.thumbCache.has(p)) {
    const cached = state.thumbCache.get(p)
    if (cached) el.innerHTML = `<img src="${cached}" alt="">`
    return
  }
  const dataUrl = await bridge.thumb(p)
  state.thumbCache.set(p, dataUrl)
  if (dataUrl && el.dataset.path === p) {
    el.innerHTML = `<img src="${dataUrl}" alt="">`
  }
}

/* ---------- 搜索 / 全选 ---------- */

function applySearchFilter () {
  const set = new Set(visibleFiles().map(f => f.id))
  for (const [id, tr] of state.rowMap) {
    tr.style.display = set.has(id) ? '' : 'none'
  }
}

function updateSelectAll () {
  const vis = visibleFiles()
  const checked = vis.filter(f => f.selected).length
  const box = $('#checkAll')
  box.checked = vis.length > 0 && checked === vis.length
  box.indeterminate = checked > 0 && checked < vis.length
}

/* ============================================================
   按钮状态
   ============================================================ */

function updateButtons () {
  const sel = selectedFiles()
  const pending = sel.filter(f => f.status === 'pending' || f.status === 'error')
  const ready = sel.filter(f => f.newName && f.status === 'done')

  $('#btnGenerate').disabled = state.running || pending.length === 0
  $('#btnApply').disabled = state.running || ready.length === 0
  $('#btnCancel').hidden = !state.running

  // 隐藏时把「正在停止…」的临时文案复原，否则下次运行会显示错
  if (!state.running) {
    const cancel = $('#btnCancel')
    if (cancel.textContent !== '停止') cancel.textContent = '停止'
    if (cancel.disabled) cancel.disabled = false
  }

  // 按钮上带数量，减少误操作
  $('#btnGenerate').querySelector('.btn-label').textContent = pending.length
    ? `生成新名字（${pending.length}）`
    : '生成新名字'
  $('#btnApply').querySelector('.btn-label').textContent = ready.length
    ? `执行重命名（${ready.length}）`
    : '执行重命名'
}

function updateProgress (finished, total) {
  state.progress = { finished, total }

  const fill = $('#progressFill')
  const text = $('#progressText')

  if (!state.files.length) {
    fill.style.width = '0%'
    fill.classList.remove('done')
    text.textContent = '还没有文件'
    return
  }

  if (!total) {
    const sel = selectedFiles().length
    fill.style.width = '0%'
    fill.classList.remove('done')
    text.textContent = `已添加 ${state.files.length} 个文件 · 已选 ${sel} 个`
    return
  }

  const pct = Math.min(100, Math.round((finished / total) * 100))
  fill.style.width = `${pct}%`
  fill.classList.toggle('done', finished >= total)

  const ok = state.files.filter(f => f.status === 'done').length
  const bad = state.files.filter(f => f.status === 'error').length
  text.innerHTML = `生成进度 <strong>${finished}/${total}</strong>` +
    (ok ? `　成功 ${ok}` : '') +
    (bad ? `　失败 ${bad}` : '')
}

function updateUndoButton () {
  const btn = $('#btnUndo')
  btn.disabled = !state.undoBatches.length && !state.batchId
  btn.title = state.undoBatches.length
    ? `可撤销：${state.undoBatches[0].count} 个文件（${new Date(state.undoBatches[0].time).toLocaleString('zh-CN', { hour12: false })}）`
    : '暂无可撤销的改名记录'
}

/* ============================================================
   核心动作
   ============================================================ */

async function addViaFolderDialog () {
  const folder = await bridge.pickFolder()
  if (!folder) return
  await addFolder(folder)
}

async function addFolder (folder) {
  try {
    const res = await bridge.scanFolder(folder, $('#recursiveCheck').checked)
    const added = mergeFiles(res.files)
    if (!added) {
      toast('这个文件夹里没有能处理的文件', 'warn')
      return
    }
    toast(`添加了 ${added} 个文件`, 'ok')
    if (res.skipped && res.skipped.unsupported) {
      setTimeout(() => toast(`另有 ${res.skipped.unsupported} 个文件类型不支持，已跳过`, 'warn', 3600), 400)
    }
  } catch (err) {
    toast(`读取文件夹失败：${err.message}`, 'err', 4200)
  }
}

async function addViaFileDialog () {
  const paths = await bridge.pickFiles()
  if (!paths.length) return
  await addPaths(paths)
}

async function addPaths (paths) {
  const res = await bridge.scanPaths(paths)
  const added = mergeFiles(res.files)
  if (!added) {
    toast('没有可处理的文件（支持图片、视频、PDF、Word、Excel、文本、代码）', 'warn', 4000)
    return
  }
  toast(`添加了 ${added} 个文件`, 'ok')
}

async function generate () {
  const targets = selectedFiles().filter(f => f.status === 'pending' || f.status === 'error')
  if (!targets.length) { toast('没有待生成的文件', 'warn'); return }

  const preset = currentPreset()
  const model = $('#modelInput').value.trim()
  if (!model) { toast('请先在右侧选择模型', 'warn', 3800); return }

  if (preset.protocol !== 'ollama' && !$('#apiKeyInput').value.trim()) {
    toast('还没有填 API Key', 'warn', 3800)
    return
  }

  // 没有视觉能力却要处理图片/视频，提前拦住
  const hasVisionModel = state.modelList.some(m => m.name === model && m.tag === '看图') ||
    /vl|vision|4v|multimodal|glm-4\.5v/i.test(model)
  const hasVisual = targets.some(f => f.kind === 'image' || f.kind === 'video')
  if (hasVisual && !hasVisionModel && preset.vision !== false) {
    // 只是提醒，不阻止——有的模型名看不出来但支持视觉
    console.warn('模型可能不支持看图')
  }
  if (hasVisual && preset.vision === false) {
    const go = await showModal({
      title: '当前服务商不支持看图',
      body: `「${preset.name}」没有视觉模型，无法处理 <b>${targets.filter(f => f.kind === 'image' || f.kind === 'video').length}</b> 个图片/视频文件。<br><br>这些文件会失败，只有文本类文件能正常处理。要继续吗？`,
      okText: '仍然继续'
    })
    if (!go) return
  }

  state.running = true
  state.progress = { finished: 0, total: targets.length }
  targets.forEach(f => {
    f.status = 'running'
    f.error = ''
    updateRow(f)
  })
  updateButtons()
  updateProgress(0, targets.length)

  const payload = targets.map(f => ({
    id: f.id,
    path: f.path,
    dir: f.dir,
    fileName: f.fileName,
    baseName: f.baseName,
    ext: f.ext,
    kind: f.kind
  }))

  const res = await bridge.generate({ files: payload, settings: collectSettings() })

  state.running = false

  if (!res.ok) {
    toast(res.message || '生成失败', 'err', 5000)
    targets.forEach(f => {
      if (f.status === 'running') { f.status = 'error'; f.error = res.message; updateRow(f) }
    })
    updateButtons()
    return
  }

  const done = state.files.filter(f => f.status === 'done').length
  const bad = state.files.filter(f => f.status === 'error').length

  if (res.aborted) toast('已停止', 'warn')
  else if (bad === 0) toast(`全部完成，${done} 个文件已生成新名字`, 'ok')
  else toast(`完成 ${done} 个，失败 ${bad} 个（悬停「失败」看原因）`, 'warn', 5000)

  // 能跑通就说明连接是好的，不必非得点一次「测试连接」
  if (done > 0) {
    $('#modelState').textContent = '已连接'
    $('#modelState').className = 'panel-hint ok'
    const t = $('#testResult')
    t.className = 'test-result ok'
    t.textContent = `刚成功处理 ${done} 个文件`
  }

  updateProgress(res.finished, res.total)
  updateButtons()
}

function requestCancel () {
  bridge.cancel()
  $('#btnCancel').disabled = true
  $('#btnCancel').textContent = '正在停止…'
  setTimeout(() => {
    $('#btnCancel').disabled = false
    $('#btnCancel').textContent = '停止'
  }, 1500)
}

async function applyRenames () {
  const ready = selectedFiles().filter(f => f.newName && f.status === 'done')
  if (!ready.length) { toast('没有可执行的重命名', 'warn'); return }

  const sample = ready.slice(0, 4)
  const more = ready.length - sample.length

  const html = `
    <div>即将重命名 <b>${ready.length}</b> 个文件：</div>
    <div style="margin:10px 0;padding:9px 11px;background:#f7f8fa;border-radius:6px;font-size:11.5px;line-height:1.9;max-height:150px;overflow:auto">
      ${sample.map(f => `<div>${escapeHtml(f.fileName)}　→　<b>${escapeHtml(f.newName)}</b></div>`).join('')}
      ${more > 0 ? `<div style="color:#8b93a1">…… 还有 ${more} 个</div>` : ''}
    </div>
    <div style="font-size:11.5px;color:#8b93a1">重命名后可以在左下角「撤销」还原。</div>
  `

  const go = await showModal({ title: '确认执行重命名', body: html, okText: '开始重命名' })
  if (!go) return

  const plans = ready.map(f => ({ path: f.path, newName: f.newName }))
  const res = await bridge.apply(plans)

  if (!res.success) {
    const first = res.failed && res.failed[0]
    toast(first ? `改名失败：${first.error}` : (res.message || '重命名失败'), 'err', 5200)
    return
  }

  const byFrom = new Map()
  for (const r of res.renamed || []) byFrom.set(r.from, r)

  for (const f of state.files) {
    const r = byFrom.get(f.path)
    if (!r) continue
    f.prevName = f.fileName
    f.path = r.to
    f.dir = r.to.replace(/[\\/][^\\/]+$/, '')
    f.fileName = r.newName
    f.baseName = r.newName.replace(/\.[^.]+$/, '')
    f.newName = ''
    f.status = 'renamed'
    updateRow(f)
  }

  state.batchId = res.batchId || null
  state.undoBatches = [{ id: res.batchId, time: Date.now(), count: (res.renamed || []).length }]
    .concat(state.undoBatches)
  updateUndoButton()
  updateButtons()

  if (res.failed && res.failed.length) {
    toast(`改名完成 ${(res.renamed || []).length} 个，${res.failed.length} 个失败`, 'warn', 5200)
  } else {
    toast(`已重命名 ${(res.renamed || []).length} 个文件`, 'ok')
  }
}

async function undoRename () {
  const batch = state.batchId
    ? { id: state.batchId, count: (state.undoBatches[0] && state.undoBatches[0].count) || 0 }
    : state.undoBatches[0]

  if (!batch) { toast('没有可撤销的记录', 'warn'); return }

  const go = await showModal({
    title: '撤销上一次重命名',
    body: `将把最近一次的 <b>${batch.count}</b> 个文件改回原来的名字。<br><br>如果这些文件之后被移动或删除过，对应的项目会跳过。`,
    okText: '撤销'
  })
  if (!go) return

  const res = await bridge.undo(batch.id)

  if (!res.success) {
    toast(res.message || '撤销失败', 'err', 5000)
    return
  }

  // 用返回的记录把界面上的名字改回去
  for (const r of res.restoredList || []) {
    const f = state.files.find(x => x.path === r.to)
    if (!f) continue
    f.path = r.from
    f.fileName = r.originalName
    f.baseName = r.originalName.replace(/\.[^.]+$/, '')
    f.newName = ''
    f.status = 'pending'
    updateRow(f)
  }

  state.undoBatches = state.undoBatches.filter(b => b.id !== batch.id)
  if (state.batchId === batch.id) state.batchId = null
  updateUndoButton()
  updateButtons()

  toast(`已还原 ${res.restored} 个文件`, 'ok')
}

/* ============================================================
   事件绑定
   ============================================================ */

function bindEvents () {
  $('#btnPickFiles').addEventListener('click', addViaFileDialog)
  $('#btnPickFolder').addEventListener('click', addViaFolderDialog)
  $('#btnEmptyFiles').addEventListener('click', addViaFileDialog)
  $('#btnEmptyFolder').addEventListener('click', addViaFolderDialog)

  $('#btnClear').addEventListener('click', async () => {
    if (!state.files.length) return
    const go = await showModal({
      title: '清空列表',
      body: '只清空这个列表，不会删除或改动任何文件。',
      okText: '清空'
    })
    if (!go) return
    state.files = []
    state.byId.clear()
    state.progress = { finished: 0, total: 0 }
    state.batchId = null
    renderTable()
  })

  $('#btnGenerate').addEventListener('click', generate)
  $('#btnApply').addEventListener('click', applyRenames)
  $('#btnUndo').addEventListener('click', undoRename)
  $('#btnCancel').addEventListener('click', requestCancel)

  $('#searchInput').addEventListener('input', e => {
    state.search = e.target.value.trim()
    applySearchFilter()
    updateSelectAll()
  })

  $('#checkAll').addEventListener('change', e => {
    const on = e.target.checked
    for (const f of visibleFiles()) {
      f.selected = on
      const tr = state.rowMap.get(f.id)
      const cb = tr && tr.querySelector('input[type="checkbox"]')
      if (cb) cb.checked = on
      if (tr) tr.classList.toggle('is-selected', on)
    }
    updateButtons()
  })

  // 服务商切换：先把当前输入存回原服务商，再载入新的
  $('#presetSelect').addEventListener('change', e => {
    const prevId = state.activePresetId
    if (prevId && prevId !== e.target.value) {
      if (!state.settings.perPreset) state.settings.perPreset = {}
      state.settings.perPreset[prevId] = {
        baseURL: $('#baseURLInput').value.trim(),
        model: $('#modelInput').value.trim(),
        apiKey: $('#apiKeyInput').value.trim()
      }
    }
    state.activePresetId = e.target.value
    loadPresetIntoUI(e.target.value)
    queueSave()
  })

  // 模型与地址
  $('#modelInput').addEventListener('input', () => refreshChip())
  $('#modelInput').addEventListener('change', onModelChanged)
  $('#modelInput').addEventListener('focus', () => {
    if (state.modelList.length) openModelDropdown()
  })
  $('#btnModelList').addEventListener('click', e => {
    e.stopPropagation()
    if ($('#modelDropdown').hidden) openModelDropdown()
    else closeModelDropdown()
  })
  document.addEventListener('click', e => {
    if (!e.target.closest('#modelGroup')) closeModelDropdown()
  })

  $('#baseURLInput').addEventListener('change', queueSave)
  $('#apiKeyInput').addEventListener('change', () => { queueSave(); refreshChip() })
  $('#apiKeyInput').addEventListener('blur', queueSave)

  $('#btnToggleKey').addEventListener('click', () => {
    const input = $('#apiKeyInput')
    input.type = input.type === 'password' ? 'text' : 'password'
  })

  $('#keyLink').addEventListener('click', e => {
    e.preventDefault()
    const url = e.currentTarget.dataset.url
    if (url) bridge.openExternal(url)
  })

  $('#btnRefreshModels').addEventListener('click', refreshModelList)
  $('#btnTest').addEventListener('click', testConnection)

  // 规则
  $('#styleSelect').addEventListener('change', () => { updateStyleTip(); queueSave() })
  $('#languageSelect').addEventListener('change', queueSave)
  $('#maxCharsInput').addEventListener('change', queueSave)
  $('#maxWordsInput').addEventListener('change', queueSave)
  $('#customPromptInput').addEventListener('input', queueSave)
  $('#framesInput').addEventListener('change', queueSave)
  $('#concurrencyInput').addEventListener('change', queueSave)
  $('#recursiveCheck').addEventListener('change', queueSave)
  $('#prefixInput').addEventListener('input', queueSave)

  // 高级面板折叠
  $('#advToggle').addEventListener('click', () => {
    $('#advToggle').closest('.panel').classList.toggle('collapsed')
  })

  // 拖拽
  let dragDepth = 0
  const overlay = $('#dropOverlay')

  window.addEventListener('dragenter', e => {
    e.preventDefault()
    dragDepth++
    overlay.classList.add('active')
  })
  window.addEventListener('dragover', e => { e.preventDefault() })
  window.addEventListener('dragleave', e => {
    e.preventDefault()
    dragDepth--
    if (dragDepth <= 0) { dragDepth = 0; overlay.classList.remove('active') }
  })
  window.addEventListener('drop', async e => {
    e.preventDefault()
    dragDepth = 0
    overlay.classList.remove('active')

    const paths = []
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      for (const f of Array.from(e.dataTransfer.files)) {
        const p = bridge.pathForFile(f)
        if (p) paths.push(p)
      }
    }
    if (paths.length) await addPaths(paths)
  })

  // 快捷键
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModelDropdown()
      if (!$('#modalMask').hidden) $('#modalCancel').click()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      if (!$('#btnGenerate').disabled) generate()
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      addViaFileDialog()
    }
  })

  // 主进程进度
  bridge.onProgress(e => {
    const file = state.byId.get(e.id)
    if (!file) return

    if (e.type === 'file-start') {
      file.status = 'running'
      updateRow(file)
    } else if (e.type === 'file-done') {
      file.status = 'done'
      file.newName = e.newName
      file.raw = e.raw
      updateRow(file)
    } else if (e.type === 'file-error') {
      file.status = 'error'
      file.error = e.error
      updateRow(file)
    }
    updateProgress(e.finished, e.total)
    updateButtons()
  })

  bridge.onScanProgress(({ count }) => {
    $('#progressText').textContent = `正在读取文件… 已找到 ${count} 个`
  })

  // 拖到程序图标上启动时，自动载入那个文件夹
  bridge.onOpenPaths(paths => {
    if (Array.isArray(paths) && paths.length) addPaths(paths)
  })
}

/* ============================================================
   弹窗与提示
   ============================================================ */

let modalResolve = null

function showModal ({ title, body, okText = '确定' }) {
  return new Promise(resolve => {
    modalResolve = resolve
    $('#modalTitle').textContent = title
    $('#modalBody').innerHTML = body
    $('#modalOk').textContent = okText
    $('#modalMask').hidden = false
  })
}

function closeModal (result) {
  $('#modalMask').hidden = true
  if (modalResolve) { modalResolve(result); modalResolve = null }
}

$('#modalOk').addEventListener('click', () => closeModal(true))
$('#modalCancel').addEventListener('click', () => closeModal(false))
$('#modalMask').addEventListener('mousedown', e => {
  if (e.target === $('#modalMask')) closeModal(false)
})

function toast (msg, kind = '', duration = 2800) {
  const stack = $('#toastStack')
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.textContent = msg
  stack.appendChild(el)
  setTimeout(() => {
    el.style.transition = 'opacity .2s, transform .2s'
    el.style.opacity = '0'
    el.style.transform = 'translateY(6px)'
    setTimeout(() => el.remove(), 220)
  }, duration)
}

function escapeHtml (s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* ============================================================
   启动
   ============================================================ */

init().catch(err => {
  document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif">
    <h2>启动失败</h2><pre style="color:#b3261e;white-space:pre-wrap">${escapeHtml(err.stack || err.message)}</pre>
  </div>`
})
