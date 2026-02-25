// Tank Management and Egg Count Averaging System
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { addEggDetectionNotification } from './notifications.js';

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDbn0lS8dyfa5_HLG_ePuDfSlt5B_4BLbk",
  authDomain: "test-29995-default-rtdb.firebaseapp.com",
  projectId: "test-29995",
  storageBucket: "test-29995.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef",
  databaseURL: "https://test-29995-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Tank Data Structure
const tankData = {
  TankA: {
    samples: [],
    lastAverage: 0,
    lastComputedAt: null,
    averagingInterval: null,
    lastNotificationTime: null
  },
  TankB: {
    samples: [],
    lastAverage: 0,
    lastComputedAt: null,
    averagingInterval: null,
    lastNotificationTime: null
  }
};

// Active Tank
let activeTank = 'TankA';

// Global variable for current tank tracking
window.currentTank = activeTank;

const REPORTS_EGG_SUMMARY_URL = '/api/reports/egg-detections';

// Initialize tank system
function initializeTankSystem() {
  console.log('Initializing tank system...');

  // Set default active tank
  activeTank = 'TankA';

  // Register callback from client-side detector (replaces Flask polling)
  window.onDetectionResult = function(eggCount, timestamp) {
    addSampleToTank(activeTank, eggCount, timestamp);
  };

  console.log('Tank system initialized (using client-side detection)');
}

// Tank selection
function selectTank(tankId) {
  if (!tankData[tankId]) {
    console.error('Invalid tank ID:', tankId);
    return;
  }

  // Update active tank
  activeTank = tankId;
  window.currentTank = tankId;

  console.log(`Switched to ${tankId}`);

  // Update UI - check if elements exist first
  const tankButtons = document.querySelectorAll('.tank-btn');
  if (tankButtons.length > 0) {
    tankButtons.forEach(btn => {
      btn.classList.remove('active');
    });

    const activeBtn = document.getElementById(`tank${tankId.slice(-1)}-btn`);
    if (activeBtn) {
      activeBtn.classList.add('active');
    }
  }

  // Update display with last known average
  updateInfoPanel();
}

// Add sample to tank buffer (called by detector.js via window.onDetectionResult)
function addSampleToTank(tankId, eggCount, timestamp) {
  const tank = tankData[tankId];

  // Check for duplicate timestamps (prevent double-counting)
  if (tank.samples.length > 0) {
    const lastSample = tank.samples[tank.samples.length - 1];
    if (lastSample.timestamp === timestamp) {
      return; // Skip duplicate
    }
  }

  // Add new sample
  tank.samples.push({
    eggCount: eggCount,
    timestamp: timestamp
  });

  // Keep only last 5 minutes of samples (300 seconds)
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  tank.samples = tank.samples.filter(sample => {
    // Convert timestamp to milliseconds if needed
    const sampleTime = sample.timestamp > 10000000000 ? sample.timestamp : sample.timestamp * 1000;
    return sampleTime > fiveMinutesAgo;
  });
}

// Start 5-minute averaging for a tank
function startAveragingForTank(tankId) {
  const tank = tankData[tankId];

  // Clear existing interval if any
  if (tank.averagingInterval) {
    clearInterval(tank.averagingInterval);
  }

  // Set up new interval
  tank.averagingInterval = setInterval(() => {
    computeAndStoreAverage(tankId);
  }, 5 * 60 * 1000); // Every 5 minutes

  // Compute initial average after 1 minute
  setTimeout(() => {
    computeAndStoreAverage(tankId);
  }, 60 * 1000);
}

// Compute 5-minute average and store to Firestore
async function computeAndStoreAverage(tankId) {
  const tank = tankData[tankId];

  if (tank.samples.length === 0) {
    console.log(`No samples for ${tankId}, skipping average computation`);
    return;
  }

  // Compute average
  const sum = tank.samples.reduce((acc, sample) => acc + sample.eggCount, 0);
  const average = sum / tank.samples.length;
  const maxEggCount = tank.samples.reduce((acc, sample) => Math.max(acc, sample.eggCount), 0);

  // Update tank data
  tank.lastAverage = average;
  tank.lastComputedAt = new Date();

  // Clear samples for this tank
  tank.samples = [];

  // Check if we should send notification (only if average > 0)
  if (average > 0) {
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);

    // Only notify if last notification was more than 5 minutes ago or no notification exists
    if (!tank.lastNotificationTime || tank.lastNotificationTime < fiveMinutesAgo) {
      addEggDetectionNotification(tankId, average);

      tank.lastNotificationTime = now;
      console.log(`Sent egg detection notification for ${tankId}: ${average.toFixed(1)}`);
    } else {
      console.log(`Skipping notification for ${tankId} - too soon since last notification`);
    }
  }

  // Store to Firestore
  try {
    await setDoc(doc(db, 'tanks', tankId), {
      lastFiveMinuteAverage: average,
      lastComputedAt: serverTimestamp()
    });

    console.log(`Stored 5-minute average for ${tankId}: ${average.toFixed(2)}`);

    // Update UI if this is the active tank
    if (activeTank === tankId) {
      updateInfoPanel();
    }

  } catch (error) {
    console.error(`Error storing average for ${tankId}:`, error);
  }

  // Persist summary to backend for reports
  try {
    const intervalEnd = new Date();
    const intervalStart = new Date(intervalEnd.getTime() - (5 * 60 * 1000));

    await fetch(REPORTS_EGG_SUMMARY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intervalStart: intervalStart.toISOString(),
        intervalEnd: intervalEnd.toISOString(),
        tank: tankId.slice(-1),
        avgEggCount: average,
        maxEggCount: maxEggCount,
      })
    });
  } catch {
    // Backend unavailable - fail silently
  }
}

// Update information panel display
function updateInfoPanel() {
  const tank = tankData[activeTank];

  // Update average egg count
  const avgElement = document.getElementById('avg-egg-count');
  if (avgElement) {
    avgElement.textContent = tank.lastAverage.toFixed(2);
  }

  // Update timestamp
  const timestampElement = document.getElementById('avg-timestamp');
  if (timestampElement) {
    if (tank.lastComputedAt) {
      timestampElement.textContent = tank.lastComputedAt.toLocaleTimeString();
    } else {
      timestampElement.textContent = '--:--:--';
    }
  }
}

// Initialize system when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Wait a bit for all elements to be available
  setTimeout(() => {
    // Check if tank buttons exist before initializing
    const tankAButton = document.getElementById('tankA-btn');
    const tankBButton = document.getElementById('tankB-btn');

    if (tankAButton && tankBButton) {
      initializeTankSystem();

      // Start averaging for both tanks
      startAveragingForTank('TankA');
      startAveragingForTank('TankB');

      // Set default active tank
      selectTank('TankA');
    } else {
      console.error('Tank buttons not found in DOM');
    }
  }, 500);
});

// Export functions for global access
window.selectTank = selectTank;
window.tankData = tankData;
window.getCurrentTank = () => window.currentTank;
