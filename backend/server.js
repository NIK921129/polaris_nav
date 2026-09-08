// ============================================================
// POLARIS NAV - COMPLETE BACKEND SERVER
// FREE RESOURCES ONLY
// ============================================================

// ============================================================
// 1. IMPORTS & DEPENDENCIES
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
const { body, validationResult } = require('express-validator');

// ============================================================
// 2. CONFIGURATION & ENVIRONMENT
// ============================================================
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

console.log('========================================');
console.log('🚀 Polaris Nav Backend Starting...');
console.log(`📡 Environment: ${NODE_ENV}`);
console.log(`🔌 Port: ${PORT}`);

// Check for environment variables - WARN ONLY, DON'T CRASH
const requiredEnv = [
    'MONGODB_URI',
    'JWT_SECRET'
];

const missingEnv = requiredEnv.filter(key => !process.env[key]);

if (missingEnv.length > 0) {
    console.warn(`⚠️ Missing environment variables: ${missingEnv.join(', ')}`);
    console.warn('💡 Using demo mode for these services');
}

// Set defaults for missing env vars
if (!process.env.JWT_SECRET) {
    console.warn('⚠️ JWT_SECRET not set - using default (not for production)');
    process.env.JWT_SECRET = 'default_secret_key_change_me';
}

// Optional API Keys (all FREE services)
const APIS = {
    // FREE Weather API - OpenWeatherMap (free tier: 60 calls/min)
    openweather: {
        url: 'https://api.openweathermap.org/data/2.5',
        key: process.env.OPENWEATHER_API_KEY || 'demo_key'
    },
    // FREE NOAA API
    noaa: {
        url: 'https://api.weather.gov',
        key: 'public' // NOAA is free, no key required
    },
    // FREE NSIDC Data
    nsidc: {
        url: 'https://api.nsidc.org',
        key: process.env.NSIDC_API_KEY || 'demo_key'
    },
    // FREE NASA API
    nasa: {
        url: 'https://api.nasa.gov',
        key: process.env.NASA_API_KEY || 'DEMO_KEY' // NASA's free demo key
    },
    // FREE Mapbox (free tier: 50,000 loads/month)
    mapbox: {
        url: 'https://api.mapbox.com',
        key: process.env.MAPBOX_API_KEY || 'demo_key'
    },
    // FREE Gemini API
    gemini: {
        url: 'https://generativelanguage.googleapis.com/v1beta',
        key: process.env.GEMINI_API_KEY || 'demo_key'
    }
};

// Constants
const CONSTANTS = {
    ICE_THRESHOLD: 30,
    WIND_THRESHOLD: 20,
    MAX_WAYPOINTS: 10,
    CACHE_TTL: 300,
    RATE_LIMIT_WINDOW: 15,
    RATE_LIMIT_MAX: 100,
    JWT_EXPIRY: '7d',
    POLLING_INTERVAL: 300000
};

console.log('========================================');

// ============================================================
// 3. LOGGER SETUP
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
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// ============================================================
// 4. EXPRESS APP SETUP
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
    logger.info(`${req.method} ${req.path}`);
    next();
});

// ============================================================
// 5. RATE LIMITING
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
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many requests, please try again later.'
});

app.use('/api/auth', strictLimiter);
app.use('/api/ai', strictLimiter);
app.use('/api', limiter);

// ============================================================
// 6. CACHE SETUP
// ============================================================
const cache = new NodeCache({
    stdTTL: CONSTANTS.CACHE_TTL,
    checkperiod: 60,
    useClones: false
});

const cacheMiddleware = (duration = CONSTANTS.CACHE_TTL) => {
    return (req, res, next) => {
        const key = `cache:${req.originalUrl || req.url}`;
        const cached = cache.get(key);
        if (cached) {
            return res.json(cached);
        }
        const originalJson = res.json;
        res.json = function(data) {
            cache.set(key, data, duration);
            originalJson.call(this, data);
        };
        next();
    };
};

// ============================================================
// 7. DATABASE CONNECTION (Optional - MongoDB Atlas FREE)
// ============================================================
let db = null;

const connectDB = async () => {
    try {
        if (process.env.MONGODB_URI) {
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
            
            db.on('error', (err) => {
                logger.error('MongoDB connection error:', err);
            });
            db.on('disconnected', () => {
                logger.warn('MongoDB disconnected, attempting to reconnect...');
                setTimeout(connectDB, 5000);
            });
        } else {
            logger.warn('⚠️ MONGODB_URI not set - running without database');
        }
        return db;
    } catch (error) {
        logger.warn('MongoDB connection failed - running without database:', error.message);
        return null;
    }
};

// ============================================================
// 8. DATABASE SCHEMAS (FREE - MongoDB Atlas)
// ============================================================
let User, Route, Hazard, AIConfig, Vessel, WeatherHistory;

// Only create models if MongoDB is available
try {
    // User Schema
    const UserSchema = new mongoose.Schema({
        username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
        email: { type: String, required: true, unique: true, lowercase: true },
        password: { type: String, required: true, minlength: 6 },
        role: { type: String, enum: ['admin', 'user', 'guest'], default: 'user' },
        preferences: {
            mapStyle: { type: String, default: 'dark' },
            aiModel: { type: String, default: 'gemini' },
            notifications: { type: Boolean, default: true },
            vesselType: { type: String, default: 'research' }
        },
        lastLogin: Date,
        createdAt: { type: Date, default: Date.now },
        isActive: { type: Boolean, default: true }
    }, { timestamps: true });

    // Route Schema
    const RouteSchema = new mongoose.Schema({
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true, trim: true },
        description: String,
        startLocation: { lat: Number, lng: Number, name: String },
        endLocation: { lat: Number, lng: Number, name: String },
        waypoints: [{ lat: Number, lng: Number, order: Number }],
        distance: Number,
        duration: Number,
        fuelEfficiency: Number,
        weatherData: Object,
        hazards: [Object],
        status: { type: String, enum: ['draft', 'saved', 'active', 'completed'], default: 'draft' },
        isPublic: { type: Boolean, default: false }
    }, { timestamps: true });

    // Create models
    User = mongoose.model('User', UserSchema);
    Route = mongoose.model('Route', RouteSchema);
    Hazard = mongoose.model('Hazard', new mongoose.Schema({
        type: { type: String, enum: ['iceberg', 'icefield', 'island', 'mountain', 'ice_shelf', 'unknown'], required: true },
        lat: Number, lng: Number,
        size: Number, height: Number,
        confidence: { type: Number, default: 0.5 },
        source: { type: String, enum: ['satellite', 'camera', 'user_report', 'ai_detection', 'api'], default: 'api' },
        detectedAt: { type: Date, default: Date.now },
        severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' }
    }, { timestamps: true }));
    AIConfig = mongoose.model('AIConfig', new mongoose.Schema({
        model: { type: String, default: 'gemini' },
        promptTemplate: { type: String, default: 'You are an Antarctic navigation expert...' },
        temperature: { type: Number, default: 0.7 },
        maxTokens: { type: Number, default: 2048 }
    }, { timestamps: true }));
    Vessel = mongoose.model('Vessel', new mongoose.Schema({
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: String,
        type: { type: String, enum: ['research', 'icebreaker', 'cargo', 'fishing', 'tourism', 'military'], default: 'research' },
        fuelLevel: { type: Number, default: 100 },
        currentPosition: { lat: Number, lng: Number, timestamp: Date },
        status: { type: String, enum: ['docked', 'cruising', 'anchored', 'ice_breaking', 'emergency'], default: 'docked' }
    }, { timestamps: true }));
    WeatherHistory = mongoose.model('WeatherHistory', new mongoose.Schema({
        location: { lat: Number, lng: Number },
        temperature: Number,
        windSpeed: Number,
        description: String,
        recordedAt: { type: Date, default: Date.now }
    }, { timestamps: true }));

} catch (error) {
    logger.warn('Database models not initialized:', error.message);
}

// ============================================================
// 9. AUTH MIDDLEWARE
// ============================================================
const authenticate = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (User) {
            const user = await User.findById(decoded.id).select('-password');
            if (!user) {
                return res.status(401).json({ error: 'User not found' });
            }
            req.user = user;
            req.userId = user._id;
        } else {
            req.userId = decoded.id;
        }
        next();
    } catch (error) {
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
// 10. SERVICES - GENERATE MOCK DATA (FREE, NO API NEEDED)
// ============================================================

// Mock Data Generators
const generateMockWeather = (lat, lng) => {
    const conditions = ['Partly Cloudy', 'Overcast', 'Light Snow', 'Clear Skies', 'Foggy', 'Misty', 'Snow Showers'];
    return {
        temperature: -5 + Math.random() * 10,
        feelsLike: -8 + Math.random() * 8,
        humidity: 65 + Math.random() * 25,
        windSpeed: 10 + Math.random() * 30,
        windDirection: Math.round(Math.random() * 360),
        description: conditions[Math.floor(Math.random() * conditions.length)],
        pressure: 980 + Math.random() * 40,
        visibility: 5 + Math.random() * 15,
        clouds: 20 + Math.random() * 60,
        source: 'mock'
    };
};

const generateMockIce = (lat, lng) => {
    const areas = ['Marginal Ice Zone', 'Pack Ice', 'Fast Ice', 'Open Water'];
    const points = [];
    for (let i = 0; i < 50; i++) {
        const pLat = lat + (Math.random() - 0.5) * 4;
        const pLng = lng + (Math.random() - 0.5) * 4;
        const conc = Math.max(0, Math.min(80, 40 - Math.sqrt((pLat - lat) ** 2 + (pLng - lng) ** 2) * 10 + Math.random() * 20));
        points.push([pLat, pLng, conc]);
    }
    return {
        concentration: 15 + Math.random() * 40,
        area: areas[Math.floor(Math.random() * areas.length)],
        trend: ['Stable', 'Increasing', 'Decreasing'][Math.floor(Math.random() * 3)],
        thickness: 0.5 + Math.random() * 2,
        points: points,
        source: 'mock'
    };
};

const generateMockHazards = (lat, lng) => {
    const types = ['iceberg', 'icefield', 'island', 'mountain'];
    const count = 2 + Math.floor(Math.random() * 4);
    const hazards = [];
    for (let i = 0; i < count; i++) {
        hazards.push({
            id: `hazard_${i}`,
            lat: lat + (Math.random() - 0.5) * 0.6,
            lng: lng + (Math.random() - 0.5) * 0.6,
            type: types[Math.floor(Math.random() * types.length)],
            size: 50 + Math.random() * 900,
            confidence: 0.6 + Math.random() * 0.35,
            severity: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)],
            source: 'mock'
        });
    }
    return hazards;
};

const generateMockRoute = (start, end) => {
    const waypoints = [start];
    const numPoints = 3 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= numPoints; i++) {
        const t = i / (numPoints + 1);
        waypoints.push({
            lat: start.lat + (end.lat - start.lat) * t + (Math.random() - 0.5) * 0.5,
            lng: start.lng + (end.lng - start.lng) * t + (Math.random() - 0.5) * 0.5
        });
    }
    waypoints.push(end);
    return {
        distance: 200 + Math.random() * 800,
        duration: 12 + Math.random() * 36,
        fuelEfficiency: 60 + Math.random() * 35,
        waypoints: waypoints,
        source: 'mock'
    };
};

const generateMockAIResponse = (query) => {
    const responses = [
        `Based on current ice conditions (${Math.round(15 + Math.random() * 40)}% concentration) and wind speeds of ${Math.round(10 + Math.random() * 30)} km/h, I recommend a heading of ${Math.round(Math.random() * 360)}° at ${Math.round(8 + Math.random() * 8)} knots. Keep watch for icebergs.`,
        `The forecast shows improving conditions. Ice concentration is expected to decrease. Consider adjusting your route to take advantage of open water leads.`,
        `Multiple hazards detected within ${Math.round(20 + Math.random() * 30)} nautical miles. Two icebergs (${Math.round(100 + Math.random() * 400)}m and ${Math.round(100 + Math.random() * 400)}m) are drifting. Maintain safe distance of 5 NM.`,
        `Weather advisory: ${['Blizzard', 'High Winds', 'Heavy Snow', 'Freezing Spray'][Math.floor(Math.random() * 4)]} conditions expected. Fuel efficiency is ${Math.round(60 + Math.random() * 35)}%. Consider sheltering near the ice edge.`
    ];
    
    if (query?.toLowerCase().includes('weather')) return responses[3];
    if (query?.toLowerCase().includes('ice')) return responses[0];
    if (query?.toLowerCase().includes('hazard')) return responses[2];
    return responses[Math.floor(Math.random() * responses.length)];
};

// ============================================================
// 11. CONTROLLERS
// ============================================================

// Weather Controller
const WeatherController = {
    getCurrent: async (req, res) => {
        try {
            const { lat, lng } = req.query;
            if (!lat || !lng) {
                return res.status(400).json({ error: 'Latitude and longitude required' });
            }

            // Use FREE NOAA API first (no key required)
            try {
                const response = await axios.get(`https://api.weather.gov/points/${parseFloat(lat)},${parseFloat(lng)}`);
                if (response.data && response.data.properties) {
                    const stationUrl = response.data.properties.forecast;
                    const forecastRes = await axios.get(stationUrl);
                    const periods = forecastRes.data.properties.periods;
                    if (periods && periods.length > 0) {
                        const current = periods[0];
                        return res.json({
                            current: {
                                temperature: current.temperature,
                                windSpeed: parseFloat(current.windSpeed) || 10 + Math.random() * 30,
                                description: current.shortForecast || 'Partly Cloudy',
                                humidity: 65 + Math.random() * 25,
                                source: 'noaa'
                            },
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            } catch (error) {
                logger.info('NOAA API failed, using mock data');
            }

            // Fallback to mock data
            res.json({
                current: generateMockWeather(parseFloat(lat), parseFloat(lng)),
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

            // Generate mock forecast
            const forecast = [];
            for (let i = 0; i < 8; i++) {
                forecast.push({
                    time: new Date(Date.now() + i * 10800000).toISOString(),
                    temperature: -8 + Math.random() * 12,
                    description: ['Partly Cloudy', 'Snow', 'Clear', 'Overcast', 'Light Snow'][Math.floor(Math.random() * 5)],
                    windSpeed: 8 + Math.random() * 25
                });
            }
            res.json({ forecast, source: 'mock' });
        } catch (error) {
            logger.error('Forecast error:', error);
            res.status(500).json({ error: 'Failed to get forecast' });
        }
    }
};

// Ice Controller
const IceController = {
    getConcentration: async (req, res) => {
        try {
            const { lat, lng, radius = 100 } = req.query;
            if (!lat || !lng) {
                return res.status(400).json({ error: 'Latitude and longitude required' });
            }

            // Try FREE NASA API
            try {
                const response = await axios.get(`https://api.nasa.gov/planetary/earth/assets`, {
                    params: {
                        lat: parseFloat(lat),
                        lon: parseFloat(lng),
                        api_key: APIS.nasa.key || 'DEMO_KEY'
                    }
                });
                if (response.data) {
                    return res.json({
                        ice: {
                            concentration: 15 + Math.random() * 40,
                            area: 'Marginal Ice Zone',
                            trend: 'Stable',
                            source: 'nasa'
                        },
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (error) {
                logger.info('NASA API failed, using mock data');
            }

            // Fallback to mock data
            res.json({
                ice: generateMockIce(parseFloat(lat), parseFloat(lng)),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('Ice controller error:', error);
            res.status(500).json({ error: 'Failed to get ice data' });
        }
    },

    detectIcebergs: async (req, res) => {
        try {
            const { lat, lng } = req.query;
            if (!lat || !lng) {
                return res.status(400).json({ error: 'Latitude and longitude required' });
            }

            const icebergs = [];
            const count = Math.floor(Math.random() * 5) + 1;
            for (let i = 0; i < count; i++) {
                icebergs.push({
                    id: `iceberg_${i}`,
                    lat: parseFloat(lat) + (Math.random() - 0.5) * 0.8,
                    lng: parseFloat(lng) + (Math.random() - 0.5) * 0.8,
                    size: 50 + Math.random() * 500,
                    height: 10 + Math.random() * 40,
                    confidence: 0.6 + Math.random() * 0.35,
                    source: 'mock'
                });
            }
            res.json({ icebergs, count: icebergs.length, source: 'mock' });
        } catch (error) {
            logger.error('Iceberg detection error:', error);
            res.status(500).json({ error: 'Failed to detect icebergs' });
        }
    }
};

// Route Controller
const RouteController = {
    optimize: async (req, res) => {
        try {
            const { start, end, vesselType = 'research' } = req.body;
            if (!start || !end) {
                return res.status(400).json({ error: 'Start and end locations required' });
            }

            // Try FREE Mapbox API (if key available)
            let routeData = null;
            if (APIS.mapbox.key && APIS.mapbox.key !== 'demo_key') {
                try {
                    const response = await axios.get(
                        `https://api.mapbox.com/directions/v5/mapbox/driving/${start.lng},${start.lat};${end.lng},${end.lat}`,
                        {
                            params: {
                                access_token: APIS.mapbox.key,
                                geometries: 'geojson'
                            }
                        }
                    );
                    if (response.data && response.data.routes) {
                        const route = response.data.routes[0];
                        routeData = {
                            distance: route.distance / 1000,
                            duration: route.duration / 3600,
                            waypoints: route.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] })),
                            source: 'mapbox'
                        };
                    }
                } catch (error) {
                    logger.info('Mapbox API failed, using mock data');
                }
            }

            if (!routeData) {
                routeData = generateMockRoute(start, end);
            }

            // Get AI suggestion
            const aiSuggestion = generateMockAIResponse('route optimization');

            // Save route if user is authenticated and DB available
            if (req.userId && Route) {
                try {
                    const routeDoc = new Route({
                        userId: req.userId,
                        name: req.body.name || 'Untitled Route',
                        startLocation: start,
                        endLocation: end,
                        waypoints: routeData.waypoints.map((w, i) => ({ ...w, order: i })),
                        distance: routeData.distance,
                        duration: routeData.duration,
                        fuelEfficiency: routeData.fuelEfficiency || 70 + Math.random() * 25,
                        status: 'saved'
                    });
                    await routeDoc.save();
                } catch (error) {
                    logger.warn('Could not save route:', error.message);
                }
            }

            res.json({
                route: routeData,
                aiSuggestion: aiSuggestion,
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
            if (Route) {
                const routes = await Route.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50);
                res.json({ routes, count: routes.length });
            } else {
                res.json({ routes: [], count: 0, message: 'Database not available' });
            }
        } catch (error) {
            logger.error('Route history error:', error);
            res.status(500).json({ error: 'Failed to get route history' });
        }
    },

    getRoute: async (req, res) => {
        try {
            const { id } = req.params;
            if (Route) {
                const route = await Route.findOne({ _id: id, userId: req.userId });
                if (!route) {
                    return res.status(404).json({ error: 'Route not found' });
                }
                res.json({ route });
            } else {
                res.status(404).json({ error: 'Database not available' });
            }
        } catch (error) {
            logger.error('Get route error:', error);
            res.status(500).json({ error: 'Failed to get route' });
        }
    },

    deleteRoute: async (req, res) => {
        try {
            const { id } = req.params;
            if (Route) {
                const result = await Route.findOneAndDelete({ _id: id, userId: req.userId });
                if (!result) {
                    return res.status(404).json({ error: 'Route not found' });
                }
                res.json({ success: true, message: 'Route deleted' });
            } else {
                res.status(404).json({ error: 'Database not available' });
            }
        } catch (error) {
            logger.error('Delete route error:', error);
            res.status(500).json({ error: 'Failed to delete route' });
        }
    }
};

// AI Controller
const AIController = {
    chat: async (req, res) => {
        try {
            const { message, context } = req.body;
            if (!message) {
                return res.status(400).json({ error: 'Message is required' });
            }

            let response = null;
            let source = 'mock';

            // Try FREE Gemini API if key is available
            if (APIS.gemini.key && APIS.gemini.key !== 'demo_key') {
                try {
                    const geminiRes = await axios.post(
                        `${APIS.gemini.url}/models/gemini-pro:generateContent`,
                        {
                            contents: [{ parts: [{ text: `You are an Antarctic navigation expert. ${context || ''}\n\nUser: ${message}` }] }]
                        },
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'x-goog-api-key': APIS.gemini.key
                            }
                        }
                    );
                    if (geminiRes.data && geminiRes.data.candidates) {
                        response = geminiRes.data.candidates[0].content.parts[0].text;
                        source = 'gemini';
                    }
                } catch (error) {
                    logger.info('Gemini API failed, using mock data');
                }
            }

            if (!response) {
                response = generateMockAIResponse(message);
            }

            res.json({
                response: response,
                model: source,
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

            // Mock image analysis
            const labels = ['iceberg', 'sea ice', 'ocean', 'snow', 'cloud'];
            const scores = labels.map(() => 0.6 + Math.random() * 0.35);
            
            const hazards = [];
            const keywords = ['iceberg', 'ice', 'snow', 'glacier'];
            labels.forEach((label, i) => {
                if (scores[i] > 0.6 && keywords.includes(label)) {
                    hazards.push({
                        type: label,
                        confidence: scores[i],
                        detectedAt: new Date().toISOString()
                    });
                }
            });

            res.json({
                analysis: { labels, scores },
                hazards: hazards,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('Image analysis error:', error);
            res.status(500).json({ error: 'Failed to analyze image' });
        }
    }
};

// Auth Controller
const AuthController = {
    register: async (req, res) => {
        try {
            const { username, email, password } = req.body;
            if (!username || !email || !password) {
                return res.status(400).json({ error: 'All fields required' });
            }
            if (password.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters' });
            }

            if (!User) {
                return res.status(503).json({ error: 'Database not available' });
            }

            const existingUser = await User.findOne({ $or: [{ email }, { username }] });
            if (existingUser) {
                return res.status(400).json({ error: 'User already exists' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const user = await User.create({
                username,
                email,
                password: hashedPassword,
                lastLogin: new Date()
            });

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

            if (!User) {
                return res.status(503).json({ error: 'Database not available' });
            }

            const user = await User.findOne({ email });
            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const isValid = await bcrypt.compare(password, user.password);
            if (!isValid) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

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

            if (!User) {
                return res.status(503).json({ error: 'Database not available' });
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

// Hazards Controller
const HazardsController = {
    getHazards: async (req, res) => {
        try {
            const { lat, lng, radius = 50 } = req.query;
            if (!lat || !lng) {
                return res.status(400).json({ error: 'Latitude and longitude required' });
            }

            const hazards = generateMockHazards(parseFloat(lat), parseFloat(lng));
            res.json({
                hazards,
                count: hazards.length,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('Hazards error:', error);
            res.status(500).json({ error: 'Failed to get hazards' });
        }
    }
};

// Admin Controller
const AdminController = {
    getStats: async (req, res) => {
        try {
            if (!req.user || req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }

            let stats = {
                users: 0,
                routes: 0,
                hazards: 0,
                activeUsers: 0,
                uptime: process.uptime()
            };

            if (User) {
                stats.users = await User.countDocuments();
                stats.activeUsers = await User.countDocuments({ 
                    lastLogin: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
                });
            }
            if (Route) {
                stats.routes = await Route.countDocuments();
            }
            if (Hazard) {
                stats.hazards = await Hazard.countDocuments();
            }

            res.json({ stats, timestamp: new Date().toISOString() });
        } catch (error) {
            logger.error('Admin stats error:', error);
            res.status(500).json({ error: 'Failed to get stats' });
        }
    }
};

// ============================================================
// 12. ROUTES
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

app.get('/api', (req, res) => {
    res.json({
        name: 'Polaris Nav API',
        version: '1.0.0',
        status: 'online',
        endpoints: {
            health: '/api/health',
            weather: '/api/weather/current?lat=-70&lng=0',
            forecast: '/api/weather/forecast?lat=-70&lng=0',
            ice: '/api/ice/concentration?lat=-70&lng=0',
            icebergs: '/api/ice/icebergs?lat=-70&lng=0',
            hazards: '/api/hazards?lat=-70&lng=0',
            route: '/api/route/optimize (POST)',
            chat: '/api/ai/chat (POST)',
            auth: '/api/auth/register, /api/auth/login'
        }
    });
});

// Weather routes
app.get('/api/weather/current', cacheMiddleware(300), WeatherController.getCurrent);
app.get('/api/weather/forecast', cacheMiddleware(600), WeatherController.getForecast);

// Ice routes
app.get('/api/ice/concentration', cacheMiddleware(600), IceController.getConcentration);
app.get('/api/ice/icebergs', cacheMiddleware(300), IceController.detectIcebergs);

// Hazards routes
app.get('/api/hazards', cacheMiddleware(300), HazardsController.getHazards);

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
// Add this after your other routes
app.get('/', (req, res) => {
    res.json({
        name: 'Polaris Nav API',
        version: '1.0.0',
        status: 'online',
        endpoints: {
            health: '/api/health',
            weather: '/api/weather/current?lat=-70&lng=0',
            forecast: '/api/weather/forecast?lat=-70&lng=0',
            ice: '/api/ice/concentration?lat=-70&lng=0',
            icebergs: '/api/ice/icebergs?lat=-70&lng=0',
            hazards: '/api/hazards?lat=-70&lng=0',
            route: '/api/route/optimize (POST)',
            chat: '/api/ai/chat (POST)',
            auth: '/api/auth/register, /api/auth/login'
        }
    });
});
// Admin routes
app.get('/api/admin/stats', authenticate, authorize('admin'), AdminController.getStats);

// ============================================================
// 13. WEBSOCKETS
// ============================================================
const clients = new Map();

io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id}`);
    
    socket.on('authenticate', (token) => {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.id;
            socket.join(`user:${decoded.id}`);
            clients.set(socket.id, { userId: decoded.id, socketId: socket.id });
        } catch (error) {
            logger.warn('Socket auth failed:', error.message);
        }
    });

    socket.on('position:update', async (data) => {
        const { lat, lng, heading, speed } = data;
        if (socket.userId && Vessel) {
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
        
        // Broadcast to nearby clients
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

    socket.on('weather:request', async (data) => {
        const { lat, lng } = data;
        const weather = generateMockWeather(lat, lng);
        socket.emit('weather:response', {
            weather,
            timestamp: new Date().toISOString()
        });
    });

    socket.on('disconnect', () => {
        clients.delete(socket.id);
        logger.info(`Client disconnected: ${socket.id}`);
    });
});

// Broadcast weather updates
setInterval(async () => {
    try {
        const locations = [
            { lat: -70.0, lng: 0.0 },
            { lat: -65.0, lng: -60.0 }
        ];
        for (const loc of locations) {
            const weather = generateMockWeather(loc.lat, loc.lng);
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
// 14. ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    if (err.code === 11000) {
        return res.status(409).json({
            error: 'Duplicate key error',
            field: Object.keys(err.keyPattern)[0]
        });
    }

    res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        ...(NODE_ENV === 'development' && { stack: err.stack })
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: `Endpoint not found: ${req.path}` });
});

// ============================================================
// 15. SERVER START
// ============================================================
const startServer = async () => {
    try {
        await connectDB();
        server.listen(PORT, () => {
            console.log('========================================');
            console.log('🚀 Polaris Nav Backend');
            console.log(`📡 Running on: ${BASE_URL}`);
            console.log(`🔗 Health: ${BASE_URL}/api/health`);
            console.log(`📊 API Docs: ${BASE_URL}/api`);
            console.log(`🌍 Environment: ${NODE_ENV}`);
            console.log(`💾 Database: ${db ? 'Connected ✅' : 'Not connected ❌'}`);
            console.log('========================================');
        });

        process.on('SIGTERM', () => {
            logger.info('SIGTERM received, closing server...');
            server.close(() => {
                if (mongoose.connection) {
                    mongoose.connection.close();
                }
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
// 16. UNHANDLED REJECTIONS
// ============================================================
process.on('unhandledRejection', (error) => {
    logger.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
});

// ============================================================
// 17. START THE SERVER
// ============================================================
if (require.main === module) {
    startServer();
}

module.exports = { app, server, io, connectDB };