import numpy as np
from sklearn.linear_model import HuberRegressor

class HuberRANSACCalibrator:
    def __init__(self, epsilon: float = 1.35, alpha: float = 0.0001):
        self.regressor = HuberRegressor(epsilon=epsilon, alpha=alpha)

    def calibrate(self, relative_depth: np.ndarray, base_dem: np.ndarray, sun_elevation_deg: float = 45.0):
        rel_flat = relative_depth.flatten().reshape(-1, 1)
        base_flat = base_dem.flatten()

        mask = np.isfinite(rel_flat.squeeze()) & np.isfinite(base_flat)
        X = rel_flat[mask]
        y = base_flat[mask]

        if len(X) < 100:
            scale, shift = 50.0, float(np.nanmedian(base_dem))
        else:
            self.regressor.fit(X, y)
            scale = float(self.regressor.coef_[0])
            shift = float(self.regressor.intercept_)

        metric_dsm = (relative_depth * scale) + shift
        return metric_dsm, scale, shift
