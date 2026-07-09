/* =========================================================================
   OrbitPool — áudio por AMOSTRAS (arquivos em public/sfx e public/music).
   Efeitos tocados via Web Audio (variação de volume/tom pela força do
   impacto). Música de fundo em loop via <audio> roteado pelo mesmo mixer.
   Três barramentos: master (geral) → destino; sfx e music → master.
   Se um arquivo falhar ao carregar, cai no som SINTETIZADO (fallback).
   Volumes persistidos em localStorage.
     OrbitAudio.unlock()                          liberar no 1º gesto
     OrbitAudio.cue(speed)/clack(v)/cushion(v)/pocket()
     OrbitAudio.win()/lose()/foul()
     OrbitAudio.setVolume('master'|'sfx'|'music',0..1)/getVolume(bus)
     OrbitAudio.setMuted(b)/toggleMute()/isMuted()
     OrbitAudio.startMusic()/stopMusic()
   Velocidades em unidades/s da física (tacada máx ≈ 1650).
   ========================================================================= */
'use strict';

window.OrbitAudio = (function () {
  const VREF = 1650;
  const LSKEY = 'orbitpool.audio';
  const SAMPLES = {
    crack: 'sfx/crack.mp3',   // tacada + colisão bola-bola
    thud1: 'sfx/thud1.mp3',   // batida na tabela (variação 1)
    thud2: 'sfx/thud2.mp3',   // batida na tabela (variação 2)
    pocket: 'sfx/pocket.mp3', // bola na caçapa
    win: 'sfx/win.mp3',       // vitória
    lose: 'sfx/lose.mp3',     // derrota
    foul: 'sfx/foul.mp3',     // falta / bola branca encaçapada
  };
  const MUSIC_TRACKS = [
    'music/music1.mp3', 'music/music2.mp3', 'music/music3.mp3',
    'music/amassado-e-jogado.mp3', 'music/cola-no-interior.mp3',
    'music/ligacoes-a-noite.mp3', 'music/se-ela-me-ouvisse-cantar.mp3',
    'music/festa-do-interior.mp3', 'music/o-campeao-sertanejo.mp3',
    'music/angel-in-my-eyes.mp3', 'music/american-western-country.mp3',
  ];

  let ctx = null, master = null, sfx = null, music = null;
  let muted = false;
  let vol = { master: 0.8, sfx: 0.9, music: 0.15 }; // música baixa (ambiente)
  const buffers = {};           // name → AudioBuffer
  let loadStarted = false;
  let musicEl = null, musicSrcNode = null, musicIdx = 0;
  let lastAt = 0, burst = 0;

  // --- persistência (volumes, mudo e última faixa tocada) ---
  let savedTrack = -1;
  try {
    const s = JSON.parse(localStorage.getItem(LSKEY) || '{}');
    if (s && typeof s === 'object') {
      ['master', 'sfx', 'music'].forEach((k) => { if (typeof s[k] === 'number') vol[k] = s[k]; });
      if (typeof s.muted === 'boolean') muted = s.muted;
      if (typeof s.track === 'number' && s.track >= 0 && s.track < MUSIC_TRACKS.length) savedTrack = s.track;
    }
  } catch (e) {}
  function persist() { try { localStorage.setItem(LSKEY, JSON.stringify({ ...vol, muted, track: musicIdx })); } catch (e) {} }

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); sfx = ctx.createGain(); music = ctx.createGain();
    sfx.connect(master); music.connect(master); master.connect(ctx.destination);
    applyGains();
    loadAll();
    return true;
  }
  function applyGains() {
    if (!ctx) return;
    master.gain.value = muted ? 0 : vol.master;
    sfx.gain.value = vol.sfx;
    music.gain.value = vol.music;
  }

  // Carrega e decodifica as amostras uma vez.
  function loadAll() {
    if (loadStarted || !ctx) return; loadStarted = true;
    Object.keys(SAMPLES).forEach((name) => {
      fetch(SAMPLES[name])
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => { buffers[name] = buf; })
        .catch(() => { /* fica sem essa amostra → usa fallback sintetizado */ });
    });
  }

  // Libera o AudioContext num gesto do usuário (necessário p/ tocar áudio).
  // NÃO inicia a música aqui — ela só começa quando a partida começa
  // (OrbitAudio.startMusic()), então o lobby fica sem música.
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function norm(v) { return clamp(Math.sqrt(clamp(v, 0, VREF) / VREF), 0, 1); }
  function allow() {
    const now = (ctx && ctx.currentTime) || 0;
    if (now - lastAt > 0.05) burst = 0;
    lastAt = now; burst++;
    return burst <= 8;
  }
  function guard() { if (muted) return false; if (!ensure()) return false; if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return true; }

  // Toca uma amostra: gain (0..~1.3) e rate (pitch). Retorna true se tocou.
  function play(name, gain, rate) {
    const buf = buffers[name]; if (!buf) return false;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = rate || 1;
    const g = ctx.createGain(); g.gain.value = clamp(gain == null ? 1 : gain, 0, 1.5);
    src.connect(g).connect(sfx);
    src.start(t);
    return true;
  }

  // --- Fallback sintetizado (usado só se a amostra não carregar) ----------
  function ping(freq, dur, gain, type) {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.7), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(sfx); osc.start(t); osc.stop(t + dur + 0.02);
  }
  function noise(dur, gain, filtType, filtFreq, Q) {
    const t = ctx.currentTime;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = filtType || 'highpass'; f.frequency.value = filtFreq || 2000; if (Q) f.Q.value = Q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(sfx); src.start(t); src.stop(t + dur + 0.02);
  }
  function synthCue(a) { noise(0.012, 0.5 * a, 'bandpass', 1400, 1); ping(520 + 120 * a, 0.09, 0.22 * a, 'triangle'); ping(240, 0.13, 0.14 * a, 'sine'); }
  function synthClack(a) { const f = 1700 + 1400 * a; noise(0.006, 0.35 * (0.4 + a), 'highpass', 2500); ping(f, 0.05, 0.30 * (0.3 + a), 'sine'); ping(f * 1.5, 0.03, 0.16 * (0.3 + a), 'sine'); }
  function synthCushion(a) { noise(0.02, 0.28 * (0.4 + a), 'lowpass', 900, 0.7); ping(300 + 220 * a, 0.09, 0.22 * (0.3 + a), 'sine'); ping(150, 0.12, 0.12 * a, 'sine'); }
  function synthPocket() { noise(0.03, 0.22, 'bandpass', 700, 0.8); ping(220, 0.10, 0.18, 'sine'); }

  // --- Sons públicos -------------------------------------------------------
  function cue(speed) {
    if (!guard()) return;
    const a = clamp(0.35 + norm(speed) * 0.65, 0.15, 1);
    // taco: mesma amostra da batida, tom mais grave para soar como "knock".
    if (!play('crack', 0.55 * a, 0.82 + norm(speed) * 0.06)) synthCue(a);
  }
  function clack(v) {
    if (!guard() || !allow()) return;
    const a = norm(v); if (a < 0.02) return;
    const rate = 0.92 + a * 0.32 + (Math.random() - 0.5) * 0.06;
    if (!play('crack', 0.35 + a * 0.65, rate)) synthClack(a);
  }
  function cushion(v) {
    if (!guard() || !allow()) return;
    const a = norm(v); if (a < 0.03) return;
    const name = Math.random() < 0.5 ? 'thud1' : 'thud2';
    const rate = 0.9 + a * 0.25 + (Math.random() - 0.5) * 0.05;
    if (!play(name, 0.3 + a * 0.7, rate)) synthCushion(a);
  }
  function pocket() { if (!guard()) return; if (!play('pocket', 0.9, 1)) synthPocket(); }
  function win() { if (!guard()) return; play('win', 0.9, 1); }
  function lose() { if (!guard()) return; play('lose', 0.9, 1); }
  function foul() { if (!guard()) return; play('foul', 0.8, 1); }

  // --- Música de fundo: alterna entre as 3 faixas em loop contínuo ---------
  function playCurrent() { if (!musicEl) return; const p = musicEl.play(); if (p && p.catch) p.catch(() => {}); }
  function nextTrack() { // ao terminar uma faixa, emenda a próxima (volta ao início após a última)
    if (!musicEl) return;
    musicIdx = (musicIdx + 1) % MUSIC_TRACKS.length;
    musicEl.src = MUSIC_TRACKS[musicIdx];
    persist(); // lembra a faixa p/ próxima sessão
    playCurrent();
  }
  function startMusic() {
    if (!ensure() || muted || vol.music <= 0) return;
    if (!musicEl) {
      // retoma a última faixa da sessão anterior; sem histórico, sorteia
      musicIdx = savedTrack >= 0 ? savedTrack : Math.floor(Math.random() * MUSIC_TRACKS.length);
      musicEl = new Audio(MUSIC_TRACKS[musicIdx]);
      musicEl.preload = 'auto'; musicEl.crossOrigin = 'anonymous';
      musicEl.addEventListener('ended', nextTrack); // encadeia as 3 sem parar
      try { musicSrcNode = ctx.createMediaElementSource(musicEl); musicSrcNode.connect(music); }
      catch (e) { musicSrcNode = null; } // se falhar, o <audio> toca direto (sem bus)
    }
    playCurrent();
  }
  function stopMusic() { if (musicEl) { try { musicEl.pause(); } catch (e) {} } }

  // --- Controles de playlist (atalhos de teclado) ---------------------------
  function titleOf(i) { // nome do arquivo → título legível ("cola-no-interior" → "cola no interior")
    return MUSIC_TRACKS[i].split('/').pop().replace(/\.mp3$/, '').replace(/[-_]+/g, ' ');
  }
  function musicInfo() {
    return { idx: musicIdx, total: MUSIC_TRACKS.length, title: titleOf(musicIdx), playing: !!(musicEl && !musicEl.paused) };
  }
  function skipMusic(dir) {
    unlock();
    if (!musicEl) { startMusic(); return musicInfo(); }
    musicIdx = (musicIdx + dir + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
    musicEl.src = MUSIC_TRACKS[musicIdx];
    persist(); // lembra a faixa p/ próxima sessão
    playCurrent();
    return musicInfo();
  }
  function nextMusic() { return skipMusic(1); }
  function prevMusic() { return skipMusic(-1); }
  function toggleMusic() { // pause ↔ play
    unlock();
    if (!musicEl) { startMusic(); return musicInfo(); }
    if (musicEl.paused) playCurrent(); else { try { musicEl.pause(); } catch (e) {} }
    return musicInfo();
  }

  // --- Controles de volume/mudo -------------------------------------------
  function setVolume(bus, v) {
    v = clamp(+v || 0, 0, 1); if (!(bus in vol)) return;
    vol[bus] = v; persist(); ensure(); applyGains();
    if (bus === 'music') { if (v > 0 && !muted) { unlock(); startMusic(); } else if (v === 0) stopMusic(); }
  }
  function getVolume(bus) { return vol[bus]; }
  function setMuted(b) { muted = !!b; persist(); applyGains(); if (muted) stopMusic(); else if (vol.music > 0) startMusic(); }
  function toggleMute() { setMuted(!muted); return muted; }
  function isMuted() { return muted; }

  return { unlock, cue, clack, cushion, pocket, win, lose, foul, startMusic, stopMusic,
    nextMusic, prevMusic, toggleMusic, musicInfo,
    setVolume, getVolume, setMuted, toggleMute, isMuted };
})();
