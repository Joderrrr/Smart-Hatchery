/**
 * Main Application Module
 * Wires together all components
 */

import { subscribeToSensor } from './firebase.js';
import { updateSensorCard } from './sensors.js';
import { initChart, addDataPoint } from './charts.js';
import { addWaterSample } from './water-aggregator.js';
import { initNotifications as initNotificationSystem } from './notifications.js';

/**
 * Update date and time display
 */
function updateDateTime() {
  const now = new Date();

  const dateElement = document.getElementById('current-date');
  const timeElement = document.getElementById('current-time');

  if (dateElement) {
    dateElement.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  if (timeElement) {
    timeElement.textContent = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  }
}

/**
 * Initialize all sensor subscriptions
 */
function initSensors() {
  const sensorTypes = ['temperature', 'turbidity', 'tds'];

  sensorTypes.forEach(sensorType => {
    subscribeToSensor(sensorType, (value) => {
      if (value !== null) {
        // Update sensor card
        updateSensorCard(sensorType, value);
        // Add to history
        addDataPoint(sensorType, value);
        // Aggregate 5-minute water readings for reports
        addWaterSample(sensorType, value);
      }
    });
  });
}

/**
 * Initialize all charts
 */
function initCharts() {
  const sensorTypes = ['temperature', 'turbidity', 'tds'];

  sensorTypes.forEach(sensorType => {
    initChart(sensorType);
  });
}

/**
 * Initialize connection status monitoring
 */
function initConnectionStatus() {
  const statusElement = document.getElementById('connection-status');
  if (!statusElement) return;
}

/**
 * Initialize application
 */
async function init() {
  // Update date/time immediately and set interval
  updateDateTime();
  setInterval(updateDateTime, 1000);

  // Initialize connection status
  initConnectionStatus();

  // Initialize notifications
  initNotificationSystem();

  // Initialize charts
  initCharts();

  // Initialize sensors (will start subscribing to Firebase)
  initSensors();

  // Detector is initialized on-demand via Start Detection button (detector.js)
  // Tank manager initializes itself via DOMContentLoaded (tank-manager.js)

  console.log('Tilapia Hatchery Monitoring System initialized');
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  // detector.js handles its own cleanup
});
