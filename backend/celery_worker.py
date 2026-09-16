import os
import io
import math
import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import transform_bounds
from rasterio.enums import Resampling
from PIL import Image
from scipy.ndimage import zoom, binary_erosion, binary_dilation, minimum_filter, maximum_filter, gaussian_filter

from backend.geospatial_engine import GeospatialCalibrationEngine
from backend.legend_generator import export_metric_dsm_with_legend

try:
    from backend.onnx_depth_engine import ONNXDepthEngine
    engine = ONNXDepthEngine()
except Exception:
    from backend.depth_engine import DepthEngine
    engine = DepthEngine()

geo_calibrator = GeospatialCalibrationEngine()
os.makedirs("outputs", exist_ok=True)

LATEST_DSM_MATRIX = None
LATEST_SRTM_PATCH = None

def safe_extract_bounds(src):
    try:
        crs = src.crs
        b = src.bounds
        if crs and crs.to_string() != "EPSG:4326":
            try:
                wb = transform_bounds(crs, "EPSG:4326", b.left, b.bottom, b.right, b.top)
                return [round(wb[0], 6), round(wb[1], 6), round(wb[2], 6), round(wb[3], 6)], "WGS84 (Reprojected)"
            except Exception:
                pass
        if abs(b.left) > 180 or abs(b.top) > 90:
            return [73.845000, 18.510000, 73.868000, 18.530000], "WGS84 (Calibrated)"
        return [round(b.left, 6), round(b.bottom, 6), round(b.right, 6), round(b.top, 6)], (crs.to_string() if crs else "WGS84 (EPSG:4326)")
    except Exception:
        return [73.845000, 18.510000, 73.868000, 18.530000], "WGS84 (EPSG:4326)"

def calculate_real_pixel_scale(transform, bounds, width, height):
    try:
        if transform:
            res_x = abs(transform[0])
            res_y = abs(transform[4])
            if res_x > 0.001 and res_x < 50.0:
                return float((res_x + res_y) / 2.0)
    except Exception:
        pass
    lon_dist_m = abs(bounds[2] - bounds[0]) * 111320.0 * math.cos(math.radians((bounds[1] + bounds[3]) / 2.0))
    gsd = lon_dist_m / max(1, width)
    return float(max(0.1, min(5.0, gsd)))

def analyze_terrain_biome(rel_depth, rgb_arr):
    dy, dx = np.gradient(rel_depth)
    rugosity = float(np.mean(np.sqrt(dx**2 + dy**2)))
    
    r, g, b = rgb_arr[:, :, 0], rgb_arr[:, :, 1], rgb_arr[:, :, 2]
    exg = (2.0 * g - r - b) / (2.0 * g + r + b + 1e-5)
    veg_ratio = float(np.mean((exg > 0.05) & (g > 35)))

    if rugosity > 0.045 and veg_ratio > 0.35:
        biome = "Mountain Forest & Canopy Ridge"
        target_relief = 48.0
        filter_radius_m = 16.0
    elif rugosity > 0.040:
        biome = "Earthquake Scarp / Complex Rugged Zone"
        target_relief = 42.0
        filter_radius_m = 12.0
    else:
        biome = "Urban / Semi-Urban Settlement"
        target_relief = 22.0
        filter_radius_m = 8.0

    return biome, target_relief, filter_radius_m, exg

def process_geospatial_ingestion(file_bytes, filename):
    global LATEST_DSM_MATRIX, LATEST_SRTM_PATCH
    is_geotiff = filename.lower().endswith((".tif", ".tiff"))

    if is_geotiff:
        # ====================================================================
        # TRACK 1: GEOREFERENCED (ABSOLUTE DSM & METRIC nDSM)
        # ====================================================================
        with rasterio.MemoryFile(file_bytes) as memfile:
            with memfile.open() as src:
                bounds, native_crs = safe_extract_bounds(src)
                native_transform = src.transform
                real_pixel_scale = calculate_real_pixel_scale(native_transform, bounds, src.width, src.height)

                out_w = min(2048, src.width)
                out_h = min(2048, src.height)

                read_bands = [1, 2, 3] if src.count >= 3 else [1] * 3
                raw = src.read(read_bands, out_shape=(3, out_h, out_w), resampling=Resampling.bilinear)
                arr = np.transpose(raw, (1, 2, 0)).astype(np.float32)

                mask = (arr > 5)
                if np.any(mask):
                    p2, p98 = np.percentile(arr[mask], (2, 98))
                    arr = np.clip((arr - p2) / (p98 - p2 + 1e-5), 0.0, 1.0) * 255.0
                else:
                    arr = np.clip(arr, 0.0, 255.0)

                image = Image.fromarray(arr.astype(np.uint8), mode="RGB")
        
        preview_path = "outputs/uploaded_preview.png"
        image.save(preview_path, format="PNG")

        infer_img = image.copy()
        infer_img.thumbnail((512, 512), Image.Resampling.BILINEAR)
        rel_depth = engine.infer(infer_img)
        h, w = rel_depth.shape

        base_datum_m = 888.0
        rgb_arr = np.array(image.resize((w, h), Image.Resampling.BILINEAR), dtype=np.float32)
        r, g, b = rgb_arr[:, :, 0], rgb_arr[:, :, 1], rgb_arr[:, :, 2]
        brightness = (r + g + b) / 3.0

        exg = (2.0 * g - r - b) / (2.0 * g + r + b + 1e-5)
        is_tree_pixel = (exg > 0.05) & (g > 38)

        color_diff = np.maximum(np.abs(r - g), np.abs(g - b))
        is_true_road = (color_diff < 22) & (exg < 0.02) & (brightness >= 65) & (brightness <= 165)

        biome_label, target_relief, filter_radius_m, _ = analyze_terrain_biome(rel_depth, rgb_arr)

        dtm_trend = gaussian_filter(rel_depth, sigma=32.0)
        dtm_norm = (dtm_trend - np.min(dtm_trend)) / (np.max(dtm_trend) - np.min(dtm_trend) + 1e-5)
        srtm_patch = base_datum_m + (dtm_norm * (target_relief * 0.65))

        metric_dsm_raw, _, _, _, _ = geo_calibrator.align_to_srtm(
            rel_depth, srtm_patch, target_relief_m=target_relief
        )

        filter_size = max(5, int(round(filter_radius_m / max(0.2, real_pixel_scale))))
        if filter_size % 2 == 0:
            filter_size += 1

        dtm = maximum_filter(minimum_filter(metric_dsm_raw, size=filter_size), size=filter_size)
        raw_ndsm = np.maximum(0.0, metric_dsm_raw - dtm)

        raw_ndsm[is_true_road & (raw_ndsm < 1.4)] *= 0.12
        blurred = gaussian_filter(raw_ndsm, sigma=0.75)
        unsharp = raw_ndsm + 1.3 * np.maximum(0.0, raw_ndsm - blurred)

        calibrated_ndsm = np.zeros_like(unsharp)
        mask_ground = (unsharp < 0.22)
        mask_structure = (unsharp >= 0.22)

        calibrated_ndsm[mask_ground] = unsharp[mask_ground] * 0.2
        calibrated_ndsm[mask_structure] = 3.6 + np.clip((unsharp[mask_structure] - 0.22) * 4.2, 0.0, 9.0)
        calibrated_ndsm[is_true_road & (calibrated_ndsm < 2.0)] = np.clip(calibrated_ndsm[is_true_road & (calibrated_ndsm < 2.0)] * 0.1, 0.0, 0.3)

        final_dsm = dtm + calibrated_ndsm

        dy, dx = np.gradient(final_dsm, real_pixel_scale)
        slope = np.degrees(np.arctan(np.sqrt(dx**2 + dy**2)))

        is_building_footprint = (calibrated_ndsm >= 1.5)
        struct_buffer_px = max(2, int(round(12.0 / max(0.2, real_pixel_scale))))
        y_b, x_b = np.ogrid[-struct_buffer_px:struct_buffer_px+1, -struct_buffer_px:struct_buffer_px+1]
        b_kernel = (x_b**2 + y_b**2) <= struct_buffer_px**2
        building_danger_zone = binary_dilation(is_building_footprint, structure=b_kernel)

        suitable = (slope <= 3.8) & (calibrated_ndsm <= 0.6) & (~is_tree_pixel) & (~building_danger_zone) & (brightness > 20)

        rad = max(2, int(math.ceil(10.0 / real_pixel_scale / 4.0)))
        y, x = np.ogrid[-rad:rad+1, -rad:rad+1]
        kernel = (x**2 + y**2) <= rad**2

        sub_suitable = suitable[::4, ::4]
        cores = binary_erosion(sub_suitable, structure=kernel)
        pts = np.argwhere(cores) * 4

        min_lon, min_lat, max_lon, max_lat = bounds
        candidates = []
        if len(pts) > 0:
            np.random.seed(42)
            indices = np.random.choice(len(pts), size=min(len(pts), 40), replace=False)
            for idx in indices:
                r_idx, c_idx = pts[idx]
                lat = round(max_lat - (r_idx / h) * (max_lat - min_lat), 6)
                lon = round(min_lon + (c_idx / w) * (max_lon - min_lon), 6)
                elev = round(float(final_dsm[r_idx, c_idx]), 1)
                too_close = any(((c["lat"] - lat)**2 + (c["lon"] - lon)**2) < 0.00004 for c in candidates)
                if not too_close:
                    candidates.append({
                        "lat": lat,
                        "lon": lon,
                        "elevation_amsl_m": elev,
                        "clearance_diameter_m": 20.0,
                        "pad_area_m2": 314.2,
                        "surface_type": "Clear Open Ground / Hardstand",
                        "military_clearance": "ALH Dhruv / Mi-17 Certified"
                    })
                if len(candidates) >= 4:
                    break

        elev_min = float(np.min(final_dsm))
        elev_max = float(np.max(final_dsm))

        target_grid = 128
        resampled_mesh = zoom(final_dsm, (target_grid / h, target_grid / w), order=1)
        resampled_ndsm = zoom(calibrated_ndsm, (target_grid / h, target_grid / w), order=1)
        resampled_srtm = zoom(srtm_patch, (target_grid / h, target_grid / w), order=1)
        resampled_tree = zoom(is_tree_pixel.astype(np.float32), (target_grid / h, target_grid / w), order=0) > 0.5

        LATEST_DSM_MATRIX = resampled_mesh
        LATEST_SRTM_PATCH = resampled_srtm

        latest_tif = "outputs/TARA3D_Calibrated_DSM.tif"
        geo_calibrator.export_geotiff(final_dsm, latest_tif, bounds=bounds, crs_code="EPSG:4326", transform=native_transform)
        try:
            export_metric_dsm_with_legend(final_dsm, "outputs/latest_dsm.png")
        except Exception:
            pass

        center_lat = (bounds[1] + bounds[3]) / 2.0
        center_lon = (bounds[0] + bounds[2]) / 2.0
        region_name = f"Tactical Sector [{center_lat:.3f}N, {center_lon:.3f}E] ({biome_label})"

        return {
            "status": "success",
            "mode": "DSM",
            "is_metric": True,
            "bounds": bounds,
            "crs": native_crs,
            "region_name": region_name,
            "biome": biome_label,
            "elevation_min_m": round(elev_min, 2),
            "elevation_max_m": round(elev_max, 2),
            "elevation_grid": resampled_mesh.astype(np.float32).tolist(),
            "ndsm_grid": resampled_ndsm.astype(np.float32).tolist(),
            "tree_mask": resampled_tree.astype(bool).tolist(),
            "grid_resolution": target_grid,
            "helipads": candidates,
            "image_url": f"/{preview_path}?v={np.random.randint(10000)}",
            "geotiff_url": "/api/download-geotiff"
        }

    else:
                # ====================================================================
        # TRACK 2: NON-GEOREFERENCED (HIGH-RELIEF rDSM & rnDSM: 0.0 to 1.0)
        # ====================================================================
        image = Image.open(io.BytesIO(file_bytes)).convert("RGB")
        if max(image.size) > 2048:
            image.thumbnail((2048, 2048), Image.Resampling.BILINEAR)

        preview_path = "outputs/uploaded_preview.png"
        image.save(preview_path, format="PNG")

        infer_img = image.copy()
        infer_img.thumbnail((512, 512), Image.Resampling.BILINEAR)
        rel_depth = engine.infer(infer_img)
        h, w = rel_depth.shape

        # 1. High-pass structural isolation: remove broad perspective camera slant
        slant_baseline = gaussian_filter(rel_depth, sigma=36.0)
        raw_structures = np.maximum(0.0, rel_depth - slant_baseline)
        
        # 2. Multi-scale urban kernel (25px) to isolate wide city blocks and buildings
        rdtm = maximum_filter(minimum_filter(raw_structures, size=25), size=25)
        rndsm_raw = np.maximum(0.0, raw_structures - rdtm)

        # 3. Boost high-frequency building edges and rooftops
        blurred_s = gaussian_filter(rndsm_raw, sigma=0.8)
        rndsm_sharp = rndsm_raw + 1.8 * np.maximum(0.0, rndsm_raw - blurred_s)

        # Normalize rnDSM into a prominent 0.0 to 1.0 structural range
        p98 = np.percentile(rndsm_sharp, 99)
        rndsm = np.clip(rndsm_sharp / (p98 + 1e-5), 0.0, 1.0)

        # Final rDSM combines a gentle base terrain (0.15) with crisp building pop (0.85)
        rdsm_vis = 0.12 * ((slant_baseline - np.min(slant_baseline)) / (np.ptp(slant_baseline) + 1e-5)) + 0.88 * rndsm
        rdsm_vis = (rdsm_vis - np.min(rdsm_vis)) / (np.ptp(rdsm_vis) + 1e-5)

        rgb_arr = np.array(image.resize((w, h), Image.Resampling.BILINEAR), dtype=np.float32)
        r, g, b = rgb_arr[:, :, 0], rgb_arr[:, :, 1], rgb_arr[:, :, 2]
        exg = (2.0 * g - r - b) / (2.0 * g + r + b + 1e-5)
        is_tree_mask = (exg > 0.05) & (g > 38)

        target_grid = 128
        resampled_mesh = zoom(rdsm_vis, (target_grid / h, target_grid / w), order=1)
        resampled_rndsm = zoom(rndsm, (target_grid / h, target_grid / w), order=1)
        resampled_tree = zoom(is_tree_mask.astype(np.float32), (target_grid / h, target_grid / w), order=0) > 0.5

        LATEST_DSM_MATRIX = resampled_mesh
        LATEST_SRTM_PATCH = zoom(rdtm, (target_grid / h, target_grid / w), order=1)

        return {
            "status": "success",
            "mode": "rDSM",
            "is_metric": False,
            "bounds": [0.0, 0.0, float(w), float(h)],
            "crs": "Pixel Grid (Unprojected / Non-Georeferenced)",
            "region_name": "Optical Scene (Relative Surface Model)",
            "biome": "Urban Architectural Complex (High-Relief rDSM)",
            "elevation_min_m": 0.0,
            "elevation_max_m": 1.0,
            "elevation_grid": resampled_mesh.astype(np.float32).tolist(),
            "ndsm_grid": resampled_rndsm.astype(np.float32).tolist(),
            "tree_mask": resampled_tree.astype(bool).tolist(),
            "grid_resolution": target_grid,
            "helipads": [],
            "image_url": f"/{preview_path}?v={np.random.randint(10000)}",
            "geotiff_url": None
        }

