import { fetchWithAuth, getAuthContext, hasPermission } from './authz.js';

const AGG_INTERVAL_MS = 5 * 60 * 1000;
const samples = {
  temperature: [],
  turbidity: [],
  tds: [],
};

function toNumber(value) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

function average(values) {
  if (!values.length) return null;
  const sum = values.reduce((acc, item) => acc + item, 0);
  return sum / values.length;
}

async function flushSamples() {
  const temperatureAvg = average(samples.temperature);
  const turbidityAvg = average(samples.turbidity);
  const tdsAvg = average(samples.tds);

  if (temperatureAvg === null && turbidityAvg === null && tdsAvg === null) {
    return;
  }

  const payload = {
    recordedAt: new Date().toISOString(),
    temperature: temperatureAvg,
    turbidity: turbidityAvg,
    tds: tdsAvg,
  };

  samples.temperature = [];
  samples.turbidity = [];
  samples.tds = [];

  try {
    const context = await getAuthContext();
    if (!hasPermission(context, 'view_sensors')) return;

    await fetchWithAuth('/api/reports/water-readings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch {
    // Backend unavailable - fail silently
  }
}

export function addWaterSample(sensorType, value) {
  const numValue = toNumber(value);
  if (numValue === null || !samples[sensorType]) {
    return;
  }

  samples[sensorType].push(numValue);
}

setInterval(flushSamples, AGG_INTERVAL_MS);
