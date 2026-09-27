// RENDER builder — ctx.post
// postprocessing EffectComposer (HDR half-float): scene -> N8AO -> soft particles (ctx.fx) -> sun shafts ->
// [bloom + lens (radial blur / chromatic aberration) + exposure + AgX tone map + film grade + vignette + gameplay
// overlays] -> [SMAA + grain] -> screen. Gameplay API: flash(k), punch(k), setDamage(k), setSlowmo(k), speed blur.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, EdgeDetectionMode,
  Effect, EffectAttribute, BlendFunction, Pass,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { FSPass, makeRT, GLSL_HASH } from './common.js';

// ---------------------------------------------------------------------------------------------------------------
// Pass that lets another system draw into the HDR buffer after AO (soft particles read the stable depth texture)
class HookPass extends Pass {
  constructor(fn) { super('HookPass'); this.fn = fn; this.needsSwap = false; this.needsDepthTexture = true; this.depthTexture = null; }
  setDepthTexture(t) { this.depthTexture = t; }
  render(renderer, inputBuffer, outputBuffer, dt) { this.fn(renderer, inputBuffer, this.depthTexture, dt); }
}

// Screen-space sun shafts: sky mask around the sun (clouds + silhouettes occlude it) radially blurred toward the sun.
class ShaftsPass extends Pass {
  constructor(ctx, samples) {
    super('ShaftsPass');
    this.ctx = ctx; this.needsSwap = false; this.needsDepthTexture = true; this.depthTexture = null;
    this.rtA = makeRT(2, 2); this.rtB = makeRT(2, 2);
    this.sunUv = new THREE.Vector2(); this.strength = 0; this.samples = samples;
    this.mask = new FSPass({
      name: 'shaftMask', uniforms: {
        tColor: { value: null }, tDepth: { value: null }, uSunUv: { value: this.sunUv }, uAspect: { value: 1 },
      },
      fragmentShader: /* glsl */`
      varying vec2 vUv; uniform sampler2D tColor, tDepth; uniform vec2 uSunUv; uniform float uAspect;
      void main() {
        float d = texture2D(tDepth, vUv).r;
        vec3 c = texture2D(tColor, vUv).rgb;
        float sky = step(0.99999, d);
        vec2 dv = (vUv - uSunUv) * vec2(uAspect, 1.0);
        float fall = exp(-dot(dv, dv) * 7.0);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor = vec4(c * sky * fall * smoothstep(0.4, 2.5, l), 1.0);
      }`,
    });
    this.blur = new FSPass({
      name: 'shaftBlur', defines: { SAMPLES: samples },
      uniforms: { tIn: { value: null }, uSunUv: { value: this.sunUv }, uLen: { value: 1 }, uFrame: { value: 0 } },
      fragmentShader: /* glsl */`
      varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uSunUv; uniform float uLen, uFrame;
      ${GLSL_HASH}
      void main() {
        vec2 d = (uSunUv - vUv) * uLen / float(SAMPLES);
        float j = aotIGN(gl_FragCoord.xy + uFrame * 3.1);
        vec2 p = vUv + d * j;
        vec3 acc = vec3(0.0); float w = 1.0, ws = 0.0;
        for (int i = 0; i < SAMPLES; i++) { acc += texture2D(tIn, p).rgb * w; ws += w; w *= 0.965; p += d; }
        gl_FragColor = vec4(acc / ws, 1.0);
      }`,
    });
    this.frame = 0;
  }
  setDepthTexture(t) { this.depthTexture = t; }
  setSize(w, h) {
    const s = 0.25;
    this.rtA.setSize(Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s)));
    this.rtB.setSize(this.rtA.width, this.rtA.height);
    this.mask.uniforms.uAspect.value = w / Math.max(1, h);
  }
  render(renderer, inputBuffer) {
    if (this.strength <= 0.001) return;
    const m = this.mask.uniforms;
    m.tColor.value = inputBuffer.texture; m.tDepth.value = this.depthTexture;
    this.mask.render(renderer, this.rtA);
    const b = this.blur.uniforms;
    b.uFrame.value = (this.frame++) % 64;
    b.tIn.value = this.rtA.texture; b.uLen.value = 0.9; this.blur.render(renderer, this.rtB);
    b.tIn.value = this.rtB.texture; b.uLen.value = 0.35; this.blur.render(renderer, this.rtA);
  }
  get texture() { return this.rtA.texture; }
}

// ---------------------------------------------------------------------------------------------------------------
const GRADE_FRAG = /* glsl */`
uniform sampler2D uShafts;
uniform vec4 uFx;      // x flash, y damage, z slowmo, w punch
uniform vec4 uFx2;     // x speed, y exposure, z ca, w vignette
uniform vec4 uFx3;     // x shaft strength, y time, z saturation, w contrast
uniform vec3 uFlashCol, uShaftCol;
uniform vec2 uCenter;
uniform vec4 uShock;   // xy centre uv, z radius (screen heights), w amplitude
const mat3 AOT_709_2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956);
const mat3 AOT_2020_709 = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
vec3 aotAgxCurve(vec3 x) { vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 aotAgx(vec3 c) {
  const mat3 ins = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outs = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  c = AOT_709_2020 * c; c = ins * c; c = max(c, 1e-10); c = log2(c);
  c = (c + 12.47393) / (4.026069 + 12.47393); c = clamp(c, 0.0, 1.0);
  c = aotAgxCurve(c);
  // look: a touch of punch (slope/power/saturation in AgX space)
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = pow(max(c, 0.0), vec3(1.18));
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = l + uFx3.z * (c - l);
  c = outs * c; c = pow(max(vec3(0.0), c), vec3(2.2)); c = AOT_2020_709 * c;
  return clamp(c, 0.0, 1.0);
}
void mainImage(const in vec4 inputColor, const in vec2 uv0, out vec4 outputColor) {
  vec2 uv = uv0;
  float shockLit = 0.0;
  if (uShock.w > 0.001) {
    vec2 sd = (uv0 - uShock.xy) * vec2(aspect, 1.0);
    float sr = length(sd);
    float x = (sr - uShock.z) / 0.045;
    float w = exp(-x * x) * uShock.w;
    uv -= (sd / max(sr, 1e-4)) / vec2(aspect, 1.0) * w * x * 0.022;
    shockLit = w * max(-x, 0.0);
  }
  uv = clamp(uv, texelSize * 0.5, 1.0 - texelSize * 0.5);
  vec2 d = uv - uCenter;
  float r = length(d * vec2(aspect, 1.0));
  float blur = uFx.w * 0.07 + uFx2.x * 0.05;
  float ca = uFx2.z * (0.35 + r * 1.4) * 0.0025 + uFx.w * 0.008;
  vec3 col;
  if (blur > 0.0008) {
    float edge = smoothstep(0.05, 0.75, r);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 10; i++) {
      float s = 1.0 - blur * edge * (float(i) / 9.0);
      vec2 p = uCenter + d * s;
      acc.r += texture2D(inputBuffer, clamp(uCenter + d * (s + ca), 0.0, 1.0)).r;
      acc.g += texture2D(inputBuffer, p).g;
      acc.b += texture2D(inputBuffer, clamp(uCenter + d * (s - ca), 0.0, 1.0)).b;
    }
    col = acc / 10.0;
  } else {
    col = vec3(texture2D(inputBuffer, clamp(uCenter + d * (1.0 + ca), 0.0, 1.0)).r, texture2D(inputBuffer, uv).g, texture2D(inputBuffer, clamp(uCenter + d * (1.0 - ca), 0.0, 1.0)).b);
  }
  col *= 1.0 + shockLit * 0.25;
  // sun shafts (HDR add)
  col += texture2D(uShafts, uv).rgb * uShaftCol * uFx3.x;
  col *= uFx2.y;
  // hit-stop slow motion: desaturate, crush, cool
  float sl = uFx.z;
  if (sl > 0.0) {
    float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(l0) * vec3(0.95, 1.0, 1.08), sl * 0.75);
    col = mix(col, col * col / max(l0, 1e-3) * 0.8, sl * 0.25);
  }
  col = aotAgx(col);
  // film grade in display space: warm highlights, slightly teal shadows, gentle S-curve
  vec3 g = pow(col, vec3(1.0 / 2.2));
  float gl = dot(g, vec3(0.2126, 0.7152, 0.0722));
  vec3 shTint = vec3(0.94, 1.0, 1.04), hiTint = vec3(1.05, 1.0, 0.92);
  g *= mix(shTint, hiTint, smoothstep(0.15, 0.85, gl));
  g = mix(g, g * g * (3.0 - 2.0 * g), uFx3.w);
  g = max(g + vec3(0.003, 0.004, 0.007) * (1.0 - gl) - 0.006, 0.0);  // near-black, slightly cool shadows
  // vignette
  float v = smoothstep(1.05, 0.25, r);
  g *= mix(1.0, v, uFx2.w);
  // damage: pulsing red vignette
  if (uFx.y > 0.0) {
    float pulse = 0.72 + 0.28 * sin(uFx3.y * 7.0);
    float dv = smoothstep(0.3, 1.05, r) * uFx.y * pulse;
    float dl = dot(g, vec3(0.3, 0.59, 0.11));
    g = mix(g, mix(vec3(dl), g, 1.0 - uFx.y * 0.4), 1.0);
    g = mix(g, vec3(0.42, 0.015, 0.02), clamp(dv * 1.1, 0.0, 0.85));
  }
  if (sl > 0.0) g *= mix(1.0, smoothstep(1.1, 0.35, r), sl * 0.35);
  // flash
  g = g + uFlashCol * uFx.x;
  g = clamp(g, 0.0, 1.0);
  outputColor = vec4(pow(g, vec3(2.2)), inputColor.a);
}`;

class GradeEffect extends Effect {
  constructor(shafts) {
    super('AotGrade', GRADE_FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([
        ['uShafts', new THREE.Uniform(shafts)],
        ['uFx', new THREE.Uniform(new THREE.Vector4())],
        ['uFx2', new THREE.Uniform(new THREE.Vector4(0, 1, 1, 0.5))],
        ['uFx3', new THREE.Uniform(new THREE.Vector4(0, 0, 1.12, 0.18))],
        ['uFlashCol', new THREE.Uniform(new THREE.Vector3(1, 0.95, 0.8))],
        ['uShaftCol', new THREE.Uniform(new THREE.Vector3(1, 0.8, 0.55))],
        ['uCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['uShock', new THREE.Uniform(new THREE.Vector4(0.5, 0.5, 0, 0))],
      ]),
    });
  }
}

class GrainEffect extends Effect {
  constructor() {
    super('AotGrain', /* glsl */`
    uniform float uGrain; uniform float uSeed;
    float gh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
      vec3 c = inputColor.rgb;
      vec2 px = uv * resolution;
      float n = gh(px + uSeed * 91.7) + gh(px * 1.37 + uSeed * 13.1) - 1.0;
      float l = dot(pow(max(c, 0.0), vec3(1.0 / 2.2)), vec3(0.3333));
      float amt = uGrain * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 0.9)));
      c = pow(max(pow(max(c, 0.0), vec3(1.0 / 2.2)) + n * amt, 0.0), vec3(2.2));
      outputColor = vec4(c, inputColor.a);
    }`, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([['uGrain', new THREE.Uniform(0.035)], ['uSeed', new THREE.Uniform(0)]]),
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
export async function create(ctx) {
  const { renderer, scene, camera } = ctx;
  const q = ctx.quality?.level || 'high';
  renderer.toneMapping = THREE.NoToneMapping;

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0, stencilBuffer: false });
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  let ao = null;
  if (q !== 'low') {
    ao = new N8AOPostPass(scene, camera, size.x, size.y);
    ao.autoDetectTransparency = false;
    const c = ao.configuration;
    c.gammaCorrection = false;
    c.aoRadius = 4.5;
    c.distanceFalloff = 1.2;
    c.intensity = 2.6;
    c.aoSamples = q === 'high' ? 16 : 8;
    c.denoiseSamples = q === 'high' ? 8 : 4;
    c.denoiseRadius = 10;
    c.halfRes = true;
    c.depthAwareUpsampling = true;
    c.color = new THREE.Color(0.06, 0.05, 0.05);
    composer.addPass(ao);
  }

  const fxPass = new HookPass((r, buf, depth, dt) => { ctx.fx?.render?.(r, camera, buf, depth, dt); });
  composer.addPass(fxPass);

  const shafts = q !== 'low' ? new ShaftsPass(ctx, q === 'high' ? 28 : 18) : null;
  if (shafts) composer.addPass(shafts);

  const bloom = new BloomEffect({
    mipmapBlur: true, intensity: 0.75, luminanceThreshold: 1.1, luminanceSmoothing: 0.35, radius: 0.72,
    levels: q === 'low' ? 5 : 7,
  });
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true;
  const grade = new GradeEffect(shafts ? shafts.texture : blank);
  const passA = new EffectPass(camera, bloom, grade);
  composer.addPass(passA);

  const smaa = new SMAAEffect({ preset: q === 'low' ? SMAAPreset.LOW : q === 'medium' ? SMAAPreset.MEDIUM : SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR });
  const grain = new GrainEffect();
  const passB = new EffectPass(camera, smaa, grain);
  composer.addPass(passB);

  // ---- state -------------------------------------------------------------------------------------------------
  const st = { speedExt: 0, speedExtT: -10, shockAmp: 0, shockR: 0, shockPos: new THREE.Vector3(), flash: 0, flashCol: new THREE.Vector3(1, 0.95, 0.8), damage: 0, damageTarget: 0, slowmo: 0, slowTarget: 0, punch: 0, speed: 0, time: 0 };
  const G = grade.uniforms;
  const uShock = G.get('uShock').value;
  const uFx = G.get('uFx').value, uFx2 = G.get('uFx2').value, uFx3 = G.get('uFx3').value, uCenter = G.get('uCenter').value;
  const settings = { exposure: 1.15, ca: 1.0, vignette: 0.42, saturation: 1.1, contrast: 0.16, shafts: 0.9, grain: 0.03, bloom: 0.75 };
  const tmpV = new THREE.Vector3(), sunV = new THREE.Vector3(), camDir = new THREE.Vector3();
  const foe = new THREE.Vector2(0.5, 0.5);

  function updateUniforms(dt) {
    st.time += dt;
    st.flash *= Math.exp(-dt * 3.2); if (st.flash < 0.002) st.flash = 0;
    st.punch *= Math.exp(-dt * 7.0); if (st.punch < 0.002) st.punch = 0;
    st.damage += (st.damageTarget - st.damage) * (1 - Math.exp(-dt * 6));
    st.slowmo += (st.slowTarget - st.slowmo) * (1 - Math.exp(-dt * 10));
    // speed blur from the player's velocity (focus of expansion = projected velocity direction)
    let sp = 0;
    const extK = st.time - st.speedExtT < 0.25 ? st.speedExt : -1;
    if (ctx.cameraOwner === 'player' && ctx.player?.velocity) {
      const v = ctx.player.velocity; const s = v.length();
      sp = extK >= 0 ? extK : THREE.MathUtils.smoothstep(s, 24, 48);
      if (sp > 0) {
        tmpV.copy(v).normalize().multiplyScalar(100).add(camera.position).project(camera);
        if (tmpV.z < 1 && Math.abs(tmpV.x) < 1.2 && Math.abs(tmpV.y) < 1.2) foe.set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5);
        else foe.set(0.5, 0.5);
      }
    }
    st.speed += (sp - st.speed) * (1 - Math.exp(-dt * 5));
    if (st.speed > 0.01) uCenter.copy(foe); else uCenter.set(0.5, 0.5);
    // roar shockwave: ring expands from the projected source
    if (st.shockAmp > 0.001) {
      st.shockR += dt * 1.25; st.shockAmp *= Math.exp(-dt * 1.6);
      tmpV.copy(st.shockPos).project(camera);
      const behind = tmpV.z > 1;
      uShock.set(behind ? 0.5 : tmpV.x * 0.5 + 0.5, behind ? 0.5 : tmpV.y * 0.5 + 0.5, st.shockR, st.shockAmp * (behind ? 0.5 : 1));
    } else uShock.w = 0;
    uFx.set(Math.min(st.flash, 1.2), st.damage, st.slowmo, st.punch);
    uFx2.set(st.speed * 0.9, settings.exposure * (ctx.sky?.exposureK ?? 1), settings.ca + st.punch * 2, settings.vignette);
    uFx3.set(0, st.time % 1000, settings.saturation * (1 - st.slowmo * 0.3), settings.contrast + (ctx.sky?.contrastK ?? 0) + st.slowmo * 0.2);
    G.get('uFlashCol').value.copy(st.flashCol);
    bloom.intensity = settings.bloom * (ctx.sky?.bloomK ?? 1);
    // shafts: sun screen position and facing
    if (shafts) {
      const sd = ctx.sky?.sunDir;
      if (sd) {
        camera.getWorldDirection(camDir);
        const facing = camDir.dot(sd);
        sunV.copy(sd).multiplyScalar(1000).add(camera.position).project(camera);
        shafts.sunUv.set(sunV.x * 0.5 + 0.5, sunV.y * 0.5 + 0.5);
        const onScreen = THREE.MathUtils.smoothstep(facing, 0.15, 0.55);
        shafts.strength = settings.shafts * (ctx.sky?.shaftsK ?? 1) * onScreen * (sunV.z < 1 ? 1 : 0);
        uFx3.x = shafts.strength;
        const sc = ctx.sky.sunColor;
        if (sc) G.get('uShaftCol').value.set(sc.r, sc.g, sc.b).multiplyScalar(0.12);
      }
    }
    grain.uniforms.get('uGrain').value = settings.grain;
    grain.uniforms.get('uSeed').value = (st.time * 60) % 97;
  }

  const api = {
    composer, bloom, grade, ao, settings,
    render(rawDt = 1 / 60) {
      camera.updateMatrixWorld();
      ctx.sky?.renderClouds?.(camera);
      updateUniforms(rawDt);
      composer.render(rawDt);
    },
    /** full-screen flash (white-yellow), decays. k ~0.3 small, 1 blinding */
    flash(k = 1, color) {
      st.flash = Math.max(st.flash, k);
      if (color) st.flashCol.set(color.r ?? color.x ?? 1, color.g ?? color.y ?? 0.95, color.b ?? color.z ?? 0.8);
      else st.flashCol.set(1, 0.95, 0.8);
    },
    /** speed blur strength 0..1 (player camera calls this every frame; overrides the velocity estimate) */
    setSpeed(k = 0) { st.speedExt = THREE.MathUtils.clamp(k, 0, 1); st.speedExtT = st.time; },
    punch(k = 1) { st.punch = Math.min(1.5, Math.max(st.punch, k)); },
    /** screen-space shockwave ring expanding from a world position (roar). k 0..1.5 */
    shockwave(pos, k = 1) {
      if (!pos) return;
      const d = camera.position.distanceTo(pos);
      st.shockPos.copy(pos); st.shockR = 0.02; st.shockAmp = k * THREE.MathUtils.clamp(1.3 - d / 1200, 0.3, 1);
      st.punch = Math.max(st.punch, 0.35 * k);
    },
    setDamage(k = 0) { st.damageTarget = THREE.MathUtils.clamp(k, 0, 1); },
    setSlowmo(k = 0) { st.slowTarget = THREE.MathUtils.clamp(k, 0, 1); },
    resize(w, h) {
      composer.setSize(w, h);
      ctx.sky?.resize?.();
    },
  };
  return api;
}
