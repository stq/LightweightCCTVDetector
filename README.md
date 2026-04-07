# LightweightCCTVDetector

A second-layer motion detection service for static IP cameras. Cameras that detect motion by pixel change alone produce excessive false alarms from shadows, clouds, and wind. LightweightCCTVDetector watches the camera's FTP output folder and applies AI-based object recognition to filter out these false positives — only alerting when a real person, animal, vehicle, or unknown object is present.

## How it works

1. Camera saves JPEG images to a local FTP folder on motion trigger
2. LightweightCCTVDetector watches that folder with [chokidar](https://github.com/paulmillr/chokidar)
3. Each new image is compared to a stored "safe" baseline image using pixel diff
4. If significant change is detected, [TensorFlow.js COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd) runs inference on the frame
5. Confirmed detections send an alert (with annotated image) via **email** and/or **Telegram**
6. Shadow/wind/reflection changes that AI does not confirm are silently ignored

Detection categories: `PERSON`, `ANIMAL`, `VEHICLE`, `OBJECT`, `UNKNOWN` (AI unavailable fallback), `NONE` (ignored).

## Requirements

- **Node.js** ≥ 18
- Windows (for the auto-start service scripts) — the detection logic itself runs on any platform
- A camera that saves images to a local folder via FTP

Tested on a [Youyeetoo X1](https://www.youyeetoo.com/products/x1-single-board-computer) SBC (Intel N5105).

## Installation

```bash
git clone https://github.com/stq/LightweightCCTVDetector.git
cd LightweightCCTVDetector
npm install
cp .env.example .env
```

Edit `.env` with your camera paths and notification credentials (see [Configuration](#configuration) below).

## Running

**Manually:**
```bash
npm start
```

**As a Windows auto-start service** (runs at logon, restarts automatically):
```bash
# Run once as Administrator
npm run install-service

# Check if the service is running
npm run status

# To remove
npm run uninstall-service
```

The service uses Windows Task Scheduler (`ONLOGON` trigger) with a 1-minute startup delay to allow the FTP server to initialize first.

## Configuration

### `.env` — credentials and paths

Copy `.env.example` to `.env` and fill in your values. This file is gitignored and never committed.

| Variable | Required | Description |
|---|---|---|
| `CAMERA_1_FOLDER` | Yes | Path to camera FTP folder |
| `CAMERA_1_NAME` | No | Display name (default: `Camera 1`) |
| `CAMERA_2_FOLDER` … `CAMERA_8_FOLDER` | No | Additional cameras (up to 8) |
| `LOG_FOLDER` | No | Log output folder (default: `CAMERA_1_FOLDER`) |
| `EMAIL_ENABLED` | No | `true` / `false` (default: `true`) |
| `EMAIL_FROM` | Yes (if email) | Sender address |
| `EMAIL_TO` | Yes (if email) | Recipient address |
| `EMAIL_SMTP_HOST` | Yes (if email) | SMTP server (e.g. `smtp.yandex.ru`) |
| `EMAIL_SMTP_PORT` | Yes (if email) | SMTP port (e.g. `465`) |
| `EMAIL_USER` | Yes (if email) | SMTP username |
| `EMAIL_PASS` | Yes (if email) | App password (not your account password) |
| `TELEGRAM_ENABLED` | No | `true` / `false` (default: `true`) |
| `TELEGRAM_BOT_TOKEN` | Yes (if Telegram) | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Yes (if Telegram) | Target chat or channel ID |

> **Email app passwords:**
> - Yandex: https://id.yandex.ru/security/app-passwords (port 465)
> - Gmail: https://myaccount.google.com/apppasswords (port 587, host `smtp.gmail.com`)

### `config.json` — detection tuning

| Key | Default | Description |
|---|---|---|
| `detection.compareWidth/Height` | 640×480 | Resolution for pixel diff comparison |
| `detection.pixelDiffThreshold` | 25 | Per-channel difference to count a pixel as changed |
| `detection.minChangedRatio` | 0.015 | Minimum fraction of changed pixels to proceed |
| `detection.minBlobArea` | 300 | Minimum blob size in pixels |
| `detection.minBlobDensity` | 0.08 | Minimum blob density (area/bounding box) |
| `detection.aiConfidenceThreshold` | 0.45 | Minimum COCO-SSD confidence score |
| `safeImage.updateIntervalMs` | 1800000 | How often (ms) the baseline image is refreshed (30 min) |
| `safeImage.lockoutAfterAlertMs` | 300000 | Baseline update lockout after an alert (5 min) |
| `notifications.cooldownMs` | 0 | Minimum ms between alerts per camera |
| `watchDebounceMs` | 1000 | File write debounce in ms |
| `logLevel` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

## TensorFlow.js backends

The detector tries backends in order:

1. **`@tensorflow/tfjs-node`** — native CPU binding, ~0.5–2 s/frame on N5105. Requires `tensorflow.dll` on PATH (installed automatically via npm on most Windows setups).
2. **`@tensorflow/tfjs`** — pure JavaScript fallback, ~3–8 s/frame, no native dependencies.

If both fail, the service continues in blob-only mode and sends `UNKNOWN` alerts for significant pixel changes.

## Logs

A daily rotating log file is written to `LOG_FOLDER` (defaults to the first camera's FTP folder). Log level is controlled by `logLevel` in `config.json`.

## Project structure

```
src/
  index.js      — entry point, reads config, starts watchers
  watcher.js    — chokidar file watcher per camera
  detector.js   — TF.js COCO-SSD inference + classification
  compare.js    — pixel diff and blob detection
  notifier.js   — email (nodemailer) and Telegram alerts
  logger.js     — daily log file writer
scripts/
  install-service.js    — register Windows Scheduled Task
  uninstall-service.js  — remove Windows Scheduled Task
config.json     — detection and notification tuning
.env.example    — credential template
```

## License

MIT
