/**
 * Main Application Module
 * Wires together all components
 */

import { subscribeToSensor } from './firebase.js';
import { updateSensorCard, applyThresholdLabelsToUI } from './sensors.js';
import { initChart, addDataPoint } from './charts.js';
import { addWaterSample } from './water-aggregator.js';
import { initNotifications as initNotificationSystem } from './notifications.js';
import { getAuthContext, hasPermission } from './authz.js';
import { loadThresholdsFromServer } from './thresholds-config.js';

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
  let permissions = [];
  try {
    const context = await getAuthContext();
    permissions = context?.permissions || [];
  } catch (error) {
    console.error('Failed to load auth context:', error);
  }

  const canViewSensors = permissions.includes('view_sensors');

  // Update date/time immediately and set interval
  updateDateTime();
  setInterval(updateDateTime, 1000);

  // Initialize connection status
  initConnectionStatus();

  // Initialize notifications
  initNotificationSystem();

  // Initialize sensors (will start subscribing to Firebase)
  if (canViewSensors) {
    await loadThresholdsFromServer();
    applyThresholdLabelsToUI();
    initSensors();
  } else {
    const sensorsPanel = document.querySelector('.sensors-panel');
    if (sensorsPanel) {
      sensorsPanel.innerHTML = '<div class="panel-header"><h2>Water Quality Sensors</h2></div><div style="padding: 1.5rem; color: #ef4444;">You do not have permission to view sensors.</div>';
    }
  }

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
