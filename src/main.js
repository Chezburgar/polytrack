import { App } from './app.js';

function fail(msg) {
  const boot = document.getElementById('boot');
  if (boot) boot.querySelector('.boot-msg').textContent = msg;
}

try {
  const test = document.createElement('canvas');
  if (!(test.getContext('webgl2') || test.getContext('webgl'))) throw new Error('WebGL is not available in this browser.');
  const app = new App();
  window.__POLY = app.devHandle();
  app.start();
} catch (e) {
  console.error(e);
  fail(e.message || String(e));
}
