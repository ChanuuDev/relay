@echo off
if exist "%~dp0relay.exe" (
  "%~dp0relay.exe" hook codex --end
) else (
  echo {}
)
