import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Sky }                        from 'three/addons/objects/Sky.js';
import { EffectComposer }             from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }                 from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }            from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }                 from 'three/addons/postprocessing/OutputPass.js';

// ── Room config ───────────────────────────────────────────────────────────────

const ROOMS = {
  lobby:        { label: 'ロビー',  col: 0x134e4a, glow: 0x2dd4bf, lgt: 0x5eead4, wall: 0xd8f5f0, x:   0, z:  0, w: 30, d: 28 },
  learning:     { label: '学習室',  col: 0x1e3a8a, glow: 0x60a5fa, lgt: 0x93c5fd, wall: 0xdceafa, x:  70, z:  0, w: 30, d: 40 },
  workshop:     { label: '作業室',  col: 0x78350f, glow: 0xf59e0b, lgt: 0xfde68a, wall: 0xfdf0d8, x: -70, z:  0, w: 30, d: 40 },
  consultation: { label: '相談室',  col: 0x881337, glow: 0xfb7185, lgt: 0xfecdd3, wall: 0xfde8ec, x:   0, z:-72, w: 30, d: 28 },
};

const SPAWNS = {
  lobby:        { x:  0,  z:  8 },
  learning:     { x: 62,  z:  0 },
  workshop:     { x:-62,  z:  0 },
  consultation: { x:  0,  z:-62 },
};

const ROOM_DOORS = {
  lobby:        { n: true,  s: false, e: true,  w: true  },
  learning:     { n: false, s: false, e: false, w: true  },
  workshop:     { n: false, s: false, e: true,  w: false },
  consultation: { n: false, s: true,  e: false, w: false },
};

const NPCS = [
  { id: 'ren',  name: 'たくや', shirt: 0x7c3aed, pants: 0x1e293b, hair: 0x3b1f14, room: 'workshop',     dx:  4, dz:  5 },
  { id: 'mika', name: 'まさと', shirt: 0x065f46, pants: 0x1e3a5f, hair: 0x0f172a, room: 'learning',     dx: -5, dz: -6 },
  { id: 'sora', name: 'ひろし', shirt: 0x92400e, pants: 0x1c1917, hair: 0x1c0a00, room: 'consultation', dx:  4, dz:  3 },
];

// ── Module state ──────────────────────────────────────────────────────────────

let scene, camera, renderer, labelRenderer, composer;
let playerGroup;
const npcGroups = {};
let clock, animId;
let walkPhase = 0;
let activeRoom = 'lobby';

let camYaw = 0, camPitch = 0.4;
let dragging = false, dragX = 0, dragY = 0, dragMoved = false;

const collidables = [];           // wall / ceiling meshes for camera collision
const camRaycaster = new THREE.Raycaster();

const keys = { w: false, a: false, s: false, d: false };
const raycaster = new THREE.Raycaster();
const screenPt  = new THREE.Vector2();

const screenCanvases = {};
const screenTextures = {};

let cbParticipant = () => {};
let cbRoom        = () => {};

// ── Public API ────────────────────────────────────────────────────────────────

export function initMetaverse(container, onParticipant, onRoom) {
  cbParticipant = onParticipant;
  cbRoom        = onRoom;
  buildRenderer(container);
  buildScene();
  buildWorld();
  buildPlayer();
  addHintOverlay(container);
  bindEvents(container);
  clock = new THREE.Clock();
  loop();
}

export function teleportToRoom(roomId) {
  const sp = SPAWNS[roomId];
  if (!sp || !playerGroup) return;
  playerGroup.position.set(sp.x, 0, sp.z);
  activeRoom = roomId;
}

export function highlightParticipant(id) {
  Object.entries(npcGroups).forEach(([nid, g]) => {
    const body = g.getObjectByName('shirt');
    if (!body) return;
    body.material.emissive.setHex(nid === id ? 0xffd700 : 0x000000);
    body.material.emissiveIntensity = nid === id ? 0.5 : 0;
  });
}

export function setVoiceActive(active) {
  if (!playerGroup) return;
  let ring = playerGroup.userData.voiceRing;
  if (!ring) {
    ring = new THREE.Mesh(
      new THREE.RingGeometry(0.52, 0.64, 36),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    playerGroup.add(ring);
    playerGroup.userData.voiceRing = ring;
  }
  ring.visible = active;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function buildRenderer(container) {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace  = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
  container.appendChild(labelRenderer.domElement);

  camera = new THREE.PerspectiveCamera(56, container.clientWidth / container.clientHeight, 0.1, 500);

  // Post-processing — bloom
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera)); // scene not built yet; updated in buildScene
  const bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.32, 0.5, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(container);
}

// ── Scene ─────────────────────────────────────────────────────────────────────

function buildScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x7ab8d4, 0.007);

  // Physically-based sky
  const sky = new Sky();
  sky.scale.setScalar(1800);
  scene.add(sky);
  const su = sky.material.uniforms;
  su['turbidity'].value       = 2.2;
  su['rayleigh'].value        = 1.1;
  su['mieCoefficient'].value  = 0.003;
  su['mieDirectionalG'].value = 0.86;
  const sunVec = new THREE.Vector3();
  sunVec.setFromSphericalCoords(1, THREE.MathUtils.degToRad(83), THREE.MathUtils.degToRad(195));
  su['sunPosition'].value.copy(sunVec);

  // Re-assign render pass scene reference now that scene exists
  if (composer.passes[0]) composer.passes[0].scene = scene;

  // Lighting
  const hemi = new THREE.HemisphereLight(0xc8e6ff, 0xffe4c8, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff5e0, 2.0);
  sun.position.set(45, 80, 55);
  sun.castShadow           = true;
  sun.shadow.mapSize.width = sun.shadow.mapSize.height = 2048;
  Object.assign(sun.shadow.camera, { near: 1, far: 420, left: -130, right: 130, top: 130, bottom: -130 });
  sun.shadow.bias = -0.001;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xc8d8ff, 0.45);
  fill.position.set(-25, 35, -35);
  scene.add(fill);
}

// ── World ─────────────────────────────────────────────────────────────────────

function buildWorld() {
  // Exterior ground
  const extFloor = mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.95 })
  );
  extFloor.rotation.x = -Math.PI / 2;
  extFloor.receiveShadow = true;
  scene.add(extFloor);

  // Subtle exterior grid
  const grid = new THREE.GridHelper(400, 200, 0x2d4a5c, 0x243648);
  grid.position.y = 0.01;
  scene.add(grid);

  // Building base platform
  const base = mesh(
    new THREE.BoxGeometry(230, 0.15, 180),
    new THREE.MeshStandardMaterial({ color: 0x2d3e4a, roughness: 0.88 })
  );
  base.position.set(0, -0.08, -36);
  base.receiveShadow = true;
  scene.add(base);

  // Rooms
  Object.entries(ROOMS).forEach(([id, r]) => {
    buildRoomZone(id, r);
    buildRoomWalls(id, r);
    buildCeiling(r);
  });

  // Corridors — lobby edges to each room's nearest wall
  buildCorridor(0,  -14, 0,  -58, 8, 0x1e3a5f);   // lobby north → consultation south
  buildCorridor(15,   0, 55,   0, 8, 0x1e3a5f);   // lobby east  → learning west
  buildCorridor(-15,  0, -55,  0, 8, 0x1e3a5f);   // lobby west  → workshop east

  // Outdoor environment
  buildOutdoor();
}

function buildCorridor(x1, z1, x2, z2, width, color) {
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const len = Math.hypot(x2 - x1, z2 - z1);
  const m = mesh(
    new THREE.PlaneGeometry(width, len),
    new THREE.MeshStandardMaterial({ color, roughness: 0.82 })
  );
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.atan2(x2 - x1, z2 - z1);
  m.position.set(cx, 0.015, cz);
  m.receiveShadow = true;
  scene.add(m);
}

function buildRoomZone(id, r) {
  // Floor with canvas tile texture
  const floorTex = makeTileTex(r.col, 12, 0.07);
  floorTex.repeat.set(r.w / 6, r.d / 6);
  const floor = mesh(
    new THREE.PlaneGeometry(r.w, r.d),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.78, metalness: 0.02 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(r.x, 0.02, r.z);
  floor.receiveShadow = true;
  scene.add(floor);

  // Glowing border strips
  const bMat = new THREE.MeshStandardMaterial({ color: r.glow, emissive: new THREE.Color(r.glow), emissiveIntensity: 0.6, roughness: 0.3 });
  const hw = r.w / 2, hd = r.d / 2;
  [[r.w + 0.4, 0.06, 0.22, 0, 0, -hd], [r.w + 0.4, 0.06, 0.22, 0, 0, hd],
   [0.22, 0.06, r.d + 0.4, 0, -hw, 0], [0.22, 0.06, r.d + 0.4, 0, hw, 0]
  ].forEach(([bw, bh, bd, bx, ox, oz]) => {
    const b = mesh(new THREE.BoxGeometry(bw, bh, bd), bMat);
    b.position.set(r.x + ox, 0.03, r.z + oz);
    scene.add(b);
  });

  // CSS2D room label
  const el = document.createElement('div');
  el.className = 'room-sign';
  el.textContent = r.label;
  const obj = new CSS2DObject(el);
  obj.position.set(r.x, 7.2, r.z);
  scene.add(obj);

  // Furniture
  addFurniture(id, r);
}

function buildRoomWalls(id, r) {
  const hw = r.w / 2, hd = r.d / 2;
  const WH = 8.0, WT = 0.22;
  const doors = ROOM_DOORS[id];

  const wallMat = new THREE.MeshStandardMaterial({ color: r.wall, roughness: 0.92, metalness: 0.01 });
  const trimMat = new THREE.MeshStandardMaterial({ color: r.glow, emissive: new THREE.Color(r.glow), emissiveIntensity: 0.22, roughness: 0.5 });

  wallSide(r.x,      r.z - hd, r.w, WH, WT, true,  doors.n, wallMat);
  wallSide(r.x,      r.z + hd, r.w, WH, WT, true,  doors.s, wallMat);
  wallSide(r.x + hw, r.z,      r.d, WH, WT, false, doors.e, wallMat);
  wallSide(r.x - hw, r.z,      r.d, WH, WT, false, doors.w, wallMat);

  const sk = 0.13;
  [[r.w, sk, sk*0.5, r.x, sk/2, r.z-hd], [r.w, sk, sk*0.5, r.x, sk/2, r.z+hd],
   [sk*0.5, sk, r.d, r.x+hw, sk/2, r.z], [sk*0.5, sk, r.d, r.x-hw, sk/2, r.z]
  ].forEach(([bw,bh,bd,bx,by,bz]) => {
    const m = mesh(new THREE.BoxGeometry(bw,bh,bd), trimMat);
    m.position.set(bx,by,bz);
    scene.add(m);
  });
}

function wallSide(cx, cz, len, WH, WT, xAligned, hasDoor, mat) {
  const DW = 4.6, DH = 4.0;
  function seg(w, h, d, px, py, pz) {
    const m = mesh(new THREE.BoxGeometry(w,h,d), mat);
    m.position.set(px,py,pz);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    collidables.push(m);
  }
  if (!hasDoor) {
    xAligned ? seg(len,WH,WT, cx,WH/2,cz) : seg(WT,WH,len, cx,WH/2,cz);
    return;
  }
  const sl = (len - DW) / 2, hH = WH - DH;
  if (xAligned) {
    if (sl > 0) { seg(sl,WH,WT, cx-DW/2-sl/2, WH/2,cz); seg(sl,WH,WT, cx+DW/2+sl/2, WH/2,cz); }
    if (hH > 0)   seg(DW,hH,WT, cx, DH+hH/2, cz);
  } else {
    if (sl > 0) { seg(WT,WH,sl, cx,WH/2, cz-DW/2-sl/2); seg(WT,WH,sl, cx,WH/2, cz+DW/2+sl/2); }
    if (hH > 0)   seg(WT,hH,DW, cx, DH+hH/2, cz);
  }
}

function buildCeiling(r) {
  const CH = 8.5;
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.88 });
  const ceil = mesh(new THREE.PlaneGeometry(r.w - 0.46, r.d - 0.46), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(r.x, CH, r.z);
  scene.add(ceil);
  collidables.push(ceil);

  // Crown molding at ceiling edge
  const molMat = new THREE.MeshStandardMaterial({ color: 0xd0dae4, roughness: 0.75 });
  const mh = 0.18;
  [[r.w+0.48, mh, 0.30, r.x, CH-mh/2, r.z-r.d/2],
   [r.w+0.48, mh, 0.30, r.x, CH-mh/2, r.z+r.d/2],
   [0.30, mh, r.d+0.48, r.x-r.w/2, CH-mh/2, r.z],
   [0.30, mh, r.d+0.48, r.x+r.w/2, CH-mh/2, r.z]
  ].forEach(([bw,bh,bd,bx,by,bz]) => {
    const m = mesh(new THREE.BoxGeometry(bw,bh,bd), molMat);
    m.position.set(bx,by,bz);
    scene.add(m);
  });

  // LED panels + point lights (ceiling at 8.5 m — use higher intensity / wider range)
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: new THREE.Color(0xfcfff8),
    emissiveIntensity: 1.8, roughness: 0.3,
  });
  const offsets = r.w > 25
    ? [[-r.w/4, -r.d/4], [r.w/4, -r.d/4], [-r.w/4, r.d/4], [r.w/4, r.d/4]]
    : [[-r.w/5, -r.d/5], [r.w/5, -r.d/5], [-r.w/5, r.d/5], [r.w/5, r.d/5]];

  offsets.forEach(([ox, oz]) => {
    const panel = mesh(new THREE.BoxGeometry(4.2, 0.06, 1.6), panelMat);
    panel.position.set(r.x + ox, CH - 0.03, r.z + oz);
    scene.add(panel);
    const pt = new THREE.PointLight(0xfff8f0, 4.0, 38, 1.6);
    pt.position.set(r.x + ox, CH - 0.5, r.z + oz);
    scene.add(pt);
  });

  const acc = new THREE.PointLight(r.lgt, 1.4, 55, 1.6);
  acc.position.set(r.x, CH - 1.0, r.z);
  scene.add(acc);
}

// ── Outdoor ───────────────────────────────────────────────────────────────────

function buildOutdoor() {
  [[ 55,-40],[ 62,0],[ 55,40],[-55,-40],[-62,0],[-55,40],
   [10, 60],[25,65],[-25,65],[-10,60],[0,-68],[30,-65],[-30,-65]
  ].forEach(([x,z]) => addTree(x, z));

  [[ 110, 22,  15, 0x263244, 22],
   [ 90,  30,  88, 0x2e3d4f, 30],
   [-108, 18,  20, 0x263244, 18],
   [-85,  26, -90, 0x2e3d4f, 26],
   [ 30, 14, -100, 0x2a3848, 14],
   [-30, 18, -98,  0x2e3d4f, 18],
  ].forEach(([x, h, z, col, w]) => {
    const b = mesh(new THREE.BoxGeometry(w, h, w * 0.7), new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 }));
    b.position.set(x, h / 2, z);
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
    // Windows on buildings
    for (let wy = 2; wy < h - 1; wy += 3.5) {
      for (let wx = -w/2 + 1.5; wx < w/2; wx += 3) {
        const win = mesh(
          new THREE.PlaneGeometry(1.8, 1.4),
          new THREE.MeshStandardMaterial({ color: 0xfff8c0, emissive: new THREE.Color(0xfff8c0), emissiveIntensity: 0.3 + Math.random() * 0.3 })
        );
        win.position.set(x + wx, wy, z + w * 0.35 + 0.01);
        scene.add(win);
      }
    }
  });

  // Road / path
  const road = mesh(
    new THREE.PlaneGeometry(8, 80),
    new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.95 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.008, 40);
  scene.add(road);
}

function addTree(x, z) {
  const trunk = mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.8, 8), new THREE.MeshStandardMaterial({ color: 0x7c5c3a, roughness: 0.9 }));
  trunk.position.set(x, 1.4, z);
  trunk.castShadow = true;
  scene.add(trunk);
  [[0, 3.8, 0, 1.4], [0.5, 4.2, 0.3, 1.1], [-0.3, 4.5, -0.2, 0.9]].forEach(([dx,dy,dz,r]) => {
    const leaves = mesh(
      new THREE.SphereGeometry(r, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x14532d + Math.floor(Math.random() * 0x102000), roughness: 0.88 })
    );
    leaves.position.set(x + dx, dy, z + dz);
    leaves.castShadow = true;
    scene.add(leaves);
  });
}

// ── Furniture ─────────────────────────────────────────────────────────────────

function addFurniture(id, r) {
  const { x, z } = r;
  switch (id) {
    case 'lobby':
      addReceptionDesk(x, z - 5);
      [[-10, 8], [10, 8], [-10, -8], [10, -8]].forEach(([dx, dz]) => addPlant(x + dx, z + dz));
      addSofa(x - 6, z + 6, 0);
      addSofa(x + 6, z + 6, Math.PI);
      addRoundTable(x, z + 2);
      break;
    case 'learning':
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const dx = x - 7 + col * 7, dz = z - 9 + row * 9;
          addDesk(dx, dz);
          addLiveMonitor(dx, dz - 1.4, 'learning');
          addChair(dx, dz + 1.5, 0);
        }
      }
      addPlant(x + 12, z - 17);
      addPlant(x - 12, z - 17);
      break;
    case 'workshop':
      for (let i = 0; i < 3; i++) addWorkTable(x, z - 10 + i * 10, i);
      [[-12, -17], [12, -17]].forEach(([dx, dz]) => addPlant(x + dx, z + dz));
      break;
    case 'consultation':
      addRoundTable(x - 6, z - 2);
      addRoundTable(x + 6, z - 2);
      addSofa(x - 6, z - 6, Math.PI * 0.5);
      addSofa(x + 6, z - 6, -Math.PI * 0.5);
      addDivider(x, z - 7, 12);
      [[-12, 8], [12, 8]].forEach(([dx, dz]) => addPlant(x + dx, z + dz));
      break;
  }
}

function addBox(x, y, z, w, h, d, color, extra = {}) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.06, ...extra }));
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  return m;
}

function addCyl(x, y, z, rTop, rBot, h, color) {
  const m = mesh(new THREE.CylinderGeometry(rTop, rBot, h, 20), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}

function addPlant(x, z) {
  addCyl(x, 0, z, 0.2, 0.26, 0.44, 0x7c6a5a);
  const l = mesh(new THREE.SphereGeometry(0.62, 10, 8), new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.88 }));
  l.position.set(x, 1.02, z);
  l.castShadow = true;
  scene.add(l);
  const l2 = mesh(new THREE.SphereGeometry(0.38, 8, 6), new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.88 }));
  l2.position.set(x + 0.3, 1.3, z + 0.2);
  l2.castShadow = true;
  scene.add(l2);
}

function addReceptionDesk(x, z) {
  addBox(x, 0, z, 4.2, 0.92, 1.7, 0x0f766e);
  addBox(x, 0.92, z - 0.5, 4.2, 0.08, 0.65, 0xf0fdfa);
  addBox(x - 0.5, 0.92, z, 0.85, 0.52, 0.06, 0x0f172a);
  addBox(x - 0.5, 0.92, z + 0.28, 0.42, 0.04, 0.24, 0x334155);
}

function addDesk(x, z) {
  [[-0.82,-0.38],[0.82,-0.38],[-0.82,0.38],[0.82,0.38]].forEach(([dx,dz]) => addBox(x+dx,0,z+dz, 0.05,0.73,0.05, 0x94a3b8));
  addBox(x, 0.73, z, 1.85, 0.06, 0.82, 0xf1f5f9);
}

function addLiveMonitor(x, z, screenId) {
  addBox(x, 0.82, z, 0.08, 0.08, 0.15, 0x64748b);
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 320;
  if (!screenCanvases[screenId]) {
    screenCanvases[screenId] = canvas;
    screenTextures[screenId] = new THREE.CanvasTexture(canvas);
  }
  const scrMesh = mesh(
    new THREE.BoxGeometry(0.95, 0.58, 0.055),
    new THREE.MeshStandardMaterial({ map: screenTextures[screenId], emissiveMap: screenTextures[screenId], emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.45 })
  );
  scrMesh.position.set(x, 1.175, z);
  scrMesh.castShadow = true;
  scene.add(scrMesh);
}

function addChair(x, z, rotY) {
  const g = new THREE.Group();
  const seat = mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 }));
  seat.position.y = 0.44;
  g.add(seat);
  const back = mesh(new THREE.BoxGeometry(0.5, 0.52, 0.06), new THREE.MeshStandardMaterial({ color: 0x1e293b }));
  back.position.set(0, 0.7, -0.22);
  g.add(back);
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
}

function addSofa(x, z, rotY) {
  const g = new THREE.Group();
  const col = 0x1e40af;
  const seat = mesh(new THREE.BoxGeometry(1.65, 0.22, 0.78), new THREE.MeshStandardMaterial({ color: col, roughness: 0.55 }));
  seat.position.y = 0.37;
  g.add(seat);
  const back = mesh(new THREE.BoxGeometry(1.65, 0.58, 0.14), new THREE.MeshStandardMaterial({ color: 0x1e3a8a }));
  back.position.set(0, 0.66, -0.32);
  g.add(back);
  [-0.72, 0.72].forEach(ax => {
    const arm = mesh(new THREE.BoxGeometry(0.14, 0.3, 0.78), new THREE.MeshStandardMaterial({ color: 0x1e3a8a }));
    arm.position.set(ax, 0.53, 0);
    g.add(arm);
  });
  [[-0.66,-0.3],[0.66,-0.3],[-0.66,0.3],[0.66,0.3]].forEach(([lx,lz]) => {
    const leg = mesh(new THREE.BoxGeometry(0.07,0.27,0.07), new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.3 }));
    leg.position.set(lx, 0.135, lz);
    g.add(leg);
  });
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
}

function addWorkTable(x, z, idx) {
  addBox(x, 0.73, z, 6.6, 0.075, 1.25, 0x78350f);
  [[-2.85,0],[2.85,0]].forEach(([dx]) => {
    addBox(x+dx,0,z-0.42, 0.08,0.73,0.08, 0x92400e);
    addBox(x+dx,0,z+0.42, 0.08,0.73,0.08, 0x92400e);
    addBox(x+dx,0.3,z, 0.08,0.07,0.85, 0x92400e);
  });
  addBox(x-1.8+idx*0.3, 0.805, z, 0.32,0.22,0.25, 0x1d4ed8);
  addBox(x+0.5, 0.805, z, 0.16,0.16,0.16, 0xef4444);
  addBox(x+1.8, 0.805, z-0.2, 0.85,0.01,0.58, 0xf8fafc);

  // Live screen for workshop
  if (idx === 1) addLiveMonitor(x - 2.5, z - 0.5, 'workshop');
}

function addRoundTable(x, z) {
  addCyl(x, 0, z, 0.06, 0.08, 0.73, 0x9ca3af);
  addCyl(x, 0.73, z, 1.12, 1.12, 0.07, 0xfef3c7);
}

function addDivider(x, z, len) {
  addBox(x, 0, z, len, 1.45, 0.1, 0xe2e8f0, { roughness: 0.6 });
}

// ── Avatar factory ────────────────────────────────────────────────────────────

function buildAvatar(shirtColor, hairColor, pantsColor, name, isPlayer) {
  const g = new THREE.Group();

  // Legs
  const legMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.6 });
  [-0.1, 0.1].forEach(dx => {
    const leg = mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), legMat);
    leg.position.set(dx, 0.42, 0);
    leg.castShadow = true;
    g.add(leg);
  });

  // Shoes
  [-0.12, 0.12].forEach(dx => {
    const shoe = mesh(new THREE.BoxGeometry(0.17, 0.07, 0.3), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 }));
    shoe.position.set(dx, 0.035, 0.04);
    g.add(shoe);
  });

  // Shirt / body
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.55, metalness: 0.05 });
  const shirt = mesh(new THREE.CapsuleGeometry(0.28, 0.7, 4, 10), shirtMat);
  shirt.name = 'shirt';
  shirt.position.y = 1.08;
  shirt.castShadow = true;
  g.add(shirt);

  // Collar / neck
  const neck = mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.15, 10), new THREE.MeshStandardMaterial({ color: 0xfde8c8, roughness: 0.8 }));
  neck.position.y = 1.52;
  g.add(neck);

  // Head
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfde8c8, roughness: 0.72 });
  const head = mesh(new THREE.SphereGeometry(0.29, 16, 12), headMat);
  head.name = 'head';
  head.position.y = 1.78;
  head.castShadow = true;
  g.add(head);

  // Hair
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.82 });
  const hairTop = mesh(new THREE.SphereGeometry(0.3, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
  hairTop.position.y = 1.82;
  g.add(hairTop);
  const hairBack = mesh(new THREE.SphereGeometry(0.28, 12, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.22), hairMat);
  hairBack.position.set(0, 1.74, 0.04);
  g.add(hairBack);

  // Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e });
  [-0.1, 0.1].forEach(ex => {
    const eye = mesh(new THREE.SphereGeometry(0.048, 8, 6), eyeMat);
    eye.position.set(ex, 1.81, 0.26);
    g.add(eye);
  });
  // Eyebrows
  const browMat = new THREE.MeshStandardMaterial({ color: hairColor });
  [-0.1, 0.1].forEach(ex => {
    const brow = mesh(new THREE.BoxGeometry(0.1, 0.02, 0.04), browMat);
    brow.position.set(ex, 1.86, 0.26);
    g.add(brow);
  });

  // Name label
  const div = document.createElement('div');
  div.className = isPlayer ? 'avatar-label player-label' : 'avatar-label npc-label';
  div.textContent = name;
  const lbl = new CSS2DObject(div);
  lbl.position.set(0, 2.38, 0);
  g.add(lbl);

  // Ground shadow
  const disc = mesh(new THREE.CircleGeometry(0.38, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2 }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.01;
  g.add(disc);

  return g;
}

function buildPlayer() {
  playerGroup = buildAvatar(0x0d9488, 0x1c1917, 0x1e293b, '自分', true);
  playerGroup.position.set(SPAWNS.lobby.x, 0, SPAWNS.lobby.z);
  scene.add(playerGroup);
}

function buildNPCs() {
  NPCS.forEach(n => {
    const r = ROOMS[n.room];
    const g = buildAvatar(n.shirt, n.hair, n.pants, n.name, false);
    g.position.set(r.x + n.dx, 0, r.z + n.dz);
    g.userData.participantId = n.id;
    scene.add(g);
    npcGroups[n.id] = g;
  });
}

// ── Canvas textures ───────────────────────────────────────────────────────────

function makeTileTex(hexColor, tileCount, lineAlpha) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const r = (hexColor >> 16) & 0xff, g = (hexColor >> 8) & 0xff, b = hexColor & 0xff;
  const lighten = v => Math.min(255, v + 14);
  ctx.fillStyle = `rgb(${lighten(r)},${lighten(g)},${lighten(b)})`;
  ctx.fillRect(0, 0, S, S);
  const ts = S / tileCount;
  ctx.strokeStyle = `rgba(255,255,255,${lineAlpha})`;
  ctx.lineWidth = 1.2;
  for (let i = 0; i <= tileCount; i++) {
    ctx.beginPath(); ctx.moveTo(i*ts,0); ctx.lineTo(i*ts,S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,i*ts); ctx.lineTo(S,i*ts); ctx.stroke();
  }
  const img = ctx.getImageData(0,0,S,S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n));
    img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n));
    img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n));
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function updateScreens() {
  const t = performance.now() * 0.001;
  if (screenCanvases.learning) {
    drawLearningScreen(screenCanvases.learning.getContext('2d'), t);
    screenTextures.learning.needsUpdate = true;
  }
  if (screenCanvases.workshop) {
    drawWorkshopScreen(screenCanvases.workshop.getContext('2d'), t);
    screenTextures.workshop.needsUpdate = true;
  }
}

function drawLearningScreen(ctx, t) {
  const W = 512, H = 320;
  ctx.fillStyle = '#080e1c';
  ctx.fillRect(0,0,W,H);
  const hg = ctx.createLinearGradient(0,0,W,0);
  hg.addColorStop(0,'#1d4ed8'); hg.addColorStop(1,'#0d9488');
  ctx.fillStyle = hg; ctx.fillRect(0,0,W,46);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif';
  ctx.fillText('就労準備プログラム', 14, 32);
  const courses = [
    { name: '報連相の基本',           p: 0.75 },
    { name: 'ビジネスメール',          p: 0.45 },
    { name: 'デジタルスキル入門',      p: 0.28 },
  ];
  courses.forEach((c, i) => {
    const y = 68 + i * 72;
    ctx.fillStyle = '#94a3b8'; ctx.font = '13px sans-serif'; ctx.fillText(c.name, 18, y);
    ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.roundRect(18, y+10, W-36, 16, 8); ctx.fill();
    const p = Math.min(1, c.p + Math.sin(t*1.2+i)*0.02);
    const bg = ctx.createLinearGradient(18,0,18+(W-36)*p,0);
    bg.addColorStop(0,'#1d4ed8'); bg.addColorStop(1,'#06b6d4');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(18, y+10, (W-36)*p, 16, 8); ctx.fill();
    ctx.fillStyle = '#94a3b8'; ctx.font = '12px sans-serif';
    ctx.fillText(`${Math.round(c.p*100)}%`, W-52, y+23);
  });
  ctx.fillStyle = '#0d9488'; ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleTimeString('ja'), W-14, H-14);
  ctx.textAlign = 'left';
}

function drawWorkshopScreen(ctx, t) {
  const W = 512, H = 320;
  ctx.fillStyle = '#080e1c';
  ctx.fillRect(0,0,W,H);
  const hg = ctx.createLinearGradient(0,0,W,0);
  hg.addColorStop(0,'#92400e'); hg.addColorStop(1,'#b45309');
  ctx.fillStyle = hg; ctx.fillRect(0,0,W,46);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif'; ctx.fillText('タスクボード', 14, 32);
  const cols = [
    { title:'未着手', color:'#475569', tasks:['告知画像作成','Notion記録'] },
    { title:'進行中', color:'#1d4ed8', tasks:['デザイン確認'] },
    { title:'完了',   color:'#059669', tasks:['週次ふりかえり','メモ送付'] },
  ];
  const cw = (W-30)/3;
  cols.forEach((col, ci) => {
    const cx = 10 + ci*(cw+5), cy = 54;
    ctx.fillStyle = col.color+'28'; ctx.beginPath(); ctx.roundRect(cx,cy,cw,H-64,7); ctx.fill();
    ctx.fillStyle = col.color; ctx.font = 'bold 12px sans-serif'; ctx.fillText(col.title, cx+8, cy+20);
    col.tasks.forEach((task,ti) => {
      const ty = cy+36+ti*40;
      ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.roundRect(cx+4,ty,cw-8,30,5); ctx.fill();
      ctx.fillStyle = '#cbd5e1'; ctx.font = '11px sans-serif'; ctx.fillText(task, cx+10, ty+19);
    });
  });
  ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleTimeString('ja'), W-14, H-14);
  ctx.textAlign = 'left';
}

// ── Hint overlay ──────────────────────────────────────────────────────────────

function addHintOverlay(container) {
  const h = document.createElement('div');
  h.className = 'movement-hint';
  h.innerHTML = 'WASD / 矢印：移動&nbsp;&nbsp;|&nbsp;&nbsp;ドラッグ：視点&nbsp;&nbsp;|&nbsp;&nbsp;1〜4：ルーム';
  container.appendChild(h);
}

// ── Input ─────────────────────────────────────────────────────────────────────

function bindEvents(container) {
  const km = { w:'w',a:'a',s:'s',d:'d',W:'w',A:'a',S:'s',D:'d', ArrowUp:'w',ArrowDown:'s',ArrowLeft:'a',ArrowRight:'d' };
  const rk = { '1':'lobby','2':'learning','3':'workshop','4':'consultation' };
  window.addEventListener('keydown', e => {
    const k = km[e.key];
    if (k) { keys[k] = true; if (e.key.startsWith('Arrow')) e.preventDefault(); }
    if (rk[e.key]) { teleportToRoom(rk[e.key]); cbRoom(rk[e.key]); }
  });
  window.addEventListener('keyup', e => { const k = km[e.key]; if (k) keys[k] = false; });

  container.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragging = true; dragMoved = false; dragX = e.clientX; dragY = e.clientY;
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX-dragX, dy = e.clientY-dragY;
    if (Math.abs(dx)+Math.abs(dy) > 3) dragMoved = true;
    camYaw   -= dx * 0.007;
    camPitch  = Math.max(0.12, Math.min(0.94, camPitch + dy * 0.005));
    dragX = e.clientX; dragY = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  container.addEventListener('click', e => {
    if (dragMoved) return;
    const rect = container.getBoundingClientRect();
    screenPt.x =  ((e.clientX-rect.left)/rect.width)  * 2 - 1;
    screenPt.y = -((e.clientY-rect.top) /rect.height) * 2 + 1;
    raycaster.setFromCamera(screenPt, camera);
    const hits = raycaster.intersectObjects(Object.values(npcGroups).flatMap(g => g.children.filter(c => c.isMesh)));
    if (hits.length > 0) {
      const id = hits[0].object.parent.userData.participantId;
      if (id) cbParticipant(id);
    }
  });
}

// ── Remote players ────────────────────────────────────────────────────────────

const REMOTE_COLORS = [
  { shirt: 0x3b82f6, hair: 0x1e293b, pants: 0x1e3a5f },
  { shirt: 0xef4444, hair: 0x7f1d1d, pants: 0x450a0a },
  { shirt: 0x10b981, hair: 0x064e3b, pants: 0x052e16 },
  { shirt: 0xf59e0b, hair: 0x451a03, pants: 0x422006 },
  { shirt: 0x8b5cf6, hair: 0x2e1065, pants: 0x3b0764 },
  { shirt: 0xec4899, hair: 0x500724, pants: 0x4a0d3b },
];

const remotePlayers = {};

export function addRemotePlayer(id, data) {
  if (remotePlayers[id]) { _setRemoteTarget(id, data); return; }
  const c = REMOTE_COLORS[(data.avatarIdx ?? 0) % REMOTE_COLORS.length];
  const g = buildAvatar(c.shirt, c.hair, c.pants, data.name || '?', false);
  g.position.set(data.x ?? 0, 0, data.z ?? 0);
  g.rotation.y = data.yaw ?? 0;
  scene.add(g);
  remotePlayers[id] = { group: g, tx: data.x ?? 0, tz: data.z ?? 0, tyaw: data.yaw ?? 0 };
}

export function moveRemotePlayer(id, data) {
  if (!remotePlayers[id]) { addRemotePlayer(id, data); return; }
  _setRemoteTarget(id, data);
}

function _setRemoteTarget(id, data) {
  const rp = remotePlayers[id];
  if (!rp) return;
  if (data.x   !== undefined) rp.tx   = data.x;
  if (data.z   !== undefined) rp.tz   = data.z;
  if (data.yaw !== undefined) rp.tyaw = data.yaw;
}

export function removeRemotePlayer(id) {
  const rp = remotePlayers[id];
  if (!rp) return;
  scene.remove(rp.group);
  delete remotePlayers[id];
}

export function getPlayerState() {
  if (!playerGroup) return null;
  return { x: playerGroup.position.x, z: playerGroup.position.z, yaw: camYaw };
}

function animateRemotePlayers() {
  const L = 0.18;
  Object.values(remotePlayers).forEach(rp => {
    rp.group.position.x += (rp.tx - rp.group.position.x) * L;
    rp.group.position.z += (rp.tz - rp.group.position.z) * L;
    let dy = rp.tyaw - rp.group.rotation.y;
    while (dy >  Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    rp.group.rotation.y += dy * L;
  });
}

// ── Animation loop ────────────────────────────────────────────────────────────

function loop() {
  animId = requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t  = performance.now() * 0.001;
  movePlayer(dt);
  animateNPCs(t);
  animateVoiceRing(t);
  animateRemotePlayers();
  updateCamera();
  updateScreens();
  composer.render();
  labelRenderer.render(scene, camera);
}

function movePlayer(dt) {
  const dir = new THREE.Vector3();
  if (keys.w) dir.z -= 1;
  if (keys.s) dir.z += 1;
  if (keys.a) dir.x -= 1;
  if (keys.d) dir.x += 1;
  if (dir.length() > 0) {
    dir.normalize().applyAxisAngle(new THREE.Vector3(0,1,0), camYaw);
    playerGroup.position.x += dir.x * 9 * dt;
    playerGroup.position.z += dir.z * 9 * dt;
    playerGroup.rotation.y  = Math.atan2(dir.x, dir.z);
    walkPhase += dt * 10;
    playerGroup.position.y  = Math.abs(Math.sin(walkPhase)) * 0.06;
  } else {
    playerGroup.position.y = THREE.MathUtils.lerp(playerGroup.position.y, 0, dt * 10);
  }
  const B = 105;
  playerGroup.position.x = Math.max(-B, Math.min(B, playerGroup.position.x));
  playerGroup.position.z = Math.max(-B, Math.min(B, playerGroup.position.z));

  const px = playerGroup.position.x, pz = playerGroup.position.z;
  let nearest = 'lobby', minD = Infinity;
  Object.entries(ROOMS).forEach(([id,r]) => { const d = Math.hypot(px-r.x,pz-r.z); if (d<minD){ minD=d; nearest=id; } });
  if (nearest !== activeRoom) { activeRoom = nearest; cbRoom(nearest); }
}

function animateNPCs(t) {
  Object.values(npcGroups).forEach((g, i) => {
    const s = 1 + Math.sin(t*1.3+i*1.1)*0.012;
    const shirt = g.getObjectByName('shirt'), head = g.getObjectByName('head');
    if (shirt) shirt.scale.set(s,s,s);
    if (head)  head.position.y = 1.78 + Math.sin(t*1.0+i*0.8)*0.016;
    g.rotation.y = Math.sin(t*0.28+i*2.0)*0.38;
  });
}

function animateVoiceRing(t) {
  const ring = playerGroup?.userData.voiceRing;
  if (ring?.visible) {
    const s = 1 + Math.sin(t*7)*0.09;
    ring.scale.set(s,1,s);
    ring.material.opacity = 0.55 + Math.sin(t*9)*0.25;
  }
}

function updateCamera() {
  if (!playerGroup) return;
  const target = playerGroup.position.clone().add(new THREE.Vector3(0, 1.2, 0));
  const sinY = Math.sin(camYaw), cosY = Math.cos(camYaw);
  const sinP = Math.sin(camPitch), cosP = Math.cos(camPitch);

  // Direction from target toward ideal camera position (already unit length)
  const dir = new THREE.Vector3(sinY * cosP, sinP, cosY * cosP);
  const IDEAL = 14;

  // Raycast: if a wall/ceiling is in the way, pull camera to just in front of it
  camRaycaster.set(target, dir);
  camRaycaster.near = 0.1;
  camRaycaster.far  = IDEAL;
  const hits = camRaycaster.intersectObjects(collidables, false);
  const dist  = hits.length > 0 ? Math.max(2.0, hits[0].distance - 0.3) : IDEAL;

  camera.position.copy(target).addScaledVector(dir, dist);
  camera.lookAt(target);
}

// ── Utility ───────────────────────────────────────────────────────────────────

function mesh(geo, mat) { return new THREE.Mesh(geo, mat); }
