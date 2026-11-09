@echo off
cd /d C:\dev\leadstream
if not exist logs mkdir logs
for %%F in (logs\reddit-daily.log) do if %%~zF GTR 2000000 (
  powershell -NoProfile -Command "Get-Content logs\reddit-daily.log -Tail 400 | Set-Content logs\reddit-daily.tmp" && move /y logs\reddit-daily.tmp logs\reddit-daily.log >nul
)
"C:\Program Files\nodejs\node.exe" scripts\reddit-daily.mjs >> logs\reddit-daily.log 2>&1
