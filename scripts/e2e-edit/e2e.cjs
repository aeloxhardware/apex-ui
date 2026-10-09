// Banc de bout en bout de l'onglet Édition : vraie application Electron (electron/main.cjs), vrai noyau C++
// (native/build/apex_edit.node, `node native/build.cjs`), vrai G-code. Le serveur Vite doit tourner
// (`pnpm dev`, port 8080 ; URL=... pour un autre).
//
//   node scripts/e2e-edit/run.cjs <scenario>
//   GCODE=chemin.gcode node scripts/e2e-edit/run.cjs sym2
//
// Scénarios : basic, full (verrous, ΔB + lissage, rognage, copier/coller, symétrie, analyses), rot,
// locks, thick, trim2 (GCODE=thin.gcode), sym / sym2 (GCODE=towers.gcode), probe, coll.
// G-code de test : `python scripts/e2e-edit/gen_towers.py` (towers.gcode, thin.gcode).
// Captures et journaux : OUT_DIR (défaut : dossier temporaire).
// Banc de bout en bout de l'onglet Édition : vraie application Electron (main.cjs), vrai noyau C++,
// vrai G-code. Usage : node e2e.cjs <scenario> (scenario = nom d'une fonction ci-dessous).
process.env.ELECTRON_START_URL = process.env.URL || 'http://localhost:8080';
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, screen } = require('electron');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.env.OUT_DIR || require('node:os').tmpdir();
const GCODE = process.env.GCODE || path.resolve(ROOT, '..', 'slicer_engine', 'out', 'elbow_tube_x1.gcode');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let win;
const ev = (js) => win.webContents.executeJavaScript(js, true);
const log = (...a) => console.log('[e2e]', ...a);

async function shot(name, rect) {
  const img = await win.webContents.capturePage(rect);
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
}

async function click(x, y, opts = {}) {
  const wc = win.webContents;
  const base = { x: Math.round(x), y: Math.round(y), button: opts.button || 'left', clickCount: 1 };
  wc.sendInputEvent({ type: 'mouseMove', x: base.x, y: base.y });
  await sleep(40);
  wc.sendInputEvent({ ...base, type: 'mouseDown' });
  await sleep(60);
  wc.sendInputEvent({ ...base, type: 'mouseUp' });
  await sleep(120);
}

async function waitFor(js, label, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await ev(js); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('délai dépassé : ' + label);
    await sleep(150);
  }
}

async function openEditTab() {
  await sleep(2500);
  await ev(`window.__st = null; window.__msgs = [];
    window.addEventListener('apex-edit-state', (e) => { window.__st = e.detail; });`);
  await ev(`[...document.querySelectorAll('button')].find((b) => /Prévisualisation/.test(b.textContent))?.click()`);
  await sleep(2500);
  const text = fs.readFileSync(GCODE, 'utf8');
  await ev(`(() => {
    const f = new File([${JSON.stringify(text)}], 'elbow.gcode', { type: 'text/plain' });
    const dt = new DataTransfer(); dt.items.add(f);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  })()`);
  await waitFor(`!!window.__apexEdit && !!window.__apexEdit.debugParsed()`, 'g-code charge', 60000);
  await sleep(2500);
  await ev(`(document.querySelector('svg.lucide-pencil')?.closest('button') ?? document.querySelector('svg.lucide-pencil')?.parentElement)?.click()`);
  await sleep(1500);
  await sleep(1000);
  log('onglet courant :', await ev(`import('/src/components/PreviewUpperTabs.tsx').then((m) => m.getPreviewTab())`));
  log('statut interne :', await ev(`JSON.stringify(window.__apexEdit.debugStatus())`));
  log('refresh direct :', await ev(`(() => { try { window.__apexEdit.refresh(); return 'ok'; } catch (e) { return 'ERR ' + e.stack; } })()`));
  await sleep(1500);
  log('état après refresh :', await ev('JSON.stringify(window.__st && { status: window.__st.status, message: window.__st.message })'));
  log('refresh manuel');
  await ev(`window.dispatchEvent(new CustomEvent('apex-preview-toggled', { detail: { active: true } }))`);
  await sleep(3000);
  log('éléments Édition :', await ev(`JSON.stringify([...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /dition/.test(e.textContent || '')).map((e) => e.tagName + ':' + (e.textContent || '').trim().slice(0, 30)).slice(0, 10))`));
  await shot('dbg_tab');
  log('état avant attente :', await ev('JSON.stringify(window.__st && { status: window.__st.status, message: window.__st.message })'));
  await waitFor(`window.__st && window.__st.status === 'ready'`, 'noyau pret', 60000);
  log('onglet Édition prêt, points :', await ev(`window.__apexEdit.debugParsed().moves.length`));
}

async function placeNodeAt(k) {
  const p = await ev(`JSON.stringify(window.__apexEdit.debugProjectMove(${k}))`);
  const { x, y } = JSON.parse(p);
  const rect = JSON.parse(await ev(`JSON.stringify(document.getElementById('babylon-canvas').getBoundingClientRect())`));
  await ev(`window.dispatchEvent(new CustomEvent('apex-edit-place-mode', { detail: { active: true } }))`);
  await sleep(300);
  await click(rect.left + x, rect.top + y);
  await sleep(1200);
  return { x: rect.left + x, y: rect.top + y };
}

const state = () => ev(`(() => { const s = window.__st; if (!s) return null; const c = { ...s }; delete c.validation; c.validation = s.validation ? { ...s.validation, normalIndices: s.validation.normalIndices.length, normalDeviation: s.validation.normalDeviation.length } : null; return JSON.stringify(c); })()`).then((s) => (s ? JSON.parse(s) : null));

const scenarios = {
  // Accueil : page sans 3D, panneau « Merci à » à curseur externe, bibliothèque de sons.
  async home() {
    await sleep(2500);
    await ev(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Accueil')?.click()`);
    await sleep(3000);
    await shot('home_page');
    await shot('home_indicator', { x: 870, y: 10, width: 220, height: 60 });
    for (const [name, frac] of [['home_scroll_s4', 0.46], ['home_scroll_end', 1]]) {
      await ev(`(() => { const s = document.querySelector('[class*=scrollArea]').firstElementChild; s.scrollTop = (s.scrollHeight - s.clientHeight) * ${frac}; })()`);
      await sleep(500);
      await shot(name);
    }
    await ev(`[...document.querySelectorAll('button')].find((b) => /bibliothèque de sons gratuits/.test(b.textContent))?.click()`);
    await sleep(1200);
    await shot('home_library');
  },
  async tabs2() {
    await sleep(2500);
    await ev(`[...document.querySelectorAll('button')].find((b) => /Prévisualisation/.test(b.textContent))?.click()`);
    await sleep(3000);
    const text = fs.readFileSync(GCODE, 'utf8');
    await ev(`(() => {
      const f = new File([${JSON.stringify(text)}], 'elbow.gcode', { type: 'text/plain' });
      const dt = new DataTransfer(); dt.items.add(f);
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    })()`);
    await waitFor(`!!window.__apexEdit && !!window.__apexEdit.debugParsed()`, 'g-code charge', 60000);
    await sleep(3500);
    const clickIcon = (name) => ev(`(() => { const all = [...document.querySelectorAll('svg.lucide-${name}')]; const el = all[all.length - 1]; (el?.closest('button') ?? el?.parentElement)?.click(); return all.length; })()`);
    const burst = async (prefix, n) => {
      const t0 = Date.now();
      const times = [];
      for (let i = 0; i < n; i++) { await shot(prefix + String(i).padStart(2, '0'), { x: 0, y: 180, width: 620, height: 820 }); times.push(Date.now() - t0); }
      log(prefix, 'instants (ms) :', times.join(' '));
    };
    await clickIcon('pencil');
    await burst('fw', 24);
    await sleep(800);
    await clickIcon('palette');
    await burst('bw', 24);
  },

  async tabs() {
    await sleep(2500);
    await ev(`[...document.querySelectorAll('button')].find((b) => /Prévisualisation/.test(b.textContent))?.click()`);
    await sleep(3000);
    const text = fs.readFileSync(GCODE, 'utf8');
    await ev(`(() => {
      const f = new File([${JSON.stringify(text)}], 'elbow.gcode', { type: 'text/plain' });
      const dt = new DataTransfer(); dt.items.add(f);
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    })()`);
    await waitFor(`!!window.__apexEdit && !!window.__apexEdit.debugParsed()`, 'g-code charge', 60000);
    await sleep(3500);
    await shot('tab0_coloration');
    const clickIcon = (name) => ev(`(() => { const all = [...document.querySelectorAll('svg.lucide-${name}')]; const el = all[all.length - 1]; (el?.closest('button') ?? el?.parentElement)?.click(); return all.length; })()`);
    await clickIcon('pencil');
    const marks = [250, 500, 800, 1100, 1450, 1800, 2300, 3000];
    let t = 0;
    for (const m of marks) { await sleep(m - t); t = m; await shot('tab1_' + m); }
    await sleep(500);
    await clickIcon('palette');
    t = 0;
    for (const m of [250, 700, 1100, 1500, 1900, 2400, 3200]) { await sleep(m - t); t = m; await shot('tab2_' + m); }
    log('terminé les captures');
  },

  async coll() {
    await openEditTab();
    const r = await ev(`(async () => {
      const k = window.__apexEdit.debugKernel();
      const out = {};
      for (const margin of [0.1, 1, 5, 15, 40]) {
        const v = await k.validate({ limits: { collisionMarginMm: margin, maxPoses: 4000 }, collisions: true });
        out[margin] = { part: v.headPart, plate: v.headPlate, poses: v.posesTested, checked: v.collisionChecked };
      }
      return JSON.stringify(out);
    })()`);
    log('collisions selon la marge :', r);
  },

  async trim2() {
    await openEditTab();
    const k = await ev(`(() => { const m = window.__apexEdit.debugParsed().moves; for (let i = 0; i < m.length; i++) { if (m[i].extruding && Math.abs(m[i].z - 3.0) < 0.02) return i + 10; } return -1; })()`);
    await ev(`window.__apexEdit.debugPlaceNode(${k})`);
    await sleep(1200);
    await ev(`window.__apexEdit.togglePositionLock(1)`);
    await ev(`window.__apexEdit.toggleTrimming(1)`);
    await sleep(500);
    let st = await state();
    const infl = { ...st.influence, trimLayers: 0, spatial: { enabled: true, radiusMm: 3, falloff: 'plateau' } };
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-influence', { detail: { influence: ${JSON.stringify(infl)} } }))`);
    await sleep(1200);
    st = await state();
    log('rognage actif :', st.nodeTrimming, 'points touchés =', st.affected, 'msg =', st.message);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: { z: 0.5 }, commit: false } }))`);
    await sleep(2500);
    st = await state();
    log('aperçu : z =', st.delta && st.delta.z.toFixed(3), 'rogné =', st.trimmed, 'épaisseur =', JSON.stringify(st.thickness && { n: st.thickness.node, min: st.thickness.min, max: st.thickness.max, bad: st.thickness.outOfBounds }));
    await shot('tr_prev');
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: { z: 0.5 }, commit: true } }))`);
    await sleep(3500);
    st = await state();
    log('validé : undo =', st.undoDepth, 'mouvements rognés =', await ev(`(window.__apexEdit.debugParsed().trimmedMoves || new Set()).size`), 'msg =', st.message);
    await shot('tr_done');
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-undo'))`);
    await sleep(3000);
    log('annulé : rognés =', await ev(`(window.__apexEdit.debugParsed().trimmedMoves || new Set()).size`), 'undo =', (await state()).undoDepth);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-redo'))`);
    await sleep(3000);
    log('rétabli : rognés =', await ev(`(window.__apexEdit.debugParsed().trimmedMoves || new Set()).size`));
  },

  // Rognage par défaut (couche du nœud seule) : liberté de mouvement le long de l'axe de tête, dans les
  // deux sens, et matière rognée dessous / dessus.
  async trim3() {
    await openEditTab();
    const k = await ev(`(() => { const m = window.__apexEdit.debugParsed().moves; for (let i = 0; i < m.length; i++) { if (m[i].extruding && Math.abs(m[i].z - 3.0) < 0.02) return i + 10; } return -1; })()`);
    await ev(`window.__apexEdit.debugPlaceNode(${k})`);
    await sleep(1200);
    await ev(`window.__apexEdit.togglePositionLock(1)`);
    await ev(`window.__apexEdit.toggleTrimming(1)`);
    await sleep(1500);
    let st = await state();
    log('rognage :', st.nodeTrimming, 'couches =', st.influence.trimLayers, 'mode =', st.influence.reachMode, 'points touchés =', st.affected, 'msg =', st.message);
    for (const z of [-0.3, -0.8, 0.3, 0.8]) {
      await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: { z: ${z} }, commit: false } }))`);
      await sleep(2500);
      st = await state();
      const drag = JSON.parse(await ev(`JSON.stringify((() => { const d = window.__apexEdit.debugLastDrag(); return d && { limitScale: d.limitScale, applied: Array.from(d.appliedTranslation) }; })())`));
      log(`Δz demandé ${z} : obtenu`, st.delta && st.delta.z.toFixed(3), 'touchés =', st.affected, 'rognés =', st.trimmed, 'limite =', JSON.stringify(drag), 'msg =', st.message);
      await shot(`trim3_${z}`);
    }
    // Portée de 3 mm : validation, puis annulation.
    st = await state();
    const infl = { ...st.influence, reachMode: process.env.REACH || 'reach', spatial: { ...st.influence.spatial, radiusMm: 3 } };
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-influence', { detail: { influence: ${JSON.stringify(infl)} } }))`);
    await sleep(1500);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: { z: -0.6 }, commit: false } }))`);
    await sleep(2500);
    st = await state();
    log('Portée 3 mm, Δz -0.6 : obtenu', st.delta && st.delta.z.toFixed(3), 'touchés =', st.affected, 'rognés =', st.trimmed);
    await shot('trim3_reach_preview');
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: { z: -0.6 }, commit: true } }))`);
    await sleep(3500);
    st = await state();
    log('validé : undo =', st.undoDepth, 'mouvements rognés =', await ev(`(window.__apexEdit.debugParsed().trimmedMoves || new Set()).size`), 'msg =', st.message);
    await shot('trim3_reach_done');
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-undo'))`);
    await sleep(3000);
    log('annulé : rognés =', await ev(`(window.__apexEdit.debugParsed().trimmedMoves || new Set()).size`), 'undo =', (await state()).undoDepth);
  },

  async probe() {
    await openEditTab();
    const out = [];
    for (const k of [60, 200, 400, 750, 900, 1100, 1300]) {
      out.push(k + ' ' + await ev(`window.__apexEdit.debugTryHandle(${k})`) + ' z=' + await ev(`window.__apexEdit.debugParsed().moves[${k}].z`));
    }
    log('sondes :', out.join(' | '));
  },

  async sym2() {
    await openEditTab();
    const k = await ev(`(() => { const m = window.__apexEdit.debugParsed().moves; const n = m.length; const half = Math.floor(n/2); for (let i = Math.floor(half*0.5); i < half; i++) { if (m[i].extruding && Math.abs(m[i].z - 3.0) < 0.05 && Math.abs(m[i].y) < 30) return i; } return -1; })()`);
    log('point de la tour 1 :', k);
    await ev(`window.__apexEdit.debugPlaceNode(${k})`);
    await sleep(1200);
    let st = await state();
    log('nœud posé :', st.hasNode, st.message);
    await ev(`window.__apexEdit.togglePositionLock(1)`);
    await sleep(600);
    const infl = { ...st.influence, spatial: { enabled: true, radiusMm: 2.0, falloff: 'cubic' } };
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-influence', { detail: { influence: ${JSON.stringify(infl)} } }))`);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-symmetry', { detail: { symmetry: { mode: 'cyclic', count: 2, mirrorDeg: 0 } } }))`);
    await sleep(800);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: { r: 0.15 }, commit: true } }))`);
    await sleep(6000);
    st = await state();
    log('cyclique 2 : undo =', st.undoDepth, 'msg =', st.message);
    log('mouvements modifiés :', await ev(`(window.__apexEdit.debugParsed().editedMoves || new Set()).size`), 'journal =', await ev(`window.__apexEdit.debugParsed().editJournal.undo.length`), 'groupes =', await ev(`JSON.stringify(window.__apexEdit.debugParsed().editJournal.undo.map((e) => e.group))`));
    await shot('sym2a');
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-undo'))`);
    await sleep(4000);
    st = await state();
    log('un Annuler : undo =', st.undoDepth, 'redo =', st.redoDepth, 'modifiés =', await ev(`window.__apexEdit.debugParsed().editedMoves.size`));
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-redo'))`);
    await sleep(4000);
    st = await state();
    log('un Rétablir : undo =', st.undoDepth, 'redo =', st.redoDepth);
  },

  async sym() {
    await openEditTab();
    const k = await ev(`(() => { const m = window.__apexEdit.debugParsed().moves; const n = m.length; let best = -1, bc = 0; for (let i = Math.floor(n*0.4); i < Math.floor(n*0.6); i++) { if (m[i].extruding && Math.abs(m[i].y) > bc) { bc = Math.abs(m[i].y); best = i; } } return best; })()`);
    log('point hors plan :', k, JSON.stringify(await ev(`(() => { const m = window.__apexEdit.debugParsed().moves[${k}]; return { r: m.x, c: m.y, z: m.z, b: m.b }; })()`)));
    await placeNodeAt(k);
    let st = await state();
    log('nœud posé :', st.hasNode, st.message);
    await ev(`window.__apexEdit.togglePositionLock(1)`);
    await sleep(600);
    const infl = { ...st.influence, spatial: { enabled: true, radiusMm: 2.5, falloff: 'cubic' } };
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-influence', { detail: { influence: ${JSON.stringify(infl)} } }))`);
    const meanC = await ev(`(() => { const m = window.__apexEdit.debugParsed().moves; const n = m.length; let s = 0, c = 0; for (let i = Math.floor(n*0.4); i < Math.floor(n*0.6); i++) { if (m[i].extruding) { s += m[i].y; c++; } } return s / c; })()`);
    log('plan moyen C =', meanC);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-symmetry', { detail: { symmetry: { mode: 'mirror', count: 2, mirrorDeg: ${meanC} } } }))`);
    await sleep(800);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: { z: 0.05 }, commit: true } }))`);
    await sleep(5000);
    st = await state();
    log('miroir : undo =', st.undoDepth, 'msg =', st.message);
    const edited = await ev(`window.__apexEdit.debugParsed().editedMoves.size`);
    log('mouvements modifiés :', edited);
    await shot('sym1');
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-undo'))`);
    await sleep(3500);
    st = await state();
    log('un seul Annuler : undo =', st.undoDepth, 'redo =', st.redoDepth);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-redo'))`);
    await sleep(3500);
    st = await state();
    log('Rétablir : undo =', st.undoDepth, 'redo =', st.redoDepth);
  },

  async thick() {
    await openEditTab();
    const n = await ev(`window.__apexEdit.debugParsed().moves.length`);
    for (const frac of [0.5, 0.45, 0.55, 0.4]) {
      await placeNodeAt(Math.floor(n * frac));
      if ((await state()).hasNode) break;
    }
    await ev(`window.__apexEdit.togglePositionLock(1)`);
    await sleep(600);
    const st0 = await state();
    const infl = { ...st0.influence, spatial: { enabled: true, radiusMm: 4, falloff: 'cubic' } };
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-influence', { detail: { influence: ${JSON.stringify(infl)} } }))`);
    await sleep(900);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: { z: 0.5 }, commit: false } }))`);
    await sleep(2500);
    const st = await state();
    log('épaisseur :', JSON.stringify(st.thickness), 'delta z =', st.delta && st.delta.z);
    await shot('t1');
  },

  // Re-tranchage : un grand déplacement le long de l'empilement insère des couches interpolées dans le
  // G-code (réécriture + rechargement), puis Ctrl+Z revient au fichier d'avant.
  async reslice() {
    await openEditTab();
    await ev(`window.__fi = []; window.addEventListener('apex-edit-file-info', (e) => window.__fi.push(JSON.stringify(e.detail)))`);
    const before = await ev(`window.__apexEdit.debugParsed().moves.length`);
    const n = before;
    for (const frac of (process.env.FRACS || '0.5,0.45,0.55,0.4').split(',').map(Number)) {
      if (process.env.DIRECT) await ev(`window.__apexEdit.debugPlaceNode(${Math.floor(n * frac)})`); else await placeNodeAt(Math.floor(n * frac));
      await sleep(800);
      if ((await state()).hasNode) break;
    }
    await ev(`window.__apexEdit.togglePositionLock(1)`);
    await sleep(600);
    const st0 = await state();
    const dz = Number(process.env.DZ || 3);
    const infl = { ...st0.influence, reachMode: process.env.REACH || 'reach', spatial: { enabled: true, radiusMm: Number(process.env.RADIUS || 6), falloff: 'cubic' }, reslice: true };
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-influence', { detail: { influence: ${JSON.stringify(infl)} } }))`);
    await sleep(1200);
    log('capacité (avant glissement) :', (await state()).capacityMm);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: { z: ${dz} }, commit: false } }))`);
    await sleep(2500);
    const stDrag = await state();
    log('aperçu : capacité', stDrag.capacityMm, 'demandé', stDrag.requestedAxialMm, 'points à subdiviser', stDrag.reslicePoints, 'couches max', stDrag.resliceMaxCount);
    log('épaisseur :', JSON.stringify(stDrag.thickness));
    await shot('r1');
    const tCommit = Date.now();
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: { z: ${dz} }, commit: true } }))`);
    await waitFor(`window.__apexEdit.debugParsed().moves.length !== ${before} || (window.__st && /impossible|annul/i.test(window.__st.message || ''))`, 'fichier recharge', 120000).catch(() => log('pas de rechargement'));
    await waitFor(`window.__st && window.__st.status === 'ready'`, 'noyau pret apres rechargement', 120000);
    log('validation -> noyau pret :', Date.now() - tCommit, 'ms');
    const after = await ev(`window.__apexEdit.debugParsed().moves.length`);
    const st1 = await state();
    log('mouvements :', before, '->', after, '| annuler =', st1.undoDepth, '| message =', st1.message);
    await shot('r2');
    if (after !== before) {
      // Texte enregistré : les couches insérées sont écrites, le fichier se relit avec le même nombre de mouvements.
      const saved = await ev(`window.__apexSavedText()`);
      fs.writeFileSync(path.join(OUT, 'reslice_saved.gcode'), saved);
      await ev(`window.__saved = ${JSON.stringify(saved)}`);
      const reparsed = await ev(`import('/src/utils/gcodeParseAsync.ts').then((m) => m.parseGCodeAsync(${JSON.stringify(saved)})).then((p) => p.moves.length)`);
      log('texte enregistré :', saved.split(String.fromCharCode(10)).length, 'lignes ; relu :', reparsed, 'mouvements (attendu', after, ')');

      const blocks = await ev(`(() => { const t = window.__saved; const L = t.split('\\n'); const out = []; for (let i = 0; i < L.length; i++) if (L[i].startsWith('; apex: re-tranchage')) { let j = i; while (j < L.length && !/^G92 E/.test(L[j])) j++; out.push({ at: i, n: j - i, head: L.slice(Math.max(0, i - 2), i + 6), tail: L.slice(j - 3, j + 3) }); } return JSON.stringify(out); })()`);
      fs.writeFileSync(path.join(OUT, 'reslice_blocks.json'), blocks);
      log('blocs insérés :', JSON.parse(blocks).length);

      await sleep(1500);
      { const pre = await state(); log('avant annulation : statut', pre.status, 'annuler', pre.undoDepth, 'occupé', pre.busy, 'msg', pre.message); }
      await ev(`window.dispatchEvent(new CustomEvent('apex-edit-undo'))`);
      await waitFor(`window.__apexEdit.debugParsed().moves.length === ${before}`, 'retour au fichier d avant', 120000);
      await waitFor(`window.__st && window.__st.status === 'ready'`, 'noyau pret apres annulation', 120000);
      const st2 = await state();
      log('infos fichier :', await ev('JSON.stringify(window.__fi)'));
      log('après annulation : mouvements =', await ev(`window.__apexEdit.debugParsed().moves.length`), '| rétablir =', st2.redoDepth);
      await ev(`window.dispatchEvent(new CustomEvent('apex-edit-redo'))`);
      await sleep(4000);
      log('après redo (4 s) : mouvements =', await ev(`window.__apexEdit.debugParsed().moves.length`), JSON.stringify(await state()).slice(0, 300));
      await waitFor(`window.__apexEdit.debugParsed().moves.length === ${after}`, 'retablissement', 120000);
      log('après rétablissement : mouvements =', await ev(`window.__apexEdit.debugParsed().moves.length`));
    }
  },

  async locks() {
    await openEditTab();
    const n = await ev(`window.__apexEdit.debugParsed().moves.length`);
    const rect = JSON.parse(await ev(`JSON.stringify(document.getElementById('babylon-canvas').getBoundingClientRect())`));
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-lock-mode', { detail: { mode: 'lock', radiusMm: 8 } }))`);
    await sleep(300);
    for (const frac of [0.15, 0.8]) {
      const p = JSON.parse(await ev(`JSON.stringify(window.__apexEdit.debugProjectMove(${Math.floor(n * frac)}))`));
      await click(rect.left + p.x, rect.top + p.y);
      await sleep(1200);
    }
    let st = await state();
    log('verrous : points =', st.locks);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-lock-mode', { detail: { mode: null, radiusMm: 8 } }))`);
    await sleep(800);
    await shot('l1');
    // placer un nœud au milieu pour voir le tout
    await placeNodeAt(Math.floor(n * 0.5));
    st = await state();
    log('nœud posé :', st.hasNode, 'message =', st.message);
    await shot('l2');
  },

  async rot() {
    await openEditTab();
    const n = await ev(`window.__apexEdit.debugParsed().moves.length`);
    for (const frac of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35]) {
      await placeNodeAt(Math.floor(n * frac));
      if ((await state()).hasNode) break;
    }
    await ev(`window.__apexEdit.togglePositionLock(1)`);
    await sleep(800);
    const r = await ev(`(async () => {
      const k = window.__apexEdit.debugKernel();
      const out = [];
      const tests = [
        { t: [0, 0, 0], a: 0.14 }, { t: [0, 0, 0], a: 0.05 }, { t: [0, 0, 0.01], a: 0.14 },
        { t: [0, 0, 0.5], a: 0.0 }, { t: [0, 0, 0.5], a: 0.14 }, { t: [0, 0, 0], a: -0.14 },
        { t: [-4.208, -0.1338, 4.843], a: 0 }, { t: [-4.208, -0.1338, 4.843], a: 0.14 }, { t: [-4.208, -0.1338, 4.843], a: 0.01 },
        { t: [0, 0, 2], a: 0.14 }, { t: [0, 0, 2], a: 0 },
      ];
      for (const x of tests) {
        const res = await k.drag({ translation: Float64Array.from(x.t), axis: Float64Array.from([0, 1, 0]), angleRad: x.a }, { heights: true });
        out.push({ ...x, applied: res && res.appliedAngleRad, limit: res && res.limitScale, handleB: res && res.handle[3] });
      }
      return JSON.stringify(out);
    })()`);
    log('rotation :', r);
  },

  async full() {
    await openEditTab();
    const n = await ev(`window.__apexEdit.debugParsed().moves.length`);
    let placed = null;
    for (const frac of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35]) {
      const k = Math.floor(n * frac);
      await placeNodeAt(k);
      if ((await state()).hasNode) { placed = k; break; }
    }
    log('nœud posé au point', placed);
    await ev(`window.__apexEdit.togglePositionLock(1)`);
    await sleep(800);
    const setInfl = async (patch) => {
      const st0 = await state();
      const infl = { ...st0.influence, ...patch };
      await ev(`window.dispatchEvent(new CustomEvent('apex-edit-influence', { detail: { influence: ${JSON.stringify(infl)} } }))`);
      await sleep(900);
    };
    const setDelta = async (values, commit, wait = 1500) => {
      await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: ${JSON.stringify(values)}, commit: ${commit} } }))`);
      await sleep(wait);
      return state();
    };
    let st;

    // --- verrous de zone -------------------------------------------------------------------------
    {
      const k2 = Math.floor(n * 0.3);
      const p = JSON.parse(await ev(`JSON.stringify(window.__apexEdit.debugProjectMove(${k2}))`));
      const rect = JSON.parse(await ev(`JSON.stringify(document.getElementById('babylon-canvas').getBoundingClientRect())`));
      await ev(`window.dispatchEvent(new CustomEvent('apex-edit-lock-mode', { detail: { mode: 'lock', radiusMm: 2 } }))`);
      await sleep(300);
      await click(rect.left + p.x, rect.top + p.y);
      await sleep(1500);
      st = await state();
      log('verrous : points =', st.locks, 'mode =', st.lockMode, 'message =', st.message);
      await shot('f1_locks');
      await ev(`window.dispatchEvent(new CustomEvent('apex-edit-lock-mode', { detail: { mode: null, radiusMm: 2 } }))`);
      await ev(`window.dispatchEvent(new CustomEvent('apex-edit-clear-locks'))`);
      await sleep(800);
      st = await state();
      log('verrous effacés : points =', st.locks);
    }

    // --- ΔB et lissage de B --------------------------------------------------------------------------
    await setInfl({ smoothB: 0.6, spatial: { enabled: true, radiusMm: 3, falloff: 'cubic' } });
    st = await setDelta({ b: 8 }, false);
    log('ΔB aperçu :', JSON.stringify(st.delta && { b: st.delta.b, z: st.delta.z }), 'points =', st.affected);
    log('dernier glissement :', await ev(`(() => { const d = window.__apexEdit.debugLastDrag(); return JSON.stringify(d && { appliedAngleRad: d.appliedAngleRad, limitScale: d.limitScale, applied: Array.from(d.appliedTranslation), handle: Array.from(d.handle) }); })()`));
    st = await setDelta({ b: 8 }, true, 2500);
    log('ΔB validé : undo =', st.undoDepth, 'validation B =', st.validation && [st.validation.bRange, st.validation.bSpeed, st.validation.bAccel], 'msg =', st.message);
    await shot('f2_deltaB');
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-undo'))`);
    await sleep(2000);
    log('annulé : undo =', (await state()).undoDepth);
    await setInfl({ smoothB: 0 });

    // --- rognage ----------------------------------------------------------------------------------------
    await ev(`window.__apexEdit.toggleTrimming(1)`);
    await sleep(500);
    await setInfl({ trimLayers: 0, spatial: { enabled: true, radiusMm: 2, falloff: 'plateau' } });
    st = await state();
    log('rognage :', st.nodeTrimming, 'points touchés =', st.affected, 'msg =', st.message);
    st = await setDelta({ z: 0.18 }, false, 2200);
    log('rognage aperçu : z =', st.delta && st.delta.z.toFixed(3), 'rogné =', st.trimmed, 'épaisseur =', JSON.stringify(st.thickness && { min: st.thickness.min, max: st.thickness.max, bad: st.thickness.outOfBounds }));
    await shot('f3_trim_preview');
    st = await setDelta({ z: 0.18 }, true, 3000);
    const trimmedMoves = await ev(`(window.__apexEdit.debugParsed().trimmedMoves || new Set()).size`);
    log('rognage validé : undo =', st.undoDepth, 'mouvements rognés =', trimmedMoves, 'msg =', st.message);
    await shot('f4_trim_done');
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-undo'))`);
    await sleep(2500);
    log('rognage annulé : mouvements rognés =', await ev(`(window.__apexEdit.debugParsed().trimmedMoves || new Set()).size`), 'undo =', (await state()).undoDepth);
    await ev(`window.__apexEdit.toggleTrimming(1)`);
    await setInfl({ trimLayers: 1 });

    // --- copier / coller + symétrie ------------------------------------------------------------------
    await setInfl({ spatial: { enabled: true, radiusMm: 2, falloff: 'cubic' } });
    st = await setDelta({ z: 0.03, c: 0.5 }, false);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-copy'))`);
    await sleep(300);
    st = await state();
    log('copie : canPaste =', st.canPaste, 'msg =', st.message);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-symmetry', { detail: { symmetry: { mode: 'cyclic', count: 2, mirrorDeg: 0 } } }))`);
    await sleep(300);
    st = await setDelta({ z: 0.03, c: 0.5 }, true, 3500);
    log('symétrie cyclique : undo =', st.undoDepth, 'msg =', st.message);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-symmetry', { detail: { symmetry: { mode: 'none', count: 2, mirrorDeg: 0 } } }))`);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-paste'))`);
    await sleep(3000);
    st = await state();
    log('collé : undo =', st.undoDepth, 'msg =', st.message);

    // --- analyse du fichier ----------------------------------------------------------------------------
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-analyze', { detail: { collisions: false } }))`);
    await sleep(2500);
    st = await state();
    log('analyse B :', st.message);
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-analyze', { detail: { collisions: true } }))`);
    await sleep(8000);
    st = await state();
    log('analyse + collisions :', st.message, JSON.stringify(st.validation && { part: st.validation.headPart, plate: st.validation.headPlate, poses: st.validation.posesTested }));
    await shot('f5_analysis');
  },

  async basic() {
    await openEditTab();
    await shot('s0_tab');
    const n = await ev(`window.__apexEdit.debugParsed().moves.length`);
    // Un point au milieu, loin de la première couche et de la surface libre.
    let placed = null;
    for (const frac of [0.5, 0.45, 0.55, 0.4, 0.6]) {
      const k = Math.floor(n * frac);
      await placeNodeAt(k);
      const st = await state();
      if (st.hasNode) { placed = k; break; }
      log('refus à', k, st.message);
    }
    log('nœud posé au point', placed);
    await shot('s1_node');
    // Verrouiller la position (le déplacement exact déforme).
    await ev(`window.__apexEdit.togglePositionLock(1)`);
    await sleep(800);
    let st = await state();
    log('influence : points touchés =', st.affected, 'message =', st.message, 'nœud =', st.hasNode);
    // Saisie numérique : ΔZ = +0,04 mm, validée.
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: { z: 0.04 }, commit: false } }))`);
    await sleep(1500);
    st = await state();
    log('aperçu : delta =', JSON.stringify(st.delta), 'épaisseur =', JSON.stringify(st.thickness), 'rogné =', st.trimmed);
    await shot('s2_preview');
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-set-delta', { detail: { values: { z: 0.04 }, commit: true } }))`);
    await sleep(2500);
    st = await state();
    log('validé : undo =', st.undoDepth, 'validation =', JSON.stringify(st.validation), 'message =', st.message);
    await shot('s3_committed');
    // Annuler.
    await ev(`window.dispatchEvent(new CustomEvent('apex-edit-undo'))`);
    await sleep(2500);
    st = await state();
    log('annulé : undo =', st.undoDepth, 'redo =', st.redoDepth);
  },
};

app.on('browser-window-created', (_e, w) => {
  win = w;
  w.webContents.on('console-message', (e) => {
    const m = String(e.message ?? '');
    const lvl = e.level;
    if ((lvl === 'error' || lvl === 3 || /Uncaught|TypeError|shader|WebGL/i.test(m)) && !/Security|DevTools|Autofill/i.test(m)) log('CONSOLE', lvl, m.slice(0, 400));
  });
  w.webContents.once('did-finish-load', async () => {
    try {
      const d = screen.getPrimaryDisplay().size;
      w.setBounds({ x: 0, y: 0, width: d.width, height: d.height });
      w.show(); w.focus();
      const name = process.argv.find((a) => scenarios[a]) || 'basic';
      await scenarios[name]();
      log('terminé');
    } catch (error) {
      log('ECHEC', error.stack || error.message);
      try { await shot('fail'); log('état', await ev('JSON.stringify(window.__st && { status: window.__st.status, message: window.__st.message })')); } catch {}
    } finally {
      await sleep(500);
      app.exit(0);
    }
  });
});

require(path.join(ROOT, 'electron/main.cjs'));
