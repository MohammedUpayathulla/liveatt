#!/bin/bash

# Wait for pi_server to be ready (eth0 + Flask up)
echo "[WAIT] Waiting for pi_server to be ready..."
sleep 5

# Start Pi Recognition
cd /home/pi/Documents/attendace
python3 pi_recognize_v2.py
