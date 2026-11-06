import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the adapter's real gesture handlers with a deterministic clock and a small DOM surface.
function fixture() {
  const source = readFileSync(new URL('../youtube/overlay.js', import.meta.url), 'utf8');
  const take = (name, next) => source.slice(source.indexOf(`  function ${name}(`), source.indexOf(`  function ${next}(`));
  let now = 0, id = 0;
  const timers = new Map();
  const metrics = { width: 200, height: 112, margin: 12, maxX: 188, maxY: 600 };
  const api = {}, target = { closest: () => null, setPointerCapture() {} };
  const state = { mode: 'mini', host: {}, miniGestureSurface: { getBoundingClientRect: () => ({ left: 100, top: 300 }) } };
  const context = vm.createContext({ state, api, API_NAME: 'player', Date: { now: () => now }, Math,
    window: { player: api, innerWidth: 400, innerHeight: 800,
      setTimeout(fn, delay) { timers.set(++id, { fn, at: now + delay }); return id; }, clearTimeout(key) { timers.delete(key); } },
    miniMetrics: () => metrics, basePlayerRect: () => ({}), setMiniPosition() {},
    expandByUser() { throw new Error('Holding or dragging must not expand'); }, applyMiniGeometry() {},
  });
  vm.runInContext(take('armMiniHold', 'onFramePointerDown') + take('onFramePointerMove', 'onFramePointerEnd') +
    take('onFramePointerEnd', 'onFramePointerCancel') + take('onFramePointerCancel', 'onMiniSurfacePointerDown') +
    take('onMiniSurfacePointerDown', 'onMiniSurfaceClick'), context);
  const event = (x, y) => ({ button: 0, pointerId: 1, target, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  return { state,
    down(x = 150, y = 350) { context.onMiniSurfacePointerDown(event(x, y)); },
    move(x, y) { context.onFramePointerMove(event(x, y)); },
    up(x, y) { context.onFramePointerEnd(event(x, y)); },
    advance(ms) { now += ms; for (const [key, timer] of [...timers]) if (timer.at <= now && timers.delete(key)) timer.fn(); },
  };
}

test('YouTube: holding for three seconds preserves the exact dragged position', () => {
  const f = fixture(); f.down(); f.move(110, 280); f.advance(3_001); f.up(110, 280);
  assert.equal(f.state.miniX, 60); assert.equal(f.state.miniY, 230);
});
test('YouTube: continued movement resets the hold timer', () => {
  const f = fixture(); f.down();
  for (let step = 1; step <= 5; step++) { f.advance(1_000); f.move(150 + step * 10, 350); }
  assert.notEqual(f.state.gesture.freePosition, true);
  f.up(200, 350);
  assert.equal(f.state.miniX, 188); assert.equal(f.state.miniY, 300);
});
test('YouTube: stationary hold does not expand or jump to a corner', () => {
  const f = fixture(); f.down(); f.advance(3_001); f.up(150, 350);
  assert.equal(f.state.miniX, 100); assert.equal(f.state.miniY, 300);
});
