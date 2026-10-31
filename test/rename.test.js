'use strict'

/**
 * 改名引擎集成测试（真建文件、真改名）
 * node test/rename.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const { applyRenames, undoRenames } = require('../lib/renamer')

let pass = 0
let fail = 0

function ok (cond, label, extra = '') {
  if (cond) { pass++ } else { fail++; console.log(`  ✗ ${label} ${extra}`) }
}

let dir

function setup (files) {
  dir = path.join(os.tmpdir(), `rn-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  fs.mkdirSync(dir, { recursive: true })
  for (const f of files) fs.writeFileSync(path.join(dir, f), `content of ${f}`)
  return dir
}

function p (name) { return path.join(dir, name) }
function exists (name) { return fs.existsSync(p(name)) }
function list () { return fs.readdirSync(dir).sort() }

function teardown () {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) {}
}

async function main () {
  console.log('\n=== 一、普通改名 ===')
  setup(['a.txt', 'b.txt'])
  let r = await applyRenames([
    { path: p('a.txt'), newName: '夏天-海边.txt' },
    { path: p('b.txt'), newName: '冬天-雪山.txt' }
  ])
  ok(r.ok.length === 2, '两个文件都改名成功', JSON.stringify(r.failed))
  ok(exists('夏天-海边.txt'), '新文件名正确')
  ok(!exists('a.txt'), '旧文件名已不存在')
  ok(fs.readFileSync(p('夏天-海边.txt'), 'utf8') === 'content of a.txt', '文件内容没丢')
  teardown()

  console.log('\n=== 二、互换名字（最容易丢文件的情况） ===')
  setup(['one.txt', 'two.txt'])
  r = await applyRenames([
    { path: p('one.txt'), newName: 'two.txt' },
    { path: p('two.txt'), newName: 'one.txt' }
  ])
  ok(r.ok.length === 2, '互换成功', JSON.stringify(r.failed))
  ok(fs.readFileSync(p('one.txt'), 'utf8') === 'content of two.txt', 'one.txt 拿到的是 two 的内容')
  ok(fs.readFileSync(p('two.txt'), 'utf8') === 'content of one.txt', 'two.txt 拿到的是 one 的内容')
  ok(list().length === 2, '文件数量没有增减')
  teardown()

  console.log('\n=== 三、目标名已被占用 ===')
  setup(['src.txt', '张伟.txt'])
  r = await applyRenames([
    { path: p('src.txt'), newName: '张伟.txt' }
  ])
  ok(r.ok.length === 1, '改名成功')
  ok(exists('张伟(2).txt'), '自动加了序号，没覆盖原文件')
  ok(fs.readFileSync(p('张伟.txt'), 'utf8') === 'content of 张伟.txt', '原文件内容未被覆盖')
  ok(fs.readFileSync(p('张伟(2).txt'), 'utf8') === 'content of src.txt', '新文件内容正确')
  teardown()

  console.log('\n=== 四、源文件不存在 ===')
  setup(['only.txt'])
  r = await applyRenames([
    { path: path.join(dir, '不存在.txt'), newName: 'x.txt' }
  ])
  ok(r.ok.length === 0, '失败被记录')
  ok(r.failed.length === 1, '有失败条目')
  ok(list().length === 1, '目录状态未被破坏')
  teardown()

  console.log('\n=== 五、撤销 ===')
  setup(['甲方合同.pdf', '乙方合同.pdf'])
  const originNames = list()
  r = await applyRenames([
    { path: p('甲方合同.pdf'), newName: '2026-采购合同-甲方.pdf' },
    { path: p('乙方合同.pdf'), newName: '2026-采购合同-乙方.pdf' }
  ])
  const records = r.ok.map(x => ({ from: x.from, to: x.to }))
  ok(list().length === 2, '改名后仍是 2 个文件')

  const u = await undoRenames(records)
  ok(u.ok.length === 2, '两个都还原成功', JSON.stringify(u.failed))
  ok(fs.readFileSync(p('甲方合同.pdf'), 'utf8') === 'content of 甲方合同.pdf', '内容对应正确')
  ok(JSON.stringify(list()) === JSON.stringify(originNames), '目录恢复到初始状态', JSON.stringify(list()))
  teardown()

  console.log('\n=== 六、撤销时原文件名被占用 ===')
  setup(['orig.txt'])
  r = await applyRenames([{ path: p('orig.txt'), newName: 'renamed.txt' }])
  // 人为制造冲突
  fs.writeFileSync(p('orig.txt'), 'someone else')
  const u2 = await undoRenames(r.ok.map(x => ({ from: x.from, to: x.to })))
  ok(u2.failed.length === 1, '冲突被识别，不会覆盖')
  ok(fs.readFileSync(p('orig.txt'), 'utf8') === 'someone else', '占用者内容未被动过')
  ok(exists('renamed.txt'), '待还原文件被安全放回原名位置')
  teardown()

  console.log('\n=== 七、中文与特殊字符 ===')
  setup(['d.jpg'])
  r = await applyRenames([
    { path: p('d.jpg'), newName: '海边日落(2).jpg' }
  ])
  ok(r.ok.length === 1, '带括号的文件名可以创建')
  ok(exists('海边日落(2).jpg'), '文件名正确')
  teardown()

  console.log(`\n${'='.repeat(50)}`)
  console.log(`通过 ${pass} 项，失败 ${fail} 项`)
  console.log('='.repeat(50) + '\n')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  teardown()
  process.exit(1)
})
