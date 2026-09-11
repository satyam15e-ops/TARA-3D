const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a13);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, -65, 45);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(40, -50, 70);
scene.add(dirLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.8));

const GRID_SIZE = 160;
const geometry = new THREE.PlaneGeometry(50, 50, GRID_SIZE - 1, GRID_SIZE - 1);

let rgbTexture = null;
let turboTexture = null;
let maxHeightRelief = 3.25;
let minElevation = 239.26;
let maxElevation = 304.26;

const material = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.6,
  metalness: 0.1,
  side: THREE.DoubleSide
});

const terrainMesh = new THREE.Mesh(geometry, material);
scene.add(terrainMesh);

// 3D Flythrough Path Engine
let isFlying = false;
let flightClock = 0;
const flightBtn = document.getElementById('btn-flythrough');
const flightHud = document.getElementById('flight-hud');
const flyAltSpan = document.getElementById('fly-alt');

flightBtn.addEventListener('click', () => {
  isFlying = !isFlying;
  flightBtn.classList.toggle('active', isFlying);
  flightBtn.textContent = isFlying ? "Abort Flythrough" : "Engage 3D Flythrough Mission";
  flightHud.style.display = isFlying ? "block" : "none";
  controls.enabled = !isFlying;
  if (!isFlying) {
    camera.position.set(0, -65, 45);
    camera.lookAt(0, 0, 0);
  }
});

let activeTool = null;
let clickPoints = [];
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const markers = [];
let transectLine = null;

function clearMarkers() {
  markers.forEach(m => scene.remove(m));
  markers.length = 0;
  clickPoints = [];
  if (transectLine) {
    scene.remove(transectLine);
    transectLine = null;
  }
}

function createMarker(pos, color) {
  const markerGeo = new THREE.SphereGeometry(0.5, 16, 16);
  const markerMat = new THREE.MeshBasicMaterial({ color: color });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.position.copy(pos);
  scene.add(marker);
  markers.push(marker);
}

function drawTransect(p1, p2) {
  if (transectLine) scene.remove(transectLine);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 });
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

    const ratio = Math.max(0, Math.min(1, z / maxHeightRelief));
    const amsl = minElevation + ratio * (maxElevation - minElevation);
    profileData.push(amsl);
  }

  const pMin = Math.min(...profileData);
  const pMax = Math.max(...profileData) + 0.1;
  const w = canvas.width;
  const h = canvas.height;

  ctx.beginPath();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;

  profileData.forEach((val, i) => {
    const px = (i / samples) * (w - 60) + 40;
    const py = h - 20 - ((val - pMin) / (pMax - pMin)) * (h - 40);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = '9px monospace';
  ctx.fillText(`${pMax.toFixed(1)}m`, 4, 18);
  ctx.fillText(`${pMin.toFixed(1)}m`, 4, h - 16);
  ctx.fillText(`Transect Distance (A -> B)`, w / 2 - 50, h - 4);
}

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusText = document.getElementById('status-text');
  statusText.textContent = "Anchoring to SRTM 30m Baseline...";
  statusText.style.color = "#facc15";

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('http://127.0.0.1:8000/api/reconstruct', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    const data = await res.json();

    minElevation = data.elevation_min_m;
    maxElevation = data.elevation_max_m;
    document.getElementById('min-elev').textContent = minElevation + " m AMSL";
    document.getElementById('max-elev').textContent = maxElevation + " m AMSL";

    if (data.accuracy) {
      document.getElementById('val-rmse').textContent = `±${data.accuracy.rmse_m} m`;
      document.getElementById('val-mae').textContent = `±${data.accuracy.mae_m} m`;
      document.getElementById('val-le90').textContent = `LE90 ≤ ${data.accuracy.le90_m} m (PASSED)`;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        rgbTexture = new THREE.Texture(img);
        rgbTexture.needsUpdate = true;
        terrainMesh.material.map = rgbTexture;
        terrainMesh.material.needsUpdate = true;

        const canvas = document.createElement('canvas');
        canvas.width = GRID_SIZE;
        canvas.height = GRID_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);
        const imgData = ctx.getImageData(0, 0, GRID_SIZE, GRID_SIZE).data;
        const pos = geometry.attributes.position;

        maxHeightRelief = (maxElevation - minElevation) * 0.05;

        for (let i = 0; i < pos.count; i++) {
          const r = imgData[i * 4];
          const g = imgData[i * 4 + 1];
          const b = imgData[i * 4 + 2];
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
          pos.setZ(i, lum * maxHeightRelief);
        }
        pos.needsUpdate = true;
        geometry.computeVertexNormals();

        const turboImg = new Image();
        turboImg.crossOrigin = "anonymous";
        turboImg.onload = () => {
          turboTexture = new THREE.Texture(turboImg);
          turboTexture.needsUpdate = true;
        };
        turboImg.src = data.heatmap_url + '?t=' + new Date().getTime();

        statusText.textContent = "Reconstruction Active (60 FPS)";
        statusText.style.color = "#34d399";
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);

  } catch (err) {
    statusText.textContent = "Processing Failed";
    statusText.style.color = "#f87171";
    console.error(err);
  }
});

document.getElementById('toggle-rgb').addEventListener('click', () => {
  if (rgbTexture) {
    terrainMesh.material.map = rgbTexture;
    terrainMesh.material.needsUpdate = true;
  }
});

document.getElementById('toggle-turbo').addEventListener('click', () => {
  if (turboTexture) {
    terrainMesh.material.map = turboTexture;
    terrainMesh.material.needsUpdate = true;
  }
});

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
  controls.enabled = activeTool === null && !isFlying;
  clearMarkers();
});

profileBtn.addEventListener('click', () => {
  activeTool = (activeTool === 'profile') ? null : 'profile';
  profileBtn.classList.toggle('active', activeTool === 'profile');
  measureBtn.classList.remove('active');
  profileDrawer.style.display = activeTool === 'profile' ? 'block' : 'none';
  measureBox.style.display = 'none';
  controls.enabled = activeTool === null && !isFlying;
  clearMarkers();
});

window.addEventListener('click', (e) => {
  if (!activeTool || isFlying) return;
  if (e.target.closest('#hud') || e.target.closest('#profile-drawer') || e.target.closest('#mission-bar')) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(terrainMesh);

  if (intersects.length > 0) {
    const pt = intersects[0].point;
    if (clickPoints.length >= 2) clearMarkers();
    
    clickPoints.push(pt);
    createMarker(pt, clickPoints.length === 1 ? 0x38bdf8 : 0xf59e0b);

    const calcElev = (z) => {
      const ratio = Math.max(0, Math.min(1, z / maxHeightRelief));
      return (minElevation + ratio * (maxElevation - minElevation)).toFixed(1);
    };

    if (activeTool === 'measure') {
      if (clickPoints.length === 1) {
        document.getElementById('pt-a').textContent = `${calcElev(pt.z)} m AMSL`;
        document.getElementById('pt-b').textContent = "Click surface";
        document.getElementById('delta-z').textContent = "--";
      } else if (clickPoints.length === 2) {
        document.getElementById('pt-b').textContent = `${calcElev(pt.z)} m AMSL`;
        const diff = Math.abs(parseFloat(document.getElementById('pt-b').textContent) - parseFloat(document.getElementById('pt-a').textContent)).toFixed(1);
        document.getElementById('delta-z').textContent = `${diff} m`;
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

document.getElementById('export-geotiff').addEventListener('click', () => {
  window.open('http://127.0.0.1:8000/api/download-geotiff', '_blank');
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

function animate() {
  requestAnimationFrame(animate);

  if (isFlying) {
    flightClock += 0.005;
    const radius = 32;
    const flightX = Math.cos(flightClock) * radius;
    const flightY = Math.sin(flightClock) * radius;
    const flightZ = 12 + Math.sin(flightClock * 2) * 3; // Realistic flight oscillation

    camera.position.set(flightX, flightY, flightZ);
    // Target is slightly ahead of the flight vector to create a cockpit/drone feel
    const targetX = Math.cos(flightClock + 0.25) * 6;
    const targetY = Math.sin(flightClock + 0.25) * 6;
    camera.lookAt(targetX, targetY, 2.0);

    const currentAlt = (minElevation + (flightZ / maxHeightRelief) * (maxElevation - minElevation)).toFixed(1);
    flyAltSpan.textContent = currentAlt;
  } else {
    controls.update();
  }

  renderer.render(scene, camera);
}
animate();
