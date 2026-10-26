(function () {
  'use strict';

  var API_NAME = '__playSiteOverlay';
  var HOST_ID = '__play-site-overlay';
  var STYLE_ID = '__play-site-overlay-style';
  var FRAME_STYLE_ID = '__play-site-overlay-frame-style';
  var VERSION = 10;

  if (window[API_NAME] && window[API_NAME].version === VERSION) return;
  if (window[API_NAME] && typeof window[API_NAME].destroy === 'function') {
    try {
      window[API_NAME].destroy();
    } catch (_) {
      Array.prototype.slice.call(document.querySelectorAll('#' + HOST_ID)).forEach(function (host) {
        host.remove();
      });
      try { delete window[API_NAME]; } catch (_) { window[API_NAME] = null; }
    }
  }

  function isYouTubeHost(hostname) {
    var host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    return host === 'youtube.com' || host.endsWith('.youtube.com');
  }

  if (!isYouTubeHost(location.hostname)) return;

  var state = {
    host: null,
    frame: null,
    miniGestureSurface: null,
    miniMediaButton: null,
    miniCloseButton: null,
    mode: 'closed',
    url: '',
    parentWidth: 0,
    parentHeight: 0,
    miniScale: 1,
    miniX: null,
    miniY: null,
    lastDockHorizontal: 'right',
    lastDockVertical: 'bottom',
    scrollStyles: null,
    parentBottomBars: [],
    parentBottomBarProgress: 1,
    frameDocument: null,
    frameWindow: null,
    frameObserver: null,
    gesture: null,
    fadeSnapshot: null,
    mediaVideo: null,
    mediaLoading: false,
    animationTimer: 0,
    animationFrame: 0,
  };
  var api = null;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + HOST_ID + '{box-sizing:border-box;background:#000;overflow:hidden;}',
      '#' + HOST_ID + ' iframe{display:block;border:0;background:#000;}',
      '#' + HOST_ID + ' .play-overlay-mini-gesture{position:absolute;inset:0;z-index:2147483647;background:transparent;touch-action:none;pointer-events:auto;}',
      '#' + HOST_ID + ' .play-overlay-mini-gesture[hidden]{display:none!important;}',
      '#' + HOST_ID + '.play-overlay-expanding .play-overlay-mini-button{display:none!important;}',
      '#' + HOST_ID + ' .play-overlay-mini-button{position:absolute;top:6px;z-index:3;display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:50%;background:rgba(15,15,15,.72);color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.45);touch-action:manipulation;}',
      '#' + HOST_ID + ' .play-overlay-mini-button svg{width:18px;height:18px;fill:currentColor;}',
      '#' + HOST_ID + ' .play-overlay-mini-media{left:6px;}',
      '#' + HOST_ID + ' .play-overlay-mini-close{right:6px;font:400 23px/1 system-ui,sans-serif;}',
      '#' + HOST_ID + ' .play-overlay-spinner{width:15px;height:15px;border:2px solid rgba(255,255,255,.38);border-top-color:#fff;border-radius:50%;animation:play-overlay-spin .75s linear infinite;}',
      'ytm-pivot-bar-renderer{padding-bottom:0!important;}',
      '@keyframes play-overlay-spin{to{transform:rotate(360deg)}}',
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function setParentScrolling(locked) {
    if (locked) {
      if (!state.scrollStyles) {
        state.scrollStyles = {
          htmlOverflow: document.documentElement.style.overflow,
          htmlOverscroll: document.documentElement.style.overscrollBehavior,
          bodyOverflow: document.body ? document.body.style.overflow : '',
          bodyOverscroll: document.body ? document.body.style.overscrollBehavior : '',
        };
      }
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.style.overscrollBehavior = 'none';
      if (document.body) {
        document.body.style.overflow = 'hidden';
        document.body.style.overscrollBehavior = 'none';
      }
      return;
    }

    if (!state.scrollStyles) return;
    document.documentElement.style.overflow = state.scrollStyles.htmlOverflow;
    document.documentElement.style.overscrollBehavior = state.scrollStyles.htmlOverscroll;
    if (document.body) {
      document.body.style.overflow = state.scrollStyles.bodyOverflow;
      document.body.style.overscrollBehavior = state.scrollStyles.bodyOverscroll;
    }
    state.scrollStyles = null;
  }

  function emitChange() {
    window.dispatchEvent(new CustomEvent('play-site-overlay-change', {
      detail: { mode: state.mode, url: state.url },
    }));
  }

  function getFrameDocument() {
    if (!state.frame) return null;
    try {
      return state.frame.contentDocument;
    } catch (_) {
      return null;
    }
  }

  function isVisible(element) {
    if (!element || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    var view = element.ownerDocument && element.ownerDocument.defaultView;
    var style = view && view.getComputedStyle(element);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    var rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isVisibleSubview(element) {
    if (!isVisible(element)) return false;
    var rect = element.getBoundingClientRect();
    var view = element.ownerDocument.defaultView;
    return rect.bottom > 0 && rect.top < view.innerHeight &&
      rect.right > 0 && rect.left < view.innerWidth &&
      (rect.width > 120 || rect.height > 100);
  }

  function ensureFrameStyle(frameDocument) {
    var style = frameDocument.getElementById(FRAME_STYLE_ID);
    if (!style) {
      style = frameDocument.createElement('style');
      style.id = FRAME_STYLE_ID;
      (frameDocument.head || frameDocument.documentElement).appendChild(style);
    }
    var css = [
      '#header-bar,.mobile-topbar-header-background,ytm-mobile-topbar-renderer{display:none!important;}',
      'ytm-app{padding-top:0!important;}',
      '#player-container-id{top:0!important;touch-action:none!important;}',
      'html.play-overlay-player-motion,html.play-overlay-player-motion body,html.play-overlay-player-motion ytm-app{background:transparent!important;}',
      'html.play-overlay-player-motion #player-container-id{z-index:2147483647!important;will-change:transform;}',
      'html.play-overlay-mini-mode .ytp-chrome-top,html.play-overlay-mini-mode .ytp-chrome-bottom,html.play-overlay-mini-mode .ytp-gradient-top,html.play-overlay-mini-mode .ytp-gradient-bottom,html.play-overlay-mini-mode .ytp-pause-overlay,html.play-overlay-mini-mode .ytp-spinner,html.play-overlay-mini-mode .ytp-bezel,html.play-overlay-mini-mode .ytp-cued-thumbnail-overlay,html.play-overlay-mini-mode .ytp-ce-element,html.play-overlay-mini-mode .ytp-endscreen-content,html.play-overlay-mini-mode .ytp-paid-content-overlay,html.play-overlay-mini-mode .ytp-show-cards-title,html.play-overlay-mini-mode ytm-player-controls,html.play-overlay-mini-mode .new-controls,html.play-overlay-mini-mode .player-controls,html.play-overlay-mini-mode .player-controls-content,html.play-overlay-mini-mode .player-controls-background,html.play-overlay-mini-mode .player-controls-background-container,html.play-overlay-mini-mode .ytmA11yStylesHiddenButton{opacity:0!important;visibility:hidden!important;pointer-events:none!important;}',
    ].join('');
    if (style.textContent !== css) style.textContent = css;
  }

  function miniIcon(path) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.appendChild(shape);
    return svg;
  }

  function miniSpinner() {
    var spinner = document.createElement('span');
    spinner.className = 'play-overlay-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    return spinner;
  }

  function renderMiniMediaControl() {
    var button = state.miniMediaButton;
    var video = state.mediaVideo;
    if (!button) return;
    if (!video || state.mediaLoading || (video.readyState < 3 && !video.paused && !video.ended)) {
      button.setAttribute('aria-label', 'Loading video');
      button.replaceChildren(miniSpinner());
      return;
    }
    if (video.ended) {
      button.setAttribute('aria-label', 'Replay video');
      button.replaceChildren(miniIcon('M12 5V2L7 7l5 5V9a6 6 0 1 1-5.65 8H4.26A8 8 0 1 0 12 5z'));
      return;
    }
    if (video.paused) {
      button.setAttribute('aria-label', 'Play video');
      button.replaceChildren(miniIcon('M8 5v14l11-7z'));
      return;
    }
    button.setAttribute('aria-label', 'Pause video');
    button.replaceChildren(miniIcon('M7 5h4v14H7zm6 0h4v14h-4z'));
  }

  function onMediaStateChange(event) {
    if (event && (event.type === 'waiting' || event.type === 'loadstart' || event.type === 'stalled')) {
      state.mediaLoading = true;
    } else if (event && (event.type === 'playing' || event.type === 'canplay' || event.type === 'pause' || event.type === 'ended')) {
      state.mediaLoading = false;
    }
    renderMiniMediaControl();
  }

  function unbindMediaVideo() {
    var video = state.mediaVideo;
    if (!video) return;
    ['play', 'playing', 'pause', 'waiting', 'stalled', 'loadstart', 'canplay', 'ended'].forEach(function (name) {
      video.removeEventListener(name, onMediaStateChange);
    });
    state.mediaVideo = null;
    state.mediaLoading = false;
  }

  function bindMediaVideo(frameDocument) {
    var video = frameDocument.querySelector('video');
    if (video === state.mediaVideo) return;
    if (!video) {
      unbindMediaVideo();
      renderMiniMediaControl();
      return;
    }
    unbindMediaVideo();
    state.mediaVideo = video;
    ['play', 'playing', 'pause', 'waiting', 'stalled', 'loadstart', 'canplay', 'ended'].forEach(function (name) {
      video.addEventListener(name, onMediaStateChange);
    });
    renderMiniMediaControl();
  }

  function toggleMiniPlayback(event) {
    event.preventDefault();
    event.stopPropagation();
    var video = state.mediaVideo || (getFrameDocument() && getFrameDocument().querySelector('video'));
    if (!video) return;
    if (video.ended) video.currentTime = 0;
    if (video.paused || video.ended) {
      var playPromise = video.play();
      if (playPromise && playPromise.catch) playPromise.catch(function () {});
    } else {
      video.pause();
    }
    renderMiniMediaControl();
  }

  function removeFrameListeners() {
    var frameDocument = state.frameDocument;
    if (!frameDocument) return;
    try {
      if (state.frameWindow) state.frameWindow.removeEventListener('click', onFrameClick, true);
      frameDocument.removeEventListener('pointerdown', onFramePointerDown, true);
      frameDocument.removeEventListener('pointermove', onFramePointerMove, true);
      frameDocument.removeEventListener('pointerup', onFramePointerEnd, true);
      frameDocument.removeEventListener('pointercancel', onFramePointerCancel, true);
    } catch (_) {}
    if (state.frameObserver) state.frameObserver.disconnect();
    state.frameObserver = null;
    unbindMediaVideo();
    state.frameDocument = null;
    state.frameWindow = null;
    state.gesture = null;
  }

  // Videos opened inside the player replace its history entry instead of adding one, so the browser's history holds
  // only the site's own pages and Back never steps into old videos.
  function keepFrameOutOfHistory(frameWindow) {
    try {
      var frameHistory = frameWindow.history;
      if (frameWindow.__playOverlayNoHistory) return;
      var replace = frameHistory.replaceState;
      frameHistory.pushState = function (data, title, url) { return replace.call(frameHistory, data, title, url); };
      frameWindow.__playOverlayNoHistory = true;
    } catch (_) {}
  }

  function installFrameEnhancements() {
    var frameDocument = getFrameDocument();
    if (!frameDocument || !frameDocument.documentElement) return false;
    ensureFrameStyle(frameDocument);
    if (state.frameDocument === frameDocument) return true;
    removeFrameListeners();
    state.frameDocument = frameDocument;
    state.frameWindow = frameDocument.defaultView;
    keepFrameOutOfHistory(state.frameWindow);
    state.frameWindow.addEventListener('click', onFrameClick, true);
    frameDocument.addEventListener('pointerdown', onFramePointerDown, true);
    frameDocument.addEventListener('pointermove', onFramePointerMove, { capture: true, passive: false });
    frameDocument.addEventListener('pointerup', onFramePointerEnd, true);
    frameDocument.addEventListener('pointercancel', onFramePointerCancel, true);
    bindMediaVideo(frameDocument);
    state.frameObserver = new MutationObserver(function () {
      bindMediaVideo(frameDocument);
    });
    state.frameObserver.observe(frameDocument.documentElement, { childList: true, subtree: true });
    try {
      var current = new URL(frameDocument.location.href);
      if (isPlaybackPath(current)) state.url = current.href;
    } catch (_) {}
    return true;
  }

  function armFrameFastStart() {
    var frameDocument = getFrameDocument();
    try {
      var helper = frameDocument && frameDocument.defaultView.__playAdFastStart;
      if (helper && typeof helper.arm === 'function') helper.arm();
    } catch (_) {}
  }

  function playerForTarget(target) {
    if (!target || !target.closest) return null;
    return target.closest('#player-container-id');
  }

  function isFrameFullscreen() {
    var frameDocument = getFrameDocument();
    if (!frameDocument) return false;
    if (frameDocument.fullscreenElement || frameDocument.webkitFullscreenElement) return true;
    if (document.fullscreenElement || document.webkitFullscreenElement) return true;
    var player = frameDocument.querySelector('#player-container-id,.html5-video-player');
    return !!(player && (
      player.classList.contains('player-fullscreen') ||
      player.classList.contains('ytp-fullscreen') ||
      player.closest('[fullscreen]')
    ));
  }

  function framePlayer() {
    var frameDocument = getFrameDocument();
    return frameDocument && (
      frameDocument.querySelector('#player-container-id') ||
      frameDocument.querySelector('video')
    );
  }

  function captureParentBottomBars() {
    state.parentBottomBars = state.parentBottomBars.filter(function (item) {
      return item.element && item.element.isConnected;
    });
    var known = state.parentBottomBars.map(function (item) { return item.element; });
    var elements = Array.prototype.slice.call(document.querySelectorAll(
      'ytm-pivot-bar-renderer,#pivot-bar'
    )).filter(function (element, _, all) {
      return !all.some(function (other) { return other !== element && other.contains(element); });
    });
    elements.forEach(function (element) {
      if (known.indexOf(element) !== -1) return;
      var rect = element.getBoundingClientRect();
      state.parentBottomBars.push({
        element: element,
        height: rect.height || element.offsetHeight || 0,
        transform: element.style.transform,
        opacity: element.style.opacity,
        transition: element.style.transition,
        pointerEvents: element.style.pointerEvents,
        willChange: element.style.willChange,
      });
      known.push(element);
    });
    return state.parentBottomBars;
  }

  function parentBottomBarHeight() {
    var height = 0;
    captureParentBottomBars().forEach(function (item) {
      var style = window.getComputedStyle(item.element);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      var currentHeight = item.element.offsetHeight || item.element.getBoundingClientRect().height || item.height;
      if (currentHeight > 0) item.height = currentHeight;
      height = Math.max(height, item.height || 0);
    });
    return height;
  }

  function setParentBottomBarProgress(progress, transition) {
    var visibleProgress = Math.min(1, Math.max(0, Number(progress) || 0));
    state.parentBottomBarProgress = visibleProgress;
    captureParentBottomBars().forEach(function (item) {
      var baseTransform = item.transform && item.transform !== 'none' ? item.transform + ' ' : '';
      item.element.style.transform = baseTransform +
        'translate3d(0,' + ((1 - visibleProgress) * 100) + '%,0)';
      item.element.style.opacity = String(visibleProgress);
      item.element.style.pointerEvents = visibleProgress > 0.98 ? item.pointerEvents : 'none';
      item.element.style.transition = transition || 'none';
      item.element.style.willChange = 'transform,opacity';
    });
  }

  function restoreParentBottomBars() {
    state.parentBottomBars.forEach(function (item) {
      if (!item.element || !item.element.isConnected) return;
      item.element.style.transform = item.transform;
      item.element.style.opacity = item.opacity;
      item.element.style.transition = item.transition;
      item.element.style.pointerEvents = item.pointerEvents;
      item.element.style.willChange = item.willChange;
    });
    state.parentBottomBars = [];
    state.parentBottomBarProgress = 1;
  }

  function miniMetrics(rect) {
    var maxWidth = Math.min(220, Math.max(160, window.innerWidth * 0.48));
    var maxHeight = Math.min(220, Math.max(96, window.innerHeight * 0.28));
    var scale = Math.min(maxWidth / rect.width, maxHeight / rect.height);
    var width = Math.max(96, rect.width * scale);
    var height = Math.max(54, rect.height * scale);
    var margin = 12;
    var bottomClearance = parentBottomBarHeight();
    var maxX = Math.max(margin, window.innerWidth - width - margin);
    var maxY = Math.max(margin, window.innerHeight - height - bottomClearance - margin);
    var x = state.miniX == null ? maxX : Math.min(maxX, Math.max(margin, state.miniX));
    var y = state.miniY == null ? maxY : Math.min(maxY, Math.max(margin, state.miniY));
    return { scale: scale, width: width, height: height, margin: margin, maxX: maxX, maxY: maxY, x: x, y: y };
  }

  function fullMiniMetrics(rect, side, vertical) {
    var metrics = miniMetrics(rect);
    metrics.x = side === 'left' ? metrics.margin : metrics.maxX;
    metrics.y = vertical === 'top' ? metrics.margin : metrics.maxY;
    return metrics;
  }

  function preferredDockSide() {
    return state.lastDockHorizontal;
  }

  function preferredDockVertical() {
    return state.lastDockVertical;
  }

  function rememberedMiniMetrics(rect) {
    return fullMiniMetrics(rect, preferredDockSide(), preferredDockVertical());
  }

  function rememberDock(metrics) {
    state.miniX = metrics.x;
    state.miniY = metrics.y;
    state.lastDockHorizontal = Math.abs(metrics.x - metrics.margin) <=
      Math.abs(metrics.x - metrics.maxX) ? 'left' : 'right';
    state.lastDockVertical = Math.abs(metrics.y - metrics.margin) <=
      Math.abs(metrics.y - metrics.maxY) ? 'top' : 'bottom';
  }

  function setFrameMiniMode(enabled) {
    var frameDocument = getFrameDocument();
    if (frameDocument && frameDocument.documentElement) {
      frameDocument.documentElement.classList.toggle('play-overlay-mini-mode', !!enabled);
    }
  }

  function beginPlayerMotion() {
    if (state.fadeSnapshot) return state.fadeSnapshot;
    var frameDocument = getFrameDocument();
    var player = framePlayer();
    if (!frameDocument || !player) return null;
    var elements = Array.prototype.slice.call(
      frameDocument.querySelectorAll('.page-container,ytm-pivot-bar-renderer')
    ).filter(function (element) { return !element.contains(player); });
    state.fadeSnapshot = {
      player: player,
      playerRect: player.getBoundingClientRect(),
      playerStyle: {
        transform: player.style.transform,
        transformOrigin: player.style.transformOrigin,
        transition: player.style.transition,
        borderRadius: player.style.borderRadius,
        boxShadow: player.style.boxShadow,
        opacity: player.style.opacity,
        willChange: player.style.willChange,
      },
      elements: elements.map(function (element) {
        return {
          element: element,
          opacity: element.style.opacity,
          transition: element.style.transition,
          pointerEvents: element.style.pointerEvents,
          transform: element.style.transform,
          willChange: element.style.willChange,
        };
      }),
    };
    frameDocument.documentElement.classList.add('play-overlay-player-motion');
    state.host.style.background = 'transparent';
    state.frame.style.background = 'transparent';
    return state.fadeSnapshot;
  }

  function setPlayerMotion(transform, opacity, transition, contentOffset) {
    var snapshot = beginPlayerMotion();
    if (!snapshot) return false;
    var offset = Math.max(0, Number(contentOffset) || 0);
    snapshot.player.style.transformOrigin = 'top left';
    snapshot.player.style.transition = transition || 'none';
    snapshot.player.style.willChange = 'transform,opacity';
    snapshot.player.style.transform = transform;
    snapshot.player.style.borderRadius = ((1 - opacity) * 10) + 'px';
    snapshot.player.style.boxShadow = opacity < 0.95 ? '0 4px 18px rgba(0,0,0,.4)' : 'none';
    snapshot.elements.forEach(function (item) {
      item.element.style.transition = transition || 'none';
      item.element.style.opacity = String(opacity);
      item.element.style.pointerEvents = opacity < 0.98 ? 'none' : item.pointerEvents;
      item.element.style.willChange = 'opacity,transform';
      item.element.style.transform = (item.transform ? item.transform + ' ' : '') +
        'translate3d(0,' + offset + 'px,0)';
    });
    return true;
  }

  function clearPlayerMotion() {
    if (state.animationTimer) {
      window.clearTimeout(state.animationTimer);
      state.animationTimer = 0;
    }
    if (state.animationFrame) {
      window.cancelAnimationFrame(state.animationFrame);
      state.animationFrame = 0;
    }
    var snapshot = state.fadeSnapshot;
    if (!snapshot) return;
    var frameDocument = getFrameDocument();
    if (frameDocument) frameDocument.documentElement.classList.remove('play-overlay-player-motion');
    var player = snapshot.player;
    player.style.transform = snapshot.playerStyle.transform;
    player.style.transformOrigin = snapshot.playerStyle.transformOrigin;
    player.style.transition = snapshot.playerStyle.transition;
    player.style.borderRadius = snapshot.playerStyle.borderRadius;
    player.style.boxShadow = snapshot.playerStyle.boxShadow;
    player.style.opacity = snapshot.playerStyle.opacity;
    player.style.willChange = snapshot.playerStyle.willChange;
    snapshot.elements.forEach(function (item) {
      item.element.style.opacity = item.opacity;
      item.element.style.transition = item.transition;
      item.element.style.pointerEvents = item.pointerEvents;
      item.element.style.transform = item.transform;
      item.element.style.willChange = item.willChange;
    });
    state.fadeSnapshot = null;
  }

  function updateFullDrag(distance, gesture) {
    var rect = gesture.playerRect || playerRect();
    var side = gesture.dockSide || gesture.previewDockSide || preferredDockSide();
    var metrics = gesture.miniMetrics;
    if (!metrics || gesture.metricSide !== side) {
      metrics = fullMiniMetrics(rect, side, 'bottom');
      gesture.metricSide = side;
    }
    gesture.playerRect = rect;
    gesture.miniMetrics = metrics;
    var travel = Math.max(260, metrics.y - rect.top);
    var progress = Math.min(1, Math.max(0, distance / travel));
    var scale = 1 - (1 - metrics.scale) * progress;
    var translateX = (metrics.x - rect.left) * progress;
    var translateY = (metrics.y - rect.top) * progress;
    setPlayerMotion(
      'translate3d(' + translateX + 'px,' + translateY + 'px,0) scale(' + scale + ')',
      1 - progress,
      'none',
      28 * progress
    );
    setParentBottomBarProgress(progress, 'none');
  }

  function animateFullToMini(gesture) {
    var rect = gesture.playerRect || playerRect();
    var side = gesture.dockSide || gesture.previewDockSide || preferredDockSide();
    var metrics = gesture.metricSide === side && gesture.miniMetrics ?
      gesture.miniMetrics : fullMiniMetrics(rect, side, gesture.dockVertical || 'bottom');
    rememberDock(metrics);
    setPlayerMotion(
      'translate3d(' + (metrics.x - rect.left) + 'px,' + (metrics.y - rect.top) + 'px,0) scale(' + metrics.scale + ')',
      0,
      'transform 220ms cubic-bezier(.2,.8,.2,1),opacity 180ms ease,border-radius 220ms ease,box-shadow 220ms ease',
      28
    );
    if (state.fadeSnapshot) {
      state.fadeSnapshot.elements.forEach(function (item) {
        item.element.style.transition = 'opacity 180ms ease,transform 220ms cubic-bezier(.2,.8,.2,1)';
      });
    }
    setParentBottomBarProgress(
      1,
      'transform 220ms cubic-bezier(.2,.8,.2,1),opacity 180ms ease'
    );
    state.animationTimer = window.setTimeout(function () {
      finishMinimize(rect, metrics);
    }, 225);
  }

  function animateFullBack() {
    if (!state.fadeSnapshot) {
      showFull();
      return;
    }
    setPlayerMotion(
      'translate3d(0,0,0) scale(1)',
      1,
      'transform 180ms cubic-bezier(.2,.8,.2,1),opacity 160ms ease,border-radius 180ms ease,box-shadow 180ms ease',
      0
    );
    if (state.fadeSnapshot) {
      state.fadeSnapshot.elements.forEach(function (item) {
        item.element.style.transition = 'opacity 160ms ease,transform 180ms cubic-bezier(.2,.8,.2,1)';
      });
    }
    setParentBottomBarProgress(
      0,
      'transform 180ms cubic-bezier(.2,.8,.2,1),opacity 160ms ease'
    );
    state.animationTimer = window.setTimeout(function () {
      clearPlayerMotion();
      showFull();
    }, 185);
  }

  function onFramePointerDown(event) {
    if (window[API_NAME] !== api || event.button !== 0 || state.mode === 'closed') return;
    if (state.mode === 'full' && isFrameFullscreen()) return;
    if (!playerForTarget(event.target)) return;
    state.gesture = {
      pointerId: event.pointerId,
      target: event.target,
      mode: state.mode,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startTime: Date.now(),
      active: false,
      coordinateScale: state.mode === 'mini' ? state.miniScale : 1,
      dockSide: null,
      previewDockSide: null,
    };
    try { event.target.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function onFramePointerMove(event) {
    var gesture = state.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId || !state.host) return;
    if (gesture.mode === 'full' && isFrameFullscreen()) {
      state.gesture = null;
      return;
    }
    var dx = event.clientX - gesture.startX;
    var dy = event.clientY - gesture.startY;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;

    if (!gesture.active) {
      var activationDistance = gesture.mode === 'mini' ? 4 : 9;
      if (Math.hypot(dx, dy) < activationDistance) return;
      if (gesture.mode === 'full' && (dy <= 0 || Math.abs(dy) < Math.abs(dx) * 1.15)) {
        state.gesture = null;
        return;
      }
      gesture.active = true;
    }

    event.preventDefault();
    event.stopPropagation();

    if (gesture.mode === 'full') {
      // A neutral downward drag means bottom-right. Left is selected only when
      // the gesture contains a deliberate leftward component.
      var directedSide = dx <= -36 ? 'left' : 'right';
      gesture.previewDockSide = directedSide;
      if (dx <= -36) {
        gesture.dockSide = 'left';
      } else if (dx >= 18) {
        gesture.dockSide = 'right';
      } else if (!gesture.dockSide && dy >= 90) {
        gesture.dockSide = 'right';
      }
      var distance = Math.max(0, dy);
      updateFullDrag(distance, gesture);
      return;
    }

    var metrics = gesture.miniMetrics;
    var nextX = Math.min(metrics.maxX, Math.max(metrics.margin, gesture.startHostX + dx));
    var extraBottom = gesture.wasBottomDocked ? metrics.height * 0.85 : 0;
    var nextY = Math.min(metrics.maxY + extraBottom, Math.max(metrics.margin, gesture.startHostY + dy));
    gesture.currentX = nextX;
    gesture.currentY = nextY;
    var dismissDistance = gesture.wasBottomDocked ? Math.max(0, nextY - metrics.maxY) : 0;
    var dismissProgress = Math.min(1, dismissDistance / Math.max(54, metrics.height * 0.72));
    setMiniPosition(nextX, nextY, metrics, dismissProgress, 'none');
  }

  function onFramePointerEnd(event) {
    var gesture = state.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    state.gesture = null;
    var elapsed = Math.max(1, Date.now() - gesture.startTime);
    var dx = event.clientX - gesture.startX;
    var dy = event.clientY - gesture.startY;

    if (!gesture.active) {
      if (gesture.mode === 'mini') {
        event.preventDefault();
        event.stopImmediatePropagation();
        expandAnimated();
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (gesture.mode === 'full') {
      var downwardVelocity = dy / elapsed;
      if (dy > Math.min(150, window.innerHeight * 0.17) || downwardVelocity > 0.55) {
        animateFullToMini(gesture);
      } else {
        animateFullBack();
      }
      return;
    }

    var metrics = gesture.miniMetrics;
    var currentX = gesture.currentX == null ? gesture.startHostX : gesture.currentX;
    var currentY = gesture.currentY == null ? gesture.startHostY : gesture.currentY;
    if (gesture.wasBottomDocked && dy > Math.max(52, metrics.height * 0.38) && currentY > metrics.maxY + 30) {
      animateMiniDismiss(currentX, currentY, metrics);
    } else {
      var startHorizontal = gesture.startHostX + metrics.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
      var startVertical = gesture.startHostY + metrics.height / 2 < window.innerHeight / 2 ? 'top' : 'bottom';
      var horizontalTravel = Math.max(1, metrics.maxX - metrics.margin);
      var verticalTravel = Math.max(1, metrics.maxY - metrics.margin);
      var horizontalThreshold = Math.max(32, horizontalTravel * 0.26);
      var verticalThreshold = Math.max(56, verticalTravel * 0.26);
      var horizontal = dx <= -horizontalThreshold ? 'left' :
        (dx >= horizontalThreshold ? 'right' : startHorizontal);
      var vertical = dy <= -verticalThreshold ? 'top' :
        (dy >= verticalThreshold ? 'bottom' : startVertical);
      state.miniX = horizontal === 'left' ? metrics.margin : metrics.maxX;
      state.miniY = vertical === 'top' ? metrics.margin : metrics.maxY;
      state.lastDockHorizontal = horizontal;
      state.lastDockVertical = vertical;
      setMiniPosition(
        state.miniX,
        state.miniY,
        metrics,
        0,
        'transform 180ms cubic-bezier(.2,.8,.2,1),opacity 160ms ease'
      );
    }
  }

  function onFramePointerCancel() {
    var gesture = state.gesture;
    state.gesture = null;
    if (!gesture) return;
    if (gesture.mode === 'full') animateFullBack(); else applyMiniGeometry();
  }

  function onMiniSurfacePointerDown(event) {
    if (window[API_NAME] !== api || event.button !== 0 || state.mode !== 'mini') return;
    if (event.target && event.target.closest && event.target.closest('button')) return;
    event.preventDefault();
    event.stopPropagation();
    var hostRect = state.miniGestureSurface.getBoundingClientRect();
    var metrics = miniMetrics(basePlayerRect());
    state.gesture = {
      pointerId: event.pointerId,
      target: event.target,
      mode: 'mini',
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startTime: Date.now(),
      active: false,
      coordinateScale: 1,
      startHostX: hostRect.left,
      startHostY: hostRect.top,
      currentX: hostRect.left,
      currentY: hostRect.top,
      miniMetrics: metrics,
      wasBottomDocked: Math.abs(hostRect.top - metrics.maxY) < 14,
    };
    try { event.target.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function onMiniSurfaceClick(event) {
    if (window[API_NAME] !== api || !state.miniGestureSurface || state.miniGestureSurface.hidden) return;
    if (event.target && event.target.closest && event.target.closest('button')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Pointer-up may already have started the reverse animation. Keep
    // swallowing this generated click until that animation has completed.
    if (state.mode === 'mini') expandAnimated();
  }

  function tryAutoUnmute() {
    var frameDocument = getFrameDocument();
    if (!frameDocument) return;
    var button = frameDocument.querySelector(
      '.ytp-unmute.ytp-popup.ytp-button.ytp-unmute-animated.ytp-unmute-shrink,' +
      '.ytp-unmute.ytp-button,.ytp-unmute-button'
    );
    if (button) button.click();
  }

  function applyFullGeometry() {
    state.host.style.cssText = [
      'position:fixed',
      'inset:0',
      'width:auto',
      'height:auto',
      'overflow:hidden',
      'border-radius:0',
      'box-shadow:none',
      'background:#000',
      'z-index:2147483646',
      'opacity:1',
      'pointer-events:auto',
      'transform:none',
      'transition:none',
    ].join(';');
    state.frame.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'border:0',
      'background:#000',
      'transform:none',
    ].join(';');
  }

  function showFull() {
    if (!state.host || !state.frame) return false;
    clearPlayerMotion();
    setParentScrolling(true);
    state.mode = 'full';
    state.gesture = null;
    state.host.classList.remove('play-overlay-expanding');
    applyFullGeometry();
    setParentBottomBarProgress(
      0,
      'transform 180ms cubic-bezier(.2,.8,.2,1),opacity 160ms ease'
    );
    setFrameMiniMode(false);
    if (state.miniGestureSurface) state.miniGestureSurface.hidden = true;
    installFrameEnhancements();
    emitChange();
    return true;
  }

  function playerRect() {
    var frameDocument = getFrameDocument();
    var player = frameDocument && (
      frameDocument.querySelector('#player-container-id') ||
      frameDocument.querySelector('video')
    );
    var rect = player && player.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) return rect;
    return {
      top: 0,
      left: 0,
      width: state.parentWidth || window.innerWidth || 360,
      height: (state.parentWidth || window.innerWidth || 360) * 9 / 16,
    };
  }

  function basePlayerRect() {
    return state.fadeSnapshot && state.fadeSnapshot.playerRect ?
      state.fadeSnapshot.playerRect : playerRect();
  }

  function setMiniPosition(x, y, metrics, dismissProgress, transition) {
    var rect = basePlayerRect();
    var progress = Math.min(1, Math.max(0, Number(dismissProgress) || 0));
    setPlayerMotion(
      'translate3d(' + (x - rect.left) + 'px,' + (y - rect.top) + 'px,0) scale(' + metrics.scale + ')',
      0,
      transition || 'none',
      28
    );
    if (state.fadeSnapshot && state.fadeSnapshot.player) {
      state.fadeSnapshot.player.style.opacity = String(1 - progress);
    }
    if (state.miniGestureSurface) {
      state.miniGestureSurface.style.cssText = [
        'position:absolute',
        'inset:auto',
        'left:' + x + 'px',
        'top:' + y + 'px',
        'width:' + metrics.width + 'px',
        'height:' + metrics.height + 'px',
        'border-radius:10px',
        'box-shadow:0 4px 18px rgba(0,0,0,.45)',
        'opacity:' + (1 - progress),
        'pointer-events:auto',
        'transition:' + (transition || 'none'),
      ].join(';');
    }
  }

  function applyMiniGeometry(rectOverride, metricsOverride) {
    if (!state.host || !state.frame || state.mode !== 'mini') return;
    var rect = rectOverride || basePlayerRect();
    var metrics = metricsOverride || miniMetrics(rect);
    state.miniScale = metrics.scale;
    rememberDock(metrics);

    state.host.style.cssText = [
      'position:fixed',
      'inset:0',
      'width:auto',
      'height:auto',
      'overflow:hidden',
      'border-radius:0',
      'box-shadow:none',
      'background:transparent',
      'z-index:2147483646',
      'opacity:1',
      'pointer-events:none',
      'transform:none',
      'transition:none',
    ].join(';');
    state.frame.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'border:0',
      'background:transparent',
      'pointer-events:none',
      'transform:none',
    ].join(';');
    setMiniPosition(metrics.x, metrics.y, metrics, 0, 'none');
  }

  function finishMinimize(rect, metrics) {
    if (!state.host || !state.frame) return false;
    state.parentWidth = state.frame.contentWindow ? state.frame.contentWindow.innerWidth : window.innerWidth;
    state.parentHeight = state.frame.contentWindow ? state.frame.contentWindow.innerHeight : window.innerHeight;
    state.mode = 'mini';
    state.gesture = null;
    state.miniX = metrics.x;
    state.miniY = metrics.y;
    setParentScrolling(false);
    state.host.classList.remove('play-overlay-expanding');
    if (state.miniGestureSurface) state.miniGestureSurface.hidden = false;
    setFrameMiniMode(true);
    setParentBottomBarProgress(1, 'none');
    // Keep the same full-screen frame and the already-transformed player when
    // the gesture settles. Avoiding a frame/crop swap removes the top flash.
    applyMiniGeometry(rect, metrics);
    state.animationTimer = 0;
    installFrameEnhancements();
    emitChange();
    return true;
  }

  function minimize() {
    if (!state.host || !state.frame) return false;
    var previousMode = state.mode;
    var rect = playerRect();
    var metrics = previousMode === 'full' ?
      rememberedMiniMetrics(rect) : miniMetrics(rect);
    return finishMinimize(rect, metrics);
  }

  function minimizeAnimated() {
    if (!state.host || !state.frame) return false;
    if (state.mode !== 'full') return minimize();
    var gesture = {
      playerRect: playerRect(),
      dockSide: preferredDockSide(),
      dockVertical: preferredDockVertical(),
    };
    gesture.miniMetrics = rememberedMiniMetrics(gesture.playerRect);
    setPlayerMotion('translate3d(0,0,0) scale(1)', 1, 'none', 0);
    if (state.fadeSnapshot && state.fadeSnapshot.player) {
      void state.fadeSnapshot.player.offsetWidth;
    }
    animateFullToMini(gesture);
    return true;
  }

  function expandAnimated() {
    if (!state.host || !state.frame) return false;
    if (state.mode !== 'mini') return state.mode === 'full';
    setParentScrolling(true);
    state.mode = 'full';
    state.gesture = null;
    state.host.classList.add('play-overlay-expanding');
    setFrameMiniMode(true);
    state.host.style.pointerEvents = 'none';
    state.frame.style.pointerEvents = 'none';
    if (state.miniGestureSurface) {
      state.miniGestureSurface.hidden = false;
      state.miniGestureSurface.style.cssText = [
        'position:absolute',
        'inset:0',
        'width:auto',
        'height:auto',
        'opacity:1',
        'pointer-events:auto',
        'transition:none',
      ].join(';');
    }
    if (!state.fadeSnapshot || !state.fadeSnapshot.player) {
      setParentBottomBarProgress(0, 'none');
      state.animationTimer = window.setTimeout(showFull, 0);
      return true;
    }
    void state.fadeSnapshot.player.offsetWidth;
    state.animationFrame = window.requestAnimationFrame(function () {
      state.animationFrame = 0;
      setParentBottomBarProgress(
        0,
        'transform 220ms cubic-bezier(.2,.8,.2,1),opacity 180ms ease'
      );
      setPlayerMotion(
        'translate3d(0,0,0) scale(1)',
        1,
        'transform 220ms cubic-bezier(.2,.8,.2,1),opacity 180ms ease,border-radius 220ms ease,box-shadow 220ms ease',
        0
      );
      if (state.fadeSnapshot && state.fadeSnapshot.player) {
        state.fadeSnapshot.player.style.opacity = '1';
      }
      state.animationTimer = window.setTimeout(function () {
        clearPlayerMotion();
        applyFullGeometry();
        setFrameMiniMode(false);
        state.host.classList.remove('play-overlay-expanding');
        if (state.miniGestureSurface) state.miniGestureSurface.hidden = true;
        emitChange();
      }, 225);
    });
    return true;
  }

  function animateMiniDismiss(currentX, currentY, metrics) {
    if (!state.host || state.mode !== 'mini') return false;
    var targetY = Math.max(currentY, metrics.maxY + metrics.height + 24);
    var rect = basePlayerRect();
    setPlayerMotion(
      'translate3d(' + (currentX - rect.left) + 'px,' + (targetY - rect.top) + 'px,0) scale(' + metrics.scale + ')',
      0,
      'transform 180ms cubic-bezier(.4,0,1,1),opacity 160ms ease',
      28
    );
    if (state.fadeSnapshot && state.fadeSnapshot.player) state.fadeSnapshot.player.style.opacity = '0';
    if (state.miniGestureSurface) {
      state.miniGestureSurface.style.pointerEvents = 'none';
      state.miniGestureSurface.style.transition = 'top 180ms cubic-bezier(.4,0,1,1),opacity 160ms ease';
      state.miniGestureSurface.style.top = targetY + 'px';
      state.miniGestureSurface.style.opacity = '0';
    }
    state.animationTimer = window.setTimeout(function () {
      close();
    }, 185);
    return true;
  }

  function close() {
    if (!state.host || state.mode === 'closed') return false;
    var frameDocument = getFrameDocument();
    var video = frameDocument && frameDocument.querySelector('video');
    if (video) video.pause();
    // Park the loaded YouTube runtime instead of destroying it. A later card
    // click on the parent feed can then navigate this same document via the
    // site's SPA router without booting another full page.
    state.host.style.display = 'none';
    if (state.miniGestureSurface) state.miniGestureSurface.hidden = true;
    clearPlayerMotion();
    state.host.style.pointerEvents = 'auto';
    state.host.classList.remove('play-overlay-expanding');
    setFrameMiniMode(false);
    restoreParentBottomBars();
    state.mode = 'closed';
    state.gesture = null;
    setParentScrolling(false);
    emitChange();
    return true;
  }

  function createOverlay(url) {
    installStyles();
    var host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-label', 'Video page');

    var frame = document.createElement('iframe');
    frame.title = 'Video page';
    frame.src = url;
    frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    frame.allowFullscreen = true;

    var miniGestureSurface = document.createElement('div');
    miniGestureSurface.className = 'play-overlay-mini-gesture';
    miniGestureSurface.setAttribute('aria-label', 'Video mini player');
    miniGestureSurface.hidden = true;
    miniGestureSurface.addEventListener('pointerdown', onMiniSurfacePointerDown, true);
    miniGestureSurface.addEventListener('pointermove', onFramePointerMove, { capture: true, passive: false });
    miniGestureSurface.addEventListener('pointerup', onFramePointerEnd, true);
    miniGestureSurface.addEventListener('pointercancel', onFramePointerCancel, true);
    miniGestureSurface.addEventListener('click', onMiniSurfaceClick, true);

    var miniMediaButton = document.createElement('button');
    miniMediaButton.type = 'button';
    miniMediaButton.className = 'play-overlay-mini-button play-overlay-mini-media';
    miniMediaButton.setAttribute('aria-label', 'Loading video');
    miniMediaButton.appendChild(miniSpinner());
    miniMediaButton.addEventListener('click', toggleMiniPlayback);

    var miniCloseButton = document.createElement('button');
    miniCloseButton.type = 'button';
    miniCloseButton.className = 'play-overlay-mini-button play-overlay-mini-close';
    miniCloseButton.setAttribute('aria-label', 'Close video');
    miniCloseButton.textContent = '\u00d7';
    miniCloseButton.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      close();
    });
    miniGestureSurface.appendChild(miniMediaButton);
    miniGestureSurface.appendChild(miniCloseButton);

    host.appendChild(frame);
    host.appendChild(miniGestureSurface);
    document.body.appendChild(host);

    state.host = host;
    state.frame = frame;
    state.miniGestureSurface = miniGestureSurface;
    state.miniMediaButton = miniMediaButton;
    state.miniCloseButton = miniCloseButton;
    state.url = url;

    frame.addEventListener('load', function () {
      if (state.frame !== frame) return;
      installFrameEnhancements();
      armFrameFastStart();
      tryAutoUnmute();
      window.setTimeout(tryAutoUnmute, 400);
      window.setTimeout(tryAutoUnmute, 1200);
      if (state.mode === 'mini') applyMiniGeometry();
    });
    showFull();
  }

  function isShortsPath(url) {
    return /^\/shorts\/[^/]+/.test(url.pathname);
  }

  function currentFrameUrl() {
    var frameDocument = getFrameDocument();
    try {
      return frameDocument ? new URL(frameDocument.location.href) : null;
    } catch (_) {
      return null;
    }
  }

  function needsRouteFamilyReload(targetUrl) {
    var current = currentFrameUrl();
    // Mobile YouTube currently fails to construct its Shorts renderer when a
    // normal watch page enters /shorts through a synthetic SPA click. The
    // inverse transition works. Keep the same iframe, but replace its document
    // only for this known-bad direction.
    return !!current && !isShortsPath(current) && isShortsPath(targetUrl);
  }

  function replaceFrameDocument(url) {
    if (!state.frame) return false;
    state.url = url;
    removeFrameListeners();
    try {
      state.frame.contentWindow.location.replace(url);
    } catch (_) {
      state.frame.src = url;
    }
    return true;
  }

  function navigateFrameSpa(url) {
    var frameDocument = getFrameDocument();
    if (!frameDocument || !frameDocument.body) return false;

    try {
      if (frameDocument.location.href === url) return true;
      var targetUrl = new URL(url, frameDocument.location.href);
      if (needsRouteFamilyReload(targetUrl)) return replaceFrameDocument(targetUrl.href);

      // YouTube's mobile SPA intercepts an ordinary same-origin anchor click.
      // Dispatching it inside the already-loaded frame keeps the frame document,
      // player element, cookies, and application runtime alive between videos.
      var link = frameDocument.createElement('a');
      link.href = url;
      link.hidden = true;
      link.setAttribute('aria-hidden', 'true');
      frameDocument.body.appendChild(link);
      link.click();
      link.remove();
      armFrameFastStart();
      return true;
    } catch (_) {
      return false;
    }
  }

  function open(url) {
    var parsed;
    try {
      parsed = new URL(url, location.href);
    } catch (_) {
      return false;
    }
    if (parsed.origin !== location.origin || !isPlaybackPath(parsed)) return false;

    if (!state.host) {
      createOverlay(parsed.href);
      return true;
    }

    state.url = parsed.href;
    if (!navigateFrameSpa(parsed.href)) {
      try {
        state.frame.contentWindow.location.replace(parsed.href);
      } catch (_) {
        state.frame.src = parsed.href;
      }
    }
    showFull();
    return true;
  }

  function navigateParentPage(url) {
    minimize();
    try {
      var link = document.createElement('a');
      link.href = url;
      link.hidden = true;
      link.setAttribute('aria-hidden', 'true');
      document.body.appendChild(link);
      link.click();
      link.remove();
      return true;
    } catch (_) {
      return false;
    }
  }

  function isPlaybackPath(url) {
    return (url.pathname === '/watch' && url.searchParams.has('v')) ||
      /^\/shorts\/[^/]+/.test(url.pathname) ||
      /^\/live\/[^/]+/.test(url.pathname);
  }

  function clickedAnchor(event) {
    var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (var i = 0; i < path.length; i += 1) {
      if (path[i] && path[i].tagName === 'A' && path[i].href) return path[i];
    }
    var target = event.target;
    return target && target.closest ? target.closest('a[href]') : null;
  }

  function onFrameClick(event) {
    if (window[API_NAME] !== api || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var anchor = clickedAnchor(event);
    if (!anchor) return;

    var frameDocument = getFrameDocument();
    var url;
    try {
      url = new URL(anchor.href, frameDocument ? frameDocument.location.href : state.url);
    } catch (_) {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    if (url.origin === location.origin && isPlaybackPath(url)) {
      state.url = url.href;
      armFrameFastStart();
      if (needsRouteFamilyReload(url)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        replaceFrameDocument(url.href);
        showFull();
      }
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    navigateParentPage(url.href);
  }

  function dispatchFrameEscape(frameDocument) {
    var target = frameDocument.activeElement || frameDocument;
    var options = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', options));
    target.dispatchEvent(new KeyboardEvent('keyup', options));
  }

  function elementDepth(element) {
    var depth = 0;
    while (element && element.parentElement) {
      depth += 1;
      element = element.parentElement;
    }
    return depth;
  }

  function effectiveZIndex(element) {
    var zIndex = 0;
    var current = element;
    var view = element.ownerDocument.defaultView;
    while (current && current.nodeType === 1) {
      var parsed = Number.parseInt(view.getComputedStyle(current).zIndex, 10);
      if (Number.isFinite(parsed)) zIndex = Math.max(zIndex, parsed);
      current = current.parentElement;
    }
    return zIndex;
  }

  function topVisibleFrameSubview(frameDocument) {
    var selectors = [
      '.ytp-settings-menu',
      '.player-settings-menu',
      'player-settings-menu',
      'bottom-sheet-container',
      'bottom-sheet-layout',
      'ytm-bottom-sheet-container-renderer',
      '.bottom-sheet-container',
      '[class*="bottom-sheet"]',
      '.ytSpecBottomSheetLayoutHost',
      'yt-sheet-view-model',
      'yt-contextual-sheet-layout',
      'ytm-engagement-panel-section-list-renderer',
      'ytm-menu-popup-renderer',
      'ytm-multi-page-menu-renderer',
      'ytm-popup-container',
      'tp-yt-paper-dialog',
      '[role="dialog"]',
      '[role="menu"]',
    ];
    var candidates = [];
    selectors.forEach(function (selector) {
      Array.prototype.slice.call(frameDocument.querySelectorAll(selector)).forEach(function (element) {
        if (candidates.indexOf(element) === -1 && isVisibleSubview(element)) candidates.push(element);
      });
    });
    candidates.sort(function (left, right) {
      if (left.contains(right)) return -1;
      if (right.contains(left)) return 1;
      var zDifference = effectiveZIndex(left) - effectiveZIndex(right);
      if (zDifference) return zDifference;
      var depthDifference = elementDepth(left) - elementDepth(right);
      if (depthDifference) return depthDifference;
      return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  function firstVisibleControl(root, selectors) {
    for (var i = 0; i < selectors.length; i += 1) {
      var controls = Array.prototype.slice.call(root.querySelectorAll(selectors[i]));
      var control = controls.reverse().find(isVisible);
      if (control) return control;
    }
    return null;
  }

  function closeFrameSubview() {
    var frameDocument = getFrameDocument();
    if (!frameDocument) return false;
    var visibleSubview = topVisibleFrameSubview(frameDocument);
    if (!visibleSubview) return false;

    // A nested settings page gets its own Back first. Only after that page is
    // gone do we close its containing menu/sheet.
    var backButton = firstVisibleControl(visibleSubview, [
      'button[aria-label*="Back" i]',
      '[role="button"][aria-label*="Back" i]',
      '.ytp-panel-back-button',
      '.back-button',
    ]);
    if (backButton) {
      backButton.click();
      return true;
    }

    var closeButton = firstVisibleControl(visibleSubview, [
      'button[aria-label*="Close" i]',
      'button[aria-label*="Dismiss" i]',
      'button[aria-label*="Cancel" i]',
      '[role="button"][aria-label*="Close" i]',
      '[role="button"][aria-label*="Dismiss" i]',
      '.close-button',
    ]);
    if (closeButton) {
      closeButton.click();
      return true;
    }

    var sheetCloseButton = firstVisibleControl(frameDocument, [
      'bottom-sheet-container button.close-button',
      'bottom-sheet-container button[aria-label*="Close" i]',
      'ytm-bottom-sheet-container-renderer button[aria-label*="Close" i]',
      'ytw-scrim button[aria-label*="Close" i]',
    ]);
    if (sheetCloseButton) {
      sheetCloseButton.click();
      return true;
    }

    if (visibleSubview.matches('.ytp-settings-menu,.player-settings-menu,player-settings-menu')) {
      var settingsButton = frameDocument.querySelector(
        '.ytp-settings-button,.player-settings-icon,button[aria-label*="Settings" i]'
      );
      if (settingsButton) {
        settingsButton.click();
        return true;
      }
    }
    dispatchFrameEscape(frameDocument);
    return true;
  }

  function handleBackAction() {
    if (!state.host || state.mode === 'closed') return 'unhandled';
    // The mini player leaves Back to the page; media.js steps back through the site's own pages.
    if (state.mode === 'mini') return 'unhandled';
    if (closeFrameSubview()) return 'handled';
    return minimizeAnimated() ? 'handled' : 'unhandled';
  }

  function handleBack() {
    return handleBackAction() === 'handled';
  }

  function onParentClick(event) {
    if (window[API_NAME] !== api) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    var anchor = clickedAnchor(event);
    if (!anchor || anchor.closest('#' + HOST_ID)) return;

    var url;
    try {
      url = new URL(anchor.href, location.href);
    } catch (_) {
      return;
    }
    if (url.origin !== location.origin || !isPlaybackPath(url)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    open(url.href);
  }

  function onKeyDown(event) {
    if (window[API_NAME] !== api) return;
    if (event.key === 'Escape' && state.host && state.mode !== 'closed') {
      event.preventDefault();
      handleBack();
    }
  }

  function onResize() {
    if (window[API_NAME] !== api) return;
    if (state.mode === 'mini') applyMiniGeometry();
  }

  function destroy() {
    var frameDocument = getFrameDocument();
    var video = frameDocument && frameDocument.querySelector('video');
    if (video) video.pause();
    removeFrameListeners();
    if (state.host) state.host.remove();
    setParentScrolling(false);
    restoreParentBottomBars();
    document.removeEventListener('click', onParentClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onResize);
    state.host = null;
    state.frame = null;
    state.miniGestureSurface = null;
    state.miniMediaButton = null;
    state.miniCloseButton = null;
    state.mode = 'closed';
    state.url = '';
    if (window[API_NAME] === api) delete window[API_NAME];
  }

  api = {
    version: VERSION,
    open: open,
    close: close,
    minimize: minimize,
    expand: showFull,
    handleBack: handleBack,
    handleBackAction: handleBackAction,
    destroy: destroy,
    isOpen: function () { return !!state.host && state.mode !== 'closed'; },
    mode: function () { return state.mode; },
    // Loads the current video again in the same player (after a playback error).
    reload: function () {
      if (!state.host || state.mode === 'closed') return false;
      var current = currentFrameUrl();
      return replaceFrameDocument(current && isPlaybackPath(current) ? current.href : state.url);
    },
    getDocument: function () {
      return state.mode === 'closed' ? null : getFrameDocument();
    },
  };
  window[API_NAME] = api;
  document.addEventListener('click', onParentClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize);
}());
