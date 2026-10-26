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

  // 'handled': the overlay closed a sheet or shrank. 'exit': leave the page without WebView history, which would step
  // into the overlay iframe's videos. 'unhandled': the browser goes back as usual.
  back: function () {
    var o = overlay();
    if (!o || typeof o.handleBackAction !== 'function') return 'unhandled';
    return o.handleBackAction();
  },

  // Refresh only YouTube's home feed through its own page router. If the page isn't running (it failed to load),
  // nothing intercepts the click and the browser reloads the page instead.
  refresh: function () {
    var o = overlay();
    if (o && o.isOpen() && o.mode() === 'full' && typeof o.minimize === 'function') o.minimize();
    var link = document.createElement('a');
    link.href = '/';
    link.hidden = true;
    (document.body || document.documentElement).appendChild(link);
    var click = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    link.dispatchEvent(click);
    link.remove();
    if (click.defaultPrevented) window.scrollTo(0, 0);
    return click.defaultPrevented;
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
