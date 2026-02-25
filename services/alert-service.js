/**
 * Alert Service Module
 * Handles alert evaluation, cooldown checking, and logging
 */

const { sendSms } = require('./sms-service');

// Alert type constants
const ALERT_TYPES = {
  TEMPERATURE_HIGH: 'temperature_high',
  TEMPERATURE_LOW: 'temperature_low',
  TDS_HIGH: 'tds_high',
  TURBIDITY_HIGH: 'turbidity_high',
  EGG_COUNT_HIGH: 'egg_count_high',
};

/**
 * Get configured thresholds from environment
 */
function getThresholds() {
  return {
    temperatureMax: Number(process.env.ALERT_THRESHOLD_TEMPERATURE_MAX || 32),
    temperatureMin: Number(process.env.ALERT_THRESHOLD_TEMPERATURE_MIN || 20),
    tdsMax: Number(process.env.ALERT_THRESHOLD_TDS_MAX || 1000),
    turbidityMax: Number(process.env.ALERT_THRESHOLD_TURBIDITY_MAX || 100),
    eggCountAvg: Number(process.env.ALERT_THRESHOLD_EGG_COUNT_AVG || 50),
  };
}

/**
 * Get cooldown duration in minutes
 */
function getCooldownMinutes() {
  return Number(process.env.ALERT_COOLDOWN_MINUTES || 30);
}

/**
 * Check if an alert type is within cooldown period (database-driven)
 * @param {import('mysql2/promise').Pool} pool - MySQL connection pool
 * @param {string} alertType - The type of alert
 * @returns {Promise<boolean>} - True if in cooldown, false otherwise
 */
async function isInCooldown(pool, alertType) {
  const cooldownMinutes = getCooldownMinutes();
  
  const [rows] = await pool.query(
    `SELECT id FROM alerts_log 
     WHERE type = ? AND sent_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
     LIMIT 1`,
    [alertType, cooldownMinutes]
  );

  return rows.length > 0;
}

/**
 * Log a sent alert to the database
 * @param {import('mysql2/promise').Pool} pool - MySQL connection pool
 * @param {string} alertType - The type of alert
 * @param {string} message - The alert message
 */
async function logAlert(pool, alertType, message) {
  await pool.query(
    'INSERT INTO alerts_log (type, message, sent_at) VALUES (?, ?, NOW())',
    [alertType, message]
  );
}

/**
 * Send an alert if not in cooldown
 * @param {import('mysql2/promise').Pool} pool - MySQL connection pool
 * @param {string} alertType - The type of alert
 * @param {string} message - The alert message
 * @returns {Promise<boolean>} - True if alert was sent
 */
async function sendAlertIfAllowed(pool, alertType, message) {
  try {
    const inCooldown = await isInCooldown(pool, alertType);
    if (inCooldown) {
      console.log(`Alert ${alertType} skipped - in cooldown period.`);
      return false;
    }

    const result = await sendSms(message);
    if (result.success) {
      await logAlert(pool, alertType, message);
      console.log(`Alert ${alertType} sent and logged.`);
      return true;
    } else {
      console.error(`Failed to send alert ${alertType}: ${result.error}`);
      return false;
    }
  } catch (error) {
    console.error(`Alert ${alertType} error:`, error.message || error);
    return false;
  }
}

/**
 * Check sensor thresholds and trigger alerts
 * @param {import('mysql2/promise').Pool} pool - MySQL connection pool
 */
async function checkSensorThresholds(pool) {
  const thresholds = getThresholds();

  // Get the latest water reading
  const [readings] = await pool.query(
    `SELECT temperature, tds, turbidity, recorded_at 
     FROM water_readings 
     ORDER BY recorded_at DESC 
     LIMIT 1`
  );

  if (readings.length === 0) {
    console.log('No water readings found for alert evaluation.');
    return;
  }

  const latest = readings[0];
  const timestamp = new Date(latest.recorded_at).toLocaleString();

  // Temperature high check
  if (latest.temperature !== null && latest.temperature > thresholds.temperatureMax) {
    const message = `[Smart Hatchery ALERT] Temperature is HIGH: ${latest.temperature.toFixed(1)}°C (threshold: ${thresholds.temperatureMax}°C) at ${timestamp}`;
    await sendAlertIfAllowed(pool, ALERT_TYPES.TEMPERATURE_HIGH, message);
  }

  // Temperature low check
  if (latest.temperature !== null && latest.temperature < thresholds.temperatureMin) {
    const message = `[Smart Hatchery ALERT] Temperature is LOW: ${latest.temperature.toFixed(1)}°C (threshold: ${thresholds.temperatureMin}°C) at ${timestamp}`;
    await sendAlertIfAllowed(pool, ALERT_TYPES.TEMPERATURE_LOW, message);
  }

  // TDS high check
  if (latest.tds !== null && latest.tds > thresholds.tdsMax) {
    const message = `[Smart Hatchery ALERT] TDS is HIGH: ${latest.tds.toFixed(1)} ppm (threshold: ${thresholds.tdsMax} ppm) at ${timestamp}`;
    await sendAlertIfAllowed(pool, ALERT_TYPES.TDS_HIGH, message);
  }

  // Turbidity high check
  if (latest.turbidity !== null && latest.turbidity > thresholds.turbidityMax) {
    const message = `[Smart Hatchery ALERT] Turbidity is HIGH: ${latest.turbidity.toFixed(1)} NTU (threshold: ${thresholds.turbidityMax} NTU) at ${timestamp}`;
    await sendAlertIfAllowed(pool, ALERT_TYPES.TURBIDITY_HIGH, message);
  }
}

/**
 * Check 5-minute average egg count and trigger alert if threshold exceeded
 * @param {import('mysql2/promise').Pool} pool - MySQL connection pool
 */
async function checkEggCountAverage(pool) {
  const thresholds = getThresholds();

  // Calculate rolling 5-minute average using timestamp-based filtering
  const [result] = await pool.query(
    `SELECT AVG(avg_egg_count) AS rolling_avg, COUNT(*) AS record_count
     FROM egg_detection_summary 
     WHERE interval_end > DATE_SUB(NOW(), INTERVAL 5 MINUTE)`
  );

  if (result.length === 0 || result[0].record_count === 0) {
    console.log('No egg detection records in the last 5 minutes for averaging.');
    return;
  }

  const rollingAvg = Number(result[0].rolling_avg || 0);
  const recordCount = result[0].record_count;

  console.log(`5-minute egg count average: ${rollingAvg.toFixed(2)} (from ${recordCount} records)`);

  if (rollingAvg > thresholds.eggCountAvg) {
    const message = `[Smart Hatchery ALERT] Egg count average is HIGH: ${rollingAvg.toFixed(1)} eggs/5min (threshold: ${thresholds.eggCountAvg}) - Based on ${recordCount} detection(s)`;
    await sendAlertIfAllowed(pool, ALERT_TYPES.EGG_COUNT_HIGH, message);
  }
}

/**
 * Run all alert evaluations
 * @param {import('mysql2/promise').Pool} pool - MySQL connection pool
 */
async function runAlertEvaluation(pool) {
  if (!pool) {
    console.warn('Alert evaluation skipped - MySQL pool not available.');
    return;
  }

  console.log(`[${new Date().toISOString()}] Running alert evaluation...`);

  try {
    await checkSensorThresholds(pool);
    await checkEggCountAverage(pool);
  } catch (error) {
    console.error('Alert evaluation failed:', error.message || error);
  }
}

/**
 * Send 5-minute total egg count summary SMS (for testing)
 * @param {import('mysql2/promise').Pool} pool - MySQL connection pool
 */
async function sendEggCountSummary(pool) {
  if (!pool) {
    console.warn('Egg count summary skipped - MySQL pool not available.');
    return;
  }

  try {
    // Get total egg count from the last 5 minutes
    const [result] = await pool.query(
      `SELECT SUM(avg_egg_count) AS total_eggs, COUNT(*) AS record_count
       FROM egg_detection_summary 
       WHERE interval_end > DATE_SUB(NOW(), INTERVAL 5 MINUTE)`
    );

    const totalEggs = Number(result[0]?.total_eggs || 0);
    const recordCount = Number(result[0]?.record_count || 0);
    const timestamp = new Date().toLocaleString();

    const message = `[Smart Hatchery] 5-min Summary: Total eggs detected: ${totalEggs.toFixed(0)} (from ${recordCount} detection interval(s)) at ${timestamp}`;

    console.log(`Sending egg count summary: ${totalEggs} eggs from ${recordCount} records`);

    const smsResult = await sendSms(message);
    if (smsResult.success) {
      await logAlert(pool, 'egg_count_summary', message);
      console.log('Egg count summary SMS sent successfully.');
    } else {
      console.error('Failed to send egg count summary SMS:', smsResult.error);
    }
  } catch (error) {
    console.error('Egg count summary failed:', error.message || error);
  }
}

module.exports = {
  ALERT_TYPES,
  getThresholds,
  getCooldownMinutes,
  sendEggCountSummary,
  isInCooldown,
  logAlert,
  sendAlertIfAllowed,
  checkSensorThresholds,
  checkEggCountAverage,
  runAlertEvaluation,
};
