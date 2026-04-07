'use strict';
/**
 * Show service status + image counts in watched camera folders.
 *
 *   npm run status
 */

require('dotenv').config();

const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');

const TASK_NAME  = 'LightweightCCTVDetector';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp']);

// ── Scheduled task status ─────────────────────────────────────────────────────

console.log('=== Service status ===');
try {
  const out = execSync(`schtasks /Query /TN "${TASK_NAME}" /FO LIST /V`, { encoding: 'utf8' });
  // Print only the most useful lines to keep output short
  const keep = ['TaskName', 'Status', 'Last Run Time', 'Next Run Time', 'Last Result', 'Run As User'];
  out.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (keep.some((k) => trimmed.startsWith(k))) console.log(' ', trimmed);
  });
} catch {
  console.log('  Task not found or schtasks unavailable.');
}

// ── Camera folders ────────────────────────────────────────────────────────────

console.log('\n=== Camera folders ===');

const cameras = [];
for (let i = 1; i <= 8; i++) {
  const folder = process.env[`CAMERA_${i}_FOLDER`];
  if (folder) cameras.push({ name: process.env[`CAMERA_${i}_NAME`] || `Camera ${i}`, folder });
}
if (cameras.length === 0 && process.env.WATCH_FOLDER) {
  cameras.push({ name: process.env.CAMERA_1_NAME || 'Camera 1', folder: process.env.WATCH_FOLDER });
}

if (cameras.length === 0) {
  console.log('  No camera folders configured (check .env).');
} else {
  for (const { name, folder } of cameras) {
    if (!fs.existsSync(folder)) {
      console.log(`  ${name}: folder not found – ${folder}`);
      continue;
    }
    let count = 0;
    let totalBytes = 0;
    try {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (entry.isFile() && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) {
          count++;
          totalBytes += fs.statSync(path.join(folder, entry.name)).size;
        }
      }
    } catch (e) {
      console.log(`  ${name}: cannot read folder – ${e.message}`);
      continue;
    }
    const mb = (totalBytes / 1024 / 1024).toFixed(1);
    console.log(`  ${name}: ${count} image${count !== 1 ? 's' : ''} (${mb} MB) – ${folder}`);
  }
}
