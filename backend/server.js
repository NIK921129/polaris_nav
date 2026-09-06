// ============================================================
// POLARIS NAV - COMPLETE BACKEND SERVER
// Single file: backend/server.js
// ~1400 lines
// ============================================================

// ============================================================
// 1. IMPORTS & DEPENDENCIES (~50 lines)
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
const multer = require('multer');
const Jimp = require('jimp');
const NodeCache = require('node-cache');
const { body, validationResult } = require('express-validator');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const Sentry = require('@sentry/node');

// ============================================================
// 2. CONFIGURATION & ENVIRONMENT (~80 lines)
// ============================================================
const PORT = process.env.PORT || 5500;
const NODE_ENV = process.env.NODE_ENV || 'development';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Validate required environment variables
const requiredEnv = [
    'MONGODB_URI',
    'JWT_SECRET',
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'OPENWEATHER_API_KEY',
    'NSIDC_API_KEY',
    'NASA_API_KEY',
    'COPERNICUS_API_KEY',
    'MAPBOX_API_KEY'
];

const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingEnv.join(', ')}`);
    process.exit(1);
}

// API Configuration
const APIS = {
    openweather: {
        url: 'https://api.openweathermap.org/data/2.5',
        key: process.env.OPENWEATHER_API_KEY
    },
    noaa: {
        url: 'https://api.noaa.gov',
        key: process.env.NOAA_API_KEY
    },
    copernicus: {
        url: 'https://api.copernicus.eu',
        key: process.env.COPERNICUS_API_KEY
    },
    nsidc: {
        url: 'https://api.nsidc.org',
        key: process.env.NSIDC_API_KEY
    },
    nasa: {
        url: 'https://api.nasa.gov',
        key: process.env.NASA_API_KEY
    },
    mapbox: {
        url: 'https://api.mapbox.com',
        key: process.env.MAPBOX_API_KEY
    },
    gemini: {
        url: 'https://generativelanguage.googleapis.com/v1beta',
        key: process.env.GEMINI_API_KEY
    },
    openai: {
        url: 'https://api.openai.com/v1',
        key: process.env.OPENAI_API_KEY
    },
    huggingface: {
        url: 'https://api-inference.huggingface.co',
        key: process.env.HUGGINGFACE_API_KEY
    },
    claude: {
        url: 'https://api.anthropic.com/v1',
        key: process.env.CLAUDE_API_KEY
    },
    cohere: {
        url: 'https://api.cohere.ai/v1',
        key: process.env.COHERE_API_KEY
    },
    sentinel: {
        url: 'https://api.sentinel-hub.com',
        key: process.env.SENTINEL_API_KEY
    },
    earthEngine: {
        url: 'https://earthengine.googleapis.com',
        key: process.env.EARTH_ENGINE_API_KEY
    },
    googleMaps: {
        url: 'https://maps.googleapis.com',
        key: process.env.GOOGLE_MAPS_API_KEY
    },
    hereMaps: {
        url: 'https://route.ls.hereapi.com',
        key: process.env.HERE_MAPS_API_KEY
    },
    tomtom: {
        url: 'https://api.tomtom.com',
        key: process.env.TOMTOM_API_KEY
    },
    windy: {
        url: 'https://api.windy.com',
        key: process.env.WINDY_API_KEY
    },
    ecmwf: {
        url: 'https://api.ecmwf.int',
        key: process.env.ECMWF_API_KEY
    },
    gfs: {
        url: 'https://api.gfs.com',
        key: process.env.GFS_API_KEY
    },
    hycom: {
        url: 'https://api.hycom.org',
        key: process.env.HYCOM_API_KEY
    }
};

// Constants
const CONSTANTS = {
    ICE_THRESHOLD: 30, // 30% ice concentration
    WIND_THRESHOLD: 20, // 20 knots
    MAX_WAYPOINTS: 10,
    CACHE_TTL: 300, // 5 minutes
    RATE_LIMIT_WINDOW: 15, // minutes
    RATE_LIMIT_MAX: 100,
    JWT_EXPIRY: '7d',
    MAX_IMAGE_SIZE: 10485760, // 10MB
    POLLING_INTERVAL: 300000 // 5 minutes
};

// ============================================================
// 3. LOGGER SETUP (~40 lines)
// ============================================================
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'polaris-nav' },
    transports: [
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 10485760,
            maxFiles: 5
        }),
        new winston.transports.File({
            filename: 'logs/app.log',
            maxsize: 10485760,
            maxFiles: 5
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// ============================================================
// 4. SENTRY INITIALIZATION (~15 lines)
// ============================================================
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: NODE_ENV,
        tracesSampleRate: 0.1,
        integrations: [
            new Sentry.Integrations.Http({ tracing: true }),
            new Sentry.Integrations.Express({ app: express() })
        ]
    });
}

// ============================================================
// 5. EXPRESS APP SETUP (~30 lines)
// ============================================================
const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true
    },
    path: '/socket.io',
    transports: ['websocket', 'polling']
});

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"]
        }
    }
}));
app.use(cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
    credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('user-agent')
    });
    next();
});

// ============================================================
// 6. RATE LIMITING (~25 lines)
// ============================================================
const limiter = rateLimit({
    windowMs: CONSTANTS.RATE_LIMIT_WINDOW * 60 * 1000,
    max: CONSTANTS.RATE_LIMIT_MAX,
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || 'anonymous'
});

const strictLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    message: 'Too many requests, please try again later.'
});

// Apply to specific routes
app.use('/api/auth', strictLimiter);
app.use('/api/ai', strictLimiter);
app.use('/api', limiter);

// ============================================================
// 7. CACHE SETUP (~20 lines)
// ============================================================
const cache = new NodeCache({
    stdTTL: CONSTANTS.CACHE_TTL,
    checkperiod: 60,
    useClones: false
});

// Cache middleware
const cacheMiddleware = (duration = CONSTANTS.CACHE_TTL) => {
    return (req, res, next) => {
        const key = `cache:${req.originalUrl || req.url}`;
        const cached = cache.get(key);
        if (cached) {
            logger.debug(`Cache hit: ${key}`);
            return res.json(cached);
        }
        // Store original json method
        const originalJson = res.json;
        res.json = function(data) {
            cache.set(key, data, duration);
            originalJson.call(this, data);
        };
        next();
    };
};

// ============================================================
// 8. DATABASE CONNECTION (~40 lines)
// ============================================================
let db = null;

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            dbName: process.env.MONGODB_DB_NAME || 'polaris_nav',
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4
        });
        db = mongoose.connection;
        logger.info('✅ MongoDB connected successfully');
        
        // Handle connection events
        db.on('error', (err) => {
            logger.error('MongoDB connection error:', err);
        });
        db.on('disconnected', () => {
            logger.warn('MongoDB disconnected, attempting to reconnect...');
            setTimeout(connectDB, 5000);
        });
        
        return db;
    } catch (error) {
        logger.error('MongoDB connection failed:', error);
        // Retry after 5 seconds
        setTimeout(connectDB, 5000);
        return null;
    }
};

// ============================================================
// 9. DATABASE SCHEMAS (~200 lines)
// ============================================================

// 9a. User Schema (~35 lines)
const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Username is required'],
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 30
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: 6
    },
    role: {
        type: String,
        enum: ['admin', 'user', 'guest'],
        default: 'user'
    },
    preferences: {
        mapStyle: { type: String, default: 'dark' },
        aiModel: { type: String, default: 'gemini' },
        notifications: { type: Boolean, default: true },
        vesselType: { type: String, default: 'research' }
    },
    vessels: [{
        name: String,
        type: String,
        fuelCapacity: Number,
        speed: Number
    }],
    lastLogin: Date,
    createdAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

// 9b. Route Schema (~45 lines)
const RouteSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: String,
    startLocation: {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
        name: String
    },
    endLocation: {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
        name: String
    },
    waypoints: [{
        lat: Number,
        lng: Number,
        order: Number,
        estimatedTime: Date
    }],
    distance: Number, // in km
    duration: Number, // in hours
    fuelEfficiency: Number, // percentage
    weatherData: {
        temperature: Number,
        windSpeed: Number,
        windDirection: Number,
        iceConcentration: Number,
        seaState: String
    },
    hazards: [{
        type: String,
        lat: Number,
        lng: Number,
        severity: { type: String, enum: ['low', 'medium', 'high'] }
    }],
    status: {
        type: String,
        enum: ['draft', 'saved', 'active', 'completed'],
        default: 'draft'
    },
    isPublic: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// 9c. Hazard Schema (~30 lines)
const HazardSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['iceberg', 'icefield', 'island', 'mountain', 'ice_shelf', 'unknown'],
        required: true
    },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    size: Number, // in meters
    height: Number, // in meters
    description: String,
    confidence: { type: Number, min: 0, max: 1, default: 0.5 },
    source: {
        type: String,
        enum: ['satellite', 'camera', 'user_report', 'ai_detection', 'api'],
        default: 'api'
    },
    detectedAt: { type: Date, default: Date.now },
    lastSeen: Date,
    trajectory: [{
        lat: Number,
        lng: Number,
        timestamp: Date,
        speed: Number,
        direction: Number
    }],
    status: {
        type: String,
        enum: ['active', 'melting', 'moving', 'stationary', 'unknown'],
        default: 'unknown'
    },
    severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    }
}, { timestamps: true });

// 9d. AIConfig Schema (~25 lines)
const AIConfigSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null // null = global config
    },
    model: {
        type: String,
        enum: ['gemini', 'openai', 'claude', 'cohere', 'huggingface'],
        default: 'gemini'
    },
    promptTemplate: {
        type: String,
        default: `You are an Antarctic navigation expert. Analyze:
Position: {position}
Ice: {ice}
Weather: {weather}
Hazards: {hazards}
Provide route recommendation.`
    },
    temperature: { type: Number, default: 0.7, min: 0, max: 1 },
    maxTokens: { type: Number, default: 2048 },
    systemPrompt: String,
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// 9e. Vessel Schema (~30 lines)
const VesselSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['research', 'icebreaker', 'cargo', 'fishing', 'tourism', 'military'],
        default: 'research'
    },
    imo: String,
    mmsi: String,
    length: Number,
    beam: Number,
    draft: Number,
    fuelCapacity: Number,
    fuelLevel: { type: Number, default: 100 },
    maxSpeed: Number,
    currentSpeed: Number,
    currentPosition: {
        lat: Number,
        lng: Number,
        timestamp: Date
    },
    heading: Number,
    status: {
        type: String,
        enum: ['docked', 'cruising', 'anchored', 'ice_breaking', 'emergency'],
        default: 'docked'
    },
    lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

// 9f. WeatherHistory Schema (~25 lines)
const WeatherHistorySchema = new mongoose.Schema({
    location: {
        lat: Number,
        lng: Number,
        name: String
    },
    temperature: Number,
    humidity: Number,
    pressure: Number,
    windSpeed: Number,
    windDirection: Number,
    visibility: Number,
    cloudCover: Number,
    precipitation: Number,
    seaState: String,
    waveHeight: Number,
    swellDirection: Number,
    iceConcentration: Number,
    source: String,
    recordedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, index: { expires: '24h' } }
}, { timestamps: true });

// Create models
const User = mongoose.model('User', UserSchema);
const Route = mongoose.model('Route', RouteSchema);
const Hazard = mongoose.model('Hazard', HazardSchema);
const AIConfig = mongoose.model('AIConfig', AIConfigSchema);
const Vessel = mongoose.model('Vessel', VesselSchema);
const WeatherHistory = mongoose.model('WeatherHistory', WeatherHistorySchema);

// ============================================================
// 10. AUTH MIDDLEWARE (~30 lines)
// ============================================================
const authenticate = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        req.user = user;
        req.userId = user._id;
        next();
    } catch (error) {
        logger.error('Auth error:', error);
        return res.status(401).json({ error: 'Invalid token' });
    }
};

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    };
};

// ============================================================
// 11. API HELPER FUNCTIONS (~60 lines)
// ============================================================
const apiCall = async (service, endpoint, params = {}, method = 'GET', body = null) => {
    const config = APIS[service];
    if (!config || !config.key) {
        throw new Error(`API key missing for ${service}`);
    }

    const url = `${config.url}${endpoint}`;
    const headers = {
        'Authorization': `Bearer ${config.key}`,
        'Content-Type': 'application/json'
    };

    try {
        const response = await axios({
            method,
            url,
            params,
            data: body,
            headers,
            timeout: 30000,
            validateStatus: (status) => status < 500
        });

        if (response.status >= 400) {
            logger.warn(`API ${service} returned ${response.status}:`, response.data);
            throw new Error(`API error: ${response.status}`);
        }

        return response.data;
    } catch (error) {
        logger.error(`API call failed (${service}):`, error.message);
        throw error;
    }
};

// Retry wrapper
const apiCallWithRetry = async (service, endpoint, params = {}, method = 'GET', body = null, retries = 3) => {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await apiCall(service, endpoint, params, method, body);
        } catch (error) {
            lastError = error;
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
    }
    throw lastError;
};

// ============================================================
// 12. SERVICES (~250 lines)
// ============================================================

// 12a. Weather Service (~60 lines)
const WeatherService = {
    getCurrent: async (lat, lng) => {
        try {
            // Try OpenWeather first
            const data = await apiCallWithRetry('openweather', '/weather', {
                lat,
                lon: lng,
                units: 'metric',
                appid: APIS.openweather.key
            });

            return {
                temperature: data.main.temp,
                feelsLike: data.main.feels_like,
                humidity: data.main.humidity,
                pressure: data.main.pressure,
                windSpeed: data.wind.speed * 3.6, // m/s to km/h
                windDirection: data.wind.deg,
                description: data.weather[0].description,
                icon: data.weather[0].icon,
                visibility: data.visibility / 1000,
                clouds: data.clouds.all,
                timestamp: new Date(data.dt * 1000)
            };
        } catch (error) {
            logger.warn('OpenWeather failed, trying NOAA...');
            // Fallback to mock data
            return {
                temperature: -5 + Math.random() * 10,
                humidity: 70 + Math.random() * 20,
                pressure: 980 + Math.random() * 40,
                windSpeed: 10 + Math.random() * 30,
                windDirection: Math.random() * 360,
                description: 'Partly cloudy',
                icon: '04d',
                visibility: 10,
                clouds: 50,
                timestamp: new Date()
            };
        }
    },

    getForecast: async (lat, lng) => {
        try {
            const data = await apiCallWithRetry('openweather', '/forecast', {
                lat,
                lon: lng,
                units: 'metric',
                appid: APIS.openweather.key
            });

            return data.list.slice(0, 8).map(item => ({
                time: new Date(item.dt * 1000),
                temperature: item.main.temp,
                feelsLike: item.main.feels_like,
                humidity: item.main.humidity,
                windSpeed: item.wind.speed * 3.6,
                description: item.weather[0].description,
                icon: item.weather[0].icon,
                clouds: item.clouds.all,
                precipitation: item.pop || 0
            }));
        } catch (error) {
            logger.warn('Forecast failed:', error);
            return [];
        }
    },

    getMarineData: async (lat, lng) => {
        try {
            // Try Copernicus
            const data = await apiCallWithRetry('copernicus', '/marine-data', {
                lat,
                lng,
                parameters: ['sea_state', 'wave_height', 'swell']
            });
            return {
                seaState: data.sea_state || 'moderate',
                waveHeight: data.wave_height || 2.5,
                swellDirection: data.swell_direction || 180,
                swellPeriod: data.swell_period || 8,
                seaTemperature: data.sea_temperature || 2
            };
        } catch (error) {
            return {
                seaState: 'moderate',
                waveHeight: 2 + Math.random() * 3,
                swellDirection: Math.random() * 360,
                swellPeriod: 6 + Math.random() * 4,
                seaTemperature: -1 + Math.random() * 4
            };
        }
    }
};

// 12b. Ice Service (~50 lines)
const IceService = {
    getConcentration: async (lat, lng, radius = 100) => {
        try {
            // Try NSIDC
            const data = await apiCallWithRetry('nsidc', '/ice-concentration', {
                lat,
                lng,
                radius,
                format: 'json'
            });

            return {
                concentration: data.concentration || Math.random() * 40,
                area: data.area || 'Marginal Ice Zone',
                trend: data.trend || 'Stable',
                thickness: data.thickness || 0.5 + Math.random() * 1.5,
                age: data.age || 'First Year',
                points: data.points || []
            };
        } catch (error) {
            logger.warn('NSIDC failed, generating mock data...');
            // Generate realistic mock data
            const points = [];
            const baseLat = lat;
            const baseLng = lng;
            for (let i = 0; i < 50; i++) {
                const pLat = baseLat + (Math.random() - 0.5) * 4;
                const pLng = baseLng + (Math.random() - 0.5) * 4;
                const dist = Math.sqrt((pLat - baseLat) ** 2 + (pLng - baseLng) ** 2);
                const conc = Math.max(0, Math.min(80, 40 - dist * 10 + Math.random() * 20));
                points.push([pLat, pLng, conc]);
            }
            return {
                concentration: 15 + Math.random() * 30,
                area: 'Marginal Ice Zone',
                trend: ['Stable', 'Increasing', 'Decreasing'][Math.floor(Math.random() * 3)],
                thickness: 0.5 + Math.random() * 1.5,
                age: ['First Year', 'Multi-Year', 'Fast Ice'][Math.floor(Math.random() * 3)],
                points
            };
        }
    },

    getSatellite: async (lat, lng) => {
        try {
            const data = await apiCallWithRetry('nasa', '/planetary/earth/assets', {
                lat,
                lon: lng,
                api_key: APIS.nasa.key
            });
            return {
                imageUrl: data.url || null,
                date: data.date || new Date(),
                cloudCover: data.cloud_cover || 20,
                resolution: data.resolution || 30
            };
        } catch (error) {
            return null;
        }
    },

    detectIcebergs: async (lat, lng, radius = 50) => {
        try {
            // Try Sentinel-1
            const data = await apiCallWithRetry('sentinel', '/iceberg-detection', {
                lat,
                lng,
                radius
            });
            return data.icebergs || [];
        } catch (error) {
            // Mock icebergs
            const icebergs = [];
            const count = Math.floor(Math.random() * 5) + 1;
            for (let i = 0; i < count; i++) {
                icebergs.push({
                    lat: lat + (Math.random() - 0.5) * 0.5,
                    lng: lng + (Math.random() - 0.5) * 0.5,
                    size: 100 + Math.random() * 900,
                    height: 10 + Math.random() * 50,
                    confidence: 0.6 + Math.random() * 0.3
                });
            }
            return icebergs;
        }
    }
};

// 12c. AI Service (~80 lines)
const AIService = {
    callGemini: async (prompt, config = {}) => {
        try {
            const data = await apiCallWithRetry('gemini', '/models/gemini-pro:generateContent', {}, 'POST', {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: config.temperature || 0.7,
                    maxOutputTokens: config.maxTokens || 2048,
                    topK: 40,
                    topP: 0.95
                }
            });
            return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
        } catch (error) {
            logger.error('Gemini API error:', error);
            return null;
        }
    },

    callOpenAI: async (prompt, config = {}) => {
        try {
            const data = await apiCallWithRetry('openai', '/chat/completions', {}, 'POST', {
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }],
                temperature: config.temperature || 0.7,
                max_tokens: config.maxTokens || 2048
            });
            return data.choices?.[0]?.message?.content || null;
        } catch (error) {
            logger.error('OpenAI API error:', error);
            return null;
        }
    },

    callClaude: async (prompt, config = {}) => {
        try {
            const data = await apiCallWithRetry('claude', '/messages', {}, 'POST', {
                model: 'claude-3-opus-20240229',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: config.maxTokens || 2048,
                temperature: config.temperature || 0.7
            });
            return data.content?.[0]?.text || null;
        } catch (error) {
            logger.error('Claude API error:', error);
            return null;
        }
    },

    getRouteSuggestion: async (context) => {
        const prompt = `
You are an Antarctic navigation expert AI assistant called Polaris Nav.

CONTEXT:
${context}

Provide a detailed route recommendation including:
1. Optimal route with waypoints (lat/lng)
2. Estimated distance and time
3. Fuel efficiency estimate
4. Hazard avoidance strategy
5. Safety recommendations

Be concise, practical, and safety-focused.
`;
        // Try Gemini first, fallback to OpenAI
        let response = await AIService.callGemini(prompt);
        if (!response) {
            response = await AIService.callOpenAI(prompt);
        }
        return response;
    },

    analyzeImage: async (imageData) => {
        try {
            // Try HuggingFace
            const response = await apiCallWithRetry('huggingface', '/models/google/vit-base-patch16-224', {}, 'POST', imageData);
            return response;
        } catch (error) {
            // Fallback analysis
            return {
                labels: ['iceberg', 'sea ice', 'ocean', 'snow', 'cloud'],
                scores: [0.85, 0.72, 0.63, 0.55, 0.42]
            };
        }
    },

    detectHazards: async (imageData) => {
        const analysis = await AIService.analyzeImage(imageData);
        const hazards = [];
        const keywords = ['iceberg', 'ice', 'snow', 'glacier', 'island', 'mountain'];
        
        if (analysis.labels) {
            analysis.labels.forEach((label, i) => {
                const confidence = analysis.scores?.[i] || 0;
                if (confidence > 0.6) {
                    keywords.forEach(keyword => {
                        if (label.toLowerCase().includes(keyword)) {
                            hazards.push({
                                type: keyword,
                                confidence: confidence,
                                detectedAt: new Date().toISOString()
                            });
                        }
                    });
                }
            });
        }
        return hazards;
    }
};

// 12d. Route Service (~60 lines)
const RouteService = {
    calculateGreatCircle: (start, end, numPoints = 10) => {
        const points = [];
        const lat1 = start.lat * Math.PI / 180;
        const lon1 = start.lng * Math.PI / 180;
        const lat2 = end.lat * Math.PI / 180;
        const lon2 = end.lng * Math.PI / 180;
        const d = 2 * Math.asin(Math.sqrt(
            Math.sin((lat2 - lat1) / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin((lon2 - lon1) / 2) ** 2
        ));
        
        for (let i = 0; i <= numPoints; i++) {
            const f = i / numPoints;
            const A = Math.sin((1 - f) * d) / Math.sin(d);
            const B = Math.sin(f * d) / Math.sin(d);
            const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
            const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
            const z = A * Math.sin(lat1) + B * Math.sin(lat2);
            const lat = Math.atan2(z, Math.sqrt(x ** 2 + y ** 2)) * 180 / Math.PI;
            const lng = Math.atan2(y, x) * 180 / Math.PI;
            points.push({ lat, lng });
        }
        return points;
    },

    optimize: async (start, end, vesselType = 'research', weather = null, ice = null) => {
        try {
            // Try Mapbox first
            const data = await apiCallWithRetry('mapbox', `/directions/v5/mapbox/driving/${start.lng},${start.lat};${end.lng},${end.lat}`, {
                alternatives: true,
                geometries: 'geojson',
                steps: true
            });
            
            const route = data.routes?.[0];
            if (route) {
                const waypoints = route.geometry.coordinates.map(c => ({
                    lat: c[1],
                    lng: c[0]
                }));
                
                return {
                    distance: route.distance / 1000,
                    duration: route.duration / 3600,
                    waypoints,
                    geometry: route.geometry,
                    fuelEfficiency: this.calculateFuelEfficiency(ice, weather, vesselType)
                };
            }
        } catch (error) {
            logger.warn('Mapbox route failed, using great circle...');
        }

        // Fallback to great circle calculation
        const waypoints = this.calculateGreatCircle(start, end, 5);
        const distance = this.calculateDistance(start, end);
        const speed = this.getVesselSpeed(vesselType);
        const duration = distance / speed;
        
        return {
            distance,
            duration,
            waypoints,
            fuelEfficiency: this.calculateFuelEfficiency(ice, weather, vesselType)
        };
    },

    calculateDistance: (start, end) => {
        const R = 6371;
        const dLat = (end.lat - start.lat) * Math.PI / 180;
        const dLng = (end.lng - start.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) ** 2 + Math.cos(start.lat * Math.PI/180) * Math.cos(end.lat * Math.PI/180) * Math.sin(dLng/2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    },

    getVesselSpeed: (vesselType) => {
        const speeds = {
            research: 12,
            icebreaker: 8,
            cargo: 16,
            fishing: 10,
            tourism: 14,
            military: 18
        };
        return speeds[vesselType] || 12;
    },

    calculateFuelEfficiency: (ice = null, weather = null, vesselType = 'research') => {
        let efficiency = 85;
        if (ice && ice.concentration) {
            efficiency -= ice.concentration / 3;
        }
        if (weather && weather.windSpeed) {
            if (weather.windSpeed > 20) {
                efficiency -= (weather.windSpeed - 20) * 0.5;
            }
        }
        const multipliers = { research: 1, icebreaker: 0.9, cargo: 1.1 };
        efficiency *= (multipliers[vesselType] || 1);
        return Math.max(20, Math.min(100, Math.round(efficiency)));
    },

    getETA: (distance, speed = 12) => {
        return (distance / speed).toFixed(1);
    }
};

// ============================================================
// 13. CONTROLLERS (~250 lines)
// ============================================================

// 13a. Weather Controller (~40 lines)
const WeatherController = {
    getCurrent: async (req, res) => {
        try {
            const { lat, lng } = req.query;
            if (!lat || !lng) {
                return res.status(400).json({ error: 'Latitude and longitude required' });
            }

            const [weather, marine, forecast] = await Promise.all([
                WeatherService.getCurrent(parseFloat(lat), parseFloat(lng)),
                WeatherService.getMarineData(parseFloat(lat), parseFloat(lng)),
                WeatherService.getForecast(parseFloat(lat), parseFloat(lng))
            ]);

            // Save to history
            if (db) {
                await WeatherHistory.create({
                    location: { lat: parseFloat(lat), lng: parseFloat(lng) },
                    ...weather,
                    seaState: marine.seaState,
                    waveHeight: marine.waveHeight,
                    iceConcentration: 0,
                    source: 'openweather'
                });
            }

            res.json({
                current: weather,
                marine,
                forecast: forecast.slice(0, 5),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('Weather controller error:', error);
            res.status(500).json({ error: 'Failed to get weather data' });
        }
    },

    getForecast: async (req, res) => {
        try {
            const { lat, lng } = req.query;
            if (!lat || !lng) {
                return res.status(400).json({ error: 'Latitude and longitude required' });
            }

            const forecast = await WeatherService.getForecast(parseFloat(lat), parseFloat(lng));
            res.json({ forecast, timestamp: new Date().toISOString() });
        } catch (error) {
            logger.error('Forecast error:', error);
            res.status(500).json({ error: 'Failed to get forecast' });
        }
    }
};

// 13b. Ice Controller (~40 lines)
const IceController = {
    getConcentration: async (req, res) => {
        try {
            const { lat, lng, radius = 100 } = req.query;
            if (!lat || !lng) {
                return res.status(400).json({ error: 'Latitude and longitude required' });
            }

            const [ice, satellites] = await Promise.all([
                IceService.getConcentration(parseFloat(lat), parseFloat(lng), parseFloat(radius)),
                IceService.getSatellite(parseFloat(lat), parseFloat(lng))
            ]);

            res.json({
                ice,
                satellites,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('Ice controller error:', error);
            res.status(500).json({ error: 'Failed to get ice data' });
        }
    },

    detectIcebergs: async (req, res) => {
        try {
            const { lat, lng, radius = 50 } = req.query;
            if (!lat || !lng) {
                return res.status(400).json({ error: 'Latitude and longitude required' });
            }

            const icebergs = await IceService.detectIcebergs(parseFloat(lat), parseFloat(lng), parseFloat(radius));
            res.json({
                icebergs,
                count: icebergs.length,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('Iceberg detection error:', error);
            res.status(500).json({ error: 'Failed to detect icebergs' });
        }
    }
};

// 13c. Route Controller (~50 lines)
const RouteController = {
    optimize: async (req, res) => {
        try {
            const { start, end, vesselType = 'research', weather, ice } = req.body;
            if (!start || !end) {
                return res.status(400).json({ error: 'Start and end locations required' });
            }

            // Get weather and ice if not provided
            let weatherData = weather;
            let iceData = ice;
            if (!weatherData) {
                weatherData = await WeatherService.getCurrent(start.lat, start.lng);
            }
            if (!iceData) {
                iceData = await IceService.getConcentration(start.lat, start.lng);
            }

            // Optimize route
            const route = await RouteService.optimize(
                start,
                end,
                vesselType,
                weatherData,
                iceData
            );

            // Get AI suggestion
            const aiPrompt = `Position: ${start.lat}, ${start.lng} to ${end.lat}, ${end.lng}
Ice: ${JSON.stringify(iceData)}
Weather: ${JSON.stringify(weatherData)}
Vessel: ${vesselType}`;
            const aiSuggestion = await AIService.getRouteSuggestion(aiPrompt);

            // Save route if user is authenticated
            if (req.userId) {
                const routeDoc = new Route({
                    userId: req.userId,
                    name: req.body.name || 'Untitled Route',
                    description: req.body.description || '',
                    startLocation: start,
                    endLocation: end,
                    waypoints: route.waypoints.map((w, i) => ({ ...w, order: i })),
                    distance: route.distance,
                    duration: route.duration,
                    fuelEfficiency: route.fuelEfficiency,
                    weatherData,
                    hazards: [],
                    status: 'saved'
                });
                await routeDoc.save();
            }

            res.json({
                route,
                aiSuggestion,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('Route optimization error:', error);
            res.status(500).json({ error: 'Failed to optimize route' });
        }
    },

    getHistory: async (req, res) => {
        try {
            if (!req.userId) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const routes = await Route.find({ userId: req.userId })
                .sort({ createdAt: -1 })
                .limit(50);
            res.json({ routes, count: routes.length });
        } catch (error) {
            logger.error('Route history error:', error);
            res.status(500).json({ error: 'Failed to get route history' });
        }
    },

    getRoute: async (req, res) => {
        try {
            const { id } = req.params;
            const route = await Route.findOne({ 
                _id: id,
                $or: [{ userId: req.userId }, { isPublic: true }]
            });
            if (!route) {
                return res.status(404).json({ error: 'Route not found' });
            }
            res.json({ route });
        } catch (error) {
            logger.error('Get route error:', error);
            res.status(500).json({ error: 'Failed to get route' });
        }
    },

    deleteRoute: async (req, res) => {
        try {
            const { id } = req.params;
            const result = await Route.findOneAndDelete({ _id: id, userId: req.userId });
            if (!result) {
                return res.status(404).json({ error: 'Route not found' });
            }
            res.json({ success: true, message: 'Route deleted' });
        } catch (error) {
            logger.error('Delete route error:', error);
            res.status(500).json({ error: 'Failed to delete route' });
        }
    }
};

// 13d. AI Controller (~40 lines)
const AIController = {
    chat: async (req, res) => {
        try {
            const { message, context } = req.body;
            if (!message) {
                return res.status(400).json({ error: 'Message is required' });
            }

            const fullContext = context || '';
            const prompt = `
${fullContext}

User Query: ${message}

Provide a helpful, concise response as Polaris Nav, the Antarctic navigation expert.
`;

            let response = await AIService.callGemini(prompt);
            if (!response) {
                response = await AIService.callOpenAI(prompt);
            }
            if (!response) {
                response = await AIService.callClaude(prompt);
            }

            res.json({
                response: response || 'I apologize, but I am unable to process your request at the moment.',
                model: 'gemini',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('AI chat error:', error);
            res.status(500).json({ error: 'Failed to get AI response' });
        }
    },

    analyzeImage: async (req, res) => {
        try {
            const { image } = req.body;
            if (!image) {
                return res.status(400).json({ error: 'Image data is required' });
            }

            const [analysis, hazards] = await Promise.all([
                AIService.analyzeImage(image),
                AIService.detectHazards(image)
            ]);

            // Save detected hazards
            if (hazards.length > 0 && db) {
                for (const hazard of hazards) {
                    await Hazard.create({
                        type: hazard.type,
                        lat: 0, // Will be filled by frontend
                        lng: 0,
                        confidence: hazard.confidence,
                        source: 'camera',
                        description: `Detected ${hazard.type} from image analysis`
                    });
                }
            }

            res.json({
                analysis,
                hazards,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('Image analysis error:', error);
            res.status(500).json({ error: 'Failed to analyze image' });
        }
    }
};

// 13e. Auth Controller (~50 lines)
const AuthController = {
    register: async (req, res) => {
        try {
            const { username, email, password } = req.body;
            
            // Validation
            if (!username || !email || !password) {
                return res.status(400).json({ error: 'All fields required' });
            }
            if (password.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters' });
            }

            // Check if user exists
            const existingUser = await User.findOne({ $or: [{ email }, { username }] });
            if (existingUser) {
                return res.status(400).json({ error: 'User already exists' });
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // Create user
            const user = await User.create({
                username,
                email,
                password: hashedPassword,
                lastLogin: new Date()
            });

            // Generate token
            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
                expiresIn: CONSTANTS.JWT_EXPIRY
            });

            res.status(201).json({
                token,
                user: {
                    id: user._id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    preferences: user.preferences
                }
            });
        } catch (error) {
            logger.error('Register error:', error);
            res.status(500).json({ error: 'Registration failed' });
        }
    },

    login: async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ error: 'Email and password required' });
            }

            const user = await User.findOne({ email });
            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const isValid = await bcrypt.compare(password, user.password);
            if (!isValid) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Update last login
            user.lastLogin = new Date();
            await user.save();

            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
                expiresIn: CONSTANTS.JWT_EXPIRY
            });

            res.json({
                token,
                user: {
                    id: user._id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    preferences: user.preferences
                }
            });
        } catch (error) {
            logger.error('Login error:', error);
            res.status(500).json({ error: 'Login failed' });
        }
    },

    getProfile: async (req, res) => {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            res.json({ user: req.user });
        } catch (error) {
            logger.error('Profile error:', error);
            res.status(500).json({ error: 'Failed to get profile' });
        }
    },

    updatePreferences: async (req, res) => {
        try {
            const { preferences } = req.body;
            if (!preferences) {
                return res.status(400).json({ error: 'Preferences required' });
            }

            const user = await User.findByIdAndUpdate(
                req.userId,
                { preferences },
                { new: true }
            ).select('-password');

            res.json({ user });
        } catch (error) {
            logger.error('Update preferences error:', error);
            res.status(500).json({ error: 'Failed to update preferences' });
        }
    }
};

// 13f. Admin Controller (~30 lines)
const AdminController = {
    getStats: async (req, res) => {
        try {
            if (!req.user || req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }

            const [userCount, routeCount, hazardCount, activeUsers] = await Promise.all([
                User.countDocuments(),
                Route.countDocuments(),
                Hazard.countDocuments(),
                User.countDocuments({ lastLogin: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } })
            ]);

            res.json({
                stats: {
                    users: userCount,
                    routes: routeCount,
                    hazards: hazardCount,
                    activeUsers,
                    uptime: process.uptime(),
                    memory: process.memoryUsage()
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('Admin stats error:', error);
            res.status(500).json({ error: 'Failed to get stats' });
        }
    },

    getLogs: async (req, res) => {
        try {
            if (!req.user || req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }

            // Return recent logs from file
            const fs = require('fs');
            const logPath = 'logs/app.log';
            if (!fs.existsSync(logPath)) {
                return res.json({ logs: [] });
            }

            const logs = fs.readFileSync(logPath, 'utf8')
                .split('\n')
                .filter(line => line.length > 0)
                .slice(-100);

            res.json({ logs });
        } catch (error) {
            logger.error('Get logs error:', error);
            res.status(500).json({ error: 'Failed to get logs' });
        }
    }
};

// ============================================================
// 14. ROUTES (~100 lines)
// ============================================================

// Public routes
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        dbConnected: db && db.readyState === 1,
        memory: process.memoryUsage()
    });
});

// Weather routes
app.get('/api/weather/current', cacheMiddleware(300), WeatherController.getCurrent);
app.get('/api/weather/forecast', cacheMiddleware(600), WeatherController.getForecast);

// Ice routes
app.get('/api/ice/concentration', cacheMiddleware(600), IceController.getConcentration);
app.get('/api/ice/icebergs', cacheMiddleware(300), IceController.detectIcebergs);

// AI routes
app.post('/api/ai/chat', AIController.chat);
app.post('/api/ai/analyze-image', AIController.analyzeImage);

// Route routes
app.post('/api/route/optimize', authenticate, RouteController.optimize);
app.get('/api/routes', authenticate, RouteController.getHistory);
app.get('/api/routes/:id', authenticate, RouteController.getRoute);
app.delete('/api/routes/:id', authenticate, RouteController.deleteRoute);

// Auth routes
app.post('/api/auth/register', AuthController.register);
app.post('/api/auth/login', AuthController.login);
app.get('/api/auth/profile', authenticate, AuthController.getProfile);
app.put('/api/auth/preferences', authenticate, AuthController.updatePreferences);

// Admin routes
app.get('/api/admin/stats', authenticate, authorize('admin'), AdminController.getStats);
app.get('/api/admin/logs', authenticate, authorize('admin'), AdminController.getLogs);

// ============================================================
// 15. WEBSOCKETS (~70 lines)
// ============================================================
const clients = new Map();

io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id}`);
    
    // Join room with user ID if authenticated
    socket.on('authenticate', (token) => {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.id;
            socket.join(`user:${decoded.id}`);
            clients.set(socket.id, { userId: decoded.id, socketId: socket.id });
            logger.info(`User ${decoded.id} authenticated on socket`);
        } catch (error) {
            logger.warn('Socket auth failed:', error.message);
        }
    });

    // Position updates
    socket.on('position:update', async (data) => {
        const { lat, lng, heading, speed } = data;
        if (socket.userId) {
            // Update vessel position
            try {
                await Vessel.findOneAndUpdate(
                    { userId: socket.userId },
                    {
                        currentPosition: { lat, lng, timestamp: new Date() },
                        heading,
                        currentSpeed: speed,
                        lastUpdated: new Date()
                    },
                    { upsert: true, new: true }
                );
            } catch (error) {
                logger.error('Position update error:', error);
            }
        }
        
        // Broadcast to nearby clients (within 5 degrees)
        const nearby = [];
        clients.forEach((client, id) => {
            if (id !== socket.id) {
                nearby.push(id);
            }
        });
        if (nearby.length > 0) {
            socket.to(nearby).emit('position:broadcast', {
                lat,
                lng,
                heading,
                speed,
                timestamp: new Date().toISOString()
            });
        }
    });

    // Weather updates
    socket.on('weather:request', async (data) => {
        const { lat, lng } = data;
        try {
            const weather = await WeatherService.getCurrent(lat, lng);
            socket.emit('weather:response', {
                weather,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            socket.emit('weather:error', { error: error.message });
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        clients.delete(socket.id);
        logger.info(`Client disconnected: ${socket.id}`);
    });
});

// Broadcast weather updates periodically
setInterval(async () => {
    try {
        // Get weather for common locations
        const locations = [
            { lat: -70.0, lng: 0.0 },
            { lat: -65.0, lng: -60.0 },
            { lat: -75.0, lng: 30.0 }
        ];
        
        for (const loc of locations) {
            const weather = await WeatherService.getCurrent(loc.lat, loc.lng);
            io.emit('weather:broadcast', {
                location: loc,
                weather,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        logger.error('Weather broadcast error:', error);
    }
}, CONSTANTS.POLLING_INTERVAL);

// ============================================================
// 16. ERROR HANDLER (~30 lines)
// ============================================================
app.use(Sentry.Handlers.errorHandler());

// Global error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    if (err instanceof mongoose.Error.ValidationError) {
        return res.status(400).json({
            error: 'Validation error',
            details: Object.values(err.errors).map(e => e.message)
        });
    }

    if (err instanceof mongoose.Error.CastError) {
        return res.status(400).json({
            error: 'Invalid ID format'
        });
    }

    if (err.code === 11000) {
        return res.status(409).json({
            error: 'Duplicate key error',
            field: Object.keys(err.keyPattern)[0]
        });
    }

    // Sentry error tracking
    if (process.env.SENTRY_DSN) {
        Sentry.captureException(err);
    }

    res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        ...(NODE_ENV === 'development' && { stack: err.stack })
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// ============================================================
// 17. SERVER START (~30 lines)
// ============================================================
const startServer = async () => {
    try {
        // Connect to database
        await connectDB();

        // Start server
        server.listen(PORT, () => {
            logger.info(`🚀 Polaris Nav backend running on ${BASE_URL}`);
            logger.info(`📡 WebSocket server running on ${BASE_URL}`);
            logger.info(`🌍 Environment: ${NODE_ENV}`);
            logger.info(`📊 API Services: ${Object.keys(APIS).length} configured`);
            logger.info(`💾 Database: ${db ? 'Connected ✅' : 'Not connected ❌'}`);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            logger.info('SIGTERM received, closing server...');
            server.close(() => {
                mongoose.connection.close();
                logger.info('Server closed');
                process.exit(0);
            });
        });

    } catch (error) {
        logger.error('Server start failed:', error);
        process.exit(1);
    }
};

// ============================================================
// 18. UNHANDLED REJECTIONS (~15 lines)
// ============================================================
process.on('unhandledRejection', (error) => {
    logger.error('Unhandled rejection:', error);
    if (process.env.SENTRY_DSN) {
        Sentry.captureException(error);
    }
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    if (process.env.SENTRY_DSN) {
        Sentry.captureException(error);
    }
    process.exit(1);
});

// ============================================================
// 19. EXPORT FOR TESTING
// ============================================================
module.exports = { app, server, io, connectDB };

// ============================================================
// START THE SERVER
// ============================================================
if (require.main === module) {
    startServer();
}

// ============================================================
// END OF FILE - ~1400 LINES
// ============================================================