export const TEXT_SIZE_KEY = 'jc_text_size';
export const MIN_TEXT_SIZE = 80;
export const MAX_TEXT_SIZE = 160;
export const TEXT_SIZE_STEP = 10;

export function normalizeTextSize(value) {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number) || value === null || value === undefined || (typeof value === 'string' && !value.trim())) return 100;
  return Math.max(MIN_TEXT_SIZE, Math.min(MAX_TEXT_SIZE, Math.round(number / TEXT_SIZE_STEP) * TEXT_SIZE_STEP));
}

const labels = {
  en: { group: 'Text size', decrease: 'Decrease text size', increase: 'Increase text size', reset: 'Reset text size to 100%', current: 'Text size: {size}%' },
  ja: { group: '文字サイズ', decrease: '文字を小さくする', increase: '文字を大きくする', reset: '文字サイズを100%に戻す', current: '文字サイズ：{size}%' }
};

export function createTextSizeControls({ root, group, decrease, increase, reset, status, read, write, onChange = () => {} }) {
  let size = 100, language = 'en';
  try { size = normalizeTextSize(read(TEXT_SIZE_KEY)); } catch { /* Use the default when browser storage is unavailable. */ }
  function render(announce = false) {
    const copy = labels[language] || labels.en;
    root.style.setProperty('--app-text-scale', String(size / 100));
    group.setAttribute('aria-label', copy.group);
    for (const [button, label] of [[decrease, copy.decrease], [increase, copy.increase], [reset, copy.reset]]) {
      button.setAttribute('aria-label', button === reset ? `${copy.current.replace('{size}', size)}. ${label}` : label);
      button.title = label;
    }
    decrease.disabled = size === MIN_TEXT_SIZE;
    increase.disabled = size === MAX_TEXT_SIZE;
    reset.textContent = `${size}%`;
    if (announce) status.textContent = copy.current.replace('{size}', size);
  }
  function setSize(value, persist = true) {
    size = normalizeTextSize(value);
    if (persist) try { write(TEXT_SIZE_KEY, String(size)); } catch { /* Sizing still works without persistence. */ }
    render(true);
    onChange();
  }
  decrease.addEventListener('click', () => setSize(size - TEXT_SIZE_STEP));
  increase.addEventListener('click', () => setSize(size + TEXT_SIZE_STEP));
  reset.addEventListener('click', () => setSize(100));
  render();
  return {
    setLanguage(value) { language = value; render(); },
    sync(event) { if (event.key === TEXT_SIZE_KEY || event.key === null) setSize(event.newValue, false); }
  };
}
