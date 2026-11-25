/* CR CSU — prise de notes horodatées pour comptes-rendus */
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const NATIVE = typeof window.Android !== 'undefined';

/* ---------- Stockage (IndexedDB) ---------- */
let db;
function openDB() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open('crcsu', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('media'); };
    r.onsuccess = () => { db = r.result; ok(); };
    r.onerror = () => ko(r.error);
  });
}
function idb(store, mode, fn) {
  return new Promise((ok, ko) => {
    const tx = db.transaction(store, mode); const req = fn(tx.objectStore(store));
    tx.oncomplete = () => ok(req && req.result); tx.onerror = () => ko(tx.error);
  });
}
const putMedia = (id, blob) => idb('media', 'readwrite', s => s.put(blob, id));
const getMedia = async id => { if (typeof pending !== 'undefined' && pending[id]) await pending[id]; return idb('media', 'readonly', s => s.get(id)); };
const delMedia = id => idb('media', 'readwrite', s => s.delete(id));
const allMediaKeys = () => idb('media', 'readonly', s => s.getAllKeys());

const DEFAULT = () => ({
  profile: { name: 'Zouti' },
  sections: [{ id: 'csu', name: 'CSU' }],
  categories: [
    { id: 'c1', color: '#2f7cf6', name: 'Surveillance', actions: ['Ronde caméras', 'Individu suspect', 'Attroupement'] },
    { id: 'c2', color: '#34a853', name: 'Intervention', actions: ['Appel police', 'Appel pompiers', 'Réquisition vidéo'] },
    { id: 'c3', color: '#e5484d', name: 'Incident', actions: ['Accident', 'Dégradation', 'Rixe'] },
    { id: 'c4', color: '#f59e0b', name: 'Technique', actions: ['Caméra HS', 'Panne réseau'] }
  ],
  buttons: ['c1|Ronde caméras', 'c1|Individu suspect', 'c2|Appel police', 'c2|Appel pompiers', 'c3|Accident', 'c3|Rixe'],
  reminders: [],
  phones: [
    { n: 'Police secours', t: '17', ok: 1 }, { n: 'Pompiers', t: '18', ok: 1 }, { n: 'SAMU', t: '15', ok: 1 }, { n: 'Urgence européenne', t: '112', ok: 1 },
    { n: 'Mairie de Yerres', t: '01 69 49 76 00', ok: 1 }, { n: 'Mairie annexe', t: '01 69 49 77 16' },
    { n: 'Police municipale', t: '01 69 49 77 66', ok: 1 }, { n: 'Services techniques', t: '01 69 49 77 00', ok: 1 },
    { n: 'AMIE (3e âge)', t: '0800 64 85 26' }, { n: 'Allô M. le Maire', t: '0800 22 12 02' },
    { n: 'Allô propreté', t: '0800 91 330' }, { n: 'Éclairage public', t: '0800 77 02 02' }
  ],
  settings: {
    defaultName: 'CSU', validation: 'auto', sortReports: 'date', sortEvents: 'date', useEndDate: false,
    timeFormat: 'sans', maxButtons: '9', btnCols: '3', imageQuality: 'moyenne', videoQuality: 'moyenne', autoGeo: false, lang: 'fr',
    email: '', multiExport: 'date', showDates: 'debut', showCoords: true, showCoordDate: false,
    showAddress: true, showComment: true, protectedExport: false, pin: '',
    lockOn: false, lockHash: '', lockSalt: '', lockLen: 0, lockBio: false, lockDelay: '60', secureScreen: false,
    bigButtons: false, shiftAuto: false, shiftTimes: '07:00, 19:00', autoBackup: true, pdfOrg: '', pdfAgent: '', pdfLogo: '', pdfSign: '', pdfSummary: true
  },
  reports: []
});
let S;
async function load() {
  await openDB();
  S = await idb('kv', 'readonly', s => s.get('state'));
  if (!S) S = DEFAULT();
  const d = DEFAULT();
  S.settings = Object.assign(d.settings, S.settings || {});
  for (const k of ['profile', 'sections', 'categories', 'buttons', 'reminders', 'phones', 'reports']) if (!S[k]) S[k] = d[k];
}
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => idb('kv', 'readwrite', s => s.put(S, 'state')), 150); }

/* ---------- Dates ---------- */
const p2 = n => String(n).padStart(2, '0');
const fDate = t => { const d = new Date(t); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; };
const fTime = t => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}` + (S.settings.timeFormat === 'avec' ? ':' + p2(d.getSeconds()) : ''); };
const dayKey = t => fDate(t);
const toLocalInput = t => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

function reportSpan(r) {
  if (S.settings.useEndDate && r.start) {
    const a = fDate(r.start), b = r.end ? fDate(r.end) : null;
    return b && b !== a ? `${a} au ${b}` : `Le ${a}`;
  }
  const ts = r.events.map(e => e.ts);
  if (!ts.length) return `Le ${fDate(r.created)}`;
  const a = fDate(Math.min(...ts)), b = fDate(Math.max(...ts));
  return a === b ? `Le ${a}` : `${a} au ${b}`;
}
const reportFirst = r => r.events.length ? Math.min(...r.events.map(e => e.ts)) : r.created;
const sectionName = id => (S.sections.find(s => s.id === id) || {}).name || '—';
function sortedEvents(r) {
  const ev = [...r.events];
  return S.settings.sortEvents === 'date_desc' ? ev.sort((a, b) => b.ts - a.ts) : ev.sort((a, b) => a.ts - b.ts);
}

/* ---------- UI de base ---------- */
const stacks = { cr: [{ v: 'sections' }], export: [{ v: 'export' }], plan: [{ v: 'plan' }], settings: [{ v: 'settings' }], about: [{ v: 'about' }] };
let tab = 'cr';
const cur = () => stacks[tab][stacks[tab].length - 1];
function go(v, args = {}) { stacks[tab].push(Object.assign({ v }, args)); render(); $('#view').scrollTop = 0; }
function back() { if (stacks[tab].length > 1) { stacks[tab].pop(); render(); } }
window.__back = () => { if (document.getElementById('lock')) return false; if ($('#modalRoot').innerHTML) { closeModal(); return true; } if (stacks[tab].length > 1) { back(); return true; } return false; };

function toast(m) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2300); }
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 4l-8 8 8 8"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M6 11H4.5v10h15V11H18"/></svg>',
  gallery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9.5" r="1.8"/><path d="M21 16l-5-5-8 9"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.8"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.5s-7-7.2-7-12.5a7 7 0 0 1 14 0c0 5.3-7 12.5-7 12.5z"/><circle cx="12" cy="9" r="2.6"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4M8.5 21.5h7"/></svg>'
};
function setBar(title, left = '', right = '') { $('#barTitle').textContent = title; $('#barLeft').innerHTML = left; $('#barRight').innerHTML = right; }
const backBtn = (label = 'Retour') => `<button class="bbtn" data-a="back">${ICON.back}${esc(label)}</button>`;

function render() {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const c = cur(); const fn = VIEWS[c.v];
  $('#view').innerHTML = fn ? fn(c) : '';
  if (c.after) c.after();
  hydrateMedia();
}

/* ---------- Vues ---------- */
const VIEWS = {};
const maxBtn = () => +(S.settings.maxButtons || 9);
const PALETTE = ['#2f7cf6', '#34a853', '#e5484d', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#a16207', '#0ea5e9'];
const catColor = k => k.color || PALETTE[Math.max(0, S.categories.indexOf(k)) % PALETTE.length];
function colorOf(e) {
  let k = e.cat && S.categories.find(x => x.id === e.cat);
  if (!k && e.category) k = S.categories.find(x => x.actions.includes(e.category));
  return k ? catColor(k) : '';
}
function applyBig() { document.documentElement.classList.toggle('big', !!(S && S.settings.bigButtons)); }
/* ---------- Thème clair / sombre ---------- */
const mqDark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const t = (S && S.settings.theme) || 'clair';
  const dark = t === 'sombre' || (t === 'auto' && mqDark && mqDark.matches);
  document.documentElement.classList.toggle('dark', dark);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#000000' : '#2a2c2e';
}
if (mqDark && mqDark.addEventListener) mqDark.addEventListener('change', applyTheme);

function searchHits(q) {
  q = q.trim().toLowerCase(); if (q.length < 2) return null;
  const hits = [];
  for (const r of S.reports) for (const e of r.events) {
    const hay = [r.name, e.category, e.text, e.comment, e.address, e.phone].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(q)) hits.push({ r, e });
  }
  return hits.sort((a, b) => b.e.ts - a.e.ts);
}
function renderSearch() {
  const box = $('#searchRes'); if (!box) return;
  const q = $('#searchIn').value; const hits = searchHits(q);
  $('#secList').style.display = hits ? 'none' : '';
  if (!hits) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="hint">${plural(hits.length, 'résultat')}</div>` + hits.slice(0, 200).map(({ r, e }) => `<div class="cell" data-a="openHit" data-r="${r.id}" data-e="${e.id}" style="${colorOf(e) ? `border-left:5px solid ${colorOf(e)}` : ''}"><div class="grow"><div class="t" style="font-weight:600;font-size:15px">${esc(evLine(e))}</div><div class="s">${esc(r.name)} · ${fDate(e.ts)} à ${fTime(e.ts)}${e.comment ? ' · ' + esc(e.comment) : ''}${e.address ? ' · ' + esc(e.address) : ''}${e.phone ? ' · 📞 ' + esc(e.phone) : ''}</div></div><span class="chev">›</span></div>`).join('');
}
VIEWS.sections = c => {
  c.after = () => { const i = $('#searchIn'); if (i) { i.value = c.q || ''; i.oninput = () => { c.q = i.value; renderSearch(); }; renderSearch(); } };
  return `<div class="search"><input id="searchIn" type="search" placeholder="🔍 Rechercher (mot, adresse, plaque, n°…)" autocomplete="off"></div><div id="searchRes"></div><div id="secList">` + VIEWS._sections() + '</div>';
};
VIEWS._sections = () => {
  setBar('Sections', '', '');
  return `<div class="cell" data-a="openSection" data-id="*"><div class="grow t" style="font-weight:600">Toutes les sections</div><span class="val">${S.reports.length}</span><span class="chev">›</span></div>` +
    S.sections.map(s => `<div class="cell" data-a="openSection" data-id="${s.id}"><div class="grow">${esc(s.name)}</div><span class="val">${S.reports.filter(r => r.sectionId === s.id).length}</span><span class="chev">›</span></div>`).join('');
};

function reportsOf(sec) {
  let l = S.reports.filter(r => sec === '*' || r.sectionId === sec);
  if (S.settings.sortReports === 'nom') l.sort((a, b) => a.name.localeCompare(b.name) || reportFirst(a) - reportFirst(b));
  else l.sort((a, b) => reportFirst(a) - reportFirst(b));
  return l;
}
const crCell = (r, extra = '') => `<div class="cell cr" data-a="openReport" data-id="${r.id}">${extra}<div class="grow"><div class="t">${esc(r.name)}</div><div class="s">Section : ${esc(sectionName(r.sectionId))}<br>Profil : ${esc(r.profile)}<br>${reportSpan(r)} : ${plural(r.events.length, 'évènement')}</div></div>${extra ? '' : '<span class="chev">›</span>'}</div>`;

VIEWS.reports = c => {
  const edit = c.edit;
  setBar('CR', backBtn() + `<span style="width:10px;height:10px;border-radius:50%;background:#2f7cf6;display:inline-block;margin-left:4px"></span>`,
    `<button class="bbtn plus" data-a="newReport">+</button><button class="bbtn" data-a="toggleEdit">${edit ? 'OK' : 'Modifier'}</button>`);
  const l = reportsOf(c.sec);
  if (!l.length) return `<div class="empty">Aucun compte-rendu.<br><br>Touchez <b>+</b> pour en créer un.</div>`;
  return l.map(r => edit
    ? `<div class="cell cr"><button class="del" data-a="delReport" data-id="${r.id}">Suppr.</button><div class="grow" data-a="openReport" data-id="${r.id}"><div class="t">${esc(r.name)}</div><div class="s">${reportSpan(r)} : ${plural(r.events.length, 'évènement')}</div></div></div>`
    : crCell(r)).join('');
};

let draft = null; // évènement en attente de validation
let qTab = 'fav';
function evHTML(e, pending, edit) {
  const st = S.settings; const bits = [];
  if (e.category) bits.push(`<span class="cat">${esc(e.category)}</span>`);
  if (e.text) bits.push(`<span>${esc(e.text)}</span>`);
  if (e.type === 'geo' && !e.text) bits.push('<span>Position</span>');
  let media = '';
  if (e.mediaId) {
    if (e.type === 'photo') media = `<img class="th" data-media="${e.mediaId}">`;
    else if (e.type === 'video') media = `<video class="th" data-media="${e.mediaId}" muted></video>`;
  }
  const audio = e.type === 'audio' && e.mediaId ? `<audio controls data-media="${e.mediaId}"></audio>` : '';
  const meta = [];
  if (e.lat != null && st.showCoords) meta.push(`${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}`);
  if (e.address && st.showAddress) meta.push(esc(e.address));
  const sw = !pending && !edit;
  return `${sw ? `<div class="swipe"><button class="swbg" data-a="swipeDel" data-id="${e.id}">Supprimer</button>` : ''}<div class="ev ${pending ? 'pending' : ''}" ${colorOf(e) ? `style="border-left:5px solid ${colorOf(e)}"` : ''} ${pending ? '' : `data-a="openEvent" data-id="${e.id}"`}>
    ${edit ? `<button class="del" data-a="quickDelEvent" data-id="${e.id}">Suppr.</button>` : ''}<div class="time">${fTime(e.ts)}</div>
    <div class="body">${bits.join(' — ') || (e.type === 'audio' ? '<span class="cat">Mémo vocal</span>' : e.type === 'photo' ? '<span class="cat">Photo</span>' : e.type === 'video' ? '<span class="cat">Vidéo</span>' : '')}
      ${e.phone ? `<div class="meta">📞 ${esc(e.phone)}</div>` : ''}${audio}${meta.length ? `<div class="meta">📍 ${meta.join(' · ')}</div>` : ''}
      ${e.comment && st.showComment ? `<div class="com">${esc(e.comment)}</div>` : ''}</div>${media}</div>${sw ? '</div>' : ''}`;
}

VIEWS.report = c => {
  const r = S.reports.find(x => x.id === c.id);
  if (!r) { stacks[tab].pop(); return VIEWS[cur().v](cur()); }
  const edit = c.edit;
  setBar(r.name, backBtn(), edit ? `<button class="bbtn" data-a="toggleEdit">OK</button>` : `<button class="bbtn" data-a="shareReport">${ICON.share}</button><button class="bbtn" data-a="toggleEdit">Modifier</button>`);
  const evs = sortedEvents(r); let last = '';
  const list = evs.map(e => { const k = dayKey(e.ts); const h = k !== last ? `<div class="group" style="padding:8px 14px 4px;font-size:13px">${k}</div>` : ''; last = k; return h + evHTML(e, false, edit); }).join('');
  const qb = (b) => { const [cid, a] = b.split('|'); const k = S.categories.find(x => x.id === cid); return `<button class="qbtn" data-a="quick" data-b="${esc(b)}" ${k ? `style="border-bottom:3px solid ${catColor(k)}"` : ''}>${esc(a)}</button>`; };
  const qk = S.categories.find(k => k.id === qTab);
  const btns = (qk ? qk.actions.map(a => qk.id + '|' + a) : S.buttons.slice(0, maxBtn())).map(qb).join('');
  const qtabs = S.categories.length ? `<div class="qtabs"><button class="${qk ? '' : 'on'}" data-a="qTab" data-id="fav">★ Favoris</button>${S.categories.map(k => `<button class="${qk === k ? 'on' : ''}" data-a="qTab" data-id="${k.id}" style="--c:${catColor(k)}">${esc(k.name)}</button>`).join('')}</div>` : '';
  c.after = () => {
    const el = $('.events'); if (!el) return;
    if (c.hl) { const t = el.querySelector(`.ev[data-id="${c.hl}"]`); c.hl = null; if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); return; } }
    if (S.settings.sortEvents !== 'date_desc') el.scrollTop = el.scrollHeight;
  };
  if (edit) return `<div class="report"><div class="events" style="background:#fff">
      <div class="cell" data-a="editReport"><div class="grow"><div class="t" style="font-weight:600">Nom, section et profil</div><div class="s">${esc(r.name)} · ${esc(sectionName(r.sectionId))} · ${esc(r.profile)}</div></div><span class="chev">›</span></div>
      <div class="hint">Touchez « Suppr. » pour effacer une note. Touchez une note pour la corriger.</div>
      ${list || '<div class="empty">Aucun évènement.</div>'}
      <div style="padding:16px"><button class="bigbtn red" data-a="delThisReport">Supprimer ce compte-rendu</button></div></div></div>`;
  return `<div class="report">
    <div class="events">${list || '<div class="empty">Aucun évènement.<br>Utilisez les boutons ci-dessous.</div>'}</div>
    <div class="panel">
      ${draft ? `<div class="draft">${evHTML(draft, true)}<textarea id="draftCom" placeholder="Commentaire (facultatif)">${esc(draft.comment || '')}</textarea></div>` : ''}
      ${qtabs}<div class="qbtns c${S.settings.btnCols || 3}">${btns || '<button class="qbtn none" data-a="gotoButtons">Configurer les boutons (Paramètres › Boutons)</button>'}</div>
      <div class="tools">
        <button class="tool" data-a="gallery">${ICON.gallery}</button>
        <button class="tool" data-a="camera">${ICON.camera}</button>
        <button class="tool" data-a="geo">${ICON.pin}</button>
        <button class="tool" data-a="mic">${ICON.mic}</button>
        <button class="tool" data-a="text"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2M12 5v14M9 19h6"/></svg></button>
      </div>
      <div class="actions"><button class="ok" data-a="validate" ${draft ? '' : 'disabled'}>Valider l'évènement</button><button class="ko" data-a="cancelDraft" ${draft ? '' : 'disabled'}>Annuler</button></div>
    </div></div>`;
};

VIEWS.event = c => {
  const r = S.reports.find(x => x.id === c.rid); const e = r && r.events.find(x => x.id === c.id);
  if (!e) { stacks[tab].pop(); return VIEWS[cur().v](cur()); }
  setBar('Évènement', backBtn(), `<button class="bbtn" data-a="saveEvent">OK</button>`);
  const cats = ['', ...S.categories.flatMap(k => k.actions.map(a => a))];
  let media = '';
  if (e.mediaId) media = e.type === 'photo' ? `<img data-media="${e.mediaId}">` : e.type === 'video' ? `<video controls data-media="${e.mediaId}"></video>` : `<audio controls data-media="${e.mediaId}"></audio>`;
  return `<div class="detail">${media}
    <div class="field dtp"><label>Date et heure</label><input type="hidden" id="eTs" value="${e.ts}">${dtPickerHTML(e.ts)}</div>
    <div class="field"><label>Action / catégorie</label><input type="hidden" id="eCat" value="${esc(e.category || '')}">
      <div class="cpick"><button type="button" class="chip none ${!e.category ? 'on' : ''}" data-a="pickCat" data-v="">Aucune</button></div>
      ${S.categories.filter(k => k.actions.length).map(k => `<div class="cgrp">${esc(k.name)}</div><div class="cpick">${k.actions.map(a => `<button type="button" class="chip ${a === e.category ? 'on' : ''}" data-a="pickCat" data-v="${esc(a)}">${esc(a)}</button>`).join('')}</div>`).join('')}
      ${e.category && !cats.includes(e.category) ? `<div class="cpick"><button type="button" class="chip on" data-a="pickCat" data-v="${esc(e.category)}">${esc(e.category)}</button></div>` : ''}</div>
    ${e.type === 'photo' ? `<div class="field"><label>Numéro lu sur la photo</label><input id="ePhone" inputmode="tel" value="${esc(e.phone || '')}" placeholder="${e.phone === undefined ? 'Analyse en cours…' : 'Aucun numéro détecté'}"></div><button class="bigbtn grey" data-a="rescanPhone">Relire le numéro sur la photo</button>` : ''}
    <div class="field"><label style="display:flex;justify-content:space-between;align-items:center">Texte <button class="mini" data-a="dictText">🎤 Dicter</button></label><textarea id="eText">${esc(e.text || '')}</textarea></div>
    <div class="field"><label>Commentaire</label><textarea id="eCom">${esc(e.comment || '')}</textarea></div>
    <div class="field"><label>Adresse</label><input id="eAddr" list="dlRues" value="${esc(e.address || '')}" placeholder="Rue de Yerres…" autocomplete="off"></div>
    ${e.lat != null ? `<div class="field"><label>Coordonnées${e.geoTs ? ' (relevées le ' + fDate(e.geoTs) + ' à ' + fTime(e.geoTs) + ')' : ''}</label><div>${e.lat.toFixed(6)}, ${e.lon.toFixed(6)}</div>${e.address ? `<div style="font-size:14px;color:#555;margin-top:4px">${esc(e.address)}</div>` : ''}</div>` : ''}
    <button class="bigbtn grey" data-a="addGeoToEvent">${e.lat != null ? 'Mettre à jour la position' : 'Ajouter ma position'}</button>
    <button class="bigbtn red" data-a="delEvent">Supprimer l'évènement</button></div>`;
};

/* Sélecteur date/heure intégré : flèches jour, boutons − / +, saisie directe, raccourcis. */
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function dayLabel(ts) {
  const d = new Date(ts), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - t) / 864e5);
  const rel = diff === 0 ? "Aujourd'hui" : diff === -1 ? 'Hier' : diff === 1 ? 'Demain' : '';
  const full = `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
  return rel ? `<b>${rel}</b><span>${full}</span>` : `<b>${full.charAt(0).toUpperCase() + full.slice(1)}</b>`;
}
function dtPickerHTML(ts) {
  const d = new Date(ts), p2 = n => String(n).padStart(2, '0');
  return `<div class="dt-day"><button type="button" class="dt-arr" data-a="dtShift" data-d="-1" aria-label="Jour précédent">‹</button><div class="dt-dlab" data-a="dtCal">${dayLabel(ts)}</div><button type="button" class="dt-arr" data-a="dtShift" data-d="1" aria-label="Jour suivant">›</button></div>
    <div class="dt-time">
      <div class="dt-col"><button type="button" class="dt-pm" data-a="dtShift" data-m="60">▲</button><input id="dtH" class="dt-num" inputmode="numeric" maxlength="2" value="${p2(d.getHours())}"><button type="button" class="dt-pm" data-a="dtShift" data-m="-60">▼</button><small>heures</small></div>
      <div class="dt-sep">:</div>
      <div class="dt-col"><button type="button" class="dt-pm" data-a="dtShift" data-m="1">▲</button><input id="dtM" class="dt-num" inputmode="numeric" maxlength="2" value="${p2(d.getMinutes())}"><button type="button" class="dt-pm" data-a="dtShift" data-m="-1">▼</button><small>minutes</small></div>
    </div>
    <div class="dt-quick"><button type="button" class="chip" data-a="dtNow">🕒 Maintenant</button><button type="button" class="chip" data-a="dtShift" data-m="-5">−5 min</button><button type="button" class="chip" data-a="dtShift" data-m="5">+5 min</button><button type="button" class="chip" data-a="dtShift" data-m="-15">−15 min</button><button type="button" class="chip" data-a="dtShift" data-m="15">+15 min</button></div>
    <input type="date" id="dtCal" class="dt-hidden" value="${toLocalInput(ts).slice(0, 10)}">`;
}
function dtSet(ts) {
  const box = document.querySelector('.dtp'); if (!box) return;
  $('#eTs').value = ts;
  const d = new Date(ts), p2 = n => String(n).padStart(2, '0');
  box.querySelector('.dt-dlab').innerHTML = dayLabel(ts);
  if (document.activeElement !== $('#dtH')) $('#dtH').value = p2(d.getHours());
  if (document.activeElement !== $('#dtM')) $('#dtM').value = p2(d.getMinutes());
  $('#dtCal').value = toLocalInput(ts).slice(0, 10);
  box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
}
document.addEventListener('input', ev => {
  const id = ev.target.id; if (!['dtH', 'dtM', 'dtCal'].includes(id)) return;
  const d = new Date(+$('#eTs').value);
  if (id === 'dtCal') { if (!ev.target.value) return; const [y, m, j] = ev.target.value.split('-').map(Number); d.setFullYear(y, m - 1, j); return dtSet(d.getTime()); }
  const v = ev.target.value.replace(/\D/g, '').slice(0, 2); ev.target.value = v; if (v === '') return;
  const n = Math.min(+v, id === 'dtH' ? 23 : 59);
  if (id === 'dtH') d.setHours(n); else d.setMinutes(n);
  $('#eTs').value = d.getTime(); document.querySelector('.dt-dlab').innerHTML = dayLabel(d.getTime());
  if (v.length === 2 && id === 'dtH') $('#dtM').focus();
});
document.addEventListener('focusout', ev => { if (ev.target.id === 'dtH' || ev.target.id === 'dtM') { ev.target.value = String(ev.target.value || 0).padStart(2, '0'); } });
document.addEventListener('focusin', ev => { if (ev.target.id === 'dtH' || ev.target.id === 'dtM') setTimeout(() => ev.target.select(), 0); });

/* --- Exporter (multi-export) --- */
VIEWS.export = c => {
  c.sel = c.sel || {};
  const n = Object.values(c.sel).filter(Boolean).length;
  setBar('Exporter', `<button class="bbtn" data-a="selAll">Tout</button>`, `<button class="bbtn" data-a="multiExport">${n ? 'Exporter (' + n + ')' : ''}</button>`);
  const l = reportsOf('*');
  if (!l.length) return '<div class="empty">Aucun compte-rendu à exporter.</div>';
  return `<div class="hint">Sélectionnez les comptes-rendus à exporter ensemble (regroupement : ${S.settings.multiExport === 'date' ? 'par date' : 'par compte-rendu'}).</div>` +
    l.map(r => `<div class="cell cr" data-a="toggleSel" data-id="${r.id}"><span class="ck ${c.sel[r.id] ? 'on' : ''}">${c.sel[r.id] ? '✓' : ''}</span><div class="grow"><div class="t">${esc(r.name)}</div><div class="s">Section : ${esc(sectionName(r.sectionId))}<br>${reportSpan(r)} : ${plural(r.events.length, 'évènement')}</div></div></div>`).join('');
};

/* --- Paramètres --- */
const CHOICES = {
  validation: { label: 'Evènement', opts: [['auto', 'Validation automatique'], ['manuel', 'Validation manuelle']] },
  sortReports: { label: 'Trier comptes-rendus par', opts: [['date', 'Date'], ['nom', 'Nom']] },
  sortEvents: { label: 'Trier évènements par', opts: [['date', 'Date'], ['date_desc', 'Date (récent en haut)']] },
  timeFormat: { label: 'Format heure', opts: [['sans', 'Sans secondes'], ['avec', 'Avec secondes']] },
  imageQuality: { label: 'Qualité des images', opts: [['basse', 'Basse'], ['moyenne', 'Moyenne'], ['haute', 'Haute']] },
  videoQuality: { label: 'Qualité des vidéos', opts: [['basse', 'Basse'], ['moyenne', 'Moyenne'], ['haute', 'Haute']] },
  multiExport: { label: 'Multi-Export', opts: [['date', 'Par date'], ['cr', 'Par compte-rendu']] },
  maxButtons: { label: 'Nombre de boutons', opts: [['6', '6'], ['9', '9'], ['12', '12'], ['15', '15'], ['18', '18'], ['24', '24'], ['30', '30']] },
  btnCols: { label: 'Boutons par ligne', opts: [['2', '2'], ['3', '3'], ['4', '4']] },
  lockDelay: { label: 'Verrouiller après', opts: [['0', 'Immédiatement'], ['60', '1 minute'], ['300', '5 minutes'], ['900', '15 minutes']] },
  showDates: { label: 'Afficher dates', opts: [['debut', 'Début'], ['debut_fin', 'Début et fin'], ['non', 'Non']] }
};
const BOOLS = { useEndDate: 'Utiliser une date de fin', autoGeo: 'Géolocalisation automatique', showCoords: 'Afficher coordonnées', showCoordDate: 'Afficher date coordonnées', showAddress: 'Afficher adresse', showComment: 'Afficher commentaire', protectedExport: 'Export protégé' };
const optLabel = k => (CHOICES[k].opts.find(o => o[0] === S.settings[k]) || CHOICES[k].opts[0])[1];
const choiceCell = k => `<div class="cell" data-a="choice" data-k="${k}"><div class="grow">${CHOICES[k].label}</div><span class="val">${optLabel(k)}</span></div>`;
const boolCell = k => `<div class="cell" data-a="bool" data-k="${k}"><div class="grow">${BOOLS[k]}</div><span class="val">${S.settings[k] ? 'Oui' : 'Non'}</span></div>`;
const navCell = (t, s, a, v = '') => `<div class="cell" data-a="${a}"><div class="grow"><div class="t" style="font-weight:600">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</div>${v ? `<span class="val">${v}</span>` : ''}<span class="chev">›</span></div>`;

VIEWS.settings = () => {
  setBar('Paramètres');
  const st = S.settings;
  const th = st.theme || 'clair';
  return `<div class="group">Apparence</div>
    <div class="seg">${[['clair', '☀️ Clair'], ['sombre', '🌙 Sombre'], ['auto', '🌓 Auto']].map(([v, l]) => `<button class="${th === v ? 'on' : ''}" data-a="setTheme" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="cell" data-a="bool" data-k="bigButtons"><div class="grow"><div>Gros boutons</div><div class="s">Boutons plus grands pour noter en mouvement</div></div><span class="sw ${st.bigButtons ? 'on' : ''}"></span></div>
    <div class="group">Personnalisation</div>
    ${navCell('Profil', '', 'editProfile', esc(S.profile.name))}
    ${navCell('Sections', 'Rangez vos comptes-rendus dans des sections logiques', 'gotoSections')}
    ${navCell('Catégories', 'Créez vos catégories et leurs actions pour la prise de note', 'gotoCategories')}
    ${navCell(`Boutons (max ${maxBtn()})`, 'Personnalisez vos boutons à partir des catégories', 'gotoButtons')}
    ${navCell('Rappels', 'Définissez des rappels à une date précise ou après un délai', 'gotoReminders')}
    <div class="group">Vacation</div>
    <div class="cell" data-a="bool" data-k="shiftAuto"><div class="grow"><div>Compte-rendu automatique</div><div class="s">Créé et ouvert tout seul à chaque prise de service</div></div><span class="sw ${st.shiftAuto ? 'on' : ''}"></span></div>
    ${st.shiftAuto ? `<div class="cell" data-a="shiftTimes"><div class="grow">Heures de prise de service</div><span class="val">${esc(st.shiftTimes)}</span></div>` : ''}
    <div class="group">Paramètres</div>
    <div class="cell" data-a="defaultName"><div class="grow">Nom par défaut</div><span class="val">${esc(st.defaultName)}</span></div>
    ${choiceCell('validation')}${choiceCell('sortReports')}${choiceCell('sortEvents')}${boolCell('useEndDate')}
    ${choiceCell('timeFormat')}${choiceCell('imageQuality')}${choiceCell('videoQuality')}${boolCell('autoGeo')}
    <div class="cell"><div class="grow">Langage</div><span class="val">Français 🇫🇷</span></div>
    <div class="group">🔒 Protection des données</div>
    <div class="cell" data-a="toggleLock"><div class="grow"><div>Verrouillage par code</div><div class="s">Code demandé à l'ouverture de l'appli</div></div><span class="sw ${st.lockOn ? 'on' : ''}"></span></div>
    ${st.lockOn ? `<div class="cell" data-a="changeLock"><div class="grow">Changer le code</div><span class="chev">›</span></div>
    ${choiceCell('lockDelay')}
    ${NATIVE && Android.canBiometric && Android.canBiometric() ? `<div class="cell" data-a="toggleBio"><div class="grow"><div>Déverrouiller avec l'empreinte</div><div class="s">Le code reste utilisable</div></div><span class="sw ${st.lockBio ? 'on' : ''}"></span></div>` : ''}
    <div class="cell" data-a="lockNow"><div class="grow">Verrouiller maintenant</div><span style="font-size:18px">🔒</span></div>` : ''}
    <div class="cell" data-a="toggleSecure"><div class="grow"><div>Écran confidentiel</div><div class="s">Bloque les captures d'écran et masque l'appli dans les applis récentes</div></div><span class="sw ${st.secureScreen ? 'on' : ''}"></span></div>
    <div class="cell" data-a="info" data-m="Vos comptes-rendus, photos et numéros restent uniquement sur ce téléphone, dans l'espace privé de l'appli : rien n'est envoyé sur internet et la sauvegarde automatique Android (cloud) est désactivée. Seuls les exports que vous partagez vous-même quittent l'appli."><div class="grow">Où sont stockées mes données ?</div><span class="chev">›</span></div>
    <div class="group">Sauvegarde</div>
    <div class="cell" data-a="backup"><span style="font-size:20px">☁️</span><div class="grow t" style="font-weight:600">Sauvegarder</div></div>
    <div class="cell" data-a="restore"><span style="font-size:20px">📥</span><div class="grow t" style="font-weight:600">Restaurer</div></div>
    <div class="cell" data-a="bool" data-k="autoBackup"><div class="grow"><div>Sauvegarde automatique</div><div class="s">${NATIVE ? 'Chaque jour dans Téléchargements › CR-CSU (7 dernières gardées)' : 'Disponible dans l\'appli Android'}${S.lastAutoBackup ? ' — dernière : ' + esc(S.lastAutoBackup) : ''}</div></div><span class="sw ${st.autoBackup ? 'on' : ''}"></span></div>
    <div class="group">Modèle PDF</div>
    <div class="cell" data-a="pdfField" data-k="pdfOrg"><div class="grow">En-tête (service, ville)</div><span class="val">${esc(st.pdfOrg) || 'Aucun'}</span></div>
    <div class="cell" data-a="pdfField" data-k="pdfAgent"><div class="grow">Nom de l'agent</div><span class="val">${esc(st.pdfAgent) || esc(S.profile.name)}</span></div>
    <div class="cell" data-a="pdfLogo"><div class="grow">Logo</div>${st.pdfLogo ? `<img src="${st.pdfLogo}" style="height:30px;max-width:90px;object-fit:contain">` : '<span class="val">Aucun</span>'}</div>
    <div class="cell" data-a="pdfSign"><div class="grow">Signature</div>${st.pdfSign ? `<img src="${st.pdfSign}" style="height:30px;max-width:110px;object-fit:contain;background:#fff;border-radius:4px">` : '<span class="val">Aucune</span>'}</div>
    <div class="cell" data-a="bool" data-k="pdfSummary"><div class="grow">Synthèse par catégorie dans le PDF</div><span class="sw ${st.pdfSummary ? 'on' : ''}"></span></div>
    <div class="group">Options d'export</div>
    <div class="cell" data-a="email"><div class="grow">Email</div><span class="val">${esc(st.email) || 'Non défini'}</span></div>
    ${choiceCell('multiExport')}${choiceCell('showDates')}${boolCell('showCoords')}${boolCell('showCoordDate')}${boolCell('showAddress')}${boolCell('showComment')}
    <div class="cell" data-a="info" data-m="CSV : séparateur « ; », compatible Excel. Une ligne par évènement."><div class="grow">Options d'export CSV</div><span class="chev">›</span></div>
    <div class="cell" data-a="info" data-m="PDF : utilise l'impression Android → « Enregistrer au format PDF ». Les photos sont incluses."><div class="grow">Options d'export PDF</div><span class="chev">›</span></div>
    <div class="cell" data-a="info" data-m="DOC : document lisible par Word, LibreOffice et Google Docs."><div class="grow">Options d'export DOC</div><span class="chev">›</span></div>
    ${boolCell('protectedExport')}
    <div class="group danger" style="color:#d33">Zone sensible</div>
    <div class="cell" data-a="resetAll"><div class="grow danger">Effacer toutes les données</div></div>
    <div style="height:30px"></div>`;
};

VIEWS.sectionsEdit = () => {
  setBar('Sections', backBtn(), `<button class="bbtn plus" data-a="addSection">+</button>`);
  return S.sections.map(s => `<div class="cell"><div class="grow" data-a="renameSection" data-id="${s.id}">${esc(s.name)}</div><span class="val">${S.reports.filter(r => r.sectionId === s.id).length} CR</span>${S.sections.length > 1 ? `<button class="del" data-a="delSection" data-id="${s.id}">Suppr.</button>` : ''}</div>`).join('') +
    '<div class="hint">Touchez un nom pour le renommer.</div>';
};
VIEWS.categories = () => {
  setBar('Catégories', backBtn(), `<button class="bbtn plus" data-a="addCategory">+</button>`);
  return S.categories.map(k => navCell(esc(k.name), esc(k.actions.join(', ')) || 'Aucune action', `openCategory" data-id="${k.id}`)).join('') || '<div class="empty">Aucune catégorie.</div>';
};
VIEWS.category = c => {
  const k = S.categories.find(x => x.id === c.id); if (!k) { stacks[tab].pop(); return VIEWS[cur().v](cur()); }
  setBar(k.name, backBtn(), `<button class="bbtn plus" data-a="addAction">+</button>`);
  return `<div class="cell" data-a="renameCategory"><div class="grow">Nom</div><span class="val">${esc(k.name)}</span></div>
    <div class="group">Couleur</div><div class="colors">${PALETTE.map(col => `<button data-a="setCatColor" data-c="${col}" style="background:${col}" class="${catColor(k) === col ? 'on' : ''}"></button>`).join('')}</div><div class="group">Actions</div>` +
    k.actions.map((a, i) => `<div class="cell"><div class="grow" data-a="renameAction" data-i="${i}">${esc(a)}</div><button class="del" data-a="delAction" data-i="${i}">Suppr.</button></div>`).join('') +
    `<div style="padding:16px"><button class="bigbtn red" data-a="delCategory">Supprimer la catégorie</button></div>`;
};
VIEWS.buttons = () => {
  setBar(`Boutons (max ${maxBtn()})`, backBtn());
  return `${choiceCell('maxButtons')}${choiceCell('btnCols')}<div class="hint">${S.buttons.length}/${maxBtn()} boutons sélectionnés. Ils apparaissent en bas de chaque compte-rendu.</div>` +
    S.categories.map(k => `<div class="group">${esc(k.name)}</div>` + k.actions.map(a => { const key = k.id + '|' + a; const on = S.buttons.includes(key); return `<div class="cell" data-a="toggleButton" data-b="${esc(key)}"><span class="ck ${on ? 'on' : ''}">${on ? '✓' : ''}</span><div class="grow">${esc(a)}</div></div>`; }).join('')).join('');
};
VIEWS.reminders = () => {
  setBar('Rappels', backBtn(), `<button class="bbtn plus" data-a="addReminder">+</button>`);
  const l = [...S.reminders].sort((a, b) => a.at - b.at);
  return (l.map(r => `<div class="cell"><div class="grow"><div class="t" style="font-weight:600">${esc(r.label)}</div><div class="s">${fDate(r.at)} à ${fTime(r.at)}${r.at < Date.now() ? ' — passé' : ''}</div></div><button class="del" data-a="delReminder" data-id="${r.id}">Suppr.</button></div>`).join('') || '<div class="empty">Aucun rappel.</div>') +
    '<div class="hint">Une notification s\'affiche sur le téléphone à l\'heure du rappel.</div>';
};
/* --- Plan de la ville --- */
const QUARTIERS = [
  ['#cfd8ea', 'Grosbois / Sablière / Mare-Armée'], ['#a9b8dd', 'Bellevue / Centre-ville'], ['#f2b98a', 'Rives de l\'Yerres / Tournelles'],
  ['#c9c3cf', 'Gambetta / Brossolette / Belvédère'], ['#ecd3cf', 'Bout du Monde / Camaldules / Abbaye'], ['#f3d21f', 'Concy / Grands Godeaux / Gare'], ['#f6e48a', 'Taillis / Garenne']
];
let planSrc = '';
async function planURL() { const b = await getMedia('plan_custom'); return b ? URL.createObjectURL(b) : 'plan_yerres.jpg'; }
VIEWS.plan = c => {
  setBar('Plan de Yerres', '', `<button class="bbtn" data-a="planMenu">•••</button>`);
  c.after = async () => {
    const ri = $('#rueIn'); if (ri) { ri.value = c.rq || ''; const go2 = () => { c.rq = ri.value; renderRues(ri.value); }; ri.oninput = go2; renderRues(ri.value); }
    planSrc = planSrc || await planURL(); const img = $('#pzImg'); if (img) { img.src = planSrc; initZoom($('#pz'), img); } };
  return `<div class="pz" id="pz"><img id="pzImg" alt="Plan" draggable="false"><div class="pzb"><button data-a="pzIn">＋</button><button data-a="pzOut">－</button><button data-a="pzFit">⤢</button><button data-a="pzFull">⛶</button></div></div>
    <div class="hint">Pincez pour zoomer, glissez pour vous déplacer, double-tap pour agrandir.</div>
    <div class="cell" data-a="openMaps"><span style="font-size:20px">🗺️</span><div class="grow"><div class="t" style="font-weight:600">Ouvrir Yerres dans Maps</div><div class="s">Carte détaillée et itinéraires (internet)</div></div><span class="chev">›</span></div>
    <div class="group">Quartiers</div>
    ${QUARTIERS.map(([col, n]) => `<div class="cell"><span style="width:22px;height:22px;border-radius:5px;background:${col};border:1px solid #0002;flex:0 0 auto"></span><div class="grow">${esc(n)}</div></div>`).join('')}
    <div class="group">Rues de Yerres (${RUES.length})</div>
    <div class="search" style="position:static"><input id="rueIn" type="search" placeholder="🔍 Chercher une rue, allée, place…" autocomplete="off"></div>
    <div id="ruesList" class="rues"></div>
    <div class="group" style="display:flex;justify-content:space-between;align-items:center">Numéros utiles <button class="mini" data-a="addPhone" style="background:#2f7cf6">＋ Ajouter</button></div>
    ${S.phones.map((x, i) => `<div class="cell" data-a="phoneMenu" data-i="${i}"><span style="font-size:18px">📞</span><div class="grow"><div style="font-weight:600">${esc(x.n)}</div>${x.ok ? '' : '<div class="s">Lu sur le plan — à vérifier</div>'}</div><a class="call" href="tel:${esc(x.t.replace(/\s/g, ''))}" data-noop="1">${esc(x.t)}</a></div>`).join('')}
    <div style="height:24px"></div>`;
};

/* rues */
const RUES = (window.RUES_YERRES || []).slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'fr'));
function norm(x) { return x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’-]/g, ' '); }
function sortKey(x) { return norm(x).replace(/^(rue|allee|avenue|place|impasse|residence|chemin|square|sentier|parc|mail|centre commercial|rond point|zone industrielle|hameau|domaine|chateau|ferme)\s+(de la |de l |des |du |de |d |la |le |les )?/, ''); }
function fullAddr(a) { return /yerres/i.test(a) ? a : a + ', 91330 Yerres'; }
function renderRues(q) {
  const box = $('#ruesList'); if (!box) return;
  const n = norm(q.trim()); const words = n.split(/\s+/).filter(Boolean);
  const l = words.length ? RUES.filter(r => { const x = norm(r); return words.every(w => x.includes(w)); }) : RUES;
  box.innerHTML = (l.length ? '' : '<div class="hint">Aucune voie trouvée.</div>') + l.map(r => `<div class="cell" data-a="rueMenu" data-r="${esc(r)}"><span style="font-size:15px">🛣️</span><div class="grow">${esc(r)}</div><span class="chev">›</span></div>`).join('');
}
function fillStreets() { const d = $('#dlRues'); if (d && !d.children.length) d.innerHTML = RUES.map(r => `<option value="${esc(r)}">`).join(''); }

/* zoom / déplacement du plan */
let PZ = null;
function initZoom(box, img) {
  const z = PZ = { box, img, s: 1, x: 0, y: 0, min: 1, pts: new Map(), last: null, tap: 0 };
  const fit = () => { const bw = box.clientWidth, bh = box.clientHeight, iw = img.naturalWidth || 1, ih = img.naturalHeight || 1; z.min = Math.min(bw / iw, bh / ih); z.s = z.min; z.x = (bw - iw * z.s) / 2; z.y = (bh - ih * z.s) / 2; apply(); };
  const clamp = () => { const bw = box.clientWidth, bh = box.clientHeight, w = img.naturalWidth * z.s, h = img.naturalHeight * z.s;
    z.x = w <= bw ? (bw - w) / 2 : Math.min(0, Math.max(bw - w, z.x)); z.y = h <= bh ? (bh - h) / 2 : Math.min(0, Math.max(bh - h, z.y)); };
  const apply = () => { clamp(); img.style.transform = `translate(${z.x}px,${z.y}px) scale(${z.s})`; };
  z.zoomAt = (f, cx, cy) => { const ns = Math.max(z.min, Math.min(z.min * 8, z.s * f)); const k = ns / z.s; z.x = cx - (cx - z.x) * k; z.y = cy - (cy - z.y) * k; z.s = ns; apply(); };
  z.fit = fit;
  if (img.complete && img.naturalWidth) fit(); else img.onload = fit;
  const rel = e => { const b = box.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  box.onpointerdown = e => {
    if (e.target.closest('.pzb')) return;
    box.setPointerCapture(e.pointerId); z.pts.set(e.pointerId, rel(e));
    if (z.pts.size === 1) { const now = Date.now(); if (now - z.tap < 300) { const [cx, cy] = rel(e); img.style.transition = 'transform .2s'; z.s > z.min * 1.5 ? fit() : z.zoomAt(2.5, cx, cy); setTimeout(() => img.style.transition = '', 220); z.tap = 0; } else z.tap = now; }
    z.last = null;
  };
  box.onpointermove = e => {
    if (!z.pts.has(e.pointerId)) return;
    const prev = z.pts.get(e.pointerId); const cur = rel(e); z.pts.set(e.pointerId, cur);
    if (z.pts.size === 1) { z.x += cur[0] - prev[0]; z.y += cur[1] - prev[1]; apply(); }
    else if (z.pts.size === 2) {
      const [a, b] = [...z.pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (z.last) { z.x += m[0] - z.last.m[0]; z.y += m[1] - z.last.m[1]; z.zoomAt(d / z.last.d, m[0], m[1]); }
      z.last = { d, m };
    }
  };
  box.onpointerup = box.onpointercancel = e => { z.pts.delete(e.pointerId); z.last = null; };
  box.onwheel = e => { e.preventDefault(); const [cx, cy] = rel(e); z.zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, cx, cy); };
}

VIEWS.about = () => {
  setBar('À propos');
  return `<div class="about"><div class="logo">CR</div><h2 style="margin:0">CR CSU</h2><div style="color:#777">Version 1.2</div>
  <p>Prise de notes horodatées pour rédiger les comptes-rendus du CSU : évènements, photos, vidéos, mémos vocaux, positions GPS.</p>
  <p style="font-size:14px;color:#666">Toutes les données restent sur ce téléphone. Pensez à utiliser <b>Paramètres › Sauvegarder</b> régulièrement.</p>
  <p style="font-size:13px;color:#888">${S.reports.length} compte(s)-rendu(s) · ${S.reports.reduce((n, r) => n + r.events.length, 0)} évènement(s)</p></div>`;
};

/* ---------- Médias ---------- */
const urlCache = {}; const pending = {};
async function mediaURL(id) { if (urlCache[id]) return urlCache[id]; const b = await getMedia(id); if (!b) return ''; return (urlCache[id] = URL.createObjectURL(b)); }
function hydrateMedia() { document.querySelectorAll('[data-media]').forEach(async el => { el.src = await mediaURL(el.dataset.media); }); }
const blobToDataURL = b => new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); });
async function dataURLToBlob(u) { return (await fetch(u)).blob(); }
function compressImage(file, maxOv) {
  const max = maxOv || { basse: 640, moyenne: 1024, haute: 1600 }[S.settings.imageQuality] || 1024;
  const q = { basse: .55, moyenne: .68, haute: .82 }[S.settings.imageQuality] || .68;
  if (window.createImageBitmap) return (async () => {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close();
      return await new Promise(ok => cv.toBlob(b => ok(b || file), 'image/jpeg', q));
    } catch { return file; }
  })();
  return new Promise(ok => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img; const k = Math.min(1, max / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h);
      cv.toBlob(b => { URL.revokeObjectURL(u); ok(b || file); }, 'image/jpeg', q);
    };
    img.onerror = () => ok(file); img.src = u;
  });
}

/* ---------- Géolocalisation ---------- */
function getPosition() {
  return new Promise((ok, ko) => {
    if (!navigator.geolocation) return ko(new Error('GPS indisponible'));
    navigator.geolocation.getCurrentPosition(p => ok(p.coords), e => ko(e), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}
async function reverse(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&accept-language=fr`);
    const j = await r.json(); const a = j.address || {};
    const s = [[a.house_number, a.road].filter(Boolean).join(' '), [a.postcode, a.city || a.town || a.village].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return s || j.display_name || '';
  } catch { return ''; }
}
async function attachGeo(e, silent) {
  try {
    if (!silent) toast('Recherche de la position…');
    const c = await getPosition(); e.lat = c.latitude; e.lon = c.longitude; e.geoTs = Date.now();
    e.address = await reverse(e.lat, e.lon); return true;
  } catch (err) { if (!silent) toast('Position indisponible (GPS activé ?)'); return false; }
}

/* ---------- Lecture du numéro sur les photos (OCR ML Kit, hors-ligne) ---------- */
const ocrWait = {};
window.__ocr = (id, text) => { const f = ocrWait[id]; if (f) { delete ocrWait[id]; f(text || ''); } };
async function ocrBlob(blob) {
  if (!NATIVE || !Android.ocr || !blob) return '';
  const data = await blobToDataURL(blob); const id = uid();
  return new Promise(res => { ocrWait[id] = res; setTimeout(() => window.__ocr(id, ''), 20000); Android.ocr(id, data.split(',')[1]); });
}
function fmtPhone(d) { return d.length === 10 ? d.replace(/(\d\d)(?=\d)/g, '$1 ') : d; }
function extractPhones(text) {
  const t = String(text).replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0').replace(/(\d)[ .\-]+(?=\d)/g, '$1');
  const out = [];
  for (let d of t.match(/\+?\d{9,14}/g) || []) {
    d = d.replace('+', '00');
    if (/^0033\d{9}$/.test(d)) d = '0' + d.slice(4);
    else if (/^33[1-9]\d{8}$/.test(d)) d = '0' + d.slice(2);
    else if (/^00[1-9]\d{8}$/.test(d)) d = d.slice(1);          // 0 de sortie (ligne extérieure) + numéro
    else if (/^[1-9]\d{8}$/.test(d)) d = '0' + d;
    if (!/^0[1-9]\d{8}$/.test(d) && !/^00\d{9,12}$/.test(d)) continue;
    const f = fmtPhone(d); if (!out.includes(f)) out.push(f);
  }
  return out.join(', ');
}
async function detectPhone(e) {
  if (e.type !== 'photo' || !e.mediaId || e.phone !== undefined) return false;
  if (pending[e.mediaId]) await pending[e.mediaId];
  const txt = await ocrBlob(await getMedia(e.mediaId));
  if (!NATIVE || !Android.ocr) return false;
  e.phone = extractPhones(txt); return true;
}

/* ---------- Création d'évènements ---------- */
const curReport = () => { const c = cur(); return c.v === 'report' ? S.reports.find(r => r.id === c.id) : null; };
async function newEvent(fields) {
  const r = curReport(); if (!r) return;
  const e = Object.assign({ id: uid(), ts: Date.now(), type: 'text' }, fields);
  if (S.settings.validation === 'auto') { r.events.push(e); save(); render(); toast('Évènement ajouté'); }
  else { if (draft && draft.mediaId) delMedia(draft.mediaId); draft = e; render(); }
  if (e.type === 'photo') detectPhone(e).then(ok => { if (ok) { save(); if (['report', 'event'].includes(cur().v)) render(); if (e.phone) toast('Numéro détecté : ' + e.phone); } });
  if (S.settings.autoGeo && e.lat == null) attachGeo(e, true).then(ok => { if (ok) { save(); if (cur().v === 'report') render(); } });
  return e;
}
function commitDraft() {
  const r = curReport(); if (!r || !draft) return;
  const t = $('#draftCom'); if (t) draft.comment = t.value.trim();
  r.events.push(draft); draft = null; save(); render(); toast('Évènement validé');
}
async function handleFile(file) {
  if (!file) return;
  const isVid = file.type.startsWith('video'); const isImg = file.type.startsWith('image');
  if (!isVid && !isImg) return toast('Format non pris en charge');
  const id = uid();
  urlCache[id] = URL.createObjectURL(file);            // affichage immédiat
  pending[id] = (async () => {
    const blob = isImg ? await compressImage(file) : file;
    await putMedia(id, blob);
    if (isImg) { const old = urlCache[id]; urlCache[id] = URL.createObjectURL(blob); setTimeout(() => URL.revokeObjectURL(old), 5000); }
    delete pending[id];
  })();
  newEvent({ type: isVid ? 'video' : 'photo', mediaId: id });
}

/* ---------- Mémo vocal ---------- */
async function recordAudio() {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return toast('Micro non autorisé'); }
  const rec = new MediaRecorder(stream); const chunks = []; let t0 = Date.now(), iv;
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    clearInterval(iv); stream.getTracks().forEach(t => t.stop()); closeModal();
    if (rec._cancel || !chunks.length) return;
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); const id = uid(); await putMedia(id, blob);
    newEvent({ type: 'audio', mediaId: id, ts: t0 });
  };
  rec.start();
  modal(`<h3>Enregistrement</h3><div class="rec" id="recT">00:00</div><div class="row2"><button class="bigbtn grey" id="recX">Annuler</button><button class="bigbtn red" id="recS">■ Arrêter</button></div>`, true);
  iv = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); const el = $('#recT'); if (el) el.textContent = p2(Math.floor(s / 60)) + ':' + p2(s % 60); }, 250);
  $('#recS').onclick = () => rec.stop();
  $('#recX').onclick = () => { rec._cancel = true; rec.stop(); };
}

/* ---------- Modales ---------- */
function modal(html, center) {
  $('#modalRoot').innerHTML = `<div class="ovl ${center ? 'center' : ''}"><div class="sheet">${html}</div></div>`;
  $('#modalRoot .ovl').addEventListener('click', e => { if (e.target.classList.contains('ovl')) closeModal(); });
}
function closeModal() { $('#modalRoot').innerHTML = ''; }
function sheet(title, options, selected) {
  return new Promise(ok => {
    modal(`<h3>${esc(title)}</h3>${options.map((o, i) => `<button class="opt ${o[0] === selected ? 'sel' : ''}" data-i="${i}">${esc(o[1])}${o[0] === selected ? ' ✓' : ''}</button>`).join('')}<button class="opt cancel" data-i="-1">Annuler</button>`);
    $('#modalRoot').querySelectorAll('.opt').forEach(b => b.onclick = () => { closeModal(); const i = +b.dataset.i; ok(i < 0 ? null : options[i][0]); });
  });
}
function ask(title, fields) {
  return new Promise(ok => {
    modal(`<h3>${esc(title)}</h3>${fields.map((f, i) => `<div class="field"><label>${esc(f.label)}</label>${f.type === 'textarea' ? `<textarea id="f${i}">${esc(f.value || '')}</textarea>` : f.type === 'select' ? `<select id="f${i}">${f.options.map(o => `<option value="${esc(o[0])}" ${o[0] === f.value ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>` : `<input id="f${i}" type="${f.type || 'text'}" value="${esc(f.value || '')}" ${f.type === 'password' ? 'inputmode="numeric"' : ''}>`}</div>`).join('')}
      <div class="row2"><button class="bigbtn grey" id="aX">Annuler</button><button class="bigbtn" id="aOk">OK</button></div>`, true);
    const el = $('#f0'); if (el) setTimeout(() => el.focus(), 50);
    $('#aX').onclick = () => { closeModal(); ok(null); };
    $('#aOk').onclick = () => { const v = fields.map((f, i) => $('#f' + i).value); closeModal(); ok(v); };
  });
}
function confirmBox(msg, okLabel = 'Supprimer') {
  return new Promise(ok => {
    modal(`<h3>${esc(msg)}</h3><div class="row2"><button class="bigbtn grey" id="cX">Annuler</button><button class="bigbtn red" id="cOk">${esc(okLabel)}</button></div>`, true);
    $('#cX').onclick = () => { closeModal(); ok(false); }; $('#cOk').onclick = () => { closeModal(); ok(true); };
  });
}

/* ---------- Exports ---------- */
function rowsFor(reports) {
  const st = S.settings; const rows = [];
  for (const r of reports) for (const e of sortedEvents(r)) rows.push({ r, e });
  if (st.multiExport === 'date' && reports.length > 1) rows.sort((a, b) => a.e.ts - b.e.ts);
  return rows;
}
function evLine(e) {
  const st = S.settings; const parts = [];
  if (e.category) parts.push(e.category); if (e.text) parts.push(e.text);
  if (!parts.length) parts.push({ photo: 'Photo', video: 'Vidéo', audio: 'Mémo vocal', geo: 'Position' }[e.type] || '');
  return parts.join(' — ');
}
function headerText(reports) {
  const st = S.settings;
  if (st.showDates === 'non') return '';
  const ts = reports.flatMap(r => r.events.map(e => e.ts)); if (!ts.length) return '';
  const a = fDate(Math.min(...ts)), b = fDate(Math.max(...ts));
  return st.showDates === 'debut_fin' && a !== b ? `Du ${a} au ${b}` : `Début : ${a} à ${fTime(Math.min(...ts))}`;
}
function buildCSV(reports) {
  const st = S.settings; const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Compte-rendu', 'Section', 'Profil', 'Date', 'Heure', 'Catégorie', 'Texte', 'Numéro', 'Type'];
  if (st.showCoords) head.push('Latitude', 'Longitude'); if (st.showCoordDate) head.push('Date coordonnées');
  if (st.showAddress) head.push('Adresse'); if (st.showComment) head.push('Commentaire');
  const lines = [head.map(q).join(';')];
  for (const { r, e } of rowsFor(reports)) {
    const row = [r.name, sectionName(r.sectionId), r.profile, fDate(e.ts), fTime(e.ts), e.category, e.text, e.phone || '', e.type];
    if (st.showCoords) row.push(e.lat ?? '', e.lon ?? ''); if (st.showCoordDate) row.push(e.geoTs ? fDate(e.geoTs) + ' ' + fTime(e.geoTs) : '');
    if (st.showAddress) row.push(e.address); if (st.showComment) row.push(e.comment);
    lines.push(row.map(q).join(';'));
  }
  return '﻿' + lines.join('\r\n');
}
async function buildHTML(reports, withImages) {
  const st = S.settings; const multi = reports.length > 1;
  let body = '';
  const evRow = async ({ r, e }) => {
    let img = '';
    if (withImages && e.type === 'photo' && e.mediaId) { const b = await getMedia(e.mediaId); if (b) img = `<div class="ph"><img src="${await blobToDataURL(b)}"></div>`; }
    const meta = [];
    if (e.lat != null && st.showCoords) meta.push(`GPS : ${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}` + (st.showCoordDate && e.geoTs ? ` (${fDate(e.geoTs)} ${fTime(e.geoTs)})` : ''));
    if (e.address && st.showAddress) meta.push(esc(e.address));
    const tag = multi && st.multiExport === 'date' ? `<span class="tag">${esc(r.name)}</span>` : '';
    const main = `${e.category ? `<b class="cat">${esc(e.category)}</b>` : ''}${e.category && e.text ? ' — ' : ''}${esc(e.text || '')}${!e.category && !e.text ? esc(evLine(e)) : ''}`;
    return `<tr><td class="dt"><div class="d">${fDate(e.ts)}</div><div class="h">${fTime(e.ts)}</div></td><td class="c">${tag}<div class="txt">${main}</div>${e.phone ? `<div class="tel">N° : <b>${esc(e.phone)}</b></div>` : ''}${meta.length ? `<div class="meta">${meta.join(' · ')}</div>` : ''}${e.comment && st.showComment ? `<div class="com">${esc(e.comment)}</div>` : ''}${img}</td></tr>`;
  };
  const table = async rows => { let h = ''; for (const x of rows) h += await evRow(x); return h ? `<table class="list"><thead><tr><th class="dt">Date et heure</th><th>Évènement</th></tr></thead><tbody>${h}</tbody></table>` : '<p class="empty">Aucun évènement.</p>'; };
  const info = (label, val) => `<div class="i"><span>${label}</span><b>${val}</b></div>`;
  const per = () => { const h = headerText(reports); if (!h) return ''; return h.startsWith('Début : ') ? info('Début', esc(h.slice(8))) : info('Période', esc(h)); };
  const logo = st.pdfLogo ? `<img class="lg" src="${st.pdfLogo}">` : '';
  const org = st.pdfOrg ? `<div class="org">${esc(st.pdfOrg)}</div>` : '';
  const hd = t => `<header class="hd">${logo}<div>${org}<h1>${t}</h1></div></header>`;
  const synth = () => { if (!st.pdfSummary) return ''; const c = countBy(reports); if (!c.length) return ''; return `<div class="syn"><b>Synthèse</b>${c.map(([n, v, col]) => `<span style="border-left:4px solid ${col || '#999'}">${esc(n)} : <b>${v}</b></span>`).join('')}</div>`; };
  const sig = `<div class="sig"><div>L'agent : <b>${esc(st.pdfAgent || S.profile.name)}</b></div>${st.pdfSign ? `<img src="${st.pdfSign}">` : '<div class="sl"></div>'}</div>`;
  if (multi && st.multiExport === 'cr') {
    body = `<header class="hd">${logo}<div>${org}<h1>Comptes-rendus</h1><div class="sub">${esc(headerText(reports))}</div></div></header>${synth()}`;
    for (const r of reports) body += `<section><h2>${esc(r.name)}</h2><div class="info">${info('Section', esc(sectionName(r.sectionId)))}${info('Profil', esc(r.profile))}${info('Période', esc(reportSpan(r)))}${info('Évènements', r.events.length)}</div>${await table(rowsFor([r]))}</section>`;
  } else {
    const r0 = reports[0]; const n = rowsFor(reports).length;
    body = `${hd(multi ? 'Comptes-rendus' : esc(r0.name))}<div class="info">${multi ? reports.map(r => info(esc(r.name), esc(reportSpan(r)))).join('') : info('Section', esc(sectionName(r0.sectionId))) + info('Profil', esc(r0.profile))}${per()}${info('Évènements', n)}</div>${synth()}` + await table(rowsFor(reports));
  }
  body += sig;
  const css = `@page{size:A4;margin:12mm 14mm 16mm}
@media screen{html{background:#8a8f96}body{width:794px;margin:16px auto;background:#fff;padding:45px 53px;box-shadow:0 2px 12px #0006}.foot{position:static;margin-top:14px}.sp{height:0}}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:10.5pt;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
header{border-bottom:3px solid #2b3a8c;padding-bottom:6px;margin-bottom:10px}
.hd{display:flex;align-items:center;gap:14px}.hd .lg{max-height:56px;max-width:140px;object-fit:contain}
.org{font-size:9pt;color:#555;text-transform:uppercase;letter-spacing:.6px;margin-bottom:2px}
.syn{margin:8px 0 12px;padding:8px 10px;background:#f4f6fc;border:1px solid #dde2f3;border-radius:6px;font-size:9.5pt;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.syn span{padding-left:6px}
.sig{margin-top:26px;page-break-inside:avoid;text-align:right;font-size:10.5pt}.sig img{max-height:70px;max-width:220px;margin-top:6px}.sig .sl{margin:34px 0 0 auto;width:200px;border-bottom:1px solid #999}
h1{font-size:20pt;margin:0;color:#2b3a8c;letter-spacing:.5px}
h2{font-size:14pt;margin:18px 0 8px;color:#2b3a8c;border-bottom:1px solid #c9cfee;padding-bottom:3px}
section{break-before:auto}section+section{break-before:page}
.sub{color:#555;font-size:9.5pt;margin-top:2px}
.info{display:flex;flex-wrap:wrap;gap:6px 0;background:#f4f5fb;border:1px solid #dde0f2;border-radius:6px;padding:8px 10px;margin-bottom:14px}
.i{width:50%;padding-right:10px}.i span{display:block;color:#6a6f86;font-size:8pt;text-transform:uppercase;letter-spacing:.4px}.i b{font-size:10.5pt}
table.list{width:100%;border-collapse:collapse;table-layout:fixed}
.list thead{display:table-header-group}
.list th{background:#2b3a8c;color:#fff;text-align:left;font-size:9.5pt;padding:6px 8px;border:1px solid #2b3a8c}
.list td{border:1px solid #cfd3e6;padding:7px 8px;vertical-align:top}
.list tr{break-inside:avoid}
.list tbody tr:nth-child(even) td{background:#f8f9fd}
th.dt,td.dt{width:30mm}
td.dt .d{font-weight:bold}td.dt .h{color:#2b3a8c;font-weight:bold;font-size:12pt}
.c{min-width:0}.txt{word-wrap:break-word}.cat{color:#000}
.tel{margin-top:3px;font-size:11pt}.tel b{color:#2b3a8c;letter-spacing:.5px}
.tag{display:inline-block;font-size:8pt;color:#555;background:#eee;border-radius:3px;padding:0 5px;margin-bottom:2px}
.meta{color:#555;font-size:9pt;margin-top:2px}.com{font-style:italic;color:#333;margin-top:2px}
.ph{margin-top:6px}.ph img{display:block;max-width:70%;max-height:80mm;width:auto;height:auto;border:1px solid #ccc;border-radius:4px;object-fit:contain}
.empty{color:#888;font-style:italic}
.foot{position:fixed;left:0;right:0;bottom:0;height:7mm;padding-top:4px;border-top:1px solid #ddd;color:#888;font-size:8.5pt;display:flex;justify-content:space-between;background:#fff}
.wrap{width:100%;border-collapse:collapse}.wrap>tbody>tr>td{padding:0;vertical-align:top}.sp{height:9mm;padding:0}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=820, user-scalable=yes"><title>Compte-rendu</title><style>${css}</style></head><body><table class="wrap"><tbody><tr><td>${body}</td></tr></tbody><tfoot><tr><td class="sp"></td></tr></tfoot></table><div class="foot"><span>Édité le ${fDate(Date.now())} à ${fTime(Date.now())} — ${esc(S.profile.name)}</span><span>CR CSU</span></div></body></html>`;
}
function textBody(reports) {
  return rowsFor(reports).map(({ r, e }) => `${fDate(e.ts)} ${fTime(e.ts)}${reports.length > 1 ? ' [' + r.name + ']' : ''} : ${evLine(e)}${e.comment && S.settings.showComment ? ' (' + e.comment + ')' : ''}${e.address && S.settings.showAddress ? ' — ' + e.address : ''}`).join('\n');
}
function b64(str) { return btoa(unescape(encodeURIComponent(str))); }
function shareFile(name, mime, base64, subject, text) {
  if (NATIVE) return Android.shareFile(name, mime, base64, subject || name, text || '', S.settings.email || '');
  const a = document.createElement('a'); a.href = `data:${mime};base64,${base64}`; a.download = name; a.click();
}
async function checkPin() {
  if (!S.settings.protectedExport) return true;
  const v = await ask('Export protégé', [{ label: 'Code', type: 'password' }]);
  if (!v) return false; if (v[0] !== S.settings.pin) { toast('Code incorrect'); return false; } return true;
}
async function exportReports(reports) {
  if (!reports.length) return;
  const fmt = await sheet('Exporter', [['resume', '📋 Résumé de fin de service'], ['pdf', 'PDF'], ['csv', 'CSV (Excel)'], ['doc', 'DOC (Word)'], ['mail', 'Email (texte)']]);
  if (fmt === 'resume') return showSummary(reports);
  if (!fmt || !(await checkPin())) return;
  const todo = reports.flatMap(r => r.events).filter(e => e.type === 'photo' && e.mediaId && e.phone === undefined);
  if (todo.length && NATIVE && Android.ocr) { toast('Lecture des numéros sur les photos…'); for (const e of todo) await detectPhone(e); save(); }
  const base = (reports.length > 1 ? 'Comptes-rendus' : reports[0].name + '_' + reportSpan(reports[0])).replace(/[^\wÀ-ÿ-]+/g, '_');
  const subj = reports.length > 1 ? `Comptes-rendus (${reports.length})` : `Compte-rendu ${reports[0].name} – ${reportSpan(reports[0])}`;
  if (fmt === 'csv') shareFile(base + '.csv', 'text/csv', b64(buildCSV(reports)), subj);
  else if (fmt === 'doc') shareFile(base + '.doc', 'application/msword', b64(await buildHTML(reports, true)), subj);
  else if (fmt === 'pdf') { const h = await buildHTML(reports, true); if (NATIVE) { if (Android.previewPdf) Android.previewPdf(h, base); else Android.printPdf(h, base); } else { const w = window.open(''); w.document.write(h); w.print(); } }
  else if (fmt === 'mail') { if (NATIVE) Android.sendEmail(S.settings.email || '', subj, textBody(reports)); else location.href = `mailto:${S.settings.email}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(textBody(reports))}`; }
}

/* ---------- Sauvegarde / restauration ---------- */
async function backupJSON() {
  const media = {}; for (const k of await allMediaKeys()) { const b = await getMedia(k); if (b) media[k] = await blobToDataURL(b); }
  return JSON.stringify({ app: 'CR-CSU', v: 1, date: Date.now(), state: S, media });
}
async function autoBackup(force) {
  if (!NATIVE || !Android.saveDownload || !S.settings.autoBackup) return;
  const today = fDate(Date.now()); if (!force && S.lastAutoBackup === today) return;
  try {
    const p = Android.saveDownload(`Sauvegarde_auto_${today.split('/').reverse().join('-')}.json`, b64(await backupJSON()));
    if (p) { S.lastAutoBackup = today; save(); if (force) toast('Sauvegarde enregistrée dans ' + p); }
  } catch {}
}
async function backup() {
  toast('Préparation de la sauvegarde…');
  const json = await backupJSON();
  shareFile(`Sauvegarde_CR_CSU_${fDate(Date.now()).replace(/\//g, '-')}.json`, 'application/json', b64(json), 'Sauvegarde CR CSU');
}
async function restore(file) {
  try {
    const j = JSON.parse(await file.text()); if (j.app !== 'CR-CSU' || !j.state) throw 0;
    if (!(await confirmBox('Remplacer toutes les données actuelles par cette sauvegarde ?', 'Restaurer'))) return;
    await idb('media', 'readwrite', s => s.clear());
    for (const [k, v] of Object.entries(j.media || {})) await putMedia(k, await dataURLToBlob(v));
    S = j.state; await idb('kv', 'readwrite', s => s.put(S, 'state')); await load(); render(); toast('Sauvegarde restaurée');
  } catch { toast('Fichier de sauvegarde invalide'); }
}

/* ---------- Rappels ---------- */
function scheduleReminder(r) {
  if (NATIVE) Android.scheduleReminder(r.id, r.at, 'Rappel CR CSU', r.label);
  else if (r.at > Date.now() && r.at - Date.now() < 2147483647) setTimeout(() => toast('⏰ ' + r.label), r.at - Date.now());
}

/* ---------- Actions ---------- */
const A = {
  back,
  async openSection(d) { go('reports', { sec: d.id }); },
  toggleEdit() { cur().edit = !cur().edit; render(); },
  async newReport() {
    const sec = cur().sec !== '*' ? cur().sec : S.sections[0].id;
    const r = { id: uid(), name: S.settings.defaultName || 'CR', sectionId: sec, profile: S.profile.name, created: Date.now(), start: Date.now(), end: null, events: [] };
    S.reports.push(r); save(); draft = null; go('report', { id: r.id });
  },
  async delReport(d) { if (await confirmBox('Supprimer ce compte-rendu et tous ses évènements ?')) { const r = S.reports.find(x => x.id === d.id); r.events.forEach(e => e.mediaId && delMedia(e.mediaId)); S.reports = S.reports.filter(x => x.id !== d.id); save(); render(); } },
  openReport(d) { draft = null; go('report', { id: d.id }); },
  async editReport() {
    const r = curReport();
    const f = [{ label: 'Nom', value: r.name }, { label: 'Section', type: 'select', value: r.sectionId, options: S.sections.map(s => [s.id, s.name]) }, { label: 'Profil', value: r.profile }];
    if (S.settings.useEndDate) f.push({ label: 'Début', type: 'datetime-local', value: toLocalInput(r.start || r.created) }, { label: 'Fin', type: 'datetime-local', value: r.end ? toLocalInput(r.end) : '' });
    const v = await ask('Modifier le compte-rendu', f); if (!v) return;
    r.name = v[0].trim() || r.name; r.sectionId = v[1]; r.profile = v[2].trim() || r.profile;
    if (S.settings.useEndDate) { r.start = v[3] ? new Date(v[3]).getTime() : r.start; r.end = v[4] ? new Date(v[4]).getTime() : null; }
    save(); render();
  },
  shareReport() { exportReports([curReport()]); },
  quick(d) { const [cid, a] = d.b.split('|'); newEvent({ type: 'action', category: a, cat: cid }); },
  gallery() { $('#fileGallery').value = ''; $('#fileGallery').click(); },
  async camera() { const k = await sheet('Appareil photo', [['p', 'Prendre une photo'], ['v', 'Filmer une vidéo']]); if (k) { const el = k === 'p' ? $('#filePhoto') : $('#fileVideo'); el.value = ''; el.click(); } },
  async geo() { const e = {}; if (await attachGeo(e)) newEvent(Object.assign({ type: 'geo' }, e)); },
  mic() { recordAudio(); },
  async text() { const v = await textModal('Nouvel évènement', ''); const a = lastAddr; if ((v && v.trim()) || a) newEvent(Object.assign({ type: 'text', text: (v || '').trim() }, a ? { address: fullAddr(a) } : {})); },
  qTab(d) { qTab = d.id; render(); },
  async rueMenu(d) {
    const top = stacks.cr[stacks.cr.length - 1]; const rep0 = top.v === 'report' ? S.reports.find(r => r.id === top.id) : null;
    const opts = [['maps', '🗺️ Voir dans Maps']]; if (rep0) opts.push(['note', `📝 Nouvelle note dans « ${rep0.name} »`]); opts.push(['copy', '📋 Copier le nom']);
    const k = await sheet(d.r, opts);
    if (k === 'maps') location.href = 'geo:0,0?q=' + encodeURIComponent(d.r + ', 91330 Yerres');
    if (k === 'copy') { try { await navigator.clipboard.writeText(d.r); toast('Copié'); } catch { toast(d.r); } }
    if (k === 'note' && rep0) {
      const v = await textModal('Note — ' + d.r, ''); if (v === null) return;
      rep0.events.push({ id: uid(), ts: Date.now(), type: 'text', text: (v || '').trim(), address: fullAddr(lastAddr || d.r) }); save(); toast('Note ajoutée dans ' + rep0.name);
    }
  },
  pzIn() { if (PZ) PZ.zoomAt(1.6, PZ.box.clientWidth / 2, PZ.box.clientHeight / 2); },
  pzOut() { if (PZ) PZ.zoomAt(1 / 1.6, PZ.box.clientWidth / 2, PZ.box.clientHeight / 2); },
  pzFit() { if (PZ) PZ.fit(); },
  pzFull() { const b = $('#pz'); if (!b) return; b.classList.toggle('full'); setTimeout(() => PZ && PZ.fit(), 30); },
  openMaps() { location.href = 'geo:48.7175,2.4925?q=Yerres%2091330'; },
  async planMenu() {
    const k = await sheet('Plan', [['photo', 'Remplacer par une photo du plan'], ['reset', 'Revenir au plan d\'origine']]);
    if (k === 'photo') pickImage(async f => { await putMedia('plan_custom', await compressImage(f, 2600)); planSrc = ''; render(); toast('Plan remplacé'); });
    if (k === 'reset') { await delMedia('plan_custom'); planSrc = ''; render(); }
  },
  async phoneMenu(d) {
    const x = S.phones[d.i];
    const k = await sheet(`${x.n} — ${x.t}`, [['call', '📞 Appeler'], ['edit', 'Modifier'], ['del', 'Supprimer']]);
    if (k === 'call') location.href = 'tel:' + x.t.replace(/\s/g, '');
    if (k === 'edit') { const v = await ask('Modifier le numéro', [{ label: 'Nom', value: x.n }, { label: 'Numéro', type: 'tel', value: x.t }]); if (v && v[0].trim() && v[1].trim()) { x.n = v[0].trim(); x.t = v[1].trim(); x.ok = 1; save(); render(); } }
    if (k === 'del' && await confirmBox(`Supprimer « ${x.n} » ?`)) { S.phones.splice(d.i, 1); save(); render(); }
  },
  async addPhone() { const v = await ask('Nouveau numéro', [{ label: 'Nom' }, { label: 'Numéro', type: 'tel' }]); if (v && v[0].trim() && v[1].trim()) { S.phones.push({ n: v[0].trim(), t: v[1].trim(), ok: 1 }); save(); render(); } },
  async dictText() { const t = await dictate(); const el = $('#eText'); if (t && el) el.value = (el.value.trim() ? el.value.trim() + ' ' : '') + t; },
  openHit(d) { draft = null; go('report', { id: d.r, hl: d.e }); },
  setCatColor(d) { const k = S.categories.find(x => x.id === cur().id); k.color = d.c; save(); render(); },
  async shiftTimes() { const v = await ask('Heures de prise de service', [{ label: 'Une ou plusieurs heures, séparées par des virgules (ex. 07:00, 19:00)', value: S.settings.shiftTimes }]); if (!v) return; const t = parseShiftTimes(v[0]); if (!t.length) return toast('Format attendu : 07:00, 19:00'); S.settings.shiftTimes = t.join(', '); S.lastShift = 0; save(); render(); checkShift(); },
  async pdfField(d) { const lab = d.k === 'pdfOrg' ? 'En-tête du PDF (ex. Police municipale de … — CSU)' : 'Nom de l\'agent'; const v = await ask(lab, [{ label: lab, value: S.settings[d.k] }]); if (v) { S.settings[d.k] = v[0].trim(); save(); render(); } },
  async pdfLogo() {
    if (S.settings.pdfLogo) { const k = await sheet('Logo', [['new', 'Choisir un autre logo'], ['del', 'Retirer le logo']]); if (!k) return; if (k === 'del') { S.settings.pdfLogo = ''; save(); render(); return; } }
    pickImage(async f => { S.settings.pdfLogo = await imageToDataURL(f, 400); save(); render(); });
  },
  async pdfSign() { const u = await signaturePad(); if (u !== null) { S.settings.pdfSign = u; save(); render(); } },
  async summary() { const r = curReport(); showSummary([r]); },
  validate() { commitDraft(); },
  cancelDraft() { if (draft && draft.mediaId) delMedia(draft.mediaId); draft = null; render(); },
  swipeDel(d) {
    const r = curReport(); const i = r && r.events.findIndex(x => x.id === d.id); if (i < 0) return;
    const e = r.events.splice(i, 1)[0]; save(); render();
    undoToast('Note supprimée', () => { r.events.splice(i, 0, e); save(); if (cur().v === 'report') render(); }, () => { if (e.mediaId) delMedia(e.mediaId); });
  },
  async quickDelEvent(d) {
    const r = curReport(); const e = r && r.events.find(x => x.id === d.id); if (!e) return;
    if (!(await confirmBox('Supprimer cette note ?'))) return;
    if (e.mediaId) delMedia(e.mediaId); r.events = r.events.filter(x => x !== e); save(); render(); toast('Note supprimée');
  },
  async delThisReport() {
    const r = curReport(); if (!(await confirmBox('Supprimer ce compte-rendu et toutes ses notes ?'))) return;
    r.events.forEach(e => e.mediaId && delMedia(e.mediaId)); S.reports = S.reports.filter(x => x !== r); save(); back();
  },
  openEvent(d) { go('event', { rid: curReport().id, id: d.id }); },
  async toggleLock() {
    const st = S.settings;
    if (!st.lockOn) { if (await newLockCode()) { st.lockOn = true; save(); render(); toast('Verrouillage activé 🔒'); } }
    else if (await verifyLock('Désactiver le verrouillage')) { st.lockOn = false; st.lockHash = ''; st.lockBio = false; save(); render(); toast('Verrouillage désactivé'); }
  },
  async changeLock() { if (await verifyLock('Changer le code') && await newLockCode()) { save(); render(); toast('Code modifié'); } },
  async toggleBio() {
    const st = S.settings;
    if (!st.lockBio) { bioCb = ok => { if (ok) { st.lockBio = true; save(); render(); toast('Empreinte activée'); } }; Android.biometric('Activer l\'empreinte'); }
    else { st.lockBio = false; save(); render(); }
  },
  lockNow() { pausedAt = 0; lockApp(); },
  toggleSecure() { S.settings.secureScreen = !S.settings.secureScreen; save(); applySecure(); render(); toast(S.settings.secureScreen ? 'Écran confidentiel activé' : 'Écran confidentiel désactivé'); },
  setTheme(d) { S.settings.theme = d.v; save(); applyTheme(); render(); },
  toggleTheme() { S.settings.theme = document.documentElement.classList.contains('dark') ? 'clair' : 'sombre'; save(); applyTheme(); render(); },
  dtShift(d) {
    const t = new Date(+$('#eTs').value);
    if (d.d) t.setDate(t.getDate() + +d.d); else t.setMinutes(t.getMinutes() + +d.m);
    dtSet(t.getTime()); if (navigator.vibrate) navigator.vibrate(6);
  },
  dtNow() { const t = new Date(); t.setSeconds(0, 0); dtSet(t.getTime()); },
  dtCal() { const el = $('#dtCal'); if (el.showPicker) try { el.showPicker(); return; } catch {} el.focus(); el.click(); },
  pickCat(d, el) {
    const v = el ? el.dataset.v : d.v; $('#eCat').value = v;
    document.querySelectorAll('.chip[data-a="pickCat"]').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    if (navigator.vibrate) navigator.vibrate(8);
  },
  saveEvent() {
    const c = cur(); const r = S.reports.find(x => x.id === c.rid); const e = r.events.find(x => x.id === c.id);
    const ts = +$('#eTs').value; if (ts) e.ts = ts;
    e.category = $('#eCat').value; e.text = $('#eText').value.trim(); e.comment = $('#eCom').value.trim();
    const ph = $('#ePhone'); if (ph) e.phone = ph.value.trim();
    const ad = $('#eAddr'); if (ad) e.address = ad.value.trim() ? fullAddr(ad.value.trim()) : '';
    save(); back();
  },
  async rescanPhone() {
    const c = cur(); const e = S.reports.find(x => x.id === c.rid).events.find(x => x.id === c.id);
    if (!NATIVE) return toast('Disponible dans l\'application Android');
    toast('Lecture de la photo…'); delete e.phone;
    await detectPhone(e); save(); render(); toast(e.phone ? 'Numéro : ' + e.phone : 'Aucun numéro trouvé');
  },
  async addGeoToEvent() { const c = cur(); const e = S.reports.find(x => x.id === c.rid).events.find(x => x.id === c.id); if (await attachGeo(e)) { save(); render(); } },
  async delEvent() { if (!(await confirmBox('Supprimer cet évènement ?'))) return; const c = cur(); const r = S.reports.find(x => x.id === c.rid); const e = r.events.find(x => x.id === c.id); if (e.mediaId) delMedia(e.mediaId); r.events = r.events.filter(x => x !== e); save(); back(); },
  // export
  toggleSel(d) { const c = cur(); c.sel[d.id] = !c.sel[d.id]; render(); },
  selAll() { const c = cur(); const all = S.reports.every(r => c.sel[r.id]); S.reports.forEach(r => c.sel[r.id] = !all); render(); },
  multiExport() { const c = cur(); exportReports(reportsOf('*').filter(r => c.sel[r.id])); },
  // paramètres
  async editProfile() { const v = await ask('Profil', [{ label: 'Nom du profil', value: S.profile.name }]); if (v && v[0].trim()) { S.profile.name = v[0].trim(); save(); render(); } },
  gotoSections() { go('sectionsEdit'); },
  gotoCategories() { go('categories'); },
  gotoButtons() { if (tab !== 'settings') { tab = 'settings'; stacks.settings = [{ v: 'settings' }]; } go('buttons'); },
  gotoReminders() { go('reminders'); },
  async defaultName() { const v = await ask('Nom par défaut', [{ label: 'Nom des nouveaux comptes-rendus', value: S.settings.defaultName }]); if (v) { S.settings.defaultName = v[0].trim() || 'CR'; save(); render(); } },
  async choice(d) { const k = d.k; const v = await sheet(CHOICES[k].label, CHOICES[k].opts, S.settings[k]); if (v) { S.settings[k] = v; save(); render(); } },
  async bool(d) {
    const k = d.k;
    if (k === 'protectedExport' && !S.settings[k]) { const v = await ask('Code d\'export (4 chiffres ou plus)', [{ label: 'Code', type: 'password' }, { label: 'Confirmer', type: 'password' }]); if (!v) return; if (v[0].length < 4 || v[0] !== v[1]) return toast('Codes invalides ou différents'); S.settings.pin = v[0]; }
    if (k === 'protectedExport' && S.settings[k]) { if (!(await checkPin())) return; S.settings.pin = ''; }
    S.settings[k] = !S.settings[k]; save(); applyBig(); render(); if (k === 'shiftAuto' && S.settings.shiftAuto) { S.lastShift = 0; checkShift(); } if (k === 'autoBackup' && S.settings.autoBackup) autoBackup(true);
  },
  async email() { const v = await ask('Email de destination', [{ label: 'Adresse', type: 'email', value: S.settings.email }]); if (v) { S.settings.email = v[0].trim(); save(); render(); } },
  info(d) { modal(`<h3>Information</h3><p style="text-align:center">${esc(d.m)}</p><button class="bigbtn" onclick="closeModal()">OK</button>`, true); },
  backup, restore() { $('#fileRestore').value = ''; $('#fileRestore').click(); },
  async resetAll() { if (await confirmBox('Effacer définitivement tous les comptes-rendus et réglages ?', 'Tout effacer')) { await idb('media', 'readwrite', s => s.clear()); S = DEFAULT(); save(); render(); toast('Données effacées'); } },
  async addSection() { const v = await ask('Nouvelle section', [{ label: 'Nom' }]); if (v && v[0].trim()) { S.sections.push({ id: uid(), name: v[0].trim() }); save(); render(); } },
  async renameSection(d) { const s = S.sections.find(x => x.id === d.id); const v = await ask('Renommer la section', [{ label: 'Nom', value: s.name }]); if (v && v[0].trim()) { s.name = v[0].trim(); save(); render(); } },
  async delSection(d) {
    const n = S.reports.filter(r => r.sectionId === d.id).length;
    if (!(await confirmBox(n ? `Supprimer la section ? Ses ${n} compte(s)-rendu(s) seront déplacés dans « ${S.sections.find(s => s.id !== d.id).name} ».` : 'Supprimer la section ?'))) return;
    S.sections = S.sections.filter(s => s.id !== d.id); S.reports.forEach(r => { if (r.sectionId === d.id) r.sectionId = S.sections[0].id; }); save(); render();
  },
  async addCategory() { const v = await ask('Nouvelle catégorie', [{ label: 'Nom' }]); if (v && v[0].trim()) { const k = { id: uid(), name: v[0].trim(), actions: [] }; S.categories.push(k); save(); go('category', { id: k.id }); } },
  openCategory(d) { go('category', { id: d.id }); },
  async renameCategory() { const k = S.categories.find(x => x.id === cur().id); const v = await ask('Renommer', [{ label: 'Nom', value: k.name }]); if (v && v[0].trim()) { k.name = v[0].trim(); save(); render(); } },
  async delCategory() { const k = S.categories.find(x => x.id === cur().id); if (!(await confirmBox(`Supprimer « ${k.name} » ?`))) return; S.categories = S.categories.filter(x => x !== k); S.buttons = S.buttons.filter(b => !b.startsWith(k.id + '|')); save(); back(); },
  async addAction() { const k = S.categories.find(x => x.id === cur().id); const v = await ask('Nouvelle action', [{ label: 'Nom de l\'action' }]); if (v && v[0].trim()) { k.actions.push(v[0].trim()); save(); render(); } },
  async renameAction(d) { const k = S.categories.find(x => x.id === cur().id); const old = k.actions[d.i]; const v = await ask('Renommer l\'action', [{ label: 'Nom', value: old }]); if (v && v[0].trim()) { k.actions[d.i] = v[0].trim(); S.buttons = S.buttons.map(b => b === k.id + '|' + old ? k.id + '|' + v[0].trim() : b); save(); render(); } },
  delAction(d) { const k = S.categories.find(x => x.id === cur().id); const a = k.actions.splice(d.i, 1)[0]; S.buttons = S.buttons.filter(b => b !== k.id + '|' + a); save(); render(); },
  toggleButton(d) { const i = S.buttons.indexOf(d.b); if (i >= 0) S.buttons.splice(i, 1); else if (S.buttons.length >= maxBtn()) return toast(`Maximum ${maxBtn()} boutons (modifiable en haut de cette page)`); else S.buttons.push(d.b); save(); render(); },
  async addReminder() {
    const v = await ask('Nouveau rappel', [{ label: 'Libellé', value: 'Rédiger le compte-rendu' }, { label: 'Type', type: 'select', value: 'delay', options: [['delay', 'Après un délai'], ['date', 'À une date précise']] }, { label: 'Délai en minutes (si « après un délai »)', type: 'number', value: '60' }, { label: 'Date et heure (si « date précise »)', type: 'datetime-local', value: toLocalInput(Date.now() + 3600e3) }]);
    if (!v) return;
    const at = v[1] === 'delay' ? Date.now() + Math.max(1, +v[2] || 0) * 60e3 : new Date(v[3]).getTime();
    if (!at || at <= Date.now()) return toast('Date de rappel invalide');
    const r = { id: uid(), label: v[0].trim() || 'Rappel', at }; S.reminders.push(r); save(); scheduleReminder(r); render(); toast('Rappel programmé');
  },
  delReminder(d) { if (NATIVE) Android.cancelReminder(d.id); S.reminders = S.reminders.filter(r => r.id !== d.id); save(); render(); }
};

function undoToast(msg, undo, commit) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = `${esc(msg)} <button style="margin-left:10px;background:none;border:0;color:#6fb1ff;font-weight:700;font-size:14px">ANNULER</button>`;
  document.body.appendChild(t); let done = false;
  const end = () => { if (done) return; done = true; t.remove(); commit && commit(); };
  t.querySelector('button').onclick = () => { if (done) return; done = true; t.remove(); undo(); };
  setTimeout(end, 4500);
}

/* ---------- Synthèse / résumé de fin de service ---------- */
function countBy(reports) {
  const m = new Map();
  for (const r of reports) for (const e of r.events) {
    const n = e.category || { photo: 'Photos', video: 'Vidéos', audio: 'Mémos vocaux', geo: 'Positions', text: 'Notes texte' }[e.type] || 'Autres';
    const x = m.get(n) || [n, 0, colorOf(e)]; x[1]++; m.set(n, x);
  }
  return [...m.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function summaryText(reports) {
  const st = S.settings; const rows = rowsFor(reports); const c = countBy(reports);
  const ts = rows.map(x => x.e.ts);
  const L = [];
  L.push(`RÉSUMÉ DE FIN DE SERVICE${st.pdfOrg ? ' — ' + st.pdfOrg : ''}`);
  L.push(reports.length > 1 ? `Comptes-rendus : ${reports.map(r => r.name).join(', ')}` : `Compte-rendu : ${reports[0].name} (section ${sectionName(reports[0].sectionId)})`);
  L.push(`Agent : ${st.pdfAgent || S.profile.name}`);
  if (ts.length) L.push(`Période : du ${fDate(Math.min(...ts))} ${fTime(Math.min(...ts))} au ${fDate(Math.max(...ts))} ${fTime(Math.max(...ts))}`);
  L.push(`Total : ${plural(rows.length, 'évènement')}`, '', 'SYNTHÈSE');
  for (const [n, v] of c) L.push(`- ${n} : ${v}`);
  L.push('', 'CHRONOLOGIE');
  let last = '';
  for (const { r, e } of rows) {
    const d = fDate(e.ts); if (d !== last) { L.push(`[${d}]`); last = d; }
    L.push(`${fTime(e.ts)}  ${evLine(e)}${e.phone ? ' — n° ' + e.phone : ''}${e.address && st.showAddress ? ' — ' + e.address : ''}${e.comment && st.showComment ? ' (' + e.comment + ')' : ''}${reports.length > 1 ? '  [' + r.name + ']' : ''}`);
  }
  L.push('', `Édité le ${fDate(Date.now())} à ${fTime(Date.now())}`);
  return L.join('\n');
}
function showSummary(reports) {
  const txt = summaryText(reports); const c = countBy(reports);
  modal(`<h3>📋 Résumé de fin de service</h3>
    <div class="sumc">${c.map(([n, v, col]) => `<div style="border-left:5px solid ${col || '#999'}"><b>${v}</b><span>${esc(n)}</span></div>`).join('') || '<div class="hint">Aucun évènement.</div>'}</div>
    <pre class="sumt">${esc(txt)}</pre>
    <div class="row2"><button class="bigbtn grey" id="smX">Fermer</button><button class="bigbtn" id="smS">Partager</button></div>`, true);
  $('#smX').onclick = closeModal;
  $('#smS').onclick = () => { closeModal(); const subj = 'Résumé de fin de service — ' + (reports.length > 1 ? 'comptes-rendus' : reports[0].name); if (NATIVE) Android.sendEmail(S.settings.email || '', subj, txt); else location.href = `mailto:${S.settings.email}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(txt)}`; };
}

/* ---------- Dictée vocale ---------- */
let dictCb = null, lastAddr = '';
window.__dict = t => { const cb = dictCb; dictCb = null; cb && cb(t); };
function dictate() {
  return new Promise(ok => {
    if (NATIVE && Android.dictate) { dictCb = ok; Android.dictate(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Dictée non disponible'); return ok(null); }
    const r = new SR(); r.lang = 'fr-FR'; r.onresult = e => ok(e.results[0][0].transcript); r.onerror = () => ok(null); r.start(); toast('Parlez…');
  });
}
function textModal(title, value) {
  return new Promise(ok => {
    modal(`<h3>${esc(title)}</h3><div class="field"><textarea id="tmT" style="min-height:110px">${esc(value || '')}</textarea></div>
      <div class="field"><label>Adresse (facultatif)</label><input id="tmA" list="dlRues" placeholder="Commencez à taper une rue de Yerres…" autocomplete="off"></div>
      <button class="bigbtn dict" id="tmD">🎤 Dicter</button>
      <div class="row2"><button class="bigbtn grey" id="tmX">Annuler</button><button class="bigbtn" id="tmOk">OK</button></div>`, true);
    const ta = $('#tmT'); setTimeout(() => ta.focus(), 50);
    $('#tmD').onclick = async () => { const t = await dictate(); if (t && $('#tmT')) { const el = $('#tmT'); el.value = (el.value.trim() ? el.value.trim() + ' ' : '') + t; } };
    $('#tmX').onclick = () => { closeModal(); ok(null); };
    $('#tmOk').onclick = () => { const v = $('#tmT').value; lastAddr = $('#tmA').value.trim(); closeModal(); ok(v); };
  });
}

/* ---------- Vacation automatique ---------- */
function parseShiftTimes(str) {
  return String(str || '').split(/[,;\s]+/).map(x => x.trim().replace('h', ':')).filter(Boolean)
    .map(x => { const m = x.match(/^(\d{1,2})(?::(\d{2}))?$/); if (!m || +m[1] > 23 || +(m[2] || 0) > 59) return null; return p2(+m[1]) + ':' + p2(+(m[2] || 0)); })
    .filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).sort();
}
function lastShiftStart() {
  const now = Date.now(); let best = 0;
  for (const t of parseShiftTimes(S.settings.shiftTimes)) for (const dd of [0, -1]) {
    const d = new Date(); d.setDate(d.getDate() + dd); const [h, m] = t.split(':'); d.setHours(+h, +m, 0, 0);
    if (d.getTime() <= now && d.getTime() > best) best = d.getTime();
  }
  return best;
}
function checkShift() {
  if (!S || !S.settings.shiftAuto) return;
  const st = lastShiftStart(); if (!st || S.lastShift === st) return;
  S.lastShift = st;
  if (S.reports.some(r => r.shiftStart === st)) { save(); return; }
  const r = { id: uid(), name: `${S.settings.defaultName || 'CR'} ${fDate(st)} ${fTime(st)}`, sectionId: S.sections[0].id, profile: S.profile.name, created: Date.now(), start: st, end: null, shiftStart: st, events: [] };
  S.reports.push(r); save();
  tab = 'cr'; stacks.cr = [{ v: 'sections' }, { v: 'reports', sec: r.sectionId }, { v: 'report', id: r.id }]; draft = null; render();
  toast(`Vacation de ${fTime(st)} : compte-rendu créé`);
}

/* ---------- Images (logo) et signature ---------- */
function pickImage(cb) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
  i.onchange = () => i.files[0] && cb(i.files[0]); i.click();
}
function imageToDataURL(file, max) {
  return new Promise(ok => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(u); ok(cv.toDataURL('image/png')); };
    img.onerror = () => ok(''); img.src = u;
  });
}
function signaturePad() {
  return new Promise(ok => {
    modal(`<h3>Signature</h3><div class="hint" style="text-align:center">Signez avec le doigt dans le cadre</div>
      <canvas id="sgC" class="sigpad" width="600" height="260"></canvas>
      <div class="row2"><button class="bigbtn grey" id="sgE">Effacer</button><button class="bigbtn red" id="sgD">Retirer</button></div>
      <div class="row2"><button class="bigbtn grey" id="sgX">Annuler</button><button class="bigbtn" id="sgOk">Enregistrer</button></div>`, true);
    const cv = $('#sgC'), g = cv.getContext('2d'); let drawing = false, empty = true;
    g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111';
    const pos = e => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * cv.width / b.width, (e.clientY - b.top) * cv.height / b.height]; };
    cv.onpointerdown = e => { drawing = true; empty = false; cv.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pos(e)); };
    cv.onpointermove = e => { if (!drawing) return; g.lineTo(...pos(e)); g.stroke(); };
    cv.onpointerup = cv.onpointercancel = () => { drawing = false; };
    $('#sgE').onclick = () => { g.clearRect(0, 0, cv.width, cv.height); empty = true; };
    $('#sgD').onclick = () => { closeModal(); ok(''); };
    $('#sgX').onclick = () => { closeModal(); ok(null); };
    $('#sgOk').onclick = () => { const u = empty ? '' : cv.toDataURL('image/png'); closeModal(); ok(u); };
  });
}

/* ---------- Appui long : corriger l'heure ---------- */
async function shiftEventTime(id) {
  const r = curReport(); const e = r && r.events.find(x => x.id === id); if (!e) return;
  if (navigator.vibrate) navigator.vibrate(30);
  const k = await sheet(`Heure de « ${evLine(e)} » : ${fTime(e.ts)}`, [['-10', '− 10 min'], ['-5', '− 5 min'], ['-1', '− 1 min'], ['1', '+ 1 min'], ['5', '+ 5 min'], ['10', '+ 10 min'], ['set', 'Choisir l\'heure…']]);
  if (!k) return;
  if (k === 'set') {
    const v = await ask('Nouvelle heure', [{ label: 'Heure', type: 'time', value: `${p2(new Date(e.ts).getHours())}:${p2(new Date(e.ts).getMinutes())}` }]);
    if (!v || !v[0]) return; const [h, m] = v[0].split(':'); const d = new Date(e.ts); d.setHours(+h, +m, 0, 0); e.ts = d.getTime();
  } else e.ts += +k * 60e3;
  save(); render(); toast('Heure : ' + fTime(e.ts));
}
let lpT = null;

/* ---------- Glisser pour supprimer ---------- */
const SW = 96; let sw = null, swipedAt = 0;
function closeSwipes(except) { document.querySelectorAll('.swipe .ev.open').forEach(el => { if (el !== except) { el.classList.remove('open'); el.style.transform = ''; } }); }
document.addEventListener('contextmenu', e => { if (e.target.closest('.swipe .ev')) e.preventDefault(); });
document.addEventListener('pointerdown', e => {
  const ev = e.target.closest('.swipe .ev'); if (!ev) { if (!e.target.closest('.swbg')) closeSwipes(); return; }
  sw = { el: ev, x: e.clientX, y: e.clientY, base: ev.classList.contains('open') ? -SW : 0, dx: 0, h: null };
  clearTimeout(lpT); const id = ev.dataset.id;
  lpT = setTimeout(() => { if (sw && sw.h === null && sw.el === ev) { sw = null; swipedAt = Date.now() + 400; shiftEventTime(id); } }, 550);
});
document.addEventListener('pointermove', e => {
  if (!sw) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
  if (sw.h === null) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; clearTimeout(lpT); sw.h = Math.abs(dx) > Math.abs(dy); if (sw.h) closeSwipes(sw.el); }
  if (!sw.h) return;
  sw.dx = dx; const w = sw.el.parentNode.offsetWidth;
  sw.el.style.transition = 'none';
  sw.el.style.transform = `translateX(${Math.max(-w, Math.min(0, sw.base + dx))}px)`;
});
function swipeEnd() {
  clearTimeout(lpT);
  if (!sw) return; const s = sw; sw = null; if (!s.h) return;
  swipedAt = Date.now(); s.el.style.transition = '';
  const pos = s.base + s.dx, w = s.el.parentNode.offsetWidth;
  if (pos < -w * 0.55) { s.el.style.transform = `translateX(${-w}px)`; const id = s.el.parentNode.querySelector('.swbg').dataset.id; setTimeout(() => A.swipeDel({ id }), 180); }
  else if (pos < -SW / 2) { s.el.classList.add('open'); s.el.style.transform = `translateX(${-SW}px)`; }
  else { s.el.classList.remove('open'); s.el.style.transform = ''; }
}
document.addEventListener('pointerup', swipeEnd);
document.addEventListener('pointercancel', swipeEnd);

/* ---------- Verrouillage de l'appli ---------- */
async function hashPin(pin, salt) {
  const txt = salt + ':' + pin;
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  catch { let h = 5381; for (const c of txt) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return 'd' + h.toString(16); }
}
let bioCb = null;
window.__bio = ok => { const f = bioCb; bioCb = null; if (f) f(ok); };
const canBio = () => NATIVE && Android.canBiometric && Android.biometric && S.settings.lockBio && Android.canBiometric();
/* Pavé numérique plein écran. mode 'unlock' : se valide seul ; mode 'set' : 4 à 6 chiffres + OK. */
function pinPad({ title, sub = '', mode = 'unlock', check, cancel }) {
  return new Promise(done => {
    let code = '', fails = 0, waitUntil = 0;
    const el = document.createElement('div'); el.id = 'lock'; el.className = 'lock';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', mode === 'unlock' && canBio() ? 'bio' : (mode === 'set' ? 'ok' : ''), '0', 'del'];
    el.innerHTML = `<div class="lk-top"><div class="lk-logo">🔒</div><div class="lk-t">${esc(title)}</div><div class="lk-s">${esc(sub)}</div><div class="lk-dots"></div><div class="lk-err"></div></div>
      <div class="lk-pad">${keys.map(k => `<button class="lk-k ${k ? '' : 'empty'} ${['bio', 'ok', 'del'].includes(k) ? 'fn' : ''}" data-k="${k}">${k === 'bio' ? '👆' : k === 'ok' ? 'OK' : k === 'del' ? '⌫' : k}</button>`).join('')}</div>
      ${cancel ? '<button class="lk-cancel">Annuler</button>' : ''}`;
    document.body.appendChild(el);
    const dots = el.querySelector('.lk-dots'), err = el.querySelector('.lk-err');
    const n = mode === 'unlock' ? S.settings.lockLen : 6;
    const draw = () => { dots.innerHTML = Array.from({ length: mode === 'unlock' ? n : Math.max(4, code.length) }, (_, i) => `<i class="${i < code.length ? 'on' : ''}"></i>`).join(''); };
    const finish = v => { el.remove(); done(v); };
    const shake = msg => { err.textContent = msg; dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); if (navigator.vibrate) navigator.vibrate(120); };
    const submit = async () => {
      if (mode === 'set') { if (code.length < 4) return shake('Au moins 4 chiffres'); return finish(code); }
      if (await check(code)) return finish(code);
      fails++; code = ''; draw();
      if (fails % 5 === 0) { waitUntil = Date.now() + 30000; shake('Trop d\'essais : patientez 30 s'); }
      else shake(`Code incorrect (${fails})`);
    };
    const bio = () => { if (!canBio()) return; bioCb = ok => { if (ok) finish('bio'); }; Android.biometric('Déverrouiller CR CSU'); };
    el.querySelectorAll('.lk-k').forEach(b => b.onclick = () => {
      const k = b.dataset.k; if (!k) return;
      if (Date.now() < waitUntil) return shake(`Patientez ${Math.ceil((waitUntil - Date.now()) / 1000)} s`);
      if (k === 'del') { code = code.slice(0, -1); err.textContent = ''; }
      else if (k === 'bio') return bio();
      else if (k === 'ok') return submit();
      else if (code.length < n) { code += k; err.textContent = ''; }
      draw();
      if (mode === 'unlock' && code.length === n) setTimeout(submit, 120);
    });
    if (cancel) el.querySelector('.lk-cancel').onclick = () => finish(null);
    draw();
    if (mode === 'unlock' && canBio()) setTimeout(bio, 350);
  });
}
let locking = false, pausedAt = 0;
async function lockApp() {
  if (!S.settings.lockOn || !S.settings.lockHash || locking || document.getElementById('lock')) return;
  locking = true; closeModal();
  await pinPad({ title: 'CR CSU verrouillé', sub: 'Saisissez votre code', check: async c => (await hashPin(c, S.settings.lockSalt)) === S.settings.lockHash });
  locking = false;
}
window.__pause = () => { pausedAt = Date.now(); };
window.__resume = skip => {
  setTimeout(() => { checkShift(); autoBackup(); }, 500);
  if (skip || !pausedAt) return;
  if ((Date.now() - pausedAt) / 1000 >= +(S.settings.lockDelay || 0)) lockApp();
};
async function newLockCode() {
  const a = await pinPad({ title: 'Nouveau code', sub: 'Choisissez 4 à 6 chiffres puis OK', mode: 'set', cancel: true }); if (!a) return false;
  const b = await pinPad({ title: 'Confirmez le code', sub: 'Saisissez-le une seconde fois puis OK', mode: 'set', cancel: true }); if (!b) return false;
  if (a !== b) { toast('Les deux codes sont différents'); return false; }
  const st = S.settings; st.lockSalt = uid() + uid(); st.lockHash = await hashPin(a, st.lockSalt); st.lockLen = a.length; return true;
}
async function verifyLock(title) {
  if (!S.settings.lockOn) return true;
  return !!(await pinPad({ title, sub: 'Saisissez votre code actuel', cancel: true, check: async c => (await hashPin(c, S.settings.lockSalt)) === S.settings.lockHash }));
}
function applySecure() { if (NATIVE && Android.setSecure) Android.setSecure(!!S.settings.secureScreen); }

/* ---------- Événements globaux ---------- */
document.addEventListener('click', e => {
  if (e.target.closest('a.call')) return;
  const t = e.target.closest('[data-a]'); if (!t || t.closest('#modalRoot')) return;
  if (t.classList.contains('ev')) { if (Date.now() - swipedAt < 400) return; if (t.classList.contains('open')) { closeSwipes(); return; } }
  const fn = A[t.dataset.a]; if (fn) { e.stopPropagation(); fn(Object.assign({}, t.dataset)); }
});
document.addEventListener('input', e => { if (e.target.id === 'draftCom' && draft) draft.comment = e.target.value; });
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  if (tab === b.dataset.tab) stacks[tab] = stacks[tab].slice(0, 1); tab = b.dataset.tab; draft = null; render();
});
for (const id of ['fileGallery', 'filePhoto', 'fileVideo']) $('#' + id).onchange = e => handleFile(e.target.files[0]);
$('#fileRestore').onchange = e => e.target.files[0] && restore(e.target.files[0]);

(async () => { await load(); fillStreets(); applyTheme(); applyBig(); applySecure(); lockApp(); render(); checkShift(); setTimeout(() => autoBackup(), 4000); })();
