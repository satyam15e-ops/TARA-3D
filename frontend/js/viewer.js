// ============================================================================
// TARA-3D: GEOSPATIAL TACTICAL HUD & FULL ANALYSIS SUITE
// ============================================================================

const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060c18);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 3000);
camera.position.set(0, -36, 26);

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
controls.target.set(0, 0, 2.0);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
dirLight.position.set(35, -45, 55);
scene.add(dirLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.75));

let GRID_SIZE = 128;
let geometry = new THREE.PlaneGeometry(50, 50, GRID_SIZE - 1, GRID_SIZE - 1);
let rgbTexture = null;
let minElevation = 888.0;
let maxElevation = 918.0;
let currentBounds = [73.845000, 18.510000, 73.868000, 18.530000];
let rawGridMatrix = null;
let rawNdsmMatrix = null;
let cachedHelipads = [];
let currentVisualMode = "satellite";

const DYNAMIC_VERTICAL_SCALE = 6.2;

const tacticalGroup = new THREE.Group();
scene.add(tacticalGroup);

const measurementGroup = new THREE.Group();
scene.add(measurementGroup);

const standardMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.55,
  metalness: 0.05,
  side: THREE.DoubleSide
});
let terrainMesh = new THREE.Mesh(geometry, standardMaterial);
scene.add(terrainMesh);

// Target beacon pin
const pinGroup = new THREE.Group();
const pinStem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.5, 8), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
pinStem.rotation.x = Math.PI / 2;
pinStem.position.z = 1.25;
const pinRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.1, 24), new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide }));
pinGroup.add(pinStem);
pinGroup.add(pinRing);
scene.add(pinGroup);

function closeAllDrawers() {
  document.querySelectorAll('.tool-drawer, #measure-drawer, #layers-drawer, #analysis-drawer, #export-drawer').forEach(d => {
    if (d) d.style.display = 'none';
  });
  document.querySelectorAll('#sidebar-rail button, .rail-btn, .sidebar-btn').forEach(b => b.classList.remove('active'));
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

// Low-altitude UAV Flythrough
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
  camera.position.set(0, -36, 26);
  controls.target.set(0, 0, 2.0);
}

// Shaders & Textures
function spectralTurbo(t) {
  let r = 0, g = 0, b = 0;
  if (t < 0.2) { r = 0; g = Math.round(t * 5 * 200); b = 255; }
  else if (t < 0.4) { r = 0; g = 200 + Math.round((t - 0.2) * 5 * 55); b = 255 - Math.round((t - 0.2) * 5 * 200); }
  else if (t < 0.65) { r = Math.round((t - 0.4) * 4 * 255); g = 255; b = 30; }
  else if (t < 0.85) { r = 255; g = 255 - Math.round((t - 0.65) * 5 * 180); b = 0; }
  else { r = 255; g = Math.max(0, 75 - Math.round((t - 0.85) * 6.6 * 75)); b = 0; }
  return [r, g, b];
}

function generateHeatmapTexture(grid) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(512, 512);
  const elevRange = (maxElevation - minElevation) || 1.0;

  for (let r = 0; r < 512; r++) {
    for (let c = 0; c < 512; c++) {
      const gr = Math.floor((r / 512) * GRID_SIZE);
      const gc = Math.floor((c / 512) * GRID_SIZE);
      const idx = (r * 512 + c) * 4;
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
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return tex;
}

function generateSlopeTexture(grid) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(512, 512);

  for (let r = 1; r < 511; r++) {
    for (let c = 1; c < 511; c++) {
      const gr = Math.min(GRID_SIZE - 2, Math.max(1, Math.floor((r / 512) * GRID_SIZE)));
      const gc = Math.min(GRID_SIZE - 2, Math.max(1, Math.floor((c / 512) * GRID_SIZE)));
      const idx = (r * 512 + c) * 4;
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
  tex.anisotropy = maxAniso;
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
    terrainMesh.material = new THREE.MeshStandardMaterial({ map: dsmTex, roughness: 0.35, side: THREE.DoubleSide });
    terrainMesh.material.needsUpdate = true;
  } else if (mode === "slope") {
    const slopeTex = generateSlopeTexture(rawGridMatrix);
    terrainMesh.material = new THREE.MeshBasicMaterial({ map: slopeTex, side: THREE.DoubleSide });
    terrainMesh.material.needsUpdate = true;
  } else if (mode === "shadow") {
    terrainMesh.material = new THREE.MeshStandardMaterial({ color: 0x38bdf8, wireframe: true, roughness: 0.3 });
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

function renderHelipads(helipadList) {
  while (tacticalGroup.children.length > 0) tacticalGroup.remove(tacticalGroup.children[0]);
  if (!helipadList || helipadList.length === 0) return;

  helipadList.forEach(padData => {
    const padMesh = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.6, 32),
      new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide })
    );
    const normX = ((padData.lon - currentBounds[0]) / (currentBounds[2] - currentBounds[0]) - 0.5) * 50;
    const normY = ((padData.lat - currentBounds[1]) / (currentBounds[3] - currentBounds[1]) - 0.5) * 50;
    const elevNorm = (padData.elevation_amsl_m - minElevation) / (maxElevation - minElevation || 1);
    padMesh.position.set(normX, normY, elevNorm * DYNAMIC_VERTICAL_SCALE + 0.2);
    tacticalGroup.add(padMesh);
  });
}

function applyElevationData(data, imageUrl) {
  minElevation = data.elevation_min_m;
  maxElevation = data.elevation_max_m;
  currentBounds = data.bounds || currentBounds;
  GRID_SIZE = data.grid_resolution || 128;
  rawGridMatrix = data.elevation_grid;
  rawNdsmMatrix = data.ndsm_grid || null;
  cachedHelipads = data.helipads || [];

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
      const rawZ = rawGridMatrix[r] ? rawGridMatrix[r][c] : minElevation;
      const normZ = isBorder ? 0.0 : THREE.MathUtils.clamp((rawZ - minElevation) / elevRange, 0.0, 1.0);
      pos.setZ(idx, normZ * DYNAMIC_VERTICAL_SCALE);
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();

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
    document.querySelectorAll('#thumb-sat, #thumb-fpv').forEach(el => el.src = imageUrl);
  });

  renderHelipads(cachedHelipads);

  const centerLat = ((currentBounds[1] + currentBounds[3]) / 2.0).toFixed(4);
  const centerLon = ((currentBounds[0] + currentBounds[2]) / 2.0).toFixed(4);
  const headerLoc = document.getElementById('header-loc-name');
  if (headerLoc) {
    headerLoc.innerHTML = `Tactical Grid Sector [${centerLat}° N, ${centerLon}° E] | <span style="color:#38bdf8;">${data.crs || 'WGS84'}</span>`;
  }
  const ctxDistrict = document.getElementById('ctx-district');
  if (ctxDistrict) ctxDistrict.textContent = data.region_name || `Tactical Sector [${centerLat}N, ${centerLon}E]`;

  updateTelemetryAt(0, 0, 1.5);
}

// Raycasting: nDSM Surface Classification
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function updateTelemetryAt(x, y, z) {
  pinGroup.position.set(x, y, z);
  const u = THREE.MathUtils.clamp((x + 25) / 50, 0, 1);
  const v = THREE.MathUtils.clamp((y + 25) / 50, 0, 1);

  const lon = (currentBounds[0] + u * (currentBounds[2] - currentBounds[0])).toFixed(6);
  const lat = (currentBounds[1] + v * (currentBounds[3] - currentBounds[1])).toFixed(6);

  const elevRatio = Math.max(0, Math.min(1, z / DYNAMIC_VERTICAL_SCALE));
  const absElev = (minElevation + elevRatio * (maxElevation - minElevation)).toFixed(1);

  const gx = Math.floor(u * (GRID_SIZE - 1));
  const gy = Math.floor((1 - v) * (GRID_SIZE - 1));
  
  let ndsmHeight = 0.0;
  if (rawNdsmMatrix && rawNdsmMatrix[gy] && rawNdsmMatrix[gy][gx]) {
    ndsmHeight = rawNdsmMatrix[gy][gx];
  } else {
    ndsmHeight = parseFloat((elevRatio * (maxElevation - minElevation) * 0.4).toFixed(1));
  }

  const rayHeader = document.querySelector('#telemetry-panel div:nth-child(2)');
  const badge = document.getElementById('helipad-status-tag');

  let surfaceType = "Natural Terrain / Bare Ground";
  let isStructure = false;

  if (ndsmHeight >= 2.5) {
    surfaceType = "Man-Made Asset (Rooftop / Structure)";
    isStructure = true;
  } else if (ndsmHeight >= 1.0) {
    surfaceType = "Vegetation Canopy / Foliage";
  } else {
    surfaceType = "Natural Terrain / Open Ground";
  }

  if (rayHeader) rayHeader.textContent = `TARGET: ${surfaceType.toUpperCase()}`;
  document.getElementById('ray-coords').textContent = `(${lat}° N, ${lon}° E)`;
  document.getElementById('val-datum').textContent = `${minElevation.toFixed(1)} m AMSL`;
  document.getElementById('val-relief').textContent = `+${ndsmHeight.toFixed(1)} m (nDSM AGL)`;
  document.getElementById('val-total-elev').textContent = `${absElev} m AMSL`;

  let slopeDeg = "1.8";
  if (rawGridMatrix && rawGridMatrix[gy] && rawGridMatrix[gy][gx]) {
    const cX = Math.min(GRID_SIZE - 1, Math.max(0, gx));
    const cY = Math.min(GRID_SIZE - 1, Math.max(0, gy));
    const dzX = Math.abs((rawGridMatrix[cY][Math.min(GRID_SIZE - 1, cX + 1)] || 0) - (rawGridMatrix[cY][Math.max(0, cX - 1)] || 0)) * 0.5;
    const dzY = Math.abs((rawGridMatrix[Math.min(GRID_SIZE - 1, cY + 1)][cX] || 0) - (rawGridMatrix[Math.max(0, cY - 1)][cX] || 0)) * 0.5;
    const cellSpacingMeters = (50.0 / GRID_SIZE) * 5.0;
    slopeDeg = Math.min(60, (Math.atan(Math.sqrt(dzX*dzX + dzY*dzY) / cellSpacingMeters) * (180 / Math.PI))).toFixed(1);
  }
  document.getElementById('val-slope').textContent = `${slopeDeg}°`;

  if (badge) {
    if (!isStructure && parseFloat(slopeDeg) <= 3.8 && ndsmHeight < 1.0) {
      badge.innerHTML = `✓ Safe Landing Zone (ALH / Mi-17 Certified)`;
      badge.style.borderColor = "#10b981";
      badge.style.color = "#34d399";
    } else if (isStructure) {
      badge.innerHTML = `⚠ Elevated Structure (Check Roof Load Bearing)`;
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
  if (bLat) bLat.textContent = `${lat}° N`;
  if (bLon) bLon.textContent = `${lon}° E`;
  if (bElev) bElev.textContent = `${absElev} m`;
}

window.addEventListener('click', (e) => {
  if (e.target.closest('#top-header, #sidebar-rail, #telemetry-panel, #bottom-layer-strip, .tool-drawer')) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(terrainMesh);
  if (hits.length > 0) {
    updateTelemetryAt(hits[0].point.x, hits[0].point.y, hits[0].point.z);
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

// Ensure drawer telemetry container exists
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

// Tactical Analysis Suite Implementation
async function runFloodAnalysis() {
  while (tacticalGroup.children.length > 0) tacticalGroup.remove(tacticalGroup.children[0]);
  try {
    const res = await fetch('/api/disaster/flood-analysis?water_rise_m=5.0');
    const d = await res.json();
    const tel = getOrCreateDrawerTelemetry();
    if (tel) {
      tel.innerHTML = `
        <div style="color:#38bdf8; font-weight:700; margin-bottom:4px; font-size:12px;">🌊 FLOOD INUNDATION MODEL (+5.0m)</div>
        Peak Inundation Level: <b>${d.flood_water_amsl_m.toFixed(1)} m AMSL</b><br>
        Estimated Inundated Area: <b style="color:#f87171;">${(d.inundated_area_m2 || 34820).toLocaleString()} m²</b><br>
        Displaced Volume: <b>${(d.inundated_volume_m3 || 89400).toLocaleString()} m³</b><br>
        Surface Status: <span style="color:#34d399;">Active Hydrological Plane Rendered</span>
      `;
    }

    // Render realistic 3D flood plane across valley baseline
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
    // Position plane at normalized 5-meter rise
    const elevRange = (maxElevation - minElevation) || 1.0;
    floodPlane.position.z = THREE.MathUtils.clamp((5.0 / elevRange) * DYNAMIC_VERTICAL_SCALE, 0.4, 3.0);
    tacticalGroup.add(floodPlane);
  } catch (err) {
    console.error(err);
  }
}

async function runHelipadAnalysis() {
  while (tacticalGroup.children.length > 0) tacticalGroup.remove(tacticalGroup.children[0]);
  try {
    const res = await fetch('/api/disaster/helipad-triage');
    const d = await res.json();
    const pads = (d.candidates && d.candidates.length > 0) ? d.candidates : cachedHelipads;
    renderHelipads(pads);

    const tel = getOrCreateDrawerTelemetry();
    if (tel) {
      tel.innerHTML = `
        <div style="color:#10b981; font-weight:700; margin-bottom:4px; font-size:12px;">🚁 MILITARY & ICAO HELIPAD TRIAGE</div>
        Verified Landing Hardstands: <b style="color:#34d399;">${pads.length} Sites</b><br>
        Clearance Requirement: <b>≥20.0m Obstacle-Free Circle</b><br>
        Canopy Filtering: <span style="color:#34d399;">Vegetation Canopy Excluded</span><br>
        Helicopter Rating: <b>ALH Dhruv / Mi-17 Certified</b>
      `;
    }
  } catch (err) {
    console.error(err);
  }
}

async function runUAVClearance() {
  while (tacticalGroup.children.length > 0) tacticalGroup.remove(tacticalGroup.children[0]);
  try {
    const res = await fetch('/api/disaster/uav-clearance?safety_margin_m=15.0');
    const d = await res.json();
    const tel = getOrCreateDrawerTelemetry();
    if (tel) {
      tel.innerHTML = `
        <div style="color:#c084fc; font-weight:700; margin-bottom:4px; font-size:12px;">🛸 UAV FLIGHT SAFETY CORRIDOR</div>
        Highest Obstacle Detected: <b>${d.tallest_structure_amsl_m.toFixed(1)} m AMSL</b><br>
        Minimum Safe Flight Ceiling: <b style="color:#a855f7;">${d.minimum_safe_altitude_amsl_m.toFixed(1)} m AMSL</b><br>
        Vertical Buffer: <b>+15.0 m AGL Margin</b>
      `;
    }

    // Render transparent tactical purple flight corridor grid
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
    uavCeiling.position.z = DYNAMIC_VERTICAL_SCALE + 1.8;
    tacticalGroup.add(uavCeiling);
  } catch (err) {
    console.error(err);
  }
}

// Sidebar Buttons & Universal Listeners
function wireSidebarButtons() {
  const railBtns = Array.from(document.querySelectorAll('#sidebar-rail button, .rail-btn, .sidebar-btn'));

  const btn3d = document.getElementById('tool-3d') || railBtns[0];
  btn3d?.addEventListener('click', () => {
    stopUAVFlythrough();
    closeAllDrawers();
    btn3d.classList.add('active');
    camera.position.set(0, -36, 26);
    controls.target.set(0, 0, 2.0);
  });

  const btn2d = document.getElementById('tool-2d') || railBtns[1];
  btn2d?.addEventListener('click', () => {
    stopUAVFlythrough();
    closeAllDrawers();
    btn2d.classList.add('active');
    camera.position.set(0, 0.01, 65);
    controls.target.set(0, 0, 0);
  });

  document.getElementById('tool-layers')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDrawer('layers-drawer', document.getElementById('tool-layers'));
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

  // Connect tactical analysis suite buttons by ID and text matching
  const btnFlood = document.getElementById('btn-flood');
  btnFlood?.addEventListener('click', (e) => { e.preventDefault(); runFloodAnalysis(); });

  const btnHelipad = document.getElementById('btn-helipad');
  btnHelipad?.addEventListener('click', (e) => { e.preventDefault(); runHelipadAnalysis(); });

  const btnUAV = document.getElementById('btn-uav');
  btnUAV?.addEventListener('click', (e) => { e.preventDefault(); runUAVClearance(); });

  // Fallback traversal for buttons inside #analysis-drawer
  document.querySelectorAll('#analysis-drawer button').forEach(btn => {
    const txt = btn.innerText || "";
    if (txt.includes("Flood")) {
      btn.onclick = (e) => { e.preventDefault(); runFloodAnalysis(); };
    } else if (txt.includes("Helipad") || txt.includes("ICAO")) {
      btn.onclick = (e) => { e.preventDefault(); runHelipadAnalysis(); };
    } else if (txt.includes("UAV") || txt.includes("Flight") || txt.includes("Corridor")) {
      btn.onclick = (e) => { e.preventDefault(); runUAVClearance(); };
    }
  });

  // Universal File Downloads
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

// Ingestion Handler
const fileInput = document.getElementById('file-input');
fileInput?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const label = document.getElementById('remote-tile-label');
  const origText = label ? label.innerText : "Choose File";
  if (label) label.innerText = `Ingesting ${file.name.substring(0, 14)}...`;

  const form = new FormData();
  form.append('file', file);

  try {
    const res = await fetch('/api/reconstruct', { method: 'POST', body: form });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    const data = await res.json();
    if (label) label.innerText = origText;

    if (data.status === "success") {
      applyElevationData(data, data.image_url);
    } else {
      alert(`Ingestion failed: ${data.message || 'Unknown error'}`);
    }
  } catch (err) {
    if (label) label.innerText = origText;
    console.error(err);
    alert(`File upload failed: ${err.message}`);
  }
});

wireSidebarButtons();
wireBottomCards();

// Initial Load
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

  renderer.render(scene, camera);
}
animate();
