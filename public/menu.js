/* =========================================================================
   OrbitPool — menu de pausa (ESC) + configurações, compartilhado por 2D e 3D.
   Injeta o próprio HTML/CSS, então os dois modos ficam idênticos.
     OrbitMenu.init({ has3D, onQuit })  → monta e liga o ESC
     OrbitMenu.open() / close() / isOpen()
   OrbitSettings guarda a sensibilidade da câmera (multiplicador) persistida.
   Volumes ficam no OrbitAudio.
   ========================================================================= */
'use strict';

window.OrbitSettings = (function () {
  const LSKEY = 'orbitpool.settings';
  // Sensibilidade por EIXO (multiplicadores 0.25–2.5, 1 = padrão):
  //   sensX = mouse horizontal (girar o taco); sensY = vertical (altura da câmera).
  let s = { sensX: 1.0, sensY: 1.0 };
  try {
    const j = JSON.parse(localStorage.getItem(LSKEY) || '{}');
    if (j && typeof j.sensitivity === 'number') { s.sensX = j.sensitivity; s.sensY = j.sensitivity; } // migra o formato antigo
    if (j && typeof j.sensX === 'number') s.sensX = j.sensX;
    if (j && typeof j.sensY === 'number') s.sensY = j.sensY;
  } catch (e) {}
  function save() { try { localStorage.setItem(LSKEY, JSON.stringify(s)); } catch (e) {} }
  const clampS = (v) => Math.max(0.25, Math.min(2.5, +v || 1));
  return {
    sensitivity() { return s.sensX; }, // compat: quem chamar o antigo recebe o X
    setSensitivity(v) { s.sensX = clampS(v); save(); },
    sensitivityX() { return s.sensX; },
    sensitivityY() { return s.sensY; },
    setSensitivityX(v) { s.sensX = clampS(v); save(); },
    setSensitivityY(v) { s.sensY = clampS(v); save(); },
  };
})();

window.OrbitMenu = (function () {
  let root = null, pause = null, settings = null, opts = { has3D: false, onQuit: null };
  let open = false;

  const CSS = `
  #obm-root{position:fixed;inset:0;z-index:60;display:none;font-family:'Kalam',cursive;}
  #obm-root.show{display:block;}
  .obm-ovl{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
    background:rgba(6,10,8,.62);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
  .obm-ovl.show{display:flex;}
  .obm-card{position:relative;padding:26px 24px;width:min(92vw,360px);text-align:center;color:#f3ecdb;
    border-radius:14px;border:9px solid transparent;
    background:radial-gradient(120% 90% at 30% 10%, #2f3b34, #1c241f 80%) padding-box,
      linear-gradient(135deg,#7a4a1e,#5a3413) border-box;
    box-shadow:0 24px 70px rgba(0,0,0,.55), inset 0 0 40px rgba(0,0,0,.6);}
  .obm-card h2{margin:0 0 4px;font-family:'Pacifico',cursive;font-weight:400;font-size:24px;color:#fff;
    text-shadow:0 1px 0 rgba(0,0,0,.4);}
  .obm-card h2 span{color:#ffd24a;}
  .obm-sub{color:#cbb892;font-size:14px;margin:0 0 18px;}
  .obm-btn{display:block;width:100%;margin:10px 0 0;padding:13px;border:0;border-radius:11px;
    font-family:'Permanent Marker',cursive;font-size:16px;cursor:pointer;color:#3a1e05;
    background:linear-gradient(180deg,#ffd24a,#e69a1a);
    box-shadow:0 5px 0 #a86a10, 0 8px 18px rgba(0,0,0,.35);transition:transform .08s,box-shadow .15s;}
  .obm-btn:hover{transform:translateY(1px);box-shadow:0 4px 0 #a86a10, 0 6px 14px rgba(0,0,0,.35);}
  .obm-btn:active{transform:translateY(2px);}
  .obm-btn.ghost{background:rgba(255,210,74,.08);color:#ffd24a;border:1.5px dashed rgba(255,210,74,.5);box-shadow:none;}
  .obm-btn.ghost:hover{background:rgba(255,210,74,.16);transform:none;}
  .obm-btn.danger{background:transparent;color:#ff8a76;border:1.5px dashed rgba(255,122,102,.55);box-shadow:none;}
  .obm-btn.danger:hover{background:rgba(255,122,102,.12);transform:none;}
  .obm-row{text-align:left;margin:16px 0;}
  .obm-row label{display:flex;justify-content:space-between;font-size:14px;color:#cbb892;margin-bottom:7px;}
  .obm-row label b{color:#f3ecdb;font-weight:700;font-family:'Oswald',sans-serif;}
  .obm-row input[type=range]{width:100%;accent-color:#ffd24a;height:22px;cursor:pointer;}
  .obm-hint{color:#9c8f74;font-size:11px;margin-top:6px;line-height:1.5;}
  .obm-only3d{display:none;}
  #obm-root.is3d .obm-only3d{display:block;}
  `;

  function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function pct(v) { return Math.round(v * 100) + '%'; }
  // i18n: T(chave) traduz; i18nEl marca o elemento p/ retradução automática
  // quando o idioma muda (OrbitI18N.apply varre os data-i18n).
  const T = (k, p) => (window.OrbitI18N ? OrbitI18N.t(k, p) : k);
  function i18nEl(el, key) { el.setAttribute('data-i18n', key); return el; }

  function build() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    root = h('div'); root.id = 'obm-root'; if (opts.has3D) root.classList.add('is3d');

    // --- Pausa ---
    pause = h('div', 'obm-ovl');
    const pc = h('div', 'obm-card');
    pc.appendChild(i18nEl(h('h2', null, T('menu.pause')), 'menu.pause'));
    pc.appendChild(i18nEl(h('p', 'obm-sub', T('menu.paused')), 'menu.paused'));
    const bResume = i18nEl(h('button', 'obm-btn', T('menu.resume')), 'menu.resume');
    const bSettings = i18nEl(h('button', 'obm-btn ghost', T('menu.settings')), 'menu.settings');
    const bQuit = i18nEl(h('button', 'obm-btn danger', T('menu.quit')), 'menu.quit');
    bResume.onclick = close;
    bSettings.onclick = showSettings;
    bQuit.onclick = () => { if (opts.onQuit) opts.onQuit(); else location.reload(); };
    pc.append(bResume, bSettings, bQuit);
    pause.appendChild(pc);

    // --- Configurações ---
    settings = h('div', 'obm-ovl');
    const sc = h('div', 'obm-card');
    sc.appendChild(i18nEl(h('h2', null, T('menu.settings')), 'menu.settings'));
    sc.appendChild(i18nEl(h('p', 'obm-sub', T('menu.autoSaved')), 'menu.autoSaved'));

    // Idioma (troca aplicada na hora e persistida)
    if (window.OrbitI18N) {
      const langRow = h('div', 'obm-row');
      const lab = h('label');
      const name = document.createElement('span');
      name.textContent = T('lang.label'); name.setAttribute('data-i18n', 'lang.label');
      lab.appendChild(name);
      const dd = document.createElement('div');
      OrbitI18N.customSelect(dd, { wide: true }); // dropdown personalizado (mesmo do lobby)
      langRow.append(lab, dd);
      sc.appendChild(langRow);
    }

    sc.appendChild(slider('menu.volMaster', () => OrbitAudio.getVolume('master'), (v) => OrbitAudio.setVolume('master', v)));
    sc.appendChild(slider('menu.volSfx', () => OrbitAudio.getVolume('sfx'), (v) => OrbitAudio.setVolume('sfx', v)));
    sc.appendChild(slider('menu.volMusic', () => OrbitAudio.getVolume('music'), (v) => OrbitAudio.setVolume('music', v)));

    const sensXRow = slider('menu.sensX', () => (OrbitSettings.sensitivityX() - 0.25) / 2.25,
      (t) => OrbitSettings.setSensitivityX(0.25 + t * 2.25), () => OrbitSettings.sensitivityX().toFixed(2) + '×');
    sensXRow.classList.add('obm-only3d');
    sc.appendChild(sensXRow);
    const sensYRow = slider('menu.sensY', () => (OrbitSettings.sensitivityY() - 0.25) / 2.25,
      (t) => OrbitSettings.setSensitivityY(0.25 + t * 2.25), () => OrbitSettings.sensitivityY().toFixed(2) + '×');
    sensYRow.classList.add('obm-only3d');
    sc.appendChild(sensYRow);

    const bBack = i18nEl(h('button', 'obm-btn', T('menu.back')), 'menu.back');
    bBack.onclick = showPause;
    sc.appendChild(bBack);
    settings.appendChild(sc);

    root.append(pause, settings);
    document.body.appendChild(root);
  }

  // getVal/setVal em 0..1; fmt opcional para o texto do valor.
  // labelKey é uma CHAVE de tradução (i18n.js) — o texto acompanha o idioma.
  function slider(labelKey, getVal, setVal, fmt) {
    const row = h('div', 'obm-row');
    const lab = h('label'); const name = document.createElement('span');
    name.textContent = T(labelKey); name.setAttribute('data-i18n', labelKey);
    const val = document.createElement('b'); lab.append(name, val);
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.01;
    const sync = () => { const g = getVal(); inp.value = g; val.textContent = fmt ? fmt() : pct(g); };
    inp.addEventListener('input', () => { setVal(parseFloat(inp.value)); val.textContent = fmt ? fmt() : pct(parseFloat(inp.value)); });
    row.append(lab, inp); row._sync = sync;
    return row;
  }

  function syncAll() { settings.querySelectorAll('.obm-row').forEach((r) => r._sync && r._sync()); }
  function showPause() { settings.classList.remove('show'); pause.classList.add('show'); }
  function showSettings() { if (window.OrbitAudio) OrbitAudio.unlock(); syncAll(); pause.classList.remove('show'); settings.classList.add('show'); }

  function doOpen() { if (open) return; if (opts.canOpen && !opts.canOpen()) return; open = true; root.classList.add('show'); showPause(); }
  function close() { open = false; root.classList.remove('show'); pause.classList.remove('show'); settings.classList.remove('show'); }
  function toggle() { if (open) { if (settings.classList.contains('show')) { showPause(); return; } close(); } else doOpen(); }

  function init(o) {
    opts = Object.assign({ has3D: false, onQuit: null, canOpen: null }, o || {});
    build();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (!open && opts.canOpen && !opts.canOpen()) return;
        e.preventDefault(); toggle();
      }
    });
  }

  return { init, open: doOpen, close, isOpen: () => open };
})();
