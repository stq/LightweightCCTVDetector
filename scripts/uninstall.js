'use strict';
/**
 * Stop and remove the LightweightCCTVDetector scheduled task.
 *
 * Run as Administrator:
 *   npm run uninstall
 */

const { execSync } = require('child_process');

const TASK_NAME = 'LightweightCCTVDetector';

console.log('Stopping service…');
try {
  execSync(`schtasks /End /TN "${TASK_NAME}"`, { stdio: 'inherit' });
  console.log('Service stopped.');
} catch {
  console.log('Service was not running (or task not found).');
}

console.log('Removing scheduled task…');
try {
  execSync(`schtasks /Delete /F /TN "${TASK_NAME}"`, { stdio: 'inherit' });
  console.log(`Task "${TASK_NAME}" removed.`);
} catch {
  console.error('Failed to remove task – it may not exist.');
}
