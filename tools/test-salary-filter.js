/*
 * 薪资筛选回归测试(端到端,不依赖浏览器)
 * 从 content/app.js 抽取真实的 parseSalary / collectJobList / logFilterReport 执行,
 * 只把 DOM 相关的 getCards / cardFields 换成 mock。
 *
 * 运行:
 *   node tools/test-salary-filter.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'boss-haitu-free', 'content', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

function slice(from, to) {
  const i = src.indexOf(from);
  const j = src.indexOf(to);
  if (i < 0 || j < 0 || j <= i) {
    console.error(`✗ 无法定位代码块:「${from.slice(0, 20)}」→「${to.slice(0, 24)}」`);
    process.exit(1);
  }
  return src.slice(i, j);
}

const salaryBlock = slice('/* ---------- 薪资解析 ----------', 'function parseCompanySize(');
const filterBlock = slice('// 上一次筛选的明细', 'function jobKey(');

const factory = new Function(`
  const q = (s, root) => (root && root.querySelector ? root.querySelector(s) : null);
  const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const SEL = { CARD_TITLE: '.job-name' };
  const document = { body: null, documentElement: null };
  let MOCK_PATH = '/web/geek/job';
  const location = { get pathname() { return MOCK_PATH; } };
  ${salaryBlock}

  const SALARY = { min: 0, max: 60, step: 1 };
  let settings = {};
  const logLines = [];
  const log = (s) => logLines.push(String(s));
  function salaryUnlimited() {
    return settings.salaryMin <= SALARY.min && settings.salaryMax >= SALARY.max;
  }
  let MOCK_CARDS = [];
  let MOCK_FIELDS = () => ({});
  function getCards() { return { cards: MOCK_CARDS, selector: 'mock' }; }
  function cardFields(c) { return MOCK_FIELDS(c); }

  ${filterBlock}

  return {
    collectJobList, logFilterReport, lastFilterReport, parseSalary, PUA,
    setSettings: (s) => { settings = s; },
    setCards: (cards, fields) => { MOCK_CARDS = cards; MOCK_FIELDS = fields; },
    setPath: (p) => { MOCK_PATH = p; },
    lines: () => logLines.slice(),
    clearLines: () => { logLines.length = 0; }
  };
`)();

// ---- 构造场景 ----
// 每张卡片: { title, salaryText }
function build(jobs) {
  const cards = jobs.map((j, i) => ({ __i: i }));
  const fields = (c) => {
    const j = jobs[c.__i];
    return {
      title: j.title,
      addr: j.addr || '深圳',
      company: j.company || '某公司',
      hhAlt: j.hhAlt || '',
      salary: j.salaryText === undefined ? null : parseOne(j.salaryText),
      size: j.size || '100-499人'
    };
  };
  return { cards, fields };
}

// 用被测代码自己的解析函数算 salary,避免测试里再写一份
const parseOne = (() => {
  const f = new Function(`
    const q = () => null;
    const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
    const SEL = { CARD_TITLE: '.job-name' };
    const document = { body: null, documentElement: null };
    ${salaryBlock}
    return parseSalary;
  `);
  return (text) => f()({ textContent: text });
})();

let pass = 0;
const fails = [];
function check(name, got, expect) {
  const ok = got === expect;
  if (ok) pass++; else fails.push(name);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} 期望 ${String(expect).padEnd(8)} 实际 ${got}`);
}

// ============ 场景 1:常规筛选(本次修复的核心场景) ============
console.log('\n场景 1 · 筛选 15K—60K+,混合职位');
{
  const jobs = [
    { title: 'AI应用开发工程师', salaryText: '15-25K' },   // 命中
    { title: '算法工程师', salaryText: '20-40K' },          // 命中
    { title: '初级开发', salaryText: '8-12K' },             // 薪资不符
    { title: '实习生', salaryText: '150-200元/天' },         // 薪资不符
    { title: '架构师', salaryText: '80-100K' },             // 命中(60K+ 视为不设上限)
    { title: '测试工程师', salaryText: '面议' },             // 未识别 → 跳过
    { title: '运维工程师', salaryText: '10-20K' }           // 命中(区间有交集)
  ];
  factory.setSettings({
    includeKeywords: [], locationKeywords: [], companySizes: [],
    excludeHeadhunters: false, salaryMin: 15, salaryMax: 60, activeStatus: ['不限']
  });
  const { cards, fields } = build(jobs);
  factory.setCards(cards, fields);
  const list = factory.collectJobList();
  const r = factory.lastFilterReport;
  check('保留数量', list.length, 4);
  check('薪资不符计数', r.skip['薪资不符'], 2);
  check('薪资未识别计数', r.skip['薪资未识别'], 1);
  check('成功解析计数', r.salaryParsed, 6);
}

// ============ 场景 2:旧版 fail-open 会漏掉的场景 ============
console.log('\n场景 2 · 薪资全部无法识别时(旧版会全部放行,即「筛选没用」)');
{
  const jobs = [
    { title: '岗位A', salaryText: '面议' },
    { title: '岗位B', salaryText: '' },
    { title: '岗位C', salaryText: undefined }
  ];
  factory.setSettings({
    includeKeywords: [], locationKeywords: [], companySizes: [],
    excludeHeadhunters: false, salaryMin: 15, salaryMax: 60, activeStatus: ['不限']
  });
  const { cards, fields } = build(jobs);
  factory.setCards(cards, fields);
  const list = factory.collectJobList();
  check('全部跳过(旧版会保留 3 个)', list.length, 0);
  check('未识别计数', factory.lastFilterReport.skip['薪资未识别'], 3);
  factory.logFilterReport();
  const warn = factory.lines().some((l) => l.includes('薪资一个都没解析出来'));
  check('日志给出选择器失效告警', warn, true);
  check('搜索页不给「改用搜索页」提示', factory.lines().some((l) => l.includes('推荐页的卡片可能根本不渲染薪资')), false);

  factory.setPath('/web/geek/jobs');
  factory.logFilterReport();
  check('推荐页额外提示改用搜索页', factory.lines().some((l) => l.includes('推荐页的卡片可能根本不渲染薪资')), true);
  factory.setPath('/web/geek/job');
}

// ============ 场景 3:薪资不限时,不该过滤任何职位 ============
console.log('\n场景 3 · 薪资滑块保持默认(0—60),不应参与过滤');
{
  const jobs = [
    { title: '岗位A', salaryText: '8-12K' },
    { title: '岗位B', salaryText: '面议' }
  ];
  factory.setSettings({
    includeKeywords: [], locationKeywords: [], companySizes: [],
    excludeHeadhunters: false, salaryMin: 0, salaryMax: 60, activeStatus: ['不限']
  });
  const { cards, fields } = build(jobs);
  factory.setCards(cards, fields);
  const list = factory.collectJobList();
  check('全部保留', list.length, 2);
  check('salaryOn 标记', factory.lastFilterReport.salaryOn, false);
}

// ============ 场景 4:只设下限 / 只设上限 ============
console.log('\n场景 4 · 只拖下限 15K(上限留在最右)');
{
  const jobs = [{ title: 'A', salaryText: '8-12K' }, { title: 'B', salaryText: '15-25K' }];
  factory.setSettings({
    includeKeywords: [], locationKeywords: [], companySizes: [],
    excludeHeadhunters: false, salaryMin: 15, salaryMax: 60, activeStatus: ['不限']
  });
  factory.setCards(...Object.values(build(jobs)));
  check('只保留 15K 以上', factory.collectJobList().length, 1);
}
console.log('\n场景 5 · 只拖上限 12K(下限留在最左)');
{
  const jobs = [{ title: 'A', salaryText: '8-12K' }, { title: 'B', salaryText: '15-25K' }];
  factory.setSettings({
    includeKeywords: [], locationKeywords: [], companySizes: [],
    excludeHeadhunters: false, salaryMin: 0, salaryMax: 12, activeStatus: ['不限']
  });
  factory.setCards(...Object.values(build(jobs)));
  check('只保留 12K 以下', factory.collectJobList().length, 1);
}

// ============ 场景 6:其它筛选维度仍然生效 ============
console.log('\n场景 6 · 关键词 / 城市 / 猎头 / 公司规模');
{
  const jobs = [
    { title: 'AI应用开发', addr: '深圳', salaryText: '20-30K' },
    { title: 'Java开发', addr: '深圳', salaryText: '20-30K' },
    { title: 'AI算法', addr: '杭州', salaryText: '20-30K' },
    { title: 'AI产品', addr: '深圳', salaryText: '20-30K', hhAlt: '猎头' },
    { title: 'AI测试', addr: '深圳', salaryText: '20-30K', size: '0-20人' }
  ];
  factory.setSettings({
    includeKeywords: ['ai'], locationKeywords: ['深圳'], companySizes: ['100-499人'],
    excludeHeadhunters: true, salaryMin: 15, salaryMax: 60, activeStatus: ['不限']
  });
  const { cards, fields } = build(jobs);
  factory.setCards(cards, fields);
  const list = factory.collectJobList();
  const r = factory.lastFilterReport;
  check('只留 AI应用开发', list.length, 1);
  check('关键词不符', r.skip['关键词'], 1);
  check('城市不符', r.skip['城市'], 1);
  check('猎头', r.skip['猎头'], 1);
  check('公司规模不符', r.skip['公司规模'], 1);
}

// ============ 场景 7:字体反爬(本次报障的真实路径) ============
// BOSS 把薪资里的数字换成私用区(PUA)码位 —— 页面看着是「15-25K」,
// textContent 里数字却消失了。旧版这里会 100% 跳过所有职位,表现就是「薪资筛选没用」。
console.log('\n场景 7 · 薪资数字被字体反爬混淆');
{
  // 极简 DOM mock(只为跑通 findSalaryIn / widenCard / salarySkeletonNodes)
  function node(cls, text, children) {
    const el = {
      tagName: 'DIV', _cls: cls || '', _text: text || '', children: children || [],
      parentElement: null,
      getAttribute: (n) => (n === 'class' ? el._cls : null),
      get attributes() { return []; },
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
  // 按「数字 0 = U+E031」把 0-9 换成私用区码位
  const ob = (s) => String(s).replace(/[0-9]/g, (d) => String.fromCodePoint(0xE031 + Number(d)));

  const jobs = [
    { title: 'AI应用开发工程师', sal: ob('15-25K') },        // 命中
    { title: '算法工程师', sal: ob('20-40K·15薪') },          // 命中
    { title: '初级开发', sal: ob('8-12K') },                 // 薪资不符
    { title: 'AI产品经理', sal: ob('25-45K') }               // 命中
  ];
  const cards = jobs.map((j) => node('job-card-box', '', [
    node('job-name', j.title),
    node('salary', j.sal)
  ]));
  // 半张卡片:只含标题那一半,薪资在兄弟节点 → 需要冒泡 + 第 2 轮标定
  cards.push(node('job-name', 'AI Agent 测试工程师'));
  cards[cards.length - 1].parentElement = node('job-card-box', '', [
    cards[cards.length - 1], node('salary', ob('30-50K'))
  ]);

  factory.setSettings({
    includeKeywords: [], locationKeywords: [], companySizes: [],
    excludeHeadhunters: false, salaryMin: 15, salaryMax: 60, activeStatus: ['不限']
  });
  factory.setCards(cards, (c) => ({
    title: (c.querySelector('.job-name') && c.querySelector('.job-name').textContent) || '',
    addr: '深圳', company: '某公司', hhAlt: '', size: '100-499人',
    salary: factory.parseSalary(c)
  }));

  const list = factory.collectJobList();
  const r = factory.lastFilterReport;
  check('字体反爬已标定(R.ready)', factory.PUA.ready, true);
  check('标定的 base = U+E031', factory.PUA.base, 0xE031);
  check('保留数量(含半张卡片冒泡补齐)', list.length, 4);
  check('薪资不符计数', r.skip['薪资不符'], 1);
  check('薪资未识别计数(旧版这里是 5)', r.skip['薪资未识别'], 0);
  check('成功解析计数', r.salaryParsed, 5);

  factory.logFilterReport();
  check('日志里能看到字体反爬状态', factory.lines().some((l) => l.includes('字体反爬')), true);
}

// ============ 场景 8:边界设错时,日志必须自解释 ============
// 用户报障的真实形态:15-25K / 19-30K 被判「薪资不符」,
// 而旧版日志只打印「薪资不符 46」,不打印生效区间,也不说为什么 —— 只能靠猜。
console.log('\n场景 8 · 下限被拖高(31K)');
{
  const jobs = [
    { title: 'AI Agent 测试工程师', salaryText: '15-25K' },
    { title: 'AI产品经理（情绪陪伴）', salaryText: '19-30K' },
    { title: 'Ai Agent开发', salaryText: '15-30K' },
    { title: 'AI架构师', salaryText: '40-70K' }
  ];
  factory.setSettings({
    includeKeywords: [], locationKeywords: [], companySizes: [],
    excludeHeadhunters: false, salaryMin: 31, salaryMax: 60, activeStatus: ['不限']
  });
  factory.setCards(...Object.values(build(jobs)));
  factory.clearLines();
  const list = factory.collectJobList();
  factory.logFilterReport();
  const lines = factory.lines();
  check('只留下 40-70K', list.length, 1);
  check('薪资不符 = 3', factory.lastFilterReport.skip['薪资不符'], 3);
  check('日志打印实际生效区间', lines.some((l) => l.includes('薪资条件 31K — 不限(60K+)')), true);
  check('拒绝原因写明「低于下限」', lines.some((l) => l.includes('低于下限 31K')), true);
}

// ============ 场景 9:两个滑块拖到同一个点 ============
console.log('\n场景 9 · 下限 ≥ 上限(可投区间 0 宽)');
{
  factory.setSettings({
    includeKeywords: [], locationKeywords: [], companySizes: [],
    excludeHeadhunters: false, salaryMin: 31, salaryMax: 31, activeStatus: ['不限']
  });
  factory.setCards(...Object.values(build([{ title: 'A', salaryText: '15-25K' }])));
  factory.clearLines();
  factory.collectJobList();
  factory.logFilterReport();
  check('日志警告滑块叠在一起', factory.lines().some((l) => l.includes('被压成了 0 宽')), true);
}

// ============ 场景 10:正常区间不该误报警告(回归) ============
console.log('\n场景 10 · 正常区间 15K—60K+ 不该出现任何警告');
{
  const jobs = [
    { title: 'AI Agent 测试工程师', salaryText: '15-25K' },
    { title: 'AI产品经理', salaryText: '19-30K' },
    { title: '低薪岗', salaryText: '8-12K' }
  ];
  factory.setSettings({
    includeKeywords: [], locationKeywords: [], companySizes: [],
    excludeHeadhunters: false, salaryMin: 15, salaryMax: 60, activeStatus: ['不限']
  });
  factory.setCards(...Object.values(build(jobs)));
  factory.clearLines();
  const list = factory.collectJobList();
  factory.logFilterReport();
  const lines = factory.lines();
  check('保留 2 个(15-25 / 19-30)', list.length, 2);
  check('日志区间正确', lines.some((l) => l.includes('薪资条件 15K — 不限(60K+)')), true);
  check('不出现「0 宽」误报', lines.some((l) => l.includes('被压成了 0 宽')), false);
  check('不出现「全部卡在薪资上」误报', lines.some((l) => l.includes('全部卡在薪资上')), false);
}

console.log(`\n${pass} 项通过${fails.length ? `,${fails.length} 项失败` : ''}`);
if (fails.length) {
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
