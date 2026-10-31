/* 生成后打开「确认执行重命名」弹窗，用于检查弹窗样式 */
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
  await wait(400)

  const mask = document.querySelector('#modalMask')
  return {
    ok: !mask.hidden,
    title: document.querySelector('#modalTitle').textContent,
    body: document.querySelector('#modalBody').textContent.replace(/\s+/g, ' ').trim().slice(0, 200)
  }
})()
