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

/* 点击工具栏图标 → 通知当前标签页切换面板 */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: MSG.TOGGLE_PANEL });
  } catch (e) {
    // 页面还没注入内容脚本(例如未刷新),尝试主动注入
    try {
      if (!chrome.scripting) return;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['common/constants.js', 'content/app.js']
      });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/app.css'] });
      await chrome.tabs.sendMessage(tab.id, { type: MSG.TOGGLE_PANEL });
    } catch (e2) { /* ignore */ }
  }
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
