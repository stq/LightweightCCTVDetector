'use strict';

/**
 * Per-camera file watcher.
 *
 * Constructed with a specific folder + human name (e.g. "Front Door").
 * Each instance maintains its own:
 *   - safe reference image
 *   - set of already-scanned filenames (persisted to detector_scanned.txt)
 *   - processing queue
 *
 * When started with SCAN_EXISTING=true (set by `npm run reset`), the watcher
 * queues all existing images sorted oldest-first before starting live watching.
 */

const fs   = require('fs');
const path = require('path');

const chokidar = require('chokidar');
const { compareImages } = require('./compare');
const { detect, annotateImage } = require('./detector');
const notifier = require('./notifier');
const logger   = require('./logger');

const IMAGE_EXTS    = new Set(['.jpg', '.jpeg', '.png', '.bmp']);
const SCANNED_FILE  = 'detector_scanned.txt';
const SCANNED_MAX   = 10000;  // prune to half when this is exceeded
const SCANNED_KEEP  = 5000;

class Watcher {
  /**
   * @param {string} folder      - absolute path to camera FTP folder
   * @param {string} name        - human-readable camera name (shown in alerts)
   * @param {object} cfg         - global config (detection, safeImage, etc.)
   */
  constructor(folder, name, cfg) {
    this._folder  = folder;
    this._name    = name;
    this._cfg     = cfg;

    this._safeImagePath     = null;
    this._lastAlertAt       = 0;
    this._lastSafeUpdateAt  = 0;

    this._queue      = [];
    this._processing = false;
    this._watcher    = null;

    // Scanned-images persistence
    this._scannedFile = path.join(folder, SCANNED_FILE);
    this._scanned     = new Set();
  }

  start() {
    this._loadScanned();
    this._initSafeImage();

    // In reset mode, queue all existing images sorted by modification time
    // so history is replayed in chronological order.
    if (process.env.SCAN_EXISTING === 'true') {
      this._enqueueExisting();
    }

    if (!fs.existsSync(this._folder)) {
      logger.warn(`[${this._name}] watch folder does not exist yet: ${this._folder}`);
    }

    this._watcher = chokidar.watch(this._folder, {
      persistent:       true,
      ignoreInitial:    true,
      awaitWriteFinish: {
        stabilityThreshold: this._cfg.watchDebounceMs,
        pollInterval:       200,
      },
      depth: 0,
    });

    this._watcher.on('add',   (p) => this._enqueue(p));
    this._watcher.on('error', (e) => logger.error(`[${this._name}] chokidar: ${e.message}`));

    logger.info(`[${this._name}] watching ${this._folder}`);
  }

  stop() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }

  // ─── Existing-image scan (reset mode) ────────────────────────────────────────

  _enqueueExisting() {
    if (!fs.existsSync(this._folder)) return;

    let files;
    try {
      files = fs.readdirSync(this._folder)
        .filter((f) => isImage(path.join(this._folder, f)))
        .map((f) => ({
          fullPath: path.join(this._folder, f),
          mtime:    fs.statSync(path.join(this._folder, f)).mtimeMs,
        }))
        .sort((a, b) => a.mtime - b.mtime); // oldest first
    } catch (err) {
      logger.warn(`[${this._name}] reset: could not read folder – ${err.message}`);
      return;
    }

    const unscanned = files.filter((f) => !this._scanned.has(path.basename(f.fullPath)));
    logger.info(`[${this._name}] reset: queuing ${unscanned.length} existing image(s) (oldest first)`);
    for (const { fullPath } of unscanned) {
      this._queue.push(fullPath);
    }
    if (unscanned.length > 0 && !this._processing) {
      this._processNext();
    }
  }

  // ─── Scanned-images persistence ──────────────────────────────────────────────

  _loadScanned() {
    try {
      if (!fs.existsSync(this._scannedFile)) return;
      const lines = fs.readFileSync(this._scannedFile, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      lines.forEach((l) => this._scanned.add(l));
      logger.info(`[${this._name}] loaded ${this._scanned.size} previously scanned image(s)`);
    } catch (err) {
      logger.warn(`[${this._name}] could not read scanned list – ${err.message}`);
    }
  }

  _markScanned(basename) {
    this._scanned.add(basename);

    // Append single line – fast, no full rewrite unless pruning needed
    fs.appendFile(this._scannedFile, basename + '\n', (err) => {
      if (err) logger.warn(`[${this._name}] scanned-file write error – ${err.message}`);
    });

    if (this._scanned.size > SCANNED_MAX) {
      this._pruneScanned();
    }
  }

  _pruneScanned() {
    const keep = [...this._scanned].slice(-SCANNED_KEEP);
    this._scanned = new Set(keep);
    fs.writeFile(this._scannedFile, keep.join('\n') + '\n', (err) => {
      if (err) logger.warn(`[${this._name}] scanned-file prune error – ${err.message}`);
      else     logger.info(`[${this._name}] scanned list pruned to ${keep.length} entries`);
    });
  }

  // ─── Queue ───────────────────────────────────────────────────────────────────

  _enqueue(filePath) {
    if (!isImage(filePath)) return;
    const basename = path.basename(filePath);

    if (this._scanned.has(basename)) {
      logger.debug(`[${this._name}] skip (already scanned): ${basename}`);
      return;
    }

    logger.debug(`[${this._name}] queued: ${basename}`);
    this._queue.push(filePath);
    if (!this._processing) this._processNext();
  }

  async _processNext() {
    if (this._queue.length === 0) { this._processing = false; return; }
    this._processing = true;
    const filePath = this._queue.shift();
    try {
      await this._handleImage(filePath);
    } catch (err) {
      logger.error(`[${this._name}] unhandled error – ${err.message}`);
    }
    setImmediate(() => this._processNext());
  }

  // ─── Core pipeline ────────────────────────────────────────────────────────────

  async _handleImage(imagePath) {
    const basename = path.basename(imagePath);
    logger.info(`[${this._name}] processing ${basename}`);

    // Mark scanned immediately – even if we crash mid-processing, don't re-process
    this._markScanned(basename);

    if (!this._safeImagePath) {
      this._setSafeImage(imagePath);
      logger.info(`[${this._name}] safe image initialised → ${basename}`);
      return;
    }

    // ── Pixel comparison ─────────────────────────────────────────────────────
    let compareResult;
    try {
      compareResult = await compareImages(imagePath, this._safeImagePath, this._cfg.detection);
    } catch (err) {
      logger.error(`[${this._name}] comparison failed – ${err.message}`);
      return;
    }

    const { significant, changedRatio, blobs } = compareResult;

    if (!significant) {
      logger.debug(`[${this._name}] no significant change (${pct(changedRatio)})`);
      this._maybeUpdateSafeImage(imagePath);
      return;
    }

    logger.info(
      `[${this._name}] significant change – ${pct(changedRatio)} changed, ${blobs.length} blob(s)`,
    );

    // ── AI detection ─────────────────────────────────────────────────────────
    let result;
    try {
      result = await detect(imagePath, this._cfg.detection.aiConfidenceThreshold, blobs);
    } catch (err) {
      logger.error(`[${this._name}] detection error – ${err.message}`);
      result = { category: 'UNKNOWN', label: `Detection failed: ${err.message}`, detections: [], alert: true };
    }

    logger.info(`[${this._name}] result – ${result.category}: ${result.label}`);

    // ── Notify ───────────────────────────────────────────────────────────────
    if (result.alert) {
      const imageBuffer = await annotateImage(imagePath, result.detections);

      await notifier.send({
        cameraName:   this._name,
        category:     result.category,
        label:        result.label,
        imagePath,
        imageBuffer,
        changedRatio,
      });

      this._lastAlertAt = Date.now();
    } else {
      this._maybeUpdateSafeImage(imagePath);
    }
  }

  // ─── Safe image ───────────────────────────────────────────────────────────────

  _initSafeImage() {
    if (!fs.existsSync(this._folder)) return;

    const files = fs.readdirSync(this._folder)
      .filter((f) => isImage(path.join(this._folder, f)))
      .filter((f) => f !== SCANNED_FILE)
      .map((f) => ({ f, mtime: fs.statSync(path.join(this._folder, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > 0) {
      this._setSafeImage(path.join(this._folder, files[0].f));
      logger.info(`[${this._name}] initial safe image → ${files[0].f}`);
    }
  }

  _setSafeImage(filePath) {
    this._safeImagePath    = filePath;
    this._lastSafeUpdateAt = Date.now();
  }

  _maybeUpdateSafeImage(newImagePath) {
    const now        = Date.now();
    const quietOk    = (now - this._lastAlertAt)      >= this._cfg.safeImage.lockoutAfterAlertMs;
    const dueUpdate  = (now - this._lastSafeUpdateAt) >= this._cfg.safeImage.updateIntervalMs;

    if (quietOk && dueUpdate) {
      logger.info(
        `[${this._name}] rotating safe image → ${path.basename(newImagePath)} ` +
        `(${Math.round((now - this._lastSafeUpdateAt) / 60000)} min since last update)`,
      );
      this._setSafeImage(newImagePath);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isImage(filePath) {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

function pct(ratio) {
  return `${(ratio * 100).toFixed(2)}%`;
}

module.exports = Watcher;
