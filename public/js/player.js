/* Plyr 播放器初始化（视频统一样式）。
   gallery.js 里已初始化时为幂等：不会重复挂载。 */
(function () {
  'use strict';
  if (!window.Plyr || window.__plyrPlayers) return;
  var videos = document.querySelectorAll('video.plyr-video');
  if (!videos.length) return;
  window.__plyrPlayers = Array.prototype.slice.call(videos).map(function (v) {
    return new window.Plyr(v, {
      controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen']
    });
  });
})();
