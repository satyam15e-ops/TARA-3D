import numpy as np

def compute_metrics(predicted: np.ndarray, ground_truth: np.ndarray):
    diff = predicted - ground_truth
    rmse = float(np.sqrt(np.mean(diff ** 2)))
    mae = float(np.mean(np.abs(diff)))
    le90 = float(np.percentile(np.abs(diff), 90))
    return {"rmse_m": round(rmse, 2), "mae_m": round(mae, 2), "le90_m": round(le90, 2)}
