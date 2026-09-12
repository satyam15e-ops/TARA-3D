@echo off
echo ========================================================
echo   TARA-3D : ISRO/SAC PS SIH26175 Geodetic Engine
echo   Automated Environment Setup & Launch
echo ========================================================

python -m venv venv
call venv\Scripts\activate

python -m pip install --upgrade pip
pip install -r requirements.txt

echo.
echo [*] Running Geodetic Pipeline Unit Verification...
python test_pipeline.py

echo.
echo [*] Launching Production GIS Cockpit on port 8080...
python run_production.py
pause
