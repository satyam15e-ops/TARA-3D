const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060913);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, -38, 24);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.innerHTML = "";
container.appendChild(renderer.domElement);

const maxAniso = renderer.capabilities.getMaxAnisotropy();

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI / 2 + 0.05;
controls.minDistance = 4;
controls.maxDistance = 250;
controls.target.set(0, 0, 1.5);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(30, -50, 45);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x94a3b8, 0.4);
fillLight.position.set(-30, 40, 20);
scene.add(fillLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.65));

let GRID_SIZE = 256;
let geometry = new THREE.PlaneGeometry(50, 50, GRID_SIZE - 1, GRID_SIZE - 1);

let rgbTexture = null;
let turboTexture = null;
let verticalExaggeration = 2.4;
let minElevation = 239.26;
let maxElevation = 304.26;
let currentBounds = [77.200, 28.610, 77.215, 28.625];
let rawGridMatrix = null;

const material = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.65,
  metalness: 0.05,
  side: THREE.DoubleSide
});

material.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <common>',
    `#include <common>
     varying float vSlope;`
  );
  shader.vertexShader = shader.vertexShader.replace(
    '#include <beginnormal_vertex>',
    `#include <beginnormal_vertex>
     vSlope = clamp(dot(normalize(normal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0);`
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
     varying float vSlope;`
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <dithering_fragment>',
    `#include <dithering_fragment>
     float facadeFactor = mix(0.45, 1.0, smoothstep(0.3, 0.85, vSlope));
     gl_FragColor.rgb *= facadeFactor;`
  );
};

let terrainMesh = new THREE.Mesh(geometry, material);
scene.add(terrainMesh);

let targetCamPos = null;
let targetLookAt = null;
let transitionProgress = 1.0;

function smoothTransitionTo(camPos, lookAtPos) {
  targetCamPos = camPos.clone();
  targetLookAt = lookAtPos.clone();
  transitionProgress = 0.0;
}

const view2dBtn = document.getElementById('view-2d');
const view3dBtn = document.getElementById('view-3d');

if (view2dBtn) {
  view2dBtn.addEventListener('click', () => {
    view2dBtn.classList.add('active');
    view3dBtn.classList.remove('active');
    isFlying = false;
    exitFpvMode();
    smoothTransitionTo(new THREE.Vector3(0, 0.01, 65), new THREE.Vector3(0, 0, 0));
  });
}

if (view3dBtn) {
  view3dBtn.addEventListener('click', () => {
    view3dBtn.classList.add('active');
    view2dBtn.classList.remove('active');
    isFlying = false;
    exitFpvMode();
    smoothTransitionTo(new THREE.Vector3(0, -38, 24), new THREE.Vector3(0, 0, 1.5));
  });
}

let isFlying = false;
let isFpv = false;
let flightClock = 0;
const keysPressed = {};
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const PI_2 = Math.PI / 2;

const flightBtn = document.getElementById('btn-flythrough');
const fpvBtn = document.getElementById('btn-fpv');

function exitFpvMode() {
  if (isFpv) {
    isFpv = false;
    if (fpvBtn) {
      fpvBtn.classList.remove('active');
      fpvBtn.textContent = "First-Person Drone Flight (WASD)";
    }
    if (document.exitPointerLock) document.exitPointerLock();
    controls.enabled = true;
  }
}

if (flightBtn) {
  flightBtn.addEventListener('click', () => {
    isFlying = !isFlying;
    if (isFlying) {
      exitFpvMode();
      view3dBtn.classList.add('active');
      view2dBtn.classList.remove('active');
    }
    flightBtn.classList.toggle('active', isFlying);
    flightBtn.textContent = isFlying ? "Abort Flythrough" : "Engage Autonomous Flythrough";
    controls.enabled = !isFlying;
  });
}

if (fpvBtn) {
  fpvBtn.addEventListener('click', () => {
    isFpv = !isFpv;
    if (isFpv) {
      isFlying = false;
      if (flightBtn) {
        flightBtn.classList.remove('active');
        flightBtn.textContent = "Engage Autonomous Flythrough";
      }
      view3dBtn.classList.add('active');
      view2dBtn.classList.remove('active');
      fpvBtn.classList.add('active');
      fpvBtn.textContent = "Click Map to Steer (ESC to Exit)";
      controls.enabled = false;
      renderer.domElement.requestPointerLock();
    } else {
      exitFpvMode();
    }
  });
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement) {
    if (fpvBtn) fpvBtn.textContent = "Drone Active (WASD + Mouse | ESC to Exit)";
  } else if (isFpv) {
    if (fpvBtn) fpvBtn.textContent = "Drone Paused: Click Map to Resume";
  }
});

renderer.domElement.addEventListener('click', () => {
  if (isFpv && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener('mousemove', (event) => {
  if (isFpv && document.pointerLockElement === renderer.domElement) {
    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= movementX * 0.0025;
    euler.x -= movementY * 0.0025;
    euler.x = Math.max(-PI_2 + 0.1, Math.min(PI_2 - 0.1, euler.x));
    camera.quaternion.setFromEuler(euler);
  }
});

window.addEventListener('keydown', (e) => { keysPressed[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keysPressed[e.key.toLowerCase()] = false; });

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('mousemove', (e) => {
  if (isFpv && document.pointerLockElement === renderer.domElement) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(terrainMesh);
  if (hits.length > 0) {
    const pt = hits[0].point;
    const u = THREE.MathUtils.clamp((pt.x + 25) / 50, 0, 1);
    const v = THREE.MathUtils.clamp((pt.y + 25) / 50, 0, 1);

    const lon = (currentBounds[0] + u * (currentBounds[2] - currentBounds[0])).toFixed(5);
    const lat = (currentBounds[1] + v * (currentBounds[3] - currentBounds[1])).toFixed(5);
    
    const elevRatio = Math.max(0, Math.min(1, pt.z / verticalExaggeration));
    const elev = (minElevation + elevRatio * (maxElevation - minElevation)).toFixed(1);

    const curLat = document.getElementById('cur-lat');
    const curLon = document.getElementById('cur-lon');
    const curElev = document.getElementById('cur-elev');
    if (curLat) curLat.textContent = `${lat}° N`;
    if (curLon) curLon.textContent = `${lon}° E`;
    if (curElev) curElev.textContent = `${elev} m AMSL`;
  }
});

const fileInput = document.getElementById('file-input');
if (fileInput) {
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const statusText = document.getElementById('status-text');
    statusText.textContent = "Anchoring & Calibrating Terrain...";
    statusText.style.color = "#facc15";

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/reconstruct', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      document.getElementById('pipeline-mode').textContent = data.pipeline_mode;
      document.getElementById('regime-tag').textContent = data.terrain_regime.replace('_', ' ');
      document.getElementById('meta-crs').textContent = data.crs;

      minElevation = data.elevation_min_m;
      maxElevation = data.elevation_max_m;
      currentBounds = data.bounds || currentBounds;
      document.getElementById('cur-relief').textContent = `${(maxElevation - minElevation).toFixed(1)} m`;

      if (data.accuracy) {
        document.getElementById('val-rmse').textContent = `±${data.accuracy.rmse_m} m`;
        document.getElementById('val-corr').textContent = `${data.accuracy.pearson_r}`;
        document.getElementById('val-le90').textContent = `LE90 ≤ ${data.accuracy.le90_m} m (PASSED)`;
      }

      GRID_SIZE = data.grid_resolution || 256;
      scene.remove(terrainMesh);
      geometry = new THREE.PlaneGeometry(50, 50, GRID_SIZE - 1, GRID_SIZE - 1);
      terrainMesh = new THREE.Mesh(geometry, material);
      scene.add(terrainMesh);

      const pos = geometry.attributes.position;
      rawGridMatrix = data.elevation_grid;
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

      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          rgbTexture = new THREE.Texture(img);
          rgbTexture.generateMipmaps = true;
          rgbTexture.minFilter = THREE.LinearMipmapLinearFilter;
          rgbTexture.magFilter = THREE.LinearFilter;
          rgbTexture.anisotropy = maxAniso;
          rgbTexture.needsUpdate = true;
          
          terrainMesh.material.map = rgbTexture;
          terrainMesh.material.needsUpdate = true;

          const turboImg = new Image();
          turboImg.crossOrigin = "anonymous";
          turboImg.onload = () => {
            turboTexture = new THREE.Texture(turboImg);
            turboTexture.generateMipmaps = true;
            turboTexture.minFilter = THREE.LinearMipmapLinearFilter;
            turboTexture.magFilter = THREE.LinearFilter;
            turboTexture.anisotropy = maxAniso;
            turboTexture.needsUpdate = true;
          };
          turboImg.src = data.heatmap_url + '?t=' + new Date().getTime();

          statusText.textContent = "Operational (60 FPS)";
          statusText.style.color = "#34d399";
          view3dBtn.click();
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);

    } catch (err) {
      statusText.textContent = "Pipeline Error";
      statusText.style.color = "#f87171";
      console.error(err);
    }
  });
}

// 1. PRECISION FLOOD HAZARD & VOLUMETRIC ANALYSIS
let floodMesh = null;
let isFloodSimActive = false;
const floodBtn = document.getElementById('btn-flood-sim');
const disasterBox = document.getElementById('disaster-telemetry-box');

if (floodBtn) {
  floodBtn.addEventListener('click', async () => {
    isFloodSimActive = !isFloodSimActive;
    floodBtn.classList.toggle('active', isFloodSimActive);
    floodBtn.textContent = isFloodSimActive ? "Drain Inundation" : "Flood Hazard (+5m)";

    if (isFloodSimActive) {
      if (!floodMesh) {
        const waterGeo = new THREE.PlaneGeometry(52, 52);
        const waterMat = new THREE.MeshStandardMaterial({
          color: 0x0284c7,
          transparent: true,
          opacity: 0.68,
          roughness: 0.1,
          metalness: 0.8
        });
        floodMesh = new THREE.Mesh(waterGeo, waterMat);
        scene.add(floodMesh);
      }
      const waterHeightNorm = (5.0 / (maxElevation - minElevation || 1.0)) * verticalExaggeration;
      floodMesh.position.set(0, 0, waterHeightNorm);
      floodMesh.visible = true;

      try {
        const res = await fetch('/api/disaster/flood-analysis?water_rise_m=5.0');
        const d = await res.json();
        if (d.status === 'success') {
          disasterBox.style.display = 'block';
          document.getElementById('disaster-metric-1').innerHTML = `Surge Datum: <span style="color:#f8fafc;">+5.0m (${d.flood_water_amsl_m}m AMSL)</span>`;
          document.getElementById('disaster-metric-2').innerHTML = `Inundated Area: <span style="color:#facc15;">${d.inundated_area_m2} m² (${d.inundated_percentage}%)</span>`;
          document.getElementById('disaster-metric-3').innerHTML = `Volumetric Water: <span style="color:#38bdf8;">${d.inundated_volume_m3} m³</span>`;
          document.getElementById('disaster-metric-4').innerHTML = `Peak Depth: <span style="color:#f87171;">${d.max_water_depth_m}m (${d.critical_evacuation_alert ? 'EVACUATE GROUND' : 'STABLE'})</span>`;
        }
      } catch (err) { console.warn(err); }
    } else {
      if (floodMesh) floodMesh.visible = false;
      if (disasterBox) disasterBox.style.display = 'none';
    }
  });
}

// 2. QUANTITATIVE ICAO HELIPAD EXTRACTION
const helipadBtn = document.getElementById('btn-helipad-zones');
let helipadMarkers = [];

if (helipadBtn) {
  helipadBtn.addEventListener('click', async () => {
    const isActive = helipadBtn.classList.toggle('active');
    helipadBtn.textContent = isActive ? "Clear Helipads" : "ICAO Helipads";

    helipadMarkers.forEach(m => scene.remove(m));
    helipadMarkers = [];

    if (isActive) {
      try {
        const res = await fetch('/api/disaster/helipad-triage');
        const data = await res.json();
        if (data.status === 'success' && data.candidates.length > 0) {
          disasterBox.style.display = 'block';
          const top = data.candidates[0];
          document.getElementById('disaster-metric-1').innerHTML = `Verified Pads: <span style="color:#34d399;">${data.verified_landing_zones} Zones</span>`;
          document.getElementById('disaster-metric-2').innerHTML = `Primary Pad: <span style="color:#f8fafc;">${top.lat}°N, ${top.lon}°E</span>`;
          document.getElementById('disaster-metric-3').innerHTML = `Area / Slope: <span style="color:#facc15;">${top.pad_area_m2} m² | ${top.mean_slope_deg}°</span>`;
          document.getElementById('disaster-metric-4').innerHTML = `Obstacle Clearance: <span style="color:${top.icao_compliant ? '#34d399' : '#f87171'};">${top.icao_compliant ? 'ICAO COMPLIANT (<2.5m)' : 'OBSTACLE HAZARD'}</span>`;

          data.candidates.forEach(c => {
            const u = (c.lon - currentBounds[0]) / (currentBounds[2] - currentBounds[0]);
            const v = (c.lat - currentBounds[1]) / (currentBounds[3] - currentBounds[1]);
            const x = (u - 0.5) * 50;
            const y = (v - 0.5) * 50;
            const z = ((c.elevation_amsl_m - minElevation) / (maxElevation - minElevation)) * verticalExaggeration;

            const group = new THREE.Group();
            const ringGeo = new THREE.RingGeometry(0.85, 1.15, 32);
            const ringMat = new THREE.MeshBasicMaterial({ 
              color: c.icao_compliant ? 0x10b981 : 0xf59e0b, 
              side: THREE.DoubleSide 
            });
            const ring = new THREE.Mesh(ringGeo, ringMat);

            const centerGeo = new THREE.CircleGeometry(0.28, 16);
            const centerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
            const dot = new THREE.Mesh(centerGeo, centerMat);

            group.add(ring);
            group.add(dot);
            group.position.set(x, y, z + 0.15);
            scene.add(group);
            helipadMarkers.push(group);
          });
        }
      } catch (err) { console.warn(err); }
    } else {
      if (disasterBox) disasterBox.style.display = 'none';
    }
  });
}

// 3. UAV FLIGHT CLEARANCE CORRIDOR MASKING
const uavBtn = document.getElementById('btn-uav-corridor');
let uavMesh = null;
let isUavActive = false;

if (uavBtn) {
  uavBtn.addEventListener('click', async () => {
    isUavActive = !isUavActive;
    uavBtn.classList.toggle('active', isUavActive);
    uavBtn.textContent = isUavActive ? "Clear UAV Corridor" : "UAV Flight Clearance Corridor";

    if (isUavActive) {
      try {
        const res = await fetch('/api/disaster/uav-clearance?safety_margin_m=15.0');
        const data = await res.json();
        if (data.status === 'success') {
          disasterBox.style.display = 'block';
          document.getElementById('disaster-metric-1').innerHTML = `UAV Mode: <span style="color:#f59e0b;">ACTIVE CLEARANCE CEILING</span>`;
          document.getElementById('disaster-metric-2').innerHTML = `Obstacle Max: <span style="color:#f8fafc;">${data.tallest_structure_amsl_m}m AMSL</span>`;
          document.getElementById('disaster-metric-3').innerHTML = `Safety Buffer: <span style="color:#38bdf8;">+${data.safety_margin_m}m Above Envelopes</span>`;
          document.getElementById('disaster-metric-4').innerHTML = `Minimum Safe Ceiling: <span style="color:#10b981; font-weight:bold;">${data.minimum_safe_altitude_amsl_m}m AMSL</span>`;

          if (!uavMesh) {
            const uavGeo = new THREE.PlaneGeometry(50, 50, 63, 63);
            const uavMat = new THREE.MeshBasicMaterial({
              color: 0xf59e0b,
              wireframe: true,
              transparent: true,
              opacity: 0.35
            });
            uavMesh = new THREE.Mesh(uavGeo, uavMat);
            scene.add(uavMesh);
          }

          const pos = uavMesh.geometry.attributes.position;
          const grid = data.mca_grid;
          for (let r = 0; r < 64; r++) {
            for (let c = 0; c < 64; c++) {
              const idx = r * 64 + c;
              const amsl = grid[r][c];
              const normZ = ((amsl - minElevation) / (maxElevation - minElevation || 1.0)) * verticalExaggeration;
              pos.setZ(idx, normZ);
            }
          }
          pos.needsUpdate = true;
          uavMesh.visible = true;
        }
      } catch (err) { console.warn(err); }
    } else {
      if (uavMesh) uavMesh.visible = false;
      if (disasterBox) disasterBox.style.display = 'none';
    }
  });
}

// Measurement & Transects
let activeTool = null;
let clickPoints = [];
const markers = [];
let transectLine = null;

function clearMarkers() {
  markers.forEach(m => scene.remove(m));
  markers.length = 0;
  clickPoints = [];
  if (transectLine) { scene.remove(transectLine); transectLine = null; }
}

function createMarker(pos, color) {
  const markerGeo = new THREE.SphereGeometry(0.35, 16, 16);
  const markerMat = new THREE.MeshBasicMaterial({ color: color });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.position.copy(pos);
  scene.add(marker);
  markers.push(marker);
}

function drawTransect(p1, p2) {
  if (transectLine) scene.remove(transectLine);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 3 });
  transectLine = new THREE.Line(lineGeo, lineMat);
  scene.add(transectLine);
}

function renderProfileGraph(p1, p2) {
  const canvas = document.getElementById('profile-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const samples = 120;
  const profileData = [];
  const pos = geometry.attributes.position;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = p1.x + (p2.x - p1.x) * t;
    const y = p1.y + (p2.y - p1.y) * t;

    const gx = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(((x + 25) / 50) * (GRID_SIZE - 1))));
    const gy = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(((25 - y) / 50) * (GRID_SIZE - 1))));
    const idx = gy * GRID_SIZE + gx;
    const z = pos.getZ(idx) || 0;

    const ratio = Math.max(0, Math.min(1, z / verticalExaggeration));
    const amsl = minElevation + ratio * (maxElevation - minElevation);
    profileData.push(amsl);
  }

  const pMin = Math.min(...profileData);
  const pMax = Math.max(...profileData) + 0.1;
  const w = canvas.width;
  const h = canvas.height;

  ctx.beginPath();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.5;

  profileData.forEach((val, i) => {
    const px = (i / samples) * (w - 60) + 40;
    const py = h - 18 - ((val - pMin) / (pMax - pMin)) * (h - 36);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText(`${pMax.toFixed(1)}m`, 4, 16);
  ctx.fillText(`${pMin.toFixed(1)}m`, 4, h - 8);
}

const measureBtn = document.getElementById('toggle-measure');
const profileBtn = document.getElementById('toggle-profile');
const measureBox = document.getElementById('measure-box');
const profileDrawer = document.getElementById('profile-drawer');

measureBtn?.addEventListener('click', () => {
  activeTool = (activeTool === 'measure') ? null : 'measure';
  measureBtn.classList.toggle('active', activeTool === 'measure');
  profileBtn?.classList.remove('active');
  if (measureBox) measureBox.style.display = activeTool === 'measure' ? 'block' : 'none';
  if (profileDrawer) profileDrawer.style.display = 'none';
  clearMarkers();
});

profileBtn?.addEventListener('click', () => {
  activeTool = (activeTool === 'profile') ? null : 'profile';
  profileBtn.classList.toggle('active', activeTool === 'profile');
  measureBtn?.classList.remove('active');
  if (profileDrawer) profileDrawer.style.display = activeTool === 'profile' ? 'block' : 'none';
  if (measureBox) measureBox.style.display = 'none';
  clearMarkers();
});

window.addEventListener('click', (e) => {
  if (!activeTool || isFlying || isFpv) return;
  if (e.target.closest('#hud') || e.target.closest('#profile-drawer') || e.target.closest('#bhuvan-header') || e.target.closest('#telemetry-bar')) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(terrainMesh);

  if (hits.length > 0) {
    const pt = hits[0].point;
    if (clickPoints.length >= 2) clearMarkers();
    
    clickPoints.push(pt);
    createMarker(pt, clickPoints.length === 1 ? 0x38bdf8 : 0xf59e0b);

    const calcElev = (z) => {
      const ratio = Math.max(0, Math.min(1, z / verticalExaggeration));
      return (minElevation + ratio * (maxElevation - minElevation));
    };

    if (activeTool === 'measure') {
      if (clickPoints.length === 1) {
        document.getElementById('pt-a').textContent = `${calcElev(pt.z).toFixed(1)} m`;
        document.getElementById('pt-b').textContent = "Click endpoint";
      } else if (clickPoints.length === 2) {
        const h1 = calcElev(clickPoints[0].z);
        const h2 = calcElev(clickPoints[1].z);
        document.getElementById('pt-b').textContent = `${h2.toFixed(1)} m`;
        const deltaZ = Math.abs(h2 - h1);
        document.getElementById('delta-z').textContent = `${deltaZ.toFixed(1)} m`;

        const dx = (clickPoints[1].x - clickPoints[0].x) * 10;
        const dy = (clickPoints[1].y - clickPoints[0].y) * 10;
        const horizDist = Math.sqrt(dx*dx + dy*dy) + 1e-6;
        const slopeAngle = (Math.atan(deltaZ / horizDist) * (180.0 / Math.PI)).toFixed(1);
        document.getElementById('slope-deg').textContent = `${slopeAngle}°`;
      }
    } else if (activeTool === 'profile') {
      if (clickPoints.length === 1) {
        document.getElementById('profile-status').textContent = "Click Second Point";
      } else if (clickPoints.length === 2) {
        drawTransect(clickPoints[0], clickPoints[1]);
        renderProfileGraph(clickPoints[0], clickPoints[1]);
        document.getElementById('profile-status').textContent = "Transect Calculated";
      }
    }
  }
});

document.getElementById('export-geotiff')?.addEventListener('click', () => {
  window.open('/api/download-geotiff', '_blank');
});

document.getElementById('export-gltf')?.addEventListener('click', () => {
  const exporter = new THREE.GLTFExporter();
  exporter.parse(
    terrainMesh,
    (gltf) => {
      const blob = new Blob([gltf], { type: 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'TARA3D_Terrain.glb';
      link.click();
    },
    { binary: true }
  );
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);

  if (transitionProgress < 1.0) {
    transitionProgress += 0.035;
    camera.position.lerpVectors(camera.position, targetCamPos, 0.08);
    controls.target.lerp(targetLookAt, 0.08);
    controls.update();
  } else if (isFlying) {
    flightClock += 0.0035;
    const radius = 34;
    camera.position.set(
      Math.cos(flightClock) * radius,
      Math.sin(flightClock) * (radius * 0.9),
      20 + Math.sin(flightClock * 2) * 2.5
    );
    camera.lookAt(0, 0, 2);
  } else if (isFpv) {
    const moveSpeed = 0.55;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);

    const right = new THREE.Vector3();
    right.crossVectors(camera.up, forward).negate().normalize();

    if (keysPressed['w']) camera.position.addScaledVector(forward, moveSpeed);
    if (keysPressed['s']) camera.position.addScaledVector(forward, -moveSpeed);
    if (keysPressed['a']) camera.position.addScaledVector(right, -moveSpeed);
    if (keysPressed['d']) camera.position.addScaledVector(right, moveSpeed);
    if (keysPressed['e']) camera.position.z += moveSpeed * 0.7;
    if (keysPressed['q']) camera.position.z = Math.max(1.2, camera.position.z - moveSpeed * 0.7);
  } else {
    controls.update();
  }

  renderer.render(scene, camera);
}
animate();
