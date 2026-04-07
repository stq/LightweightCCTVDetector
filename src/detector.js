'use strict';

/**
 * AI Object Detection using TensorFlow.js + COCO-SSD.
 *
 * Backend selection (automatic, in priority order):
 *   1. @tensorflow/tfjs-node  – native CPU binding, fastest (~0.5–2 s/frame on N5105)
 *                               Fails on Windows if tensorflow.dll is not on PATH.
 *   2. @tensorflow/tfjs       – pure JavaScript fallback, ~3–8 s/frame, no native deps.
 *
 * Image decoding:
 *   - With tfjs-node: uses tf.node.decodeImage (handles JPEG/PNG natively).
 *   - With pure tfjs: uses sharp to extract raw RGB pixels and wraps in a tensor.
 */

const fs     = require('fs');
const logger = require('./logger');

let cocoSsd         = null;
let tf              = null;
let model           = null;
let modelLoading    = null;
let useNativeDecoder = false;   // true when tfjs-node loaded successfully

const PERSON_CLASSES  = new Set(['person']);
const ANIMAL_CLASSES  = new Set([
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe',
]);
const VEHICLE_CLASSES = new Set([
  'bicycle', 'car', 'motorcycle', 'airplane',
  'bus', 'train', 'truck', 'boat',
]);

// ── Model loading ────────────────────────────────────────────────────────────

/**
 * Load COCO-SSD model once; safe to call concurrently.
 */
async function loadModel() {
  if (model) return model;
  if (modelLoading) return modelLoading;

  modelLoading = (async () => {
    logger.info('detector: loading TF.js + COCO-SSD model …');

    // 1. Try native backend
    try {
      tf = require('@tensorflow/tfjs-node');
      useNativeDecoder = true;
      logger.info('detector: using @tensorflow/tfjs-node (native CPU)');
    } catch (e) {
      logger.warn(`detector: tfjs-node native binding unavailable – ${e.message}`);
      logger.warn('detector: trying pure-JS @tensorflow/tfjs fallback (slower) …');

      // 2. Pure-JS fallback
      try {
        tf = require('@tensorflow/tfjs');
        useNativeDecoder = false;
        logger.info('detector: using @tensorflow/tfjs (pure JS)');
      } catch (e2) {
        const msg = `Neither tfjs-node nor tfjs could be loaded: ${e2.message}`;
        logger.error(`detector: ${msg}`);
        model = null;
        modelLoading = null;
        throw new Error(msg);
      }
    }

    try {
      cocoSsd = require('@tensorflow-models/coco-ssd');
      model   = await cocoSsd.load({ base: 'mobilenet_v2' });
      logger.info('detector: COCO-SSD model ready');
      return model;
    } catch (err) {
      logger.error(`detector: COCO-SSD load failed – ${err.message}`);
      model = null;
      modelLoading = null;
      throw err;
    }
  })();

  return modelLoading;
}

// ── Inference ────────────────────────────────────────────────────────────────

/**
 * Run detection on a single image file.
 *
 * @param {string} imagePath  - absolute path to the JPEG/PNG
 * @param {number} minScore   - minimum confidence threshold
 * @param {Array}  blobs      - blob descriptors from compare.js (fallback signal)
 * @returns {DetectionResult}
 */
async function detect(imagePath, minScore, blobs) {
  let detections  = [];
  let aiAvailable = false;

  try {
    const m = await loadModel();

    let tensor;
    if (useNativeDecoder) {
      // tfjs-node path: fast, handles EXIF rotation etc.
      const buf = fs.readFileSync(imagePath);
      tensor = tf.node.decodeImage(buf, 3);
    } else {
      // Pure-JS path: decode via sharp, create tensor manually.
      // Cap at 1280 px wide so the pure-JS runtime stays manageable.
      const sharp = require('sharp');
      const { data, info } = await sharp(imagePath)
        .resize({ width: 1280, withoutEnlargement: true })
        .flatten({ background: { r: 0, g: 0, b: 0 } })   // removes alpha
        .toColorspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      tensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, info.channels]);
    }

    const raw = await m.detect(tensor);
    tensor.dispose();

    detections = raw
      .filter((d) => d.score >= minScore)
      .map((d) => ({ class: d.class, score: d.score, bbox: d.bbox }));

    aiAvailable = true;
    logger.debug(
      `detector: ${detections.length} hit(s) – ` +
      (detections.map((d) => `${d.class} ${(d.score * 100).toFixed(0)}%`).join(', ') || 'none'),
    );
  } catch (err) {
    logger.warn(`detector: AI inference failed – ${err.message} (blob-only fallback)`);
  }

  return classify(detections, blobs, aiAvailable);
}

// ── Classification ───────────────────────────────────────────────────────────

/**
 * @typedef  {object} DetectionResult
 * @property {'PERSON'|'ANIMAL'|'VEHICLE'|'OBJECT'|'UNKNOWN'|'NONE'} category
 * @property {string}  label
 * @property {Array}   detections
 * @property {boolean} alert
 */
function classify(detections, blobs, aiAvailable) {
  const persons  = detections.filter((d) => PERSON_CLASSES.has(d.class));
  const animals  = detections.filter((d) => ANIMAL_CLASSES.has(d.class));
  const vehicles = detections.filter((d) => VEHICLE_CLASSES.has(d.class));
  const objects  = detections.filter(
    (d) => !PERSON_CLASSES.has(d.class) && !ANIMAL_CLASSES.has(d.class) && !VEHICLE_CLASSES.has(d.class),
  );

  if (persons.length > 0)  return { category: 'PERSON',  label: `Person detected (${persons.length})`,                   detections, alert: true };
  if (animals.length > 0)  return { category: 'ANIMAL',  label: `Animal: ${uniq(animals)}`,                              detections, alert: true };
  if (vehicles.length > 0) return { category: 'VEHICLE', label: `Vehicle: ${uniq(vehicles)}`,                            detections, alert: true };
  if (objects.length > 0)  return { category: 'OBJECT',  label: `Object: ${uniq(objects)}`,                              detections, alert: true };

  if (blobs && blobs.length > 0) {
    if (!aiAvailable) {
      return {
        category: 'UNKNOWN',
        label: `Unknown object (AI unavailable, ${blobs.length} significant change blob(s))`,
        detections: [],
        alert: true,
      };
    }
    // AI running but found nothing → shadow / reflection / wind
    return {
      category: 'NONE',
      label: 'Pixel change without identifiable object (likely shadow/reflection)',
      detections: [],
      alert: false,
    };
  }

  return { category: 'NONE', label: 'No significant object', detections: [], alert: false };
}

function uniq(detections) {
  return [...new Set(detections.map((d) => d.class))].join(', ');
}

// ── Annotation ───────────────────────────────────────────────────────────────

/**
 * Draw bounding boxes + labels on the image; return JPEG Buffer.
 * Falls back to the raw file bytes on any error.
 */
async function annotateImage(imagePath, detections) {
  const sharp = require('sharp');

  try {
    if (!detections || detections.length === 0) {
      return sharp(imagePath).jpeg({ quality: 85 }).toBuffer();
    }

    const { width: W, height: H } = await sharp(imagePath).metadata();

    const rects = detections.map((d) => {
      const [x, y, w, h] = d.bbox.map(Math.round);
      const label = `${d.class} ${Math.round(d.score * 100)}%`;
      const labelW = Math.min(w, label.length * 9 + 6);
      return `
        <rect x="${x}" y="${y}" width="${w}" height="${h}"
              fill="none" stroke="#ff3300" stroke-width="3" rx="2"/>
        <rect x="${x}" y="${Math.max(0, y - 24)}" width="${labelW}" height="22"
              fill="#ff3300" opacity="0.85"/>
        <text x="${x + 3}" y="${Math.max(16, y - 5)}"
              fill="white" font-size="16" font-family="monospace">${label}</text>`;
    }).join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rects}</svg>`;

    return sharp(imagePath)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (err) {
    logger.warn(`detector: annotateImage failed – ${err.message}`);
    return fs.readFileSync(imagePath);
  }
}

module.exports = { loadModel, detect, annotateImage };
