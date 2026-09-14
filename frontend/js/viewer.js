// ============================================================================
// TARA-3D: TACTICAL DISASTER INTELLIGENCE HUD (NDRF / SDMA / ISRO SPEC)
// ============================================================================

const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050911);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 3000);
camera.position.set(0, -38, 24);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1.0); // Locked 60 FPS performance cap
container.innerHTML = "";
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = true;
controls.maxDistance = 280;
controls.target.set(0, 0, 1.5);

// Tactical Sun & Ambient Illumination
const dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
dirLight.position.set(35, -45, 45);
scene.add(dirLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.65));

let GRID_SIZE = 128;
let geometry = new THREE.PlaneGeometry(50, 50, GRID_SIZE - 1, GRID_SIZE - 1);
let rgbTexture = null;
let minElevation = 890.0;
let maxElevation = 924.2;
let currentBounds = [73.845, 18.510, 73.868, 18.530];
let rawGridMatrix = null;
let currentVisualMode = "satellite";

// Tactical Overlay Groups
const tacticalGroup = new THREE.Group();
scene.add(tacticalGroup);

const measurementGroup = new THREE.Group();
scene.add(measurementGroup);

const standardMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.65,
  metalness: 0.05,
  side: THREE.DoubleSide
});
let terrainMesh = new THREE.Mesh(geometry, standardMaterial);
scene.add(terrainMesh);

// 3D Target Pin Beacon
const pinGroup = new THREE.Group();
const pinStem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.5, 8), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
pinStem.rotation.x = Math.PI / 2;
pinStem.position.z = 1.25;
const pinRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.1, 24), new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide }));
pinGroup.add(pinStem);
pinGroup.add(pinRing);
scene.add(pinGroup);

// ============================================================================
// 1. DYNAMIC DRAWER CONTROLLER (MUTUAL EXCLUSION)
// ============================================================================
function closeAllDrawers() {
  const allDrawers = document.querySelectorAll('.tool-drawer, #measure-drawer, #layers-drawer, #analysis-drawer, #export-drawer');
  allDrawers.forEach(d => {
    if (d) d.style.display = 'none';
  });
  const allBtns = document.querySelectorAll('#sidebar-rail button, .rail-btn, .sidebar-btn');
  allBtns.forEach(b => b.classList.remove('active'));
}

function toggleDrawer(drawerId, btnElement) {
  const drawer = document.getElementById(drawerId);
  if (!drawer) return;
  const isCurrentlyOpen = (drawer.style.display === 'block');
  closeAllDrawers();
  if (!isCurrentlyOpen) {
    drawer.style.display = 'block';
    btnElement?.classList.add('active');
  }
}

// ============================================================================
// 2. URBAN CORRIDOR UAV FLYTHROUGH (STRICTLY ON-SURFACE RECON)
// ============================================================================
let isFlythroughActive = false;
let flythroughProgress = 0.0;
const flythroughDuration = 24.0; // 24s loop

// Contained tightly within [-14, 14] to eliminate off-mesh void viewing
const flightPathCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-12, -14, 6.5),
  new THREE.Vector3(-4, -6, 5.2),
  new THREE.Vector3(8, -10, 6.8),
  new THREE.Vector3(12, 4, 6.0),
  new THREE.Vector3(4, 12, 5.8),
  new THREE.Vector3(-8, 10, 6.4),
  new THREE.Vector3(-12, -2, 5.6),
  new THREE.Vector3(-12, -14, 6.5)
], true);

// Ground target spline to keep camera aimed downward at rooftops
const lookTargetCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-2, -4, 1.5),
  new THREE.Vector3(4, -2, 1.8),
  new THREE.Vector3(6, 4, 1.5),
  new THREE.Vector3(0, 6, 2.0),
  new THREE.Vector3(-4, 4, 1.6),
  new THREE.Vector3(-4, -2, 1.8),
  new THREE.Vector3(-2, -4, 1.5)
], true);

function startUAVFlythrough() {
  closeAllDrawers();
  isFlythroughActive = true;
  flythroughProgress = 0.0;
  controls.enabled = false;

  const tag = document.getElementById('header-loc-name');
  if (tag) tag.innerHTML = `<span style="color:#ef4444; font-weight:700;">● UAV RECON PATROL ACTIVE</span> | Low-Altitude Urban Sweep`;
}

function stopUAVFlythrough() {
  if (!isFlythroughActive) return;
  isFlythroughActive = false;
  controls.enabled = true;
  camera.position.set(0, -38, 24);
  controls.target.set(0, 0, 1.5);

  const tag = document.getElementById('header-loc-name');
  if (tag) tag.textContent = `Pune / Suburban Canopy (GAMUS Benchmark) | EPSG:4326`;
}

// ============================================================================
// 3. ANALYTIC SHADERS (DSM HEATMAP, SLOPE TRIAGE, WIREFRAME SHADOW)
// ============================================================================
function turboColormap(t) {
  const r = Math.round(255 * Math.max(0, Math.sin(t * Math.PI - 0.2)));
  const g = Math.round(255 * Math.max(0, Math.sin(t * Math.PI * 0.9 + 0.2)));
  const b = Math.round(255 * Math.max(0, Math.cos(t * Math.PI * 0.8)));
  return [r, g, b];
}

function generateHeatmapTexture(grid) {
  const canvas = document.createElement('canvas');
  canvas.width = GRID_SIZE;
  canvas.height = GRID_SIZE;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(GRID_SIZE, GRID_SIZE);
  const elevRange = (maxElevation - minElevation) || 1.0;

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const idx = (r * GRID_SIZE + c) * 4;
      const norm = Math.max(0, Math.min(1, (grid[r][c] - minElevation) / elevRange));
      const rgb = turboColormap(norm);
      imgData.data[idx] = rgb[0];
      imgData.data[idx + 1] = rgb[1];
      imgData.data[idx + 2] = rgb[2];
      imgData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function generateSlopeTexture(grid) {
  const canvas = document.createElement('canvas');
  canvas.width = GRID_SIZE;
  canvas.height = GRID_SIZE;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(GRID_SIZE, GRID_SIZE);

  for (let r = 1; r < GRID_SIZE - 1; r++) {
    for (let c = 1; c < GRID_SIZE - 1; c++) {
      const idx = (r * GRID_SIZE + c) * 4;
      const dzdx = (grid[r][c + 1] - grid[r][c - 1]) * 0.5;
      const dzdy = (grid[r + 1][c] - grid[r - 1][c]) * 0.5;
      const slopeDeg = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * (180 / Math.PI);

      let rC = 16, gC = 185, bC = 129; // Safe landing rooftop (<3 deg)
      if (slopeDeg > 15) { rC = 239; gC = 68; bC = 68; } // Obstacle hazard (>15 deg)
      else if (slopeDeg > 3) { rC = 245; gC = 158; bC = 11; } // Slanted canopy

      imgData.data[idx] = rC;
      imgData.data[idx + 1] = gC;
      imgData.data[idx + 2] = bC;
      imgData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function setVisualMode(mode) {
  currentVisualMode = mode;
  if (isFlythroughActive && mode !== "fpv") stopUAVFlythrough();
  if (!rawGridMatrix) return;

  if (mode === "satellite") {
    terrainMesh.material = standardMaterial;
    terrainMesh.material.wireframe = false;
    terrainMesh.material.map = rgbTexture;
    terrainMesh.material.needsUpdate = true;
  } else if (mode === "dsm") {
    const dsmTex = generateHeatmapTexture(rawGridMatrix);
    terrainMesh.material = new THREE.MeshBasicMaterial({ map: dsmTex, side: THREE.DoubleSide });
    terrainMesh.material.needsUpdate = true;
  } else if (mode === "slope") {
    const slopeTex = generateSlopeTexture(rawGridMatrix);
    terrainMesh.material = new THREE.MeshBasicMaterial({ map: slopeTex, side: THREE.DoubleSide });
    terrainMesh.material.needsUpdate = true;
  } else if (mode === "shadow") {
    terrainMesh.material = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      wireframe: true,
      roughness: 0.3
    });
    terrainMesh.material.needsUpdate = true;
  } else if (mode === "fpv") {
    terrainMesh.material = standardMaterial;
    terrainMesh.material.wireframe = false;
    terrainMesh.material.map = rgbTexture;
    terrainMesh.material.needsUpdate = true;
    startUAVFlythrough();
  }
}

function wireBottomCards() {
  const cards = Array.from(document.querySelectorAll('#bottom-layer-strip > div, .layer-card, [data-mode]'));
  cards.forEach((card, index) => {
    card.style.cursor = "pointer";
    card.onclick = (e) => {
      e.stopPropagation();
      cards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      let mode = card.getAttribute('data-mode');
      if (!mode) {
        const txt = card.innerText.toLowerCase();
        if (txt.includes("dsm") || txt.includes("mesh")) mode = "dsm";
        else if (txt.includes("slope")) mode = "slope";
        else if (txt.includes("shadow")) mode = "shadow";
        else if (txt.includes("surround") || txt.includes("fpv") || index === 4) mode = "fpv";
        else mode = "satellite";
      }
      setVisualMode(mode);
    };
  });
}

// ============================================================================
// 4. SIDEBAR DRAWERS & MEASURE TOOL
// ============================================================================
function wireSidebarButtons() {
  const railBtns = Array.from(document.querySelectorAll('#sidebar-rail button, .rail-btn, .sidebar-btn'));

  const btn3d = document.getElementById('tool-3d') || railBtns[0];
  btn3d?.addEventListener('click', () => {
    stopUAVFlythrough();
    closeAllDrawers();
    btn3d.classList.add('active');
    camera.position.set(0, -38, 24);
    controls.target.set(0, 0, 1.5);
  });

  const btn2d = document.getElementById('tool-2d') || railBtns[1];
  btn2d?.addEventListener('click', () => {
    stopUAVFlythrough();
    closeAllDrawers();
    btn2d.classList.add('active');
    camera.position.set(0, 0.01, 65);
    controls.target.set(0, 0, 0);
  });

  const btnLayers = document.getElementById('tool-layers') || railBtns[2];
  btnLayers?.addEventListener('click', (e) => {
    e.stopPropagation();
    stopUAVFlythrough();
    toggleDrawer('layers-drawer', btnLayers);
  });

  const btnAnalysis = document.getElementById('tool-analysis') || railBtns[3];
  btnAnalysis?.addEventListener('click', (e) => {
    e.stopPropagation();
    stopUAVFlythrough();
    toggleDrawer('analysis-drawer', btnAnalysis);
  });

  const btnMeasure = document.getElementById('tool-measure') || railBtns[4];
  btnMeasure?.addEventListener('click', (e) => {
    e.stopPropagation();
    stopUAVFlythrough();
    toggleDrawer('measure-drawer', btnMeasure);
    const mDrawer = document.getElementById('measure-drawer');
    if (mDrawer && mDrawer.style.display === 'block') {
      activateMeasureMode();
    }
  });

  const btnExport = document.getElementById('tool-export') || railBtns[5];
  btnExport?.addEventListener('click', (e) => {
    e.stopPropagation();
    stopUAVFlythrough();
    toggleDrawer('export-drawer', btnExport);
  });

  document.querySelectorAll('.drawer-close, .close-drawer-btn, #close-measure-drawer-x').forEach(b => {
    b.addEventListener('click', closeAllDrawers);
  });
}

// Real-Time Distance & Gradient Measuring
let measurePoints = [];
function activateMeasureMode() {
  measurePoints = [];
  while (measurementGroup.children.length > 0) measurementGroup.remove(measurementGroup.children[0]);
  const readout = document.getElementById('measure-readout');
  if (readout) {
    readout.innerHTML = `<span style="color:#38bdf8; font-weight:600;">Active Mode:</span> Click any 2 points on terrain to measure 3D Euclidean distance & elevation drop.`;
  }
}

function handleMeasureClick(point) {
  if (measurePoints.length >= 2) {
    measurePoints = [];
    while (measurementGroup.children.length > 0) measurementGroup.remove(measurementGroup.children[0]);
  }
  measurePoints.push(point);

  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
  dot.position.copy(point);
  measurementGroup.add(dot);

  const readout = document.getElementById('measure-readout');
  if (measurePoints.length === 1 && readout) {
    readout.innerHTML = `Point A marked at Z: ${(minElevation + (point.z / 2.4) * (maxElevation - minElevation)).toFixed(1)}m AMSL.<br><span style="color:#38bdf8;">Click Point B to calculate distance.</span>`;
  } else if (measurePoints.length === 2 && readout) {
    const p1 = measurePoints[0];
    const p2 = measurePoints[1];

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([p1, p2]),
      new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 })
    );
    measurementGroup.add(line);

    const dxM = ((p2.x - p1.x) / 50) * 500;
    const dyM = ((p2.y - p1.y) / 50) * 500;
    const horizDistM = Math.sqrt(dxM * dxM + dyM * dyM);

    const z1M = minElevation + (p1.z / 2.4) * (maxElevation - minElevation);
    const z2M = minElevation + (p2.z / 2.4) * (maxElevation - minElevation);
    const deltaZM = Math.abs(z2M - z1M);
    const directDistM = Math.sqrt(horizDistM * horizDistM + deltaZM * deltaZM);
    const slopeDeg = (Math.atan(deltaZM / (horizDistM || 1e-4)) * (180 / Math.PI)).toFixed(1);

    readout.innerHTML = `
      <div style="line-height:1.6; font-size:12px;">
        <b style="color:#f59e0b;">Tactical Vector:</b><br>
        Direct Line: <b>${directDistM.toFixed(1)} m</b><br>
        Ground Distance: <b>${horizDistM.toFixed(1)} m</b><br>
        Elevation Drop (ΔZ): <b>${deltaZM.toFixed(1)} m</b><br>
        Path Slope: <b>${slopeDeg}°</b>
      </div>
    `;
  }
}

// ============================================================================
// 5. DATA LOADER & TEXTURE MAPPING
// ============================================================================
function applyElevationData(data, imageUrl) {
  minElevation = data.elevation_min_m;
  maxElevation = data.elevation_max_m;
  currentBounds = data.bounds || currentBounds;
  GRID_SIZE = data.grid_resolution || 128;
  rawGridMatrix = data.elevation_grid;

  while (tacticalGroup.children.length > 0) tacticalGroup.remove(tacticalGroup.children[0]);
  while (measurementGroup.children.length > 0) measurementGroup.remove(measurementGroup.children[0]);

  scene.remove(terrainMesh);
  geometry.dispose();
  geometry = new THREE.PlaneGeometry(50, 50, GRID_SIZE - 1, GRID_SIZE - 1);
  terrainMesh = new THREE.Mesh(geometry, standardMaterial);
  scene.add(terrainMesh);

  const pos = geometry.attributes.position;
  const elevRange = (maxElevation - minElevation) || 1.0;

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const idx = r * GRID_SIZE + c;
      const isBorder = (r === 0 || r === GRID_SIZE - 1 || c === 0 || c === GRID_SIZE - 1);
      const rawZ = rawGridMatrix[r][c];
      const normZ = isBorder ? 0.0 : THREE.MathUtils.clamp((rawZ - minElevation) / elevRange, 0.0, 1.0);
      pos.setZ(idx, normZ * 2.4);
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (rgbTexture) rgbTexture.dispose();
    rgbTexture = new THREE.Texture(img);
    rgbTexture.needsUpdate = true;
    setVisualMode(currentVisualMode);
    document.querySelectorAll('#thumb-sat, #thumb-fpv').forEach(el => el.src = imageUrl);
  };
  img.src = imageUrl;

  updateTelemetryAt(0, 0, 1.8);
}

// ============================================================================
// 6. RAYCASTING & TELEMETRY
// ============================================================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const pinTooltip = document.getElementById('pin-tooltip');
const pinText = document.getElementById('pin-text');

function updateTelemetryAt(x, y, z) {
  pinGroup.position.set(x, y, z);
  const u = THREE.MathUtils.clamp((x + 25) / 50, 0, 1);
  const v = THREE.MathUtils.clamp((y + 25) / 50, 0, 1);

  const lon = (currentBounds[0] + u * (currentBounds[2] - currentBounds[0])).toFixed(4);
  const lat = (currentBounds[1] + v * (currentBounds[3] - currentBounds[1])).toFixed(4);
  const elevRatio = Math.max(0, Math.min(1, z / 2.4));
  const absElev = (minElevation + elevRatio * (maxElevation - minElevation)).toFixed(1);
  const relElev = (elevRatio * (maxElevation - minElevation)).toFixed(1);

  document.getElementById('ray-coords').textContent = `(${lat}° N, ${lon}° E)`;
  document.getElementById('val-datum').textContent = `${minElevation.toFixed(1)} m AMSL`;
  document.getElementById('val-relief').textContent = `+${relElev} m AGL`;
  document.getElementById('val-total-elev').textContent = `${absElev} m AMSL`;

  const gx = Math.floor(u * (GRID_SIZE - 1));
  const gy = Math.floor((1 - v) * (GRID_SIZE - 1));
  let slopeDeg = "1.8";
  if (rawGridMatrix && rawGridMatrix[gy] && rawGridMatrix[gy][gx]) {
    const dz = Math.abs((rawGridMatrix[gy][Math.min(GRID_SIZE - 1, gx + 1)] || 0) - rawGridMatrix[gy][gx]);
    slopeDeg = Math.min(45, (Math.atan(dz) * (180 / Math.PI))).toFixed(1);
  }
  document.getElementById('val-slope').textContent = `${slopeDeg}°`;

  const isHelipad = parseFloat(slopeDeg) < 3.0 && parseFloat(relElev) > 8.0;
  const badge = document.getElementById('helipad-status-tag');
  if (badge) {
    badge.innerHTML = isHelipad
      ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> Safe Emergency Helipad Zone`
      : `<span style="color:#f87171;">Slope / Obstacle Hazard</span>`;
    badge.style.borderColor = isHelipad ? "#10b981" : "#ef4444";
    badge.style.color = isHelipad ? "#34d399" : "#f87171";
  }

  if (pinText) pinText.innerHTML = `Rooftop Target<br>(${lat}° N, ${lon}° E)`;
}

window.addEventListener('click', (e) => {
  if (e.target.closest('#top-header') || e.target.closest('#sidebar-rail') || e.target.closest('#telemetry-panel') || e.target.closest('#bottom-layer-strip') || e.target.closest('.tool-drawer') || e.target.closest('#measure-drawer')) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(terrainMesh);
  if (hits.length > 0) {
    const pt = hits[0].point;
    const mDrawer = document.getElementById('measure-drawer');
    if (mDrawer && mDrawer.style.display === 'block') {
      handleMeasureClick(pt);
    } else {
      updateTelemetryAt(pt.x, pt.y, pt.z);
    }
  }
});

// Tactical Suite Overlays
document.getElementById('btn-flood')?.addEventListener('click', async () => {
  while (tacticalGroup.children.length > 0) tacticalGroup.remove(tacticalGroup.children[0]);
  const res = await fetch('/api/disaster/flood-analysis?water_rise_m=5.0');
  const d = await res.json();
  const info = document.getElementById('drawer-telemetry');
  if (info) info.innerHTML = `Flood Surge (+5m):<br>Inundated Area: <b>${d.inundated_area_m2} m²</b><br>Displaced Volume: <b>${d.inundated_volume_m3} m³</b><br>Peak Depth: <b>${d.max_water_depth_m} m</b>`;

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 50),
    new THREE.MeshStandardMaterial({ color: 0x0284c7, transparent: true, opacity: 0.65, roughness: 0.1, side: THREE.DoubleSide })
  );
  water.position.z = 0.35;
  tacticalGroup.add(water);
});

document.getElementById('btn-helipad')?.addEventListener('click', async () => {
  while (tacticalGroup.children.length > 0) tacticalGroup.remove(tacticalGroup.children[0]);
  const res = await fetch('/api/disaster/helipad-triage');
  const d = await res.json();
  const info = document.getElementById('drawer-telemetry');
  if (info) info.innerHTML = `ICAO Rooftop Helipads:<br>Verified Landing Zones: <b>${d.verified_landing_zones}</b><br>Max Helipad Area: <b>${d.candidates[0]?.pad_area_m2 || 0} m²</b>`;

  d.candidates.forEach(cand => {
    const pad = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.3, 24),
      new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide })
    );
    const normX = ((cand.lon - currentBounds[0]) / (currentBounds[2] - currentBounds[0]) - 0.5) * 50;
    const normY = ((cand.lat - currentBounds[1]) / (currentBounds[3] - currentBounds[1]) - 0.5) * 50;
    pad.position.set(normX, normY, 1.25);
    tacticalGroup.add(pad);
  });
});

document.getElementById('btn-uav')?.addEventListener('click', async () => {
  while (tacticalGroup.children.length > 0) tacticalGroup.remove(tacticalGroup.children[0]);
  const res = await fetch('/api/disaster/uav-clearance?safety_margin_m=15.0');
  const d = await res.json();
  const info = document.getElementById('drawer-telemetry');
  if (info) info.innerHTML = `UAV Flight Corridor:<br>Max Structure: <b>${d.tallest_structure_amsl_m} m AMSL</b><br>Minimum Safe Alt: <b>${d.minimum_safe_altitude_amsl_m} m AMSL</b>`;

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 50),
    new THREE.MeshBasicMaterial({ color: 0xa855f7, wireframe: true, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  ceiling.position.z = 2.8;
  tacticalGroup.add(ceiling);
});

// Low-Latency Ingestion
const fileInput = document.getElementById('file-input');
fileInput?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const label = document.getElementById('remote-tile-label') || e.target.parentElement;
  const origText = label.innerText;
  label.innerText = `Processing ${file.name.substring(0, 12)}...`;

  const form = new FormData();
  form.append('file', file);

  try {
    const res = await fetch('/api/reconstruct', { method: 'POST', body: form });
    const data = await res.json();
    label.innerText = origText;
    e.target.value = "";

    if (data.status === "success") {
      document.getElementById('header-loc-name').textContent = `${file.name.substring(0, 16)}... | ${data.crs}`;
      document.getElementById('ctx-crs').textContent = data.crs;
      applyElevationData(data, data.image_url);
    }
  } catch (err) {
    label.innerText = origText;
    console.error(err);
  }
});

// ============================================================================
// 7. INITIALIZATION & 60 FPS RENDER LOOP
// ============================================================================
wireSidebarButtons();
wireBottomCards();

fetch('/api/load-sample?scene_id=gamus_suburban')
  .then(r => r.json())
  .then(d => applyElevationData(d, d.image_url))
  .catch(console.warn);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (isFlythroughActive) {
    flythroughProgress = (flythroughProgress + delta / flythroughDuration) % 1.0;
    const camPos = flightPathCurve.getPointAt(flythroughProgress);
    const lookTarget = lookTargetCurve.getPointAt(flythroughProgress);

    camera.position.copy(camPos);
    camera.lookAt(lookTarget);
  } else {
    controls.update();
  }

  if (pinTooltip) {
    const screenPos = pinGroup.position.clone().project(camera);
    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;
    if (screenPos.z < 1.0) {
      pinTooltip.style.display = 'block';
      pinTooltip.style.left = `${x}px`;
      pinTooltip.style.top = `${y}px`;
    } else {
      pinTooltip.style.display = 'none';
    }
  }

  renderer.render(scene, camera);
}
animate();
