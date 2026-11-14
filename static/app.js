import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// --- State ---
let appState = null;
let savedRooms = [];
let activeRoomId = null;
let lastAnalysis = null;
let catalogData = null;
let selectedItemId = null;
let interactionMode = "camera"; // "camera" (default) | "edit"
let autoCutawayWalls = true;
let isDragging = false;
let dragOffset = new THREE.Vector3();

// --- Three.js Scene Setup ---
const container = document.getElementById("canvas-container");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#141619");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 5, 4000);
camera.position.set(220, 420, 480);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.02;

// Groups
const roomGroup = new THREE.Group();
const furnitureGroup = new THREE.Group();
const helperGroup = new THREE.Group();
scene.add(roomGroup);
scene.add(furnitureGroup);
scene.add(helperGroup);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 0.65);
hemiLight.position.set(0, 400, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xfffaf0, 1.3);
dirLight.position.set(260, 460, 220);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 50;
dirLight.shadow.camera.far = 1500;
const d = 400;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

// Maps item.id -> Three.Group
const furnitureMeshes = new Map();
// Wall meshes for cutaway transparency
const wallMeshes = {};

// Floor Texture Generator
function createFloorTexture(floorType, baseHex) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = baseHex || "#d8b88c";
  ctx.fillRect(0, 0, 512, 512);

  if (floorType === "oak" || floorType === "walnut" || floorType === "ash") {
    const planks = 8;
    const plankH = 512 / planks;
    ctx.strokeStyle = "rgba(0,0,0,0.13)";
    ctx.lineWidth = 2;
    for (let i = 0; i < planks; i++) {
      const y = i * plankH;
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)";
      ctx.fillRect(0, y, 512, plankH);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();

      const jointX = ((i * 173) % 380) + 60;
      ctx.beginPath();
      ctx.moveTo(jointX, y);
      ctx.lineTo(jointX, y + plankH);
      ctx.stroke();
    }
  } else if (floorType === "tile") {
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 3;
    const step = 128;
    for (let i = 0; i <= 512; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
  } else if (floorType === "carpet") {
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    for (let i = 0; i < 1200; i++) {
      ctx.fillRect((i * 73) % 512, (i * 137) % 512, 2, 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

// Text Sprite helper for Compass / Labels
function makeLabelSprite(text, bgColor = "rgba(20, 24, 32, 0.85)", textColor = "#ffffff") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 48, 12);
  ctx.fill();
  ctx.font = "bold 24px -apple-system, sans-serif";
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(60, 15, 1);
  return sprite;
}

function applyLightingMood(mood) {
  if (mood === "warm") {
    ambientLight.color.set("#ffebd6");
    ambientLight.intensity = 0.65;
    dirLight.color.set("#ffdcb8");
    dirLight.intensity = 1.15;
  } else if (mood === "evening") {
    ambientLight.color.set("#9da9c4");
    ambientLight.intensity = 0.42;
    dirLight.color.set("#ffae70");
    dirLight.intensity = 0.75;
  } else if (mood === "studio") {
    ambientLight.color.set("#ffffff");
    ambientLight.intensity = 0.9;
    dirLight.color.set("#ffffff");
    dirLight.intensity = 1.4;
  } else {
    // daylight
    ambientLight.color.set("#ffffff");
    ambientLight.intensity = 0.75;
    dirLight.color.set("#fffaf0");
    dirLight.intensity = 1.3;
  }
}

// Build Room Geometry (centered at world 0,0,0 -> floor coordinates [0..W, 0..D] mapped to [-W/2..W/2, -D/2..D/2])
function roomToWorld(x, z, roomW, roomD) {
  return { wx: x - roomW / 2, wz: z - roomD / 2 };
}

function worldToRoom(wx, wz, roomW, roomD) {
  return { x: wx + roomW / 2, z: wz + roomD / 2 };
}

function buildRoomMesh(room) {
  roomGroup.clear();
  helperGroup.clear();
  for (const k of Object.keys(wallMeshes)) delete wallMeshes[k];

  const W = Number(room.width || 352);
  const D = Number(room.depth || 264);
  const H = Number(room.height || 240);
  const wallT = 8;

  applyLightingMood(room.lighting || "daylight");

  // 1. Floor
  const floorTex = createFloorTexture(room.floorType || "oak", room.floorColor || "#d8b88c");
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: room.floorType === "tile" ? 0.35 : 0.7,
    metalness: 0.05,
  });
  const floorGeo = new THREE.BoxGeometry(W, 4, D);
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.set(0, -2, 0);
  floorMesh.receiveShadow = true;
  floorMesh.name = "floor";
  roomGroup.add(floorMesh);

  // Subtle 50cm grid overlay on floor
  const gridMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08 });
  const gridPoints = [];
  for (let x = 0; x <= W; x += 50) {
    const wx = x - W / 2;
    gridPoints.push(new THREE.Vector3(wx, 0.2, -D / 2), new THREE.Vector3(wx, 0.2, D / 2));
  }
  for (let z = 0; z <= D; z += 50) {
    const wz = z - D / 2;
    gridPoints.push(new THREE.Vector3(-W / 2, 0.2, wz), new THREE.Vector3(W / 2, 0.2, wz));
  }
  const gridGeo = new THREE.BufferGeometry().setFromPoints(gridPoints);
  roomGroup.add(new THREE.LineSegments(gridGeo, gridMat));

  // 2. Walls (North: -D/2, South: +D/2, West: -W/2, East: +W/2)
  const makeWallMat = (dir) => {
    const isAccent = room.accentWall === dir;
    const col = isAccent ? (room.accentWallColor || "#dce3df") : (room.wallColor || "#f7f6f2");
    return new THREE.MeshStandardMaterial({
      color: col,
      roughness: 0.85,
      transparent: true,
      opacity: 1.0,
    });
  };

  const wallsSpec = [
    { dir: "north", w: W + wallT * 2, d: wallT, x: 0, z: -D / 2 - wallT / 2 },
    { dir: "south", w: W + wallT * 2, d: wallT, x: 0, z: D / 2 + wallT / 2 },
    { dir: "west", w: wallT, d: D, x: -W / 2 - wallT / 2, z: 0 },
    { dir: "east", w: wallT, d: D, x: W / 2 + wallT / 2, z: 0 },
  ];

  for (const ws of wallsSpec) {
    const mat = makeWallMat(ws.dir);
    const geo = new THREE.BoxGeometry(ws.w, H, ws.d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(ws.x, H / 2, ws.z);
    mesh.receiveShadow = true;
    roomGroup.add(mesh);
    wallMeshes[ws.dir] = mesh;
  }

  // 3. Openings (Doors & Windows)
  for (const op of room.openings || []) {
    const opGroup = new THREE.Group();
    const otype = op.type || "window";
    const wall = op.wall || "east";
    const opW = Number(op.width || 80);
    const opH = Number(op.height || 180);
    const sill = Number(op.sillHeight || 0);
    const offset = Number(op.offset || 100);

    if (otype === "window" || otype === "balcony_window") {
      // Window frame + glass
      const frameMat = new THREE.MeshStandardMaterial({ color: "#e5e7eb", roughness: 0.5 });
      const glassMat = new THREE.MeshStandardMaterial({
        color: "#bae6fd",
        transparent: true,
        opacity: 0.45,
        roughness: 0.1,
        metalness: 0.2,
      });
      const frame = new THREE.Mesh(new THREE.BoxGeometry(opW, opH, 4), frameMat);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(opW - 8, opH - 8, 5), glassMat);
      opGroup.add(frame, glass);
    } else {
      // Door / Closet panel
      const doorMat = new THREE.MeshStandardMaterial({
        color: otype === "closet" ? "#f3f2ee" : "#d6bfa3",
        roughness: 0.7,
      });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(opW, opH, 4), doorMat);
      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(8, 3, 8),
        new THREE.MeshStandardMaterial({ color: "#333333", metalness: 0.8 })
      );
      handle.position.set(opW / 2 - 12, 0, 2);
      opGroup.add(panel, handle);

      // Floor clearance zone visual (only for hinged doors, not sliding doors)
      if (op.swing !== "sliding") {
        const clearDepth = otype === "door" ? 75 : 55;
        const zoneGeo = new THREE.PlaneGeometry(opW, clearDepth);
        const zoneMat = new THREE.MeshBasicMaterial({
          color: 0x60a5fa,
          transparent: true,
          opacity: 0.16,
          side: THREE.DoubleSide,
        });
        const zoneMesh = new THREE.Mesh(zoneGeo, zoneMat);
        zoneMesh.rotation.x = -Math.PI / 2;
        zoneMesh.position.set(0, -opH / 2 - sill + 0.5, clearDepth / 2);
        opGroup.add(zoneMesh);
      }
    }

    const cy = sill + opH / 2;
    if (wall === "north") {
      opGroup.position.set(offset - W / 2, cy, -D / 2 + 1);
      opGroup.rotation.y = 0;
    } else if (wall === "south") {
      opGroup.position.set(offset - W / 2, cy, D / 2 - 1);
      opGroup.rotation.y = Math.PI;
    } else if (wall === "west") {
      opGroup.position.set(-W / 2 + 1, cy, offset - D / 2);
      opGroup.rotation.y = Math.PI / 2;
    } else if (wall === "east") {
      opGroup.position.set(W / 2 - 1, cy, offset - D / 2);
      opGroup.rotation.y = -Math.PI / 2;
    }
    roomGroup.add(opGroup);
  }

  // 3.5. Internal Structures (Kitchen System, Counter, Partition Walls, Built-in Closets)
  for (const st of room.structures || []) {
    const sw = Number(st.width || 50);
    const sd = Number(st.depth || 30);
    const sh = Number(st.height || 200);
    const kind = st.kind || (sh >= H - 10 ? "wall" : "box");
    const { wx, wz } = roomToWorld(Number(st.x || 0), Number(st.z || 0), W, D);

    if (kind === "kitchen_system") {
      const kGroup = new THREE.Group();
      kGroup.position.set(wx, 0, wz);

      // Base cabinet
      const cabMat = new THREE.MeshStandardMaterial({ color: st.color || "#d6cbbd", roughness: 0.7 });
      const topMat = new THREE.MeshStandardMaterial({ color: "#e5e7eb", roughness: 0.25, metalness: 0.25 });
      const metalMat = new THREE.MeshStandardMaterial({ color: "#9ca3af", roughness: 0.2, metalness: 0.85 });
      const darkMat = new THREE.MeshStandardMaterial({ color: "#1f2937", roughness: 0.3, metalness: 0.5 });

      const base = new THREE.Mesh(new THREE.BoxGeometry(sw, sh - 4, sd), cabMat);
      base.position.set(0, (sh - 4) / 2, 0);
      base.castShadow = true;
      base.receiveShadow = true;
      kGroup.add(base);

      const worktop = new THREE.Mesh(new THREE.BoxGeometry(sw + 2, 4, sd + 2), topMat);
      worktop.position.set(0, sh - 2, 0);
      worktop.receiveShadow = true;
      kGroup.add(worktop);

      // Stove (West side)
      const stove = new THREE.Mesh(new THREE.BoxGeometry(58, 1.5, 42), darkMat);
      stove.position.set(-sw / 2 + 42, sh + 0.5, 0);
      kGroup.add(stove);

      // Sink basin (East side — where sightline opens!)
      const sinkW = 72;
      const sinkD = 44;
      const sinkX = sw / 2 - 52;
      const sink = new THREE.Mesh(new THREE.BoxGeometry(sinkW, 2, sinkD), metalMat);
      sink.position.set(sinkX, sh + 0.3, 2);
      kGroup.add(sink);

      // Gooseneck Faucet (水栓)
      const faucetPipe = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 28, 12), metalMat);
      faucetPipe.position.set(sinkX, sh + 14, -sinkD / 2 + 4);
      kGroup.add(faucetPipe);
      const faucetSpout = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 16), metalMat);
      faucetSpout.position.set(sinkX, sh + 27, -sinkD / 2 + 11);
      kGroup.add(faucetSpout);

      roomGroup.add(kGroup);
    } else if (kind === "counter") {
      const cGroup = new THREE.Group();
      cGroup.position.set(wx, 0, wz);
      const wallMat = new THREE.MeshStandardMaterial({ color: st.color || "#f2efe9", roughness: 0.85 });
      const boardMat = new THREE.MeshStandardMaterial({ color: "#dfc196", roughness: 0.55 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(sw, sh - 4, sd - 4), wallMat);
      body.position.set(0, (sh - 4) / 2, 0);
      body.castShadow = true;
      body.receiveShadow = true;
      const topBoard = new THREE.Mesh(new THREE.BoxGeometry(sw + 2, 4, sd + 4), boardMat);
      topBoard.position.set(0, sh - 2, 2);
      topBoard.castShadow = true;
      cGroup.add(body, topBoard);
      roomGroup.add(cGroup);
    } else {
      const isWall = sh >= H - 10;
      const isPillar = kind === "pillar";
      const stMat = new THREE.MeshStandardMaterial({
        color: st.color || (isPillar ? "#e5e0d5" : "#ebe6dc"),
        roughness: 0.8,
        transparent: isWall,
        opacity: isWall ? (isPillar ? 0.82 : 0.6) : 1.0,
      });
      const boxGeo = new THREE.BoxGeometry(sw, sh, sd);
      const stMesh = new THREE.Mesh(boxGeo, stMat);
      stMesh.position.set(wx, sh / 2, wz);
      stMesh.castShadow = true;
      stMesh.receiveShadow = true;

      if (isWall || isPillar) {
        const edgeGeo = new THREE.EdgesGeometry(boxGeo);
        const edgeMat = new THREE.LineBasicMaterial({
          color: 0x374151,
          transparent: true,
          opacity: 0.45,
        });
        stMesh.add(new THREE.LineSegments(edgeGeo, edgeMat));
      }

      roomGroup.add(stMesh);
    }
  }

  // 3.6. Zone Labels (LD, 洋室3, モアトリエ)
  for (const zn of room.zones || []) {
    const { wx, wz } = roomToWorld(Number(zn.x || 0), Number(zn.z || 0), W, D);
    const sp = makeLabelSprite(zn.name, "rgba(30, 41, 59, 0.75)", "#93c5fd");
    sp.position.set(wx, 10, wz);
    helperGroup.add(sp);
  }

  // 4. Compass direction labels
  const pad = 28;
  const lblN = makeLabelSprite(`N 北 (${W}cm)`);
  lblN.position.set(0, 12, -D / 2 - pad);
  const lblS = makeLabelSprite("S 南");
  lblS.position.set(0, 12, D / 2 + pad);
  const lblW = makeLabelSprite(`W 西 (${D}cm)`);
  lblW.position.set(-W / 2 - pad - 15, 12, 0);
  const lblE = makeLabelSprite("E 東");
  lblE.position.set(W / 2 + pad + 15, 12, 0);
  helperGroup.add(lblN, lblS, lblW, lblE);
}

// --- Procedural 3D Furniture Builder ---
function createFurnitureMesh(item) {
  const g = new THREE.Group();
  const W = Number(item.width || 80);
  const D = Number(item.depth || 50);
  const H = Number(item.height || 70);
  const ftype = item.type || "box";

  const mainMat = new THREE.MeshStandardMaterial({
    color: item.color || "#dfc196",
    roughness: 0.72,
  });
  const subMat = new THREE.MeshStandardMaterial({
    color: item.subColor || "#8fa39a",
    roughness: 0.8,
  });
  const whiteMat = new THREE.MeshStandardMaterial({ color: "#f9f8f6", roughness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: "#222428", roughness: 0.4, metalness: 0.3 });

  const addBox = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = ftype !== "rug";
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  if (ftype === "bed") {
    // Frame (15cm for low beds) + Headboard + Mattress + Blanket + Pillows
    const isLow = H <= 36;
    const frameH = isLow ? 15 : Math.min(20, H * 0.42);
    const headH = isLow ? H + 15 : H + 32;
    addBox(W, frameH, D, 0, frameH / 2, 0, mainMat);
    addBox(W, headH, 7, 0, headH / 2, -D / 2 + 3.5, mainMat);
    const matH = Math.max(14, H - frameH);
    addBox(W - 4, matH, D - 10, 0, frameH + matH / 2, 3, whiteMat);
    // Blanket on lower 65%
    addBox(W - 2, matH + 2, D * 0.62, 0, frameH + matH / 2 + 1, D * 0.16, subMat);
    // Pillows
    const pCount = W >= 115 ? 2 : 1;
    const pW = pCount === 2 ? W * 0.38 : W * 0.55;
    for (let i = 0; i < pCount; i++) {
      const px = pCount === 2 ? (i === 0 ? -W * 0.22 : W * 0.22) : 0;
      addBox(pW, 8, 28, px, frameH + matH + 4, -D / 2 + 24, whiteMat);
    }
  } else if (ftype === "baby_crib") {
    // Baby Crib: 4 caster legs + elevated mattress platform (y=46) + 4-sided slatted rails up to H
    const bedY = Math.round(H * 0.48);
    // 4 Corner Posts from floor to H
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBox(4, H, 4, sx * (W / 2 - 2), H / 2, sz * (D / 2 - 2), mainMat);
      }
    }
    // Mattress base & white baby mattress
    addBox(W - 4, 4, D - 4, 0, bedY, 0, mainMat);
    addBox(W - 8, 8, D - 8, 0, bedY + 6, 0, whiteMat);
    addBox(W * 0.45, 5, D * 0.35, 0, bedY + 11, -D * 0.22, subMat);
    // Top & bottom crib rails
    const railT = 3;
    for (const ry of [bedY, H - 2]) {
      addBox(W, railT, railT, 0, ry, -D / 2 + 2, mainMat);
      addBox(W, railT, railT, 0, ry, D / 2 - 2, mainMat);
      addBox(railT, railT, D, -W / 2 + 2, ry, 0, mainMat);
      addBox(railT, railT, D, W / 2 - 2, ry, 0, mainMat);
    }
    // Vertical crib bars
    const railH = H - bedY;
    const railMidY = bedY + railH / 2;
    for (let x = -W / 2 + 11; x <= W / 2 - 11; x += 11) {
      addBox(1.5, railH, 1.5, x, railMidY, -D / 2 + 2, mainMat);
      addBox(1.5, railH, 1.5, x, railMidY, D / 2 - 2, mainMat);
    }
    for (let z = -D / 2 + 11; z <= D / 2 - 11; z += 11) {
      addBox(1.5, railH, 1.5, -W / 2 + 2, railMidY, z, mainMat);
      addBox(1.5, railH, 1.5, W / 2 - 2, railMidY, z, mainMat);
    }
  } else if (ftype === "sofa") {
    const legH = 10;
    const seatH = 26;
    const armW = Math.min(14, W * 0.12);
    const backD = 16;
    // 4 legs
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBox(5, legH, 5, sx * (W / 2 - 6), legH / 2, sz * (D / 2 - 6), subMat);
      }
    }
    // Seat base
    addBox(W, seatH, D, 0, legH + seatH / 2, 0, mainMat);
    // Backrest (on North/-Z side)
    addBox(W, H - legH, backD, 0, legH + (H - legH) / 2, -D / 2 + backD / 2, mainMat);
    // Left & Right Armrests
    const armH = Math.min(H - legH - 12, 46);
    addBox(armW, armH, D, -W / 2 + armW / 2, legH + armH / 2, 0, mainMat);
    addBox(armW, armH, D, W / 2 - armW / 2, legH + armH / 2, 0, mainMat);
  } else if (ftype === "desk" || ftype === "dining_table" || ftype === "low_table" || ftype === "side_table") {
    const topT = 4;
    addBox(W, topT, D, 0, H - topT / 2, 0, mainMat);
    const legT = ftype === "low_table" ? 4 : 5;
    const inset = 5;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBox(legT, H - topT, legT, sx * (W / 2 - inset), (H - topT) / 2, sz * (D / 2 - inset), subMat);
      }
    }
    if (ftype === "desk") {
      // Monitor on desk
      addBox(48, 28, 3, 0, H + 20, -D / 2 + 12, darkMat);
      addBox(12, 8, 10, 0, H + 4, -D / 2 + 12, darkMat);
    }
  } else if (ftype === "standing_desk") {
    // FLEXISPOT E9 (120x60cm, height adjustable 73..123cm, 1 drawer) + Ultrawide Monitor
    const topT = 3.5;
    // Tabletop
    addBox(W, topT, D, 0, H - topT / 2, 0, mainMat);
    // Integrated front drawer (1 drawer under center) & digital height controller on right
    addBox(W * 0.48, 5, D * 0.65, 0, H - topT - 2.5, 2, subMat);
    addBox(11, 2.2, 5, W / 2 - 18, H - topT - 1.1, D / 2 - 2, darkMat);

    // T-shaped dual-motor lifting legs (left & right)
    const legX = W / 2 - 12;
    for (const sx of [-1, 1]) {
      // Bottom foot bar (56cm deep)
      addBox(7, 3.5, D - 4, sx * legX, 1.75, 0, subMat);
      // Lower outer column & upper telescoping inner column
      addBox(7, (H - topT) * 0.58, 7, sx * legX, (H - topT) * 0.29, 0, subMat);
      addBox(5.5, (H - topT) * 0.55, 5.5, sx * legX, (H - topT) * 0.72, 0, subMat);
    }

    // 34-38 inch Ultrawide Display (21:9 aspect ratio: ~82cm wide x 36cm high)
    const uwW = Math.min(W * 0.72, 84);
    const uwH = 36;
    const screenMat = new THREE.MeshStandardMaterial({
      color: "#111318",
      roughness: 0.18,
      metalness: 0.6,
    });
    // Monitor arm/stand at back (-Z)
    addBox(6, 18, 6, 0, H + 9, -D / 2 + 8, darkMat);
    addBox(uwW, uwH, 3, 0, H + 12 + uwH / 2, -D / 2 + 12, darkMat);
    addBox(uwW - 2, uwH - 2, 3.3, 0, H + 12 + uwH / 2, -D / 2 + 12.3, screenMat);
    // Keyboard on desk
    addBox(34, 1.2, 12, 0, H + 0.6, 8, darkMat);
  } else if (ftype === "balance_ball") {
    // 65cm Balance Ball (sphere + subtle stability ring at base)
    const r = Math.min(W, D, H) / 2;
    const ballMat = new THREE.MeshStandardMaterial({
      color: item.color || "#8fa39a",
      roughness: 0.55,
      metalness: 0.05,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 24), ballMat);
    sphere.scale.set(1.0, 0.94, 1.0); // slight compression from sitting/resting on floor
    sphere.position.set(0, r * 0.94, 0);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    g.add(sphere);
  } else if (ftype === "round_table") {
    const radius = Math.min(W, D) / 2;
    const topMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 4, 32), mainMat);
    topMesh.position.set(0, H - 2, 0);
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    g.add(topMesh);

    const poleMesh = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, H - 4, 16), subMat);
    poleMesh.position.set(0, (H - 4) / 2, 0);
    poleMesh.castShadow = true;
    g.add(poleMesh);

    const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, 2, 24), subMat);
    baseMesh.position.set(0, 1, 0);
    g.add(baseMesh);
  } else if (ftype === "bench") {
    // Backless dining bench: wooden frame + 4 legs + upholstered seat pad
    const legH = H - 8;
    addBox(W, 4, D, 0, legH, 0, mainMat);
    addBox(W - 2, 5, D - 2, 0, legH + 4.5, 0, subMat);
    const legT = 4.5;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBox(legT, legH, legT, sx * (W / 2 - 5), legH / 2, sz * (D / 2 - 4), mainMat);
      }
    }
  } else if (ftype === "chair" || ftype === "office_chair") {
    const seatY = 43;
    addBox(W * 0.85, 5, D * 0.85, 0, seatY, 0, mainMat);
    addBox(W * 0.82, H - seatY, 5, 0, seatY + (H - seatY) / 2, -D * 0.38, mainMat);
    if (ftype === "office_chair") {
      addBox(5, seatY - 6, 5, 0, (seatY - 6) / 2 + 4, 0, subMat);
      addBox(W * 0.75, 4, 5, 0, 4, 0, subMat);
      addBox(5, 4, D * 0.75, 0, 4, 0, subMat);
    } else {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          addBox(3.5, seatY, 3.5, sx * (W * 0.36), seatY / 2, sz * (D * 0.36), subMat);
        }
      }
    }
  } else if (ftype === "tv_board") {
    // Lowboard with legs/plinth + drawer/door front details
    const legH = 10;
    const bodyH = Math.max(18, H - legH);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBox(4, legH, 4, sx * (W / 2 - 8), legH / 2, sz * (D / 2 - 5), darkMat);
      }
    }
    addBox(W, bodyH, D, 0, legH + bodyH / 2, 0, mainMat);
    // Front panel division lines (3 sections)
    addBox(1.5, bodyH - 4, 2, -W / 6, legH + bodyH / 2, D / 2 + 0.3, darkMat);
    addBox(1.5, bodyH - 4, 2, W / 6, legH + bodyH / 2, D / 2 + 0.3, darkMat);

    // TV Screen on top (16:9 exact size from tvInch, default 56 inch -> 125x71cm)
    const tvInch = Number(item.tvInch || 56);
    const tvW = Math.round(tvInch * 2.54 * 0.871); // 56" -> 124cm
    const tvH = Math.round(tvInch * 2.54 * 0.490); // 56" -> 70cm
    const screenMat = new THREE.MeshStandardMaterial({
      color: "#111318",
      roughness: 0.18,
      metalness: 0.6,
    });
    // TV panel & stand
    addBox(tvW + 2, tvH + 2, 3.5, 0, H + tvH / 2 + 6, 0, darkMat);
    addBox(tvW - 1, tvH - 1, 4.0, 0, H + tvH / 2 + 6, 0.3, screenMat);
    addBox(28, 6, 18, 0, H + 3, 0, darkMat);
  } else if (ftype === "bookshelf") {
    // Side panels & shelves
    addBox(3, H, D, -W / 2 + 1.5, H / 2, 0, mainMat);
    addBox(3, H, D, W / 2 - 1.5, H / 2, 0, mainMat);
    const shelves = Math.max(3, Math.round(H / 34));
    for (let i = 0; i <= shelves; i++) {
      const sy = (i / shelves) * (H - 4) + 2;
      addBox(W, 3, D, 0, sy, 0, mainMat);
      if (i < shelves && i % 2 === 1) {
        addBox(W * 0.35, 22, D * 0.7, -W * 0.2, sy + 12.5, 0, subMat);
      }
    }
  } else if (ftype === "wardrobe") {
    addBox(W, H, D, 0, H / 2, 0, mainMat);
    // Door split line & handles
    addBox(1.5, H - 8, 2, 0, H / 2, D / 2 + 0.5, subMat);
    addBox(2, 22, 3, -6, H * 0.52, D / 2 + 1.5, subMat);
    addBox(2, 22, 3, 6, H * 0.52, D / 2 + 1.5, subMat);
  } else if (ftype === "rug" || ftype === "rug_round") {
    if (ftype === "rug_round") {
      const r = Math.min(W, D) / 2;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.5, 36), mainMat);
      m.position.set(0, 0.8, 0);
      m.receiveShadow = true;
      g.add(m);
    } else {
      addBox(W, 1.5, D, 0, 0.8, 0, mainMat);
    }
  } else if (ftype === "plant") {
    const potR = Math.min(W, D) * 0.32;
    const potH = Math.min(34, H * 0.28);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(potR, potR * 0.78, potH, 20), subMat);
    pot.position.set(0, potH / 2, 0);
    pot.castShadow = true;
    g.add(pot);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 3, H * 0.55, 10),
      new THREE.MeshStandardMaterial({ color: "#5c4033" })
    );
    stem.position.set(0, potH + H * 0.25, 0);
    g.add(stem);

    const leafPositions = [
      [0, H * 0.78, 0, potR * 1.35],
      [-potR * 0.55, H * 0.64, potR * 0.35, potR * 0.95],
      [potR * 0.55, H * 0.68, -potR * 0.3, potR * 1.0],
      [0, H * 0.55, -potR * 0.5, potR * 0.85],
    ];
    for (const [lx, ly, lz, lr] of leafPositions) {
      const sp = new THREE.Mesh(new THREE.SphereGeometry(lr, 16, 14), mainMat);
      sp.scale.set(1.1, 0.75, 1.1);
      sp.position.set(lx, ly, lz);
      sp.castShadow = true;
      g.add(sp);
    }
  } else if (ftype === "floor_lamp") {
    const baseR = Math.min(W, D) * 0.4;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(baseR, baseR, 3, 20), subMat);
    base.position.set(0, 1.5, 0);
    g.add(base);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, H - 25, 12), subMat);
    pole.position.set(0, (H - 25) / 2, 0);
    g.add(pole);

    const shadeMat = new THREE.MeshStandardMaterial({
      color: item.color || "#fff6e0",
      emissive: item.color || "#ffe4b5",
      emissiveIntensity: 0.65,
      roughness: 0.4,
    });
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(baseR * 0.7, baseR * 1.05, 26, 24), shadeMat);
    shade.position.set(0, H - 14, 0);
    g.add(shade);

    const pLight = new THREE.PointLight(0xffdfa8, 60, 260, 1.5);
    pLight.position.set(0, H - 16, 0);
    g.add(pLight);
  } else if (ftype === "baby_pen") {
    // Cushioned playmat floor + 4-sided slatted baby fence (see-through bars!)
    addBox(W - 4, 2.5, D - 4, 0, 1.25, 0, subMat);
    const railT = 3.5;
    // Top & bottom rails on all 4 sides
    for (const ry of [6, H - 2]) {
      addBox(W, railT, railT, 0, ry, -D / 2 + railT / 2, mainMat);
      addBox(W, railT, railT, 0, ry, D / 2 - railT / 2, mainMat);
      addBox(railT, railT, D, -W / 2 + railT / 2, ry, 0, mainMat);
      addBox(railT, railT, D, W / 2 - railT / 2, ry, 0, mainMat);
    }
    // Corner posts
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBox(4.5, H, 4.5, sx * (W / 2 - 2.25), H / 2, sz * (D / 2 - 2.25), mainMat);
      }
    }
    // Vertical slats around perimeter (every ~12cm so sightline passes through!)
    const step = 12;
    for (let x = -W / 2 + step; x <= W / 2 - step; x += step) {
      addBox(1.8, H - 8, 1.8, x, H / 2, -D / 2 + railT / 2, mainMat);
      addBox(1.8, H - 8, 1.8, x, H / 2, D / 2 - railT / 2, mainMat);
    }
    for (let z = -D / 2 + step; z <= D / 2 - step; z += step) {
      addBox(1.8, H - 8, 1.8, -W / 2 + railT / 2, H / 2, z, mainMat);
      addBox(1.8, H - 8, 1.8, W / 2 - railT / 2, H / 2, z, mainMat);
    }
  } else if (ftype === "kitchen_cabinet") {
    // unico DIX W800 style: Walnut body + Stainless steel top + Slide shelf niche + Black handles
    const stainlessMat = new THREE.MeshStandardMaterial({
      color: item.subColor || "#d1d5db",
      roughness: 0.25,
      metalness: 0.75,
    });
    // Walnut cabinet body
    addBox(W, H - 3, D, 0, (H - 3) / 2, 0, mainMat);
    // Stainless steel top plate (3cm)
    addBox(W + 0.6, 3, D + 0.6, 0, H - 1.5, 0, stainlessMat);
    // Slide shelf recess indicator & drawer lines on front (+Z face)
    addBox(W * 0.44, 26, 2, -W * 0.24, H - 22, D / 2 + 0.3, darkMat);
    addBox(W * 0.88, 1.5, 1.5, 0, H * 0.46, D / 2 + 0.4, darkMat);
    // Black iron handles
    addBox(W * 0.35, 1.8, 2.5, -W * 0.24, H * 0.40, D / 2 + 1.2, darkMat);
    addBox(W * 0.35, 1.8, 2.5, W * 0.24, H * 0.78, D / 2 + 1.2, darkMat);
  } else {
    addBox(W, H, D, 0, H / 2, 0, mainMat);
  }

  // Front direction indicator arrow (subtle triangle on top/floor when selected)
  const outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(W + 2, H + 1, D + 2));
  const outlineMat = new THREE.LineBasicMaterial({
    color: 0x60a5fa,
    transparent: true,
    opacity: 0.0,
  });
  const outline = new THREE.LineSegments(outlineGeo, outlineMat);
  outline.position.set(0, H / 2, 0);
  outline.name = "selection_outline";
  g.add(outline);

  g.userData.itemId = item.id;
  return g;
}

function renderSceneFromState() {
  if (!appState) return;
  const room = appState.room || {};
  const W = Number(room.width || 352);
  const D = Number(room.depth || 264);

  buildRoomMesh(room);

  furnitureGroup.clear();
  furnitureMeshes.clear();

  // Collect error item IDs for visual highlight
  const errorIds = new Set();
  if (lastAnalysis && lastAnalysis.issues) {
    for (const iss of lastAnalysis.issues) {
      if (iss.item_id) errorIds.add(iss.item_id);
      if (iss.item_ids) iss.item_ids.forEach((id) => errorIds.add(id));
    }
  }

  for (const item of appState.furniture || []) {
    const mesh = createFurnitureMesh(item);
    const { wx, wz } = roomToWorld(Number(item.x || 0), Number(item.z || 0), W, D);
    mesh.position.set(wx, 0, wz);
    // Clockwise rotation in degrees from top view -> Three.js -Y rotation in radians
    mesh.rotation.y = -THREE.MathUtils.degToRad(Number(item.rotation || 0));

    const outline = mesh.getObjectByName("selection_outline");
    if (outline) {
      if (errorIds.has(item.id)) {
        outline.material.color.setHex(0xf87171);
        outline.material.opacity = 0.95;
      } else if (item.id === selectedItemId) {
        outline.material.color.setHex(0x60a5fa);
        outline.material.opacity = 0.95;
      } else {
        outline.material.opacity = 0.0;
      }
    }

    furnitureGroup.add(mesh);
    furnitureMeshes.set(item.id, mesh);
  }

  updateUI();
}

// --- Mode Management ---
function setInteractionMode(mode) {
  interactionMode = mode;
  document.getElementById("btn-mode-camera").classList.toggle("active", mode === "camera");
  document.getElementById("btn-mode-edit").classList.toggle("active", mode === "edit");

  const hintEl = document.getElementById("mode-hint");
  if (mode === "camera") {
    selectedItemId = null;
    hintEl.textContent =
      "📷 視点操作モード: ドラッグで回転・右ドラッグで平行移動・ホイールでズーム ｜ [E] キーで「✋ 家具移動」に切替";
  } else {
    hintEl.textContent =
      "✋ 家具移動モード: 家具をクリックして選択・ドラッグで移動 (5cmスナップ) ｜ [R] 90°回転 ｜ [Delete] 削除 ｜ [E] 視点操作へ戻る";
  }
  renderSceneFromState();
}

// --- Popover Management ---
function togglePopover(popId) {
  const allPops = ["pop-catalog", "pop-room", "pop-diag"];
  for (const id of allPops) {
    const el = document.getElementById(id);
    if (id === popId) {
      el.classList.toggle("open");
    } else {
      el.classList.remove("open");
    }
  }
}

function closeAllPopovers() {
  for (const id of ["pop-catalog", "pop-room", "pop-diag"]) {
    document.getElementById(id)?.classList.remove("open");
  }
}

// --- UI Sync ---
function updateUI() {
  if (!appState) return;
  const room = appState.room;

  document.getElementById("room-width").value = room.width;
  document.getElementById("room-depth").value = room.depth;
  document.getElementById("room-height").value = room.height;
  document.getElementById("room-floor-type").value = room.floorType || "oak";
  document.getElementById("room-lighting").value = room.lighting || "daylight";

  // Room Selector Dropdown
  const roomSelectEl = document.getElementById("room-select");
  if (roomSelectEl) {
    roomSelectEl.innerHTML = "";
    for (const r of savedRooms) {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = `${r.name} (${r.width}×${r.depth}cm / ${r.furnitureCount}点)`;
      if (r.id === activeRoomId) opt.selected = true;
      roomSelectEl.appendChild(opt);
    }
  }

  // Diagnostics Notification Badge & Popover Content
  const diagBox = document.getElementById("diagnostics-box");
  const badgeEl = document.getElementById("diag-badge");
  const covLabel = document.getElementById("coverage-label");
  diagBox.innerHTML = "";

  if (lastAnalysis) {
    covLabel.textContent = `床面積占有率: ${lastAnalysis.floor_coverage_pct}% — ${lastAnalysis.coverage_evaluation}`;
    const issues = lastAnalysis.issues || [];
    const warnings = lastAnalysis.warnings || [];

    badgeEl.className = "badge-pill";
    if (issues.length > 0) {
      badgeEl.classList.add("badge-err");
      badgeEl.textContent = `⚠️ ${issues.length}`;
    } else if (warnings.length > 0) {
      badgeEl.classList.add("badge-warn");
      badgeEl.textContent = `💡 ${warnings.length}`;
    } else {
      badgeEl.classList.add("badge-ok");
      badgeEl.textContent = "OK";
    }

    if (issues.length === 0 && warnings.length === 0) {
      const ok = document.createElement("div");
      ok.className = "diag-ok";
      ok.textContent = "✓ 干渉・動線エラーなし (良好)";
      diagBox.appendChild(ok);
    } else {
      for (const iss of issues) {
        const d = document.createElement("div");
        d.className = "diag-issue error";
        d.textContent = `⚠️ ${iss.message}`;
        diagBox.appendChild(d);
      }
      for (const w of warnings) {
        const d = document.createElement("div");
        d.className = "diag-issue warning";
        d.textContent = `💡 ${w.message}`;
        diagBox.appendChild(d);
      }
    }
  }

  // Floating Inspector (Only visible in Edit Mode when an item is selected)
  const inspSec = document.getElementById("inspector-section");
  const selItem = interactionMode === "edit"
    ? (appState.furniture || []).find((i) => i.id === selectedItemId)
    : null;
  if (!selItem) {
    inspSec.style.display = "none";
  } else {
    inspSec.style.display = "block";
    document.getElementById("insp-name").value = selItem.name || "";
    document.getElementById("insp-x").value = Math.round(selItem.x);
    document.getElementById("insp-z").value = Math.round(selItem.z);
    document.getElementById("insp-rot").value = Math.round(selItem.rotation || 0);
    document.getElementById("insp-w").value = selItem.width;
    document.getElementById("insp-d").value = selItem.depth;
    document.getElementById("insp-h").value = selItem.height;
    document.getElementById("insp-color").value = selItem.color || "#dfc196";
    document.getElementById("insp-subcolor").value = selItem.subColor || "#8fa39a";
  }
}

function selectItem(itemId) {
  selectedItemId = itemId;
  renderSceneFromState();
}

// --- API Helpers ---
function applyPayload(data) {
  if (!data) return;
  if (data.rooms) savedRooms = data.rooms;
  if (data.activeRoomId) activeRoomId = data.activeRoomId;
  if (data.state) {
    appState = data.state;
    lastAnalysis = data.analysis;
    renderSceneFromState();
  }
}

async function callTool(name, args) {
  const res = await fetch("/api/tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
  });
  const data = await res.json();
  applyPayload(data);
  return data;
}

async function saveFullState() {
  const res = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: appState }),
  });
  const data = await res.json();
  applyPayload(data);
}

// --- Raycasting & Dragging on Floor (Only active in "edit" mode) ---
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const planeIntersect = new THREE.Vector3();

function updatePointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  closeAllPopovers();
  if (e.button !== 0) return;

  // In Camera Mode, do not intercept furniture clicks—let OrbitControls handle everything!
  if (interactionMode !== "edit") return;

  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);

  const intersects = raycaster.intersectObjects(furnitureGroup.children, true);
  if (intersects.length > 0) {
    let obj = intersects[0].object;
    while (obj && !obj.userData.itemId && obj.parent) {
      obj = obj.parent;
    }
    if (obj && obj.userData.itemId) {
      selectItem(obj.userData.itemId);
      isDragging = true;
      controls.enabled = false;
      raycaster.ray.intersectPlane(floorPlane, planeIntersect);
      dragOffset.copy(obj.position).sub(planeIntersect);
      return;
    }
  }
  selectItem(null);
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (interactionMode !== "edit" || !isDragging || !selectedItemId || !appState) return;
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.ray.intersectPlane(floorPlane, planeIntersect)) {
    const newPos = planeIntersect.clone().add(dragOffset);
    const W = Number(appState.room.width || 352);
    const D = Number(appState.room.depth || 264);
    let { x, z } = worldToRoom(newPos.x, newPos.z, W, D);

    // 5cm snap
    x = Math.round(x / 5) * 5;
    z = Math.round(z / 5) * 5;

    const item = appState.furniture.find((i) => i.id === selectedItemId);
    if (item) {
      item.x = x;
      item.z = z;
      const mesh = furnitureMeshes.get(selectedItemId);
      if (mesh) {
        const { wx, wz } = roomToWorld(x, z, W, D);
        mesh.position.set(wx, 0, wz);
      }
      document.getElementById("insp-x").value = x;
      document.getElementById("insp-z").value = z;
    }
  }
});

window.addEventListener("pointerup", () => {
  if (isDragging) {
    isDragging = false;
    controls.enabled = true;
    saveFullState();
  }
});

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "e" || e.key === "E") {
    setInteractionMode(interactionMode === "camera" ? "edit" : "camera");
    return;
  }
  if (e.key === "Escape") {
    closeAllPopovers();
    selectItem(null);
    return;
  }
  if (interactionMode !== "edit" || !selectedItemId || !appState) return;
  if (e.key === "r" || e.key === "R") {
    const item = appState.furniture.find((i) => i.id === selectedItemId);
    if (item) {
      item.rotation = ((Number(item.rotation || 0) + 90) % 360);
      saveFullState();
    }
  } else if (e.key === "Delete" || e.key === "Backspace") {
    callTool("remove_furniture", { id: selectedItemId });
    selectedItemId = null;
  }
});

// --- UI Event Listeners ---
document.getElementById("btn-mode-camera").addEventListener("click", () => setInteractionMode("camera"));
document.getElementById("btn-mode-edit").addEventListener("click", () => setInteractionMode("edit"));

document.getElementById("btn-pop-catalog").addEventListener("click", () => togglePopover("pop-catalog"));
document.getElementById("btn-pop-room").addEventListener("click", () => togglePopover("pop-room"));
document.getElementById("btn-pop-diag").addEventListener("click", () => togglePopover("pop-diag"));

document.querySelectorAll(".close-btn[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => document.getElementById(btn.dataset.close)?.classList.remove("open"));
});

document.getElementById("btn-close-inspector").addEventListener("click", () => selectItem(null));

document.getElementById("room-select").addEventListener("change", (e) => {
  selectedItemId = null;
  callTool("switch_room", { room_id: e.target.value });
});

document.getElementById("btn-view-3d").addEventListener("click", (e) => {
  setActiveViewBtn(e.target);
  camera.position.set(220, 420, 480);
  controls.target.set(0, 40, 0);
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
});

document.getElementById("btn-view-2d").addEventListener("click", (e) => {
  setActiveViewBtn(e.target);
  camera.position.set(0, 680, 1);
  controls.target.set(0, 0, 0);
});

let eyeViewIndex = 0;
document.getElementById("btn-view-eye").addEventListener("click", (e) => {
  setActiveViewBtn(e.target);
  const W = Number(appState?.room?.width || 600);
  const D = Number(appState?.room?.depth || 714);

  // Check if this room has a kitchen_system structure to stand behind
  const kitchenSt = (appState?.room?.structures || []).find((s) => s.kind === "kitchen_system");
  if (kitchenSt && eyeViewIndex % 2 === 0) {
    // 1. Standing at the kitchen sink/faucet looking South across the counter into LD
    const { wx, wz } = roomToWorld(Number(kitchenSt.x) + 35, Number(kitchenSt.z) - 55, W, D);
    camera.position.set(wx, 155, wz);
    controls.target.set(wx - 20, 100, D / 2 - 80);
    document.getElementById("mode-hint").textContent =
      "👁️ キッチン水栓からの目線 (高さ155cm) ｜ もう一度「目線」を押すとバルコニー側からの目線に切替";
  } else {
    // 2. Standing near South balcony looking North toward Dinning & Kitchen Counter
    camera.position.set(-W * 0.15, 150, D / 2 - 35);
    controls.target.set(-W * 0.15, 110, -D / 4);
    document.getElementById("mode-hint").textContent =
      "👁️ バルコニー側からの室内目線 (高さ150cm) ｜ もう一度「目線」を押すとキッチン水栓からの目線に切替";
  }
  eyeViewIndex++;
});

function setActiveViewBtn(activeEl) {
  for (const id of ["btn-view-3d", "btn-view-2d", "btn-view-eye"]) {
    document.getElementById(id).classList.remove("active");
  }
  activeEl.classList.add("active");
}

document.getElementById("btn-toggle-walls").addEventListener("click", (e) => {
  autoCutawayWalls = !autoCutawayWalls;
  e.target.classList.toggle("active", autoCutawayWalls);
});

document.getElementById("btn-clear-furniture").addEventListener("click", () => {
  if (!confirm("現在表示中の部屋の家具をすべてクリアしますか？（他の部屋のレイアウトには影響しません）")) return;
  selectedItemId = null;
  callTool("remove_furniture", { id: "all" });
});

document.getElementById("btn-new-room").addEventListener("click", async () => {
  const name = prompt("新しい部屋の名前を入力してください:", "新規ルーム");
  if (!name) return;
  const dims = prompt("幅(cm) × 奥行(cm) をカンマまたはx区切りで入力してください:", "360,270");
  if (!dims) return;
  const parts = dims.split(/[x×,\s]+/).map(Number);
  const w = parts[0] || 360;
  const d = parts[1] || 270;
  const roomId = "room_" + Date.now().toString(36);
  selectedItemId = null;
  await callTool("create_room", { room_id: roomId, name, width: w, depth: d, height: 240, activate: true });
});

// Room dimension & finish changes
for (const [id, key] of [
  ["room-width", "width"],
  ["room-depth", "depth"],
  ["room-height", "height"],
]) {
  document.getElementById(id).addEventListener("change", (e) => {
    callTool("set_room_config", { [key]: Number(e.target.value) });
  });
}

document.getElementById("room-floor-type").addEventListener("change", (e) => {
  callTool("set_room_config", { floorType: e.target.value });
});
document.getElementById("room-lighting").addEventListener("change", (e) => {
  callTool("set_room_config", { lighting: e.target.value });
});

// Inspector inputs
for (const [id, field, isNum] of [
  ["insp-name", "name", false],
  ["insp-x", "x", true],
  ["insp-z", "z", true],
  ["insp-rot", "rotation", true],
  ["insp-w", "width", true],
  ["insp-d", "depth", true],
  ["insp-h", "height", true],
  ["insp-color", "color", false],
  ["insp-subcolor", "subColor", false],
]) {
  document.getElementById(id).addEventListener("change", (e) => {
    if (!selectedItemId) return;
    const val = isNum ? Number(e.target.value) : e.target.value;
    callTool("update_furniture", { id: selectedItemId, [field]: val });
  });
}

document.getElementById("btn-rot-left").addEventListener("click", () => {
  const item = appState?.furniture?.find((i) => i.id === selectedItemId);
  if (item) callTool("update_furniture", { id: selectedItemId, rotation: (Number(item.rotation || 0) + 315) % 360 });
});
document.getElementById("btn-rot-right").addEventListener("click", () => {
  const item = appState?.furniture?.find((i) => i.id === selectedItemId);
  if (item) callTool("update_furniture", { id: selectedItemId, rotation: (Number(item.rotation || 0) + 90) % 360 });
});

document.querySelectorAll(".wall-snap-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!selectedItemId) return;
    callTool("update_furniture", { id: selectedItemId, wall: btn.dataset.wall, align: "center" });
  });
});

document.getElementById("btn-delete-item").addEventListener("click", () => {
  if (!selectedItemId) return;
  callTool("remove_furniture", { id: selectedItemId });
  selectedItemId = null;
});

// --- Initialize Catalog & SSE Live Stream ---
async function init() {
  const catRes = await fetch("/api/catalog");
  catalogData = await catRes.json();

  // Style theme buttons
  const thContainer = document.getElementById("theme-buttons");
  for (const [key, t] of Object.entries(catalogData.style_themes)) {
    const btn = document.createElement("button");
    btn.textContent = t.name.split(" (")[0];
    btn.addEventListener("click", () => callTool("apply_style_theme", { theme: key, recolor_furniture: true }));
    thContainer.appendChild(btn);
  }

  // Furniture catalog buttons
  const catContainer = document.getElementById("catalog-buttons");
  for (const [key, f] of Object.entries(catalogData.furniture_catalog)) {
    const btn = document.createElement("button");
    btn.className = "catalog-item";
    btn.innerHTML = `<span class="name">+ ${f.name}</span><span class="dims">${f.width}×${f.depth}×${f.height}cm</span>`;
    btn.addEventListener("click", async () => {
      closeAllPopovers();
      setInteractionMode("edit");
      const data = await callTool("add_furniture", { preset: key });
      if (data?.result?.item?.id) {
        selectItem(data.result.item.id);
      }
    });
    catContainer.appendChild(btn);
  }

  // Initial state load
  const stRes = await fetch("/api/state");
  const stData = await stRes.json();
  applyPayload(stData);

  // Subscribe to Server-Sent Events for real-time MCP updates
  const evtSource = new EventSource("/events");
  evtSource.onmessage = (event) => {
    if (isDragging) return;
    const payload = JSON.parse(event.data);
    applyPayload(payload);
  };
}

// Animation Loop & Auto Wall Cutaway
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // Make walls facing camera semi-transparent so interior is always visible
  if (wallMeshes.north) {
    const camPos = camera.position;
    const rules = {
      north: camPos.z < -80,
      south: camPos.z > 80,
      west: camPos.x < -80,
      east: camPos.x > 80,
    };
    for (const [dir, mesh] of Object.entries(wallMeshes)) {
      mesh.material.opacity = autoCutawayWalls && rules[dir] ? 0.12 : 1.0;
    }
  }

  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
animate();
