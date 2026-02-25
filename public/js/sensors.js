/**
 * Sensor Cards Module
 * Handles display and status logic for sensor cards
 */

import { checkSensorThresholds } from './notifications.js';

// Status thresholds
const THRESHOLDS = {
  temperature: {
    optimalMin: 20,
    optimalMax: 32,
    unit: '°C',
  },
  turbidity: {
    optimalMax: 100,
    unit: 'NTU',
  },
  tds: {
    optimalMin: 0,
    optimalMax: 1000,
    unit: 'ppm',
  },
};

/**
 * Update sensor card display
 */
export function updateSensorCard(sensorType, value) {
  console.log(`updateSensorCard called for ${sensorType} with value:`, value, typeof value);
  
  // Convert to number if needed
  const numValue = typeof value === 'number' ? value : parseFloat(value);
  
  if (value === null || value === undefined || isNaN(numValue) || !isFinite(numValue)) {
    console.warn(`updateSensorCard: Invalid value for ${sensorType}:`, value);
    return;
  }

  const threshold = THRESHOLDS[sensorType];
  const valueElement = document.getElementById(`${sensorType}-value`);
  const statusElement = document.getElementById(`${sensorType}-status`);
  const fillElement = document.getElementById(`${sensorType}-fill`);
  const timestampElement = document.getElementById(`${sensorType}-timestamp`);
  
  if (!valueElement) {
    console.error(`Sensor card element not found for ${sensorType}`);
    return;
  }

  // Use the numeric value
  const displayValue = numValue;

  // Update value
  valueElement.textContent = `${displayValue.toFixed(2)} ${threshold.unit}`;
  console.log(`Updated ${sensorType} display to:`, valueElement.textContent);

  // Calculate status and range fill
  let status = 'warning';
  let statusClass = 'warning';
  let fillPercentage = 0;

  if (sensorType === 'temperature') {
    fillPercentage = ((displayValue - threshold.optimalMin) / (threshold.optimalMax - threshold.optimalMin)) * 100;
    fillPercentage = Math.max(0, Math.min(100, fillPercentage));
    
    if (displayValue >= threshold.optimalMin && displayValue <= threshold.optimalMax) {
      status = 'Optimal';
      statusClass = 'optimal';
    } else if (displayValue < threshold.optimalMin) {
      status = 'Low';
      statusClass = 'critical';
    } else {
      status = 'High';
      statusClass = 'critical';
    }
  } else if (sensorType === 'turbidity') {
    fillPercentage = (displayValue / threshold.optimalMax) * 100;
    fillPercentage = Math.max(0, Math.min(100, fillPercentage));
    
    if (displayValue <= threshold.optimalMax) {
      status = 'Optimal';
      statusClass = 'optimal';
    } else {
      status = 'High';
      statusClass = 'critical';
    }
  } else if (sensorType === 'tds') {
    fillPercentage = (displayValue / threshold.optimalMax) * 100;
    fillPercentage = Math.max(0, Math.min(100, fillPercentage));
    
    if (displayValue === 0 || displayValue < threshold.optimalMin) {
      status = 'Low';
      statusClass = 'critical';
    } else if (displayValue <= threshold.optimalMax) {
      status = 'Optimal';
      statusClass = 'optimal';
    } else {
      status = 'High';
      statusClass = 'critical';
    }
  }

  // Check thresholds and trigger notifications
  checkSensorThresholds(sensorType, displayValue);

  // Update status badge
  if (statusElement) {
    statusElement.textContent = status;
    statusElement.className = `status-badge ${statusClass}`;
  }

  // Update range fill
  if (fillElement) {
    fillElement.style.width = `${fillPercentage}%`;
  }

  // Update timestamp
  if (timestampElement) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: true 
    });
    timestampElement.textContent = `Updated: ${timeStr}`;
  }
}

