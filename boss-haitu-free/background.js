/*
 * 一键投 Boss —— 后台 Service Worker
 * 极简职责:点击工具栏图标切换页面内面板、维护 badge、跨天复位今日计数。
 */
importScripts('common/constants.js');

const K = globalThis.HT_KEYS;
const MSG = globalThis.HT_MSG;
const DEFAULT_STATE = globalThis.HT_DEFAULT_STATE;

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function getLocal(keys) { return await chrome.storage.local.get(keys); }
async function setLocal(o) { return await chrome.storage.local.set(o); }

async function getSettings() {
  const { [K.settings]: s } = await getLocal(K.settings);
  return Object.assign({}, globalThis.HT_DEFAULTS, s || {});
}

async function getCounter() {
  const { [K.state]: st } = await getLocal(K.state);
  const { ht_counter: c } = await getLocal('ht_counter');
  const today = todayStr();
  if (!c || c.date !== today) return { date: today, count: 0 };
  return c;
}

async function updateBadge() {
  const c = await getCounter();
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#00A6A7' });
    await chrome.action.setBadgeText({ text: c.count > 0 ? String(c.count) : '' });
  } catch (e) { /* ignore */ }
}

/* ---------------- 工具栏图标:点一下就要能看到面板 ----------------
   三级兜底,任一层成功即返回:
   ① 消息通道(首选,面板会顺带刷新统计与记录)
   ② 页面里压根没有面板 → 主动注入脚本,等它建好再发一次消息
   ③ 注入成功但消息仍不通 → 直接改 DOM 把面板从收起态展开
   结果会在图标上闪一下 ✓ / ! ,不用再猜「点了到底有没有反应」。
*/
function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(resp || null);
      });
    } catch (e) { resolve(null); }
  });
}

async function hasPanel(tabId) {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!(document.querySelector && document.querySelector('.ht-root'))
    });
    return !!(r && r[0] && r[0].result);
  } catch (e) { return false; }
}

async function injectPanel(tabId) {
  if (!chrome.scripting) return false;
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/app.css'] });
  } catch (e) { /* 重复插入会报错,忽略 */ }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['common/constants.js', 'content/app.js']
    });
    return true;
  } catch (e) { return false; }
}

/* 兜底:不经过消息,直接展开,并把它拉回视口内(位置记忆可能把它留在屏幕外) */
async function forceOpenDom(tabId) {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = document.querySelector('.ht-root');
        if (!root) return false;
        root.classList.remove('ht-collapsed');
        const b = root.getBoundingClientRect();
        if (b.right < 48 || b.bottom < 48 || b.left > innerWidth - 48 || b.top > innerHeight - 48) {
          root.style.left = '';
          root.style.top = '';
          root.style.right = '18px';
          root.style.bottom = '18px';
        }
        return true;
      }
    });
    return !!(r && r[0] && r[0].result);
  } catch (e) { return false; }
}

let badgeTimer = null;
function flashBadge(ok) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: ok ? '#0F9D58' : '#D93A3A' });
    chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => { updateBadge(); }, 1400);
  } catch (e) { /* ignore */ }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  const tabId = tab.id;

  /* ① 首选:走内容脚本的消息通道 */
  const r1 = await sendToTab(tabId, { type: MSG.OPEN_PANEL });
  if (r1 && r1.ok) return flashBadge(true);

  /* ② 页面里没有面板 → 主动注入,等它建好再试 */
  if (!(await hasPanel(tabId))) {
    if (!(await injectPanel(tabId))) return flashBadge(false);
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 150));
      if (await hasPanel(tabId)) break;
    }
    const r2 = await sendToTab(tabId, { type: MSG.OPEN_PANEL });
    if (r2 && r2.ok) return flashBadge(true);
  }

  /* ③ 最后兜底:直接改 DOM */
  flashBadge(await forceOpenDom(tabId));
});

/* 消息:内容脚本上报成功计数 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg && msg.type === MSG.GET_STATE) {
      const settings = await getSettings();
      const c = await getCounter();
      sendResponse({ ok: true, settings, todayCount: c.count });
    } else if (msg && msg.type === 'ht:inc') {
      const c = await getCounter();
      c.count += 1;
      await setLocal({ ht_counter: c });
      await updateBadge();
      sendResponse({ ok: true, todayCount: c.count });
    } else if (msg && msg.type === MSG.STATE_CHANGED) {
      await updateBadge();
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const s = await getSettings();
  await setLocal({ [K.settings]: s });
  const { [K.state]: st } = await getLocal(K.state);
  if (!st) await setLocal({ [K.state]: DEFAULT_STATE });
  await updateBadge();
});

/* 定时任务:跨天复位今日计数(防御式,任何 API 缺失都不影响扩展加载) */
try {
  if (chrome.alarms && chrome.alarms.create) {
    chrome.alarms.create('ht-tick', { periodInMinutes: 5 });
    chrome.alarms.onAlarm.addListener(async (a) => {
      if (a.name !== 'ht-tick') return;
      try {
        const { ht_counter: c } = await getLocal('ht_counter');
        if (!c || c.date !== todayStr()) await setLocal({ ht_counter: { date: todayStr(), count: 0 } });
        await updateBadge();
      } catch (e) { /* ignore */ }
    });
  }
} catch (e) { /* ignore */ }
