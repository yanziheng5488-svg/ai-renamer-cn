'use strict'

/**
 * 文档读取测试
 * 重点验证两件国内常见的事：GBK 编码的 txt、Office 文档的正文提取
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const JSZip = require('jszip')

const { readFileContent, decodeBuffer } = require('../lib/readers')

let pass = 0
let fail = 0

function ok (cond, label, extra = '') {
  if (cond) { pass++ } else { fail++; console.log(`  ✗ ${label} ${extra}`) }
}

function contains (text, sub, label) {
  ok(String(text).includes(sub), label, `实际内容: ${JSON.stringify(String(text).slice(0, 80))}`)
}

/** 生成一个结构完整的最小 PDF（pdf.js 对 xref 要求严格，这里仅作参考保留） */
async function buildDOCX (paragraphs) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const body = paragraphs.map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function buildXLSX (sheetName, cells) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/></Types>')
  zip.file('xl/workbook.xml',
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`)
  zip.file('xl/sharedStrings.xml',
    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    cells.map(c => `<si><t>${c}</t></si>`).join('') + '</sst>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function main () {
  const dir = path.join(os.tmpdir(), `rd-test-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })

  console.log('\n=== 一、编码识别 ===')

  fs.writeFileSync(path.join(dir, 'utf8.txt'), '中文测试，UTF-8 编码', 'utf8')
  const utf8Res = await readFileContent(path.join(dir, 'utf8.txt'))
  contains(utf8Res.text, '中文测试', 'UTF-8 正常读取')
  ok(utf8Res.encoding === 'UTF-8', '编码识别为 UTF-8', utf8Res.encoding)

  // GBK：「中文测试」= D6D0 CEC4 B2E2 CAD4
  const gbkBytes = Buffer.from([0xD6, 0xD0, 0xCE, 0xC4, 0xB2, 0xE2, 0xCA, 0xD4])
  fs.writeFileSync(path.join(dir, 'gbk.txt'), gbkBytes)
  const gbkRes = await readFileContent(path.join(dir, 'gbk.txt'))
  ok(gbkRes.text === '中文测试', 'GBK 中文正确还原（不乱码）', JSON.stringify(gbkRes.text))
  ok(/GB/i.test(gbkRes.encoding), '识别为 GB 系列编码', gbkRes.encoding)

  // 带 BOM 的 UTF-8
  fs.writeFileSync(path.join(dir, 'bom.txt'), Buffer.concat([
    Buffer.from([0xEF, 0xBB, 0xBF]),
    Buffer.from('带 BOM 的文本', 'utf8')
  ]))
  const bomRes = await readFileContent(path.join(dir, 'bom.txt'))
  ok(bomRes.text === '带 BOM 的文本', 'UTF-8 BOM 被正确剥离', JSON.stringify(bomRes.text))

  // UTF-16LE
  const u16 = Buffer.from('\uFEFF' + '十六位编码文本', 'utf16le')
  fs.writeFileSync(path.join(dir, 'u16.txt'), u16)
  const u16Res = await readFileContent(path.join(dir, 'u16.txt'))
  contains(u16Res.text, '十六位编码文本', 'UTF-16LE 正确读取')

  console.log('\n=== 二、PDF ===')

  // 用 Chromium 打印出来的真实 PDF 作样本（见 test/make-fixture.js）
  const fixturePDF = path.join(__dirname, 'fixtures', 'sample.pdf')
  if (!fs.existsSync(fixturePDF)) {
    console.log('  ! 缺少 test/fixtures/sample.pdf，先运行 npm run fixture')
  } else {
    const pdfRes = await readFileContent(fixturePDF)
    contains(pdfRes.text, '第三季度工作总结', 'PDF 中文标题被正确提取')
    contains(pdfRes.text, '营收同比增长', 'PDF 正文被正确提取')
    ok(pdfRes.encoding === 'PDF', '标记为 PDF 来源')
    ok(/页/.test(pdfRes.note || ''), '带上了页数信息', pdfRes.note)
  }

  // 损坏的 PDF 要给出可读错误，而不是崩溃
  const brokenPath = path.join(dir, 'broken.pdf')
  fs.writeFileSync(brokenPath, Buffer.from('%PDF-1.4\nthis is not really a pdf at all'))
  let pdfErr = null
  try {
    await readFileContent(brokenPath)
  } catch (err) {
    pdfErr = err
  }
  ok(pdfErr !== null, '损坏 PDF 抛出异常而不是静默返回')

  console.log('\n=== 三、Word ===')

  fs.writeFileSync(path.join(dir, 'plan.docx'), await buildDOCX([
    '项目启动会纪要',
    '本次会议确定了三个阶段的时间安排。'
  ]))
  const docxRes = await readFileContent(path.join(dir, 'plan.docx'))
  contains(docxRes.text, '项目启动会纪要', 'DOCX 段落被提取')
  contains(docxRes.text, '三个阶段', 'DOCX 第二段也在')
  ok(!docxRes.text.includes('<w:'), 'XML 标签已剥离')

  console.log('\n=== 四、Excel ===')

  fs.writeFileSync(path.join(dir, 'sales.xlsx'), await buildXLSX('2026年3月销售明细', [
    '产品名称', '销售额', '环比增长'
  ]))
  const xlsxRes = await readFileContent(path.join(dir, 'sales.xlsx'))
  contains(xlsxRes.text, '2026年3月销售明细', '工作表名被提取')
  contains(xlsxRes.text, '销售额', '单元格文字被提取')

  console.log('\n=== 五、异常与边界 ===')

  fs.writeFileSync(path.join(dir, 'old.doc'), 'fake binary doc')
  let docErr = null
  try {
    await readFileContent(path.join(dir, 'old.doc'))
  } catch (err) {
    docErr = err
  }
  ok(docErr && /doc/.test(docErr.message), '旧版 .doc 给出明确提示', docErr && docErr.message)

  // 超长文本应被截断
  fs.writeFileSync(path.join(dir, 'long.txt'), '甲'.repeat(20000), 'utf8')
  const longRes = await readFileContent(path.join(dir, 'long.txt'))
  ok(longRes.text.length < 13000, '超长正文被截断', `长度 ${longRes.text.length}`)
  ok(longRes.text.includes('中间省略'), '截断处有省略标记')

  console.log('\n=== 六、解码函数单独验证 ===')

  const r1 = decodeBuffer(Buffer.from('普通文本', 'utf8'))
  ok(r1.text === '普通文本', 'decodeBuffer UTF-8')
  const r2 = decodeBuffer(gbkBytes)
  ok(r2.text === '中文测试', 'decodeBuffer GBK')

  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) {}

  console.log(`\n${'='.repeat(50)}`)
  console.log(`通过 ${pass} 项，失败 ${fail} 项`)
  console.log('='.repeat(50) + '\n')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
