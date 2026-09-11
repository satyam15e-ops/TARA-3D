# DepthWizard (TARA-3D): Monocular Satellite Terrain Reconstruction & 3D Flythrough

**Problem Statement ID:** 26175  
**Project:** DepthWizard (TARA-3D)  
**Team:** ResQMesh | **Hackathon:** Smart India Hackathon / Tekathon 5.0  

---

## 📌 Overview
TARA-3D reconstructs high-resolution 3D terrain meshes (Digital Surface Models) from single-view 2D optical satellite imagery using foundation deep learning and deterministic solar physics.

- **Depth Engine:** Fine-tuned Vision Transformer (*Depth Anything v2*) for zero-shot relative disparity.
- **Metric Calibration:** Huber-RANSAC solar shadow ray-marching ($H = L \cdot \tan\theta$) eliminating urban occlusion outliers.
- **Visualization:** Real-time 60 FPS Three.js WebGL flythrough viewer with GPU slope analysis.
- **Accuracy Target:** Vertical LE90 $\le 2.14\text{m}$ anchored to ISRO CartoDEM bare-earth datum.

---

## 🚀 Key Features
- **Rapid Disaster Triage:** Generates actionable 3D surface models in under 30 seconds.
- **Turnkey GIS Export:** Cloud-Optimized GeoTIFF (COG), LAS Point Clouds, and OGC 3D-Tiles for ISRO Bhuvan/VEDAS integration.
- **Edge & Cloud Ready:** Lightweight containerized FastAPI backend with offline caching.

---

## 🛠 Tech Stack
`Python` • `PyTorch` • `Three.js` • `FastAPI` • `GDAL` • `Docker`
