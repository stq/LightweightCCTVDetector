'use strict';

/**
 * Image comparison module.
 *
 * Strategy:
 *   1. Resize both images to a small working resolution and convert to grayscale.
 *   2. Compute per-pixel absolute difference; pixels above pixelDiffThreshold
 *      are marked "changed".
 *   3. Run connected-components (BFS) on the changed-pixel mask to find blobs.
 *   4. Discard blobs that are too small or too diffuse (shadows/grass show up as
 *      large but very sparse regions; real objects form compact blobs).
 *   5. Return a result indicating whether a significant change was detected,
 *      along with blob metadata for downstream AI classification.
 */

const sharp = require('sharp');
const logger = require('./logger');

/**
 * Compare newImagePath against safeImagePath.
 *
 * @param {string} newImagePath
 * @param {string} safeImagePath
 * @param {object} cfg  - detection config from config.json
 * @returns {{ significant: boolean, changedRatio: number, blobs: Blob[], imageInfo: object }}
 */
async function compareImages(newImagePath, safeImagePath, cfg) {
  const W = cfg.compareWidth;
  const H = cfg.compareHeight;
  const threshold = cfg.pixelDiffThreshold;

  let newBuf, safeBuf, meta;

  try {
    const [n, s] = await Promise.all([
      sharp(newImagePath)
        .resize(W, H, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      sharp(safeImagePath)
        .resize(W, H, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ]);
    newBuf = n.data;
    safeBuf = s.data;
    meta = n.info;
  } catch (err) {
    logger.error(`compare: failed to load images – ${err.message}`);
    throw err;
  }

  const total = meta.width * meta.height;
  const diffMask = new Uint8Array(total);
  let changedCount = 0;

  for (let i = 0; i < total; i++) {
    if (Math.abs(newBuf[i] - safeBuf[i]) > threshold) {
      diffMask[i] = 1;
      changedCount++;
    }
  }

  const changedRatio = changedCount / total;
  logger.debug(`compare: changedRatio=${(changedRatio * 100).toFixed(2)}%`);

  if (changedRatio < cfg.minChangedRatio) {
    return { significant: false, changedRatio, blobs: [], imageInfo: meta };
  }

  const blobs = findBlobs(diffMask, meta.width, meta.height);

  // Normalise blob coordinates back to full-image fractions so the AI module
  // can map them to original pixel coords regardless of image resolution.
  const scaleX = 1 / meta.width;
  const scaleY = 1 / meta.height;

  const significant = blobs.filter(
    (b) => b.area >= cfg.minBlobArea && b.density >= cfg.minBlobDensity,
  );

  const mapped = significant.map((b) => ({
    area: b.area,
    density: b.density,
    // bbox in 0..1 fractions
    bboxRel: {
      x: b.bbox.x * scaleX,
      y: b.bbox.y * scaleY,
      w: b.bbox.w * scaleX,
      h: b.bbox.h * scaleY,
    },
    // bbox in compare-resolution pixels (useful for debug logs)
    bboxPx: b.bbox,
  }));

  logger.debug(
    `compare: found ${significant.length} significant blob(s) out of ${blobs.length} total`,
  );

  return {
    significant: mapped.length > 0,
    changedRatio,
    blobs: mapped,
    imageInfo: meta,
  };
}

/**
 * Connected-components labelling using BFS.
 * Returns an array of blob descriptors sorted largest-first.
 *
 * @param {Uint8Array} binary  - flat mask (1 = changed, 0 = background), row-major
 * @param {number} W
 * @param {number} H
 * @returns {Array<{ area: number, bbox: object, density: number }>}
 */
function findBlobs(binary, W, H) {
  const total = W * H;
  const visited = new Uint8Array(total);
  const blobs = [];

  for (let startIdx = 0; startIdx < total; startIdx++) {
    if (!binary[startIdx] || visited[startIdx]) continue;

    // BFS with head pointer – O(n) dequeue
    const queue = [startIdx];
    visited[startIdx] = 1;
    let head = 0;

    let area = 0;
    let minX = W, maxX = 0, minY = H, maxY = 0;

    while (head < queue.length) {
      const idx = queue[head++];
      area++;

      const x = idx % W;
      const y = (idx - x) / W;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // 4-connected neighbours
      if (x > 0)     pushIfValid(idx - 1,     binary, visited, queue);
      if (x < W - 1) pushIfValid(idx + 1,     binary, visited, queue);
      if (y > 0)     pushIfValid(idx - W,     binary, visited, queue);
      if (y < H - 1) pushIfValid(idx + W,     binary, visited, queue);
    }

    const bboxW = maxX - minX + 1;
    const bboxH = maxY - minY + 1;
    const bboxArea = bboxW * bboxH;

    blobs.push({
      area,
      bbox: { x: minX, y: minY, w: bboxW, h: bboxH },
      density: area / bboxArea,
    });
  }

  return blobs.sort((a, b) => b.area - a.area);
}

function pushIfValid(idx, binary, visited, queue) {
  if (!visited[idx] && binary[idx]) {
    visited[idx] = 1;
    queue.push(idx);
  }
}

module.exports = { compareImages };
