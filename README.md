# PolyTrack

A low-poly 3D racing game for the browser: 20 tracks across nine themes, a
track builder for your own, eight car bodies with a full garage, AI opponents,
ghosts and medals, and online multiplayer for up to eight players. No install,
no build step, no accounts.

## Play

Serve the folder with any static web server and open `index.html`:

```
npm install     # only needed for the dev tools
npm start       # http://localhost:5180
```

It also runs from GitHub Pages or any static host as-is.

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate / brake-reverse | W S or arrows | RT / LT |
| Steer | A D or arrows | left stick |
| Drift (handbrake) | Space or Shift | RB |
| Restart (time trial) | Backspace | Back |
| Camera | C | X |
| Look back | Q | |
| Chat (online) | Enter or T | |
| Pause | Esc or P | Start |

Touch screens get on-screen controls automatically.

**Track limits.** There is no manual respawn. Leave the road and a 3 second
clock starts: get back on, or you are put back on the road where you left it.
Water, lava and falling out of the world put you back at once; skipping a
checkpoint or cutting across the infield sends you back too.

**Cars touch.** Bumping and rubbing push cars apart (a car that has just been
put back, or has finished, is see-through and passes through others until it
is clear). Online, each player's car is shown where it is now, not where it
was, so contact lines up with what you see.

**Jumps.** In the air the car lines itself up with its flight path and the road
it will land on; brake lifts the nose, accelerate dips it a touch, steering turns
it while held. On a ramp, steering is softened so jumps launch where the ramp
points. Braking cancels a boost pad's push.

## Modes

- **Time Trial** - race the clock; your best run is saved as a ghost and earns
  bronze / silver / gold / author medals.
- **Race vs AI** - one to seven bots at four difficulty levels, laps adjustable
  on circuits.
- **Multiplayer** - create a room and share its five-letter code (or the invite
  link). Players connect peer-to-peer through the public PeerJS broker; the host
  relays positions and runs any AI drivers, and the race clock is the host's, so
  finish times are fair. Chat in the lobby (with quick messages) and during the
  race. The host can pick any of their own tracks; it is sent to everyone.
  `?net=local` swaps in a same-browser transport for testing with two tabs.

## Track Builder

Build a track piece by piece over a live 3D preview: straights, left/right turns
(angle, radius, banking), hills, ramp + gap jumps, loops, road width, surfaces
(asphalt, dirt, ice, sand, grass), barriers, checkpoints, boost pads and tunnels,
in any of the nine sceneries. Circuits close themselves (the gold section at the
end is the shortest smooth way back to the start line); every change is checked
for roads that run into each other and other trouble. Tracks save in the browser
as you go.

- **Test drive** jumps straight into a time trial and back.
- **AI test** lets a bot race it to prove it can be finished and set medal times.
- **Share** gives a track code (`PT1.…`) or a `.polytrack.json` file;
  **Import** takes either (or drop the file on the window).
- Your tracks appear under **My tracks** in track select and in the multiplayer
  host's track list.

## Tracks

Tracks are written as piece lists in `src/track/tracks.js`, e.g.

```js
'S 80', 'R 90 r50 b10', 'K 12 a12', 'J 30 d4', 'LOOP r12', 'S ? boost'
```

(straights, turns with radius/bank, kicker ramps, jump gaps, loops, boost pads,
ice/dirt surfaces, tunnels, checkpoints). Built-in circuits close by solving
two `S ?` straights; custom ones get an automatic closing section
(`src/track/custom.js`). The grammar is documented at the top of
`src/track/builder.js`.

## Development tools

- `node tools/check.mjs` - syntax-checks every module and builds all tracks,
  flagging roads that cross at the same height.
- `node tools/sim.mjs [trackId...]` - an AI driver races each track on the real
  physics (with boost pads and the live track-limit rules) and must finish
  without being put back (`--trace` prints its state). The track builder's AI
  test runs the same code (`src/game/verify.js`).
- `node tools/medals.mjs` - regenerates medal times from AI runs.
- `node tools/physics-test.mjs` - acceleration, braking, cornering and drift checks.
- `node tools/browse.mjs <script>` - drives the game in headless Chrome and saves
  screenshots to `.shots/` (see `.scratch/` for examples; not committed). It opens
  the local server by default; `--url=https://chezburgar.github.io/polytrack/` tests the live site.
- `dev/preview.html` - top-down map and elevation profile of every track.
- `npm run vendor` - recopies three.js and PeerJS from `node_modules` into `vendor/`.

## Layout

```
src/physics   car (raycast suspension, tyre model, air + ramp assists), car contact, collision world
src/track     piece builder, road geometry, terrain, themes, the 20 tracks, medals, custom tracks
src/game      race session, checkpoints/laps, track limits, AI driver, camera, ghosts, verifier
src/render    renderer + bloom, sky, scenery, props, effects
src/car       procedural car bodies, liveries, presets
src/net       PeerJS / BroadcastChannel transports, room + race protocol
src/ui        screens (incl. the track builder), HUD, chat, touch controls, styles
src/core      input, audio (synthesised engines/tyres/effects, menu music)
assets/audio  the menu music
```

Everything visual is generated in code, and so is every sound except the menu
music; the only third-party code is three.js and PeerJS in `vendor/`.
