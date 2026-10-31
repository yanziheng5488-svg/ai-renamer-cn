/* 端到端驱动脚本：在渲染进程里执行，点「生成新名字」并等待完成 */
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const log = []

  for (let i = 0; i < 80; i++) {
    if (document.querySelectorAll('#fileTbody tr').length > 0) break
    await wait(100)
  }

  const rows = document.querySelectorAll('#fileTbody tr').length
  log.push(`文件数=${rows}`)
  if (!rows) return { ok: false, log: log.concat('没有载入文件') }

  log.push(`服务商=${document.querySelector('#presetSelect').value}`)
  log.push(`模型=${document.querySelector('#modelInput').value}`)
  log.push(`Key长度=${document.querySelector('#apiKeyInput').value.length}`)

  const btn = document.querySelector('#btnGenerate')
  if (btn.disabled) {
    log.push('生成按钮不可用')
    return { ok: false, log }
  }

  btn.click()
  log.push('已点击生成')

  let broke = '超时'
  for (let i = 0; i < 220; i++) {
    await wait(120)
    const applyBtn = document.querySelector('#btnApply')
    const failed = document.querySelectorAll('.status-error').length
    if (!applyBtn.disabled) { broke = '有可执行项'; break }
    if (failed > 0) { broke = '出现失败'; break }
  }
  log.push(`结束原因=${broke}`)

  const bodyStatuses = Array.from(document.querySelectorAll('#fileTbody .col-status'))
    .map(e => e.textContent.trim())
  const names = Array.from(document.querySelectorAll('.new-input')).map(e => e.value)

  return {
    ok: true,
    log,
    toasts: Array.from(document.querySelectorAll('.toast')).map(e => e.textContent),
    counts: bodyStatuses.reduce((a, s) => { a[s] = (a[s] || 0) + 1; return a }, {}),
    names,
    applyLabel: document.querySelector('#btnApply .btn-label').textContent,
    progress: document.querySelector('#progressText').textContent
  }
})()
