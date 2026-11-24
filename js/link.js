/* Kwebbel – directe verbinding tussen twee apparaten via WebRTC, zonder server.
   - Koppelen (eerste keer): A laat een QR-code zien, B scant hem en laat zijn antwoord-QR zien, A scant die.
   - Verbinden (daarna): A laat een QR-code zien, B scant hem — één scan is genoeg. A rekent B's antwoord zelf uit,
     want B's certificaat-vingerafdruk is bekend van het koppelen en B's ICE-gegevens volgen uit hun gedeelde geheim.
   - Daarna: handdruk met ondertekende tijdelijke sleutels, en alles versleuteld met AES-GCM. */
(function (G) {
  'use strict';
  const { b64u, unb64u, cat, te, td } = G.KC;
  const CHUNK = 16 * 1024;
  let CERT = null;
  async function cert() {
    if (CERT && CERT.expires - Date.now() > 30 * 864e5) return CERT;
    let c = await G.KDB.get('kv', 'cert');
    if (!c || c.expires - Date.now() < 30 * 864e5) { c = await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256', expires: 365 * 864e5 }); await G.KDB.put('kv', c, 'cert'); }
    CERT = c; return c;
  }
  const fpHex = (u8) => Array.from(u8, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const fpBytes = (s) => new Uint8Array(String(s).trim().split(':').map((h) => parseInt(h, 16)));
  async function myFp() { const c = await cert(); const f = c.getFingerprints().find((x) => x.algorithm === 'sha-256'); return b64u(fpBytes(f.value)); }

  /* ---------- compacte SDP (alleen wat nodig is) ---------- */
  function parseSdp(sdp) {
    const L = sdp.split(/\r?\n/); const get = (p) => { const l = L.find((x) => x.startsWith(p)); return l ? l.slice(p.length).trim() : ''; };
    const fl = get('a=fingerprint:').split(' ');
    const cands = [];
    for (const l of L) {
      const m = /^a=candidate:\S+ (\d) (udp) \d+ (\S+) (\d+) typ host/i.exec(l);
      if (m && m[1] === '1') cands.push({ a: m[3], p: +m[4] });
    }
    const v4 = cands.filter((c) => !c.a.includes(':')), v6 = cands.filter((c) => c.a.includes(':'));
    return { u: get('a=ice-ufrag:'), p: get('a=ice-pwd:'), f: fl[0] === 'sha-256' ? fpBytes(fl[1]) : new Uint8Array(32), c: v4.slice(0, 4).concat(v6.slice(0, Math.max(0, 5 - Math.min(4, v4.length)))) };
  }
  const UUID = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
  function packInfo(i) {
    const out = [1, i.u.length, ...te.encode(i.u), i.p.length, ...te.encode(i.p), ...i.f, i.c.length];
    for (const c of i.c) {
      let m;
      if (/^\d+\.\d+\.\d+\.\d+$/.test(c.a)) out.push(4, ...c.a.split('.').map(Number));
      else if ((m = UUID.exec(c.a))) { out.push(109); const h = m.slice(1).join(''); for (let k = 0; k < 32; k += 2) out.push(parseInt(h.slice(k, k + 2), 16)); }
      else { const s = te.encode(c.a); out.push(115, s.length, ...s); }
      out.push(c.p >> 8, c.p & 255);
    }
    return new Uint8Array(out);
  }
  function unpackInfo(u8, pos) {
    let p = pos || 0; if (u8[p++] !== 1) throw new Error('code');
    const rs = () => { const n = u8[p++]; const s = td.decode(u8.subarray(p, p + n)); p += n; return s; };
    const i = { u: rs(), p: rs(), f: u8.slice(p, p + 32), c: [] }; p += 32;
    const n = u8[p++];
    for (let k = 0; k < n; k++) {
      const t = u8[p++]; let a;
      if (t === 4) { a = Array.from(u8.subarray(p, p + 4)).join('.'); p += 4; }
      else if (t === 109) { const h = Array.from(u8.subarray(p, p + 16), (x) => x.toString(16).padStart(2, '0')).join(''); p += 16; a = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`; }
      else if (t === 115) { a = rs(); }
      else throw new Error('code');
      i.c.push({ a, p: u8[p] << 8 | u8[p + 1] }); p += 2;
    }
    return { info: i, end: p };
  }
  function candLine(c, k) { return `a=candidate:${k + 1} 1 udp ${2113937151 - k} ${c.a} ${c.p} typ host generation 0`; }
  function buildSdp(i, type) {
    const sid = Math.floor(Math.random() * 1e15);
    return ['v=0', `o=- ${sid} 2 IN IP4 127.0.0.1`, 's=-', 't=0 0', 'a=group:BUNDLE 0', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
      ...i.c.map(candLine), ...(i.c.length ? ['a=end-of-candidates'] : []),
      `a=ice-ufrag:${i.u}`, `a=ice-pwd:${i.p}`, `a=fingerprint:sha-256 ${fpHex(i.f)}`, `a=setup:${type === 'offer' ? 'actpass' : 'active'}`, 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', ''].join('\r\n');
  }
  const munge = (sdp, u, p) => sdp.replace(/a=ice-ufrag:.*\r?\n/g, `a=ice-ufrag:${u}\r\n`).replace(/a=ice-pwd:.*\r?\n/g, `a=ice-pwd:${p}\r\n`);

  /* ---------- QR-codes ---------- */
  const PFX = 'KWEBBEL1';
  const enc = (type, u8) => PFX + type + b64u(u8);
  function dec(code) {
    code = String(code || '').trim();
    if (!code.startsWith(PFX)) throw new Error('Dit is geen Kwebbel-code.');
    return { type: code[PFX.length], u8: unb64u(code.slice(PFX.length + 1)) };
  }
  const idBytes = (id) => unb64u(id), idStr = (u8) => b64u(u8);

  async function newPc() {
    const pc = new RTCPeerConnection({ iceServers: [], certificates: [await cert()] });
    const dc0 = pc.createDataChannel('kw', { negotiated: true, id: 0, ordered: true });
    const dc1 = pc.createDataChannel('kwf', { negotiated: true, id: 1, ordered: true });
    dc0.binaryType = dc1.binaryType = 'arraybuffer';
    return { pc, dc0, dc1 };
  }
  function gathered(pc, ms) {
    return new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, ms || 2500);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }

  /* Koppelen, stap 1 (A): QR met A's verbinding + hash van A's sleutels (+ 'word mijn ouder'-vlag) */
  async function pairOffer(me, flags) {
    const L = await newPc();
    await L.pc.setLocalDescription(await L.pc.createOffer()); await gathered(L.pc);
    const hash = await G.KC.keyHash(me.sp, me.ep);
    L.code = enc('P', cat(packInfo(parseSdp(L.pc.localDescription.sdp)), hash, new Uint8Array([flags || 0])));
    return L;
  }
  function readPair(code) {
    const d = dec(code); if (d.type !== 'P') throw new Error('type');
    const { info, end } = unpackInfo(d.u8); return { info, hash: d.u8.slice(end, end + 16), flags: d.u8[end + 16] || 0 };
  }
  /* Koppelen, stap 2 (B): antwoord-QR */
  async function pairAnswer(me, code) {
    const o = readPair(code);
    const L = await newPc();
    await L.pc.setRemoteDescription({ type: 'offer', sdp: buildSdp(o.info, 'offer') });
    await L.pc.setLocalDescription(await L.pc.createAnswer()); await gathered(L.pc);
    L.code = enc('A', cat(packInfo(parseSdp(L.pc.localDescription.sdp)), await G.KC.keyHash(me.sp, me.ep)));
    L.peerHash = o.hash; L.peerFp = b64u(o.info.f); L.flags = o.flags;
    return L;
  }
  /* Koppelen, stap 3 (A): antwoord inlezen */
  async function pairFinish(L, code) {
    const d = dec(code); if (d.type !== 'A') throw new Error('Dit is geen antwoord-code.');
    const { info, end } = unpackInfo(d.u8);
    L.peerHash = d.u8.slice(end, end + 16); L.peerFp = b64u(info.f);
    await L.pc.setRemoteDescription({ type: 'answer', sdp: buildSdp(info, 'answer') });
    return L;
  }

  /* Verbinden met een bekend contact, A: één QR-code */
  async function connectOffer(me, contact) {
    const L = await newPc();
    await L.pc.setLocalDescription(await L.pc.createOffer()); await gathered(L.pc);
    const nonce = G.KC.rnd(8);
    const cr = await G.KC.iceCreds(me, contact.ep, nonce);
    await L.pc.setRemoteDescription({ type: 'answer', sdp: buildSdp({ u: cr.u, p: cr.p, f: unb64u(contact.fp), c: [] }, 'answer') });
    L.code = enc('C', cat(packInfo(parseSdp(L.pc.localDescription.sdp)), idBytes(me.id), idBytes(contact.id), nonce));
    L.contactId = contact.id;
    return L;
  }
  function readConnect(code) {
    const d = dec(code); if (d.type !== 'C') throw new Error('type');
    const { info, end } = unpackInfo(d.u8);
    return { info, from: idStr(d.u8.slice(end, end + 9)), to: idStr(d.u8.slice(end + 9, end + 18)), nonce: d.u8.slice(end + 18, end + 26) };
  }
  /* B: scant en verbindt meteen; maakt ook een reserve-antwoord voor als het niet direct lukt */
  async function connectAnswer(me, contact, code) {
    const o = readConnect(code);
    if (G.KW_TEST_UNREACHABLE) o.info.c = [];   // test: B kan A's adressen niet bereiken (zoals bij mDNS-problemen)
    const L = await newPc();
    await L.pc.setRemoteDescription({ type: 'offer', sdp: buildSdp(o.info, 'offer') });
    const ans = await L.pc.createAnswer();
    const cr = await G.KC.iceCreds(me, contact.ep, o.nonce);
    await L.pc.setLocalDescription({ type: 'answer', sdp: munge(ans.sdp, cr.u, cr.p) });
    await gathered(L.pc, 2000);
    L.code = enc('R', cat(packInfo(parseSdp(L.pc.localDescription.sdp)), idBytes(me.id)));
    L.peerFp = b64u(o.info.f); L.contactId = contact.id;
    return L;
  }
  /* A: reserve-antwoord inlezen → B's adressen toevoegen */
  async function connectFallback(L, code) {
    const d = dec(code); if (d.type !== 'R') throw new Error('Dit is geen antwoord-code.');
    const { info, end } = unpackInfo(d.u8); const from = idStr(d.u8.slice(end, end + 9));
    if (from !== L.contactId) throw new Error('Deze code is van iemand anders.');
    const fp = b64u(info.f);
    for (let k = 0; k < info.c.length; k++) { try { await L.pc.addIceCandidate({ candidate: candLine(info.c[k], k).slice(2), sdpMid: '0', sdpMLineIndex: 0 }); } catch (e) {} }
    return { fp };
  }
  function codeType(code) { try { return dec(code).type; } catch (e) { return null; } }

  /* ---------- Sessie: handdruk + versleutelde berichten + bestanden ---------- */
  class Session {
    constructor(L, me, expect, h) {
      Object.assign(this, { pc: L.pc, dc0: L.dc0, dc1: L.dc1, me, expect, h, key: null, ready: false, closed: false, peer: null, last: Date.now() });
      this.qOut = Promise.resolve(); this.qIn = Promise.resolve(); this.qF = Promise.resolve();
      const d0 = this.dc0, d1 = this.dc1;
      d0.onopen = () => this.hello();
      if (d0.readyState === 'open') this.hello();
      d0.onmessage = (e) => { this.last = Date.now(); this.qIn = this.qIn.then(() => this.onFrame(e.data)).catch((err) => console.warn('kw frame', err)); };
      d1.onmessage = (e) => { this.last = Date.now(); this.qF = this.qF.then(() => this.onChunk(e.data)).catch((err) => console.warn('kw chunk', err)); };
      d1.bufferedAmountLowThreshold = 256 * 1024;
      d0.onclose = () => this.close('dc');
      this.pc.addEventListener('connectionstatechange', () => { const s = this.pc.connectionState; if (s === 'failed' || s === 'closed') this.close(s); this.h.onstate && this.h.onstate(s); });
      this.timer = setInterval(() => { if (this.ready) { this.send({ k: 'ping' }); if (Date.now() - this.last > 25000) this.close('timeout'); } }, 5000);
    }
    async hello() {
      if (this.helloSent) return; this.helloSent = true;
      this.eph = await G.KC.ephemeral();
      this.dc0.send(JSON.stringify({ t: 'h1', v: 1, id: this.me.id, sp: this.me.sp, ep: this.me.ep, eph: this.eph.pub }));
      if (this.peerH1) this.h2();
    }
    transcript() { const a = [[this.me.id, this.eph.pub], [this.peerH1.id, this.peerH1.eph]].sort((x, y) => (x[0] < y[0] ? -1 : 1)); return 'kwebbel1|' + a.map((x) => x.join(':')).join('|'); }
    async h2() { const sig = await G.KC.sign(this.me.signPriv, te.encode(this.transcript())); this.dc0.send(JSON.stringify({ t: 'h2', sig: b64u(sig) })); this.h2sent = true; await this.maybeReady(); }
    async onFrame(data) {
      if (!this.ready || typeof data === 'string') {
        if (typeof data !== 'string') { (this.pending = this.pending || []).push(data); return; }
        const m = JSON.parse(data);
        if (m.t === 'h1') {
          const ok = await this.checkPeer(m);
          if (!ok) { this.fail('Dit apparaat is niet wie het zegt te zijn. Verbinding gestopt.'); return; }
          this.peerH1 = m; if (this.eph) await this.h2();
        } else if (m.t === 'h2') {
          if (!this.peerH1 || !this.eph) return;
          if (!(await G.KC.verify(this.peerH1.sp, unb64u(m.sig), te.encode(this.transcript())))) { this.fail('Handtekening klopt niet. Verbinding gestopt.'); return; }
          this.peerH2 = true; await this.maybeReady();
        }
        return;
      }
      const plain = await G.KC.open(this.key, new Uint8Array(data));
      const m = JSON.parse(td.decode(plain));
      if (m.k === 'ping') return;
      this.h.onmsg && this.h.onmsg(m, this);
    }
    async checkPeer(m) {
      if (m.v !== 1 || !m.id || !m.sp || !m.ep || !m.eph) return false;
      if ((await G.KC.idFromSp(m.sp)) !== m.id) return false;
      const e = this.expect;
      if (e.hash) { const h = await G.KC.keyHash(m.sp, m.ep); return G.KC.cmp(h, e.hash) === 0; }
      if (e.contact) return e.contact.id === m.id && e.contact.sp === m.sp && e.contact.ep === m.ep;
      if (e.lookup) { const c = await e.lookup(m.id); if (c && c.sp === m.sp && c.ep === m.ep) { e.contact = c; return true; } }
      return false;
    }
    async maybeReady() {
      if (this.ready || this.readying || !this.peerH2 || !this.h2sent) return;
      this.readying = true;
      this.peer = { id: this.peerH1.id, sp: this.peerH1.sp, ep: this.peerH1.ep };
      this.key = await G.KC.sessionKey(this.me, this.eph, this.peer, this.peerH1.eph, this.transcript());
      this.ready = true;
      this.h.onready && this.h.onready(this);
      const p = this.pending || []; this.pending = null;   // berichten die al binnen waren vóór de sleutel klaar was
      for (const d of p) this.qIn = this.qIn.then(() => this.onFrame(d)).catch((err) => console.warn('kw frame', err));
    }
    fail(msg) { this.h.onerror && this.h.onerror(msg); this.close('auth'); }
    send(obj) {
      if (!this.ready || this.closed) return Promise.resolve(false);
      return (this.qOut = this.qOut.then(async () => { if (this.dc0.readyState !== 'open') return false; this.dc0.send(await G.KC.seal(this.key, te.encode(JSON.stringify(obj)))); return true; }).catch(() => false));
    }
    async sendFile(fid, blob, onprog) {
      const fb = unb64u(fid), n = Math.ceil(blob.size / CHUNK) || 1;
      for (let i = 0; i < n; i++) {
        if (this.closed || this.dc1.readyState !== 'open') return false;
        const data = new Uint8Array(await blob.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer());
        const hdr = new Uint8Array(12); hdr.set(fb.subarray(0, 8)); new DataView(hdr.buffer).setUint32(8, i);
        const frame = await G.KC.seal(this.key, cat(hdr, data));
        while (this.dc1.bufferedAmount > 1024 * 1024) { await new Promise((r) => { const t = setTimeout(r, 200); this.dc1.onbufferedamountlow = () => { clearTimeout(t); r(); }; }); if (this.closed) return false; }
        try { this.dc1.send(frame); } catch (e) { return false; }
        if (onprog && (i % 8 === 0 || i === n - 1)) onprog((i + 1) / n);
      }
      return true;
    }
    async onChunk(data) {
      if (!this.ready) { await new Promise((r) => { const t = setInterval(() => { if (this.ready || this.closed) { clearInterval(t); r(); } }, 20); }); if (!this.ready) return; }
      const plain = await G.KC.open(this.key, new Uint8Array(data));
      const fid = b64u(plain.slice(0, 8)), idx = new DataView(plain.buffer, plain.byteOffset + 8, 4).getUint32(0);
      this.h.onchunk && this.h.onchunk(fid, idx, plain.slice(12), this);
    }
    close(why) {
      if (this.closed) return; this.closed = true; clearInterval(this.timer);
      try { this.pc.close(); } catch (e) {}
      this.h.onclose && this.h.onclose(why, this);
    }
  }
  const fidNew = () => b64u(G.KC.rnd(8));
  G.KLink = { cert, myFp, pairOffer, readPair, pairAnswer, pairFinish, connectOffer, readConnect, connectAnswer, connectFallback, codeType, Session, fidNew, CHUNK, _: { parseSdp, packInfo, unpackInfo, buildSdp } };
})(window);
