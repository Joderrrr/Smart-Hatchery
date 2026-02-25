/**
 * Charts Module
 * Handles in-memory history and Chart.js visualization
 */

// In-memory data storage
const historyData = {
  temperature: [],
  turbidity: [],
  tds: [],
};

// Chart instances
const charts = {};

// Time range in milliseconds
const TIME_RANGES = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

/**
 * Initialize a chart
 */
export function initChart(sensorType) {
  const canvas = document.getElementById(`${sensorType}-chart`);
  const collectingElement = document.getElementById(`${sensorType}-collecting`);
  
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  
  charts[sensorType] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: sensorType.charAt(0).toUpperCase() + sensorType.slice(1),
        data: [],
        borderColor: getChartColor(sensorType),
        backgroundColor: getChartColor(sensorType, 0.1),
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          mode: 'index',
          intersect: false,
        },
      },
      scales: {
        x: {
          display: true,
          grid: {
            color: '#2d3748',
          },
          ticks: {
            color: '#909090',
            font: {
              size: 10,
            },
          },
        },
        y: {
          display: true,
          grid: {
            color: '#2d3748',
          },
          ticks: {
            color: '#909090',
            font: {
              size: 10,
            },
          },
        },
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false,
      },
    },
  });

  // Set up time range buttons
  setupTimeRangeButtons(sensorType);
}

/**
 * Add data point to history
 */
export function addDataPoint(sensorType, value) {
  if (value === null || value === undefined || isNaN(value)) {
    return;
  }

  const now = Date.now();
  historyData[sensorType].push({
    timestamp: now,
    value: value,
  });

  // Remove old data points (keep last 7 days worth)
  const cutoff = now - TIME_RANGES['7d'];
  historyData[sensorType] = historyData[sensorType].filter(
    point => point.timestamp > cutoff
  );

  // Update chart if visible
  updateChart(sensorType);
}

/**
 * Update chart display based on selected time range
 */
function updateChart(sensorType) {
  const chart = charts[sensorType];
  if (!chart) return;

  // Get active time range
  const canvas = document.getElementById(`${sensorType}-chart`);
  if (!canvas) return;
  
  const historyCard = canvas.closest('.history-card');
  if (!historyCard) return;
  
  const timeRangeButtons = historyCard.querySelectorAll('.time-btn');
  let activeRange = '24h'; // Default to 24h
  
  timeRangeButtons.forEach(btn => {
    if (btn.classList.contains('active')) {
      activeRange = btn.dataset.range || '24h';
    }
  });
  
  // If no button is active, set 24h as active
  const hasActive = Array.from(timeRangeButtons).some(btn => btn.classList.contains('active'));
  if (!hasActive) {
    timeRangeButtons.forEach(btn => {
      if (btn.dataset.range === '24h') {
        btn.classList.add('active');
      }
    });
  }

  // Filter data by time range
  const now = Date.now();
  const timeRange = TIME_RANGES[activeRange] || TIME_RANGES['24h'];
  const cutoff = now - timeRange;
  
  const filteredData = historyData[sensorType].filter(
    point => point.timestamp > cutoff
  );

  if (filteredData.length === 0) {
    // Show "Collecting data..." message
    const collectingElement = document.getElementById(`${sensorType}-collecting`);
    if (collectingElement) {
      collectingElement.classList.remove('hidden');
    }
    chart.data.labels = [];
    chart.data.datasets[0].data = [];
  } else {
    // Hide "Collecting data..." message
    const collectingElement = document.getElementById(`${sensorType}-collecting`);
    if (collectingElement) {
      collectingElement.classList.add('hidden');
    }

    // Format labels and data
    chart.data.labels = filteredData.map(point => {
      const date = new Date(point.timestamp);
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });
    });
    
    chart.data.datasets[0].data = filteredData.map(point => point.value);
  }

  chart.update('none'); // 'none' mode for smooth updates
}

/**
 * Set up time range button handlers
 */
function setupTimeRangeButtons(sensorType) {
  const canvas = document.getElementById(`${sensorType}-chart`);
  if (!canvas) return;
  
  const historyCard = canvas.closest('.history-card');
  if (!historyCard) return;

  const buttons = historyCard.querySelectorAll('.time-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all buttons in this card
      buttons.forEach(b => b.classList.remove('active'));
      // Add active class to clicked button
      btn.classList.add('active');
      // Update chart
      updateChart(sensorType);
    });
  });
}

/**
 * Get chart color for sensor type
 */
function getChartColor(sensorType, alpha = 1) {
  const colors = {
    temperature: `rgba(251, 191, 36, ${alpha})`,
    turbidity: `rgba(34, 197, 94, ${alpha})`,
    tds: `rgba(251, 146, 60, ${alpha})`,
  };
  return colors[sensorType] || `rgba(96, 165, 250, ${alpha})`;
}

