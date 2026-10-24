/*
 * 一键投 Boss —— 共享常量
 * 仅向 globalThis 挂载数据,可在内容脚本 / 后台复用。
 */
(function (root) {
  'use strict';

  root.HT_KEYS = {
    settings: 'ht_settings',
    state: 'ht_state',
    records: 'ht_records',
    stats: 'ht_stats',
    greeted: 'ht_greeted',
    resumeSent: 'ht_resume_sent',
    applied: 'ht_applied'
  };

  // 制作人信息
  root.HT_AUTHOR = '王智纬 / wangzhiwei';

  root.HT_MSG = {
    TOGGLE_PANEL: 'ht:toggle-panel',
    GET_STATE: 'ht:get-state',
    STATE_CHANGED: 'ht:state-changed'
  };

  // 招聘者活跃状态(与 BOSS 页面文案一致)
  root.HT_ACTIVE_STATUS = [
    '不限', '在线', '刚刚活跃', '今日活跃', '3日内活跃', '本周活跃',
    '2周内活跃', '本月活跃', '2月内活跃', '3月内活跃', '4月内活跃',
    '5月内活跃', '近半年活跃', '半年前活跃'
  ];

  // 常用城市(下拉选择;仍支持自由输入多个)
  root.HT_CITIES = [
    '北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京',
    '西安', '苏州', '长沙', '重庆', '天津', '郑州', '合肥', '厦门',
    '东莞', '佛山', '宁波', '无锡', '青岛', '济南', '福州', '珠海'
  ];

  // 公司规模分档(与 BOSS 页面文案一致)
  root.HT_COMPANY_SIZES = [
    '0-20人', '20-99人', '100-499人', '500-999人', '1000-9999人', '10000人以上'
  ];

  // 薪资范围(K/月),0 表示不限
  root.HT_SALARY = { min: 0, max: 60, step: 1 };

  // 图片发送限制
  root.HT_IMAGE = {
    maxCount: 3,
    maxBytes: 2 * 1024 * 1024,
    accept: 'image/png,image/jpeg,image/jpg,image/webp,image/gif',
    types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  };

  root.HT_DEFAULTS = {
    // 投递筛选
    includeKeywords: [],      // 职位名包含(任一命中)
    locationKeywords: [],     // 工作地包含(任一命中)
    activeStatus: ['不限'],    // 招聘者活跃状态(多选)
    excludeHeadhunters: false, // 排除猎头职位
    salaryMin: 0,              // 薪资下限(K),0 = 不限
    salaryMax: 60,             // 薪资上限(K),60 = 不限
    companySizes: [],          // 公司规模(多选,空 = 不限)

    // 聊天 / 简历
    autoSendResume: false,     // 首次沟通后自动发送附件简历
    greetOnFirstChat: true,    // 首次沟通发送招呼语
    replyWhenResumeAsked: true,// HR 提到"简历"时自动发简历

    // 图片(图片简历 / 作品图,作为图片消息发给 HR)
    imageFiles: [],            // [{ name, type, size, dataUrl }]
    autoSendImage: false,      // 首次沟通后自动发送图片
    sendImageOnResumeAsk: false, // HR 提到「简历」时发送图片

    // 招呼语(多条,逐条发送)
    greetings: [],

    // 节奏(毫秒)
    opDelay: 1200,             // 基础操作间隔
    scrollWait: 1000           // 滚动加载等待
  };

  root.HT_DEFAULT_STATE = {
    running: false,
    mode: '',            // jobs | chat
    phase: 'idle',       // idle | scanning | applying | chatting | stopped | error
    message: '',
    runCount: 0,
    todayCount: 0
  };

  // 页面选择器(集中管理,BOSS 改版只需改这里)
  root.HT_SEL = {
    CARD: 'li.job-card-box',
    CARD_TITLE: '.job-name',
    CARD_ADDR: '.job-address-desc, .company-location, .job-area',
    CARD_HEADHUNTER: '.job-tag-icon',

    ONLINE_TAG: '.boss-online-tag',
    ACTIVE_TIME: '.boss-active-time',

    CHAT_BTN: 'a.op-btn-chat',
    STAY_BTN: '.default-btn.cancel-btn',

    CHAT_LIST_ITEM: 'ul[role="group"] li[role="listitem"]',
    CHAT_AVATAR: '.figure',
    CHAT_NAME: '.name-text',
    CHAT_USER_LIST: '.user-list-content',
    IM_LIST: '.chat-message .im-list',
    FRIEND_MSG: 'li.message-item.item-friend',
    MSG_TEXT: '.text span',
    CARD_WRAP: '.message-card-wrap',
    CARD_BTN: '.card-btn',

    INPUT: '#chat-input',
    SEND_BTN: '.btn-send',

    FILE_INPUT: 'input[type="file"]',
    CHAT_OP_BOX: '.chat-op, .chat-toolbar, .im-toolbar, .toolbar, .chat-editor, .edit-area',

    TOOLBAR_BTN: '.toolbar-btn',
    RESUME_ONLY_DIALOG: '.panel-resume.sentence-popover',
    RESUME_LIST: 'ul.resume-list',
    RESUME_ITEM: 'li.list-item',
    RESUME_NAME: '.resume-name',
    CONFIRM_BTN: 'button.btn-v2.btn-sure-v2.btn-confirm'
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
