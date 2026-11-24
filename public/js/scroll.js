/* 文章页：标题逐字、封面视差、章节 Pin、阅读进度、代码复制。
   文章页不加载 Three.js；手机关闭 Pin，改普通滚动。 */
(function () {
  'use strict';

  var m = window.__blogMotion || {};
  if (m.reduced || !m.gsap || !m.ScrollTrigger) return;

  // 标题逐字
  var title = document.querySelector('[data-split]');
  if (title) {
    var targets = [title];
    if (m.SplitText) {
      try {
        targets = new m.SplitText(title, { type: 'chars', charsClass: 'hero-char' }).chars;
      } catch (e) {}
    }
    m.gsap.from(targets, {
      y: 30, opacity: 0, duration: 0.8, stagger: 0.03, ease: 'power3.out', delay: 0.1
    });
  }

  // 封面视差
  var cover = document.querySelector('.post-cover');
  if (cover) {
    m.gsap.to(cover, {
      yPercent: -15, ease: 'none',
      scrollTrigger: { trigger: cover, start: 'top top', end: 'bottom top', scrub: true }
    });
  }

  // 长文章章节 Pin（桌面端，超过 800px 的章节）
  var isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (!isMobile) {
    m.gsap.utils.toArray('.content h2').forEach(function (heading) {
      var section = heading.closest('section') || heading.parentElement;
      if (!section || section.offsetHeight < 800) return;
      m.ScrollTrigger.create({
        trigger: section, start: 'top 12%', end: '+=45%',
        pin: true, pinSpacing: true, anticipatePin: 1
      });
    });
  }

  // 图注淡入
  m.gsap.utils.toArray('.content figcaption').forEach(function (cap) {
    m.gsap.from(cap, {
      opacity: 0, y: 12, duration: 0.5,
      scrollTrigger: { trigger: cap, start: 'top 92%', once: true }
    });
  });

  // 顶部阅读进度
  var bar = document.querySelector('.reading-progress');
  if (bar) {
    m.ScrollTrigger.create({
      start: 0, end: 'max',
      onUpdate: function (self) { m.gsap.set(bar, { scaleX: self.progress }); }
    });
  }

  // 代码块：行号 + 复制按钮
  document.querySelectorAll('.content pre').forEach(function (pre) {
    var code = pre.querySelector('code');
    if (!code || pre.querySelector('.copy-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = '复制';
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(code.textContent).then(function () {
        btn.textContent = '已复制';
        setTimeout(function () { btn.textContent = '复制'; }, 1600);
      });
    });
    pre.appendChild(btn);
  });

  // 预计阅读时间（按正文字符估算）
  var meta = document.querySelector('[data-read-time]');
  if (meta) {
    var text = (document.querySelector('.content') || {}).textContent || '';
    var minutes = Math.max(1, Math.round(text.replace(/\s/g, '').length / 400));
    meta.textContent = '约 ' + minutes + ' 分钟读完';
  }
})();
