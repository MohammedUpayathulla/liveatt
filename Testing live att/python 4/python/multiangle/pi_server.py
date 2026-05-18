"""
pi_server.py  —  Web server on Pi to receive config and employee registrations from Node.js
Node.js sends:
    POST http://<PI_IP>:5003/device-config     — push camera config
    POST http://<PI_IP>:5003/register-employee — push face embedding
    POST http://<PI_IP>:5003/delete-employee   — remove face
    GET  http://<PI_IP>:5003/health            — liveness check

Run:
    python3 pi_server.py
"""

from flask import Flask, request, jsonify
import yaml, socket, sqlite3, base64, numpy as np, cv2, threading, time, requests, os

CONFIG_PATH     = "config.yaml"
DB_PATH         = "face.sqlite"
HEALTH_INTERVAL = 10

# File that signals pi_recognize.py to pause its recognition loop while this
# process is running InsightFace, preventing concurrent heavy CPU/RAM usage
# that can cause the Pi to crash or reboot.
_SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
_FA_BUSY_FILE = os.path.join(_SCRIPT_DIR, ".fa_busy")

MAX_CLUSTER_IMAGES = 8     # hard cap — protect Pi RAM when averaging embeddings
BLUR_THRESHOLD     = 80.0  # Laplacian variance; images below this are too blurry to use

app = Flask(__name__)

# Load InsightFace model once at startup
from insightface.app import FaceAnalysis as _FaceAnalysis
print("[SERVER] Loading InsightFace model...")
_fa = _FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
_fa.prepare(ctx_id=-1, det_size=(160, 160))
print("[SERVER] InsightFace model ready.")

def load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f) or {}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          
    except:
        return {}

def get_device_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return ""

COM_KEY = "LA-COM-2026@SecureKey"

def save_device_ip(ip):
    """Persist the detected device IP into config.yaml."""
    try:
        cfg = load_config()
        if cfg.get("device_ip") == ip:
            return  # Already up to date — no write needed
        cfg["device_ip"] = ip
        with open(CONFIG_PATH, "w") as f:
            yaml.dump(cfg, f, default_flow_style=False)
        print(f"[CONFIG] device_ip updated → {ip}")
    except Exception as e:
        print(f"[CONFIG] Failed to save device_ip: {e}")

def _health_loop():
    while True:
        try:
            cfg         = load_config()
            backend_url = cfg.get("backend_url", "").rstrip("/")
            if not backend_url:
                print("[HEALTH] backend_url not set in config.yaml — skipping heartbeat")
                time.sleep(HEALTH_INTERVAL)
                continue

            current_ip = get_device_ip()

            # Auto-save detected IP to config.yaml so other services can read it
            if current_ip:
                save_device_ip(current_ip)

            health_api = backend_url + "/api/cameras/health-update"
            payload = {
                "device_id": cfg.get("device_id", "pi_cam_01"),
                "device_ip": current_ip,
                "status":    "online",
            }
            headers = {
                "Content-Type": "application/json",
                "X-Com-Key":    COM_KEY,
            }
            requests.post(health_api, json=payload, headers=headers, timeout=5)
            print(f"[HEALTH] Sent: {payload}")
        except Exception as e:
            print(f"[HEALTH] Error: {e}")
        time.sleep(HEALTH_INTERVAL)

threading.Thread(target=_health_loop, daemon=True).start()

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS face_embeddings (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_code TEXT NOT NULL UNIQUE,
            name          TEXT,
            embedding     BLOB NOT NULL,
            face_image    BLOB,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit(); conn.close()

def _laplacian_variance(img):
    """Return Laplacian variance (sharpness score) of an image."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return cv2.Laplacian(gray, cv2.CV_64F).var()


def _decode_b64_image(b64_str):
    """Decode a base64 string to a cv2 BGR image. Returns None on failure."""
    try:
        img_bytes = base64.b64decode(b64_str)
        buf = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if img is None:
            return None
        h, w = img.shape[:2]
        if w > 640 or h > 640:
            scale = 640 / max(w, h)
            img = cv2.resize(img, (int(w * scale), int(h * scale)))
        return img
    except Exception:
        return None


@app.route("/register-employee", methods=["POST"])
def register_employee():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    employee_code = data.get("employee_code")
    name          = data.get("name")

    if not employee_code or not name:
        return jsonify({"error": "employee_code and name are required"}), 400

    # Accept either a single image_base64 (legacy) or an images_base64 list (cluster).
    images_list = data.get("images_base64") or []
    if not images_list and data.get("image_base64"):
        images_list = [data["image_base64"]]

    if not images_list:
        return jsonify({"error": "image_base64 or images_base64 is required"}), 400

    # Cap to protect Pi RAM
    images_list = images_list[:MAX_CLUSTER_IMAGES]

    # Set busy-file once — kept until finally block
    try:
        open(_FA_BUSY_FILE, 'w').close()
    except Exception:
        pass

    valid = []   # list of (embedding, blur_score, img)
    skipped = 0

    try:
        for b64 in images_list:
            img = _decode_b64_image(b64)
            if img is None:
                skipped += 1
                continue

            blur_score = _laplacian_variance(img)

            # Skip blurry images only when we have more than one to work with
            if blur_score < BLUR_THRESHOLD and len(images_list) > 1:
                skipped += 1
                continue

            try:
                faces = _fa.get(img)
            except Exception:
                skipped += 1
                continue

            if not faces:
                skipped += 1
                continue

            face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
            valid.append((face.embedding.astype(np.float32), blur_score, img))

        if not valid:
            return jsonify({"error": "No usable face found in any provided image"}), 400

        # Average embeddings across all valid images, then L2-normalize
        avg_emb = np.mean([e for e, _, _ in valid], axis=0).astype(np.float32)
        norm = np.linalg.norm(avg_emb)
        if norm > 0:
            avg_emb = avg_emb / norm

        # Use the sharpest image as the stored face thumbnail
        best_img = max(valid, key=lambda x: x[1])[2]

    except Exception as e:
        return jsonify({"error": f"Face extraction failed: {e}"}), 500
    finally:
        try:
            os.remove(_FA_BUSY_FILE)
        except Exception:
            pass

    # Save to SQLite
    try:
        _, enc = cv2.imencode('.jpg', best_img)
        conn = sqlite3.connect(DB_PATH)
        conn.execute("DELETE FROM face_embeddings WHERE employee_code = ?", (employee_code,))
        conn.execute(
            "INSERT INTO face_embeddings (employee_code, name, embedding, face_image) VALUES (?,?,?,?)",
            (employee_code, name, avg_emb.tobytes(), enc.tobytes())
        )
        conn.commit(); conn.close()
        print(f"[REGISTER] Saved: {employee_code} ({name}) — {len(valid)} images used, {skipped} skipped")
    except Exception as e:
        return jsonify({"error": f"DB save failed: {e}"}), 500

    return jsonify({
        "status":           "ok",
        "employee_code":    employee_code,
        "name":             name,
        "embedding":        avg_emb.tolist(),
        "images_processed": len(valid),
        "images_skipped":   skipped,
    }), 200

@app.route("/sync-streams", methods=["POST"])
def sync_streams():
    """
    Full replace: Node.js sends the COMPLETE list of active streams for this Pi.
    config.yaml streams dict is replaced entirely — removes stale entries automatically.
    Body: { streams: { "CamName": { rtsp_url, mode, threshold, roi? }, ... },
            punch_cooldown_seconds: 60 }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    new_streams = data.get("streams") or {}
    cooldown    = int(data.get("punch_cooldown_seconds") or 300)

    cfg = load_config()
    cfg["streams"]                = new_streams
    cfg["punch_cooldown_seconds"] = cooldown
    # Keep legacy single rtsp_url pointing to the first stream
    cfg["rtsp_url"] = next((v["rtsp_url"] for v in new_streams.values() if v.get("rtsp_url")), "")

    with open(CONFIG_PATH, "w") as f:
        yaml.dump(cfg, f, default_flow_style=False)

    print(f"[SYNC-STREAMS] Replaced streams → {list(new_streams.keys())}")
    return jsonify({"status": "ok", "streams": list(new_streams.keys())}), 200


@app.route("/delete-device", methods=["POST"])
def delete_device():
    """Remove a stream from config.yaml when the camera is deleted from the UI."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    device_name = data.get("device_name") or data.get("device_id")
    if not device_name:
        return jsonify({"error": "device_name is required"}), 400

    cfg = load_config()
    streams = {k: v for k, v in (cfg.get("streams") or {}).items() if v.get("rtsp_url")}

    if device_name not in streams:
        print(f"[DELETE-DEVICE] Stream '{device_name}' not in config (already removed)")
        return jsonify({"status": "ok", "message": "Stream not found (already removed)",
                        "remaining_streams": list(streams.keys())}), 200

    del streams[device_name]
    cfg["streams"] = streams

    # Keep legacy single rtsp_url pointing to the first active stream
    cfg["rtsp_url"] = next((v["rtsp_url"] for v in streams.values()), "")

    with open(CONFIG_PATH, "w") as f:
        yaml.dump(cfg, f, default_flow_style=False)

    print(f"[DELETE-DEVICE] Removed stream: '{device_name}'. Remaining: {list(streams.keys())}")
    return jsonify({"status": "ok", "removed": device_name,
                    "remaining_streams": list(streams.keys())}), 200


@app.route("/delete-employee", methods=["POST"])
def delete_employee():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    employee_code = data.get("employee_code")
    if not employee_code:
        return jsonify({"error": "employee_code required"}), 400

    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("DELETE FROM face_embeddings WHERE employee_code = ?", (employee_code,)).rowcount
    conn.commit(); conn.close()

    if rows == 0:
        return jsonify({"error": "Employee not found"}), 404

    print(f"[DELETE] Removed: {employee_code}")
    return jsonify({"status": "ok", "employee_code": employee_code}), 200

@app.route("/device-config", methods=["POST"])
def device_config():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    # Load existing config to preserve fields like backend_url and streams
    existing = load_config()

    # Priority: IP explicitly sent by backend → auto-detected → existing
    backend_ip = (data.get("device_ip") or "").strip()
    live_ip    = backend_ip or get_device_ip() or existing.get("device_ip", "")

    stream_name    = data.get("device_name", existing.get("device_name", "Camera"))
    stream_rtsp    = data.get("rtsp_url",    existing.get("rtsp_url",    "0"))
    stream_mode    = data.get("camera_mode", data.get("mode", existing.get("camera_mode", "in")))
    stream_thresh  = float(data.get("threshold") or existing.get("threshold") or 0.6)
    stream_enabled = bool(data.get("enabled", data.get("enable_device", existing.get("enabled", True))))

    # ── Multi-stream: maintain a streams dict keyed by device_name ────────────
    # Each entry: { rtsp_url, mode, threshold }
    # When enable_device=false we remove that stream from the dict.
    # Clean out any pre-existing entries that have no rtsp_url (corrupted state).
    streams = {k: v for k, v in (existing.get("streams") or {}).items() if v.get("rtsp_url")}

    if stream_enabled and stream_rtsp and stream_rtsp != "0":
        streams[stream_name] = {
            "rtsp_url":  stream_rtsp,
            "mode":      stream_mode,
            "threshold": stream_thresh,
        }
        print(f"[SERVER] Added/updated stream {stream_name!r} → {stream_rtsp}")
    else:
        removed = streams.pop(stream_name, None)
        if removed:
            print(f"[SERVER] Removed disabled stream {stream_name!r}")

    # Legacy single rtsp_url = first active stream (keeps old pi_recognize.py working)
    first_rtsp = next((v["rtsp_url"] for v in streams.values()), stream_rtsp)

    config = {
        "device_id":              data.get("device_id",   existing.get("device_id",   "pi_cam_01")),
        "device_ip":              live_ip,
        "device_name":            stream_name,
        "rtsp_url":               first_rtsp,   # legacy fallback for single-stream mode
        "threshold":              stream_thresh,
        "enabled":                stream_enabled,
        "camera_mode":            stream_mode,
        "punch_cooldown_seconds": int(data.get("punch_cooldown_seconds", existing.get("punch_cooldown_seconds", 300))),
        "backend_url":            existing.get("backend_url", ""),
        "server_port":            existing.get("server_port", 5003),
        "roi":                    existing.get("roi", None),
        "streams":                streams,       # multi-stream dict
    }

    with open(CONFIG_PATH, "w") as f:
        yaml.dump(config, f, default_flow_style=False)

    stream_list = list(streams.keys())
    print(f"[SERVER] Config updated: device_id={config['device_id']}  streams={stream_list}")
    return jsonify({"status": "ok", "config": config}), 200

@app.route("/clear-all-faces", methods=["POST"])
def clear_all_faces():
    """Delete every face embedding from SQLite — called by Node.js admin reset."""
    try:
        conn = sqlite3.connect(DB_PATH)
        deleted = conn.execute("DELETE FROM face_embeddings").rowcount
        conn.commit(); conn.close()
        print(f"[CLEAR-ALL] Removed {deleted} face embeddings from SQLite")
        return jsonify({"status": "ok", "deleted": deleted}), 200
    except Exception as e:
        return jsonify({"error": f"Clear failed: {e}"}), 500


@app.route("/set-roi", methods=["POST"])
def set_roi():
    """Set or clear ROI for a named stream without touching the rest of config.
    Body: { stream_name: str, roi: [x1,y1,x2,y2] | null }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400
    stream_name = data.get("stream_name")
    if not stream_name:
        return jsonify({"error": "stream_name is required"}), 400
    roi = data.get("roi")  # [x1,y1,x2,y2] or null

    cfg = load_config()
    if "streams" not in cfg or not isinstance(cfg.get("streams"), dict):
        cfg["streams"] = {}
    if stream_name not in cfg["streams"]:
        cfg["streams"][stream_name] = {}

    if roi and len(roi) == 4 and roi[2] > roi[0] and roi[3] > roi[1]:
        cfg["streams"][stream_name]["roi"] = [int(v) for v in roi]
        print(f"[ROI] Set for '{stream_name}': {roi}")
    else:
        cfg["streams"][stream_name]["roi"] = None
        print(f"[ROI] Cleared for '{stream_name}'")

    with open(CONFIG_PATH, "w") as f:
        yaml.dump(cfg, f, default_flow_style=False)
    return jsonify({"status": "ok", "stream_name": stream_name, "roi": roi}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "running"}), 200

def setup_eth0():
    """Set static IP and route on eth0 automatically."""
    import subprocess
    cfg        = load_config()
    static_ip  = cfg.get("device_ip", "172.16.0.100")
    try:
        subprocess.run(["ip", "addr", "add", f"{static_ip}/16", "dev", "eth0"],
                       capture_output=True)
        subprocess.run(["ip", "route", "add", "172.16.0.0/16", "dev", "eth0"],
                       capture_output=True)
        print(f"[NET] eth0 set to {static_ip}/16")
    except Exception as e:
        print(f"[NET] eth0 setup error: {e}")

if __name__ == "__main__":
    setup_eth0()

    # Detect and immediately save the Pi's current IP to config.yaml
    pi_ip = get_device_ip() or "0.0.0.0"
    if pi_ip != "0.0.0.0":
        save_device_ip(pi_ip)

    init_db()
    cfg  = load_config()
    port = int(cfg.get("server_port", 5003))
    print(f"\n[SERVER] Pi IP  : {pi_ip}")
    print(f"[SERVER] Port   : {port}")
    print(f"[SERVER] Give Node.js this URL:")
    print(f"         POST http://{pi_ip}:{port}/device-config\n")

    app.run(host="0.0.0.0", port=port, debug=False)
