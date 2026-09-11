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
scene.add(new THREE.AmbientLight(0xffffff, 0.7));

const GRID_SIZE = 160;
const geometry = new THREE.PlaneGeometry(50, 50, GRID_SIZE - 1, GRID_SIZE - 1);
const material = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.6,
  metalness: 0.1,
  flatShading: false
});
const terrainMesh = new THREE.Mesh(geometry, material);
scene.add(terrainMesh);

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusText = document.getElementById('status-text');
  statusText.textContent = "Processing Surface...";
  statusText.style.color = "#facc15";

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('http://127.0.0.1:8000/api/reconstruct', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    document.getElementById('min-elev').textContent = data.elevation_min_m + " m";
    document.getElementById('max-elev').textContent = data.elevation_max_m + " m";
    document.getElementById('scale-val').textContent = data.scale_factor;

    const textureLoader = new THREE.TextureLoader();
    const objectURL = URL.createObjectURL(file);
    
    textureLoader.load(objectURL, (texture) => {
      terrainMesh.material.map = texture;
      terrainMesh.material.needsUpdate = true;

      const canvas = document.createElement('canvas');
      canvas.width = GRID_SIZE;
      canvas.height = GRID_SIZE;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.src = objectURL;
      
      img.onload = () => {
        ctx.filter = 'blur(1.5px)'; // Smooth high-frequency noise
        ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);
        const imgData = ctx.getImageData(0, 0, GRID_SIZE, GRID_SIZE).data;
        const pos = geometry.attributes.position;

        // Controlled vertical displacement factor
        const heightRelief = (data.elevation_max_m - data.elevation_min_m) * 0.05;

        for (let i = 0; i < pos.count; i++) {
          const r = imgData[i * 4];
          const g = imgData[i * 4 + 1];
          const b = imgData[i * 4 + 2];
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
          pos.setZ(i, lum * heightRelief);
        }
        pos.needsUpdate = true;
        geometry.computeVertexNormals();
        statusText.textContent = "Reconstruction Active (60 FPS)";
        statusText.style.color = "#4ade80";
      };
    });

  } catch (err) {
    statusText.textContent = "Inference Failed";
    statusText.style.color = "#f87171";
    console.error(err);
  }
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
