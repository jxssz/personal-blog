/* 首页动效：标题逐字、卡片进场、横向最新内容、Three.js 粒子星空。
   手机与 reduced-motion 自动跳过重型效果。 */
(function () {
  'use strict';

  var m = window.__blogMotion || {};
  var hero = document.querySelector('.hero');
  if (!hero) return;

  // 标题逐字出现（SplitText，失败时退化为整段淡入）
  var title = hero.querySelector('[data-split]');
  if (title && !m.reduced && m.gsap) {
    var targets = [title];
    if (m.SplitText) {
      try {
        targets = new m.SplitText(title, { type: 'chars', charsClass: 'hero-char' }).chars;
      } catch (e) { targets = [title]; }
    }
    m.gsap.from(targets, {
      y: 36, opacity: 0, duration: 0.9, stagger: 0.035,
      ease: 'power3.out', delay: 0.15
    });
  }

  // 文章卡逐个进场
  if (!m.reduced && m.gsap && m.ScrollTrigger) {
    m.gsap.utils.toArray('.article-card').forEach(function (card, i) {
      m.gsap.from(card, {
        y: 28, opacity: 0, duration: 0.7, delay: (i % 5) * 0.06,
        ease: 'power2.out',
        scrollTrigger: { trigger: card, start: 'top 90%', once: true }
      });
    });

    // 桌面端：Latest Content 横向滚动
    var track = document.querySelector('.latest-track');
    var latestSection = document.querySelector('.latest-scroll');
    if (track && latestSection && window.matchMedia('(min-width: 769px)').matches) {
      m.gsap.to(track, {
        x: function () { return -(track.scrollWidth - window.innerWidth + 80); },
        ease: 'none',
        scrollTrigger: { trigger: latestSection, start: 'top bottom', end: 'bottom top', scrub: 1 }
      });
    }
  }

  // 卡片 hover：Anime.js 微交互（CDN 可用时），否则 CSS 兜底
  if (!m.reduced && window.anime) {
    document.querySelectorAll('.article-card').forEach(function (card) {
      card.addEventListener('mouseenter', function () {
        window.anime({ targets: card, translateY: -6, borderColor: '#00ff66', duration: 260, easing: 'easeOutQuad' });
      });
      card.addEventListener('mouseleave', function () {
        window.anime({ targets: card, translateY: 0, borderColor: '#2d3d35', duration: 260, easing: 'easeOutQuad' });
      });
    });
  }

  // 重型库只加载 Three.js 一个；手机跳过，失败降级为 CSS 星空
  if (m.reduced || window.matchMedia('(max-width: 768px)').matches) return;
  var mount = document.getElementById('hero-canvas');
  if (!mount) return;

  import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js')
    .then(function (THREE) {
      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 1000);
      camera.position.z = 30;
      var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      mount.appendChild(renderer.domElement);

      var count = 900;
      var positions = new Float32Array(count * 3);
      for (var i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 60;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 34;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
      }
      var geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      var material = new THREE.PointsMaterial({
        color: 0x00ff66, size: 0.14, transparent: true, opacity: 0.85, sizeAttenuation: true
      });
      var stars = new THREE.Points(geometry, material);
      scene.add(stars);

      var mouse = { x: 0, y: 0 };
      window.addEventListener('mousemove', function (e) {
        mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
        mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
      }, { passive: true });

      window.addEventListener('resize', function () {
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      });

      // 与 GSAP/Lenis 共用同一个 ticker，不另开 rAF
      if (m.gsap) {
        m.gsap.ticker.add(function () {
          scene.rotation.y += (mouse.x * 0.12 - scene.rotation.y) * 0.04;
          scene.rotation.x += (-mouse.y * 0.08 - scene.rotation.x) * 0.04;
          stars.rotation.z += 0.0004;
          renderer.render(scene, camera);
        });
      } else {
        renderer.render(scene, camera);
      }
      mount.classList.add('hero-canvas-ready');
    })
    .catch(function () {
      document.documentElement.classList.add('hero-fallback');
    });
})();
