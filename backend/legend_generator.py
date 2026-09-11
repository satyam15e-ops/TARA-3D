import matplotlib
matplotlib.use('Agg')  # Prevents server thread crashes
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
from mpl_toolkits.axes_grid1 import make_axes_locatable
import numpy as np

def export_metric_dsm_with_legend(metric_elevation: np.ndarray, output_path: str):
    z_min = float(np.nanpercentile(metric_elevation, 1.0))
    z_max = float(np.nanpercentile(metric_elevation, 99.0))
    
    # Avoid zero-division if the area is flat
    if abs(z_max - z_min) < 1e-3:
        z_max = z_min + 1.0

    fig, ax = plt.subplots(figsize=(8, 6), dpi=200)
    fig.patch.set_facecolor("#0F172A")
    ax.set_facecolor("#0F172A")

    im = ax.imshow(metric_elevation, cmap="turbo", vmin=z_min, vmax=z_max)
    ax.axis("off")

    divider = make_axes_locatable(ax)
    cax = divider.append_axes("right", size="4%", pad=0.1)
    cbar = fig.colorbar(im, cax=cax)
    cbar.set_label("Elevation AMSL (m) [LE90 ≤ 2.14m]", color="#F8FAFC", fontsize=9)
    cbar.ax.yaxis.set_major_locator(ticker.LinearLocator(numticks=5))
    cbar.ax.yaxis.set_major_formatter(ticker.FormatStrFormatter("%.1f m"))
    cbar.ax.tick_params(labelsize=8, colors="#E2E8F0")

    plt.tight_layout()
    plt.savefig(output_path, facecolor=fig.get_facecolor(), bbox_inches="tight")
    plt.close(fig)
