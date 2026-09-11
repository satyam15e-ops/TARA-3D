import subprocess
import webbrowser
import time
import sys
import os

print("=" * 70)
print("  TARA-3D / ISRO SAC DepthWizard Production Suite (PS SIH26175)")
print("  Launching Sovereign Geodetic Photogrammetric Engine...")
print("=" * 70)

# Verify environment
if not os.path.exists("outputs"):
    os.makedirs("outputs")

# Start FastAPI backend
backend_cmd = [sys.executable, "-m", "uvicorn", "backend.app:app", "--host", "127.0.0.1", "--port", "8000"]
backend_proc = subprocess.Popen(backend_cmd)

# Start Static Frontend Server
frontend_cmd = [sys.executable, "-m", "http.server", "8080", "--directory", "frontend"]
frontend_proc = subprocess.Popen(frontend_cmd)

print("[INFO] Core Geodetic Processing Engine online at http://127.0.0.1:8000")
print("[INFO] Mission Control Cockpit active at http://127.0.0.1:8080")
time.sleep(1.5)

webbrowser.open("http://127.0.0.1:8080")

try:
    backend_proc.wait()
    frontend_proc.wait()
except KeyboardInterrupt:
    print("\n[INFO] Terminating TARA-3D System Services...")
    backend_proc.terminate()
    frontend_proc.terminate()
    sys.exit(0)
