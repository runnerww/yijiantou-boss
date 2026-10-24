/*
 * 薪资解析回归测试
 * 直接从 content/app.js 里抽取「薪资解析」代码块执行,测的是真实代码,不是副本。
 *
 * 运行:
 *   node tools/test-salary-parse.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'boss-haitu-free', 'content', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

const START = '/* ---------- 薪资解析 ----------';
const END = 'function parseCompanySize(';
const i = src.indexOf(START);
const j = src.indexOf(END);
if (i < 0 || j < 0 || j <= i) {
  console.error('✗ 未能定位薪资解析代码块,请检查 app.js 里的标记注释是否还在');
  process.exit(1);
}
const block = src.slice(i, j);

const factory = new Function(`
  const q = (s, root) => root.querySelector(s);
  const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const SEL = { CARD_TITLE: '.job-name' };
  const document = { body: null, documentElement: null };
  ${block}
  return { parseSalary, salaryRawText, findSalaryIn, widenCard, codePoints, salarySkeletonNodes, salaryFromAttrs,
           PUA, puaDecode, puaDecodeWith, puaCalibrate, puaScore, hasLeadingZero };
`);
const { parseSalary, salaryRawText, findSalaryIn, widenCard, codePoints, salarySkeletonNodes, salaryFromAttrs,
        PUA, puaDecode, puaCalibrate, hasLeadingZero } = factory();

// ---- 造一张假卡片 ----
// els: { '.salary': '15-25K' } —— 模拟卡片里的元素
// text: 卡片纯文本 —— 模拟整卡兜底
function card(els, text) {
  return {
    textContent: text || '',
    querySelector(sel) {
      return Object.prototype.hasOwnProperty.call(els || {}, sel)
        ? { textContent: els[sel] }
        : null;
    }
  };
}

// ---- 极简 DOM mock:只实现 findSalaryIn / widenCard 用到的接口 ----
function node(cls, text, children, attrs) {
  const el = {
    tagName: 'DIV',
    _cls: cls || '',
    _text: text || '',
    _attrs: attrs || {},
    children: children || [],
    childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
    parentElement: null,
    getAttribute: (n) => (n === 'class' ? el._cls
      : (Object.prototype.hasOwnProperty.call(el._attrs, n) ? el._attrs[n] : null)),
    get attributes() {
      return Object.keys(el._attrs).map((k) => ({ name: k, value: el._attrs[k] }));
    },
    get textContent() {
      return [el._text].concat(el.children.map((c) => c.textContent)).filter(Boolean).join(' ');
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const want = sel === '*' ? '' : sel.replace(/^\./, '');
      const out = [];
      (function walk(n) {
        n.children.forEach((c) => {
          if (!want || c._cls.split(/\s+/).includes(want)) out.push(c);
          walk(c);
        });
      })(el);
      return out;
    }
  };
  el.children.forEach((c) => { c.parentElement = el; });
  return el;
}

const widenChecks = [];
const cases = [
  // [说明, 卡片, 期望 {min,max} 或 null]

  // —— 主流程:搜索页 / 推荐页常见格式 ——
  ['标准区间', card({ '.salary': '15-25K' }), { min: 15, max: 25 }],
  ['区间带 K 在前', card({ '.salary': '15K-25K' }), { min: 15, max: 25 }],
  ['区间用千', card({ '.salary': '15-25千' }), { min: 15, max: 25 }],
  ['带薪数后缀', card({ '.salary': '15-25K·13薪' }), { min: 15, max: 25 }],
  ['星号薪数', card({ '.salary': '15-25K*14薪' }), { min: 15, max: 25 }],
  ['波浪号区间', card({ '.salary': '15～25K' }), { min: 15, max: 25 }],
  ['全角波浪号', card({ '.salary': '15~25K' }), { min: 15, max: 25 }],
  ['上限定薪', card({ '.salary': '8-12K·14薪' }), { min: 8, max: 12 }],
  ['小数', card({ '.salary': '12.5-20K' }), { min: 12.5, max: 20 }],

  // —— 其他单位 ——
  ['万/月', card({ '.salary': '1.5-2.5万' }), { min: 15, max: 25 }],
  ['万年薪', card({ '.salary': '20万-40万/年' }), { min: 16.7, max: 33.3 }],
  ['元月薪', card({ '.salary': '8000-12000元/月' }), { min: 8, max: 12 }],
  ['元日薪', card({ '.salary': '150-200元/天' }), { min: 3.3, max: 4.4 }],
  ['元时薪', card({ '.salary': '30元/时' }), { min: 5.2, max: 5.2 }],

  // —— 单值 / 开放上限 ——
  ['以上', card({ '.salary': '15K以上' }), { min: 15, max: 9999 }],
  ['加号', card({ '.salary': '15K+' }), { min: 15, max: 9999 }],
  ['起', card({ '.salary': '1.5万起' }), { min: 15, max: 9999 }],
  ['单值', card({ '.salary': '15K' }), { min: 15, max: 15 }],
  ['单值千', card({ '.salary': '8千' }), { min: 8, max: 8 }],

  // —— 不该被误判的东西 ——
  ['经验年限不是薪资', card({ '.salary': '3-5年' }), null],
  ['公司规模不是薪资', card({ '.salary': '1000-9999人' }), null],
  ['面议', card({ '.salary': '面议' }), null],
  ['空元素', card({ '.salary': '' }), null],
  ['没有薪资元素也没有文本', card({}), null],

  // —— 选择器失效 + 整卡兜底 ——
  ['元素缺失,整卡兜底', card({}, 'AI应用开发工程师 深圳·南山区 3-5年 本科 某某科技 15-25K 王女士·HR'), { min: 15, max: 25 }],
  ['薪资排在卡片很靠后(旧版截 120 字会漏)', card({},
    '资深算法工程师 深圳·南山区 5-10年 硕士 某某科技有限公司 已上市 1000-9999人 五险一金 年终奖 股票期权 带薪年假 弹性工作 免费班车 定期体检 节日福利 零食下午茶 20-40K·15薪'), { min: 20, max: 40 }],
  ['通用 .red 被无关文本占用时,不该被它带偏', card({ '.red': '急聘', '.salary': '15-25K' }), { min: 15, max: 25 }],
  ['只有 .red 而且是薪资(老版页面)', card({ '.red': '12-18K' }), { min: 12, max: 18 }],

  // —— 类名完全改版:靠结构扫描兜底,不依赖任何 class ——
  ['类名改版:.salary 不存在,薪资在 .xyz 里', node('', '', [node('xyz', '20-40K')]), { min: 20, max: 40 }],
  ['类名改版:薪资在 .job-card-right > .box 里', node('', '', [node('job-card-right', '', [node('box', '25-45K·14薪')])]), { min: 25, max: 45 }],
  ['结构扫描不该把公司规模当薪资', node('', '', [node('xyz', '1000-9999人'), node('abc', '面议')]), null],

  // —— 字体反爬:文本里的数字被换成私用区码位(肉眼看是 15-25K,textContent 只剩 "- K")——
  ['混淆文本 + title 有明文', node('', '', [node('salary', '- K', [], { title: '15-25K' })]), { min: 15, max: 25 }],
  ['混淆文本 + data-salary 有明文', node('', '', [node('pay', '- K', [], { 'data-salary': '20-40K·15薪' })]), { min: 20, max: 40 }]
];

// —— 卡片元素只含"一半"(薪资在兄弟节点):widenCard 应向上冒泡补齐 ——
{
  const salaryNode = node('right', '20-40K');
  const titleNode = node('job-name', 'AI应用开发工程师');
  const parent = node('job-card-box', '', [titleNode, salaryNode]);
  cases.push(['卡片偏小:向上冒泡后能读到薪资', titleNode, { min: 20, max: 40 }]);
  cases.push(['冒泡目标本身能读到薪资', parent, { min: 20, max: 40 }]);

  // 冒泡不该越界到「含多个职位名」的祖先 —— 否则会读到隔壁职位的薪资
  const otherTitle = node('job-name', '另一个职位');
  const otherSalary = node('right', '8-12K');
  const otherCard = node('job-card-box', '', [otherTitle, otherSalary]);
  const list = node('list', '', [parent, otherCard]);
  widenChecks.push(['不越界到含多个职位的祖先', widenCard(titleNode) === parent, true]);
  widenChecks.push(['不越界后仍能读到本卡薪资', findSalaryIn(widenCard(titleNode)), '20-40K']);
  widenChecks.push(['邻居卡片读到的是自己的薪资', findSalaryIn(otherCard), '8-12K']);
  void list;
}

// —— 字体反爬专项:码点解码 + 骨架定位 ——
{
  widenChecks.push(['码点解码:私用区数字会显形', codePoints('\uE1A2\uE1B3-\uE2A1K'), '{E1A2}{E1B3}-{E2A1}K']);
  widenChecks.push(['码点解码:ASCII 原样保留', codePoints('20-40K'), '20-40K']);
  widenChecks.push(['码点解码:中文原样保留(日志可读)', codePoints('深圳·南山区'), '深圳·南山区']);

  const obf = node('salary', '- K', [], { title: '15-25K' });
  const holder = node('', '', [obf]);
  const skel = salarySkeletonNodes(holder, 3);
  widenChecks.push(['骨架扫描:数字被抹掉也能定位到节点', skel.length, 1]);
  widenChecks.push(['骨架扫描:定位到的就是那个节点', skel[0] === obf, true]);
  widenChecks.push(['属性兜底:从未混淆的 title 取回明文', findSalaryIn(holder), '15-25K']);
  widenChecks.push(['正常文本不会被误判成骨架', salarySkeletonNodes(node('', '', [node('x', '20-40K')]), 3).length, 0]);
}

// —— 字体反爬专项(PUA):标定 + 解密 ——
{
  // ob: 按「数字 0 = U+E031」把文本里的 0-9 换成私用区码位
  const ob = (s, base) => String(s).replace(/[0-9]/g, (d) =>
    String.fromCodePoint((base === undefined ? 0xE031 : base) + Number(d)));
  const pua = (cp) => String.fromCodePoint(cp);

  // ① 标准映射(锚点 E031)
  puaCalibrate([ob('15-25K'), ob('20-40K'), ob('8-12K'), ob('30-50K·14薪')]);
  widenChecks.push(['PUA 标定:启用解密', PUA.ready, true]);
  widenChecks.push(['PUA 标定:base 命中锚点 U+E031', PUA.base, 0xE031]);
  widenChecks.push(['PUA 解码:还原被混淆的薪资', puaDecode(ob('15-25K')), '15-25K']);
  widenChecks.push(['PUA 解码:真实数字原样保留', puaDecode('1-3年'), '1-3年']);
  widenChecks.push(['PUA 解码:无数字文本不受影响', puaDecode('面议'), '面议']);
  widenChecks.push(['PUA 解码:区间完整还原', puaDecode(ob('20-40K·15薪')), '20-40K·15薪']);

  // ② 端到端:文案里只剩「- K」的卡片,现在能正常解析
  widenChecks.push(['PUA 端到端:混淆卡片解析出薪资', (() => {
    const p = parseSalary(node('', '', [node('salary', ob('20-40K'))]));
    return p ? p.min + '-' + p.max : 'null';
  })(), '20-40']);
  widenChecks.push(['PUA 端到端:混淆卡片 findSalaryIn', (() => {
    return findSalaryIn(node('', '', [node('salary', ob('15-25K·13薪'))]));
  })(), '15-25K·13薪']);

  // ③ 字体重新生成(起始码位变化)
  puaCalibrate([ob('15-25K', 0xE5C0), ob('20-40K', 0xE5C0), ob('8-12K', 0xE5C0)]);
  widenChecks.push(['PUA 标定:起始码位变化后仍可标定', PUA.ready, true]);
  widenChecks.push(['PUA 标定:base 跟随字体走', PUA.base, 0xE5C0]);

  // ④ 页面上刚好没出现数字 0 —— 整体偏移一格,必须靠校验纠回来
  puaCalibrate([ob('15-25K'), ob('35-45K'), ob('23-34K')]);
  widenChecks.push(['PUA 标定:缺 0 时仍启用', PUA.ready, true]);
  widenChecks.push(['PUA 标定:缺 0 时未整体偏移', PUA.base, 0xE031]);

  // ⑤ 图标字体混入(私用区另一段 U+E6xx)—— 采样若带进图标,标定不能被带偏
  puaCalibrate([ob('15-25K'), ob('20-40K'), pua(0xE6A1) + pua(0xE6A2), pua(0xE6C8)]);
  widenChecks.push(['PUA 标定:图标码位混入仍能标定', PUA.ready, true]);
  widenChecks.push(['PUA 标定:图标未污染 base', PUA.base, 0xE031]);

  // ⑥ 非顺序映射(码位乱跳)—— 必须停用,宁可不筛也不能算错
  puaCalibrate([pua(0xE100) + '-' + pua(0xE200) + 'K', pua(0xE300) + '-' + pua(0xE400) + 'K']);
  widenChecks.push(['PUA 非顺序映射:停用解密', PUA.ready, false]);
  widenChecks.push(['PUA 非顺序映射:给出明确说明', /停用/.test(PUA.note), true]);
  widenChecks.push(['PUA 非顺序映射:不再改写文本', puaDecode(ob('15-25K')), ob('15-25K')]);

  // ⑦ 页面上没有 PUA 字符 —— 不做任何猜测
  puaCalibrate(['15-25K', '20-40K']);
  widenChecks.push(['PUA 无混淆:不启用', PUA.ready, false]);
  widenChecks.push(['PUA 无混淆:给出说明', /没有 PUA/.test(PUA.note), true]);

  // ⑧ 边界:空样本 / 非字符串不该崩
  puaCalibrate([]);
  widenChecks.push(['PUA 空样本:安全退出', PUA.ready, false]);
  puaCalibrate([null, undefined, 123, ob('15-25K')]);
  widenChecks.push(['PUA 脏样本:不崩且仍能标定', PUA.ready, true]);

  // ⑨ 前导 0 判定(标定校验的核心依据)
  widenChecks.push(['前导 0 判定:04K 算非法', hasLeadingZero('04-14K'), true]);
  widenChecks.push(['前导 0 判定:40-50K 合法', hasLeadingZero('40-50K'), false]);
  widenChecks.push(['前导 0 判定:20K 合法', hasLeadingZero('20K'), false]);
}

let pass = 0;
const fails = [];

for (const [name, c, expect] of cases) {
  const got = parseSalary(widenCard(c));
  const ok = expect === null
    ? got === null
    : (got && Math.abs(got.min - expect.min) < 0.05 && Math.abs(got.max - expect.max) < 0.05);
  if (ok) pass++;
  else fails.push({ name, expect, got });
  const show = (v) => (v === null ? 'null' : v.min + '-' + v.max + 'K');
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${name.padEnd(38)} 期望 ${show(expect).padEnd(14)} 实际 ${show(got)}`);
}

for (const [name, got, expect] of widenChecks) {
  const ok = got === expect;
  if (ok) pass++; else fails.push({ name, expect, got });
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${name.padEnd(38)} 期望 ${String(expect).padEnd(14)} 实际 ${got}`);
}

console.log(`\n${pass}/${cases.length + widenChecks.length} 通过`);
if (fails.length) {
  console.log('\n失败用例:');
  fails.forEach((f) => console.log('  - ' + f.name));
  process.exit(1);
}

// ---- 筛选逻辑抽样:区间重叠判断 ----
console.log('\n区间重叠抽样(筛选区间 15K — 60K+):');
const lo = 15, hi = Infinity;
[['8-12K', { min: 8, max: 12 }], ['10-20K', { min: 10, max: 20 }], ['15-25K', { min: 15, max: 25 }],
 ['20-40K', { min: 20, max: 40 }], ['60-90K', { min: 60, max: 90 }], ['80-100K', { min: 80, max: 100 }]]
  .forEach(([label, s]) => {
    const hit = !(s.max < lo || s.min > hi);
    console.log(`  ${label.padEnd(10)} → ${hit ? '保留' : '跳过'}`);
  });
