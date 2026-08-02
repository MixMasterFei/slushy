@echo off
REM ---------------------------------------------------------------------------
REM Fallback npm launcher for Windows.
REM
REM Comments here are deliberately ASCII-only: cmd.exe reads .cmd files in the
REM OEM codepage, and accented characters break REM line parsing, spraying
REM "not recognized as an internal command" noise over every run.
REM
REM Why this exists: Node IS installed and IS on the system PATH. But a process
REM started BEFORE that PATH entry was added keeps the old environment and hands
REM it down to everything it spawns. In a terminal opened from such an app, npm
REM stays unreachable even though the machine is configured correctly.
REM
REM The real fix is to open a fresh terminal from the Start menu, or restart the
REM host application. This script only avoids being blocked meanwhile, and
REM becomes unnecessary once the environment is refreshed.
REM
REM Usage:  scripts\npm run dev   scripts\npm test   scripts\npm install
REM ---------------------------------------------------------------------------

if not exist "%ProgramFiles%\nodejs\npm.cmd" (
  echo [error] Node not found in "%ProgramFiles%\nodejs".
  echo Install Node.js, or adjust the path in scripts\npm.cmd
  exit /b 1
)

set "PATH=%ProgramFiles%\nodejs;%PATH%"
call npm %*
