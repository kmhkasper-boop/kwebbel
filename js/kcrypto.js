/* Kwebbel – versleuteling (WebCrypto).
   Elk apparaat heeft een eigen sleutelpaar: ECDH P-256 (geheime sleutels afspreken) en ECDSA P-256 (ondertekenen).
   Per verbinding wordt een nieuwe tijdelijke sleutel gemaakt (forward secrecy); berichten gaan met AES-256-GCM,
   bovenop de DTLS-versleuteling van WebRTC zelf. Privésleutels kunnen niet uit het apparaat worden geëxporteerd. */
(function (G) {
  'use strict';
  const S = crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
  const b64u = (u8) => { u8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = (s) => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const cat = (...a) => { const n = a.reduce((x, y) => x + y.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const sha = async (u8) => new Uint8Array(await S.digest('SHA-256', u8));
  const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
  const ECDH = { name: 'ECDH', namedCurve: 'P-256' }, ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
  const cmp = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; };

  async function newIdentity() {
    const dh = await S.generateKey(ECDH, false, ['deriveBits']);
    const sg = await S.generateKey(ECDSA, false, ['sign', 'verify']);
    const ep = new Uint8Array(await S.exportKey('raw', dh.publicKey));
    const sp = new Uint8Array(await S.exportKey('raw', sg.publicKey));
    const id = b64u((await sha(sp)).slice(0, 9));
    return { id, dhPriv: dh.privateKey, signPriv: sg.privateKey, ep: b64u(ep), sp: b64u(sp) };
  }
  /* 16-byte hash van beide publieke sleutels: staat in de QR-code van het koppelen */
  async function keyHash(sp, ep) { return (await sha(cat(unb64u(sp), unb64u(ep)))).slice(0, 16); }
  async function idFromSp(sp) { return b64u((await sha(unb64u(sp))).slice(0, 9)); }
  const impDH = (raw) => S.importKey('raw', unb64u(raw), ECDH, false, []);
  const impSig = (raw) => S.importKey('raw', unb64u(raw), ECDSA, false, ['verify']);
  async function dhBits(priv, pubRaw) { return new Uint8Array(await S.deriveBits({ name: 'ECDH', public: await impDH(pubRaw) }, priv, 256)); }
  async function hkdfBytes(ikm, salt, info, n) {
    const k = await S.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) }, k, n * 8));
  }
  async function hkdfKey(ikm, salt, info) {
    const k = await S.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    return S.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function sign(priv, data) { return new Uint8Array(await S.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, data)); }
  async function verify(spRaw, sig, data) { try { return await S.verify({ name: 'ECDSA', hash: 'SHA-256' }, await impSig(spRaw), sig, data); } catch (e) { return false; } }
  async function ephemeral() { const k = await S.generateKey(ECDH, false, ['deriveBits']); return { priv: k.privateKey, pub: b64u(new Uint8Array(await S.exportKey('raw', k.publicKey))) }; }

  /* ICE-gebruikersnaam en -wachtwoord voor 'snel verbinden' met één scan: beide kanten kunnen ze uitrekenen
     uit hun gedeelde geheim + het willekeurige nummer uit de QR-code. */
  const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  async function iceCreds(me, peerEp, nonce) {
    const b = await hkdfBytes(await dhBits(me.dhPriv, peerEp), nonce, 'kwebbel-ice-v1', 32);
    const s = Array.from(b, (x) => ALNUM[x % 62]).join('');
    return { u: s.slice(0, 8), p: s.slice(8, 32) };
  }
  /* Sessiesleutel: tijdelijke ECDH + vaste ECDH, gehasht met het hele handdruk-transcript */
  async function sessionKey(me, eph, peer, peerEph, transcript) {
    const a = await dhBits(eph.priv, peerEph), b = await dhBits(me.dhPriv, peer.ep);
    return hkdfKey(cat(a, b), await sha(te.encode(transcript)), 'kwebbel-session-v1');
  }
  async function seal(key, plain) { const iv = rnd(12); const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv }, key, plain)); return cat(iv, ct); }
  async function open(key, u8) { u8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8); return new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, key, u8.subarray(12))); }

  /* Veiligheidscode: 6 plaatjes + 6 cijfers, hetzelfde op beide apparaten */
  const EMO = ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦉','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐢','🐍','🐙','🦀','🐠','🐬','🐳','🦈','🐊','🦒','🐘','🦔','🍎','🍌','🍉','🍓','🍒','🥕','🌽','🍕','🍩','🍪','🎂','⚽','🏀','🎈','🎁','⭐','🌙','☀️','🌈','❄️','🔥','🚀','🚲','🎸','🎨'];
  async function safetyCode(spA, spB) {
    const a = unb64u(spA), b = unb64u(spB);
    const h = await sha(cmp(a, b) < 0 ? cat(a, b) : cat(b, a));
    const emoji = Array.from(h.slice(0, 6), (x) => EMO[x % 64]);
    const num = ((h[6] << 16 | h[7] << 8 | h[8]) % 1000000).toString().padStart(6, '0');
    return { emoji, num: num.slice(0, 3) + ' ' + num.slice(3) };
  }
  async function pinHash(pin, salt) { const k = await S.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveBits']); return b64u(new Uint8Array(await S.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64u(salt), iterations: 150000 }, k, 256))); }

  G.KC = { b64u, unb64u, cat, sha, rnd, te, td, cmp, newIdentity, keyHash, idFromSp, iceCreds, ephemeral, sessionKey, sign, verify, seal, open, safetyCode, pinHash };
})(window);
