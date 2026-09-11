from fastapi import FastAPI, UploadFile, File
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
async def reconstruct(file: UploadFile = File(...)):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    rel_depth = engine.infer(image)
    metric_dsm, scale, shift = calibrator.calibrate(rel_depth)
    output_png = "outputs/latest_dsm.png"
    export_metric_dsm_with_legend(metric_dsm, output_png)
    
    return {
        "status": "success",
        "scale_factor": round(scale, 3),
        "shift_datum_m": round(shift, 2),
        "elevation_min_m": round(float(np.min(metric_dsm)), 2),
        "elevation_max_m": round(float(np.max(metric_dsm)), 2),
        "heatmap_url": "http://127.0.0.1:8000/outputs/latest_dsm.png"
    }
