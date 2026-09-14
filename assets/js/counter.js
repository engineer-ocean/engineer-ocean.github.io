/* 访客统计（前端）
 *
 * 流程：上报一次访问命中 → 拉取聚合数字 → 渲染到页脚。
 * 本脚本只读取服务端返回的**聚合数字**（总次数 / 独立访客 / 城市分布），
 * 页面上不会出现任何单个访客的信息。
 *
 * 覆盖范围：所有引用了本脚本的页面都会计一次访问；只有带 `[data-visits]`
 * 展示位的页面（目前是首页）才渲染数字。
 *
 * 启用方式：部署好 counter/worker.js 之后，把它的地址填进下面的 ENDPOINT。
 * ENDPOINT 留空时本脚本**完全不发任何网络请求**，页脚统计区也整块保持隐藏，
 * 站点行为与外观同未装统计时完全一致。
 */
(function () {
  'use strict';

  // 例：'https://ocean-site-counter.your-subdomain.workers.dev'
  var ENDPOINT = 'https://ocean-site-counter.yangee1638.workers.dev';

  if (!ENDPOINT) return;

  var wrap = document.querySelector('[data-visits-wrap]');
  var box = document.querySelector('[data-visits]');

  // 1) 上报命中 —— 不等待、不阻塞渲染，失败静默。
  //    放在展示位判断之前，这样没有展示位的页面同样计入访问量。
  try {
    fetch(ENDPOINT + '/hit', {
      method: 'POST',
      mode: 'cors',
      keepalive: true
    }).catch(function () {});
  } catch (e) {}

  // 没有展示位就到此为止：只计数，不显示。
  if (!box) return;

  var summaryEl = box.querySelector('[data-visits-summary]');
  var citiesEl = box.querySelector('[data-visits-cities]');

  function fmt(n) {
    return (Number(n) || 0).toLocaleString('zh-CN');
  }

  // 用 DOM 节点拼装，数字单独套 .num（等宽字体），全程不碰 innerHTML
  function setLine(el, parts) {
    if (!el) return;
    el.textContent = '';
    parts.forEach(function (p) {
      if (typeof p === 'string') {
        el.appendChild(document.createTextNode(p));
      } else {
        var s = document.createElement('span');
        s.className = 'num';
        s.textContent = fmt(p.num);
        el.appendChild(s);
      }
    });
  }

  function render(data) {
    setLine(summaryEl, [
      '本站访问 ', { num: data.pv }, ' 次 · 独立访客 ',
      { num: data.uv }, ' 位 · 来自 ', { num: data.cityCount }, ' 个城市'
    ]);

    var top = (data.topCities || []).filter(function (c) {
      return c && c.city;
    }).slice(0, 5);

    if (top.length) {
      setLine(citiesEl, top.reduce(function (acc, c, i) {
        if (i) acc.push(' · ');
        acc.push(c.city, ' ', { num: c.count });
        return acc;
      }, []));
      if (citiesEl) citiesEl.hidden = false;
    }

    if (wrap) wrap.hidden = false;
    box.hidden = false;
  }

  // 2) 拉取聚合数字
  try {
    fetch(ENDPOINT + '/stats', { mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) render(d); })
      .catch(function () {});
  } catch (e) {}
})();
