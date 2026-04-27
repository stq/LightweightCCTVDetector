'use strict';

/**
 * LightweightCCTVDetector – entry point.
 *
 * Camera configuration is driven by a single .env key:
 *
 *   CAMERAS_ROOT=C:\cameras
 *
 * Every direct subfolder of CAMERAS_ROOT is treated as one camera.
 * The folder name becomes the camera name shown in alerts.
 *
 * Example layout:
 *   C:\cameras\
 *     FrontDoor\   ← camera "FrontDoor"
 *     Backyard\    ← camera "Backyard"
 *
 * The daily log file is written to CAMERAS_ROOT itself (e.g. 2026-04-11.log).
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

const camerasRoot = process.env.CAMERAS_ROOT || '';
if (!camerasRoot) {
  process.stderr.write('FATAL: CAMERAS_ROOT is not set in .env\n');
  process.exit(1);
}
if (!fs.existsSync(camerasRoot)) {
  process.stderr.write(`FATAL: CAMERAS_ROOT does not exist: ${camerasRoot}\n`);
  process.exit(1);
}

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

  // Optional public Telegram bot. Active only when both token and chat are set.
  publicTelegram: {
    enabled:  !!(process.env.PUBLIC_TELEGRAM_BOT_TOKEN && process.env.PUBLIC_TELEGRAM_CHAT_ID),
    botToken: process.env.PUBLIC_TELEGRAM_BOT_TOKEN || '',
    chatId:   process.env.PUBLIC_TELEGRAM_CHAT_ID   || '',
    // CSV of camera folder names whose alerts are forwarded to the public channel
    cameras:  (process.env.PUBLIC_CAMERAS || '').split(',').map((s) => s.trim()).filter(Boolean),
  },
};

// ── Cameras ───────────────────────────────────────────────────────────────────

const cameras = parseCameras(camerasRoot);
if (cameras.length === 0) {
  process.stderr.write(
    `FATAL: No camera subfolders found in CAMERAS_ROOT: ${camerasRoot}\n` +
    'Create one subfolder per camera inside CAMERAS_ROOT.\n',
  );
  process.exit(1);
}

// ── Logger ────────────────────────────────────────────────────────────────────

// Log folder is CAMERAS_ROOT itself; daily file named YYYY-MM-DD.log
logger.init(camerasRoot, cfg.logLevel);

logger.info('=== LightweightCCTVDetector starting ===');
logger.info(`cameras root : ${camerasRoot}`);
logger.info(`cameras      : ${cameras.map((c) => c.name).join(', ')}`);
logger.info(`email        : ${cfg.email.enabled ? cfg.email.to : 'disabled'}`);
logger.info(`telegram     : ${cfg.telegram.enabled ? `chat ${cfg.telegram.chatId}` : 'disabled'}`);
if (cfg.publicTelegram.enabled) {
  logger.info(
    `public bot   : chat ${cfg.publicTelegram.chatId}, cameras: ${cfg.publicTelegram.cameras.join(', ')}`,
  );
} else {
  logger.info('public bot   : disabled');
}

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

process.on('uncaughtException', (e) => {
  const msg = `UNCAUGHT EXCEPTION: ${e.stack || e.message}`;
  logger.error(msg);
  notifier.sendError(msg).catch(() => {});
});

process.on('unhandledRejection', (r) => {
  const msg = `UNHANDLED REJECTION: ${r instanceof Error ? (r.stack || r.message) : String(r)}`;
  logger.error(msg);
  notifier.sendError(msg).catch(() => {});
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCameras(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, folder: path.join(root, d.name) }));
  } catch (err) {
    return [];
  }
}

function envBool(key, defaultVal) {
  const v = process.env[key];
  if (!v) return defaultVal;
  return v.toLowerCase() !== 'false' && v !== '0';
}
