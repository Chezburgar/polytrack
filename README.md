# PolyTrack

A low-poly 3D racing game for the browser: 20 tracks across nine themes, eight
car bodies with a full garage, AI opponents, ghosts and medals, and online
multiplayer for up to eight players. No install, no build step, no accounts.

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
| Respawn at last checkpoint | R or Enter | B |
| Restart (time trial) | Backspace | Back |
| Camera | C | X |
| Look back | Q | |
| Pause | Esc or P | Start |

Touch screens get on-screen controls automatically.

In the air, accelerate/brake pitch the car and steering spins it. Respawning
keeps the speed you crossed the checkpoint with, so a failed jump can be retried.

## Modes

- **Time Trial** - race the clock; your best run is saved as a ghost and earns
  bronze / silver / gold / author medals.
- **Race vs AI** - one to seven bots at four difficulty levels, laps adjustable
  on circuits.
- **Multiplayer** - create a room and share its five-letter code (or the invite
  link). Players connect peer-to-peer through the public PeerJS broker; the host
  relays positions and runs any AI drivers. Cars are ghosts to each other, as in
  Trackmania, and the race clock is the host's, so finish times are fair.
  `?net=local` swaps in a same-browser transport for testing with two tabs.

## Tracks

Tracks are written as piece lists in `src/track/tracks.js`, e.g.

```js
'S 80', 'R 90 r50 b10', 'K 12 a12', 'J 30 d4', 'LOOP r12', 'S ? boost'
```

(straights, turns with radius/bank, kicker ramps, jump gaps, loops, boost pads,
ice/dirt surfaces, tunnels, checkpoints). Circuits close themselves by solving the
two `S ?` straights. The grammar is documented at the top of `src/track/builder.js`.

## Development tools

- `node tools/check.mjs` - syntax-checks every module and builds all tracks,
  flagging roads that cross at the same height.
- `node tools/sim.mjs [trackId...]` - an AI driver races each track on the real
  physics and must finish without respawning (`--trace` prints its state).
- `node tools/medals.mjs` - regenerates medal times from AI runs.
- `node tools/physics-test.mjs` - acceleration, braking, cornering and drift checks.
- `node tools/browse.mjs <script>` - drives the game in headless Chrome and saves
  screenshots to `.shots/` (see `.scratch/` for examples; not committed). It opens
  the local server by default; `--url=https://chezburgar.github.io/polytrack/` tests the live site.
- `dev/preview.html` - top-down map and elevation profile of every track.
- `npm run vendor` - recopies three.js and PeerJS from `node_modules` into `vendor/`.

## Layout

```
src/physics   car (raycast suspension, tyre model, stability assist), collision world
src/track     piece builder, road geometry, terrain, themes, the 20 tracks, medals
src/game      race session, checkpoints/laps, AI driver, camera, ghosts, respawn rules
src/render    renderer + bloom, sky, scenery, props, effects
src/car       procedural car bodies, liveries, presets
src/net       PeerJS / BroadcastChannel transports, room + race protocol
src/ui        screens, HUD, touch controls, styles
src/core      input, procedural audio (engine, tyres, music)
```

Everything visual and audible is generated in code; the only third-party files
are three.js and PeerJS in `vendor/`.
