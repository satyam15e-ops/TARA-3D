import unittest
import os
import numpy as np
import rasterio
from backend.geospatial_engine import GeospatialCalibrationEngine

class TestTARA3DGeodeticPipeline(unittest.TestCase):
    def test_decoupled_dual_band_calibration(self):
        calibrator = GeospatialCalibrationEngine()
        
        # Synthetic relative disparity (simulating building footprint)
        H, W = 100, 100
        disp = np.zeros((H, W), dtype=np.float32)
        disp[20:50, 20:50] = 1.0
        
        # Synthetic SRTM 30m datum baseline (240m AMSL)
        srtm = np.full((H, W), 240.0, dtype=np.float32)
        
        metric_dsm, scale_s, shift_t, accuracy = calibrator.align_to_srtm(
            disp, srtm, target_relief_m=65.0
        )
        
        self.assertEqual(metric_dsm.shape, (H, W))
        self.assertAlmostEqual(float(np.min(metric_dsm)), 240.0, delta=1.5)
        self.assertAlmostEqual(float(np.max(metric_dsm)), 305.0, delta=1.5)
        self.assertLessEqual(accuracy["le90_m"], 2.5)
        print("\n[PASS] Decoupled dual-band calibration verified within LE90 bounds.")

    def test_geotiff_export_validity(self):
        calibrator = GeospatialCalibrationEngine()
        test_dsm = np.random.uniform(240.0, 305.0, (64, 64)).astype(np.float32)
        out_path = "outputs/unit_test_dsm.tif"
        bounds = (77.20, 28.61, 77.21, 28.62)
        
        calibrator.export_geotiff(test_dsm, out_path, bounds=bounds)
        self.assertTrue(os.path.exists(out_path))
        
        with rasterio.open(out_path) as src:
            self.assertEqual(src.dtypes[0], "float32")
            self.assertEqual(src.nodata, -9999.0)
            data = src.read(1)
            self.assertEqual(data.shape, (64, 64))
        print("[PASS] 32-bit Float GeoTIFF binary schema and nodata tags verified.")

if __name__ == "__main__":
    unittest.main()
