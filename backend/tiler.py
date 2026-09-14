import numpy as np
from PIL import Image

def get_hann_window(tile_h, tile_w):
    h_win = np.hanning(tile_h)
    w_win = np.hanning(tile_w)
    return np.outer(h_win, w_win).astype(np.float32)

def process_large_raster_tiled(image: Image.Image, infer_fn, tile_size=512, overlap=64):
    """
    Processes large remote-sensing images using overlapping windows and Hann blending.
    """
    w, h = image.size
    
    # If smaller than one tile, run direct inference
    if w <= tile_size and h <= tile_size:
        return infer_fn(image)

    stride = tile_size - overlap
    step_y = max(1, int(np.ceil((h - overlap) / stride)))
    step_x = max(1, int(np.ceil((w - overlap) / stride)))

    accum_disparity = np.zeros((h, w), dtype=np.float32)
    accum_weight = np.zeros((h, w), dtype=np.float32)
    window = get_hann_window(tile_size, tile_size)

    for iy in range(step_y):
        y0 = iy * stride
        y1 = min(y0 + tile_size, h)
        if y1 - y0 < tile_size:
            y0 = max(0, h - tile_size)
            y1 = h

        for ix in range(step_x):
            x0 = ix * stride
            x1 = min(x0 + tile_size, w)
            if x1 - x0 < tile_size:
                x0 = max(0, w - tile_size)
                x1 = w

            chip = image.crop((x0, y0, x1, y1))
            chip_disp = infer_fn(chip)

            accum_disparity[y0:y1, x0:x1] += chip_disp * window
            accum_weight[y0:y1, x0:x1] += window

    merged = accum_disparity / (accum_weight + 1e-8)
    return merged
