/* 完整执行：生成 → 确认改名 → 报告界面状态 */
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))

  for (let i = 0; i < 80; i++) {
    if (document.querySelectorAll('#fileTbody tr').length > 0) break
    await wait(100)
  }
  document.querySelector('#btnGenerate').click()
  for (let i = 0; i < 220; i++) {
    await wait(120)
    if (!document.querySelector('#btnApply').disabled) break
  }

  document.querySelector('#btnApply').click()
  await wait(300)
  document.querySelector('#modalOk').click()

  for (let i = 0; i < 120; i++) {
    await wait(120)
    if (document.querySelectorAll('#fileTbody .status-renamed').length > 0) break
  }

  return {
    renamed: document.querySelectorAll('#fileTbody .status-renamed').length,
    currentNames: Array.from(document.querySelectorAll('.name-main')).map(e => e.textContent),
    undoDisabled: document.querySelector('#btnUndo').disabled,
    toasts: Array.from(document.querySelectorAll('.toast')).map(e => e.textContent)
  }
})()
