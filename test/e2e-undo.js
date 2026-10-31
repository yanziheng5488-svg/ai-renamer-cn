/* 撤销上一次改名 */
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))

  for (let i = 0; i < 80; i++) {
    if (document.querySelectorAll('#fileTbody tr').length > 0) break
    await wait(100)
  }

  const undoBtn = document.querySelector('#btnUndo')
  if (undoBtn.disabled) return { ok: false, reason: '撤销按钮不可用' }

  const before = Array.from(document.querySelectorAll('.name-main')).map(e => e.textContent)
  undoBtn.click()
  await wait(300)

  const modalTitle = document.querySelector('#modalTitle').textContent
  const modalBody = document.querySelector('#modalBody').textContent.replace(/\s+/g, ' ').trim()

  document.querySelector('#modalOk').click()

  for (let i = 0; i < 120; i++) {
    await wait(120)
    if (document.querySelectorAll('#fileTbody .status-pending').length > 0) break
  }

  return {
    ok: true,
    modalTitle,
    modalBody,
    before,
    after: Array.from(document.querySelectorAll('.name-main')).map(e => e.textContent),
    pending: document.querySelectorAll('#fileTbody .status-pending').length,
    toasts: Array.from(document.querySelectorAll('.toast')).map(e => e.textContent)
  }
})()
