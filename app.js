// ===== ALLDAY CUBE — Interactive 3D Controller & UI =====
const $ = id => document.getElementById(id);

let state = SOLVED();
let stickerQuad = Array.from({ length: 24 }, (_, i) => i % 4);
let stickerRot = Array(24).fill(0);
let brush = 'T'; // Default selected logo: TARZZAN
let brushQuad = 0; // Currently selected 1/4 piece to place
let selectedSticker = 17; // Default to Top-Right of Left face for immediate editing
let mode = 'edit'; // 'edit' | 'solve'
let sol = [];
let states = [];
let statesRot = [];
let statesOrig = [];
let step = 0;
let timer = null;
let animating = false;

const INV_MOVE = {
  U: "U'", "U'": 'U', U2: 'U2',
  R: "R'", "R'": 'R', R2: 'R2',
  F: "F'", "F'": 'F', F2: 'F2'
};

// 3D View Angles
let rx = -22, ry = 35; // Default front view (Top, Front, Right)
let drag = null;
let moved = false;

// Drag-and-drop state for 1/4 puzzle pieces
let pieceDrag = null;

const VIEW_PRESETS = {
  front:  { rx: -22, ry: 35 },   // 上・前・右
  back:   { rx: 22,  ry: 215 },  // 下・後・左
  top:    { rx: -85, ry: 0 },    // 正上面 ADP
  bottom: { rx: 85,  ry: 0 },    // 正底面 WOOCHAN
};

// Intrinsic "Up" vectors for each face in 3D
const FACE_UP = [
  [0, 0, -1], // 0: U
  [0, 1, 0],  // 1: R
  [0, 1, 0],  // 2: F
  [0, 0, 1],  // 3: D
  [0, 1, 0],  // 4: L
  [0, 1, 0],  // 5: B
];

function calcTextureAngle(texUp, slotIndex) {
  const f = Math.floor(slotIndex / 4);
  const refUp = FACE_UP[f];
  const normal = G[slotIndex].n;
  const refRight = cross(refUp, normal);

  const cosA = dot(texUp, refUp);
  const sinA = dot(texUp, refRight);

  if (cosA > 0.6) return 0;
  if (sinA > 0.6) return 90;
  if (cosA < -0.6) return 180;
  if (sinA < -0.6) return 270;
  return 0;
}

// Current 3D texture up vectors for all 24 stickers
let texUpVectors = G.map((g, s) => FACE_UP[Math.floor(s / 4)].slice());

// Map each sticker to its corner group
const ALL_CORNERS = [FIX, ...POS];
const CORNER_MAP = new Map();
ALL_CORNERS.forEach(corner => {
  corner.s.forEach(s => CORNER_MAP.set(s, corner));
});

/**
 * Given a corner on the cube, if all 3 of its stickers are filled and match
 * one of the 7 movable home cubies POS[j] in some orientation t (0, 1, 2),
 * automatically compute and snap all 3 stickers' exact 1/4 quadrant and 3D rotation!
 */
function syncCornerGeometry(corner) {
  if (!corner) return false;
  if (corner === FIX) {
    corner.s.forEach(s => {
      stickerQuad[s] = s % 4;
      texUpVectors[s] = FACE_UP[Math.floor(s / 4)].slice();
      stickerRot[s] = 0;
    });
    return true;
  }

  const cols = corner.s.map(s => state[s]);
  if (cols.some(c => !c)) return false;

  for (let j = 0; j < 7; j++) {
    for (let t = 0; t < 3; t++) {
      if ([0, 1, 2].every(k => cols[(t + k) % 3] === REF[j][k])) {
        const nSrc = [0, 1, 2].map(m => G[POS[j].s[m]].n);
        const nDst = [0, 1, 2].map(m => G[corner.s[(t + m) % 3]].n);

        for (let k = 0; k < 3; k++) {
          const srcS = POS[j].s[k];
          const dstS = corner.s[(t + k) % 3];
          const uHome = FACE_UP[Math.floor(srcS / 4)];

          const c0 = dot(uHome, nSrc[0]);
          const c1 = dot(uHome, nSrc[1]);
          const c2 = dot(uHome, nSrc[2]);

          const uRot = [
            c0 * nDst[0][0] + c1 * nDst[1][0] + c2 * nDst[2][0],
            c0 * nDst[0][1] + c1 * nDst[1][1] + c2 * nDst[2][1],
            c0 * nDst[0][2] + c1 * nDst[1][2] + c2 * nDst[2][2],
          ];

          stickerQuad[dstS] = srcS % 4;
          texUpVectors[dstS] = uRot;
          stickerRot[dstS] = calcTextureAngle(uRot, dstS);
        }
        return true;
      }
    }
  }
  return false;
}

// Descriptions & Visual Icons (no emojis)
const DESC = {
  U:  '把最上面那一層【往左轉】1/4 圈（90°）',
  "U'": '把最上面那一層【往右轉】1/4 圈（90°）',
  U2: '把最上面那一層轉半圈（180°）',
  R:  '把右邊那一層【往上推】1/4 圈（遠離你）',
  "R'": '把右邊那一層【往下拉】1/4 圈（靠近你）',
  R2: '把右邊那一層轉半圈（180°）',
  F:  '把面向你的那一面【順時針】轉 1/4 圈',
  "F'": '把面向你的那一面【逆時針】轉 1/4 圈',
  F2: '把面向你的那一面轉半圈（180°）',
};

const ICON = {
  U: '←', "U'": '→', U2: '⇇',
  R: '↑', "R'": '↓', R2: '⇈',
  F: '↻', "F'": '↺', F2: '⟳'
};

const CHEERS = [
  'ANNIE: 很好！繼續保持！',
  'TARZZAN: 節奏抓到了，穩定前進！',
  'BAILEY: 就是這樣，FAMOUS 等級！',
  'WOOCHAN: 帥氣，快完成了～',
  'YOUNGSEO: 你超強的，繼續下一步！',
  'ALLDAY: Wicked smooth!'
];

function showMsg(text, isError = false) {
  const el = $('msg');
  if (!el) return;
  el.textContent = text;
  el.className = 'msg' + (isError ? ' err' : '');
}

// 3D Cube Constants
const H = 40; // half of 80px sticker
const ORIENT = {
  U: 'rotateX(90deg)',
  D: 'rotateX(-90deg)',
  R: 'rotateY(90deg)',
  L: 'rotateY(-90deg)',
  F: '',
  B: 'rotateY(180deg)'
};

const CUBE_ST = [];
const KEYCHAIN_STICKERS = new Set(FIX.s);

function initIntroCube() {
  const introCubeEl = $('introCube');
  if (!introCubeEl) return;
  introCubeEl.innerHTML = '';

  const solvedSt = SOLVED();
  G.forEach((g, s) => {
    const f = Math.floor(s / 4);
    const i = s % 4;
    const r = i >> 1, c = i & 1;
    const code = solvedSt[s];

    const el = document.createElement('div');
    el.className = 'cst st';
    if (KEYCHAIN_STICKERS.has(s)) {
      el.classList.add('key');
    }

    const pos = [
      g.p[0] * H + g.n[0] * H,
      -(g.p[1] * H + g.n[1] * H),
      g.p[2] * H + g.n[2] * H
    ];
    el.style.transform = `translate3d(${pos[0]}px,${pos[1]}px,${pos[2]}px) ${ORIENT[FACES[f]]}`;

    el.innerHTML = `<i class="st-inner"><b class="st-img" style="background-image:url(${LOGOS[code].img});background-size:200% 200%;background-position:${c * 100}% ${r * 100}%"></b></i>`;
    introCubeEl.appendChild(el);
  });

  const ring = document.createElement('div');
  ring.className = 'keyring';
  ring.innerHTML = `<span class="chain"></span><span class="loop"></span>`;
  ring.style.transform = `translate3d(-80px, 80px, -80px)`;
  introCubeEl.appendChild(ring);

  const enterApp = () => {
    const introScreen = $('introScreen');
    const appWrap = $('appWrap');
    if (introScreen) introScreen.classList.add('hidden');
    if (appWrap) appWrap.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const introStage = $('introStage');
  const introCta = $('introCta');
  if (introStage) {
    introStage.onclick = enterApp;
    introStage.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enterApp();
      }
    };
  }
  if (introCta) introCta.onclick = enterApp;
}

function init3DCube() {
  const cubeEl = $('cube');
  cubeEl.innerHTML = '';
  CUBE_ST.length = 0;

  G.forEach((g, s) => {
    const f = Math.floor(s / 4);
    const i = s % 4;
    const r = i >> 1, c = i & 1;

    const el = document.createElement('div');
    el.className = 'cst st';
    el.dataset.s = s;
    el.dataset.f = f;
    el.dataset.i = i;
    el.dataset.r = r;
    el.dataset.c = c;

    if (KEYCHAIN_STICKERS.has(s)) {
      el.classList.add('key');
      el.title = '吊飾角塊（定位點）';
    }

    const pos = [
      g.p[0] * H + g.n[0] * H,
      -(g.p[1] * H + g.n[1] * H),
      g.p[2] * H + g.n[2] * H
    ];
    el.style.transform = `translate3d(${pos[0]}px,${pos[1]}px,${pos[2]}px) ${ORIENT[FACES[f]]}`;

    el.innerHTML = '<i class="st-inner"><b class="st-img"></b></i>';
    el.addEventListener('click', e => onStickerClick(s, e));

    cubeEl.appendChild(el);
    CUBE_ST.push(el);
  });

  // Attach 3D metallic keychain to the Left-Down-Back corner (-80, 80, -80)
  const ring = document.createElement('div');
  ring.className = 'keyring';
  ring.innerHTML = `
    <span class="chain"></span>
    <span class="loop" title="吊飾鑰匙圈定位點（左下後方）"></span>
  `;
  ring.style.transform = `translate3d(-80px, 80px, -80px)`;
  cubeEl.appendChild(ring);
}

// Palette & 2x2 Quadrant Selector Upright Display Setup
// (Display order: ADP, ANNIE, TARZZAN, BAILEY, WOOCHAN, YOUNGSEO)
const PALETTE_ORDER = ['A', 'N', 'T', 'B', 'W', 'Y'];
const PALETTE_ICON_ROT = {
  A: 0,
  N: 90,   // ANNIE: rotated 90 deg right (CW) to appear upright
  T: 0,
  B: 180,  // BAILEY: rotated 180 deg to appear upright
  W: 180,  // WOOCHAN: rotated 180 deg to appear upright
  Y: -90   // YOUNGSEO: rotated 90 deg left (CCW) to appear upright
};

/**
 * Convert a visual 2x2 grid slot `vQ` (0=TL, 1=TR, 2=BL, 3=BR in the upright 2x2 selector)
 * into the underlying image quadrant `imgQ` (0..3 in `img/*.png`).
 */
function visualQuadToImgQuad(code, vQ) {
  const rot = ((PALETTE_ICON_ROT[code] || 0) % 360 + 360) % 360;
  if (rot === 90)  return [2, 0, 3, 1][vQ];
  if (rot === 180) return [3, 2, 1, 0][vQ];
  if (rot === 270) return [1, 3, 0, 2][vQ];
  return vQ;
}

/**
 * Convert an underlying image quadrant `imgQ` (0..3) back to the visual 2x2 grid slot `vQ` (0..3).
 */
function imgQuadToVisualQuad(code, imgQ) {
  for (let vQ = 0; vQ < 4; vQ++) {
    if (visualQuadToImgQuad(code, vQ) === imgQ) return vQ;
  }
  return imgQ;
}

/**
 * Find which sticker (0..23) carries `code` and underlying image quadrant `imgQ`, or -1 if unused.
 */
function findUsedSlot(code, imgQ, excludeS = -1) {
  for (let s = 0; s < 24; s++) {
    if (s === excludeS) continue;
    if (state[s] === code && stickerQuad[s] === imgQ) {
      return s;
    }
  }
  return -1;
}

/**
 * Pick the first unused underlying image quadrant (in visual order 0..3) of member `code`.
 */
function pickNextUnusedQuad(code) {
  for (let vQ = 0; vQ < 4; vQ++) {
    const imgQ = visualQuadToImgQuad(code, vQ);
    if (findUsedSlot(code, imgQ) === -1) return imgQ;
  }
  return visualQuadToImgQuad(code, 0);
}

/**
 * Place member `code` with underlying image quadrant `imgQ` onto cube sticker `s`
 * (with foolproof duplicate prevention and initial upright rotation matching the 2x2 selector).
 */
function placePieceOnSticker(s, code, imgQ) {
  if (mode !== 'edit') return;
  if (KEYCHAIN_STICKERS.has(s)) {
    selectSticker(s);
    showMsg('此格為吊飾固定角塊（WOOCHAN/ANNIE/BAILEY），解題全程作為手持定位點。');
    return;
  }

  // Foolproof check: If this exact 1/4 piece of `code` is already placed on another non-keychain slot,
  // move it from that old slot to this new slot so a 1/4 piece is never duplicated!
  const prevSlot = findUsedSlot(code, imgQ, s);
  if (prevSlot !== -1) {
    if (KEYCHAIN_STICKERS.has(prevSlot)) {
      showMsg(`${COLOR_NAME[code]} 的該部位已固定在左下後方吊飾角塊上，請選擇其他部位！`, true);
      return;
    }
    state[prevSlot] = null;
    stickerQuad[prevSlot] = null;
    stickerRot[prevSlot] = 0;
    renderSticker(prevSlot);
  }

  state[s] = code;
  stickerQuad[s] = imgQ;
  // Set initial rotation so the piece lands on the cube in the same upright orientation as the 2x2 selector
  stickerRot[s] = ((PALETTE_ICON_ROT[code] || 0) % 360 + 360) % 360;

  // Advance brushQuad to next unused quadrant of `brush` for convenience
  brushQuad = pickNextUnusedQuad(brush);

  selectSticker(s);
  renderSticker(s);
  updateStatus();
  updateQuadUI();
  showMsg(`已填入 ${COLOR_NAME[code]}！直接點一下方塊上的這格即可順時針旋轉 90°。`);
}

function selectSticker(s) {
  selectedSticker = s;
  CUBE_ST.forEach((el, idx) => {
    el.classList.toggle('selected', idx === s);
  });
  updateQuadUI();
}

function onStickerClick(s, e) {
  if (moved || animating) return;
  if (mode !== 'edit') return;

  if (KEYCHAIN_STICKERS.has(s)) {
    selectSticker(s);
    showMsg('此格為吊飾固定角塊（WOOCHAN/ANNIE/BAILEY），解題全程作為手持定位點。');
    return;
  }

  // Requirement: If clicking a sticker that is already filled, rotate it 90 degrees CW!
  if (state[s]) {
    selectedSticker = s;
    CUBE_ST.forEach((el, idx) => el.classList.toggle('selected', idx === s));
    stickerRot[s] = ((stickerRot[s] || 0) + 90) % 360;
    renderSticker(s);
    updateQuadUI();
    showMsg(`已將此格順時針旋轉至 ${stickerRot[s]}°（再點一下繼續轉 90°，或從下方拖曳新拼圖格覆蓋）`);
    return;
  }

  // If the clicked sticker is empty, fill it with current `brush` and `brushQuad` (or first unused quad)
  const qToUse = findUsedSlot(brush, brushQuad) === -1 ? brushQuad : pickNextUnusedQuad(brush);
  placePieceOnSticker(s, brush, qToUse);
}

function updateQuadUI() {
  const quadBox = $('quadBox');
  if (!quadBox) return;

  const code = brush;
  const nameEl = $('quadMemberName');
  if (nameEl) nameEl.textContent = COLOR_NAME[code] || '—';

  // Determine which underlying image quadrant is active
  const activeImgQ = (selectedSticker != null && state[selectedSticker] === code && stickerQuad[selectedSticker] != null)
    ? stickerQuad[selectedSticker]
    : brushQuad;
  const activeVQ = imgQuadToVisualQuad(code, activeImgQ);
  const iconRot = ((PALETTE_ICON_ROT[code] || 0) % 360 + 360) % 360;

  document.querySelectorAll('.qbtn').forEach(btn => {
    const vQ = +btn.dataset.q;
    const imgQ = visualQuadToImgQuad(code, vQ);
    const qR = imgQ >> 1, qC = imgQ & 1;
    const icon = btn.querySelector('i');
    if (icon && LOGOS[code]) {
      icon.style.backgroundImage = `url(${LOGOS[code].img})`;
      icon.style.backgroundSize = '200% 200%';
      icon.style.backgroundPosition = `${qC * 100}% ${qR * 100}%`;
      icon.style.transform = iconRot ? `rotate(${iconRot}deg)` : '';
    }
    const usedAt = findUsedSlot(code, imgQ);
    const isUsedElsewhere = usedAt !== -1;
    btn.classList.toggle('used', isUsedElsewhere);
    btn.classList.toggle('active', vQ === activeVQ);
  });

  const deg = (selectedSticker != null ? stickerRot[selectedSticker] : 0) || 0;
  const degLabel = $('rotDegLabel');
  if (degLabel) degLabel.textContent = `${deg}°`;
}

function setQuad(vQ) {
  if (mode !== 'edit') return;
  const imgQ = visualQuadToImgQuad(brush, vQ);
  brushQuad = imgQ;

  // If a non-keychain sticker is currently selected, apply this 1/4 piece to it
  if (selectedSticker != null && !KEYCHAIN_STICKERS.has(selectedSticker)) {
    placePieceOnSticker(selectedSticker, brush, imgQ);
    return;
  }
  updateQuadUI();
}

function rotateSticker(delta) {
  if (selectedSticker == null || mode !== 'edit') return;
  if (KEYCHAIN_STICKERS.has(selectedSticker)) {
    showMsg('吊飾角塊圖案方向已固定。');
    return;
  }
  if (!state[selectedSticker]) {
    showMsg('請先將圖案填入此格，再旋轉方向。');
    return;
  }
  stickerRot[selectedSticker] = ((stickerRot[selectedSticker] || 0) + delta + 360) % 360;
  renderSticker(selectedSticker);
  updateQuadUI();
  showMsg(`已旋轉圖案至 ${stickerRot[selectedSticker]}°`);
}

function clearSelectedCell() {
  if (selectedSticker == null || mode !== 'edit') return;
  if (KEYCHAIN_STICKERS.has(selectedSticker)) {
    showMsg('吊飾角塊為基準定位點，無法清除。');
    return;
  }
  state[selectedSticker] = null;
  stickerQuad[selectedSticker] = null;
  stickerRot[selectedSticker] = 0;
  renderSticker(selectedSticker);
  brushQuad = pickNextUnusedQuad(brush);
  updateStatus();
  updateQuadUI();
  showMsg('已清除此格，可重新點選或拖曳 1/4 拼圖填入。');
}

// Drag-and-Drop 1/4 Puzzle Pieces onto 3D Cube Stickers
function initPieceDragAndDrop() {
  document.querySelectorAll('.qbtn').forEach(btn => {
    const vQ = +btn.dataset.q;

    btn.addEventListener('pointerdown', e => {
      if (mode !== 'edit') return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const imgQ = visualQuadToImgQuad(brush, vQ);

      pieceDrag = {
        vQ,
        imgQ,
        code: brush,
        startX,
        startY,
        dragging: false,
        ghost: null,
        hoverSticker: null
      };
    });
  });

  window.addEventListener('pointermove', e => {
    if (!pieceDrag) return;
    const dx = e.clientX - pieceDrag.startX;
    const dy = e.clientY - pieceDrag.startY;

    if (!pieceDrag.dragging && Math.hypot(dx, dy) > 6) {
      pieceDrag.dragging = true;
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      const qR = pieceDrag.imgQ >> 1, qC = pieceDrag.imgQ & 1;
      const iconRot = ((PALETTE_ICON_ROT[pieceDrag.code] || 0) % 360 + 360) % 360;
      ghost.style.backgroundImage = `url(${LOGOS[pieceDrag.code].img})`;
      ghost.style.backgroundPosition = `${qC * 100}% ${qR * 100}%`;
      if (iconRot) ghost.style.transform = `rotate(${iconRot}deg)`;
      document.body.appendChild(ghost);
      pieceDrag.ghost = ghost;
    }

    if (pieceDrag.dragging && pieceDrag.ghost) {
      pieceDrag.ghost.style.left = `${e.clientX}px`;
      pieceDrag.ghost.style.top = `${e.clientY}px`;

      // Hit-test element under cursor
      const hitEl = document.elementFromPoint(e.clientX, e.clientY);
      const cstEl = hitEl ? hitEl.closest('.cst') : null;
      const hoverS = cstEl ? +cstEl.dataset.s : null;

      if (pieceDrag.hoverSticker !== hoverS) {
        if (pieceDrag.hoverSticker != null && CUBE_ST[pieceDrag.hoverSticker]) {
          CUBE_ST[pieceDrag.hoverSticker].classList.remove('drop-target');
        }
        pieceDrag.hoverSticker = hoverS;
        if (hoverS != null && !KEYCHAIN_STICKERS.has(hoverS) && CUBE_ST[hoverS]) {
          CUBE_ST[hoverS].classList.add('drop-target');
        }
      }
    }
  });

  const finishPieceDrag = e => {
    if (!pieceDrag) return;
    const { vQ, imgQ, code, dragging, ghost, hoverSticker } = pieceDrag;
    pieceDrag = null;

    if (ghost) ghost.remove();
    CUBE_ST.forEach(el => el.classList.remove('drop-target'));

    if (dragging) {
      if (hoverSticker != null) {
        placePieceOnSticker(hoverSticker, code, imgQ);
      }
    } else {
      // Treated as a click on the 1/4 quadrant button
      setQuad(vQ);
    }
  };

  window.addEventListener('pointerup', finishPieceDrag);
  window.addEventListener('pointercancel', finishPieceDrag);
}

function renderSticker(s) {
  const el = CUBE_ST[s];
  if (!el) return;

  const curState = mode === 'edit' ? state : states[step];
  const curRot   = mode === 'edit' ? (stickerRot[s] || 0) : statesRot[step][s];
  const curQuad  = mode === 'edit'
    ? (stickerQuad[s] != null ? stickerQuad[s] : (s % 4))
    : (statesOrig[step][s] % 4);
  const code = curState ? curState[s] : null;

  const inner = el.querySelector('.st-inner');
  const imgEl = el.querySelector('.st-img');

  if (!code || !LOGOS[code]) {
    inner.classList.add('empty');
    imgEl.style.backgroundImage = '';
    imgEl.style.transform = '';
    return;
  }

  inner.classList.remove('empty');

  const quadR = curQuad >> 1;
  const quadC = curQuad & 1;

  imgEl.style.backgroundImage = `url(${LOGOS[code].img})`;
  imgEl.style.backgroundSize = '200% 200%';
  imgEl.style.backgroundPosition = `${quadC * 100}% ${quadR * 100}%`;
  imgEl.style.transform = `rotate(${curRot || 0}deg)`;
}

function renderAllStickers() {
  for (let s = 0; s < 24; s++) {
    renderSticker(s);
  }
}

function initPalette() {
  const paletteEl = $('palette');
  paletteEl.innerHTML = '';

  PALETTE_ORDER.forEach(code => {
    const item = LOGOS[code];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch' + (code === brush ? ' active' : '');
    btn.dataset.code = code;
    btn.title = `選取 ${item.label}`;

    const iconRot = PALETTE_ICON_ROT[code] || 0;
    const rotStyle = iconRot ? `; transform: rotate(${iconRot}deg)` : '';

    btn.innerHTML = `
      <i style="background-image: url(${item.img})${rotStyle}"></i>
      <span class="sname">${item.label}</span>
      <span class="scnt" id="cnt-${code}">0/4</span>
    `;

    btn.onclick = () => {
      brush = code;
      brushQuad = pickNextUnusedQuad(code);
      document.querySelectorAll('.swatch').forEach(b => {
        b.classList.toggle('active', b.dataset.code === brush);
      });
      updateQuadUI();
      showMsg(`已選取【${item.label}】，可將下方 1/4 拼圖格直接拖曳到 3D 方塊上，或直接點選方塊空格填入。`);
    };

    paletteEl.appendChild(btn);
  });
}

function updateStatus() {
  const counts = {};
  for (const c of state) {
    if (c) counts[c] = (counts[c] || 0) + 1;
  }

  let allFour = true;
  COLORS.forEach(code => {
    const n = counts[code] || 0;
    const cntEl = $(`cnt-${code}`);
    const swatchEl = document.querySelector(`.swatch[data-code="${code}"]`);
    if (cntEl) cntEl.textContent = `${n}/4`;
    if (swatchEl) {
      swatchEl.classList.toggle('complete', n === 4);
      swatchEl.classList.toggle('over', n > 4);
    }
    if (n !== 4) allFour = false;
  });

  const filled = state.filter(Boolean).length;
  const statusEl = $('status');
  if (statusEl) {
    if (filled < 24) {
      statusEl.innerHTML = `已填入 <b>${filled}/24</b> 格（已填過的 1/4 拼圖會自動變暗防呆）`;
    } else if (allFour) {
      statusEl.innerHTML = `<span style="color:var(--gold2)">24 格已填滿，各圖案數量正確！可點下方開始解題</span>`;
    } else {
      statusEl.innerHTML = `<span class="bad">每個圖案需剛好 4 格，請檢查紅色的項目</span>`;
    }
  }
}

// 3D View Manipulation
function setCubeTransform(animate = false) {
  const cubeEl = $('cube');
  if (!cubeEl) return;
  cubeEl.classList.toggle('smooth', animate);
  cubeEl.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
}

function initViewControls() {
  const stage = $('stage');

  stage.addEventListener('pointerdown', e => {
    if (pieceDrag) return;
    drag = { startX: e.clientX, startY: e.clientY, rx, ry };
    moved = false;
  });

  window.addEventListener('pointermove', e => {
    if (!drag || pieceDrag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) {
      moved = true;
    }
    ry = drag.ry + dx * 0.55;
    rx = Math.max(-88, Math.min(88, drag.rx - dy * 0.55));
    setCubeTransform(false);
  });

  window.addEventListener('pointerup', () => {
    drag = null;
  });
  window.addEventListener('pointercancel', () => {
    drag = null;
  });

  // View preset chips
  document.querySelectorAll('[data-view]').forEach(chip => {
    chip.onclick = () => {
      const v = VIEW_PRESETS[chip.dataset.view];
      if (!v) return;
      rx = v.rx;
      ry = v.ry;
      setCubeTransform(true);
      document.querySelectorAll('[data-view]').forEach(c => c.classList.remove('on'));
      chip.classList.add('on');
    };
  });
}

// Mathematical 3D State Transition with Rotation Tracking
function applyMoveWithGeometry(stateObj, mv) {
  const n = mv[1] === '2' ? 2 : (mv[1] === "'" ? 3 : 1);
  let cur = stateObj;
  const f = mv[0];
  const a = MOVE_AXIS[f];

  for (let step = 0; step < n; step++) {
    const nextSt = applyBase(cur.st, f);
    const nextOrig = STICKER_MOVE[f].map(src => cur.orig[src]);
    const nextTexUp = STICKER_MOVE[f].map(src => {
      const u = cur.texUp[src];
      if (dot(G[src].p, a) === 1) {
        return rot(u, a);
      }
      return u.slice();
    });
    const nextRot = nextTexUp.map((u, s) => calcTextureAngle(u, s));
    cur = { st: nextSt, orig: nextOrig, texUp: nextTexUp, rot: nextRot };
  }
  return cur;
}

// 3D Layer Animation (Slower, clearer movement)
const PLANE_OR = a => a[0] ? 'rotateY(90deg)' : a[1] ? 'rotateX(90deg)' : '';

function plane(a, off) {
  const p = document.createElement('div');
  p.className = 'cut';
  p.style.transform = `translate3d(${a[0] * off}px, ${-a[1] * off}px, ${a[2] * off}px) ${PLANE_OR(a)}`;
  return p;
}

function animateMove(mv, sign) {
  return new Promise(resolve => {
    animating = true;
    const f = mv[0];
    const a = MOVE_AXIS[f];
    const n = mv[1] === '2' ? 2 : (mv[1] === "'" ? -1 : 1);
    const dur = Math.abs(n) === 2 ? 900 : 650;

    const group = document.createElement('div');
    group.className = 'layer';

    const fixedPlane = plane(a, -0.5);
    group.appendChild(plane(a, 0.5));

    // Append layer stickers
    LAYER[f].forEach(s => group.appendChild(CUBE_ST[s]));

    const cubeEl = $('cube');
    cubeEl.append(group, fixedPlane);

    group.style.transform = `rotate3d(${a[0]}, ${-a[1]}, ${a[2]}, 0deg)`;
    void group.offsetWidth; // Force reflow

    group.style.transition = `transform ${dur}ms cubic-bezier(.4, .1, .3, 1)`;
    group.style.transform = `rotate3d(${a[0]}, ${-a[1]}, ${a[2]}, ${90 * n * sign}deg)`;

    setTimeout(() => {
      LAYER[f].forEach(s => cubeEl.appendChild(CUBE_ST[s]));
      group.remove();
      fixedPlane.remove();
      animating = false;
      resolve();
    }, dur + 50);
  });
}

async function go(k, anim = false) {
  if (animating) return;
  k = Math.max(0, Math.min(sol.length, k));
  if (k === step) return;

  if (anim && k === step + 1) {
    await animateMove(sol[step], 1);
  } else if (anim && k === step - 1) {
    await animateMove(sol[k], -1);
  }

  step = k;
  renderAllStickers();
  updateSolveUI();
}

async function replay() {
  if (animating || step >= sol.length) return;
  await animateMove(sol[step], 1);
  step++;
  renderAllStickers();
  updateSolveUI();
  await new Promise(r => setTimeout(r, 900));
  await animateMove(sol[step - 1], -1);
  step--;
  renderAllStickers();
  updateSolveUI();
}

function updateSolveUI() {
  const isFinished = step >= sol.length;
  const currentMove = isFinished ? null : sol[step];

  $('stepNo').textContent = isFinished
    ? `完成 · 共 ${sol.length} 步`
    : `第 ${step + 1} 步 / 共 ${sol.length} 步`;

  $('stepMove').textContent = isFinished ? '✓' : ICON[currentMove];
  $('stepDesc').textContent = isFinished
    ? '恭喜完成！方塊已經全部轉回來了！'
    : DESC[currentMove];

  if (step === 0) {
    $('cheer').textContent = '拿好吊飾（左下後方），照著箭頭一步一步做！';
  } else if (isFinished) {
    $('cheer').textContent = 'ALLDAY PROJECT: 太棒了！完美復原！';
  } else {
    $('cheer').textContent = CHEERS[(step - 1) % CHEERS.length];
  }

  const pills = document.querySelectorAll('.mv');
  pills.forEach((p, idx) => {
    p.className = 'mv' + (idx < step ? ' done' : (idx === step ? ' cur' : ''));
  });

  $('btnPrev').disabled = step <= 0;
  $('btnNext').disabled = isFinished;
  $('btnReplay').disabled = isFinished;
}

function exitSolve() {
  stopPlay();
  mode = 'edit';
  $('solveBox').classList.add('hidden');
  $('editBox').classList.remove('hidden');
  updateQuadUI();
}

function stopPlay() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const btn = $('btnPlay');
  if (btn) btn.textContent = '▶ 自動播放';
}

// Action Buttons
$('btnSolved').onclick = () => {
  exitSolve();
  state = SOLVED();
  stickerQuad = Array.from({ length: 24 }, (_, i) => i % 4);
  stickerRot = Array(24).fill(0);
  texUpVectors = G.map((g, s) => FACE_UP[Math.floor(s / 4)].slice());
  selectSticker(17);
  renderAllStickers();
  updateStatus();
  updateQuadUI();
  showMsg('已設為完成狀態，所有面均已對齊');
};

function clearToDefault() {
  exitSolve();
  state = Array(24).fill(null);
  stickerQuad = Array(24).fill(null);
  stickerRot = Array(24).fill(0);
  texUpVectors = G.map((g, s) => FACE_UP[Math.floor(s / 4)].slice());

  // Pre-fill anchor corner to exact solved position, quadrant, and orientation
  // FIX.s: [14 (D), 18 (L), 23 (B)]
  state[FIX.s[0]] = 'W'; stickerQuad[FIX.s[0]] = 2; stickerRot[FIX.s[0]] = 0; // Down: WOOCHAN (BL)
  state[FIX.s[1]] = 'N'; stickerQuad[FIX.s[1]] = 2; stickerRot[FIX.s[1]] = 0; // Left: ANNIE (BL)
  state[FIX.s[2]] = 'B'; stickerQuad[FIX.s[2]] = 3; stickerRot[FIX.s[2]] = 0; // Back: BAILEY (BR)

  brushQuad = pickNextUnusedQuad(brush);
  selectSticker(17);
  renderAllStickers();
  updateStatus();
  updateQuadUI();
}

$('btnClear').onclick = () => {
  clearToDefault();
  showMsg('已清空。吊飾角塊（左下後方）已自動對齊定位，請將 1/4 拼圖拖曳或點選填入！');
};

$('btnRandom').onclick = () => {
  exitSolve();
  const fs = 'URF';
  let last = '', seq = [];
  for (let i = 0; i < 12; i++) {
    let f;
    do { f = fs[Math.random() * 3 | 0]; } while (f === last);
    last = f;
    seq.push(f + ['', "'", '2'][Math.random() * 3 | 0]);
  }

  let curObj = {
    st: SOLVED(),
    orig: Array.from({ length: 24 }, (_, i) => i),
    texUp: G.map((g, s) => FACE_UP[Math.floor(s / 4)].slice()),
    rot: Array(24).fill(0)
  };

  for (const m of seq) {
    curObj = applyMoveWithGeometry(curObj, m);
  }

  state = curObj.st;
  stickerQuad = curObj.orig.map(k => k % 4);
  stickerRot = curObj.rot;
  texUpVectors = curObj.texUp;

  selectSticker(17);
  renderAllStickers();
  updateStatus();
  updateQuadUI();
  showMsg(`已隨機打亂（${seq.length} 步），所有圖案部位與方向均符合實體物理旋轉！`);
};

$('btnRotCW').onclick = () => rotateSticker(90);
$('btnRotCCW').onclick = () => rotateSticker(-90);
$('btnClearCell').onclick = clearSelectedCell;

$('btnSolve').onclick = () => {
  try {
    sol = solve(state);

    let curObj = {
      st: SOLVED(),
      orig: Array.from({ length: 24 }, (_, i) => i),
      texUp: G.map((g, s) => FACE_UP[Math.floor(s / 4)].slice()),
      rot: Array(24).fill(0)
    };

    for (let i = sol.length - 1; i >= 0; i--) {
      curObj = applyMoveWithGeometry(curObj, INV_MOVE[sol[i]]);
    }

    state = curObj.st.slice();
    stickerQuad = curObj.orig.map(k => k % 4);
    stickerRot = curObj.rot.slice();
    texUpVectors = curObj.texUp.map(v => v.slice());

    states = [curObj.st];
    statesOrig = [curObj.orig];
    statesRot = [curObj.rot];

    for (const m of sol) {
      curObj = applyMoveWithGeometry(curObj, m);
      states.push(curObj.st);
      statesOrig.push(curObj.orig);
      statesRot.push(curObj.rot);
    }

    mode = 'solve';
    step = 0;

    const movesEl = $('moves');
    movesEl.innerHTML = sol.map((m, idx) => `<span class="mv" data-k="${idx}">${idx + 1}</span>`).join('');
    document.querySelectorAll('.mv').forEach(el => {
      el.onclick = () => go(+el.dataset.k);
    });

    $('editBox').classList.add('hidden');
    $('solveBox').classList.remove('hidden');

    rx = -22;
    ry = 35;
    setCubeTransform(true);
    document.querySelectorAll('[data-view]').forEach(c => c.classList.toggle('on', c.dataset.view === 'front'));

    showMsg(sol.length ? `找到最佳解：只需 ${sol.length} 步！` : '目前已經是完成狀態囉！');
    renderAllStickers();
    updateSolveUI();
  } catch (err) {
    showMsg(typeof err === 'string' ? err : '輸入的方塊狀態有誤，請檢查', true);
  }
};

$('btnNext').onclick = () => go(step + 1, true);
$('btnPrev').onclick = () => go(step - 1, true);
$('btnReplay').onclick = replay;
$('btnFirst').onclick = () => { stopPlay(); go(0); };
$('btnEdit').onclick = () => { exitSolve(); renderAllStickers(); updateStatus(); showMsg(''); };

$('btnPlay').onclick = () => {
  if (timer) return stopPlay();
  if (step >= sol.length) go(0);
  $('btnPlay').textContent = '❚❚ 暫停';
  // Slower auto-play interval (2800ms per step) so users can comfortably follow along with their real cube
  timer = setInterval(() => {
    if (step >= sol.length) return stopPlay();
    go(step + 1, true);
  }, 2800);
};

document.addEventListener('keydown', e => {
  if (mode !== 'solve') return;
  if (e.key === 'ArrowRight' || e.key === ' ') {
    e.preventDefault();
    go(step + 1, true);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    go(step - 1, true);
  }
});

// Initialization
initIntroCube();
init3DCube();
initPalette();
initPieceDragAndDrop();
initViewControls();
setCubeTransform(false);
clearToDefault();

showMsg('正在載入解題大腦…');
setTimeout(() => {
  const t0 = performance.now();
  buildTables();
  const dur = Math.round(performance.now() - t0);
  showMsg(`準備完成（${dur}ms）· 吊飾角塊已自動定位，請將 1/4 拼圖拖曳或點選填入空格！`);
}, 30);
