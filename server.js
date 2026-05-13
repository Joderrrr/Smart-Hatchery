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
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!databaseURL) {
    throw new Error('Missing FIREBASE_DATABASE_URL environment variable.');
  }

  if (serviceAccountPath) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({ 
      credential: admin.credential.cert(serviceAccount),
      databaseURL 
    });
    firebaseInitialized = true;
    return;
  }

  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({ 
      credential: admin.credential.cert(serviceAccount),
      databaseURL 
    });
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

const PERMISSIONS = {
  VIEW_SENSORS: 'view_sensors',
  TOGGLE_DETECTION: 'toggle_detection',
  EDIT_THRESHOLDS: 'edit_thresholds',
  MANAGE_SETTINGS: 'manage_settings',
  MANAGE_USERS: 'manage_users',
  MANAGE_ROLES: 'manage_roles',
  VIEW_REPORTS: 'view_reports',
  SEND_ALERTS: 'send_alerts',
};

const DEFAULT_ROLE_PERMISSIONS = {
  admin: [
    PERMISSIONS.VIEW_SENSORS,
    PERMISSIONS.TOGGLE_DETECTION,
    PERMISSIONS.EDIT_THRESHOLDS,
    PERMISSIONS.MANAGE_SETTINGS,
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.MANAGE_ROLES,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.SEND_ALERTS,
  ],
  technician: [
    PERMISSIONS.VIEW_SENSORS,
    PERMISSIONS.TOGGLE_DETECTION,
    PERMISSIONS.EDIT_THRESHOLDS,
    PERMISSIONS.SEND_ALERTS,
  ],
  viewer: [
    PERMISSIONS.VIEW_SENSORS,
    PERMISSIONS.VIEW_REPORTS,
  ],
};

function normalizePermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  return permissions.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
}

async function getUserAuthorizationContext(uid) {
  ensureFirebaseAdminInitialized();
  const db = admin.database();

  const userSnapshot = await db.ref(`/users/${uid}`).once('value');
  const user = userSnapshot.val();
  if (!user) return null;

  const roleId = String(user.roleId || user.role || '').trim();
  let roleRecord = null;
  if (roleId) {
    const roleSnapshot = await db.ref(`/roles/${roleId}`).once('value');
    roleRecord = roleSnapshot.val();
  }

  const fallbackPermissions = DEFAULT_ROLE_PERMISSIONS[roleId] || [];
  const permissions = normalizePermissions(roleRecord?.permissions);
  const resolvedPermissions = permissions.length ? permissions : fallbackPermissions;

  return {
    user,
    roleId,
    roleName: roleRecord?.name || roleId || null,
    permissions: resolvedPermissions,
  };
}

async function authenticateRequest(req, res, next) {
  try {
    ensureFirebaseAdminInitialized();
    const authHeader = String(req.headers.authorization || '');
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, message: 'Missing or invalid Authorization header.' });
    }

    const idToken = authHeader.slice(7).trim();
    if (!idToken) {
      return res.status(401).json({ ok: false, message: 'Missing Firebase ID token.' });
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.auth = decodedToken;
    return next();
  } catch (error) {
    return res.status(401).json({ ok: false, message: 'Unauthorized request.' });
  }
}

function requirePermissions(requiredPermissions, options = {}) {
  const { any = false } = options;

  return async (req, res, next) => {
    try {
      const required = normalizePermissions(requiredPermissions);
      if (!required.length) return next();

      const uid = req.auth?.uid;
      if (!uid) {
        return res.status(401).json({ ok: false, message: 'Unauthorized request.' });
      }

      const authz = await getUserAuthorizationContext(uid);
      if (!authz) {
        return res.status(403).json({ ok: false, message: 'Access denied. User profile not found.' });
      }

      const ownedPermissions = new Set(authz.permissions);
      const isAllowed = any
        ? required.some((permission) => ownedPermissions.has(permission))
        : required.every((permission) => ownedPermissions.has(permission));

      if (!isAllowed) {
        return res.status(403).json({ ok: false, message: 'Access denied. Missing required permissions.' });
      }

      req.authz = authz;
      return next();
    } catch (error) {
      return res.status(500).json({ ok: false, message: 'Failed to evaluate permissions.' });
    }
  };
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

app.post('/api/reports/egg-detections', authenticateRequest, requirePermissions([PERMISSIONS.TOGGLE_DETECTION]), async (req, res) => {
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

app.post('/api/reports/water-readings', authenticateRequest, requirePermissions([PERMISSIONS.VIEW_SENSORS]), async (req, res) => {
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

app.post('/api/reports/system-events', authenticateRequest, requirePermissions([PERMISSIONS.SEND_ALERTS]), async (req, res) => {
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

app.get('/api/reports/summary', authenticateRequest, requirePermissions([PERMISSIONS.VIEW_REPORTS]), async (req, res) => {
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

app.get('/api/reports/egg-detections', authenticateRequest, requirePermissions([PERMISSIONS.VIEW_REPORTS]), async (req, res) => {
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

app.get('/api/reports/water-readings', authenticateRequest, requirePermissions([PERMISSIONS.VIEW_REPORTS]), async (req, res) => {
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

app.get('/api/reports/system-events', authenticateRequest, requirePermissions([PERMISSIONS.VIEW_REPORTS]), async (req, res) => {
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
app.post('/api/alerts/sms', authenticateRequest, requirePermissions([PERMISSIONS.SEND_ALERTS]), async (req, res) => {
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

// ============ RBAC & USER MANAGEMENT ENDPOINTS ============

/**
 * Create a new user via Firebase Admin SDK
 * This performs the "Double Write": creates Firebase Auth user + writes to RTDB
 * Only callable by authenticated admins (client should enforce this)
 */
app.post('/api/users', authenticateRequest, requirePermissions([PERMISSIONS.MANAGE_USERS]), async (req, res) => {
  try {
    console.log('Received user creation request. Body:', JSON.stringify(req.body));

    const { email, password, name, roleId, status } = req.body;

    // Validate inputs
    if (!email || !email.trim()) {
      console.warn('Missing or empty email');
      return res.status(400).json({ ok: false, message: 'Email is required' });
    }
    if (!password || !password.trim()) {
      console.warn('Missing or empty password');
      return res.status(400).json({ ok: false, message: 'Password is required' });
    }
    if (!name || !name.trim()) {
      console.warn('Missing or empty name');
      return res.status(400).json({ ok: false, message: 'Name is required' });
    }
    if (!roleId || !String(roleId).trim()) {
      console.warn('Missing or empty roleId');
      return res.status(400).json({ ok: false, message: 'Role is required' });
    }
    if (!status || !status.trim()) {
      console.warn('Missing or empty status');
      return res.status(400).json({ ok: false, message: 'Status is required' });
    }

    // Ensure Firebase Admin is initialized
    ensureFirebaseAdminInitialized();

    const db = admin.database();
    const selectedRoleId = String(roleId).trim();
    const roleRef = db.ref(`/roles/${selectedRoleId}`);
    const roleSnapshot = await roleRef.once('value');
    const roleRecord = roleSnapshot.val();
    if (!roleRecord) {
      return res.status(400).json({ ok: false, message: 'Selected role does not exist' });
    }

    // Create user in Firebase Auth
    console.log(`Creating Firebase Auth user for: ${email}`);
    const userRecord = await admin.auth().createUser({
      email: email.trim(),
      password: password.trim(),
      displayName: name.trim(),
    });

    console.log(`✓ Created Firebase Auth user: ${userRecord.uid}`);

    // Write user data to Realtime Database
    const userRef = db.ref(`/users/${userRecord.uid}`);
    await userRef.set({
      uid: userRecord.uid,
      email: email.trim(),
      name: name.trim(),
      role: roleRecord.name || selectedRoleId,
      roleId: selectedRoleId,
      status: status.trim(),
      createdAt: new Date().toISOString(),
    });

    console.log(`✓ Wrote user data to RTDB: ${userRecord.uid}`);

    return res.status(201).json({
      ok: true,
      message: 'User created successfully',
      uid: userRecord.uid,
    });
  } catch (error) {
    console.error('Error creating user:', error.message);
    console.error('Error code:', error.code);

    // Handle common Firebase Auth errors
    let errorMessage = 'Failed to create user';
    if (error.code === 'auth/email-already-exists') {
      errorMessage = 'Email already registered';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email address format';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'Password is too weak (minimum 6 characters)';
    } else if (error.message) {
      errorMessage = error.message;
    }

    return res.status(400).json({ ok: false, message: errorMessage });
  }
});

/**
 * Get all users from Realtime Database
 */
app.get('/api/users', authenticateRequest, requirePermissions([PERMISSIONS.MANAGE_USERS]), async (req, res) => {
  try {
    ensureFirebaseAdminInitialized();

    const db = admin.database();
    const usersRef = db.ref('/users');
    const snapshot = await usersRef.once('value');
    const users = snapshot.val() || {};

    return res.json({ ok: true, users });
  } catch (error) {
    console.error('Error fetching users:', error.message);
    return res.status(500).json({ ok: false, message: 'Failed to fetch users' });
  }
});

/**
 * Get all roles from Realtime Database
 */
app.get('/api/roles', authenticateRequest, requirePermissions([PERMISSIONS.MANAGE_ROLES, PERMISSIONS.MANAGE_USERS], { any: true }), async (req, res) => {
  try {
    ensureFirebaseAdminInitialized();

    const db = admin.database();
    const rolesRef = db.ref('/roles');
    const snapshot = await rolesRef.once('value');
    const roles = snapshot.val() || {};

    return res.json({ ok: true, roles });
  } catch (error) {
    console.error('Error fetching roles:', error.message);
    return res.status(500).json({ ok: false, message: 'Failed to fetch roles' });
  }
});

app.get('/api/settings/thresholds', authenticateRequest, requirePermissions([PERMISSIONS.EDIT_THRESHOLDS, PERMISSIONS.MANAGE_SETTINGS, PERMISSIONS.VIEW_SENSORS], { any: true }), async (req, res) => {
  try {
    ensureFirebaseAdminInitialized();
    const db = admin.database();
    const snapshot = await db.ref('/settings/thresholds').once('value');
    const thresholds = snapshot.val() || {
      temperature: { min: 20, max: 32 },
      turbidity: { max: 100 },
      tds: { min: 0, max: 1000 },
    };

    return res.json({ ok: true, thresholds });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Failed to fetch thresholds' });
  }
});

app.put('/api/settings/thresholds', authenticateRequest, requirePermissions([PERMISSIONS.EDIT_THRESHOLDS, PERMISSIONS.MANAGE_SETTINGS]), async (req, res) => {
  try {
    const temperatureMin = Number(req.body?.temperature?.min);
    const temperatureMax = Number(req.body?.temperature?.max);
    const turbidityMax = Number(req.body?.turbidity?.max);
    const tdsMin = Number(req.body?.tds?.min);
    const tdsMax = Number(req.body?.tds?.max);

    if (
      [temperatureMin, temperatureMax, turbidityMax, tdsMin, tdsMax].some((value) => Number.isNaN(value))
      || temperatureMin >= temperatureMax
      || tdsMin >= tdsMax
      || turbidityMax < 0
    ) {
      return res.status(400).json({ ok: false, message: 'Invalid thresholds payload' });
    }

    ensureFirebaseAdminInitialized();
    const db = admin.database();
    const payload = {
      temperature: { min: temperatureMin, max: temperatureMax },
      turbidity: { max: turbidityMax },
      tds: { min: tdsMin, max: tdsMax },
      updatedAt: new Date().toISOString(),
      updatedBy: req.auth?.uid || null,
    };
    await db.ref('/settings/thresholds').set(payload);
    return res.json({ ok: true, thresholds: payload });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Failed to update thresholds' });
  }
});

// ============ END RBAC ENDPOINTS ============

app.get('/api/auth/context', authenticateRequest, async (req, res) => {
  try {
    const authz = await getUserAuthorizationContext(req.auth.uid);
    if (!authz) {
      return res.status(404).json({ ok: false, message: 'User profile not found.' });
    }

    return res.json({
      ok: true,
      uid: req.auth.uid,
      email: req.auth.email || authz.user.email || null,
      roleId: authz.roleId,
      roleName: authz.roleName,
      permissions: authz.permissions,
      status: authz.user.status || null,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Failed to load auth context.' });
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

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
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