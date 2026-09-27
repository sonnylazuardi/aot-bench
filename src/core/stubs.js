import * as THREE from 'three';
import { LAYOUT } from './layout.js';

// Fallback implementations used when a system module is missing or fails to load.
// They define the MINIMUM public API of each system (see CONTRACT.md). Real modules
// must provide at least these members with the same signatures.

const noop = () => {};

export const STUBS = {
  sky: (ctx) => {
    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a4a3a, 1.2);
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.5);
    sun.position.set(...LAYOUT.sunDir).multiplyScalar(500);
    ctx.scene.add(hemi, sun, sun.target);
    ctx.scene.background = new THREE.Color(0x9fb8cc);
    ctx.scene.fog = new THREE.Fog(0x9fb8cc, 200, 3000);
    return { sun, update: noop, setMood: noop };
  },
  post: (ctx) => ({
    render: () => ctx.renderer.render(ctx.scene, ctx.camera),
    flash: noop, setDamage: noop, setSlowmo: noop, punch: noop, resize: noop,
  }),
  fx: () => {
    const h = { stop: noop, position: new THREE.Vector3(), setIntensity: noop };
    return {
      update: noop, dust: noop, debris: noop, blood: noop, gasPuff: noop, sparks: noop, explosion: noop,
      lightning: noop, projectile: noop,
      steam: () => h, fire: () => h, smoke: () => h,
    };
  },
  world: (ctx) => {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7a8a5a }));
    const w = LAYOUT.wall;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(w.radius + w.thickness, w.radius + w.thickness, w.height, 96, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xb8ad98, side: THREE.DoubleSide }));
    wall.position.y = w.height / 2;
    ctx.scene.add(g, wall);
    const ray = new THREE.Raycaster();
    ctx.physics.addRaycaster('world', (o, d, max) => {
      ray.set(o, d); ray.far = max;
      const h = ray.intersectObjects([g, wall], false)[0];
      return h ? { point: h.point, normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0), distance: h.distance, kind: h.object === g ? 'ground' : 'wall' } : null;
    });
    ctx.physics.addCollider('world', (c, r, out) => { if (c.y < r) out.push({ normal: new THREE.Vector3(0, 1, 0), depth: r - c.y, kind: 'ground' }); });
    return { update: noop, groundHeight: () => 0, damage: noop, breach: noop, breached: false, buildings: [] };
  },
  titans: () => ({ update: noop, list: [], spawn: () => null, trySlash: () => null, nearestNape: () => null, killAll: noop }),
  colossal: () => ({ update: noop, appear: noop, kick: noop, vanish: noop, active: false, object: null }),
  intro: (ctx) => ({ update: noop, start: () => ctx.events.emit('intro:done'), skip: noop, playing: false }),
  player: () => ({
    update: noop, position: new THREE.Vector3(LAYOUT.playerStart.x, 2, LAYOUT.playerStart.z), velocity: new THREE.Vector3(),
    yaw: 0, pitch: 0, object: new THREE.Group(), state: 'ground', gas: 1, blades: { count: 8, durability: 1 }, hp: 1, hooks: [],
    setEnabled: noop, teleport: noop, hurt: noop, grab: noop, kill: noop, respawn: noop, refill: noop, enabled: false,
  }),
  cam: (ctx) => {
    // debug orbit so something is visible before the real rig exists
    return {
      update: (dt, t) => {
        if (ctx.cameraOwner !== 'player') return;
        const p = ctx.player.position;
        ctx.camera.position.set(p.x, p.y + 6, p.z - 14);
        ctx.camera.lookAt(p.x, p.y + 4, p.z + 20);
      },
      fovKick: noop, getAimRay: (o, d) => { ctx.camera.getWorldPosition(o); ctx.camera.getWorldDirection(d); },
    };
  },
  audio: () => {
    const h = { stop: noop, setVolume: noop, setPosition: noop, setRate: noop };
    return { update: noop, unlock: async () => {}, play: noop, loop: () => h, music: noop, setMasterVolume: noop, duck: noop };
  },
  hud: () => ({
    update: noop, showTitle: noop, hideTitle: noop, objective: noop, banner: noop, subtitle: noop, toast: noop,
    showDeath: noop, hideDeath: noop, setVisible: noop, letterbox: noop, fade: noop,
  }),
  director: () => ({ update: noop, start: noop }),
};
