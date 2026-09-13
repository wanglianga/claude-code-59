#!/bin/sh
set -e
echo "==> initializing database (schema + seed on first run)"
node db/init.js
echo "==> starting application server"
exec node src/server.js
