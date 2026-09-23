// Body shapes. Each body is a loft: cross-section stations from the front
// bumper (largest z) to the rear, in metres with the ground at y = 0.
//   z     station position        top   roof / hood / deck height
//   w     half width at the belt  wt    half width of the top surface
//   belt  shoulder height         kind  'h' hood/deck, 'c' cabin (glass sides)
//   yb    floor height (wheel arches raise it automatically)
// Every body shares one physics hull: wheels at x = +/-0.84, z = 1.34 / -1.30.

const S = (z, top, w, wt, belt, kind, yb = 0.26) => ({ z, top, w, wt, belt, kind, yb });

export const BODIES = {
  bolt: {
    name: 'Bolt', blurb: 'Balanced sports coupe',
    arches: true,
    stations: [
      S(2.18, 0.58, 0.8, 0.62, 0.56, 'h', 0.3),
      S(2.06, 0.7, 0.9, 0.72, 0.68, 'h'),
      S(1.72, 0.77, 0.94, 0.76, 0.75, 'h'),
      S(0.98, 0.87, 0.95, 0.8, 0.85, 'h'),
      S(0.2, 1.21, 0.95, 0.66, 0.88, 'c'),
      S(-0.7, 1.19, 0.95, 0.64, 0.9, 'c'),
      S(-1.48, 0.97, 0.94, 0.78, 0.93, 'h'),
      S(-2.02, 0.95, 0.9, 0.76, 0.92, 'h'),
      S(-2.16, 0.78, 0.85, 0.66, 0.76, 'h', 0.3),
    ],
    lights: { front: 'wide', rear: 'bar' },
    mirrors: true, exhaust: 2,
  },
  vortex: {
    name: 'Vortex', blurb: 'Wedge-shaped hypercar',
    arches: true,
    stations: [
      S(2.22, 0.46, 0.84, 0.7, 0.44, 'h', 0.24),
      S(2.0, 0.58, 0.93, 0.8, 0.56, 'h', 0.24),
      S(1.35, 0.68, 0.96, 0.82, 0.66, 'h'),
      S(0.62, 0.8, 0.97, 0.8, 0.76, 'h'),
      S(-0.12, 1.1, 0.97, 0.6, 0.8, 'c'),
      S(-0.72, 1.08, 0.98, 0.6, 0.84, 'c'),
      S(-1.5, 0.92, 0.99, 0.84, 0.9, 'h'),
      S(-2.06, 0.92, 0.98, 0.86, 0.9, 'h'),
      S(-2.2, 0.72, 0.94, 0.74, 0.7, 'h', 0.3),
    ],
    lights: { front: 'slit', rear: 'bar' },
    mirrors: true, exhaust: 1, intake: true,
  },
  rally: {
    name: 'Rally', blurb: 'Hot hatch with a roof scoop',
    arches: true,
    stations: [
      S(2.08, 0.66, 0.82, 0.68, 0.62, 'h', 0.32),
      S(1.96, 0.78, 0.9, 0.78, 0.76, 'h', 0.3),
      S(1.55, 0.86, 0.94, 0.8, 0.84, 'h'),
      S(0.95, 0.94, 0.95, 0.82, 0.92, 'h'),
      S(0.2, 1.38, 0.95, 0.72, 0.97, 'c'),
      S(-1.2, 1.36, 0.95, 0.72, 0.98, 'c'),
      S(-1.78, 1.24, 0.94, 0.74, 0.98, 'c'),
      S(-2.02, 0.98, 0.9, 0.8, 0.96, 'h'),
      S(-2.1, 0.8, 0.86, 0.7, 0.78, 'h', 0.32),
    ],
    lights: { front: 'round', rear: 'pair' },
    mirrors: true, exhaust: 1, scoop: true, mudflaps: true,
  },
  brute: {
    name: 'Brute', blurb: 'Big-block muscle',
    arches: true,
    stations: [
      S(2.24, 0.68, 0.86, 0.74, 0.64, 'h', 0.28),
      S(2.12, 0.8, 0.94, 0.84, 0.78, 'h'),
      S(1.2, 0.86, 0.96, 0.86, 0.84, 'h'),
      S(0.62, 0.9, 0.96, 0.84, 0.88, 'h'),
      S(-0.05, 1.23, 0.96, 0.72, 0.9, 'c'),
      S(-0.72, 1.21, 0.96, 0.72, 0.9, 'c'),
      S(-1.62, 0.96, 0.96, 0.84, 0.92, 'h'),
      S(-2.12, 0.95, 0.95, 0.84, 0.92, 'h'),
      S(-2.24, 0.8, 0.9, 0.76, 0.78, 'h', 0.3),
    ],
    lights: { front: 'quad', rear: 'bar' },
    mirrors: true, exhaust: 2, hoodScoop: true,
  },
  retro: {
    name: 'Classic', blurb: '60s grand tourer',
    arches: true,
    stations: [
      S(2.2, 0.54, 0.62, 0.5, 0.52, 'h', 0.3),
      S(2.08, 0.66, 0.84, 0.66, 0.64, 'h', 0.28),
      S(1.6, 0.74, 0.92, 0.64, 0.73, 'h'),
      S(0.9, 0.8, 0.9, 0.66, 0.79, 'h'),
      S(0.3, 1.16, 0.88, 0.6, 0.84, 'c'),
      S(-0.55, 1.14, 0.88, 0.58, 0.85, 'c'),
      S(-1.35, 0.9, 0.92, 0.68, 0.86, 'h'),
      S(-1.95, 0.84, 0.88, 0.6, 0.82, 'h'),
      S(-2.14, 0.66, 0.7, 0.46, 0.64, 'h', 0.3),
    ],
    lights: { front: 'round', rear: 'round' },
    mirrors: false, exhaust: 2, chrome: true,
  },
  cyber: {
    name: 'Wedge', blurb: 'Angular electric truck',
    arches: true,
    stations: [
      S(2.2, 0.74, 0.9, 0.84, 0.72, 'h', 0.34),
      S(1.9, 0.9, 0.96, 0.92, 0.88, 'h', 0.3),
      S(0.9, 1.08, 0.97, 0.9, 0.94, 'h'),
      S(0.05, 1.46, 0.97, 0.7, 0.98, 'c'),
      S(-0.9, 1.3, 0.97, 0.78, 0.98, 'c'),
      S(-2.1, 1.02, 0.97, 0.92, 0.98, 'h'),
      S(-2.22, 0.86, 0.94, 0.9, 0.84, 'h', 0.34),
    ],
    lights: { front: 'bar', rear: 'bar' },
    mirrors: false, exhaust: 0,
  },
  formula: {
    name: 'Formula', blurb: 'Open-wheel racer',
    arches: false, open: true,
    stations: [
      S(2.3, 0.3, 0.1, 0.06, 0.29, 'h', 0.2),
      S(1.95, 0.42, 0.2, 0.14, 0.4, 'h', 0.18),
      S(1.2, 0.6, 0.3, 0.2, 0.56, 'h', 0.16),
      S(0.45, 0.72, 0.38, 0.26, 0.66, 'h', 0.16),
      S(-0.1, 0.72, 0.44, 0.26, 0.66, 'h', 0.16),
      S(-0.6, 1.06, 0.46, 0.16, 0.7, 'h', 0.16),
      S(-1.3, 0.88, 0.4, 0.16, 0.64, 'h', 0.16),
      S(-2.0, 0.56, 0.3, 0.2, 0.5, 'h', 0.2),
      S(-2.1, 0.46, 0.24, 0.18, 0.42, 'h', 0.22),
    ],
    lights: { front: 'none', rear: 'rain' },
    mirrors: false, exhaust: 0, formula: true,
  },
  buggy: {
    name: 'Dune', blurb: 'Roll-cage dune buggy',
    arches: false, open: true,
    stations: [
      S(1.95, 0.5, 0.6, 0.5, 0.48, 'h', 0.34),
      S(1.7, 0.66, 0.66, 0.58, 0.64, 'h', 0.3),
      S(0.8, 0.74, 0.7, 0.62, 0.72, 'h', 0.3),
      S(-0.2, 0.74, 0.72, 0.62, 0.72, 'h', 0.3),
      S(-1.2, 0.8, 0.7, 0.62, 0.78, 'h', 0.3),
      S(-1.75, 0.8, 0.66, 0.58, 0.76, 'h', 0.32),
      S(-1.9, 0.62, 0.6, 0.5, 0.6, 'h', 0.36),
    ],
    lights: { front: 'round', rear: 'pair' },
    mirrors: false, exhaust: 1, buggy: true,
  },
};

export const BODY_IDS = Object.keys(BODIES);
