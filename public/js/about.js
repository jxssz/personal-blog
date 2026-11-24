/* 关于页：时间轴逐段出现 + Logo 动效（Rive 缺失时用 Lottie 兜底）。 */
(function () {
  'use strict';
  var m = window.__blogMotion || {};

  if (!m.reduced && m.gsap && m.ScrollTrigger) {
    m.gsap.utils.toArray('.timeline-item').forEach(function (item) {
      m.gsap.from(item, {
        x: -24, opacity: 0, duration: 0.6, ease: 'power2.out',
        scrollTrigger: { trigger: item, start: 'top 88%', once: true }
      });
    });
  }

  var logo = document.querySelector('[data-lottie]');
  if (logo) {
    var s = document.createElement('script');
    s.src = '/vendor/lottie.min.js';
    s.onload = function () {
      var path = logo.getAttribute('data-lottie');
      if (window.lottie && path && path !== 'none') {
        window.lottie.loadAnimation({ container: logo, renderer: 'svg', loop: true, autoplay: true, path: path });
      }
    };
    document.head.appendChild(s);
  }
})();
