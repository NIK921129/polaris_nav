// ============================================================
// POLARIS NAV - BACKEND SERVER (CLEAN, DEDUPED)
// Free-tier APIs + graceful mock fallback
// ============================================================
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

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

if (!process.env.JWT_SECRET) {
  if (NODE_ENV === 'production') {
    console.error('❌ JWT_SECRET is required in production. Exiting.');
    process.exit(1);
  }
  process.env.JWT_SECRET = 'dev_only_insecure_secret';
  console.warn('⚠️  Using insecure dev JWT_SECRET. Set JWT_SECRET in .env');
}

const APIS = {
  openweather: { url: 'https://api.openweathermap.org/data/2.5', key: process.env.OPENWEATHER_API_KEY || '' },
  nasa:        { url: 'https://api.nasa.gov',                     key: process.env.NASA_API_KEY || 'DEMO_KEY' },
  mapbox:      { url: 'https://api.mapbox.com',                   key: process.env.MAPBOX_API_KEY || '' },
  gemini:      { url: 'https://generativelanguage.googleapis.com/v1beta', key: process.env.GEMINI_API_KEY || '' },
  noaa:        { url: 'https://api.weather.gov',                  key: 'public' }
};

const CONSTANTS = {
  ICE_THRESHOLD: 30,
  WIND_THRESHOLD: 20,
  MAX_WAYPOINTS: 10,
  CACHE_TTL: 300,
  RATE_LIMIT_WINDOW: 15 * 60 * 1000,
  RATE_LIMIT_MAX: 200,
  JWT_EXPIRY: '7d',
  POLLING_INTERVAL: 300000
};

// ------------------------------------------------------------
// LOGGER
// ------------------------------------------------------------
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'polaris-nav' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) =>
          `${timestamp} ${level}: ${typeof message === 'string' ? message : JSON.stringify(message)}`)
      )
    })
  ]
});

// ------------------------------------------------------------
// EXPRESS + SOCKET.IO
// ------------------------------------------------------------
const app = express();
const server = createServer(app);
const corsOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : '*';

const io = new Server(server, {
  cors: { origin: corsOrigins, methods: ['GET', 'POST'], credentials: true },
  path: '/socket.io',
  transports: ['websocket', 'polling']
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", 'https:']
    }
  }
}));
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// ------------------------------------------------------------
// RATE LIMIT + CACHE
// ------------------------------------------------------------
const limiter = rateLimit({
  windowMs: CONSTANTS.RATE_LIMIT_WINDOW,
  max: CONSTANTS.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false
});
const strictLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30 });
app.use('/api/auth', strictLimiter);
app.use('/api/ai', strictLimiter);
app.use('/api', limiter);

const cache = new NodeCache({ stdTTL: CONSTANTS.CACHE_TTL, checkperiod: 60 });

const cacheMiddleware = (duration = CONSTANTS.CACHE_TTL) => (req, res, next) => {
  const key = `cache:${req.originalUrl}`;
  const hit = cache.get(key);
  if (hit) return res.json(hit);
  const orig = res.json.bind(res);
  res.json = (data) => { cache.set(key, data, duration); return orig(data); };
  next();
};

// ------------------------------------------------------------
// DATABASE
// ------------------------------------------------------------
let User, Route, Hazard, Vessel, AIConfig, WeatherHistory;
let dbReady = false;

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    logger.warn('⚠️  MONGODB_URI not set — running in DB-less mode (auth/route saving disabled)');
    return null;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.MONGODB_DB_NAME || 'polaris_nav',
      serverSelectionTimeoutMS: 8000
    });
    dbReady = true;
    logger.info('✅ MongoDB connected');
    registerModels();
    mongoose.connection.on('error', e => logger.error('Mongo error: ' + e.message));
    mongoose.connection.on('disconnected', () => {
      dbReady = false;
      logger.warn('Mongo disconnected, retrying in 5s');
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
    email:    { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, minlength: 6 },
    role:     { type: String, enum: ['admin', 'user', 'guest'], default: 'user' },
    preferences: {
      mapStyle: { type: String, default: 'dark' },
      aiModel:  { type: String, default: 'gemini' },
      notifications: { type: Boolean, default: true },
      vesselType: { type: String, default: 'research' }
    },
    lastLogin: Date,
    isActive: { type: Boolean, default: true }
  }, { timestamps: true }));

  Route = mongoose.model('Route', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    description: String,
    startLocation: { lat: Number, lng: Number, name: String },
    endLocation:   { lat: Number, lng: Number, name: String },
    waypoints: [{ lat: Number, lng: Number, order: Number }],
    distance: Number,
    duration: Number,
    fuelEfficiency: Number,
    weatherData: Object,
    hazards: [Object],
    status: { type: String, enum: ['draft', 'saved', 'active', 'completed'], default: 'draft' },
    isPublic: { type: Boolean, default: false }
  }, { timestamps: true }));

  Hazard = mongoose.model('Hazard', new mongoose.Schema({
    type: { type: String, enum: ['iceberg', 'icefield', 'island', 'mountain', 'ice_shelf', 'unknown'], required: true },
    lat: Number, lng: Number, size: Number, height: Number,
    confidence: { type: Number, default: 0.5 },
    source: { type: String, enum: ['satellite', 'camera', 'user_report', 'ai_detection', 'api'], default: 'api' },
    detectedAt: { type: Date, default: Date.now },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' }
  }, { timestamps: true }));

  Vessel = mongoose.model('Vessel', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: String,
    type: { type: String, enum: ['research', 'icebreaker', 'cargo', 'fishing', 'tourism', 'military'], default: 'research' },
    fuelLevel: { type: Number, default: 100 },
    currentPosition: { lat: Number, lng: Number, timestamp: Date },
    heading: Number,
    currentSpeed: Number,
    status: { type: String, enum: ['docked', 'cruising', 'anchored', 'ice_breaking', 'emergency'], default: 'docked' }
  }, { timestamps: true }));

  AIConfig = mongoose.model('AIConfig', new mongoose.Schema({
    model: { type: String, default: 'gemini' },
    promptTemplate: { type: String, default: 'You are an Antarctic navigation expert...' },
    temperature: { type: Number, default: 0.7 },
    maxTokens: { type: Number, default: 2048 }
  }, { timestamps: true }));

  WeatherHistory = mongoose.model('WeatherHistory', new mongoose.Schema({
    location: { lat: Number, lng: Number },
    temperature: Number,
    windSpeed: Number,
    description: String,
    recordedAt: { type: Date, default: Date.now }
  }, { timestamps: true }));
}

// ------------------------------------------------------------
// AUTH MIDDLEWARE
// ------------------------------------------------------------
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

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// ------------------------------------------------------------
// MOCK DATA GENERATORS
// ------------------------------------------------------------
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const generateMockWeather = () => ({
  temperature: rand(-5, 5),
  feelsLike: rand(-8, 0),
  humidity: rand(65, 90),
  windSpeed: rand(10, 40),
  windDirection: Math.round(rand(0, 360)),
  description: pick(['Partly Cloudy', 'Overcast', 'Light Snow', 'Clear Skies', 'Foggy', 'Misty', 'Snow Showers']),
  pressure: rand(980, 1020),
  visibility: rand(5, 20),
  clouds: rand(20, 80),
  source: 'mock'
});

const generateMockIce = (lat, lng) => {
  const points = [];
  for (let i = 0; i < 50; i++) {
    const pLat = lat + (Math.random() - 0.5) * 4;
    const pLng = lng + (Math.random() - 0.5) * 4;
    const dist = Math.hypot(pLat - lat, pLng - lng);
    const conc = Math.max(0, Math.min(80, 40 - dist * 10 + rand(-10, 10)));
    points.push([pLat, pLng, conc]);
  }
  return {
    concentration: rand(15, 55),
    area: pick(['Marginal Ice Zone', 'Pack Ice', 'Fast Ice', 'Open Water', 'Ice Shelf']),
    trend: pick(['Stable', 'Increasing', 'Decreasing']),
    thickness: rand(0.5, 2.5),
    age: pick(['First Year', 'Multi-Year', 'Young Ice', 'Fast Ice']),
    points,
    source: 'mock'
  };
};

const generateMockHazards = (lat, lng) => {
  const types = ['iceberg', 'icefield', 'island', 'mountain', 'ice_shelf'];
  const severities = ['low', 'medium', 'high', 'critical'];
  const count = 2 + Math.floor(Math.random() * 4);
  const hazards = [];
  for (let i = 0; i < count; i++) {
    hazards.push({
      id: `hazard_${i}`,
      lat: lat + (Math.random() - 0.5) * 0.6,
      lng: lng + (Math.random() - 0.5) * 0.6,
      type: pick(types),
      size: rand(50, 950),
      height: rand(10, 60),
      confidence: rand(0.6, 0.95),
      severity: pick(severities),
      status: pick(['active', 'melting', 'moving', 'stationary']),
      detectedAt: new Date().toISOString(),
      source: 'mock'
    });
  }
  return hazards;
};

const generateMockRoute = (start, end) => {
  const waypoints = [start];
  const n = 3 + Math.floor(Math.random() * 3);
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    waypoints.push({
      lat: start.lat + (end.lat - start.lat) * t + (Math.random() - 0.5) * 0.5,
      lng: start.lng + (end.lng - start.lng) * t + (Math.random() - 0.5) * 0.5
    });
  }
  waypoints.push(end);
  const distance = rand(200, 1000);
  const duration = rand(12, 48);
  return {
    distance,
    duration,
    fuelEfficiency: rand(60, 95),
    waypoints,
    source: 'mock'
  };
};

const generateMockAIResponse = (query = '') => {
  const responses = {
    weather: `Weather advisory: ${pick(['Blizzard', 'High Winds', 'Heavy Snow', 'Freezing Spray'])} conditions expected. Fuel efficiency is ${Math.round(rand(60, 95))}%. Consider sheltering near the ice edge.`,
    ice:     `Based on current ice conditions (${Math.round(rand(15, 55))}% concentration) and wind speeds of ${Math.round(rand(10, 40))} km/h, I recommend a heading of ${Math.round(rand(0, 360))}° at ${Math.round(rand(8, 16))} knots.`,
    hazard:  `Multiple hazards detected within ${Math.round(rand(20, 50))} nautical miles. Maintain a safe distance of 5 NM.`,
    route:   `Route optimization complete. Fuel savings: ${Math.round(rand(5, 20))}%. ETA: ${Math.round(rand(12, 36))} hours.`
  };
  const q = query.toLowerCase();
  if (q.includes('weather')) return responses.weather;
  if (q.includes('ice'))     return responses.ice;
  if (q.includes('hazard') || q.includes('danger')) return responses.hazard;
  if (q.includes('route') || q.includes('path'))    return responses.route;
  return pick(Object.values(responses));
};

// ------------------------------------------------------------
// ROUTES: HEALTH / INDEX
// ------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    dbConnected: dbReady,
    memory: process.memoryUsage()
  });
});

app.get(['/', '/api'], (_req, res) => {
  res.json({
    name: 'Polaris Nav API',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      health:    '/api/health',
      weather:   '/api/weather/current?lat=-70&lng=0',
      forecast:  '/api/weather/forecast?lat=-70&lng=0',
      ice:       '/api/ice/concentration?lat=-70&lng=0',
      icebergs:  '/api/ice/icebergs?lat=-70&lng=0',
      hazards:   '/api/hazards?lat=-70&lng=0',
      routeOpt:  'POST /api/route/optimize',
      chat:      'POST /api/ai/chat',
      analyze:   'POST /api/ai/analyze-image',
      auth:      '/api/auth/register, /api/auth/login'
    }
  });
});

// ------------------------------------------------------------
// WEATHER
// ------------------------------------------------------------
app.get('/api/weather/current', cacheMiddleware(300), async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  // Try free NOAA (US only, but we try anyway; fails fast for poles)
  try {
    const points = await axios.get(
      `https://api.weather.gov/points/${parseFloat(lat)},${parseFloat(lng)}`,
      { timeout: 4000 }
    );
    const forecastUrl = points.data?.properties?.forecast;
    if (forecastUrl) {
      const fc = await axios.get(forecastUrl, { timeout: 4000 });
      const p = fc.data?.properties?.periods?.[0];
      if (p) {
        return res.json({
          current: {
            temperature: p.temperature,
            windSpeed: parseFloat(p.windSpeed) || rand(10, 40),
            description: p.shortForecast || 'Partly Cloudy',
            humidity: Math.round(rand(65, 90)),
            source: 'noaa'
          },
          timestamp: new Date().toISOString()
        });
      }
    }
  } catch { /* fall through */ }

  res.json({ current: generateMockWeather(), timestamp: new Date().toISOString() });
});

app.get('/api/weather/forecast', cacheMiddleware(600), (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  const forecast = Array.from({ length: 8 }, (_, i) => ({
    time: new Date(Date.now() + i * 3 * 3600_000).toISOString(),
    temperature: rand(-8, 4),
    description: pick(['Partly Cloudy', 'Snow', 'Clear', 'Overcast', 'Light Snow']),
    windSpeed: rand(8, 33)
  }));
  res.json({ forecast, source: 'mock' });
});

// ------------------------------------------------------------
// ICE
// ------------------------------------------------------------
app.get('/api/ice/concentration', cacheMiddleware(600), (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  res.json({
    ice: generateMockIce(parseFloat(lat), parseFloat(lng)),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/ice/icebergs', cacheMiddleware(300), (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  const latN = parseFloat(lat), lngN = parseFloat(lng);
  const count = 1 + Math.floor(Math.random() * 5);
  const icebergs = Array.from({ length: count }, (_, i) => ({
    id: `iceberg_${i}`,
    lat: latN + (Math.random() - 0.5) * 0.8,
    lng: lngN + (Math.random() - 0.5) * 0.8,
    size: rand(50, 550),
    height: rand(10, 50),
    type: pick(['Tabular', 'Dome', 'Pinnacle', 'Blocky']),
    speed: rand(0.5, 2.5),
    direction: Math.round(rand(0, 360)),
    confidence: rand(0.6, 0.95),
    source: 'mock'
  }));
  res.json({ icebergs, count: icebergs.length, timestamp: new Date().toISOString() });
});

// ------------------------------------------------------------
// HAZARDS
// ------------------------------------------------------------
app.get('/api/hazards', cacheMiddleware(300), (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  const hazards = generateMockHazards(parseFloat(lat), parseFloat(lng));
  res.json({ hazards, count: hazards.length, timestamp: new Date().toISOString() });
});

// ------------------------------------------------------------
// ROUTE
// ------------------------------------------------------------
app.post('/api/route/optimize', authenticate, async (req, res) => {
  try {
    const { start, end, vesselType = 'research' } = req.body || {};
    if (!start || !end) return res.status(400).json({ error: 'start and end required' });

    let routeData = null;

    if (APIS.mapbox.key) {
      try {
        const r = await axios.get(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${start.lng},${start.lat};${end.lng},${end.lat}`,
          { params: { access_token: APIS.mapbox.key, geometries: 'geojson' }, timeout: 8000 }
        );
        const rt = r.data?.routes?.[0];
        if (rt) {
          routeData = {
            distance: rt.distance / 1000,
            duration: rt.duration / 3600,
            fuelEfficiency: rand(60, 95),
            waypoints: rt.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] })),
            source: 'mapbox'
          };
        }
      } catch (e) {
        logger.warn('Mapbox failed: ' + e.message);
      }
    }

    if (!routeData) routeData = generateMockRoute(start, end);

    const aiSuggestion = generateMockAIResponse('route');

    // Persist if DB available
    if (req.userId && Route) {
      try {
        await Route.create({
          userId: req.userId,
          name: req.body.name || `Route ${new Date().toLocaleDateString()}`,
          startLocation: start,
          endLocation: end,
          waypoints: routeData.waypoints.map((w, i) => ({ ...w, order: i })),
          distance: routeData.distance,
          duration: routeData.duration,
          fuelEfficiency: routeData.fuelEfficiency,
          status: 'saved'
        });
      } catch (e) {
        logger.warn('Route save failed: ' + e.message);
      }
    }

    res.json({ route: routeData, aiSuggestion, vesselType, timestamp: new Date().toISOString() });
  } catch (e) {
    logger.error('Route optimize error: ' + e.message);
    res.status(500).json({ error: 'Failed to optimize route' });
  }
});

app.get('/api/routes', authenticate, async (req, res) => {
  if (!Route) return res.json({ routes: [], count: 0, message: 'Database not available' });
  const routes = await Route.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50);
  res.json({ routes, count: routes.length });
});

app.get('/api/routes/:id', authenticate, async (req, res) => {
  if (!Route) return res.status(503).json({ error: 'Database not available' });
  const route = await Route.findOne({ _id: req.params.id, userId: req.userId });
  if (!route) return res.status(404).json({ error: 'Route not found' });
  res.json({ route });
});

app.delete('/api/routes/:id', authenticate, async (req, res) => {
  if (!Route) return res.status(503).json({ error: 'Database not available' });
  const result = await Route.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!result) return res.status(404).json({ error: 'Route not found' });
  res.json({ success: true, message: 'Route deleted' });
});

// ------------------------------------------------------------
// AI
// ------------------------------------------------------------
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, context } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message is required' });

    let response = null;
    let source = 'mock';

    if (APIS.gemini.key) {
      try {
        const gr = await axios.post(
          `${APIS.gemini.url}/models/gemini-pro:generateContent?key=${APIS.gemini.key}`,
          { contents: [{ parts: [{ text: `You are an Antarctic navigation expert. ${context || ''}\n\nUser: ${message}` }] }] },
          { timeout: 12000 }
        );
        const txt = gr.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (txt) { response = txt; source = 'gemini'; }
      } catch (e) { logger.warn('Gemini failed: ' + e.message); }
    }

    if (!response) response = generateMockAIResponse(message);

    res.json({ response, model: source, timestamp: new Date().toISOString() });
  } catch (e) {
    logger.error('AI chat error: ' + e.message);
    res.status(500).json({ error: 'Failed to get AI response' });
  }
});

app.post('/api/ai/analyze-image', (req, res) => {
  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image required' });

  const labels = ['iceberg', 'sea ice', 'ocean', 'snow', 'cloud'];
  const scores = labels.map(() => rand(0.6, 0.95));
  const hazards = labels
    .map((l, i) => ({ type: l, confidence: scores[i] }))
    .filter(h => h.confidence > 0.7 && ['iceberg', 'sea ice'].includes(h.type));

  res.json({
    analysis: { labels, scores },
    hazards,
    timestamp: new Date().toISOString()
  });
});

// ------------------------------------------------------------
// AUTH
// ------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be >= 6 chars' });
    if (!User) return res.status(503).json({ error: 'Database not available' });

    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(400).json({ error: 'User already exists' });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, password: hash, lastLogin: new Date() });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: CONSTANTS.JWT_EXPIRY });

    res.status(201).json({
      token,
      user: { id: user._id, username: user.username, email: user.email, role: user.role, preferences: user.preferences }
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
    if (!User) return res.status(503).json({ error: 'Database not available' });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: CONSTANTS.JWT_EXPIRY });
    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email, role: user.role, preferences: user.preferences }
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
  if (!User) return res.status(503).json({ error: 'Database not available' });
  const { preferences } = req.body || {};
  if (!preferences) return res.status(400).json({ error: 'preferences required' });
  const user = await User.findByIdAndUpdate(req.userId, { preferences }, { new: true }).select('-password');
  res.json({ user });
});

// ------------------------------------------------------------
// ADMIN
// ------------------------------------------------------------
app.get('/api/admin/stats', authenticate, authorize('admin'), async (_req, res) => {
  const stats = { users: 0, routes: 0, hazards: 0, activeUsers: 0, uptime: process.uptime() };
  if (User) {
    stats.users = await User.countDocuments();
    stats.activeUsers = await User.countDocuments({ lastLogin: { $gt: new Date(Date.now() - 86400_000) } });
  }
  if (Route) stats.routes = await Route.countDocuments();
  if (Hazard) stats.hazards = await Hazard.countDocuments();
  res.json({ stats, timestamp: new Date().toISOString() });
});

// ------------------------------------------------------------
// WEBSOCKETS
// ------------------------------------------------------------
const clients = new Map();

io.on('connection', socket => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on('authenticate', token => {
    try {
      const d = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = d.id;
      socket.join(`user:${d.id}`);
      clients.set(socket.id, { userId: d.id, socketId: socket.id });
    } catch {
      logger.warn('Socket auth failed');
    }
  });

  socket.on('position:update', async data => {
    const { lat, lng, heading, speed } = data || {};
    if (socket.userId && Vessel) {
      try {
        await Vessel.findOneAndUpdate(
          { userId: socket.userId },
          { currentPosition: { lat, lng, timestamp: new Date() }, heading, currentSpeed: speed },
          { upsert: true, new: true }
        );
      } catch (e) { logger.warn('Pos update failed: ' + e.message); }
    }
    socket.broadcast.emit('position:broadcast', { lat, lng, heading, speed, timestamp: new Date().toISOString() });
  });

  socket.on('weather:request', ({ lat, lng }) => {
    socket.emit('weather:response', { weather: generateMockWeather(), timestamp: new Date().toISOString() });
  });

  socket.on('disconnect', () => {
    clients.delete(socket.id);
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

// Periodic weather broadcast
setInterval(() => {
  const locs = [{ lat: -70, lng: 0 }, { lat: -65, lng: -60 }];
  for (const loc of locs) {
    io.emit('weather:broadcast', { location: loc, weather: generateMockWeather(), timestamp: new Date().toISOString() });
  }
}, CONSTANTS.POLLING_INTERVAL);

// ------------------------------------------------------------
// ERROR HANDLERS
// ------------------------------------------------------------
app.use((err, req, res, _next) => {
  logger.error(`Unhandled: ${err.message}`);
  if (err.code === 11000) {
    return res.status(409).json({ error: 'Duplicate key', field: Object.keys(err.keyPattern || {})[0] });
  }
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(NODE_ENV === 'development' ? { stack: err.stack } : {})
  });
});

app.use((req, res) => res.status(404).json({ error: `Endpoint not found: ${req.path}` }));

// ------------------------------------------------------------
// START
// ------------------------------------------------------------
const startServer = async () => {
  await connectDB();
  server.listen(PORT, () => {
    console.log('========================================');
    console.log('🚀 Polaris Nav Backend');
    console.log(`📡 ${BASE_URL}`);
    console.log(`🔗 Health: ${BASE_URL}/api/health`);
    console.log(`🌍 Env: ${NODE_ENV}`);
    console.log(`💾 DB: ${dbReady ? 'Connected ✅' : 'Not connected ❌'}`);
    console.log('========================================');
  });

  const shutdown = () => {
    logger.info('Shutting down...');
    server.close(() => {
      if (mongoose.connection) mongoose.connection.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

process.on('unhandledRejection', e => logger.error('Unhandled rejection: ' + e));
process.on('uncaughtException', e => {
  logger.error('Uncaught exception: ' + e);
  process.exit(1);
});

if (require.main === module) startServer();

module.exports = { app, server, io, connectDB };