'use strict'

/**
 * 命名引擎自测
 * 直接跑：node test/namer.test.js
 */

const {
  buildName,
  cleanModelOutput,
  makeUniqueName,
  charLen
} = require('../lib/namer')

let pass = 0
let fail = 0

function eq (actual, expected, label) {
  const ok = actual === expected
  if (ok) {
    pass++
  } else {
    fail++
    console.log(`  ✗ ${label}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`)
  }
}

function ok (cond, label, extra = '') {
  if (cond) { pass++ } else { fail++; console.log(`  ✗ ${label} ${extra}`) }
}

console.log('\n=== 一、清洗模型输出 ===')

eq(cleanModelOutput('夏天海边日落'), '夏天海边日落', '原样中文')
eq(cleanModelOutput('文件名：夏天海边日落'), '夏天海边日落', '中文前缀「文件名：」')
eq(cleanModelOutput('文件名:夏天海边日落'), '夏天海边日落', '半角冒号前缀')
eq(cleanModelOutput('"夏天海边日落"'), '夏天海边日落', '双引号包裹')
eq(cleanModelOutput('“夏天海边日落”'), '夏天海边日落', '中文引号包裹')
eq(cleanModelOutput('「夏天海边日落」'), '夏天海边日落', '直角引号包裹')
eq(cleanModelOutput('夏天海边日落.jpg'), '夏天海边日落', '误带扩展名')
eq(cleanModelOutput('夏天海边日落.JPG'), '夏天海边日落', '大写扩展名')
eq(cleanModelOutput('**夏天海边日落**'), '夏天海边日落', 'markdown 加粗')
eq(cleanModelOutput('```\n夏天海边日落\n```'), '夏天海边日落', '代码块包裹')
eq(cleanModelOutput('1. 夏天海边日落'), '夏天海边日落', '行首编号')
eq(cleanModelOutput('夏天海边日落。'), '夏天海边日落', '句末句号')
eq(
  cleanModelOutput('Here is the filename:\n夏天海边日落'),
  '夏天海边日落',
  '英文开场白多行'
)
eq(
  cleanModelOutput('这张图片显示的是夏天海边日落的美景。'),
  '这张图片显示的是夏天海边日落的美景',
  '整句描述保留（后面靠截断和词数控制）'
)

console.log('\n=== 二、中文命名风格 ===')

const base = '夏天 海边 日落'

eq(buildName(base, { style: 'zh-dash' }).name, '夏天-海边-日落', '短横连接')
eq(buildName(base, { style: 'zh-underscore' }).name, '夏天_海边_日落', '下划线连接')
eq(buildName(base, { style: 'zh-space' }).name, '夏天 海边 日落', '空格连接')
eq(buildName(base, { style: 'zh-plain' }).name, '夏天海边日落', '连写')

console.log('\n=== 三、非法字符与标点 ===')

eq(
  buildName('夏天/海边:日落*2024?', { style: 'zh-dash' }).name,
  '夏天-海边-日落-2024',
  'Windows 非法字符被当分隔符'
)
eq(
  buildName('合同（第三版）— 终稿', { style: 'zh-dash' }).name,
  '合同-第三版-终稿',
  '中文全角标点'
)
eq(
  buildName('  夏天   海边  ', { style: 'zh-dash' }).name,
  '夏天-海边',
  '多余空白与首尾分隔符'
)
ok(
  !/[<>:"/\\|?*]/.test(buildName('a<b>c:d"e/f\\g|h?i*j', { style: 'zh-dash' }).name),
  '最终结果不含 Windows 非法字符'
)

console.log('\n=== 四、长度与词数 ===')

const longRes = buildName('这是一个非常长的关于夏天海边日落的风景照片', {
  style: 'zh-dash',
  maxChars: 8
})
ok(charLen(longRes.name) <= 8, '字数被截断到 8 以内', `实际: ${longRes.name} (${charLen(longRes.name)})`)

const wordRes = buildName('夏天 海边 日落 沙滩 椰树 海浪 天空', {
  style: 'zh-dash',
  maxWords: 3
})
eq(wordRes.name, '夏天-海边-日落', '词数限制到 3')

const truncNonEmpty = buildName('夏天海边日落风景如画', { style: 'zh-dash', maxChars: 4 })
eq(truncNonEmpty.name, '夏天海边', '中文按字截断')

console.log('\n=== 五、英文与驼峰 ===')

eq(
  buildName('sunset beach at summer', { style: 'kebab-case' }).name,
  'sunset-beach-at-summer',
  '英文 kebab-case'
)
eq(
  buildName('sunset beach', { style: 'snake_case' }).name,
  'sunset_beach',
  '英文 snake_case'
)
eq(
  buildName('sunset beach', { style: 'camelCase' }).name,
  'sunsetBeach',
  '英文 camelCase'
)
eq(
  buildName('sunset beach', { style: 'PascalCase' }).name,
  'SunsetBeach',
  '英文 PascalCase'
)
eq(
  buildName('Summer Beach', { style: 'kebab-case' }).name,
  'summer-beach',
  '英文自动转小写'
)

console.log('\n=== 六、边界情况 ===')

ok(!buildName('', { style: 'zh-dash' }).ok, '空输出应判为失败')
ok(!buildName('   ', { style: 'zh-dash' }).ok, '纯空白应判为失败')
ok(!buildName('！！！？？？', { style: 'zh-dash' }).ok, '纯标点应判为失败')
ok(buildName('图片', { style: 'zh-dash' }).ok, '无信息量词仍给出结果（不崩）')

eq(buildName('CON', { style: 'zh-dash' }).name, 'CON_1', 'Windows 保留字规避')
eq(buildName('nul', { style: 'zh-dash' }).name, 'nul_1', '小写保留字也规避')

eq(
  buildName('夏天海边日落', { style: 'zh-dash', prefix: '2026-10' }).name,
  '2026-10-夏天海边日落',
  '前缀拼接'
)

console.log('\n=== 七、重名规避 ===')

const used = new Set()
eq(makeUniqueName('照片', '.jpg', used), '照片.jpg', '首次不冲突')
eq(makeUniqueName('照片', '.jpg', used), '照片(2).jpg', '第二次加序号')
eq(makeUniqueName('照片', '.jpg', used), '照片(3).jpg', '第三次递增')
eq(makeUniqueName('照片', '.png', used), '照片.png', '不同扩展名互不影响')

console.log('\n=== 八、真实模型输出模拟 ===')

// 说明：中文没有词间空格。模型若输出连写的一整串，本地不做分词（需要词典，成本过高），
// 会原样保留。这也是为什么提示词里要明确要求模型按指定分隔符断词。
const realCases = [
  ['好的，根据图片内容，我建议的文件名是：\n夏天海边日落', '夏天海边日落', '多行带开场白'],
  ['夏天海边日落的海滩风景照片', '夏天海边日落的海滩风景照片', '连写中文原样保留'],
  ['夏天-海边-日落', '夏天-海边-日落', '模型已按短横断词'],
  ['夏天_海边_日落', '夏天-海边-日落', '下划线被统一成短横'],
  ['夏天 海边 日落', '夏天-海边-日落', '空格被统一成短横'],
  ['Filename: summer_beach_sunset', 'summer-beach-sunset', '英文下划线归一'],
  ['「2024年度财务报表」', '2024年度财务报表', '书名号包裹 + 数字开头']
]

for (const [input, expected, label] of realCases) {
  const r = buildName(input, { style: 'zh-dash', maxWords: 6 })
  eq(r.name, expected, `模拟：${label}`)
}

console.log(`\n${'='.repeat(50)}`)
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
console.log('='.repeat(50) + '\n')

process.exit(fail === 0 ? 0 : 1)
