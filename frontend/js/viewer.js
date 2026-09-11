const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f19);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, -60, 45);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
dirLight.position.set(40, -50, 70);
scene.add(dirLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.8));

const GRID_SIZE = 160;
const geometry = new THREE.PlaneGeometry(50, 50, GRID_SIZE - 1, GRID_SIZE - 1);

let rgbTexture = null;
let turboTexture = null;
let maxHeightRelief = 1.0;
let minElevation = 0;
let maxElevation = 0;

const material = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.6,
  metalness: 0.1,
  side: THREE.DoubleSide
});

const terrainMesh = new THREE.Mesh(geometry, material);
scene.add(terrainMesh);

// Measurement variables
let measureMode = false;
let clickPoints = [];
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const markers = [];

function createMarker(pos, color) {
  const markerGeo = new THREE.SphereGeometry(0.5, 16, 16);
  const markerMat = new THREE.MeshBasicMaterial({ color: color });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.position.copy(pos);
  scene.add(marker);
  markers.push(marker);
}

function clearMarkers() {
  markers.forEach(m => scene.remove(m));
  markers.length = 0;
  clickPoints = [];
}

// 1. INFERENCE & METRIC RECONSTRUCTION
document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusText = document.getElementById('status-text');
  statusText.textContent = "Anchoring Datum & Inferring...";
  statusText.style.color = "#facc15";

  const baseDatum = document.getElementById('base-datum-input').value || 240;
  const reliefScale = document.getElementById('relief-scale-input').value || 65;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('base_datum_m', baseDatum);
  formData.append('max_relief_m', reliefScale);

  try {
    const res = await fetch('http://127.0.0.1:8000/api/reconstruct', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    const data = await res.json();

    minElevation = data.elevation_min_m;
    maxElevation = data.elevation_max_m;
    document.getElementById('min-elev').textContent = minElevation + " m";
    document.getElementById('max-elev').textContent = maxElevation + " m";
    document.getElementById('scale-val').textContent = data.scale_factor;

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
        ctx.filter = 'blur(1.5px)';
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
        statusText.style.color = "#4ade80";
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);

  } catch (err) {
    statusText.textContent = "Inference Failed";
    statusText.style.color = "#f87171";
    console.error(err);
  }
});

// 2. TEXTURE TOGGLE
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

// 3. ELEVATION SLICER
const slider = document.getElementById('slice-slider');
const sliceLabel = document.getElementById('slice-val');

slider.addEventListener('input', (e) => {
  const percent = parseFloat(e.target.value);
  if (percent === 0) {
    sliceLabel.textContent = "None";
    terrainMesh.material.vertexColors = false;
    terrainMesh.material.needsUpdate = true;
    return;
  }
  sliceLabel.textContent = `${percent}%`;
  
  const cutoffZ = (percent / 100.0) * maxHeightRelief;
  const colors = [];
  const pos = geometry.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z >= cutoffZ) {
      colors.push(1.0, 0.4, 0.1);
    } else {
      colors.push(0.3, 0.3, 0.35);
    }
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  terrainMesh.material.vertexColors = true;
  terrainMesh.material.needsUpdate = true;
});

// 4. RAYCASTING MEASUREMENT TOOL
const measureBtn = document.getElementById('toggle-measure');
const measureBox = document.getElementById('measure-box');

measureBtn.addEventListener('click', () => {
  measureMode = !measureMode;
  measureBtn.classList.toggle('active', measureMode);
  measureBox.style.display = measureMode ? 'block' : 'none';
  controls.enabled = !measureMode;
  if (!measureMode) {
    clearMarkers();
    document.getElementById('pt-a').textContent = "Click surface";
    document.getElementById('pt-b').textContent = "Click surface";
    document.getElementById('delta-z').textContent = "--";
  }
});

window.addEventListener('click', (e) => {
  if (!measureMode) return;
  if (e.target.closest('#hud')) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(terrainMesh);

  if (intersects.length > 0) {
    const pt = intersects[0].point;
    if (clickPoints.length >= 2) {
      clearMarkers();
    }
    clickPoints.push(pt);
    createMarker(pt, clickPoints.length === 1 ? 0x38bdf8 : 0xec4899);

    const calcElev = (z) => {
      const ratio = Math.max(0, Math.min(1, z / maxHeightRelief));
      return (minElevation + ratio * (maxElevation - minElevation)).toFixed(1);
    };

    if (clickPoints.length === 1) {
      document.getElementById('pt-a').textContent = `${calcElev(pt.z)} m`;
      document.getElementById('pt-b').textContent = "Click surface";
      document.getElementById('delta-z').textContent = "--";
    } else if (clickPoints.length === 2) {
      document.getElementById('pt-b').textContent = `${calcElev(pt.z)} m`;
      const diff = Math.abs(parseFloat(document.getElementById('pt-b').textContent) - parseFloat(document.getElementById('pt-a').textContent)).toFixed(1);
      document.getElementById('delta-z').textContent = `${diff} m`;
    }
  }
});

// 5. EXPORT GLB
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
  controls.update();
  renderer.render(scene, camera);
}
animate();
