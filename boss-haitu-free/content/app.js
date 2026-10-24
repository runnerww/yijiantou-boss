/*
 * 一键投 Boss —— 内容脚本
 * 面板 UI(Notion / Linear 风格) + 投递引擎 + 自动沟通引擎。全部本地运行。
 *
 * 投递(/web/geek/job*):滚到底加载全部职位 → 按关键词/城市/薪资/公司规模/招聘者状态/猎头 筛选
 *                      → 点卡片 → 点「立即沟通」→ 处理「留在此页」弹窗 → 记录
 * 沟通(/web/geek/chat):对未招呼过的 HR 逐个打开 → 发招呼语(可多条)→ 可选发附件简历
 *                      → HR 回复提到「简历」时自动发送简历
 */
(function () {
  'use strict';
  if (window.__HT_LOADED__) return;
  window.__HT_LOADED__ = true;

  // 版本号:面板标题 + 控制台 + 运行日志都会带上,用来确认新代码是否真的生效
  const VERSION = '1.0.10';
  try { console.log('%c[一键投 Boss] v' + VERSION + ' 内容脚本已加载', 'color:#2b6cb0;font-weight:bold'); } catch (e) { /* ignore */ }

  const K = globalThis.HT_KEYS;
  const MSG = globalThis.HT_MSG;
  const SEL = globalThis.HT_SEL;
  const DEFAULTS = globalThis.HT_DEFAULTS;
  const ACTIVE_STATUS = globalThis.HT_ACTIVE_STATUS;
  const CITIES = globalThis.HT_CITIES || [];
  const COMPANY_SIZES = globalThis.HT_COMPANY_SIZES || [];
  const SALARY = globalThis.HT_SALARY || { min: 0, max: 60, step: 1 };
  const IMG = globalThis.HT_IMAGE || { maxCount: 3, maxBytes: 2 * 1024 * 1024, accept: 'image/*', types: [] };

  /* ============================ 小工具 ============================ */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const randBetween = (a, b) => Math.random() * (b - a) + a;
  const q = (s, root = document) => root.querySelector(s);
  const qa = (s, root = document) => Array.from(root.querySelectorAll(s));
  const txt = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  async function waitFor(fn, timeout = 8000, interval = 200) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try { const v = fn(); if (v) return v; } catch (e) { /* ignore */ }
      await sleep(interval);
    }
    return null;
  }
  function simulateClick(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
    };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    if (typeof el.click === 'function') { try { el.click(); } catch (e) { /* ignore */ } }
  }

  /* 带重试的异步执行器
   * fn: 返回 Promise 的函数;返回 { outcome } 结构
   * retryOutcomes: 需要重试的 outcome 列表(如 'no-button' 表示找不到按钮)
   * maxRetries: 最大重试次数(不含首次)
   * delayMs: 每次重试前等待毫秒数 */
  async function withRetry(fn, retryOutcomes, maxRetries = 2, delayMs = 800) {
    let lastResult;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (stopFlag) break;
      try {
        lastResult = await fn();
        // 成功或明确跳过的 outcome 直接返回,不再重试
        if (!lastResult || !retryOutcomes.includes(lastResult.outcome)) return lastResult;
        // 需要重试的 outcome
        if (attempt < maxRetries) {
          log(`  重试 ${attempt + 1}/${maxRetries}…`);
          await sleep(delayMs);
        }
      } catch (e) {
        lastResult = { outcome: 'error', detail: String(e && e.message) };
        if (attempt < maxRetries) {
          log(`  异常重试 ${attempt + 1}/${maxRetries}: ${e && e.message}`);
          await sleep(delayMs);
        }
      }
    }
    return lastResult;
  }

  /* 分隔符:英文/中文逗号、换行、分号、顿号、各种空白(含普通空格、Tab、全角空格 \u3000) */
  function parseList(v) {
    if (Array.isArray(v)) v = v.join('\n');
    return String(v || '')
      .split(/[\s,，;；、]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /* 线性风格图标 */
  const ICONS = {
    spark: '<path d="M13 2.5 5 13.5h5.5L10 21.5l8-11h-5.5z"/>',
    home: '<path d="M3.6 10.3 12 3.6l8.4 6.7"/><path d="M5.9 9.3V20h12.2V9.3"/>',
    chart: '<path d="M4 20V11"/><path d="M10 20V4.5"/><path d="M16 20v-6"/><path d="M21 20H3"/>',
    sliders: '<path d="M4 7h8"/><path d="M17 7h3"/><circle cx="14.5" cy="7" r="2"/><path d="M4 12h2"/><path d="M11 12h9"/><circle cx="8.5" cy="12" r="2"/><path d="M4 17h8"/><path d="M17 17h3"/><circle cx="14.5" cy="17" r="2"/>',
    clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.6V12l3 1.8"/>',
    layers: '<path d="m12 3.6 8 4.2-8 4.2-8-4.2z"/><path d="m4 12 8 4.2 8-4.2"/><path d="m4 16.2 8 4.2 8-4.2"/>',
    check: '<path d="M20 6.6 9.6 17 4 11.4"/>',
    play: '<path d="M7.5 4.8v14.4L19.5 12z"/>',
    pause: '<path d="M9 5v14"/><path d="M15 5v14"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M12 5.5v13"/><path d="M5.5 12h13"/>',
    brush: '<path d="M4 20h16"/><path d="M6 20V9.5l6-5 6 5V20"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17.2 4.7-4.5 3.3 3.1 2.6-2.3 4.4 3.9"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V4.8h5V7"/><path d="M6.6 7l1 13h8.8l1-13"/>'
  };
  function svg(name, cls) {
    return '<svg class="ht-i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || '') + '</svg>';
  }

  /* ============================ 状态 ============================ */
  let settings = Object.assign({}, DEFAULTS);
  const sets = { greeted: new Set(), resumeSent: new Set(), applied: new Set() };
  let records = [];
  let stats = { total: 0, attempts: 0 };
  const state = {
    running: false, paused: false, mode: '',
    phase: 'idle', message: '', runCount: 0, todayCount: 0
  };

  async function loadStorage() {
    const obj = await chrome.storage.local.get(
      [K.settings, K.records, K.stats, K.greeted, K.resumeSent, K.applied]);
    settings = Object.assign({}, DEFAULTS, obj[K.settings] || {});
    // 归一化:把历史遗留的"空格分隔"关键词重新拆开(如 "杭州 长沙" → ["杭州","长沙"])
    settings.includeKeywords = parseList(settings.includeKeywords);
    settings.locationKeywords = parseList(settings.locationKeywords);
    settings.companySizes = Array.isArray(settings.companySizes) ? settings.companySizes.filter(Boolean) : [];
    if (!Array.isArray(settings.activeStatus) || !settings.activeStatus.length) settings.activeStatus = ['不限'];
    settings.salaryMin = Number(settings.salaryMin) || 0;
    settings.salaryMax = Number(settings.salaryMax);
    if (!isFinite(settings.salaryMax) || settings.salaryMax <= 0) settings.salaryMax = SALARY.max;

    records = Array.isArray(obj[K.records]) ? obj[K.records] : [];
    stats = Object.assign({ total: 0, attempts: 0 }, obj[K.stats] || {});
    if (!stats.total && records.length) stats.total = records.length;   // 老数据回填

    sets.greeted = new Set(obj[K.greeted] || []);
    sets.resumeSent = new Set(obj[K.resumeSent] || []);
    sets.applied = new Set(obj[K.applied] || []);

    const st = await chrome.runtime.sendMessage({ type: MSG.GET_STATE }).catch(() => null);
    if (st && st.ok) state.todayCount = st.todayCount || 0;
  }
  async function saveSettings() {
    try { await chrome.storage.local.set({ [K.settings]: settings }); } catch (e) { /* ignore */ }
  }
  async function persistSets() {
    await chrome.storage.local.set({
      [K.greeted]: Array.from(sets.greeted).slice(-8000),
      [K.resumeSent]: Array.from(sets.resumeSent).slice(-8000),
      [K.applied]: Array.from(sets.applied).slice(-8000)
    });
  }
  async function addRecord(rec) {
    records.push(Object.assign({ ts: Date.now() }, rec));
    if (records.length > 3000) records = records.slice(-3000);
    await chrome.storage.local.set({ [K.records]: records });
  }
  async function bumpStats(ok) {
    stats.attempts += 1;
    if (ok) stats.total += 1;
    try { await chrome.storage.local.set({ [K.stats]: stats }); } catch (e) { /* ignore */ }
    renderHomeStats();
    renderDataPage();
  }
  async function incToday() {
    state.todayCount += 1;
    state.runCount += 1;
    try { await chrome.runtime.sendMessage({ type: 'ht:inc' }); } catch (e) { /* ignore */ }
    renderHomeStats();
  }
  function setPhase(phase, message) {
    state.phase = phase;
    state.message = message || '';
    renderStatus();
    renderButtons();
    try { chrome.runtime.sendMessage({ type: MSG.STATE_CHANGED }); } catch (e) { /* ignore */ }
  }
  function jumpTo(page) {
    if (!panel) return;
    qa('.ht-navbtn', panel).forEach((b) => b.classList.toggle('on', b.getAttribute('data-nav') === page));
    qa('.ht-page', panel).forEach((p) => { p.hidden = p.getAttribute('data-page') !== page; });
    const body = q('.ht-body', panel);
    if (body) body.scrollTop = 0;
    if (page === 'data') renderDataPage();
    if (page === 'settings') { renderGreetings(); renderChips(); syncFormControls(); }
  }

  /* ============================ 面板 ============================ */
  let panel = null;
  let ui = {};

  function buildPanel() {
    if (panel) return;

    const cityOptions = ['<option value="">添加城市…</option>']
      .concat(CITIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)).join('');

    panel = document.createElement('div');
    panel.className = 'ht-root ht-collapsed';
    panel.innerHTML = `
      <button class="ht-launcher" title="打开一键投面板">
        ${svg('spark')}<span>一键投</span>
      </button>

      <div class="ht-panel">
        <header class="ht-top">
          <div class="ht-brand">
            <span class="ht-logo">${svg('spark')}</span>
            <span class="ht-brandname">一键投 Boss</span>
            <span class="ht-ver">v${VERSION}</span>
          </div>
          <div class="ht-top-right">
            <span class="ht-pill" data-status><i class="ht-dot"></i><span data-status-text>待机</span></span>
            <button class="ht-iconbtn ht-min" title="收起">${svg('minus')}</button>
          </div>
        </header>

        <div class="ht-body">

          <!-- ===================== 首页 ===================== -->
          <section class="ht-page" data-page="home">
            <div class="ht-stats">
              <div class="ht-stat">
                <div class="ht-stat-hd"><span class="ht-stat-ic">${svg('clock')}</span><span>今日投递</span></div>
                <div class="ht-stat-num"><span data-num="today">0</span></div>
              </div>
              <div class="ht-stat">
                <div class="ht-stat-hd"><span class="ht-stat-ic">${svg('layers')}</span><span>总投递</span></div>
                <div class="ht-stat-num"><span data-num="total">0</span></div>
              </div>
              <div class="ht-stat">
                <div class="ht-stat-hd"><span class="ht-stat-ic">${svg('check')}</span><span>成功率</span></div>
                <div class="ht-stat-num"><span data-num="rate">0</span><span class="ht-unit">%</span></div>
              </div>
            </div>

            <div class="ht-card ht-run">
              <button class="ht-primary" data-act="start">${svg('play')}<span>一键开始投递</span></button>
              <button class="ht-iconbtn ht-lg" data-act="pause" title="暂停 / 继续" disabled>${svg('pause')}</button>
              <button class="ht-iconbtn ht-lg" data-act="stop" title="停止" disabled>${svg('stop')}</button>
            </div>

            <div class="ht-card">
              <div class="ht-card-hd">
                <span class="ht-card-title">筛选条件</span>
                <span class="ht-sum" data-sum></span>
              </div>

              <div class="ht-field">
                <div class="ht-field-hd"><label>岗位关键词</label><span class="ht-hint">回车 / 逗号 / 空格分隔</span></div>
                <div class="ht-tags" data-tags="includeKeywords"></div>
              </div>

              <div class="ht-field">
                <div class="ht-field-hd"><label>城市</label><span class="ht-hint">可多选</span></div>
                <div class="ht-tags" data-tags="locationKeywords"></div>
                <select class="ht-select" data-city-select>${cityOptions}</select>
              </div>

              <div class="ht-field">
                <div class="ht-field-hd"><label>薪资范围</label><span class="ht-rangetxt" data-salary-text>不限</span></div>
                <div class="ht-range" data-salary>
                  <div class="ht-range-track"><div class="ht-range-fill" data-salary-fill></div></div>
                  <input type="range" class="ht-rng ht-rng-lo" min="${SALARY.min}" max="${SALARY.max}" step="${SALARY.step}" />
                  <input type="range" class="ht-rng ht-rng-hi" min="${SALARY.min}" max="${SALARY.max}" step="${SALARY.step}" />
                </div>
              </div>

              <div class="ht-field">
                <div class="ht-field-hd"><label>公司规模</label><span class="ht-hint">不选 = 不限</span></div>
                <div class="ht-chips" data-chips="companySizes"></div>
              </div>
            </div>

            <div class="ht-card">
              <div class="ht-card-hd">
                <span class="ht-card-title">投递日志</span>
                <span class="ht-live" data-live><i></i>实时</span>
              </div>
              <div class="ht-recordlist" data-records></div>
            </div>

            <details class="ht-card ht-details">
              <summary class="ht-card-hd"><span class="ht-card-title">运行日志</span><span class="ht-chev">›</span></summary>
              <div class="ht-logbox" data-log></div>
            </details>
          </section>

          <!-- ===================== 数据统计 ===================== -->
          <section class="ht-page" data-page="data" hidden>
            <div class="ht-stats">
              <div class="ht-stat">
                <div class="ht-stat-hd"><span class="ht-stat-ic">${svg('layers')}</span><span>累计成功</span></div>
                <div class="ht-stat-num"><span data-num="d-total">0</span></div>
              </div>
              <div class="ht-stat">
                <div class="ht-stat-hd"><span class="ht-stat-ic">${svg('clock')}</span><span>今日</span></div>
                <div class="ht-stat-num"><span data-num="d-today">0</span></div>
              </div>
              <div class="ht-stat">
                <div class="ht-stat-hd"><span class="ht-stat-ic">${svg('check')}</span><span>成功率</span></div>
                <div class="ht-stat-num"><span data-num="d-rate">0</span><span class="ht-unit">%</span></div>
              </div>
            </div>

            <div class="ht-card">
              <div class="ht-card-hd"><span class="ht-card-title">近 7 日投递</span></div>
              <div class="ht-bars" data-bars></div>
            </div>

            <div class="ht-card">
              <div class="ht-card-hd"><span class="ht-card-title">状态分布</span></div>
              <div class="ht-dist" data-dist></div>
            </div>
          </section>

          <!-- ===================== 设置 ===================== -->
          <section class="ht-page" data-page="settings" hidden>
            <div class="ht-card">
              <div class="ht-card-hd"><span class="ht-card-title">招聘者活跃状态</span></div>
              <div class="ht-chips" data-chips="activeStatus"></div>
            </div>

            <div class="ht-card">
              <div class="ht-card-hd"><span class="ht-card-title">投递偏好</span></div>
              <label class="ht-row">
                <span>排除猎头职位</span>
                <span class="ht-toggle"><input type="checkbox" data-k="excludeHeadhunters" /><i></i></span>
              </label>
              <label class="ht-row">
                <span>操作间隔</span>
                <span class="ht-inline"><input type="number" class="ht-num" data-k="opDelaySec" min="1" max="60" /><em>秒</em></span>
              </label>
            </div>

            <div class="ht-card">
              <div class="ht-card-hd">
                <span class="ht-card-title">招呼语</span>
                <button class="ht-mini" data-act="add-greet">${svg('plus')}添加</button>
              </div>
              <div class="ht-hint ht-hint-block">首次与 HR 沟通时依次发送,建议 1~3 条、单条 100 字内。</div>
              <div data-greets></div>
            </div>

            <div class="ht-card">
              <div class="ht-card-hd">
                <span class="ht-card-title">聊天与简历</span>
              </div>

              <div class="ht-grp">
                <div class="ht-grp-hd">${svg('brush')}<span>沟通与简历</span></div>
                <label class="ht-row">
                  <span>首次沟通发送招呼语</span>
                  <span class="ht-toggle"><input type="checkbox" data-k="greetOnFirstChat" /><i></i></span>
                </label>
                <label class="ht-row">
                  <span>首次沟通后自动发附件简历</span>
                  <span class="ht-toggle"><input type="checkbox" data-k="autoSendResume" /><i></i></span>
                </label>
                <label class="ht-row">
                  <span>HR 提到「简历」时自动发简历</span>
                  <span class="ht-toggle"><input type="checkbox" data-k="replyWhenResumeAsked" /><i></i></span>
                </label>
              </div>

              <div class="ht-grp">
                <div class="ht-grp-hd">
                  ${svg('image')}<span>图片(图片简历 / 作品图)</span>
                  <span class="ht-sum" data-img-count></span>
                </div>
                <div class="ht-hint ht-hint-block">支持 png / jpg / jpeg / webp / gif,单张 ≤ 2MB,最多 ${IMG.maxCount} 张。<b>作为图片消息</b>发到聊天里,不是 BOSS 的附件简历。</div>
                <div class="ht-imgs" data-imgs></div>
                <input type="file" class="ht-file" data-img-input accept="${IMG.accept}" multiple />
                <button class="ht-ghost" data-act="pick-img">${svg('image')}<span>选择图片</span></button>
                <label class="ht-row">
                  <span>首次沟通后自动发送图片</span>
                  <span class="ht-toggle"><input type="checkbox" data-k="autoSendImage" /><i></i></span>
                </label>
                <label class="ht-row">
                  <span>HR 提到「简历」时发送图片</span>
                  <span class="ht-toggle"><input type="checkbox" data-k="sendImageOnResumeAsk" /><i></i></span>
                </label>
              </div>

              <button class="ht-primary ht-cta" data-act="chat">${svg('brush')}<span>开始聊天(聊天页)</span></button>
            </div>

            <div class="ht-card">
              <div class="ht-card-hd"><span class="ht-card-title">维护</span></div>
              <div class="ht-row-btns">
                <button class="ht-ghost" data-act="diag">诊断页面</button>
                <button class="ht-ghost" data-act="copy-diag">复制日志</button>
                <button class="ht-ghost ht-danger" data-act="clear">${svg('trash')}<span>清空记录</span></button>
              </div>
            </div>
          </section>
        </div>

        <nav class="ht-nav">
          <button class="ht-navbtn on" data-nav="home">${svg('home')}<span>首页</span></button>
          <button class="ht-navbtn" data-nav="data">${svg('chart')}<span>数据统计</span></button>
          <button class="ht-navbtn" data-nav="settings">${svg('sliders')}<span>设置</span></button>
        </nav>
      </div>`;

    document.documentElement.appendChild(panel);

    ui = {
      launcher: q('.ht-launcher', panel),
      body: q('.ht-body', panel),
      statusText: q('[data-status-text]', panel),
      pill: q('[data-status]', panel),
      start: q('[data-act="start"]', panel),
      pause: q('[data-act="pause"]', panel),
      stop: q('[data-act="stop"]', panel),
      sum: q('[data-sum]', panel),
      salaryText: q('[data-salary-text]', panel),
      salaryFill: q('[data-salary-fill]', panel),
      rngLo: q('.ht-rng-lo', panel),
      rngHi: q('.ht-rng-hi', panel),
      log: q('[data-log]', panel),
      records: q('[data-records]', panel),
      greets: q('[data-greets]', panel),
      bars: q('[data-bars]', panel),
      dist: q('[data-dist]', panel),
      imgs: q('[data-imgs]', panel),
      imgInput: q('[data-img-input]', panel),
      imgCount: q('[data-img-count]', panel)
    };

    ui.launcher.addEventListener('click', () => togglePanel(true));
    makeLauncherDraggable();
    q('.ht-min', panel).addEventListener('click', () => togglePanel(false));

    /* 主按钮 / 图标按钮 */
    panel.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.getAttribute('data-act');
      if (act) {
        if (act === 'start') startEngine('jobs');
        else if (act === 'chat') startEngine('chat');
        else if (act === 'pause') togglePause();
        else if (act === 'stop') stopEngine();
        else if (act === 'add-greet') addGreeting();
        else if (act === 'pick-img') { if (ui.imgInput) ui.imgInput.click(); }
        else if (act === 'diag') diagnose();
        else if (act === 'copy-diag') copyDiagLog();
        else if (act === 'clear') clearRecords();
        return;
      }
      const nav = e.target.closest('[data-nav]')?.getAttribute('data-nav');
      if (nav) jumpTo(nav);
    });

    /* 设置项(checkbox / number) */
    panel.addEventListener('change', onSettingChange);
    panel.addEventListener('input', onSettingInput);

    /* 城市下拉快捷添加 */
    const citySel = q('[data-city-select]', panel);
    if (citySel) citySel.addEventListener('change', () => {
      const v = citySel.value;
      citySel.value = '';
      if (!v) return;
      if (!settings.locationKeywords.includes(v)) {
        settings.locationKeywords.push(v);
        saveSettings(); renderTagEditor('locationKeywords'); renderFilterSummary();
      }
    });

    /* 标签输入(关键词 / 城市) */
    panel.addEventListener('keydown', (e) => {
      const input = e.target.closest('.ht-taginput');
      if (!input) return;
      if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === ' ') {
        e.preventDefault();
        commitTagInput(input);
      } else if (e.key === 'Backspace' && !input.value) {
        const key = input.getAttribute('data-tags');
        const arr = settings[key] || [];
        if (arr.length) { arr.pop(); saveSettings(); renderTagEditor(key); renderFilterSummary(); }
      }
    });
    panel.addEventListener('blur', (e) => {
      const input = e.target.closest ? e.target.closest('.ht-taginput') : null;
      if (input) commitTagInput(input);
    }, true);

    /* 薪资滑块 */
    if (ui.rngLo && ui.rngHi) {
      ui.rngLo.addEventListener('input', () => { onSalaryInput('lo'); });
      ui.rngHi.addEventListener('input', () => { onSalaryInput('hi'); });
    }

    /* 图片文件选择 */
    const fileInput = q('[data-img-input]', panel);
    if (fileInput) fileInput.addEventListener('change', () => handleImagePick(fileInput));

    applySavedPos();
    makeDraggable();
    renderHomeStats();
    renderStatus();
    renderButtons();
    renderTagEditor('includeKeywords');
    renderTagEditor('locationKeywords');
    renderSalary();
    renderChips();
    renderGreetings();
    renderImageList();
    renderRecords();
    renderFilterSummary();
    syncFormControls();
  }

  /* ---------- 拖动 / 位置记忆 ---------- */
  function applySavedPos() {
    try {
      const saved = window.__HT_POS__;
      if (saved && typeof saved.left === 'number') {
        panel.style.left = saved.left + 'px';
        panel.style.top = saved.top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
    } catch (e) { /* ignore */ }
  }
  function resetPos() {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '18px';
    panel.style.bottom = '18px';
    window.__HT_POS__ = null;
    try { chrome.storage.local.set({ ht_pos: null }); } catch (e) { /* ignore */ }
  }
  function makeDraggable() {
    const handle = q('.ht-top', panel);
    if (!handle) return;
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') || e.target.closest('.ht-pill')) return;
      const r = panel.getBoundingClientRect();
      dragging = true;
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      panel.style.left = r.left + 'px';
      panel.style.top = r.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      e.preventDefault();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    handle.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      resetPos();
    });

    function onMove(e) {
      if (!dragging) return;
      const w = panel.offsetWidth, h = panel.offsetHeight;
      let nl = ox + (e.clientX - sx);
      let nt = oy + (e.clientY - sy);
      nl = Math.max(4, Math.min(window.innerWidth - w - 4, nl));
      nt = Math.max(4, Math.min(window.innerHeight - h - 4, nt));
      panel.style.left = nl + 'px';
      panel.style.top = nt + 'px';
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const r = panel.getBoundingClientRect();
      const pos = { left: Math.round(r.left), top: Math.round(r.top) };
      window.__HT_POS__ = pos;
      try { chrome.storage.local.set({ ht_pos: pos }); } catch (e) { /* ignore */ }
    }
  }

  function makeLauncherDraggable() {
    const launcher = ui.launcher;
    if (!launcher) return;
    let dragging = false, moved = false;
    let sx = 0, sy = 0, ox = 0, oy = 0;

    launcher.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const r = panel.getBoundingClientRect();
      dragging = true;
      moved = false;
      sx = e.clientX; sy = e.clientY;
      ox = r.left; oy = r.top;
      panel.style.left = r.left + 'px';
      panel.style.top = r.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      e.preventDefault();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    launcher.addEventListener('dblclick', () => {
      resetPos();
    });

    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      const w = panel.offsetWidth, h = panel.offsetHeight;
      let nl = ox + dx, nt = oy + dy;
      nl = Math.max(4, Math.min(window.innerWidth - w - 4, nl));
      nt = Math.max(4, Math.min(window.innerHeight - h - 4, nt));
      panel.style.left = nl + 'px';
      panel.style.top = nt + 'px';
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const r = panel.getBoundingClientRect();
      const pos = { left: Math.round(r.left), top: Math.round(r.top) };
      window.__HT_POS__ = pos;
      try { chrome.storage.local.set({ ht_pos: pos }); } catch (e) { /* ignore */ }
      // 如果是拖拽，阻止后续 click 事件触发面板展开
      if (moved) {
        const cancelClick = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        launcher.addEventListener('click', cancelClick, true);
        setTimeout(() => launcher.removeEventListener('click', cancelClick, true), 0);
      }
    }
  }

  function togglePanel(open) {
    if (!panel) buildPanel();
    const collapsed = !open;
    panel.classList.toggle('ht-collapsed', collapsed);
    if (!collapsed) { renderRecords(); renderHomeStats(); renderFilterSummary(); syncFormControls(); }
  }

  /* ============================ 渲染 ============================ */
  function animateNumber(el, to) {
    if (!el) return;
    to = Math.max(0, Math.round(to));
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (from === to) { el.textContent = to; return; }
    const dur = 480, t0 = performance.now();
    function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function rate() {
    if (!stats.attempts) return 0;
    return Math.round((stats.total / stats.attempts) * 100);
  }
  function renderHomeStats() {
    if (!panel) return;
    animateNumber(q('[data-num="today"]', panel), state.todayCount);
    animateNumber(q('[data-num="total"]', panel), stats.total);
    animateNumber(q('[data-num="rate"]', panel), rate());
  }
  function renderDataPage() {
    if (!panel) return;
    animateNumber(q('[data-num="d-total"]', panel), stats.total);
    animateNumber(q('[data-num="d-today"]', panel), state.todayCount);
    animateNumber(q('[data-num="d-rate"]', panel), rate());

    /* 近 7 日柱状图 */
    if (ui.bars) {
      const days = [];
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        days.push({ key: d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(), n: 0, md: (d.getMonth() + 1) + '/' + d.getDate() });
      }
      const map = new Map(days.map((d) => [d.key, d]));
      records.forEach((r) => {
        const d = new Date(r.ts);
        const k = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
        const hit = map.get(k);
        if (hit) hit.n += 1;
      });
      const max = Math.max(1, ...days.map((d) => d.n));
      ui.bars.innerHTML = days.map((d) =>
        `<div class="ht-bar">
           <div class="ht-bar-col"><i style="height:${Math.round((d.n / max) * 100)}%"></i></div>
           <b>${d.n}</b><span>${d.md}</span>
         </div>`).join('');
    }

    /* 状态分布 */
    if (ui.dist) {
      const map = {};
      records.forEach((r) => { const k = r.status || '其他'; map[k] = (map[k] || 0) + 1; });
      const entries = Object.keys(map).map((k) => ({ k, n: map[k] })).sort((a, b) => b.n - a.n);
      if (!entries.length) {
        ui.dist.innerHTML = '<div class="ht-empty">暂无数据</div>';
      } else {
        const max = Math.max(1, ...entries.map((e) => e.n));
        ui.dist.innerHTML = entries.map((e) =>
          `<div class="ht-distrow">
             <span class="ht-distname">${esc(e.k)}</span>
             <span class="ht-distbar"><i style="width:${Math.round((e.n / max) * 100)}%"></i></span>
             <b>${e.n}</b>
           </div>`).join('');
      }
    }
  }
  function renderStatus() {
    if (!panel) return;
    const map = {
      idle: '待机', scanning: '加载中', applying: '投递中', paused: '已暂停',
      chatting: '沟通中', stopped: '已停止', error: '异常'
    };
    const label = state.paused ? '已暂停' : (map[state.phase] || state.phase);
    if (ui.statusText) ui.statusText.textContent = label;
    if (ui.pill) {
      ui.pill.className = 'ht-pill ht-pill-' +
        (state.paused ? 'paused' : (state.running ? 'running' : (state.phase === 'error' ? 'error' : 'idle')));
    }
    panel.classList.toggle('ht-running', !!state.running);
  }
  function renderButtons() {
    if (!panel) return;
    const running = state.running;
    if (ui.start) {
      ui.start.disabled = running;
      const sp = q('span', ui.start);
      if (sp) sp.textContent = running ? (state.mode === 'chat' ? '沟通进行中…' : '投递进行中…') : '一键开始投递';
      ui.start.classList.toggle('ht-busy', running);
    }
    if (ui.pause) {
      ui.pause.disabled = !running;
      ui.pause.innerHTML = state.paused ? svg('play') : svg('pause');
      ui.pause.title = state.paused ? '继续' : '暂停';
    }
    if (ui.stop) ui.stop.disabled = !running;
  }
  function renderFilterSummary() {
    if (!ui.sum) return;
    const n = (settings.includeKeywords.length ? 1 : 0) +
      (settings.locationKeywords.length ? 1 : 0) +
      (salaryUnlimited() ? 0 : 1) +
      (settings.companySizes.length ? 1 : 0) +
      ((settings.activeStatus.length && settings.activeStatus[0] !== '不限') ? 1 : 0) +
      (settings.excludeHeadhunters ? 1 : 0);
    ui.sum.textContent = n ? n + ' 项已设置' : '不限';
    ui.sum.classList.toggle('on', n > 0);
  }

  /* ---------- 标签编辑器 ---------- */
  function renderTagEditor(key) {
    if (!panel) return;
    const box = q(`[data-tags="${key}"]`, panel);
    if (!box) return;
    const arr = settings[key] || [];
    box.innerHTML = '';
    arr.forEach((v, i) => {
      const chip = document.createElement('span');
      chip.className = 'ht-tag';
      chip.innerHTML = `<span>${esc(v)}</span><button class="ht-tag-x" title="移除">×</button>`;
      q('.ht-tag-x', chip).addEventListener('click', () => {
        settings[key].splice(i, 1);
        saveSettings(); renderTagEditor(key); renderFilterSummary();
      });
      box.appendChild(chip);
    });
    const input = document.createElement('input');
    input.className = 'ht-taginput';
    input.setAttribute('data-tags', key);
    input.placeholder = arr.length ? '继续添加…' : (key === 'includeKeywords' ? '如:测试工程师 agent' : '如:杭州 长沙');
    box.appendChild(input);
  }
  function commitTagInput(input) {
    const key = input.getAttribute('data-tags');
    const parts = parseList(input.value);
    if (!parts.length) {
      if (input.value.trim() === '') return;
    }
    parts.forEach((p) => { if (!settings[key].includes(p)) settings[key].push(p); });
    input.value = '';
    saveSettings();
    renderTagEditor(key);
    renderFilterSummary();
  }

  /* ---------- 多选 chips(活跃状态 / 公司规模) ---------- */
  function renderChips() {
    if (!panel) return;
    qa('.ht-chips[data-chips]', panel).forEach((box) => {
      const key = box.getAttribute('data-chips');
      const list = key === 'activeStatus' ? ACTIVE_STATUS : COMPANY_SIZES;
      const cur = settings[key] || [];
      box.innerHTML = '';
      list.forEach((s) => {
        const b = document.createElement('button');
        b.className = 'ht-chip' + (cur.includes(s) ? ' on' : '');
        b.textContent = s;
        b.addEventListener('click', () => {
          if (key === 'activeStatus') {
            if (s === '不限') settings.activeStatus = ['不限'];
            else {
              settings.activeStatus = settings.activeStatus.filter((x) => x !== '不限');
              if (settings.activeStatus.includes(s)) settings.activeStatus = settings.activeStatus.filter((x) => x !== s);
              else settings.activeStatus.push(s);
              if (!settings.activeStatus.length) settings.activeStatus = ['不限'];
            }
          } else {
            const a = settings.companySizes;
            const i = a.indexOf(s);
            if (i >= 0) a.splice(i, 1); else a.push(s);
          }
          saveSettings(); renderChips(); renderFilterSummary();
        });
        box.appendChild(b);
      });
    });
  }

  /* ---------- 薪资滑块 ---------- */
  function salaryUnlimited() {
    return settings.salaryMin <= SALARY.min && settings.salaryMax >= SALARY.max;
  }
  function renderSalary() {
    if (!panel || !ui.rngLo) return;
    ui.rngLo.value = settings.salaryMin;
    ui.rngHi.value = settings.salaryMax;
    // 两个 input 完全重叠、只有滑块本身可点(pointer-events),所以重叠时只有 z-index 高的那个抓得住。
    // 不重叠 → hi 在上,互不影响;一旦重叠 → 把 lo 抬到最上层,保证永远至少有一个能拖,不会卡死。
    const sameSpot = settings.salaryMin >= settings.salaryMax;
    ui.rngLo.style.zIndex = sameSpot ? 5 : 3;
    if (ui.rngHi) ui.rngHi.style.zIndex = 4;
    const span = SALARY.max - SALARY.min || 1;
    const l = ((settings.salaryMin - SALARY.min) / span) * 100;
    const r = ((settings.salaryMax - SALARY.min) / span) * 100;
    if (ui.salaryFill) { ui.salaryFill.style.left = l + '%'; ui.salaryFill.style.right = (100 - r) + '%'; }
    if (ui.salaryText) {
      ui.salaryText.textContent = salaryUnlimited()
        ? '不限'
        : (settings.salaryMin + 'K — ' + (settings.salaryMax >= SALARY.max ? SALARY.max + 'K+' : settings.salaryMax + 'K'));
    }
  }
  function onSalaryInput(which) {
    let lo = Number(ui.rngLo.value);
    let hi = Number(ui.rngHi.value);
    if (lo > hi) { if (which === 'lo') hi = lo; else lo = hi; }
    settings.salaryMin = lo;
    settings.salaryMax = hi;
    saveSettings(); renderSalary(); renderFilterSummary();
  }

  /* ---------- 表单同步(设置页) ---------- */
  function syncFormControls() {
    if (!panel) return;
    qa('input[type=checkbox][data-k]', panel).forEach((el) => {
      el.checked = !!settings[el.getAttribute('data-k')];
    });
    const opSec = q('input[data-k="opDelaySec"]', panel);
    if (opSec) opSec.value = Math.round((settings.opDelay || 1200) / 1000);
    renderSalary();
  }
  function onSettingInput(e) {
    const el = e.target;
    if (!el.hasAttribute || !el.hasAttribute('data-k')) return;
    if (el.getAttribute('data-k') === 'opDelaySec') {
      settings.opDelay = Math.max(1, Number(el.value) || 1) * 1000;
      saveSettings();
    }
  }
  function onSettingChange(e) {
    const el = e.target;
    if (!el.hasAttribute || !el.hasAttribute('data-k')) return;
    const k = el.getAttribute('data-k');
    if (el.type === 'checkbox') { settings[k] = el.checked; saveSettings(); renderFilterSummary(); }
    else if (k === 'opDelaySec') { settings.opDelay = Math.max(1, Number(el.value) || 1) * 1000; saveSettings(); }
  }

  /* ---------- 招呼语 ---------- */
  function renderGreetings() {
    if (!panel || !ui.greets) return;
    ui.greets.innerHTML = '';
    if (!settings.greetings.length) {
      ui.greets.innerHTML = '<div class="ht-empty">还没有招呼语,点右上角「添加」</div>';
      return;
    }
    settings.greetings.forEach((g, i) => {
      const row = document.createElement('div');
      row.className = 'ht-greet';
      row.innerHTML = `<textarea class="ht-ta" rows="2" placeholder="例如:您好,我对这个岗位很感兴趣…"></textarea>
        <button class="ht-greet-x" title="删除">${svg('trash')}</button>`;
      const ta = q('textarea', row);
      ta.value = g;
      ta.addEventListener('input', () => { settings.greetings[i] = ta.value; saveSettings(); });
      q('.ht-greet-x', row).addEventListener('click', () => {
        settings.greetings.splice(i, 1); saveSettings(); renderGreetings();
      });
      ui.greets.appendChild(row);
    });
  }
  function addGreeting() {
    settings.greetings.push('');
    saveSettings();
    renderGreetings();
    jumpTo('settings');
  }

  /* ---------- 图片 ---------- */
  function renderImageList() {
    if (!panel || !ui.imgs) return;
    const list = settings.imageFiles || [];
    ui.imgs.innerHTML = '';
    if (!list.length) {
      ui.imgs.innerHTML = '<div class="ht-empty">还没有图片</div>';
    } else {
      list.forEach((f, i) => {
        const d = document.createElement('div');
        d.className = 'ht-img';
        d.innerHTML = '<img alt="" /><button class="ht-img-x" title="删除">×</button>';
        const im = q('img', d);
        im.src = f.dataUrl;
        im.title = f.name + ' · ' + Math.round((f.size || 0) / 1024) + ' KB';
        q('.ht-img-x', d).addEventListener('click', () => {
          settings.imageFiles.splice(i, 1);
          saveSettings(); renderImageList();
        });
        ui.imgs.appendChild(d);
      });
    }
    if (ui.imgCount) ui.imgCount.textContent = list.length ? list.length + ' / ' + IMG.maxCount + ' 张' : '未添加';
    const btn = q('[data-act="pick-img"]', panel);
    if (btn) btn.disabled = list.length >= IMG.maxCount;
  }
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('读取失败'));
      r.readAsDataURL(file);
    });
  }
  async function handleImagePick(input) {
    const picked = Array.from(input.files || []);
    input.value = '';
    if (!picked.length) return;
    const list = settings.imageFiles || (settings.imageFiles = []);
    for (const f of picked) {
      if (list.length >= IMG.maxCount) { log('最多 ' + IMG.maxCount + ' 张,已忽略「' + f.name + '」'); break; }
      const typeOk = !IMG.types.length || IMG.types.includes(f.type);
      if (!typeOk) { log('不支持的格式:' + f.name + '(' + (f.type || '未知') + ')'); continue; }
      if (f.size > IMG.maxBytes) { log('「' + f.name + '」超过 ' + Math.round(IMG.maxBytes / 1024 / 1024) + 'MB,已忽略'); continue; }
      try {
        const dataUrl = await readAsDataUrl(f);
        list.push({ name: f.name, type: f.type, size: f.size, dataUrl });
      } catch (e) { log('读取图片失败:' + f.name); }
    }
    saveSettings();
    renderImageList();
  }

  /* dataURL → File,用于注入 <input type=file> */
  function dataUrlToFile(dataUrl, name, type) {
    const comma = dataUrl.indexOf(',');
    const meta = dataUrl.slice(0, comma);
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || type || 'image/png';
    const bin = atob(dataUrl.slice(comma + 1));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], name || ('image.' + (mime.split('/')[1] || 'png')), { type: mime });
  }

  /* 找图片上传入口
   * 策略:先定位聊天工具栏容器(稳定锚点)→ 在容器内找 input[type=file]
   *      → 优先 accept 含 image 的 → 其次容器内任意 input → 全局兜底
   * 一次命中即返回,不再继续 fallback,避免选中更远的错误元素 */
  function findImageInput() {
    // 1. 定位聊天工具栏容器(稳定锚点)
    const toolbar = q(SEL.CHAT_OP_BOX);
    if (toolbar) {
      const inputs = qa(SEL.FILE_INPUT, toolbar);
      // 1a. 容器内 accept 含 image 的(最高优先级)
      let hit = inputs.find((i) => /image/i.test(i.getAttribute('accept') || ''));
      if (hit) return hit;
      // 1b. 容器内任意 file input(次优先级)
      if (inputs.length) return inputs[0];
    }

    // 2. 全局搜索(兜底)
    const inputs = qa(SEL.FILE_INPUT);
    if (!inputs.length) return null;
    // 2a. accept 含 image 的
    let hit = inputs.find((i) => /image/i.test(i.getAttribute('accept') || ''));
    if (hit) return hit;
    // 2b. 只有一个时直接用
    if (inputs.length === 1) return inputs[0];
    // 2c. 多个时取可见的
    hit = inputs.find(visible);
    if (hit) return hit;
    return null;
  }

  /* 尝试点击工具栏中的图片按钮,触发隐藏的 file input 出现 */
  function tryClickImageButton() {
    const btns = qa(SEL.TOOLBAR_BTN + ', .chat-op button, .im-toolbar button, [class*="image"], [class*="img"]');
    for (const btn of btns) {
      if (!visible(btn)) continue;
      const t = txt(btn).toLowerCase();
      const aria = (btn.getAttribute('aria-label') || btn.getAttribute('title') || '').toLowerCase();
      if (/图片|照片|image|img|相册|上传/.test(t) || /图片|照片|image|img|相册/.test(aria)) {
        simulateClick(btn);
        return true;
      }
    }
    return false;
  }

  function injectFileTo(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function dropFileTo(el, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    const base = { bubbles: true, cancelable: true, dataTransfer: dt };
    el.dispatchEvent(new DragEvent('dragenter', base));
    el.dispatchEvent(new DragEvent('dragover', base));
    el.dispatchEvent(new DragEvent('drop', base));
  }

  async function sendImage() {
    const list = settings.imageFiles || [];
    if (!list.length) { log('未配置图片(设置 → 图片)'); return false; }
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      if (stopFlag || !state.running) break;
      await whilePaused();
      const f = list[i];
      log('发送图片 ' + (i + 1) + '/' + list.length + ' · ' + f.name);
      let file;
      try { file = dataUrlToFile(f.dataUrl, f.name, f.type); }
      catch (e) { log('图片解码失败:' + f.name); continue; }

      let injected = false;
      // 先尝试直接找 input
      let input = await waitFor(() => findImageInput(), 3000);
      // 找不到时,尝试点击工具栏图片按钮触发隐藏 input 出现
      if (!input) {
        if (tryClickImageButton()) {
          log('已点击工具栏图片按钮,等待上传框出现…');
          input = await waitFor(() => findImageInput(), 4000);
        }
      }
      if (input) {
        try { injectFileTo(input, file); injected = true; }
        catch (e) { log('注入图片失败:' + (e && e.message)); }
      }
      if (!injected) {
        const area = q(SEL.INPUT) || q(SEL.CHAT_OP_BOX);
        if (area) { try { dropFileTo(area, file); injected = true; } catch (e) { /* ignore */ } }
      }
      if (!injected) { log('未找到图片上传入口,可在设置页点「诊断页面」查看'); return false; }

      await sleep(1000);
      const sendBtn = q(SEL.SEND_BTN);
      if (sendBtn) { simulateClick(sendBtn); await sleep(settings.opDelay); }
      ok++;
      await sleep(Math.max(800, settings.opDelay / 2));
    }
    if (ok) log('已发送 ' + ok + ' 张图片');
    return ok > 0;
  }

  /* ---------- 日志 / 记录 ---------- */
  let logCount = 0;
  function log(msg) {
    if (!panel || !ui.log) return;
    const t = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const line = document.createElement('div');
    line.className = 'ht-line';
    line.textContent = `[${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}] ${msg}`;
    ui.log.appendChild(line);
    while (ui.log.childElementCount > 200) ui.log.removeChild(ui.log.firstChild);
    ui.log.scrollTop = ui.log.scrollHeight;
    logCount++;
  }

  /* 一键复制运行日志 —— 报障时直接粘贴给开发者,不用截图 */
  async function copyDiagLog() {
    if (!ui.log) return;
    const text = Array.from(ui.log.children).map((d) => d.textContent).join('\n');
    if (!text.trim()) { log('日志还是空的,先点「诊断页面」。'); return; }
    let done = false;
    try { await navigator.clipboard.writeText(text); done = true; } catch (e) { /* 权限被拒 → 走兜底 */ }
    if (!done) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        done = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) { /* ignore */ }
    }
    log(done
      ? `已复制 ${text.split('\n').length} 行日志到剪贴板,直接粘贴即可。`
      : '复制失败(剪贴板被拒),请手动选中日志内容复制。');
  }
  function renderRecords() {
    if (!panel || !ui.records) return;
    ui.records.innerHTML = '';
    const recent = records.slice(-40).reverse();
    if (!recent.length) {
      ui.records.innerHTML = '<div class="ht-empty">暂无投递记录</div>';
      return;
    }
    const p = (n) => String(n).padStart(2, '0');
    recent.forEach((r) => {
      const t = new Date(r.ts);
      const ok = /沟通|招呼|简历|成功/.test(r.status || '');
      const d = document.createElement('div');
      d.className = 'ht-rec';
      d.innerHTML = `
        <span class="ht-rec-ic${ok ? ' ok' : ''}">${svg(ok ? 'check' : 'clock')}</span>
        <span class="ht-rec-main">
          <b>${esc(r.company || r.job || '—')}</b>
          <i>${esc(r.job || '')}${r.company && r.job ? '' : ''}</i>
        </span>
        <span class="ht-rec-time">${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}</span>`;
      ui.records.appendChild(d);
    });
  }
  async function clearRecords() {
    records = [];
    stats = { total: 0, attempts: 0 };
    await chrome.storage.local.set({ [K.records]: [], [K.stats]: stats });
    renderRecords(); renderHomeStats(); renderDataPage();
    log('已清空记录');
  }

  /* ============================ 投递引擎 ============================ */
  let stopFlag = false;

  function isJobsPage() { return location.pathname.includes('/web/geek/job'); }
  function isChatPage() { return location.pathname.includes('/chat'); }

  async function startEngine(mode) {
    if (state.running) { log('已在运行中'); return; }
    if (mode === 'jobs' && !isJobsPage()) {
      sessionStorage.setItem('ht_pending', 'jobs');
      location.href = 'https://www.zhipin.com/web/geek/jobs';
      return;
    }
    if (mode === 'chat' && !isChatPage()) {
      sessionStorage.setItem('ht_pending', 'chat');
      location.href = 'https://www.zhipin.com/web/geek/chat';
      return;
    }
    state.running = true;
    state.paused = false;
    state.runCount = 0;
    state.mode = mode;
    stopFlag = false;
    renderButtons();
    jumpTo('home');
    if (mode === 'jobs') runJobs();
    else runChat();
  }
  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
    setPhase(state.paused ? 'paused' : state.phase, state.paused ? '已暂停' : '继续运行');
    log(state.paused ? '⏸ 已暂停' : '▶ 继续');
    renderButtons();
  }
  function stopEngine() {
    state.running = false;
    state.paused = false;
    stopFlag = true;
    setPhase('stopped', '已停止');
    log('已停止');
    renderButtons();
  }
  async function whilePaused() {
    while (state.paused && !stopFlag) { renderStatus(); await sleep(200); }
  }

  // 候选选择器:同时兼容「推荐职位页」与「搜索结果页」
  const CARD_CANDIDATES = [
    'li.job-card-box',                          // 推荐页
    'li.job-card-wrapper',                      // 搜索页
    '.job-list-box .job-card-wrapper',
    '.job-list-container .job-card-wrapper',
    '.job-list-wrapper .job-card-wrapper',
    '.rec-job-list .job-card-wrapper',
    '.job-card-box',
    '.job-card-wrapper'
  ];
  const LIST_CANDIDATES = ['.job-list-container', '.job-list-box', '.rec-job-list', '.job-list-wrapper', '.job-list'];

  function getListEl() {
    for (const s of LIST_CANDIDATES) { const el = q(s); if (el) return el; }
    return null;
  }
  function getCards() {
    let best = [], bestSel = '';
    for (const s of CARD_CANDIDATES) {
      const n = qa(s);
      if (n.length > best.length) { best = n; bestSel = s; }
    }
    // 兜底:从 .job-name 向上找所属卡片(应对改版,卡片可能是 li 也可能是 div)
    if (!best.length) {
      const seen = new Set();
      const arr = [];
      qa('.job-name').forEach((nm) => {
        let el = nm;
        for (let i = 0; i < 6 && el; i++) {
          const cls = el.getAttribute ? (el.getAttribute('class') || '') : '';
          if (/job-card|card-wrapper|card-box|job-item/i.test(cls)) {
            if (!seen.has(el)) { seen.add(el); arr.push(el); }
            break;
          }
          el = el.parentElement;
        }
      });
      if (arr.length) { best = arr; bestSel = '.job-name→卡片'; }
    }
    return { cards: best, selector: bestSel };
  }
  function findCardButton(card) {
    return card.querySelector('a.op-btn-chat, .op-btn-chat, button.op-btn-chat, .btn-startchat, .startchat-btn');
  }

  async function autoScrollJobList() {
    setPhase('scanning', '加载岗位上…');
    const listEl = getListEl();
    let history = [];
    for (let i = 0; i < 60; i++) {
      if (stopFlag) return;
      await whilePaused();
      if (listEl) listEl.scrollTop = listEl.scrollHeight;
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      await sleep(settings.scrollWait || 1000);
      const n = getCards().cards.length;
      history.push(n);
      if (history.length > 3) history.shift();
      if (history.length === 3 && new Set(history).size === 1) break;
    }
  }

  /* ---------- 薪资解析 ----------
   * 从职位卡片解析月薪区间(单位 K);解析不到返回 null。
   * 「解析不到怎么办」由 collectJobList 统一决定(现行策略:跳过),解析层只负责产出结构。
   *
   * 支持:15-25K / 15K-25K / 15-25千 / 15-25K·13薪 / 1.5-2.5万 / 20万-40万/年
   *      15K以上 / 15K+ / 15K / 8000-12000元/月 / 150-200元/天
   */

  // 候选元素:按「优先级顺序」逐个试。
  // ⚠️ 不能写成 q('.salary, .red, ...') —— querySelector 的多选择器返回的是「文档序第一个匹配」,
  //    而不是「列表里第一个命中的选择器」。一旦卡片里出现 .red 这类通用类名且位置靠前,
  //    拿到的就是与薪资无关的文本,整条薪资筛选随之失效。
  const SALARY_ELS = [
    '.salary',
    '.job-salary',
    '.job-card-right .salary',
    '.job-salary-info',
    '.job-card-salary',
    '.job-limit .red',
    '.red'
  ];
  // 「像不像薪资」的快速判断
  const LOOKS_LIKE_SALARY = /[\d.]\s*(?:K|k|千|万|元)/;
  // 整卡兜底:从任意长文本里抠出最像薪资的一段(不再截前 120 字,避免薪资排在卡片后半段时被截掉)
  const SALARY_SNIPPET =
    /[\d.]+\s*(?:K|k|千|万)?\s*[-–—~～至]\s*[\d.]+\s*(?:K|k|千|万|元)[^\s]{0,4}|[\d.]+\s*(?:K|k|千|万|元)\s*(?:以上|起|满|\+|＋)?(?:[/／每]\s*(?:月|年|天|时|周))?/;
  // 「薪资骨架」:数字被字体混淆抹掉后,剩下的 - / K / 千 / 万 / 元 还在,用这个兜住
  const SALARY_SKELETON = /.{0,14}[-–—~～至]\s*.{0,14}[Kk千万円]|.{0,6}(?:K|k|千|万)\s*(?:以上|起|\+)/;

  /* 明文薪资也可能放在属性里 —— 这是对抗字体混淆的关键退路 */
  const SALARY_ATTRS = ['title', 'data-salary', 'data-salary-desc', 'data-value', 'aria-label', 'alt'];
  function salaryFromAttrs(el) {
    if (!el || !el.getAttribute) return '';
    for (let i = 0; i < SALARY_ATTRS.length; i++) {
      const v = el.getAttribute(SALARY_ATTRS[i]);
      if (v && LOOKS_LIKE_SALARY.test(v)) return v.trim();
    }
    return '';
  }

  /* 把文本转成「可读码点」:正常能看见的字符(含中文)原样保留,
   * 只把不可见字符(控制符 / 私用区)显示成 {码点}。
   * 字体反爬会把数字换成私用区(PUA)码位,肉眼不可见 —— 这样一打就现形 */
  function codePoints(s, max) {
    return Array.from(String(s || '')).slice(0, max || 40).map((c) => {
      const cp = c.codePointAt(0);
      const invisible = cp < 32 || cp === 127 || (cp >= PUA_MIN && cp <= PUA_MAX);
      return invisible ? '{' + cp.toString(16).toUpperCase() + '}' : c;
    }).join('');
  }

  /* 找「像薪资骨架」的节点 —— 不看数字,只看 - K / 千 / 万 这些残迹
   * 用于:数字被字体混淆抹掉时,定位到薪资节点,再看它的属性有没有明文 */
  function salarySkeletonNodes(root, limit) {
    const out = [];
    if (!root || !root.querySelectorAll) return out;
    const nodes = root.querySelectorAll('*');
    for (let i = 0; i < nodes.length && out.length < (limit || 3); i++) {
      const el = nodes[i];
      if (el.children.length > 2) continue;
      const t = txt(el);
      if (!t || t.length > 24) continue;
      if (SALARY_SKELETON.test(t) && !/\d\s*[-–—]\s*\d/.test(t)) out.push(el);
    }
    return out;
  }

  /* ---------- 字体反爬(PUA)解密 ----------
   * BOSS 把薪资里的数字 0-9 换成 Unicode 私用区(PUA)码位,再用自定义字体渲染回数字。
   * 页面看着是「15-25K」,textContent 却是不可见字符 —— 这就是薪资一直读不到的真正原因
   * (同一张卡里「1-3年」是普通文本,所以那些数字是正常的)。
   *
   * 已知规律:一组连续的 PUA 码位按顺序对应 0-9(如 U+E031→0 … U+E03A→9),
   * 但字体文件是动态生成的,起始码位会变 —— 写死会某天静默算错(把 8K 当 20K 投出去),
   * 所以不写死,而是「就地标定」:
   *   ① 只从薪资节点采样(绝不扫全页:图标字体同样占私用区,会把观察集撑爆)
   *   ② 枚举候选起始码位(任一已观测码位都可能对应 0-9 → base = 码位 - d)
   *   ③ 逐一打分:解出来得像「正经薪资」才算分(有残留/前导 0/数字越界都扣分)
   *   ④ 取分最高者;同分时优先「不假设有更小数字缺失」的那个
   * 任何一步不通过就停用解密并明确告知 —— 宁可报错,也不能把 8K 当 20K 投出去。
   */
  const PUA = { ready: false, base: 0, span: 0, note: '未标定', seen: 0, samples: 0 };
  const PUA_MIN = 0xE000;
  const PUA_MAX = 0xF8FF;
  // 已知锚点:多个公开分析里 BOSS 把数字 0 放在 U+E031。字体可能重新生成,所以只当「优先候选」而非硬编码
  const PUA_ANCHOR = 0xE031;

  function isPuaChar(ch) {
    const cp = ch.codePointAt(0);
    return cp >= PUA_MIN && cp <= PUA_MAX;
  }
  function hasPuaChar(text) {
    return Array.from(String(text || '')).some(isPuaChar);
  }
  // 用指定 base 解码(不读全局状态,供标定阶段逐一打分)
  function puaDecodeWith(base, text) {
    return Array.from(String(text || '')).map((ch) => {
      const cp = ch.codePointAt(0);
      if (cp < PUA_MIN || cp > PUA_MAX) return ch;
      const d = cp - base;
      return d >= 0 && d <= 9 ? String(d) : ch;
    }).join('');
  }
  // 把文本里的 PUA 字符还原成数字(未标定时原样返回)
  function puaDecode(text) {
    if (!PUA.ready) return text;
    return puaDecodeWith(PUA.base, text);
  }
  // 解出来的薪资不该有前导 0(「04K」不合法),出现即说明标定偏了
  function hasLeadingZero(text) {
    return /(?:^|[^\d])0\d/.test(String(text || ''));
  }

  /* 采样:只从「薪资节点」取样本,绝不扫全页 ——
   * 图标字体同样占用私用区(U+E600 一带),一旦扫全页就会把图标码位混进来,
   * 观察集合被撑大 → 标定窗口失效。薪资节点是干净的。 */
  function puaSamplesFromCards(cards) {
    const out = [];
    const push = (t) => { if (t && t.length <= 40) out.push(t); };
    (cards || []).slice(0, 60).forEach((c) => {
      for (let i = 0; i < SALARY_ELS.length; i++) {
        const el = q(SALARY_ELS[i], c);
        if (el) push(txt(el));
      }
      salarySkeletonNodes(c, 2).forEach((el) => push(txt(el)));
    });
    return out;
  }

  /* 给候选 base 打分:解出来的文本越像「正经薪资」得分越高。
   * 两条硬约束(缺一不可):
   *   ① 混在薪资节点里的 PUA 字符必须被「全部」解掉 —— 解一半会残留,
   *      而残留文本里的一小段(比如「-1K」)照样能被薪资正则抠出来,造成假阳性。
   *      所以只要有残留,这条样本直接不计分。
   *   ② 解出来的数字必须落在正常月薪区间,且不能有前导 0(「04K」不合法)。 */
  function puaScore(base, samples) {
    let score = 0;
    for (let i = 0; i < samples.length; i++) {
      const raw = samples[i];
      // 不像薪资的样本(图标字、面议、1000-9999人)不参与打分,也不扣分
      if (!/[Kk千万元円]/.test(raw)) continue;
      const dec = puaDecodeWith(base, raw);
      if (hasPuaChar(dec)) continue;                 // 有残留 → 这个 base 不对
      if (!/\d/.test(dec)) continue;                 // 原本就没数字(如「- K」)
      const m = dec.match(SALARY_SNIPPET);
      if (!m) { score -= 1; continue; }
      const s = m[0];
      if (hasLeadingZero(s)) { score -= 2; continue; }        // 「04K」不合法
      const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
      if (!nums.length || nums.some((n) => !(n > 0 && n <= 500))) { score -= 2; continue; }
      score += 1;
    }
    return score;
  }

  function puaCalibrate(samples) {
    const list = (samples || []).filter((s) => typeof s === 'string' && s);
    PUA.samples = list.length;
    const set = new Set();
    list.forEach((t) => {
      Array.from(t).forEach((ch) => { if (isPuaChar(ch)) set.add(ch.codePointAt(0)); });
    });
    PUA.seen = set.size;
    if (!set.size) {
      PUA.ready = false; PUA.span = 0;
      PUA.note = '薪资节点里没有 PUA 字符 —— 页面可能没启用字体反爬(那薪资读不到就是别的原因)';
      return;
    }
    const cps = Array.from(set).sort((a, b) => a - b);
    PUA.span = cps[cps.length - 1] - cps[0];
    const hex = (n) => 'U+' + n.toString(16).toUpperCase();

    // 候选 base:任一已观测码位都可能对应数字 0-9 → base = 码位 - d
    const cands = new Set([PUA_ANCHOR]);
    cps.forEach((cp) => {
      for (let d = 0; d <= 9; d++) {
        const b = cp - d;
        if (b >= PUA_MIN && b + 9 <= PUA_MAX) cands.add(b);
      }
    });

    let best = null;
    Array.from(cands).forEach((b) => {
      const sc = puaScore(b, list);
      const cover = cps.filter((cp) => cp >= b && cp <= b + 9).length;  // 能落进 0-9 的已观测码位数
      // 偏移惩罚:base 比「最小已观测码位」低多少,就意味着假设「页面上有几个更小的数字没出现」。
      // 这个假设越激进越可疑 —— 同分时优先「不假设缺失」的那个 base。
      const offset = Math.max(0, cps[0] - b);
      const isMin = b === cps[0] ? 1 : 0;
      const key = sc * 1000000 - offset * 10000 + cover * 100 + isMin * 50 + (b === PUA_ANCHOR ? 1 : 0);
      if (!best || key > best.key) best = { key: key, base: b, score: sc, cover: cover, offset: offset };
    });

    if (!best || best.score <= 0) {
      PUA.ready = false;
      PUA.note = `检测到 ${cps.length} 种 PUA 码位(跨度 ${PUA.span + 1}),但没有任何一种映射能解出合理薪资 —— 已停用解密,避免把薪资算错。`;
      return;
    }
    PUA.ready = true;
    PUA.base = best.base;
    PUA.note = `顺序映射已启用:数字 0 = ${hex(best.base)} … 9 = ${hex(best.base + 9)}` +
      `(已观测 ${cps.length} 种,命中 ${best.cover} 种,校验通过 ${best.score} 条)`;
  }

  /* 在 root 子树里找薪资文本。四级递进,越靠后越不依赖 class 名:
   *   ① 已知选择器(按优先级逐个试)         —— 常规情况
   *   ② 单次遍历子树:先看属性、再看文本     —— 类名改版 / 数字混淆都能兜
   *   ③ 整个 root 的文本里抠一段
   */
  /* 在 root 子树里找薪资文本。三级递进,越靠后越不依赖 class 名:
   *   ① 已知选择器(按优先级逐个试,命中且内容像薪资才采用)
   *   ② 单次遍历子树:先看属性明文、再看文本 —— 类名改版 / 数字混淆都能兜
   *   ③ 整个 root 的文本里抠一段
   */
  function findSalaryIn(root) {
    if (!root) return '';

    // ① 已知选择器
    for (let i = 0; i < SALARY_ELS.length; i++) {
      const el = q(SALARY_ELS[i], root);
      if (!el) continue;
      const t = puaDecode(txt(el));           // 字体反爬:先把 PUA 数字还原
      if (t && LOOKS_LIKE_SALARY.test(t)) return t;
      const av = salaryFromAttrs(el);          // 有些页面把明文放在 title / data-* 上
      if (av) return av;
    }

    // ② 单次遍历子树:属性优先(能救字体混淆),再退到文本
    const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
    const limit = Math.min(nodes.length, 600);
    for (let i = 0; i < limit; i++) {
      const el = nodes[i];
      if (el.children.length > 3) continue;    // 只看叶子附近,避免扫到整块容器

      // 2a 属性里的明文(对抗字体反爬:数字被换成 PUA 时,属性往往还是明文)
      const av = salaryFromAttrs(el);
      if (av) return av;

      // 2b 文本(同样先解 PUA)
      const t = puaDecode(txt(el));
      if (!t || t.length > 24 || !LOOKS_LIKE_SALARY.test(t)) continue;
      const m = t.match(SALARY_SNIPPET);
      if (m) return m[0];
    }

    // ③ 整个 root 的文本
    const m = puaDecode(txt(root)).match(SALARY_SNIPPET);
    return m ? m[0] : '';
  }

  function salaryRawText(card) {
    return findSalaryIn(card);
  }

  /* BOSS 的卡片结构会把「职位名 + 薪资」拆到不同兄弟节点里,
   * 而 getCards() 命中的可能只是其中一半(例如只有标题块)。
   * 这里向上冒泡补齐:只要父节点 ① 仍只含一个职位名 ② 能读到薪资,就采用父节点。 */
  function widenCard(el) {
    let cur = el;
    for (let i = 0; i < 3; i++) {
      if (findSalaryIn(cur)) return cur;
      const p = cur.parentElement;
      if (!p || p === document.body || p === document.documentElement) return cur;
      if (p.querySelectorAll(SEL.CARD_TITLE).length !== 1) return cur;
      cur = p;
    }
    return cur;
  }

  // 单位 → K 的倍数
  const SALARY_UNIT_K = { K: 1, k: 1, '千': 1, '万': 10, '元': 0.001 };
  // 周期 → 折算到「月」的系数(先把周期金额换算成月金额,再乘单位倍数)
  const SALARY_PERIOD = { '月': 1, '年': 1 / 12, '周': 4.345, '天': 21.75, '时': 174 };

  function salaryToK(num, unit, period) {
    const u = SALARY_UNIT_K[unit] == null ? 1 : SALARY_UNIT_K[unit];
    const p = SALARY_PERIOD[period] == null ? 1 : SALARY_PERIOD[period];
    return Math.round(num * u * p * 10) / 10;
  }

  function parseSalary(card) {
    const raw = salaryRawText(card);
    if (!raw) return null;

    // 归一化:统一横线 / 波浪号 / 斜杠,压缩空格,统一同义字
    const s = raw
      .replace(/[–—―−]/g, '-')
      .replace(/[～~≈]/g, '-')
      .replace(/[／]/g, '/')
      .replace(/\s+/g, ' ')
      .replace(/[kｋ]/g, 'K')
      .replace(/[仟]/g, '千')
      .replace(/[萬]/g, '万')
      .replace(/[圆]/g, '元')
      .trim();

    // 模式1:区间 15-25K / 15K-25K / 1.5-2.5万 / 20万-40万/年 / 8000-12000元/月
    // 第一个数字后的单位可省略,第二个数字后必须有单位
    const rangeRe = /(\d+(?:\.\d+)?)\s*(?:K|千|万|元)?\s*-\s*(\d+(?:\.\d+)?)\s*(K|千|万|元)\s*(?:\/\s*)?(月|年|天|时|周)?/;
    const r = s.match(rangeRe);
    if (r) {
      const lo = salaryToK(parseFloat(r[1]), r[3], r[4]);
      const hi = salaryToK(parseFloat(r[2]), r[3], r[4]);
      return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
    }

    // 模式2:上限开放 15K以上 / 15K+ / 1.5万起
    const aboveRe = /(\d+(?:\.\d+)?)\s*(K|千|万|元)\s*(?:以上|起|满|\+|＋)/;
    const a = s.match(aboveRe);
    if (a) return { min: salaryToK(parseFloat(a[1]), a[2], ''), max: 9999 };

    // 模式3:单值 15K / 1.5万 / 8000元
    const oneRe = /(\d+(?:\.\d+)?)\s*(K|千|万|元)\s*(?:\/\s*)?(月|年|天|时|周)?/;
    const o = s.match(oneRe);
    if (o) {
      const v = salaryToK(parseFloat(o[1]), o[2], o[3]);
      return { min: v, max: v };
    }

    return null;
  }
  function parseCompanySize(card) {
    const t = txt(card);
    return COMPANY_SIZES.find((s) => t.includes(s)) || '';
  }

  function cardFields(card) {
    const title = txt(q(SEL.CARD_TITLE, card) || q('.job-title, .title', card));
    const addr = txt(q(SEL.CARD_ADDR, card) || q('.company-location, .job-area', card));
    const company = txt(q('.company-name, .company-info .name', card));
    const hh = q(SEL.CARD_HEADHUNTER, card);
    const hhAlt = hh ? (hh.getAttribute('alt') || '') : '';
    return { title, addr, company, hhAlt, salary: parseSalary(card), size: parseCompanySize(card) };
  }

  // 上一次筛选的明细,供日志 / 诊断展示
  const lastFilterReport = {
    total: 0, kept: 0, salaryOn: false, salaryParsed: 0,
    loBound: 0, hiBound: Infinity,        // 本次实际生效的薪资边界(上限拖到最右 = Infinity)
    skip: {}, unmatched: [], rejected: []
  };

  function collectJobList() {
    const include = settings.includeKeywords || [];
    const locs = settings.locationKeywords || [];
    const sizes = settings.companySizes || [];
    const salOn = !salaryUnlimited();
    // 上限拖到最右 = 60K+,按「不设上限」处理,否则 60K 以上的职位会被误杀
    const hiBound = settings.salaryMax >= SALARY.max ? Infinity : settings.salaryMax;
    const loBound = settings.salaryMin;

    const skip = { 关键词: 0, 城市: 0, 猎头: 0, 薪资不符: 0, 薪资未识别: 0, 公司规模: 0 };
    const unmatched = [];
    const rejected = [];
    let parsedCount = 0;

    // getCards() 命中的元素可能只是卡片的一半(标题块),薪资在兄弟节点里 → 向上冒泡补齐并去重
    const seen = new Set();
    const all = [];
    const rawCards = getCards().cards;
    // 字体反爬标定(第 1 轮):薪资数字被换成 PUA 码位,不标定就一个都读不到 ——
    // 表现就是「薪资筛选完全没生效」。
    puaCalibrate(puaSamplesFromCards(rawCards));
    rawCards.forEach((el) => {
      const w = widenCard(el);
      if (!seen.has(w)) { seen.add(w); all.push(w); }
    });
    // 字体反爬标定(第 2 轮):若卡片元素只含「半张」,第 1 轮采样可能是空的;
    // 冒泡补齐之后再采一次,样本才完整。
    if (!PUA.ready) puaCalibrate(puaSamplesFromCards(all));

    const list = all.filter((card) => {
      const f = cardFields(card);
      const t = f.title.toLowerCase();
      const a = f.addr.toLowerCase();
      const incOk = !include.length || include.some((k) => t.includes(k.toLowerCase()));
      const locOk = !locs.length || locs.some((k) => a.includes(k.toLowerCase()));
      const hhOk = !settings.excludeHeadhunters || !f.hhAlt.includes('猎头');

      if (!incOk) { skip.关键词++; return false; }
      if (!locOk) { skip.城市++; return false; }
      if (!hhOk) { skip.猎头++; return false; }

      if (salOn) {
        if (!f.salary) {
          // 解析不到薪资 → 跳过(而不是放行)。
          // 旧版这里是「放行」,属于 fail-open:只要页面改版让解析失败,全部职位都会通过,
          // 薪资筛选看起来就完全没生效。改成跳过,失败会以「跳过数」的形式暴露出来。
          skip.薪资未识别++;
          if (unmatched.length < 5) {
            unmatched.push((f.title || '(无标题)') + ' ｜ 卡片文本「' + txt(card).slice(0, 46) + '」');
          }
          return false;
        }
        parsedCount++;
        // 区间有交集才算命中
        if (f.salary.max < loBound || f.salary.min > hiBound) {
          skip.薪资不符++;
          if (rejected.length < 8) {
            // 把「为什么被跳过」写清楚 —— 只报薪资值的话,一旦边界设错就得靠猜
            const why = f.salary.max < loBound
              ? `${f.salary.max}K 低于下限 ${loBound}K`
              : `${f.salary.min}K 高于上限 ${hiBound === Infinity ? '不限' : hiBound + 'K'}`;
            rejected.push((f.title || '(无标题)') + ' · ' + f.salary.min + '-' + f.salary.max + 'K · ' + why);
          }
          return false;
        }
      }

      if (sizes.length && f.size && !sizes.includes(f.size)) { skip.公司规模++; return false; }
      return true;
    });

    lastFilterReport.total = all.length;
    lastFilterReport.kept = list.length;
    lastFilterReport.salaryOn = salOn;
    lastFilterReport.salaryParsed = parsedCount;
    lastFilterReport.loBound = loBound;
    lastFilterReport.hiBound = hiBound;
    lastFilterReport.skip = skip;
    lastFilterReport.unmatched = unmatched;
    lastFilterReport.rejected = rejected;
    return list;
  }

  function salaryBoundText() {
    const hi = settings.salaryMax >= SALARY.max ? '不限(60K+)' : settings.salaryMax + 'K';
    return settings.salaryMin + 'K — ' + hi;
  }

  function logFilterReport() {
    const r = lastFilterReport;
    if (!r.total) {
      log('⚠️ 页面上没有识别到职位卡片,请点「设置 → 诊断页面」检查选择器。');
      return;
    }
    log(`筛选:共 ${r.total} 个卡片 → 保留 ${r.kept} 个,跳过 ${r.total - r.kept} 个`);
    if (r.salaryOn && PUA.seen) log('  字体反爬:' + PUA.note);
    const parts = [];
    if (r.salaryOn) {
      // 把实际生效的区间打出来 —— 排查「明明该保留却被跳过」时,这一行是第一手证据
      parts.push(`薪资条件 ${salaryBoundText()}(区间有交集才保留)`);
      parts.push(`薪资不符 ${r.skip['薪资不符']}`);
      parts.push(`薪资未识别 ${r.skip['薪资未识别']}`);
    } else {
      parts.push(`薪资不限(${settings.salaryMin}K—${settings.salaryMax}K,未参与过滤)`);
    }
    if (settings.includeKeywords.length) parts.push(`关键词不符 ${r.skip['关键词']}`);
    if (settings.locationKeywords.length) parts.push(`城市不符 ${r.skip['城市']}`);
    if (settings.excludeHeadhunters) parts.push(`猎头 ${r.skip['猎头']}`);
    if (settings.companySizes.length) parts.push(`公司规模不符 ${r.skip['公司规模']}`);
    log('  ' + parts.join(' / '));

    // 下限 ≥ 上限:滑块几乎一定被拖到同一个点了,这几乎不会是想要的效果
    if (r.salaryOn && settings.salaryMin >= settings.salaryMax) {
      log(`  ⚠️ 薪资下限(${settings.salaryMin}K)已经不低于上限(${settings.salaryMax}K),可投区间被压成了 0 宽。`);
      log('     面板上的两个滑块是叠在一起的 —— 很可能拖到了同一个位置。请把左滑块往左拖。');
    }
    // 一个都没留下 + 卡在薪资上 → 直接指向「下限太高」
    if (r.salaryOn && r.kept === 0 && r.skip['薪资不符'] > 0) {
      log(`  ⚠️ 全部卡在薪资上:当前下限 ${settings.salaryMin}K。如果这不是你想要的,把左滑块往左拖。`);
    }
    if (r.salaryOn && r.salaryParsed === 0 && r.skip['薪资未识别'] > 0) {
      log('  ⚠️ 薪资一个都没解析出来,极可能是薪资选择器失效(页面改版)。请点「诊断页面」查看明细。');
      if (location.pathname.includes('/web/geek/jobs')) {
        log('  💡 你现在在「推荐页」。推荐页的卡片可能根本不渲染薪资 —— 请改用 BOSS 搜索页(/web/geek/job?query=…) 再试一次做对照。');
      }
    }
    r.rejected.forEach((s) => log('  ✕ 薪资不符:' + s));
    r.unmatched.forEach((s) => log('  ? 薪资未识别:' + String(s).slice(0, 60)));
  }

  function jobKey(card) {
    return hash(txt(q(SEL.CARD_TITLE, card)) + '|' + txt(q(SEL.CARD_ADDR, card)));
  }

  /* 打印一个元素的 DOM 大纲(tag + class + 自身文本),用于定位「薪资到底在哪个节点」 */
  function domOutline(root, max) {
    const out = [];
    const pad = (n) => '·'.repeat(n) + (n ? ' ' : '');
    (function walk(el, depth) {
      if (out.length >= max || depth > 8) return;
      const kids = Array.from(el.children);
      for (let i = 0; i < kids.length; i++) {
        if (out.length >= max) return;
        const c = kids[i];
        const cls = (c.getAttribute('class') || '').split(/\s+/).filter(Boolean).join('.');
        const own = Array.from(c.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' ');
        const head = pad(depth) + c.tagName.toLowerCase() + (cls ? '.' + cls : '');
        out.push(own ? head + ' = 「' + own.slice(0, 34) + '」' : head);
        walk(c, depth + 1);
      }
    })(root, 0);
    return out;
  }

  /* 打印单个节点的完整证据(属性 / 文本 / 码点 / 字体 / HTML),用于识破字体反爬 */
  function dumpNode(el, label) {
    if (!el) return;
    const cls = el.getAttribute ? (el.getAttribute('class') || '') : '';
    const attrs = el.attributes
      ? Array.from(el.attributes).map((a) => a.name + '="' + a.value + '"').join(' ')
      : '';
    log(`  ${label}: <${String(el.tagName || '?').toLowerCase()}${cls ? ' class="' + cls + '"' : ''}>`);
    log(`    属性: ${attrs || '(无)'}`);
    log(`    文本: 「${txt(el).slice(0, 40)}」`);
    log(`    码点: ${codePoints(el.textContent, 44)}`);
    try {
      const cs = getComputedStyle(el);
      log(`    字体: ${cs.fontFamily}`);
      const before = getComputedStyle(el, '::before').content;
      if (before && before !== 'none' && before !== 'normal') log(`    ::before content: ${before}`);
    } catch (e) { /* ignore */ }
    if (el.outerHTML) log(`    HTML: ${el.outerHTML.replace(/\s+/g, ' ').slice(0, 300)}`);
  }

  function diagnose() {
    jumpTo('settings');
    log('———— 诊断 ————');
    log('插件版本: v' + VERSION);
    log('URL: ' + location.href);
    CARD_CANDIDATES.forEach((s) => log(`卡片 ${s} → ${qa(s).length}`));
    const { cards, selector } = getCards();
    log(`最佳选择器: ${selector || '无匹配'} (${cards.length})`);
    log(`全局 a.op-btn-chat → ${qa('a.op-btn-chat').length}`);
    const fileInputs = qa(SEL.FILE_INPUT);
    log(`input[type=file] 共 ${fileInputs.length} 个`);
    fileInputs.forEach((i, n) => log(`  #${n} accept=${i.getAttribute('accept') || '-'} | class=${(i.getAttribute('class') || '-').slice(0, 40)}`));
    const imgEntry = findImageInput();
    log('图片上传入口 → ' + (imgEntry ? 'accept=' + (imgEntry.getAttribute('accept') || '-') : '未找到'));
    log(`已配置图片 ${(settings.imageFiles || []).length} 张`);

    // ——— 字体反爬(PUA)标定:必须在任何薪资解析之前完成 ———
    log('———— 字体反爬标定 ————');
    const puaSamples = puaSamplesFromCards(cards)
      .concat(puaSamplesFromCards(cards.slice(0, 20).map((c) => widenCard(c))));
    log(`  采样薪资节点 ${puaSamples.length} 个`);
    puaCalibrate(puaSamples);
    log('  ' + PUA.note);
    if (cards.length) {
      const raw0 = txt(cards[0]).slice(0, 60);
      log('  首卡解码前码点: ' + codePoints(raw0, 60));
      log('  首卡解码后文本: 「' + puaDecode(raw0).slice(0, 60) + '」');
      if (!PUA.ready && PUA.seen) {
        log('  ⚠️ 检测到 PUA 字符但无法自动标定 —— 薪资会全部识别失败,请把本段日志发给开发者。');
      }
    }
    if (puaSamples.length) {
      log('  样本对照(前 3 条):');
      puaSamples.slice(0, 3).forEach((s, i) => {
        log(`    #${i + 1} 码点 ${codePoints(s, 40)} → 「${puaDecode(s)}」`);
      });
    }

    if (cards[0]) {
      log('首卡片 class = ' + cards[0].className);
      log('首卡片文本 = ' + txt(cards[0]).slice(0, 60));
      const f = cardFields(cards[0]);
      log('解析 → 职位:' + f.title + ' / 地址:' + f.addr + ' / 薪资:' + (f.salary ? f.salary.min + '-' + f.salary.max + 'K' : '无') + ' / 规模:' + (f.size || '无'));
      const b = findCardButton(cards[0]);
      log('首卡片沟通按钮 = ' + (b ? txt(b) : '无'));
    }


    // ——— 薪资识别专项自检 ———
    log('———— 薪资识别自检 ————');
    log('薪资筛选状态:' + (salaryUnlimited() ? '不限(当前不会过滤)' : salaryBoundText()));
    if (!salaryUnlimited()) {
      log(`  生效边界:下限 ${settings.salaryMin}K / 上限 ` +
        (settings.salaryMax >= SALARY.max ? '不设(60K+ 视为最右)' : settings.salaryMax + 'K') +
        ' —— 岗位薪资区间与它「有交集」才保留');
      if (settings.salaryMin >= settings.salaryMax) {
        log('  ⚠️ 下限不低于上限,可投区间被压成 0 宽 —— 面板两个滑块可能叠在同一个位置了。');
      }
    }
    SALARY_ELS.forEach((s) => log(`  元素 ${s} → 命中 ${qa(s).length} 个`));
    let okCount = 0;
    cards.slice(0, 5).forEach((c, i) => {
      const wc = widenCard(c);
      const p = parseSalary(wc);
      if (p) okCount++;
      log(`  #${i + 1} 薪资原文「${findSalaryIn(wc) || '空'}」 → ${p ? p.min + '-' + p.max + 'K' : '未识别'}${wc !== c ? ' (卡片元素已向上冒泡补齐)' : ''}`);
      log(`      卡片文本「${txt(wc).slice(0, 70)}」`);
    });
    log(`  前 ${Math.min(5, cards.length)} 个卡片:识别成功 ${okCount} 个`);

    // ——— 首卡片 DOM 大纲:薪资到底在哪个节点 ———
    if (cards[0]) {
      log('———— 首卡片 DOM 大纲 ————');
      domOutline(cards[0], 34).forEach((l) => log(l));
      const up = widenCard(cards[0]);
      if (up !== cards[0]) {
        log('⚠️ 卡片元素偏小:向上冒泡补齐后能读到薪资「' + findSalaryIn(up) + '」');
        log('   补齐后的 DOM 大纲:');
        domOutline(up, 26).forEach((l) => log(l));
      } else {
        log('卡片元素已能读到薪资(无需冒泡)');
      }
    }

    // ——— 薪资节点抽样:识破字体混淆 / 定位真实节点 ———
    if (cards[0]) {
      log('———— 薪资节点抽样 ————');
      const skel = salarySkeletonNodes(cards[0], 3);
      if (!skel.length) {
        log('  未找到「像薪资骨架」的节点(即含有 - / K / 千 / 万 残迹的短文本节点)');
      } else {
        skel.forEach((el, i) => dumpNode(el, '骨架候选 ' + (i + 1)));
      }
      const el0 = q('.salary', cards[0]);
      if (el0) dumpNode(el0, '.salary');
    }

    if (cards.length && okCount === 0) {
      log('⚠️ 前几个卡片全部未识别 —— 请把以上内容(尤其「薪资节点抽样」)复制发给开发者。');
    }
    log('———— 诊断结束 ————');
    log('提示:点「设置 → 维护 → 复制日志」可一键复制以上全部内容。');
  }

  function getActiveStatus() {
    const online = q(SEL.ONLINE_TAG);
    if (online && txt(online) === '在线') return '在线';
    const at = q(SEL.ACTIVE_TIME);
    return at ? txt(at) || '未知' : '未知';
  }
  function activeMatched(status) {
    const list = settings.activeStatus || ['不限'];
    return list.includes('不限') || list.includes(status);
  }

  async function handleStayModal() {
    const btn = await waitFor(() => qa(SEL.STAY_BTN).find((b) => txt(b) === '留在此页'), 4000);
    if (btn) { simulateClick(btn); await sleep(settings.opDelay); }
  }

  async function applyToCard(card) {
    let btn = findCardButton(card);
    if (!btn) {
      simulateClick(card);
      await sleep(settings.opDelay);
      btn = await waitFor(
        () => q('.job-detail-box .op-btn.op-btn-chat') || q('.job-detail-box .op-btn-chat') || qa('a.op-btn-chat').find(visible),
        6000
      );
    }
    const status = getActiveStatus();
    if (status !== '未知' && !activeMatched(status)) return { outcome: 'status', detail: status };
    if (!btn) return { outcome: 'no-button' };
    const t = txt(btn);
    if (t !== '立即沟通') return { outcome: 'already', detail: t || '已沟通' };
    simulateClick(btn);
    await sleep(settings.opDelay);
    await handleStayModal();
    return { outcome: 'success' };
  }

  async function runJobs() {
    setPhase('applying', '开始投递…');
    log(`v${VERSION} · 开始投递 · ` + (location.pathname.includes('/web/geek/jobs') ? '推荐页' : '搜索页'));
    await autoScrollJobList();
    if (stopFlag) { renderButtons(); return; }
    const { cards, selector } = getCards();
    log(`识别到 ${cards.length} 个职位卡片(${selector || '无匹配选择器'})`);
    const list = collectJobList();
    logFilterReport();
    if (!list.length) {
      log('没有符合条件的职位。点「设置 → 诊断页面」可查看识别详情。');
      setPhase('stopped', '没有符合条件的职位');
      state.running = false;
      renderButtons();
      return;
    }

    for (let i = 0; i < list.length; i++) {
      if (stopFlag || !state.running) break;
      await whilePaused();
      const card = list[i];
      const key = jobKey(card);
      if (sets.applied.has(key)) continue;
      const f = cardFields(card);
      card.scrollIntoView({ block: 'center' });
      await sleep(300);
      setPhase('applying', `${i + 1}/${list.length} · ${f.title || '投递中'}`);

      let res = await withRetry(
        () => applyToCard(card),
        ['no-button', 'error'],   // 找不到按钮或异常时重试
        2,                          // 最多重试 2 次
        800                         // 每次间隔 800ms
      );

      if (res.outcome === 'success') {
        sets.applied.add(key); await persistSets();
        await addRecord({ job: f.title, company: f.company || f.addr, status: '已沟通' });
        await incToday();
        await bumpStats(true);
        log(`✅ 已沟通 · ${f.title}`);
        renderRecords();
      } else if (res.outcome === 'already') {
        sets.applied.add(key); await persistSets();
        await bumpStats(true);
        log(`跳过 · ${f.title} · ${res.detail}`);
      } else if (res.outcome === 'status') {
        await bumpStats(false);
        log(`跳过 · ${f.title} · 招聘者状态「${res.detail}」不符`);
      } else if (res.outcome === 'error') {
        await bumpStats(false);
        log(`跳过 · ${f.title} · 异常:${res.detail || '未知错误'}`);
      } else {
        await bumpStats(false);
        log(`跳过 · ${f.title} · 未找到沟通按钮`);
      }
      await sleep(randBetween(settings.opDelay, settings.opDelay * 1.6));
    }
    if (stopFlag) { renderButtons(); return; }
    setPhase('stopped', '投递完成');
    log('投递完成');
    state.running = false;
    renderButtons();
    renderDataPage();
  }

  /* ============================ 聊天引擎 ============================ */
  function getChatItems() {
    return qa(SEL.CHAT_LIST_ITEM).filter((li) => q(SEL.CHAT_AVATAR, li));
  }
  function hrKeyOf(li) {
    const name = txt(q(SEL.CHAT_NAME, li)) || '未知';
    return name.toLowerCase();
  }
  async function openChat(li) {
    const fig = q(SEL.CHAT_AVATAR, li);
    if (fig) simulateClick(fig);
    await sleep(settings.opDelay);
  }
  function getImList() { return q(SEL.IM_LIST); }
  function getLastFriendMessageText() {
    const box = getImList();
    if (!box) return null;
    const msgs = qa(SEL.FRIEND_MSG, box);
    if (!msgs.length) return null;
    return txt(q(SEL.MSG_TEXT, msgs[msgs.length - 1]));
  }

  async function sendText(text) {
    const input = await waitFor(() => q(SEL.INPUT), 5000);
    if (!input) { log('未找到聊天输入框'); return false; }
    input.focus();
    input.textContent = '';
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      input.textContent = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(200);
    const sendBtn = q(SEL.SEND_BTN);
    if (sendBtn) simulateClick(sendBtn);
    else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(settings.opDelay);
    return true;
  }

  async function sendGreetings() {
    const list = (settings.greetings || []).filter((s) => s && s.trim());
    if (!list.length) return false;
    for (let i = 0; i < list.length; i++) {
      log(`发送招呼语 ${i + 1}/${list.length}`);
      await sendText(list[i]);
      await sleep(settings.opDelay);
    }
    return true;
  }

  async function sendResume() {
    const btn = await waitFor(() => qa(SEL.TOOLBAR_BTN).find((b) => txt(b) === '发简历'), 5000);
    if (!btn) { log('未找到「发简历」按钮'); return { ok: false, retryable: true }; }
    if (btn.classList.contains('unable')) { log('对方未回复,暂不能发送简历'); return { ok: false, retryable: false }; }
    simulateClick(btn);
    await sleep(settings.opDelay);

    const onlyDialog = await waitFor(() => q(SEL.RESUME_ONLY_DIALOG), 4000);
    if (onlyDialog) {
      const sure = q('.btn-sure-v2', onlyDialog);
      if (sure) { simulateClick(sure); return { ok: true }; }
      return { ok: false, retryable: true };
    }
    const list = await waitFor(() => q(SEL.RESUME_LIST), 5000);
    if (!list) { log('未找到简历列表'); return { ok: false, retryable: true }; }
    const items = qa(SEL.RESUME_ITEM, list);
    if (!items.length) { log('简历列表为空'); return { ok: false, retryable: true }; }

    const jobName = txt(q('.position-name') || q(SEL.CARD_TITLE)) || '';
    let target = items[0];
    if (jobName) {
      const kw = jobName.toLowerCase().slice(0, 2);
      const hit = items.find((it) => txt(q(SEL.RESUME_NAME, it)).toLowerCase().includes(kw));
      if (hit) target = hit;
    }
    simulateClick(target);
    await sleep(settings.opDelay);

    const confirm = await waitFor(() => q(SEL.CONFIRM_BTN), 5000);
    if (confirm) { simulateClick(confirm); log('已发送附件简历'); return { ok: true }; }
    log('未找到简历发送确认按钮');
    return { ok: false, retryable: true };
  }

  /* 带重试地发送简历:仅对 retryable 的失败重试 */
  async function sendResumeWithRetry(maxRetries = 1) {
    for (let i = 0; i <= maxRetries; i++) {
      if (stopFlag) break;
      const r = await sendResume();
      if (r.ok) return true;
      if (!r.retryable || i >= maxRetries) return false;
      log(`  重试发简历 ${i + 1}/${maxRetries}…`);
      await sleep(800);
    }
    return false;
  }

  async function processChatPage() {
    const items = getChatItems();
    if (!items.length) return;
    for (const li of items) {
      if (stopFlag || !state.running) return;
      await whilePaused();
      const hr = hrKeyOf(li);
      const greeted = sets.greeted.has(hr);

      if (!greeted && settings.greetOnFirstChat) {
        setPhase('chatting', `沟通 ${hr}`);
        await openChat(li);
        await sendGreetings();
        if (settings.autoSendResume) await sendResumeWithRetry(1);
        if (settings.autoSendImage) await sendImage();
        sets.greeted.add(hr);
        await persistSets();
        await addRecord({ job: hr, company: '', status: '已招呼' });
        await incToday();
        await bumpStats(true);
        log(`✅ 已招呼 ${hr}`);
        renderRecords();
        await sleep(randBetween(settings.opDelay, settings.opDelay * 1.6));
        continue;
      }

      if (greeted && settings.replyWhenResumeAsked && !sets.resumeSent.has(hr)) {
        await openChat(li);
        const last = getLastFriendMessageText();
        if (last && /简历/.test(last)) {
          const ok = await sendResumeWithRetry(1);
          const imgOk = settings.sendImageOnResumeAsk ? await sendImage() : false;
          if (ok || imgOk) {
            sets.resumeSent.add(hr);
            await persistSets();
            await addRecord({ job: hr, company: '', status: ok ? '已发简历' : '已发图片' });
            await bumpStats(true);
            log('✅ 已向 ' + hr + ' 发送' + (ok ? '简历' : '图片'));
            renderRecords();
          }
        }
        await sleep(Math.max(600, settings.opDelay / 2));
      }
    }
  }

  async function runChat() {
    setPhase('chatting', '开始沟通…');
    log('开始沟通(聊天页)');
    jumpTo('home');
    while (state.running && !stopFlag) {
      await whilePaused();
      if (!isChatPage()) { setPhase('error', '请切换到聊天页'); await sleep(2000); continue; }
      try { await processChatPage(); } catch (e) { log('沟通出错: ' + (e && e.message)); }
      await sleep(settings.opDelay);
    }
    setPhase('stopped', '沟通已停止');
  }

  /* ============================ 消息与初始化 ============================ */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === MSG.TOGGLE_PANEL) {
      buildPanel();
      togglePanel(panel.classList.contains('ht-collapsed'));
      sendResponse({ ok: true });
      return true;
    }
  });

  (async function init() {
    try { await loadStorage(); } catch (e) { /* ignore */ }
    try {
      const { ht_pos } = await chrome.storage.local.get('ht_pos');
      if (ht_pos) window.__HT_POS__ = ht_pos;
    } catch (e) { /* ignore */ }
    buildPanel();
    try {
      const pending = sessionStorage.getItem('ht_pending');
      if (pending) {
        sessionStorage.removeItem('ht_pending');
        await sleep(1500);
        startEngine(pending === 'chat' ? 'chat' : 'jobs');
      }
    } catch (e) { /* ignore */ }
  })();
})();
