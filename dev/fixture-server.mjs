/*
 * The dev server: serves the dev build (dist/dev) and answers every "remote" request from dev/fixtures, with CORS.
 * There is no network in the workspace (no Stremio, no add-ons), and a dev build of the app redirects every absolute
 * http(s) URL here (src/lib/http.js devRewrite):
 *
 *     https://api.strem.io/api/addonCollectionGet   ->   <this server>/__fx/api.strem.io/api/addonCollectionGet
 *     https://v3-cinemeta.strem.io/catalog/movie/top.json
 *                                                   ->   <this server>/__fx/v3-cinemeta.strem.io/catalog/movie/top.json
 *
 * A request to /__fx/<host>/<path> is answered with the first file that exists under dev/fixtures/<host>/ among
 * (see dev/README.md):
 *     <path>.<METHOD>.<key>.json   POST/PUT only; key = the request body's "collection", else its "type"
 *     <path>.<key>.json            same, any method
 *     <path>.<METHOD>.json
 *     <path>                       exactly (the add-on URLs already end in .json)
 *     <path>.json
 *     <path>/index.json
 * Pictures from any host (metahub, tmdb, ...) that have no file get a generated placeholder (SVG), so screens can be
 * drawn and photographed without the real art. Anything else answers 404 with a JSON body and is logged.
 *
 * Query parameters of the *request* that start with __ are for testing and are removed before matching:
 *     ?__delay=800   answer after 800 ms        ?__status=503   answer with that status (body: the fixture or {})
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.srt': 'application/x-subrip; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8', '.webm': 'video/webm', '.mp4': 'video/mp4', '.wgt': 'application/octet-stream',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
};

const isImagePath = (host, path) => /\.(jpe?g|png|webp|gif|svg)$/i.test(path) || /image|metahub|tmdb|poster|cdn/i.test(host) || /\/(poster|background|logo)\//.test(path);

function hashOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A placeholder picture for a URL: a gradient chosen by the path, with its last segment as the label. */
export function placeholderSvg(host, path) {
  const kind = /\/background\//.test(path) ? 'background' : /\/logo\//.test(path) ? 'logo' : 'poster';
  const parts = path.split('/').filter(Boolean);
  const label = (parts.length > 1 && /^img$/.test(parts[parts.length - 1]) ? parts[parts.length - 2] : parts[parts.length - 1] || host).replace(/\.[a-z]+$/i, '');
  const hue = hashOf(path) % 360;
  const [w, h] = kind === 'poster' ? [300, 450] : kind === 'background' ? [1280, 720] : [400, 160];
  const esc = label.replace(/[<>&"]/g, '');
  if (kind === 'logo') {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><text x="0" y="110" font-family="Georgia,serif" font-size="96" fill="#f3eee6">' + esc.slice(0, 10) + '</text></svg>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(' + hue + ',40%,30%)"/><stop offset="1" stop-color="hsl(' + ((hue + 40) % 360) + ',45%,10%)"/></linearGradient></defs>'
    + '<rect width="' + w + '" height="' + h + '" fill="url(#g)"/>'
    + '<text x="' + (w / 2) + '" y="' + (h / 2) + '" text-anchor="middle" font-family="Georgia,serif" font-size="' + (kind === 'poster' ? 34 : 64) + '" fill="#f3eee6" fill-opacity="0.85">' + esc + '</text></svg>';
}

/** The first existing fixture file for a request, or null. */
export function findFixture(fixturesDir, host, path, method, body) {
  const base = join(fixturesDir, host);
  let keys = [];
  if (body) {
    try { const j = JSON.parse(body); keys = [j.collection, j.type].filter((k) => typeof k === 'string' && /^[\w-]+$/.test(k)); } catch (e) { /* not JSON */ }
  }
  // Rule: a ':' in the decoded request path is looked up as '__' on disk (Windows cannot hold ':' in file names),
  // e.g. /stream/series/tt11280740:1:4.json -> stream/series/tt11280740__1__4.json
  const rel = path.replace(/^\/+/, '').replace(/:/g, '__');
  const names = [];
  keys.forEach((k) => { names.push(rel + '.' + method + '.' + k + '.json'); });
  keys.forEach((k) => { names.push(rel + '.' + k + '.json'); });
  names.push(rel + '.' + method + '.json', rel, rel + '.json', rel.replace(/\/$/, '') + '/index.json');
  for (const name of names) {
    const file = normalize(join(base, name));
    if (file.indexOf(base + sep) !== 0 && file !== base) continue; // never outside the host's folder
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

let testVideo = null;
/** A 30 s test-pattern WebM for media=video mock scenarios, made once with ffmpeg if there is one. */
function testVideoPath() {
  if (testVideo !== null) return testVideo || null;
  const out = join(tmpdir(), 'alder-tizen-test.webm');
  if (!existsSync(out)) {
    const r = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '30',
      '-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libvorbis', out], { stdio: 'ignore' });
    if (r.status !== 0) { testVideo = ''; return null; }
  }
  testVideo = out;
  return out;
}

export async function startServer({ port = 0, host = '127.0.0.1', fixturesDir = join(HERE, 'fixtures'), staticDir = join(ROOT, 'dist/dev'), quiet = false } = {}) {
  const requests = []; // the last 200, for tests: GET /__fx/_requests
  const note = (entry) => { requests.push(entry); if (requests.length > 200) requests.shift(); if (!quiet) console.log(entry.status + ' ' + entry.method + ' ' + entry.url + (entry.note ? '  ' + entry.note : '')); };

  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8');
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, type, data, extra = {}) => {
      res.writeHead(status, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, CORS, extra));
      res.end(data);
    };
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

      if (url.pathname.indexOf('/__fx/') === 0) {
        const rest = url.pathname.slice('/__fx/'.length);
        if (rest === '_requests') { send(200, TYPES['.json'], JSON.stringify(requests)); return; }
        if (rest === '_health') { send(200, TYPES['.json'], '{"ok":true}'); return; }
        if (rest === '_media/test.webm') {
          const file = testVideoPath();
          if (!file) { send(404, TYPES['.json'], '{"error":"no ffmpeg to make the test video"}'); return; }
          send(200, 'video/webm', await readFile(file));
          return;
        }
        const slash = rest.indexOf('/');
        const hostName = decodeURIComponent(slash < 0 ? rest : rest.slice(0, slash));
        const path = decodeURIComponent(slash < 0 ? '/' : rest.slice(slash));
        const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : '';
        const delay = Number(url.searchParams.get('__delay')) || 0;
        const forced = Number(url.searchParams.get('__status')) || 0;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        const file = /^[\w.:-]+$/.test(hostName) ? findFixture(fixturesDir, hostName, path, req.method, body) : null;
        if (file) {
          const data = await readFile(file);
          const status = forced || 200;
          send(status, TYPES[extname(file)] || 'application/octet-stream', data);
          note({ status, method: req.method, url: hostName + path, fixture: file.slice(fixturesDir.length + 1), body: body.slice(0, 200) });
          return;
        }
        if (forced) { send(forced, TYPES['.json'], '{}'); note({ status: forced, method: req.method, url: hostName + path, note: 'forced' }); return; }
        if (isImagePath(hostName, path)) {
          send(200, TYPES['.svg'], placeholderSvg(hostName, path));
          note({ status: 200, method: req.method, url: hostName + path, note: 'placeholder' });
          return;
        }
        send(404, TYPES['.json'], JSON.stringify({ error: 'no fixture for ' + req.method + ' ' + hostName + path }));
        note({ status: 404, method: req.method, url: hostName + path, note: 'NO FIXTURE', body: body.slice(0, 200) });
        return;
      }

      // static: the dev build
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = normalize(join(staticDir, rel));
      if (file.indexOf(staticDir) !== 0 || !existsSync(file) || !(await stat(file)).isFile()) {
        send(404, 'text/plain; charset=utf-8', 'not found: ' + rel);
        return;
      }
      send(200, TYPES[extname(file)] || 'application/octet-stream', await readFile(file));
    } catch (e) {
      send(500, TYPES['.json'], JSON.stringify({ error: String(e && e.message || e) }));
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const actual = server.address().port;
  return {
    server, port: actual, origin: 'http://' + host + ':' + actual, requests,
    close: () => new Promise((resolve) => { server.close(() => resolve()); if (server.closeAllConnections) server.closeAllConnections(); }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const portArg = args.indexOf('--port');
  const port = portArg >= 0 ? Number(args[portArg + 1]) : 8080;
  if (!args.includes('--no-build')) {
    const { build } = await import('../scripts/build.mjs');
    await build({ dev: true });
  }
  const s = await startServer({ port, host: args.includes('--lan') ? '0.0.0.0' : '127.0.0.1' });
  console.log('Alder dev build: ' + s.origin + '/   (fixtures: ' + s.origin + '/__fx/_requests)');
  console.log('Query: ?clock=12:03%20AM freezes the clock; ?mock.device=fhd picks a 1080p TV. Ctrl-C to stop.');
}
