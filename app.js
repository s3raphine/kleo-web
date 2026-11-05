/* Kleo Web — 100% local OpenPGP key manager (OpenPGP.js v5).
   Nothing is sent over the network: the CSP in index.html blocks every connection. */
'use strict';

const STORE_PRIV = 'kleo.priv';
const STORE_PUB = 'kleo.pub';
const STORE_IDLE = 'kleo.idle';
const STORE_ALIAS = 'kleo.alias';
const PREVIEW_LIMIT = 200000; // larger outputs are offered as a download only

// Vault entry: { key, armored, added, persist, unlocked, health, expires, revocation }
const vault = { priv: [], pub: [] };
const ui = { view: 'priv', selected: null };

// ---------- utilities ----------

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const ICONS = {
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/>',
  unlock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 017.7-1.5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
function svg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}
function icon(name) {
  const s = el('span', { 'data-icon': name });
  s.innerHTML = svg(name);
  return s;
}
document.querySelectorAll('[data-icon]').forEach((n) => { n.innerHTML = svg(n.dataset.icon); });

function storeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storeSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch { return false; }
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, isError ? 5000 : 2500);
}

class Cancelled extends Error {}

function errMsg(e) {
  const m = (e && e.message) || String(e);
  if (/Incorrect key passphrase|passphrase/i.test(m)) return 'Incorrect passphrase.';
  if (/Misformed armored text|Unknown ASCII armor|No key packet found/i.test(m)) return 'Invalid or incomplete PGP block.';
  if (/Session key decryption failed|No decryption key packets found|Error decrypting message/i.test(m))
    return 'Cannot decrypt: wrong key or wrong password.';
  return m.replace(/^Error [a-z ]+: /i, '');
}

async function busy(button, fn) {
  button.disabled = true;
  try { await fn(); }
  catch (e) {
    if (!(e instanceof Cancelled)) { console.error(e); toast(errMsg(e), true); }
  } finally { button.disabled = false; }
}

const fmtFpr = (fpr) => fpr.toUpperCase().match(/.{1,4}/g).join(' ');
const fmtDay = (d) => new Date(d).toISOString().slice(0, 10);
const fmtDate = (d) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function algoName(key) {
  const info = key.getAlgorithmInfo();
  if (info.curve) return info.curve === 'ed25519' ? 'ECC (Curve25519)' : `ECC (${info.curve})`;
  if (info.bits) return `RSA ${info.bits} bits`;
  return info.algorithm;
}
function uid(key) {
  const u = key.users.find((x) => x.userID)?.userID;
  // a user ID without an email (e.g. just "admin") is not split into name/email
  const raw = (u?.userID || '').replace(/<[^>]*>/, '').trim();
  return { name: u?.name || raw, email: u?.email || '' };
}

// User-chosen names, keyed by fingerprint
let aliases = {};
try { aliases = JSON.parse(storeGet(STORE_ALIAS) || '{}') || {}; } catch { aliases = {}; }

function setAlias(fpr, name) {
  if (name) aliases[fpr] = name;
  else delete aliases[fpr];
  storeSet(STORE_ALIAS, JSON.stringify(aliases));
}
function label(key) {
  const { name, email } = uid(key);
  return aliases[key.getFingerprint()] || name || email || key.getKeyID().toHex().toUpperCase();
}
function fullLabel(key) {
  const alias = aliases[key.getFingerprint()];
  const id = key.getUserIDs()[0];
  if (alias) return id ? `${alias} (${id})` : alias;
  return id || label(key);
}
function safeName(key) {
  return label(key).replace(/[^\w.@-]+/g, '_');
}

async function enrich(entry) {
  const k = entry.key;
  entry.expires = await k.getExpirationTime().catch(() => null);
  entry.health = null;
  if (await k.isRevoked().catch(() => false)) entry.health = { label: 'REVOKED', cls: 'bad', unusable: true };
  else if (entry.expires instanceof Date && entry.expires < new Date()) entry.health = { label: 'EXPIRED', cls: 'bad', unusable: true };
  else {
    try { await k.getEncryptionKey(); }
    catch { entry.health = { label: 'SIGN ONLY', cls: 'warn', unusable: true }; }
  }
  return entry;
}

function download(filename, data) {
  const type = typeof data === 'string' ? 'text/plain' : 'application/octet-stream';
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = el('textarea', {}, text);
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Copied to clipboard');
}

async function readFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder().decode(bytes.slice(0, 2048));
  return head.includes('-----BEGIN PGP')
    ? { name: file.name, bytes, armored: new TextDecoder().decode(bytes) }
    : { name: file.name, bytes };
}

function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

// Wires a .drop zone: shows the file name, highlights on drag, calls onFile(file)
function dropZone(zoneId, inputId, nameId, emptyText, onFile) {
  const zone = $(zoneId);
  const input = $(inputId);
  const nameEl = $(nameId);
  const show = (file) => {
    nameEl.replaceChildren(file ? el('strong', {}, file.name) : emptyText, file ? ` · ${fmtSize(file.size)}` : '');
  };
  input.addEventListener('change', () => { const f = input.files[0]; show(f); onFile(f || null); });
  zone.addEventListener('dragover', () => zone.classList.add('over'));
  ['dragleave', 'drop'].forEach((e) => zone.addEventListener(e, () => zone.classList.remove('over')));
  return { reset: () => { input.value = ''; show(null); onFile(null); } };
}

// Segmented control: calls onChange(value) and toggles [data-<attr>] blocks
function segmented(segId, onChange) {
  const seg = $(segId);
  seg.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    onChange(b.dataset.val);
  });
}

// ---------- modal ----------

function openModal({ title, text, body = [], ok = 'OK', okClass = 'primary', onOk }) {
  const dlg = $('modal');
  const box = $('modalBody');
  return new Promise((resolve) => {
    const okBtn = el('button', { class: `btn ${okClass}`, type: 'button' }, ok);
    const cancelBtn = el('button', { class: 'btn', type: 'button' }, 'Cancel');
    box.replaceChildren(
      el('h2', {}, title),
      text ? el('p', { class: 'muted small' }, text) : null,
      ...body,
      el('div', { class: 'modal-actions' }, cancelBtn, okBtn),
    );
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      dlg.close();
      resolve(v);
    };
    cancelBtn.onclick = () => finish(null);
    dlg.oncancel = (e) => { e.preventDefault(); finish(null); };
    okBtn.onclick = () => busy(okBtn, async () => finish((onOk ? await onOk() : true) ?? true));
    box.onkeydown = (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); okBtn.click(); }
    };
    dlg.showModal();
    box.querySelector('input:not([type=file]):not([type=checkbox]), textarea')?.focus();
  });
}

const confirmModal = (title, text, ok = 'Delete') =>
  openModal({ title, text, ok, okClass: 'danger' });

// A textarea + file picker that yields a PGP key source ({ armored } or { binary })
function keySourceFields(placeholder) {
  let binary = null;
  const area = el('textarea', { rows: 7, spellcheck: 'false', placeholder });
  area.addEventListener('input', () => { binary = null; });
  const fileInput = el('input', { type: 'file', accept: '.asc,.gpg,.key,.pgp,.txt' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    const r = await readFile(f);
    if (r.armored) { binary = null; area.value = r.armored; }
    else { binary = r.bytes; area.value = `[binary file: ${f.name}]`; }
  });
  return {
    nodes: [
      el('label', { class: 'field' }, 'PGP block', area),
      el('label', { class: 'btn file' }, icon('upload'), 'Choose a file', fileInput),
    ],
    source() {
      if (binary) return { binary };
      if (!area.value.trim()) throw new Error('Paste a key or choose a file.');
      return { armored: area.value };
    },
  };
}

// ---------- vault ----------

function save() {
  const dump = (list) => JSON.stringify(list.filter((e) => e.persist).map(({ armored, added }) => ({ armored, added })));
  const ok = storeSet(STORE_PRIV, dump(vault.priv)) && storeSet(STORE_PUB, dump(vault.pub));
  if (!ok) toast('Local storage unavailable: keys will not be kept.', true);
}

async function load() {
  for (const [kind, storeKey] of [['priv', STORE_PRIV], ['pub', STORE_PUB]]) {
    let list = [];
    try { list = JSON.parse(storeGet(storeKey) || '[]'); } catch { list = []; }
    for (const { armored, added } of list) {
      try {
        const key = kind === 'priv'
          ? await openpgp.readPrivateKey({ armoredKey: armored })
          : await openpgp.readKey({ armoredKey: armored });
        vault[kind].push(await enrich({ key, armored, added, persist: true, unlocked: null }));
      } catch (e) { console.warn('Skipped unreadable key', e); }
    }
  }
}

const byFpr = (list, fpr) => list.find((e) => e.key.getFingerprint() === fpr);
const sortEntries = (list) => [...list].sort((a, b) => label(a.key).localeCompare(label(b.key)));

async function addPriv(key, extra = {}) {
  const existing = byFpr(vault.priv, key.getFingerprint());
  if (existing) return { entry: existing, isNew: false };
  const unprotected = key.isDecrypted();
  const entry = await enrich({
    key,
    armored: extra.armored || key.armor(),
    added: new Date().toISOString(),
    // a key without a passphrase is never written to disk
    persist: !unprotected,
    unlocked: unprotected ? key : (extra.unlocked || null),
    revocation: extra.revocation || null,
  });
  vault.priv.push(entry);
  if (unprotected) toast('Private key has no passphrase: kept for this session only. Use "Change passphrase" to keep it.', true);
  return { entry, isNew: true };
}

async function addPub(key) {
  const existing = byFpr(vault.pub, key.getFingerprint());
  if (existing) {
    existing.key = await existing.key.update(key);
    existing.armored = existing.key.armor();
    await enrich(existing);
    return { entry: existing, isNew: false };
  }
  const entry = await enrich({ key, armored: key.armor(), added: new Date().toISOString(), persist: true, unlocked: null });
  vault.pub.push(entry);
  return { entry, isNew: true };
}

async function parseKeys({ armored, binary }) {
  if (binary) return openpgp.readKeys({ binaryKeys: binary });
  const blocks = armored.match(/-----BEGIN PGP (PUBLIC|PRIVATE) KEY BLOCK-----[\s\S]*?-----END PGP \1 KEY BLOCK-----/g);
  if (!blocks) throw new Error('No PGP key found.');
  const keys = [];
  for (const b of blocks) {
    if (b.includes('PRIVATE KEY BLOCK')) keys.push(...await openpgp.readPrivateKeys({ armoredKeys: b }));
    else keys.push(...await openpgp.readKeys({ armoredKeys: b }));
  }
  return keys;
}

async function importKeys(source, alias = '') {
  const keys = await parseKeys(source);
  let added = 0, updated = 0, first = null;
  for (const key of keys) {
    if (alias) setAlias(key.getFingerprint(), keys.length > 1 ? `${alias} ${keys.indexOf(key) + 1}` : alias);
    const r = key.isPrivate() ? await addPriv(key) : await addPub(key);
    if (r.isNew) added++; else updated++;
    first = first || { kind: key.isPrivate() ? 'priv' : 'pub', fpr: key.getFingerprint() };
  }
  save();
  if (first) { setView(first.kind); select(first.fpr); }
  toast(`${added} key(s) imported` + (updated ? `, ${updated} already present` : ''));
}

async function ensureUnlocked(entry, reason) {
  if (entry.unlocked) return entry.unlocked;
  const pass = el('input', { type: 'password', autocomplete: 'current-password' });
  const unlocked = await openModal({
    title: 'Unlock key',
    text: `${fullLabel(entry.key)}${reason ? ' — ' + reason : ''}`,
    body: [el('label', { class: 'field' }, 'Passphrase', pass)],
    ok: 'Unlock',
    onOk: () => openpgp.decryptKey({ privateKey: entry.key, passphrase: pass.value }),
  });
  if (!unlocked) throw new Cancelled();
  entry.unlocked = unlocked;
  resetIdle();
  render();
  return unlocked;
}

function lockEntry(entry) {
  if (entry.key.isDecrypted()) return; // unprotected key: nothing to lock
  entry.unlocked?.clearPrivateParams?.();
  entry.unlocked = null;
}
function lockAll() {
  vault.priv.forEach(lockEntry);
  render();
}

function verificationKeys() {
  return [...vault.pub.map((e) => e.key), ...oneOff.map((e) => e.key), ...vault.priv.map((e) => e.key.toPublic())];
}
function findSigner(keyID) {
  const match = (k) => k.getKeyIDs().some((id) => id.equals(keyID));
  const mine = vault.priv.find((e) => match(e.key));
  if (mine) return { key: mine.key, mine: true };
  const other = vault.pub.find((e) => match(e.key)) || oneOff.find((e) => match(e.key));
  return other ? { key: other.key, mine: false } : null;
}

// ---------- auto-lock ----------

let idleTimer;
function resetIdle() {
  clearTimeout(idleTimer);
  const minutes = Number(storeGet(STORE_IDLE) ?? 15);
  if (!minutes || !vault.priv.some((e) => e.unlocked && !e.key.isDecrypted())) return;
  idleTimer = setTimeout(() => { lockAll(); toast('Keys locked after inactivity'); }, minutes * 60000);
}
['click', 'keydown'].forEach((ev) => document.addEventListener(ev, resetIdle, true));

// ---------- navigation ----------

function setView(view) {
  ui.view = view;
  ui.selected = null;
  $('search').value = '';
  document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) =>
    v.classList.toggle('active', v.dataset.view.split(' ').includes(view)));
  document.querySelector('.shell').classList.toggle('no-detail', !isListView());
  if (view === 'encrypt') renderEncrypt();
  render();
}
const isListView = () => ui.view === 'priv' || ui.view === 'pub';

document.querySelectorAll('.nav').forEach((n) => n.addEventListener('click', () => setView(n.dataset.view)));

function select(fpr) {
  ui.selected = fpr;
  document.querySelector('.shell').classList.toggle('show-detail', !!fpr);
  render();
}

// ---------- rendering ----------

function render() {
  $('countPriv').textContent = vault.priv.length;
  $('countPub').textContent = vault.pub.length;
  const open = vault.priv.filter((e) => e.unlocked).length;
  $('lockState').textContent = open ? `${open} key(s) unlocked` : 'All keys are locked';
  if (isListView()) { renderList(); renderDetail(); }
}

function statusOf(entry, kind) {
  if (entry.health) return entry.health;
  if (kind === 'pub') return { label: 'VALID', cls: 'ok' };
  if (entry.key.isDecrypted()) return { label: 'SESSION', cls: 'warn' };
  return entry.unlocked ? { label: 'UNLOCKED', cls: 'accent' } : { label: 'LOCAL', cls: '' };
}

function renderList() {
  const kind = ui.view;
  const q = $('search').value.trim().toLowerCase();
  const rows = sortEntries(vault[kind]).filter((e) => !q ||
    fullLabel(e.key).toLowerCase().includes(q) ||
    e.key.getFingerprint().includes(q.replace(/\s/g, '')));

  $('keyRows').replaceChildren(...rows.map((e) => {
    const fpr = e.key.getFingerprint();
    const st = statusOf(e, kind);
    return el('tr', { class: fpr === ui.selected ? 'selected' : '', onclick: () => select(fpr) },
      el('td', { class: 'name' }, el('span', {}, icon(kind === 'priv' ? 'key' : 'users'), label(e.key))),
      el('td', { class: 'ident' }, uid(e.key).email || e.key.getKeyID().toHex().toUpperCase()),
      el('td', {}, kind === 'priv' ? 'Private key' : 'Public key'),
      el('td', {}, fmtDay(e.added)),
      el('td', {}, el('span', { class: `status ${st.cls}` }, st.label)));
  }));

  const empty = $('emptyList');
  empty.classList.toggle('hidden', rows.length > 0);
  if (!rows.length) {
    empty.replaceChildren(
      q ? 'No results.'
        : kind === 'priv' ? 'No private keys. Import yours or create a new one.'
          : 'No public keys. Import your contacts\' keys to write to them and verify their signatures.',
      q ? null : el('div', {}, el('button', { class: 'btn primary', onclick: kind === 'priv' ? newKey : importDialog },
        icon(kind === 'priv' ? 'plus' : 'upload'), kind === 'priv' ? 'New key' : 'Import a key')));
  }
}

function renderDetail() {
  const kind = ui.view;
  const entry = ui.selected && byFpr(vault[kind], ui.selected);
  const pane = $('detail');
  if (!entry) {
    document.querySelector('.shell').classList.remove('show-detail');
    pane.replaceChildren(el('div', { class: 'detail-empty' },
      el('div', { class: 'tile' }, icon('key')),
      el('div', {}, 'Select a key to see its details here.')));
    return;
  }
  const k = entry.key;
  const st = statusOf(entry, kind);
  const prop = (name, value, cls) => el('div', {}, el('dt', {}, name), el('dd', { class: cls || '' }, value));
  const btn = (ic, text, onclick, cls = '') => el('button', { class: `btn ${cls}`, onclick }, icon(ic), text);
  const group = (title) => el('div', { class: 'group-label' }, title);
  const pubArmor = kind === 'priv' ? k.toPublic().armor() : entry.armored;

  const actions = [group('Use')];
  if (kind === 'priv') {
    if (!k.isDecrypted()) {
      actions.push(entry.unlocked
        ? btn('lock', 'Lock', () => { lockEntry(entry); render(); })
        : btn('unlock', 'Unlock', (ev) => busy(ev.currentTarget, () => ensureUnlocked(entry)), 'primary'));
    }
    actions.push(btn('pen', 'Sign / encrypt with this key', () => useKey(k.getFingerprint())));
  } else {
    actions.push(btn('mail', 'Encrypt for this contact', () => sendTo(k.getFingerprint()), 'primary'));
  }
  actions.push(group('Share'),
    btn('copy', 'Copy public key', () => copy(pubArmor)),
    btn('download', 'Export public key', () => download(`${safeName(k)}_public.asc`, pubArmor)));
  if (kind === 'priv') {
    actions.push(btn('download', 'Back up private key', () => download(`${safeName(k)}_SECRET.asc`, entry.armored)));
    if (entry.revocation) {
      actions.push(btn('download', 'Revocation certificate', () => download(`${safeName(k)}_revocation.asc`, entry.revocation)));
    }
  }
  actions.push(group('Manage'), btn('pen', 'Rename', () => renameEntry(entry)));
  if (kind === 'priv') {
    actions.push(btn('key', k.isDecrypted() ? 'Set a passphrase' : 'Change passphrase', () => changePassphrase(entry)));
  }
  actions.push(btn('trash', 'Delete', () => removeEntry(kind, entry), 'danger'));

  pane.replaceChildren(
    el('div', { class: 'detail-head' },
      el('div', { class: 'tile' }, icon(kind === 'priv' ? 'key' : 'users')),
      el('div', {},
        el('h2', {}, label(k)),
        el('div', { class: 'sub' }, uid(k).email))),
    el('dl', { class: 'props' },
      prop('Status', el('span', { class: `status ${st.cls}` }, st.label)),
      prop('Identity in key', k.getUserIDs()[0] || '(none)'),
      prop('Fingerprint', fmtFpr(k.getFingerprint()), 'mono'),
      prop('Key ID', k.getKeyID().toHex().toUpperCase(), 'mono'),
      prop('Algorithm', algoName(k)),
      prop('Created', fmtDate(k.getCreationTime())),
      prop('Expires', entry.expires instanceof Date ? fmtDate(entry.expires) : 'Never'),
      k.getUserIDs().length > 1 ? prop('Identities', el('div', {}, k.getUserIDs().map((u) => el('div', {}, u)))) : null),
    el('div', { class: 'detail-actions' }, actions));
}

async function renameEntry(entry) {
  const fpr = entry.key.getFingerprint();
  const input = el('input', { type: 'text', value: aliases[fpr] || '', placeholder: label(entry.key) });
  const ok = await openModal({
    title: 'Rename key',
    text: 'This name is only for you; it is not written into the key. Leave empty to go back to the original name.',
    body: [el('label', { class: 'field' }, 'Name', input)],
    ok: 'Save',
  });
  if (!ok) return;
  setAlias(fpr, input.value.trim());
  render();
  renderEncrypt();
}

async function changePassphrase(entry) {
  const unprotected = entry.key.isDecrypted();
  const current = el('input', { type: 'password', autocomplete: 'current-password' });
  const next = el('input', { type: 'password', autocomplete: 'new-password' });
  const next2 = el('input', { type: 'password', autocomplete: 'new-password' });
  const ok = await openModal({
    title: unprotected ? 'Set a passphrase' : 'Change passphrase',
    text: fullLabel(entry.key),
    body: [
      unprotected ? null : el('label', { class: 'field' }, 'Current passphrase', current),
      el('div', { class: 'grid2' },
        el('label', { class: 'field' }, 'New passphrase', next),
        el('label', { class: 'field' }, 'Confirm', next2)),
    ],
    ok: 'Save',
    onOk: async () => {
      if (next.value.length < 8) throw new Error('Passphrase too short (8 characters minimum).');
      if (next.value !== next2.value) throw new Error('Passphrases do not match.');
      const decrypted = unprotected
        ? entry.key
        : await openpgp.decryptKey({ privateKey: entry.key, passphrase: current.value });
      const encrypted = await openpgp.encryptKey({ privateKey: decrypted, passphrase: next.value });
      entry.armored = encrypted.armor();
      entry.key = await openpgp.readPrivateKey({ armoredKey: entry.armored });
      entry.unlocked = decrypted;
      entry.persist = true;
    },
  });
  if (!ok) return;
  save();
  render();
  toast('Passphrase updated. Make a new backup of this key.');
}

async function removeEntry(kind, entry) {
  const what = kind === 'priv' ? 'private key' : 'public key';
  const warn = kind === 'priv' ? ' Without a backup, you will no longer be able to decrypt messages sent to it.' : '';
  if (!await confirmModal(`Delete ${what}?`, `${fullLabel(entry.key)}.${warn}`)) return;
  lockEntry(entry);
  vault[kind] = vault[kind].filter((e) => e !== entry);
  if (!byFpr(vault.priv, entry.key.getFingerprint()) && !byFpr(vault.pub, entry.key.getFingerprint())) {
    setAlias(entry.key.getFingerprint(), null);
  }
  save();
  select(null);
  renderEncrypt();
}

$('search').addEventListener('input', renderList);

// ---------- new key / import ----------

function newKey() {
  const name = el('input', { type: 'text', autocomplete: 'name' });
  const email = el('input', { type: 'email', autocomplete: 'email' });
  const type = el('select', {},
    el('option', { value: 'ecc' }, 'ECC Curve25519 (recommended)'),
    el('option', { value: 'rsa' }, 'RSA 4096 bits'));
  const expiry = el('select', {},
    el('option', { value: '0' }, 'Never'),
    el('option', { value: '1' }, '1 year'),
    el('option', { value: '2' }, '2 years'),
    el('option', { value: '5' }, '5 years'));
  const pass = el('input', { type: 'password', autocomplete: 'new-password' });
  const pass2 = el('input', { type: 'password', autocomplete: 'new-password' });
  return openModal({
    title: 'New key pair',
    text: 'The private key will be protected by your passphrase. Pick a long one you will not forget.',
    body: [
      el('div', { class: 'grid2' },
        el('label', { class: 'field' }, 'Name', name),
        el('label', { class: 'field' }, 'Email', email)),
      el('div', { class: 'grid2' },
        el('label', { class: 'field' }, 'Key type', type),
        el('label', { class: 'field' }, 'Expires', expiry)),
      el('div', { class: 'grid2' },
        el('label', { class: 'field' }, 'Passphrase', pass),
        el('label', { class: 'field' }, 'Confirm', pass2)),
    ],
    ok: 'Generate',
    onOk: async () => {
      const userID = {};
      if (name.value.trim()) userID.name = name.value.trim();
      if (email.value.trim()) userID.email = email.value.trim();
      if (!userID.name && !userID.email) throw new Error('Enter at least a name or an email.');
      if (pass.value.length < 8) throw new Error('Passphrase too short (8 characters minimum).');
      if (pass.value !== pass2.value) throw new Error('Passphrases do not match.');
      const opts = type.value === 'rsa' ? { type: 'rsa', rsaBits: 4096 } : { type: 'ecc', curve: 'curve25519' };
      const { privateKey, revocationCertificate } = await openpgp.generateKey({
        ...opts,
        userIDs: [userID],
        passphrase: pass.value,
        keyExpirationTime: Number(expiry.value) * 365 * 24 * 3600,
        format: 'armored',
      });
      const key = await openpgp.readPrivateKey({ armoredKey: privateKey });
      const unlocked = await openpgp.decryptKey({ privateKey: key, passphrase: pass.value });
      const { entry } = await addPriv(key, { armored: privateKey, unlocked, revocation: revocationCertificate });
      save();
      setView('priv');
      select(entry.key.getFingerprint());
      resetIdle();
      toast('Key created. Remember to back it up ("Back up private key" button).');
    },
  });
}

function importDialog() {
  const aliasInput = el('input', { type: 'text', placeholder: 'e.g. Karim, Server admin… (optional)' });
  const src = keySourceFields('-----BEGIN PGP PUBLIC KEY BLOCK-----\n…\nor\n-----BEGIN PGP PRIVATE KEY BLOCK-----');
  return openModal({
    title: 'Import keys',
    text: 'A private key (yours) or a public key (a contact\'s). The type is detected automatically.',
    body: [el('label', { class: 'field' }, 'Name (so you know who it is)', aliasInput), ...src.nodes],
    ok: 'Import',
    onOk: () => importKeys(src.source(), aliasInput.value.trim()),
  });
}

$('newKeyBtn').addEventListener('click', newKey);
$('importBtn').addEventListener('click', importDialog);

// ---------- encrypt / sign ----------

const enc = { input: 'text', action: 'encrypt', file: null };
let oneOff = []; // public keys pasted for a single use, not saved: [{ key, health }]

dropZone('encDrop', 'encFile', 'encFileName', 'Click or drop a file here', (f) => { enc.file = f; updateEncryptForm(); });
segmented('encInputSeg', (v) => {
  enc.input = v;
  document.querySelectorAll('[data-enc-input]').forEach((n) => n.classList.toggle('hidden', n.dataset.encInput !== v));
  updateEncryptForm();
});
segmented('encActionSeg', (v) => { enc.action = v; updateEncryptForm(); });

function updateEncryptForm() {
  const isFile = enc.input === 'file';
  const encrypting = enc.action === 'encrypt';
  document.querySelectorAll('[data-view=encrypt] [data-only]').forEach((n) =>
    n.classList.toggle('hidden', n.dataset.only !== enc.action));
  $('outStep').textContent = encrypting ? '4' : '3';
  $('armorRow').classList.toggle('hidden', !isFile);
  $('detachedRow').classList.toggle('hidden', encrypting || isFile);
  $('encPassword').classList.toggle('hidden', !$('usePassword').checked);
  const sign = !encrypting || $('doSign').checked;
  $('runEncryptLabel').textContent = encrypting ? (sign ? 'Encrypt & sign' : 'Encrypt') : 'Sign';

  let summary = '';
  if (encrypting) {
    const n = checkedRecipients().length + ($('encToSelf').checked && $('signer').value ? 1 : 0);
    const parts = [];
    if (n) parts.push(`${n} recipient${n > 1 ? 's' : ''}`);
    if ($('usePassword').checked) parts.push('password');
    summary = parts.length ? `For: ${parts.join(' + ')}` : 'No recipient selected yet';
  } else if (isFile) {
    summary = 'Creates a separate signature file (.sig / .asc)';
  }
  $('encSummary').textContent = summary;
}
['doSign', 'encToSelf', 'usePassword', 'signer'].forEach((id) => $(id).addEventListener('change', updateEncryptForm));
$('recipList').addEventListener('change', updateEncryptForm);

function renderEncrypt() {
  const signer = $('signer');
  const prev = signer.value;
  signer.replaceChildren(
    vault.priv.length ? null : el('option', { value: '' }, '— No private key yet —'),
    ...sortEntries(vault.priv).map((e) => el('option', { value: e.key.getFingerprint() }, fullLabel(e.key))));
  const fallback = vault.priv.find((e) => e.unlocked) || sortEntries(vault.priv)[0];
  signer.value = byFpr(vault.priv, prev) ? prev : (fallback ? fallback.key.getFingerprint() : '');
  renderRecipients();
  updateEncryptForm();
}

function recipientPool() {
  const saved = vault.pub.map((e) => ({ ...e, temp: false }));
  const temp = oneOff.filter((o) => !byFpr(vault.pub, o.key.getFingerprint())).map((o) => ({ ...o, temp: true }));
  return [...sortEntries(saved), ...temp];
}
function checkedRecipients() {
  return [...document.querySelectorAll('#recipList input:checked')].map((i) => i.value);
}

function renderRecipients() {
  const q = $('recipFilter').value.trim().toLowerCase();
  const box = $('recipList');
  const checked = new Set(checkedRecipients());
  const pool = recipientPool();
  if (!pool.length) {
    box.replaceChildren(el('div', { class: 'none' },
      'No public keys yet. Click "Use someone\'s public key" to paste the key of the person you are writing to.'));
    return;
  }
  const shown = pool.filter((e) => !q || fullLabel(e.key).toLowerCase().includes(q) || checked.has(e.key.getFingerprint()));
  box.replaceChildren(...shown.map((e) => {
    const fpr = e.key.getFingerprint();
    return el('label', { class: 'check' },
      el('input', { type: 'checkbox', value: fpr, checked: checked.has(fpr), disabled: !!e.health?.unusable }),
      el('span', {}, fullLabel(e.key),
        e.temp ? el('span', { class: 'tag' }, 'not saved') : null,
        e.health?.unusable ? el('span', { class: 'tag' }, e.health.label.toLowerCase()) : null,
        el('br'), el('span', { class: 'kid' }, e.key.getKeyID().toHex().toUpperCase())));
  }));
}
$('recipFilter').addEventListener('input', renderRecipients);

$('pasteRecip').addEventListener('click', async () => {
  const src = keySourceFields('-----BEGIN PGP PUBLIC KEY BLOCK-----');
  const keep = el('input', { type: 'checkbox', checked: true });
  const aliasInput = el('input', { type: 'text', placeholder: 'e.g. Karim (optional)' });
  const added = await openModal({
    title: 'Encrypt for someone',
    text: 'Paste the public key of the person you are writing to (they can send it to you, it is not secret).',
    body: [
      el('label', { class: 'field' }, 'Name (so you know who it is)', aliasInput),
      ...src.nodes,
      el('label', { class: 'check' }, keep, 'Save this key in my Public Keys'),
    ],
    ok: 'Add recipient',
    onOk: async () => {
      const keys = (await parseKeys(src.source())).map((k) => (k.isPrivate() ? k.toPublic() : k));
      const fprs = [];
      for (const key of keys) {
        if (aliasInput.value.trim()) setAlias(key.getFingerprint(), aliasInput.value.trim());
        if (keep.checked) {
          await addPub(key);
        } else if (!oneOff.some((o) => o.key.getFingerprint() === key.getFingerprint())) {
          oneOff.push(await enrich({ key }));
        }
        fprs.push(key.getFingerprint());
      }
      if (keep.checked) save();
      return fprs;
    },
  });
  if (!added) return;
  $('recipFilter').value = '';
  render();
  renderRecipients();
  document.querySelectorAll('#recipList input').forEach((cb) => { if (added.includes(cb.value) && !cb.disabled) cb.checked = true; });
  updateEncryptForm();
  toast(`${added.length} recipient(s) added`);
});

function sendTo(fpr) {
  setView('encrypt');
  $('encActionSeg').querySelector('[data-val=encrypt]').click();
  $('recipFilter').value = '';
  renderRecipients();
  document.querySelectorAll('#recipList input').forEach((cb) => { cb.checked = cb.value === fpr; });
  updateEncryptForm();
  $('encInput').focus();
}
function useKey(fpr) {
  setView('encrypt');
  $('signer').value = fpr;
  updateEncryptForm();
}

let encResult = null; // { data, filename }

$('runEncrypt').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
  const isFile = enc.input === 'file';
  const text = $('encInput').value;
  if (isFile && !enc.file) throw new Error('Choose a file first.');
  if (!isFile && !text) throw new Error('The message is empty.');
  const bytes = isFile ? new Uint8Array(await enc.file.arrayBuffer()) : null;
  const baseName = isFile ? enc.file.name : 'message';
  const armor = !isFile || $('armor').checked;
  const format = armor ? 'armored' : 'binary';

  const myEntry = byFpr(vault.priv, $('signer').value);
  const encrypting = enc.action === 'encrypt';
  const wantSign = !encrypting || $('doSign').checked;
  if (wantSign && !myEntry) throw new Error('You need a private key to sign. Create or import one, or uncheck "Sign".');
  const signingKey = wantSign ? await ensureUnlocked(myEntry, 'Required to sign.') : undefined;

  let data, filename, title;
  if (encrypting) {
    const pool = recipientPool();
    const keys = checkedRecipients().map((fpr) => pool.find((e) => e.key.getFingerprint() === fpr).key);
    if ($('encToSelf').checked && myEntry) keys.push(myEntry.key.toPublic());
    const password = $('usePassword').checked ? $('encPassword').value : '';
    if ($('usePassword').checked && !password) throw new Error('Enter the password, or uncheck "Also protect with a password".');
    if (!keys.length && !password) throw new Error('Pick at least one recipient (or use a password).');
    const message = isFile
      ? await openpgp.createMessage({ binary: bytes, filename: enc.file.name })
      : await openpgp.createMessage({ text });
    data = await openpgp.encrypt({
      message,
      encryptionKeys: keys.length ? keys : undefined,
      passwords: password ? [password] : undefined,
      signingKeys: signingKey,
      format,
    });
    filename = `${baseName}.${armor ? 'asc' : 'gpg'}`;
    title = signingKey ? 'Encrypted & signed' : 'Encrypted';
  } else if (!isFile && !$('detached').checked) {
    data = await openpgp.sign({ message: await openpgp.createCleartextMessage({ text }), signingKeys: signingKey });
    filename = 'message.asc';
    title = 'Signed message';
  } else {
    const message = isFile ? await openpgp.createMessage({ binary: bytes }) : await openpgp.createMessage({ text });
    data = await openpgp.sign({ message, signingKeys: signingKey, detached: true, format });
    filename = isFile ? `${baseName}.${armor ? 'asc' : 'sig'}` : 'signature.asc';
    title = 'Detached signature';
  }
  showEncResult(data, filename, title);
}));

function showEncResult(data, filename, title) {
  encResult = { data, filename };
  const isText = typeof data === 'string';
  const showText = isText && data.length <= PREVIEW_LIMIT;
  $('encOutTitle').textContent = title;
  $('encOutput').value = showText ? data : '';
  $('encOutput').classList.toggle('hidden', !showText);
  $('copyEnc').classList.toggle('hidden', !showText);
  $('encFileOut').classList.toggle('hidden', showText);
  $('encFileOut').replaceChildren(el('strong', {}, filename), ` · ${fmtSize(isText ? data.length : data.byteLength)} — use Download to save it.`);
  $('encOutBox').classList.remove('hidden');
  $('encOutBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('copyEnc').addEventListener('click', () => copy($('encOutput').value));
$('saveEnc').addEventListener('click', () => encResult && download(encResult.filename, encResult.data));

// ---------- decrypt / verify ----------

const dec = { input: 'text', file: null, dataFile: null };
let decResult = null; // { bytes, filename }

dropZone('decDrop', 'decFile', 'decFileName', 'Encrypted or signed file (.gpg, .asc, .pgp, .sig)', (f) => { dec.file = f; });
dropZone('decDataDrop', 'decDataFile', 'decDataName', 'Original file (optional)', (f) => { dec.dataFile = f; });
segmented('decInputSeg', (v) => {
  dec.input = v;
  document.querySelectorAll('[data-dec-input]').forEach((n) => n.classList.toggle('hidden', n.dataset.decInput !== v));
});

async function renderSignatures(signatures) {
  const box = $('sigResults');
  if (!signatures || !signatures.length) {
    box.replaceChildren(el('div', { class: 'sig warn' }, '⚠ Not signed: the sender cannot be verified.'));
    return;
  }
  const nodes = await Promise.all(signatures.map(async (s) => {
    const signer = findSigner(s.keyID);
    let created = null;
    try { created = (await s.signature).packets[0].created; } catch { /* no date */ }
    const when = created ? ` on ${created.toLocaleString('en-US')}` : '';
    if (!signer) {
      return el('div', { class: 'sig warn' },
        `⚠ Signed${when} by an unknown key (ID ${s.keyID.toHex().toUpperCase()}). Import the sender's public key to verify.`);
    }
    try {
      await s.verified;
      return el('div', { class: 'sig ok' },
        el('div', {}, '✔ Good signature from ', el('strong', {}, fullLabel(signer.key)), signer.mine ? ' (you)' : '', when),
        el('div', { class: 'fpr' }, fmtFpr(signer.key.getFingerprint())));
    } catch (e) {
      return el('div', { class: 'sig bad' },
        el('div', {}, '✖ BAD signature claiming to be from ', el('strong', {}, fullLabel(signer.key))),
        el('div', { class: 'small' }, errMsg(e)));
    }
  }));
  box.replaceChildren(...nodes);
}

function showDecResult(bytes, filename) {
  decResult = bytes ? { bytes, filename } : null;
  const text = bytes ? decodeText(bytes) : null;
  const showText = text != null && text.length <= PREVIEW_LIMIT && !(dec.input === 'file' && !/\.(txt|asc|md)$/i.test(filename || ''));
  $('decOutput').value = showText ? text : '';
  $('decOutput').classList.toggle('hidden', !showText);
  $('copyDec').classList.toggle('hidden', !showText);
  $('saveDec').classList.toggle('hidden', !bytes);
  $('decFileOut').classList.toggle('hidden', !bytes || showText);
  if (bytes) $('decFileOut').replaceChildren(el('strong', {}, filename), ` · ${fmtSize(bytes.length)} — use Download to save it.`);
  $('decOutBox').classList.remove('hidden');
  $('decOutBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function outputName(inputName, embedded) {
  if (embedded && embedded !== 'msg.txt') return embedded;
  if (!inputName) return 'message.txt';
  return inputName.replace(/\.(gpg|pgp|asc)$/i, '') || 'decrypted';
}

$('runDecrypt').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
  $('sigResults').replaceChildren();
  $('decOutBox').classList.add('hidden');
  const isFile = dec.input === 'file';

  let armored = null, binary = null, inputName = null, signedData = null;
  if (isFile) {
    if (!dec.file) throw new Error('Choose a file first.');
    const r = await readFile(dec.file);
    inputName = r.name;
    if (r.armored) armored = r.armored.trim(); else binary = r.bytes;
    if (dec.dataFile) signedData = new Uint8Array(await dec.dataFile.arrayBuffer());
  } else {
    armored = $('decInput').value.trim();
    if (!armored) throw new Error('Paste a PGP message or switch to "File".');
    if ($('detachedText').value) signedData = $('detachedText').value;
  }

  if (armored && /-----BEGIN PGP (PUBLIC|PRIVATE) KEY BLOCK-----/.test(armored)) {
    if (await openModal({ title: 'This is a key, not a message', text: 'Import it into your vault?', ok: 'Import' })) {
      await importKeys({ armored });
      $('decInput').value = '';
    }
    return;
  }

  if (armored && armored.includes('-----BEGIN PGP SIGNED MESSAGE-----')) {
    const message = await openpgp.readCleartextMessage({ cleartextMessage: armored });
    const { data, signatures } = await openpgp.verify({ message, verificationKeys: verificationKeys() });
    await renderSignatures(signatures);
    showDecResult(new TextEncoder().encode(data), outputName(inputName));
    return;
  }

  const isDetached = armored ? armored.includes('-----BEGIN PGP SIGNATURE-----') : (signedData != null || /\.sig$/i.test(inputName));
  if (isDetached) {
    if (signedData == null) {
      if (!isFile) { $('detachedBox').open = true; $('detachedText').focus(); }
      throw new Error(isFile
        ? 'This is a detached signature: also choose the original file.'
        : 'This is a detached signature: paste the original text below.');
    }
    const { signatures } = await openpgp.verify({
      message: typeof signedData === 'string'
        ? await openpgp.createMessage({ text: signedData })
        : await openpgp.createMessage({ binary: signedData }),
      signature: armored
        ? await openpgp.readSignature({ armoredSignature: armored })
        : await openpgp.readSignature({ binarySignature: binary }),
      verificationKeys: verificationKeys(),
    });
    await renderSignatures(signatures);
    showDecResult(null);
    return;
  }

  const message = armored
    ? await openpgp.readMessage({ armoredMessage: armored })
    : await openpgp.readMessage({ binaryMessage: binary });

  const pkeskIDs = message.getEncryptionKeyIDs();
  const hasPassword = message.packets.filterByTag(openpgp.enums.packet.symEncryptedSessionKey).length > 0;
  const opts = { message, verificationKeys: verificationKeys(), format: 'binary' };

  if (!pkeskIDs.length && !hasPassword) {
    // signed but not encrypted
    const { data, signatures } = await openpgp.verify(opts);
    await renderSignatures(signatures);
    showDecResult(data, outputName(inputName, message.getFilename?.()));
    return;
  }

  const anonymous = pkeskIDs.some((id) => id.isWildcard());
  const candidates = anonymous ? vault.priv
    : vault.priv.filter((e) => e.key.getKeyIDs().some((k) => pkeskIDs.some((id) => id.equals(k))));

  if (candidates.length) {
    if (!candidates.some((e) => e.unlocked)) await ensureUnlocked(candidates[0], 'Required to decrypt this message.');
    opts.decryptionKeys = candidates.filter((e) => e.unlocked).map((e) => e.unlocked);
  } else if (hasPassword) {
    const pw = el('input', { type: 'password' });
    const ok = await openModal({ title: 'Password-protected message', body: [el('label', { class: 'field' }, 'Password', pw)], ok: 'Decrypt' });
    if (!ok) return;
    opts.passwords = [pw.value];
  } else {
    const ids = pkeskIDs.map((id) => {
      const s = findSigner(id);
      return s ? label(s.key) : id.toHex().toUpperCase();
    });
    throw new Error(`This message is not encrypted for any of your keys. Recipients: ${ids.join(', ')}`);
  }
  const { data, signatures, filename } = await openpgp.decrypt(opts);
  await renderSignatures(signatures);
  showDecResult(data, outputName(inputName, filename));
}));

$('copyDec').addEventListener('click', () => copy($('decOutput').value));
$('saveDec').addEventListener('click', () => decResult && download(decResult.filename, decResult.bytes));

// ---------- settings ----------

$('idleSetting').value = storeGet(STORE_IDLE) ?? '15';
$('idleSetting').addEventListener('change', (ev) => { storeSet(STORE_IDLE, ev.target.value); resetIdle(); });
$('lockAll').addEventListener('click', () => { lockAll(); toast('All keys are locked'); });
$('backupAll').addEventListener('click', () => {
  if (!vault.priv.length && !vault.pub.length) return toast('The vault is empty.', true);
  const all = [...vault.priv.map((e) => e.armored), ...vault.pub.map((e) => e.armored)].join('\n');
  download(`kleo-backup-${fmtDay(new Date())}.asc`, all);
});
$('wipeAll').addEventListener('click', async () => {
  if (!await confirmModal('Erase everything?', 'Every private and public key in this browser will be deleted. Make a backup first.', 'Erase everything')) return;
  vault.priv.forEach(lockEntry);
  vault.priv = [];
  vault.pub = [];
  oneOff = [];
  storeSet(STORE_PRIV, null);
  storeSet(STORE_PUB, null);
  aliases = {};
  storeSet(STORE_ALIAS, null);
  setView('priv');
  toast('Vault erased');
});

// ---------- startup ----------

(async () => {
  if (typeof openpgp === 'undefined') {
    document.body.replaceChildren(el('p', { class: 'view tool active' }, 'Error: lib/openpgp.min.js not found.'));
    return;
  }
  await load();
  setView('priv');
})();
