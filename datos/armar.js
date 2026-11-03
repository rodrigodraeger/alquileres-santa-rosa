// Uso: node armar.js  (junta La Arena + Instagram + geo-cache.json y escribe ../alquileres.html)
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const FECHA = '2026-11-02';
const PLAZA = { lat: -36.62030, lon: -64.29060 }; // Plaza San Martín

const leer = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const consultas = JSON.parse(leer('geo-consultas.json'));
const cache = JSON.parse(leer('geo-cache.json'));
const fotos = new Set(fs.readdirSync(path.join(DIR, '..', 'fotos')));

// Avisos repetidos entre inmobiliarias: el segundo se marca como duplicado del primero
const DUPLICADOS = { 'DfDbmH-lhLY': 'DfAhthxltb6', 'DeeZWA9ESZS': 'DebzFlGEfbd', 'la0': 'DeupE7oEeJn', 'DdTnbGAmwSS': 'dest-trenel-1-3' };

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function fechaDeCodigo(sc) {
  let n = 0n;
  for (const c of sc.slice(0, 11)) n = n * 64n + BigInt(B64.indexOf(c));
  return new Date(Number((n >> 23n) + 1314220021721n)).toISOString().slice(0, 10);
}

// Suma expensas, municipales, tasas e impuestos con monto; ignora montos alternativos (con cochera, rebajado desde, total)
function gastos(nota) {
  if (!nota) return { monto: 0, sinDato: false };
  let monto = 0;
  const re = /\$\s?([\d.]+)/g;
  let m;
  while ((m = re.exec(nota))) {
    const antes = nota.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
    const despues = nota.slice(m.index, m.index + 25).toLowerCase();
    if (/desde|con cochera|total|^\s*$/.test(antes) && !/expensa|municipal|tasa|impuest/.test(antes)) continue;
    if (/cochera\)/.test(despues)) continue;
    let v = +m[1].replace(/\./g, '');
    if (v < 1000) v *= 1000; // "$35 / 000" quedó cortado en el texto original
    monto += v;
  }
  const nombraGastos = /expensa|municipal|tasa|impuest|servicios/i.test(nota);
  return { monto, sinDato: nombraGastos && monto === 0 };
}

function distancia(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const filas = [];
const vistos = {};
for (const l of leer('ig-2026-11-02.jsonl').split('\n').filter(x => x.trim())) {
  const r = JSON.parse(l);
  if (r.excluir || r.tipo === 'revisar' || r.tipo === 'video') continue;
  let id = r.sc;
  vistos[id] = (vistos[id] || 0) + 1;
  if (vistos[id] > 1) id += '-' + vistos[id];
  const esPosteo = !r.origen;
  filas.push({ ...r, id, fuente: 'Instagram', fecha: r.fecha || fechaDeCodigo(r.sc),
    link: esPosteo ? `https://www.instagram.com/p/${r.sc}/` : `https://www.instagram.com/${r.cuenta}/`, foto: fotos.has(`alq_${r.cuenta}_${r.sc}.jpg`) ? `fotos/alq_${r.cuenta}_${r.sc}.jpg` : null });
}
JSON.parse(leer('laarena-2026-11-02.json')).forEach((r, i) => {
  filas.push({ ...r, id: 'la' + i, cuenta: r.anunciante, fuente: 'La Arena', fecha: FECHA, estado: 'disponible',
    detalle: r.texto, link: 'https://www.laarena.com.ar/clasificados', foto: null });
});

// Ubicaciones corregidas a mano: pisan lo que devolvió el geocodificador (null = sin ubicación)
const correcciones = JSON.parse(leer('geo-correcciones.json'));

for (const f of filas) {
  const c = consultas[f.id];
  let g = c ? cache[JSON.stringify(c)] : null;
  if (f.id in correcciones) g = correcciones[f.id];
  else if (c && g === undefined) throw new Error(`Falta geocodificar ${f.id}: corré node geocodificar.js`);
  if (g && g.localidad) f.localidad = g.localidad;
  f.lat = g ? g.lat : null;
  f.lon = g ? g.lon : null;
  f.precision = g ? g.precision : null;
  f.metros = g ? distancia(PLAZA, g) : null;
  f.localidad = f.localidad || (/toay/i.test(f.direccion || '') ? 'Toay' : 'Santa Rosa');
  const gs = gastos(f.precio_nota);
  f.gastos = gs.monto;
  f.gastosSinDato = gs.sinDato;
  f.total = f.precio ? f.precio + gs.monto : null;
  f.duplicadoDe = DUPLICADOS[f.id] || null;
  f.tipo = { depto: 'Depto', casa: 'Casa', duplex: 'Dúplex' }[f.tipo] || f.tipo;
  for (const k of ['sc', 'texto', 'anunciante', 'dup_sc', 'pendientes', 'video', 'barrio']) delete f[k];
}

const html = leer('plantilla.html')
  .replace('/*DATOS*/[]', JSON.stringify(filas))
  .replace('/*PLAZA*/{}', JSON.stringify(PLAZA))
  .replace(/__FECHA__/g, '2 de noviembre de 2026');
fs.writeFileSync(path.join(DIR, '..', 'alquileres.html'), html);

const n = filas.length, ubic = filas.filter(f => f.lat).length;
console.log(`${n} avisos, ${ubic} en el mapa, ${n - ubic} sin ubicación, ${filas.filter(f => f.foto).length} con foto`);
