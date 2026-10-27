@echo off
setlocal
cd /d "%~dp0"
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo Node.js and npm are required to run the local preview.
  echo Install Node.js, then run this launcher again.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Project dependencies are missing. Run npm install in this folder first.
  pause
  exit /b 1
)
echo Starting the unpublished Longleaf Atlas preview on this computer.
echo Keep this window open while reviewing the app.
echo The browser will open after the server is ready.
echo Press Ctrl+C in this window to stop the preview.
call npm.cmd run dev -- --host 127.0.0.1 --port 5180 --strictPort --open
if errorlevel 1 (
  echo Preview could not start. The error is shown above.
  pause
  exit /b 1
)
