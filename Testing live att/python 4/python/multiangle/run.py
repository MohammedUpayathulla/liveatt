"""
run.py  —  Watchdog launcher for pi_server.py and pi_recognize.py

Runs both scripts as subprocesses. If either crashes it is automatically
restarted after a short delay. The loop runs forever until you press Ctrl+C.

Usage:
    python3 run.py
"""

import subprocess
import sys
import time
import os
import signal
import threading

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
PYTHON      = sys.executable

SERVICES = [
    {
        "name":    "pi_server",
        "script":  os.path.join(SCRIPT_DIR, "pi_server.py"),
        "restart_delay": 3,   # seconds to wait before restarting after a crash
    },
    {
        "name":    "pi_recognize",
        "script":  os.path.join(SCRIPT_DIR, "pi_recognize.py"),
        "restart_delay": 5,
    },
]

_stop_event = threading.Event()
_processes  = {}   # name → subprocess.Popen


def _watch(service):
    name          = service["name"]
    script        = service["script"]
    restart_delay = service["restart_delay"]

    while not _stop_event.is_set():
        print(f"[WATCHDOG] Starting {name} ...")
        try:
            proc = subprocess.Popen(
                [PYTHON, script],
                cwd=SCRIPT_DIR,
            )
            _processes[name] = proc
            proc.wait()   # blocks until the process exits

            if _stop_event.is_set():
                break

            rc = proc.returncode
            print(f"[WATCHDOG] {name} exited (code={rc}) — restarting in {restart_delay}s ...")
            time.sleep(restart_delay)

        except Exception as e:
            print(f"[WATCHDOG] Failed to start {name}: {e} — retrying in {restart_delay}s ...")
            time.sleep(restart_delay)

    print(f"[WATCHDOG] {name} watchdog stopped.")


def _shutdown(signum, frame):
    print("\n[WATCHDOG] Shutdown signal received — stopping all services ...")
    _stop_event.set()
    for name, proc in _processes.items():
        try:
            proc.terminate()
            print(f"[WATCHDOG] Sent SIGTERM to {name} (pid={proc.pid})")
        except Exception:
            pass
    # Give processes 5 s to exit cleanly, then force-kill
    time.sleep(5)
    for name, proc in _processes.items():
        try:
            if proc.poll() is None:
                proc.kill()
                print(f"[WATCHDOG] Force-killed {name}")
        except Exception:
            pass
    sys.exit(0)


signal.signal(signal.SIGINT,  _shutdown)
signal.signal(signal.SIGTERM, _shutdown)

print("[WATCHDOG] Starting Live Attendance watchdog ...")
print(f"[WATCHDOG] Managing: {[s['name'] for s in SERVICES]}")

threads = []
for svc in SERVICES:
    t = threading.Thread(target=_watch, args=(svc,), daemon=True)
    t.start()
    threads.append(t)
    time.sleep(2)   # stagger startup so pi_server loads the model first

# Keep main thread alive
while not _stop_event.is_set():
    time.sleep(1)
