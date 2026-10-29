import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';

const ROOT = import.meta.dirname;
// Everything the app writes lives in STORAGE_DIR (defaults to this folder).
// In Docker this is a bind mount of the project folder, so data/db survive restarts.
const STORAGE_DIR = process.env.STORAGE_DIR || ROOT;
const DATA_DIR = path.join(STORAGE_DIR, 'data');
const THUMB_DIR = path.join(STORAGE_DIR, '.thumbs');
const DB_PATH = path.join(STORAGE_DIR, 'photos.db');
const THUMB_SIZE = 512;
const DIST_DIR = path.join(ROOT, 'dist');
const PORT = process.env.PORT || 3030;
const DEV = process.argv.includes('--dev');

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg', '.heic'];
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v', '.ogg', '.mkv'];
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.heic': 'image/heic', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.m4v': 'video/mp4', '.ogg': 'video/ogg', '.mkv': 'video/x-matroska',
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon',
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(THUMB_DIR, { recursive: true });

// ---------- database ----------
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS media (
    name TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    size INTEGER,
    mtime INTEGER,
    favorite INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS album_media (
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    media_name TEXT NOT NULL REFERENCES media(name) ON DELETE CASCADE,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (album_id, media_name)
  );
`);
if (!db.prepare('PRAGMA table_info(media)').all().some((c) => c.name === 'duration'))
  db.exec('ALTER TABLE media ADD COLUMN duration REAL');

function typeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

// Sync the ./data folder with the media table (cheap enough for personal use).
function syncMedia() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => !f.startsWith('.') && typeOf(f));
  const seen = new Set(files);
  const upsert = db.prepare(`
    INSERT INTO media (name, type, size, mtime) VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET size = excluded.size, mtime = excluded.mtime
  `);
  db.exec('BEGIN');
  for (const f of files) {
    const st = fs.statSync(path.join(DATA_DIR, f));
    upsert.run(f, typeOf(f), st.size, Math.floor(st.mtimeMs));
  }
  const del = db.prepare('DELETE FROM media WHERE name = ?');
  for (const { name } of db.prepare('SELECT name FROM media').all()) {
    if (!seen.has(name)) {
      console.log(`[sync] removed missing file ${name}`);
      del.run(name);
    }
  }
  db.exec('COMMIT');
}

function listMedia(view) {
  syncMedia();
  const base = `SELECT m.name, m.type, m.size, m.mtime, m.favorite, m.duration,
      (SELECT json_group_array(album_id) FROM album_media WHERE media_name = m.name) AS albums
    FROM media m`;
  let rows;
  if (view === 'favorites') rows = db.prepare(`${base} WHERE m.favorite = 1 ORDER BY m.mtime DESC`).all();
  else if (view === 'photos') rows = db.prepare(`${base} WHERE m.type = 'image' ORDER BY m.mtime DESC`).all();
  else if (view === 'videos') rows = db.prepare(`${base} WHERE m.type = 'video' ORDER BY m.mtime DESC`).all();
  else if (/^\d+$/.test(view || ''))
    rows = db.prepare(`${base} JOIN album_media am ON am.media_name = m.name
      WHERE am.album_id = ? ORDER BY am.added_at DESC, m.mtime DESC`).all(Number(view));
  else rows = db.prepare(`${base} ORDER BY m.mtime DESC`).all();
  return rows.map((r) => ({ ...r, favorite: !!r.favorite, albums: JSON.parse(r.albums) }));
}

function listAlbums() {
  return db.prepare(`
    SELECT a.id, a.name, a.created_at, COUNT(am.media_name) AS count,
      (SELECT am2.media_name FROM album_media am2 WHERE am2.album_id = a.id
        ORDER BY am2.added_at DESC LIMIT 1) AS cover,
      (SELECT m.type FROM album_media am3 JOIN media m ON m.name = am3.media_name
        WHERE am3.album_id = a.id ORDER BY am3.added_at DESC LIMIT 1) AS cover_type
    FROM albums a LEFT JOIN album_media am ON am.album_id = a.id
    GROUP BY a.id ORDER BY a.name COLLATE NOCASE
  `).all();
}

function counts() {
  syncMedia();
  return db.prepare(`SELECT COUNT(*) AS all_count,
    SUM(type = 'image') AS photos, SUM(type = 'video') AS videos,
    SUM(favorite) AS favorites FROM media`).get();
}

// ---------- http helpers ----------
const json = (res, data, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => resolve(s ? JSON.parse(s) : {}));
  });

function serveFile(req, res, file, cache = 'no-cache') {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = Number(s);
      const end = e ? Number(e) : st.size - 1;
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control': cache,
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cache,
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- thumbnails ----------
// Generated on demand and cached in ./.thumbs. Images via macOS `sips` or, on Linux
// (Docker), `vipsthumbnail` — both respect EXIF orientation. Videos via ffmpeg.
// Max 4 jobs at a time.
const HAS_SIPS = fs.existsSync('/usr/bin/sips');
const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  );
const inflight = new Map();
const queue = [];
let active = 0;

function enqueue(job) {
  return new Promise((resolve, reject) => {
    queue.push({ job, resolve, reject });
    pump();
  });
}
function pump() {
  while (active < 4 && queue.length) {
    const { job, resolve, reject } = queue.shift();
    active++;
    job().then(resolve, reject).finally(() => { active--; pump(); });
  }
}

async function makeThumb(name, out) {
  const src = path.join(DATA_DIR, name);
  if (typeOf(name) === 'video') {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.5', '-i', src, '-frames:v', '1',
      '-vf', `scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=increase`, '-q:v', '4', out])
      .catch(() => run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-frames:v', '1',
        '-vf', `scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=increase`, '-q:v', '4', out]));
    const dur = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).catch(() => '');
    if (parseFloat(dur)) db.prepare('UPDATE media SET duration = ? WHERE name = ?').run(parseFloat(dur), name);
  } else if (!HAS_SIPS) {
    await run('vipsthumbnail', [src, '-s', `${THUMB_SIZE}x${THUMB_SIZE}`, '-o', `${out}[Q=70]`]);
  } else {
    await run('sips', ['-Z', String(THUMB_SIZE), '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', src, '--out', out]);
  }
}

function thumb(name) {
  const out = path.join(THUMB_DIR, `${name}.jpg`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  if (!inflight.has(name)) {
    const p = enqueue(() => makeThumb(name, out))
      .then(() => out)
      .catch((e) => {
        console.log(`[thumb] failed for ${name}: ${e.message.split('\n')[0]}`);
        return path.join(DATA_DIR, name); // fall back to original
      })
      .finally(() => inflight.delete(name));
    inflight.set(name, p);
  }
  return inflight.get(name);
}

// ---------- api ----------
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (m === 'GET' && p === '/api/media') return json(res, listMedia(url.searchParams.get('view')));
  if (m === 'GET' && p === '/api/albums') return json(res, { albums: listAlbums(), counts: counts() });

  if (m === 'POST' && p === '/api/favorite') {
    const { names = [], favorite } = await readBody(req);
    const stmt = db.prepare('UPDATE media SET favorite = ? WHERE name = ?');
    for (const n of names) stmt.run(favorite ? 1 : 0, n);
    console.log(`[favorite] ${favorite ? 'marked' : 'unmarked'} ${names.length} item(s)`);
    return json(res, { ok: true });
  }

  if (m === 'POST' && p === '/api/albums') {
    const { name } = await readBody(req);
    const r = db.prepare('INSERT INTO albums (name, created_at) VALUES (?, ?)').run(name || 'Untitled', Date.now());
    console.log(`[album] created "${name}" (#${r.lastInsertRowid})`);
    return json(res, { id: Number(r.lastInsertRowid), name });
  }

  let match = p.match(/^\/api\/albums\/(\d+)$/);
  if (match && m === 'PATCH') {
    const { name } = await readBody(req);
    db.prepare('UPDATE albums SET name = ? WHERE id = ?').run(name, Number(match[1]));
    console.log(`[album] renamed #${match[1]} to "${name}"`);
    return json(res, { ok: true });
  }
  if (match && m === 'DELETE') {
    db.prepare('DELETE FROM albums WHERE id = ?').run(Number(match[1]));
    console.log(`[album] deleted #${match[1]}`);
    return json(res, { ok: true });
  }

  match = p.match(/^\/api\/albums\/(\d+)\/(add|remove)$/);
  if (match && m === 'POST') {
    const id = Number(match[1]);
    const { names = [] } = await readBody(req);
    const stmt =
      match[2] === 'add'
        ? db.prepare('INSERT OR IGNORE INTO album_media (album_id, media_name, added_at) VALUES (?, ?, ?)')
        : db.prepare('DELETE FROM album_media WHERE album_id = ? AND media_name = ?');
    const now = Date.now();
    for (const n of names) match[2] === 'add' ? stmt.run(id, n, now) : stmt.run(id, n);
    console.log(`[album] ${match[2]} ${names.length} item(s) ${match[2] === 'add' ? 'to' : 'from'} #${id}`);
    return json(res, { ok: true });
  }

  json(res, { error: 'not found' }, 404);
}

// ---------- server ----------
let vite;
if (DEV) {
  const { createServer } = await import('vite');
  vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (url.pathname.startsWith('/thumb/')) {
        const name = path.basename(decodeURIComponent(url.pathname.slice(7)));
        if (!typeOf(name) || !fs.existsSync(path.join(DATA_DIR, name))) {
          res.writeHead(404);
          return res.end();
        }
        return serveFile(req, res, await thumb(name), 'max-age=604800');
      }
      if (url.pathname.startsWith('/media/')) {
        const name = path.basename(decodeURIComponent(url.pathname.slice(7)));
        return serveFile(req, res, path.join(DATA_DIR, name), 'max-age=86400');
      }
      if (vite) return vite.middlewares(req, res);
      const file = path.join(DIST_DIR, path.normalize(url.pathname));
      if (url.pathname !== '/' && fs.existsSync(file)) return serveFile(req, res, file);
      serveFile(req, res, path.join(DIST_DIR, 'index.html'));
    } catch (e) {
      console.error('[error]', e);
      json(res, { error: e.message }, 500);
    }
  })
  .listen(PORT, () => {
    console.log(`Photos running at http://localhost:${PORT} ${DEV ? '(dev)' : ''}`);
    console.log(`Reading media from ${DATA_DIR}`);
    console.log(`Database at ${DB_PATH}`);
  });
