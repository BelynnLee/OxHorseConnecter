#!/bin/bash
# Initialize the SQLite database
# The database is auto-initialized on first Host startup.
# This script can be used to reset it.
cd "$(dirname "$0")/.." || exit 1

DB_PATH="${DB_PATH:-./data/rac.db}"
if [ -f "$DB_PATH" ]; then
  echo "Removing existing database: $DB_PATH"
  rm "$DB_PATH"
fi

echo "Database will be auto-created on next Host startup."
