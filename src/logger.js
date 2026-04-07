'use strict';

const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  constructor() {
    this.logDir = null;
    this.minLevel = 1; // info
    this._currentDate = null;
    this._stream = null;
  }

  init(logDir, level = 'info') {
    this.logDir = logDir;
    this.minLevel = LEVELS[level] ?? 1;
    this._rotateIfNeeded();
  }

  _rotateIfNeeded() {
    const today = new Date().toISOString().slice(0, 10);
    if (today === this._currentDate) return;
    this._currentDate = today;
    if (this._stream) {
      this._stream.end();
      this._stream = null;
    }
    if (this.logDir) {
      const logPath = path.join(this.logDir, `detector_${today}.log`);
      this._stream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
      this._stream.on('error', (err) => {
        process.stderr.write(`[Logger] stream error: ${err.message}\n`);
      });
    }
  }

  _write(level, msg) {
    if (LEVELS[level] < this.minLevel) return;
    this._rotateIfNeeded();
    const line = `[${new Date().toISOString()}] [${level.toUpperCase().padEnd(5)}] ${msg}\n`;
    process.stdout.write(line);
    if (this._stream) {
      this._stream.write(line);
    }
  }

  debug(msg) { this._write('debug', msg); }
  info(msg)  { this._write('info',  msg); }
  warn(msg)  { this._write('warn',  msg); }
  error(msg) { this._write('error', msg); }
}

module.exports = new Logger();
