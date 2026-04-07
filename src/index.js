'use strict';

/**
 * LightweightCCTVDetector – entry point.
 *
 * Camera configuration is read from environment variables:
 *
 *   CAMERA_1_FOLDER=C:\camera\ftp       (required – at least one camera)
 *   CAMERA_1_NAME=Front Door            (optional, defaults to "Camera 1")
 *   CAMERA_2_FOLDER=C:\camera2\ftp
 *   CAMERA_2_NAME=Backyard
 *   ...up to CAMERA_8_*
 *
 * For a single-camera setup, WATCH_FOLDER is still accepted as an alias for
 * CAMERA_1_FOLDER (backward compatibility).
 *
 * LOG_FOLDER overrides where the daily log file is written.
 * Defaults to the first camera's folder.
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const logger   = require('./logger');
const Watcher  = require('./watcher');
const notifier = require('./notifier');
const { loadModel } = require('./detector');

// ── Config ────────────────────────────────────────────────────────────────────

const configPath = path.join(__dirname, '..', 'config.json');
if (!fs.existsSync(configPath)) {
  process.stderr.write(`FATAL: config.json not found at ${configPath}\n`);
  process.exit(1);
}
const fileCfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const cfg = {
  detection:       fileCfg.detection,
  safeImage:       fileCfg.safeImage,
  notifications:   fileCfg.notifications,
  watchDebounceMs: fileCfg.watchDebounceMs,
  logLevel:        fileCfg.logLevel || 'info',

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

// ── Cameras ───────────────────────────────────────────────────────────────────

const cameras = parseCameras();
if (cameras.length === 0) {
  process.stderr.write(
    'FATAL: No camera folders configured.\n' +
    'Set CAMERA_1_FOLDER (and optionally CAMERA_1_NAME) in .env.\n' +
    'Single-camera setup: WATCH_FOLDER is also accepted.\n',
  );
  process.exit(1);
}

// ── Logger ────────────────────────────────────────────────────────────────────

const logFolder = process.env.LOG_FOLDER || cameras[0].folder;
logger.init(logFolder, cfg.logLevel);

logger.info('=== LightweightCCTVDetector starting ===');
logger.info(`cameras      : ${cameras.map((c) => `${c.name} → ${c.folder}`).join(' | ')}`);
logger.info(`email        : ${cfg.email.enabled ? cfg.email.to : 'disabled'}`);
logger.info(`telegram     : ${cfg.telegram.enabled ? `chat ${cfg.telegram.chatId}` : 'disabled'}`);

// ── Notifier ──────────────────────────────────────────────────────────────────

notifier.init(cfg);

// ── Watchers ──────────────────────────────────────────────────────────────────

const watchers = cameras.map((cam) => {
  const w = new Watcher(cam.folder, cam.name, cfg);
  w.start();
  return w;
});

// ── Pre-warm TF.js model ──────────────────────────────────────────────────────

loadModel().catch((err) => {
  logger.warn(`index: TF model pre-warm failed – ${err.message}`);
  logger.warn('index: detection will run in blob-only mode');
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  logger.info(`index: ${signal} – shutting down`);
  watchers.forEach((w) => w.stop());
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException',   (e) => logger.error(`UNCAUGHT: ${e.stack || e.message}`));
process.on('unhandledRejection',  (r) => logger.error(`UNHANDLED REJECTION: ${r}`));

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCameras() {
  const list = [];

  for (let i = 1; i <= 8; i++) {
    const folder = process.env[`CAMERA_${i}_FOLDER`];
    if (folder) {
      list.push({
        folder,
        name: process.env[`CAMERA_${i}_NAME`] || `Camera ${i}`,
      });
    }
  }

  // Backward-compat single-camera alias
  if (list.length === 0 && process.env.WATCH_FOLDER) {
    list.push({
      folder: process.env.WATCH_FOLDER,
      name:   process.env.CAMERA_1_NAME || 'Camera 1',
    });
  }

  return list;
}

function envBool(key, defaultVal) {
  const v = process.env[key];
  if (!v) return defaultVal;
  return v.toLowerCase() !== 'false' && v !== '0';
}
