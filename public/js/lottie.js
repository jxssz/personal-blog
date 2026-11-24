/* Lottie / dotLottie 挂载：只按需加载，失败静默降级。 */
(function () {
  'use strict';
  var nodes = document.querySelectorAll('[data-lottie]');
  if (!nodes.length) return;

  function mount() {
    if (!window.lottie) return;
    nodes.forEach(function (el) {
      var path = el.getAttribute('data-lottie');
      if (!path || path === 'none') return;
      window.lottie.loadAnimation({
        container: el,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: path
      });
    });
  }

  if (window.lottie) { mount(); return; }
  var s = document.createElement('script');
  s.src = '/vendor/lottie.min.js';
  s.onload = mount;
  document.head.appendChild(s);
})();
