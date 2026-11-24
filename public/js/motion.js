/* 全站唯一动效入口：Lenis + GSAP 共用同一个时钟。
   无 JS / reduced-motion / 库加载失败时，页面保持静态可读。 */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    document.documentElement.classList.add('no-motion');
    window.__blogMotion = { reduced: true };
    return;
  }

  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  var Lenis = window.Lenis;
  if (!gsap || !ScrollTrigger || !Lenis) {
    window.__blogMotion = { reduced: false, unavailable: true };
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  var lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
  gsap.ticker.lagSmoothing(0);
  // Three.js 渲染也挂在这个 ticker 上，不许另开 requestAnimationFrame。

  // CSS animation-timeline 不支持时用 ScrollTrigger 兜底顶部进度条
  var bar = document.querySelector('.scroll-progress');
  var nativeTimeline = false;
  try { nativeTimeline = window.CSS && CSS.supports('animation-timeline', 'scroll()'); } catch (e) {}
  if (bar && !nativeTimeline) {
    ScrollTrigger.create({
      start: 0, end: 'max',
      onUpdate: function (self) { gsap.set(bar, { scaleX: self.progress }); }
    });
  }

  window.__blogMotion = {
    reduced: false,
    gsap: gsap,
    ScrollTrigger: ScrollTrigger,
    SplitText: window.SplitText,
    lenis: lenis
  };
})();
