// YouTube: the browser hooks (media, back, refresh, pip) and auto-unmute.
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

var pipRestore = null;

// The site's own page history. Every page YouTube opens is numbered in its history entry, so Back can step through
// exactly the pages of this visit and leave the site only from the first one.
var pages = (function () {
  var h = window.history;
  if (!h || typeof h.pushState !== 'function') return { depth: function () { return 0; } };
  var KEY = '__bweDepth';
  var depth = numbered(h.state);
  function numbered(data) { return data && typeof data === 'object' && typeof data[KEY] === 'number' ? data[KEY] : 0; }
  function mark(data, value) {
    if (data === null || data === undefined) { var fresh = {}; fresh[KEY] = value; return fresh; }
    if (typeof data !== 'object' || Array.isArray(data)) return data;
    var copy = Object.assign({}, data); copy[KEY] = value; return copy;
  }
  var push = h.pushState, replace = h.replaceState;
  h.pushState = function (data, title, url) { depth += 1; return push.call(h, mark(data, depth), title, url); };
  h.replaceState = function (data, title, url) { return replace.call(h, mark(data, depth), title, url); };
  window.addEventListener('popstate', function (event) { depth = numbered(event.state); });
  return { depth: function () { return depth; } };
})();

// A real playback failure in the open player: a media error or YouTube's own error screen. Paused, buffering and
// loading don't count.
function playbackError(doc) {
  var video = doc.querySelector('video');
  if (video && video.error) return true;
  var screen = doc.querySelector('.ytp-error, ytm-player-error-message-renderer, .player-error-message, .ytp-error-content');
  return !!(screen && screen.getClientRects().length);
}

function fullPlayer() {
  var o = overlay();
  return o && o.isOpen() && o.mode() === 'full' ? o : null;
}

// Asks YouTube's own router to open the current address again, which reloads the page's data without a site reload.
function refreshPage() {
  var link = document.createElement('a');
  link.href = location.href;
  link.hidden = true;
  (document.body || document.documentElement).appendChild(link);
  var click = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
  link.dispatchEvent(click);
  link.remove();
  if (click.defaultPrevented) window.scrollTo(0, 0);
  return click.defaultPrevented;
}

experience.register({
  media: {
    state: function () {
      var doc = activeDocument();
      var video = doc.querySelector('video');
      if (!video) return { found: false };
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
        canSkip: true
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
  },

  // Full player: close a sheet or shrink to the mini player. Otherwise step back through this visit's YouTube pages;
  // from the first one, 'exit' while a video is open (the mini player can't follow to another site) or let the browser
  // go back as usual.
  back: function () {
    var o = fullPlayer();
    if (o && o.handleBackAction() === 'handled') return 'handled';
    if (pages.depth() > 0) { window.history.back(); return 'handled'; }
    var open = overlay();
    return open && open.isOpen() ? 'exit' : 'unhandled';
  },

  // Pull-to-refresh while the full player shows a working video belongs to the player (swipe down shrinks it).
  canRefresh: function () {
    var o = fullPlayer();
    return !o || playbackError(activeDocument());
  },

  // Full player with a playback error: load the same video again. Otherwise refresh the current YouTube page through
  // its router (Home, search, History, a channel…); the mini player keeps playing. If the router isn't running (the
  // page failed to load), nothing takes the click and the browser reloads the page instead.
  refresh: function () {
    var o = fullPlayer();
    if (o) {
      if (playbackError(activeDocument()) && typeof o.reload === 'function') return o.reload();
      if (typeof o.minimize === 'function') o.minimize();
      return true;
    }
    return refreshPage();
  },

  // Shows only the player, for picture-in-picture.
  pip: {
    enter: function () {
      var o = overlay();
      if (o && o.isOpen() && o.mode() === 'mini' && typeof o.expand === 'function') o.expand();
      var doc = activeDocument();
      var video = doc.querySelector('video');
      if (!video || pipRestore) return !!pipRestore;
      pipRestore = [];
      var keep = video.closest('#player, #player-container, #movie_player, ytd-player, ytm-player') || video.parentElement;
      Array.prototype.forEach.call(doc.body.children, function (node) {
        if (node === keep || node.contains(keep)) return;
        pipRestore.push([node, node.getAttribute('style')]);
        node.style.display = 'none';
      });
      for (var cursor = keep; cursor && cursor !== doc.body; cursor = cursor.parentElement) {
        pipRestore.push([cursor, cursor.getAttribute('style')]);
        cursor.style.position = 'fixed';
        cursor.style.inset = '0';
        cursor.style.width = '100vw';
        cursor.style.height = '100vh';
        cursor.style.zIndex = '2147483647';
      }
      return true;
    },
    exit: function () {
      if (!pipRestore) return false;
      pipRestore.forEach(function (entry) {
        if (entry[1] === null) entry[0].removeAttribute('style'); else entry[0].setAttribute('style', entry[1]);
      });
      pipRestore = null;
      return true;
    }
  }
});
