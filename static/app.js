import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  buildRoomGeometry,
  createFurnitureMesh,
  roomToWorld,
  worldToRoom,
} from "./meshes.js";

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
    ambientLight.color.set("#ffffff");
    ambientLight.intensity = 0.75;
    dirLight.color.set("#fffaf0");
    dirLight.intensity = 1.3;
  }
}

function buildRoomMesh(room) {
  applyLightingMood(room.lighting || "daylight");
  buildRoomGeometry(room, roomGroup, helperGroup, wallMeshes);
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
    const nameSpan = document.createElement("span");
    nameSpan.className = "name";
    nameSpan.textContent = `+ ${f.name}`;
    const dimsSpan = document.createElement("span");
    dimsSpan.className = "dims";
    dimsSpan.textContent = `${f.width}×${f.depth}×${f.height}cm`;
    btn.append(nameSpan, dimsSpan);
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
