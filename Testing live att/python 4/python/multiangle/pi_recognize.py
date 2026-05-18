"""
pi_recognize.py  —  Face Recognition System for Raspberry Pi
Two pages:
  - Recognition Page : live camera + face recognition + interactive ROI drawing
  - Register Page    : capture face from same camera
Run:
    python3 pi_recognize.py
"""

import cv2, numpy as np, sqlite3, time, threading, yaml, requests, base64, os, signal, uuid
from urllib.parse import unquote
from concurrent.futures import ThreadPoolExecutor
import tkinter as tk
from PIL import Image, ImageTk
from insightface.app import FaceAnalysis
from flask import Flask as _Flask, Response as _Response

# ── CONSTANTS ──────────────────────────────────────────────────────────────────
_SCRIPT_DIR          = os.path.dirname(os.path.abspath(__file__))
DB_PATH              = os.path.join(_SCRIPT_DIR, "face.sqlite")
CONFIG_PATH          = os.path.join(_SCRIPT_DIR, "config.yaml")
# Busy-file written by pi_server.py during InsightFace registration calls.
# When present, we skip the recognition cycle to avoid concurrent heavy
# CPU/RAM usage that can cause the Pi to crash or reboot.
_FA_BUSY_FILE        = os.path.join(_SCRIPT_DIR, ".fa_busy")
DET_SIZE             = (480, 480)   # Multi-person: detect faces in crowded scenes without excessive CPU
DB_RELOAD_INTERVAL   = 5
RECOG_W, RECOG_H     = 640, 480    # match MJPEG size — InsightFace resizes internally anyway
RECOG_INTERVAL       = 0.5         # Multi-person: 2x per second for faster detection of rapid arrivals
QUEUE_FLUSH_INTERVAL = 30
DISPLAY_W, DISPLAY_H = 800, 480
CAM_DISPLAY_H        = DISPLAY_H - 45   # height of camera view area

# ── MULTI-PERSON DETECTION LIMITS ────────────────────────────────────────────────
MAX_FACES_PER_FRAME  = 20               # Cap processing at 20 people per frame
MIN_FACE_SIZE_PX     = 50               # Minimum face width/height (pixels) for known employees

# ── MJPEG STREAM SERVER ────────────────────────────────────────────────────────
# Serves annotated frames (with bounding boxes) as MJPEG on port 5004.
# One endpoint per stream: GET /stream/<stream_name>
# The web backend proxies this at /api/cameras/:id/stream
MJPEG_PORT   = 5004
_mjpeg_buf   = {}           # stream_name → latest JPEG bytes
_mjpeg_lock  = threading.Lock()

MJPEG_STREAM_W  = 640   # Option A: Medium Quality (recommended) — balanced quality + speed
MJPEG_STREAM_H  = 480   # 640x480 provides better vertical coverage for face detection
MJPEG_QUALITY   = 75    # 75% quality — good balance of clarity vs bandwidth
MJPEG_FPS_CAP   = 20    # 20 FPS — smooth playback without excessive CPU
# ── THREAD POOL FOR ATTENDANCE API CALLS ────────────────────────────────────────
_publish_log_executor = ThreadPoolExecutor(max_workers=5, thread_name_prefix="publish-")

# ── LOW-LIGHT ENHANCEMENT ──────────────────────────────────────────────────────
# Created once at module load — CLAHE apply() is not reentrant; recognition worker
# is single-threaded so this is safe without a lock.
_clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))

def _enhance_low_light(frame):
    """Boost contrast via CLAHE on the Y channel (YUV) — helps face detection in dim light."""
    yuv = cv2.cvtColor(frame, cv2.COLOR_BGR2YUV)
    yuv[:, :, 0] = _clahe.apply(yuv[:, :, 0])
    return cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR)

# ── CONFIG ─────────────────────────────────────────────────────────────────────
def load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        print(f"[CONFIG] Read error: {e}")
        return {}

def save_config(cfg):
    try:
        with open(CONFIG_PATH, "w") as f:
            yaml.dump(cfg, f, default_flow_style=False)
    except Exception as e:
        print(f"[CONFIG] Write error: {e}")

_cfg0              = load_config()
DEVICE_ID          = _cfg0.get("device_id",              "pi_cam_01")
DEVICE_IP          = _cfg0.get("device_ip",              "")
DEVICE_NAME        = _cfg0.get("device_name",            "Camera")
CAMERA_MODE        = _cfg0.get("camera_mode",            "in")
THRESHOLD          = float(_cfg0.get("threshold",        0.60))
PUNCH_COOLDOWN_SEC    = int(_cfg0.get("punch_cooldown_seconds", 300))

# ── Unknown face constants ─────────────────────────────────────────────────────
UNKNOWN_COOLDOWN_SEC   = 60     # min seconds between saves for the same cluster
UNKNOWN_MIN_FACE_PX    = 50     # min face width AND height (pixels) to be "clear"
UNKNOWN_CLUSTER_THRESH = 0.45   # cosine distance below which two faces = same person
UNKNOWN_SYNC_INTERVAL  = 20     # seconds between queue flushes to backend

# ── STREAM HOT-RELOAD ──────────────────────────────────────────────────────────
# Dict of currently active SharedCamera objects, keyed by stream name.
# Populated in main() and read by _config_watcher() to reconnect on URL change.
_active_streams  = {}   # { stream_name: SharedCamera }
_config_mtime    = 0.0  # last-seen mtime of config.yaml
# Shared list used by the recognition worker — append here to add streams live.
_all_streams_list = []  # [(stream_name, SharedCamera), ...]

# ── DATABASE ───────────────────────────────────────────────────────────────────
db_embeddings = {}
name_map      = {}
db_lock       = threading.Lock()

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
    conn.execute("""
        CREATE TABLE IF NOT EXISTS attendance_queue (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_code TEXT NOT NULL,
            log_time      TEXT NOT NULL,
            device_id     TEXT,
            device_ip     TEXT,
            device_name   TEXT,
            camera_mode   TEXT,
            attempts      INTEGER DEFAULT 0,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS unknown_queue (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            cluster_id  TEXT NOT NULL,
            face_image  BLOB NOT NULL,
            device_id   TEXT,
            device_ip   TEXT,
            device_name TEXT,
            sent        INTEGER DEFAULT 0,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    for col in ["face_image BLOB", "name TEXT"]:
        try: conn.execute(f"ALTER TABLE face_embeddings ADD COLUMN {col}")
        except: pass
    conn.commit()
    conn.close()

def load_db():
    global name_map
    conn  = sqlite3.connect(DB_PATH)
    rows  = conn.execute("SELECT employee_code, name, embedding FROM face_embeddings").fetchall()
    conn.close()
    db, nm = {}, {}
    for emp, name, blob in rows:
        db[emp] = np.frombuffer(blob, dtype=np.float32)
        nm[emp] = name or emp
    name_map = nm
    return db

def save_registration(employee_code, name, embedding, face_img):
    _, buf = cv2.imencode('.jpg', face_img)
    conn   = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM face_embeddings WHERE employee_code = ?", (employee_code,))
    conn.execute(
        "INSERT INTO face_embeddings (employee_code, name, embedding, face_image) VALUES (?,?,?,?)",
        (employee_code, name, embedding.astype(np.float32).tobytes(), buf.tobytes())
    )
    conn.commit()
    conn.close()

def get_face_image(employee_code):
    conn = sqlite3.connect(DB_PATH)
    row  = conn.execute(
        "SELECT face_image FROM face_embeddings WHERE employee_code = ?", (employee_code,)
    ).fetchone()
    conn.close()
    if row and row[0]:
        buf = np.frombuffer(row[0], np.uint8)
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return None

def _db_reload_loop():
    global db_embeddings
    while True:
        time.sleep(DB_RELOAD_INTERVAL)
        try:
            new = load_db()
            with db_lock: db_embeddings = new
        except Exception as e:
            print(f"[DB] Reload error: {e}")

# ── UNKNOWN FACE TRACKING ─────────────────────────────────────────────────────
# In-memory: cluster_id → centroid embedding (float32)
_unknown_clusters   = {}
# Per-cluster cooldown: cluster_id → last-saved timestamp
_unknown_last_save  = {}
_unknown_lock       = threading.Lock()

# ── SHARED DISPLAY RESULTS — all streams write here, display threads read ──────
# Central recognition worker writes; Tkinter display threads read.
_stream_results      = {}   # stream_name → [(x1,y1,x2,y2, label, color)]
_stream_results_lock = threading.Lock()

# ── ROI CACHE — updated by _config_watcher, read every frame by _read_loop ─────
# Avoids reading config.yaml from disk 15×/sec per camera.
_stream_roi_cache = {}          # stream_name → [x1,y1,x2,y2] or None
_stream_roi_lock  = threading.Lock()

# Per-stream tracking for attendance banner and in-frame deduplication
_stream_in_frame   = {}   # stream_name → set of emp_codes currently visible
_stream_new_emp    = {}   # stream_name → [{"emp": code, "until": float}, ...]  (list for multi-person)
_stream_state_lock = threading.Lock()

def _draw_attendance_banner(frame, stream_key):
    """Draw a green attendance-confirmed banner at the BOTTOM of frame.
    Shows one row per recently detected person. Does nothing if no active detections."""
    now = time.time()
    with _stream_state_lock:
        entries = list(_stream_new_emp.get(stream_key) or [])
    active = [e for e in entries if now < e.get("until", 0)]
    if not active:
        return

    fh, fw  = frame.shape[:2]
    row_h   = max(50, min(80, fh // 8))   # height per person row
    n       = len(active)
    bh      = row_h * n
    fscl    = row_h / 70.0

    # Semi-transparent dark-green background at BOTTOM
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, fh - bh), (fw, fh), (0, 120, 50), -1)
    cv2.addWeighted(overlay, 0.80, frame, 0.20, 0, frame)

    for i, entry in enumerate(active):
        emp      = entry["emp"]
        name_txt = name_map.get(emp, emp)
        row_top  = fh - bh + i * row_h
        cy       = row_top + row_h // 2

        # Filled circle + checkmark
        r  = row_h // 2 - 6
        cx = row_h // 2
        cv2.circle(frame, (cx, cy), r, (0, 210, 90), -1)
        pts = np.array([
            [cx - r//2,      cy],
            [cx - r//7,      cy + r//2],
            [cx + r//2 + 2,  cy - r//2],
        ], np.int32)
        cv2.polylines(frame, [pts], False, (255, 255, 255), max(2, r // 6), cv2.LINE_AA)

        tx = row_h + 10
        # Name
        cv2.putText(frame, name_txt,
                    (tx, int(row_top + row_h * 0.44)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9 * fscl,
                    (255, 255, 255), 2, cv2.LINE_AA)
        # Employee code + label
        cv2.putText(frame, f"{emp}  |  Attendance Marked",
                    (tx, int(row_top + row_h * 0.80)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.50 * fscl,
                    (160, 255, 185), 2, cv2.LINE_AA)

def _get_or_create_cluster(embedding):
    """Return an existing cluster_id if the embedding is close enough,
    else create a new cluster. Thread-safe."""
    emb  = np.asarray(embedding, np.float32)
    norm = np.linalg.norm(emb)
    if norm < 1e-9:
        return str(uuid.uuid4())[:8]
    emb_n = emb / norm

    with _unknown_lock:
        best_id, best_dist = None, 1.0
        for cid, cemb in _unknown_clusters.items():
            cn = np.linalg.norm(cemb)
            if cn < 1e-9: continue
            d = float(1.0 - np.dot(emb_n, cemb / cn))
            if d < best_dist:
                best_dist, best_id = d, cid

        if best_id and best_dist < UNKNOWN_CLUSTER_THRESH:
            # Update centroid with running average
            _unknown_clusters[best_id] = (_unknown_clusters[best_id] + emb) * 0.5
            return best_id
        else:
            new_id = str(uuid.uuid4())[:8]
            _unknown_clusters[new_id] = emb.copy()
            return new_id

def _save_unknown_face(embedding, face_crop, cluster_id, stream_device_name=None):
    """Save unknown face crop to SQLite queue (called from a daemon thread)."""
    try:
        _, buf = cv2.imencode('.jpg', face_crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
        cfg    = load_config()
        conn   = sqlite3.connect(DB_PATH)
        conn.execute(
            "INSERT INTO unknown_queue "
            "(cluster_id, face_image, device_id, device_ip, device_name) "
            "VALUES (?,?,?,?,?)",
            (cluster_id, buf.tobytes(),
             cfg.get("device_id",   DEVICE_ID),
             cfg.get("device_ip",   DEVICE_IP),
             stream_device_name or cfg.get("device_name", DEVICE_NAME))
        )
        conn.commit()
        conn.close()
        print(f"[UNKNOWN] Saved cluster {cluster_id}")
    except Exception as e:
        print(f"[UNKNOWN] Save error: {e}")

def _flush_unknown_queue():
    """Send unsent unknown faces to backend API."""
    cfg         = load_config()
    backend_url = cfg.get("backend_url", "").rstrip("/")
    if not backend_url:
        return
    api = backend_url + "/api/unknown-faces/log"
    try:
        conn = sqlite3.connect(DB_PATH)
        rows = conn.execute(
            "SELECT id, cluster_id, face_image, device_id, device_ip, device_name "
            "FROM unknown_queue WHERE sent = 0 ORDER BY id LIMIT 20"
        ).fetchall()
        conn.close()
    except Exception as e:
        print(f"[UNKNOWN] Queue read error: {e}")
        return

    if not rows:
        return

    for row in rows:
        row_id, cluster_id, face_blob, dev_id, dev_ip, dev_name = row
        try:
            img_b64 = base64.b64encode(face_blob).decode("utf-8")
            payload = {
                "cluster_id":  cluster_id,
                "face_image":  img_b64,
                "device_id":   dev_id  or DEVICE_ID,
                "device_ip":   dev_ip  or DEVICE_IP,
                "device_name": dev_name or DEVICE_NAME,
                "captured_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            resp = requests.post(api, json=payload, timeout=10)
            if resp.status_code in (200, 201):
                conn2 = sqlite3.connect(DB_PATH)
                conn2.execute("UPDATE unknown_queue SET sent = 1 WHERE id = ?", (row_id,))
                conn2.commit()
                conn2.close()
                print(f"[UNKNOWN] Sent cluster {cluster_id}")
            elif resp.status_code in (400, 422):
                conn2 = sqlite3.connect(DB_PATH)
                conn2.execute("UPDATE unknown_queue SET sent = 1 WHERE id = ?", (row_id,))
                conn2.commit()
                conn2.close()
            else:
                break   # backend error — retry later
        except Exception as e:
            print(f"[UNKNOWN] Send error: {e}")
            break

def _unknown_sync_loop():
    while True:
        time.sleep(UNKNOWN_SYNC_INTERVAL)
        try: _flush_unknown_queue()
        except Exception as e: print(f"[UNKNOWN] Sync loop error: {e}")

# ── PER-STREAM ROI HELPERS ────────────────────────────────────────────────────
def _get_stream_roi(stream_name):
    """Return ROI [x1,y1,x2,y2] from in-memory cache — never hits disk."""
    with _stream_roi_lock:
        return _stream_roi_cache.get(stream_name)

def _parse_roi(roi):
    """Validate and normalise a raw roi value → [x1,y1,x2,y2] or None."""
    if roi and len(roi) == 4 and roi[2] > roi[0] and roi[3] > roi[1]:
        return [int(v) for v in roi]
    return None

def _save_stream_roi(stream_name, roi):
    """Save ROI for a named stream into config.yaml and update in-memory cache."""
    try:
        cfg = load_config()
        if "streams" not in cfg or not isinstance(cfg["streams"], dict):
            cfg["streams"] = {}
        if stream_name not in cfg["streams"]:
            cfg["streams"][stream_name] = {}
        cfg["streams"][stream_name]["roi"] = roi
        save_config(cfg)
        with _stream_roi_lock:
            _stream_roi_cache[stream_name] = _parse_roi(roi)
        print(f"[ROI:{stream_name}] Saved: {roi}")
    except Exception as e:
        print(f"[ROI:{stream_name}] Save error: {e}")

def _clear_stream_roi(stream_name):
    """Clear ROI for a named stream in config.yaml and in-memory cache."""
    try:
        cfg = load_config()
        if "streams" in cfg and stream_name in (cfg["streams"] or {}):
            cfg["streams"][stream_name]["roi"] = None
            save_config(cfg)
        with _stream_roi_lock:
            _stream_roi_cache.pop(stream_name, None)
        print(f"[ROI:{stream_name}] Cleared")
    except Exception as e:
        print(f"[ROI:{stream_name}] Clear error: {e}")

# ── CENTRAL RECOGNITION WORKER (all streams, equal priority) ──────────────────
def _recognition_worker(all_streams):
    """Single round-robin recognition loop covering ALL camera streams.

    all_streams: list of (stream_name, SharedCamera) — primary first,
                 then secondary cameras in order.

    Processing cameras sequentially ensures:
      • Equal InsightFace time for EVERY camera regardless of count.
      • No lock contention — one thread calls fa.get() at a time.
      • Scales to N cameras: just add to the list.

    Results go into _stream_results[stream_name] so both
    RecognitionPage._update_display and SecondaryStreamWindow._update
    can overlay face boxes independently.
    """
    print(f"[RECOG] Central worker started - {len(all_streams)} stream(s): "
          f"{[n for n, _ in all_streams]}")

    last_run = {name: 0.0 for name, _ in all_streams}

    while True:
        # Yield while pi_server.py is running InsightFace for enrollment
        if os.path.exists(_FA_BUSY_FILE):
            time.sleep(0.3)
            continue

        now      = time.time()
        did_work = False

        for stream_name, camera in list(all_streams):  # list() snapshot — safe for concurrent appends
            if now - last_run.get(stream_name, 0.0) < RECOG_INTERVAL:
                continue

            frame = camera.get_frame()
            if frame is None:
                last_run[stream_name] = now
                continue

            last_run[stream_name] = now
            did_work = True

            fh, fw = frame.shape[:2]
            small  = _enhance_low_light(cv2.resize(frame, (RECOG_W, RECOG_H)))
            rx, ry = RECOG_W / fw, RECOG_H / fh

            # Apply per-stream ROI (coords stored in MJPEG_STREAM space: 640×360)
            roi = _get_stream_roi(stream_name)
            if roi:
                rsx = RECOG_W / MJPEG_STREAM_W  # 960/640 = 1.5
                rsy = RECOG_H / MJPEG_STREAM_H  # 540/360 = 1.5
                srx1 = max(0,       int(roi[0] * rsx))
                sry1 = max(0,       int(roi[1] * rsy))
                srx2 = min(RECOG_W, int(roi[2] * rsx))
                sry2 = min(RECOG_H, int(roi[3] * rsy))
                if srx2 > srx1 + 10 and sry2 > sry1 + 10:
                    crop = small[sry1:sry2, srx1:srx2]
                    with fa_lock: faces = fa.get(crop)
                    for face in faces:
                        face.bbox[0] += srx1; face.bbox[2] += srx1
                        face.bbox[1] += sry1; face.bbox[3] += sry1
                else:
                    with fa_lock: faces = fa.get(small)
            else:
                with fa_lock: faces = fa.get(small)

            display_results = []
            seen_emps       = set()
            _unk_idx        = 0

            prev_in_frame = _stream_in_frame.get(stream_name, set())

            # Multi-person optimization: sort by size (largest first) and cap at MAX_FACES_PER_FRAME
            if len(faces) > MAX_FACES_PER_FRAME:
                print(f"[WARN] {len(faces)} faces detected, processing top {MAX_FACES_PER_FRAME} by area")
                faces = sorted(faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]), reverse=True)[:MAX_FACES_PER_FRAME]
            elif len(faces) > 5:
                # Sort by size for better accuracy in crowds (process largest/clearest first)
                faces = sorted(faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]), reverse=True)

            for face in faces:
                x1, y1, x2, y2 = face.bbox.astype(int)
                x1 = max(0, min(x1, RECOG_W))
                y1 = max(0, min(y1, RECOG_H))
                x2 = max(0, min(x2, RECOG_W))
                y2 = max(0, min(y2, RECOG_H))
                face_w, face_h = x2 - x1, y2 - y1

                emp, dist = match_face(face.embedding)
                if emp:
                    # Skip very small/far-away faces for known employees (unreliable match)
                    if face_w < MIN_FACE_SIZE_PX or face_h < MIN_FACE_SIZE_PX:
                        continue

                    seen_emps.add(emp)
                    label, color = name_map.get(emp, emp), (0, 200, 0)
                    # Heartbeat: tell the frontend this person is still in frame (every 5 s)
                    signal_presence(emp, stream_device_name=stream_name)
                    # Log attendance only on first appearance (subject to 300 s cooldown)
                    if emp not in prev_in_frame:
                        publish_log(emp, stream_device_name=stream_name)
                        with _stream_state_lock:
                            now_ts  = time.time()
                            entries = _stream_new_emp.get(stream_name, [])
                            # Keep non-expired entries, remove duplicate of same employee
                            entries = [e for e in entries
                                       if now_ts < e.get("until", 0) and e["emp"] != emp]
                            entries.append({"emp": emp, "until": now_ts + 5})
                            _stream_new_emp[stream_name] = entries
                else:
                    _unk_idx += 1
                    cluster_id = _get_or_create_cluster(face.embedding)
                    label, color = f"Unknown {_unk_idx}", (0, 0, 210)
                    w_f, h_f = x2 - x1, y2 - y1
                    if w_f >= UNKNOWN_MIN_FACE_PX and h_f >= UNKNOWN_MIN_FACE_PX:
                        now_ts   = time.time()
                        save_key = f"{cluster_id}:{stream_name}"   # per-stream cooldown
                        with _unknown_lock:
                            last_save = _unknown_last_save.get(save_key, 0)
                        if now_ts - last_save >= UNKNOWN_COOLDOWN_SEC:
                            with _unknown_lock:
                                _unknown_last_save[save_key] = now_ts
                            pad       = int(max(w_f, h_f) * 0.3)
                            px1       = max(0,              x1 - pad)
                            py1       = max(0,              y1 - pad)
                            px2       = min(frame.shape[1], x2 + pad)
                            py2       = min(frame.shape[0], y2 + pad)
                            face_crop = frame[py1:py2, px1:px2].copy()
                            threading.Thread(
                                target=_save_unknown_face,
                                args=(face.embedding.copy(), face_crop, cluster_id, stream_name),
                                daemon=True
                            ).start()

                display_results.append((x1, y1, x2, y2, label, color))

            # Update per-stream tracking and shared display results
            _stream_in_frame[stream_name] = seen_emps
            with _stream_results_lock:
                _stream_results[stream_name] = display_results

            # Emit bounding box coordinates for real-time canvas overlay in frontend
            # Always emit (even empty) so the frontend clears stale boxes when no faces present
            bbox_payload = [
                {
                    "x1": int(x1), "y1": int(y1), "x2": int(x2), "y2": int(y2),
                    "known": (color == (0, 200, 0)),
                }
                for (x1, y1, x2, y2, _, color) in display_results
            ]
            _emit_bbox_frame(stream_name, RECOG_W, RECOG_H, bbox_payload)

        if not did_work:
            time.sleep(0.01)   # brief yield when all cameras within their interval

# ── OFFLINE ATTENDANCE QUEUE ───────────────────────────────────────────────────
def _queue_save(payload):
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            "INSERT INTO attendance_queue "
            "(employee_code, log_time, device_id, device_ip, device_name, camera_mode) "
            "VALUES (?,?,?,?,?,?)",
            (payload["employee_code"], payload["time"],
             payload.get("device_id"), payload.get("device_ip"),
             payload.get("device_name"), payload.get("camera_mode"))
        )
        conn.commit()
        conn.close()
        print(f"[QUEUE] Saved offline: {payload['employee_code']} at {payload['time']}")
    except Exception as e:
        print(f"[QUEUE] Save error: {e}")

def flush_queue():
    cfg         = load_config()
    backend_url = cfg.get("backend_url", "").rstrip("/")
    if not backend_url:
        return
    attendance_api = backend_url + "/api/attendance/log"
    try:
        conn = sqlite3.connect(DB_PATH)
        rows = conn.execute(
            "SELECT id, employee_code, log_time, device_id, device_ip, device_name, camera_mode "
            "FROM attendance_queue ORDER BY id LIMIT 50"
        ).fetchall()
        conn.close()
    except: return

    if not rows: return
    print(f"[QUEUE] Flushing {len(rows)} queued log(s)...")
    for row in rows:
        row_id, emp_code, log_time, dev_id, dev_ip, dev_name, cam_mode = row
        payload = {
            "employee_code": emp_code,
            "time":          log_time,
            "device_id":     dev_id   or DEVICE_ID,
            "device_ip":     dev_ip   or DEVICE_IP,
            "device_name":   dev_name or DEVICE_NAME,
            "camera_mode":   cam_mode or CAMERA_MODE,
        }
        try:
            resp = requests.post(attendance_api, json=payload, timeout=5)
            if resp.status_code == 200:
                conn2 = sqlite3.connect(DB_PATH)
                conn2.execute("DELETE FROM attendance_queue WHERE id = ?", (row_id,))
                conn2.commit()
                conn2.close()
                print(f"[QUEUE] Flushed: {emp_code}")
            elif resp.status_code in (400, 404, 422):
                conn2 = sqlite3.connect(DB_PATH)
                conn2.execute("DELETE FROM attendance_queue WHERE id = ?", (row_id,))
                conn2.commit()
                conn2.close()
            else:
                break
        except Exception as e:
            print(f"[QUEUE] Backend unreachable: {e}")
            conn2 = sqlite3.connect(DB_PATH)
            conn2.execute("UPDATE attendance_queue SET attempts = attempts + 1 WHERE id = ?", (row_id,))
            conn2.commit()
            conn2.close()
            break

def _queue_flush_loop():
    while True:
        time.sleep(QUEUE_FLUSH_INTERVAL)
        try: flush_queue()
        except Exception as e: print(f"[QUEUE] Flush loop error: {e}")

# ── ATTENDANCE LOGGING ─────────────────────────────────────────────────────────
_last_log_time   = {}
_log_lock        = threading.Lock()
PRESENCE_SEC     = 5   # send a presence heartbeat every 5 s per person per stream

def publish_log(employee_code, stream_device_name=None, bbox=None, confidence=None):
    now = time.time()
    # Re-read cooldown from config so push-config changes (e.g. shorter cooldown
    # for In&Out cameras) take effect without restarting the script.
    cfg_now  = load_config()
    cooldown = int(cfg_now.get("punch_cooldown_seconds", PUNCH_COOLDOWN_SEC))
    # Use per-stream cooldown key so streams don't block each other
    log_key = f"{employee_code}:{stream_device_name or ''}"
    with _log_lock:
        if now - _last_log_time.get(log_key, 0) < cooldown:
            return
        _last_log_time[log_key] = now

    def _send():
        cfg            = load_config()
        backend_url    = cfg.get("backend_url", "").rstrip("/")
        attendance_api = backend_url + "/api/attendance/log"
        payload = {
            "employee_code": employee_code,
            "time":          time.strftime("%Y-%m-%d %H:%M:%S"),
            "device_id":     cfg.get("device_id",   DEVICE_ID),
            "device_ip":     cfg.get("device_ip",   DEVICE_IP),
            "device_name":   stream_device_name or cfg.get("device_name", DEVICE_NAME),
            "camera_mode":   (cfg.get("streams") or {}).get(stream_device_name, {}).get("mode") or cfg.get("camera_mode", CAMERA_MODE),
            "bbox":          list(bbox) if bbox else None,
            "confidence":    confidence,
            "frame_w":       RECOG_W,
            "frame_h":       RECOG_H,
        }
        try:
            resp = requests.post(attendance_api, json=payload, timeout=10)
            if resp.status_code == 200:
                print(f"[API] Attendance logged: {employee_code}")
            else:
                print(f"[API] Attendance failed ({resp.status_code}) - queuing: {employee_code}")
                _queue_save(payload)
        except Exception as e:
            print(f"[API] Backend unreachable: {e} - queuing: {employee_code}")
            _queue_save(payload)

    _publish_log_executor.submit(_send)  # Use bounded thread pool instead of unlimited threads


def _emit_bbox_frame(stream_name, frame_w, frame_h, faces_data):
    """Non-blocking POST of bounding box coordinates to backend for real-time canvas overlay."""
    def _send():
        try:
            cfg          = load_config()
            backend_url  = cfg.get("backend_url", "").rstrip("/")
            bbox_api     = backend_url + "/api/cameras/bbox-frame"
            payload = {
                "stream":   stream_name,
                "frame_w":  frame_w,
                "frame_h":  frame_h,
                "faces":    faces_data
            }
            r = requests.post(bbox_api, json=payload, timeout=1)
            if r.status_code != 200:
                print(f"[BBOX] POST failed: {r.status_code} {r.text[:80]}")
        except Exception as e:
            print(f"[BBOX] POST error: {e}")

    _publish_log_executor.submit(_send)


def signal_presence(employee_code, stream_device_name=None):
    """Lightweight heartbeat — tells the frontend the person is still in frame.
    Fires at most every PRESENCE_SEC seconds per person per stream.
    No DB writes; backend only emits a socket event.
    """
    now     = time.time()
    pres_key = f"pres:{employee_code}:{stream_device_name or ''}"
    with _log_lock:
        if now - _last_log_time.get(pres_key, 0) < PRESENCE_SEC:
            return
        _last_log_time[pres_key] = now

    def _send():
        cfg          = load_config()
        backend_url  = cfg.get("backend_url", "").rstrip("/")
        presence_api = backend_url + "/api/attendance/presence"
        payload = {
            "employee_code": employee_code,
            "employee_name": name_map.get(employee_code, employee_code),
            "camera_name":   stream_device_name or cfg.get("device_name", DEVICE_NAME),
            "device_ip":     cfg.get("device_ip", DEVICE_IP),
        }
        try:
            requests.post(presence_api, json=payload, timeout=5)
        except Exception:
            pass  # non-critical — frontend falls back gracefully

    threading.Thread(target=_send, daemon=True).start()


# ── REGISTRATION API ───────────────────────────────────────────────────────────
def send_registration(employee_code, name, embedding, face_img):
    def _send():
        cfg          = load_config()
        backend_url  = cfg.get("backend_url", "").rstrip("/")
        register_api = backend_url + "/api/employees/register"
        try:
            _, buf  = cv2.imencode('.jpg', face_img)
            img_b64 = base64.b64encode(buf.tobytes()).decode('utf-8')
            payload = {"employee_code": employee_code, "name": name,
                       "embedding": embedding.tolist(), "image": img_b64}
            resp = requests.post(register_api, json=payload, timeout=10)
            if resp.status_code == 200:
                print(f"[API] Registration sent for '{employee_code}'")
            else:
                print(f"[API] Registration failed: {resp.status_code} {resp.text}")
        except Exception as e:
            print(f"[API] Registration error: {e}")
    threading.Thread(target=_send, daemon=True).start()

# ── FACE MATCHING ──────────────────────────────────────────────────────────────
def cosine_dist(a, b):
    a, b = np.asarray(a, np.float32), np.asarray(b, np.float32)
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na < 1e-9 or nb < 1e-9: return 1.0
    return float(1.0 - np.dot(a, b) / (na * nb))

def match_face(emb):
    """Vectorized cosine match — one BLAS call for all employees."""
    emb = np.asarray(emb, np.float32)
    norm_e = np.linalg.norm(emb)
    if norm_e < 1e-9:
        return None, 1.0
    emb_n = emb / norm_e

    with db_lock:
        if not db_embeddings:
            return None, 1.0
        codes = list(db_embeddings.keys())
        refs  = np.stack(list(db_embeddings.values()))  # (N, D)

    norms  = np.linalg.norm(refs, axis=1, keepdims=True)
    norms  = np.where(norms < 1e-9, 1.0, norms)
    refs_n = refs / norms                               # (N, D) normalised
    dists  = 1.0 - (refs_n @ emb_n)                    # (N,) cosine distances

    idx    = int(np.argmin(dists))
    best_d = float(dists[idx])
    if best_d < THRESHOLD:
        return codes[idx], best_d
    return None, best_d

# ── SHARED CAMERA ──────────────────────────────────────────────────────────────
fa      = None
fa_lock = threading.Lock()

class SharedCamera:
    def __init__(self, cam_src):
        self._latest   = None
        self._lat_lock = threading.Lock()
        self._stop     = threading.Event()
        self._src      = str(cam_src)   # track current URL for hot-reload comparison

        self._open(cam_src)

    def _open(self, cam_src):
        src = cam_src
        try: src = int(cam_src)
        except (ValueError, TypeError): pass

        if isinstance(src, str):
            decoded = unquote(src) if '%' in src else src
            # Four attempts in priority order:
            # 1. Decoded URL over TCP  (most reliable for cameras with special-char passwords)
            # 2. Decoded URL (default UDP)
            # 3. Original URL over TCP
            # 4. Original URL (default UDP)
            tcp_flag = 'rtsp_transport;tcp|buffer_size;1048576'
            attempts = []
            if decoded != src:
                attempts.append((decoded, tcp_flag))
                attempts.append((decoded, None))
            attempts.append((src, tcp_flag))
            attempts.append((src, None))

            cap = None
            for url, ffmpeg_opts in attempts:
                if ffmpeg_opts:
                    os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS'] = ffmpeg_opts
                else:
                    os.environ.pop('OPENCV_FFMPEG_CAPTURE_OPTIONS', None)
                c = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
                if c.isOpened():
                    cap = c
                    print(f"[Camera] Connected via {'TCP' if ffmpeg_opts else 'UDP'}: {url}")
                    break
                c.release()
            os.environ.pop('OPENCV_FFMPEG_CAPTURE_OPTIONS', None)

            if cap is None:
                cap = cv2.VideoCapture()   # empty — _read_loop will keep trying via reconnect
        else:
            cap = cv2.VideoCapture(src, cv2.CAP_V4L2)
            if not cap.isOpened(): cap = cv2.VideoCapture(src)

        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self._cap = cap
        if not cap.isOpened():
            print(f"[Camera] Cannot open stream: {cam_src}  - will retry automatically")
            return False
        threading.Thread(target=self._read_loop, daemon=True).start()
        return True

    def reconnect(self, new_src):
        """Stop the current capture and restart with a new URL (hot-reload)."""
        print(f"[HOT-RELOAD] Reconnecting stream: {self._src!r} -> {new_src!r}")
        self._stop.set()
        try:
            if self._cap:
                self._cap.release()
        except Exception:
            pass
        self._stop   = threading.Event()
        self._latest = None
        self._src    = str(new_src)
        self._open(new_src)

    def _read_loop(self):
        FAIL_THRESHOLD = 60   # ~3 s of consecutive failures before reconnect attempt
        RETRY_DELAY    = 8    # seconds between reconnect attempts
        READ_INTERVAL  = 0.033  # 30 fps default — saves CPU
        fail_count     = 0
        _last_push     = 0.0
        _last_read     = 0.0
        while not self._stop.is_set():
            # Throttle read rate to match MJPEG FPS cap — avoids decoding
            # 25–30 camera frames/sec when we only need 15 for display.
            now = time.time()
            wait = READ_INTERVAL - (now - _last_read)
            if wait > 0:
                time.sleep(wait)
            _last_read = time.time()
            try:
                ret, frame = self._cap.read()
            except Exception as e:
                print(f"[Camera] Read exception on {self._src}: {e}")
                ret, frame = False, None
            if not ret or frame is None:
                fail_count += 1
                if fail_count >= FAIL_THRESHOLD:
                    print(f"[Camera] Stream lost - reconnecting: {self._src}")
                    try: self._cap.release()
                    except Exception: pass
                    time.sleep(RETRY_DELAY)
                    if self._open(self._src):
                        return  # new _read_loop thread started; this one exits cleanly
                    fail_count = 0  # _open failed — keep retrying in this thread
                time.sleep(0.05)
                continue
            fail_count = 0
            with self._lat_lock: self._latest = frame
            # Push annotated frame to MJPEG at FPS cap.
            # Annotations (ROI box + face boxes) are applied here from the latest
            # recognition results so every frame is consistent — no racing between
            # MJPEG streaming removed — video now handled by MediaMTX
            # Bounding boxes sent to frontend via HTTP POST to /api/cameras/bbox-frame

    def get_frame(self):
        with self._lat_lock:
            return self._latest.copy() if self._latest is not None else None

    def stop(self):
        self._stop.set()
        if self._cap: self._cap.release()

# ── MAIN APP ───────────────────────────────────────────────────────────────────
class App:
    def __init__(self, root, camera, main_stream_name=None, extra_cameras=None):
        global DISPLAY_W, DISPLAY_H, CAM_DISPLAY_H

        self.root             = root
        self.camera           = camera
        self.current          = None
        self.main_stream_name = main_stream_name
        self.extra_cameras    = extra_cameras or []

        root.update_idletasks()
        DISPLAY_W     = root.winfo_screenwidth()
        DISPLAY_H     = root.winfo_screenheight()
        CAM_DISPLAY_H = DISPLAY_H - 45

        n_wins  = 1 + len(self.extra_cameras)
        win_w   = DISPLAY_W // n_wins
        win_h   = DISPLAY_H

        # ── Primary window ────────────────────────────────────────────────────
        root.title(main_stream_name or "Face Recognition")
        root.configure(bg="#0d0d1a")
        root.geometry(f"{win_w}x{win_h}+0+0")

        def _toggle_fs(win):
            win.attributes('-fullscreen', not win.attributes('-fullscreen'))

        root.bind('<f>',      lambda e: _toggle_fs(root))
        root.bind('<Escape>', lambda e: root.attributes('-fullscreen', False))
        root.bind('<q>',      lambda e: root.destroy())

        self.container = tk.Frame(root, bg="#0d0d1a")
        self.container.pack(fill=tk.BOTH, expand=True)

        self.pages = {}
        page = RecognitionPage(self.container, self)
        self.pages[RecognitionPage] = page
        page.place(relx=0, rely=0, relwidth=1, relheight=1)

        self.show(RecognitionPage)

        # ── Secondary windows (one per extra stream) ──────────────────────────
        self._secondary_wins = []
        for idx, (scam, sname) in enumerate(self.extra_cameras):
            x_pos = win_w * (idx + 1)
            sw    = SecondaryStreamWindow(root, scam, sname,
                                          x=x_pos, w=win_w, h=win_h,
                                          on_quit=root.destroy)
            self._secondary_wins.append(sw)

    def show(self, page_class):
        if self.current: self.current.on_hide()
        self.current = self.pages[page_class]
        self.current.lift()
        self.current.on_show()


# ── REGISTER WINDOW (reusable modal for any stream) ───────────────────────────
class RegisterWindow:
    """Modal Toplevel for face registration — works with any SharedCamera."""

    def __init__(self, parent_win, camera):
        self.camera  = camera
        self._active = False
        self._face_boxes = []
        self._face_lock  = threading.Lock()

        self.win = tk.Toplevel(parent_win)
        self.win.title("Register New Face")
        self.win.configure(bg="white")
        self.win.geometry("680x540")
        self.win.resizable(False, False)
        self.win.grab_set()   # modal

        bar = tk.Frame(self.win, bg="#1a1a2e", height=45)
        bar.pack(fill=tk.X)
        bar.pack_propagate(False)
        tk.Label(bar, text="Register New Face", font=("Helvetica", 13, "bold"),
                 bg="#1a1a2e", fg="white").pack(side=tk.LEFT, padx=12)
        tk.Button(bar, text="✕ Close", font=("Helvetica", 11),
                  bg="#444", fg="white", relief=tk.FLAT, padx=10,
                  command=self._close).pack(side=tk.RIGHT, padx=10, pady=6)

        self.cam_lbl = tk.Label(self.win, bg="black")
        self.cam_lbl.pack(fill=tk.BOTH, expand=True)

        form = tk.Frame(self.win, bg="white", pady=10)
        form.pack(fill=tk.X)
        tk.Label(form, text="Employee Code:", font=("Helvetica", 11),
                 bg="white").grid(row=0, column=0, padx=10, pady=5)
        self.emp_var = tk.StringVar()
        tk.Entry(form, textvariable=self.emp_var, font=("Helvetica", 11),
                 width=14).grid(row=0, column=1, padx=5)
        tk.Label(form, text="Name:", font=("Helvetica", 11),
                 bg="white").grid(row=0, column=2, padx=10)
        self.name_var = tk.StringVar()
        tk.Entry(form, textvariable=self.name_var, font=("Helvetica", 11),
                 width=14).grid(row=0, column=3, padx=5)
        tk.Button(form, text="Capture", font=("Helvetica", 11),
                  bg="#0066cc", fg="white", padx=10,
                  command=self._capture).grid(row=0, column=4, padx=10)
        self.status_lbl = tk.Label(form, text="Look at camera and click Capture",
                                   font=("Helvetica", 11), bg="white", fg="#555")
        self.status_lbl.grid(row=1, column=0, columnspan=5, pady=5)

        self.win.protocol("WM_DELETE_WINDOW", self._close)
        threading.Thread(target=self._detect_loop, daemon=True).start()
        self._active = True
        self._update_display()

    def _close(self):
        self._active = False
        try: self.win.grab_release()
        except Exception: pass
        self.win.destroy()

    def _detect_loop(self):
        while True:
            if not self._active: time.sleep(0.1); continue
            frame = self.camera.get_frame()
            if frame is None: time.sleep(0.1); continue
            fh, fw = frame.shape[:2]
            small  = _enhance_low_light(cv2.resize(frame, (RECOG_W, RECOG_H)))
            rx, ry = RECOG_W / fw, RECOG_H / fh
            with fa_lock: faces = fa.get(small)
            boxes = [(int(f.bbox[0]/rx), int(f.bbox[1]/ry),
                      int(f.bbox[2]/rx), int(f.bbox[3]/ry)) for f in faces]
            with self._face_lock: self._face_boxes = boxes
            time.sleep(0.05)

    def _capture(self):
        emp  = self.emp_var.get().strip()
        name = self.name_var.get().strip()
        if not emp or not name:
            self.status_lbl.config(text="Enter employee code and name first!", fg="red"); return
        frame = self.camera.get_frame()
        if frame is None:
            self.status_lbl.config(text="No camera frame!", fg="red"); return
        with fa_lock: faces = fa.get(frame)
        if not faces:
            self.status_lbl.config(text="No face detected — try again!", fg="red"); return
        face = max(faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]))
        x1, y1, x2, y2 = face.bbox.astype(int)
        fh, fw = frame.shape[:2]
        pad_x, pad_y = int((x2-x1)*0.6), int((y2-y1)*0.8)
        face_crop = frame[max(0,y1-pad_y):min(fh,y2+pad_y),
                          max(0,x1-pad_x):min(fw,x2+pad_x)]
        save_registration(emp, name, face.embedding, face_crop)
        send_registration(emp, name, face.embedding, face_crop)
        global db_embeddings
        try:
            new = load_db()
            with db_lock: db_embeddings = new
        except Exception as e:
            print(f"[DB] Reload after registration failed: {e}")
        self.status_lbl.config(text=f"Registered '{name}' ({emp}) successfully!", fg="green")
        self.win.after(2000, self._close)

    def _update_display(self):
        if not self._active: return
        frame = self.camera.get_frame()
        if frame is not None:
            with self._face_lock: boxes = list(self._face_boxes)
            for (x1, y1, x2, y2) in boxes:
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 200, 0), 2)
                cv2.putText(frame, "Position face here", (x1, y1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 0), 2)
            frame = cv2.resize(frame, (680, 390))
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            imgtk = ImageTk.PhotoImage(image=Image.fromarray(frame))
            self.cam_lbl.imgtk = imgtk
            self.cam_lbl.configure(image=imgtk)
        self.win.after(50, self._update_display)


# ── SECONDARY STREAM WINDOW ────────────────────────────────────────────────────
class SecondaryStreamWindow:
    """Standalone Toplevel window for a secondary RTSP stream.
    Full feature parity with RecognitionPage: ROI drawing, Clear ROI, Register."""

    def __init__(self, root, camera, stream_name, x=0, w=800, h=480, on_quit=None):
        self.camera      = camera
        self.stream_name = stream_name
        self._init_w     = w
        self._init_h     = h

        self.win = tk.Toplevel(root)
        self.win.title(stream_name)
        self.win.configure(bg="#0d0d1a")
        self.win.geometry(f"{w}x{h}+{x}+0")
        self.win.resizable(True, True)

        # ── Top bar ────────────────────────────────────────────────────────────
        bar = tk.Frame(self.win, bg="#1a1a2e", height=45)
        bar.pack(fill=tk.X)
        bar.pack_propagate(False)

        tk.Label(bar, text=stream_name, font=("Helvetica", 13, "bold"),
                 bg="#1a1a2e", fg="#00dcff").pack(side=tk.LEFT, padx=12)

        tk.Button(bar, text="+ Register", font=("Helvetica", 10),
                  bg="#0066cc", fg="white", relief=tk.FLAT, padx=8,
                  command=self._open_register).pack(side=tk.RIGHT, padx=6, pady=7)

        self._clear_roi_btn = tk.Button(bar, text="Clear ROI", font=("Helvetica", 10),
                                        bg="#555", fg="white", relief=tk.FLAT, padx=8,
                                        command=self._clear_roi)
        self._clear_roi_btn.pack(side=tk.RIGHT, padx=3, pady=7)

        self._roi_btn = tk.Button(bar, text="Set ROI", font=("Helvetica", 10),
                                  bg="#444", fg="white", relief=tk.FLAT, padx=8,
                                  command=self._toggle_roi_mode)
        self._roi_btn.pack(side=tk.RIGHT, padx=3, pady=7)

        # ── Camera label ───────────────────────────────────────────────────────
        self.lbl = tk.Label(self.win, bg="#0d0d1a", cursor="")
        self.lbl.pack(fill=tk.BOTH, expand=True)

        # Mouse events for ROI drawing
        self.lbl.bind('<ButtonPress-1>',   self._mouse_press)
        self.lbl.bind('<B1-Motion>',       self._mouse_drag)
        self.lbl.bind('<ButtonRelease-1>', self._mouse_release)

        # Key bindings
        self.win.bind('<f>',      lambda e: self.win.attributes('-fullscreen',
                                             not self.win.attributes('-fullscreen')))
        self.win.bind('<Escape>', lambda e: self.win.attributes('-fullscreen', False))
        if on_quit:
            self.win.bind('<q>', lambda e: on_quit())

        # ── ROI state ──────────────────────────────────────────────────────────
        self._roi         = None
        self._frame_wh    = None
        self._roi_drawing = False
        self._roi_pt1     = None
        self._roi_pt2     = None
        self._load_roi()

        self._update()

    # ── ROI helpers ────────────────────────────────────────────────────────────
    def _load_roi(self):
        roi = _get_stream_roi(self.stream_name)
        self._roi = roi
        if roi: print(f"[ROI:{self.stream_name}] Loaded: {roi}")

    def _save_roi(self, roi):
        _save_stream_roi(self.stream_name, roi)
        self._roi = roi

    def _clear_roi(self):
        _clear_stream_roi(self.stream_name)
        self._roi = None

    def _toggle_roi_mode(self):
        self._roi_drawing = not self._roi_drawing
        self._roi_pt1 = self._roi_pt2 = None
        if self._roi_drawing:
            self._roi_btn.config(text="Cancel", bg="#cc4400")
            self.lbl.config(cursor="crosshair")
        else:
            self._roi_btn.config(text="Set ROI", bg="#444")
            self.lbl.config(cursor="")

    # ── Mouse events ───────────────────────────────────────────────────────────
    def _mouse_press(self, event):
        if not self._roi_drawing: return
        self._roi_pt1 = self._roi_pt2 = (event.x, event.y)

    def _mouse_drag(self, event):
        if not self._roi_drawing or self._roi_pt1 is None: return
        self._roi_pt2 = (event.x, event.y)

    def _mouse_release(self, event):
        if not self._roi_drawing or self._roi_pt1 is None: return
        self._roi_pt2 = (event.x, event.y)
        if self._frame_wh:
            win_w    = self.win.winfo_width()  or self._init_w
            cam_h    = max(100, (self.win.winfo_height() or self._init_h) - 45)
            # Save in MJPEG stream space (640×360) for consistency with web frontend
            sx, sy   = MJPEG_STREAM_W / win_w, MJPEG_STREAM_H / cam_h
            dx1 = min(self._roi_pt1[0], self._roi_pt2[0])
            dy1 = min(self._roi_pt1[1], self._roi_pt2[1])
            dx2 = max(self._roi_pt1[0], self._roi_pt2[0])
            dy2 = max(self._roi_pt1[1], self._roi_pt2[1])
            dx1, dx2 = max(0, dx1), min(win_w, dx2)
            dy1, dy2 = max(0, dy1), min(cam_h, dy2)
            x1, y1 = int(dx1 * sx), int(dy1 * sy)
            x2, y2 = int(dx2 * sx), int(dy2 * sy)
            if x2 - x1 > 10 and y2 - y1 > 10:
                self._save_roi([x1, y1, x2, y2])
        self._roi_drawing = False
        self._roi_pt1 = self._roi_pt2 = None
        self._roi_btn.config(text="Set ROI", bg="#444")
        self.lbl.config(cursor="")

    def _open_register(self):
        RegisterWindow(self.win, self.camera)

    # ── Display loop ───────────────────────────────────────────────────────────
    def _update(self):
        # Refresh ROI from config.yaml every 3 s
        now = time.time()
        if not self._roi_drawing and now - getattr(self, '_roi_loaded_at', 0) > 3:
            self._load_roi()
            self._roi_loaded_at = now

        frame = self.camera.get_frame()
        if frame is not None:
            fh, fw = frame.shape[:2]
            self._frame_wh = (fw, fh)

            # Face-box overlays from recognition thread
            with _stream_results_lock:
                results = list(_stream_results.get(self.stream_name, []))
            for (x1, y1, x2, y2, label, color) in results:
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2)
                cv2.rectangle(frame, (x1, y1-th-10), (x1+tw+8, y1), color, -1)
                cv2.putText(frame, label, (x1+4, y1-4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)

            # Attendance confirmed banner (green, top of frame)
            _draw_attendance_banner(frame, self.stream_name)

            # Saved ROI overlay — stored in MJPEG stream space (640×360)
            roi = self._roi
            if roi and not self._roi_drawing:
                # Scale to original frame space for drawing
                rx1 = int(roi[0] * fw / MJPEG_STREAM_W)
                ry1 = int(roi[1] * fh / MJPEG_STREAM_H)
                rx2 = int(roi[2] * fw / MJPEG_STREAM_W)
                ry2 = int(roi[3] * fh / MJPEG_STREAM_H)
                c_roi, dash = (0, 255, 255), 20
                for px in range(rx1, rx2, dash*2):
                    cv2.line(frame, (px, ry1), (min(px+dash, rx2), ry1), c_roi, 2)
                    cv2.line(frame, (px, ry2), (min(px+dash, rx2), ry2), c_roi, 2)
                for py in range(ry1, ry2, dash*2):
                    cv2.line(frame, (rx1, py), (rx1, min(py+dash, ry2)), c_roi, 2)
                    cv2.line(frame, (rx2, py), (rx2, min(py+dash, ry2)), c_roi, 2)
                for cx, cy in [(rx1, ry1), (rx2, ry1), (rx1, ry2), (rx2, ry2)]:
                    cv2.circle(frame, (cx, cy), 6, c_roi, -1)
                cv2.rectangle(frame, (rx1, ry1-22), (rx1+58, ry1), c_roi, -1)
                cv2.putText(frame, "ROI", (rx1+4, ry1-5),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2)

            # Stream name watermark
            cv2.putText(frame, self.stream_name, (10, 32),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 220, 255), 2)

            win_w = self.win.winfo_width()  or self._init_w
            win_h = self.win.winfo_height() or self._init_h
            cam_h = max(100, win_h - 45)

            disp = cv2.resize(frame, (win_w, cam_h))

            # Rubber-band ROI while dragging
            if self._roi_drawing and self._roi_pt1 and self._roi_pt2:
                dx1 = min(self._roi_pt1[0], self._roi_pt2[0])
                dy1 = min(self._roi_pt1[1], self._roi_pt2[1])
                dx2 = max(self._roi_pt1[0], self._roi_pt2[0])
                dy2 = max(self._roi_pt1[1], self._roi_pt2[1])
                cv2.rectangle(disp, (dx1, dy1), (dx2, dy2), (255, 140, 0), 2)
                w_orig = int((dx2-dx1) * fw / win_w)
                h_orig = int((dy2-dy1) * fh / cam_h)
                cv2.putText(disp, f"{w_orig} x {h_orig}", (dx1+4, dy1+18),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 140, 0), 1)
            elif self._roi_drawing:
                cv2.putText(disp, "Click and drag to set ROI",
                            (win_w//2 - 140, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 140, 0), 2)

            disp = cv2.cvtColor(disp, cv2.COLOR_BGR2RGB)
            imgtk = ImageTk.PhotoImage(image=Image.fromarray(disp))
            self.lbl.imgtk = imgtk
            self.lbl.configure(image=imgtk)

        self.win.after(33, self._update)

# ── RECOGNITION PAGE ───────────────────────────────────────────────────────────
class RecognitionPage(tk.Frame):
    def __init__(self, parent, app):
        super().__init__(parent, bg="#0d0d1a")
        self.app = app

        # ── Top bar ────────────────────────────────────────────────────────────
        bar = tk.Frame(self, bg="#1a1a2e", height=45)
        bar.pack(fill=tk.X)
        bar.pack_propagate(False)

        tk.Label(bar, text="Face Recognition", font=("Helvetica", 13, "bold"),
                 bg="#1a1a2e", fg="white").pack(side=tk.LEFT, padx=12)

        tk.Button(bar, text="+ Register", font=("Helvetica", 10),
                  bg="#0066cc", fg="white", relief=tk.FLAT, padx=8,
                  command=lambda: RegisterWindow(app.root, app.camera)).pack(side=tk.RIGHT, padx=6, pady=7)

        self.clear_roi_btn = tk.Button(bar, text="Clear ROI", font=("Helvetica", 10),
                                       bg="#555", fg="white", relief=tk.FLAT, padx=8,
                                       command=self._clear_roi)
        self.clear_roi_btn.pack(side=tk.RIGHT, padx=3, pady=7)

        self.roi_btn = tk.Button(bar, text="Set ROI", font=("Helvetica", 10),
                                 bg="#444", fg="white", relief=tk.FLAT, padx=8,
                                 command=self._toggle_roi_mode)
        self.roi_btn.pack(side=tk.RIGHT, padx=3, pady=7)

        # ── Camera display area (fills entire window) ─────────────────────────
        self.cam_lbl = tk.Label(self, bg="#0d0d1a", cursor="")
        self.cam_lbl.pack(fill=tk.BOTH, expand=True)

        # ── State ──────────────────────────────────────────────────────────────
        self._stream_name = app.main_stream_name  # None → use config device_name
        self._active      = False
        self._disp_w      = DISPLAY_W  # updated each frame in _update_display

        # ROI state (coordinates are in ORIGINAL camera frame space)
        self._roi         = None   # [x1, y1, x2, y2] or None
        self._frame_wh    = None   # (width, height) of actual camera frame
        self._roi_drawing = False  # True while user drags a new ROI
        self._roi_pt1     = None   # drag start (display coords)
        self._roi_pt2     = None   # drag end   (display coords)

        self._load_roi()

        # Mouse events for ROI drawing
        self.cam_lbl.bind('<ButtonPress-1>',   self._mouse_press)
        self.cam_lbl.bind('<B1-Motion>',       self._mouse_drag)
        self.cam_lbl.bind('<ButtonRelease-1>', self._mouse_release)
        # Recognition is handled by the central _recognition_worker thread started
        # at entry-point; results are read from _stream_results[self._stream_name].

    # ── ROI helpers — use per-stream helpers so recognition worker sees the ROI ──
    def _load_roi(self):
        key = self._stream_name or DEVICE_NAME
        self._roi = _get_stream_roi(key)
        if self._roi:
            print(f"[ROI:{key}] Loaded: {self._roi}")

    def _save_roi(self, roi):
        key = self._stream_name or DEVICE_NAME
        _save_stream_roi(key, roi)
        self._roi = roi

    def _clear_roi(self):
        key = self._stream_name or DEVICE_NAME
        _clear_stream_roi(key)
        self._roi = None

    def _toggle_roi_mode(self):
        self._roi_drawing = not self._roi_drawing
        self._roi_pt1     = None
        self._roi_pt2     = None
        if self._roi_drawing:
            self.roi_btn.config(text="Cancel", bg="#cc4400")
            self.cam_lbl.config(cursor="crosshair")
        else:
            self.roi_btn.config(text="Set ROI", bg="#444")
            self.cam_lbl.config(cursor="")

    # ── Mouse events ───────────────────────────────────────────────────────────
    def _mouse_press(self, event):
        if not self._roi_drawing: return
        self._roi_pt1 = (event.x, event.y)
        self._roi_pt2 = (event.x, event.y)

    def _mouse_drag(self, event):
        if not self._roi_drawing or self._roi_pt1 is None: return
        self._roi_pt2 = (event.x, event.y)

    def _mouse_release(self, event):
        if not self._roi_drawing or self._roi_pt1 is None: return
        self._roi_pt2 = (event.x, event.y)

        # Convert display-space coords → MJPEG stream space (640×360) for consistency
        # with ROI drawn from web frontend
        if self._frame_wh:
            panel_w      = self._disp_w
            actual_cam_h = (self.app.root.winfo_height() or DISPLAY_H) - 45
            sx = MJPEG_STREAM_W / panel_w
            sy = MJPEG_STREAM_H / actual_cam_h

            dx1 = min(self._roi_pt1[0], self._roi_pt2[0])
            dy1 = min(self._roi_pt1[1], self._roi_pt2[1])
            dx2 = max(self._roi_pt1[0], self._roi_pt2[0])
            dy2 = max(self._roi_pt1[1], self._roi_pt2[1])

            dx1, dx2 = max(0, dx1), min(panel_w,       dx2)
            dy1, dy2 = max(0, dy1), min(actual_cam_h,  dy2)

            x1, y1 = int(dx1 * sx), int(dy1 * sy)
            x2, y2 = int(dx2 * sx), int(dy2 * sy)

            if x2 - x1 > 10 and y2 - y1 > 10:
                self._save_roi([x1, y1, x2, y2])

        # Exit draw mode
        self._roi_drawing = False
        self._roi_pt1     = None
        self._roi_pt2     = None
        self.roi_btn.config(text="Set ROI", bg="#444")
        self.cam_lbl.config(cursor="")

    # ── Page lifecycle ─────────────────────────────────────────────────────────
    def on_show(self):
        self._active = True
        self._load_roi()
        self._update_display()

    def on_hide(self):
        self._active      = False
        self._roi_drawing = False

    # ── Display loop (Tkinter main thread) ─────────────────────────────────────
    def _update_display(self):
        if not self._active: return

        # Refresh ROI from config.yaml every 3 s so web-saved ROI is picked up
        now = time.time()
        if not self._roi_drawing and now - getattr(self, '_roi_loaded_at', 0) > 3:
            self._load_roi()
            self._roi_loaded_at = now

        frame = self.app.camera.get_frame()
        if frame is not None:
            fh, fw = frame.shape[:2]
            self._frame_wh = (fw, fh)   # store for mouse coord conversion

            # ── Draw face boxes ───────────────────────────────────────────────
            stream_key = self._stream_name or DEVICE_NAME
            with _stream_results_lock:
                results = list(_stream_results.get(stream_key, []))
            for (x1, y1, x2, y2, label, color) in results:
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2)
                cv2.rectangle(frame, (x1, y1 - th - 10), (x1 + tw + 8, y1), color, -1)
                cv2.putText(frame, label, (x1 + 4, y1 - 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)

            # ── Draw saved ROI — stored in MJPEG stream space (640×360) ─────
            roi = self._roi
            if roi and not self._roi_drawing:
                # Scale from 640×360 → original frame space for drawing
                rx1 = int(roi[0] * fw / MJPEG_STREAM_W)
                ry1 = int(roi[1] * fh / MJPEG_STREAM_H)
                rx2 = int(roi[2] * fw / MJPEG_STREAM_W)
                ry2 = int(roi[3] * fh / MJPEG_STREAM_H)
                color_roi = (0, 255, 255)
                dash      = 20
                for x in range(rx1, rx2, dash * 2):
                    cv2.line(frame, (x, ry1), (min(x + dash, rx2), ry1), color_roi, 2)
                    cv2.line(frame, (x, ry2), (min(x + dash, rx2), ry2), color_roi, 2)
                for y in range(ry1, ry2, dash * 2):
                    cv2.line(frame, (rx1, y), (rx1, min(y + dash, ry2)), color_roi, 2)
                    cv2.line(frame, (rx2, y), (rx2, min(y + dash, ry2)), color_roi, 2)
                mk = 12
                for cx, cy in [(rx1, ry1), (rx2, ry1), (rx1, ry2), (rx2, ry2)]:
                    cv2.circle(frame, (cx, cy), mk // 2, color_roi, -1)
                cv2.rectangle(frame, (rx1, ry1 - 22), (rx1 + 58, ry1), color_roi, -1)
                cv2.putText(frame, "ROI", (rx1 + 4, ry1 - 5),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2)

            # ── Attendance confirmed banner (green, top of frame) ─────────────
            _draw_attendance_banner(frame, stream_key)

            # ── Actual window dimensions (adapts to fullscreen or resize) ─────
            win_w        = self.app.root.winfo_width()  or DISPLAY_W
            win_h        = self.app.root.winfo_height() or DISPLAY_H
            cam_h        = max(100, win_h - 45)
            self._disp_w = win_w   # used by _mouse_release for ROI coord mapping

            # ── Stream name watermark ─────────────────────────────────────────
            if self._stream_name:
                cv2.putText(frame, self._stream_name, (10, 28),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 220, 255), 2)

            # MJPEG push is handled by SharedCamera._read_loop with annotations applied there.

            # ── Resize to fill full window ────────────────────────────────────
            disp = cv2.resize(frame, (win_w, cam_h))
            disp = cv2.cvtColor(disp, cv2.COLOR_BGR2RGB)

            # ── Draw rubber-band ROI while dragging (display coords) ──────────
            if self._roi_drawing and self._roi_pt1 and self._roi_pt2:
                dx1 = min(self._roi_pt1[0], self._roi_pt2[0])
                dy1 = min(self._roi_pt1[1], self._roi_pt2[1])
                dx2 = max(self._roi_pt1[0], self._roi_pt2[0])
                dy2 = max(self._roi_pt1[1], self._roi_pt2[1])
                cv2.rectangle(disp, (dx1, dy1), (dx2, dy2), (255, 140, 0), 2)
                w_px = dx2 - dx1
                h_px = dy2 - dy1
                if self._frame_wh:
                    w_orig = int(w_px * fw / win_w)
                    h_orig = int(h_px * fh / cam_h)
                    cv2.putText(disp, f"{w_orig} x {h_orig}",
                                (dx1 + 4, dy1 + 18),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 140, 0), 1)
            elif self._roi_drawing:
                cv2.putText(disp, "Click and drag to set ROI",
                            (win_w // 2 - 140, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 140, 0), 2)

            imgtk = ImageTk.PhotoImage(image=Image.fromarray(disp))
            self.cam_lbl.imgtk = imgtk
            self.cam_lbl.configure(image=imgtk)

        self.app.root.after(33, self._update_display)

# ── REGISTER PAGE ──────────────────────────────────────────────────────────────
class RegisterPage(tk.Frame):
    def __init__(self, parent, app):
        super().__init__(parent, bg="white")
        self.app     = app
        self._active = False

        bar = tk.Frame(self, bg="#1a1a2e", height=45)
        bar.pack(fill=tk.X)
        bar.pack_propagate(False)
        tk.Label(bar, text="Register New Face", font=("Helvetica", 13, "bold"),
                 bg="#1a1a2e", fg="white").pack(side=tk.LEFT, padx=12)
        tk.Button(bar, text="← Back", font=("Helvetica", 11),
                  bg="#444", fg="white", relief=tk.FLAT, padx=10,
                  command=lambda: app.show(RecognitionPage)).pack(side=tk.RIGHT, padx=10, pady=6)

        self.cam_lbl = tk.Label(self, bg="black")
        self.cam_lbl.pack(fill=tk.BOTH, expand=True)

        form = tk.Frame(self, bg="white", pady=10)
        form.pack(fill=tk.X)

        tk.Label(form, text="Employee Code:", font=("Helvetica", 11), bg="white").grid(row=0, column=0, padx=10, pady=5)
        self.emp_var = tk.StringVar()
        tk.Entry(form, textvariable=self.emp_var, font=("Helvetica", 11), width=15).grid(row=0, column=1, padx=5)

        tk.Label(form, text="Name:", font=("Helvetica", 11), bg="white").grid(row=0, column=2, padx=10)
        self.name_var = tk.StringVar()
        tk.Entry(form, textvariable=self.name_var, font=("Helvetica", 11), width=15).grid(row=0, column=3, padx=5)

        self.capture_btn = tk.Button(form, text="Capture", font=("Helvetica", 11),
                                     bg="#0066cc", fg="white", padx=10, command=self._capture)
        self.capture_btn.grid(row=0, column=4, padx=10)

        self.status_lbl = tk.Label(form, text="Look at camera and click Capture",
                                   font=("Helvetica", 11), bg="white", fg="#555")
        self.status_lbl.grid(row=1, column=0, columnspan=5, pady=5)

        # Face boxes from background detection thread
        self._face_boxes = []
        self._face_lock  = threading.Lock()
        threading.Thread(target=self._detect_loop, daemon=True).start()

    def _detect_loop(self):
        """Background thread: run InsightFace at ~2fps so display stays smooth."""
        while True:
            if not self._active:
                time.sleep(0.1)
                continue
            frame = self.app.camera.get_frame()
            if frame is None:
                time.sleep(0.1)
                continue
            fh, fw = frame.shape[:2]
            small  = _enhance_low_light(cv2.resize(frame, (RECOG_W, RECOG_H)))
            rx, ry = RECOG_W / fw, RECOG_H / fh
            with fa_lock:
                faces = fa.get(small)
            boxes = []
            for face in faces:
                x1, y1, x2, y2 = face.bbox.astype(int)
                boxes.append((int(x1 / rx), int(y1 / ry), int(x2 / rx), int(y2 / ry)))
            with self._face_lock:
                self._face_boxes = boxes
            time.sleep(0.05)   # ~20 detections/sec max — don't hammer CPU

    def on_show(self):
        self._active = True
        self.emp_var.set(""); self.name_var.set("")
        self.status_lbl.config(text="Look at camera and click Capture", fg="#555")
        self._update_display()

    def on_hide(self):
        self._active = False

    def _capture(self):
        emp  = self.emp_var.get().strip()
        name = self.name_var.get().strip()
        if not emp or not name:
            self.status_lbl.config(text="Enter employee code and name first!", fg="red"); return

        frame = self.app.camera.get_frame()
        if frame is None:
            self.status_lbl.config(text="No camera frame!", fg="red"); return

        with fa_lock: faces = fa.get(frame)
        if not faces:
            self.status_lbl.config(text="No face detected — try again!", fg="red"); return

        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        x1, y1, x2, y2 = face.bbox.astype(int)
        fh, fw = frame.shape[:2]
        pad_x  = int((x2 - x1) * 0.6)
        pad_y  = int((y2 - y1) * 0.8)
        px1, py1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
        px2, py2 = min(fw, x2 + pad_x), min(fh, y2 + pad_y)
        face_crop = frame[py1:py2, px1:px2]

        save_registration(emp, name, face.embedding, face_crop)
        send_registration(emp, name, face.embedding, face_crop)

        global db_embeddings
        try:
            new = load_db()
            with db_lock: db_embeddings = new
        except Exception as e:
            print(f"[DB] Reload after registration failed: {e}")

        self.status_lbl.config(text=f"Registered '{name}' ({emp}) successfully!", fg="green")
        self.app.root.after(2000, lambda: self.app.show(RecognitionPage))

    def _update_display(self):
        if not self._active: return
        frame = self.app.camera.get_frame()
        if frame is not None:
            # Draw cached boxes from background detect thread (no AI call here)
            with self._face_lock:
                boxes = list(self._face_boxes)
            for (x1, y1, x2, y2) in boxes:
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 200, 0), 2)
                cv2.putText(frame, "Position face here", (x1, y1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 0), 2)
            win_w = self.app.root.winfo_width()  or DISPLAY_W
            win_h = self.app.root.winfo_height() or DISPLAY_H
            frame = cv2.resize(frame, (win_w, max(100, win_h - 130)))
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            imgtk = ImageTk.PhotoImage(image=Image.fromarray(frame))
            self.cam_lbl.imgtk = imgtk
            self.cam_lbl.configure(image=imgtk)
        self.app.root.after(50, self._update_display)  # 20 fps — smooth but light

# ── CONFIG HOT-RELOAD WATCHER ──────────────────────────────────────────────────
def _config_watcher():
    """Background thread: watches config.yaml for changes.

    Handles add / remove / URL-change / ROI-change without restarting pi_recognize.py.
    New stream RTSP connections are opened in a background thread so this watcher
    never blocks on slow cameras and existing streams keep running uninterrupted.
    """
    global _config_mtime, PUNCH_COOLDOWN_SEC
    while True:
        time.sleep(2)
        try:
            mtime = os.path.getmtime(CONFIG_PATH)
        except OSError:
            continue
        if mtime <= _config_mtime:
            continue
        _config_mtime = mtime

        new_cfg     = load_config()
        new_streams = {
            k: v for k, v in (new_cfg.get("streams") or {}).items()
            if v and v.get("rtsp_url")
        }

        # ── 1. Remove deleted streams — stop camera, clean all shared state ──
        for name in list(_active_streams.keys()):
            if name not in new_streams:
                cam = _active_streams.pop(name, None)
                if cam:
                    cam.stop()
                with _stream_results_lock:
                    _stream_results.pop(name, None)
                with _stream_roi_lock:
                    _stream_roi_cache.pop(name, None)
                # Atomic list replacement; recognition worker takes list() snapshots
                _all_streams_list[:] = [(n, c) for n, c in _all_streams_list if n != name]
                print(f"[HOT-RELOAD] Stream removed: '{name}'")

        # ── 2. Add / reconnect / update ROI ──────────────────────────────────
        for name, scfg in new_streams.items():
            new_url = str(scfg.get("rtsp_url", ""))

            # Always update ROI cache from config (no disk hit at render time)
            with _stream_roi_lock:
                _stream_roi_cache[name] = _parse_roi(scfg.get("roi"))

            cam = _active_streams.get(name)
            if cam is None:
                # Brand-new stream — connect in background so watcher never blocks
                if not new_url:
                    continue
                def _launch(n=name, u=new_url):
                    try:
                        new_cam = SharedCamera(u)
                        _active_streams[n]            = new_cam
                        _all_streams_list.append((n, new_cam))
                        print(f"[HOT-RELOAD] New stream started '{n}' -> {u}")
                    except Exception as e:
                        print(f"[HOT-RELOAD] Failed to start '{n}': {e}")
                threading.Thread(target=_launch, daemon=True).start()
                continue

            if new_url and new_url != cam._src:
                try:
                    cam.reconnect(new_url)
                    print(f"[HOT-RELOAD] Reconnected '{name}' -> {new_url}")
                except Exception as e:
                    print(f"[HOT-RELOAD] Reconnect failed for '{name}': {e}")

        # ── 3. Cooldown ───────────────────────────────────────────────────────
        new_cooldown = int(new_cfg.get("punch_cooldown_seconds", PUNCH_COOLDOWN_SEC))
        if new_cooldown != PUNCH_COOLDOWN_SEC:
            PUNCH_COOLDOWN_SEC = new_cooldown
            print(f"[HOT-RELOAD] punch_cooldown -> {PUNCH_COOLDOWN_SEC}s")

        print(f"[HOT-RELOAD] Config reloaded - active: {list(new_streams.keys())}")


# ── ENTRY POINT ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"[INFO] Script dir    : {_SCRIPT_DIR}")
    print(f"[INFO] DB path       : {DB_PATH}")
    print(f"[INFO] Config path   : {CONFIG_PATH}")

    init_db()
    try:
        db_embeddings = load_db()
        print(f"[DB] Loaded {len(db_embeddings)} persons: {list(db_embeddings.keys())}")
    except Exception as e:
        print(f"[DB] Load failed: {e}")

    threading.Thread(target=_db_reload_loop,    daemon=True).start()
    threading.Thread(target=_queue_flush_loop,  daemon=True).start()
    threading.Thread(target=flush_queue,        daemon=True).start()
    threading.Thread(target=_unknown_sync_loop, daemon=True).start()

    print("[INFO] Loading InsightFace buffalo_s (CPU)...")
    fa = FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
    fa.prepare(ctx_id=-1, det_size=DET_SIZE)
    print("[INFO] Model ready.")

    cfg = load_config()
    print(f"[INFO] Backend URL   : {cfg.get('backend_url', '(not set)')}")
    print(f"[INFO] Device ID     : {cfg.get('device_id', DEVICE_ID)}")

    # ── Build stream list ─────────────────────────────────────────────────────
    # Priority: 'streams' dict in config.yaml (set by pi_server.py push) →
    #           fallback to legacy single 'rtsp_url' field.
    # On first run with a legacy config, we AUTO-MIGRATE the single rtsp_url into
    # the 'streams' dict and save it so that pi_server.py can correctly MERGE a
    # second stream config on the next push from the Settings UI.
    streams_cfg = cfg.get("streams") or {}

    # Clean out any entries with no rtsp_url (stale / bad pushes)
    streams_cfg = {k: v for k, v in streams_cfg.items() if v and v.get("rtsp_url")}

    if not streams_cfg:
        rtsp       = cfg.get("rtsp_url", "0")
        main_name  = cfg.get("device_name", DEVICE_NAME)
        streams_cfg = {
            main_name: {
                "rtsp_url":  rtsp,
                "mode":      cfg.get("camera_mode", CAMERA_MODE),
                "threshold": float(cfg.get("threshold", THRESHOLD)),
            }
        }
        # ── One-time migration: write streams dict back to config.yaml ──────
        # This ensures the next push-config from the Settings UI (which calls
        # pi_server.py) will MERGE the new stream rather than starting fresh.
        cfg["streams"] = streams_cfg
        save_config(cfg)
        print(f"[CONFIG] Auto-migrated single rtsp_url -> streams dict  ({main_name!r})")

    stream_items = list(streams_cfg.items())

    print(f"[INFO] -- Streams loaded ({len(stream_items)}) ---------------------------")
    for idx, (sn, sc) in enumerate(stream_items):
        label = "PRIMARY  " if idx == 0 else f"SECONDARY {idx}"
        print(f"[INFO]   {label}: {sn!r}  ->  {sc.get('rtsp_url')}  "
              f"(mode={sc.get('mode','?')}  thresh={sc.get('threshold','?')})")
    print(f"[INFO] -----------------------------------------------------------------")

    # Populate ROI cache from initial config so _read_loop never hits disk
    for sn, sc in streams_cfg.items():
        with _stream_roi_lock:
            _stream_roi_cache[sn] = _parse_roi(sc.get("roi"))

    # Primary stream — shown in Tkinter GUI
    main_name, main_scfg = stream_items[0]
    camera_src = main_scfg.get("rtsp_url") or cfg.get("rtsp_url", "0")
    print(f"[INFO] Opening primary stream: {main_name!r}  ->  {camera_src}")

    camera = SharedCamera(camera_src)
    _active_streams[main_name]       = camera
    time.sleep(1)   # give camera one second to warm up

    # Secondary streams — recognition + display (side-by-side in Tkinter window)
    extra_cameras = []   # passed to App so RecognitionPage can show them
    for sname, sconf in stream_items[1:]:
        srtsp = sconf.get("rtsp_url", "0")
        print(f"[INFO] Opening secondary stream: {sname!r}  ->  {srtsp}")
        scam = SharedCamera(srtsp)
        extra_cameras.append((scam, sname))
        _active_streams[sname]       = scam

    if not extra_cameras:
        print("[INFO] Single-stream mode.")
    else:
        print(f"[INFO] Multi-stream mode: {len(extra_cameras)+1} stream(s) active")

    # Start central recognition worker covering all active streams.
    # _all_streams_list is a module-level mutable list — _config_watcher appends
    # new streams to it at runtime so the worker picks them up without restart.
    _all_streams_list.clear()
    _all_streams_list.extend([(main_name, camera)] + [(sname, scam) for scam, sname in extra_cameras])
    threading.Thread(
        target=_recognition_worker, args=(_all_streams_list,), daemon=True
    ).start()

    # Start config watcher — reconnects streams automatically when RTSP URL changes
    _config_mtime = os.path.getmtime(CONFIG_PATH) if os.path.exists(CONFIG_PATH) else 0.0
    threading.Thread(target=_config_watcher, daemon=True).start()
    print("[INFO] Config watcher started - RTSP URL changes will apply without restart")

    root = tk.Tk()
    app  = App(root, camera, main_stream_name=main_name, extra_cameras=extra_cameras)

    # ── Shutdown flag (thread-safe) ────────────────────────────────────────────
    _shutdown = threading.Event()

    def _do_quit():
        if not _shutdown.is_set():
            return
        camera.stop()
        try: root.quit()
        except Exception: pass

    # Layer 1: SIGINT signal handler sets the flag.
    def _on_sigint(*_):
        print("\n[INFO] Ctrl+C - shutting down...")
        _shutdown.set()

    signal.signal(signal.SIGINT, _on_sigint)

    # Layer 2: poll every 150 ms so the flag is checked even while mainloop idles.
    def _poll():
        if _shutdown.is_set():
            _do_quit()
            return
        root.after(150, _poll)
    root.after(150, _poll)

    # Layer 3: override Tkinter's callback exception handler.
    # When KeyboardInterrupt fires *inside* an after() callback (PIL, cv2, etc.),
    # Tkinter catches it here instead of propagating — we intercept and quit.
    def _tk_exc(exc_type, exc_val, exc_tb):
        if issubclass(exc_type, KeyboardInterrupt):
            print("\n[INFO] Ctrl+C inside callback - shutting down...")
            _shutdown.set()
            _do_quit()
        else:
            import traceback
            traceback.print_exception(exc_type, exc_val, exc_tb)

    root.report_callback_exception = _tk_exc

    root.mainloop()

    camera.stop()
    print("[INFO] Stopped.")
