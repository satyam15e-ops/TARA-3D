from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from PIL import Image
import numpy as np
import io
import os
import rasterio
from backend.depth_engine import DepthEngine
from backend.geospatial_engine import GeospatialCalibrationEngine
from backend.legend_generator import export_metric_dsm_with_legend

app = FastAPI(title="TARA-3D ISRO/NRSC Photogrammetric Processing Engine")

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
geo_calibrator = GeospatialCalibrationEngine()
latest_geotiff_path = "outputs/TARA3D_Metric_Elevation.tif"

@app.post("/api/reconstruct")
async def reconstruct(
    file: UploadFile = File(...),
    srtm_file: UploadFile = File(None),
    base_datum_m: float = Form(240.0),
    max_relief_m: float = Form(65.0),
    min_lat: float = Form(28.610),
    max_lat: float = Form(28.625),
    min_lon: float = Form(77.200),
    max_lon: float = Form(77.215)
):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    
    # 1. Foundation Relative Disparity
    rel_depth = engine.infer(image)
    
    # 2. SRTM 30m Reference Anchor
    if srtm_file is not None:
        srtm_bytes = await srtm_file.read()
        with rasterio.open(io.BytesIO(srtm_bytes)) as dem_src:
            srtm_patch = dem_src.read(1)
    else:
        h, w = rel_depth.shape
        x = np.linspace(0, 1, w)
        y = np.linspace(0, 1, h)
        xx, yy = np.meshgrid(x, y)
        srtm_patch = base_datum_m + (xx * 4.0) - (yy * 2.0)

    # 3. Dual-Band Calibration with Preserved Building Relief
    metric_dsm, scale_s, shift_t, accuracy = geo_calibrator.align_to_srtm(
        rel_depth, srtm_patch, target_relief_m=max_relief_m
    )

    # 4. Export 32-Bit Float GeoTIFF
    bounds = (min_lon, min_lat, max_lon, max_lat)
    geo_calibrator.export_geotiff(metric_dsm, latest_geotiff_path, bounds=bounds, crs_code="EPSG:4326")

    # 5. Export Heatmap
    output_png = "outputs/latest_dsm.png"
    export_metric_dsm_with_legend(metric_dsm, output_png)

    return {
        "status": "success",
        "scale_factor": round(float(scale_s), 4),
        "shift_datum_m": round(float(shift_t), 2),
        "elevation_min_m": round(float(np.min(metric_dsm)), 2),
        "elevation_max_m": round(float(np.max(metric_dsm)), 2),
        "bounds": list(bounds),
        "accuracy": accuracy,
        "heatmap_url": "http://127.0.0.1:8000/outputs/latest_dsm.png",
        "geotiff_url": "http://127.0.0.1:8000/api/download-geotiff"
    }

@app.get("/api/download-geotiff")
def download_geotiff():
    if os.path.exists(latest_geotiff_path):
        return FileResponse(
            latest_geotiff_path,
            media_type="image/tiff",
            filename="TARA3D_Calibrated_DSM_32Bit.tif"
        )
    return {"error": "File not generated yet"}
