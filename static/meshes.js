import * as THREE from "three";

// Floor Texture Generator
export function createFloorTexture(floorType, baseHex) {
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
export function makeLabelSprite(text, bgColor = "rgba(20, 24, 32, 0.85)", textColor = "#ffffff") {
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

export function roomToWorld(x, z, roomW, roomD) {
  return { wx: x - roomW / 2, wz: z - roomD / 2 };
}

export function worldToRoom(wx, wz, roomW, roomD) {
  return { x: wx + roomW / 2, z: wz + roomD / 2 };
}

export function buildRoomGeometry(room, roomGroup, helperGroup, wallMeshes) {
  roomGroup.clear();
  helperGroup.clear();
  for (const k of Object.keys(wallMeshes)) delete wallMeshes[k];

  const W = Number(room.width || 352);
  const D = Number(room.depth || 264);
  const H = Number(room.height || 240);
  const wallT = 8;

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

  // 3.5. Internal Structures (Kitchen System, Counter, Partition Walls, Pillars, Built-in Closets)
  for (const st of room.structures || []) {
    const sw = Number(st.width || 50);
    const sd = Number(st.depth || 30);
    const sh = Number(st.height || 200);
    const kind = st.kind || (sh >= H - 10 ? "wall" : "box");
    const { wx, wz } = roomToWorld(Number(st.x || 0), Number(st.z || 0), W, D);

    if (kind === "kitchen_system") {
      const kGroup = new THREE.Group();
      kGroup.position.set(wx, 0, wz);
      kGroup.rotation.y = (-Number(st.rotation || 0) * Math.PI) / 180;

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

      // Proportional stove & sink layout supporting `st.sinkSide` ("east"/"right" default, or "west"/"left")
      const sinkOnWest = st.sinkSide === "west" || st.sinkSide === "left";
      const sideSign = sinkOnWest ? -1 : 1;
      const stoveW = Math.min(58, sw * 0.28);
      const stoveD = Math.min(42, sd * 0.65);
      const stoveX = -sideSign * (sw / 2 - stoveW / 2 - Math.max(8, sw * 0.06));
      const stove = new THREE.Mesh(new THREE.BoxGeometry(stoveW, 1.5, stoveD), darkMat);
      stove.position.set(stoveX, sh + 0.5, 0);
      kGroup.add(stove);

      const sinkW = Math.min(72, sw * 0.35);
      const sinkD = Math.min(44, sd * 0.68);
      const sinkX = sideSign * (sw / 2 - sinkW / 2 - Math.max(10, sw * 0.07));
      const sink = new THREE.Mesh(new THREE.BoxGeometry(sinkW, 2, sinkD), metalMat);
      sink.position.set(sinkX, sh + 0.3, 2);
      kGroup.add(sink);

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
      cGroup.rotation.y = (-Number(st.rotation || 0) * Math.PI) / 180;
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

  // 3.6. Zone Labels
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
export function createFurnitureMesh(item) {
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
    const isLow = H <= 36;
    const frameH = isLow ? 15 : Math.min(20, H * 0.42);
    const headH = isLow ? H + 15 : H + 32;
    addBox(W, frameH, D, 0, frameH / 2, 0, mainMat);
    addBox(W, headH, 7, 0, headH / 2, -D / 2 + 3.5, mainMat);
    const matH = Math.max(14, H - frameH);
    addBox(W - 4, matH, D - 10, 0, frameH + matH / 2, 3, whiteMat);
    addBox(W - 2, matH + 2, D * 0.62, 0, frameH + matH / 2 + 1, D * 0.16, subMat);
    const pCount = W >= 115 ? 2 : 1;
    const pW = pCount === 2 ? W * 0.38 : W * 0.55;
    for (let i = 0; i < pCount; i++) {
      const px = pCount === 2 ? (i === 0 ? -W * 0.22 : W * 0.22) : 0;
      addBox(pW, 8, 28, px, frameH + matH + 4, -D / 2 + 24, whiteMat);
    }
  } else if (ftype === "baby_crib") {
    const bedY = Math.round(H * 0.48);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBox(4, H, 4, sx * (W / 2 - 2), H / 2, sz * (D / 2 - 2), mainMat);
      }
    }
    addBox(W - 4, 4, D - 4, 0, bedY, 0, mainMat);
    addBox(W - 8, 8, D - 8, 0, bedY + 6, 0, whiteMat);
    addBox(W * 0.45, 5, D * 0.35, 0, bedY + 11, -D * 0.22, subMat);
    const railT = 3;
    for (const ry of [bedY, H - 2]) {
      addBox(W, railT, railT, 0, ry, -D / 2 + 2, mainMat);
      addBox(W, railT, railT, 0, ry, D / 2 - 2, mainMat);
      addBox(railT, railT, D, -W / 2 + 2, ry, 0, mainMat);
      addBox(railT, railT, D, W / 2 - 2, ry, 0, mainMat);
    }
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
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBox(5, legH, 5, sx * (W / 2 - 6), legH / 2, sz * (D / 2 - 6), subMat);
      }
    }
    addBox(W, seatH, D, 0, legH + seatH / 2, 0, mainMat);
    addBox(W, H - legH, backD, 0, legH + (H - legH) / 2, -D / 2 + backD / 2, mainMat);
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
      addBox(48, 28, 3, 0, H + 20, -D / 2 + 12, darkMat);
      addBox(12, 8, 10, 0, H + 4, -D / 2 + 12, darkMat);
    }
  } else if (ftype === "standing_desk") {
    const topT = 3.5;
    addBox(W, topT, D, 0, H - topT / 2, 0, mainMat);
    addBox(W * 0.48, 5, D * 0.65, 0, H - topT - 2.5, 2, subMat);
    addBox(11, 2.2, 5, W / 2 - 18, H - topT - 1.1, D / 2 - 2, darkMat);

    const legX = W / 2 - 12;
    for (const sx of [-1, 1]) {
      addBox(7, 3.5, D - 4, sx * legX, 1.75, 0, subMat);
      addBox(7, (H - topT) * 0.58, 7, sx * legX, (H - topT) * 0.29, 0, subMat);
      addBox(5.5, (H - topT) * 0.55, 5.5, sx * legX, (H - topT) * 0.72, 0, subMat);
    }

    const monitorMode = item.monitor !== undefined ? item.monitor : "ultrawide";
    if (monitorMode && monitorMode !== "none") {
      const isStandard = monitorMode === "standard";
      const monW = isStandard ? Math.min(W * 0.5, 58) : Math.min(W * 0.72, 84);
      const monH = isStandard ? 34 : 36;
      const screenMat = new THREE.MeshStandardMaterial({
        color: "#111318",
        roughness: 0.18,
        metalness: 0.6,
      });
      addBox(6, 18, 6, 0, H + 9, -D / 2 + 8, darkMat);
      addBox(monW, monH, 3, 0, H + 12 + monH / 2, -D / 2 + 12, darkMat);
      addBox(monW - 2, monH - 2, 3.3, 0, H + 12 + monH / 2, -D / 2 + 12.3, screenMat);
      addBox(34, 1.2, 12, 0, H + 0.6, 8, darkMat);
    }
  } else if (ftype === "balance_ball") {
    const r = Math.min(W, D, H) / 2;
    const ballMat = new THREE.MeshStandardMaterial({
      color: item.color || "#8fa39a",
      roughness: 0.55,
      metalness: 0.05,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 24), ballMat);
    sphere.scale.set(1.0, 0.94, 1.0);
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
    const legH = 10;
    const bodyH = Math.max(18, H - legH);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBox(4, legH, 4, sx * (W / 2 - 8), legH / 2, sz * (D / 2 - 5), darkMat);
      }
    }
    addBox(W, bodyH, D, 0, legH + bodyH / 2, 0, mainMat);
    addBox(1.5, bodyH - 4, 2, -W / 6, legH + bodyH / 2, D / 2 + 0.3, darkMat);
    addBox(1.5, bodyH - 4, 2, W / 6, legH + bodyH / 2, D / 2 + 0.3, darkMat);

    const tvInch =
      item.tvInch !== undefined
        ? Number(item.tvInch)
        : Math.round(Math.min(65, Math.max(32, W * 0.32)));
    if (tvInch > 0) {
      const tvW = Math.round(tvInch * 2.54 * 0.871);
      const tvH = Math.round(tvInch * 2.54 * 0.490);
      const screenMat = new THREE.MeshStandardMaterial({
        color: "#111318",
        roughness: 0.18,
        metalness: 0.6,
      });
      addBox(tvW + 2, tvH + 2, 3.5, 0, H + tvH / 2 + 6, 0, darkMat);
      addBox(tvW - 1, tvH - 1, 4.0, 0, H + tvH / 2 + 6, 0.3, screenMat);
      addBox(28, 6, 18, 0, H + 3, 0, darkMat);
    }
  } else if (ftype === "bookshelf") {
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
    addBox(W - 4, 2.5, D - 4, 0, 1.25, 0, subMat);
    const railT = 3.5;
    for (const ry of [6, H - 2]) {
      addBox(W, railT, railT, 0, ry, -D / 2 + railT / 2, mainMat);
      addBox(W, railT, railT, 0, ry, D / 2 - railT / 2, mainMat);
      addBox(railT, railT, D, -W / 2 + railT / 2, ry, 0, mainMat);
      addBox(railT, railT, D, W / 2 - railT / 2, ry, 0, mainMat);
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBox(4.5, H, 4.5, sx * (W / 2 - 2.25), H / 2, sz * (D / 2 - 2.25), mainMat);
      }
    }
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
    const stainlessMat = new THREE.MeshStandardMaterial({
      color: item.subColor || "#d1d5db",
      roughness: 0.25,
      metalness: 0.75,
    });
    addBox(W, H - 3, D, 0, (H - 3) / 2, 0, mainMat);
    addBox(W + 0.6, 3, D + 0.6, 0, H - 1.5, 0, stainlessMat);
    addBox(W * 0.44, 26, 2, -W * 0.24, H - 22, D / 2 + 0.3, darkMat);
    addBox(W * 0.88, 1.5, 1.5, 0, H * 0.46, D / 2 + 0.4, darkMat);
    addBox(W * 0.35, 1.8, 2.5, -W * 0.24, H * 0.40, D / 2 + 1.2, darkMat);
    addBox(W * 0.35, 1.8, 2.5, W * 0.24, H * 0.78, D / 2 + 1.2, darkMat);
  } else {
    addBox(W, H, D, 0, H / 2, 0, mainMat);
  }

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
