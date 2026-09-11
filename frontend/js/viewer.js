const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, -60, 45);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(20, -40, 50);
scene.add(dirLight);
scene.add(new THREE.AmbientLight(0x404040, 1.0));

const geometry = new THREE.PlaneGeometry(50, 50, 120, 120);
const pos = geometry.attributes.position;
for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = Math.sin(vx * 0.2) * Math.cos(vy * 0.2) * 3.5 + Math.exp(- (vx*vx + vy*vy) * 0.005) * 4.0;
    pos.setZ(i, vz);
}
geometry.computeVertexNormals();

const material = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    roughness: 0.6,
    metalness: 0.2
});

scene.add(new THREE.Mesh(geometry, material));

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
