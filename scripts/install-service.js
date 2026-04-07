'use strict';
/**
 * Register LightweightCCTVDetector as a Windows Scheduled Task that starts at system boot
 * under the SYSTEM account (no user login required).
 *
 * Run once (as Administrator):
 *   node scripts/install-service.js
 *
 * To remove:
 *   node scripts/uninstall-service.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ROOT      = path.resolve(__dirname, '..');
const TASK_NAME = 'LightweightCCTVDetector';
const NODE_EXE  = process.execPath; // full path to node.exe
const SCRIPT    = path.join(ROOT, 'src', 'index.js');
const LOG_FILE  = path.join(ROOT, 'service-start.log');
const ENV_FILE  = path.join(ROOT, '.env');

if (!fs.existsSync(ENV_FILE)) {
  console.error(`ERROR: .env file not found at ${ENV_FILE}`);
  console.error('Copy .env.example to .env and fill in your credentials first.');
  process.exit(1);
}

// schtasks /Create arguments
// /SC ONSTART  – runs at system boot, no user login required
// /RU SYSTEM   – runs as SYSTEM account, no password needed
// /RL HIGHEST  – run with highest privileges so it can watch system folders
// /F           – force overwrite if task already exists
const cmd = [
  'schtasks', '/Create',
  '/F',
  '/TN',  quote(TASK_NAME),
  '/TR',  quote(`${NODE_EXE} ${SCRIPT} >> ${LOG_FILE} 2>&1`),
  '/SC',  'ONSTART',
  '/RU',  'SYSTEM',
  '/RL',  'HIGHEST',
  '/DELAY', '0001:00',  // 1-minute delay after boot (let FTP server start first)
].join(' ');

console.log(`Registering Windows Scheduled Task: ${TASK_NAME}`);
console.log(`Command: ${cmd}`);

try {
  execSync(cmd, { stdio: 'inherit' });
  console.log('\nService installed successfully.');
  console.log(`Start it now with:  schtasks /Run /TN "${TASK_NAME}"`);
  console.log(`Or reboot and it will start automatically.`);
} catch (err) {
  console.error('ERROR: Failed to register scheduled task.');
  console.error('Make sure you are running this script as Administrator.');
  process.exit(1);
}

function quote(s) {
  return `"${s.replace(/"/g, '\\"')}"`;
}
