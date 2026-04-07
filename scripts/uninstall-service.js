'use strict';
const { execSync } = require('child_process');

const TASK_NAME = 'LightweightCCTVDetector';

try {
  execSync(`schtasks /Delete /F /TN "${TASK_NAME}"`, { stdio: 'inherit' });
  console.log(`Scheduled task "${TASK_NAME}" removed.`);
} catch (err) {
  console.error('Failed to remove task – it may not exist.');
}
