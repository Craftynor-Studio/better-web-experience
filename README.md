# Better Web Experience

An **Experience** is a small package of scripts that makes a website behave more like an app on a phone: for example,
videos open over the feed with a draggable mini player, and the system media notification gets full controls.

Each Experience declares the sites it runs on, its scripts, the hooks it implements and its settings. Any browser or
WebView app can load these packages by following the format and script API below.

## Layout

```
<id>/experience.json   description, sites, scripts, capabilities, options
<id>/*.js              the scripts it names
<id>/README.md         what the Experience does and how (not published to apps)
tests/                 checks every package (node --test)
```

`<id>` is lowercase letters, digits and hyphens, starting with a letter (at most 32 characters), and matches the
`id` inside `experience.json`.

## experience.json

```json
{
  "id": "youtube",
  "name": "YouTube",
  "description": "One or two sentences shown to users.",
  "version": 1,
  "sites": ["youtube.com", "*.youtube.com"],
  "scripts": [
    { "file": "media.js", "run": "document_start" },
    { "file": "overlay.js", "run": "page_ready" }
  ],
  "capabilities": ["media", "pull-to-refresh"],
  "options": []
}
```

| Field | Rules |
|---|---|
| `name` | Up to 60 characters. |
| `description` | Up to 300 characters. |
| `version` | Whole number, raised by the release script whenever a file of the package changes. |
| `sites` | 1–32 host patterns. `example.com` means that host only; `*.example.com` means any subdomain of it, not the bare domain. Only `https` pages match. |
| `scripts` | 1–16 files, run in the order listed. `document_start`: before the page's own scripts. `page_ready`: once the document has loaded (DOMContentLoaded). Scripts run in the top frame only. |
| `capabilities` | What the package asks of the browser: `media`, `pull-to-refresh` (see below). A browser ignores names it doesn't know. |
| `options` | Optional user settings (see below). |

Every Experience also has one **master switch**; it isn't declared here. When it is off, no script runs.

## Options

```json
"options": [
  { "id": "overlay", "title": "Open videos over the feed", "description": "…", "mode": "switch", "default": true,
    "disables": ["mutedStart"] },
  { "id": "mutedStart", "title": "Start muted", "mode": "switch" },
  { "id": "quality", "title": "Preferred quality", "mode": "select", "default": "auto",
    "choices": [{ "value": "auto", "title": "Auto" }, { "value": "hd", "title": "HD" }] },
  { "id": "hidden", "title": "Hidden channels", "mode": "texts", "enabledWhen": { "overlay": true } }
]
```

| Mode | Value | Default if omitted |
|---|---|---|
| `switch` | `true` / `false` | `false` |
| `text` | one line, up to 500 characters | `""` |
| `texts` | a list of up to 50 lines | `[]` |
| `select` | one of `choices[].value` (2–30 choices) | the first choice |

Rules between options:

- `disables` (switches only): while this switch is on, the listed options are turned off. It may only name options
  declared **after** it.
- `enabledWhen`: this option is on only while each named option has the given value. It may only name options declared
  **before** it.
- An option that is turned off is not passed to the scripts at all (`experience.options.id` is `undefined`).
- Up to 40 options. Ids are letters, digits and `_`, starting with a letter.

## Script API

Each script is wrapped by the browser and receives one object, `experience`:

```js
experience.options      // the resolved option values (read-only)
experience.register({   // call once
  media: {                 // capability "media"
    state() { return { found, playing, title, artist, artworkUrl, url, positionMs, durationMs, canNext, canPrevious }; },
    play() {}, pause() {}, next() {}, previous() {}, seek(positionMs) {}
  },
  pullToRefresh: true      // capability "pull-to-refresh"
});
```

- **media**: the browser asks for `state()` about every 1.5 s while the page plays media, for the notification and
  lock screen. Only the fields it returns count; the browser fills the rest from the site's own Media Session
  (`navigator.mediaSession`), then from the media element, the page title and `og:image`. So a site whose Media
  Session is complete needs no `media` hook. `canNext` / `canPrevious` show those buttons. Notification commands go to
  the hook first; one the hook doesn't have goes to the site's Media Session handler, then to the media element.
- **pull-to-refresh**: `pullToRefresh: true` means the page draws pull-to-refresh itself, so the browser turns its own
  off. The browser checks once after each page load; if that load failed, the browser keeps its own so the page can
  still be reloaded.

Back is always the browser's ordinary Back through the page's history. A script that wants Back to close something
(a player, a sheet) adds a history entry when it opens it and closes it on `popstate`.

The browser calls hooks from outside the page and accepts only small JSON-compatible results.

## Security rules

Experiences run inside signed-in pages, so every pull request is reviewed against these rules. The tests enforce the
first group.

- No network requests: no `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, no loading
  scripts, styles, frames or images from other hosts.
- No running fetched or built code: no `eval`, `new Function`, string `setTimeout`/`setInterval`, `import()`.
- No access to `document.cookie`, `localStorage` or `sessionStorage` of the site, and no reading form fields.
- Change only what the Experience describes. No tracking, analytics, ads or hidden behavior.
- Keep scripts readable: no minified or obfuscated code.

## Contributing

1. Fork the repo and create a branch.
2. Add or change a package folder. Don't change `version`; the release script raises it.
3. Run `node --test` (Node 20 or newer, no dependencies).
4. Open a pull request describing what changes for users and how you tested it in the browser.

## Using the releases

Released packages are served from the `gh-pages` branch at `https://craftynor-studio.github.io/better-web-experience/`:

```
manifest.json          the catalog (below)
manifest.sig           base64 ECDSA P-256 / SHA-256 signature (DER) of the exact manifest.json bytes
<id>/<file>            the package files, byte for byte as listed
```

```json
{
  "format": "better-web-experience",
  "version": 1,
  "published": 1792858538552,
  "source": "<commit of main>",
  "experiences": [
    { "id": "youtube", "version": 1, "minApp": 1, "disabled": false, "fingerprint": "<sha256>",
      "files": [{ "name": "youtube/experience.json", "sha256": "<sha256>" }] }
  ]
}
```

An app that loads these packages should:

1. Download `manifest.json` and `manifest.sig`, and verify the signature with the public key below before reading
   anything else. Reject any other `format` or `version`.
2. Install a package only if every listed file matches its `sha256`. `experience.json` inside must have the same `id`
   as the catalog entry.
3. Treat `disabled: true` as "switch this package off". `minApp` is a version number the app may compare with its
   own; apps that don't use it can ignore it.
4. Check again regularly (for example daily) and replace a package only when its `version` rises.

Public key (X.509 SubjectPublicKeyInfo, base64):

```
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2DxR/nKeG/E1jZkzGtjEWqPGgm+nAI4xaj7kptVl8piy9/SKgs2ZvbZavcx9gg5rBy+xB9N/qGk36Ai/IK9hrA==
```

Apps can also build and sign the packages themselves from this repo with their own key.

## Releases

Maintainers raise the versions of changed packages and publish them to `gh-pages` with a new signed `manifest.json`.

## License

MIT. See [LICENSE](LICENSE).
