/* 标签页：进场动效（不再使用脑图）。 */
(function () {
  'use strict';
  var m = window.__blogMotion || {};
  if (m.reduced || !m.gsap) return;
  m.gsap.from('.tag-cloud .chip', {
    scale: 0.7, opacity: 0, duration: 0.55, stagger: 0.09, ease: 'back.out(1.6)'
  });
})();
