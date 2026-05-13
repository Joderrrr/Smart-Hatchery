import { fetchWithAuth } from './authz.js';

const DEFAULT_THRESHOLDS = {
  temperature: { optimalMin: 20, optimalMax: 32, unit: '°C' },
  turbidity: { optimalMax: 100, unit: 'NTU' },
  tds: { optimalMin: 0, optimalMax: 1000, unit: 'ppm' },
};

let thresholds = { ...DEFAULT_THRESHOLDS };

function toNumberOrFallback(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeThresholds(raw) {
  return {
    temperature: {
      optimalMin: toNumberOrFallback(raw?.temperature?.min, DEFAULT_THRESHOLDS.temperature.optimalMin),
      optimalMax: toNumberOrFallback(raw?.temperature?.max, DEFAULT_THRESHOLDS.temperature.optimalMax),
      unit: DEFAULT_THRESHOLDS.temperature.unit,
    },
    turbidity: {
      optimalMax: toNumberOrFallback(raw?.turbidity?.max, DEFAULT_THRESHOLDS.turbidity.optimalMax),
      unit: DEFAULT_THRESHOLDS.turbidity.unit,
    },
    tds: {
      optimalMin: toNumberOrFallback(raw?.tds?.min, DEFAULT_THRESHOLDS.tds.optimalMin),
      optimalMax: toNumberOrFallback(raw?.tds?.max, DEFAULT_THRESHOLDS.tds.optimalMax),
      unit: DEFAULT_THRESHOLDS.tds.unit,
    },
  };
}

export async function loadThresholdsFromServer() {
  try {
    const response = await fetchWithAuth('/api/settings/thresholds');
    if (!response.ok) return thresholds;
    const data = await response.json();
    thresholds = normalizeThresholds(data?.thresholds);
  } catch {
    // Keep defaults if endpoint is unavailable or forbidden.
  }
  return thresholds;
}

export function getThreshold(sensorType) {
  return thresholds[sensorType] || DEFAULT_THRESHOLDS[sensorType];
}

export function getAllThresholds() {
  return { ...thresholds };
}
