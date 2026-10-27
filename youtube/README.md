# YouTube

Makes YouTube in a browser tab work like the YouTube app: videos open over the page with a player you can shrink and
drag, Back and pull-to-refresh behave like an app, and the phone's media notification gets full controls.

Runs on `youtube.com` and its subdomains (including `m.youtube.com`).

## Files

| File | Runs | Does |
|---|---|---|
| `media.js` | document start | Media hooks, the history guard for the player's entries, auto-unmute |
| `overlay.js` | page ready | The video player over the page (full player, mini player, gestures), its history entries, pull-to-refresh |

## Video player

- Tapping a video (watch, Shorts or live) opens it over the current page instead of leaving it. The page underneath
  stays as it was.
- **Full player:** swipe down to shrink it to the **mini player**.
- **Mini player:** drag it anywhere; it docks to the nearest corner. Tap to open the full player again; × or a swipe
  down off the bottom closes it. The page underneath works normally while it plays.
- Videos opened inside the player replace each other; they don't pile up in history.

## Back

Back is the browser's ordinary Back. The player's states are entries in the page's history, so Back walks them:

| On screen | Back |
|---|---|
| Full player with a sheet open (comments, description, settings) | Closes the sheet |
| Full player | Shrinks to the mini player |
| Mini player, on the page it was opened from | Closes the mini player |
| Mini player, on a page opened later | Goes back to the previous YouTube page; the mini player keeps playing |
| No video | Goes back through YouTube's pages, then leaves YouTube |

How the entries work:

- Opening a video over page X adds two entries on top of X: "mini player" and "full player". Both keep X's address
  and YouTube's own state for it.
- Opening a sheet in the full player adds a "sheet" entry.
- When the player changes without Back (swipe down, ×, a sheet closed by tapping), its entry is removed with a silent
  step back, so no Back press ever lands on an entry that does nothing.
- `media.js` runs before YouTube's scripts and sees every `popstate` first. Moves between the player's entries of the
  same page are kept from YouTube's router, so the page underneath doesn't reload. YouTube's own `replaceState` on such
  an entry keeps the entry's mark.

## Pull-to-refresh

The script draws pull-to-refresh itself (`pullToRefresh: true`), so the browser turns its own off on YouTube pages
that loaded. The gesture and spinner follow the browser's: start in the top sixth of a page scrolled to the top, pull
down, release past the line.

| On screen | Pull down |
|---|---|
| No video | Reloads the page |
| Mini player | YouTube's router opens the current page again, so the video keeps playing. If the router doesn't take it (YouTube isn't responding), the page reloads |
| Full player, video working (playing, paused or loading) | The swipe down shrinks it to the mini player |
| Full player with a playback error | Loads the same video again in the player; the page underneath is untouched |
| The page failed to load | The browser's own pull-to-refresh reloads it |

A playback error means the video reports a media error or YouTube shows its error screen. Paused, buffering and
loading don't count.

## Media notification

`media.state()` reports the playing video (title, channel, artwork, position, length, next and previous), from the
player if it's open, otherwise from the page. Play, pause, next, previous and seeking from the notification control
YouTube's player.

## Also

- **Auto-unmute:** YouTube starts some videos muted when they begin without a tap; the script presses unmute.
