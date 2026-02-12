#!/bin/bash
cd "$(dirname "$0")"
# Start Python server in background (quietly)
python3 -m http.server 8000 --bind 127.0.0.1 > /dev/null 2>&1 &
PID=$!
# Wait a second for server to start
sleep 1
# Open Chrome (or default browser) in "App Mode"
open -na "Google Chrome" --args --app="http://localhost:8000"
# When you close the terminal window, kill the server
wait $PID