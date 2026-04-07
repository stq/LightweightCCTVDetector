'use strict';
/**
 * Send a test email and a test Telegram message using the current .env config.
 *
 *   node scripts/test-notify.js
 *   npm test
 */

require('dotenv').config();

const path     = require('path');
const fs       = require('fs');
const notifier = require('../src/notifier');

// ── Config (mirrors index.js) ─────────────────────────────────────────────────

const configPath = path.join(__dirname, '..', 'config.json');
if (!fs.existsSync(configPath)) {
  console.error(`ERROR: config.json not found at ${configPath}`);
  process.exit(1);
}
const fileCfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const cfg = {
  detection:     fileCfg.detection,
  safeImage:     fileCfg.safeImage,
  notifications: { ...fileCfg.notifications, cooldownMs: 0 }, // bypass cooldown
  email: {
    enabled:  envBool('EMAIL_ENABLED', true),
    from:     process.env.EMAIL_FROM      || '',
    to:       process.env.EMAIL_TO        || '',
    smtpHost: process.env.EMAIL_SMTP_HOST || 'smtp.yandex.ru',
    smtpPort: parseInt(process.env.EMAIL_SMTP_PORT || '465', 10),
    user:     process.env.EMAIL_USER      || '',
    pass:     process.env.EMAIL_PASS      || '',
  },
  telegram: {
    enabled:  envBool('TELEGRAM_ENABLED', true),
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId:   process.env.TELEGRAM_CHAT_ID   || '',
  },
};

notifier.init(cfg);

// ── Minimal 1×1 white JPEG used as a placeholder image attachment ─────────────

// prettier-ignore
const PLACEHOLDER_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS' +
  'Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ' +
  'CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/' +
  'EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/' +
  'aAAwDAQACEQMRAD8AJQAB/9k=',
  'base64',
);

// ── Send ──────────────────────────────────────────────────────────────────────

const alert = {
  cameraName:   'Test Camera',
  category:     'TEST',
  label:        'test notification',
  imagePath:    '(no file – test run)',
  imageBuffer:  PLACEHOLDER_JPEG,
  changedRatio: 0,
};

console.log('Sending test notifications…');
console.log(`  email    : ${cfg.email.enabled    ? cfg.email.to               : 'disabled'}`);
console.log(`  telegram : ${cfg.telegram.enabled ? `chat ${cfg.telegram.chatId}` : 'disabled'}`);
console.log('');

notifier.send(alert).then(() => {
  console.log('Done.');
}).catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});

function envBool(key, defaultVal) {
  const v = process.env[key];
  if (!v) return defaultVal;
  return v.toLowerCase() !== 'false' && v !== '0';
}
