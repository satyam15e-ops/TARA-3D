// 1. THREE.JS SCENE SETUP
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060b13);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 4000);
camera.position.set(0, -40, 26);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.innerHTML = "";
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI / 2 + 0.02;
controls.minDistance = 4;
controls.maxDistance = 300;
controls.target.set(0, 0, 2);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.25);
dirLight.position.set(40, -50, 50);
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0x94a3b8, 0.45);
fillLight.position.set(-40, 50, 25);
scene.add(fillLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

let GRID_SIZE = 256;
let geometry = new THREE.PlaneGeometry(50, 50, GRID_SIZE - 1, GRID_SIZE - 1);

let rgbTexture = null;
let verticalExaggeration = 2.4;
let minElevation = 890.0;
let maxElevation = 924.2;
let currentBounds = [77.200, 28.610, 77.215, 28.625];
let rawGridMatrix = null;
let currentVisualMode = "satellite";

const standardMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.65,
  metalness: 0.05,
  side: THREE.DoubleSide
});

let terrainMesh = new THREE.Mesh(geometry, standardMaterial);
scene.add(terrainMesh);

// 3D TARGET PIN BEACON
const pinGroup = new THREE.Group();
const pinStemGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.5, 8);
const pinStemMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
const pinStem = new THREE.Mesh(pinStemGeo, pinStemMat);
pinStem.rotation.x = Math.PI / 2;
pinStem.position.z = 1.25;

const pinRingGeo = new THREE.RingGeometry(0.8, 1.1, 32);
const pinRingMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
const pinRing = new THREE.Mesh(pinRingGeo, pinRingMat);
pinGroup.add(pinStem);
pinGroup.add(pinRing);
pinGroup.position.set(0, 0, 1.8);
scene.add(pinGroup);

// LIVE CLOCK IN HEADER
function updateLiveClock() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour12: false }) + " IST";
  const elDate = document.getElementById('live-date');
  const elClock = document.getElementById('live-clock');
  if (elDate) elDate.textContent = dateStr;
  if (elClock) elClock.textContent = timeStr;
}
setInterval(updateLiveClock, 1000);
updateLiveClock();

// CAMERA TRANSITION ANIMATION
let targetCamPos = null;
let targetLookAt = null;
let isTransitioning = false;

function smoothCameraTo(pos, lookAt) {
  targetCamPos = pos.clone();
  targetLookAt = lookAt.clone();
  isTransitioning = true;
}

const tool3d = document.getElementById('tool-3d');
const tool2d = document.getElementById('tool-2d');
const toolLayers = document.getElementById('tool-layers');
const toolAnalysis = document.getElementById('tool-analysis');
const toolExport = document.getElementById('tool-export');

const layersDrawer = document.getElementById('layers-drawer');
const analysisDrawer = document.getElementById('analysis-drawer');
const exportDrawer = document.getElementById('export-drawer');

function closeAllDrawers() {
  if (layersDrawer) layersDrawer.style.display = 'none';
  if (analysisDrawer) analysisDrawer.style.display = 'none';
  if (exportDrawer) exportDrawer.style.display = 'none';
}

tool3d?.addEventListener('click', () => {
  tool3d.classList.add('active');
  tool2d.classList.remove('active');
  closeAllDrawers();
  smoothCameraTo(new THREE.Vector3(0, -40, 26), new THREE.Vector3(0, 0, 2));
});

tool2d?.addEventListener('click', () => {
  tool2d.classList.add('active');
  tool3d.classList.remove('active');
  closeAllDrawers();
  smoothCameraTo(new THREE.Vector3(0, 0.01, 70), new THREE.Vector3(0, 0, 0));
});

toolLayers?.addEventListener('click', () => {
  const isOpen = layersDrawer.style.display === 'block';
  closeAllDrawers();
  layersDrawer.style.display = isOpen ? 'none' : 'block';
});

toolAnalysis?.addEventListener('click', () => {
  const isOpen = analysisDrawer.style.display === 'block';
  closeAllDrawers();
  analysisDrawer.style.display = isOpen ? 'none' : 'block';
});

toolExport?.addEventListener('click', () => {
  const isOpen = exportDrawer.style.display === 'block';
  closeAllDrawers();
  exportDrawer.style.display = isOpen ? 'none' : 'block';
});

// BOTTOM CAROUSEL VISUAL MODES
const layerCards = document.querySelectorAll('.layer-card');
layerCards.forEach(card => {
  card.addEventListener('click', () => {
    layerCards.forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    setVisualMode(card.getAttribute('data-mode'));
  });
});

function setVisualMode(mode) {
  currentVisualMode = mode;
  if (!rawGridMatrix) return;

  if (mode === "satellite") {
    terrainMesh.material = standardMaterial;
    terrainMesh.material.wireframe = false;
    terrainMesh.material.map = rgbTexture;
    terrainMesh.material.needsUpdate = true;
  } else if (mode === "dsm") {
    const dsmTex = createHeatmapTexture(rawGridMatrix);
    terrainMesh.material = new THREE.MeshBasicMaterial({ map: dsmTex, side: THREE.DoubleSide });
  } else if (mode === "slope") {
    const slopeTex = createSlopeTexture(rawGridMatrix);
    terrainMesh.material = new THREE.MeshBasicMaterial({ map: slopeTex, side: THREE.DoubleSide });
  } else if (mode === "shadow") {
    terrainMesh.material = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      wireframe: true,
      roughness: 0.5
    });
  } else if (mode === "fpv") {
    terrainMesh.material = standardMaterial;
    terrainMesh.material.wireframe = false;
    terrainMesh.material.map = rgbTexture;
    terrainMesh.material.needsUpdate = true;
    smoothCameraTo(new THREE.Vector3(0, -18, 6), new THREE.Vector3(0, 0, 2));
  }
}

function turboColormap(t) {
  const r = Math.round(255 * Math.max(0, Math.sin(t * Math.PI - 0.2)));
  const g = Math.round(255 * Math.max(0, Math.sin(t * Math.PI * 0.9 + 0.2)));
  const b = Math.round(255 * Math.max(0, Math.cos(t * Math.PI * 0.8)));
  return [r, g, b];
}

function createHeatmapTexture(grid) {
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
      imgData.data[idx+1] = rgb[1];
      imgData.data[idx+2] = rgb[2];
      imgData.data[idx+3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createSlopeTexture(grid) {
  const canvas = document.createElement('canvas');
  canvas.width = GRID_SIZE;
  canvas.height = GRID_SIZE;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(GRID_SIZE, GRID_SIZE);

  for (let r = 1; r < GRID_SIZE - 1; r++) {
    for (let c = 1; c < GRID_SIZE - 1; c++) {
      const idx = (r * GRID_SIZE + c) * 4;
      const dzdx = (grid[r][c+1] - grid[r][c-1]) * 0.5;
      const dzdy = (grid[r+1][c] - grid[r-1][c]) * 0.5;
      const slopeDeg = Math.atan(Math.sqrt(dzdx*dzdx + dzdy*dzdy)) * (180 / Math.PI);

      let rC = 16, gC = 185, bC = 129;
      if (slopeDeg > 15) { rC = 239; gC = 68; bC = 68; }
      else if (slopeDeg > 3) { rC = 245; gC = 158; bC = 11; }

      imgData.data[idx] = rC;
      imgData.data[idx+1] = gC;
      imgData.data[idx+2] = bC;
      imgData.data[idx+3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// RENDER MINI-CANVAS PREVIEWS ON BOTTOM THUMBNAILS
function updateBottomThumbnails(grid) {
  const elevRange = (maxElevation - minElevation) || 1.0;

  // 1. DSM Heatmap Thumbnail
  const dsmCanvas = document.getElementById('thumb-dsm-canvas');
  if (dsmCanvas) {
    const ctx = dsmCanvas.getContext('2d');
    const imgData = ctx.createImageData(96, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 96; x++) {
        const gy = Math.floor((y / 64) * (GRID_SIZE - 1));
        const gx = Math.floor((x / 96) * (GRID_SIZE - 1));
        const norm = Math.max(0, Math.min(1, (grid[gy][gx] - minElevation) / elevRange));
        const rgb = turboColormap(norm);
        const idx = (y * 96 + x) * 4;
        imgData.data[idx] = rgb[0];
        imgData.data[idx+1] = rgb[1];
        imgData.data[idx+2] = rgb[2];
        imgData.data[idx+3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // 2. Slope Map Thumbnail
  const slopeCanvas = document.getElementById('thumb-slope-canvas');
  if (slopeCanvas) {
    const ctx = slopeCanvas.getContext('2d');
    const imgData = ctx.createImageData(96, 64);
    for (let y = 1; y < 63; y++) {
      for (let x = 1; x < 95; x++) {
        const gy = Math.floor((y / 64) * (GRID_SIZE - 1));
        const gx = Math.floor((x / 96) * (GRID_SIZE - 1));
        const dzdx = (grid[gy][Math.min(GRID_SIZE-1, gx+1)] - grid[gy][Math.max(0, gx-1)]) * 0.5;
        const dzdy = (grid[Math.min(GRID_SIZE-1, gy+1)][gx] - grid[Math.max(0, gy-1)][gx]) * 0.5;
        const slope = Math.atan(Math.sqrt(dzdx*dzdx + dzdy*dzdy)) * (180 / Math.PI);

        let rC = 16, gC = 185, bC = 129;
        if (slope > 15) { rC = 239; gC = 68; bC = 68; }
        else if (slope > 3) { rC = 245; gC = 158; bC = 11; }

        const idx = (y * 96 + x) * 4;
        imgData.data[idx] = rC;
        imgData.data[idx+1] = gC;
        imgData.data[idx+2] = bC;
        imgData.data[idx+3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // 3. Shadow / Wireframe Thumbnail
  const shadowCanvas = document.getElementById('thumb-shadow-canvas');
  if (shadowCanvas) {
    const ctx = shadowCanvas.getContext('2d');
    ctx.fillStyle = '#0a1424';
    ctx.fillRect(0, 0, 96, 64);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 96; i += 12) { ctx.moveTo(i, 0); ctx.lineTo(i, 64); }
    for (let j = 0; j < 64; j += 10) { ctx.moveTo(0, j); ctx.lineTo(96, j); }
    ctx.stroke();
  }
}

// APPLY ELEVATION DATA PIPELINE
function applyElevationData(data, imageUrl) {
  minElevation = data.elevation_min_m;
  maxElevation = data.elevation_max_m;
  currentBounds = data.bounds || currentBounds;
  GRID_SIZE = data.grid_resolution || 256;
  rawGridMatrix = data.elevation_grid;

  scene.remove(terrainMesh);
  geometry = new THREE.PlaneGeometry(50, 50, GRID_SIZE - 1, GRID_SIZE - 1);
  terrainMesh = new THREE.Mesh(geometry, standardMaterial);
  scene.add(terrainMesh);

  const pos = geometry.attributes.position;
  const elevRange = maxElevation - minElevation || 1.0;

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const idx = r * GRID_SIZE + c;
      const isBorder = (r === 0 || r === GRID_SIZE - 1 || c === 0 || c === GRID_SIZE - 1);
      const rawZ = rawGridMatrix[r][c];
      const normZ = isBorder ? 0.0 : THREE.MathUtils.clamp((rawZ - minElevation) / elevRange, 0.0, 1.0);
      pos.setZ(idx, normZ * verticalExaggeration);
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    rgbTexture = new THREE.Texture(img);
    rgbTexture.needsUpdate = true;
    document.getElementById('thumb-sat').src = imageUrl;
    document.getElementById('thumb-fpv').src = imageUrl;
    setVisualMode(currentVisualMode);
    updateBottomThumbnails(rawGridMatrix);
  };
  img.src = imageUrl;

  // Center beacon target
  updateTelemetryAt(0, 0, 1.8);
}

// LIVE RAYCASTING & 3D PIN BEACON
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
  const elevRatio = Math.max(0, Math.min(1, z / verticalExaggeration));
  const absElev = (minElevation + elevRatio * (maxElevation - minElevation)).toFixed(1);
  const relElev = (elevRatio * (maxElevation - minElevation)).toFixed(1);

  const gx = Math.floor(u * (GRID_SIZE - 1));
  const gy = Math.floor((1 - v) * (GRID_SIZE - 1));
  let slopeDeg = "1.8";
  if (rawGridMatrix && rawGridMatrix[gy] && rawGridMatrix[gy][gx]) {
    const dz = Math.abs((rawGridMatrix[gy][Math.min(GRID_SIZE-1, gx+1)] || 0) - rawGridMatrix[gy][gx]);
    slopeDeg = Math.min(45, (Math.atan(dz) * (180 / Math.PI))).toFixed(1);
  }

  document.getElementById('ray-coords').textContent = `(${lat}° N, ${lon}° E)`;
  document.getElementById('val-datum').textContent = `${minElevation.toFixed(1)} m AMSL`;
  document.getElementById('val-relief').textContent = `+${relElev} m AGL`;
  document.getElementById('val-total-elev').textContent = `${absElev} m AMSL`;
  document.getElementById('val-slope').textContent = `${slopeDeg}°`;

  document.getElementById('footer-lat').textContent = `${lat}° N`;
  document.getElementById('footer-lon').textContent = `${lon}° E`;
  document.getElementById('footer-elev').textContent = `${absElev} m`;

  const isHelipad = parseFloat(slopeDeg) < 3.0 && parseFloat(relElev) > 8.0;
  const badge = document.getElementById('helipad-status-tag');
  if (badge) {
    badge.innerHTML = isHelipad
      ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> Safe Emergency Helipad Zone`
      : `<span style="color:#f87171;">Slope / Obstacle Hazard</span>`;
    badge.style.borderColor = isHelipad ? "#10b981" : "#ef4444";
    badge.style.color = isHelipad ? "#34d399" : "#f87171";
  }

  pinText.innerHTML = `Rooftop Target<br>(${lat}° N, ${lon}° E)`;
}

window.addEventListener('click', (e) => {
  if (e.target.closest('#top-header') || e.target.closest('#sidebar-rail') || e.target.closest('#search-overlay') || e.target.closest('#telemetry-panel') || e.target.closest('#bottom-layer-strip') || e.target.closest('.tool-drawer')) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(terrainMesh);
  if (hits.length > 0) {
    const pt = hits[0].point;
    updateTelemetryAt(pt.x, pt.y, pt.z);
  }
});

function updatePinScreenPos() {
  if (!pinTooltip) return;
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

// BENCHMARK SELECTOR
const benchSelect = document.getElementById('benchmark-selector');
benchSelect?.addEventListener('change', async (e) => {
  const sceneId = e.target.value;
  try {
    const res = await fetch(`/api/load-sample?scene_id=${sceneId}`);
    const data = await res.json();
    applyElevationData(data, data.image_url);
  } catch (err) { console.error(err); }
});

// REMOTE STREAMING
let streamIdx = 0;
async function streamTile(delta) {
  streamIdx = Math.max(0, streamIdx + delta);
  try {
    const res = await fetch(`/api/stream-gamus?split=test&index=${streamIdx}`);
    const data = await res.json();
    const lbl = document.getElementById('remote-tile-label');
    if (lbl) lbl.textContent = `Tile: ${data.file_name}`;
    applyElevationData(data, data.image_url);
  } catch (err) { console.error(err); }
}
document.getElementById('btn-stream-next')?.addEventListener('click', () => streamTile(1));
document.getElementById('btn-stream-prev')?.addEventListener('click', () => streamTile(-1));

// FILE UPLOAD
document.getElementById('file-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/reconstruct', { method: 'POST', body: form });
    const data = await res.json();
    const reader = new FileReader();
    reader.onload = (evt) => applyElevationData(data, evt.target.result);
    reader.readAsDataURL(file);
  } catch (err) { console.error(err); }
});

// DELIVERABLE EXPORTS
document.getElementById('btn-export-geotiff')?.addEventListener('click', () => window.open('/api/download-geotiff', '_blank'));
document.getElementById('btn-export-glb')?.addEventListener('click', () => {
  const exporter = new THREE.GLTFExporter();
  exporter.parse(terrainMesh, (gltf) => {
    const blob = new Blob([gltf], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'ISRO_3D_DSM_Mesh.glb';
    link.click();
  }, { binary: true });
});

// DISASTER BUTTONS
document.getElementById('btn-flood')?.addEventListener('click', async () => {
  const res = await fetch('/api/disaster/flood-analysis?water_rise_m=5.0');
  const d = await res.json();
  document.getElementById('drawer-telemetry').innerHTML = `Flood Surge (+5m):<br>Area: ${d.inundated_area_m2} m²<br>Vol: ${d.inundated_volume_m3} m³<br>Peak Depth: ${d.max_water_depth_m} m`;
});

document.getElementById('btn-helipad')?.addEventListener('click', async () => {
  const res = await fetch('/api/disaster/helipad-triage');
  const d = await res.json();
  document.getElementById('drawer-telemetry').innerHTML = `ICAO Helipads:<br>Detected: ${d.verified_landing_zones} Zones<br>Top Area: ${d.candidates[0]?.pad_area_m2 || 0} m²`;
});

// LOAD INITIAL DATASET
fetch('/api/load-sample?scene_id=gamus_suburban')
  .then(r => r.json())
  .then(d => applyElevationData(d, d.image_url))
  .catch(console.warn);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);

  if (isTransitioning && targetCamPos && targetLookAt) {
    camera.position.lerp(targetCamPos, 0.08);
    controls.target.lerp(targetLookAt, 0.08);
    if (camera.position.distanceTo(targetCamPos) < 0.2) {
      isTransitioning = false;
    }
  }

  controls.update();
  updatePinScreenPos();
  renderer.render(scene, camera);
}
animate();
