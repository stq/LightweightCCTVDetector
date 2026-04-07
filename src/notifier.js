'use strict';

/**
 * Notification module: email (nodemailer) + Telegram Bot API.
 *
 * Both channels attach the annotated image.
 * A per-channel cooldown prevents floods when the camera fires repeatedly
 * for the same event.
 *
 * Gmail note: Google removed "less secure app access" in 2022.
 * You MUST use an App Password (not your real password):
 *   https://myaccount.google.com/apppasswords
 * Enable 2-Step Verification first, then generate an App Password for "Mail".
 */

const logger = require('./logger');

let nodemailer = null;
let axios      = null;
let FormData   = null;

const TELEGRAM_API = 'https://api.telegram.org/bot';

class Notifier {
  constructor() {
    this._lastEmailAt    = 0;
    this._lastTelegramAt = 0;
    this._cfg = null;
  }

  init(cfg) {
    this._cfg = cfg;
  }

  /**
   * Send an alert to all enabled channels.
   *
   * @param {object} alert
   * @param {string} alert.category    - 'PERSON' | 'ANIMAL' | 'VEHICLE' | 'OBJECT' | 'UNKNOWN'
   * @param {string} alert.label
   * @param {string} alert.imagePath
   * @param {Buffer} alert.imageBuffer - annotated JPEG
   * @param {number} alert.changedRatio
   */
  async send(alert) {
    const cfg     = this._cfg;
    const now     = Date.now();
    const cooldown = cfg.notifications.cooldownMs;
    const subject = `[Camera Alert] ${alert.cameraName} – ${alert.category}: ${alert.label}`;
    const body    = buildBody(alert);

    const tasks = [];

    if (cfg.email.enabled) {
      if (now - this._lastEmailAt >= cooldown) {
        tasks.push(
          this._sendEmail(subject, body, alert.imageBuffer)
            .then(() => { this._lastEmailAt = Date.now(); })
            .catch((e) => logger.error(`notifier: email error – ${formatEmailError(e)}`)),
        );
      } else {
        logger.debug('notifier: email suppressed (cooldown)');
      }
    }

    if (cfg.telegram.enabled) {
      if (now - this._lastTelegramAt >= cooldown) {
        tasks.push(
          this._sendTelegram(subject, alert.imageBuffer)
            .then(() => { this._lastTelegramAt = Date.now(); })
            .catch((e) => logger.error(`notifier: telegram error – ${formatAxiosError(e)}`)),
        );
      } else {
        logger.debug('notifier: telegram suppressed (cooldown)');
      }
    }

    await Promise.allSettled(tasks);
  }

  // ── Email ──────────────────────────────────────────────────────────────────

  async _sendEmail(subject, body, imageBuffer) {
    if (!nodemailer) nodemailer = require('nodemailer');

    const cfg = this._cfg.email;
    const transport = nodemailer.createTransport({
      host:   cfg.smtpHost,
      port:   cfg.smtpPort,
      secure: cfg.smtpPort === 465,
      auth:   { user: cfg.user, pass: cfg.pass },
      tls:    { rejectUnauthorized: false },
    });

    await transport.sendMail({
      from:    cfg.from,
      to:      cfg.to,
      subject,
      text:    body,
      attachments: [{
        filename:    `alert_${Date.now()}.jpg`,
        content:     imageBuffer,
        contentType: 'image/jpeg',
      }],
    });

    logger.info(`notifier: email sent → ${cfg.to}`);
  }

  // ── Telegram ───────────────────────────────────────────────────────────────

  async _sendTelegram(caption, imageBuffer) {
    if (!axios)    axios    = require('axios');
    if (!FormData) FormData = require('form-data');

    const { botToken, chatId } = this._cfg.telegram;
    const url = `${TELEGRAM_API}${botToken}/sendPhoto`;

    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption.slice(0, 1024));
    form.append('photo', imageBuffer, {
      filename:    `alert_${Date.now()}.jpg`,
      contentType: 'image/jpeg',
    });

    await axios.post(url, form, {
      headers:        form.getHeaders(),
      maxBodyLength:  Infinity,
      timeout:        30000,
    });

    logger.info(`notifier: telegram sent → chat ${chatId}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildBody(alert) {
  return [
    `Camera:    ${alert.cameraName}`,
    `Detection: ${alert.label}`,
    `Category:  ${alert.category}`,
    `Time:      ${new Date().toLocaleString()}`,
    `Changed:   ${(alert.changedRatio * 100).toFixed(2)}% of frame`,
    `Image:     ${alert.imagePath}`,
  ].join('\n');
}

function formatEmailError(err) {
  const msg = err.message || String(err);
  if (msg.includes('535') || msg.includes('authentication failed') || msg.includes('Invalid login')) {
    return (
      `${msg}\n` +
      `  ↳ SMTP auth failed. Your mail provider requires an App Password, not your real account password.\n` +
      `  ↳ Yandex: https://id.yandex.ru/security/app-passwords\n` +
      `  ↳ Gmail:  https://myaccount.google.com/apppasswords`
    );
  }
  return msg;
}

function formatAxiosError(err) {
  if (err.response) {
    const body = JSON.stringify(err.response.data);
    return `HTTP ${err.response.status} – ${body}`;
  }
  return err.message;
}

module.exports = new Notifier();
