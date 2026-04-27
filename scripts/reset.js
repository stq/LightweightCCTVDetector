'use strict';

/**
 * Reset scanned state and replay all existing images in chronological order.
 *
 *   npm run reset
 *
 * This script:
 *   1. Reads CAMERAS_ROOT from .env
 *   2. Deletes detector_scanned.txt from each camera subfolder
 *   3. Starts the detector with SCAN_EXISTING=true so every existing image
 *      is re-queued oldest-first before live watching begins
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const camerasRoot = process.env.CAMERAS_ROOT || '';
if (!camerasRoot) {
  console.error('FATAL: CAMERAS_ROOT is not set in .env');
  process.exit(1);
}
if (!fs.existsSync(camerasRoot)) {
  console.error(`FATAL: CAMERAS_ROOT does not exist: ${camerasRoot}`);
  process.exit(1);
}

// ── Clear scanned state ───────────────────────────────────────────────────────

const cameras = fs.readdirSync(camerasRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory());

if (cameras.length === 0) {
  console.error(`No camera subfolders found in: ${camerasRoot}`);
  process.exit(1);
}

for (const cam of cameras) {
  const scannedFile = path.join(camerasRoot, cam.name, 'detector_scanned.txt');
  if (fs.existsSync(scannedFile)) {
    fs.unlinkSync(scannedFile);
    console.log(`Cleared: ${scannedFile}`);
  } else {
    console.log(`Already empty: ${cam.name}`);
  }
}

console.log('\nStarting detector in full-rescan mode (SCAN_EXISTING=true)…\n');

// ── Start detector ────────────────────────────────────────────────────────────

const child = spawn(
  process.execPath,
  [path.join(__dirname, '..', 'src', 'index.js')],
  {
    env:   { ...process.env, SCAN_EXISTING: 'true' },
    stdio: 'inherit',
  },
);

child.on('exit', (code) => process.exit(code ?? 0));
