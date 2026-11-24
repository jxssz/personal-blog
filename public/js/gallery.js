/* 文章内媒体：PhotoSwipe v5 灯箱 + Swiper 图片组轮播 + Plyr 播放器。
   只作用于文章正文，不是单独相册页。 */
(function () {
  'use strict';

  // PhotoSwipe v5 Lightbox
  var lightbox = null;
  if (window.PhotoSwipeLightbox && document.querySelector('.content .pswp-item')) {
    lightbox = new window.PhotoSwipeLightbox({
      gallery: '.content',
      children: 'a.pswp-item',
      pswpModule: function () { return window.PhotoSwipe; }
    });
    lightbox.init();
  }

  // Swiper 图片组轮播
  if (window.Swiper && document.querySelector('.gallery-swiper')) {
    new window.Swiper('.gallery-swiper', {
      loop: true,
      speed: 500,
      pagination: { el: '.gallery-swiper .swiper-pagination', clickable: true },
      navigation: {
        nextEl: '.gallery-swiper .swiper-button-next',
        prevEl: '.gallery-swiper .swiper-button-prev'
      }
    });
  }

  // Plyr 视频播放器
  if (window.Plyr && document.querySelector('video.plyr-video')) {
    var players = Array.prototype.slice.call(document.querySelectorAll('video.plyr-video')).map(function (v) {
      return new window.Plyr(v, { controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen'] });
    });
    window.__plyrPlayers = players;
  }
})();
