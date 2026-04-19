#!/bin/sh
set -e
# Тома Docker часто приходят с владельцем root — без этого SQLite и загрузки падают с Permission denied
mkdir -p /app/data /app/uploads
chown -R hatchway:hatchway /app/data /app/uploads
exec runuser -u hatchway -- "$@"
