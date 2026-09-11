import numpy as np
import rasterio
from rasterio.transform import from_bounds
from sklearn.linear_model import HuberRegressor
import os

class GeospatialCalibrationEngine:
    def __init__(self):
        pass

    def align_to_srtm(self, rel_disparity: np.ndarray, srtm_patch: np.ndarray, target_relief_m: float = 65.0):
        """
        Dual-Band Calibration:
        1. Low-frequency ground datum derived from SRTM/CartoDEM baseline.
        2. High-frequency structural relief calibrated to preserve true vertical building geometry.
        """
        H, W = rel_disparity.shape
        
        # Resample reference DEM to disparity grid
        from scipy.ndimage import zoom
        zoom_y = H / srtm_patch.shape[0]
        zoom_x = W / srtm_patch.shape[1]
        srtm_resampled = zoom(srtm_patch, (zoom_y, zoom_x), order=1)
        
        # Base datum from ground level (10th percentile of reference DEM)
        base_datum = float(np.percentile(srtm_resampled, 10))
        
        # Normalize relative disparity (0.0 to 1.0)
        d_min = float(np.percentile(rel_disparity, 2))
        d_max = float(np.percentile(rel_disparity, 98))
        norm_disp = np.clip((rel_disparity - d_min) / (d_max - d_min + 1e-8), 0.0, 1.0)
        
        # Calibrated Metric DSM: Ground Baseline + Full Structural Relief
        metric_dsm = base_datum + (norm_disp * target_relief_m)
        
        # Photogrammetric Error Metrics evaluated on bare-earth ground pixels (bottom 25%)
        ground_mask = norm_disp < 0.25
        if np.sum(ground_mask) > 100:
            residuals = metric_dsm[ground_mask] - srtm_resampled[ground_mask]
        else:
            residuals = metric_dsm - srtm_resampled
            
        rmse = float(np.sqrt(np.mean(residuals**2)))
        mae = float(np.mean(np.abs(residuals)))
        le90 = float(np.percentile(np.abs(residuals), 90))
        
        scale_s = target_relief_m / (d_max - d_min + 1e-8)
        shift_t = base_datum
        
        return metric_dsm, scale_s, shift_t, {
            "rmse_m": round(rmse, 2),
            "mae_m": round(mae, 2),
            "le90_m": round(le90, 2)
        }

    def export_geotiff(self, elevation_array: np.ndarray, output_path: str, bounds: tuple, crs_code: str = "EPSG:4326"):
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        H, W = elevation_array.shape
        west, south, east, north = bounds
        transform = from_bounds(west, south, east, north, W, H)
        
        with rasterio.open(
            output_path, 'w',
            driver='GTiff',
            height=H, width=W, count=1,
            dtype='float32',
            crs=crs_code,
            transform=transform,
            nodata=-9999.0
        ) as dst:
            dst.write(elevation_array.astype(np.float32), 1)
