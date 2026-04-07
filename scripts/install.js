'use strict';
/**
 * Register LightweightCCTVDetector as a Windows Scheduled Task that starts at
 * system boot under the SYSTEM account (no user login required), then starts
 * the service immediately.
 *
 * Run once (as Administrator):
 *   npm run install
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ROOT      = path.resolve(__dirname, '..');
const TASK_NAME = 'LightweightCCTVDetector';
const NODE_EXE  = process.execPath;
const SCRIPT    = path.join(ROOT, 'src', 'index.js');
const LOG_FILE  = path.join(ROOT, 'service-start.log');
const ENV_FILE  = path.join(ROOT, '.env');

if (!fs.existsSync(ENV_FILE)) {
  console.error(`ERROR: .env file not found at ${ENV_FILE}`);
  console.error('Copy .env.example to .env and fill in your credentials first.');
  process.exit(1);
}

// /SC ONSTART  – runs at system boot, no user login required
// /RU SYSTEM   – runs as SYSTEM account, no password needed
// /RL HIGHEST  – run with highest privileges so it can watch system folders
// /F           – force overwrite if task already exists
const createCmd = [
  'schtasks', '/Create',
  '/F',
  '/TN',  quote(TASK_NAME),
  '/TR',  quote(`${NODE_EXE} ${SCRIPT} >> ${LOG_FILE} 2>&1`),
  '/SC',  'ONSTART',
  '/RU',  'SYSTEM',
  '/RL',  'HIGHEST',
  '/DELAY', '0001:00',
].join(' ');

console.log(`Registering scheduled task: ${TASK_NAME}`);
try {
  execSync(createCmd, { stdio: 'inherit' });
} catch {
  console.error('ERROR: Failed to register scheduled task. Run as Administrator.');
  process.exit(1);
}

console.log('\nStarting service…');
try {
  execSync(`schtasks /Run /TN "${TASK_NAME}"`, { stdio: 'inherit' });
  console.log('Service started.');
} catch {
  console.error('ERROR: Task registered but failed to start. Try rebooting.');
  process.exit(1);
}

function quote(s) {
  return `"${s.replace(/"/g, '\\"')}"`;
}
