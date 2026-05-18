#!/bin/bash

# Setup eth0 for camera network
ip addr add 172.16.0.100/16 dev eth0 2>/dev/null || true
ip route add 172.16.0.0/16 dev eth0 2>/dev/null || true

echo "[NET] eth0 configured: 172.16.0.100/16"

# Start Pi Server
cd /home/pi/Documents/attendace
python3 pi_server.py
