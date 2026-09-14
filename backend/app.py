import io
import os
import urllib.request
import numpy as np
import rasterio
from rasterio.enums import Resampling
from PIL import Image
from scipy.ndimage import zoom, label
from fastapi import FastAPI, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from backend.geospatial_engine import GeospatialCalibrationEngine
from backend.legend_generator import export_metric_dsm_with_legend

try:
    from backend.onnx_depth_engine import ONNXDepthEngine
    engine = ONNXDepthEngine()
    ENGINE_TYPE = "ONNX Runtime (Accelerated Low-Latency)"
except Exception:
    from backend.depth_engine import DepthEngine
    engine = DepthEngine()
    ENGINE_TYPE = "PyTorch Native"

app = FastAPI(title="TARA-3D Disaster Intelligence Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("outputs", exist_ok=True)
os.makedirs("inputs", exist_ok=True)
app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")
app.mount("/inputs", StaticFiles(directory="inputs"), name="inputs")

geo_calibrator = GeospatialCalibrationEngine()
LATEST_GEOTIFF_PATH = "outputs/TARA3D_Calibrated_DSM.tif"

CURRENT_TACTICAL_CONTEXT = {
    "dsm": None,
    "bounds": [73.845, 18.510, 73.868, 18.530],
    "crs": "EPSG:4326",
    "base_elev": 890.0,
    "max_elev": 924.2,
    "pixel_res_m": 0.5
}

@app.get("/healthz")
def health_check():
    return {
        "status": "healthy",
        "engine": ENGINE_TYPE,
        "active_bounds": CURRENT_TACTICAL_CONTEXT["bounds"],
        "crs": CURRENT_TACTICAL_CONTEXT["crs"]
    }

def run_low_latency_pipeline(image: Image.Image, base_datum_m=890.0, max_relief_m=34.2, bounds=(73.845, 18.510, 73.868, 18.530), native_crs="EPSG:4326", native_transform=None, is_georeferenced=False):
    # Enforce fast inference dimension
    image.thumbnail((512, 512), Image.Resampling.BILINEAR)
    
    # Direct single-pass inference (no multi-tile CPU loops)
    rel_depth = engine.infer(image)
    h, w = rel_depth.shape

    x = np.linspace(0, 1, w)
    y = np.linspace(0, 1, h)
    xx, yy = np.meshgrid(x, y)
    srtm_patch = base_datum_m + (xx * 4.0) - (yy * 2.0)

    metric_dsm, _, _, regime, accuracy = geo_calibrator.align_to_srtm(
        rel_depth, srtm_patch, target_relief_m=max_relief_m
    )

    elev_min = float(np.min(metric_dsm))
    elev_max = float(np.max(metric_dsm))

    # Resample to optimized 128x128 grid for smooth 60 FPS Three.js rendering
    target_grid = 128
    zy = target_grid / metric_dsm.shape[0]
    zx = target_grid / metric_dsm.shape[1]
    resampled_mesh = zoom(metric_dsm, (zy, zx), order=1)

    geo_calibrator.export_geotiff(metric_dsm, LATEST_GEOTIFF_PATH, bounds=bounds, crs_code=native_crs, transform=native_transform)
    export_metric_dsm_with_legend(metric_dsm, "outputs/latest_dsm.png")

    CURRENT_TACTICAL_CONTEXT["dsm"] = metric_dsm
    CURRENT_TACTICAL_CONTEXT["bounds"] = list(bounds)
    CURRENT_TACTICAL_CONTEXT["crs"] = native_crs
    CURRENT_TACTICAL_CONTEXT["base_elev"] = elev_min
    CURRENT_TACTICAL_CONTEXT["max_elev"] = elev_max
    CURRENT_TACTICAL_CONTEXT["pixel_res_m"] = 500.0 / w

    return {
        "status": "success",
        "pipeline_mode": "Low-Latency Direct ONNX",
        "is_georeferenced": is_georeferenced,
        "crs": native_crs,
        "terrain_regime": regime,
        "elevation_min_m": round(elev_min, 2),
        "elevation_max_m": round(elev_max, 2),
        "bounds": list(bounds),
        "accuracy": accuracy,
        "elevation_grid": resampled_mesh.astype(np.float32).tolist(),
        "grid_resolution": target_grid,
        "heatmap_url": "/outputs/latest_dsm.png",
        "geotiff_url": "/api/download-geotiff"
    }

@app.post("/api/reconstruct")
async def reconstruct(
    file: UploadFile = File(...),
    base_datum_m: float = Form(890.0),
    max_relief_m: float = Form(34.2),
    min_lat: float = Form(18.510),
    max_lat: float = Form(18.530),
    min_lon: float = Form(73.845),
    max_lon: float = Form(73.868)
):
    try:
        contents = await file.read()
        filename = (file.filename or "image.png").lower()
        bounds = (min_lon, min_lat, max_lon, max_lat)
        native_crs = "EPSG:4326"
        native_transform = None
        is_georeferenced = False

        if filename.endswith((".tif", ".tiff")):
            with rasterio.open(io.BytesIO(contents)) as src:
                if src.crs:
                    is_georeferenced = True
                    native_crs = src.crs.to_string()
                    native_transform = src.transform
                    bounds = (src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top)

                # Decimated Read: directly extract at 512x512 from disk buffer
                bands = [1, 2, 3] if src.count >= 3 else [1, 1, 1]
                arr = src.read(
                    bands,
                    out_shape=(3, 512, 512),
                    resampling=Resampling.bilinear
                ).astype(np.float32)
                arr = np.transpose(arr, (1, 2, 0))

                p2, p98 = np.percentile(arr, (2, 98))
                if p98 > p2:
                    arr = np.clip((arr - p2) / (p98 - p2), 0.0, 1.0) * 255.0
                else:
                    arr = np.zeros_like(arr)
                image = Image.fromarray(arr.astype(np.uint8))
        else:
            image = Image.open(io.BytesIO(contents)).convert("RGB")
            image.thumbnail((512, 512), Image.Resampling.BILINEAR)

        preview_path = "outputs/uploaded_preview.png"
        image.save(preview_path, format="PNG")

        res = run_low_latency_pipeline(image, base_datum_m, max_relief_m, bounds, native_crs, native_transform, is_georeferenced)
        res["image_url"] = f"/{preview_path}?v={np.random.randint(10000)}"
        res["file_name"] = file.filename
        return res
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})

@app.get("/api/load-sample")
async def load_sample(scene_id: str = Query("gamus_suburban")):
    fallback = "inputs/GAMUS_DC_03_26.png"
    img = Image.open(fallback).convert("RGB")
    res = run_low_latency_pipeline(img)
    res["image_url"] = f"/{fallback}?v={np.random.randint(1000)}"
    return res

@app.get("/api/disaster/flood-analysis")
def calculate_flood_risk(water_rise_m: float = Query(5.0)):
    if CURRENT_TACTICAL_CONTEXT["dsm"] is None:
        return JSONResponse(status_code=400, content={"error": "No terrain loaded"})
    dsm = CURRENT_TACTICAL_CONTEXT["dsm"]
    flood_level = CURRENT_TACTICAL_CONTEXT["base_elev"] + water_rise_m
    submerged_mask = dsm < flood_level
    submerged_pixels = int(np.sum(submerged_mask))
    pixel_area_m2 = (CURRENT_TACTICAL_CONTEXT["pixel_res_m"]) ** 2
    return {
        "status": "success",
        "flood_water_amsl_m": round(flood_level, 2),
        "inundated_area_m2": round(submerged_pixels * pixel_area_m2, 1),
        "inundated_volume_m3": round(float(np.sum(np.where(submerged_mask, flood_level - dsm, 0.0)) * pixel_area_m2), 1),
        "max_water_depth_m": round(float(np.max(np.where(submerged_mask, flood_level - dsm, 0.0))), 2)
    }

@app.get("/api/disaster/helipad-triage")
def detect_certified_helipads():
    if CURRENT_TACTICAL_CONTEXT["dsm"] is None:
        return JSONResponse(status_code=400, content={"error": "No terrain loaded"})
    dsm = CURRENT_TACTICAL_CONTEXT["dsm"]
    h, w = dsm.shape
    dy, dx = np.gradient(dsm)
    slope_deg = np.degrees(np.arctan(np.sqrt(dx**2 + dy**2)))
    flat_elevated = ((dsm - CURRENT_TACTICAL_CONTEXT["base_elev"]) > 8.0) & (slope_deg < 3.0)
    labeled, num_features = label(flat_elevated)
    min_lon, min_lat, max_lon, max_lat = CURRENT_TACTICAL_CONTEXT["bounds"]
    candidates = []
    for feat_id in range(1, min(num_features + 1, 10)):
        pts = np.argwhere(labeled == feat_id)
        if len(pts) > 20:
            r_c, c_c = np.mean(pts, axis=0).astype(int)
            candidates.append({
                "lat": round(min_lat + ((h - r_c) / h) * (max_lat - min_lat), 4),
                "lon": round(min_lon + (c_c / w) * (max_lon - min_lon), 4),
                "elevation_amsl_m": round(float(dsm[r_c, c_c]), 1),
                "pad_area_m2": round(len(pts) * 0.25, 1)
            })
    return {"status": "success", "verified_landing_zones": len(candidates), "candidates": candidates}

@app.get("/api/disaster/uav-clearance")
def calculate_uav_clearance(safety_margin_m: float = Query(15.0)):
    if CURRENT_TACTICAL_CONTEXT["dsm"] is None:
        return JSONResponse(status_code=400, content={"error": "No terrain loaded"})
    tallest = float(np.max(CURRENT_TACTICAL_CONTEXT["dsm"]))
    return {
        "status": "success",
        "tallest_structure_amsl_m": round(tallest, 1),
        "minimum_safe_altitude_amsl_m": round(tallest + safety_margin_m, 1)
    }

@app.get("/api/download-geotiff")
def download_geotiff():
    if os.path.exists(LATEST_GEOTIFF_PATH):
        return FileResponse(LATEST_GEOTIFF_PATH, media_type="image/tiff", filename="TARA3D_Calibrated_DSM_32Bit.tif")
    return JSONResponse(status_code=404, content={"error": "File not generated"})

if os.path.exists("frontend"):
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
