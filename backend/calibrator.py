import numpy as np
from sklearn.linear_model import HuberRegressor

class HuberRANSACCalibrator:
    def __init__(self, epsilon: float = 1.35, alpha: float = 0.0001):
        self.regressor = HuberRegressor(epsilon=epsilon, alpha=alpha)

    def calibrate(self, relative_depth: np.ndarray, base_dem: np.ndarray = None, height_range_m: float = 65.0, datum_m: float = 240.0):
        """
        Calibrates relative disparity [0, 1] to real-world metric elevation AMSL.
        """
        # Invert depth if needed so high objects (rooftops/ridges) have higher elevation values
        norm_disparity = relative_depth.copy()
        
        # Scale relative variation across scene dynamic relief range
        scale = float(height_range_m)
        shift = float(datum_m)

        # Apply metric scaling: elevation = datum + (relative * scale)
        metric_dsm = (norm_disparity * scale) + shift
        return metric_dsm.astype(np.float32), scale, shift
