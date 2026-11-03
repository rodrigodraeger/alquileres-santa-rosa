// Uso: node geocodificar.js  (lee geo-consultas.json, guarda resultados en geo-cache.json)
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const UA = 'relevamiento-alquileres-santarosa/1.0 (github.com/rodrigodraeger/alquileres-santa-rosa)';
// Santa Rosa y Toay
const BBOX = { s: -36.70, w: -64.42, n: -36.56, e: -64.22 };

const consultas = JSON.parse(fs.readFileSync(path.join(DIR, 'geo-consultas.json'), 'utf8'));
const cachePath = path.join(DIR, 'geo-cache.json');
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function nominatim(q) {
  const loc = /toay/i.test(q) ? '' : ', Santa Rosa';
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&bounded=1'
    + `&viewbox=${BBOX.w},${BBOX.n},${BBOX.e},${BBOX.s}`
    + '&q=' + encodeURIComponent(q + loc + ', La Pampa');
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Nominatim ${r.status} para "${q}"`);
  const j = await r.json();
  await sleep(1100);
  if (!j.length) return null;
  return { lat: +j[0].lat, lon: +j[0].lon, tipo: j[0].addresstype, nombre: j[0].display_name };
}

async function interseccion(a, b) {
  const rx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[aá]/gi, '[aá]').replace(/[eé]/gi, '[eé]')
    .replace(/[ií]/gi, '[ií]').replace(/[oó]/gi, '[oó]').replace(/[uú]/gi, '[uú]');
  const bb = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
  const q = `[out:json][timeout:25];way["highway"]["name"~"${rx(a)}",i](${bb})->.a;`
    + `way["highway"]["name"~"${rx(b)}",i](${bb})->.b;node(w.a)(w.b);out;`;
  // Los servidores públicos de Overpass devuelven 502/504 seguido: se prueba el siguiente
  const servidores = ['https://overpass-api.de', 'https://overpass.kumi.systems', 'https://overpass.private.coffee'];
  let r = null, estados = [];
  for (let intento = 0; intento < 3 && !(r && r.ok); intento++) {
    for (const s of servidores) {
      try {
        r = await fetch(s + '/api/interpreter', {
          method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q)
        });
      } catch (e) {
        r = null;
        estados.push(`${s}: ${e.cause ? e.cause.code : e.message}`);
        continue;
      }
      if (r.ok) break;
      estados.push(`${s}: ${r.status}`);
      await sleep(3000);
    }
  }
  if (!(r && r.ok)) throw new Error(`Overpass falló para "${a} y ${b}": ${estados.join(', ')}`);
  const j = await r.json();
  await sleep(1500);
  if (!j.elements.length) return null;
  const n = j.elements[0];
  return { lat: n.lat, lon: n.lon, tipo: 'esquina', nombre: `${a} y ${b}` };
}

(async () => {
  for (const [id, c] of Object.entries(consultas)) {
    const key = JSON.stringify(c);
    if (cache[key] !== undefined) continue;
    let res;
    if (c.a) res = await nominatim(c.a);
    else if (c.p) res = await nominatim(c.p);
    else if (c.x) res = await interseccion(c.x[0], c.x[1]);
    if (res) res.precision = c.a ? (res.tipo === 'house' || res.tipo === 'building' || res.tipo === 'place' ? 'exacta' : 'calle') : c.x ? 'esquina' : 'barrio';
    cache[key] = res;
    console.log(id, res ? `${res.precision} ${res.lat.toFixed(5)},${res.lon.toFixed(5)}` : 'SIN RESULTADO');
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  }
})();
