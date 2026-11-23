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
const getMedia = id => idb('media', 'readonly', s => s.get(id));
const delMedia = id => idb('media', 'readwrite', s => s.delete(id));
const allMediaKeys = () => idb('media', 'readonly', s => s.getAllKeys());

const DEFAULT = () => ({
  profile: { name: 'Zouti' },
  sections: [{ id: 'csu', name: 'CSU' }],
  categories: [
    { id: 'c1', name: 'Surveillance', actions: ['Ronde caméras', 'Individu suspect', 'Attroupement'] },
    { id: 'c2', name: 'Intervention', actions: ['Appel police', 'Appel pompiers', 'Réquisition vidéo'] },
    { id: 'c3', name: 'Incident', actions: ['Accident', 'Dégradation', 'Rixe'] },
    { id: 'c4', name: 'Technique', actions: ['Caméra HS', 'Panne réseau'] }
  ],
  buttons: ['c1|Ronde caméras', 'c1|Individu suspect', 'c2|Appel police', 'c2|Appel pompiers', 'c3|Accident', 'c3|Rixe'],
  reminders: [],
  settings: {
    defaultName: 'CSU', validation: 'auto', sortReports: 'date', sortEvents: 'date', useEndDate: false,
    timeFormat: 'sans', imageQuality: 'moyenne', videoQuality: 'moyenne', autoGeo: false, lang: 'fr',
    email: '', multiExport: 'date', showDates: 'debut', showCoords: true, showCoordDate: false,
    showAddress: true, showComment: true, protectedExport: false, pin: ''
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
  for (const k of ['profile', 'sections', 'categories', 'buttons', 'reminders', 'reports']) if (!S[k]) S[k] = d[k];
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
const stacks = { cr: [{ v: 'sections' }], export: [{ v: 'export' }], settings: [{ v: 'settings' }], about: [{ v: 'about' }] };
let tab = 'cr';
const cur = () => stacks[tab][stacks[tab].length - 1];
function go(v, args = {}) { stacks[tab].push(Object.assign({ v }, args)); render(); $('#view').scrollTop = 0; }
function back() { if (stacks[tab].length > 1) { stacks[tab].pop(); render(); } }
window.__back = () => { if ($('#modalRoot').innerHTML) { closeModal(); return true; } if (stacks[tab].length > 1) { back(); return true; } return false; };

function toast(m) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2300); }
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 4l-8 8 8 8"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M6 11H4.5v10h15V11H18"/></svg>',
  gallery: '<svg viewBox="0 0 24 24"><path d="M3 5h15v12H3z" fill="none" stroke="#333" stroke-width="2"/><path d="M6 20h15V8" fill="none" stroke="#333" stroke-width="2"/><path d="M5 15l4-4 3 3 2-2 3 3z"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4.2" fill="#ddd"/><circle cx="12" cy="13" r="2.6"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 2a6.5 6.5 0 0 0-6.5 6.5C5.5 13.5 12 22 12 22s6.5-8.5 6.5-13.5A6.5 6.5 0 0 0 12 2z"/><circle cx="12" cy="8.5" r="2.5" fill="#ddd"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M6 11a6 6 0 0 0 12 0" fill="none" stroke="#333" stroke-width="2"/><path d="M11 17h2v4h-2z"/></svg>'
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

VIEWS.sections = () => {
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
function evHTML(e, pending) {
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
  return `<div class="ev ${pending ? 'pending' : ''}" ${pending ? '' : `data-a="openEvent" data-id="${e.id}"`}>
    <div class="time">${fTime(e.ts)}</div>
    <div class="body">${bits.join(' — ') || (e.type === 'audio' ? '<span class="cat">Mémo vocal</span>' : e.type === 'photo' ? '<span class="cat">Photo</span>' : e.type === 'video' ? '<span class="cat">Vidéo</span>' : '')}
      ${audio}${meta.length ? `<div class="meta">📍 ${meta.join(' · ')}</div>` : ''}
      ${e.comment && st.showComment ? `<div class="com">${esc(e.comment)}</div>` : ''}</div>${media}</div>`;
}

VIEWS.report = c => {
  const r = S.reports.find(x => x.id === c.id);
  if (!r) { stacks[tab].pop(); return VIEWS[cur().v](cur()); }
  setBar(r.name, backBtn(), `<button class="bbtn" data-a="shareReport">${ICON.share}</button><button class="bbtn" data-a="editReport">Modifier</button>`);
  const evs = sortedEvents(r); let last = '';
  const list = evs.map(e => { const k = dayKey(e.ts); const h = k !== last ? `<div class="group" style="padding:8px 14px 4px;font-size:13px">${k}</div>` : ''; last = k; return h + evHTML(e); }).join('');
  const btns = S.buttons.slice(0, 9).map(b => { const [, a] = b.split('|'); return `<button class="qbtn" data-a="quick" data-b="${esc(b)}">${esc(a)}</button>`; }).join('');
  c.after = () => { const el = $('.events'); if (el && S.settings.sortEvents !== 'date_desc') el.scrollTop = el.scrollHeight; };
  return `<div class="report">
    <div class="events">${list || '<div class="empty">Aucun évènement.<br>Utilisez les boutons ci-dessous.</div>'}</div>
    <div class="panel">
      ${draft ? `<div class="draft">${evHTML(draft, true)}<textarea id="draftCom" placeholder="Commentaire (facultatif)">${esc(draft.comment || '')}</textarea></div>` : ''}
      <div class="qbtns">${btns || '<button class="qbtn none" data-a="gotoButtons">Configurer les boutons (Paramètres › Boutons)</button>'}</div>
      <div class="tools">
        <button class="tool" data-a="gallery">${ICON.gallery}</button>
        <button class="tool" data-a="camera">${ICON.camera}</button>
        <button class="tool" data-a="geo">${ICON.pin}</button>
        <button class="tool" data-a="mic">${ICON.mic}</button>
        <button class="tool" data-a="text">Texte</button>
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
    <div class="field"><label>Date et heure</label><input type="datetime-local" id="eTs" value="${toLocalInput(e.ts)}" step="1"></div>
    <div class="field"><label>Action / catégorie</label><select id="eCat">${cats.map(a => `<option ${a === e.category ? 'selected' : ''}>${esc(a)}</option>`).join('')}${e.category && !cats.includes(e.category) ? `<option selected>${esc(e.category)}</option>` : ''}</select></div>
    <div class="field"><label>Texte</label><textarea id="eText">${esc(e.text || '')}</textarea></div>
    <div class="field"><label>Commentaire</label><textarea id="eCom">${esc(e.comment || '')}</textarea></div>
    ${e.lat != null ? `<div class="field"><label>Coordonnées${e.geoTs ? ' (relevées le ' + fDate(e.geoTs) + ' à ' + fTime(e.geoTs) + ')' : ''}</label><div>${e.lat.toFixed(6)}, ${e.lon.toFixed(6)}</div>${e.address ? `<div style="font-size:14px;color:#555;margin-top:4px">${esc(e.address)}</div>` : ''}</div>` : ''}
    <button class="bigbtn grey" data-a="addGeoToEvent">${e.lat != null ? 'Mettre à jour la position' : 'Ajouter ma position'}</button>
    <button class="bigbtn red" data-a="delEvent">Supprimer l'évènement</button></div>`;
};

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
  return `<div class="group">Personnalisation</div>
    ${navCell('Profil', '', 'editProfile', esc(S.profile.name))}
    ${navCell('Sections', 'Rangez vos comptes-rendus dans des sections logiques', 'gotoSections')}
    ${navCell('Catégories', 'Créez vos catégories et leurs actions pour la prise de note', 'gotoCategories')}
    ${navCell('Boutons (max 9)', 'Personnalisez vos boutons à partir des catégories', 'gotoButtons')}
    ${navCell('Rappels', 'Définissez des rappels à une date précise ou après un délai', 'gotoReminders')}
    <div class="group">Paramètres</div>
    <div class="cell" data-a="defaultName"><div class="grow">Nom par défaut</div><span class="val">${esc(st.defaultName)}</span></div>
    ${choiceCell('validation')}${choiceCell('sortReports')}${choiceCell('sortEvents')}${boolCell('useEndDate')}
    ${choiceCell('timeFormat')}${choiceCell('imageQuality')}${choiceCell('videoQuality')}${boolCell('autoGeo')}
    <div class="cell"><div class="grow">Langage</div><span class="val">Français 🇫🇷</span></div>
    <div class="group">Sauvegarde</div>
    <div class="cell" data-a="backup"><span style="font-size:20px">☁️</span><div class="grow t" style="font-weight:600">Sauvegarder</div></div>
    <div class="cell" data-a="restore"><span style="font-size:20px">📥</span><div class="grow t" style="font-weight:600">Restaurer</div></div>
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
  return `<div class="cell" data-a="renameCategory"><div class="grow">Nom</div><span class="val">${esc(k.name)}</span></div><div class="group">Actions</div>` +
    k.actions.map((a, i) => `<div class="cell"><div class="grow" data-a="renameAction" data-i="${i}">${esc(a)}</div><button class="del" data-a="delAction" data-i="${i}">Suppr.</button></div>`).join('') +
    `<div style="padding:16px"><button class="bigbtn red" data-a="delCategory">Supprimer la catégorie</button></div>`;
};
VIEWS.buttons = () => {
  setBar('Boutons (max 9)', backBtn());
  return `<div class="hint">${S.buttons.length}/9 boutons sélectionnés. Ils apparaissent en bas de chaque compte-rendu.</div>` +
    S.categories.map(k => `<div class="group">${esc(k.name)}</div>` + k.actions.map(a => { const key = k.id + '|' + a; const on = S.buttons.includes(key); return `<div class="cell" data-a="toggleButton" data-b="${esc(key)}"><span class="ck ${on ? 'on' : ''}">${on ? '✓' : ''}</span><div class="grow">${esc(a)}</div></div>`; }).join('')).join('');
};
VIEWS.reminders = () => {
  setBar('Rappels', backBtn(), `<button class="bbtn plus" data-a="addReminder">+</button>`);
  const l = [...S.reminders].sort((a, b) => a.at - b.at);
  return (l.map(r => `<div class="cell"><div class="grow"><div class="t" style="font-weight:600">${esc(r.label)}</div><div class="s">${fDate(r.at)} à ${fTime(r.at)}${r.at < Date.now() ? ' — passé' : ''}</div></div><button class="del" data-a="delReminder" data-id="${r.id}">Suppr.</button></div>`).join('') || '<div class="empty">Aucun rappel.</div>') +
    '<div class="hint">Une notification s\'affiche sur le téléphone à l\'heure du rappel.</div>';
};
VIEWS.about = () => {
  setBar('À propos');
  return `<div class="about"><div class="logo">CR</div><h2 style="margin:0">CR CSU</h2><div style="color:#777">Version 1.0</div>
  <p>Prise de notes horodatées pour rédiger les comptes-rendus du CSU : évènements, photos, vidéos, mémos vocaux, positions GPS.</p>
  <p style="font-size:14px;color:#666">Toutes les données restent sur ce téléphone. Pensez à utiliser <b>Paramètres › Sauvegarder</b> régulièrement.</p>
  <p style="font-size:13px;color:#888">${S.reports.length} compte(s)-rendu(s) · ${S.reports.reduce((n, r) => n + r.events.length, 0)} évènement(s)</p></div>`;
};

/* ---------- Médias ---------- */
const urlCache = {};
async function mediaURL(id) { if (urlCache[id]) return urlCache[id]; const b = await getMedia(id); if (!b) return ''; return (urlCache[id] = URL.createObjectURL(b)); }
function hydrateMedia() { document.querySelectorAll('[data-media]').forEach(async el => { el.src = await mediaURL(el.dataset.media); }); }
const blobToDataURL = b => new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); });
async function dataURLToBlob(u) { return (await fetch(u)).blob(); }
function compressImage(file) {
  const max = { basse: 800, moyenne: 1400, haute: 2400 }[S.settings.imageQuality] || 1400;
  const q = { basse: .6, moyenne: .75, haute: .9 }[S.settings.imageQuality] || .75;
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

/* ---------- Création d'évènements ---------- */
const curReport = () => { const c = cur(); return c.v === 'report' ? S.reports.find(r => r.id === c.id) : null; };
async function newEvent(fields) {
  const r = curReport(); if (!r) return;
  const e = Object.assign({ id: uid(), ts: Date.now(), type: 'text' }, fields);
  if (S.settings.autoGeo && e.lat == null) await attachGeo(e, true);
  if (S.settings.validation === 'auto') { r.events.push(e); save(); render(); toast('Évènement ajouté'); }
  else { if (draft && draft.mediaId) delMedia(draft.mediaId); draft = e; render(); }
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
  const blob = isImg ? await compressImage(file) : file;
  const id = uid(); await putMedia(id, blob);
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
  const head = ['Compte-rendu', 'Section', 'Profil', 'Date', 'Heure', 'Catégorie', 'Texte', 'Type'];
  if (st.showCoords) head.push('Latitude', 'Longitude'); if (st.showCoordDate) head.push('Date coordonnées');
  if (st.showAddress) head.push('Adresse'); if (st.showComment) head.push('Commentaire');
  const lines = [head.map(q).join(';')];
  for (const { r, e } of rowsFor(reports)) {
    const row = [r.name, sectionName(r.sectionId), r.profile, fDate(e.ts), fTime(e.ts), e.category, e.text, e.type];
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
    if (withImages && e.type === 'photo' && e.mediaId) { const b = await getMedia(e.mediaId); if (b) img = `<br><img src="${await blobToDataURL(b)}" style="max-width:320px;max-height:260px;margin-top:4px">`; }
    const meta = [];
    if (e.lat != null && st.showCoords) meta.push(`GPS : ${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}` + (st.showCoordDate && e.geoTs ? ` (${fDate(e.geoTs)} ${fTime(e.geoTs)})` : ''));
    if (e.address && st.showAddress) meta.push(esc(e.address));
    return `<tr><td style="white-space:nowrap;vertical-align:top;padding:4px 8px;border-bottom:1px solid #ddd"><b>${fTime(e.ts)}</b></td><td style="padding:4px 8px;border-bottom:1px solid #ddd">${multi && st.multiExport === 'date' ? `<span style="color:#777">[${esc(r.name)}]</span> ` : ''}<b>${esc(e.category || '')}</b>${e.category && e.text ? ' — ' : ''}${esc(e.text || '')}${!e.category && !e.text ? esc(evLine(e)) : ''}${meta.length ? `<br><small style="color:#555">${meta.join(' · ')}</small>` : ''}${e.comment && st.showComment ? `<br><i>${esc(e.comment)}</i>` : ''}${img}</td></tr>`;
  };
  const table = async rows => { let h = '', last = ''; for (const x of rows) { const k = fDate(x.e.ts); if (k !== last) { h += `<tr><td colspan="2" style="background:#eef;padding:6px 8px;font-weight:bold">${k}</td></tr>`; last = k; } h += await evRow(x); } return `<table style="width:100%;border-collapse:collapse;font-size:12pt">${h}</table>`; };
  if (multi && st.multiExport === 'cr') {
    for (const r of reports) body += `<h2>${esc(r.name)}</h2><p>Section : ${esc(sectionName(r.sectionId))} — Profil : ${esc(r.profile)}<br>${reportSpan(r)} : ${plural(r.events.length, 'évènement')}</p>` + await table(rowsFor([r]));
  } else {
    const r0 = reports[0];
    body = `<h1>${multi ? 'Comptes-rendus' : esc(r0.name)}</h1><p>${multi ? reports.map(r => esc(r.name) + ' (' + reportSpan(r) + ')').join('<br>') : `Section : ${esc(sectionName(r0.sectionId))}<br>Profil : ${esc(r0.profile)}`}<br>${esc(headerText(reports))}</p>` + await table(rowsFor(reports));
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Compte-rendu</title><style>body{font-family:Arial,sans-serif;color:#111;margin:24px}h1{font-size:20pt}h2{font-size:16pt;margin-top:28px}</style></head><body>${body}<p style="color:#888;font-size:9pt;margin-top:30px">Édité le ${fDate(Date.now())} à ${fTime(Date.now())} — ${esc(S.profile.name)}</p></body></html>`;
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
  const fmt = await sheet('Exporter', [['pdf', 'PDF'], ['csv', 'CSV (Excel)'], ['doc', 'DOC (Word)'], ['mail', 'Email (texte)']]);
  if (!fmt || !(await checkPin())) return;
  const base = (reports.length > 1 ? 'Comptes-rendus' : reports[0].name + '_' + reportSpan(reports[0])).replace(/[^\wÀ-ÿ-]+/g, '_');
  const subj = reports.length > 1 ? `Comptes-rendus (${reports.length})` : `Compte-rendu ${reports[0].name} – ${reportSpan(reports[0])}`;
  if (fmt === 'csv') shareFile(base + '.csv', 'text/csv', b64(buildCSV(reports)), subj);
  else if (fmt === 'doc') shareFile(base + '.doc', 'application/msword', b64(await buildHTML(reports, true)), subj);
  else if (fmt === 'pdf') { const h = await buildHTML(reports, true); if (NATIVE) Android.printPdf(h, base); else { const w = window.open(''); w.document.write(h); w.print(); } }
  else if (fmt === 'mail') { if (NATIVE) Android.sendEmail(S.settings.email || '', subj, textBody(reports)); else location.href = `mailto:${S.settings.email}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(textBody(reports))}`; }
}

/* ---------- Sauvegarde / restauration ---------- */
async function backup() {
  toast('Préparation de la sauvegarde…');
  const media = {}; for (const k of await allMediaKeys()) { const b = await getMedia(k); if (b) media[k] = await blobToDataURL(b); }
  const json = JSON.stringify({ app: 'CR-CSU', v: 1, date: Date.now(), state: S, media });
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
  async text() { const v = await ask('Nouvel évènement', [{ label: 'Texte', type: 'textarea' }]); if (v && v[0].trim()) newEvent({ type: 'text', text: v[0].trim() }); },
  validate() { commitDraft(); },
  cancelDraft() { if (draft && draft.mediaId) delMedia(draft.mediaId); draft = null; render(); },
  openEvent(d) { go('event', { rid: curReport().id, id: d.id }); },
  saveEvent() {
    const c = cur(); const r = S.reports.find(x => x.id === c.rid); const e = r.events.find(x => x.id === c.id);
    const ts = $('#eTs').value; if (ts) e.ts = new Date(ts).getTime();
    e.category = $('#eCat').value; e.text = $('#eText').value.trim(); e.comment = $('#eCom').value.trim();
    save(); back();
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
    S.settings[k] = !S.settings[k]; save(); render();
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
  toggleButton(d) { const i = S.buttons.indexOf(d.b); if (i >= 0) S.buttons.splice(i, 1); else if (S.buttons.length >= 9) return toast('Maximum 9 boutons'); else S.buttons.push(d.b); save(); render(); },
  async addReminder() {
    const v = await ask('Nouveau rappel', [{ label: 'Libellé', value: 'Rédiger le compte-rendu' }, { label: 'Type', type: 'select', value: 'delay', options: [['delay', 'Après un délai'], ['date', 'À une date précise']] }, { label: 'Délai en minutes (si « après un délai »)', type: 'number', value: '60' }, { label: 'Date et heure (si « date précise »)', type: 'datetime-local', value: toLocalInput(Date.now() + 3600e3) }]);
    if (!v) return;
    const at = v[1] === 'delay' ? Date.now() + Math.max(1, +v[2] || 0) * 60e3 : new Date(v[3]).getTime();
    if (!at || at <= Date.now()) return toast('Date de rappel invalide');
    const r = { id: uid(), label: v[0].trim() || 'Rappel', at }; S.reminders.push(r); save(); scheduleReminder(r); render(); toast('Rappel programmé');
  },
  delReminder(d) { if (NATIVE) Android.cancelReminder(d.id); S.reminders = S.reminders.filter(r => r.id !== d.id); save(); render(); }
};

/* ---------- Événements globaux ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t || t.closest('#modalRoot')) return;
  const fn = A[t.dataset.a]; if (fn) { e.stopPropagation(); fn(Object.assign({}, t.dataset)); }
});
document.addEventListener('input', e => { if (e.target.id === 'draftCom' && draft) draft.comment = e.target.value; });
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  if (tab === b.dataset.tab) stacks[tab] = stacks[tab].slice(0, 1); tab = b.dataset.tab; draft = null; render();
});
for (const id of ['fileGallery', 'filePhoto', 'fileVideo']) $('#' + id).onchange = e => handleFile(e.target.files[0]);
$('#fileRestore').onchange = e => e.target.files[0] && restore(e.target.files[0]);

(async () => { await load(); render(); })();
