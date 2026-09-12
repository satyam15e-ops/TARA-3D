import os
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

def cache_weights():
    target_dir = os.path.join(os.path.dirname(__file__), "weights")
    os.makedirs(target_dir, exist_ok=True)
    model_id = "depth-anything/Depth-Anything-V2-Small-hf"
    
    print(f"[*] Pre-fetching model weights for airgapped deployment: {model_id}")
    processor = AutoImageProcessor.from_pretrained(model_id, cache_dir=target_dir)
    model = AutoModelForDepthEstimation.from_pretrained(model_id, cache_dir=target_dir)
    print(f"[+] Model weights verified and locked in: {target_dir}")

if __name__ == "__main__":
    cache_weights()
