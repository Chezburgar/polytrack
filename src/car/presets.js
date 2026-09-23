// Colour palettes, preset looks and random bot cars.
import { BODY_IDS } from './bodies.js';
import { LIVERIES } from './livery.js';
import { RIMS, SPOILERS, FINISHES } from './model.js';

export const SWATCHES = [
  '#e8433a', '#ff6b3d', '#f39c34', '#f4d03f', '#c8e04a', '#3bbf6a', '#1f9e5a', '#1fb5a8',
  '#39c6f0', '#2f86eb', '#2346b8', '#5b5fe0', '#9b59d6', '#d23fbe', '#e84393', '#ff8fb1',
  '#f4f4f4', '#c9ced6', '#9aa3ad', '#5d6570', '#2b2f36', '#15171c', '#6b4a2a', '#c9a36a',
];

export const GLOWS = ['none', '#39e6ff', '#ff3df0', '#3dff8b', '#ffb13d', '#ff3d3d', '#8a5cff', '#ffffff'];

export const BOT_NAMES = [
  'Nova', 'Blitz', 'Kestrel', 'Vector', 'Echo', 'Jinx', 'Rook', 'Sable', 'Comet', 'Drift', 'Pixel',
  'Turbo', 'Zephyr', 'Onyx', 'Viper', 'Axel', 'Mako', 'Ember', 'Flux', 'Quill',
];

export const PRESETS = [
  { name: 'Classic Red', car: { body: 'bolt', paint: '#e8433a', accent: '#f4f4f4', livery: 'stripes', finish: 'gloss', rim: 'sport', rimColor: '#c9ced6', spoiler: 'wing' } },
  { name: 'Midnight', car: { body: 'vortex', paint: '#15171c', accent: '#39e6ff', livery: 'hex', finish: 'satin', rim: 'turbine', rimColor: '#2b2f36', spoiler: 'none', underglow: '#39e6ff', trail: '#39e6ff' } },
  { name: 'Rally Legend', car: { body: 'rally', paint: '#2346b8', accent: '#f4d03f', livery: 'side', finish: 'gloss', rim: 'classic', rimColor: '#f4f4f4', spoiler: 'lip', showNumber: true } },
  { name: 'Hot Rod', car: { body: 'brute', paint: '#f39c34', accent: '#15171c', livery: 'flames', finish: 'metallic', rim: 'mesh', rimColor: '#dfe3ea', spoiler: 'duck' } },
  { name: 'Grand Prix', car: { body: 'formula', paint: '#f4f4f4', accent: '#e8433a', livery: 'split', finish: 'gloss', rim: 'disc', rimColor: '#15171c' } },
  { name: 'Sandstorm', car: { body: 'buggy', paint: '#c9a36a', accent: '#6b4a2a', livery: 'camo', finish: 'matte', rim: 'classic', rimColor: '#2b2f36' } },
  { name: 'Chrome Dream', car: { body: 'retro', paint: '#c9ced6', accent: '#2f86eb', livery: 'none', finish: 'chrome', rim: 'mesh', rimColor: '#dfe3ea', spoiler: 'none' } },
  { name: 'Voltage', car: { body: 'cyber', paint: '#9aa3ad', accent: '#c8e04a', livery: 'bolt', finish: 'satin', rim: 'disc', rimColor: '#5d6570', spoiler: 'none', underglow: '#3dff8b', trail: '#3dff8b' } },
];

export function randomBotCar(rnd) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const paint = pick(SWATCHES.slice(0, 20));
  let accent = pick(SWATCHES);
  if (accent === paint) accent = '#f4f4f4';
  const finishes = Object.keys(FINISHES).filter((f) => f !== 'chrome');
  return {
    body: pick(BODY_IDS), paint, accent, detail: '#15171c', finish: pick(finishes),
    livery: pick(LIVERIES).id, showNumber: rnd() < 0.6, number: 1 + Math.floor(rnd() * 99),
    rim: pick(RIMS), rimColor: pick(['#c9ced6', '#15171c', '#dfe3ea', '#f4d03f', '#2b2f36', accent]),
    spoiler: pick(SPOILERS), underglow: rnd() < 0.2 ? pick(GLOWS.slice(1)) : 'none', trail: pick(GLOWS.slice(1)), tint: 'dark',
  };
}
