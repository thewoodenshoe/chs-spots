#!/bin/bash
ulimit -n 65536 2>/dev/null || true
exec node_modules/.bin/next start
