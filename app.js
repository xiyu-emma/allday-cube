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

// 3D View Angles & Quaternion Free-Rotation Setup
// Enables seamless 360-degree rotation across all faces without gimbal lock or angle clamping
function quatMultiply(q1, q2) {
  const [w1, x1, y1, z1] = q1;
  const [w2, x2, y2, z2] = q2;
  return [
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2
  ];
}

function quatNormalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len < 1e-9) return [1, 0, 0, 0];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

function eulerToQuat(rxDeg, ryDeg) {
  const ax = rxDeg * Math.PI / 180;
  const ay = ryDeg * Math.PI / 180;
  const qx = [Math.cos(ax / 2), Math.sin(ax / 2), 0, 0];
  const qy = [Math.cos(ay / 2), 0, Math.sin(ay / 2), 0];
  return quatNormalize(quatMultiply(qx, qy));
}

function quatToMatrix3d(q) {
  const [w, x, y, z] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  const m00 = 1 - (yy + zz);
  const m01 = xy - wz;
  const m02 = xz + wy;

  const m10 = xy + wz;
  const m11 = 1 - (xx + zz);
  const m12 = yz - wx;

  const m20 = xz - wy;
  const m21 = yz + wx;
  const m22 = 1 - (xx + yy);

  return `matrix3d(${m00.toFixed(6)}, ${m10.toFixed(6)}, ${m20.toFixed(6)}, 0, ${m01.toFixed(6)}, ${m11.toFixed(6)}, ${m21.toFixed(6)}, 0, ${m02.toFixed(6)}, ${m12.toFixed(6)}, ${m22.toFixed(6)}, 0, 0, 0, 0, 1)`;
}

const DEFAULT_QUAT = eulerToQuat(-14, 20); // Front face (TARZZAN T logo) facing user more directly
let cubeQuat = [...DEFAULT_QUAT];
let moved = false;

// Drag-and-drop state for 1/4 puzzle pieces
let pieceDrag = null;

const VIEW_PRESETS = {
  front: { rx: -14, ry: 20 },   // 正面偏向使用者（T logo 更加正對螢幕）
  back: { rx: 14, ry: 200 },    // 下・後・左
  top: { rx: -85, ry: 0 },      // 正上面 ADP
  bottom: { rx: 85, ry: 0 },    // 正底面 WOOCHAN
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
  U: '把最上面那一層【往左轉】1/4 圈（90°）',
  "U'": '把最上面那一層【往右轉】1/4 圈（90°）',
  U2: '把最上面那一層轉半圈（180°）',
  R: '把右邊那一層【往上推】1/4 圈（遠離你）',
  "R'": '把右邊那一層【往下拉】1/4 圈（靠近你）',
  R2: '把右邊那一層轉半圈（180°）',
  F: '把面向你的那一面【順時針】轉 1/4 圈',
  "F'": '把面向你的那一面【逆時針】轉 1/4 圈',
  F2: '把面向你的那一面轉半圈（180°）',
};

const ICON = {
  U: '←', "U'": '→', U2: '⇇',
  R: '↑', "R'": '↓', R2: '⇈',
  F: '↻', "F'": '↺', F2: '⟳'
};

// ALLDAY PROJECT 2nd EP <CRASH> (2026) English Lyrics Cheers & Audio Snippets
const DEFAULT_CHEERS = [
  {
    id: "c1",
    member: "ANNIE",
    song: "DO IT LIKE THIS",
    lyric: "Dance watch me dance, watch me do my dance!",
    file: "audio/c1.mp3",
    src: "audio/DO IT LIKE THIS.mp3",
    start: 6.9,
    end: 10.6
  },
  {
    id: "c2",
    member: "TARZZAN",
    song: "CRASH",
    lyric: "I just wanna keep the shots going Blame it on me",
    file: "audio/c2.mp3",
    src: "audio/CRASH.mp3",
    start: 0.4,
    end: 4.4
  },
  {
    id: "c3",
    member: "YOUNGSEO",
    song: "DO IT LIKE THIS",
    lyric: "They wanna know just how we roll",
    file: "audio/c3.mp3",
    src: "audio/DO IT LIKE THIS.mp3",
    start: 90.1,
    end: 93.5
  },
  {
    id: "c4",
    member: "BAILEY",
    song: "NO LIMIT",
    lyric: "Pullin' up smooth, but I move quick 불러 봐 price, I'ma match it",
    file: "audio/c4.mp3",
    src: "audio/NO LIMIT.mp3",
    start: 16.9,
    end: 20
  },
  {
    id: "c5",
    member: "WOOCHAN",
    song: "UP ALL NIGHT",
    lyric: "You know we be coming on sight",
    file: "audio/c5.mp3",
    src: "audio/UP ALL NIGHT.mp3",
    start: 49.4,
    end: 52.8
  },
  {
    id: "c6",
    member: "YOUNGSEO",
    song: "CRASH",
    lyric: "It's a show now, tear the roof down",
    file: "audio/c6.mp3",
    src: "audio/CRASH.mp3",
    start: 95.1,
    end: 99.1
  },
  {
    id: "c7",
    member: "BAILEY",
    song: "NO LIMIT",
    lyric: "All day my clique, pull up like this! Step back when we hit 'em with the ",
    file: "audio/c7.mp3",
    src: "audio/NO LIMIT.mp3",
    start: 47.9,
    end: 51.4
  },
  {
    id: "c8",
    member: "ANNIE",
    song: "TALK",
    lyric: "Running your big mouth since day one Got my day ones running you down all day",
    file: "audio/c8.mp3",
    src: "audio/TALK.mp3",
    start: 32.6,
    end: 36.3
  },
  {
    id: "c9",
    member: "WOOCHAN",
    song: "CRASH",
    lyric: "I don't need your lo-lo-lo-lo-lo-lo-love",
    file: "audio/c9.mp3",
    src: "audio/CRASH.mp3",
    start: 58.7,
    end: 62.1
  },
  {
    id: "c10",
    member: "TARZZAN",
    song: "DO IT LIKE THIS",
    lyric: "She can't copy my swag Can't copy my swag (Yeah)",
    file: "audio/c10.mp3",
    src: "audio/DO IT LIKE THIS.mp3",
    start: 71.6,
    end: 75.5
  },
  {
    id: "c11",
    member: "TARZZAN",
    song: "NO LIMIT",
    lyric: "No limit Make 'em say (Oh)",
    file: "audio/c11.mp3",
    src: "audio/NO LIMIT.mp3",
    start: 103.2,
    end: 106.7
  },
  {
    id: "c12",
    member: "WOOCHAN",
    song: "UP ALL NIGHT",
    lyric: "Don't stress 불러 let your friends come too, yeah",
    file: "audio/c12.mp3",
    src: "audio/UP ALL NIGHT.mp3",
    start: 18.8,
    end: 21.6
  },
  {
    id: "c13",
    member: "YOUNGSEO",
    song: "CRASH",
    lyric: "예고 따윈 없이 We crash the party",
    file: "audio/c13.mp3",
    src: "audio/CRASH.mp3",
    start: 12.2,
    end: 15.1
  },
  {
    id: "c14",
    member: "WOOCHAN",
    song: "DO IT LIKE THIS",
    lyric: "Monday, Tuesday, Friday, do it like this!",
    file: "audio/c14.mp3",
    src: "audio/DO IT LIKE THIS.mp3",
    start: 51.6,
    end: 55
  },
  {
    id: "c15",
    member: "BAILEY",
    song: "UP ALL NIGHT",
    lyric: "Would you come and waste my time 'til 5 in the morning?",
    file: "audio/c15.mp3",
    src: "audio/UP ALL NIGHT.mp3",
    start: 53,
    end: 56.2
  },
  {
    id: "c_1793865092293",
    member: "ALLDAY PROJECT",
    song: "UP ALL NIGHT",
    lyric: "°☆::‧(￣▽￣)/‧:‧°☆",
    file: "audio/c_1793865092293.mp3",
    src: "audio/UP ALL NIGHT.mp3",
    start: 158.1,
    end: 162.3
  }
];

const CHEER_FINISH_DEFAULT = DEFAULT_CHEERS.find(c => c.id === 'c_1793865092293') || DEFAULT_CHEERS[DEFAULT_CHEERS.length - 1];

function getActiveCheers() {
  try {
    const saved = localStorage.getItem('allday_custom_cheers');
    if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch (e) { }
  return DEFAULT_CHEERS;
}

function getFinishCheer() {
  const cheers = getActiveCheers();
  try {
    const savedId = localStorage.getItem('allday_finish_cheer_id');
    if (savedId) {
      const found = cheers.find(c => (c.id && c.id === savedId) || c.file === savedId || c.lyric === savedId);
      if (found) return found;
    }
  } catch (e) { }
  const found = cheers.find(c => c.id === 'c_1793865092293');
  return found || cheers[cheers.length - 1] || CHEER_FINISH_DEFAULT;
}

function setFinishCheerId(id) {
  try {
    localStorage.setItem('allday_finish_cheer_id', id);
  } catch (e) { }
}

let sessionCheers = [];

function prepareSessionCheers(totalSteps) {
  const finishItem = getFinishCheer();
  const allCheers = getActiveCheers();
  // Filter out the finish cheer so other steps feature randomized lyrics from other members!
  const pool = allCheers.filter(c => (c.id && finishItem.id) ? c.id !== finishItem.id : c.lyric !== finishItem.lyric);
  const candidates = pool.length > 0 ? pool : allCheers;

  sessionCheers = [];
  let bag = [];

  for (let i = 0; i < totalSteps; i++) {
    if (bag.length === 0) {
      bag = [...candidates];
      for (let j = bag.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [bag[j], bag[k]] = [bag[k], bag[j]];
      }
    }
    sessionCheers.push(bag.pop());
  }
}

let voiceEnabled = true;
let currentAudio = null;
let currentCheerItem = null;
let stopTimer = null;

function playCheerAudio(item) {
  if (!voiceEnabled || !item) return;

  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  const audio = new Audio();
  currentAudio = audio;

  const id = item.id || 'c1';
  // Candidate sources to try in priority order:
  // 1. Standalone cut file audio/{id}.wav
  // 2. Standalone cut file audio/{id}.mp3
  // 3. Explicit item.file
  // 4. Full song snippet item.src with timestamps
  const sources = [
    ...(item.file ? [{ url: item.file, isCut: true }] : []),
    { url: `audio/${id}.mp3`, isCut: true },
    { url: `audio/${id}.wav`, isCut: true },
    ...(item.src ? [{ url: item.src, isCut: false }] : [])
  ];

  let srcIdx = 0;
  function tryNext() {
    if (srcIdx >= sources.length) {
      speakText(item.lyric);
      return;
    }
    const cur = sources[srcIdx++];
    audio.src = cur.url;
    audio.onerror = tryNext;

    const onReady = () => {
      if (!cur.isCut && item.start != null) {
        audio.currentTime = item.start;
      }
      audio.play().then(() => {
        if (!cur.isCut && item.end && item.start) {
          const dur = Math.max(1000, (item.end - item.start) * 1000);
          stopTimer = setTimeout(() => {
            if (currentAudio === audio) {
              audio.pause();
              currentAudio = null;
            }
          }, dur);
        }
      }).catch(err => {
        tryNext();
      });
    };

    if (audio.readyState >= 1) {
      onReady();
    } else {
      audio.addEventListener('loadedmetadata', onReady, { once: true });
      audio.load();
    }
  }

  tryNext();
}

function speakText(text) {
  if (!voiceEnabled || !('speechSynthesis' in window) || !text) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.0;
    u.pitch = 1.05;
    window.speechSynthesis.speak(u);
  } catch (err) { }
}

function showMsg(text, isError = false) {
  const el = $('msg');
  if (!el) return;
  el.textContent = text;
  el.className = 'msg' + (isError ? ' err' : '');
}

// ===== Background Music (bg.mp3) for Edit Mode =====
let bgmAudio = null;
let bgmEnabled = (() => {
  try {
    const saved = localStorage.getItem('allday_bgm_enabled');
    if (saved === '0') return false;
  } catch (e) { }
  return true;
})();

function initBgm() {
  if (!bgmAudio) {
    bgmAudio = new Audio('audio/bg.mp3');
    bgmAudio.loop = true;
    bgmAudio.volume = 0.35; // Gentle and comfortable background volume
  }
}

function playBgm() {
  if (!bgmEnabled || mode !== 'edit') return;
  initBgm();
  if (bgmAudio && bgmAudio.paused) {
    bgmAudio.play().catch(() => {
      // Browser autoplay policy might defer until user gesture
    });
  }
}

function pauseBgm() {
  if (bgmAudio && !bgmAudio.paused) {
    bgmAudio.pause();
  }
}

function toggleBgm() {
  bgmEnabled = !bgmEnabled;
  try {
    localStorage.setItem('allday_bgm_enabled', bgmEnabled ? '1' : '0');
  } catch (e) { }
  updateBgmButton();
  if (bgmEnabled) {
    if (mode === 'edit') playBgm();
  } else {
    pauseBgm();
  }
}

function updateBgmButton() {
  const btn = $('btnBgm');
  if (!btn) return;
  if (bgmEnabled) {
    btn.className = 'bgm-btn';
    btn.textContent = '背景音樂：開';
    btn.setAttribute('aria-pressed', 'true');
    btn.title = '點擊關閉背景音樂 (bg.mp3)';
  } else {
    btn.className = 'bgm-btn off';
    btn.textContent = '背景音樂：關';
    btn.setAttribute('aria-pressed', 'false');
    btn.title = '點擊開啟背景音樂 (bg.mp3)';
  }
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

    const pos = [
      g.p[0] * H + g.n[0] * H,
      -(g.p[1] * H + g.n[1] * H),
      g.p[2] * H + g.n[2] * H
    ];
    el.style.transform = `translate3d(${pos[0]}px,${pos[1]}px,${pos[2]}px) ${ORIENT[FACES[f]]}`;

    el.innerHTML = `<i class="st-inner"><b class="st-img" style="background-image:url(${LOGOS[code].img});background-size:200% 200%;background-position:${c * 100}% ${r * 100}%"></b></i>`;
    introCubeEl.appendChild(el);
  });

  const enterApp = () => {
    const introScreen = $('introScreen');
    const appWrap = $('appWrap');
    if (introScreen) introScreen.classList.add('hidden');
    if (appWrap) appWrap.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    playBgm();
    updateBgmButton();
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
  if (rot === 90) return [2, 0, 3, 1][vQ];
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
  const curRot = mode === 'edit' ? (stickerRot[s] || 0) : statesRot[step][s];
  const curQuad = mode === 'edit'
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
  cubeEl.style.transform = quatToMatrix3d(cubeQuat);
}

function initViewControls() {
  const stage = $('stage');
  let isDragging = false;
  let lastX = 0, lastY = 0;
  let startX = 0, startY = 0;

  stage.addEventListener('pointerdown', e => {
    if (pieceDrag) return;
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
  });

  window.addEventListener('pointermove', e => {
    if (!isDragging || pieceDrag) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) {
      moved = true;
    }

    const speed = 0.0075;
    const thetaX = -dy * speed;
    const thetaY = dx * speed;
    const deltaQx = [Math.cos(thetaX / 2), Math.sin(thetaX / 2), 0, 0];
    const deltaQy = [Math.cos(thetaY / 2), 0, Math.sin(thetaY / 2), 0];
    const deltaQ = quatMultiply(deltaQx, deltaQy);

    cubeQuat = quatNormalize(quatMultiply(deltaQ, cubeQuat));
    setCubeTransform(false);
  });

  const stopDrag = () => {
    isDragging = false;
  };
  window.addEventListener('pointerup', stopDrag);
  window.addEventListener('pointercancel', stopDrag);

  // View preset chips (if any exist)
  document.querySelectorAll('[data-view]').forEach(chip => {
    chip.onclick = () => {
      const v = VIEW_PRESETS[chip.dataset.view];
      if (!v) return;
      cubeQuat = eulerToQuat(v.rx, v.ry);
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

  const finishItem = getFinishCheer();

  let item;
  if (isFinished) {
    item = finishItem;
  } else {
    item = sessionCheers[step] || getActiveCheers()[step % getActiveCheers().length];
  }
  currentCheerItem = item;

  $('cheer').innerHTML = `
    <span class="cheer-lyric">"${item.lyric}"</span>
    <span class="cheer-tag">${item.member} · ${item.song}</span>
  `;
  playCheerAudio(item);

  const pills = document.querySelectorAll('.mv');
  pills.forEach((p, idx) => {
    p.className = 'mv' + (idx < step ? ' done' : (idx === step ? ' cur' : ''));
  });

  $('btnPrev').disabled = step <= 0;
  $('btnNext').disabled = isFinished;
  if ($('btnReplay')) $('btnReplay').disabled = isFinished;
}

function renderFinishPicker(currentFinish) {
  const sel = $('selFinishCheer');
  if (!sel) return;
  const allCheers = getActiveCheers();
  sel.innerHTML = allCheers.map((c, i) => {
    const isSel = (c.id && c.id === currentFinish.id) || c.lyric === currentFinish.lyric;
    const songName = (c.song || '').replace('.mp3', '');
    const cid = c.id || `c_${i}`;
    return `<option value="${cid}" ${isSel ? 'selected' : ''}>${c.member} · 《${songName}》: "${c.lyric}"</option>`;
  }).join('');
}

function changeFinishCheer(val) {
  const allCheers = getActiveCheers();
  const found = allCheers.find((c, i) => (c.id && c.id === val) || `c_${i}` === val || c.lyric === val);
  if (found) {
    setFinishCheerId(found.id || found.lyric);
    currentCheerItem = found;
    $('cheer').innerHTML = `
      <span class="cheer-lyric">"${found.lyric}"</span>
      <span class="cheer-tag">${found.member} · ${found.song}</span>
    `;
    playCheerAudio(found);
  }
}

function exitSolve() {
  stopPlay();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  mode = 'edit';
  $('solveBox').classList.add('hidden');
  $('editBox').classList.remove('hidden');
  updateQuadUI();
  playBgm();
}

function startPlay() {
  if (timer) return;
  if (step >= sol.length) go(0);
  const btn = $('btnPlay');
  if (btn) btn.textContent = '暫停';
  // Auto-play interval set to 3.8s (3800ms) per step for comfortable following and listening to full lyrics
  timer = setInterval(() => {
    if (step >= sol.length) return stopPlay();
    go(step + 1, true);
  }, 3800);
}

function stopPlay() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  const btn = $('btnPlay');
  if (btn) btn.textContent = '自動播放';
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
    pauseBgm();
    prepareSessionCheers(sol.length + 1);

    cubeQuat = [...DEFAULT_QUAT];
    setCubeTransform(true);
    document.querySelectorAll('[data-view]').forEach(c => c.classList.toggle('on', c.dataset.view === 'front'));

    showMsg(sol.length ? `找到最佳解：只需 ${sol.length} 步！` : '目前已經是完成狀態囉！');
    renderAllStickers();
    updateSolveUI();
    if (sol.length > 0) {
      startPlay();
    }
  } catch (err) {
    showMsg(typeof err === 'string' ? err : '輸入的方塊狀態有誤，請檢查', true);
  }
};

$('btnNext').onclick = () => go(step + 1, true);
$('btnPrev').onclick = () => go(step - 1, true);
const btnReplay = $('btnReplay');
if (btnReplay) btnReplay.onclick = replay;
$('btnFirst').onclick = () => { stopPlay(); go(0); };
$('btnEdit').onclick = () => { exitSolve(); renderAllStickers(); updateStatus(); showMsg(''); };

const btnVoice = $('btnVoice');
if (btnVoice) {
  btnVoice.onclick = () => {
    if (currentCheerItem) {
      voiceEnabled = true;
      playCheerAudio(currentCheerItem);
    }
  };
}

$('btnPlay').onclick = () => {
  if (timer) {
    stopPlay();
  } else {
    startPlay();
  }
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

// BGM Button Setup
const btnBgm = $('btnBgm');
if (btnBgm) {
  btnBgm.onclick = toggleBgm;
  updateBgmButton();
}

// User interaction fallback to start BGM if browser initially paused it
document.addEventListener('click', () => {
  if (mode === 'edit' && bgmEnabled && (!bgmAudio || bgmAudio.paused)) {
    playBgm();
  }
}, { once: true });

// Initialization
initIntroCube();
init3DCube();
initPalette();
initPieceDragAndDrop();
initViewControls();
setCubeTransform(false);
clearToDefault();

setTimeout(() => {
  buildTables();
}, 30);
