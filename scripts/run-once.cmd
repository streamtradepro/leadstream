@echo off
cd /d C:\dev\leadstream
"C:\Program Files\nodejs\node.exe" scripts\run-local.js --once >> logs\scanner.log 2>&1
