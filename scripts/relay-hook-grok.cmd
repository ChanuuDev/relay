@echo off
if exist "%~dp0relay.exe" (
  "%~dp0relay.exe" hook grok
) else (
  echo {}
)
