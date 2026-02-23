#!/bin/bash
ulimit -n 65536 2>/dev/null || true
export DATA_DIR=/home/ubuntu/data
exec node_modules/.bin/next start
