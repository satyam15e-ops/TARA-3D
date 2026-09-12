import uvicorn
import webbrowser
import threading
import time
import socket

def get_ip_address():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def open_browser():
    time.sleep(2.0)
    webbrowser.open("http://127.0.0.1:8080")

if __name__ == "__main__":
    host_ip = get_ip_address()
    print("=" * 80)
    print("  TARA-3D | SINGLE-VIEW HEIGHT ESTIMATION AND 3D FLYTHROUGH")
    print("  ISRO SAC SIH26175 SOVEREIGN PRODUCTION SERVER")
    print("=" * 80)
    print(f"[*] Serving Unified Mission Cockpit & Geodetic Engine on Port 8080")
    print(f"[*] Local Workstation Access : http://localhost:8080")
    print(f"[*] Network / Remote Access  : http://{host_ip}:8080")
    print("=" * 80)

    # Launch browser automatically
    threading.Thread(target=open_browser, daemon=True).start()

    # Single unified server on 0.0.0.0:8080
    uvicorn.run("backend.app:app", host="0.0.0.0", port=8080, log_level="info")
