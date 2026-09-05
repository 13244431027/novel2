@echo off
chcp 65001 >nul
echo 正在启动后端服务...
start "后端服务" cmd /k "cd /d %~dp0backend && node server.js"

echo 正在安装前端依赖并启动前端服务...
start "前端服务" cmd /k "cd /d %~dp0frontend && npm install && npm run dev"

echo 已启动两个独立窗口！
echo 提示：关闭对应窗口即可停止对应服务
pause
