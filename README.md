# PolyTrack Pro

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

**Pre-race intro.** Races against other cars open with 30 seconds of TV-style
build-up to one of the intro songs (a different one from last time): a flyover of the track (its name, then its jumps, loops
and tunnels), then the camera finds every racer on the grid, back row first, and
names them - the song drops on the first - and ends on your car, settling into
the chase camera as the countdown starts. Space, Esc, a click or the pad's A
skips it; Settings turns it off (`?nointro` skips it once). Time trials and
restarts go straight to the countdown.

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

**Finishing.** Cross the line and your car throws itself into a drift and slides
to a stop (in slow motion, except online) while the camera swings round and a
full-screen FINISH (or VICTORY) card shows your place and time; then the results.

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
  link). Players connect peer-to-peer through the public PeerJS broker, with
  Metered TURN relays for networks that block direct connections; the host
  relays positions and runs any AI drivers, and the race clock is the host's, so
  finish times are fair. Chat in the lobby (with quick messages) and during the
  race. The host can pick any of their own tracks; it is sent to everyone. With
  the host's pre-race intro on, the start waits for it and everyone watches it
  together (skip it and a clock counts down to the start).
  `?net=local` swaps in a same-browser transport for testing with two tabs.

## Track Builder

Fly around a 3D world and build a track out of blocks on a 20 m grid, stacked in
4 m layers:

- **Road** - straight, long straight
- **Turns** - hairpin, turn, wide turn, sweeper, S-bends
- **Height** - slopes, steep slopes, big climb and drop
- **Stunts** - ramp and big ramp (leave empty squares after them: that's the
  gap you jump; land on road up to 8 squares on, level or lower), loops
- **Special** - start, checkpoint, finish, boost pad

Each placed block can be given a surface (asphalt, dirt, ice, sand, grass),
barriers, banking on turns and a tunnel. The route is traced from the Start
block along connected road ends: back into the Start makes a circuit, a Finish
block makes a sprint. The glowing line shows the route, blue arrows the open road
ends, red pins the problems. After each block, the build height and direction
follow the road, so a track can be laid down block after block.

| Action | Keys |
| --- | --- |
| Fly | W A S D / arrows, Space up, Shift down |
| Look around | drag with the right or middle mouse button; wheel zooms |
| Place / erase / copy | left click / right click / middle click |
| Pick a block | 1-9 (Tab for the next group) |
| Rotate | R (Shift+R back) |
| Build height | E / Q or Page Up / Page Down |
| Undo / redo | Ctrl+Z / Ctrl+Y |
| Whole track / test drive / help | F / T / H |

Tracks save in the browser as you go. Tracks from the earlier piece-by-piece
builder still race and share; they just can't be opened in this one.

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
`src/track/builder.js`. Builder tracks are block lists (`src/track/blocks.js`)
that the route solver turns into the same piece strings.

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
  the local server at `/?nointro` by default (`--url=/` keeps the pre-race intro);
  `--url=https://chezburgar.github.io/polytrack/` tests the live site.
- `dev/preview.html` - top-down map and elevation profile of every track.
- `npm run vendor` - recopies three.js and PeerJS from `node_modules` into `vendor/`.

## Layout

```
src/physics   car (raycast suspension, tyre model, air + ramp assists), car contact, collision world
src/track     piece builder, road geometry, terrain, themes, the 20 tracks, medals, custom tracks,
              builder blocks + route solver
src/game      race session, checkpoints/laps, track limits, AI driver, camera, ghosts, verifier,
              finish celebration, the pre-race intro
src/render    renderer + bloom, sky, scenery, props, effects
src/car       procedural car bodies, liveries, presets
src/net       PeerJS / BroadcastChannel transports, room + race protocol
src/ui        screens (incl. the track builder), HUD, chat, touch controls, styles
src/core      input, audio (synthesised engines/tyres/effects, menu and intro songs)
assets/audio  the menu song (menu-music.mp3) and the pre-race intro's (menu-2.mp3, prerace-2.mp3)
```

Everything visual is generated in code, and so is every sound except the two
songs; the only third-party code is three.js and PeerJS in `vendor/`.
