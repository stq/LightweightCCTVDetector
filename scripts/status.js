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

const camerasRoot = process.env.CAMERAS_ROOT || '';
if (!camerasRoot || !fs.existsSync(camerasRoot)) {
  console.log('  CAMERAS_ROOT not set or does not exist (check .env).');
  process.exit(0);
}

let cameras;
try {
  cameras = fs.readdirSync(camerasRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, folder: path.join(camerasRoot, d.name) }));
} catch (e) {
  console.log(`  Cannot read CAMERAS_ROOT: ${e.message}`);
  process.exit(0);
}

if (cameras.length === 0) {
  console.log(`  No camera subfolders found in: ${camerasRoot}`);
} else {
  for (const { name, folder } of cameras) {
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
