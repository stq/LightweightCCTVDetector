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
    this._patching = false; // re-entrancy guard for stdio patch
  }

  init(logDir, level = 'info') {
    this.logDir = logDir;
    this.minLevel = LEVELS[level] ?? 1;
    this._rotateIfNeeded();
    this._patchStdio();
  }

  /**
   * Intercept process.stdout and process.stderr so that all output from the
   * main process — including TF.js messages and third-party modules — is
   * mirrored to the daily log file.  Re-entrancy is guarded to prevent
   * infinite recursion when the stream error handler itself writes to stderr.
   */
  _patchStdio() {
    const self = this;
    const patch = (stream) => {
      const orig = stream.write.bind(stream);
      stream.write = function (chunk, encoding, cb) {
        if (!self._patching && self._stream) {
          self._patching = true;
          self._rotateIfNeeded();
          if (typeof chunk === 'string') self._stream.write(chunk, 'utf8');
          else if (Buffer.isBuffer(chunk)) self._stream.write(chunk);
          self._patching = false;
        }
        return orig(chunk, encoding, cb);
      };
    };
    patch(process.stdout);
    patch(process.stderr);
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
      const logPath = path.join(this.logDir, `${today}.log`);
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
    // Write to stdout only — the stdio patch mirrors it to the log file.
    process.stdout.write(line);
  }

  debug(msg) { this._write('debug', msg); }
  info(msg)  { this._write('info',  msg); }
  warn(msg)  { this._write('warn',  msg); }
  error(msg) { this._write('error', msg); }
}

module.exports = new Logger();
