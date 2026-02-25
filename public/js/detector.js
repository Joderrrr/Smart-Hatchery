/**
 * Client-Side YOLO Detector Module
 * Runs TensorFlow.js inference in the browser for real-time egg detection.
 * Replaces the server-side Python YOLO detection pipeline.
 *
 * Model: YOLOv5 exported to TF.js graph model
 *   Input:  [1, 320, 320, 3] float32 (0-1 normalized, RGB)
 *   Output: [1, 6300, 6] => [cx, cy, w, h, obj_conf, class_logit]
 *     - obj_conf is already sigmoided by the detect head
 *     - class_logit needs sigmoid applied
 *     - coordinates are in 320x320 input pixel space
 */

// ── Configuration ──────────────────────────────────────────────────────────
const MODEL_URL = '/web_model/model.json';
const MODEL_INPUT_SIZE = 320;
const CONF_THRESHOLD = 0.9;
const IOU_THRESHOLD = 0.45;
const MAX_DETECTIONS = 1000;
const CLASS_NAMES = ['Egg'];

// ── State ──────────────────────────────────────────────────────────────────
let model = null;
let videoStream = null;
let videoElement = null;
let canvasElement = null;
let canvasCtx = null;
let isDetecting = false;
let animationFrameId = null;
let fps = 0;
let frameCount = 0;
let fpsInterval = null;
let currentDetections = { count: 0, boxes: [], confidences: [], avgConfidence: 0 };

// Debug state
let _debugFrames = 0;
let _lastMaxConf = 0;

// Camera devices
let videoDevices = [];
let selectedDeviceId = null;

// ── Model Loading ──────────────────────────────────────────────────────────

async function loadModel() {
  if (model) return model;
  console.log('[Detector] Loading TensorFlow.js YOLO model...');

  try {
    model = await tf.loadGraphModel(MODEL_URL);
    console.log('[Detector] Model loaded successfully.');
    console.log('[Detector] Model inputs:', model.inputNodes);
    console.log('[Detector] Model outputs:', model.outputNodes);

    // Warm up with a dummy tensor
    const dummy = tf.zeros([1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 3]);
    let warmup = model.predict(dummy);

    // Handle if predict returns array (some TF.js models do this)
    if (Array.isArray(warmup)) {
      console.log('[Detector] model.predict() returns ARRAY of', warmup.length, 'tensors');
      console.log('[Detector] Warmup shapes:', warmup.map(t => t.shape));
      warmup.forEach(t => t.dispose());
    } else {
      console.log('[Detector] model.predict() returns single tensor, shape:', warmup.shape);
      warmup.dispose();
    }
    dummy.dispose();
    console.log('[Detector] Model warmup complete.');

    return model;
  } catch (err) {
    console.error('[Detector] Failed to load model:', err);
    throw err;
  }
}

// ── Camera Access ──────────────────────────────────────────────────────────

async function enumerateCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  videoDevices = devices.filter(d => d.kind === 'videoinput');

  const select = document.getElementById('camera-select');
  if (!select) return;

  // Clear existing options (keep placeholder)
  select.innerHTML = '<option value="">-- Select Camera --</option>';

  videoDevices.forEach((device, idx) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Camera ${idx + 1}`;
    select.appendChild(option);
  });

  select.disabled = false;

  // Auto-select first device
  if (videoDevices.length > 0) {
    select.value = videoDevices[0].deviceId;
    selectedDeviceId = videoDevices[0].deviceId;
    updateSelectedCameraName();
  }

  // Listen for selection changes
  select.addEventListener('change', async () => {
    selectedDeviceId = select.value;
    updateSelectedCameraName();
    if (isDetecting && selectedDeviceId) {
      await switchCamera(selectedDeviceId);
    }
  });
}

function updateSelectedCameraName() {
  const nameEl = document.getElementById('selected-camera-name');
  if (!nameEl) return;
  const device = videoDevices.find(d => d.deviceId === selectedDeviceId);
  nameEl.textContent = device ? device.label : '';
}

async function startCamera(deviceId) {
  // Stop existing stream first
  stopCamera();

  const constraints = {
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  };

  videoStream = await navigator.mediaDevices.getUserMedia(constraints);
  videoElement = document.getElementById('detection-video');
  if (videoElement) {
    videoElement.srcObject = videoStream;
    await videoElement.play();
    console.log(`[Detector] Camera started: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
  }
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
}

async function switchCamera(deviceId) {
  await startCamera(deviceId);
}

// ── Preprocessing ──────────────────────────────────────────────────────────

/**
 * Preprocess a video frame for YOLO inference.
 * Letterbox resize to MODEL_INPUT_SIZE x MODEL_INPUT_SIZE (preserving aspect ratio),
 * normalize to 0-1, and return as a [1, H, W, 3] float32 tensor.
 *
 * Also returns the letterbox parameters so we can unscale boxes later.
 */
function preprocessFrame(video) {
  const vidW = video.videoWidth;
  const vidH = video.videoHeight;

  // Compute letterbox scale and padding
  const scale = Math.min(MODEL_INPUT_SIZE / vidW, MODEL_INPUT_SIZE / vidH);
  const newW = Math.round(vidW * scale);
  const newH = Math.round(vidH * scale);
  const padX = (MODEL_INPUT_SIZE - newW) / 2;
  const padY = (MODEL_INPUT_SIZE - newH) / 2;

  const inputTensor = tf.tidy(() => {
    // Grab frame from video as a [H, W, 3] int32 tensor
    let frame = tf.browser.fromPixels(video);

    // Resize to letterbox inner size
    frame = tf.image.resizeBilinear(frame, [newH, newW]);

    // Normalize to 0-1
    frame = frame.toFloat().div(255.0);

    // Pad to MODEL_INPUT_SIZE x MODEL_INPUT_SIZE
    const padTop = Math.floor(padY);
    const padBottom = MODEL_INPUT_SIZE - newH - padTop;
    const padLeft = Math.floor(padX);
    const padRight = MODEL_INPUT_SIZE - newW - padLeft;

    frame = frame.pad([
      [padTop, padBottom],
      [padLeft, padRight],
      [0, 0],
    ], 0.5); // pad with gray (0.5) matching YOLOv5 letterbox default

    // Add batch dimension -> [1, 320, 320, 3]
    return frame.expandDims(0);
  });

  return {
    tensor: inputTensor,
    letterbox: { scale, padX, padY, origW: vidW, origH: vidH },
  };
}

// ── Postprocessing ─────────────────────────────────────────────────────────

/**
 * Decode raw YOLO output, filter by confidence, apply NMS, and scale boxes
 * back to the original video resolution.
 *
 * rawOutput shape: [1, 6300, 6]
 *   columns: [cx, cy, w, h, obj_conf, class_logit]
 */
async function postprocess(rawOutput, letterbox) {
  const data = await rawOutput.data(); // Float32Array of length 1*6300*6 = 37800
  const numDetections = rawOutput.shape[1]; // 6300
  const numCols = rawOutput.shape[2]; // 6

  const { scale, padX, padY } = letterbox;

  // Debug: track max confidence for diagnostics
  let maxObjConf = 0;
  let maxClassConf = 0;
  let maxCombined = 0;

  // Some TF.js YOLO exports output bbox coordinates normalized to 0..1 instead of
  // absolute pixels in MODEL_INPUT_SIZE space. We'll detect that once per frame
  // and scale accordingly.
  let coordsAreNormalized = false;
  {
    let maxCoord = 0;
    const probeCount = Math.min(numDetections, 200);
    for (let i = 0; i < probeCount; i++) {
      const offset = i * numCols;
      const cx = Math.abs(data[offset + 0]);
      const cy = Math.abs(data[offset + 1]);
      const w = Math.abs(data[offset + 2]);
      const h = Math.abs(data[offset + 3]);
      if (cx > maxCoord) maxCoord = cx;
      if (cy > maxCoord) maxCoord = cy;
      if (w > maxCoord) maxCoord = w;
      if (h > maxCoord) maxCoord = h;
    }
    coordsAreNormalized = maxCoord <= 1.5;
  }

  const boxes = [];
  const scores = [];

  for (let i = 0; i < numDetections; i++) {
    const offset = i * numCols;
    let cx = data[offset + 0];
    let cy = data[offset + 1];
    let w = data[offset + 2];
    let h = data[offset + 3];
    const objConf = data[offset + 4]; // already sigmoided
    const classLogit = data[offset + 5]; // needs sigmoid

    if (coordsAreNormalized) {
      cx *= MODEL_INPUT_SIZE;
      cy *= MODEL_INPUT_SIZE;
      w *= MODEL_INPUT_SIZE;
      h *= MODEL_INPUT_SIZE;
    }

    // Apply sigmoid to class logit
    const classConf = 1 / (1 + Math.exp(-classLogit));

    // Final confidence = obj_conf * class_conf
    const confidence = objConf * classConf;

    // Track maximums for debug
    if (objConf > maxObjConf) maxObjConf = objConf;
    if (classConf > maxClassConf) maxClassConf = classConf;
    if (confidence > maxCombined) maxCombined = confidence;

    if (confidence < CONF_THRESHOLD) continue;

    // Convert from center format to corner format (in 320x320 space)
    const x1_raw = cx - w / 2;
    const y1_raw = cy - h / 2;
    const x2_raw = cx + w / 2;
    const y2_raw = cy + h / 2;

    // Unpad and unscale to original video coordinates
    const x1 = (x1_raw - padX) / scale;
    const y1 = (y1_raw - padY) / scale;
    const x2 = (x2_raw - padX) / scale;
    const y2 = (y2_raw - padY) / scale;

    boxes.push([x1, y1, x2, y2]);
    scores.push(confidence);
  }

  // Store for debug display
  _lastMaxConf = maxCombined;

  // Debug logging for first 10 frames then every 60 frames
  if (_debugFrames < 10 || _debugFrames % 60 === 0) {
    console.log(`[Detector] Frame ${_debugFrames} postprocess: ` +
      `maxObj=${maxObjConf.toFixed(4)}, maxCls=${maxClassConf.toFixed(4)}, ` +
      `maxCombined=${maxCombined.toFixed(4)}, threshold=${CONF_THRESHOLD}, ` +
      `passed=${boxes.length}/${numDetections}`);
  }

  if (boxes.length === 0) {
    return { boxes: [], confidences: [], count: 0, avgConfidence: 0 };
  }

  // Apply NMS using TF.js built-in
  const boxesTensor = tf.tensor2d(boxes);
  const scoresTensor = tf.tensor1d(scores);

  // Convert [x1,y1,x2,y2] to [y1,x1,y2,x2] for tf.image.nonMaxSuppressionAsync
  const nmsBoxes = tf.concat([
    boxesTensor.slice([0, 1], [-1, 1]), // y1
    boxesTensor.slice([0, 0], [-1, 1]), // x1
    boxesTensor.slice([0, 3], [-1, 1]), // y2
    boxesTensor.slice([0, 2], [-1, 1]), // x2
  ], 1);

  const nmsIndices = await tf.image.nonMaxSuppressionAsync(
    nmsBoxes, scoresTensor, MAX_DETECTIONS, IOU_THRESHOLD, CONF_THRESHOLD
  );

  const selectedIndices = await nmsIndices.data();

  // Clean up tensors
  boxesTensor.dispose();
  scoresTensor.dispose();
  nmsBoxes.dispose();
  nmsIndices.dispose();

  const finalBoxes = [];
  const finalConfs = [];

  for (const idx of selectedIndices) {
    finalBoxes.push(boxes[idx]);
    finalConfs.push(scores[idx]);
  }

  const avgConf = finalConfs.length > 0
    ? finalConfs.reduce((a, b) => a + b, 0) / finalConfs.length
    : 0;

  if (_debugFrames < 10 || _debugFrames % 60 === 0) {
    console.log(`[Detector] Frame ${_debugFrames} NMS: ${boxes.length} -> ${finalBoxes.length} detections`);
  }

  return {
    boxes: finalBoxes,
    confidences: finalConfs,
    count: finalBoxes.length,
    avgConfidence: avgConf,
  };
}

// ── Drawing ────────────────────────────────────────────────────────────────

/**
 * Compute where the video actually renders inside the container when
 * object-fit: contain is used. Returns display dimensions and offsets
 * so the canvas drawing aligns precisely with the video content.
 */
function getVideoDisplayMetrics() {
  const container = canvasElement.parentElement;
  const containerW = container.clientWidth;
  const containerH = container.clientHeight;
  const vidW = videoElement.videoWidth || 640;
  const vidH = videoElement.videoHeight || 480;

  const videoAspect = vidW / vidH;
  const containerAspect = containerW / containerH;

  let displayW, displayH, offsetX, offsetY;

  if (videoAspect > containerAspect) {
    // Video is wider than container — letterbox top/bottom
    displayW = containerW;
    displayH = containerW / videoAspect;
    offsetX = 0;
    offsetY = (containerH - displayH) / 2;
  } else {
    // Video is taller than container — pillarbox left/right
    displayH = containerH;
    displayW = containerH * videoAspect;
    offsetX = (containerW - displayW) / 2;
    offsetY = 0;
  }

  return { displayW, displayH, offsetX, offsetY, containerW, containerH, vidW, vidH };
}

function drawDetections(detections) {
  if (!canvasCtx || !canvasElement || !videoElement) return;

  const m = getVideoDisplayMetrics();

  // Validate canvas dimensions
  if (m.containerW <= 0 || m.containerH <= 0) return;

  // Set canvas internal resolution to match the container pixel size
  canvasElement.width = m.containerW;
  canvasElement.height = m.containerH;

  canvasCtx.clearRect(0, 0, m.containerW, m.containerH);

  // Scale factors from native video coords to displayed video area
  const scaleX = m.displayW / m.vidW;
  const scaleY = m.displayH / m.vidH;

  const { boxes, confidences, count, avgConfidence } = detections;

  // Draw bounding boxes
  for (let i = 0; i < boxes.length; i++) {
    const [x1, y1, x2, y2] = boxes[i];
    const conf = confidences[i];

    // Map from native video coords to canvas display coords
    const dx1 = Math.max(m.offsetX, Math.round(x1 * scaleX + m.offsetX));
    const dy1 = Math.max(m.offsetY, Math.round(y1 * scaleY + m.offsetY));
    const dx2 = Math.min(m.offsetX + m.displayW, Math.round(x2 * scaleX + m.offsetX));
    const dy2 = Math.min(m.offsetY + m.displayH, Math.round(y2 * scaleY + m.offsetY));

    const bw = dx2 - dx1;
    const bh = dy2 - dy1;

    if (bw <= 0 || bh <= 0) continue;

    // Green bounding box
    canvasCtx.strokeStyle = '#00ff00';
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeRect(dx1, dy1, bw, bh);

    // Label background
    const label = `Egg ${(conf * 100).toFixed(0)}%`;
    canvasCtx.font = 'bold 13px Arial';
    const textMetrics = canvasCtx.measureText(label);
    const textH = 16;
    const labelY = dy1 > textH + m.offsetY ? dy1 - 2 : dy1 + textH + 2;
    const labelBgY = labelY - textH;

    canvasCtx.fillStyle = '#00ff00';
    canvasCtx.fillRect(dx1, labelBgY, textMetrics.width + 6, textH + 2);

    canvasCtx.fillStyle = '#000000';
    canvasCtx.fillText(label, dx1 + 3, labelY - 2);

    if (_debugFrames < 5) {
      console.log(`[Detector] Drew box ${i}: (${dx1},${dy1})-(${dx2},${dy2}) conf=${conf.toFixed(3)}`);
    }
  }

  // Summary text at top-left of the displayed video area
  const summaryX = m.offsetX + 8;
  const summaryY = m.offsetY + 8;
  const summary = `Eggs: ${count} | Conf: ${avgConfidence.toFixed(2)} | MaxConf: ${_lastMaxConf.toFixed(3)}`;
  canvasCtx.font = 'bold 14px Arial';
  const summaryMetrics = canvasCtx.measureText(summary);

  canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  canvasCtx.fillRect(summaryX, summaryY, summaryMetrics.width + 16, 28);

  canvasCtx.fillStyle = '#00ff00';
  canvasCtx.fillText(summary, summaryX + 8, summaryY + 20);

  // "Uncertain object" warning if no detections
  if (count === 0) {
    const warn = _lastMaxConf > 0.1
      ? `Uncertain (best: ${(_lastMaxConf * 100).toFixed(0)}%)`
      : 'No eggs detected';
    canvasCtx.font = 'bold 20px Arial';
    const warnMetrics = canvasCtx.measureText(warn);
    const wx = m.offsetX + (m.displayW - warnMetrics.width) / 2;
    const wy = m.offsetY + m.displayH / 2;

    canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    canvasCtx.fillRect(wx - 10, wy - 22, warnMetrics.width + 20, 34);

    canvasCtx.fillStyle = '#ffffff';
    canvasCtx.fillText(warn, wx, wy);
  }
}

// ── Detection Loop ─────────────────────────────────────────────────────────

async function detectionLoop() {
  if (!isDetecting || !model || !videoElement || videoElement.readyState < 2) {
    if (isDetecting) {
      if (_debugFrames < 3) {
        console.log(`[Detector] Waiting for video readyState: ${videoElement ? videoElement.readyState : 'no video'}`);
      }
      animationFrameId = requestAnimationFrame(detectionLoop);
    }
    return;
  }

  try {
    // Preprocess
    const { tensor, letterbox } = preprocessFrame(videoElement);

    if (_debugFrames < 3) {
      console.log(`[Detector] Frame ${_debugFrames} - Input tensor shape:`, tensor.shape);
      console.log(`[Detector] Frame ${_debugFrames} - Letterbox:`, letterbox);
    }

    // Run inference
    let rawOutput = model.predict(tensor);

    // Handle if predict returns array (some TF.js graph models do this)
    if (Array.isArray(rawOutput)) {
      if (_debugFrames < 3) {
        console.log(`[Detector] predict() returned array of ${rawOutput.length} tensors`);
        rawOutput.forEach((t, i) => console.log(`  [${i}] shape:`, t.shape));
      }
      const first = rawOutput[0];
      for (let i = 1; i < rawOutput.length; i++) rawOutput[i].dispose();
      rawOutput = first;
    }

    if (_debugFrames < 3) {
      console.log(`[Detector] Frame ${_debugFrames} - Output shape:`, rawOutput.shape, 'dtype:', rawOutput.dtype);
      // Print sample of first 3 detections to verify format
      const sampleData = await rawOutput.slice([0, 0, 0], [1, 3, rawOutput.shape[2]]).data();
      console.log(`[Detector] First 3 detections (raw):`);
      for (let i = 0; i < 3; i++) {
        const cols = rawOutput.shape[2];
        const row = Array.from(sampleData.slice(i * cols, (i + 1) * cols)).map(v => v.toFixed(4));
        console.log(`  [${i}] cx=${row[0]}, cy=${row[1]}, w=${row[2]}, h=${row[3]}, obj=${row[4]}, cls=${row[5]}`);
      }
    }

    // Postprocess (decode, NMS, scale)
    const detections = await postprocess(rawOutput, letterbox);

    // Dispose tensors
    tensor.dispose();
    rawOutput.dispose();

    // Store current detections
    currentDetections = detections;

    // Draw on canvas
    drawDetections(detections);

    // Update UI
    updateDetectionUI(detections);

    // Broadcast to tank-manager (replaces Flask /egg_count polling)
    if (typeof window.onDetectionResult === 'function') {
      window.onDetectionResult(detections.count, Date.now());
    }

    // Track FPS
    frameCount++;
    _debugFrames++;

  } catch (err) {
    console.error('[Detector] Detection loop error:', err);
    console.error('[Detector] Stack trace:', err.stack);
    _debugFrames++; // Avoid getting stuck on debug logging
  }

  // Schedule next frame
  if (isDetecting) {
    animationFrameId = requestAnimationFrame(detectionLoop);
  }
}

function updateDetectionUI(detections) {
  const eggCountEl = document.getElementById('overlay-egg-count');
  const avgConfEl = document.getElementById('overlay-avg-conf');
  const fpsEl = document.getElementById('overlay-fps');
  const currentCountEl = document.getElementById('current-egg-count');

  if (eggCountEl) eggCountEl.textContent = `Eggs: ${detections.count}`;
  if (avgConfEl) avgConfEl.textContent = `Conf: ${detections.avgConfidence.toFixed(2)}`;
  if (fpsEl) fpsEl.textContent = `FPS: ${fps}`;
  if (currentCountEl) currentCountEl.textContent = detections.count;
}

function startFpsCounter() {
  frameCount = 0;
  fpsInterval = setInterval(() => {
    fps = frameCount;
    frameCount = 0;
  }, 1000);
}

function stopFpsCounter() {
  if (fpsInterval) {
    clearInterval(fpsInterval);
    fpsInterval = null;
  }
}

// ── Video Timestamp ────────────────────────────────────────────────────────

let timestampInterval = null;

function startTimestamp() {
  const el = document.getElementById('primary-timestamp');
  if (!el) return;

  const update = () => {
    const now = new Date();
    el.textContent = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;
  };
  update();
  timestampInterval = setInterval(update, 1000);
}

// ── Public Controls ────────────────────────────────────────────────────────

/**
 * Start Detection: request camera, enumerate devices, load model, begin loop.
 */
async function startDetection() {
  const startBtn = document.getElementById('btn-start-detection');
  const stopBtn = document.getElementById('btn-stop-detection');
  const continueBtn = document.getElementById('btn-continue-detection');

  try {
    if (startBtn) startBtn.disabled = true;

    // Request camera permission (triggers browser prompt)
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    tempStream.getTracks().forEach(t => t.stop());

    // Enumerate all video devices now that we have permission
    await enumerateCameras();

    if (!selectedDeviceId && videoDevices.length > 0) {
      selectedDeviceId = videoDevices[0].deviceId;
    }

    // Start camera with selected device
    await startCamera(selectedDeviceId);

    // Initialize canvas
    canvasElement = document.getElementById('detection-canvas');
    if (canvasElement) {
      canvasCtx = canvasElement.getContext('2d');
      console.log('[Detector] Canvas initialized:', canvasElement.parentElement.clientWidth, 'x', canvasElement.parentElement.clientHeight);
    } else {
      console.error('[Detector] Canvas element not found!');
    }

    // Load model
    await loadModel();

    // Reset debug counter
    _debugFrames = 0;

    // Start detection
    isDetecting = true;

    // Show UI elements
    const yoloBadge = document.getElementById('yolo-badge');
    const liveIndicator = document.getElementById('live-indicator');
    const statsOverlay = document.getElementById('detection-stats-overlay');
    if (yoloBadge) yoloBadge.style.display = '';
    if (liveIndicator) liveIndicator.style.display = '';
    if (statsOverlay) statsOverlay.style.display = '';

    startFpsCounter();
    startTimestamp();

    // Begin detection loop
    animationFrameId = requestAnimationFrame(detectionLoop);

    // Update buttons
    if (stopBtn) stopBtn.disabled = false;
    if (continueBtn) continueBtn.disabled = true;
    if (startBtn) startBtn.disabled = true;

    console.log('[Detector] Detection started.');
  } catch (err) {
    console.error('[Detector] Failed to start detection:', err);
    if (startBtn) startBtn.disabled = false;

    if (err.name === 'NotAllowedError') {
      alert('Camera access was denied. Please allow camera access to use detection.');
    } else if (err.name === 'NotFoundError') {
      alert('No camera device found.');
    } else {
      alert('Failed to start detection: ' + err.message);
    }
  }
}

/**
 * Stop Detection: stop camera, stop loop, preserve results on canvas.
 */
function stopDetection() {
  isDetecting = false;

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  stopCamera();
  stopFpsCounter();

  // Hide live indicator but keep canvas overlay visible
  const liveIndicator = document.getElementById('live-indicator');
  if (liveIndicator) liveIndicator.style.display = 'none';

  // Update buttons
  const startBtn = document.getElementById('btn-start-detection');
  const stopBtn = document.getElementById('btn-stop-detection');
  const continueBtn = document.getElementById('btn-continue-detection');
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;
  if (continueBtn) continueBtn.disabled = false;

  console.log('[Detector] Detection stopped. Results preserved.');
}

/**
 * Continue Detection: resume camera and detection loop without page refresh.
 */
async function continueDetection() {
  const startBtn = document.getElementById('btn-start-detection');
  const stopBtn = document.getElementById('btn-stop-detection');
  const continueBtn = document.getElementById('btn-continue-detection');

  try {
    if (continueBtn) continueBtn.disabled = true;

    // Re-start camera with same device
    await startCamera(selectedDeviceId);

    // Reset debug counter for fresh logs
    _debugFrames = 0;

    // Resume detection
    isDetecting = true;
    startFpsCounter();

    // Show live indicator
    const liveIndicator = document.getElementById('live-indicator');
    if (liveIndicator) liveIndicator.style.display = '';

    animationFrameId = requestAnimationFrame(detectionLoop);

    if (stopBtn) stopBtn.disabled = false;
    if (startBtn) startBtn.disabled = true;

    console.log('[Detector] Detection resumed.');
  } catch (err) {
    console.error('[Detector] Failed to continue detection:', err);
    if (continueBtn) continueBtn.disabled = false;
    alert('Failed to resume detection: ' + err.message);
  }
}

// ── Exports ────────────────────────────────────────────────────────────────

// Expose controls to window for onclick handlers
window.detectorStartDetection = startDetection;
window.detectorStopDetection = stopDetection;
window.detectorContinueDetection = continueDetection;

// Export for module usage
export {
  startDetection,
  stopDetection,
  continueDetection,
  currentDetections,
};
