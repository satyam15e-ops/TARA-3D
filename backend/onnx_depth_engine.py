import os
import numpy as np
import onnxruntime as ort
from PIL import Image

class ONNXDepthEngine:
    def __init__(self, model_path="backend/weights/depth_engine.onnx"):
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"ONNX model not found at: {model_path}. Run backend.export_onnx first.")
        
        # Select best available execution provider
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider'] if 'CUDAExecutionProvider' in ort.get_available_providers() else ['CPUExecutionProvider']
        
        session_opts = ort.SessionOptions()
        session_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        session_opts.intra_op_num_threads = os.cpu_count() or 4
        
        self.session = ort.InferenceSession(model_path, sess_options=session_opts, providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name

    def preprocess(self, pil_image: Image.Image, target_size=(518, 518)):
        img = pil_image.convert("RGB").resize(target_size, Image.Resampling.BICUBIC)
        arr = np.array(img, dtype=np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        arr = (arr - mean) / std
        tensor = np.transpose(arr, (2, 0, 1))[np.newaxis, ...]  # Shape: (1, 3, H, W)
        return tensor

    def infer(self, pil_image: Image.Image) -> np.ndarray:
        orig_w, orig_h = pil_image.size
        input_tensor = self.preprocess(pil_image)
        outputs = self.session.run([self.output_name], {self.input_name: input_tensor})
        raw_disparity = np.squeeze(outputs[0])  # Shape: (H, W)
        
        # Resize disparity back to original tile dimensions
        disp_img = Image.fromarray(raw_disparity)
        disp_resized = np.array(disp_img.resize((orig_w, orig_h), Image.Resampling.BICUBIC))
        
        # Normalize disparity 0.0 - 1.0
        d_min, d_max = disp_resized.min(), disp_resized.max()
        norm_disparity = (disp_resized - d_min) / (d_max - d_min + 1e-8)
        return norm_disparity.astype(np.float32)
