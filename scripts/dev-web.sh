#!/bin/bash
# Start the Web console in development mode
cd "$(dirname "$0")/.." || exit 1
pnpm dev:web
