// Real-town map data for tracks set in actual places. Each map is a module in
// this folder, fetched only when its track is raced (they're large).
export const CITY_MAPS = {};

export async function loadCityMap(id) {
  if (!CITY_MAPS[id]) CITY_MAPS[id] = await import(`./${id}.js`);
  return CITY_MAPS[id];
}
