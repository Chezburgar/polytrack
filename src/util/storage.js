// localStorage wrapper that never throws (private windows, full quota).
const PREFIX = 'polytrack.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('save failed', key, e);
    return false;
  }
}

export function remove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}
