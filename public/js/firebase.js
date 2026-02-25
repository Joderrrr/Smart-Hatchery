import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

const firebaseConfig = {
  databaseURL: "https://test-29995-default-rtdb.asia-southeast1.firebasedatabase.app",
  apiKey: "AIzaSyDbn0lS8dyfa5_HLG_ePuDfSlt5B_4BLbk",
};

// Initialize Firebase
let app;
let database;

try {
  app = initializeApp(firebaseConfig);
  database = getDatabase(app);
  console.log('Firebase initialized successfully');
  console.log('Database URL:', firebaseConfig.databaseURL);
} catch (error) {
  console.error('Firebase initialization error:', error);
}

// Firebase paths
const FIREBASE_PATHS = {
  temperature: '/sensors/temperature',
  turbidity: '/sensors/turbidity',
  tds: '/sensors/tds',
};

/**
 * Subscribe to a Firebase path and call callback on value change
 * @param {string} sensorType - 'temperature', 'turbidity', or 'tds'
 * @param {Function} callback - Function to call with new value
 * @returns {Function} Unsubscribe function
 */
export function subscribeToSensor(sensorType, callback) {
  const path = FIREBASE_PATHS[sensorType];
  if (!path) {
    console.error(`Unknown sensor type: ${sensorType}`);
    return () => {};
  }

  if (!database) {
    console.error('Database not initialized');
    return () => {};
  }

  const sensorRef = ref(database, path);
  
  console.log(`Subscribing to ${sensorType} at path: ${path}`);
  
  return onValue(sensorRef, (snapshot) => {
    const data = snapshot.val();
    console.log(`${sensorType} data received:`, data);
    
    if (data !== null && data !== undefined) {
      let numValue;
      
      // Handle different data structures
      if (typeof data === 'number') {
        // Direct numeric value (e.g., /sensors/temperature = 20)
        numValue = data;
        console.log(`${sensorType} extracted direct number:`, numValue);
      } else if (typeof data === 'string') {
        // String value - try to parse
        numValue = parseFloat(data);
        console.log(`${sensorType} parsed from string:`, numValue);
      } else if (typeof data === 'object' && data !== null) {
        // Object structure: {value: 20, timestamp: 1764153040, connected: true}
        if (data.value !== undefined && data.value !== null) {
          numValue = typeof data.value === 'number' ? data.value : parseFloat(data.value);
          console.log(`${sensorType} extracted from object.value:`, numValue);
        } else if (data.data !== undefined) {
          numValue = typeof data.data === 'number' ? data.data : parseFloat(data.data);
          console.log(`${sensorType} extracted from object.data:`, numValue);
        } else {
          // Try to find any numeric property in the object (excluding timestamp, connected)
          const numericKeys = Object.keys(data).filter(key => 
            key !== 'timestamp' && 
            key !== 'connected' && 
            typeof data[key] === 'number'
          );
          if (numericKeys.length > 0) {
            numValue = data[numericKeys[0]];
            console.log(`${sensorType} extracted from property "${numericKeys[0]}":`, numValue);
          }
        }
      }
      
      // Validate the extracted value
      if (numValue !== undefined && numValue !== null && !isNaN(numValue) && isFinite(numValue)) {
        console.log(`${sensorType} final value to display:`, numValue);
        callback(numValue);
      } else {
        console.warn(`${sensorType} value could not be parsed as a number. Data structure:`, data);
        callback(null);
      }
    } else {
      console.warn(`${sensorType} data is null or undefined`);
      callback(null);
    }
  }, (error) => {
    console.error(`Error reading ${sensorType}:`, error);
    console.error('Error details:', {
      code: error.code,
      message: error.message
    });
    updateConnectionStatus(false);
    callback(null);
  });
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(isConnected) {
  const statusElement = document.getElementById('connection-status');
  if (statusElement) {
    if (isConnected) {
      statusElement.style.background = '#1e4d3e';
      statusElement.style.color = '#90ee90';
      statusElement.innerHTML = '<span>Connected to Firebase Realtime Database</span>';
    } else {
      statusElement.style.background = '#7c2d12';
      statusElement.style.color = '#fbbf24';
      statusElement.innerHTML = '<span>Disconnected from Firebase</span>';
    }
  }
}

// Test connection on load
if (database) {
  const connectionRef = ref(database, '.info/connected');
  onValue(connectionRef, (snapshot) => {
    const isConnected = snapshot.val();
    updateConnectionStatus(isConnected);
    console.log('Firebase connection status:', isConnected ? 'Connected' : 'Disconnected');
  });
}

export { database };

