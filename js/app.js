/* Kwebbel – de app. */
(function (G) {
'use strict';
const VERSION = '1.0.0';
const LIVE_URL = 'https://kmhkasper-boop.github.io/kwebbel/';
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DB = G.KDB, KC = G.KC, KL = G.KLink, KM = G.KMedia;
const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐯', '🐨', '🐵', '🦄', '🐙', '🐢', '🐬', '🐝', '🐰', '🐶', '🐱', '🐧', '🦉', '🐞', '🦖', '🐳', '🦋', '🐹', '🦒', '🐘', '🤖', '👾', '⚽', '🌈', '👩', '👨'];
const COLORS = ['#FFD23F', '#FF9F1C', '#FF5D8F', '#B388FF', '#6C4CF1', '#3A86FF', '#2EC4B6', '#7AE582', '#FFB4A2', '#A0C4FF'];
const EMOJI = ['😀', '😂', '🤣', '😊', '😍', '🥰', '😎', '🤩', '😜', '🤪', '😇', '🥳', '😮', '😢', '😭', '😡', '🤔', '🙈', '👍', '👎', '👏', '🙌', '👋', '🤞', '✌️', '💪', '❤️', '💜', '💙', '💚', '⭐', '✨', '🔥', '🎉', '🎈', '🎁', '🍕', '🍦', '🍩', '🍫', '⚽', '🏀', '🎮', '🎨', '🎵', '📚', '🐶', '🐱', '🦄', '🦖', '🌈', '☀️', '🌙', '❄️', '🚀', '🚲', '🏠', '🏫', '😴', '💩', '👻', '🤖', '👀', '✅'];
const MAX_COPY = 50 * 1024 * 1024;

const S = { me: null, settings: {}, contacts: new Map(), sess: new Map(), rx: new Map(), view: 'home', chat: null, urls: new Map(), fp: null };
G.KW = { S, version: VERSION };

/* ---------- kleine hulpjes ---------- */
function toast(msg, ms, action) {
  (G.KW.toasts = G.KW.toasts || []).push(msg); const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = `<span>${msg}</span>`;
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { t.remove(); action.fn(); }; t.appendChild(b); }
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), ms || 2800);
}
function sheet(html, opts) {
  opts = opts || {};
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet ${opts.cls || ''}">${opts.noClose ? '' : '<button class="x" data-close aria-label="Sluiten">✕</button>'}${html}</div>`;
  document.body.appendChild(bg);
  const sh = bg.firstElementChild; sh.bg = bg;
  sh.close = () => { if (!bg.isConnected) return; bg.remove(); opts.onClose && opts.onClose(); };
  bg.addEventListener('click', (e) => { if (e.target === bg && !opts.modal) sh.close(); if (e.target.closest('[data-close]')) sh.close(); });
  sh.set = (h) => { sh.innerHTML = (opts.noClose ? '' : '<button class="x" data-close aria-label="Sluiten">✕</button>') + h; };
  return sh;
}
const closeSheets = () => $$('.sheet-bg').forEach((b) => b.firstElementChild.close ? b.firstElementChild.close() : b.remove());
function av(c, cls, dot) { c = c || {}; return `<span class="av ${cls || ''}" style="background:${esc(c.color || '#FFD23F')}">${esc(c.avatar || '🙂')}${dot === undefined ? '' : `<i class="dot ${dot ? 'on' : ''}"></i>`}</span>`; }
const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' kB' : n < 1073741824 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : (n / 1073741824).toFixed(2).replace('.', ',') + ' GB';
const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const hhmm = (ts) => new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
function dayLabel(ts) { const d = new Date(ts), n = new Date(); const y = new Date(); y.setDate(n.getDate() - 1); if (d.toDateString() === n.toDateString()) return 'Vandaag'; if (d.toDateString() === y.toDateString()) return 'Gisteren'; return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }); }
const uid = () => KC.b64u(KC.rnd(9));
const isKid = () => S.me && S.me.role === 'kid';
const online = (id) => { const s = S.sess.get(id); return !!(s && s.ready && !s.closed); };
const parents = () => [...S.contacts.values()].filter((c) => c.role === 'parent');
const children = () => [...S.contacts.values()].filter((c) => c.role === 'child');
async function saveSettings() { await DB.put('kv', S.settings, 'settings'); }
async function saveContact(c) { S.contacts.set(c.id, c); await DB.put('contacts', c); }
const kindOf = (type) => /^image\//.test(type) ? 'photo' : /^video\//.test(type) ? 'video' : 'file';
function onlyEmoji(t) { const s = String(t || '').trim(); if (!s || s.length > 16) return false; try { return /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u.test(s) && !/^[\d#*\s]+$/.test(s); } catch (e) { return false; } }

/* ---------- opstarten ---------- */
async function boot() {
  const me = await DB.get('kv', 'me');
  S.settings = Object.assign({ wake: true, sound: true, copyFiles: true }, (await DB.get('kv', 'settings')) || {});
  if (!me) return showSetup();
  S.me = me; S.prof = (await DB.get('kv', 'prof')) || {};
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  (await DB.all('contacts')).forEach((c) => S.contacts.set(c.id, c));
  S.fp = await KL.myFp();
  for (const m of await DB.all('msgs')) if (m.status === 'receiving') { m.status = 'failed'; await DB.put('msgs', m); }
  show('home');
}
function show(v) {
  S.view = v; $$('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== v));
  if (v === 'home') renderHome();
}

/* ---------- eerste keer instellen ---------- */
function showSetup() {
  const el = $('#setup'); show('setup');
  const st = { step: 0, role: null, name: '', avatar: '🦊', color: COLORS[0] };
  const dots = (n) => `<div class="steps-dots">${[0, 1, 2, 3].map((i) => `<i class="${i === n ? 'on' : ''}"></i>`).join('')}</div>`;
  const r = () => {
    if (st.step === 0) el.innerHTML = `<div class="setup-card"><img class="logo" src="icons/icon-192.png" alt=""><h1>Welkom bij Kwebbel!</h1>
      <p>Kletsen, foto's en spraakberichtjes sturen naar je vriendjes. <b>Op hetzelfde wifi, zonder internet</b> en helemaal geheim versleuteld.</p>
      <p class="muted">Wie gaat dit apparaat gebruiken?</p>
      <div class="role-pick"><button data-role="kid"><span>🧒</span><div><b>Een kind</b><small>Kletsen met vriendjes. Papa of mama kiest een pincode.</small></div></button>
      <button data-role="parent"><span>🧑</span><div><b>Een ouder</b><small>Kletsen met je kind, en (als je wilt) meelezen met de gesprekken van je kind.</small></div></button></div>${dots(0)}</div>`;
    if (st.step === 1) el.innerHTML = `<div class="setup-card"><div style="font-size:64px">${st.role === 'kid' ? '🧒' : '🧑'}</div><h1>Hoe heet je?</h1>
      <p class="muted">Deze naam zien je vriendjes.</p><input class="field" id="suName" maxlength="20" autocomplete="off" value="${esc(st.name)}" placeholder="${st.role === 'kid' ? 'Bijv. Sam' : 'Bijv. Mama of Papa'}">
      <button class="btn primary block" id="suNext" style="margin-top:16px">Verder ➜</button>${dots(1)}</div>`;
    if (st.step === 2) el.innerHTML = `<div class="setup-card"><div id="suPrev">${av(st, 'xl')}</div><h1>Kies je plaatje</h1>
      <div class="choose" id="suAv">${AVATARS.map((a) => `<button data-av="${a}" class="${a === st.avatar ? 'sel' : ''}">${a}</button>`).join('')}</div>
      <p class="muted" style="margin-bottom:0">En je kleur:</p><div class="choose colors" id="suCol">${COLORS.map((c) => `<button data-col="${c}" style="background:${c}" class="${c === st.color ? 'sel' : ''}">${c}</button>`).join('')}</div>
      <button class="btn primary block" id="suNext">Verder ➜</button>${dots(2)}</div>`;
    if (st.step === 3) {
      el.innerHTML = `<div class="setup-card"><div style="font-size:60px">🔒</div><h1>${st.role === 'kid' ? 'Pincode voor papa of mama' : 'Kies een pincode'}</h1>
        <p>${st.role === 'kid' ? 'Met deze pincode kan <b>alleen een ouder</b> nieuwe vriendjes toevoegen en de instellingen veranderen. Zo kunnen er geen vreemden bij.' : 'Hiermee beveilig je de instellingen en het toevoegen van contacten.'}</p><div id="suPin"></div>${dots(3)}</div>`;
      pinPad($('#suPin'), 'Kies 4 cijfers', async (p1, ui) => {
        ui.reset('Nog een keer, ter controle');
        ui.next = async (p2) => {
          if (p2 !== p1) { ui.bad('Niet hetzelfde. Probeer opnieuw.'); ui.next = null; return; }
          el.innerHTML = '<div class="setup-card"><div class="wait"><i class="spin"></i>Je geheime sleutel wordt gemaakt…</div></div>';
          await finishSetup(st, p1);
        };
      });
    }
    $$('[data-role]', el).forEach((b) => (b.onclick = () => { st.role = b.dataset.role; st.step = 1; r(); }));
    const nm = $('#suName', el); if (nm) { nm.focus(); nm.onkeydown = (e) => { if (e.key === 'Enter') $('#suNext').click(); }; }
    $$('[data-av]', el).forEach((b) => (b.onclick = () => { st.avatar = b.dataset.av; r(); }));
    $$('[data-col]', el).forEach((b) => (b.onclick = () => { st.color = b.dataset.col; r(); }));
    const nx = $('#suNext', el);
    if (nx) nx.onclick = () => { if (st.step === 1) { st.name = $('#suName').value.trim(); if (!st.name) { $('#suName').focus(); return; } } st.step++; r(); };
  };
  r();
}
async function finishSetup(st, pin) {
  const id = await KC.newIdentity();
  const salt = KC.b64u(KC.rnd(16));
  S.me = Object.assign(id, { role: st.role, created: Date.now() });
  S.prof = { name: st.name, avatar: st.avatar, color: st.color };
  S.settings.pinSalt = salt; S.settings.pinHash = await KC.pinHash(pin, salt);
  await DB.put('kv', S.me, 'me'); await DB.put('kv', S.prof, 'prof'); await saveSettings();
  S.fp = await KL.myFp();
  show('home');
  setTimeout(() => showHelp(true), 300);
}

/* ---------- pincode ---------- */
function pinPad(host, label, done) {
  let v = '';
  const ui = {
    reset(l) { v = ''; host.querySelector('.pin-l').textContent = l; draw(); },
    bad(l) { v = ''; const d = host.querySelector('.pin-dots'); d.classList.remove('bad'); void d.offsetWidth; d.classList.add('bad'); host.querySelector('.pin-l').textContent = l; draw(); if (navigator.vibrate) navigator.vibrate(120); },
    next: null,
  };
  host.innerHTML = `<p class="pin-l" style="text-align:center;font-weight:800">${esc(label)}</p><div class="pin-dots">${'<i></i>'.repeat(4)}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-n="${n}">${n}</button>`).join('')}<span></span><button data-n="0">0</button><button data-n="del" aria-label="Wissen">⌫</button></div>`;
  const draw = () => $$('.pin-dots i', host).forEach((d, i) => d.classList.toggle('f', i < v.length));
  const press = (n) => {
    if (n === 'del') { v = v.slice(0, -1); draw(); return; }
    if (v.length >= 4) return; v += n; draw();
    if (v.length === 4) { const val = v; setTimeout(() => { if (ui.next) ui.next(val, ui); else done(val, ui); }, 120); }
  };
  $$('[data-n]', host).forEach((b) => (b.onclick = () => press(b.dataset.n)));
  host.tabIndex = -1;
  host.onkeydown = (e) => { if (/^\d$/.test(e.key)) press(e.key); if (e.key === 'Backspace') press('del'); };
  setTimeout(() => host.focus(), 50);
  return ui;
}
function askPin(why) {
  if (!S.settings.pinHash) return Promise.resolve(true);
  if (S.pinOkUntil && Date.now() < S.pinOkUntil) return Promise.resolve(true);
  return new Promise((res) => {
    let ok = false;
    const sh = sheet(`<h2>🔒 Pincode</h2><p class="muted">${esc(why || 'Vraag papa of mama om de pincode.')}</p><div id="pp"></div>`, { onClose: () => res(ok) });
    pinPad($('#pp', sh), 'Typ de pincode', async (p, ui) => {
      if ((await KC.pinHash(p, S.settings.pinSalt)) === S.settings.pinHash) { ok = true; S.pinOkUntil = Date.now() + 3 * 60 * 1000; sh.close(); }
      else ui.bad('Dat is niet de goede pincode');
    });
  });
}

/* ---------- start ---------- */
function renderHome() {
  if (!S.me) return;
  $('#meBtn').innerHTML = av(S.prof, '');
  $('#hiName').textContent = 'Hoi ' + (S.prof.name || '') + '!';
  $('#addBtn').innerHTML = `<span>➕</span>${isKid() ? 'Vriendje toevoegen' : 'Contact toevoegen'}`;
  $('#friendsTitle').textContent = isKid() ? 'Mijn vriendjes' : 'Mijn contacten';
  const ps = parents();
  $('#parentNote').innerHTML = ps.length ? `<div class="note blue"><span class="n-ic">👀</span><div><b>${esc(ps.map((p) => p.name).join(' en '))} ${ps.length > 1 ? 'lezen' : 'leest'} mee.</b> Je berichtjes, foto's en spraakberichtjes gaan ook naar ${ps.length > 1 ? 'hun telefoons' : esc(ps[0].name) + "'s telefoon"}, zodat ${ps.length > 1 ? 'ze kunnen' : esc(ps[0].name) + ' kan'} zien dat alles goed gaat. Je vriendjes zien dat ook.</div></div>` : '';
  const kids = children();
  $('#mirrorList').innerHTML = kids.length ? `<h2 class="sec-title">👀 Meelezen</h2><div class="contacts">${kids.map((c) => `<button class="contact" data-mirror="${c.id}">${av(c, '')}<div class="mid"><b>Gesprekken van ${esc(c.name)}</b><div class="last">Kopieën komen binnen als ${esc(c.name)} met jou verbonden is</div></div><span style="font-size:24px">›</span></button>`).join('')}</div>` : '';
  $$('[data-mirror]').forEach((b) => (b.onclick = () => openMirror(b.dataset.mirror)));
  const list = [...S.contacts.values()].sort((a, b) => (online(b.id) - online(a.id)) || ((b.lastTs || 0) - (a.lastTs || 0)));
  $('#contactList').innerHTML = list.length ? list.map((c) => {
    const on = online(c.id);
    return `<button class="contact" data-open="${c.id}">${av(c, '', on)}<div class="mid"><b>${esc(c.name)} ${c.role === 'parent' ? '<span class="pill">👀 leest mee</span>' : c.role === 'child' ? '<span class="pill">mijn kind</span>' : ''}</b>
      <div class="last">${on ? '<span class="pill on">● Verbonden</span> ' : '<span class="pill off">Niet verbonden</span> '}${esc(c.lastText || '')}</div></div>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</button>`;
  }).join('') : `<div class="empty"><div class="e-ill">👫</div><p><b>Nog niemand in je lijst.</b></p><p>${isKid() ? 'Vraag papa of mama om samen met je vriendje op <b>➕ Vriendje toevoegen</b> te tikken.' : 'Tik op <b>➕ Contact toevoegen</b> en scan elkaars code.'}</p></div>`;
  $$('[data-open]').forEach((b) => (b.onclick = () => openChat(b.dataset.open)));
  $('#installRow').innerHTML = isInstalled() || location.protocol === 'file:' ? '' : `<div class="install-row"><button class="btn block" data-install>📲 App op je beginscherm zetten</button></div>`;
  $$('[data-install]').forEach((b) => (b.onclick = openInstall));
}

/* ---------- gesprek ---------- */
async function openChat(id) {
  const c = S.contacts.get(id); if (!c) return;
  closeSheets();
  S.chat = id; c.unread = 0; await saveContact(c);
  show('chat'); renderChatHead(); await renderMsgs(true);
}
function renderChatHead() {
  const c = S.contacts.get(S.chat); if (!c) return;
  const on = online(c.id);
  $('#chatWho').innerHTML = `${av(c, 'sm', on)}<div style="min-width:0"><b>${esc(c.name)}</b>${on ? '<span class="pill on">● Verbonden</span>' : '<span class="pill off">Niet verbonden</span>'}</div>`;
  const notes = [];
  const ps = parents().filter((p) => p.id !== c.id);
  if (ps.length) notes.push(`<div class="note blue"><span class="n-ic">👀</span><div>${esc(ps.map((p) => p.name).join(' en '))} ${ps.length > 1 ? 'lezen' : 'leest'} mee met dit gesprek.</div></div>`);
  if (c.parentReads && c.role !== 'parent') notes.push(`<div class="note blue"><span class="n-ic">👀</span><div>Een ouder van ${esc(c.name)} leest mee met dit gesprek.</div></div>`);
  if (!on) notes.push(`<div class="offline-bar"><span>Niet verbonden. Je berichtjes wachten ⏳ tot jullie verbinden.</span><button id="obConn">🔗 Verbind</button></div>`);
  $('#chatNotes').innerHTML = notes.join('');
  const ob = $('#obConn'); if (ob) ob.onclick = () => connectSheet(c.id);
}
function blobUrl(fid, blob) { if (S.urls.has(fid)) return S.urls.get(fid); const u = URL.createObjectURL(blob); S.urls.set(fid, u); return u; }
async function msgHtml(m) {
  const mine = m.from === S.me.id;
  const tick = mine ? (m.status === 'delivered' ? ' ✓✓' : m.status === 'sent' ? ' ✓' : ' ⏳') : '';
  const meta = `<span class="meta">${hhmm(m.ts)}${tick}</span>`;
  if (m.kind === 'text') return `<div class="bub ${mine ? 'me' : ''} ${onlyEmoji(m.text) ? 'emo' : ''}" data-id="${m.id}">${esc(m.text)}${meta}</div>`;
  const busy = m.status === 'receiving' || m.status === 'failed';
  const blob = !busy && m.fid ? await DB.getFile(m.fid) : null;
  const prog = (mine && m.status !== 'delivered') || m.status === 'receiving' ? `<div class="prog"><i style="width:${Math.round((m.prog || 0) * 100)}%"></i></div>` : '';
  let body = '';
  if (m.status === 'failed') body = `<div class="file"><span class="fi">⚠️</span><div><span class="fn">${esc(m.name || 'Bestand')}</span><small>Niet helemaal aangekomen. Komt opnieuw als jullie weer verbinden.</small></div></div>`;
  else if (!blob) body = `<div class="file"><span class="fi">${m.kind === 'voice' ? '🎤' : m.kind === 'photo' ? '🖼️' : m.kind === 'video' ? '🎬' : '📄'}</span><div><span class="fn">${esc(m.kind === 'voice' ? 'Spraakbericht' : m.name || 'Bestand')}</span><small>${m.status === 'receiving' ? 'Komt binnen… ' : ''}${fmtSize(m.size || 0)}</small></div></div>`;
  else if (m.kind === 'photo') body = `<img class="ph" src="${blobUrl(m.fid, blob)}" alt="Foto" loading="lazy">`;
  else if (m.kind === 'video') body = `<video src="${blobUrl(m.fid, blob)}" controls playsinline preload="metadata"></video>`;
  else if (m.kind === 'voice') body = `<div class="voice" data-voice="${m.fid}"><button class="vp" aria-label="Afspelen">▶</button><div class="vbar"><i></i></div><small>${fmtDur(m.dur)}</small></div>`;
  else body = `<div class="file"><span class="fi">📄</span><div><span class="fn">${esc(m.name)}</span><small>${fmtSize(m.size)}</small></div></div><a class="save" href="${blobUrl(m.fid, blob)}" download="${esc(m.name)}">⬇ Opslaan</a>`;
  if (blob && (m.kind === 'photo' || m.kind === 'video')) body += `<a class="save" href="${blobUrl(m.fid, blob)}" download="${esc(m.name || 'foto')}">⬇ Opslaan</a>`;
  return `<div class="bub media ${mine ? 'me' : ''}" data-id="${m.id}">${body}${prog}${meta}</div>`;
}
async function renderMsgs(scroll) {
  const box = $('#msgs'); if (!S.chat) return;
  const list = (await DB.byIndex('msgs', 'conv', S.chat)).sort((a, b) => a.ts - b.ts);
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  let html = '', lastDay = '';
  for (const m of list) { const d = new Date(m.ts).toDateString(); if (d !== lastDay) { html += `<div class="day">${dayLabel(m.ts)}</div>`; lastDay = d; } html += await msgHtml(m); }
  if (!list.length) { const c = S.contacts.get(S.chat); html = `<div class="empty" style="margin:20px 4px"><div class="e-ill">👋</div><p>Zeg hallo tegen ${esc(c ? c.name : '')}!</p></div>`; }
  box.innerHTML = html;
  bindVoice(box);
  if (scroll || atBottom) box.scrollTop = box.scrollHeight;
  $$('img.ph, video', box).forEach((i) => i.addEventListener(i.tagName === 'IMG' ? 'load' : 'loadedmetadata', () => { if (scroll || atBottom) box.scrollTop = box.scrollHeight; }, { once: true }));
}
let curAudio = null;
function bindVoice(root) {
  $$('[data-voice]', root).forEach((v) => {
    const btn = v.querySelector('.vp'), bar = v.querySelector('.vbar i');
    btn.onclick = async () => {
      if (curAudio && curAudio.fid === v.dataset.voice && curAudio.btn === btn) { if (curAudio.paused) curAudio.play(); else curAudio.pause(); return; }
      if (curAudio) curAudio.pause();
      let blob = await DB.getFile(v.dataset.voice); if (!blob) return;
      const a = new Audio(); a.fid = v.dataset.voice; a.btn = btn; curAudio = a; G.KW.audio = a;
      if (!a.canPlayType(blob.type || 'audio/mp4')) { try { blob = await KM.toWav(blob); } catch (e) {} }
      a.src = URL.createObjectURL(blob);
      a.onplay = () => (btn.textContent = '⏸'); a.onpause = a.onended = () => { btn.textContent = '▶'; if (a.ended) bar.style.width = '0'; };
      a.ontimeupdate = () => { if (a.duration && isFinite(a.duration)) bar.style.width = (a.currentTime / a.duration) * 100 + '%'; };
      a.play().catch(() => toast('Afspelen lukt niet op dit apparaat'));
    };
  });
}
function setProg(id, p) { const el = document.querySelector(`.bub[data-id="${id}"] .prog i`); if (el) el.style.width = Math.round(p * 100) + '%'; }
let rerenderT = 0;
function refresh() { clearTimeout(rerenderT); rerenderT = setTimeout(() => { if (S.view === 'chat') { renderChatHead(); renderMsgs(); } if (S.view === 'home') renderHome(); if (S.view === 'mirror' && S.mirrorConv) openMirrorConv(S.mirrorChild, S.mirrorConv, true); }, 60); }

/* composer */
function bindComposer() {
  const t = $('#txt');
  const sync = () => { const has = t.value.trim().length > 0; $('#sendBtn').classList.toggle('hidden', !has); $('#micBtn').classList.toggle('hidden', has); t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; };
  t.oninput = sync;
  t.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !/Android|iPhone|iPad/.test(navigator.userAgent)) { e.preventDefault(); sendText(); } };
  $('#sendBtn').onclick = () => { sendText(); t.focus(); };
  $('#emoBtn').onclick = () => { const b = $('#emojiBox'); if (!b.innerHTML) { b.innerHTML = EMOJI.map((e) => `<button data-e="${e}">${e}</button>`).join(''); $$('[data-e]', b).forEach((x) => (x.onclick = () => { t.value += x.dataset.e; sync(); })); } b.classList.toggle('hidden'); };
  $('#fileBtn').onclick = () => $('#fileIn').click();
  $('#fileIn').onchange = async (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; for (const f of files) await sendFile(f); };
  $('#micBtn').onclick = () => voiceSheet();
  $('#chatBack').onclick = () => { S.chat = null; $('#emojiBox').classList.add('hidden'); show('home'); };
  $('#chatConn').onclick = () => connectSheet(S.chat);
  sync(); G.KW.syncComposer = sync;
}
async function sendText() {
  const t = $('#txt'); const text = t.value.trim(); if (!text || !S.chat) return;
  t.value = ''; G.KW.syncComposer(); $('#emojiBox').classList.add('hidden');
  await newMsg(S.chat, { kind: 'text', text });
}
async function sendFile(file, kind, dur) {
  if (!S.chat) return;
  if (file.size > 2 * 1024 * 1024 * 1024) { toast('Dit bestand is te groot (max. 2 GB)'); return; }
  const fid = KL.fidNew();
  await DB.putFile(fid, file);
  await newMsg(S.chat, { kind: kind || kindOf(file.type), fid, name: file.name || (kind === 'voice' ? 'spraakbericht' : 'bestand'), size: file.size, type: file.type || 'application/octet-stream', dur });
}
async function newMsg(conv, o) {
  const m = Object.assign({ id: uid(), conv, from: S.me.id, ts: Date.now(), status: 'queued' }, o);
  await DB.put('msgs', m);
  const c = S.contacts.get(conv); if (c) { c.lastTs = m.ts; c.lastText = preview(m); await saveContact(c); }
  await enqueueCopy(m);
  if (S.view === 'chat' && S.chat === conv) await renderMsgs(true);
  const s = S.sess.get(conv); if (s && s.ready) sendMsg(s, m);
  else if (!S.queuedTip) { S.queuedTip = 1; toast('⏳ Bewaard. Gaat vanzelf als jullie verbonden zijn.'); }
  return m;
}
const preview = (m) => m.kind === 'text' ? m.text.slice(0, 60) : m.kind === 'voice' ? '🎤 Spraakbericht' : m.kind === 'photo' ? '🖼️ Foto' : m.kind === 'video' ? '🎬 Filmpje' : '📄 ' + (m.name || 'Bestand');
const meta = (m) => ({ id: m.id, ts: m.ts, from: m.from, kind: m.kind, text: m.text, name: m.name, size: m.size, type: m.type, dur: m.dur });

/* ---------- versturen / ontvangen ---------- */
async function sendMsg(s, m) {
  const ok = await s.send(Object.assign({ k: 'm', fid: m.fid || null }, meta(m)));
  if (ok && m.status === 'queued') { m.status = 'sent'; await DB.put('msgs', m); refresh(); }
}
async function flush(s) {
  const c = S.contacts.get(s.peer.id); if (!c) return;
  const mine = (await DB.byIndex('msgs', 'conv', c.id)).filter((m) => m.from === S.me.id && m.status !== 'delivered').sort((a, b) => a.ts - b.ts);
  for (const m of mine) await sendMsg(s, m);
  if (c.role === 'parent') for (const q of (await DB.byIndex('copyq', 'parent', c.id)).sort((a, b) => a.ts - b.ts)) await sendCopy(s, q);
}
async function enqueueCopy(m) {
  for (const p of parents()) {
    if (m.conv === p.id) continue;
    const q = { id: 'cp:' + p.id + ':' + m.id, parent: p.id, msgId: m.id, ts: Date.now() };
    await DB.put('copyq', q);
    const s = S.sess.get(p.id); if (s && s.ready) sendCopy(s, q);
  }
}
async function sendCopy(s, q) {
  const m = await DB.get('msgs', q.msgId);
  if (!m) { await DB.del('copyq', q.id); return; }
  if (m.fid && m.from !== S.me.id && m.status !== 'received') return;
  const c = S.contacts.get(m.conv) || { id: m.conv, name: '?' };
  const withFile = !!(m.fid && S.settings.copyFiles !== false && (m.size || 0) <= MAX_COPY);
  await s.send({ k: 'cp', id: q.id, conv: { id: c.id, name: c.name, avatar: c.avatar, color: c.color }, dir: m.from === S.me.id ? 'out' : 'in', m: meta(m), fid: withFile ? m.fid : null });
}
function queueFile(s, fid, id, onprog) {
  s.fileChain = (s.fileChain || Promise.resolve()).then(async () => {
    const blob = await DB.getFile(fid); if (!blob || s.closed) return;
    await s.sendFile(fid, blob, onprog);
  }).catch((e) => console.warn('file', e));
}
async function onMsg(m, s) {
  const peer = S.contacts.get(s.peer.id);
  if (m.k === 'prof') return onProf(m, s);
  if (!peer) return;
  if (m.k === 'm') {
    const ex = await DB.get('msgs', m.id);
    if (ex && ex.status === 'received') { s.send({ k: 'ack', id: m.id }); return; }
    if (ex && ex.conv !== peer.id) return;
    const rec = { id: m.id, conv: peer.id, from: peer.id, ts: Math.min(Date.now(), m.ts || Date.now()), kind: ['text', 'photo', 'video', 'voice', 'file'].includes(m.kind) ? m.kind : 'file', text: m.kind === 'text' ? String(m.text || '').slice(0, 5000) : undefined, name: m.name, size: +m.size || 0, type: m.type, dur: m.dur, fid: m.fid || undefined, status: m.fid ? 'receiving' : 'received', prog: 0 };
    await DB.put('msgs', rec);
    if (m.fid) { S.rx.set(m.fid, { id: m.id, kind: 'm', size: rec.size, type: m.type, parts: [], blobs: [], bytes: 0, sess: s }); s.send({ k: 'go', id: m.id, fid: m.fid }); refresh(); return; }
    await received(rec, peer, s);
  } else if (m.k === 'go') {
    if (String(m.id).startsWith('cp:')) { const q = await DB.get('copyq', m.id); if (q) queueFile(s, m.fid, m.id); return; }
    const rec = await DB.get('msgs', m.id); if (!rec || rec.conv !== peer.id || rec.fid !== m.fid) return;
    queueFile(s, m.fid, m.id, (p) => { rec.prog = p; setProg(m.id, p); });
  } else if (m.k === 'ack') {
    if (String(m.id).startsWith('cp:')) { await DB.del('copyq', m.id); return; }
    const rec = await DB.get('msgs', m.id); if (!rec || rec.conv !== peer.id) return;
    rec.status = 'delivered'; rec.prog = 1; await DB.put('msgs', rec); refresh();
  } else if (m.k === 'cp' && peer.role === 'child') {
    const id = peer.id + '|' + m.id;
    const ex = await DB.get('mirror', id);
    if (ex && ex.status === 'received') { s.send({ k: 'ack', id: m.id }); return; }
    const rec = { id, child: peer.id, conv: m.conv, dir: m.dir === 'out' ? 'out' : 'in', m: m.m, fid: m.fid || null, ts: (m.m && m.m.ts) || Date.now(), status: m.fid ? 'receiving' : 'received' };
    await DB.put('mirror', rec);
    if (m.fid) { S.rx.set(m.fid, { id, ackId: m.id, kind: 'cp', size: (m.m && +m.m.size) || 0, type: m.m && m.m.type, parts: [], blobs: [], bytes: 0, sess: s }); s.send({ k: 'go', id: m.id, fid: m.fid }); return; }
    s.send({ k: 'ack', id: m.id }); refresh();
  }
}
async function onChunk(fid, idx, data, s) {
  const st = S.rx.get(fid); if (!st || st.sess !== s) return;
  if (idx === 0 && st.bytes) { st.parts = []; st.blobs = []; st.bytes = 0; }
  st.parts.push(data); st.bytes += data.length;
  if (st.parts.length >= 64) { st.blobs.push(new Blob(st.parts)); st.parts = []; }
  if (st.kind === 'm' && (idx % 8 === 0)) setProg(st.id, st.size ? st.bytes / st.size : 1);
  if (st.bytes >= st.size) {
    S.rx.delete(fid);
    const blob = new Blob(st.blobs.concat([new Blob(st.parts)]), { type: st.type || 'application/octet-stream' });
    await DB.putFile(fid, blob);
    if (st.kind === 'cp') { const r = await DB.get('mirror', st.id); if (r) { r.status = 'received'; await DB.put('mirror', r); } s.send({ k: 'ack', id: st.ackId }); refresh(); return; }
    const rec = await DB.get('msgs', st.id); if (!rec) return;
    rec.status = 'received'; rec.prog = 1; await DB.put('msgs', rec);
    await received(rec, S.contacts.get(rec.conv), s);
  }
}
async function received(rec, peer, s) {
  s.send({ k: 'ack', id: rec.id });
  peer.lastTs = rec.ts; peer.lastText = preview(rec);
  const looking = S.view === 'chat' && S.chat === peer.id && document.visibilityState === 'visible';
  if (!looking) peer.unread = (peer.unread || 0) + 1;
  await saveContact(peer);
  await enqueueCopy(rec);
  if (S.settings.sound !== false) KM.chime('msg');
  if (navigator.vibrate && !looking) { try { navigator.vibrate([60, 40, 60]); } catch (e) {} }
  if (!looking) toast(`${esc(peer.avatar || '💬')} <b>${esc(peer.name)}</b>: ${esc(preview(rec))}`, 3500, S.view !== 'chat' || S.chat !== peer.id ? { label: 'Open', fn: () => openChat(peer.id) } : null);
  notifySystem(peer, rec);
  refresh();
}
function notifySystem(peer, rec) {
  if (document.visibilityState === 'visible' || !S.settings.notify || !('Notification' in G) || Notification.permission !== 'granted') return;
  navigator.serviceWorker && navigator.serviceWorker.ready.then((r) => r.showNotification('Kwebbel: ' + peer.name, { body: preview(rec), icon: 'icons/icon-192.png', tag: 'kw-' + peer.id })).catch(() => {});
}

/* ---------- sessies ---------- */
function myProf(extra) { return Object.assign({ k: 'prof', name: S.prof.name, avatar: S.prof.avatar, color: S.prof.color, role: S.me.role, parentReads: parents().length > 0, fp: S.fp, v: VERSION }, extra || {}); }
function startSession(L, expect, ctx) {
  ctx = ctx || {};
  const s = new KL.Session(L, S.me, expect, {
    onready: (s) => { s.ctx = ctx; s.send(myProf(ctx.pair ? { pair: { acceptParent: !!ctx.acceptParent } } : null)); },
    onmsg: (m, s) => onMsg(m, s).catch((e) => console.warn(e)),
    onchunk: (fid, i, d, s) => onChunk(fid, i, d, s).catch((e) => console.warn(e)),
    onerror: (msg) => { toast('⚠️ ' + msg, 5000); ctx.onfail && ctx.onfail(msg); },
    onclose: (why, s) => {
      if (s.peer && S.sess.get(s.peer.id) === s) {
        S.sess.delete(s.peer.id);
        for (const [fid, st] of S.rx) if (st.sess === s) { S.rx.delete(fid); if (st.kind === 'm') DB.get('msgs', st.id).then((r) => { if (r && r.status === 'receiving') { r.status = 'failed'; DB.put('msgs', r).then(refresh); } }); }
        const c = S.contacts.get(s.peer.id);
        if (c && why !== 'replaced' && why !== 'removed') toast(`🔌 Verbinding met ${esc(c.name)} is verbroken`, 3500, { label: 'Opnieuw', fn: () => connectSheet(c.id) });
        updateWake(); refresh();
      }
    },
  });
  G.KW.lastSess = s;
  return s;
}
async function onProf(m, s) {
  let c = S.contacts.get(s.peer.id);
  const prof = { name: String(m.name || '?').slice(0, 24), avatar: String(m.avatar || '🙂').slice(0, 8), color: /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : '#FFD23F', parentReads: !!m.parentReads, fp: m.fp || (c && c.fp), peerRole: m.role === 'parent' ? 'parent' : 'kid' };
  const isNew = !c;
  if (!c) {
    if (!s.ctx || !s.ctx.pair) { s.close('unknown'); return; }
    let role = 'friend';
    if (s.ctx.iAmChildAsking && m.pair && m.pair.acceptParent) role = 'parent';
    if (s.ctx.acceptParent) role = 'child';
    c = Object.assign({ id: s.peer.id, sp: s.peer.sp, ep: s.peer.ep, role, added: Date.now(), unread: 0, lastTs: Date.now() }, prof);
    if (!c.fp) c.fp = s.ctx.peerFp;
  } else Object.assign(c, prof);
  await saveContact(c);
  const old = S.sess.get(c.id);
  S.sess.set(c.id, s);
  if (old && old !== s) old.close('replaced');
  if (isNew && c.role === 'parent') S.sess.forEach((x) => { if (x !== s) x.send(myProf()); });
  if (old !== s && S.settings.sound !== false) KM.chime('connect');
  if (s.ctx && s.ctx.onconnected && !s.ctx.announced) { s.ctx.announced = true; s.ctx.onconnected(c); }
  updateWake(); refresh();
  if (old === s) return;
  flush(s).catch((e) => console.warn(e));
}
function updateWake() { KM.wake(S.settings.wake !== false && S.sess.size > 0); }

/* ---------- QR tonen / scannen ---------- */
function qrSvg(text) { const q = G.qrcode(0, 'M'); q.addData(text, 'Byte'); q.make(); return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); }
function scannerHtml(hint) {
  return `<div class="cam"><video playsinline muted></video><div class="frame"></div><div class="camtxt">${esc(hint || 'Houd de code in het vierkant')}</div></div>
    <details class="more"><summary>Werkt de camera niet?</summary><p style="font-size:15px">Geef Kwebbel toestemming voor de camera (bij de instellingen van je browser). Of plak hier de code als tekst:</p>
    <textarea class="paste" placeholder="KWEBBEL1…"></textarea><button class="btn block" data-paste>Gebruik deze code</button></details>`;
}
/* start de camera in een vel; onCode(text) → true = blijf scannen */
function startScanner(sh, onCode) {
  const video = $('video', sh); let sc = null; let done = false;
  const handle = (t) => { if (done) return false; const keep = onCode(t); if (keep === true) return true; done = true; return false; };
  try {
    sc = KM.scan(video, handle);
    sc.start.catch((e) => { const ct = $('.camtxt', sh); if (ct) ct.textContent = '📷 Geen camera: ' + (e && e.name === 'NotAllowedError' ? 'geen toestemming' : 'niet gevonden'); const d = $('details.more', sh); if (d) d.open = true; });
  } catch (e) { const d = $('details.more', sh); if (d) d.open = true; }
  const pb = $('[data-paste]', sh); if (pb) pb.onclick = () => { const v = $('.paste', sh).value.trim(); if (v) { done = false; handle(v); } };
  const api = { stop() { if (sc) sc.stop(); }, again() { done = false; } };
  G.KW.lastScanner = { feed: (t) => { done = false; return handle(t); }, stop: api.stop };
  return api;
}

/* Algemene scanknop op het beginscherm */
function scanSheet() {
  let sc = null;
  const sh = sheet(`<h2>📷 Scan een code</h2><p class="muted" style="margin-top:0">Richt de camera op de code op het scherm van je vriendje.</p>${scannerHtml()}`, { onClose: () => sc && sc.stop() });
  sc = startScanner(sh, (t) => { handleCode(t, sh, sc); return true; });
}
let busyCode = false, lastCode = '', lastCodeT = 0;
async function handleCode(text, sh, sc) {
  if (busyCode) return;
  if (text === lastCode && Date.now() - lastCodeT < 4000) return;
  lastCode = text; lastCodeT = Date.now();
  const type = KL.codeType(text);
  if (!type) { toast('Dit is geen Kwebbel-code'); return; }
  busyCode = true;
  try {
    if (type === 'C') await scannedConnect(text, sh, sc);
    else if (type === 'P') await scannedPair(text, sh, sc);
    else if (type === 'A' || type === 'R') toast('Dit is een antwoord-code. Die scant het andere apparaat.');
  } catch (e) { console.warn(e); toast('⚠️ ' + (e.message || 'Er ging iets mis')); }
  finally { busyCode = false; }
}

/* ---- verbinden met een bekend contact ---- */
function connectSheet(id) {
  if (!id) {
    const list = [...S.contacts.values()];
    if (!list.length) { toast(isKid() ? 'Voeg eerst een vriendje toe ➕' : 'Voeg eerst een contact toe ➕'); return; }
    if (list.length === 1) return connectSheet(list[0].id);
    const sh = sheet(`<h2>🔗 Met wie wil je verbinden?</h2><div class="contacts" style="padding:0">${list.map((c) => `<button class="contact" data-c="${c.id}">${av(c, '', online(c.id))}<div class="mid"><b>${esc(c.name)}</b></div></button>`).join('')}</div>
      <p class="muted" style="text-align:center">Laat je vriendje een code zien? Tik dan op 📷 <b>Scan een code</b>.</p>`);
    $$('[data-c]', sh).forEach((b) => (b.onclick = () => { sh.close(); connectSheet(b.dataset.c); }));
    return;
  }
  const c = S.contacts.get(id); if (!c) return;
  if (online(id)) { toast(`Je bent al verbonden met ${esc(c.name)} ✓`); return; }
  let L = null, s = null, done = false, sc = null;
  const sh = sheet('', { onClose: () => { if (sc) sc.stop(); if (!done && L && !(s && s.ready)) { try { L.pc.close(); } catch (e) {} } } });
  const connected = (cc) => { done = true; if (sc) sc.stop(); celebrate(sh, cc); };
  const showCode = async () => {
    sh.set(`<h2>📱 Mijn code</h2><div class="wait"><i class="spin"></i>Code maken…</div>`);
    L = await KL.connectOffer(S.me, c);
    s = startSession(L, { contact: c }, { onconnected: connected });
    G.KW.lastCode = L.code;
    sh.set(`<div class="qr-who">${av(c, 'sm')} Voor ${esc(c.name)}</div><div class="qr" id="qrBox">${qrSvg(L.code)}</div>
      <p style="text-align:center;margin-top:4px"><b>${esc(c.name)}</b> tikt op <b>📷 Scan een code</b> en scant deze code.</p>
      <div class="wait"><i class="spin"></i>Wachten op ${esc(c.name)}…</div>
      <details class="more"><summary>Lukt het niet?</summary><p style="font-size:15px">Na het scannen laat ${esc(c.name)}'s scherm na een paar tellen óók een code zien. Scan die hier:</p><button class="btn block" id="cFb">📷 Scan de code van ${esc(c.name)}</button>
      <p style="font-size:15px">Nog steeds niet? Kijk of jullie op hetzelfde wifi zitten (niet het gastnetwerk of een school-wifi).</p></details>`);
    $('#cFb', sh).onclick = () => {
      const box = document.createElement('div'); box.innerHTML = scannerHtml('Scan de code van ' + c.name); $('#cFb', sh).replaceWith(box);
      sc = startScanner(sh, (t) => {
        if (KL.codeType(t) !== 'R') { toast('Scan de code die ' + esc(c.name) + ' nu laat zien'); return true; }
        KL.connectFallback(L, t).then(async (r) => {
          if (r.fp !== c.fp) { c.fp = r.fp; await saveContact(c); sc.stop(); try { L.pc.close(); } catch (e) {} toast('Nog één keer: laat ' + esc(c.name) + ' deze nieuwe code scannen.', 5000); showCode(); }
          else toast('Bijna… even geduld');
        }).catch((e) => toast('⚠️ ' + e.message));
        return false;
      });
    };
  };
  sh.set(`<h2>🔗 Verbinden met ${esc(c.name)}</h2><p style="margin-top:0">Zitten jullie op <b>hetzelfde wifi</b>? Eén van jullie laat de code zien, de ander scant hem.</p>
    <button class="btn primary block" id="cShow">📱 Laat mijn code zien</button><button class="btn green block" id="cScan">📷 Scan de code van ${esc(c.name)}</button>
    <p class="muted" style="font-size:15px">Daarna blijven jullie verbonden zolang de app openstaat.</p>`);
  $('#cShow', sh).onclick = showCode; $('#cScan', sh).onclick = () => { sh.close(); scanSheet(); };
}
async function scannedConnect(text, sh, sc) {
  const o = KL.readConnect(text);
  if (o.to !== S.me.id) { toast(S.contacts.has(o.from) ? 'Deze code is voor iemand anders' : 'Deze code is niet voor jou'); return; }
  const c = S.contacts.get(o.from);
  if (!c) { toast('Deze code is van iemand die niet in je lijst staat. Voeg eerst samen een vriendje toe.'); return; }
  if (online(c.id)) { sc.stop(); sh.close(); toast(`Je bent al verbonden met ${esc(c.name)} ✓`); openChat(c.id); return; }
  sh.set(`<h2>🔗 ${esc(c.name)}</h2><div class="wait"><i class="spin"></i>Verbinden met ${esc(c.name)}…</div>`);
  const L = await KL.connectAnswer(S.me, c, text);   // camera staat nog aan → betere adressen
  sc.stop();
  G.KW.lastAnswer = L.code;
  let done = false;
  const s = startSession(L, { contact: c }, { onconnected: (cc) => { done = true; celebrate(sh, cc); } });
  const oc = sh.close; sh.close = () => { if (!done && !(s && s.ready)) { try { L.pc.close(); } catch (e) {} } oc(); };
  setTimeout(() => {
    if (done || !sh.bg.isConnected) return;
    sh.set(`<h2>🔗 ${esc(c.name)}</h2><div class="wait"><i class="spin"></i>Nog even…</div><p>Lukt het niet? Laat <b>${esc(c.name)}</b> dan deze code scannen (bij “Lukt het niet?” onder de code van ${esc(c.name)}).</p><div class="qr">${qrSvg(L.code)}</div>
      <p class="muted" style="font-size:15px">Blijft het hangen? Kijk of jullie op hetzelfde wifi zitten. Op een gastnetwerk of school-wifi werkt het vaak niet.</p>`);
  }, 4500);
}
function celebrate(sh, c) {
  if (!sh.bg.isConnected) { toast(`🎉 Verbonden met ${esc(c.name)}`); return; }
  sh.set(`<div class="celebrate"><div class="big-emo">🎉</div><h2 style="margin:6px 0">Verbonden met ${esc(c.name)}!</h2><p>Jullie kunnen nu kletsen. Laat de app openstaan, dan blijven jullie verbonden.</p>
    <button class="btn primary block" id="goChat">💬 Naar het gesprek</button></div>`);
  $('#goChat', sh).onclick = () => { sh.close(); openChat(c.id); };
  setTimeout(() => { if (sh.bg.isConnected && $('#goChat', sh)) { sh.close(); openChat(c.id); } }, 2200);
}

/* ---- koppelen (nieuw vriendje / ouder) ---- */
async function addFlow(asParent) {
  if (!(await askPin(asParent ? 'Ouder koppelen: typ de pincode.' : isKid() ? 'Nieuw vriendje toevoegen? Vraag papa of mama om de pincode.' : 'Typ je pincode.'))) return;
  closeSheets();
  let L = null, done = false, sc = null;
  const title = asParent ? '👀 Ouder koppelen' : isKid() ? '➕ Nieuw vriendje' : '➕ Nieuw contact';
  const sh = sheet(`<h2>${title}</h2><div class="wait"><i class="spin"></i>Code maken…</div>`, { onClose: () => { if (sc) sc.stop(); if (!done && L) { try { L.pc.close(); } catch (e) {} } } });
  L = await KL.pairOffer(S.me, asParent ? 1 : 0);
  G.KW.lastPair = L.code;
  sh.set(`<h2>${title}</h2>
    <p style="margin-top:0"><b>Stap 1.</b> ${asParent ? 'Open Kwebbel op de telefoon van de ouder, tik op <b>📷 Scan een code</b> en scan deze code.' : 'Je vriendje tikt in Kwebbel op <b>📷 Scan een code</b> en scant deze code.'}</p>
    <div class="qr">${qrSvg(L.code)}</div>
    <p><b>Stap 2.</b> Daarna laat ${asParent ? 'dat apparaat' : 'het scherm van je vriendje'} een code zien. Scan die:</p>
    <button class="btn primary block" id="pScan">📷 Scan het antwoord</button>`);
  $('#pScan', sh).onclick = () => {
    const box = document.createElement('div'); box.innerHTML = scannerHtml('Scan de code van het andere apparaat'); $('#pScan', sh).replaceWith(box);
    sc = startScanner(sh, (t) => {
      if (KL.codeType(t) !== 'A') { toast('Scan de antwoord-code van het andere apparaat'); return true; }
      sc.stop();
      KL.pairFinish(L, t).then(() => {
        sh.set(`<h2>Bijna klaar…</h2><div class="wait"><i class="spin"></i>Verbinden en sleutels uitwisselen…</div>`);
        startSession(L, { hash: L.peerHash }, { pair: true, iAmChildAsking: asParent, peerFp: L.peerFp, onconnected: (c) => { done = true; paired(sh, c); }, onfail: () => { done = true; } });
        setTimeout(() => { if (!done && sh.bg.isConnected) sh.set(`<h2>Het lukt niet 😕</h2><p>De apparaten kunnen elkaar niet vinden. Zitten ze op <b>hetzelfde wifi</b>? Een gastnetwerk of school-wifi laat apparaten vaak niet met elkaar praten.</p><button class="btn primary block" data-close>Sluiten en opnieuw proberen</button>`); }, 25000);
      }).catch((e) => toast('⚠️ ' + e.message));
      return false;
    });
  };
}
async function scannedPair(text, sh, sc) {
  const o = KL.readPair(text);
  const asParent = !!(o.flags & 1);
  if (asParent && isKid()) { toast('Deze code is voor de telefoon van een ouder'); return; }
  const pinOk = await askPin(asParent ? 'Meelezen met je kind: typ je pincode.' : isKid() ? 'Nieuw vriendje toevoegen? Vraag papa of mama om de pincode.' : 'Nieuw contact: typ je pincode.');
  if (!pinOk) { sc.stop(); sh.close(); return; }
  if (asParent) {
    const ok = await new Promise((res) => { let v = false; const q = sheet(`<h2>👀 Meelezen</h2><p>Dit apparaat wordt gekoppeld als <b>ouder</b>. Je krijgt een kopie van de berichtjes, foto's en spraakberichtjes van je kind, steeds als jullie verbonden zijn.</p><p class="muted">Je kind ziet altijd dat jij meeleest, en de vriendjes van je kind ook.</p><div class="row"><button class="btn" data-close>Annuleren</button><button class="btn primary" id="okP">Ja, koppelen</button></div>`, { onClose: () => res(v) }); $('#okP', q).onclick = () => { v = true; q.close(); }; });
    if (!ok) { sc.stop(); sh.close(); return; }
  }
  sh.set(`<h2>➕ Koppelen</h2><div class="wait"><i class="spin"></i>Code maken…</div>`);
  const L = await KL.pairAnswer(S.me, text);   // camera staat nog aan → betere adressen
  sc.stop();
  G.KW.lastAnswer = L.code;
  let done = false;
  startSession(L, { hash: L.peerHash }, { pair: true, acceptParent: asParent, peerFp: L.peerFp, onconnected: (c) => { done = true; paired(sh, c); }, onfail: () => { done = true; } });
  sh.set(`<h2>➕ Koppelen</h2><p style="margin-top:0"><b>Laat nu deze code scannen</b> door het andere apparaat (bij “Scan het antwoord”).</p><div class="qr">${qrSvg(L.code)}</div><div class="wait"><i class="spin"></i>Wachten…</div>`);
  const oc = sh.close; sh.close = () => { if (!done) { try { L.pc.close(); } catch (e) {} } oc(); };
}
async function paired(sh, c) {
  const code = await KC.safetyCode(S.me.sp, c.sp);
  const what = c.role === 'parent' ? `${esc(c.name)} leest nu mee.` : c.role === 'child' ? `Je leest nu mee met ${esc(c.name)}.` : `${esc(c.name)} staat nu in je lijst.`;
  sh.set(`<div class="celebrate"><div class="big-emo">${esc(c.avatar)}</div><h2 style="margin:4px 0">Gelukt! ${what}</h2></div>
    <div class="safety"><p class="muted" style="margin-bottom:0">Geheime code: zien jullie op allebei de schermen <b>dezelfde plaatjes</b>?</p><div class="emo">${code.emoji.join('')}</div><div class="num">${code.num}</div></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="sNo">❌ Nee</button><button class="btn green" id="sYes">✅ Ja, klopt!</button></div>`);
  $('#sYes', sh).onclick = () => { sh.close(); openChat(c.id); };
  $('#sNo', sh).onclick = async () => { await removeContact(c.id); sh.close(); sheet('<h2>Verwijderd</h2><p>Als de plaatjes niet hetzelfde zijn, kan er iemand tussen zitten. Het contact is weer verwijderd. Probeer het opnieuw, samen naast elkaar.</p><button class="btn primary block" data-close>Oké</button>'); };
}
async function removeContact(id) {
  const s = S.sess.get(id); if (s) s.close('removed');
  S.contacts.delete(id); await DB.del('contacts', id);
  await DB.delWhere('copyq', 'parent', id);
  refresh();
}

/* ---------- spraakbericht ---------- */
function voiceSheet() {
  if (!navigator.mediaDevices || !G.MediaRecorder) { toast('Opnemen kan niet op dit apparaat'); return; }
  let rec = null, res = null, timer = 0, url = null;
  const sh = sheet(`<div class="rec"><h2 style="margin-right:0">🎤 Spraakbericht</h2><p class="muted" id="rHint">Tik op de rode knop en praat.</p>
    <button class="rbtn" id="rBtn" aria-label="Opnemen">🎤</button><div class="rtime" id="rTime">0:00</div><div class="lvl"><i id="rLvl"></i></div><div id="rAfter"></div></div>`,
    { onClose: () => { clearInterval(timer); if (rec && !res) rec.cancel(); if (url) URL.revokeObjectURL(url); } });
  const btn = $('#rBtn', sh);
  btn.onclick = async () => {
    if (!rec) {
      try { rec = await KM.recorder((l) => { const el = $('#rLvl', sh); if (el) el.style.width = l * 100 + '%'; }); }
      catch (e) { $('#rHint', sh).textContent = 'De microfoon mag niet. Geef Kwebbel toestemming voor de microfoon.'; return; }
      btn.classList.add('on'); btn.textContent = '⏹'; $('#rHint', sh).textContent = 'Aan het opnemen… tik om te stoppen';
      timer = setInterval(() => { const t = rec.elapsed(); $('#rTime', sh).textContent = fmtDur(t); if (t >= 120) btn.click(); }, 250);
      return;
    }
    if (res) return;
    clearInterval(timer); btn.classList.remove('on'); btn.disabled = true; $('#rHint', sh).textContent = 'Even klaarmaken…';
    res = await rec.stop(); url = URL.createObjectURL(res.blob);
    $('#rHint', sh).textContent = 'Luister terug of verstuur meteen.'; btn.classList.add('hidden');
    $('#rAfter', sh).innerHTML = `<audio controls src="${url}" style="width:100%;margin:8px 0"></audio><div class="row"><button class="btn" id="rAgain">🗑 Opnieuw</button><button class="btn primary" id="rSend">➤ Versturen</button></div>`;
    $('#rAgain', sh).onclick = () => { sh.close(); voiceSheet(); };
    $('#rSend', sh).onclick = async () => { const b = res.blob; sh.close(); const ext = /wav/.test(b.type) ? 'wav' : /mp4|aac/.test(b.type) ? 'm4a' : 'webm'; await sendFile(new File([b], 'spraakbericht.' + ext, { type: b.type }), 'voice', res.dur); };
  };
}

/* ---------- meelezen (ouder) ---------- */
async function openMirror(childId) {
  const c = S.contacts.get(childId); if (!c) return;
  S.mirrorChild = childId; S.mirrorConv = null; show('mirror');
  $('#mirWho').innerHTML = `${av(c, 'sm')}<div><b>Gesprekken van ${esc(c.name)}</b><span class="pill">👀 alleen lezen</span></div>`;
  const all = await DB.byIndex('mirror', 'child', childId);
  const convs = new Map();
  for (const r of all) { const k = r.conv && r.conv.id; if (!k) continue; const e = convs.get(k) || { conv: r.conv, n: 0, last: 0 }; e.n++; if (r.ts > e.last) { e.last = r.ts; e.conv = r.conv; } convs.set(k, e); }
  const list = [...convs.values()].sort((a, b) => b.last - a.last);
  $('#mirBody').innerHTML = `<div class="note blue" style="margin:0 0 10px"><span class="n-ic">ℹ️</span><div>Hier zie je kopieën van de gesprekken van ${esc(c.name)}. Ze komen binnen zodra ${esc(c.name)}'s apparaat met jou verbonden is. ${esc(c.name)} en de vriendjes zien in de app dat jij meeleest.</div></div>` +
    (list.length ? `<div class="contacts" style="padding:0">${list.map((e) => `<button class="contact" data-mc="${esc(e.conv.id)}">${av(e.conv, '')}<div class="mid"><b>${esc(c.name)} ↔ ${esc(e.conv.name)}</b><div class="last">${e.n} bericht${e.n === 1 ? '' : 'en'} · ${dayLabel(e.last)} ${hhmm(e.last)}</div></div><span style="font-size:24px">›</span></button>`).join('')}</div>` : `<div class="empty"><div class="e-ill">📭</div><p>Nog geen kopieën. Verbind met ${esc(c.name)} om ze op te halen.</p><button class="btn green" id="mConn">🔗 Verbinden met ${esc(c.name)}</button></div>`);
  $$('[data-mc]').forEach((b) => (b.onclick = () => openMirrorConv(childId, b.dataset.mc)));
  const mc = $('#mConn'); if (mc) mc.onclick = () => connectSheet(childId);
  $('#mirBack').onclick = () => show('home');
}
async function openMirrorConv(childId, convId, keep) {
  const c = S.contacts.get(childId); S.mirrorConv = convId;
  const all = (await DB.byIndex('mirror', 'child', childId)).filter((r) => r.conv && r.conv.id === convId).sort((a, b) => a.ts - b.ts);
  const other = all.length ? all[all.length - 1].conv : { name: '?' };
  $('#mirWho').innerHTML = `${av(other, 'sm')}<div style="min-width:0"><b>${esc(c.name)} ↔ ${esc(other.name)}</b><span class="pill">👀 kopie · alleen lezen</span></div>`;
  let html = '', lastDay = '';
  for (const r of all) {
    const d = new Date(r.ts).toDateString(); if (d !== lastDay) { html += `<div class="day">${dayLabel(r.ts)}</div>`; lastDay = d; }
    const m = Object.assign({}, r.m, { from: r.dir === 'out' ? S.me.id : 'x', status: r.status === 'receiving' ? 'receiving' : r.dir === 'out' ? 'delivered' : 'received', fid: r.fid || undefined });
    let h = await msgHtml(m);
    h = h.replace(/<span class="meta">[^<]*<\/span>/, `<span class="meta">${esc(r.dir === 'out' ? c.name : other.name)} · ${hhmm(r.ts)}${r.m && r.m.kind !== 'text' && !r.fid ? ' · bestand niet gekopieerd' : ''}</span>`);
    html += h;
  }
  const box = $('#mirBody'); box.innerHTML = html || '<div class="empty">Leeg</div>'; bindVoice(box); if (!keep) box.scrollTop = box.scrollHeight;
  $('#mirBack').onclick = () => openMirror(childId);
}

/* ---------- instellingen ---------- */
async function settingsSheet() {
  if (!(await askPin(isKid() ? 'Instellingen zijn voor papa of mama. Typ de pincode.' : 'Typ je pincode.'))) return;
  const sw = (k, on) => `<span class="sw ${on ? 'on' : ''}" data-sw="${k}" role="switch" aria-checked="${on}"></span>`;
  const ps = parents(), list = [...S.contacts.values()];
  const sh = sheet(`<h2>⚙️ Instellingen</h2>
    <div class="set-h">Ik</div><div class="set-list"><button class="set-item" id="stProf">${av(S.prof, 'sm')}<div class="mid"><b>${esc(S.prof.name)}</b><small>Naam, plaatje en kleur veranderen</small></div>›</button></div>
    <div class="set-h">Contacten</div><div class="set-list">${list.map((c) => `<button class="set-item" data-ct="${c.id}">${av(c, 'sm', online(c.id))}<div class="mid"><b>${esc(c.name)}</b><small>${c.role === 'parent' ? '👀 Leest mee (ouder)' : c.role === 'child' ? '👀 Jij leest mee (kind)' : isKid() ? 'Vriendje' : 'Contact'}</small></div>›</button>`).join('') || '<p class="muted">Nog geen contacten.</p>'}</div>
    ${isKid() ? `<div class="set-h">Meelezen</div><div class="set-list"><button class="set-item" id="stParent"><span class="ic">👀</span><div class="mid"><b>Ouder koppelen</b><small>Een ouder krijgt een kopie van alle gesprekken. Het kind en de vriendjes zien dat altijd.</small></div>›</button>
      ${ps.length ? `<div class="set-item"><span class="ic">📎</span><div class="mid"><b>Foto's, filmpjes en spraak ook kopiëren</b><small>Tot 50 MB per bestand. Uit = alleen tekst en bestandsnamen.</small></div>${sw('copyFiles', S.settings.copyFiles !== false)}</div>` : ''}</div>` : ''}
    <div class="set-h">App</div><div class="set-list">
      <div class="set-item"><span class="ic">💡</span><div class="mid"><b>Scherm aan houden</b><small>Als je verbonden bent. Gaat het scherm uit, dan stopt de verbinding meestal.</small></div>${sw('wake', S.settings.wake !== false)}</div>
      <div class="set-item"><span class="ic">🔔</span><div class="mid"><b>Geluidjes</b></div>${sw('sound', S.settings.sound !== false)}</div>
      <div class="set-item"><span class="ic">📣</span><div class="mid"><b>Meldingen</b><small>Een melding als er iets binnenkomt terwijl Kwebbel op de achtergrond nog verbonden is (Android en computer).</small></div>${sw('notify', !!S.settings.notify)}</div>
      <button class="set-item" id="stPin"><span class="ic">🔒</span><div class="mid"><b>Pincode veranderen</b></div>›</button>
      ${isInstalled() ? '' : '<button class="set-item" data-install><span class="ic">📲</span><div class="mid"><b>App op je beginscherm zetten</b></div>›</button>'}
      <button class="set-item" id="stHelp"><span class="ic">❓</span><div class="mid"><b>Hoe werkt Kwebbel?</b></div>›</button>
      <button class="set-item" id="stSafe"><span class="ic">🔐</span><div class="mid"><b>Veiligheid en versleuteling</b></div>›</button>
    </div>
    <div class="set-h">Wissen</div><div class="set-list">
      <button class="set-item" id="stClear"><span class="ic">🧹</span><div class="mid"><b>Alle gesprekken wissen</b><small>Op dit apparaat. Contacten blijven.</small></div>›</button>
      <button class="set-item" id="stReset"><span class="ic">🗑</span><div class="mid"><b>Kwebbel helemaal wissen</b><small>Alles weg: sleutels, contacten, gesprekken.</small></div>›</button>
    </div><p class="muted" style="text-align:center;font-size:14px;margin-top:16px">Kwebbel ${VERSION} · werkt zonder internet · geen server · geen reclame</p>`);
  $$('[data-sw]', sh).forEach((el) => (el.onclick = async () => {
    const k = el.dataset.sw; const v = !el.classList.contains('on');
    if (k === 'notify' && v) { if (!('Notification' in G)) { toast('Meldingen kunnen niet op dit apparaat'); return; } const p = await Notification.requestPermission(); if (p !== 'granted') { toast('Geen toestemming voor meldingen'); return; } }
    S.settings[k] = v; el.classList.toggle('on', v); el.setAttribute('aria-checked', v); await saveSettings(); if (k === 'wake') updateWake();
  }));
  $('#stProf', sh).onclick = () => { sh.close(); profileSheet(); };
  $$('[data-ct]', sh).forEach((b) => (b.onclick = () => { sh.close(); contactSheet(b.dataset.ct); }));
  const sp = $('#stParent', sh); if (sp) sp.onclick = () => { sh.close(); addFlow(true); };
  $('#stPin', sh).onclick = () => { const s2 = sheet('<h2>🔒 Nieuwe pincode</h2><div id="np"></div>'); pinPad($('#np', s2), 'Kies 4 nieuwe cijfers', (p1, ui) => { ui.reset('Nog een keer'); ui.next = async (p2) => { if (p1 !== p2) { ui.bad('Niet hetzelfde'); ui.next = null; return; } S.settings.pinHash = await KC.pinHash(p1, S.settings.pinSalt); await saveSettings(); s2.close(); toast('Pincode veranderd ✓'); }; }); };
  $$('[data-install]', sh).forEach((b) => (b.onclick = () => { sh.close(); openInstall(); }));
  $('#stHelp', sh).onclick = () => { sh.close(); showHelp(); };
  $('#stSafe', sh).onclick = () => { sh.close(); safetyInfo(); };
  $('#stClear', sh).onclick = () => confirmSheet('Alle gesprekken wissen?', 'Alle berichtjes, foto\'s en spraakberichtjes op dit apparaat worden gewist. Dit kan niet ongedaan worden.', 'Wissen', async () => { await DB.clear('msgs'); await DB.clear('files'); await DB.clear('copyq'); await DB.clear('mirror'); for (const c of S.contacts.values()) { c.lastText = ''; c.unread = 0; await saveContact(c); } sh.close(); toast('Gesprekken gewist'); refresh(); });
  $('#stReset', sh).onclick = () => confirmSheet('Kwebbel helemaal wissen?', 'Alles wordt gewist, ook je geheime sleutel. Je moet daarna al je vriendjes opnieuw toevoegen.', 'Alles wissen', async () => { S.sess.forEach((s) => s.close('reset')); await DB.wipe(); location.reload(); });
}
function confirmSheet(title, text, label, fn) {
  const sh = sheet(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="row"><button class="btn" data-close>Annuleren</button><button class="btn red" id="cfOk">${esc(label)}</button></div>`);
  $('#cfOk', sh).onclick = async () => { sh.close(); await fn(); };
}
async function contactSheet(id) {
  const c = S.contacts.get(id); if (!c) return;
  const code = await KC.safetyCode(S.me.sp, c.sp);
  const sh = sheet(`<div style="text-align:center">${av(c, 'lg')}<h2 style="margin:8px 0">${esc(c.name)}</h2>
    <p class="muted">${c.role === 'parent' ? '👀 Leest mee met dit apparaat' : c.role === 'child' ? '👀 Jij leest mee met dit kind' : isKid() ? 'Vriendje' : 'Contact'} · toegevoegd ${new Date(c.added || Date.now()).toLocaleDateString('nl-NL')}</p></div>
    <div class="safety"><p class="muted" style="margin-bottom:0">Geheime code (moet op beide apparaten hetzelfde zijn):</p><div class="emo">${code.emoji.join('')}</div><div class="num">${code.num}</div></div>
    <button class="btn block" id="ctClear">🧹 Gesprek wissen</button><button class="btn red block" id="ctDel">${c.role === 'parent' ? '👀 Ouder ontkoppelen' : '🗑 Verwijderen'}</button>`);
  $('#ctClear', sh).onclick = () => confirmSheet('Gesprek wissen?', `Het gesprek met ${c.name} wordt op dit apparaat gewist.`, 'Wissen', async () => { for (const m of await DB.byIndex('msgs', 'conv', id)) { if (m.fid) await DB.del('files', m.fid); } await DB.delWhere('msgs', 'conv', id); c.lastText = ''; await saveContact(c); sh.close(); toast('Gesprek gewist'); refresh(); });
  $('#ctDel', sh).onclick = () => confirmSheet(c.role === 'parent' ? 'Ouder ontkoppelen?' : `${c.name} verwijderen?`, c.role === 'parent' ? `${c.name} krijgt geen kopieën meer.` : `${c.name} kan dan geen berichtjes meer sturen. Om weer te kletsen moeten jullie opnieuw koppelen.`, c.role === 'parent' ? 'Ontkoppelen' : 'Verwijderen', async () => { await removeContact(id); sh.close(); S.sess.forEach((s) => s.send(myProf())); toast('Klaar'); });
}
function profileSheet() {
  const st = Object.assign({}, S.prof);
  const sh = sheet('');
  const r = () => {
    sh.set(`<h2>Mijn profiel</h2><div style="text-align:center">${av(st, 'lg')}</div><input class="field" id="pfName" maxlength="20" value="${esc(st.name)}" style="margin-top:10px">
      <div class="choose">${AVATARS.map((a) => `<button data-av="${a}" class="${a === st.avatar ? 'sel' : ''}">${a}</button>`).join('')}</div>
      <div class="choose colors">${COLORS.map((c) => `<button data-col="${c}" style="background:${c}" class="${c === st.color ? 'sel' : ''}">${c}</button>`).join('')}</div>
      <button class="btn primary block" id="pfSave">Bewaren</button><p class="muted" style="font-size:14px">Je vriendjes zien de nieuwe naam en het nieuwe plaatje de volgende keer dat jullie verbinden.</p>`);
    $('#pfName', sh).oninput = (e) => (st.name = e.target.value);
    $$('[data-av]', sh).forEach((b) => (b.onclick = () => { st.name = $('#pfName', sh).value; st.avatar = b.dataset.av; r(); }));
    $$('[data-col]', sh).forEach((b) => (b.onclick = () => { st.name = $('#pfName', sh).value; st.color = b.dataset.col; r(); }));
    $('#pfSave', sh).onclick = async () => { st.name = $('#pfName', sh).value.trim() || S.prof.name; S.prof = st; await DB.put('kv', st, 'prof'); S.sess.forEach((s) => s.send(myProf())); sh.close(); renderHome(); };
  };
  r();
}
function showHelp(first) {
  const steps = [
    ['👫', 'Vriendje toevoegen (één keer)', 'Samen met papa of mama: tik op ➕ en scan elkaars code. Zo kunnen alleen kinderen die je echt kent in je lijst komen.'],
    ['🔗', 'Verbinden', 'Wil je kletsen? Eén van jullie tikt op 🔗 Verbinden en laat de code zien, de ander tikt op 📷 Scan een code. Laat de app daarna openstaan.'],
    ['💬', 'Kletsen', 'Stuur berichtjes, emoji, foto\'s, filmpjes, bestanden en spraakberichtjes 🎤.'],
    ['📶', 'Hetzelfde wifi', 'Kwebbel werkt alleen als jullie op hetzelfde wifi zitten. Er gaat niets over internet.'],
    ['⏳', 'Niet verbonden?', 'Typ gerust. Je berichtjes wachten en gaan vanzelf zodra jullie weer verbonden zijn.'],
    ['🔒', 'Geheim', 'Alles is versleuteld. Alleen jij en je vriendje kunnen het lezen, en een ouder die meeleest. Dat zie je altijd aan 👀.'],
  ];
  return sheet(`<h2>${first ? 'Zo werkt Kwebbel 🎉' : '❓ Hoe werkt Kwebbel?'}</h2>${steps.map((s) => `<div class="help-step"><span class="hs-n">${s[0]}</span><div><b>${s[1]}</b><p>${s[2]}</p></div></div>`).join('')}
    ${isKid() ? '' : '<div class="note" style="margin:10px 0"><span class="n-ic">👀</span><div><b>Meelezen als ouder:</b> open Kwebbel op het apparaat van je kind › ⚙️ Instellingen › <b>Ouder koppelen</b>, en scan die code hier met 📷 Scan een code.</div></div>'}
    <button class="btn primary block" data-close>Begrepen!</button>`);
}
function safetyInfo() {
  sheet(`<h2>🔐 Veiligheid</h2>
    <div class="help-step"><span class="hs-n">📶</span><div><b>Geen server, geen internet</b><p>Berichten gaan rechtstreeks van apparaat naar apparaat over het wifi. Er is geen account, geen telefoonnummer en geen bedrijf dat meekijkt.</p></div></div>
    <div class="help-step"><span class="hs-n">🔑</span><div><b>Eigen sleutels</b><p>Elk apparaat heeft een eigen geheime sleutel die het apparaat nooit verlaat. Bij het koppelen gaan de openbare sleutels via de QR-code. Met de geheime code (plaatjes) controleer je dat er niemand tussen zit.</p></div></div>
    <div class="help-step"><span class="hs-n">🔒</span><div><b>Dubbel versleuteld</b><p>Elke verbinding is versleuteld door WebRTC (DTLS) en daarbovenop met AES-256-GCM, met een nieuwe sleutel voor elke verbinding (ECDH P-256, ondertekend met ECDSA).</p></div></div>
    <div class="help-step"><span class="hs-n">👫</span><div><b>Geen vreemden</b><p>Alleen apparaten die je zelf hebt gekoppeld (met de pincode) kunnen verbinden. Een code van iemand anders werkt niet.</p></div></div>
    <div class="help-step"><span class="hs-n">👀</span><div><b>Eerlijk meelezen</b><p>Een gekoppelde ouder krijgt kopieën, ook versleuteld. Het kind én de vriendjes zien altijd dat er een ouder meeleest.</p></div></div>
    <div class="help-step"><span class="hs-n">📱</span><div><b>Op het apparaat zelf</b><p>Gesprekken staan alleen op de apparaten zelf, in de opslag van de app (daar niet extra versleuteld). Beveilig het apparaat met een schermvergrendeling.</p></div></div>
    <button class="btn primary block" data-close>Sluiten</button>`);
}

/* ---------- installeren (zoals in de yoga-app) ---------- */
let deferredInstall = null;
G.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
G.addEventListener('appinstalled', () => { deferredInstall = null; toast('Kwebbel staat nu op je beginscherm ✓'); renderHome(); });
function isInstalled() { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true; }
function platform() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return { os: 'ios', dev: /iPad/.test(ua) || !/iPhone|iPod/.test(ua) ? 'iPad' : 'iPhone', browser: /CriOS/.test(ua) ? 'chrome' : /FxiOS/.test(ua) ? 'firefox' : /EdgiOS/.test(ua) ? 'edge' : /GSA|Instagram|FBAN|FBAV|WhatsApp/.test(ua) ? 'app' : 'safari' };
  if (/Android/.test(ua)) return { os: 'android', browser: /SamsungBrowser/.test(ua) ? 'samsung' : /Firefox/.test(ua) ? 'firefox' : /EdgA/.test(ua) ? 'edge' : 'chrome' };
  return { os: 'desktop', browser: /Edg\//.test(ua) ? 'edge' : /Firefox/.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other' };
}
const IC = {
  share: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>',
  dots: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
};
const stepHtml = (n, title, mock, text) => `<div class="ist"><div class="ist-n">${n}</div><div class="ist-b"><b>${title}</b><div class="ist-mock">${mock}</div><p>${text}</p></div></div>`;
function installSteps(pf) {
  const icon = '<img src="icons/icon-192.png" alt="" class="ist-app">';
  if (pf.os === 'ios') {
    const where = pf.dev === 'iPad' ? 'rechtsboven naast de adresbalk' : 'onderaan het scherm (soms rechts in de adresbalk)';
    const pre = pf.browser !== 'safari' ? `<div class="ist-warn"><b>Let op:</b> open deze link het liefst in <b>Safari</b>. In Chrome kan het ook (iOS 16.4 of nieuwer): tik op het deel-icoon ${IC.share} in de adresbalk en volg dezelfde stappen.</div>` : '';
    return pre + stepHtml(1, 'Tik op het deel-icoon', `<div class="mk-bar"><span>‹</span><span>›</span><span class="hl">${IC.share}</span><span>▢</span></div>`, `Het vierkantje met het pijltje omhoog, ${where}.`) +
      stepHtml(2, 'Kies “Zet op beginscherm”', `<div class="mk-list"><div>Kopieer</div><div>Voeg bladwijzer toe</div><div class="hl">Zet op beginscherm <span>${IC.plus}</span></div></div>`, 'Scroll een klein stukje naar beneden als je hem niet meteen ziet.') +
      stepHtml(3, 'Tik op “Voeg toe”', '<div class="mk-top"><span>Annuleer</span><b>Zet op beginscherm</b><span class="hl">Voeg toe</span></div>', 'Rechtsboven in het venster.') +
      stepHtml(4, 'Klaar!', `<div class="mk-home">${icon}<small>Kwebbel</small></div>`, 'Open Kwebbel voortaan met dit icoontje. <b>Let op:</b> de app op je beginscherm heeft een eigen geheugen. Stel Kwebbel daar in en koppel je vriendjes daar, niet in Safari.');
  }
  if (pf.os === 'android') {
    if (pf.browser === 'samsung') return stepHtml(1, 'Tik op het menu', '<div class="mk-bar"><span>‹</span><span>›</span><span>⌂</span><span>▣</span><span class="hl">☰</span></div>', 'De drie streepjes onderaan.') + stepHtml(2, 'Kies “Pagina toevoegen aan” › “Startscherm”', '<div class="mk-list"><div class="hl">Toevoegen aan startscherm</div></div>', 'Bevestig met “Toevoegen”.') + stepHtml(3, 'Klaar!', `<div class="mk-home">${icon}<small>Kwebbel</small></div>`, 'Het icoontje staat nu op je startscherm.');
    return stepHtml(1, 'Tik op de drie puntjes', `<div class="mk-addr"><span>🔒 kmhkasper-boop.github.io</span><span class="hl">${IC.dots}</span></div>`, 'Rechtsboven in Chrome.') +
      stepHtml(2, 'Kies “App installeren”', '<div class="mk-list"><div>Nieuw tabblad</div><div>Bladwijzers</div><div class="hl">App installeren</div></div>', 'Staat er “Toevoegen aan startscherm”? Dat is ook goed.') +
      stepHtml(3, 'Tik op “Installeren”', '<div class="mk-top"><span></span><b>App installeren?</b><span class="hl">Installeren</span></div>', '') +
      stepHtml(4, 'Klaar!', `<div class="mk-home">${icon}<small>Kwebbel</small></div>`, 'Open Kwebbel voortaan met dit icoontje.');
  }
  if (pf.browser === 'safari') return stepHtml(1, 'Kies in de menubalk “Archief”', '<div class="mk-list"><div class="hl">Voeg toe aan Dock…</div></div>', 'Op een Mac met macOS Sonoma of nieuwer. Daarna staat Kwebbel in je Dock.');
  if (pf.browser === 'firefox') return '<p>Firefox kan apps niet installeren. Open Kwebbel in <b>Chrome</b> of <b>Edge</b> en klik op het installeer-icoon in de adresbalk.</p>';
  return stepHtml(1, 'Klik op het installeer-icoon', '<div class="mk-addr"><span>🔒 kmhkasper-boop.github.io/kwebbel</span><span class="hl" style="font-size:22px">⊕</span></div>', 'Rechts in de adresbalk. Of via het menu ⋮ › “Opslaan en delen” › “App installeren”.') +
    stepHtml(2, 'Klik op “Installeren”', '<div class="mk-top"><span></span><b>App installeren?</b><span class="hl">Installeren</span></div>', 'Kwebbel opent in een eigen venster.');
}
async function openInstall() {
  if (isInstalled()) { toast('Kwebbel staat al op je beginscherm ✓'); return; }
  if (deferredInstall) { const ev = deferredInstall; deferredInstall = null; try { ev.prompt(); const r = await ev.userChoice; toast(r && r.outcome === 'accepted' ? 'Gelukt! Kwebbel komt op je beginscherm ✓' : 'Geen probleem, het kan later ook nog'); } catch (e) { showInstallSteps(); } return; }
  showInstallSteps();
}
function showInstallSteps() { const pf = platform(); sheet(`<h2>📲 Kwebbel op ${pf.os === 'ios' ? 'je ' + pf.dev : pf.os === 'android' ? 'je telefoon' : 'je computer'} zetten</h2><p class="muted" style="margin-top:0">Dan staat Kwebbel als icoontje op je beginscherm en werkt het zonder internet.</p>${installSteps(pf)}<button class="btn primary block" data-close>Begrepen</button>`, { cls: 'install-sheet' }); }

/* ---------- start ---------- */
$('#scanBtn').onclick = scanSheet;
$('#connBtn').onclick = () => connectSheet();
$('#addBtn').onclick = () => addFlow(false);
$('#setBtn').onclick = settingsSheet;
$('#meBtn').onclick = () => askPin('Je profiel veranderen? Typ de pincode.').then((ok) => ok && profileSheet());
$('#helpBtn').onclick = () => showHelp();
bindComposer();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { updateWake(); refresh(); if (S.chat) { const c = S.contacts.get(S.chat); if (c && c.unread) { c.unread = 0; saveContact(c); } } } });
G.addEventListener('beforeunload', (e) => { if (S.rx.size) { e.preventDefault(); e.returnValue = ''; } });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
Object.assign(G.KW, { DB, boot, openChat, connectSheet, addFlow, newMsg, sendFile, settingsSheet, openMirror, openMirrorConv, refresh, online, scanSheet, openInstall, LIVE_URL });
boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<p style="padding:20px">Kwebbel kon niet starten: ${esc(e.message)}</p>`); });
})(window);
