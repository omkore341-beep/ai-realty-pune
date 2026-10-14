#!/usr/bin/env bash
# Mac / Linux launcher (Windows users: double-click start.bat)
set -e
echo "Starting PostgreSQL..."
docker compose up -d
echo "Installing Node dependencies..."
npm install
echo "Starting Application..."
npm start
