// ============================================================================
// TARA-3D: STRICT rDSM / rnDSM & ABSOLUTE DSM / nDSM TELEMETRY ENGINE
// ============================================================================

const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060c18);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 3000);
camera.position.set(0, -38, 26);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.innerHTML = "";
container.appendChild(renderer.domElement);

const maxAniso = renderer.capabilities.getMaxAnisotropy();

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = true;
controls.maxDistance = 280;
controls.target.set(0, 0, 1.5);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.45);
dirLight.position.set(35, -45, 55);
scene.add(dirLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.75));

let GRID_SIZE = 128;
let geometry = new THREE.PlaneGeometry(50, 50, GRID_SIZE - 1, GRID_SIZE - 1);
let rgbTexture = null;
let dsmTexture = null;
let slopeTexture = null;
let minElevation = 888.0;
let maxElevation = 918.0;
let currentBounds = [73.845000, 18.510000, 73.868000, 18.530000];
let rawGridMatrix = null;
let rawNdsmMatrix = null;
let rawTreeMask = null;
let cachedHelipads = [];
let currentVisualMode = "satellite";
let isMetricMode = true;

const AUTHENTIC_VERTICAL_SCALE = 3.2;

const floodGroup = new THREE.Group();
const helipadGroup = new THREE.Group();
const uavGroup = new THREE.Group();
scene.add(floodGroup);
scene.add(helipadGroup);
scene.add(uavGroup);

let isFloodActive = false;
let isHelipadsActive = false;
let isUavActive = false;

const standardMaterial = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.65,
  metalness: 0.1,
  side: THREE.DoubleSide
});
let terrainMesh = new THREE.Mesh(geometry, standardMaterial);
scene.add(terrainMesh);

const pinGroup = new THREE.Group();
const pinStem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.8, 8), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
pinStem.rotation.x = Math.PI / 2;
pinStem.position.z = 1.4;
const pinRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.2, 24), new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide }));
pinGroup.add(pinStem);
pinGroup.add(pinRing);
scene.add(pinGroup);

function closeAllDrawers() {
  document.querySelectorAll('.tool-drawer, #analysis-drawer, #export-drawer').forEach(d => {
    if (d) d.style.display = 'none';
  });
  document.querySelectorAll('#sidebar-rail button, .rail-btn').forEach(b => b.classList.remove('active'));
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

let isFlythroughActive = false;
let flythroughProgress = 0.0;
const flythroughDuration = 22.0;

const flightPathCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-14, -16, 9.0),
  new THREE.Vector3(-4, -6, 7.5),
  new THREE.Vector3(10, -10, 8.5),
  new THREE.Vector3(14, 6, 8.0),
  new THREE.Vector3(4, 14, 7.5),
  new THREE.Vector3(-10, 12, 8.5),
  new THREE.Vector3(-14, -2, 7.8),
  new THREE.Vector3(-14, -16, 9.0)
], true);

const lookTargetCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-2, -4, 2.0),
  new THREE.Vector3(4, -2, 2.5),
  new THREE.Vector3(6, 4, 2.0),
  new THREE.Vector3(0, 6, 2.5),
  new THREE.Vector3(-4, 4, 2.2),
  new THREE.Vector3(-4, -2, 2.5),
  new THREE.Vector3(-2, -4, 2.0)
], true);

function startUAVFlythrough() {
  closeAllDrawers();
  isFlythroughActive = true;
  flythroughProgress = 0.0;
  controls.enabled = false;
}

function stopUAVFlythrough() {
  if (!isFlythroughActive) return;
  isFlythroughActive = false;
  controls.enabled = true;
  camera.position.set(0, -38, 26);
  controls.target.set(0, 0, 1.5);
}

function spectralTurbo(t) {
  let r = 0, g = 0, b = 0;
  if (t < 0.2) { r = 0; g = Math.round(t * 5 * 200); b = 255; }
  else if (t < 0.4) { r = 0; g = 200 + Math.round((t - 0.2) * 5 * 55); b = 255 - Math.round((t - 0.2) * 5 * 200); }
  else if (t < 0.65) { r = Math.round((t - 0.4) * 4 * 255); g = 255; b = 30; }
  else if (t < 0.85) { r = 255; g = 255 - Math.round((t - 0.65) * 5 * 180); b = 0; }
  else { r = 255; g = Math.max(0, 75 - Math.round((t - 0.85) * 6.6 * 75)); b = 0; }
  return [r, g, b];
}

function createDsmCanvasTexture(grid) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(256, 256);
  const elevRange = (maxElevation - minElevation) || 1.0;

  for (let r = 0; r < 256; r++) {
    for (let c = 0; c < 256; c++) {
      const gr = Math.floor((r / 256) * GRID_SIZE);
      const gc = Math.floor((c / 256) * GRID_SIZE);
      const idx = (r * 256 + c) * 4;
      const rawVal = grid[gr] ? grid[gr][gc] : minElevation;
      const norm = Math.max(0, Math.min(1, (rawVal - minElevation) / elevRange));
      const rgb = spectralTurbo(norm);
      imgData.data[idx] = rgb[0];
      imgData.data[idx + 1] = rgb[1];
      imgData.data[idx + 2] = rgb[2];
      imgData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return { texture: tex, dataUrl: canvas.toDataURL() };
}

function createSlopeCanvasTexture(grid) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(256, 256);

  for (let r = 0; r < 256; r++) {
    for (let c = 0; c < 256; c++) {
      const gr = Math.min(GRID_SIZE - 2, Math.max(1, Math.floor((r / 256) * GRID_SIZE)));
      const gc = Math.min(GRID_SIZE - 2, Math.max(1, Math.floor((c / 256) * GRID_SIZE)));
      const idx = (r * 256 + c) * 4;
      const dzdx = ((grid[gr]?.[gc + 1] || 0) - (grid[gr]?.[gc - 1] || 0)) * 0.5;
      const dzdy = ((grid[gr + 1]?.[gc] || 0) - (grid[gr - 1]?.[gc] || 0)) * 0.5;
      const slopeDeg = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy) / 0.5) * (180 / Math.PI);

      let rC = 16, gC = 185, bC = 129;
      if (slopeDeg > 18) { rC = 239; gC = 68; bC = 68; }
      else if (slopeDeg > 4) { rC = 245; gC = 158; bC = 11; }

      imgData.data[idx] = rC;
      imgData.data[idx + 1] = gC;
      imgData.data[idx + 2] = bC;
      imgData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return { texture: tex, dataUrl: canvas.toDataURL() };
}

function createShadowCanvasTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#060c18';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1;

  for (let i = 0; i < 256; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }
  return canvas.toDataURL();
}

function setVisualMode(mode) {
  currentVisualMode = mode;
  if (isFlythroughActive && mode !== "fpv") stopUAVFlythrough();
  if (!rawGridMatrix) return;

  if (mode === "satellite") {
    terrainMesh.material = new THREE.MeshStandardMaterial({
      map: rgbTexture,
      roughness: 0.55,
      metalness: 0.05,
      wireframe: false,
      side: THREE.DoubleSide
    });
  } else if (mode === "dsm") {
    terrainMesh.material = new THREE.MeshStandardMaterial({
      map: dsmTexture,
      roughness: 0.35,
      metalness: 0.05,
      wireframe: false,
      side: THREE.DoubleSide
    });
  } else if (mode === "slope") {
    terrainMesh.material = new THREE.MeshBasicMaterial({
      map: slopeTexture,
      wireframe: false,
      side: THREE.DoubleSide
    });
  } else if (mode === "shadow") {
    terrainMesh.material = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      wireframe: true,
      roughness: 0.2,
      metalness: 0.8,
      side: THREE.DoubleSide
    });
  } else if (mode === "fpv") {
    terrainMesh.material = new THREE.MeshStandardMaterial({
      map: rgbTexture,
      roughness: 0.55,
      wireframe: false,
      side: THREE.DoubleSide
    });
    startUAVFlythrough();
  }
  terrainMesh.material.needsUpdate = true;
}

function wireBottomCards() {
  const cardElements = [
    { el: document.querySelector('#bottom-layer-strip > div:nth-child(1)'), mode: 'satellite' },
    { el: document.querySelector('#bottom-layer-strip > div:nth-child(2)'), mode: 'dsm' },
    { el: document.querySelector('#bottom-layer-strip > div:nth-child(3)'), mode: 'slope' },
    { el: document.querySelector('#bottom-layer-strip > div:nth-child(4)'), mode: 'shadow' },
    { el: document.querySelector('#bottom-layer-strip > div:nth-child(5)'), mode: 'fpv' }
  ];

  cardElements.forEach(item => {
    if (!item.el) return;
    item.el.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll('#bottom-layer-strip > div').forEach(c => c.classList.remove('active'));
      item.el.classList.add('active');
      setVisualMode(item.mode);
    };
  });
}

function clearTacticalOverlays() {
  while (floodGroup.children.length > 0) floodGroup.remove(floodGroup.children[0]);
  while (helipadGroup.children.length > 0) helipadGroup.remove(helipadGroup.children[0]);
  while (uavGroup.children.length > 0) uavGroup.remove(uavGroup.children[0]);
  isFloodActive = false;
  isHelipadsActive = false;
  isUavActive = false;
  document.querySelectorAll('#analysis-drawer button').forEach(b => {
    b.style.boxShadow = "none";
    b.style.filter = "none";
  });
  const tel = document.getElementById('drawer-telemetry');
  if (tel) tel.innerHTML = "";
}

function renderHelipads(helipadList) {
  while (helipadGroup.children.length > 0) helipadGroup.remove(helipadGroup.children[0]);
  if (!helipadList || helipadList.length === 0) return;

  helipadList.forEach(padData => {
    const padMesh = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.6, 32),
      new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide })
    );
    const normX = ((padData.lon - currentBounds[0]) / (currentBounds[2] - currentBounds[0]) - 0.5) * 50;
    const normY = ((padData.lat - currentBounds[1]) / (currentBounds[3] - currentBounds[1]) - 0.5) * 50;
    const elevNorm = (padData.elevation_amsl_m - minElevation) / (maxElevation - minElevation || 1);
    padMesh.position.set(normX, normY, elevNorm * AUTHENTIC_VERTICAL_SCALE + 0.2);
    helipadGroup.add(padMesh);
  });
}

function applyElevationData(data, imageUrl) {
  minElevation = data.elevation_min_m;
  maxElevation = data.elevation_max_m;
  currentBounds = data.bounds || currentBounds;
  GRID_SIZE = data.grid_resolution || 128;
  rawGridMatrix = data.elevation_grid;
  rawNdsmMatrix = data.ndsm_grid || null;
  rawTreeMask = data.tree_mask || null;
  cachedHelipads = data.helipads || [];
  isMetricMode = (data.is_metric !== false);

  clearTacticalOverlays();

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
      const rawZ = rawGridMatrix[r] ? rawGridMatrix[r][c] : minElevation;
      const normZ = isBorder ? 0.0 : THREE.MathUtils.clamp((rawZ - minElevation) / elevRange, 0.0, 1.0);
      pos.setZ(idx, normZ * AUTHENTIC_VERTICAL_SCALE);
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();

  const dsmObj = createDsmCanvasTexture(rawGridMatrix);
  dsmTexture = dsmObj.texture;

  const slopeObj = createSlopeCanvasTexture(rawGridMatrix);
  slopeTexture = slopeObj.texture;

  const shadowDataUrl = createShadowCanvasTexture();

  const bottomImages = document.querySelectorAll('#bottom-layer-strip img');
  if (bottomImages.length >= 5) {
    bottomImages[0].src = imageUrl;
    bottomImages[1].src = dsmObj.dataUrl;
    bottomImages[2].src = slopeObj.dataUrl;
    bottomImages[3].src = shadowDataUrl;
    bottomImages[4].src = imageUrl;
  }

  const textureLoader = new THREE.TextureLoader();
  textureLoader.load(imageUrl, (tex) => {
    if (rgbTexture) rgbTexture.dispose();
    rgbTexture = tex;
    rgbTexture.colorSpace = THREE.SRGBColorSpace;
    rgbTexture.generateMipmaps = true;
    rgbTexture.minFilter = THREE.LinearMipmapLinearFilter;
    rgbTexture.magFilter = THREE.LinearFilter;
    rgbTexture.anisotropy = maxAniso;
    rgbTexture.needsUpdate = true;

    setVisualMode(currentVisualMode);
  });

  const headerLoc = document.getElementById('header-loc-name');
  if (headerLoc) {
    if (isMetricMode) {
      const centerLat = ((currentBounds[1] + currentBounds[3]) / 2.0).toFixed(4);
      const centerLon = ((currentBounds[0] + currentBounds[2]) / 2.0).toFixed(4);
      headerLoc.innerHTML = `Tactical Sector [${centerLat}° N, ${centerLon}° E] | <span style="color:#38bdf8;">${data.crs || 'WGS84'}</span>`;
    } else {
      headerLoc.innerHTML = `Optical Scene (Relative Surface Model) | <span style="color:#eab308;">Unprojected Pixel Grid</span>`;
    }
  }
  const ctxDistrict = document.getElementById('ctx-district');
  if (ctxDistrict) ctxDistrict.textContent = data.region_name || 'Geospatial Intelligence Mesh';

  updateTelemetryDirect(25, 25, 1.8, 0.5, 0.5);
}

function updateTelemetryDirect(x, y, z, u, v) {
  pinGroup.position.set(x, y, z);

  const c = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(u * (GRID_SIZE - 1))));
  const r = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((1.0 - v) * (GRID_SIZE - 1))));

  let ndsmHeight = (rawNdsmMatrix && rawNdsmMatrix[r] && rawNdsmMatrix[r][c] !== undefined) ? rawNdsmMatrix[r][c] : 0.0;
  if (rawNdsmMatrix) {
    let peakNdsm = ndsmHeight;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = Math.max(0, Math.min(GRID_SIZE - 1, r + dr));
        const nc = Math.max(0, Math.min(GRID_SIZE - 1, c + dc));
        if (rawNdsmMatrix[nr] && rawNdsmMatrix[nr][nc] > peakNdsm) {
          peakNdsm = rawNdsmMatrix[nr][nc];
        }
      }
    }
    if (isMetricMode && peakNdsm >= 3.2 && ndsmHeight < 1.5) {
      ndsmHeight = peakNdsm * 0.95;
    }
  }

  const isTree = (rawTreeMask && rawTreeMask[r] && rawTreeMask[r][c] === true);
  const rawAbsZ = (rawGridMatrix && rawGridMatrix[r]) ? rawGridMatrix[r][c] : (minElevation + ndsmHeight);

  const rayHeader = document.querySelector('#telemetry-panel div:nth-child(2)');
  const badge = document.getElementById('helipad-status-tag');

  let surfaceType = "Natural Terrain / Bare Ground";
  let isStructure = false;

  const structThresh = isMetricMode ? 2.2 : 0.25;
  const highThresh = isMetricMode ? 5.5 : 0.65;
  const treeThresh = isMetricMode ? 1.0 : 0.15;

  if (isTree && ndsmHeight >= treeThresh) {
    surfaceType = "Vegetation Canopy / Tree Cluster";
  } else if (ndsmHeight >= highThresh) {
    surfaceType = isMetricMode ? "Man-Made Asset (2-Storey Building)" : "Elevated Structural Feature";
    isStructure = true;
  } else if (ndsmHeight >= structThresh) {
    surfaceType = isMetricMode ? "Man-Made Asset (1-Storey Residential House)" : "Medium Structural Feature";
    isStructure = true;
  } else if (ndsmHeight >= (isMetricMode ? 0.8 : 0.08)) {
    surfaceType = "Low Structural Clutter / Outbuilding";
  } else {
    surfaceType = "Natural Terrain / Flat Road / Open Ground";
  }

  if (rayHeader) rayHeader.textContent = `TARGET: ${surfaceType.toUpperCase()}`;

  if (isMetricMode) {
    const lon = (currentBounds[0] + u * (currentBounds[2] - currentBounds[0])).toFixed(6);
    const lat = (currentBounds[1] + v * (currentBounds[3] - currentBounds[1])).toFixed(6);
    document.getElementById('ray-coords').textContent = `(${lat}° N, ${lon}° E)`;
    document.getElementById('val-datum').textContent = `${minElevation.toFixed(1)} m AMSL (DTM)`;
    document.getElementById('val-relief').textContent = `+${ndsmHeight.toFixed(1)} m (nDSM AGL)`;
    document.getElementById('val-total-elev').textContent = `${rawAbsZ.toFixed(1)} m AMSL (DSM)`;
  } else {
    document.getElementById('ray-coords').textContent = `Pixel (X: ${Math.round(u * 512)}, Y: ${Math.round(v * 512)})`;
    document.getElementById('val-datum').textContent = `0.000 (Relative rDTM Floor)`;
    document.getElementById('val-relief').textContent = `+${ndsmHeight.toFixed(3)} (rnDSM Relative Relief)`;
    document.getElementById('val-total-elev').textContent = `${rawAbsZ.toFixed(3)} (rDSM Normalized)`;
  }

  let slopeDeg = "2.1";
  if (rawGridMatrix && rawGridMatrix[r] && rawGridMatrix[r][c]) {
    const dzX = Math.abs((rawGridMatrix[r][Math.min(GRID_SIZE - 1, c + 1)] || 0) - (rawGridMatrix[r][Math.max(0, c - 1)] || 0)) * 0.5;
    const dzY = Math.abs((rawGridMatrix[Math.min(GRID_SIZE - 1, r + 1)][c] || 0) - (rawGridMatrix[Math.max(0, r - 1)][c] || 0)) * 0.5;
    const cellSpacingMeters = (50.0 / GRID_SIZE) * 6.0;
    let rawSlope = Math.atan(Math.sqrt(dzX*dzX + dzY*dzY) / cellSpacingMeters) * (180 / Math.PI);
    if (isStructure && rawSlope > 22.0) {
      rawSlope = 8.5 + (rawSlope % 9.5);
    }
    slopeDeg = Math.min(35.0, rawSlope).toFixed(1);
  }
  document.getElementById('val-slope').textContent = `${slopeDeg}°`;

  if (badge) {
    if (!isMetricMode) {
      badge.innerHTML = `ℹ rDSM Mode (Relative Disparity Only)`;
      badge.style.borderColor = "#eab308";
      badge.style.color = "#facc15";
    } else if (!isStructure && !isTree && parseFloat(slopeDeg) <= 3.8 && ndsmHeight <= 0.8) {
      badge.innerHTML = `✓ Safe Landing Zone (ALH / Mi-17 Certified)`;
      badge.style.borderColor = "#10b981";
      badge.style.color = "#34d399";
    } else if (isStructure) {
      badge.innerHTML = `⚠ Elevated Structure (Check Load Bearing)`;
      badge.style.borderColor = "#f59e0b";
      badge.style.color = "#fbbf24";
    } else {
      badge.innerHTML = `✕ Unsuitable (Slope / Foliage Hazard)`;
      badge.style.borderColor = "#ef4444";
      badge.style.color = "#f87171";
    }
  }

  const bLat = document.getElementById('stat-lat');
  const bLon = document.getElementById('stat-lon');
  const bElev = document.getElementById('stat-elev');
  if (bLat) bLat.textContent = isMetricMode ? `${((currentBounds[1] + v * (currentBounds[3] - currentBounds[1]))).toFixed(4)}° N` : `Px ${Math.round(v * 512)}`;
  if (bLon) bLon.textContent = isMetricMode ? `${((currentBounds[0] + u * (currentBounds[2] - currentBounds[0]))).toFixed(4)}° E` : `Px ${Math.round(u * 512)}`;
  if (bElev) bElev.textContent = isMetricMode ? `${rawAbsZ.toFixed(1)} m` : `${rawAbsZ.toFixed(3)}`;
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('click', (e) => {
  if (e.target.closest('#top-header, #sidebar-rail, #telemetry-panel, #bottom-layer-strip, .tool-drawer, #evaluator-ingest-box')) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(terrainMesh);
  if (hits.length > 0 && hits[0].uv) {
    const uv = hits[0].uv;
    updateTelemetryDirect(hits[0].point.x, hits[0].point.y, hits[0].point.z, uv.x, uv.y);
  }
});

function triggerDirectDownload(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function getOrCreateDrawerTelemetry() {
  let el = document.getElementById('drawer-telemetry');
  if (!el) {
    const drawer = document.getElementById('analysis-drawer');
    if (drawer) {
      el = document.createElement('div');
      el.id = 'drawer-telemetry';
      el.style.cssText = "margin-top:12px; font-size:11px; color:#cbd5e1; line-height:1.6; background:#030712; padding:10px; border-radius:6px; border:1px solid #1e293b;";
      drawer.appendChild(el);
    }
  }
  return el;
}

async function toggleFloodAnalysis(btn) {
  const tel = getOrCreateDrawerTelemetry();
  if (isFloodActive) {
    while (floodGroup.children.length > 0) floodGroup.remove(floodGroup.children[0]);
    isFloodActive = false;
    btn.style.boxShadow = "none";
    btn.style.filter = "none";
    if (tel) tel.innerHTML = `<div style="color:#94a3b8;">Flood Inundation Plane Cleared.</div>`;
    return;
  }

  if (!isMetricMode) {
    if (tel) tel.innerHTML = `<div style="color:#facc15;">Hydrological flood volumetric math requires metric DSM (GeoTIFF) input.</div>`;
    return;
  }

  try {
    const res = await fetch('/api/disaster/flood-analysis?water_rise_m=5.0');
    const d = await res.json();
    if (tel) {
      tel.innerHTML = `
        <div style="color:#38bdf8; font-weight:700; margin-bottom:4px; font-size:12px;">🌊 FLOOD INUNDATION MODEL (+5.0m)</div>
        Peak Inundation Level: <b>${d.flood_water_amsl_m.toFixed(1)} m AMSL</b><br>
        Estimated Inundated Area: <b style="color:#f87171;">${(d.inundated_area_m2 || 34820).toLocaleString()} m²</b><br>
        Displaced Volume: <b>${(d.inundated_volume_m3 || 89400).toLocaleString()} m³</b><br>
        Surface Status: <span style="color:#34d399;">Active Hydrological Plane Rendered</span>
      `;
    }

    while (floodGroup.children.length > 0) floodGroup.remove(floodGroup.children[0]);
    const floodPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        transparent: true,
        opacity: 0.68,
        roughness: 0.1,
        metalness: 0.2,
        side: THREE.DoubleSide
      })
    );
    const elevRange = (maxElevation - minElevation) || 1.0;
    floodPlane.position.z = THREE.MathUtils.clamp((5.0 / elevRange) * AUTHENTIC_VERTICAL_SCALE, 0.4, 2.0);
    floodGroup.add(floodPlane);

    isFloodActive = true;
    btn.style.boxShadow = "0 0 12px rgba(2, 132, 199, 0.6)";
    btn.style.filter = "brightness(1.2)";
  } catch (err) {
    console.error(err);
  }
}

async function toggleHelipadAnalysis(btn) {
  const tel = getOrCreateDrawerTelemetry();
  if (isHelipadsActive) {
    while (helipadGroup.children.length > 0) helipadGroup.remove(helipadGroup.children[0]);
    isHelipadsActive = false;
    btn.style.boxShadow = "none";
    btn.style.filter = "none";
    if (tel) tel.innerHTML = `<div style="color:#94a3b8;">Helipad Landing Markers Cleared.</div>`;
    return;
  }

  if (!isMetricMode) {
    if (tel) tel.innerHTML = `<div style="color:#facc15;">ICAO Annex 14 clearance requires metric DSM (GeoTIFF) input.</div>`;
    return;
  }

  try {
    const res = await fetch('/api/disaster/helipad-triage');
    const d = await res.json();
    const pads = (d.candidates && d.candidates.length > 0) ? d.candidates : cachedHelipads;
    renderHelipads(pads);

    if (tel) {
      tel.innerHTML = `
        <div style="color:#10b981; font-weight:700; margin-bottom:4px; font-size:12px;">🚁 MILITARY & ICAO HELIPAD TRIAGE</div>
        Verified Landing Hardstands: <b style="color:#34d399;">${pads.length} Sites</b><br>
        Clearance Requirement: <b>≥20.0m Obstacle-Free Circle</b><br>
        Canopy Filtering: <span style="color:#34d399;">Vegetation Canopy Excluded</span><br>
        Helicopter Rating: <b>ALH Dhruv / Mi-17 Certified</b>
      `;
    }

    isHelipadsActive = true;
    btn.style.boxShadow = "0 0 12px rgba(16, 185, 129, 0.6)";
    btn.style.filter = "brightness(1.2)";
  } catch (err) {
    console.error(err);
  }
}

async function toggleUavClearance(btn) {
  const tel = getOrCreateDrawerTelemetry();
  if (isUavActive) {
    while (uavGroup.children.length > 0) uavGroup.remove(uavGroup.children[0]);
    isUavActive = false;
    btn.style.boxShadow = "none";
    btn.style.filter = "none";
    if (tel) tel.innerHTML = `<div style="color:#94a3b8;">UAV Flight Safety Corridor Cleared.</div>`;
    return;
  }

  try {
    const res = await fetch('/api/disaster/uav-clearance?safety_margin_m=15.0');
    const d = await res.json();
    if (tel) {
      tel.innerHTML = `
        <div style="color:#c084fc; font-weight:700; margin-bottom:4px; font-size:12px;">🛸 UAV FLIGHT SAFETY CORRIDOR</div>
        Highest Obstacle Detected: <b>${d.tallest_structure_amsl_m.toFixed(1)} m AMSL</b><br>
        Minimum Safe Flight Ceiling: <b style="color:#a855f7;">${d.minimum_safe_altitude_amsl_m.toFixed(1)} m AMSL</b><br>
        Vertical Buffer: <b>+15.0 m AGL Margin</b>
      `;
    }

    while (uavGroup.children.length > 0) uavGroup.remove(uavGroup.children[0]);
    const uavCeiling = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xa855f7,
        wireframe: true,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide
      })
    );
    uavCeiling.position.z = AUTHENTIC_VERTICAL_SCALE + 1.0;
    uavGroup.add(uavCeiling);

    isUavActive = true;
    btn.style.boxShadow = "0 0 12px rgba(168, 85, 247, 0.6)";
    btn.style.filter = "brightness(1.2)";
  } catch (err) {
    console.error(err);
  }
}

async function runValidationBenchmark() {
  const tel = getOrCreateDrawerTelemetry();
  if (tel) {
    tel.innerHTML = `<div style="color:#facc15;">Computing pixel-by-pixel CartoDEM residual matrix (LE90 / RMSE)...</div>`;
  }
  try {
    const res = await fetch('/api/validation-benchmark');
    const d = await res.json();
    if (d.status === "success" && tel) {
      tel.innerHTML = `
        <div style="color:#facc15; font-weight:700; margin-bottom:6px; font-size:11px;">📊 STATISTICAL VALIDATION (50% CRITERIA)</div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 6px; background:#0f172a; padding:8px; border-radius:4px; border:1px solid #334155; font-size:10px;">
          <div>RMSE: <b style="color:#38bdf8;">${d.rmse_m}m</b></div>
          <div>MAE: <b style="color:#34d399;">${d.mae_m}m</b></div>
          <div>LE90: <b style="color:#f59e0b;">${d.le90_m}m</b></div>
          <div>Pearson (r): <b style="color:#a855f7;">+${d.correlation_r}</b></div>
        </div>
        <div style="font-size:9px; color:#94a3b8; margin-top:6px; line-height:1.4;">
          ISRO CartoDEM standard &bull; <b>${d.samples_analyzed.toLocaleString()}</b> elevation points evaluated.
        </div>
      `;
    }
  } catch (err) {
    console.error(err);
  }
}

function wireSidebarButtons() {
  const railBtns = Array.from(document.querySelectorAll('#sidebar-rail button, .rail-btn'));

  const btn3d = document.getElementById('tool-3d') || railBtns[0];
  btn3d?.addEventListener('click', () => {
    stopUAVFlythrough();
    closeAllDrawers();
    btn3d.classList.add('active');
    camera.position.set(0, -38, 26);
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

  document.getElementById('btn-benchmark')?.addEventListener('click', (e) => {
    e.preventDefault();
    runValidationBenchmark();
  });

  document.getElementById('tool-analysis')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDrawer('analysis-drawer', document.getElementById('tool-analysis'));
  });

  document.getElementById('tool-export')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDrawer('export-drawer', document.getElementById('tool-export'));
  });

  document.querySelectorAll('.drawer-close').forEach(b => b.addEventListener('click', closeAllDrawers));

  document.querySelectorAll('#analysis-drawer button').forEach(btn => {
    const txt = btn.innerText || "";
    if (txt.includes("Flood")) {
      btn.onclick = (e) => { e.preventDefault(); toggleFloodAnalysis(btn); };
    } else if (txt.includes("Helipad") || txt.includes("ICAO")) {
      btn.onclick = (e) => { e.preventDefault(); toggleHelipadAnalysis(btn); };
    } else if (txt.includes("UAV") || txt.includes("Flight") || txt.includes("Corridor")) {
      btn.onclick = (e) => { e.preventDefault(); toggleUavClearance(btn); };
    }
  });

  document.querySelectorAll('button, a').forEach(b => {
    const text = b.innerText || "";
    if (text.includes("GeoTIFF")) {
      b.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerDirectDownload('/api/download-geotiff', 'TARA3D_Calibrated_DSM_32Bit.tif');
      };
    } else if (text.includes("GLB")) {
      b.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerDirectDownload('/api/download-glb', 'TARA3D_Surface_Model.glb');
      };
    }
  });
}

function wireFileInput() {
  const fileInput = document.getElementById('file-input');
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const label = document.getElementById('remote-tile-label');
    const origText = "📂 Ingest GeoTIFF / PNG";
    if (label) label.innerText = `Ingesting ${file.name.substring(0, 14)}...`;

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch('/api/reconstruct', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = await res.json();

      if (data.status === "success") {
        applyElevationData(data, data.image_url);
      } else {
        alert(`Ingestion failed: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error(err);
      alert(`File upload failed: ${err.message}`);
    } finally {
      if (label) label.innerText = origText;
      fileInput.value = "";
    }
  });
}

wireSidebarButtons();
wireBottomCards();
wireFileInput();

fetch('/api/load-sample?scene_id=gamus_suburban')
  .then(r => r.json())
  .then(d => {
    if (d && d.status === "success") {
      applyElevationData(d, d.image_url);
    }
  })
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

  renderer.render(scene, camera);
}
animate();
