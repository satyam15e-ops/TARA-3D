from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from PIL import Image
import numpy as np
import io
import os
import rasterio
from scipy.ndimage import zoom
from backend.depth_engine import DepthEngine
from backend.geospatial_engine import GeospatialCalibrationEngine
from backend.legend_generator import export_metric_dsm_with_legend

app = FastAPI(title="TARA-3D Single-View Height Estimation & 3D Flythrough")

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
latest_geotiff_path = "outputs/TARA3D_Calibrated_DSM.tif"

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

        # Inspect GeoTIFF metadata
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

        # Disparity estimation
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

        # Downsample for 60 FPS WebGL mesh rendering
        target_grid = 256
        zy = target_grid / metric_dsm.shape[0]
        zx = target_grid / metric_dsm.shape[1]
        resampled_mesh = zoom(metric_dsm, (zy, zx), order=1)
        elevation_list = resampled_mesh.astype(np.float32).tolist()

        # Save GIS deliverables
        geo_calibrator.export_geotiff(
            metric_dsm, latest_geotiff_path, bounds=bounds, crs_code=native_crs, transform=native_transform
        )
        export_metric_dsm_with_legend(metric_dsm, "outputs/latest_dsm.png")

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
        return {"status": "error", "message": str(e)}

@app.get("/api/download-geotiff")
def download_geotiff():
    if os.path.exists(latest_geotiff_path):
        return FileResponse(
            latest_geotiff_path,
            media_type="image/tiff",
            filename="TARA3D_Calibrated_DSM_32Bit.tif"
        )
    return {"error": "File not generated yet"}

# Mount frontend files after API routes are defined
if os.path.exists("frontend"):
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
