// RENDER builder. Small shared helpers: fullscreen triangle passes, render targets, GLSL snippets.
import * as THREE from 'three';

const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class FSPass {
  constructor({ fragmentShader, uniforms = {}, defines = {}, blending = THREE.NoBlending, transparent = false, name = 'fs' }) {
    this.material = new THREE.ShaderMaterial({
      name, uniforms, defines, vertexShader: FS_VERT, fragmentShader,
      depthTest: false, depthWrite: false, blending, transparent, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(tri, this.material);
    this.mesh.frustumCulled = false;
    this.uniforms = this.material.uniforms;
  }
  render(renderer, target, layer) {
    if (layer !== undefined) renderer.setRenderTarget(target ?? null, layer);
    else renderer.setRenderTarget(target ?? null);
    renderer.render(this.mesh, orthoCam);
  }
}

export function makeRT(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
    type: opts.type ?? THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: opts.filter ?? THREE.LinearFilter,
    magFilter: opts.filter ?? THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    colorSpace: THREE.NoColorSpace,
  });
}

export const GLSL_HASH = /* glsl */`
float aotIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float aotHash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec3 aotHash33(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
`;
