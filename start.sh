#!/bin/bash
set -e

# 启动后端服务（后台）
cd "$(dirname "$0")/backend"
node server.js &
BACKEND_PID=$!

# 启动前端服务（前台，暴露端口）
cd "$(dirname "$0")/frontend"
npm run dev

# 退出时清理后端进程
trap "kill $BACKEND_PID" EXIT
