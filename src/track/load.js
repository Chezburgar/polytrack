// Builds everything the simulation needs for a track: centreline, geometry,
// collision world and AI racing data. Pure data - no rendering - so the
// headless validator and the game share it.
import { buildTrack, SURF } from './builder.js';
import { buildTrackGeometry } from './geometry.js';
import { getTheme } from './themes.js';
import { CollisionWorld } from '../physics/world.js';
import { computeRacingLine, computeSpeedProfile } from '../game/ai.js';
import { makeTerrain } from './terrain.js';

export function groundFor(theme) {
  if (theme.ground === 'void') return null;
  if (theme.ground === 'water' || theme.ground === 'lava') return { y: -2.2, mat: SURF.kill };
  if (theme.ground === 'sand') return { y: -0.03, mat: SURF.sand };
  return { y: -0.03, mat: SURF.grass };
}

export function loadTrack(def) {
  const track = buildTrack(def);
  const theme = getTheme(def.theme);
  const geo = buildTrackGeometry(track, theme);
  const world = new CollisionWorld();
  world.addSoup(geo.collision.pos, geo.collision.mat);
  // terrain near the course is solid too (same triangles the renderer draws)
  const terrain = makeTerrain(track, theme);
  if (terrain.grid && !terrain.wet) {
    const { X, Z, H } = terrain.grid;
    const mat = theme.ground === 'sand' ? SURF.sand : SURF.grass;
    const b = track.bounds, m = 90;
    terrain.forEachTri((a, bq, c) => {
      const x = (X[a] + X[bq] + X[c]) / 3, z = (Z[a] + Z[bq] + Z[c]) / 3;
      if (x < b.minX - m || x > b.maxX + m || z < b.minZ - m || z > b.maxZ + m) return;
      if (H[a] + H[bq] + H[c] === 0) return; // flat ground is the plane below
      const near = terrain.index.nearest(x, z, m);
      if (!near) return;
      world.addTri(X[a], H[a], Z[a], X[bq], H[bq], Z[bq], X[c], H[c], Z[c], mat);
    });
  }
  world.ground = groundFor(theme);
  world.build(8);
  const line = computeRacingLine(track);
  const speeds = computeSpeedProfile(track, line);
  return { def, track, theme, geo, world, line, speeds, terrain };
}
