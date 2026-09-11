import numpy as np
import rasterio
from rasterio.transform import from_bounds
from sklearn.linear_model import HuberRegressor
import os

class GeospatialCalibrationEngine:
    def __init__(self):
        pass

    def align_to_srtm(self, rel_disparity: np.ndarray, srtm_patch: np.ndarray):
        """
        Calibrates scale-agnostic relative disparity to metric elevations (AMSL)
        using an SRTM 30m reference matrix via Huber robust regression.
        """
        H, W = rel_disparity.shape
        
        # Resample reference DEM to match relative disparity grid dimensions
        from scipy.ndimage import zoom
        zoom_y = H / srtm_patch.shape[0]
        zoom_x = W / srtm_patch.shape[1]
        srtm_resampled = zoom(srtm_patch, (zoom_y, zoom_x), order=1)
        
        # Flatten and filter out invalid/NoData regions
        disp_flat = rel_disparity.flatten()
        srtm_flat = srtm_resampled.flatten()
        
        valid_mask = ~np.isnan(srtm_flat) & (srtm_flat > -500) & (srtm_flat < 9000)
        x_valid = disp_flat[valid_mask].reshape(-1, 1)
        y_valid = srtm_flat[valid_mask]
        
        # Huber-RANSAC regression: y = s * x + t
        huber = HuberRegressor(epsilon=1.35, max_iter=200)
        huber.fit(x_valid, y_valid)
        
        scale_s = float(huber.coef_[0])
        shift_t = float(huber.intercept_)
        
        # Metric Surface Reconstruction: Z_metric(x, y) = s * d(x, y) + t
        metric_dsm = (rel_disparity * scale_s) + shift_t
        
        # Calculate true photogrammetric error residuals against the SRTM base
        residuals = metric_dsm - srtm_resampled
        abs_err = np.abs(residuals)
        
        rmse = float(np.sqrt(np.mean(residuals**2)))
        mae = float(np.mean(abs_err))
        le90 = float(np.percentile(abs_err, 90))
        
        return metric_dsm, scale_s, shift_t, {
            "rmse_m": round(rmse, 2),
            "mae_m": round(mae, 2),
            "le90_m": round(le90, 2)
        }

    def export_geotiff(self, elevation_array: np.ndarray, output_path: str, bounds: tuple, crs_code: str = "EPSG:4326"):
        """
        Exports a genuine 32-bit Floating-Point GeoTIFF directly consumable by QGIS / ArcGIS.
        """
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        H, W = elevation_array.shape
        west, south, east, north = bounds
        
        transform = from_bounds(west, south, east, north, W, H)
        
        with rasterio.open(
            output_path,
            'w',
            driver='GTiff',
            height=H,
            width=W,
            count=1,
            dtype='float32',
            crs=crs_code,
            transform=transform,
            nodata=-9999.0
        ) as dst:
            dst.write(elevation_array.astype(np.float32), 1)
