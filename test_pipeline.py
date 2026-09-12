import unittest
import numpy as np
import os
import rasterio
from backend.geospatial_engine import GeospatialCalibrationEngine

class TestTARA3DGeodeticPipeline(unittest.TestCase):
    def setUp(self):
        self.calibrator = GeospatialCalibrationEngine()
        self.test_disp = np.random.uniform(0.1, 0.9, (128, 128)).astype(np.float32)
        self.test_srtm = np.full((32, 32), 240.0, dtype=np.float32)

    def test_decoupled_dual_band_calibration(self):
        metric_dsm, scale_s, shift_t, regime, accuracy = self.calibrator.align_to_srtm(
            self.test_disp, self.test_srtm, target_relief_m=65.0
        )
        # Check shapes
        self.assertEqual(metric_dsm.shape, (128, 128))
        # Check elevation ranges
        self.assertTrue(np.all(metric_dsm >= 235.0))
        self.assertTrue(np.all(metric_dsm <= 315.0))
        # Check regime classification
        self.assertIn(regime, ["URBAN_STRUCTURAL", "HILLY_COMPLEX", "FORESTED_CANOPY", "SPARSE_PLAINS"])
        # Check accuracy metrics format
        self.assertIn("rmse_m", accuracy)
        self.assertIn("le90_m", accuracy)
        self.assertIn("pearson_r", accuracy)
        self.assertLessEqual(accuracy["le90_m"], 1.65)
        print(f"\n[PASS] Decoupled calibration verified: LE90 = {accuracy['le90_m']}m (Regime: {regime})")

    def test_32bit_geotiff_export(self):
        out_tif = "outputs/test_verify_32bit.tif"
        elevation = np.random.uniform(240.0, 305.0, (64, 64)).astype(np.float32)
        bounds = (77.200, 28.610, 77.215, 28.625)

        self.calibrator.export_geotiff(elevation, out_tif, bounds=bounds, crs_code="EPSG:4326")
        self.assertTrue(os.path.exists(out_tif))

        with rasterio.open(out_tif) as src:
            self.assertEqual(src.dtypes[0], 'float32')
            self.assertEqual(src.crs.to_string(), 'EPSG:4326')
            self.assertEqual(src.nodata, -9999.0)
            data = src.read(1)
            self.assertEqual(data.shape, (64, 64))

        if os.path.exists(out_tif):
            os.remove(out_tif)
        print("[PASS] 32-bit Float GeoTIFF binary schema and nodata tags verified.")

if __name__ == "__main__":
    unittest.main()
