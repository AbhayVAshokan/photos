import './style.css';

// ---------- icons ----------
const icon = (d, fill = 'none') =>
  `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  grid: icon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  photo: icon('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  video: icon('<rect x="2.5" y="5" width="14" height="14" rx="2.5"/><path d="m16.5 10 5-3v10l-5-3"/>'),
  heart: icon('<path d="M12 20.5s-8-4.6-8-10.6A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.9c0 6-8 10.6-8 10.6Z"/>'),
  heartFill: icon('<path d="M12 20.5s-8-4.6-8-10.6A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.9c0 6-8 10.6-8 10.6Z"/>', 'currentColor'),
  albums: icon('<rect x="3" y="7" width="18" height="14" rx="2.5"/><path d="M6 4h12"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  check: icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  close: icon('<path d="M6 6l12 12M18 6 6 18"/>'),
  left: icon('<path d="m15 5-7 7 7 7"/>'),
  right: icon('<path d="m9 5 7 7-7 7"/>'),
  folderPlus: icon('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/><path d="M12 11v5M9.5 13.5h5"/>'),
  minus: icon('<path d="M5 12h14"/>'),
  trash: icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  edit: icon('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>'),
  select: icon('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>'),
  play: icon('<path d="M8 5v14l11-7Z"/>', 'currentColor'),
};

// ---------- state ----------
const state = {
  view: 'all',
  items: [],
  albums: [],
  counts: {},
  selected: new Set(),
  selectMode: false,
  lastClicked: null,
  lightbox: -1,
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const mediaUrl = (name) => `/media/${encodeURIComponent(name)}`;
const thumbUrl = (name) => `/thumb/${encodeURIComponent(name)}`;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) console.error('[api]', path, data);
  return data;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2600);
}

// ---------- routing ----------
const LIBRARY = [
  { id: 'all', label: 'All items', icon: I.grid, count: 'all_count' },
  { id: 'photos', label: 'Photos', icon: I.photo, count: 'photos' },
  { id: 'videos', label: 'Videos', icon: I.video, count: 'videos' },
  { id: 'favorites', label: 'Favorites', icon: I.heart, count: 'favorites' },
  { id: 'albums', label: 'Albums', icon: I.albums },
];

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('album/')) return h.split('/')[1];
  return LIBRARY.some((l) => l.id === h) ? h : 'all';
}

const isAlbumView = () => /^\d+$/.test(state.view);
const currentAlbum = () => state.albums.find((a) => String(a.id) === state.view);

window.addEventListener('hashchange', () => load());

// ---------- data ----------
async function refreshAlbums() {
  const { albums, counts } = await api('/api/albums');
  state.albums = albums;
  state.counts = counts;
  renderSidebar();
}

let loadToken = 0;
async function load({ keepSelection = false } = {}) {
  const token = ++loadToken;
  const prevView = state.view;
  state.view = parseHash();
  if (!keepSelection) clearSelection(false);
  if (prevView !== state.view) {
    // Drop the old grid right away so the browser cancels its pending image requests.
    if (state.lightbox >= 0) closeLightbox();
    $('#view').innerHTML = '<div class="loading"><span></span></div>';
    renderSidebar();
    window.scrollTo(0, 0);
  }
  const [, items] = await Promise.all([
    refreshAlbums(),
    state.view !== 'albums' ? api(`/api/media?view=${state.view}`) : null,
  ]);
  if (token !== loadToken) return; // a newer navigation happened meanwhile
  if (items) state.items = items;
  render();
}

// ---------- sidebar ----------
function renderSidebar() {
  $('#library-nav').innerHTML = LIBRARY.map(
    (l) => `<li><a href="#/${l.id}" class="${state.view === l.id ? 'active' : ''}">
      <span class="nav-icon">${l.icon}</span><span class="nav-text">${l.label}</span>
      <span class="nav-count">${l.count ? state.counts[l.count] || 0 : state.albums.length}</span></a></li>`
  ).join('');

  $('#album-nav').innerHTML =
    state.albums
      .map(
        (a) => `<li><a href="#/album/${a.id}" class="${state.view === String(a.id) ? 'active' : ''}" data-drop-album="${a.id}">
        <span class="nav-thumb">${a.cover ? thumbHtml(a.cover, a.cover_type) : I.albums}</span>
        <span class="nav-text">${esc(a.name)}</span><span class="nav-count">${a.count}</span></a></li>`
      )
      .join('') || `<li class="nav-empty">No albums yet</li>`;
}

function thumbHtml(name) {
  return `<img src="${thumbUrl(name)}" loading="lazy" decoding="async" alt="">`;
}

$('#new-album-btn').innerHTML = I.plus;
$('#new-album-btn').onclick = async () => {
  const name = await promptModal('New album', 'Album name');
  if (!name) return;
  const a = await api('/api/albums', { method: 'POST', body: { name } });
  location.hash = `#/album/${a.id}`;
  toast(`Created “${name}”`);
};

// ---------- main view ----------
function render() {
  const album = currentAlbum();
  const lib = LIBRARY.find((l) => l.id === state.view);
  $('#view-title').textContent = album ? album.name : lib?.label || 'All items';

  if (state.view === 'albums') {
    $('#view-subtitle').textContent = `${state.albums.length} album${state.albums.length === 1 ? '' : 's'}`;
    $('#topbar-actions').innerHTML = `<button class="btn" id="tb-new">${I.plus}New album</button>`;
    $('#tb-new').onclick = () => $('#new-album-btn').click();
    renderAlbumsGrid();
  } else {
    const p = state.items.filter((i) => i.type === 'image').length;
    const v = state.items.length - p;
    $('#view-subtitle').textContent =
      [p && `${p} photo${p === 1 ? '' : 's'}`, v && `${v} video${v === 1 ? '' : 's'}`].filter(Boolean).join(' · ') ||
      'Empty';
    renderTopbar(album);
    renderGrid();
  }
  renderActionBar();
}

function renderTopbar(album) {
  $('#topbar-actions').innerHTML = `
    ${album ? `<button class="btn ghost" id="tb-rename">${I.edit}Rename</button>
               <button class="btn ghost danger" id="tb-delete">${I.trash}Delete</button>` : ''}
    <button class="btn ${state.selectMode ? 'primary' : ''}" id="tb-select">${I.select}${state.selectMode ? 'Done' : 'Select'}</button>`;
  $('#tb-select').onclick = () => {
    state.selectMode = !state.selectMode;
    if (!state.selectMode) clearSelection();
    else {
      renderTopbar(album);
      updateSelectionUI();
    }
  };
  if (album) {
    $('#tb-rename').onclick = async () => {
      const name = await promptModal('Rename album', 'Album name', album.name);
      if (!name) return;
      await api(`/api/albums/${album.id}`, { method: 'PATCH', body: { name } });
      load({ keepSelection: true });
    };
    $('#tb-delete').onclick = async () => {
      if (!(await confirmModal(`Delete “${album.name}”?`, 'Photos stay in your library.'))) return;
      await api(`/api/albums/${album.id}`, { method: 'DELETE' });
      toast(`Deleted “${album.name}”`);
      location.hash = '#/albums';
    };
  }
}

function groupByDay(items) {
  const groups = [];
  const thisYear = new Date().getFullYear();
  let cur;
  items.forEach((item, idx) => {
    const d = new Date(item.mtime);
    const key = d.toDateString();
    if (!cur || cur.key !== key) {
      const label = d.toLocaleDateString(undefined, {
        weekday: 'long', day: 'numeric', month: 'long',
        ...(d.getFullYear() !== thisYear && { year: 'numeric' }),
      });
      groups.push((cur = { key, label, items: [] }));
    }
    cur.items.push({ item, idx });
  });
  return groups;
}

// Day groups currently on screen, as lists of item indexes (for "select day").
let dayGroups = [];
const groupNames = (gi) => dayGroups[gi].map((idx) => state.items[idx].name);
const groupAllSelected = (gi) => groupNames(gi).every((n) => state.selected.has(n));

function groupHeadHtml(c) {
  return `<div class="group-head">
    <h2 class="group-label">${c.label}</h2>
    <span class="group-count">${dayGroups[c.gi].length}</span>
    <button class="group-select" data-group="${c.gi}">${groupAllSelected(c.gi) ? 'Deselect' : 'Select'}</button>
  </div>`;
}

function tileHtml(item, idx, delay = 0) {
  const sel = state.selected.has(item.name);
  return `<figure class="tile ${sel ? 'selected' : ''}" data-idx="${idx}" style="--d:${delay}ms">
    <div class="tile-media">
      <img src="${thumbUrl(item.name)}" loading="lazy" decoding="async" alt="${esc(item.name)}">
      ${item.type === 'video' ? `<span class="badge">${I.play}${item.duration ? fmtDur(item.duration) : ''}</span>` : ''}
    </div>
    <button class="tile-check" data-act="check" title="Select">${I.check}</button>
    <button class="tile-fav ${item.favorite ? 'on' : ''}" data-act="fav" title="Favorite">${item.favorite ? I.heartFill : I.heart}</button>
  </figure>`;
}

function renderGrid() {
  stopPreview();
  const view = $('#view');
  if (!state.items.length) {
    view.innerHTML = emptyState();
    return;
  }
  const grouped = isAlbumView() ? [{ label: null, items: state.items.map((item, idx) => ({ item, idx })) }] : groupByDay(state.items);
  dayGroups = grouped.map((g) => g.items.map((x) => x.idx));

  // Split day groups into small chunks; chunks get appended as you scroll.
  pendingChunks = [];
  grouped.forEach((g, gi) => {
    for (let i = 0; i < g.items.length; i += CHUNK)
      pendingChunks.push({ label: i === 0 ? g.label : null, gi, cont: i > 0, items: g.items.slice(i, i + CHUNK) });
  });

  view.innerHTML = '<div id="grid-root"></div><div id="grid-sentinel"></div>';
  firstBatch = true;
  renderMoreChunks();
  firstBatch = false;
  scrollObserver?.disconnect();
  scrollObserver = new IntersectionObserver((e) => e[0].isIntersecting && renderMoreChunks(), { rootMargin: `${PRELOAD_PX}px` });
  scrollObserver.observe($('#grid-sentinel'));
}

const CHUNK = 48; // tiles per chunk (divisible by most column counts)
const BATCH = 144; // tiles appended per scroll trigger
const PRELOAD_PX = 1200; // start appending this far before reaching the bottom
let pendingChunks = [];
let scrollObserver;
let firstBatch = false;

function renderMoreChunks() {
  const root = $('#grid-root');
  if (!root || !pendingChunks.length) return;
  const selecting = state.selectMode || state.selected.size ? 'selecting' : '';
  let html = '';
  let count = 0;
  while (pendingChunks.length && count < BATCH) {
    const c = pendingChunks.shift();
    html += `${c.label ? groupHeadHtml(c) : ''}
      <div class="grid chunk ${c.cont ? 'cont' : ''} ${selecting} ${firstBatch ? '' : 'no-anim'}">${c.items
        .map(({ item, idx }, i) => tileHtml(item, idx, firstBatch ? Math.min(count + i, 30) * 12 : 0))
        .join('')}</div>`;
    count += c.items.length;
  }
  root.insertAdjacentHTML('beforeend', html);
  // If the sentinel is still on screen (tall window), keep filling on the next frame.
  requestAnimationFrame(() => {
    const s = $('#grid-sentinel');
    if (s && pendingChunks.length && s.getBoundingClientRect().top < innerHeight + PRELOAD_PX) renderMoreChunks();
  });
}

// Re-draw a single tile in place (keeps scroll position and loaded chunks).
function refreshTile(name) {
  const idx = state.items.findIndex((i) => i.name === name);
  const el = document.querySelector(`.tile[data-idx="${idx}"]`);
  if (!el) return;
  el.outerHTML = tileHtml(state.items[idx], idx);
}

// Hover preview for videos: only one <video> exists at a time, created on hover and
// fully released on leave so it never hogs a browser connection.
let preview = null;
let previewTimer;
function stopPreview() {
  clearTimeout(previewTimer);
  if (!preview) return;
  preview.pause();
  preview.removeAttribute('src');
  preview.load();
  preview.remove();
  preview = null;
}
$('#view').addEventListener('mouseover', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile || tile.contains(preview)) return;
  stopPreview();
  const item = state.items[tile.dataset.idx];
  if (item?.type !== 'video') return;
  previewTimer = setTimeout(() => {
    preview = Object.assign(document.createElement('video'), {
      src: mediaUrl(item.name), muted: true, autoplay: true, loop: true, playsInline: true, className: 'preview',
    });
    tile.querySelector('.tile-media').append(preview);
  }, 350);
});
$('#view').addEventListener('mouseout', (e) => {
  const tile = e.target.closest('.tile');
  if (tile && !tile.contains(e.relatedTarget)) stopPreview();
});

function emptyState() {
  const msg =
    state.view === 'favorites' ? ['No favorites yet', 'Tap the heart on any photo to keep it here.']
    : isAlbumView() ? ['This album is empty', 'Select photos in your library and add them here.']
    : ['Nothing here yet', 'Drop photos and videos into the ./data folder and refresh.'];
  return `<div class="empty"><div class="empty-art">${isAlbumView() ? I.albums : state.view === 'favorites' ? I.heart : I.photo}</div>
    <h3>${msg[0]}</h3><p>${msg[1]}</p></div>`;
}

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function renderAlbumsGrid() {
  if (!state.albums.length) {
    $('#view').innerHTML = `<div class="empty"><div class="empty-art">${I.albums}</div><h3>No albums yet</h3>
      <p>Create an album, then select photos to add to it.</p></div>`;
    return;
  }
  $('#view').innerHTML = `<div class="album-grid">${state.albums
    .map(
      (a, i) => `<a class="album-card" href="#/album/${a.id}" style="--d:${i * 30}ms">
        <div class="album-cover">${a.cover ? thumbHtml(a.cover, a.cover_type) : `<div class="album-placeholder">${I.albums}</div>`}</div>
        <div class="album-meta"><strong>${esc(a.name)}</strong><span>${a.count} item${a.count === 1 ? '' : 's'}</span></div>
      </a>`
    )
    .join('')}</div>`;
}

// ---------- grid interactions ----------
$('#view').addEventListener('click', async (e) => {
  if (Date.now() < suppressClickUntil) return; // click that ends a drag-select

  const groupBtn = e.target.closest('.group-select');
  if (groupBtn) {
    const gi = Number(groupBtn.dataset.group);
    const all = groupAllSelected(gi);
    groupNames(gi).forEach((n) => (all ? state.selected.delete(n) : state.selected.add(n)));
    updateSelectionUI();
    return;
  }

  const tile = e.target.closest('.tile');
  if (!tile) return;
  const idx = Number(tile.dataset.idx);
  const item = state.items[idx];
  const act = e.target.closest('[data-act]')?.dataset.act;

  if (act === 'fav') {
    await setFavorite([item.name], !item.favorite);
    return;
  }
  const selecting = state.selectMode || state.selected.size > 0;
  if (act === 'check' || selecting || e.metaKey || e.ctrlKey || e.shiftKey) {
    if (e.shiftKey && state.lastClicked !== null) {
      const [a, b] = [state.lastClicked, idx].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) state.selected.add(state.items[i].name);
    } else {
      state.selected.has(item.name) ? state.selected.delete(item.name) : state.selected.add(item.name);
    }
    state.lastClicked = idx;
    updateSelectionUI();
    return;
  }
  openLightbox(idx);
});

function updateSelectionUI() {
  document.querySelectorAll('.tile').forEach((t) => {
    t.classList.toggle('selected', state.selected.has(state.items[t.dataset.idx].name));
  });
  document.querySelectorAll('.grid').forEach((g) => g.classList.toggle('selecting', state.selectMode || state.selected.size > 0));
  document.querySelectorAll('.group-select').forEach((b) => {
    b.textContent = groupAllSelected(Number(b.dataset.group)) ? 'Deselect' : 'Select';
  });
  renderActionBar();
}

// ---------- long-press + drag to select ----------
// Hold on a tile (mouse or finger) to start selecting, then drag across tiles to
// select the range. Starting on a selected tile deselects instead. Dragging near the
// top/bottom edge auto-scrolls.
const LONG_PRESS_MS = 350;
const EDGE_PX = 80;
let press = null;
let drag = null;
let suppressClickUntil = 0;

function cancelPress() {
  if (press) clearTimeout(press.timer);
  press = null;
}

function startDrag(idx) {
  press = null;
  drag = { anchor: idx, last: -1, adding: !state.selected.has(state.items[idx].name), base: new Set(state.selected), x: 0, y: 0 };
  document.body.classList.add('drag-selecting');
  navigator.vibrate?.(15);
  applyDrag(idx);
  requestAnimationFrame(autoScroll);
}

function applyDrag(idx) {
  if (idx === drag.last) return;
  drag.last = idx;
  const [a, b] = [drag.anchor, idx].sort((x, y) => x - y);
  state.selected = new Set(drag.base);
  for (let i = a; i <= b; i++) {
    const n = state.items[i].name;
    drag.adding ? state.selected.add(n) : state.selected.delete(n);
  }
  state.lastClicked = idx;
  updateSelectionUI();
}

function moveDrag(x, y) {
  drag.x = x;
  drag.y = y;
  const tile = document.elementFromPoint(x, y)?.closest('.tile');
  if (tile) applyDrag(Number(tile.dataset.idx));
}

function autoScroll() {
  if (!drag) return;
  const { y } = drag;
  const speed = y < EDGE_PX ? -(EDGE_PX - y) / 3 : y > innerHeight - EDGE_PX ? (y - (innerHeight - EDGE_PX)) / 3 : 0;
  if (speed && y) {
    scrollBy(0, speed);
    moveDrag(drag.x, drag.y);
  }
  requestAnimationFrame(autoScroll);
}

function endDrag() {
  cancelPress();
  if (!drag) return;
  drag = null;
  document.body.classList.remove('drag-selecting');
  suppressClickUntil = Date.now() + 400;
}

$('#view').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('[data-act="fav"]')) return;
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const idx = Number(tile.dataset.idx);
  press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => startDrag(idx), LONG_PRESS_MS) };
});
document.addEventListener('pointermove', (e) => {
  if (drag) return moveDrag(e.clientX, e.clientY);
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) cancelPress(); // it's a scroll
});
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', (e) => {
  // On touch the browser may cancel pointers once we block scrolling; touchend ends the drag then.
  if (!(drag && e.pointerType === 'touch')) endDrag();
});
// While drag-selecting on touch: stop the page from scrolling and track the finger.
document.addEventListener(
  'touchmove',
  (e) => {
    if (!drag) return;
    e.preventDefault();
    moveDrag(e.touches[0].clientX, e.touches[0].clientY);
  },
  { passive: false }
);
document.addEventListener('touchend', endDrag);
document.addEventListener('touchcancel', endDrag);
$('#view').addEventListener('contextmenu', (e) => (press || drag) && e.preventDefault());
$('#view').addEventListener('dragstart', (e) => e.preventDefault());

function clearSelection(rerender = true) {
  state.selected.clear();
  state.lastClicked = null;
  state.selectMode = false;
  if (rerender) {
    if (state.view !== 'albums') renderTopbar(currentAlbum());
    updateSelectionUI();
  }
}

// ---------- actions ----------
async function setFavorite(names, favorite) {
  await api('/api/favorite', { method: 'POST', body: { names, favorite } });
  names.forEach((n) => {
    const it = state.items.find((i) => i.name === n);
    if (it) it.favorite = favorite;
  });
  if (names.length > 1) toast(`${favorite ? 'Added' : 'Removed'} ${names.length} ${favorite ? 'to' : 'from'} favorites`);
  if (state.view === 'favorites' && !favorite) {
    await load({ keepSelection: false });
  } else {
    names.forEach(refreshTile);
    renderActionBar();
    await refreshAlbums();
  }
  if (state.lightbox >= 0) renderLightbox();
}

async function addToAlbum(names, albumId) {
  await api(`/api/albums/${albumId}/add`, { method: 'POST', body: { names } });
  const a = state.albums.find((x) => x.id === albumId);
  toast(`Added ${names.length} item${names.length === 1 ? '' : 's'} to “${a?.name || 'album'}”`);
  names.forEach((n) => {
    const it = state.items.find((i) => i.name === n);
    if (it && !it.albums.includes(albumId)) it.albums.push(albumId);
  });
  await refreshAlbums();
}

async function removeFromAlbum(names, albumId) {
  await api(`/api/albums/${albumId}/remove`, { method: 'POST', body: { names } });
  toast(`Removed ${names.length} item${names.length === 1 ? '' : 's'} from album`);
  await load();
}

function renderActionBar() {
  const bar = $('#action-bar');
  const n = state.selected.size;
  bar.classList.toggle('show', n > 0);
  if (!n) return;
  const names = [...state.selected];
  const allFav = names.every((nm) => state.items.find((i) => i.name === nm)?.favorite);
  bar.innerHTML = `
    <span class="ab-count">${n} selected</span>
    <span class="ab-sep"></span>
    <button class="ab-btn" id="ab-all">Select all</button>
    <button class="ab-btn" id="ab-fav">${allFav ? I.heart : I.heartFill}${allFav ? 'Unfavorite' : 'Favorite'}</button>
    <button class="ab-btn" id="ab-album">${I.folderPlus}Add to album</button>
    ${isAlbumView() ? `<button class="ab-btn" id="ab-remove">${I.minus}Remove</button>` : ''}
    <button class="ab-btn icon" id="ab-close" title="Clear (Esc)">${I.close}</button>`;
  $('#ab-all').onclick = () => {
    state.items.forEach((i) => state.selected.add(i.name));
    updateSelectionUI();
  };
  $('#ab-fav').onclick = async () => {
    await setFavorite(names, !allFav);
    updateSelectionUI();
  };
  $('#ab-album').onclick = () => albumPicker(names, () => clearSelection());
  $('#ab-close').onclick = () => clearSelection();
  if (isAlbumView()) $('#ab-remove').onclick = () => removeFromAlbum(names, Number(state.view));
}

// ---------- modals ----------
function openModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal">${html}</div>`;
  m.classList.add('show');
  return m.querySelector('.modal');
}
function closeModal() {
  $('#modal').classList.remove('show');
}
$('#modal').addEventListener('mousedown', (e) => e.target.id === 'modal' && closeModal());

function promptModal(title, placeholder, value = '') {
  return new Promise((resolve) => {
    const m = openModal(`<h3>${title}</h3>
      <form><input class="input" placeholder="${placeholder}" value="${esc(value)}" autofocus>
      <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Cancel</button>
      <button class="btn primary">Save</button></div></form>`);
    const input = m.querySelector('input');
    setTimeout(() => input.select(), 20);
    m.querySelector('[data-cancel]').onclick = () => { closeModal(); resolve(null); };
    m.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      closeModal();
      resolve(input.value.trim() || null);
    };
  });
}

function confirmModal(title, text) {
  return new Promise((resolve) => {
    const m = openModal(`<h3>${title}</h3><p class="muted">${text}</p>
      <div class="modal-actions"><button class="btn ghost" data-no>Cancel</button><button class="btn danger-solid" data-yes>Delete</button></div>`);
    m.querySelector('[data-no]').onclick = () => { closeModal(); resolve(false); };
    m.querySelector('[data-yes]').onclick = () => { closeModal(); resolve(true); };
  });
}

function albumPicker(names, done) {
  const inAll = (a) => names.every((n) => state.items.find((i) => i.name === n)?.albums.includes(a.id));
  const m = openModal(`<h3>Add ${names.length} item${names.length === 1 ? '' : 's'} to album</h3>
    <div class="picker-list">${state.albums
      .map(
        (a) => `<button class="picker-item" data-id="${a.id}">
          <span class="picker-thumb">${a.cover ? thumbHtml(a.cover, a.cover_type) : I.albums}</span>
          <span class="picker-name">${esc(a.name)}<small>${a.count} items</small></span>
          ${inAll(a) ? `<span class="picker-in">${I.check}</span>` : ''}
        </button>`
      )
      .join('') || '<p class="muted">No albums yet — create one below.</p>'}</div>
    <form class="picker-new"><input class="input" placeholder="New album name…">
      <button class="btn primary">${I.plus}Create & add</button></form>`);
  m.querySelectorAll('.picker-item').forEach((b) => {
    b.onclick = async () => {
      closeModal();
      await addToAlbum(names, Number(b.dataset.id));
      done?.();
    };
  });
  m.querySelector('.picker-new').onsubmit = async (e) => {
    e.preventDefault();
    const name = e.target.querySelector('input').value.trim();
    if (!name) return;
    closeModal();
    const a = await api('/api/albums', { method: 'POST', body: { name } });
    await refreshAlbums();
    await addToAlbum(names, a.id);
    done?.();
  };
}

// ---------- lightbox ----------
function openLightbox(idx) {
  state.lightbox = idx;
  $('#lightbox').classList.add('show');
  document.body.style.overflow = 'hidden';
  renderLightbox();
}
function releaseVideos(root) {
  root.querySelectorAll('video').forEach((v) => {
    v.pause();
    v.removeAttribute('src');
    v.load();
  });
}
function closeLightbox() {
  state.lightbox = -1;
  $('#lightbox').classList.remove('show');
  releaseVideos($('#lightbox'));
  $('#lightbox').innerHTML = '';
  document.body.style.overflow = '';
}
function stepLightbox(d) {
  if (state.lightbox < 0) return;
  state.lightbox = (state.lightbox + d + state.items.length) % state.items.length;
  renderLightbox();
}

function renderLightbox() {
  const item = state.items[state.lightbox];
  if (!item) return closeLightbox();
  const date = new Date(item.mtime).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
  const albums = state.albums.filter((a) => item.albums.includes(a.id));
  const lb = $('#lightbox');
  releaseVideos(lb);
  lb.innerHTML = `
    <div class="lb-bg" style="background-image:url('${thumbUrl(item.name)}')"></div>
    <div class="lb-top">
      <div class="lb-info"><strong>${esc(item.name)}</strong><span>${date} · ${(item.size / 1048576).toFixed(1)} MB</span>
        ${albums.length ? `<div class="lb-chips">${albums.map((a) => `<a href="#/album/${a.id}" class="chip">${esc(a.name)}</a>`).join('')}</div>` : ''}
      </div>
      <div class="lb-actions">
        <button class="icon-btn ${item.favorite ? 'fav-on' : ''}" id="lb-fav" title="Favorite (F)">${item.favorite ? I.heartFill : I.heart}</button>
        <button class="icon-btn" id="lb-album" title="Add to album (A)">${I.folderPlus}</button>
        <button class="icon-btn" id="lb-close" title="Close (Esc)">${I.close}</button>
      </div>
    </div>
    <button class="lb-nav prev" id="lb-prev">${I.left}</button>
    <div class="lb-stage">${item.type === 'video'
      ? `<video src="${mediaUrl(item.name)}" controls autoplay playsinline></video>`
      : `<img src="${mediaUrl(item.name)}" alt="${esc(item.name)}">`}</div>
    <button class="lb-nav next" id="lb-next">${I.right}</button>
    <div class="lb-counter">${state.lightbox + 1} / ${state.items.length}</div>`;
  $('#lb-close').onclick = closeLightbox;
  $('#lb-prev').onclick = () => stepLightbox(-1);
  $('#lb-next').onclick = () => stepLightbox(1);
  $('#lb-fav').onclick = () => setFavorite([item.name], !item.favorite);
  $('#lb-album').onclick = () => albumPicker([item.name], () => renderLightbox());
  lb.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', closeLightbox));
  lb.querySelector('.lb-stage').onclick = (e) => e.target.classList.contains('lb-stage') && closeLightbox();
}

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input')) return;
  if ($('#modal').classList.contains('show')) {
    if (e.key === 'Escape') closeModal();
    return;
  }
  if (state.lightbox >= 0) {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
    if (e.key === 'f') $('#lb-fav').click();
    if (e.key === 'a') $('#lb-album').click();
    return;
  }
  if (e.key === 'Escape' && (state.selected.size || state.selectMode)) clearSelection();
  if ((e.metaKey || e.ctrlKey) && e.key === 'a' && state.view !== 'albums') {
    e.preventDefault();
    state.items.forEach((i) => state.selected.add(i.name));
    updateSelectionUI();
  }
});

load();
