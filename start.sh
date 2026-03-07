#!/bin/bash
ulimit -n 65536 2>/dev/null || true
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first"
exec node_modules/.bin/next start
