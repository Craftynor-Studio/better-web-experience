# YouTube

Makes YouTube in a browser tab work like the YouTube app: videos open over the page with a player you can shrink and
drag, Back and pull-to-refresh behave like an app, and the phone's media notification gets full controls.

Runs on `youtube.com` and its subdomains (including `m.youtube.com`).

## Files

| File | Runs | Does |
|---|---|---|
| `media.js` | document start | Browser hooks (media, back, refresh, pip), page history, auto-unmute |
| `overlay.js` | page ready | The video player over the page: full player, mini player, gestures |

## Video player

- Tapping a video (watch, Shorts or live) opens it over the current page instead of leaving it. The page underneath
  stays as it was.
- **Full player:** swipe down to shrink it to the **mini player**. Sheets inside it (comments, description) close first.
- **Mini player:** drag it anywhere; it docks to the nearest side. Tap to open the full player again; × closes it.
  The page underneath works normally while it plays.
- Videos opened inside the player replace each other; they don't pile up in the browser's history.

## Back

| On screen | Back |
|---|---|
| Full player with a sheet open | Closes the sheet |
| Full player | Shrinks to the mini player |
| Mini player, or no video | Goes back through the YouTube pages of this visit (search, channel, History…) |
| First YouTube page, mini player open | Leaves YouTube (the mini player can't follow to another site) |
| First YouTube page, no video | The browser goes back as usual |

Every page YouTube opens is numbered in its history entry, so Back steps through exactly the pages of this visit,
however they were opened (links, search, tabs).

## Pull-to-refresh

| On screen | Pull down at the top |
|---|---|
| Full player, video working (playing, paused or loading) | Same as swipe down: shrinks to the mini player. Pull-to-refresh is off (`canRefresh` returns `false`), so the swipe goes to the player |
| Full player with a playback error | Loads the same video again in the player; the page underneath is untouched |
| Mini player, or no video | Refreshes the current YouTube page (Home, search, History, a channel…) through YouTube's own router, without reloading the site; the mini player keeps playing |
| The page failed to load, or YouTube isn't responding | The browser reloads the page as usual |

A playback error means the video reports a media error or YouTube shows its error screen. Paused, buffering and
loading don't count.

## Media notification

`media.state()` reports the playing video (title, channel, artwork, position, length), from the player if it's open,
otherwise from the page. Play, pause, next, previous and seeking from the notification control YouTube's player.

## Picture-in-picture

`pip.enter()` opens the full player if the mini player is showing, then shows only the video so the picture-in-picture
window holds just the player. `pip.exit()` restores the page.

## Also

- **Auto-unmute:** YouTube starts some videos muted when they begin without a tap; the script presses unmute.
