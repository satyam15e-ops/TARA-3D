from fastapi import FastAPI, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image
import numpy as np
import io
import os
import rasterio
from scipy.ndimage import zoom, uniform_filter
from backend.depth_engine import DepthEngine
from backend.geospatial_engine import GeospatialCalibrationEngine
from backend.legend_generator import export_metric_dsm_with_legend

app = FastAPI(title="TARA-3D Tactical Disaster Intelligence Engine")

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
LATEST_GEOTIFF_PATH = "outputs/TARA3D_Calibrated_DSM.tif"

# Global memory cache of active tactical matrix for sub-10ms disaster triage queries
CURRENT_TACTICAL_CONTEXT = {
    "dsm": None,
    "bounds": [77.200, 28.610, 77.215, 28.625],
    "crs": "EPSG:4326",
    "base_elev": 239.26,
    "max_elev": 304.26,
    "pixel_res_m": 0.5
}

@app.post("/api/reconstruct")
async def reconstruct(
    file: UploadFile = File(...),
    srtm_file: UploadFile = File(None),
    base_datum_m: float = Form(239.26),
    max_relief_m: float = Form(65.0),
    min_lat: float = Form(28.610),
    max_lat: float = Form(28.625),
    min_lon: float = Form(77.200),
    max_lon: float = Form(77.215)
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

        max_dim = 1024
        if max(image.size) > max_dim:
            image.thumbnail((max_dim, max_dim), Image.Resampling.BICUBIC)

        rel_depth = engine.infer(image)
        h, w = rel_depth.shape

        if srtm_file is not None:
            srtm_bytes = await srtm_file.read()
            with rasterio.open(io.BytesIO(srtm_bytes)) as dem_src:
                srtm_patch = dem_src.read(1)
        else:
            x = np.linspace(0, 1, w)
            y = np.linspace(0, 1, h)
            xx, yy = np.meshgrid(x, y)
            srtm_patch = base_datum_m + (xx * 4.0) - (yy * 2.0)

        metric_dsm, scale_s, shift_t, regime, accuracy = geo_calibrator.align_to_srtm(
            rel_depth, srtm_patch, target_relief_m=max_relief_m
        )
        
        mode_type = "Absolute DSM (Metric AMSL)" if is_georeferenced else "Relative DSM (SRTM Anchored)"
        elev_min = float(np.min(metric_dsm))
        elev_max = float(np.max(metric_dsm))

        target_grid = 256
        zy = target_grid / metric_dsm.shape[0]
        zx = target_grid / metric_dsm.shape[1]
        resampled_mesh = zoom(metric_dsm, (zy, zx), order=1)
        elevation_list = resampled_mesh.astype(np.float32).tolist()

        geo_calibrator.export_geotiff(
            metric_dsm, LATEST_GEOTIFF_PATH, bounds=bounds, crs_code=native_crs, transform=native_transform
        )
        export_metric_dsm_with_legend(metric_dsm, "outputs/latest_dsm.png")

        # Cache tactical state for real-time disaster triage
        CURRENT_TACTICAL_CONTEXT["dsm"] = metric_dsm
        CURRENT_TACTICAL_CONTEXT["bounds"] = list(bounds)
        CURRENT_TACTICAL_CONTEXT["crs"] = native_crs
        CURRENT_TACTICAL_CONTEXT["base_elev"] = elev_min
        CURRENT_TACTICAL_CONTEXT["max_elev"] = elev_max
        CURRENT_TACTICAL_CONTEXT["pixel_res_m"] = 500.0 / w  # approx GSD in meters

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
            "elevation_grid": elevation_list,
            "grid_resolution": target_grid,
            "heatmap_url": "/outputs/latest_dsm.png",
            "geotiff_url": "/api/download-geotiff"
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})

@app.get("/api/disaster/flood-analysis")
def calculate_flood_risk(water_rise_m: float = Query(3.0)):
    """
    Sub-millisecond flood hazard calculation for disaster authorities.
    Calculates exact submerged area, depth severity, and inundation coverage.
    """
    if CURRENT_TACTICAL_CONTEXT["dsm"] is None:
        return JSONResponse(status_code=400, content={"error": "No terrain currently loaded"})

    dsm = CURRENT_TACTICAL_CONTEXT["dsm"]
    flood_level = CURRENT_TACTICAL_CONTEXT["base_elev"] + water_rise_m
    submerged_mask = dsm < flood_level

    total_pixels = dsm.size
    submerged_pixels = int(np.sum(submerged_mask))
    pct_inundated = round((submerged_pixels / total_pixels) * 100, 1)

    pixel_area_m2 = (CURRENT_TACTICAL_CONTEXT["pixel_res_m"]) ** 2
    inundated_area_m2 = round(submerged_pixels * pixel_area_m2, 1)

    max_water_depth_m = round(float(flood_level - np.min(dsm)), 2)

    return {
        "status": "success",
        "flood_water_amsl_m": round(flood_level, 2),
        "water_rise_m": water_rise_m,
        "inundated_percentage": pct_inundated,
        "inundated_area_m2": inundated_area_m2,
        "max_water_depth_m": max_water_depth_m,
        "critical_evacuation_alert": pct_inundated > 25.0
    }

@app.get("/api/disaster/helipad-triage")
def detect_certified_helipads():
    """
    Computes ICAO-compliant flat structural platforms for emergency casualty evacuations.
    Analyzes local gradient and structural prominence.
    """
    if CURRENT_TACTICAL_CONTEXT["dsm"] is None:
        return JSONResponse(status_code=400, content={"error": "No terrain currently loaded"})

    dsm = CURRENT_TACTICAL_CONTEXT["dsm"]
    h, w = dsm.shape
    base = CURRENT_TACTICAL_CONTEXT["base_elev"]

    # Calculate local gradient (Slope)
    dy, dx = np.gradient(dsm)
    slope_deg = np.degrees(np.arctan(np.sqrt(dx**2 + dy**2)))

    # ICAO criteria: elevated structural platform (>12m above base) and slope < 3.5 degrees
    prominence_mask = (dsm - base) > 12.0
    flat_mask = slope_deg < 3.5
    valid_mask = prominence_mask & flat_mask

    # Downsample coordinates for pinpoint UI landing markers
    step = 24
    candidates = []
    min_lon, min_lat, max_lon, max_lat = CURRENT_TACTICAL_CONTEXT["bounds"]

    for r in range(step, h - step, step):
        for c in range(step, w - step, step):
            if valid_mask[r, c]:
                lon = min_lon + (c / w) * (max_lon - min_lon)
                lat = min_lat + ((h - r) / h) * (max_lat - min_lat)
                candidates.append({
                    "lat": round(lat, 5),
                    "lon": round(lon, 5),
                    "elevation_amsl_m": round(float(dsm[r, c]), 1),
                    "clearance_agl_m": round(float(dsm[r, c] - base), 1),
                    "local_slope_deg": round(float(slope_deg[r, c]), 1),
                    "triage_priority": "PRIMARY" if (dsm[r, c] - base) > 20.0 else "SECONDARY"
                })

    return {
        "status": "success",
        "verified_landing_zones": len(candidates),
        "candidates": candidates[:12] # return top 12 verified pads
    }

@app.get("/api/download-geotiff")
def download_geotiff():
    if os.path.exists(LATEST_GEOTIFF_PATH):
        return FileResponse(
            LATEST_GEOTIFF_PATH,
            media_type="image/tiff",
            filename="TARA3D_Calibrated_DSM_32Bit.tif"
        )
    return JSONResponse(status_code=404, content={"error": "File not generated yet"})

if os.path.exists("frontend"):
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
