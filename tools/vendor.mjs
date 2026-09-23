// Copies the exact three.js and PeerJS files the page loads into vendor/, so the
// game ships with no build step and no CDN dependency. Run after `npm install`.
import { mkdirSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'vendor');

const files = [
  ['three/build/three.module.js', 'three/three.module.js'],
  ['three/build/three.core.js', 'three/three.core.js'],
  ['three/examples/jsm/postprocessing/EffectComposer.js', 'three/addons/postprocessing/EffectComposer.js'],
  ['three/examples/jsm/postprocessing/RenderPass.js', 'three/addons/postprocessing/RenderPass.js'],
  ['three/examples/jsm/postprocessing/ShaderPass.js', 'three/addons/postprocessing/ShaderPass.js'],
  ['three/examples/jsm/postprocessing/MaskPass.js', 'three/addons/postprocessing/MaskPass.js'],
  ['three/examples/jsm/postprocessing/Pass.js', 'three/addons/postprocessing/Pass.js'],
  ['three/examples/jsm/postprocessing/UnrealBloomPass.js', 'three/addons/postprocessing/UnrealBloomPass.js'],
  ['three/examples/jsm/postprocessing/OutputPass.js', 'three/addons/postprocessing/OutputPass.js'],
  ['three/examples/jsm/shaders/CopyShader.js', 'three/addons/shaders/CopyShader.js'],
  ['three/examples/jsm/shaders/LuminosityHighPassShader.js', 'three/addons/shaders/LuminosityHighPassShader.js'],
  ['three/examples/jsm/shaders/OutputShader.js', 'three/addons/shaders/OutputShader.js'],
  ['three/examples/jsm/utils/BufferGeometryUtils.js', 'three/addons/utils/BufferGeometryUtils.js'],
  ['peerjs/dist/peerjs.min.js', 'peerjs.min.js'],
];

let n = 0;
for (const [from, to] of files) {
  const src = join(nm, from);
  if (!existsSync(src)) throw new Error('missing ' + src + ' (run npm install)');
  const dst = join(out, to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  n++;
}
const three = JSON.parse(readFileSync(join(nm, 'three/package.json'), 'utf8')).version;
const peer = JSON.parse(readFileSync(join(nm, 'peerjs/package.json'), 'utf8')).version;
console.log(`vendored ${n} files (three ${three}, peerjs ${peer})`);
