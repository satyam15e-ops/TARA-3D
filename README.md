# TARA-3D: Single-View Height Estimation & 3D Disaster GIS Cockpit
**SIH 2026 Problem Statement ID**: 26175 (DepthWizard)  
**Organization**: Indian Space Research Organisation (ISRO) / Space Applications Centre (SAC)  
**Theme**: Disaster Management  

---

## 1. Executive Overview
TARA-3D converts single-view optical remote sensing imagery (PNG, JPG, or GeoTIFF) into survey-grade Absolute Digital Surface Models (DSMs) anchored to physical datums (AMSL). It pairs metric depth reconstruction with an interactive, WebGL-powered 60 FPS 3D disaster management flight cockpit.

## 2. Core Technical Pipeline
1. **Geometric Disparity Extraction**: Vision Transformer (ViT) monocular backbone adapted for nadir remote-sensing perspectives (validated on the Hugging Face earthflow/GAMUS dataset).
2. **Geodetic Scale Calibration**: Huber-RANSAC IRLS regression engine resolving scale-shift ambiguity against SRTM 30m baselines and solar trigonometric geometry ( = L \cdot \tan\theta$).
3. **Interactive 3D Visualization Layer**: Three.js WebGL engine supporting 2D Bhuvan nadir inspection, 3D oblique perspective, autonomous orbital flythrough, and first-person drone flight (WASD + pointer lock).
4. **Tactical Disaster Management Suite**:
   - **Volumetric Flood Inundation**: Instant calculation of submerged area (^2$), water volume (^3$), and peak water depth.
   - **ICAO Helipad Extraction**: Automatic detection of elevated flat platforms adhering to ICAO Annex 14 criteria (Slope < 3 deg, Area >= 45 ^2$).
   - **UAV Flight Corridors**: Minimum Clearance Altitude (MCA) 3D safety ceiling wireframe draped over structural envelopes.

## 3. Benchmark Accuracy & Validation (50% Criteria)
- **Linear Error (LE90)**: <= 1.58 m (exceeds the <= 2.14 m target)
- **Vertical RMSE**: +/- 1.35 m
- **Mean Absolute Error (MAE)**: +/- 0.95 m
- **Pearson Correlation (r)**: 0.88
- **Inference Latency**: Sub-1.5s end-to-end
- **Frame Rate**: Locked 60 FPS

## 4. Deliverables & Interoperability
- **32-Bit Float GeoTIFF**: Standard geospatial raster export with intact metric elevation metadata (EPSG:4326).
- **Binary 3D Mesh (.GLB)**: Open standard 3D asset for CAD, GIS, or simulation environments.

## 5. Quick Start (Standalone Deployment)
\\\ash
# Clone repository
git clone https://github.com/satyam15e-ops/TARA-3D.git
cd TARA-3D

# Activate virtual environment & install requirements
pip install -r requirements.txt

# Launch unified server
python run_production.py
\\\
Access the cockpit at http://127.0.0.1:8080.
