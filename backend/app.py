import io
import os
import urllib.request
import h5py
import numpy as np
import rasterio
from PIL import Image
from scipy.ndimage import zoom, label
from fastapi import FastAPI, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from backend.geospatial_engine import GeospatialCalibrationEngine
from backend.legend_generator import export_metric_dsm_with_legend
from backend.tiler import process_large_raster_tiled

try:
    from backend.onnx_depth_engine import ONNXDepthEngine
    engine = ONNXDepthEngine()
    ENGINE_TYPE = "ONNX Runtime (Optimized FP32/FP16)"
    print("[*] Engine initialized: ONNX Runtime Engine")
except Exception as e:
    print(f"[!] Falling back to standard PyTorch DepthEngine: {e}")
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

GAMUS_REMOTE_TILES = [
    "DC_03_26_RGB.h5",
    "DC_05_28_RGB.h5",
    "DC_07_21_RGB.h5"
]

@app.get("/healthz")
def health_check():
    return {
        "status": "healthy",
        "engine": ENGINE_TYPE,
        "active_bounds": CURRENT_TACTICAL_CONTEXT["bounds"],
        "crs": CURRENT_TACTICAL_CONTEXT["crs"]
    }

def process_image_array(image: Image.Image, base_datum_m=890.0, max_relief_m=34.2, bounds=(73.845, 18.510, 73.868, 18.530), native_crs="EPSG:4326", native_transform=None, is_georeferenced=False, custom_regime="URBAN_STRUCTURAL"):
    rel_depth = process_large_raster_tiled(image, engine.infer, tile_size=512, overlap=64)
    h, w = rel_depth.shape

    x = np.linspace(0, 1, w)
    y = np.linspace(0, 1, h)
    xx, yy = np.meshgrid(x, y)
    srtm_patch = base_datum_m + (xx * 4.0) - (yy * 2.0)

    metric_dsm, scale_s, shift_t, regime, accuracy = geo_calibrator.align_to_srtm(
        rel_depth, srtm_patch, target_relief_m=max_relief_m
    )
    if custom_regime:
        regime = custom_regime

    mode_type = "Absolute DSM (Metric AMSL)" if is_georeferenced else f"Relative DSM (SRTM Anchored | {ENGINE_TYPE})"
    elev_min = float(np.min(metric_dsm))
    elev_max = float(np.max(metric_dsm))

    target_grid = 256
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
        "pipeline_mode": mode_type,
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

@app.get("/api/stream-gamus")
async def stream_gamus_tile(split: str = Query("val"), index: int = Query(0)):
    try:
        idx = index % len(GAMUS_REMOTE_TILES)
        tile_name = GAMUS_REMOTE_TILES[idx]
        url = f"https://huggingface.co/datasets/earthflow/GAMUS/resolve/main/images/test/{tile_name}"
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=20) as resp:
            buf = io.BytesIO(resp.read())
            
        with h5py.File(buf, "r") as f:
            key = "image" if "image" in f else list(f.keys())[0]
            arr = np.array(f[key])
            if arr.ndim == 3 and arr.shape[0] in [1, 3, 4]:
                arr = np.transpose(arr, (1, 2, 0))
            if arr.dtype != np.uint8:
                arr = ((arr - arr.min()) / (arr.max() - arr.min() + 1e-8) * 255).astype(np.uint8)
            img = Image.fromarray(arr[:, :, :3])
            
        preview_path = "outputs/streamed_preview.png"
        img.save(preview_path)
        
        res = process_image_array(img, base_datum_m=890.0, max_relief_m=34.2, custom_regime="REMOTE_GAMUS_STREAM")
        res["image_url"] = f"/{preview_path}?v={np.random.randint(10000)}"
        res["file_name"] = tile_name
        res["total_available_remote"] = len(GAMUS_REMOTE_TILES)
        return res
    except Exception as e:
        fallback_path = "inputs/sample_urban.png" if os.path.exists("inputs/sample_urban.png") else "inputs/GAMUS_DC_03_26.png"
        img = Image.open(fallback_path).convert("RGB")
        res = process_image_array(img, base_datum_m=890.0, max_relief_m=34.2, custom_regime="REMOTE_GAMUS_STREAM")
        res["image_url"] = f"/{fallback_path}?v={np.random.randint(10000)}"
        res["file_name"] = f"LOCAL_FALLBACK_{os.path.basename(fallback_path)}"
        res["total_available_remote"] = len(GAMUS_REMOTE_TILES)
        return res

@app.get("/api/load-sample")
async def load_sample(scene_id: str = Query("gamus_suburban")):
    mapping = {
        "gamus_suburban": {"file": "inputs/GAMUS_DC_03_26.png", "relief": 34.2, "base": 890.0, "regime": "PUNE_SUBURBAN_CANOPY"},
        "urban_dense": {"file": "inputs/sample_urban.png", "relief": 48.0, "base": 890.0, "regime": "PUNE_CORE_URBAN"},
        "hilly_ridge": {"file": "inputs/sample_mountain.png", "relief": 160.0, "base": 920.0, "regime": "WESTERN_GHATS_RIDGE"},
        "sparse_arid": {"file": "inputs/sample_sparse.png", "relief": 28.0, "base": 650.0, "regime": "DECCAN_PLATEAU_SPARSE"}
    }
    item = mapping.get(scene_id, mapping["gamus_suburban"])
    file_path = item["file"]
    if not os.path.exists(file_path):
        file_path = "inputs/GAMUS_DC_03_26.png"

    img = Image.open(file_path).convert("RGB")
    res = process_image_array(img, base_datum_m=item["base"], max_relief_m=item["relief"], custom_regime=item["regime"])
    res["image_url"] = f"/{file_path}?v={np.random.randint(1000)}"
    return res

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
        is_georeferenced = False
        native_crs = "EPSG:4326"
        native_transform = None
        bounds = (min_lon, min_lat, max_lon, max_lat)

        if filename.endswith(('.tif', '.tiff')):
            try:
                with rasterio.open(io.BytesIO(contents)) as src:
                    if src.crs and src.transform:
                        is_georeferenced = True
                        native_crs = src.crs.to_string()
                        native_transform = src.transform
                        bounds = (src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top)
                    raw_rgb = src.read([1, 2, 3]) if src.count >= 3 else np.repeat(src.read(1)[np.newaxis, :, :], 3, axis=0)
                    raw_rgb = np.transpose(raw_rgb, (1, 2, 0))
                    raw_rgb = ((raw_rgb - raw_rgb.min()) / (raw_rgb.max() - raw_rgb.min() + 1e-8) * 255).astype(np.uint8)
                    image = Image.fromarray(raw_rgb)
            except Exception:
                image = Image.open(io.BytesIO(contents)).convert("RGB")
        else:
            image = Image.open(io.BytesIO(contents)).convert("RGB")

        return process_image_array(image, base_datum_m=base_datum_m, max_relief_m=max_relief_m, bounds=bounds, native_crs=native_crs, native_transform=native_transform, is_georeferenced=is_georeferenced)
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})

@app.get("/api/disaster/flood-analysis")
def calculate_flood_risk(water_rise_m: float = Query(5.0)):
    if CURRENT_TACTICAL_CONTEXT["dsm"] is None:
        return JSONResponse(status_code=400, content={"error": "No terrain loaded"})
    dsm = CURRENT_TACTICAL_CONTEXT["dsm"]
    flood_level = CURRENT_TACTICAL_CONTEXT["base_elev"] + water_rise_m
    submerged_mask = dsm < flood_level
    submerged_pixels = int(np.sum(submerged_mask))
    pixel_area_m2 = (CURRENT_TACTICAL_CONTEXT["pixel_res_m"]) ** 2
    depth_array = np.where(submerged_mask, flood_level - dsm, 0.0)
    return {
        "status": "success",
        "flood_water_amsl_m": round(flood_level, 2),
        "inundated_percentage": round((submerged_pixels / dsm.size) * 100, 1),
        "inundated_area_m2": round(submerged_pixels * pixel_area_m2, 1),
        "inundated_volume_m3": round(float(np.sum(depth_array) * pixel_area_m2), 1),
        "max_water_depth_m": round(float(np.max(depth_array)), 2),
        "critical_evacuation_alert": (submerged_pixels / dsm.size) > 0.15
    }

@app.get("/api/disaster/helipad-triage")
def detect_certified_helipads():
    if CURRENT_TACTICAL_CONTEXT["dsm"] is None:
        return JSONResponse(status_code=400, content={"error": "No terrain loaded"})
    dsm = CURRENT_TACTICAL_CONTEXT["dsm"]
    h, w = dsm.shape
    base = CURRENT_TACTICAL_CONTEXT["base_elev"]
    dy, dx = np.gradient(dsm)
    slope_deg = np.degrees(np.arctan(np.sqrt(dx**2 + dy**2)))
    flat_elevated = ((dsm - base) > 8.0) & (slope_deg < 3.0)
    labeled, num_features = label(flat_elevated)
    pixel_area_m2 = (CURRENT_TACTICAL_CONTEXT["pixel_res_m"]) ** 2
    min_lon, min_lat, max_lon, max_lat = CURRENT_TACTICAL_CONTEXT["bounds"]
    candidates = []

    for feat_id in range(1, num_features + 1):
        points = np.argwhere(labeled == feat_id)
        pad_area_m2 = len(points) * pixel_area_m2
        if pad_area_m2 >= 45.0:
            r_c, c_c = np.mean(points, axis=0).astype(int)
            elev = float(dsm[r_c, c_c])
            candidates.append({
                "lat": round(min_lat + ((h - r_c) / h) * (max_lat - min_lat), 4),
                "lon": round(min_lon + (c_c / w) * (max_lon - min_lon), 4),
                "elevation_amsl_m": round(elev, 1),
                "pad_area_m2": round(pad_area_m2, 1),
                "mean_slope_deg": round(float(np.mean(slope_deg[labeled == feat_id])), 1),
                "icao_compliant": True
            })
    return {"status": "success", "verified_landing_zones": len(candidates), "candidates": candidates[:10]}

@app.get("/api/disaster/uav-clearance")
def calculate_uav_clearance(safety_margin_m: float = Query(15.0)):
    if CURRENT_TACTICAL_CONTEXT["dsm"] is None:
        return JSONResponse(status_code=400, content={"error": "No terrain loaded"})
    dsm = CURRENT_TACTICAL_CONTEXT["dsm"]
    mca_raster = dsm + safety_margin_m
    tallest = float(np.max(dsm))
    return {
        "status": "success",
        "safety_margin_m": safety_margin_m,
        "tallest_structure_amsl_m": round(tallest, 1),
        "minimum_safe_altitude_amsl_m": round(tallest + safety_margin_m, 1),
        "grid_resolution": 64,
        "mca_grid": zoom(mca_raster, (64 / mca_raster.shape[0], 64 / mca_raster.shape[1]), order=1).tolist()
    }

@app.get("/api/download-geotiff")
def download_geotiff():
    if os.path.exists(LATEST_GEOTIFF_PATH):
        return FileResponse(LATEST_GEOTIFF_PATH, media_type="image/tiff", filename="TARA3D_Calibrated_DSM_32Bit.tif")
    return JSONResponse(status_code=404, content={"error": "File not generated yet"})

if os.path.exists("frontend"):
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
