// Keyboard + mouse with pointer lock. Systems poll this each frame.
//   input.down('KeyW')        held this frame
//   input.pressed('Space')    went down since last frame
//   input.released('KeyE')
//   input.mouse.left/right/middle (held), input.mouse.leftPressed etc.
//   input.mouse.dx/dy         pointer-locked movement this frame (pixels)
//   input.wheel               wheel delta this frame
//   input.locked              pointer lock active
export function createInput(canvas) {
  const held = new Set(), pressedSet = new Set(), releasedSet = new Set();
  const mouse = { left: false, right: false, middle: false, leftPressed: false, rightPressed: false, middlePressed: false,
    leftReleased: false, rightReleased: false, middleReleased: false, dx: 0, dy: 0, x: 0, y: 0 };
  const input = {
    mouse, wheel: 0, locked: false, enabled: true, sensitivity: 1,
    down: (c) => held.has(c), pressed: (c) => pressedSet.has(c), released: (c) => releasedSet.has(c),
    requestLock() { if (!document.pointerLockElement) canvas.requestPointerLock?.()?.catch?.(() => {}); },
    exitLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    endFrame() {
      pressedSet.clear(); releasedSet.clear();
      mouse.dx = 0; mouse.dy = 0; input.wheel = 0;
      mouse.leftPressed = mouse.rightPressed = mouse.middlePressed = false;
      mouse.leftReleased = mouse.rightReleased = mouse.middleReleased = false;
    },
  };
  addEventListener('keydown', (e) => {
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!held.has(e.code)) pressedSet.add(e.code);
    held.add(e.code);
  });
  addEventListener('keyup', (e) => { held.delete(e.code); releasedSet.add(e.code); });
  addEventListener('blur', () => { held.clear(); mouse.left = mouse.right = mouse.middle = false; });
  const btn = ['left', 'middle', 'right'];
  addEventListener('mousedown', (e) => { const b = btn[e.button]; if (!b) return; mouse[b] = true; mouse[b + 'Pressed'] = true; });
  addEventListener('mouseup', (e) => { const b = btn[e.button]; if (!b) return; mouse[b] = false; mouse[b + 'Released'] = true; });
  addEventListener('mousemove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (document.pointerLockElement) { mouse.dx += e.movementX; mouse.dy += e.movementY; }
  });
  addEventListener('wheel', (e) => { input.wheel += Math.sign(e.deltaY); }, { passive: true });
  addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => { input.locked = document.pointerLockElement === canvas; });
  return input;
}
