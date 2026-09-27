// WORLD materials: MeshStandardMaterial extended via onBeforeCompile. Every surface pattern (timber framing, windows
// with parallax reveals, shutters, doors, clay roof tiles, ashlar masonry, cobbles, fields...) is generated in the
// fragment shader from per-vertex parameters (geom.js layout) -> one draw call per chunk, crisp at any distance,
// no texture repetition. Relief comes from a height value turned into a normal via screen-space derivatives.
import * as THREE from 'three';

export const COMMON_GLSL = /* glsl */`
uniform sampler2D tNoise;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform float uTime;
uniform float uBumpK;
varying vec4 vUV;
varying vec4 vMat;
varying vec3 vWPos;
varying vec3 vWN;
varying float vState;
varying vec3 vTint;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float nL(vec2 p) { return texture(tNoise, p).r; }
float nM(vec2 p) { return texture(tNoise, p).g; }
float nH(vec2 p) { return texture(tNoise, p).b; }
float nF(vec2 p) { return texture(tNoise, p).a; }
float aa(float e, float x) { float w = max(fwidth(x), 1e-4) * 0.75; return smoothstep(e - w, e + w, x); }
float aaw(float e, float x, float w) { return smoothstep(e - w, e + w, x); }
float rectAA(vec2 p, vec2 a, vec2 b) { return aa(a.x, p.x) * (1.0 - aa(b.x, p.x)) * aa(a.y, p.y) * (1.0 - aa(b.y, p.y)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

struct Surf { vec3 alb; float rough; float metal; float h; vec3 emis; float ao; };
Surf surfInit(vec3 c, float r) { Surf s; s.alb = c; s.rough = r; s.metal = 0.0; s.h = 0.0; s.emis = vec3(0.0); s.ao = 1.0; return s; }

// planar frame (must match geom.js)
void frameTB(vec3 N, out vec3 T, out vec3 B) {
  T = abs(N.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), N));
  B = cross(N, T);
}
vec3 gV;   // view vector in tangent space (towards the eye)
vec3 gVW;  // world view vector
vec3 gNW;  // world geometric normal
float gPx; // metres per pixel (lod)

// fake sky / street reflection for glass
vec3 skyRefl(vec3 R, float wob) {
  float y = R.y + wob;
  vec3 sky = mix(uSkyHor, uSkyTop, smoothstep(0.0, 0.6, y));
  vec3 gnd = mix(vec3(0.05, 0.045, 0.04), uSkyHor * 0.45, smoothstep(-0.35, 0.0, y));
  return y > 0.0 ? sky : gnd;
}
`;

// ---------------------------------------------------------------------------------------------------------------
// BUILDINGS
// ---------------------------------------------------------------------------------------------------------------
const BUILDING_GLSL = /* glsl */`
// ashlar blocks: returns (edgeDist, blockHash, row, col)
vec4 ashlar(vec2 uv, float ch, float bl, float seed) {
  float row = floor(uv.y / ch);
  float fy = uv.y - row * ch;
  float x = uv.x / bl + hash12(vec2(row, seed)) ;
  float k = floor(x);
  float j0 = k + (hash12(vec2(k, row + seed * 13.0)) - 0.5) * 0.5;
  float j1 = k + 1.0 + (hash12(vec2(k + 1.0, row + seed * 13.0)) - 0.5) * 0.5;
  float c = k;
  if (x < j0) { j1 = j0; j0 = k - 1.0 + (hash12(vec2(k - 1.0, row + seed * 13.0)) - 0.5) * 0.5; c = k - 1.0; }
  else if (x > j1) { j0 = j1; j1 = k + 2.0 + (hash12(vec2(k + 2.0, row + seed * 13.0)) - 0.5) * 0.5; c = k + 1.0; }
  float ex = min(x - j0, j1 - x) * bl;
  float ey = min(fy, ch - fy);
  return vec4(min(ex, ey), hash12(vec2(c, row) + seed), row, c);
}

vec3 woodCol(float style) {
  return style < 0.5 ? vec3(0.045, 0.028, 0.018) : style < 1.5 ? vec3(0.085, 0.052, 0.032) : style < 2.5 ? vec3(0.13, 0.036, 0.024) : vec3(0.045, 0.042, 0.04);
}

// window with parallax recess. a,b: rect; depth: recess; frame: frame colour; returns weight (1 = window drawn)
float windowPx(inout Surf s, vec2 uv, vec2 a, vec2 b, float depth, vec3 reveal, vec3 frameC, float seed, bool lancet) {
  float inW = rectAA(uv, a, b);
  if (lancet) {
    float w = b.x - a.x; float cx = (a.x + b.x) * 0.5; float r = w * 0.8;
    float yb = b.y - w * 0.6;
    float dx = abs(uv.x - cx);
    // pointed arch: intersection of two circles of radius r centred at (cx -+ (r - w/2), yb)
    float d = length(vec2(dx + (r - w * 0.5), uv.y - yb));
    float arch = uv.y > yb ? 1.0 - aa(r, d) : 1.0;
    inW = rectAA(uv, a, vec2(b.x, b.y)) * arch;
  }
  if (inW <= 0.001) return 0.0;
  vec2 off = -gV.xy / max(gV.z, 0.3) * depth;
  vec2 gp = uv + off;
  float onG = rectAA(gp, a, b);
  vec2 wsz = b - a;
  vec2 q = (gp - a) / wsz;  // 0..1 inside the glass
  // reveal (sill / jambs / head) shading
  vec3 rev = reveal * (gp.y < a.y ? 0.85 : gp.y > b.y ? 0.35 : 0.55);
  // frame + mullion cross
  float fw = 0.055;
  float fr = 1.0 - rectAA(gp, a + fw, b - fw);
  float mul = 1.0 - aa(0.024, abs(gp.x - (a.x + b.x) * 0.5));
  float tra = 1.0 - aa(0.024, abs(gp.y - (a.y + wsz.y * 0.64)));
  if (lancet) { mul = 1.0 - aa(0.03, abs(gp.x - (a.x + b.x) * 0.5)); tra = 1.0 - aa(0.03, abs(fract(q.y * 4.0) - 0.5) * wsz.y / 4.0 * 2.0 - wsz.y / 4.0 + 0.03); }
  float frame = max(fr, max(mul, tra) * (1.0 - fr) * (1.0 - smoothstep(0.02, 0.06, gPx)));
  // leaded panes
  vec2 pq = gp / vec2(0.17, 0.21);
  vec2 pf = abs(fract(pq) - 0.5);
  float lead = smoothstep(0.43, 0.47, max(pf.x, pf.y)) * (1.0 - smoothstep(0.006, 0.018, gPx));
  float pane = mix(hash12(floor(pq) + seed * 17.0), 0.5, smoothstep(0.01, 0.03, gPx));
  // glass
  vec3 R = reflect(-gVW, gNW);
  float fres = 0.05 + 0.95 * pow(1.0 - clamp(dot(gVW, gNW), 0.0, 1.0), 5.0);
  vec3 refl = skyRefl(R, (pane - 0.5) * 0.18);
  vec3 interior = vec3(0.018, 0.016, 0.014) * (0.6 + 0.8 * nM(q * 0.5 + seed));
  float curtain = step(0.55, hash12(vec2(seed, floor(a.x * 3.0)))) * (1.0 - smoothstep(0.18, 0.3, abs(q.x - 0.5) - 0.12)) ;
  curtain = hash12(vec2(seed * 3.0, a.x)) > 0.5 ? (1.0 - smoothstep(0.1, 0.16, min(q.x, 1.0 - q.x))) * 0.8 : 0.0;
  interior = mix(interior, vec3(0.45, 0.42, 0.36) * 0.35, curtain);
  vec3 glassC = interior;
  vec3 frameCol = frameC * (0.85 + 0.2 * nH(uv * 3.0));
  vec3 c = mix(glassC, frameCol, frame);
  c = mix(c, vec3(0.03, 0.03, 0.032), lead * (1.0 - frame) * 0.9);
  c = mix(rev, c, onG);
  float glassW = onG * (1.0 - frame) * (1.0 - lead * 0.9);
  s.alb = mix(s.alb, c, inW);
  s.rough = mix(s.rough, mix(0.7, 0.08, glassW), inW);
  s.emis += refl * (fres * 0.85 + 0.03) * glassW * inW;
  s.h = mix(s.h, -0.02 - 0.02 * frame, inW);
  return inW;
}

// wooden door (planks, iron bands) with recess
float doorPx(inout Surf s, vec2 uv, vec2 a, vec2 b, float depth, vec3 doorC, vec3 surround, bool arch, float seed) {
  float w = b.x - a.x, cx = (a.x + b.x) * 0.5;
  float r = w * 0.5, yb = b.y - r;
  float archM = arch ? (uv.y > yb ? 1.0 - aa(r, length(vec2(uv.x - cx, uv.y - yb))) : 1.0) : 1.0;
  float inD = rectAA(uv, a, b) * archM;
  // stone / timber surround
  float sw = 0.16;
  float archO = arch ? (uv.y > yb ? 1.0 - aa(r + sw, length(vec2(uv.x - cx, uv.y - yb))) : 1.0) : 1.0;
  float outD = rectAA(uv, a - vec2(sw, 0.0), b + vec2(sw, arch ? r : sw)) * archO;
  if (outD <= 0.001) return 0.0;
  vec4 blk = ashlar(uv * vec2(1.0, 1.0) + seed, 0.3, 0.45, seed);
  vec3 sur = surround * (0.85 + 0.25 * blk.y) * mix(0.55, 1.0, smoothstep(0.0, 0.02, blk.x));
  s.alb = mix(s.alb, sur, outD); s.rough = mix(s.rough, 0.85, outD); s.h = mix(s.h, 0.02 * smoothstep(0.0, 0.03, blk.x), outD);
  if (inD <= 0.001) return outD;
  vec2 gp = uv - gV.xy / max(gV.z, 0.3) * depth;
  float onD = rectAA(gp, a, vec2(b.x, b.y + (arch ? 5.0 : 0.0)));
  vec2 q = gp - a;
  float plank = abs(fract(q.x / 0.14) - 0.5);
  vec3 wood = doorC * (0.75 + 0.35 * nF(vec2(q.x * 1.3, q.y * 0.08) + seed)) * (0.7 + 0.3 * smoothstep(0.38, 0.5, 0.5 - plank + 0.44));
  float band = (1.0 - aa(0.04, abs(q.y - 0.4))) + (1.0 - aa(0.04, abs(q.y - (b.y - a.y) + 0.55)));
  wood = mix(wood, vec3(0.03, 0.03, 0.03), clamp(band, 0.0, 1.0) * step(q.x, w * 0.6));
  vec3 c = mix(surround * 0.4, wood, onD);
  s.alb = mix(s.alb, c, inD); s.rough = mix(s.rough, 0.75, inD); s.h = mix(s.h, -0.05 + 0.006 * smoothstep(0.35, 0.5, plank), inD);
  return outD;
}

Surf facade(vec2 uv, float W, float fH, float bayW, float bits, vec3 tint, float seed) {
  float wmask = floor(bits / 4096.0);
  bits = mod(bits, 4096.0);
  float fl = mod(bits, 8.0);
  float ts = mod(floor(bits / 8.0), 8.0);
  float wst = mod(floor(bits / 64.0), 4.0);
  float fg = floor(bits / 256.0);
  bool gable = mod(fg, 2.0) > 0.5;
  bool side = mod(floor(fg / 2.0), 2.0) > 0.5;
  bool door = mod(floor(fg / 4.0), 2.0) > 0.5;
  bool shop = mod(floor(fg / 8.0), 2.0) > 0.5;

  // ---- plaster ----
  float n1 = nM(uv * 0.09 + seed * 3.7), n2 = nH(uv * 0.33 + seed * 1.3), n3 = nF(uv * 1.1 + seed);
  float blotch = nH(uv * 0.07 + seed * 2.1);
  vec3 plaster = tint * (0.84 + 0.26 * n1 + 0.1 * (n2 - 0.5)) * (0.9 + 0.2 * blotch);
  float stain = smoothstep(0.5, 0.85, nM(uv * vec2(0.22, 0.07) + seed * 7.0));
  plaster *= 1.0 - 0.2 * stain;
  float streak = smoothstep(0.55, 0.9, nH(vec2(uv.x * 0.9, uv.y * 0.05) + seed)) ;
  plaster *= 1.0 - 0.12 * streak;
  plaster *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.8, uv.y));
  Surf s = surfInit(plaster, 0.93);
  s.h = (n2 - 0.5) * 0.004;

  vec3 wc = woodCol(wst) * (0.8 + 0.35 * nF(uv * vec2(0.4, 2.5) + seed));
  float nb = max(1.0, floor(W / bayW + 0.5));
  float bw = W / nb;
  float bi = clamp(floor(uv.x / bw), 0.0, nb - 1.0);
  float bx = uv.x - bi * bw;
  float hb = hash12(vec2(bi + 3.0, seed * 91.0));
  float hbf = hash12(vec2(bi + fl * 7.0, seed * 37.0));
  bool lower = fl < 0.5;

  // door placement (ground floor front)
  float doorBay = floor(hash12(vec2(seed, 4.2)) * nb);
  if (nb >= 3.0 && doorBay == 0.0) doorBay = 1.0;

  if (ts >= 1.0 && ts <= 3.0) {
    // ================= timber framing (Fachwerk) =================
    float pw = ts > 2.5 ? 0.15 : 0.19;
    float beam = 0.0;
    float dPost = min(bx, bw - bx);
    beam = max(beam, 1.0 - aa(pw * 0.5, dPost));
    beam = max(beam, 1.0 - aa(0.17, min(uv.x, W - uv.x)));            // corner posts
    beam = max(beam, 1.0 - aa(0.2, uv.y));                               // sill beam
    beam = max(beam, aa(fH - 0.2, uv.y));                                // head plate
    float sillY = 0.88, headY = min(fH - 0.42, sillY + 1.42);
    beam = max(beam, 1.0 - aa(0.065, abs(uv.y - sillY)));                // sill rail
    beam = max(beam, 1.0 - aa(0.065, abs(uv.y - headY - 0.06)));         // head rail
    bool win = (side ? hb < 0.4 : hb < 0.78) && !(gable && (bi == 0.0 || bi == nb - 1.0));
    if (gable) win = win && hbf < 0.7;
    if (wmask > 0.5) win = mod(floor(wmask / exp2(bi)), 2.0) > 0.5;
    float fineK = 1.0 - smoothstep(0.03, 0.08, gPx), fineAvg = 0.22 * (1.0 - fineK);
    if (ts > 2.5) { float st = abs(fract(bx / (bw * 0.5)) - 0.5) * bw * 0.5; beam = max(beam, ((1.0 - aa(0.06, st)) * fineK + fineAvg) * (1.0 - step(sillY, uv.y) * step(uv.y, headY) * (win ? 1.0 : 0.0))); }
    // braces
    float dir = hash12(vec2(bi, seed * 5.0)) < 0.5 ? 1.0 : -1.0;
    if (bi == 0.0) dir = 1.0; if (bi == nb - 1.0) dir = -1.0;
    if (!win) {
      vec2 p0 = vec2(dir > 0.0 ? 0.0 : bw, 0.2), p1 = vec2(dir > 0.0 ? bw : 0.0, fH - 0.2);
      vec2 d = normalize(p1 - p0); vec2 rel = vec2(bx, uv.y) - p0;
      float dl = abs(rel.x * d.y - rel.y * d.x);
      beam = max(beam, (1.0 - aa(0.085, dl)) * fineK + fineAvg);
      if (ts > 1.5 && hbf < 0.5) { // counter brace -> X
        vec2 q0 = vec2(dir > 0.0 ? bw : 0.0, 0.2); vec2 d2 = normalize(vec2(dir > 0.0 ? 0.0 : bw, fH - 0.2) - q0); vec2 r2 = vec2(bx, uv.y) - q0;
        beam = max(beam, (1.0 - aa(0.075, abs(r2.x * d2.y - r2.y * d2.x))) * fineK + fineAvg);
      }
    } else if (ts > 1.5 && uv.y < sillY) {
      // St Andrew's cross / curved struts in the parapet under windows
      vec2 c = vec2(bw * 0.5, (0.2 + sillY) * 0.5);
      vec2 r = vec2(bx, uv.y) - c; float hx = bw * 0.5, hy = (sillY - 0.2) * 0.5;
      vec2 d1 = normalize(vec2(hx, hy)), d2 = normalize(vec2(hx, -hy));
      float x1 = abs(r.x * d1.y - r.y * d1.x), x2 = abs(r.x * d2.y - r.y * d2.x);
      float fig = hbf < 0.55 ? min(x1, x2) : abs(length(r * vec2(1.0, hx / hy)) - hx * 0.62) * 0.6;
      beam = max(beam, (1.0 - aa(0.06, fig)) * fineK + fineAvg);
    }
    float wood = beam;
    vec3 base = mix(s.alb, wc, wood);
    // plaster panels darken towards the timbers (weathering along joints)
    s.alb = base;
    s.rough = mix(s.rough, 0.82, wood);
    s.h += wood * 0.03;
    if (win) {
      float ww = min(bw - pw - 0.14, 1.05);
      vec2 a = vec2(bi * bw + (bw - ww) * 0.5, sillY + 0.065), b = vec2(bi * bw + (bw + ww) * 0.5, headY);
      windowPx(s, uv, a, b, 0.09, wc * 1.4, mix(vec3(0.62, 0.6, 0.55), wc * 1.6, step(0.5, hash12(vec2(seed, 9.1)))), seed + bi, false);
    }
  } else {
    // ================= plastered or ashlar wall =================
    bool stone = ts > 3.5 && ts < 4.5;
    bool church = ts > 4.5;
    if (stone || church) {
      float ch = church ? 0.42 : 0.36;
      vec4 blk = ashlar(uv, ch, church ? 0.9 : 0.75, seed);
      float bv = mix(blk.y, 0.5, smoothstep(0.03, 0.09, gPx));
      vec3 sc = tint * (0.78 + 0.34 * bv) * (0.9 + 0.2 * nH(uv * 0.5 + seed));
      float mort = 1.0 - aa(0.012, blk.x);
      mort *= 1.0 - smoothstep(0.02, 0.06, gPx);
      sc = mix(sc, tint * 0.6, mort * 0.75);
      s.alb = sc * (1.0 - 0.18 * streak) * (1.0 - 0.25 * stain);
      s.rough = 0.88;
      s.h = 0.015 * smoothstep(0.0, 0.05, blk.x);
    }
    // quoins on corners of plaster houses
    if (!stone && !church && hash12(vec2(seed, 2.2)) < 0.5) {
      float qd = min(uv.x, W - uv.x);
      float qrow = floor(uv.y / 0.34);
      float qw = mod(qrow, 2.0) < 0.5 ? 0.55 : 0.35;
      float q = 1.0 - aa(qw, qd);
      vec3 qc = vec3(0.55, 0.5, 0.42) * (0.85 + 0.2 * hash12(vec2(qrow, seed)));
      float qj = 1.0 - aa(0.012, abs(fract(uv.y / 0.34) - 0.5) * 0.34 * 2.0 - 0.32);
      s.alb = mix(s.alb, mix(qc, qc * 0.6, qj), q); s.h += q * 0.02;
    }
    float ww = church ? min(bw * 0.5, 1.8) : min(0.95, bw * 0.4);
    float sillY = church ? 3.2 : 0.92, headY = church ? fH - 2.2 : min(fH - 0.55, 2.4);
    bool win = church ? (bi > 0.0 && bi < nb - 1.0) : (side ? hb < 0.5 : hb < 0.9);
    if (gable) win = win && abs(bi - (nb - 1.0) * 0.5) < 1.1 && hbf < 0.8;
    if (wmask > 0.5 && !church) win = mod(floor(wmask / exp2(bi)), 2.0) > 0.5;
    if (win && !(lower && door && bi == doorBay)) {
      vec2 a = vec2(bi * bw + (bw - ww) * 0.5, sillY), b = vec2(bi * bw + (bw + ww) * 0.5, headY);
      // stone surround / sill
      float sur = rectAA(uv, a - vec2(0.12, 0.1), b + vec2(0.12, 0.12));
      vec3 surC = church ? tint * 1.1 : vec3(0.6, 0.55, 0.47) * (0.9 + 0.2 * nH(uv + seed));
      if (!church) { s.alb = mix(s.alb, surC, sur); s.h += sur * 0.03; }
      // shutters
      bool shut = !church && !stone && hash12(vec2(seed, 5.5)) < 0.75;
      if (shut) {
        float sw = ww * 0.5 + 0.02;
        float sl = rectAA(uv, vec2(a.x - 0.13 - sw, a.y - 0.05), vec2(a.x - 0.13, b.y + 0.05));
        float sr = rectAA(uv, vec2(b.x + 0.13, a.y - 0.05), vec2(b.x + 0.13 + sw, b.y + 0.05));
        float sh = max(sl, sr);
        float pal = hash12(vec2(seed, 6.6));
        vec3 shC = pal < 0.3 ? vec3(0.05, 0.12, 0.06) : pal < 0.55 ? vec3(0.18, 0.04, 0.03) : pal < 0.75 ? vec3(0.08, 0.1, 0.13) : vec3(0.12, 0.07, 0.035);
        float plank = abs(fract(uv.x / 0.11) - 0.5);
        float zb = 1.0 - aa(0.035, abs(fract((uv.y - a.y) / max(b.y - a.y, 0.1) * 3.0) - 0.5) * (b.y - a.y) / 3.0 * 2.0 - 0.0) ;
        vec3 shutC = shC * (0.75 + 0.4 * nF(uv * vec2(1.0, 0.1) + seed)) * (0.8 + 0.2 * smoothstep(0.4, 0.5, 0.95 - plank));
        shutC *= 1.0 - 0.2 * step(0.9, 1.0 - abs(fract((uv.y - a.y) / 0.5) - 0.5) * 2.0);
        s.alb = mix(s.alb, shutC, sh); s.rough = mix(s.rough, 0.7, sh); s.h += sh * 0.04;
      }
      windowPx(s, uv, a, b, church ? 0.35 : 0.2, s.alb * 0.8, church ? vec3(0.08) : vec3(0.7, 0.68, 0.62), seed + bi, church);
      if (church) {
        // stained glass tint in the leaded panes
        vec2 gp = uv - gV.xy / max(gV.z, 0.3) * 0.35;
        float inG = rectAA(gp, a + 0.06, b - 0.06);
        vec3 stc = hash32(floor(gp / vec2(0.22, 0.3)) + seed) * vec3(0.25, 0.12, 0.3) + vec3(0.02, 0.02, 0.05);
        s.alb = mix(s.alb, stc, inG * 0.7 * rectAA(uv, a, b));
      }
    }
  }
  // ---- ground floor: door, plinth ----
  if (lower) {
    if (door) {
      float dw = min(1.3, bw - 0.4), dh = min(2.45, fH - 0.35);
      vec2 a = vec2(doorBay * bw + (bw - dw) * 0.5, 0.0), b = vec2(doorBay * bw + (bw + dw) * 0.5, dh);
      float pal = hash12(vec2(seed, 8.8));
      vec3 dc = pal < 0.4 ? vec3(0.09, 0.05, 0.028) : pal < 0.6 ? vec3(0.06, 0.1, 0.07) : pal < 0.8 ? vec3(0.16, 0.05, 0.03) : vec3(0.1, 0.1, 0.11);
      doorPx(s, uv, a, b, 0.22, dc, ts > 0.5 && ts < 3.5 ? woodCol(wst) * 1.5 : vec3(0.5, 0.46, 0.4), ts > 3.5 || hash12(vec2(seed, 1.7)) < 0.4, seed);
    }
    // plinth
    float pl = 1.0 - aa(0.42 + 0.05 * nL(uv * 0.3 + seed), uv.y);
    vec4 blk = ashlar(uv + seed * 10.0, 0.21, 0.36, seed + 3.0);
    float plod = smoothstep(0.015, 0.05, gPx);
    vec3 pc = vec3(0.3, 0.28, 0.25) * (0.7 + 0.45 * mix(blk.y, 0.5, plod)) * mix(mix(0.5, 1.0, smoothstep(0.0, 0.02, blk.x)), 0.85, plod);
    pc *= 0.75 + 0.3 * nH(uv * 1.2);
    s.alb = mix(s.alb, pc, pl); s.rough = mix(s.rough, 0.9, pl); s.h = mix(s.h, 0.012 * smoothstep(0.0, 0.04, blk.x), pl);
  }
  // soft contact darkening at the base of the wall + under jetties
  s.ao *= mix(0.72, 1.0, smoothstep(0.0, 0.9, uv.y + (lower ? 0.0 : 0.6)));
  s.ao *= mix(0.8, 1.0, smoothstep(0.0, 0.35, fH - uv.y));
  return s;
}

Surf roofTiles(vec2 uv, vec3 tint, float bits, float seed) {
  float kind = mod(bits, 4.0);
  // per-roof character: value / hue jitter (terracotta -> brown -> weathered grey), age
  float rv = hash12(vec2(seed, 5.1)), rh = hash12(vec2(seed, 6.2)), age = hash12(vec2(seed, 7.3));
  tint *= 0.8 + 0.38 * rv;
  tint = mix(tint, vec3(luma(tint)) * vec3(1.05, 0.95, 0.9), smoothstep(0.55, 1.0, rh) * 0.55);
  tint = mix(tint, tint * vec3(1.12, 0.92, 0.72), (1.0 - smoothstep(0.0, 0.6, rh)) * 0.35);
  Surf s = surfInit(tint, 0.78);
  if (kind > 0.5 && kind < 1.5) {
    // ridge caps: half-round tiles laid along u, each overlapping the next
    float f = fract(uv.x / 0.42);
    float lodR = smoothstep(0.02, 0.08, gPx);
    s.alb = tint * 0.8 * mix((0.7 + 0.35 * hash12(vec2(floor(uv.x / 0.42), seed))) * (0.65 + 0.35 * smoothstep(0.0, 0.25, f)), 0.85, lodR);
    s.h = 0.03 * smoothstep(0.0, 0.3, f) * (1.0 - lodR);
    s.rough = 0.7;
    return s;
  }
  bool slate = kind > 1.5;
  float rowH = slate ? 0.2 : 0.155, tw = slate ? 0.3 : 0.18;
  // old roofs sag: courses wave slightly
  uv.y += (sin(uv.x * 0.37 + seed * 3.0) * 0.035 + (nL(uv * vec2(0.04, 0.02) + seed) - 0.5) * 0.3);
  float row = floor(uv.y / rowH);
  float fy = uv.y / rowH - row;
  float x = uv.x / tw + 0.5 * mod(row, 2.0) + hash12(vec2(row, seed)) * 0.08;
  float fx = fract(x);
  float edge = slate ? 0.08 * (1.0 - abs(2.0 * fx - 1.0)) + 0.02 : 0.32 * (1.0 - sqrt(max(0.0, 1.0 - pow(2.0 * fx - 1.0, 2.0))));
  float owner = row;
  float ly = fy - edge;
  if (fy < edge) { owner = row - 1.0; x = uv.x / tw + 0.5 * mod(owner, 2.0) + hash12(vec2(owner, seed)) * 0.08; ly = fy + 1.0 - edge; }
  float col = floor(x);
  float th = hash12(vec2(col, owner) + seed * 7.0);
  float th2 = hash12(vec2(owner, col) * 1.7 + seed);
  float lodT = smoothstep(0.015, 0.05, gPx);
  float thv = mix(th, 0.5, lodT), th2v = mix(th2, 0.5, lodT);
  vec3 c = tint * (0.72 + 0.5 * thv);
  c = mix(c, c * vec3(1.15, 0.9, 0.75), step(0.93, th2v));
  c = mix(c, c * 0.55, step(th2v, 0.05));
  // relief: each tile lies tilted on the one below -> lit / shaded rows; gaps; the course shadow line
  float gx = abs(fract(x) - 0.5);
  float gap = smoothstep(0.46, 0.5, gx);
  float shadowAbove = smoothstep(0.55, 1.0, ly);
  float lod = smoothstep(0.03, 0.11, gPx);
  c *= 1.0 - (0.4 * gap + 0.5 * shadowAbove) * (1.0 - lod);
  c *= 1.0 - 0.14 * lod;                   // the average of the course shading survives at distance
  // patched areas of newer, brighter tiles; a few missing / broken tiles (dark holes over the battens)
  float patchA = smoothstep(0.74, 0.8, nM(uv * vec2(0.09, 0.14) + seed * 1.7)) * step(0.35, age);
  c = mix(c, tint * vec3(1.3, 1.02, 0.8) * (0.85 + 0.3 * thv), patchA * 0.85);
  float miss = step(0.992 - 0.01 * age, th2) * step(0.4, age) * (1.0 - lodT);
  c = mix(c, vec3(0.025, 0.018, 0.012), miss);
  // age: lichen / moss (more towards the eave and on old roofs), rain streaks down the slope, soot near the ridge
  float moss = smoothstep(0.6, 0.85, nM(uv * vec2(0.15, 0.25) + seed * 3.0)) * (0.35 + 0.65 * (1.0 - smoothstep(0.0, 7.0, uv.y))) * (0.3 + 0.9 * age);
  vec3 mossC = mix(vec3(0.1, 0.11, 0.045), vec3(0.28, 0.27, 0.18), step(0.5, nF(uv * 0.7 + seed))) * (0.8 + 0.3 * nF(uv * 2.0));
  float streak = smoothstep(0.45, 0.85, nH(vec2(uv.x * 0.6, uv.y * 0.035) + seed));
  c *= 1.0 - (0.22 + 0.2 * age) * streak;
  c = mix(c, mossC, clamp(moss, 0.0, 1.0) * 0.7);
  float soot = smoothstep(0.7, 0.92, nL(vec2(uv.x * 0.08, uv.y * 0.012) + seed * 2.3)) * smoothstep(2.0, 8.0, uv.y);
  c *= 1.0 - 0.45 * soot;
  float bleach = smoothstep(0.6, 0.9, nL(uv * 0.07 + seed * 1.3));
  c = mix(c, c * 1.2 + 0.015, bleach * 0.4);
  c *= 0.82 + 0.36 * nL(uv * 0.025 + seed);
  s.alb = c;
  s.rough = 0.7 + 0.2 * moss - 0.1 * patchA;
  s.h = (1.0 - lod) * (-ly * 0.035 + gap * -0.012 - miss * 0.03);
  s.ao = 1.0 - 0.3 * shadowAbove * (1.0 - lod);
  return s;
}

Surf woodSurf(vec2 uv, vec3 tint, float bits, float seed) {
  float g = nF(vec2(uv.x * 0.35, uv.y * 4.0) + seed);
  Surf s = surfInit(tint * (0.7 + 0.5 * g), 0.8);
  if (mod(bits, 2.0) > 0.5) { // jetty band with joist ends
    float f = abs(fract(uv.x / 0.58) - 0.5) * 0.58;
    float j = (1.0 - aa(0.085, f)) * (1.0 - aa(0.11, abs(uv.y - 0.14)));
    s.alb = mix(s.alb, tint * 1.6 * (0.8 + 0.3 * nF(uv * 5.0)), j);
    s.h = j * 0.04;
  }
  return s;
}

Surf brickSurf(vec2 uv, vec3 tint, float seed) {
  float row = floor(uv.y / 0.075);
  float x = uv.x / 0.26 + 0.5 * mod(row, 2.0);
  vec2 f = vec2(fract(x), fract(uv.y / 0.075));
  float e = min(min(f.x, 1.0 - f.x) * 0.26, min(f.y, 1.0 - f.y) * 0.075);
  float m = 1.0 - aa(0.008, e);
  m *= 1.0 - smoothstep(0.01, 0.03, gPx);
  vec3 c = tint * (0.7 + 0.5 * hash12(vec2(floor(x), row) + seed));
  c = mix(c, vec3(0.3, 0.29, 0.27), m * 0.8);
  // soot near the top
  c *= 1.0 - 0.6 * smoothstep(0.6, 1.4, uv.y - vMat.z + 1.4);
  Surf s = surfInit(c, 0.88);
  s.h = 0.006 * (1.0 - m);
  return s;
}

Surf stoneSurf(vec2 uv, vec3 tint, float ch, float seed) {
  vec4 blk = ashlar(uv, ch, ch * 1.9, seed);
  vec3 c = tint * (0.78 + 0.3 * blk.y) * (0.85 + 0.25 * nH(uv * 0.6 + seed));
  float m = 1.0 - aa(0.015, blk.x);
  m *= 1.0 - smoothstep(0.03, 0.08, gPx);
  c = mix(c, tint * 0.55, m * 0.7);
  c *= 1.0 - 0.2 * smoothstep(0.5, 0.85, nM(uv * vec2(0.3, 0.08) + seed));
  Surf s = surfInit(c, 0.88);
  s.h = 0.02 * smoothstep(0.0, 0.05, blk.x);
  return s;
}

Surf surf() {
  float id = floor(vMat.x + 0.5);
  float seed = fract(vMat.y * 0.61803 + 0.137) * 61.0;
  vec3 tint = vTint;
  if (id < 0.5) return facade(vUV.xy, vUV.z, vUV.w, vMat.z, vMat.w, tint, seed);
  if (id < 1.5) return roofTiles(vUV.xy, tint, vMat.w, seed);
  if (id < 2.5) return woodSurf(vUV.xy, tint, vMat.w, seed);
  if (id < 3.5) return brickSurf(vUV.xy, tint, seed);
  if (id < 4.5) return stoneSurf(vUV.xy, tint, max(vMat.z, 0.2), seed);
  if (id < 5.5) { Surf s = surfInit(tint, 0.55); s.metal = 0.6; return s; }
  if (id < 6.5) { // rubble / broken plaster fill (ruins)
    vec2 p = vUV.xy * 2.2;
    float n = nH(p * 0.3 + seed);
    vec3 c = tint * (0.55 + 0.6 * n) * (0.8 + 0.3 * hash12(floor(p * 1.5)));
    Surf s = surfInit(c, 0.95); s.h = n * 0.05; return s;
  }
  if (id < 7.5) { // cloth (awnings, laundry), striped when p3
    float st = mod(vMat.w, 2.0) > 0.5 ? step(0.5, fract(vUV.x / 0.5)) : 0.0;
    vec3 c = mix(tint, vec3(0.8, 0.77, 0.7), st) * (0.8 + 0.3 * nF(vUV.xy * 2.0));
    Surf s = surfInit(c, 0.95); s.h = nF(vUV.xy * vec2(0.5, 3.0)) * 0.01; return s;
  }
  if (id < 8.5) { // straw / sacks / produce
    float n = nF(vUV.xy * vec2(3.0, 0.6));
    Surf s = surfInit(tint * (0.65 + 0.6 * n), 0.95); s.h = n * 0.02; return s;
  }
  if (id < 9.5) { Surf s = surfInit(tint * 0.6, 0.3); s.emis = tint * 0.9; return s; }
  if (id < 10.5) {
    Surf s = surfInit(vec3(0.03, 0.045, 0.04), 0.05);
    vec3 R = reflect(-gVW, vec3(0.0, 1.0, 0.0));
    s.emis = skyRefl(R, 0.0) * (0.04 + 0.9 * pow(1.0 - clamp(gVW.y, 0.0, 1.0), 5.0));
    s.h = nH(vWPos.xz * 0.5 + uTime * 0.05) * 0.02;
    return s;
  }
  if (id < 11.5) { // flower box planting: leaves + petal clusters (tint = petal colour)
    vec2 q = vUV.xy / vec2(0.075, 0.06);
    vec2 cid = floor(q), f = fract(q) - 0.5;
    float h = hash12(cid + vMat.w * 7.3);
    float petal = step(0.42, h) * (1.0 - smoothstep(0.22, 0.42, length(f)));
    float lod = smoothstep(0.012, 0.04, gPx);
    petal = mix(petal, 0.4, lod);
    vec3 leaf = vec3(0.05, 0.1, 0.025) * (0.7 + 0.6 * hash12(cid * 1.7 + 3.0));
    vec3 pc = tint * (0.75 + 0.4 * hash12(cid + 9.1));
    pc = mix(pc, vec3(0.85, 0.85, 0.8), step(0.9, h) * 0.6);
    Surf s = surfInit(mix(leaf, pc, petal), 0.8);
    s.h = petal * 0.01;
    return s;
  }
  return surfInit(tint, 0.9);
}
`;

// vertex decl / main shared by the procedural materials
const VERT_DECL = /* glsl */`
attribute vec4 aUV;
attribute vec4 aMat;
varying vec4 vUV;
varying vec4 vMat;
varying vec3 vWPos;
varying vec3 vWN;
varying float vState;
varying vec3 vTint;
uniform sampler2D tState;
uniform float uStateOn;
`;
// collapse animation: state texel (r = progress, g/b = lean direction, a = gone)
const VERT_COLLAPSE = /* glsl */`
vState = 0.0;
if (uStateOn > 0.5 && aMat.y > 0.5) {
  int sid = int(aMat.y + 0.5);
  vec4 st = texelFetch(tState, ivec2(sid % 256, sid / 256), 0);
  if (st.a > 0.5) { transformed = vec3(transformed.x, -40.0, transformed.z); }
  else if (st.r > 0.0) {
    float p = st.r;
    vec2 lean = st.gb * 2.0 - 1.0;
    float y = max(transformed.y, 0.0);
    float roofFirst = smoothstep(0.0, 0.6, p);
    float k = 1.0 - clamp(p * 1.15 - 0.05, 0.0, 1.0) * 0.93;
    float ny = y * k - p * p * y * 0.1;
    vec3 j = vec3(fract(sin(dot(transformed.xz, vec2(12.9898, 78.233))) * 43758.5453) - 0.5, 0.0, fract(sin(dot(transformed.zx, vec2(39.3468, 11.135))) * 24634.6345) - 0.5);
    transformed.xz += lean * y * p * 0.45 + j.xz * p * min(y, 6.0) * 0.5;
    transformed.y = ny + roofFirst * 0.0;
    vState = p;
  }
}
`;

function injectCommon(sh, uniforms, fragDecl, surfCall = 'surf()') {
  Object.assign(sh.uniforms, uniforms);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_DECL)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_COLLAPSE)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vUV = aUV; vMat = aMat; vTint = color;
      vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wp4 = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
      #endif
      vWPos = wp4.xyz;
      #ifdef USE_INSTANCING
        vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #else
        vWN = normalize(mat3(modelMatrix) * objectNormal);
      #endif`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + fragDecl)
    .replace('#include <map_fragment>', `
      vec3 gN0 = normalize(vWN);
      gNW = gN0;
      gVW = normalize(cameraPosition - vWPos);
      vec3 gT, gB; frameTB(gN0, gT, gB);
      gV = vec3(dot(gVW, gT), dot(gVW, gB), dot(gVW, gN0));
      gPx = length(fwidth(vWPos));
      Surf S = ${surfCall};
      if (vState > 0.0 && nH(vUV.xy * 0.35 + vMat.y * 0.1) < vState * 1.1 - 0.15) discard;
      diffuseColor.rgb = S.alb * S.ao;`)
    .replace('#include <color_fragment>', '')
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = S.rough;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = S.metal;')
    .replace('#include <normal_fragment_maps>', `
      {
        vec2 uvB = vUV.xy;
        vec2 dx = dFdx(uvB), dy = dFdy(uvB);
        float hx = dFdx(S.h), hy = dFdy(S.h);
        float det = dx.x * dy.y - dx.y * dy.x;
        vec2 g = abs(det) > 1e-10 ? vec2(hx * dy.y - dx.y * hy, dx.x * hy - dy.x * hx) / det : vec2(0.0);
        // sub-pixel relief turns into per-pixel normal noise: clamp the slope and fade relief as texels shrink
        float gl = length(g); if (gl > 1.4) g *= 1.4 / gl;
        g *= (1.0 - smoothstep(0.015, 0.07, gPx)) * uBumpK;
        vec3 nw = normalize(gN0 - gT * g.x - gB * g.y);
        normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
      }`)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += S.emis;');
}

export function makeProcMaterial(kind, shared, glsl = null, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true });
  const uniforms = { uBumpK: { value: extra.uBumpK ? extra.uBumpK.value : 1 }, tNoise: { value: shared.noise }, uSkyTop: shared.uSkyTop, uSkyHor: shared.uSkyHor, uTime: shared.uTime, tState: { value: shared.state }, uStateOn: { value: kind === 'building' ? 1 : 0 }, ...extra };
  mat.userData.uniforms = uniforms;
  const decl = kind === 'building' ? BUILDING_GLSL : glsl || '';
  mat.onBeforeCompile = (sh) => injectCommon(sh, uniforms, decl);
  mat.customProgramCacheKey = () => 'aot-world-' + kind + '-v1';
  return mat;
}

// depth material for shadow maps that applies the same collapse deformation
export function makeCollapseDepthMaterial(shared) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const uniforms = { tState: { value: shared.state }, uStateOn: { value: 1 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_COLLAPSE);
  };
  m.customProgramCacheKey = () => 'aot-world-depth-v1';
  return m;
}
