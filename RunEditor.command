#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  DiptychTexts — launcher
#
#  FIRST TIME (or after an app update):
#    Double-click this file. Chrome opens at http://localhost:8000.
#    Click the  ⊕  Install  button in the address bar → "Install DiptychTexts".
#    The app is now installed like any other desktop app.
#
#  EVERY TIME AFTER THAT:
#    Just search "DiptychTexts" in Spotlight and click it.
#    The server is NOT required — the app loads from its offline cache.
#
#  AFTER UPDATING THE APP CODE:
#    Run this script once so the browser can re-cache the new files,
#    then close it again.
# ─────────────────────────────────────────────────────────────────────────────

cd "$(dirname "$0")"

PORT=8000

# ── If a server is already running on this port, just open the browser ────────
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Server already running on port $PORT — opening browser."
    open -a "Google Chrome" "http://localhost:$PORT" 2>/dev/null \
        || open -a "Microsoft Edge" "http://localhost:$PORT" 2>/dev/null \
        || open "http://localhost:$PORT"
    exit 0
fi

# ── Start the server ──────────────────────────────────────────────────────────
python3 -m http.server $PORT --bind 127.0.0.1 > /dev/null 2>&1 &
SERVER_PID=$!
sleep 0.8     # give Python a moment to bind the port

echo ""
echo "  ╔══════════════════════════════════════════════════════════╗"
echo "  ║              DiptychTexts  •  http://localhost:$PORT        ║"
echo "  ╠══════════════════════════════════════════════════════════╣"
echo "  ║                                                          ║"
echo "  ║  First time?                                             ║"
echo "  ║    Look for the  ⊕  icon in the Chrome address bar.     ║"
echo "  ║    Click it → \"Install DiptychTexts\".                    ║"
echo "  ║    After that, launch from Spotlight — no server needed. ║"
echo "  ║                                                          ║"
echo "  ║  Press  Ctrl-C  (or close this window) to stop.         ║"
echo "  ╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Open Chrome in normal mode so the ⊕ Install button is visible ────────────
if ! open -a "Google Chrome" "http://localhost:$PORT" 2>/dev/null; then
    if ! open -a "Microsoft Edge" "http://localhost:$PORT" 2>/dev/null; then
        open "http://localhost:$PORT"   # fall back to default browser
    fi
fi

# ── Keep server alive; clean up when window/terminal closes ──────────────────
trap "echo ''; echo 'Stopping server...'; kill $SERVER_PID 2>/dev/null" EXIT INT TERM
wait $SERVER_PID
