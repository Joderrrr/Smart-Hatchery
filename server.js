const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config();

const { runAlertEvaluation, sendEggCountSummary } = require('./services/alert-service');

const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let mysqlPool = null;

async function initMysql() {
  const host = process.env.MYSQL_HOST || 'localhost';
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE || 'smart_hatchery';
  const port = Number(process.env.MYSQL_PORT || 3306);

  if (!user) {
    console.warn('MySQL disabled. Set MYSQL_USER to enable reports storage.');
    return;
  }

  const bootstrap = await mysql.createConnection({ host, user, password, port });
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
  await bootstrap.end();

  mysqlPool = mysql.createPool({
    host,
    user,
    password,
    database,
    port,
    waitForConnections: true,
    connectionLimit: 10,
  });

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS egg_detection_summary (
      id INT AUTO_INCREMENT PRIMARY KEY,
      interval_start DATETIME NOT NULL,
      interval_end DATETIME NOT NULL,
      tank ENUM('A','B') NOT NULL,
      avg_egg_count FLOAT NOT NULL,
      max_egg_count INT
    )
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS water_readings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      recorded_at DATETIME NOT NULL,
      temperature FLOAT,
      tds FLOAT,
      turbidity FLOAT
    )
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS system_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(50),
      message TEXT,
      created_at DATETIME NOT NULL
    )
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS alerts_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      message TEXT,
      sent_at DATETIME NOT NULL,
      INDEX idx_type_sent_at (type, sent_at)
    )
  `);
}

function getMysqlPool(res) {
  if (!mysqlPool) {
    if (res) {
      res.status(503).json({ ok: false, error: 'MySQL is not configured.' });
    }
    return null;
  }
  return mysqlPool;
}

let mailTransporter = null;
function getMailTransporter() {
  if (mailTransporter) return mailTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('Missing SMTP configuration. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
  }

  mailTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return mailTransporter;
}

let firebaseInitialized = false;
function ensureFirebaseAdminInitialized() {
  if (firebaseInitialized) return;

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountPath) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseInitialized = true;
    return;
  }

  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseInitialized = true;
    return;
  }

  throw new Error('Missing Firebase Admin credentials. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON.');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function generateTemporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

const forgotPasswordCooldownMs = 5 * 60 * 1000;
const forgotPasswordLastSent = new Map();

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    if (!email) {
      return res.status(400).json({ ok: false, error: 'Email is required.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email address format.' });
    }

    const now = Date.now();
    const lastSent = forgotPasswordLastSent.get(email);
    if (lastSent && now - lastSent < forgotPasswordCooldownMs) {
      return res.status(429).json({ ok: false, error: 'Please wait a few minutes before requesting again.' });
    }

    ensureFirebaseAdminInitialized();

    const user = await admin.auth().getUserByEmail(email);
    const tempPassword = generateTemporaryPassword();
    await admin.auth().updateUser(user.uid, { password: tempPassword });

    const transporter = getMailTransporter();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;

    await transporter.sendMail({
      from,
      to: email,
      subject: 'Temporary Password - City Agriculture Office Portal',
      text: `Your temporary password is: ${tempPassword}\n\nPlease sign in and change your password immediately.`,
    });

    forgotPasswordLastSent.set(email, now);
    return res.json({ ok: true, message: 'Temporary password sent to your email.' });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('auth/user-not-found') || msg.toLowerCase().includes('no user record')) {
      return res.status(404).json({ ok: false, error: 'No account found with this email address.' });
    }
    return res.status(500).json({ ok: false, error: 'Unable to process forgot password request.' });
  }
});

app.post('/api/reports/egg-detections', async (req, res) => {
  try {
    const pool = getMysqlPool(res);
    if (!pool) return;

    const intervalStart = new Date(req.body?.intervalStart);
    const intervalEnd = new Date(req.body?.intervalEnd);
    const tank = String(req.body?.tank || '').toUpperCase();
    const avgEggCount = Number(req.body?.avgEggCount);
    const maxEggCount = Number(req.body?.maxEggCount || 0);

    if (Number.isNaN(intervalStart.getTime()) || Number.isNaN(intervalEnd.getTime()) || Number.isNaN(avgEggCount) || !['A', 'B'].includes(tank)) {
      return res.status(400).json({ ok: false, error: 'Invalid payload.' });
    }

    await pool.query(
      'INSERT INTO egg_detection_summary (interval_start, interval_end, tank, avg_egg_count, max_egg_count) VALUES (?, ?, ?, ?, ?)',
      [intervalStart, intervalEnd, tank, avgEggCount, Number.isNaN(maxEggCount) ? null : maxEggCount]
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error('Egg detection insert failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to store egg detection summary.' });
  }
});

app.post('/api/reports/water-readings', async (req, res) => {
  try {
    const pool = getMysqlPool(res);
    if (!pool) return;

    const recordedAt = new Date(req.body?.recordedAt || Date.now());
    const temperature = req.body?.temperature;
    const tds = req.body?.tds;
    const turbidity = req.body?.turbidity;

    if (Number.isNaN(recordedAt.getTime())) {
      return res.status(400).json({ ok: false, error: 'Invalid payload.' });
    }

    await pool.query(
      'INSERT INTO water_readings (recorded_at, temperature, tds, turbidity) VALUES (?, ?, ?, ?)',
      [recordedAt, temperature ?? null, tds ?? null, turbidity ?? null]
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error('Water readings insert failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to store water readings.' });
  }
});

app.post('/api/reports/system-events', async (req, res) => {
  try {
    const pool = getMysqlPool(res);
    if (!pool) return;

    const eventType = String(req.body?.eventType || 'Notification');
    const message = String(req.body?.message || '');
    const createdAt = new Date(req.body?.createdAt || Date.now());

    if (Number.isNaN(createdAt.getTime())) {
      return res.status(400).json({ ok: false, error: 'Invalid payload.' });
    }

    await pool.query(
      'INSERT INTO system_events (event_type, message, created_at) VALUES (?, ?, ?)',
      [eventType, message, createdAt]
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error('System event insert failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to store system event.' });
  }
});

function getDateRange(req) {
  let end = req.query?.end ? new Date(req.query.end) : new Date();
  let start = req.query?.start
    ? new Date(req.query.start)
    : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(end.getTime())) {
    end = new Date();
  }
  if (Number.isNaN(start.getTime())) {
    start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  return { start, end };
}

app.get('/api/reports/summary', async (req, res) => {
  try {
    const pool = getMysqlPool(res);
    if (!pool) return;

    const { start, end } = getDateRange(req);

    const [[summary]] = await pool.query(
      'SELECT COUNT(*) AS recordCount, SUM(avg_egg_count) AS totalEggCount, AVG(avg_egg_count) AS avgEggCount FROM egg_detection_summary WHERE interval_start >= ? AND interval_end <= ?',
      [start, end]
    );

    const [tankRows] = await pool.query(
      'SELECT DISTINCT tank FROM egg_detection_summary WHERE interval_start >= ? AND interval_end <= ?',
      [start, end]
    );

    return res.json({
      totalEggDetections: Number(summary?.totalEggCount || 0),
      avgEggCountPerDetection: Number(summary?.avgEggCount || 0),
      activeTanks: tankRows.map(row => `Tank ${row.tank}`),
      recordCount: Number(summary?.recordCount || 0),
    });
  } catch (error) {
    console.error('Summary fetch failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to fetch summary.' });
  }
});

app.get('/api/reports/egg-detections', async (req, res) => {
  try {
    const pool = getMysqlPool(res);
    if (!pool) return;

    const { start, end } = getDateRange(req);
    const [rows] = await pool.query(
      'SELECT interval_start, interval_end, tank, avg_egg_count, max_egg_count FROM egg_detection_summary WHERE interval_start >= ? AND interval_end <= ? ORDER BY interval_start ASC',
      [start, end]
    );

    return res.json({ records: rows });
  } catch (error) {
    console.error('Egg detection fetch failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to fetch egg detections.' });
  }
});

app.get('/api/reports/water-readings', async (req, res) => {
  try {
    const pool = getMysqlPool(res);
    if (!pool) return;

    const { start, end } = getDateRange(req);
    const [rows] = await pool.query(
      'SELECT recorded_at, temperature, tds, turbidity FROM water_readings WHERE recorded_at >= ? AND recorded_at <= ? ORDER BY recorded_at ASC',
      [start, end]
    );

    return res.json({ records: rows });
  } catch (error) {
    console.error('Water readings fetch failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to fetch water readings.' });
  }
});

app.get('/api/reports/system-events', async (req, res) => {
  try {
    const pool = getMysqlPool(res);
    if (!pool) return;

    const { start, end } = getDateRange(req);
    const [rows] = await pool.query(
      'SELECT event_type, message, created_at FROM system_events WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC',
      [start, end]
    );

    return res.json({ records: rows });
  } catch (error) {
    console.error('System events fetch failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to fetch system events.' });
  }
});

// Serve TensorFlow.js model files
app.use('/web_model', express.static(path.join(__dirname, 'web_model')));

// Serve static files under an explicit /public prefix as well
app.use('/public', express.static(path.join(__dirname, 'public')));

// SMS relay endpoint - securely proxies TextBee API calls from the browser
app.post('/api/alerts/sms', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ ok: false, error: 'Message is required.' });
    }

    const { sendSms } = require('./services/sms-service');
    const result = await sendSms(message);

    if (result.success) {
      // Log the alert to MySQL if pool is available
      if (mysqlPool) {
        const alertType = String(req.body?.alertType || 'client_alert');
        try {
          await mysqlPool.query(
            'INSERT INTO alerts_log (type, message, sent_at) VALUES (?, ?, NOW())',
            [alertType, message]
          );
        } catch (logErr) {
          console.error('Failed to log SMS alert:', logErr.message);
        }
      }
      return res.json({ ok: true });
    } else {
      return res.status(500).json({ ok: false, error: result.error || 'SMS sending failed.' });
    }
  } catch (error) {
    console.error('SMS relay error:', error.message || error);
    return res.status(500).json({ ok: false, error: 'Failed to send SMS.' });
  }
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve login.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Optional explicit dashboard route
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/reports', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reports.html'));
});

// Catch-all: serve login page for any unmatched route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

initMysql()
  .then(() => {
    // Start alert scheduler - runs every 1 minute
    if (mysqlPool) {
      const ALERT_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
      setInterval(() => {
        runAlertEvaluation(mysqlPool);
      }, ALERT_CHECK_INTERVAL_MS);
      console.log('Alert scheduler started (runs every 1 minute).');

      // Run initial evaluation after a short delay
      setTimeout(() => runAlertEvaluation(mysqlPool), 5000);

      // Start 5-minute egg count summary SMS (for testing)
      const EGG_SUMMARY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
      setInterval(() => {
        sendEggCountSummary(mysqlPool);
      }, EGG_SUMMARY_INTERVAL_MS);
      console.log('Egg count summary SMS scheduler started (runs every 5 minutes).');

      // Send initial summary after 10 seconds
      setTimeout(() => sendEggCountSummary(mysqlPool), 10000);
    }
  })
  .catch((error) => {
    console.error('Failed to initialize MySQL:', error);
  });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;









