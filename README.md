
# TARA-3D: Monocular Satellite-to-Metric 3D Elevation Engine

TARA-3D is an end-to-end computer vision and photogrammetry platform that reconstructs calibrated 3D terrain and structural digital surface models (DSM) from single 2D aerial/satellite optical images.

The pipeline combines zero-shot foundation depth inference (**Depth Anything v2**) with robust datum-anchoring (**Huber-RANSAC Calibration**) to produce metric-scale elevations, paired with an interactive 60 FPS **WebGL (Three.js)** real-time viewer.

---

## Key Features

- **Monocular Elevation Reconstruction**: Converts uncalibrated monocular satellite and aerial RGB imagery into metric Digital Surface Models without requiring stereo baseline pairs.
- **Robust Outlier-Resistant Calibration**: Employs Huber-RANSAC regression to align relative depth maps to real-world vertical datums (AMSL).
- **Interactive WebGL Digital Twin**: Real-time 3D displacement mapping rendered directly in the browser with Orbit controls.
- **Real-Time Elevation Slicing**: Dynamic threshold shader allowing users to isolate altitude levels, structural footprints, and terrain relief.
- **Multimodal Visual Inspection**: Instant swapping between natural satellite RGB texturing and scientific Turbo colourmap DSM legends.
- **GIS & CAD Interoperability**: One-click binary `.GLB` 3D mesh export for direct analysis in Blender, Caesium, and GIS tools.

---

## System Architecture

```text
[ Raw 2D Satellite Image ]
           │
           ▼
┌───────────────────────────────────────┐
│ FastAPI Inference Pipeline            │
│  ├── Depth Anything v2 (Relative)     │
│  ├── Huber-RANSAC (Metric Scaling)    │
│  └── Turbo Colourmap Legend Generato  │
└──────────────────┬────────────────────┘
                   │  JSON Telemetry + DSM Legend
                   ▼
┌───────────────────────────────────────┐
│ Three.js Interactive Viewer (Client)  │
│  ├── Dynamic Vertex Displacement      │
│  ├── Real-Time Altitude Slicing       │
│  ├── RGB / DSM Texture Blending       │
│  └── Binary GLTF/GLB Exporter         │
└───────────────────────────────────────┘
