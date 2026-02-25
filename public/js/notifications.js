/**
 * Notifications Module
 * Handles notification display and management
 */

let notifications = [];
let notificationIdCounter = 0;

// Icon paths
const ICONS = {
  warning: 'css/icons/Warning.png',
  critical: 'css/icons/Critical.png',
  egg: 'css/icons/information.png', // Use information icon for egg detections
};

/**
 * Initialize notification system
 */
export function initNotifications() {
  const notificationBtn = document.getElementById('notification-btn');
  const notificationDropdown = document.getElementById('notification-dropdown');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const notificationList = document.getElementById('notification-list');

  if (!notificationBtn || !notificationDropdown) {
    console.error('Notification elements not found');
    return;
  }

  // Toggle dropdown on button click
  notificationBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    notificationDropdown.classList.toggle('active');
    updateNotificationBadge();
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!notificationDropdown.contains(e.target) && !notificationBtn.contains(e.target)) {
      notificationDropdown.classList.remove('active');
    }
  });

  // Clear all notifications
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      notifications = [];
      renderNotifications();
      updateNotificationBadge();
    });
  }
}

/**
 * Add a new notification
 * @param {string} type - 'warning', 'critical', or 'egg'
 * @param {string} message - Notification message
 */
export function addNotification(type, message, ...rest) {
  let finalMessage = message;
  if (rest.length && typeof rest[rest.length - 1] === 'string') {
    finalMessage = rest[rest.length - 1];
  }
  if (typeof finalMessage !== 'string') {
    finalMessage = String(finalMessage || '');
  }

  const notification = {
    id: notificationIdCounter++,
    type,
    message: finalMessage,
    timestamp: Date.now(),
    read: false,
  };

  notifications.unshift(notification); // Add to beginning
  if (notifications.length > 50) {
    notifications = notifications.slice(0, 50); // Keep only last 50
  }

  renderNotifications();
  updateNotificationBadge();

  logSystemEvent(type, finalMessage);
}

/**
 * Add egg detection notification
 * @param {string} tankId - 'TankA' or 'TankB'
 * @param {number} averageCount - Average egg count over 5 minutes
 */
export function addEggDetectionNotification(tankId, averageCount) {
  const message = `Fish eggs detected in ${tankId}. Average count: ${averageCount.toFixed(1)}`;
  addNotification('egg', message);
}

/**
 * Mark notification as read
 */
function markAsRead(notificationId) {
  const notification = notifications.find(n => n.id === notificationId);
  if (notification) {
    notification.read = true;
    renderNotifications();
    updateNotificationBadge();
  }
}

/**
 * Render all notifications
 */
function renderNotifications() {
  const notificationList = document.getElementById('notification-list');
  if (!notificationList) return;

  if (notifications.length === 0) {
    notificationList.innerHTML = '<div class="no-notifications">No notifications</div>';
    return;
  }

  notificationList.innerHTML = notifications.map(notification => {
    const iconPath = ICONS[notification.type] || ICONS.warning;
    const timeAgo = getTimeAgo(notification.timestamp);
    const readClass = notification.read ? '' : 'unread';
    
    let title = 'Notification';
    if (notification.type === 'egg') {
      title = 'Egg Detection';
    } else if (notification.type === 'critical') {
      title = 'Critical Alert';
    } else if (notification.type === 'warning') {
      title = 'Warning';
    }
    
    return `
      <div class="notification-item ${notification.type} ${readClass}" data-id="${notification.id}">
        <img src="${iconPath}" alt="${notification.type}" class="notification-icon">
        <div class="notification-content">
          <div class="notification-title">${title}</div>
          <div class="notification-message">${notification.message}</div>
          <div class="notification-time">${timeAgo}</div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers to mark as read
  notificationList.querySelectorAll('.notification-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = parseInt(item.dataset.id);
      markAsRead(id);
    });
  });
}

/**
 * Get time ago string
 */
function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) {
    return 'Just now';
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else {
    const days = Math.floor(seconds / 86400);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
}

/**
 * Update notification badge
 */
function updateNotificationBadge() {
  const badge = document.getElementById('notification-badge');
  const unreadCount = notifications.filter(n => !n.read).length;
  
  if (badge) {
    if (unreadCount > 0) {
      badge.classList.add('has-notifications');
    } else {
      badge.classList.remove('has-notifications');
    }
  }
}

async function logSystemEvent(type, message) {
  const eventTypeMap = {
    egg: 'Egg Detection',
    critical: 'Sensor Critical',
    warning: 'Sensor Warning',
  };

  try {
    const response = await fetch('/api/reports/system-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: eventTypeMap[type] || 'Notification',
        message,
        createdAt: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      // Server responded but with an error - log silently
      console.debug('System event logging returned:', response.status);
    }
  } catch {
    // Backend unavailable - fail silently to avoid console spam
  }
}

/**
 * Check sensor value and create appropriate notifications
 * @param {string} sensorType - Sensor type
 * @param {number} value - Current sensor value
 */
export function checkSensorThresholds(sensorType, value) {
  const THRESHOLDS = {
    temperature: {
      optimalMin: 20,
      optimalMax: 32,
      warningMargin: 1, // 1°C margin for warning
      unit: '°C',
    },
    turbidity: {
      optimalMax: 100,
      warningMargin: 5, // 5 NTU margin for warning
      unit: 'NTU',
    },
    tds: {
      optimalMin: 0,
      optimalMax: 1000,
      warningMargin: 100, // 100 ppm margin for warning
      unit: 'ppm',
    },
  };

  const threshold = THRESHOLDS[sensorType];
  if (!threshold) return;

  if (sensorType === 'temperature') {
    // Critical: Outside optimal range
    if (value < threshold.optimalMin) {
      addNotification(
        'critical',
        sensorType,
        value,
        `Temperature is too low at ${value.toFixed(2)}${threshold.unit}. Optimal range: ${threshold.optimalMin}-${threshold.optimalMax}${threshold.unit}`
      );
    } else if (value > threshold.optimalMax) {
      addNotification(
        'critical',
        sensorType,
        value,
        `Temperature is too high at ${value.toFixed(2)}${threshold.unit}. Optimal range: ${threshold.optimalMin}-${threshold.optimalMax}${threshold.unit}`
      );
    }
    // Warning: Approaching limits
    else if (value <= threshold.optimalMin + threshold.warningMargin) {
      addNotification(
        'warning',
        sensorType,
        value,
        `Temperature is approaching lower limit at ${value.toFixed(2)}${threshold.unit}. Optimal range: ${threshold.optimalMin}-${threshold.optimalMax}${threshold.unit}`
      );
    } else if (value >= threshold.optimalMax - threshold.warningMargin) {
      addNotification(
        'warning',
        sensorType,
        value,
        `Temperature is approaching upper limit at ${value.toFixed(2)}${threshold.unit}. Optimal range: ${threshold.optimalMin}-${threshold.optimalMax}${threshold.unit}`
      );
    }
  } else if (sensorType === 'turbidity') {
    // Critical: Above optimal max
    if (value > threshold.optimalMax) {
      addNotification(
        'critical',
        sensorType,
        value,
        `Turbidity is too high at ${value.toFixed(2)}${threshold.unit}. Optimal max: ${threshold.optimalMax}${threshold.unit}`
      );
    }
    // Warning: Approaching limit
    else if (value >= threshold.optimalMax - threshold.warningMargin) {
      addNotification(
        'warning',
        sensorType,
        value,
        `Turbidity is approaching limit at ${value.toFixed(2)}${threshold.unit}. Optimal max: ${threshold.optimalMax}${threshold.unit}`
      );
    }
  } else if (sensorType === 'tds') {
    // Critical: Too low or too high
    if (value < threshold.optimalMin || value === 0) {
      addNotification(
        'critical',
        sensorType,
        value,
        `TDS is too low at ${value.toFixed(2)}${threshold.unit}. Optimal range: ${threshold.optimalMin}-${threshold.optimalMax}${threshold.unit}`
      );
    } else if (value > threshold.optimalMax) {
      addNotification(
        'critical',
        sensorType,
        value,
        `TDS is too high at ${value.toFixed(2)}${threshold.unit}. Optimal range: ${threshold.optimalMin}-${threshold.optimalMax}${threshold.unit}`
      );
    }
    // Warning: Approaching limits
    else if (value <= threshold.optimalMin + threshold.warningMargin) {
      addNotification(
        'warning',
        sensorType,
        value,
        `TDS is approaching lower limit at ${value.toFixed(2)}${threshold.unit}. Optimal range: ${threshold.optimalMin}-${threshold.optimalMax}${threshold.unit}`
      );
    } else if (value >= threshold.optimalMax - threshold.warningMargin) {
      addNotification(
        'warning',
        sensorType,
        value,
        `TDS is approaching upper limit at ${value.toFixed(2)}${threshold.unit}. Optimal range: ${threshold.optimalMin}-${threshold.optimalMax}${threshold.unit}`
      );
    }
  }
}
