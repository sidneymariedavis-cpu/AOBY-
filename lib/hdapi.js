/* BodyGraphChart client (server-side only; the API key never reaches the browser).
 * Birth details are forwarded to the provider and discarded: never stored, logged, or sent to the AI. */
'use strict';
const E = require('./engine');
let fetchImpl = (...a) => fetch(...a);
const setFetch = (f) => { fetchImpl = f; };
const base = () => process.env.HD_API_BASE || 'https://api.bodygraphchart.com/v210502';
const enabled = () => !!process.env.HD_API_KEY;

async function get(path, params) {
  const u = new URL(base() + path); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v); u.searchParams.set('api_key', process.env.HD_API_KEY);
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
  try { const r = await fetchImpl(u.toString(), { signal: ctrl.signal }); if (!r.ok) throw Object.assign(new Error('Chart provider error'), { status: 502 }); return await r.json(); }
  finally { clearTimeout(to); }
}
async function locations(query) {
  const j = await get('/locations', { query: String(query).slice(0, 80) });
  return (Array.isArray(j) ? j : []).slice(0, 10).map((x) => ({ label: [x.asciiname || x.value, x.admin1, x.country].filter(Boolean).join(', '), timezone: String(x.timezone || '') })).filter((x) => /^[A-Za-z_]+\/[A-Za-z_\/+-]+$|^UTC$/.test(x.timezone));
}
async function chart({ date, timezone }) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(date) || !/^[A-Za-z_]+\/[A-Za-z_\/+-]+$|^UTC$/.test(timezone)) throw Object.assign(new Error('Check the birth date, time and place.'), { status: 400 });
  const j = await get('/hd-data', { date, timezone });
  if (!j || !j.Properties) throw Object.assign(new Error('The chart service didn’t return a chart.'), { status: 502 });
  return E.normalizeChart(j.Properties); // only these 4 fields leave this function
}
module.exports = { enabled, setFetch, locations, chart };
