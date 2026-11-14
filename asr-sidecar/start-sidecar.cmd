@echo off
rem Arranca el sidecar local de transcripcion (faster-whisper).
rem Usa el venv del repo si existe; si no, el Python del PATH.
rem Override: set FLU_ASR_PYTHON=C:\ruta\al\python.exe
rem Argumentos opcionales: --puerto 8765 --modelo small --hilos 8 --beam 1
setlocal
set "ROOT=%~dp0.."
set "PY=%FLU_ASR_PYTHON%"
if "%PY%"=="" if exist "%ROOT%\.agent_tmp\venv\Scripts\python.exe" set "PY=%ROOT%\.agent_tmp\venv\Scripts\python.exe"
if "%PY%"=="" set "PY=python"
"%PY%" "%~dp0sidecar.py" %*
