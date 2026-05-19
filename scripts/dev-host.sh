#!/bin/bash
# Start the Host bridge service in development mode
cd "$(dirname "$0")/.." || exit 1
pnpm dev:host
