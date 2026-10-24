/* 文档配图用：把 content/app.js 里的线性图标原样注入 [data-ic] 占位元素 */
(function () {
  var ICONS = {
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
  document.querySelectorAll('[data-ic]').forEach(function (el) {
    var name = el.getAttribute('data-ic');
    el.insertAdjacentHTML('afterbegin',
      '<svg class="ht-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || '') + '</svg>');
  });
})();
