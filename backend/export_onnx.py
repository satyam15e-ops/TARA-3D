import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

import torch
from backend.depth_engine import DepthEngine

def export_to_onnx():
    weights_dir = os.path.join(BASE_DIR, "backend", "weights")
    os.makedirs(weights_dir, exist_ok=True)
    output_path = os.path.join(weights_dir, "depth_engine.onnx")

    print("[*] Loading DepthEngine model...")
    engine = DepthEngine()
    model = engine.model.eval()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = model.to(device)

    # Standard model input resolution
    dummy_input = torch.randn(1, 3, 518, 518, device=device)

    print(f"[*] Exporting to ONNX on device: {device}...")
    try:
        # PyTorch >= 2.1 supports dynamo=False to explicitly select classic tracing
        torch.onnx.export(
            model,
            dummy_input,
            output_path,
            export_params=True,
            opset_version=17,
            do_constant_folding=True,
            input_names=["input_rgb"],
            output_names=["predicted_disparity"],
            dynamic_axes={
                "input_rgb": {0: "batch_size", 2: "height", 3: "width"},
                "predicted_disparity": {0: "batch_size", 1: "height", 2: "width"}
            },
            dynamo=False
        )
    except TypeError:
        # Fallback for earlier PyTorch versions where dynamo param does not exist
        torch.onnx.export(
            model,
            dummy_input,
            output_path,
            export_params=True,
            opset_version=17,
            do_constant_folding=True,
            input_names=["input_rgb"],
            output_names=["predicted_disparity"],
            dynamic_axes={
                "input_rgb": {0: "batch_size", 2: "height", 3: "width"},
                "predicted_disparity": {0: "batch_size", 1: "height", 2: "width"}
            }
        )
    print(f"[SUCCESS] ONNX model exported successfully to: {output_path}")

if __name__ == "__main__":
    export_to_onnx()
