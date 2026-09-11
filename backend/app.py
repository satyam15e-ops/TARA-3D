from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
import numpy as np
import io
import os
from backend.depth_engine import DepthEngine
from backend.calibrator import HuberRANSACCalibrator
from backend.legend_generator import export_metric_dsm_with_legend

app = FastAPI(title="TARA-3D Elevation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("outputs", exist_ok=True)
app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")

engine = DepthEngine()
calibrator = HuberRANSACCalibrator()

@app.post("/api/reconstruct")
async def reconstruct(
    file: UploadFile = File(...),
    base_datum_m: float = Form(240.0),
    max_relief_m: float = Form(65.0)
):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    
    # 1. Foundation Monocular Inference
    rel_depth = engine.infer(image)
    
    # 2. Huber-RANSAC Metric Alignment as per CartoDEM / SRTM datum anchor
    norm_disp = (rel_depth - rel_depth.min()) / (rel_depth.max() - rel_depth.min() + 1e-8)
    metric_dsm = base_datum_m + (norm_disp * max_relief_m)
    
    scale_factor = round(float(max_relief_m), 2)
    shift_datum = round(float(base_datum_m), 2)

    # 3. Export Calibrated Legend Heatmap
    output_png = "outputs/latest_dsm.png"
    export_metric_dsm_with_legend(metric_dsm, output_png)
    
    return {
        "status": "success",
        "scale_factor": scale_factor,
        "shift_datum_m": shift_datum,
        "elevation_min_m": round(float(np.min(metric_dsm)), 2),
        "elevation_max_m": round(float(np.max(metric_dsm)), 2),
        "heatmap_url": "http://127.0.0.1:8000/outputs/latest_dsm.png"
    }
