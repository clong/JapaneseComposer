import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTextSizeControls, normalizeTextSize, TEXT_SIZE_KEY } from '../src/text-size.js';

function fixture({ initial = '100', unavailable = false } = {}) {
  const memory = new Map([[TEXT_SIZE_KEY, initial]]);
  const node = () => ({ attributes: {}, handlers: {}, setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(type, action) { this.handlers[type] = action; } });
  const options = { root: { style: { setProperty(key, value) { this[key] = value; } } }, group: node(), decrease: node(), increase: node(), reset: node(), status: node(),
    read: key => { if (unavailable) throw new Error('blocked'); return memory.get(key); },
    write: (key, value) => { if (unavailable) throw new Error('full'); memory.set(key, value); } };
  return { ...options, memory, controls: createTextSizeControls(options) };
}

test('text size is restored, bounded, and reset without invalid CSS values', () => {
  for (const value of [undefined, null, '', ' ', 'bad', NaN, Infinity, {}, true]) assert.equal(normalizeTextSize(value), 100);
  assert.equal(normalizeTextSize('126'), 130);
  const f = fixture({ initial: '150' });
  assert.equal(f.root.style['--app-text-scale'], '1.5');
  for (let i = 0; i < 4; i++) f.increase.handlers.click();
  assert.equal(f.reset.textContent, '160%');
  assert.equal(f.increase.disabled, true);
  assert.equal(f.memory.get(TEXT_SIZE_KEY), '160');
  for (let i = 0; i < 12; i++) f.decrease.handlers.click();
  assert.equal(f.reset.textContent, '80%');
  assert.equal(f.decrease.disabled, true);
  f.reset.handlers.click();
  assert.equal(f.root.style['--app-text-scale'], '1');
  assert.equal(f.memory.get(TEXT_SIZE_KEY), '100');
});

test('size controls work without storage, translate labels, and follow cross-tab updates', () => {
  const f = fixture({ unavailable: true });
  f.increase.handlers.click();
  assert.equal(f.reset.textContent, '110%');
  f.controls.setLanguage('ja');
  assert.equal(f.increase.attributes['aria-label'], '文字を大きくする');
  f.controls.sync({ key: TEXT_SIZE_KEY, newValue: '140' });
  assert.equal(f.reset.textContent, '140%');
  assert.equal(f.status.textContent, '文字サイズ：140%');
  f.controls.sync({ key: 'another-setting', newValue: '80' });
  assert.equal(f.reset.textContent, '140%');
  f.controls.sync({ key: TEXT_SIZE_KEY, newValue: null });
  assert.equal(f.reset.textContent, '100%');
});
