/*
 * 「点沟通就跳走」回归测试(不依赖浏览器)
 *
 * 背景:BOSS 的「立即沟通」常常是 <a href="/web/geek/chat?...">。
 * 旧版 simulateClick 里多调了一次 el.click() —— 那是浏览器级激活,会真的导航,
 * 表现就是「投一个就跳进聊天页」。这个用例锁住两件事:
 *   ① 点带 href 的 <a> 时,click 事件必须被 preventDefault(不导航),但事件照常派发
 *   ② 弹窗「留在此页」能找到并点掉;找不到且真跳了,要能识别出 jumped
 *
 * 从 content/app.js 抽取真实代码执行,只把 DOM 换成 mock。
 *
 * 运行: node tools/test-stay-click.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'boss-haitu-free', 'content', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

/* 按函数名切出源码(花括号配平),async 前缀也一起带上 */
function sliceFn(name) {
  for (const prefix of ['async function ' + name + '(', 'function ' + name + '(']) {
    const i = src.indexOf(prefix);
    if (i < 0) continue;
    let depth = 0;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') {
        depth--;
        if (depth === 0) return src.slice(i, k + 1);
      }
    }
  }
  console.error('✗ 无法定位函数:' + name);
  process.exit(1);
}

const blocks = ['simulateClick', 'findStayButton', 'handleStayModal'].map(sliceFn).join('\n\n');

/* ---------------- mock DOM ---------------- */
const MOCK = {
  path: '/web/geek/job',
  stay: null,        // 类名命中的「留在此页」
  dialogs: [],       // 弹窗容器
  inDialog: [],      // 弹窗容器内可点的元素
  buttons: [],       // 全页 button/a
  onAfterClick: null // 点击后模拟 BOSS 的侧效应(跳转)
};

function makeEl(opts) {
  opts = opts || {};
  const box = { width: 120, height: 20, left: 10, top: 10, right: 130, bottom: 30 };
  const el = {
    __tag: opts.tag || 'button',
    textContent: opts.text || '',
    href: opts.href || '',
    clicked: 0,
    prevented: 0,
    navigated: 0,
    getBoundingClientRect: () => Object.assign({}, box, opts.box || {}),
    scrollIntoView() { },
    closest: () => opts.anchor || null,
    contains: () => true,
    dispatchEvent(ev) {
      ev.target = el;
      DOC.capture.forEach((fn) => { fn(ev); });
      el.lastEvent = ev;
      if (opts.onClick) opts.onClick(ev);
      return !ev.defaultPrevented;
    },
    click() {
      el.clicked += 1;
      // 真实浏览器:click 事件被 preventDefault 就不会执行导航
      if (el.lastEvent && el.lastEvent.defaultPrevented) el.prevented += 1;
      else { el.navigated += 1; if (MOCK.onAfterClick) MOCK.onAfterClick(); }
    }
  };
  return el;
}

const DOC = {
  capture: [],
  addEventListener(type, fn) { if (type === 'click') this.capture.push(fn); },
  removeEventListener(type, fn) { this.capture = this.capture.filter((f) => f !== fn); },
  querySelector: () => null,
  querySelectorAll: () => []
};

class MouseEvent {
  constructor(type, o) {
    this.type = type;
    this.defaultPrevented = false;
    Object.assign(this, o || {});
  }
  preventDefault() { this.defaultPrevented = true; }
}
const window = {};

const qa = (sel) => {
  if (sel === '.default-btn.cancel-btn') return MOCK.stay ? [MOCK.stay] : [];
  if (sel.indexOf('[class*="dialog"]') === 0) return MOCK.dialogs;
  if (sel === 'button, a, span, div') return MOCK.inDialog;
  if (sel === 'button, a') return MOCK.buttons;
  return [];
};
const q = () => null;
const txt = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
const visible = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 2)));
const SEL = { STAY_BTN: '.default-btn.cancel-btn' };
const isJobsPage = () => MOCK.path.includes('/web/geek/job');

const api = new Function('qa', 'q', 'txt', 'visible', 'sleep', 'SEL', 'isJobsPage',
  'document', 'window', 'MouseEvent', `
  ${blocks}
  return { simulateClick, findStayButton, handleStayModal };
`)(qa, q, txt, visible, sleep, SEL, isJobsPage, DOC, window, MouseEvent);

/* ---------------- 断言 ---------------- */
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → 实际:' + detail : '')); }
}
function reset() {
  MOCK.path = '/web/geek/job';
  MOCK.stay = null; MOCK.dialogs = []; MOCK.inDialog = []; MOCK.buttons = [];
  MOCK.onAfterClick = null;
  DOC.capture = [];
}

(async function run() {
  /* 1. 带 href 的 <a>:事件被取消,不导航,但 click 照发 */
  console.log('\n[1] <a href="/web/geek/chat"> 只发事件、不导航');
  reset();
  const anchor = makeEl({ tag: 'a', href: '/web/geek/chat?jobId=1' });
  const btn = makeEl({ tag: 'a', text: '立即沟通', anchor });
  api.simulateClick(btn);
  check('点击被 preventDefault', btn.prevented === 1, btn.prevented);
  check('没有发生导航', btn.navigated === 0, btn.navigated);
  check('click 仍然派发一次(React 收得到)', btn.clicked === 1, btn.clicked);
  await sleep(30);
  check('捕获监听器已撤销', DOC.capture.length === 0, DOC.capture.length + ' 个残留');

  /* 2. 普通 <button>:照常点,不拦 */
  console.log('\n[2] 普通 <button> 照常点击');
  reset();
  const plain = makeEl({ text: '立即沟通' });
  api.simulateClick(plain);
  check('点击生效一次', plain.clicked === 1, plain.clicked);
  check('没有被误拦', plain.prevented === 0, plain.prevented);

  /* 3. 弹窗出现(类名命中)→ 点「留在此页」→ stayed */
  console.log('\n[3] 弹窗类名命中 → stayed');
  reset();
  const stay = makeEl({ text: '留在此页' });
  MOCK.stay = stay;
  const r3 = await api.handleStayModal();
  check('结果 stayed', r3 === 'stayed', r3);
  check('「留在此页」被点掉', stay.clicked === 1, stay.clicked);

  /* 4. 类名改了,但文本还在(走弹窗容器兜底) → stayed */
  console.log('\n[4] 类名失效、文本仍在 → 仍能点掉');
  reset();
  const stayText = makeEl({ text: '留在此页' });
  MOCK.dialogs = [makeEl({ text: '确定要离开此页吗 留在此页 继续沟通', box: { width: 400, height: 200 } })];
  MOCK.inDialog = [stayText];
  const r4 = await api.handleStayModal();
  check('结果 stayed', r4 === 'stayed', r4);
  check('兜底按钮被点掉', stayText.clicked === 1, stayText.clicked);

  /* 5. 没有弹窗、页面被带走 → 立刻 jumped,不傻等 */
  console.log('\n[5] 无弹窗且跳到聊天页 → jumped');
  reset();
  const jumpBtn = makeEl({ text: '立即沟通' });
  MOCK.onAfterClick = () => { MOCK.path = '/web/geek/chat'; };
  const t0 = Date.now();
  api.simulateClick(jumpBtn);
  const r5 = await api.handleStayModal();
  const cost = Date.now() - t0;
  check('结果 jumped', r5 === 'jumped', r5);
  check('没有等满 3.5 秒', cost < 1500, cost + 'ms');

  /* 6. 什么都发生 → none */
  console.log('\n[6] 既无弹窗也不跳 → none');
  reset();
  const r6 = await api.handleStayModal();
  check('结果 none', r6 === 'none', r6);

  console.log(`\n${pass}/${pass + fail} 通过` + (fail ? `,${fail} 失败` : ''));
  process.exit(fail ? 1 : 0);
})();
