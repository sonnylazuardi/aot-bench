#!/usr/bin/env bash
# Launch the Windows Chrome (real GPU) headless with a CDP port for tools/gpuperf.mjs (needs WSL mirrored networking).
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --remote-debugging-port=${1:-9333} \
  --user-data-dir='C:\Users\sonny\AppData\Local\Temp\aot-perf-profile' --use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist \
  --disable-gpu-vsync --disable-frame-rate-limit --no-first-run --window-size=1920,1080 about:blank >/dev/null 2>&1 &
