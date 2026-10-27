// YouTube: the media hooks, the history guard for the player's entries, and auto-unmute.
// overlay.js provides window.__playSiteOverlay; while it is open, the video lives in its same-origin iframe.

function overlay() { return window.__playSiteOverlay || null; }

function activeDocument() {
  try {
    var frame = overlay() && overlay().getDocument();
    if (frame) return frame;
  } catch (_) {}
  return document;
}

function player(doc) {
  var element = doc.querySelector('#movie_player');
  return element && typeof element.getVideoData === 'function' ? element : null;
}

function call(name, fallback) {
  var doc = activeDocument();
  var p = player(doc);
  if (p && typeof p[name] === 'function') { p[name](); return true; }
  return fallback ? fallback(doc) : false;
}

function unmute(doc) {
  var button = (doc || document).querySelector('.ytp-unmute.ytp-button, .ytp-unmute-button');
  if (button) button.click();
}

// Auto-unmute: YouTube starts muted when playback begins without a tap.
new MutationObserver(function () { unmute(document); })
  .observe(document.documentElement, { childList: true, subtree: true });

// The player's states are history entries (see overlay.js). This runs at document start, before YouTube's own
// scripts, so it sees every popstate first: moves between the player's entries of the same page never reach
// YouTube's router. YouTube's replaceState on such an entry keeps the entry's mark.
(function () {
  var h = window.history;
  if (!h || typeof h.replaceState !== 'function') return;
  var MARK = '__bwePlayer';
  window.addEventListener('popstate', function (event) {
    var o = overlay();
    var verdict = '';
    try { verdict = o && typeof o.onPopState === 'function' ? o.onPopState(event) : ''; } catch (_) {}
    if (verdict === 'swallow') event.stopImmediatePropagation();
  }, true);
  var replace = h.replaceState;
  h.replaceState = function (data, title, url) {
    var current = h.state;
    var mark = current && typeof current === 'object' ? current[MARK] : undefined;
    if (typeof mark === 'string' && (data === null || data === undefined || (typeof data === 'object' && !Array.isArray(data)))) {
      data = Object.assign({}, data || {});
      data[MARK] = mark;
    }
    return replace.call(h, data, title, url);
  };
})();

experience.register({
  // overlay.js draws pull-to-refresh itself, so the browser turns its own off on YouTube pages that loaded.
  get pullToRefresh() { return !!overlay(); },

  media: {
    state: function () {
      var doc = activeDocument();
      var video = doc.querySelector('video');
      if (!video) return { found: false };
      // The feed's inline previews aren't the user's video: on a page that isn't a video page, only a playing,
      // audible video counts (an open /watch page keeps its notification while paused).
      if (doc === document && !/^\/(watch|shorts\/|live\/)/.test(location.pathname) && (video.paused || video.muted)) return { found: false };
      var data = {};
      try { var p = player(doc); if (p) data = p.getVideoData() || {}; } catch (_) {}
      var meta = doc.querySelector('meta[name="title"]');
      var id = String(data.video_id || '').trim();
      var poster = /^https:\/\//i.test(video.poster || '') ? video.poster : '';
      var url = '';
      try { url = doc.location.href; } catch (_) {}
      return {
        found: true,
        playing: !video.paused && !video.ended,
        title: String(data.title || (meta && meta.content) || doc.title || '').trim(),
        artist: String(data.author || '').trim(),
        artworkUrl: id ? 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/hqdefault.jpg' : poster,
        url: url,
        positionMs: isFinite(video.currentTime) ? Math.round(video.currentTime * 1000) : 0,
        durationMs: isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 1000) : 0,
        canNext: true,
        canPrevious: true
      };
    },
    play: function () {
      unmute(activeDocument());
      return call('playVideo', function (doc) { var v = doc.querySelector('video'); if (v) v.play(); return !!v; });
    },
    pause: function () {
      return call('pauseVideo', function (doc) { var v = doc.querySelector('video'); if (v) v.pause(); return !!v; });
    },
    next: function () {
      return call('nextVideo', function (doc) { var b = doc.querySelector('.ytp-next-button'); if (b) b.click(); return !!b; });
    },
    previous: function () {
      return call('previousVideo', function (doc) { var b = doc.querySelector('.ytp-prev-button'); if (b) b.click(); return !!b; });
    },
    seek: function (positionMs) {
      var seconds = Math.max(0, Number(positionMs) || 0) / 1000;
      var doc = activeDocument();
      var p = player(doc);
      if (p && typeof p.seekTo === 'function') { p.seekTo(seconds, true); return true; }
      var v = doc.querySelector('video');
      if (v && isFinite(v.duration)) { v.currentTime = seconds; return true; }
      return false;
    }
  }
});
