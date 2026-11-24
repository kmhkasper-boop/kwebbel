/* Kwebbel – camera (QR scannen), spraakberichten, geluidjes, scherm aan houden. */
(function (G) {
  'use strict';
  /* ---------- QR-code scannen ---------- */
  function scan(video, onText) {
    let stop = false, stream = null;
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const det = ('BarcodeDetector' in G) ? (() => { try { return new G.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { return null; } })() : null;
    const tick = async () => {
      if (stop) return;
      if (video.readyState >= 2 && video.videoWidth) {
        try {
          let txt = null;
          if (det) { const r = await det.detect(video); if (r && r[0]) txt = r[0].rawValue; }
          if (!txt && G.jsQR) {
            const w = Math.min(720, video.videoWidth), h = Math.round(video.videoHeight * (w / video.videoWidth));
            canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
            const r = G.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            if (r && r.data) txt = r.data;
          }
          if (txt && !stop) { const keep = onText(txt); if (keep !== true) return; }
        } catch (e) {}
      }
      setTimeout(tick, 160);
    };
    const start = navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => { stream = s; if (stop) { s.getTracks().forEach((t) => t.stop()); return; } video.setAttribute('playsinline', ''); video.muted = true; video.srcObject = s;
        const st = s.getVideoTracks()[0] && s.getVideoTracks()[0].getSettings ? s.getVideoTracks()[0].getSettings() : {};
        if (st.facingMode === 'user' || (!st.facingMode && !/Android|iPhone|iPad/.test(navigator.userAgent))) video.style.transform = 'scaleX(-1)';
        return video.play(); })
      .then(tick);
    return { start, stop() { stop = true; if (stream) stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; } };
  }

  /* ---------- spraakberichten ---------- */
  function pickMime() {
    if (!G.MediaRecorder) return null;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const webkit = !G.chrome && /Safari/.test(navigator.userAgent);
    const list = (ios || webkit) ? ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac'] : ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const t of list) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {} }
    return '';
  }
  /* AAC in mp4 speelt overal af (iPhone, Android, pc). Anders zetten we de opname om naar WAV (16 kHz mono). */
  function playsEverywhere(mime) { return /mp4a|aac/.test(mime) || (/^audio\/mp4/.test(mime) && !G.chrome); }
  async function recorder(onLevel) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
    const parts = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    let ac = null, raf = 0;
    try {
      ac = new (G.AudioContext || G.webkitAudioContext)(); const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); onLevel && onLevel(Math.min(1, m / 70)); raf = requestAnimationFrame(loop); };
      loop();
    } catch (e) {}
    const t0 = Date.now(); rec.start(250);
    return {
      mime: rec.mimeType || mime,
      elapsed: () => (Date.now() - t0) / 1000,
      stop() {
        return new Promise((res) => {
          rec.onstop = async () => {
            cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); if (ac) ac.close().catch(() => {});
            const type = rec.mimeType || mime || 'audio/webm';
            let blob = new Blob(parts, { type: type.split(';')[0] }); const dur = (Date.now() - t0) / 1000;
            if (!playsEverywhere(type)) { try { blob = await toWav(blob); } catch (e) { console.warn('wav', e); } }
            res({ blob, dur });
          };
          if (rec.state !== 'inactive') rec.stop(); else rec.onstop();
        });
      },
      cancel() { try { rec.onstop = null; rec.stop(); } catch (e) {} cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); if (ac) ac.close().catch(() => {}); },
    };
  }
  async function toWav(blob, rate) {
    rate = rate || 16000;
    const ac = new (G.AudioContext || G.webkitAudioContext)();
    const src = await new Promise((res, rej) => { blob.arrayBuffer().then((ab) => { const p = ac.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); }, rej); });
    ac.close().catch(() => {});
    const len = Math.max(1, Math.ceil(src.duration * rate));
    const off = new (G.OfflineAudioContext || G.webkitOfflineAudioContext)(1, len, rate);
    const s = off.createBufferSource(); s.buffer = src; s.connect(off.destination); s.start();
    const out = await off.startRendering(); const d = out.getChannelData(0);
    const buf = new ArrayBuffer(44 + d.length * 2), v = new DataView(buf);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, d.length * 2, true);
    for (let i = 0; i < d.length; i++) { const x = Math.max(-1, Math.min(1, d[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }

  /* ---------- geluidjes ---------- */
  let actx = null;
  function chime(kind) {
    try {
      actx = actx || new (G.AudioContext || G.webkitAudioContext)();
      const notes = kind === 'connect' ? [523, 659, 784] : kind === 'sent' ? [880] : [784, 1047];
      notes.forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.value = f;
        const t = actx.currentTime + i * 0.11; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.3);
      });
    } catch (e) {}
  }
  /* ---------- scherm aan houden ---------- */
  let lock = null;
  async function wake(on) {
    try {
      if (on && !lock && 'wakeLock' in navigator && document.visibilityState === 'visible') { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
      if (!on && lock) { await lock.release(); lock = null; }
    } catch (e) { lock = null; }
  }
  G.KMedia = { scan, recorder, toWav, pickMime, playsEverywhere, chime, wake };
})(window);
