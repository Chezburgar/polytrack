// The 30 PolyTrack Pro courses. Each layout is a list of pieces (grammar in
// builder.js). laps: 0 = sprint (start -> finish), >0 = circuit. Circuits close
// automatically through their two "S ?" straights.
// difficulty: 0 easy, 1 medium, 2 hard, 3 expert, 4 extreme.
// pro: the Pro set (21-30), each in its own environment. gravity: a multiplier
// for the whole track (Red Planet runs at half).
export const TRACKS = [
  {
    id: 'green-start', name: 'Green Start', theme: 'meadow', laps: 3, difficulty: 0,
    blurb: 'A gentle warm-up lap through the meadows.',
    pieces: [
      'S 90', 'R 90 r60 b6', 'S 50 u4', 'L 40 r50', 'R 70 r45 cp', 'S 40 d4', 'R 90 r35',
      'S ? boost', 'R 60 r55', 'L 30 r60', 'R 120 r40 cp', 'S ?',
    ],
  },
  {
    id: 'rolling-hills', name: 'Rolling Hills', theme: 'meadow', laps: 0, difficulty: 0,
    blurb: 'Crests, dips and your first jump.',
    pieces: [
      'S 80', 'S 60 u6', 'S 60 d6', 'L 60 r70 b5', 'S 40 u8', 'R 90 r50 cp', 'S 50 d8', 'S 40',
      'K 12 a10', 'J 18 d1', 'S 60', 'R 120 r40 b10', 'S 60 u5 cp', 'S 40 d5', 'L 80 r45', 'R 60 r45',
      'S 60 boost', 'L 40 r80', 'S 80 u3', 'S 40',
    ],
  },
  {
    id: 'meadow-loop', name: 'Loop the Meadow', theme: 'meadow', laps: 3, difficulty: 1,
    blurb: 'Carry your speed into the big loop.',
    pieces: [
      'S 70', 'L 90 r45', 'S 60 u5', 'L 90 r40 b10 cp', 'S 40 d5', 'S 50 boost', 'LOOP r12', 'S 60',
      'L 90 r40', 'S ?', 'R 45 r50', 'L 135 r35 b12 cp', 'S ?',
    ],
  },
  {
    id: 'mesa-run', name: 'Mesa Run', theme: 'desert', laps: 0, difficulty: 1,
    blurb: 'Leap between sandstone plateaus.',
    pieces: [
      'S 70', 'S 50 u8', 'R 60 r80', 'S 65', 'K 12 a12', 'J 26 d3', 'S 60', 'L 150 r45 b10 cp',
      'S 60 u6', 'S 40', 'K 10 a12', 'J 30 d4', 'S 70', 'R 45 r70', 'L 45 r70', 'S 50 boost',
      'R 130 r50 b10 cp', 'S 60 d4', 'S 60 dirt', 'L 70 r45 dirt', 'S 65', 'K 12 a14', 'J 34 d4',
      'S 80',
    ],
  },
  {
    id: 'canyon-drift', name: 'Canyon Drift', theme: 'desert', laps: 3, difficulty: 1,
    blurb: 'Dusty hairpins made for sliding.',
    pieces: [
      'S 80', 'R 90 r30', 'S 40 dirt', 'L 150 r22 dirt', 'S ?', 'R 120 r28 cp', 'S 50 u4', 'R 60 r50',
      'S 40 d4', 'L 60 r35', 'R 150 r26 dirt cp', 'S ?', 'R 60 r45', 'R 90 r40',
    ],
  },
  {
    id: 'dune-jumper', name: 'Dune Jumper', theme: 'desert', laps: 0, difficulty: 2,
    blurb: 'Five jumps. Keep it straight in the air.',
    pieces: [
      'S 60', 'S 40 boost', 'K 12 a12', 'J 28 d2', 'S 60', 'R 100 r50 b10 cp', 'S 40 u3', 'S 35',
      'K 10 a12', 'J 22 d4', 'S 85 cp', 'L 140 r50 b12', 'S 40 dirt', 'S 40 boost', 'K 12 a13',
      'J 32 d3', 'S 70', 'R 45 r70', 'L 45 r70 cp', 'S 80 u7', 'S 50', 'K 10 a10', 'J 26 d6', 'S 95',
      'R 110 r60 b10', 'S 65 boost', 'K 12 a12', 'J 30', 'S 60',
    ],
  },
  {
    id: 'glacier-pass', name: 'Glacier Pass', theme: 'alpine', laps: 0, difficulty: 1,
    blurb: 'Climb through the ice tunnel - mind the frozen corners.',
    pieces: [
      'S 70', 'L 45 r80', 'S 60 u8', 'R 90 r45 b8', 'S 50 u6 tunnel', 'S 40 tunnel cp', 'L 90 r40 ice',
      'S 40 ice', 'R 60 r50', 'S 60 d6', 'L 120 r35 b10 cp', 'S 50 u4', 'R 45 r60', 'S 40 boost',
      'L 45 r60', 'S 60 d6', 'R 90 r40 ice', 'S 65', 'K 12 a10', 'J 22 d2', 'S 60', 'L 60 r60', 'S 50',
    ],
  },
  {
    id: 'summit', name: 'Summit Spiral', theme: 'alpine', laps: 2, difficulty: 2,
    blurb: 'Spiral up the mountain, then plunge back down.',
    pieces: [
      'S 80', 'S 60 u6', 'L 360 r38 u16 b6 cp', 'S 60', 'R 90 r45 b12', 'S ? d6', 'R 90 r40', 'S ? d8',
      'S 60 d8 cp', 'R 90 r50', 'S 60', 'R 90 r50',
    ],
  },
  {
    id: 'palm-beach', name: 'Palm Beach', theme: 'coast', laps: 3, difficulty: 0,
    blurb: 'Sweeping causeways over turquoise water.',
    pieces: [
      'S 100', 'R 60 r80', 'S 60', 'R 60 r80 b6 cp', 'S 50 boost', 'L 40 r90', 'R 130 r50 b8', 'S ?',
      'R 70 r60', 'L 50 r70 cp', 'R 90 r55', 'S ?', 'R 40 r100',
    ],
  },
  {
    id: 'island-hopper', name: 'Island Hopper', theme: 'coast', laps: 0, difficulty: 2,
    blurb: 'Fly from island to island - fall short and you swim.',
    pieces: [
      'S 60', 'S 40 boost', 'K 14 a11', 'J 30 d2', 'S 60', 'L 90 r60 b8', 'S 65', 'K 12 a12', 'J 34',
      'S 60 cp', 'L 90 r55 b10', 'S 40 u6', 'S 20', 'K 12 a12', 'J 36 d6', 'S 70', 'R 60 r70',
      'L 60 r70', 'S 65 boost cp', 'K 14 a12', 'J 40 d3', 'S 70', 'L 80 r50', 'S 40', 'R 40 r60',
      'S 65 boost', 'K 14 a13', 'J 44 d3', 'S 80',
    ],
  },
  {
    id: 'maple-mile', name: 'Maple Mile', theme: 'autumn', laps: 3, difficulty: 1,
    blurb: 'Tunnels and flowing bends under autumn leaves.',
    pieces: [
      'S 80', 'R 90 r50 tunnel cp', 'S 50 tunnel', 'L 45 r40', 'R 45 r40', 'S ? u5', 'R 90 r45 b8',
      'S ? d5 boost cp', 'R 60 r50', 'L 30 r60', 'R 30 r60', 'R 30 r50', 'S 120', 'R 90 r45 b8',
    ],
  },
  {
    id: 'leaf-storm', name: 'Leaf Storm', theme: 'autumn', laps: 0, difficulty: 2,
    blurb: 'Tight switchbacks through the woods.',
    pieces: [
      'S 60', 'R 90 r30 w12', 'L 90 r30', 'S 40', 'R 120 r25 b8', 'S 50 u5 cp', 'L 60 r35', 'R 60 r35',
      'L 60 r35', 'S 40 d5', 'R 150 r24', 'S 60 boost', 'L 90 r40 cp', 'S 40 w14', 'R 45 r50', 'L 90 r30',
      'R 90 r30', 'S 50', 'L 140 r26 b10', 'S 60 boost', 'R 60 r45', 'S 50',
    ],
  },
  {
    id: 'neon-boulevard', name: 'Neon Boulevard', theme: 'neon', laps: 3, difficulty: 1,
    blurb: 'Right angles and boost strips downtown.',
    pieces: [
      'S 100 boost', 'R 90 r28', 'S 60', 'L 90 r28', 'S 50 cp', 'R 90 r28', 'S ?', 'R 90 r35 b6',
      'S ? boost', 'R 90 r28 cp', 'S 60', 'L 90 r28', 'S 40', 'R 90 r28', 'S 60', 'R 90 r30',
    ],
  },
  {
    id: 'overdrive', name: 'Overdrive', theme: 'neon', laps: 0, difficulty: 2,
    blurb: 'Three loops, two jumps, no brakes.',
    pieces: [
      'S 60', 'S 50 boost', 'LOOP r12', 'S 60', 'R 90 r40 b10', 'S 65 u8', 'K 12 a12', 'J 30 d8',
      'S 60 boost cp', 'L 90 r35', 'S 40', 'LOOP r13 o-18', 'S 60 cp', 'R 60 r50', 'L 60 r50',
      'S 65 boost', 'K 12 a12', 'J 34', 'S 60', 'R 120 r40 b12', 'S 50 boost', 'LOOP r12', 'S 80',
    ],
  },
  {
    id: 'midnight-spiral', name: 'Midnight Spiral', theme: 'neon', laps: 2, difficulty: 3,
    blurb: 'Corkscrew up the tower, loop back down.',
    pieces: [
      'S 90 boost', 'R 90 r35', 'S 40', 'R 360 r40 u18 b8 cp', 'S 60', 'R 90 r40', 'S ? d9', 'R 90 r40',
      'LOOP r12', 'S 50 d9 cp', 'S ?', 'R 90 r35',
    ],
  },
  {
    id: 'magma-rush', name: 'Magma Rush', theme: 'volcano', laps: 0, difficulty: 2,
    blurb: 'Narrow bridges over the lava sea.',
    pieces: [
      'S 60', 'S 40 w12', 'R 60 r50', 'S 65', 'K 12 a12', 'J 28 d2', 'S 60 cp', 'L 120 r40 b10 wall',
      'S 40 w11 nowall', 'R 45 r60', 'L 45 r60', 'S 65', 'K 12 a12', 'J 32 d3', 'S 100 w14',
      'R 150 r40 b12 cp', 'S 50 u6', 'S 20', 'K 10 a12', 'J 30 d6', 'S 70', 'L 70 r45',
      'S 40 w10 nowall', 'R 70 r45', 'S 60 boost', 'S 40',
    ],
  },
  {
    id: 'caldera', name: 'Caldera', theme: 'volcano', laps: 3, difficulty: 2,
    blurb: 'Steep banking around the crater rim.',
    pieces: [
      'S 200', 'L 90 r70 b18', 'S 40', 'L 90 r70 b18 cp', 'S ?', 'L 45 r60', 'R 140 r28', 'L 95 r40 cp',
      'S 40', 'L 90 r60 b15', 'S ?', 'L 90 r60 b15',
    ],
  },
  {
    id: 'stardust', name: 'Stardust', theme: 'space', laps: 0, difficulty: 3, walls: 'none',
    blurb: 'No barriers. Nothing below. Big air.',
    pieces: [
      'S 70', 'S 40 boost', 'K 14 a12', 'J 40 d4', 'S 70', 'L 60 r60 b12 wall', 'S 40', 'LOOP r13',
      'S 60 cp', 'R 90 r50 b15 wall', 'S 80 u8', 'S 50', 'K 12 a12', 'J 42 d8', 'S 90', 'L 45 r80',
      'R 45 r80 cp', 'S 65 boost', 'K 14 a11', 'J 46 d6', 'S 80', 'R 120 r45 b15 wall', 'S 40 boost',
      'LOOP r14 o-20', 'S 60', 'K 12 a10', 'J 36', 'S 80',
    ],
  },
  {
    id: 'orbit-ring', name: 'Orbit Ring', theme: 'space', laps: 3, difficulty: 2, walls: 'none',
    blurb: 'Flat-out banked ring with a loop in the middle.',
    pieces: [
      'S 90 boost', 'L 90 r80 b20 wall', 'S 40', 'L 90 r80 b20 wall cp', 'S 60', 'LOOP r13 o18', 'S ?',
      'L 90 r80 b20 wall', 'S ? boost', 'L 90 r80 b20 wall cp', 'S 30',
    ],
  },
  {
    id: 'grand-finale', name: 'Grand Finale', theme: 'dusk', laps: 0, difficulty: 3,
    blurb: 'Every trick in the book, in one run at sunset.',
    pieces: [
      'S 70', 'S 40 boost', 'R 60 r60 b10', 'S 65 u8', 'K 12 a12', 'J 30 d4', 'S 60 cp', 'L 90 r40 b10',
      'S 40 tunnel', 'S 40 tunnel', 'R 90 r40 tunnel', 'S 50 boost', 'LOOP r12', 'S 60 cp', 'L 45 r60',
      'R 90 r35', 'S 40 ice', 'L 90 r40 ice', 'S 50', 'R 360 r40 u16 b8 cp', 'S 60', 'K 12 a12',
      'J 40 d8', 'S 70', 'L 60 r50 dirt', 'R 60 r50 dirt', 'S 50 boost cp', 'L 120 r40 b12', 'S 40 d4',
      'LOOP r13 o-18', 'S 60', 'R 45 r70', 'L 45 r70', 'S 65 boost', 'K 14 a12', 'J 44 d4', 'S 90',
    ],
  },

  // ---- Pro: harder tracks, new environments ------------------------------------
  {
    id: 'jungle-run', name: 'Jungle Run', theme: 'jungle', laps: 0, difficulty: 3, pro: true,
    blurb: 'A rally stage through the rainforest - mud, river jumps and blind hairpins.',
    pieces: [
      'S 70', 'R 45 r60', 'S 50 dirt', 'L 90 r32 dirt', 'S 40 u6', 'R 110 r28 b8 dirt', 'S 50 d6 cp',
      'L 45 r55', 'S 70', 'K 12 a11', 'J 26 d2', 'S 70', 'R 90 r34 dirt', 'S 40 w11 dirt',
      'L 90 r26 dirt', 'R 90 r26 dirt cp', 'S 45 tunnel', 'S 45 tunnel', 'L 60 r45', 'S 60 u5',
      'R 45 r50', 'S 65 d5', 'K 12 a12', 'J 30 d3', 'S 70', 'R 150 r30 b10', 'S 40 w12 dirt',
      'L 70 r35 dirt', 'S 60 u4 cp', 'R 60 r40', 'L 60 r40', 'S 50 d4', 'L 90 r30 dirt', 'S 90 boost', 'S 40',
    ],
  },
  {
    id: 'frostbite', name: 'Frostbite', theme: 'arctic', laps: 3, difficulty: 3, pro: true,
    blurb: 'Glare ice under the aurora. Brake early, steer gently.',
    pieces: [
      'S 90', 'R 90 r40 b6', 'S 60 ice', 'L 90 r30 ice', 'S 40 u5', 'R 180 r32 b10 ice cp', 'S 50 d5',
      'L 90 r40', 'S 60', 'R 90 r40 ice', 'S 120', 'R 90 r30 b8 ice cp', 'S ?', 'R 90 r45', 'S ?',
    ],
  },
  {
    id: 'red-planet', name: 'Red Planet', theme: 'mars', laps: 0, difficulty: 3, pro: true, gravity: 0.5,
    blurb: 'Half gravity. Crater-sized jumps and very long hang time.',
    pieces: [
      'S 90', 'K 12 a8', 'J 60 d3', 'S 170 u3', 'R 90 r70 b8', 'S 80 cp', 'K 12 a9', 'J 70 d5', 'S 180 u5',
      'L 120 r60 b10', 'S 100', 'K 14 a10', 'J 80 d8', 'S 190 u8 cp', 'R 60 r80', 'L 60 r80', 'S 110',
      'K 14 a10', 'J 90 d4', 'S 220 u4', 'R 90 r70', 'S 60',
    ],
  },
  {
    id: 'gridrunner', name: 'Gridrunner', theme: 'cyber', laps: 4, difficulty: 3, pro: true,
    blurb: 'A neon speedway with walls to ride - flat out round 40 degree banking.',
    pieces: [
      'S 120 boost', 'L 180 r70 b40 wall', 'S 90', 'LOOP r13 o18', 'S 70 cp', 'L 90 r45 b35 wall', 'S ?',
      'L 90 r45 b35 wall cp', 'S ?',
    ],
  },
  {
    id: 'sugar-rush', name: 'Sugar Rush', theme: 'candy', laps: 2, difficulty: 3, pro: true,
    blurb: 'A rollercoaster: spiral lift hill, the big drop, two loops.',
    pieces: [
      'S 90', 'L 360 r36 u20 b10', 'S 40', 'R 90 r45 b10 cp', 'S 100 d20', 'S 40 boost', 'LOOP r12', 'S 40',
      'R 90 r40 b12', 'S ?', 'LOOP r13 o-18', 'S 50', 'R 90 r45 cp', 'S ?', 'R 90 r50',
    ],
  },
  {
    id: 'eye-of-the-storm', name: 'Eye of the Storm', theme: 'storm', laps: 0, difficulty: 4, pro: true,
    blurb: 'Lightning, rain and a flooded plain. No barriers where it matters.',
    pieces: [
      'S 70', 'S 40 w12', 'R 60 r50 nowall', 'S 60 w11 nowall', 'L 90 r35 nowall', 'S 70', 'K 12 a11', 'J 28 d2',
      'S 60 cp', 'R 120 r34 b10', 'S 40 u6', 'L 45 r50', 'S 60 d6 w11 nowall', 'R 90 r30 nowall',
      'L 90 r30 nowall', 'S 70', 'K 12 a12', 'J 32 d3', 'S 65 cp', 'L 150 r32 b12 wall', 'S 40 w10 nowall',
      'R 60 r40 nowall', 'S 60', 'L 45 r60', 'R 45 r60', 'S 70', 'K 12 a12', 'J 36 d4', 'S 90', 'R 90 r40',
      'S 60 boost', 'S 40',
    ],
  },
  {
    id: 'cloud-nine', name: 'Cloud Nine', theme: 'sky', laps: 0, difficulty: 4, pro: true, walls: 'none',
    blurb: 'A ribbon of road above the clouds. No barriers, nothing below.',
    pieces: [
      'S 70', 'S 40', 'K 14 a11', 'J 36 d4', 'S 90', 'L 60 r70 b12', 'S 40 w11', 'R 90 r45 b10 cp',
      'S 60 d8', 'S 45', 'K 12 a12', 'J 34 d6', 'S 90', 'L 120 r45 b14', 'S 40 u10', 'S 40', 'R 45 r60',
      'L 45 r60', 'S 60 w10', 'R 90 r40 b12 cp', 'S 70', 'K 14 a12', 'J 42 d8', 'S 90', 'L 90 r50 b15',
      'S 50 w11', 'LOOP r13', 'S 60', 'R 60 r55 b12', 'S 60 boost', 'S 40',
    ],
  },
  {
    id: 'toxic-meltdown', name: 'Toxic Meltdown', theme: 'toxic', laps: 0, difficulty: 4, pro: true,
    blurb: 'Catwalks over an acid lake, through the works and out the other side.',
    pieces: [
      'S 70', 'S 40 w12', 'R 90 r40 b8', 'S 50 tunnel', 'S 40 tunnel', 'L 60 r45 tunnel', 'S 60 cp', 'K 12 a12',
      'J 30 d2', 'S 60', 'R 120 r30 b10 wall', 'S 40 w10 nowall', 'L 90 r32 nowall', 'R 90 r32 nowall',
      'S 60 u6', 'S 30', 'K 12 a12', 'J 32 d6', 'S 65 cp', 'L 150 r35 b12', 'S 50 tunnel', 'R 90 r40 tunnel',
      'S 40', 'LOOP r12', 'S 60', 'R 45 r60', 'L 45 r60', 'S 70', 'K 14 a12', 'J 38 d3', 'S 80',
      'R 90 r35 b10', 'S 60 boost', 'S 40',
    ],
  },
  {
    id: 'haunted-hollow', name: 'Haunted Hollow', theme: 'haunted', laps: 3, difficulty: 3, pro: true,
    blurb: 'Fog, graves and switchbacks by moonlight - and a loop in the dark.',
    pieces: [
      'S 80', 'R 90 r30', 'S 40 tunnel', 'L 90 r26 tunnel', 'S 30', 'R 180 r28 b8 cp', 'S 50 u6', 'L 45 r35',
      'R 45 r35', 'L 90 r30', 'R 90 r30', 'S 50 d6', 'S 40 boost', 'LOOP r12', 'S 50', 'R 90 r32', 'S ?',
      'R 90 r26 b10 cp', 'S ?',
    ],
  },
  {
    id: 'apex-gauntlet', name: 'Apex Gauntlet', theme: 'cyber', laps: 0, difficulty: 4, pro: true,
    blurb: 'The hardest run there is: ice, wall rides, a spiral, loops and big air.',
    pieces: [
      'S 80', 'S 40 boost', 'K 14 a12', 'J 40 d4', 'S 70', 'L 90 r40 b35 wall', 'S 50', 'R 120 r28 ice',
      'S 40 ice w11', 'L 90 r30 ice', 'S 60 cp', 'R 360 r38 u18 b10', 'S 60', 'L 90 r45 b12', 'S 80 d10',
      'S 40 boost', 'LOOP r13', 'S 60 cp', 'R 60 r45 dirt', 'L 60 r45 dirt', 'S 60 w10 nowall',
      'R 90 r30 nowall', 'S 70', 'K 12 a12', 'J 36 d4', 'S 70', 'L 150 r60 b40 wall', 'S 60 cp', 'R 45 r50',
      'L 45 r50', 'S 50 boost', 'LOOP r13 o-18', 'S 60', 'R 90 r35 b10', 'S 70', 'K 14 a12', 'J 44 d4', 'S 90',
    ],
  },
];

export function getTrackDef(id) {
  return TRACKS.find((t) => t.id === id);
}
