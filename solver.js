// ===== ALLDAY CUBE — 2x2 optimal solver =====
const FACES = 'URFDLB';
// Each "color" is one logo face of the ALLDAY PROJECT keychain cube.
// Order = solved face U R F D L B.  rot = how the logo is rotated on that face
// (viewed from outside, with U on top; U viewed with B on top; D viewed with F on top).
const LOGOS = {
  A: { label: 'ADP',      img: 'img/ADP.png',      rot: 0 },
  Y: { label: 'YOUNGSEO', img: 'img/YOUNGSEO.png', rot: 90 },
  T: { label: 'TARZZAN',  img: 'img/TARZZAN.png',  rot: 0 },
  W: { label: 'WOOCHAN',  img: 'img/WOOCHAN.png',  rot: 180 },
  N: { label: 'ANNIE',    img: 'img/ANNIE.png',    rot: -90 },
  B: { label: 'BAILEY',   img: 'img/BAILEY.png',   rot: 0 },
};
const COLORS = Object.keys(LOGOS);
const COLOR_NAME = Object.fromEntries(Object.entries(LOGOS).map(([k, v]) => [k, v.label]));
const SOLVED = () => FACES.split('').flatMap((f, i) => Array(4).fill(COLORS[i]));

// ---- sticker geometry (x right, y up, z front) ----
function geo(f, i) {
  const r = i >> 1, c = i & 1, a = c ? 1 : -1, b = r ? -1 : 1;
  switch (f) {
    case 0: return { p: [a, 1, r ? 1 : -1], n: [0, 1, 0] };
    case 1: return { p: [1, b, c ? -1 : 1], n: [1, 0, 0] };
    case 2: return { p: [a, b, 1], n: [0, 0, 1] };
    case 3: return { p: [a, -1, r ? -1 : 1], n: [0, -1, 0] };
    case 4: return { p: [-1, b, c ? 1 : -1], n: [-1, 0, 0] };
    case 5: return { p: [c ? -1 : 1, b, -1], n: [0, 0, -1] };
  }
}
const G = []; for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) G.push(geo(f, i));
const key = (p, n) => p.join() + '|' + n.join();
const KEY = new Map(G.map((g, s) => [key(g.p, g.n), s]));
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const rot = (v, a) => { const c = cross(a, v), d = dot(a, v); return v.map((x, k) => a[k]*d - c[k]); };

const MOVE_AXIS = { U: [0,1,0], D: [0,-1,0], R: [1,0,0], L: [-1,0,0], F: [0,0,1], B: [0,0,-1] };
const STICKER_MOVE = {}, LAYER = {};
for (const m in MOVE_AXIS) {
  const a = MOVE_AXIS[m], P = [...Array(24).keys()], L = [];
  G.forEach((g, s) => {
    if (dot(g.p, a) === 1) { P[KEY.get(key(rot(g.p, a), rot(g.n, a)))] = s; L.push(s); }
  });
  STICKER_MOVE[m] = P; LAYER[m] = L;
}
const applyBase = (st, m) => STICKER_MOVE[m].map(src => st[src]);
function applyMove(st, mv) {
  const n = mv[1] === '2' ? 2 : mv[1] === "'" ? 3 : 1;
  for (let i = 0; i < n; i++) st = applyBase(st, mv[0]);
  return st;
}

// ---- corner positions (slot0 = U/D sticker, rest consistent handedness) ----
const POS = [];
for (const y of [1, -1]) for (const z of [-1, 1]) for (const x of [-1, 1]) {
  const ss = G.map((g, s) => s).filter(s => G[s].p.join() === [x,y,z].join());
  const s0 = ss.find(s => G[s].n[1] !== 0), o = ss.filter(s => s !== s0);
  if (dot(cross(G[s0].n, G[o[0]].n), G[o[1]].n) < 0) o.reverse();
  POS.push({ c: [x,y,z], s: [s0, ...o] });
}
const FIXED = POS.findIndex(p => p.c.join() === '-1,-1,-1');
const FIX = POS.splice(FIXED, 1)[0];

// cubie-level effect of U/R/F
const CMOVE = {};
for (const m of 'URF') {
  const lab = applyBase([...Array(24).keys()], m);
  CMOVE[m] = POS.map(p => {
    const l = lab[p.s[0]];
    for (let q = 0; q < 7; q++) { const k = POS[q].s.indexOf(l); if (k >= 0) return [q, k]; }
  });
}
const cPerm = (pm, m) => CMOVE[m].map(([q]) => pm[q]);
const cOri = (or, m) => CMOVE[m].map(([q, k]) => (or[q] - k + 3) % 3);

const FACT = [1,1,2,6,24,120,720,5040];
function rankP(a) { let r = 0; for (let i = 0; i < 7; i++) { let c = 0; for (let j = i+1; j < 7; j++) if (a[j] < a[i]) c++; r += c * FACT[6-i]; } return r; }
function unrankP(r) { const e = [0,1,2,3,4,5,6], a = []; for (let i = 6; i >= 0; i--) { const q = Math.floor(r / FACT[i]); r %= FACT[i]; a.push(e.splice(q, 1)[0]); } return a; }
const rankO = o => o.slice(0, 6).reduce((s, v, i) => s + v * 3 ** i, 0);
function unrankO(r) { const o = []; let s = 0; for (let i = 0; i < 6; i++) { o.push(r % 3); s += r % 3; r = Math.floor(r / 3); } o.push((3 - s % 3) % 3); return o; }

const MOVES = ['U','U2',"U'",'R','R2',"R'",'F','F2',"F'"];
let PM, OM, DIST;
function buildTables() {
  PM = new Uint16Array(5040 * 9); OM = new Uint16Array(729 * 9);
  for (let r = 0; r < 5040; r++) [...'URF'].forEach((m, b) => { let a = unrankP(r); for (let n = 0; n < 3; n++) { a = cPerm(a, m); PM[r*9 + b*3 + n] = rankP(a); } });
  for (let r = 0; r < 729; r++) [...'URF'].forEach((m, b) => { let a = unrankO(r); for (let n = 0; n < 3; n++) { a = cOri(a, m); OM[r*9 + b*3 + n] = rankO(a); } });
  const N = 5040 * 729; DIST = new Uint8Array(N).fill(255);
  const Q = new Int32Array(N); let h = 0, t = 0; DIST[0] = 0; Q[t++] = 0;
  while (h < t) {
    const x = Q[h++], p = (x / 729) | 0, o = x % 729, d = DIST[x] + 1;
    for (let m = 0; m < 9; m++) { const y = PM[p*9+m] * 729 + OM[o*9+m]; if (DIST[y] === 255) { DIST[y] = d; Q[t++] = y; } }
  }
}

// ---- convert sticker state → coordinates (with validation) ----
const FC = { U: 'A', R: 'Y', F: 'T', D: 'W', L: 'N', B: 'B' };
const REF = POS.map(p => p.s.map(s => FC[FACES[(s / 4) | 0]]));

function encode(st) {
  const cnt = {};
  for (const c of st) cnt[c] = (cnt[c] || 0) + 1;
  for (const c of COLORS) {
    if (cnt[c] !== 4) {
      throw `每個圖案都要剛好 4 格（「${COLOR_NAME[c]}」目前 ${cnt[c] || 0} 格）`;
    }
  }

  // Check the anchor corner (FIX: Left-Down-Back)
  const fixD = st[FIX.s[0]], fixL = st[FIX.s[1]], fixB = st[FIX.s[2]];
  if (fixD !== 'W' || fixL !== 'N' || fixB !== 'B') {
    throw '吊飾角塊（左下後方）圖案不符！請拿好方塊：底面為 WOOCHAN、左面為 ANNIE、後面為 BAILEY';
  }

  const perm = [], ori = [];
  POS.forEach((p, i) => {
    const cols = p.s.map(s => st[s]);
    let found = false;
    for (let j = 0; j < 7 && !found; j++) {
      for (let t = 0; t < 3; t++) {
        if ([0, 1, 2].every(k => cols[(t + k) % 3] === REF[j][k])) {
          perm[i] = j;
          ori[i] = t;
          found = true;
          break;
        }
      }
    }
    if (!found) throw '有角塊的圖案組合不存在（例如相對面圖案出現在同角），請檢查是否有格子填錯';
  });

  if (new Set(perm).size !== 7) throw '有重複的角塊，請檢查是否有格子填錯';
  if (ori.reduce((a, b) => a + b, 0) % 3 !== 0) {
    throw '角塊方向不平衡（實體方塊不可能單獨扭角），請檢查是否填錯';
  }

  return rankP(perm) * 729 + rankO(ori);
}
function solve(st) {
  let x = encode(st); const path = [];
  while (DIST[x] > 0) {
    const p = (x / 729) | 0, o = x % 729;
    for (let m = 0; m < 9; m++) { const y = PM[p*9+m] * 729 + OM[o*9+m]; if (DIST[y] === DIST[x] - 1) { path.push(MOVES[m]); x = y; break; } }
  }
  return path;
}

