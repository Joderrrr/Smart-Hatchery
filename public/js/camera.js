/**
 * Camera Module
 * Camera handling is now managed by detector.js (client-side YOLO detection).
 * This module is retained as a stub for backward compatibility.
 */

/**
 * Initialize primary camera
 * DISABLED: Camera is now managed by detector.js
 */
export async function initPrimaryCamera() {
  console.log('Camera module disabled - using client-side detector');
  return;
}

/**
 * Stop all camera streams
 * DISABLED: Camera lifecycle is managed by detector.js
 */
export function stopAllCameras() {
  // No-op: detector.js handles camera start/stop
}
