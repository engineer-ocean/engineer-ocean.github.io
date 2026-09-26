/* =========================================================================
   Ocean — Personal Site
   Vanilla JS. No dependencies.
   ========================================================================= */
(function () {
  'use strict';

  var root = document.documentElement;
  var KEY = 'yy-theme';

  /* ------------------------------------------------------- theme toggle */
  function currentTheme() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function setTheme(next, persist) {
    root.setAttribute('data-theme', next);
    if (persist) {
      try { localStorage.setItem(KEY, next); } catch (e) {}
    }
    var btn = document.querySelector('[data-theme-toggle]');
    if (btn) {
      btn.setAttribute(
        'aria-label',
        next === 'dark' ? '切换到浅色主题' : '切换到深色主题'
      );
      btn.setAttribute('title', btn.getAttribute('aria-label'));
    }
  }

  setTheme(currentTheme(), false);

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-theme-toggle]');
    if (t) {
      setTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
      return;
    }

    /* --------------------------------------------------- mobile nav */
    var navBtn = ev.target.closest('[data-nav-toggle]');
    if (navBtn) {
      var links = document.querySelector('.nav-links');
      if (links) {
        var open = links.classList.toggle('is-open');
        navBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      return;
    }

    /* close mobile nav when a link is tapped */
    if (ev.target.closest('.nav-links a')) {
      var l = document.querySelector('.nav-links');
      var b = document.querySelector('[data-nav-toggle]');
      if (l) l.classList.remove('is-open');
      if (b) b.setAttribute('aria-expanded', 'false');
    }
  });

  /* -------------------------------------------- sticky header hairline */
  var header = document.querySelector('.site-header');
  if (header) {
    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        header.classList.toggle('is-pinned', window.scrollY > 8);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* --------------------------------------------------- active nav link */
  var sections = Array.prototype.slice.call(
    document.querySelectorAll('[data-nav-section]')
  );
  if (sections.length && 'IntersectionObserver' in window) {
    var navLinks = {};
    Array.prototype.forEach.call(
      document.querySelectorAll('.nav-links a[href^="#"]'),
      function (a) {
        navLinks[a.getAttribute('href').slice(1)] = a;
      }
    );
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var id = en.target.id;
          Object.keys(navLinks).forEach(function (k) {
            navLinks[k].classList.toggle('is-active', k === id);
          });
        });
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    );
    sections.forEach(function (s) { io.observe(s); });
  }

  /* ------------------------------------------------------- post filter */
  var filterBox = document.querySelector('[data-filters]');
  var postList = document.querySelector('[data-post-list]');
  if (filterBox && postList) {
    var posts = Array.prototype.slice.call(
      postList.querySelectorAll('[data-tags]')
    );
    var empty = document.querySelector('[data-empty]');

    filterBox.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.filter-btn');
      if (!btn) return;
      var tag = btn.getAttribute('data-tag');

      Array.prototype.forEach.call(
        filterBox.querySelectorAll('.filter-btn'),
        function (b) { b.setAttribute('aria-pressed', 'false'); }
      );
      btn.setAttribute('aria-pressed', 'true');

      var shown = 0;
      posts.forEach(function (p) {
        var tags = (p.getAttribute('data-tags') || '').split(/\s+/);
        var hit = tag === '*' || tags.indexOf(tag) !== -1;
        p.hidden = !hit;
        if (hit) shown += 1;
      });

      if (empty) empty.hidden = shown !== 0;

      var url = new URL(window.location.href);
      if (tag === '*') url.searchParams.delete('tag');
      else url.searchParams.set('tag', tag);
      window.history.replaceState({}, '', url);
    });

    var initial = new URL(window.location.href).searchParams.get('tag');
    if (initial) {
      var target = filterBox.querySelector('[data-tag="' + initial + '"]');
      if (target) target.click();
    }
  }

  /* ---------------------------------------------------------- image lightbox
     [data-lit] 的链接点击后开大图，不跳转。
     - 只接管带 data-lit 的链接，微信等外链照常新窗口打开
     - 中键 / Ctrl 点击仍按浏览器默认行为（新标签页打开原图）
     - 打开时锁页面滚动；Esc / 点背景 / 点关闭 都能退
     - 非 HTML 文档、或页面里没有 lightbox 节点时，这段整体跳过
     ---------------------------------------------------------- */
  function initLightbox() {
    var lb = document.getElementById('lightbox');
    var litLinks = document.querySelectorAll('[data-lit]');
    if (!lb || !litLinks.length) return;

    var lbImg = lb.querySelector('img');
    var lbCap = lb.querySelector('.lb-cap');
    var lbCount = lb.querySelector('.lb-count');
    var lbList = Array.prototype.slice.call(litLinks);
    var lbAt = 0;
    var lbOpener = null;

    function lbRender() {
      var a = lbList[lbAt];
      lbImg.src = a.getAttribute('href');
      lbImg.alt = a.getAttribute('alt') || '';
      if (lbCap) {
        lbCap.textContent = a.getAttribute('data-lit') || lbImg.alt || '';
      }
      if (lbCount) lbCount.textContent = (lbAt + 1) + ' / ' + lbList.length;
    }

    function lbOpen(i, opener) {
      lbAt = i;
      lbOpener = opener || lbList[i];
      lbRender();
      lb.classList.add('open');
      document.body.style.overflow = 'hidden';
      var closer = lb.querySelector('.lb-close');
      if (closer) closer.focus();
    }

    function lbClose() {
      lb.classList.remove('open');
      document.body.style.overflow = '';
      if (lbOpener) lbOpener.focus();
    }

    function lbStep(d) {
      lbAt = (lbAt + d + lbList.length) % lbList.length;
      lbRender();
    }

    Array.prototype.forEach.call(litLinks, function (a, i) {
      a.setAttribute('role', 'button');
      a.setAttribute('aria-haspopup', 'dialog');
      a.addEventListener('click', function (ev) {
        /* 新标签页打开（中键 / Ctrl 点击）不拦，尊重浏览器默认行为 */
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button) return;
        ev.preventDefault();
        lbOpen(i, a);
      });
    });

    lb.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-lit-close]')) { lbClose(); return; }
      /* 点图片本身不关，点四周留白关 */
      if (!ev.target.closest('figure')) lbClose();
    });

    document.addEventListener('keydown', function (ev) {
      if (!lb.classList.contains('open')) return;
      if (ev.key === 'Escape') { lbClose(); return; }
      if (ev.key === 'ArrowRight' && lbList.length > 1) { ev.preventDefault(); lbStep(1); }
      if (ev.key === 'ArrowLeft' && lbList.length > 1) { ev.preventDefault(); lbStep(-1); }
    });
  }

  /* script 带 defer：DOM 解析完才执行，但 DOMContentLoaded 未必已经派发过，
     所以这里要判一次 readyState，否则会漏掉整段初始化（灯箱点了没反应）。 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLightbox);
  } else {
    initLightbox();
  }

  /* ---------------------------------------------------------- footer year */
  Array.prototype.forEach.call(
    document.querySelectorAll('[data-year]'),
    function (el) { el.textContent = new Date().getFullYear(); }
  );
})();
