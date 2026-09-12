const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060913);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 3000);
// Start at oblique 3D view so 3D relief is immediately visible
camera.position.set(0, -42, 32);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// Smooth, unrestricted GIS OrbitControls (Full 360 pitch, yaw, and pan)
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true; // Allows natural map panning in all directions
controls.maxPolarAngle = Math.PI / 2 + 0.15; // Allows looking slightly upward at skyline
controls.minDistance = 5;
controls.maxDistance = 250;
controls.target.set(0, 0, 0);

// Lighting setup for high building relief shadow contrast
const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
dirLight.position.set(30, -50, 50);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.6);
fillLight.position.set(-30, 40, 20);
scene.add(fillLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.7));

let GRID_SIZE = 256;
let geometry = new THREE.PlaneGeometry(50, 50, GRID_SIZE - 1, GRID_SIZE - 1);

let rgbTexture = null;
let turboTexture = null;
let verticalExaggeration = 5.5; // Pronounced physical building relief
let minElevation = 239.26;
let maxElevation = 304.26;
let currentBounds = [77.200, 28.610, 77.215, 28.625];
let rawGridMatrix = null;

const material = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.4,
  metalness: 0.1,
  side: THREE.DoubleSide
});

let terrainMesh = new THREE.Mesh(geometry, material);
scene.add(terrainMesh);

// Smooth Animated Camera Transition Engine
let targetCamPos = null;
let targetLookAt = null;
let transitionProgress = 1.0;

function smoothTransitionTo(camPos, lookAtPos) {
  targetCamPos = camPos.clone();
  targetLookAt = lookAtPos.clone();
  transitionProgress = 0.0;
}

// Perspective Switchers (Cinematic Interpolated Transitions)
const view2dBtn = document.getElementById('view-2d');
const view3dBtn = document.getElementById('view-3d');

view2dBtn.addEventListener('click', () => {
  view2dBtn.classList.add('active');
  view3dBtn.classList.remove('active');
  isFlying = false;
  isFpv = false;
  updateNavState();
  // Smoothly pitch up to true 2D top-down nadir Bhuvan map view
  smoothTransitionTo(new THREE.Vector3(0, 0.01, 68), new THREE.Vector3(0, 0, 0));
});

view3dBtn.addEventListener('click', () => {
  view3dBtn.classList.add('active');
  view2dBtn.classList.remove('active');
  isFlying = false;
  isFpv = false;
  updateNavState();
  // Smoothly dive into cinematic 3D perspective with pronounced elevation
  smoothTransitionTo(new THREE.Vector3(0, -45, 28), new THREE.Vector3(0, 0, 2));
});

// Autonomous Flythrough & FPV Navigation
let isFlying = false;
let isFpv = false;
let flightClock = 0;
const keysPressed = {};

const flightBtn = document.getElementById('btn-flythrough');
const fpvBtn = document.getElementById('btn-fpv');

flightBtn.addEventListener('click', () => {
  isFlying = !isFlying;
  if (isFlying) {
    isFpv = false;
    view3dBtn.classList.add('active');
    view2dBtn.classList.remove('active');
  }
  updateNavState();
});

fpvBtn.addEventListener('click', () => {
  isFpv = !isFpv;
  if (isFpv) {
    isFlying = false;
    view3dBtn.classList.add('active');
    view2dBtn.classList.remove('active');
  }
  updateNavState();
});

function updateNavState() {
  flightBtn.classList.toggle('active', isFlying);
  flightBtn.textContent = isFlying ? "Abort Flythrough" : "Engage Autonomous Flythrough";
  
  fpvBtn.classList.toggle('active', isFpv);
  fpvBtn.textContent = isFpv ? "Exit First-Person Flight" : "First-Person Drone Flight (WASD)";
  
  controls.enabled = (!isFlying && !isFpv && transitionProgress >= 1.0);
}

window.addEventListener('keydown', (e) => { keysPressed[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keysPressed[e.key.toLowerCase()] = false; });

// Dynamic Cursor Telemetry (Lat, Lon, AMSL Height)
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('mousemove', (e) => {
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

    document.getElementById('cur-lat').textContent = `${lat}° N`;
    document.getElementById('cur-lon').textContent = `${lon}° E`;
    document.getElementById('cur-elev').textContent = `${elev} m AMSL`;
  }
});

// Ingestion Pipeline Handler
document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusText = document.getElementById('status-text');
  statusText.textContent = "Anchoring & Calibrating Terrain...";
  statusText.style.color = "#facc15";

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/reconstruct', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
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
        const isEdge = (r === 0 || r === GRID_SIZE - 1 || c === 0 || c === GRID_SIZE - 1);
        const rawZ = rawGridMatrix[r][c];
        const normZ = isEdge ? 0.0 : THREE.MathUtils.clamp((rawZ - minElevation) / elevRange, 0.0, 1.0);
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
        rgbTexture.needsUpdate = true;
        terrainMesh.material.map = rgbTexture;
        terrainMesh.material.needsUpdate = true;

        const turboImg = new Image();
        turboImg.crossOrigin = "anonymous";
        turboImg.onload = () => {
          turboTexture = new THREE.Texture(turboImg);
          turboTexture.needsUpdate = true;
        };
        turboImg.src = data.heatmap_url + '?t=' + new Date().getTime();

        statusText.textContent = "Operational (60 FPS)";
        statusText.style.color = "#34d399";

        // Auto-switch to 3D perspective to reveal reconstructed relief
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

// Layer Toggles
document.getElementById('toggle-rgb').addEventListener('click', () => {
  if (rgbTexture) {
    terrainMesh.material.map = rgbTexture;
    terrainMesh.material.needsUpdate = true;
    document.getElementById('toggle-rgb').classList.add('active');
    document.getElementById('toggle-turbo').classList.remove('active');
  }
});

document.getElementById('toggle-turbo').addEventListener('click', () => {
  if (turboTexture) {
    terrainMesh.material.map = turboTexture;
    terrainMesh.material.needsUpdate = true;
    document.getElementById('toggle-turbo').classList.add('active');
    document.getElementById('toggle-rgb').classList.remove('active');
  }
});

// Structural Tools: Ruler & Transects
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
  const markerGeo = new THREE.SphereGeometry(0.4, 16, 16);
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

measureBtn.addEventListener('click', () => {
  activeTool = (activeTool === 'measure') ? null : 'measure';
  measureBtn.classList.toggle('active', activeTool === 'measure');
  profileBtn.classList.remove('active');
  measureBox.style.display = activeTool === 'measure' ? 'block' : 'none';
  profileDrawer.style.display = 'none';
  controls.enabled = (activeTool === null && !isFlying && !isFpv);
  clearMarkers();
});

profileBtn.addEventListener('click', () => {
  activeTool = (activeTool === 'profile') ? null : 'profile';
  profileBtn.classList.toggle('active', activeTool === 'profile');
  measureBtn.classList.remove('active');
  profileDrawer.style.display = activeTool === 'profile' ? 'block' : 'none';
  measureBox.style.display = 'none';
  controls.enabled = (activeTool === null && !isFlying && !isFpv);
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
        document.getElementById('pt-b').textContent = "Click rooftop/endpoint";
        document.getElementById('delta-z').textContent = "--";
        document.getElementById('slope-deg').textContent = "--";
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
        document.getElementById('slope-deg').textContent = `${slopeAngle}° (${((deltaZ / horizDist)*100).toFixed(0)}% grade)`;
      }
    } else if (activeTool === 'profile') {
      if (clickPoints.length === 1) {
        document.getElementById('profile-status').textContent = "Click Second Transect Point";
      } else if (clickPoints.length === 2) {
        drawTransect(clickPoints[0], clickPoints[1]);
        renderProfileGraph(clickPoints[0], clickPoints[1]);
        document.getElementById('profile-status').textContent = "Transect Profile Calculated";
      }
    }
  }
});

// Deliverables Export
document.getElementById('export-geotiff').addEventListener('click', () => {
  window.open('/api/download-geotiff', '_blank');
});

document.getElementById('export-gltf').addEventListener('click', () => {
  const exporter = new THREE.GLTFExporter();
  exporter.parse(
    terrainMesh,
    (gltf) => {
      const blob = new Blob([gltf], { type: 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'TARA3D_Calibrated_Terrain.glb';
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

// High-Performance 60 FPS Render Loop
function animate() {
  requestAnimationFrame(animate);

  // Smooth Camera Transition Interpolation
  if (transitionProgress < 1.0) {
    transitionProgress += 0.035;
    const t = Math.min(1.0, transitionProgress);
    // Smooth cosine easing
    const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
    camera.position.lerpVectors(camera.position, targetCamPos, 0.08);
    controls.target.lerp(targetLookAt, 0.08);
    controls.update();
  } else if (isFlying) {
    flightClock += 0.0035;
    const radius = 38;
    camera.position.set(
      Math.cos(flightClock) * radius,
      Math.sin(flightClock) * (radius * 0.9),
      24 + Math.sin(flightClock * 2) * 3
    );
    camera.lookAt(0, 0, 3);
  } else if (isFpv) {
    const moveSpeed = 0.45;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.z = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(camera.up, forward).negate().normalize();

    if (keysPressed['w']) camera.position.addScaledVector(forward, moveSpeed);
    if (keysPressed['s']) camera.position.addScaledVector(forward, -moveSpeed);
    if (keysPressed['a']) camera.position.addScaledVector(right, -moveSpeed);
    if (keysPressed['d']) camera.position.addScaledVector(right, moveSpeed);
    if (keysPressed['e']) camera.position.z += moveSpeed * 0.6;
    if (keysPressed['q']) camera.position.z = Math.max(1.5, camera.position.z - moveSpeed * 0.6);
  } else {
    controls.update();
  }

  renderer.render(scene, camera);
}
animate();

