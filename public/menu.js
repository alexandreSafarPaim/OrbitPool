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
  #obm-root{position:fixed;inset:0;z-index:60;display:none;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
  #obm-root.show{display:block;}
  .obm-ovl{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
    background:rgba(6,10,16,.62);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
  .obm-ovl.show{display:flex;}
  .obm-card{background:#111823;border:1px solid #2a3646;border-radius:18px;padding:26px 24px;
    width:min(92vw,360px);box-shadow:0 24px 70px rgba(0,0,0,.55);color:#e8eef5;text-align:center;}
  .obm-card h2{margin:0 0 4px;font-size:22px;font-weight:800;}
  .obm-card h2 span{color:#37b26b;}
  .obm-sub{color:#8fa1b5;font-size:13px;margin:0 0 18px;}
  .obm-btn{display:block;width:100%;margin:10px 0 0;padding:13px;border:0;border-radius:11px;
    font-size:15px;font-weight:700;cursor:pointer;background:#2f9e5a;color:#fff;transition:transform .08s,background .15s;}
  .obm-btn:hover{background:#37b26b;}
  .obm-btn:active{transform:scale(.98);}
  .obm-btn.ghost{background:transparent;color:#cfe1f0;border:1px solid #2a3646;}
  .obm-btn.ghost:hover{background:rgba(255,255,255,.05);}
  .obm-btn.danger{background:transparent;color:#ff7a7a;border:1px solid rgba(255,122,122,.5);}
  .obm-btn.danger:hover{background:rgba(255,122,122,.1);}
  .obm-row{text-align:left;margin:16px 0;}
  .obm-row label{display:flex;justify-content:space-between;font-size:13px;color:#9fb0c3;margin-bottom:7px;}
  .obm-row label b{color:#e8eef5;font-weight:700;}
  .obm-row input[type=range]{width:100%;accent-color:#37b26b;height:22px;cursor:pointer;}
  .obm-hint{color:#66727f;font-size:11px;margin-top:6px;line-height:1.5;}
  .obm-only3d{display:none;}
  #obm-root.is3d .obm-only3d{display:block;}
  `;

  function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function pct(v) { return Math.round(v * 100) + '%'; }

  function build() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    root = h('div'); root.id = 'obm-root'; if (opts.has3D) root.classList.add('is3d');

    // --- Pausa ---
    pause = h('div', 'obm-ovl');
    const pc = h('div', 'obm-card');
    pc.appendChild(h('h2', null, '⏸ Pausa'));
    pc.appendChild(h('p', 'obm-sub', 'Jogo pausado'));
    const bResume = h('button', 'obm-btn', 'Continuar');
    const bSettings = h('button', 'obm-btn ghost', '⚙ Configurações');
    const bQuit = h('button', 'obm-btn danger', 'Sair');
    bResume.onclick = close;
    bSettings.onclick = showSettings;
    bQuit.onclick = () => { if (opts.onQuit) opts.onQuit(); else location.reload(); };
    pc.append(bResume, bSettings, bQuit);
    pause.appendChild(pc);

    // --- Configurações ---
    settings = h('div', 'obm-ovl');
    const sc = h('div', 'obm-card');
    sc.appendChild(h('h2', null, '⚙ Configurações'));
    sc.appendChild(h('p', 'obm-sub', 'Ajustes salvos automaticamente'));

    sc.appendChild(slider('Volume geral', () => OrbitAudio.getVolume('master'), (v) => OrbitAudio.setVolume('master', v)));
    sc.appendChild(slider('Efeitos sonoros', () => OrbitAudio.getVolume('sfx'), (v) => OrbitAudio.setVolume('sfx', v)));
    sc.appendChild(slider('Música', () => OrbitAudio.getVolume('music'), (v) => OrbitAudio.setVolume('music', v)));

    const sensXRow = slider('Sensibilidade horizontal (mira)', () => (OrbitSettings.sensitivityX() - 0.25) / 2.25,
      (t) => OrbitSettings.setSensitivityX(0.25 + t * 2.25), () => OrbitSettings.sensitivityX().toFixed(2) + '×');
    sensXRow.classList.add('obm-only3d');
    sc.appendChild(sensXRow);
    const sensYRow = slider('Sensibilidade vertical (câmera)', () => (OrbitSettings.sensitivityY() - 0.25) / 2.25,
      (t) => OrbitSettings.setSensitivityY(0.25 + t * 2.25), () => OrbitSettings.sensitivityY().toFixed(2) + '×');
    sensYRow.classList.add('obm-only3d');
    sc.appendChild(sensYRow);

    const bBack = h('button', 'obm-btn', 'Voltar');
    bBack.onclick = showPause;
    sc.appendChild(bBack);
    settings.appendChild(sc);

    root.append(pause, settings);
    document.body.appendChild(root);
  }

  // getVal/setVal em 0..1; fmt opcional para o texto do valor.
  function slider(label, getVal, setVal, fmt) {
    const row = h('div', 'obm-row');
    const lab = h('label'); const name = document.createElement('span'); name.textContent = label;
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
