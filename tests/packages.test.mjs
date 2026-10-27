// Checks every package folder against the format rules in README.md, plus the security rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const OPTION_ID = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const SCRIPT = /^[a-z0-9][a-z0-9_-]{0,47}\.js$/;
const FILE = /^[a-z0-9][a-z0-9_-]{0,47}\.(js|json)$/;
const SITE = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// What each capability asks the package to register. Capabilities a browser doesn't know are ignored by it.
const CAPABILITIES = new Map([['media', 'media'], ['pull-to-refresh', 'pullToRefresh']]);
const MODES = new Set(['switch', 'text', 'texts', 'select']);
const FORBIDDEN = [
  [/\bfetch\s*\(/, 'fetch'], [/\bXMLHttpRequest\b/, 'XMLHttpRequest'], [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'], [/\bsendBeacon\b/, 'sendBeacon'], [/\beval\s*\(/, 'eval'],
  [/\bnew\s+Function\b/, 'new Function'], [/\bimport\s*\(/, 'import()'], [/document\s*\.\s*cookie/, 'document.cookie'],
  [/\blocalStorage\b/, 'localStorage'], [/\bsessionStorage\b/, 'sessionStorage'],
  [/set(Timeout|Interval)\s*\(\s*['"`]/, 'string timer'], [/importScripts/, 'importScripts'],
];

export const packages = () => readdirSync(root)
  .filter((name) => !name.startsWith('.') && statSync(join(root, name)).isDirectory() && existsSync(join(root, name, 'experience.json')));

function value(mode, choices, v) {
  if (mode === 'switch') return typeof v === 'boolean';
  if (mode === 'text') return typeof v === 'string' && v.length <= 500;
  if (mode === 'texts') return Array.isArray(v) && v.length <= 50 && v.every((s) => typeof s === 'string' && s.length <= 500);
  return typeof v === 'string' && choices.some((c) => c.value === v);
}

function checkOptions(options) {
  assert.ok(Array.isArray(options) && options.length <= 40, 'options: up to 40');
  const seen = [];
  options.forEach((o, index) => {
    assert.match(o.id, OPTION_ID, `option id ${o.id}`);
    assert.ok(!seen.some((s) => s.id === o.id), `duplicate option ${o.id}`);
    assert.ok(MODES.has(o.mode), `${o.id}: unknown mode`);
    assert.ok(typeof o.title === 'string' && o.title.trim() && o.title.length <= 60, `${o.id}: title`);
    const choices = o.choices || [];
    if (o.mode === 'select') {
      assert.ok(choices.length >= 2 && choices.length <= 30, `${o.id}: 2-30 choices`);
      assert.equal(new Set(choices.map((c) => c.value)).size, choices.length, `${o.id}: duplicate choice`);
    }
    if ('default' in o) assert.ok(value(o.mode, choices, o.default), `${o.id}: invalid default`);
    for (const [key, wanted] of Object.entries(o.enabledWhen || {})) {
      const target = seen.find((s) => s.id === key);
      assert.ok(target, `${o.id}: enabledWhen must name an earlier option`);
      assert.ok(value(target.mode, target.choices || [], wanted), `${o.id}: invalid enabledWhen value`);
    }
    if (o.disables?.length) assert.equal(o.mode, 'switch', `${o.id}: only a switch can disable`);
    seen.push(o);
    (o.disables || []).forEach((target) => assert.ok(options.findIndex((x) => x.id === target) > index, `${o.id}: disables must name later options`));
  });
}

for (const id of packages()) {
  test(`${id}: experience.json`, () => {
    assert.match(id, ID);
    const e = JSON.parse(readFileSync(join(root, id, 'experience.json'), 'utf8'));
    assert.equal(e.id, id, 'id matches the folder');
    assert.ok(Number.isInteger(e.version) && e.version >= 1, 'version');
    assert.ok(typeof e.name === 'string' && e.name.trim() && e.name.length <= 60, 'name');
    assert.ok(typeof e.description === 'string' && e.description.trim() && e.description.length <= 300, 'description');
    assert.ok(Array.isArray(e.sites) && e.sites.length >= 1 && e.sites.length <= 32, 'sites');
    e.sites.forEach((s) => assert.match(s, SITE, `site ${s}`));
    assert.ok(Array.isArray(e.scripts) && e.scripts.length >= 1 && e.scripts.length <= 16, 'scripts');
    for (const s of e.scripts) {
      assert.match(s.file, SCRIPT, `script ${s.file}`);
      assert.ok(['document_start', 'page_ready', undefined].includes(s.run), `${s.file}: run`);
      assert.ok(existsSync(join(root, id, s.file)), `${s.file} exists`);
    }
    (e.capabilities || []).forEach((c) => assert.ok(CAPABILITIES.has(c), `capability ${c}`));
    checkOptions(e.options || []);
    for (const file of readdirSync(join(root, id))) if (file !== 'README.md') assert.match(file, FILE, `file name ${file}`);
  });

  test(`${id}: scripts follow the security rules and parse`, () => {
    const e = JSON.parse(readFileSync(join(root, id, 'experience.json'), 'utf8'));
    for (const s of e.scripts) {
      const code = readFileSync(join(root, id, s.file), 'utf8');
      for (const [pattern, name] of FORBIDDEN) assert.doesNotMatch(code, pattern, `${s.file} uses ${name}`);
      assert.ok(code.length <= 512 * 1024, `${s.file} is too large`);
      // The browser wraps each script the same way.
      assert.doesNotThrow(() => new vm.Script(`(function (experience) {\n${code}\n})`, { filename: s.file }), `${s.file} parses`);
    }
  });

  test(`${id}: registers the hooks it declares`, () => {
    const e = JSON.parse(readFileSync(join(root, id, 'experience.json'), 'utf8'));
    const registered = {};
    const observer = function () { this.observe = () => {}; this.disconnect = () => {}; };
    const element = () => ({ appendChild() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, style: {} });
    const document = { documentElement: element(), body: element(), head: element(), querySelector: () => null,
      querySelectorAll: () => [], addEventListener() {}, createElement: element, getElementById: () => null };
    const window = { document, addEventListener() {}, location: { hostname: 'example.invalid', href: 'https://example.invalid/' } };
    const context = vm.createContext({ window, document, MutationObserver: observer, location: window.location, console,
      setTimeout, clearTimeout, URL });
    context.window.window = context.window;
    const experience = { options: {}, register: (hooks) => Object.defineProperties(registered, Object.getOwnPropertyDescriptors(hooks)) };
    for (const s of e.scripts) {
      const code = readFileSync(join(root, id, s.file), 'utf8');
      vm.runInContext(`(function (experience) {\n${code}\n})`, context)(experience);
    }
    for (const c of e.capabilities || []) assert.ok(CAPABILITIES.get(c) in registered, `declares ${c} but does not register ${CAPABILITIES.get(c)}`);
  });
}
