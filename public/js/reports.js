const API = {
  summary: '/api/reports/summary',
  eggs: '/api/reports/egg-detections',
  water: '/api/reports/water-readings',
  events: '/api/reports/system-events',
};

const RECORDS_PER_PAGE = 10;

let eggChart = null;
let waterChart = null;

// Pagination state
const paginationState = {
  egg: { currentPage: 1, totalPages: 1, records: [] },
  water: { currentPage: 1, totalPages: 1, records: [] },
  events: { currentPage: 1, totalPages: 1, records: [] }
};

function getPageRecords(records, page) {
  const start = (page - 1) * RECORDS_PER_PAGE;
  const end = start + RECORDS_PER_PAGE;
  return records.slice(start, end);
}

function getTotalPages(records) {
  return Math.max(1, Math.ceil(records.length / RECORDS_PER_PAGE));
}

function renderPaginationControls(containerId, state, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const { currentPage, totalPages, records } = state;
  
  if (records.length === 0) {
    container.innerHTML = '';
    return;
  }

  const startRecord = (currentPage - 1) * RECORDS_PER_PAGE + 1;
  const endRecord = Math.min(currentPage * RECORDS_PER_PAGE, records.length);

  let pagesHtml = '';
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pagesHtml += `<button class="pagination-page${i === currentPage ? ' active' : ''}" data-page="${i}">${i}</button>`;
  }

  container.innerHTML = `
    <div class="pagination-info">Showing ${startRecord}-${endRecord} of ${records.length} records</div>
    <div class="pagination-buttons">
      <button class="pagination-btn pagination-prev" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">Previous</button>
      ${pagesHtml}
      <button class="pagination-btn pagination-next" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">Next</button>
    </div>
  `;

  // Add event listeners
  container.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const page = parseInt(e.target.dataset.page, 10);
      if (page >= 1 && page <= totalPages && page !== currentPage) {
        onPageChange(page);
      }
    });
  });
}

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

function setDefaultDateRange() {
  const endInput = document.getElementById('range-end');
  const startInput = document.getElementById('range-start');
  if (!endInput || !startInput) return;

  const end = new Date();

  endInput.value = formatDateInput(end);
  startInput.value = formatDateInput(end);
}

function scheduleStartDateRefresh() {
  const startInput = document.getElementById('range-start');
  const endInput = document.getElementById('range-end');
  if (!startInput || !endInput) return;

  const refreshStartDate = () => {
    const today = new Date();
    const todayValue = formatDateInput(today);
    startInput.value = todayValue;
    endInput.value = todayValue;
  };

  refreshStartDate();

  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  const delay = nextMidnight.getTime() - now.getTime();

  setTimeout(() => {
    refreshStartDate();
    setInterval(refreshStartDate, 24 * 60 * 60 * 1000);
  }, delay);
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSelectedRange() {
  const endValue = document.getElementById('range-end')?.value;
  const startValue = document.getElementById('range-start')?.value;

  const end = endValue ? new Date(`${endValue}T23:59:59.999`) : new Date();
  const start = startValue ? new Date(`${startValue}T00:00:00`) : new Date();
  start.setHours(0, 0, 0, 0);

  return { start, end };
}

function buildRangeQuery() {
  const { start, end } = getSelectedRange();
  const params = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
  });
  return params.toString();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function formatDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderSummary(summary, eggRecords) {
  const totalElement = document.getElementById('summary-total');
  const averageElement = document.getElementById('summary-average');
  const tanksElement = document.getElementById('summary-tanks');
  const noteElement = document.getElementById('summary-note');

  if (totalElement) {
    totalElement.textContent = summary.totalEggDetections?.toFixed(1) ?? '--';
  }
  if (averageElement) {
    averageElement.textContent = summary.avgEggCountPerDetection?.toFixed(1) ?? '--';
  }
  if (tanksElement) {
    const tanks = summary.activeTanks?.length ? summary.activeTanks.join(', ') : '--';
    tanksElement.textContent = tanks;
  }

  if (noteElement) {
    noteElement.textContent = eggRecords.length === 0
      ? 'No historical records found for the selected range.'
      : '';
  }
}

function renderEggTable(records, page = 1) {
  const tbody = document.querySelector('#egg-table tbody');
  if (!tbody) return;

  // Update pagination state
  paginationState.egg.records = records;
  paginationState.egg.totalPages = getTotalPages(records);
  paginationState.egg.currentPage = Math.min(page, paginationState.egg.totalPages);

  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="4">No egg detection records available.</td></tr>';
    renderPaginationControls('egg-pagination', paginationState.egg, (newPage) => {
      renderEggTable(records, newPage);
    });
    return;
  }

  const pageRecords = getPageRecords(records, paginationState.egg.currentPage);
  tbody.innerHTML = pageRecords.map(record => `
    <tr>
      <td>${formatDateTime(record.interval_start)}</td>
      <td>${formatDateTime(record.interval_end)}</td>
      <td>Tank ${record.tank}</td>
      <td>${Number(record.avg_egg_count).toFixed(1)}</td>
    </tr>
  `).join('');

  renderPaginationControls('egg-pagination', paginationState.egg, (newPage) => {
    renderEggTable(records, newPage);
  });
}

function renderWaterTable(records, page = 1) {
  const tbody = document.querySelector('#water-table tbody');
  if (!tbody) return;

  // Update pagination state
  paginationState.water.records = records;
  paginationState.water.totalPages = getTotalPages(records);
  paginationState.water.currentPage = Math.min(page, paginationState.water.totalPages);

  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="4">No water quality records available.</td></tr>';
    renderPaginationControls('water-pagination', paginationState.water, (newPage) => {
      renderWaterTable(records, newPage);
    });
    return;
  }

  const pageRecords = getPageRecords(records, paginationState.water.currentPage);
  tbody.innerHTML = pageRecords.map(record => `
    <tr>
      <td>${formatDateTime(record.recorded_at)}</td>
      <td>${record.temperature !== null && record.temperature !== undefined ? Number(record.temperature).toFixed(2) + ' °C' : '--'}</td>
      <td>${record.tds !== null && record.tds !== undefined ? Number(record.tds).toFixed(1) + ' ppm' : '--'}</td>
      <td>${record.turbidity !== null && record.turbidity !== undefined ? Number(record.turbidity).toFixed(1) + ' NTU' : '--'}</td>
    </tr>
  `).join('');

  renderPaginationControls('water-pagination', paginationState.water, (newPage) => {
    renderWaterTable(records, newPage);
  });
}

function renderEventsTable(records, page = 1) {
  const tbody = document.querySelector('#events-table tbody');
  if (!tbody) return;

  // Update pagination state
  paginationState.events.records = records;
  paginationState.events.totalPages = getTotalPages(records);
  paginationState.events.currentPage = Math.min(page, paginationState.events.totalPages);

  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="3">No system events recorded.</td></tr>';
    renderPaginationControls('events-pagination', paginationState.events, (newPage) => {
      renderEventsTable(records, newPage);
    });
    return;
  }

  const pageRecords = getPageRecords(records, paginationState.events.currentPage);
  tbody.innerHTML = pageRecords.map(record => `
    <tr>
      <td>${formatDateTime(record.created_at)}</td>
      <td>${record.event_type || '--'}</td>
      <td>${record.message || '--'}</td>
    </tr>
  `).join('');

  renderPaginationControls('events-pagination', paginationState.events, (newPage) => {
    renderEventsTable(records, newPage);
  });
}

function renderEggChart(records) {
  const ctx = document.getElementById('egg-chart');
  if (!ctx) return;

  const labels = [...new Set(records.map(record => formatDateTime(record.interval_end)))];
  const tankAData = labels.map(label => {
    const match = records.find(record => record.tank === 'A' && formatDateTime(record.interval_end) === label);
    return match ? Number(match.avg_egg_count) : null;
  });
  const tankBData = labels.map(label => {
    const match = records.find(record => record.tank === 'B' && formatDateTime(record.interval_end) === label);
    return match ? Number(match.avg_egg_count) : null;
  });

  if (eggChart) {
    eggChart.destroy();
  }

  eggChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Tank A',
          data: tankAData,
          borderColor: 'rgba(59, 130, 246, 1)',
          backgroundColor: 'rgba(59, 130, 246, 0.2)',
          tension: 0.4,
          fill: false,
        },
        {
          label: 'Tank B',
          data: tankBData,
          borderColor: 'rgba(16, 185, 129, 1)',
          backgroundColor: 'rgba(16, 185, 129, 0.2)',
          tension: 0.4,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#e0e0e0' } },
      },
      scales: {
        x: { ticks: { color: '#909090' }, grid: { color: '#2d3748' } },
        y: { ticks: { color: '#909090' }, grid: { color: '#2d3748' } },
      },
    },
  });
}

function renderWaterChart(records) {
  const ctx = document.getElementById('water-chart');
  if (!ctx) return;

  const labels = records.map(record => formatDateTime(record.recorded_at));
  const temperatureData = records.map(record => record.temperature ?? null);
  const tdsData = records.map(record => record.tds ?? null);
  const turbidityData = records.map(record => record.turbidity ?? null);

  if (waterChart) {
    waterChart.destroy();
  }

  waterChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Temperature (°C)',
          data: temperatureData,
          borderColor: 'rgba(251, 191, 36, 1)',
          backgroundColor: 'rgba(251, 191, 36, 0.2)',
          tension: 0.4,
          fill: false,
        },
        {
          label: 'TDS (ppm)',
          data: tdsData,
          borderColor: 'rgba(251, 146, 60, 1)',
          backgroundColor: 'rgba(251, 146, 60, 0.2)',
          tension: 0.4,
          fill: false,
        },
        {
          label: 'Turbidity (NTU)',
          data: turbidityData,
          borderColor: 'rgba(34, 197, 94, 1)',
          backgroundColor: 'rgba(34, 197, 94, 0.2)',
          tension: 0.4,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#e0e0e0' } },
      },
      scales: {
        x: { ticks: { color: '#909090' }, grid: { color: '#2d3748' } },
        y: { ticks: { color: '#909090' }, grid: { color: '#2d3748' } },
      },
    },
  });
}

async function loadReports() {
  const query = buildRangeQuery();
  const summaryNote = document.getElementById('summary-note');
  const eggNote = document.getElementById('egg-note');
  const waterNote = document.getElementById('water-note');
  const eventsNote = document.getElementById('events-note');

  try {
    const [summary, eggs, water, events] = await Promise.all([
      fetchJson(`${API.summary}?${query}`),
      fetchJson(`${API.eggs}?${query}`),
      fetchJson(`${API.water}?${query}`),
      fetchJson(`${API.events}?${query}`),
    ]);

    const eggRecords = eggs?.records || [];
    const waterRecords = water?.records || [];
    const eventRecords = events?.records || [];

    const computedSummary = {
      totalEggDetections: summary?.totalEggDetections ?? eggRecords.reduce((acc, rec) => acc + Number(rec.avg_egg_count || 0), 0),
      avgEggCountPerDetection: summary?.avgEggCountPerDetection ?? (eggRecords.length ? eggRecords.reduce((acc, rec) => acc + Number(rec.avg_egg_count || 0), 0) / eggRecords.length : 0),
      activeTanks: summary?.activeTanks ?? Array.from(new Set(eggRecords.map(rec => rec.tank))).map(tank => `Tank ${tank}`),
    };

    renderSummary(computedSummary, eggRecords);
    renderEggTable(eggRecords);
    renderWaterTable(waterRecords);
    renderEventsTable(eventRecords);
    renderEggChart(eggRecords);
    renderWaterChart(waterRecords);

    if (eggNote) eggNote.textContent = eggRecords.length === 0 ? 'No egg detection records found.' : '';
    if (waterNote) waterNote.textContent = waterRecords.length === 0 ? 'No water quality records found.' : '';
    if (eventsNote) eventsNote.textContent = eventRecords.length === 0 ? 'No system events found.' : '';
    if (summaryNote && eggRecords.length !== 0) summaryNote.textContent = '';
  } catch (error) {
    console.error('Failed to load reports:', error);
    if (summaryNote) {
      summaryNote.textContent = 'Unable to load reports at this time.';
    }
  }
}

function setupRangeHandler() {
  const applyButton = document.getElementById('apply-range');
  if (!applyButton) return;

  applyButton.addEventListener('click', () => {
    loadReports();
  });
}

function printReport() {
  // Temporarily resize charts for better print quality
  const charts = [eggChart, waterChart].filter(c => c);
  
  // Store original dimensions
  const originalDimensions = charts.map(chart => ({
    chart,
    width: chart.canvas.style.width,
    height: chart.canvas.style.height
  }));
  
  window.print();
}

function viewReport() {
  // Open report in a new window for full-screen viewing
  const reportContent = document.querySelector('.main-content');
  if (!reportContent) return;

  const viewWindow = window.open('', '_blank', 'width=1200,height=800');
  if (!viewWindow) {
    alert('Please allow pop-ups to view the report.');
    return;
  }

  const { start, end } = getSelectedRange();
  const dateRangeText = `${start.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;

  viewWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Smart Hatchery Report - ${dateRangeText}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #fff;
          color: #000;
          padding: 30px;
          line-height: 1.6;
        }
        .report-header {
          border-bottom: 3px solid #1e40af;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        .report-header h1 {
          font-size: 28px;
          color: #1e40af;
          margin-bottom: 5px;
        }
        .report-header .date-range {
          color: #666;
          font-size: 14px;
        }
        .report-header .generated {
          color: #999;
          font-size: 12px;
          margin-top: 5px;
        }
        .section {
          margin-bottom: 30px;
          page-break-inside: avoid;
        }
        .section-title {
          font-size: 18px;
          font-weight: 600;
          color: #1e40af;
          border-bottom: 1px solid #e0e0e0;
          padding-bottom: 8px;
          margin-bottom: 15px;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 15px;
          margin-bottom: 20px;
        }
        .summary-card {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 15px;
          text-align: center;
        }
        .summary-label { color: #64748b; font-size: 12px; margin-bottom: 5px; }
        .summary-value { font-size: 24px; font-weight: 700; color: #1e40af; }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          margin-bottom: 15px;
        }
        th, td {
          border: 1px solid #e2e8f0;
          padding: 10px;
          text-align: left;
        }
        th {
          background: #f1f5f9;
          font-weight: 600;
          color: #334155;
        }
        tr:nth-child(even) { background: #f8fafc; }
        .no-data { color: #94a3b8; font-style: italic; padding: 20px; text-align: center; }
        .print-btn {
          position: fixed;
          top: 20px;
          right: 20px;
          background: #1e40af;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
        }
        .print-btn:hover { background: #1e3a8a; }
        @media print {
          .print-btn { display: none; }
          body { padding: 15px; }
        }
      </style>
    </head>
    <body>
      <button class="print-btn" onclick="window.print()">Print Report</button>
      <div class="report-header">
        <h1>Smart Hatchery Report</h1>
        <div class="date-range">Report Period: ${dateRangeText}</div>
        <div class="generated">Generated: ${new Date().toLocaleString('en-US')}</div>
      </div>
      ${generateReportContent()}
    </body>
    </html>
  `);
  viewWindow.document.close();
}

function generateReportContent() {
  const summaryTotal = document.getElementById('summary-total')?.textContent || '--';
  const summaryAverage = document.getElementById('summary-average')?.textContent || '--';
  const summaryTanks = document.getElementById('summary-tanks')?.textContent || '--';

  const eggTableBody = document.querySelector('#egg-table tbody')?.innerHTML || '';
  const waterTableBody = document.querySelector('#water-table tbody')?.innerHTML || '';
  const eventsTableBody = document.querySelector('#events-table tbody')?.innerHTML || '';

  return `
    <div class="section">
      <div class="section-title">Summary</div>
      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-label">Total Egg Detections</div>
          <div class="summary-value">${summaryTotal}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Average Eggs per Detection</div>
          <div class="summary-value">${summaryAverage}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Active Tanks</div>
          <div class="summary-value">${summaryTanks}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Egg Detection Records</div>
      <table>
        <thead>
          <tr>
            <th>Interval Start</th>
            <th>Interval End</th>
            <th>Tank</th>
            <th>Average Egg Count</th>
          </tr>
        </thead>
        <tbody>${eggTableBody}</tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Water Quality Records</div>
      <table>
        <thead>
          <tr>
            <th>Recorded At</th>
            <th>Temperature</th>
            <th>TDS</th>
            <th>Turbidity</th>
          </tr>
        </thead>
        <tbody>${waterTableBody}</tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">System Events / Alerts</div>
      <table>
        <thead>
          <tr>
            <th>Created At</th>
            <th>Type</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>${eventsTableBody}</tbody>
      </table>
    </div>
  `;
}

function setupReportActions() {
  const printBtn = document.getElementById('print-report-btn');
  const viewBtn = document.getElementById('view-report-btn');

  if (printBtn) {
    printBtn.addEventListener('click', printReport);
  }

  if (viewBtn) {
    viewBtn.addEventListener('click', viewReport);
  }
}

function initReports() {
  updateDateTime();
  setInterval(updateDateTime, 1000);
  setDefaultDateRange();
  scheduleStartDateRefresh();
  setupRangeHandler();
  setupReportActions();
  loadReports();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReports);
} else {
  initReports();
}
