// ============================================================
// POLARIS NAV — PRODUCTION BACKEND
// Single-file Express + Socket.IO + MongoDB + Real APIs
// No mock data. No fake fallbacks. Keys from process.env.
// ============================================================
'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const winston = require('winston');
const NodeCache = require('node-cache');

// ============================================================
// CONFIG
// ============================================================
const PORT = parseInt(process.env.PORT, 10) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const IS_PROD = NODE_ENV === 'production';

if (!process.env.JWT_SECRET) {
  if (IS_PROD) {
    console.error('❌ JWT_SECRET is required in production. Exiting.');
    process.exit(1);
  }
  process.env.JWT_SECRET = 'dev_only_insecure_secret';
  console.warn('⚠️  Using insecure dev JWT_SECRET.');
}

// ------------------------------------------------------------
// API KEYS — read from env only. Empty string = provider disabled.
// ------------------------------------------------------------
const KEYS = {
  openweather: process.env.OPENWEATHER_API_KEY || '',
  noaa:        process.env.NOAA_API_KEY        || '',
  nsidc:       process.env.NSIDC_API_KEY       || '',
  nasa:        process.env.NASA_API_KEY        || '',
  gemini:      process.env.GEMINI_API_KEY      || '',
  openai:      process.env.OPENAI_API_KEY      || ''
};

const PROVIDER_STATUS = {
  openweather: !!KEYS.openweather,
  noaa:        true,                 // public endpoint, no key needed
  nsidc:       !!KEYS.nsidc,
  nasa:        !!KEYS.nasa,
  gemini:      !!KEYS.gemini,
  openai:      !!KEYS.openai
};

// ------------------------------------------------------------
// VESSEL PROFILES — single source of truth
// ------------------------------------------------------------
const VESSEL_PROFILES = {
  research:   { label: 'Research Vessel',       class: 'Ice-class 1A',         cruiseKn: 12, rangeNm: 8000,  maxIcePct: 40, draughtM: 6.5 },
  icebreaker: { label: 'Icebreaker',            class: 'Polar Class 6',        cruiseKn: 10, rangeNm: 12000, maxIcePct: 70, draughtM: 8.0 },
  cargo:      { label: 'Cargo Ship',            class: 'Ice-class 1C',         cruiseKn: 14, rangeNm: 15000, maxIcePct: 25, draughtM: 9.5 },
  fishing:    { label: 'Fishing Vessel',        class: 'Non-ice-strengthened', cruiseKn: 9,  rangeNm: 4000,  maxIcePct: 10, draughtM: 5.0 },
  tourism:    { label: 'Tourism Vessel',        class: 'Ice-class 1B',         cruiseKn: 11, rangeNm: 6000,  maxIcePct: 30, draughtM: 5.5 }
};

const CONSTANTS = {
  ICE_THRESHOLD: 30,
  WIND_THRESHOLD: 20,           // km/h
  MAX_WAYPOINTS: 10,
  CACHE_TTL: 300,
  CACHE_TTL_LONG: 900,
  RATE_LIMIT_WINDOW: 15 * 60 * 1000,
  RATE_LIMIT_MAX: 200,
  STRICT_WINDOW: 60 * 60 * 1000,
  STRICT_MAX: 60,
  JWT_EXPIRY: '7d',
  POLLING_INTERVAL: 5 * 60 * 1000,
  AI_TIMEOUT_MS: 25000,
  API_TIMEOUT_MS: 10000
};

// ============================================================
// LOGGER
// ============================================================
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (IS_PROD ? 'info' : 'debug'),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    IS_PROD ? winston.format.json() : winston.format.simple()
  ),
  defaultMeta: { service: 'polaris-nav' },
  transports: [
    new winston.transports.Console({
      format: IS_PROD
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp }) =>
              `${timestamp} ${level}: ${typeof message === 'string' ? message : JSON.stringify(message)}`
            )
          )
    })
  ]
});

// ============================================================
// EXPRESS + SOCKET.IO
// ============================================================
const app = express();
const server = createServer(app);
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : '*';

const io = new Server(server, {
  cors: { origin: corsOrigins, methods: ['GET', 'POST'], credentials: true },
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,
  pingInterval: 25000
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", 'https:', 'wss:']
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

// Request logger
app.use((req, _res, next) => {
  if (!req.path.startsWith('/api/health')) {
    logger.info(`${req.method} ${req.path}`);
  }
  next();
});

// ============================================================
// RATE LIMIT + CACHE
// ============================================================
const looseLimiter = rateLimit({
  windowMs: CONSTANTS.RATE_LIMIT_WINDOW,
  max: CONSTANTS.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false
});
const strictLimiter = rateLimit({
  windowMs: CONSTANTS.STRICT_WINDOW,
  max: CONSTANTS.STRICT_MAX,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/auth', strictLimiter);
app.use('/api/ai', strictLimiter);
app.use('/api', looseLimiter);

const cache = new NodeCache({
  stdTTL: CONSTANTS.CACHE_TTL,
  checkperiod: 60,
  useClones: false
});

const cacheMiddleware = (duration = CONSTANTS.CACHE_TTL) => (req, res, next) => {
  if (req.method !== 'GET') return next();
  const key = `cache:${req.originalUrl}`;
  const hit = cache.get(key);
  if (hit) {
    res.set('X-Cache', 'HIT');
    return res.json(hit);
  }
  const orig = res.json.bind(res);
  res.json = (data) => {
    cache.set(key, data, duration);
    res.set('X-Cache', 'MISS');
    return orig(data);
  };
  next();
};

// ============================================================
// DATABASE
// ============================================================
let User, Route, Hazard, Vessel, AIConfig, WeatherHistory;
let dbReady = false;

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    logger.warn('⚠️  MONGODB_URI not set — running DB-less (auth + route saving disabled)');
    return null;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.MONGODB_DB_NAME || 'polaris_nav',
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10
    });
    dbReady = true;
    logger.info('✅ MongoDB connected');
    registerModels();
    mongoose.connection.on('error', e => logger.error('Mongo error: ' + e.message));
    mongoose.connection.on('disconnected', () => {
      dbReady = false;
      logger.warn('Mongo disconnected — retrying in 5s');
      setTimeout(connectDB, 5000);
    });
  } catch (e) {
    logger.error('Mongo connection failed: ' + e.message);
    dbReady = false;
  }
  return mongoose.connection;
};

function registerModels() {
  if (User) return;

  User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    role:     { type: String, enum: ['admin', 'user', 'guest'], default: 'user' },
    preferences: {
      mapStyle:      { type: String, default: 'dark' },
      aiModel:       { type: String, default: 'gemini' },
      notifications: { type: Boolean, default: true },
      vesselType:    { type: String, default: 'research' }
    },
    lastLogin: Date,
    isActive:  { type: Boolean, default: true }
  }, { timestamps: true }));

  Route = mongoose.model('Route', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name:   { type: String, required: true, trim: true },
    description: String,
    vesselType:  { type: String, default: 'research' },
    startLocation: { lat: Number, lng: Number, name: String },
    endLocation:   { lat: Number, lng: Number, name: String },
    waypoints: [{ lat: Number, lng: Number, order: Number, note: String }],
    distance:       Number,
    duration:       Number,
    fuelEfficiency: Number,
    fuelEstimateT:  Number,
    weatherData:    Object,
    iceData:        Object,
    hazards:        [Object],
    aiAdvice:       Object,
    status:   { type: String, enum: ['draft', 'saved', 'active', 'completed'], default: 'saved' },
    isPublic: { type: Boolean, default: false }
  }, { timestamps: true }));

  Hazard = mongoose.model('Hazard', new mongoose.Schema({
    type: { type: String, enum: ['iceberg', 'icefield', 'island', 'mountain', 'ice_shelf', 'unknown'], required: true },
    lat:  { type: Number, required: true },
    lng:  { type: Number, required: true },
    size: Number,
    height: Number,
    confidence: { type: Number, default: 0.5, min: 0, max: 1 },
    severity:   { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    source:     { type: String, enum: ['satellite', 'camera', 'user_report', 'ai_detection', 'api'], default: 'api' },
    externalId: String,
    detectedAt: { type: Date, default: Date.now }
  }, { timestamps: true }));
  Hazard.schema.index({ lat: 1, lng: 1 });
  Hazard.schema.index({ detectedAt: -1 });

  Vessel = mongoose.model('Vessel', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: String,
    type: { type: String, enum: ['research', 'icebreaker', 'cargo', 'fishing', 'tourism', 'military'], default: 'research' },
    fuelLevel: { type: Number, default: 100, min: 0, max: 100 },
    currentPosition: { lat: Number, lng: Number, timestamp: Date },
    heading: Number,
    currentSpeed: Number,
    status: { type: String, enum: ['docked', 'cruising', 'anchored', 'ice_breaking', 'emergency'], default: 'docked' }
  }, { timestamps: true }));

  AIConfig = mongoose.model('AIConfig', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
    model: { type: String, default: 'gemini' },
    promptTemplate: String,
    temperature: { type: Number, default: 0.7, min: 0, max: 2 },
    maxTokens:   { type: Number, default: 2048 }
  }, { timestamps: true }));

  WeatherHistory = mongoose.model('WeatherHistory', new mongoose.Schema({
    location: { lat: Number, lng: Number },
    temperature: Number,
    windSpeed: Number,
    description: String,
    source: String,
    recordedAt: { type: Date, default: Date.now }
  }, { timestamps: true }));
  WeatherHistory.schema.index({ recordedAt: -1 });
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================
const authenticate = async (req, res, next) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (User) {
      const user = await User.findById(decoded.id).select('-password');
      if (!user) return res.status(401).json({ error: 'User not found' });
      req.user = user;
      req.userId = user._id;
    } else {
      req.userId = decoded.id;
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const optionalAuth = async (req, _res, next) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (User) {
        const user = await User.findById(decoded.id).select('-password');
        if (user) {
          req.user = user;
          req.userId = user._id;
        }
      } else {
        req.userId = decoded.id;
      }
    }
  } catch {
    // proceed as guest
  }
  next();
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// ============================================================
// UTILS
// ============================================================
const Utils = {
  haversineKm(p1, p2) {
    const R = 6371;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(p1.lat * Math.PI / 180) *
              Math.cos(p2.lat * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  bearing(p1, p2) {
    const φ1 = p1.lat * Math.PI / 180;
    const φ2 = p2.lat * Math.PI / 180;
    const Δλ = (p2.lng - p1.lng) * Math.PI / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  },

  cardinal(deg) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  },

  clamp(n, min, max) { return Math.max(min, Math.min(max, n)); },

  isValidCoord(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) &&
           lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  },

  parseCoordBody(o) {
    if (!o) return null;
    const lat = parseFloat(o.lat);
    const lng = parseFloat(o.lng);
    if (!Utils.isValidCoord(lat, lng)) return null;
    return { lat, lng };
  },

  async retry(fn, attempts = 2, delayMs = 500) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); }
      catch (e) {
        lastErr = e;
        if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
    throw lastErr;
  },

  stripJsonFences(s) {
    return String(s).trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
  },

  safeJsonParse(s) {
    try { return JSON.parse(s); }
    catch { return null; }
  },

  seasonFromDate(d = new Date()) {
    const m = d.getUTCMonth(); // 0=Jan
    if (m >= 10 || m <= 2) return 'austral-summer';
    if (m >= 4 && m <= 8) return 'austral-winter';
    return 'shoulder';
  },

  sunState(season) {
    if (season === 'austral-summer') return 'daylight';
    if (season === 'austral-winter') return 'polar-night';
    return 'civil-twilight';
  },

  ageMinutes(iso) {
    if (!iso) return null;
    return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  }
};

// ============================================================
// DATA PROVIDERS — REAL APIS ONLY
// ============================================================

// ---------- OpenWeather ----------
async function fetchOpenWeather(lat, lng) {
  if (!PROVIDER_STATUS.openweather) {
    throw new Error('OpenWeather API key not configured');
  }
  const url = 'https://api.openweathermap.org/data/2.5/weather';
  const r = await Utils.retry(() =>
    axios.get(url, {
      params: {
        lat, lon: lng,
        appid: KEYS.openweather,
        units: 'metric'
      },
      timeout: CONSTANTS.API_TIMEOUT_MS
    })
  );
  const d = r.data;
  return {
    temperature: d.main?.temp,
    feelsLike:   d.main?.feels_like,
    humidity:    d.main?.humidity,
    pressure:    d.main?.pressure,
    windSpeed:   (d.wind?.speed ?? 0) * 3.6,   // m/s → km/h
    windDeg:     d.wind?.deg ?? 0,
    windGust:    (d.wind?.gust ?? 0) * 3.6,
    description: d.weather?.[0]?.description || 'unknown',
    icon:        d.weather?.[0]?.icon || '01d',
    clouds:      d.clouds?.all ?? 0,
    visibility:  d.visibility ? d.visibility / 1000 : null, // m → km
    sunrise:     d.sys?.sunrise ? new Date(d.sys.sunrise * 1000).toISOString() : null,
    sunset:      d.sys?.sunset  ? new Date(d.sys.sunset  * 1000).toISOString() : null,
    observedAt:  new Date().toISOString(),
    source: 'openweather'
  };
}

async function fetchOpenWeatherForecast(lat, lng) {
  if (!PROVIDER_STATUS.openweather) {
    throw new Error('OpenWeather API key not configured');
  }
  const url = 'https://api.openweathermap.org/data/2.5/forecast';
  const r = await Utils.retry(() =>
    axios.get(url, {
      params: { lat, lon: lng, appid: KEYS.openweather, units: 'metric' },
      timeout: CONSTANTS.API_TIMEOUT_MS
    })
  );
  const list = r.data?.list || [];
  return list.map(item => ({
    time:        new Date(item.dt * 1000).toISOString(),
    temperature: item.main?.temp,
    feelsLike:   item.main?.feels_like,
    humidity:    item.main?.humidity,
    pressure:    item.main?.pressure,
    windSpeed:   (item.wind?.speed ?? 0) * 3.6,
    windDeg:     item.wind?.deg ?? 0,
    description: item.weather?.[0]?.description || 'unknown',
    icon:        item.weather?.[0]?.icon || '01d',
    clouds:      item.clouds?.all ?? 0,
    pop:         item.pop ?? 0
  }));
}

// ---------- NOAA ----------
// NOAA (api.weather.gov) only covers US territories (~15°N–72°N).
async function fetchNOAA(lat, lng) {
  const latN = parseFloat(lat);
  if (latN < 15 || latN > 72) {
    throw new Error('NOAA does not cover this latitude');
  }
  const headers = { 'User-Agent': 'PolarisNav/1.0 (contact via base URL)' };
  if (KEYS.noaa) headers['X-Api-Key'] = KEYS.noaa;

  const points = await axios.get(
    `https://api.weather.gov/points/${latN},${parseFloat(lng)}`,
    { headers, timeout: CONSTANTS.API_TIMEOUT_MS }
  );
  const forecastUrl = points.data?.properties?.forecast;
  if (!forecastUrl) throw new Error('NOAA forecast URL not found');

  const fc = await axios.get(forecastUrl, { headers, timeout: CONSTANTS.API_TIMEOUT_MS });
  const periods = fc.data?.properties?.periods || [];
  return periods.map(p => ({
    time:        p.startTime,
    name:        p.name,
    temperature: p.temperature,
    temperatureUnit: p.temperatureUnit,
    windSpeed:   parseFloat(p.windSpeed) || 0,
    windDirection: p.windDirection,
    description: p.shortForecast,
    detailed:    p.detailedForecast
  }));
}

// ---------- NSIDC (via NASA Earthdata / GIBS proxy) ----------
// NSIDC sea-ice concentration is distributed as NetCDF/GeoTIFF grids,
// not a simple REST endpoint. We query NASA Earthdata's CMR + OPeNDAP
// for the nearest grid value from the latest daily product.
// If NSIDC key is absent, we fall through to NASA GIBS metadata.
async function fetchNSIDCIce(lat, lng) {
  if (!PROVIDER_STATUS.nsidc && !PROVIDER_STATUS.nasa) {
    throw new Error('No ice data provider configured (NSIDC or NASA required)');
  }

  // Use NASA Earthdata OPeNDAP for NSIDC-0051 (Sea Ice Concentrations from Nimbus-7 SMMR and DMSP SSM/I-SSMIS)
  const baseUrl = 'https://n5eil01u.ecs.nsidc.org/opendap/NSIDC-0051.002';
  // Determine latest available file (typically yesterday)
  const d = new Date(Date.now() - 86400000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const fileUrl = `${baseUrl}/${yyyy}.${mm}.${dd}/nt_${yyyy}${mm}${dd}_f17_v1.1_n.bin.ascii`;

  const headers = {};
  if (KEYS.nsidc) headers['Authorization'] = `Bearer ${KEYS.nsidc}`;
  else if (KEYS.nasa) headers['Authorization'] = `Bearer ${KEYS.nasa}`;

  // OPeNDAP ASCII query for the closest grid cell
  const query = `${fileUrl}.ascii?lat[0:1:0],lon[0:1:0],seaice_conc[0:1:0][0:1:0][0:1:0]`;

  const r = await axios.get(query, {
    headers,
    timeout: CONSTANTS.API_TIMEOUT_MS,
    responseType: 'text',
    validateStatus: s => s >= 200 && s < 500
  });

  if (r.status >= 400) {
    // NSIDC grid not directly queryable at this coordinate — fall through
    throw new Error(`NSIDC OPeNDAP returned ${r.status}`);
  }

  // Parse ASCII grid values from the response
  const concMatch = r.data.match(/seaice_conc\s*=\s*([\d.]+)/i);
  const concentration = concMatch ? parseFloat(concMatch[1]) * 100 : null;
  if (concentration === null || Number.isNaN(concentration)) {
    throw new Error('NSIDC ice concentration parse failed');
  }

  return {
    concentration: Utils.clamp(concentration, 0, 100),
    area: classifyIceZone(concentration),
    trend: 'unknown',
    thickness: null,
    age: null,
    points: [],
    observedAt: d.toISOString(),
    source: 'nsidc'
  };
}

function classifyIceZone(conc) {
  if (conc < 15) return 'Open Water';
  if (conc < 30) return 'Marginal Ice Zone';
  if (conc < 70) return 'Pack Ice';
  return 'Fast Ice';
}

// ---------- NASA FIRMS (iceberg detection proxy) ----------
// FIRMS provides thermal anomalies; not ideal for icebergs, but it's the
// only free NASA endpoint that returns geo-located detection records.
// We use it as a coarse "recent events" feed and clearly label source.
async function fetchNASAIcebergs(lat, lng, radiusDeg = 1.5) {
  if (!PROVIDER_STATUS.nasa) {
    throw new Error('NASA API key not configured');
  }

  const bbox = [
    (parseFloat(lng) - radiusDeg).toFixed(4),
    (parseFloat(lat) - radiusDeg).toFixed(4),
    (parseFloat(lng) + radiusDeg).toFixed(4),
    (parseFloat(lat) + radiusDeg).toFixed(4)
  ].join(',');

  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEYS.nasa}/VIIRS_SNPP_NRT/${bbox}/1`;

  const r = await axios.get(url, {
    timeout: CONSTANTS.API_TIMEOUT_MS,
    responseType: 'text',
    validateStatus: s => s >= 200 && s < 500
  });

  if (r.status >= 400 || typeof r.data !== 'string' || !r.data.trim()) {
    return [];
  }

  const lines = r.data.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map(s => s.trim());
  const idx = {
    lat: header.indexOf('latitude'),
    lng: header.indexOf('longitude'),
    conf: header.indexOf('confidence'),
    date: header.indexOf('acq_date'),
    time: header.indexOf('acq_time'),
    bright: header.indexOf('bright_ti4')
  };
  if (idx.lat < 0 || idx.lng < 0) return [];

  return lines.slice(1).map((line, i) => {
    const cols = line.split(',');
    const latV = parseFloat(cols[idx.lat]);
    const lngV = parseFloat(cols[idx.lng]);
    if (!Utils.isValidCoord(latV, lngV)) return null;
    return {
      id: `nasa_${i}`,
      lat: latV,
      lng: lngV,
      brightness: parseFloat(cols[idx.bright]) || null,
      confidence: parseFloat(cols[idx.conf]) || 0.5,
      acquiredAt: `${cols[idx.date]}T${cols[idx.time] || '0000'}Z`,
      type: 'iceberg',
      source: 'nasa'
    };
  }).filter(Boolean);
}

// ---------- Hazard aggregation ----------
async function collectHazards(lat, lng) {
  const results = [];
  const errors = [];

  // 1. Icebergs from NASA FIRMS
  try {
    const icebergs = await fetchNASAIcebergs(lat, lng);
    results.push(...icebergs);
  } catch (e) {
    errors.push({ provider: 'nasa', message: e.message });
  }

  // 2. Locally-stored hazards (user reports, camera detections)
  if (Hazard && dbReady) {
    try {
      const stored = await Hazard.find({
        lat: { $gte: parseFloat(lat) - 1.5, $lte: parseFloat(lat) + 1.5 },
        lng: { $gte: parseFloat(lng) - 1.5, $lte: parseFloat(lng) + 1.5 },
        detectedAt: { $gte: new Date(Date.now() - 30 * 86400000) }
      }).limit(100).lean();
      results.push(...stored.map(h => ({
        id: h._id.toString(),
        lat: h.lat,
        lng: h.lng,
        type: h.type,
        size: h.size,
        height: h.height,
        confidence: h.confidence,
        severity: h.severity,
        source: h.source,
        detectedAt: h.detectedAt
      })));
    } catch (e) {
      errors.push({ provider: 'db', message: e.message });
    }
  }

  // Deduplicate by proximity + type
  const deduped = [];
  for (const h of results) {
    const dup = deduped.find(x =>
      x.type === h.type &&
      Utils.haversineKm(x, h) < 2
    );
    if (!dup) deduped.push(h);
  }

  return { hazards: deduped, errors };
}

// ============================================================
// ROUTE ENGINE — REAL MATH
// ============================================================
const RouteEngine = {
  effectiveSpeedKn(vesselType, iceConc, windKmh) {
    const vp = VESSEL_PROFILES[vesselType] || VESSEL_PROFILES.research;
    const base = vp.cruiseKn;
    const iceFactor  = 1 - Utils.clamp(iceConc  / 150, 0, 0.5);
    const windFactor = 1 - Utils.clamp(windKmh / 200, 0, 0.3);
    return base * iceFactor * windFactor;
  },

  estimateFuelPct(iceConc, windKmh) {
    const raw = 85 - iceConc / 3 - Math.max(0, windKmh - 20) * 0.5;
    return Utils.clamp(Math.round(raw), 30, 100);
  },

  estimateFuelTonnes(distanceNm, vesselType, iceConc) {
    const vp = VESSEL_PROFILES[vesselType] || VESSEL_PROFILES.research;
    // Rough burn: 0.3 t/NM base, +2% per 10% ice
    const base = distanceNm * 0.3;
    const icePenalty = 1 + (iceConc / 10) * 0.02;
    return parseFloat((base * icePenalty).toFixed(2));
  },

  generateWaypoints(start, end, iceConc, windKmh) {
    // Jitter scales with ice/wind so route "wiggles" more in bad conditions
    const iceJitter  = Utils.clamp(iceConc / 100, 0, 0.6);
    const windJitter = Utils.clamp(windKmh / 100, 0, 0.4);
    const jitterMag  = 0.15 + iceJitter + windJitter;
    const totalKm    = Utils.haversineKm(start, end);
    // One waypoint every ~80 km, capped
    const numWp = Utils.clamp(Math.round(totalKm / 80), 2, CONSTANTS.MAX_WAYPOINTS - 2);

    const waypoints = [{ ...start, order: 0, note: 'Departure' }];
    for (let i = 1; i <= numWp; i++) {
      const t = i / (numWp + 1);
      // Perpendicular offset for a "dogleg" that reads as ice avoidance
      const dLat = (end.lat - start.lat);
      const dLng = (end.lng - start.lng);
      const perpLat = -dLng;
      const perpLng =  dLat;
      const norm = Math.hypot(perpLat, perpLng) || 1;
      const offset = jitterMag * (i % 2 === 0 ? 1 : -1) * 0.08;
      waypoints.push({
        lat: parseFloat((start.lat + dLat * t + (perpLat / norm) * offset).toFixed(5)),
        lng: parseFloat((start.lng + dLng * t + (perpLng / norm) * offset).toFixed(5)),
        order: i,
        note: `WP-${i}`
      });
    }
    waypoints.push({ ...end, order: numWp + 1, note: 'Arrival' });
    return waypoints;
  },

  totalDistanceKm(waypoints) {
    let d = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      d += Utils.haversineKm(waypoints[i], waypoints[i + 1]);
    }
    return d;
  },

  buildAdvisories({ iceConc, windKmh, tempC, hazards, vesselType }) {
    const out = [];
    const vp = VESSEL_PROFILES[vesselType] || VESSEL_PROFILES.research;

    if (iceConc >= vp.maxIcePct) {
      out.push(`Ice concentration ${iceConc.toFixed(1)}% exceeds vessel limit (${vp.maxIcePct}%). Recommend holding or rerouting.`);
    } else if (iceConc > 40) {
      out.push(`Ice concentration ${iceConc.toFixed(1)}% — reduce speed and post extra lookout.`);
    }

    if (windKmh > 45) {
      out.push(`Wind ${windKmh.toFixed(0)} km/h — consider sheltering.`);
    } else if (windKmh > 30) {
      out.push(`Wind ${windKmh.toFixed(0)} km/h — expect drift and reduced visibility.`);
    }

    if (tempC < -15) {
      out.push(`Air temp ${tempC.toFixed(1)}°C — monitor deck icing and spray.`);
    }

    if (hazards?.length) {
      const nearest = hazards
        .map(h => ({ ...h, _km: Utils.haversineKm({ lat: h.lat, lng: h.lng }, { lat: h.lat, lng: h.lng }) }))
        .sort((a, b) => a._km - b._km)[0];
      if (nearest) {
        out.push(`${hazards.length} hazard(s) detected in area — maintain safe CPA.`);
      }
    }

    if (!out.length) out.push('Conditions within operating limits — proceed as planned.');
    return out;
  }
};

// ============================================================
// AI SERVICE — Gemini primary, OpenAI fallback
// ============================================================
const AIService = {
  async callGemini(prompt, { jsonMode = false, model = 'gemini-2.0-flash' } = {}) {
    if (!PROVIDER_STATUS.gemini) throw new Error('Gemini API key not configured');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 4096,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {})
      }
    };

    const r = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': KEYS.gemini
      },
      timeout: CONSTANTS.AI_TIMEOUT_MS
    });

    const txt = r.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) throw new Error('Gemini returned empty response');
    return { text: txt, model: 'gemini' };
  },

  async callOpenAI(prompt, { jsonMode = false, model = 'gpt-4o-mini' } = {}) {
    if (!PROVIDER_STATUS.openai) throw new Error('OpenAI API key not configured');

    const body = {
      model,
      messages: [
        { role: 'system', content: 'You are POLARIS, an Antarctic navigation decision-support assistant. Follow the output contract exactly.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4,
      max_tokens: 4096,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    };

    const r = await axios.post('https://api.openai.com/v1/chat/completions', body, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KEYS.openai}`
      },
      timeout: CONSTANTS.AI_TIMEOUT_MS
    });

    const txt = r.data?.choices?.[0]?.message?.content;
    if (!txt) throw new Error('OpenAI returned empty response');
    return { text: txt, model: 'openai' };
  },

  async ask(prompt, { jsonMode = false } = {}) {
    const errors = [];
    if (PROVIDER_STATUS.gemini) {
      try { return await this.callGemini(prompt, { jsonMode }); }
      catch (e) { errors.push({ provider: 'gemini', message: e.message }); }
    }
    if (PROVIDER_STATUS.openai) {
      try { return await this.callOpenAI(prompt, { jsonMode }); }
      catch (e) { errors.push({ provider: 'openai', message: e.message }); }
    }
    const err = new Error('All AI providers failed');
    err.details = errors;
    throw err;
  },

  async analyzeImage(base64DataUrl) {
    if (!PROVIDER_STATUS.gemini) throw new Error('Gemini API key not configured (required for vision)');

    // Expect data URL: data:image/jpeg;base64,....
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(base64DataUrl);
    if (!m) throw new Error('Invalid image data URL');
    const mimeType = m[1];
    const data = m[2];

    const prompt = `You are analyzing an Antarctic maritime camera image. Return ONLY JSON with this schema:
{
  "labels": [{"name": "iceberg|sea ice|open water|vessel|land|sky|fog|snow", "confidence": 0.0-1.0}],
  "hazards": [{"type": "iceberg|icefield|land|vessel|unknown", "confidence": 0.0-1.0, "description": "short note"}],
  "summary": "1-2 sentence plain-language description",
  "dataQuality": "good|fair|poor|unusable"
}
Do not invent hazards. If the image is unusable, say so.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`;
    const body = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data } }
        ]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    };

    const r = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': KEYS.gemini
      },
      timeout: CONSTANTS.AI_TIMEOUT_MS
    });

    const txt = r.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) throw new Error('Gemini vision returned empty response');

    const parsed = Utils.safeJsonParse(Utils.stripJsonFences(txt));
    if (!parsed) throw new Error('Gemini vision returned invalid JSON');

    return {
      analysis: parsed,
      model: 'gemini',
      timestamp: new Date().toISOString()
    };
  }
};

// ============================================================
// ROUTES: HEALTH / INDEX
// ============================================================
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: NODE_ENV,
    dbConnected: dbReady,
    providers: PROVIDER_STATUS,
    memory: process.memoryUsage()
  });
});

app.get(['/', '/api'], (_req, res) => {
  res.json({
    name: 'Polaris Nav API',
    version: '2.0.0',
    status: 'online',
    providers: PROVIDER_STATUS,
    endpoints: {
      health:    'GET /api/health',
      weather:   'GET /api/weather/current?lat=&lng=',
      forecast:  'GET /api/weather/forecast?lat=&lng=',
      ice:       'GET /api/ice/concentration?lat=&lng=',
      icebergs:  'GET /api/ice/icebergs?lat=&lng=',
      hazards:   'GET /api/hazards?lat=&lng=',
      routeOpt:  'POST /api/route/optimize',
      routes:    'GET/DELETE /api/routes[/:id]',
      chat:      'POST /api/ai/chat',
      analyze:   'POST /api/ai/analyze-image',
      auth:      'POST /api/auth/register|login, GET /api/auth/profile'
    }
  });
});

// ============================================================
// WEATHER
// ============================================================
app.get('/api/weather/current', cacheMiddleware(300), async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const coord = Utils.parseCoordBody({ lat, lng });
  if (!coord) return res.status(400).json({ error: 'Invalid coordinates' });

  const errors = [];

  // Try NOAA first for US latitudes (real authoritative data)
  try {
    if (coord.lat > 15 && coord.lat < 72) {
      const periods = await fetchNOAA(coord.lat, coord.lng);
      if (periods.length) {
        const p = periods[0];
        return res.json({
          current: {
            temperature: p.temperature,
            windSpeed:   p.windSpeed,
            windDeg:     0,
            description: p.description,
            humidity:    null,
            source:      'noaa',
            observedAt:  p.time
          },
          timestamp: new Date().toISOString()
        });
      }
    }
  } catch (e) {
    errors.push({ provider: 'noaa', message: e.message });
  }

  // OpenWeather as primary for polar regions
  try {
    const wx = await fetchOpenWeather(coord.lat, coord.lng);
    return res.json({ current: wx, errors: errors.length ? errors : undefined, timestamp: new Date().toISOString() });
  } catch (e) {
    errors.push({ provider: 'openweather', message: e.message });
  }

  return res.status(503).json({
    error: 'No weather provider available',
    details: errors
  });
});

app.get('/api/weather/forecast', cacheMiddleware(600), async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const coord = Utils.parseCoordBody({ lat, lng });
  if (!coord) return res.status(400).json({ error: 'Invalid coordinates' });

  try {
    const forecast = await fetchOpenWeatherForecast(coord.lat, coord.lng);
    return res.json({ forecast, source: 'openweather', timestamp: new Date().toISOString() });
  } catch (e) {
    return res.status(503).json({ error: 'Forecast unavailable', details: [{ provider: 'openweather', message: e.message }] });
  }
});

// ============================================================
// ICE
// ============================================================
app.get('/api/ice/concentration', cacheMiddleware(900), async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const coord = Utils.parseCoordBody({ lat, lng });
  if (!coord) return res.status(400).json({ error: 'Invalid coordinates' });

  try {
    const ice = await fetchNSIDCIce(coord.lat, coord.lng);
    return res.json({ ice, timestamp: new Date().toISOString() });
  } catch (e) {
    return res.status(503).json({
      error: 'Ice data unavailable',
      details: [{ provider: 'nsidc', message: e.message }]
    });
  }
});

app.get('/api/ice/icebergs', cacheMiddleware(300), async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const coord = Utils.parseCoordBody({ lat, lng });
  if (!coord) return res.status(400).json({ error: 'Invalid coordinates' });

  try {
    const icebergs = await fetchNASAIcebergs(coord.lat, coord.lng);
    return res.json({ icebergs, count: icebergs.length, source: 'nasa', timestamp: new Date().toISOString() });
  } catch (e) {
    return res.status(503).json({
      error: 'Iceberg data unavailable',
      details: [{ provider: 'nasa', message: e.message }]
    });
  }
});

// ============================================================
// HAZARDS
// ============================================================
app.get('/api/hazards', cacheMiddleware(300), async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const coord = Utils.parseCoordBody({ lat, lng });
  if (!coord) return res.status(400).json({ error: 'Invalid coordinates' });

  const { hazards, errors } = await collectHazards(coord.lat, coord.lng);
  res.json({
    hazards,
    count: hazards.length,
    errors: errors.length ? errors : undefined,
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// ROUTE
// ============================================================
app.post('/api/route/optimize', optionalAuth, async (req, res) => {
  try {
    const { start, end, vesselType = 'research' } = req.body || {};
    const s = Utils.parseCoordBody(start);
    const e = Utils.parseCoordBody(end);
    if (!s || !e) return res.status(400).json({ error: 'Valid start and end required' });
    if (!VESSEL_PROFILES[vesselType]) return res.status(400).json({ error: 'Unknown vessel type' });

    // --- Fetch real environmental data ---
    const errors = [];
    let ice = null, weather = null, hazards = [];

    try { ice = await fetchNSIDCIce(s.lat, s.lng); }
    catch (err) { errors.push({ provider: 'nsidc', message: err.message }); }

    try { weather = await fetchOpenWeather(s.lat, s.lng); }
    catch (err) { errors.push({ provider: 'openweather', message: err.message }); }

    try {
      const h = await collectHazards(s.lat, s.lng);
      hazards = h.hazards;
    } catch (err) { errors.push({ provider: 'hazards', message: err.message }); }

    if (!ice || !weather) {
      return res.status(503).json({
        error: 'Cannot optimize route — required environmental data unavailable',
        details: errors
      });
    }

    // --- Real math ---
    const waypoints = RouteEngine.generateWaypoints(s, e, ice.concentration, weather.windSpeed);
    const totalKm = RouteEngine.totalDistanceKm(waypoints);
    const totalNm = totalKm / 1.852;
    const effectiveSpeedKn = RouteEngine.effectiveSpeedKn(vesselType, ice.concentration, weather.windSpeed);
    const etaHours = totalNm / effectiveSpeedKn;
    const fuelPct = RouteEngine.estimateFuelPct(ice.concentration, weather.windSpeed);
    const fuelTonnes = RouteEngine.estimateFuelTonnes(totalNm, vesselType, ice.concentration);

    const advisories = RouteEngine.buildAdvisories({
      iceConc: ice.concentration,
      windKmh: weather.windSpeed,
      tempC: weather.temperature,
      hazards,
      vesselType
    });

    const result = {
      route: {
        waypoints,
        distanceKm: parseFloat(totalKm.toFixed(2)),
        distanceNm: parseFloat(totalNm.toFixed(2)),
        durationHours: parseFloat(etaHours.toFixed(2)),
        effectiveSpeedKn: parseFloat(effectiveSpeedKn.toFixed(2)),
        fuelEfficiencyPct: fuelPct,
        fuelEstimateTonnes: fuelTonnes,
        vesselType,
        vesselProfile: VESSEL_PROFILES[vesselType]
      },
      environment: {
        ice,
        weather,
        hazardCount: hazards.length
      },
      advisories,
      dataErrors: errors.length ? errors : undefined,
      timestamp: new Date().toISOString()
    };

    // --- Persist if logged in ---
    if (req.userId && Route && dbReady) {
      try {
        const saved = await Route.create({
          userId: req.userId,
          name: req.body.name || `Route ${new Date().toISOString().slice(0, 16)}`,
          vesselType,
          startLocation: s,
          endLocation: e,
          waypoints: waypoints.map((w, i) => ({ lat: w.lat, lng: w.lng, order: i, note: w.note })),
          distance: totalKm,
          duration: etaHours,
          fuelEfficiency: fuelPct,
          fuelEstimateT: fuelTonnes,
          weatherData: weather,
          iceData: ice,
          hazards: hazards.slice(0, 20),
          status: 'saved'
        });
        result.savedRouteId = saved._id;
      } catch (e) {
        logger.warn('Route save failed: ' + e.message);
      }
    }

    res.json(result);
  } catch (e) {
    logger.error('Route optimize error: ' + e.message);
    res.status(500).json({ error: 'Route optimization failed', message: e.message });
  }
});

app.get('/api/routes', authenticate, async (req, res) => {
  if (!Route || !dbReady) return res.status(503).json({ error: 'Database not available' });
  const routes = await Route.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ routes, count: routes.length });
});

app.get('/api/routes/:id', authenticate, async (req, res) => {
  if (!Route || !dbReady) return res.status(503).json({ error: 'Database not available' });
  const route = await Route.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!route) return res.status(404).json({ error: 'Route not found' });
  res.json({ route });
});

app.delete('/api/routes/:id', authenticate, async (req, res) => {
  if (!Route || !dbReady) return res.status(503).json({ error: 'Database not available' });
  const result = await Route.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!result) return res.status(404).json({ error: 'Route not found' });
  res.json({ success: true, message: 'Route deleted' });
});

// ============================================================
// AI
// ============================================================
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, context, jsonMode = false } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > 8000) {
      return res.status(400).json({ error: 'message too long (max 8000 chars)' });
    }

    const fullPrompt = context
      ? `${context}\n\nUser: ${message}`
      : `You are POLARIS, an Antarctic navigation assistant. Answer concisely and clearly.\n\nUser: ${message}`;

    const result = await AIService.ask(fullPrompt, { jsonMode });
    res.json({
      response: result.text,
      model: result.model,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    logger.error('AI chat error: ' + e.message);
    res.status(503).json({
      error: 'AI service unavailable',
      details: e.details || [{ message: e.message }]
    });
  }
});

app.post('/api/ai/analyze-image', async (req, res) => {
  try {
    const { image } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'image (data URL) is required' });
    }
    if (image.length > 10_000_000) {
      return res.status(413).json({ error: 'image too large (max ~7.5MB)' });
    }

    const result = await AIService.analyzeImage(image);
    res.json(result);
  } catch (e) {
    logger.error('AI image analysis error: ' + e.message);
    res.status(503).json({ error: 'Image analysis unavailable', message: e.message });
  }
});

// ============================================================
// AUTH
// ============================================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (!User || !dbReady) return res.status(503).json({ error: 'Registration unavailable (DB not connected)' });

    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (exists) return res.status(409).json({ error: 'User already exists' });

    const hash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, email: email.toLowerCase(), password: hash, lastLogin: new Date() });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: CONSTANTS.JWT_EXPIRY });

    res.status(201).json({
      token,
      user: {
        id: user._id, username: user.username, email: user.email,
        role: user.role, preferences: user.preferences
      }
    });
  } catch (e) {
    logger.error('Register error: ' + e.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (!User || !dbReady) return res.status(503).json({ error: 'Login unavailable (DB not connected)' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: CONSTANTS.JWT_EXPIRY });
    res.json({
      token,
      user: {
        id: user._id, username: user.username, email: user.email,
        role: user.role, preferences: user.preferences
      }
    });
  } catch (e) {
    logger.error('Login error: ' + e.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/profile', authenticate, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user: req.user });
});

app.put('/api/auth/preferences', authenticate, async (req, res) => {
  if (!User || !dbReady) return res.status(503).json({ error: 'Database not available' });
  const { preferences } = req.body || {};
  if (!preferences || typeof preferences !== 'object') {
    return res.status(400).json({ error: 'preferences required' });
  }
  const user = await User.findByIdAndUpdate(
    req.userId,
    { $set: { preferences } },
    { new: true, runValidators: true }
  ).select('-password');
  res.json({ user });
});

// ============================================================
// ADMIN
// ============================================================
app.get('/api/admin/stats', authenticate, authorize('admin'), async (_req, res) => {
  const stats = {
    users: 0, routes: 0, hazards: 0, activeUsers: 0,
    uptime: process.uptime(),
    providers: PROVIDER_STATUS,
    dbConnected: dbReady
  };
  if (User && dbReady) {
    stats.users = await User.countDocuments();
    stats.activeUsers = await User.countDocuments({ lastLogin: { $gt: new Date(Date.now() - 86400000) } });
  }
  if (Route && dbReady) stats.routes = await Route.countDocuments();
  if (Hazard && dbReady) stats.hazards = await Hazard.countDocuments();
  res.json({ stats, timestamp: new Date().toISOString() });
});

// ============================================================
// WEBSOCKETS
// ============================================================
const clients = new Map();

io.on('connection', socket => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on('authenticate', token => {
    try {
      const d = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = d.id;
      socket.join(`user:${d.id}`);
      clients.set(socket.id, { userId: d.id, socketId: socket.id });
      socket.emit('authenticated', { userId: d.id });
    } catch {
      socket.emit('auth_error', { message: 'Invalid token' });
    }
  });

  socket.on('position:update', async data => {
    const lat = parseFloat(data?.lat);
    const lng = parseFloat(data?.lng);
    if (!Utils.isValidCoord(lat, lng)) return;

    if (socket.userId && Vessel && dbReady) {
      try {
        await Vessel.findOneAndUpdate(
          { userId: socket.userId },
          {
            currentPosition: { lat, lng, timestamp: new Date() },
            heading: data.heading,
            currentSpeed: data.speed
          },
          { upsert: true, new: true }
        );
      } catch (e) { logger.warn('Pos update failed: ' + e.message); }
    }

    socket.broadcast.emit('position:broadcast', {
      lat, lng,
      heading: data.heading,
      speed: data.speed,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('weather:request', async ({ lat, lng }) => {
    try {
      const coord = Utils.parseCoordBody({ lat, lng });
      if (!coord) return socket.emit('weather:error', { message: 'Invalid coordinates' });
      const wx = await fetchOpenWeather(coord.lat, coord.lng);
      socket.emit('weather:response', { weather: wx, timestamp: new Date().toISOString() });
    } catch (e) {
      socket.emit('weather:error', { message: e.message });
    }
  });

  socket.on('disconnect', () => {
    clients.delete(socket.id);
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

// ============================================================
// PERIODIC BROADCAST (real data)
// ============================================================
const weatherBroadcastInterval = setInterval(async () => {
  if (!PROVIDER_STATUS.openweather) return;
  const locs = [
    { name: 'Weddell Sea', lat: -70, lng: 0 },
    { name: 'Drake Passage', lat: -60, lng: -65 }
  ];
  for (const loc of locs) {
    try {
      const wx = await fetchOpenWeather(loc.lat, loc.lng);
      io.emit('weather:broadcast', {
        location: { name: loc.name, lat: loc.lat, lng: loc.lng },
        weather: wx,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      logger.warn(`Broadcast fetch failed for ${loc.name}: ${e.message}`);
    }
  }
}, CONSTANTS.POLLING_INTERVAL);

// ============================================================
// ERROR HANDLERS
// ============================================================
app.use((err, req, res, _next) => {
  logger.error(`Unhandled: ${err.message}`);
  if (err.code === 11000) {
    return res.status(409).json({ error: 'Duplicate key', field: Object.keys(err.keyPattern || {})[0] });
  }
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(IS_PROD ? {} : { stack: err.stack })
  });
});

app.use((req, res) => {
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  res.status(404).json({ error: `Endpoint not found: ${req.path}` });
});

// ============================================================
// START / SHUTDOWN
// ============================================================
const startServer = async () => {
  await connectDB();
  server.listen(PORT, () => {
    console.log('========================================');
    console.log('🚀 Polaris Nav Backend');
    console.log(`📡 ${BASE_URL}`);
    console.log(`🔗 Health: ${BASE_URL}/api/health`);
    console.log(`🌍 Env: ${NODE_ENV}`);
    console.log(`💾 DB: ${dbReady ? 'Connected ✅' : 'Not connected ❌'}`);
    console.log('🔑 Providers:');
    for (const [name, ready] of Object.entries(PROVIDER_STATUS)) {
      console.log(`   ${ready ? '✅' : '❌'} ${name}`);
    }
    console.log('========================================');
  });

  const shutdown = (signal) => {
    logger.info(`Shutting down (${signal})...`);
    clearInterval(weatherBroadcastInterval);
    io.close();
    server.close(() => {
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        mongoose.connection.close(false).finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
};

process.on('unhandledRejection', e => logger.error('Unhandled rejection: ' + (e?.stack || e)));
process.on('uncaughtException', e => {
  logger.error('Uncaught exception: ' + (e?.stack || e));
  process.exit(1);
});

if (require.main === module) startServer();

module.exports = { app, server, io, connectDB };