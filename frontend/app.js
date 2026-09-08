// ============================================================
// POLARIS NAV - COMPLETE APPLICATION
// All JavaScript in one file
// ============================================================

// ============================================================
// 1. CONFIGURATION & STATE
// ============================================================

// API Base URL - CHANGE THIS TO YOUR LIVE BACKEND URL
// For production: https://polarisnav.onrender.com/api
// For local development: http://localhost:3000/api
const API_BASE_URL = 'https://polarisnav.onrender.com/api';
// const API_BASE_URL = 'http://localhost:3000/api';

const CONFIG = {
    // API Keys (loaded from localStorage)
    apis: {
        // Weather
        openweather: { url: 'https://api.openweathermap.org/data/2.5', key: null },
        noaa: { url: 'https://api.noaa.gov', key: null },
        copernicus: { url: 'https://api.copernicus.eu', key: null },
        ecmwf: { url: 'https://api.ecmwf.int', key: null },
        windy: { url: 'https://api.windy.com', key: null },
        // Ice
        nsidc: { url: 'https://api.nsidc.org', key: null },
        nasa: { url: 'https://api.nasa.gov', key: null },
        sentinel: { url: 'https://api.sentinel-hub.com', key: null },
        earthEngine: { url: 'https://earthengine.googleapis.com', key: null },
        // Mapping
        mapbox: { url: 'https://api.mapbox.com', key: null },
        googleMaps: { url: 'https://maps.googleapis.com', key: null },
        hereMaps: { url: 'https://route.ls.hereapi.com', key: null },
        // AI
        gemini: { url: 'https://generativelanguage.googleapis.com/v1beta', key: null },
        openai: { url: 'https://api.openai.com/v1', key: null },
        huggingface: { url: 'https://api-inference.huggingface.co', key: null },
        claude: { url: 'https://api.anthropic.com/v1', key: null },
        cohere: { url: 'https://api.cohere.ai/v1', key: null }
    },
    aiModel: 'gemini',
    promptTemplate: `You are an Antarctic navigation expert. Analyze:
Position: {position}
Ice: {ice}
Weather: {weather}
Hazards: {hazards}
Provide route recommendation.`,
    pollingInterval: 300000, // 5 minutes
    vesselType: 'research',
    maxWaypoints: 10,
    iceThreshold: 30,
    windThreshold: 20
};

// Application State
const STATE = {
    position: { lat: -70.0, lng: 0.0 },
    route: [],
    waypoints: [],
    hazards: [],
    iceData: null,
    weather: null,
    currentPage: 'dashboard',
    isAIEnabled: true,
    isCameraActive: false,
    capturedImage: null,
    chatHistory: [],
    isPolling: true
};

// ============================================================
// 2. UTILITY FUNCTIONS
// ============================================================

const Utils = {
    // Toast notifications
    toast: (message, type = 'info') => {
        const container = document.getElementById('toast-container');
        if (!container) {
            console.log(`🔔 ${type}: ${message}`);
            return;
        }
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
        toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${message}`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    },

    // Debounce
    debounce: (fn, delay = 300) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    },

    // Format coordinates
    formatCoords: (lat, lng) => {
        const latDir = lat >= 0 ? 'N' : 'S';
        const lngDir = lng >= 0 ? 'E' : 'W';
        return `${Math.abs(lat).toFixed(4)}°${latDir} ${Math.abs(lng).toFixed(4)}°${lngDir}`;
    },

    // Distance between two points (Haversine)
    distance: (p1, p2) => {
        const R = 6371;
        const dLat = (p2.lat - p1.lat) * Math.PI / 180;
        const dLng = (p2.lng - p1.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(p1.lat * Math.PI/180) * Math.cos(p2.lat * Math.PI/180) * Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    },

    // Save to localStorage
    save: (key, data) => {
        try { localStorage.setItem(`polaris_${key}`, JSON.stringify(data)); } catch (e) {}
    },

    // Load from localStorage
    load: (key) => {
        try {
            const data = localStorage.getItem(`polaris_${key}`);
            return data ? JSON.parse(data) : null;
        } catch (e) { return null; }
    },

    // Generate unique ID
    uid: () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
};

// ============================================================
// 3. API INTEGRATION LAYER - Using Live Backend
// ============================================================

const API = {
    // Generic API caller
    call: async (endpoint, params = {}, method = 'GET', body = null) => {
        const url = new URL(`${API_BASE_URL}${endpoint}`);
        
        // Add query parameters for GET requests
        if (method === 'GET' && params) {
            Object.keys(params).forEach(key => {
                if (params[key] !== undefined && params[key] !== null) {
                    url.searchParams.append(key, params[key]);
                }
            });
        }

        try {
            const options = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                },
                ...(method === 'POST' && body ? { body: JSON.stringify(body) } : {})
            };

            const response = await fetch(url.toString(), options);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            data._source = 'api';
            return data;
        } catch (error) {
            console.warn(`⚠️ API call failed (${endpoint}):`, error.message);
            // Return null so callers can fall back to mock data
            return null;
        }
    },

    // Weather APIs
    weather: {
        getCurrent: async (lat, lng) => {
            try {
                const data = await API.call('/weather/current', { lat, lng });
                if (data && data.current) {
                    return {
                        temp: data.current.temperature || -5,
                        feelsLike: data.current.feelsLike || -8,
                        humidity: data.current.humidity || 70,
                        windSpeed: data.current.windSpeed || 15,
                        windDeg: data.current.windDirection || 180,
                        description: data.current.description || 'Partly Cloudy',
                        pressure: data.current.pressure || 1000,
                        source: data.current.source || 'api'
                    };
                }
                // Fallback to mock data
                return this._getMockWeather(lat, lng);
            } catch (e) {
                console.warn('Weather API failed, using mock data');
                return this._getMockWeather(lat, lng);
            }
        },

        _getMockWeather: (lat, lng) => {
            const conditions = ['Partly Cloudy', 'Overcast', 'Light Snow', 'Clear Skies', 'Foggy'];
            return {
                temp: -5 + Math.random() * 10,
                feelsLike: -8 + Math.random() * 8,
                humidity: 65 + Math.random() * 25,
                windSpeed: 10 + Math.random() * 30,
                windDeg: Math.round(Math.random() * 360),
                description: conditions[Math.floor(Math.random() * conditions.length)],
                pressure: 980 + Math.random() * 40,
                source: 'mock'
            };
        },

        getForecast: async (lat, lng) => {
            try {
                const data = await API.call('/weather/forecast', { lat, lng });
                if (data && data.forecast) {
                    return data.forecast;
                }
                return [];
            } catch (e) {
                console.warn('Forecast API failed');
                return [];
            }
        }
    },

    // Ice APIs
    ice: {
        getConcentration: async (lat, lng, radius = 100) => {
            try {
                const data = await API.call('/ice/concentration', { lat, lng, radius });
                if (data && data.ice) {
                    return data.ice;
                }
                return this._getMockIce(lat, lng);
            } catch (e) {
                console.warn('Ice API failed, using mock data');
                return this._getMockIce(lat, lng);
            }
        },

        _getMockIce: (lat, lng) => {
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
                points: points,
                source: 'mock'
            };
        },

        getSatellite: async (lat, lng) => {
            try {
                const data = await API.call('/ice/satellite', { lat, lng });
                if (data) return data;
                return { imageUrl: null, date: new Date(), source: 'mock' };
            } catch (e) {
                return { imageUrl: null, date: new Date(), source: 'mock' };
            }
        }
    },

    // Hazards API
    hazards: {
        getHazards: async (lat, lng, radius = 50) => {
            try {
                const data = await API.call('/hazards', { lat, lng, radius });
                if (data && data.hazards) {
                    return data.hazards;
                }
                return this._getMockHazards(lat, lng);
            } catch (e) {
                console.warn('Hazards API failed, using mock data');
                return this._getMockHazards(lat, lng);
            }
        },

        _getMockHazards: (lat, lng) => {
            const types = ['iceberg', 'icefield', 'island', 'mountain'];
            const count = 2 + Math.floor(Math.random() * 4);
            const hazards = [];
            for (let i = 0; i < count; i++) {
                hazards.push({
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
        }
    },

    // Route API
    route: {
        optimize: async (start, end, vesselType = 'research') => {
            try {
                const data = await API.call('/route/optimize', {}, 'POST', {
                    start,
                    end,
                    vesselType,
                    name: 'Route ' + new Date().toLocaleDateString()
                });
                if (data && data.route) {
                    return data.route;
                }
                return this._getMockRoute(start, end);
            } catch (e) {
                console.warn('Route API failed, using mock data');
                return this._getMockRoute(start, end);
            }
        },

        _getMockRoute: (start, end) => {
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
        }
    },

    // AI Chat API
    ai: {
        chat: async (message, context = '') => {
            try {
                const data = await API.call('/ai/chat', {}, 'POST', { message, context });
                if (data && data.response) {
                    return data.response;
                }
                return this._getMockResponse(message);
            } catch (e) {
                console.warn('AI API failed, using mock data');
                return this._getMockResponse(message);
            }
        },

        _getMockResponse: (message) => {
            const responses = [
                `Based on current ice conditions and wind speeds, I recommend a heading of ${Math.round(Math.random() * 360)}° at ${Math.round(8 + Math.random() * 8)} knots. Keep watch for potential icebergs in the area.`,
                `The forecast shows improving conditions. Ice concentration is expected to decrease by ${Math.round(5 + Math.random() * 15)}%. Consider adjusting your route.`,
                `Multiple hazards detected within ${Math.round(20 + Math.random() * 30)} nautical miles. Two icebergs are drifting. Maintain safe distance of 5 NM.`,
                `Weather advisory: ${['Blizzard', 'High Winds', 'Heavy Snow', 'Freezing Spray'][Math.floor(Math.random() * 4)]} conditions expected. Fuel efficiency is ${Math.round(60 + Math.random() * 35)}%.`
            ];
            
            if (message.toLowerCase().includes('weather')) return responses[3];
            if (message.toLowerCase().includes('ice')) return responses[0];
            if (message.toLowerCase().includes('hazard')) return responses[2];
            return responses[Math.floor(Math.random() * responses.length)];
        },

        analyzeImage: async (imageData) => {
            try {
                const data = await API.call('/ai/analyze-image', {}, 'POST', { image: imageData });
                if (data) return data;
                return { labels: ['iceberg', 'sea ice', 'ocean'], scores: [0.85, 0.72, 0.63] };
            } catch (e) {
                return { labels: ['iceberg', 'sea ice', 'ocean'], scores: [0.85, 0.72, 0.63] };
            }
        }
    },

    // Auth API
    auth: {
        register: async (username, email, password) => {
            return API.call('/auth/register', {}, 'POST', { username, email, password });
        },

        login: async (email, password) => {
            return API.call('/auth/login', {}, 'POST', { email, password });
        },

        getProfile: async (token) => {
            try {
                const response = await fetch(`${API_BASE_URL}/auth/profile`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) throw new Error('Unauthorized');
                return response.json();
            } catch (e) {
                return null;
            }
        }
    }
};

// ============================================================
// 4. MAP MANAGER
// ============================================================

class MapManager {
    constructor() {
        this.map = null;
        this.layers = { ice: null, hazards: null, route: null, weather: null, routeMarkers: null };
        this.markers = [];
        this.initMap();
    }

    initMap() {
        if (typeof L === 'undefined') {
            console.error('Leaflet not loaded!');
            return;
        }

        this.map = L.map('map', {
            center: [-70.0, 0.0],
            zoom: 5,
            zoomControl: false,
            attributionControl: false
        });

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap, &copy; CartoDB'
        }).addTo(this.map);

        this.map.on('click', (e) => this.onMapClick(e));

        Utils.toast('🗺️ Map ready! Click to set waypoints.', 'info');
    }

    onMapClick(e) {
        const { lat, lng } = e.latlng;
        Utils.toast(`📍 Selected: ${Utils.formatCoords(lat, lng)}`, 'info');

        if (STATE.currentPage === 'route') {
            routeManager.addWaypoint(lat, lng);
        }

        this.updatePosition(lat, lng);
    }

    updatePosition(lat, lng) {
        STATE.position = { lat, lng };
        const posWidget = document.querySelector('.position-coords');
        if (posWidget) {
            posWidget.innerHTML = `
                <span>Lat: ${lat.toFixed(4)}°</span>
                <span>Lng: ${lng.toFixed(4)}°</span>
            `;
        }
        const statusEl = document.querySelector('.position-status');
        if (statusEl) statusEl.textContent = '📍 Position updated';
        Utils.save('position', STATE.position);
    }

    zoomIn() { this.map?.zoomIn(); }
    zoomOut() { this.map?.zoomOut(); }

    centerOnVessel() {
        if (this.map) {
            this.map.flyTo([STATE.position.lat, STATE.position.lng], 8);
            Utils.toast('📍 Centered on vessel', 'info');
        }
    }

    toggleLayer(layer) {
        if (!this.layers[layer]) {
            Utils.toast(`⚠️ ${layer} layer not available`, 'error');
            return;
        }
        if (this.map.hasLayer(this.layers[layer])) {
            this.map.removeLayer(this.layers[layer]);
            Utils.toast(`❌ ${layer} layer hidden`, 'info');
        } else {
            this.map.addLayer(this.layers[layer]);
            Utils.toast(`✅ ${layer} layer visible`, 'info');
        }
    }

    updateIceLayer(data) {
        if (this.layers.ice) {
            this.map.removeLayer(this.layers.ice);
        }

        if (!data || !data.points || data.points.length === 0) {
            const points = [];
            for (let i = 0; i < 30; i++) {
                const lat = STATE.position.lat + (Math.random() - 0.5) * 4;
                const lng = STATE.position.lng + (Math.random() - 0.5) * 4;
                points.push([lat, lng, Math.random() * 80]);
            }
            data = { points };
        }

        if (typeof L !== 'undefined' && L.heatLayer) {
            this.layers.ice = L.heatLayer(data.points, {
                radius: 20,
                blur: 15,
                maxZoom: 10,
                gradient: {
                    0.0: 'rgba(0, 240, 255, 0.4)',
                    0.3: 'rgba(0, 240, 255, 0.6)',
                    0.6: 'rgba(124, 58, 237, 0.7)',
                    0.8: 'rgba(255, 0, 102, 0.8)',
                    1.0: 'rgba(255, 0, 102, 0.9)'
                }
            }).addTo(this.map);
        }
    }

    updateHazards(hazards) {
        if (this.layers.hazards) {
            this.map.removeLayer(this.layers.hazards);
        }

        if (!hazards || hazards.length === 0) {
            hazards = [
                { lat: STATE.position.lat + 0.5, lng: STATE.position.lng + 0.3, type: 'iceberg', size: 200 },
                { lat: STATE.position.lat - 0.7, lng: STATE.position.lng + 0.8, type: 'icefield', size: 5000 }
            ];
        }

        const markers = hazards.map(hazard => {
            const icon = L.divIcon({
                className: 'hazard-icon',
                html: `<div style="width:20px;height:20px;border-radius:50%;background:rgba(255,0,102,0.8);border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:10px;color:white;box-shadow:0 0 20px rgba(255,0,102,0.4);">⚠</div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });

            return L.marker([hazard.lat, hazard.lng], { icon })
                .bindPopup(`<b>${hazard.type}</b><br>Size: ${hazard.size || 'Unknown'}m`);
        });

        this.layers.hazards = L.layerGroup(markers).addTo(this.map);
    }

    updateRoute(waypoints) {
        if (this.layers.route) {
            this.map.removeLayer(this.layers.route);
        }
        if (this.layers.routeMarkers) {
            this.map.removeLayer(this.layers.routeMarkers);
        }

        if (!waypoints || waypoints.length < 2) return;

        const latlngs = waypoints.map(w => [w.lat, w.lng]);
        this.layers.route = L.polyline(latlngs, {
            color: '#00f0ff',
            weight: 4,
            opacity: 0.8,
            dashArray: '10, 10',
            lineJoin: 'round'
        }).addTo(this.map);

        const markers = waypoints.map((w, i) => {
            const icon = L.divIcon({
                className: 'waypoint-icon',
                html: `<div style="width:24px;height:24px;border-radius:50%;background:rgba(0,240,255,0.8);border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:white;">${i+1}</div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });
            return L.marker([w.lat, w.lng], { icon });
        });

        this.layers.routeMarkers = L.layerGroup(markers).addTo(this.map);
        this.map.fitBounds(latlngs, { padding: [50, 50] });
    }

    updateWeather(weather) {
        if (this.layers.weather) {
            this.map.removeLayer(this.layers.weather);
        }
        if (!weather) return;

        const windArrow = L.divIcon({
            className: 'wind-arrow',
            html: `<div style="transform:rotate(${weather.windDeg || 0}deg);font-size:24px;color:rgba(0,240,255,0.6);">↑</div>`,
            iconSize: [24, 24]
        });

        this.layers.weather = L.marker([STATE.position.lat + 0.2, STATE.position.lng + 0.2], {
            icon: windArrow
        }).addTo(this.map);
    }

    addMarker(lat, lng, popup = '') {
        const marker = L.marker([lat, lng]).addTo(this.map);
        if (popup) marker.bindPopup(popup);
        this.markers.push(marker);
        return marker;
    }

    clearMarkers() {
        this.markers.forEach(m => this.map.removeLayer(m));
        this.markers = [];
    }

    clearRoute() {
        if (this.layers.route) {
            this.map.removeLayer(this.layers.route);
            this.layers.route = null;
        }
        if (this.layers.routeMarkers) {
            this.map.removeLayer(this.layers.routeMarkers);
            this.layers.routeMarkers = null;
        }
        STATE.route = [];
        STATE.waypoints = [];
    }
}

// ============================================================
// 5. ROUTE MANAGER
// ============================================================

class RouteManager {
    constructor() {
        this.start = null;
        this.end = null;
        this.waypoints = [];
    }

    setStart() {
        const input = document.getElementById('route-start');
        if (!input) return;
        const coords = this.parseCoords(input.value);
        if (coords) {
            this.start = coords;
            mapManager.addMarker(coords.lat, coords.lng, 'Start');
            Utils.toast('✅ Start set: ' + Utils.formatCoords(coords.lat, coords.lng), 'success');
        } else if (STATE.position) {
            this.start = { ...STATE.position };
            mapManager.addMarker(this.start.lat, this.start.lng, 'Start');
            input.value = `${this.start.lat}, ${this.start.lng}`;
            Utils.toast('✅ Start set to current position', 'success');
        } else {
            Utils.toast('⚠️ Enter coordinates or use current position', 'error');
        }
    }

    setEnd() {
        const input = document.getElementById('route-end');
        if (!input) return;
        const coords = this.parseCoords(input.value);
        if (coords) {
            this.end = coords;
            mapManager.addMarker(coords.lat, coords.lng, 'End');
            Utils.toast('✅ End set: ' + Utils.formatCoords(coords.lat, coords.lng), 'success');
        } else {
            Utils.toast('⚠️ Please enter valid coordinates for end', 'error');
        }
    }

    addWaypoint(lat, lng) {
        this.waypoints.push({ lat, lng });
        mapManager.addMarker(lat, lng, `Waypoint ${this.waypoints.length}`);
        Utils.toast(`📍 Waypoint ${this.waypoints.length} added`, 'info');
    }

    parseCoords(input) {
        if (!input) return null;
        const trimmed = input.trim();
        const parts = trimmed.split(/[, ]+/).filter(p => p.length > 0);
        if (parts.length >= 2) {
            const lat = parseFloat(parts[0]);
            const lng = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                return { lat, lng };
            }
        }
        return null;
    }

    async optimize() {
        if (!this.start || !this.end) {
            Utils.toast('⚠️ Please set both start and end locations', 'error');
            return;
        }

        Utils.toast('🔄 Optimizing route...', 'info');

        try {
            // Get weather and ice data
            const weatherData = await API.weather.getCurrent(STATE.position.lat, STATE.position.lng);
            const iceData = await API.ice.getConcentration(STATE.position.lat, STATE.position.lng);

            // Optimize route via API
            const routeResult = await API.route.optimize(this.start, this.end, CONFIG.vesselType);

            // Generate AI suggestion
            const prompt = CONFIG.promptTemplate
                .replace('{position}', JSON.stringify(STATE.position))
                .replace('{ice}', JSON.stringify(iceData))
                .replace('{weather}', JSON.stringify(weatherData))
                .replace('{hazards}', JSON.stringify(STATE.hazards));
            
            const aiResponse = await API.ai.chat(prompt);

            // Use the waypoints from the route result
            const optimizedWaypoints = routeResult.waypoints || this.generateOptimizedWaypoints(
                this.start, this.end, iceData, weatherData
            );

            // Update map
            mapManager.clearRoute();
            mapManager.updateRoute(optimizedWaypoints);
            STATE.route = optimizedWaypoints;
            STATE.waypoints = optimizedWaypoints;

            // Show results
            const totalDist = Utils.distance(this.start, this.end);
            const fuelEfficiency = routeResult.fuelEfficiency || this.calculateFuelEfficiency(iceData, weatherData);
            const eta = routeResult.duration || this.calculateETA(totalDist, weatherData);

            const results = document.getElementById('route-results');
            if (results) {
                results.className = 'route-results show';
                results.innerHTML = `
                    <div class="route-info">
                        <p><strong>📏 Total Distance:</strong> ${(routeResult.distance || totalDist).toFixed(1)} km</p>
                        <p><strong>⛽ Fuel Efficiency:</strong> ${fuelEfficiency}%</p>
                        <p><strong>🕐 Estimated Arrival:</strong> ${typeof eta === 'number' ? eta.toFixed(1) : eta} hours</p>
                        <p><strong>📊 Waypoints:</strong> ${optimizedWaypoints.length}</p>
                        <hr style="border-color:rgba(255,255,255,0.05);margin:10px 0;">
                        <p><strong>🤖 AI Analysis:</strong></p>
                        <p style="font-size:12px;color:var(--text-muted);">${aiResponse || 'Route optimized using standard algorithms'}</p>
                        <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">
                            ⚠️ Ice concentration: ${(iceData.concentration || 0).toFixed(1)}% | 
                            Wind: ${(weatherData.windSpeed || 0)} km/h
                        </p>
                    </div>
                `;
            }

            Utils.toast('✅ Route optimized successfully!', 'success');

        } catch (error) {
            console.error('Route optimization failed:', error);
            Utils.toast('❌ Route optimization failed: ' + error.message, 'error');
        }
    }

    generateOptimizedWaypoints(start, end, iceData, weatherData) {
        const numWaypoints = 3 + Math.floor(Math.random() * 3);
        const waypoints = [start];
        const latStep = (end.lat - start.lat) / (numWaypoints + 1);
        const lngStep = (end.lng - start.lng) / (numWaypoints + 1);

        const iceOffset = (iceData.concentration || 0) / 50;
        const windOffset = (weatherData.windSpeed || 0) / 20;

        for (let i = 1; i <= numWaypoints; i++) {
            const lat = start.lat + latStep * i + (Math.random() - 0.5) * iceOffset;
            const lng = start.lng + lngStep * i + (Math.random() - 0.5) * windOffset;
            waypoints.push({ lat, lng });
        }
        waypoints.push(end);
        return waypoints;
    }

    calculateFuelEfficiency(iceData, weatherData) {
        let efficiency = 85;
        if (iceData && iceData.concentration) {
            efficiency -= iceData.concentration / 3;
        }
        if (weatherData && weatherData.windSpeed) {
            if (weatherData.windSpeed > 20) {
                efficiency -= (weatherData.windSpeed - 20) * 0.5;
            }
        }
        return Math.max(30, Math.min(100, Math.round(efficiency)));
    }

    calculateETA(distance, weatherData) {
        const baseSpeed = 15;
        const windFactor = 1 - ((weatherData?.windSpeed || 0) / 100);
        const iceFactor = 1 - (CONFIG.iceThreshold / 100);
        const speed = baseSpeed * Math.max(0.3, windFactor) * iceFactor;
        return (distance / 1.852 / speed).toFixed(1);
    }
}

// ============================================================
// 6. AI MANAGER
// ============================================================

class AIManager {
    constructor() {
        this.chatMessages = [];
        this.isProcessing = false;
        this.loadHistory();
        this.displayWelcome();
    }

    loadHistory() {
        const saved = Utils.load('chatHistory');
        if (saved) {
            this.chatMessages = saved;
            this.renderMessages();
        }
    }

    displayWelcome() {
        if (this.chatMessages.length === 0) {
            this.addMessage('ai', `
                <p>🌊 Welcome to <strong>Polaris Nav</strong>!</p>
                <p>I'm your AI navigation assistant for Antarctic waters.</p>
                <p style="font-size:12px;color:var(--text-muted);">Ask me about:</p>
                <ul style="font-size:12px;color:var(--text-muted);margin-left:16px;">
                    <li>Route planning</li>
                    <li>Ice conditions</li>
                    <li>Weather forecasts</li>
                    <li>Hazard warnings</li>
                </ul>
            `);
        }
    }

    async sendMessage() {
        const input = document.getElementById('user-input');
        if (!input) return;
        const message = input.value.trim();
        if (!message || this.isProcessing) return;

        input.value = '';
        this.addMessage('user', message);
        this.isProcessing = true;

        try {
            const context = this.buildContext(message);
            const response = await API.ai.chat(message, context);

            if (response) {
                this.addMessage('ai', this.formatResponse(response));
            } else {
                this.addMessage('ai', `
                    <p>⚠️ I couldn't process that request.</p>
                    <p style="font-size:12px;color:var(--text-muted);">Try asking about:</p>
                    <ul style="font-size:12px;color:var(--text-muted);margin-left:16px;">
                        <li>"What's the weather at my position?"</li>
                        <li>"Are there any icebergs nearby?"</li>
                        <li>"Optimize my route to avoid ice"</li>
                    </ul>
                `);
            }
        } catch (error) {
            console.error('AI Error:', error);
            this.addMessage('ai', '❌ Sorry, I encountered an error. Please try again.');
        }

        this.isProcessing = false;
        this.saveHistory();
    }

    buildContext(message) {
        const ice = STATE.iceData || { concentration: 0, area: 'Unknown' };
        const weather = STATE.weather || { temp: 0, windSpeed: 0, description: 'Unknown' };
        const pos = STATE.position;

        return `
            Current Position: ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}
            Ice Concentration: ${ice.concentration || 0}%
            Weather: ${weather.temp || 0}°C, ${weather.windSpeed || 0} km/h, ${weather.description || 'Unknown'}
            Hazards: ${STATE.hazards.length} detected
            User Query: ${message}
        `;
    }

    formatResponse(text) {
        if (!text) return '<p>No response available.</p>';
        let html = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>')
            .replace(/- (.*?)(<br>|$)/g, '• $1$2');
        return html.split('<br><br>').map(p => `<p>${p}</p>`).join('');
    }

    addMessage(type, content) {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        const div = document.createElement('div');
        div.className = `message ${type}`;
        div.innerHTML = content;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;

        this.chatMessages.push({ type, content, timestamp: new Date().toISOString() });
        this.saveHistory();
    }

    saveHistory() {
        if (this.chatMessages.length > 50) {
            this.chatMessages = this.chatMessages.slice(-50);
        }
        Utils.save('chatHistory', this.chatMessages);
    }

    renderMessages() {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        container.innerHTML = '';
        this.chatMessages.forEach(msg => {
            const div = document.createElement('div');
            div.className = `message ${msg.type}`;
            div.innerHTML = msg.content;
            container.appendChild(div);
        });
        container.scrollTop = container.scrollHeight;
    }
}

// ============================================================
// 7. CAMERA MANAGER
// ============================================================

class CameraManager {
    constructor() {
        this.stream = null;
        this.isActive = false;
        this.facingMode = 'environment';
        this.currentImage = null;
        this.setupFileUpload();
    }

    async init() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: this.facingMode, width: { ideal: 1280 } },
                audio: false
            });

            const video = document.getElementById('camera-stream');
            if (video) {
                video.srcObject = this.stream;
                video.className = 'active';
            }
            this.isActive = true;

            const overlay = document.getElementById('camera-overlay');
            if (overlay) overlay.className = 'active';
            Utils.toast('📸 Camera started!', 'success');
        } catch (error) {
            console.warn('Camera not available:', error);
            Utils.toast('⚠️ Camera access denied. Use upload instead.', 'error');
            const upload = document.getElementById('file-upload');
            if (upload) upload.click();
        }
    }

    async capture() {
        if (!this.isActive) {
            Utils.toast('⚠️ Please start camera first', 'error');
            return;
        }

        const video = document.getElementById('camera-stream');
        if (!video) return;

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        this.currentImage = canvas.toDataURL('image/jpeg');

        const preview = document.getElementById('camera-preview');
        if (preview) {
            preview.innerHTML = `<img src="${this.currentImage}" alt="Captured">`;
            preview.className = 'active';
        }

        Utils.toast('📸 Image captured!', 'success');
    }

    switchCamera() {
        this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
        }
        this.init();
        Utils.toast('🔄 Camera switched', 'info');
    }

    uploadImage() {
        const upload = document.getElementById('file-upload');
        if (upload) upload.click();
    }

    setupFileUpload() {
        const upload = document.getElementById('file-upload');
        if (!upload) return;
        upload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                this.currentImage = event.target.result;
                const preview = document.getElementById('camera-preview');
                if (preview) {
                    preview.innerHTML = `<img src="${this.currentImage}" alt="Uploaded">`;
                    preview.className = 'active';
                }
                Utils.toast('📤 Image uploaded!', 'success');
            };
            reader.readAsDataURL(file);
        });
    }

    async analyze() {
        if (!this.currentImage) {
            Utils.toast('⚠️ Please capture or upload an image first', 'error');
            return;
        }

        Utils.toast('🤖 Analyzing image...', 'info');

        try {
            const analysis = await API.ai.analyzeImage(this.currentImage);

            const results = document.getElementById('analysis-results');
            if (results) {
                results.className = 'analysis-results show';
                results.innerHTML = `
                    <h4>🔍 Analysis Results</h4>
                    <div class="analysis-content">
                        ${this.formatAnalysis(analysis)}
                    </div>
                `;
            }

            const hazards = this.detectHazardsFromImage(analysis);
            if (hazards.length > 0) {
                hazards.forEach(h => {
                    STATE.hazards.push({
                        ...h,
                        detectedAt: new Date().toISOString(),
                        source: 'camera'
                    });
                });
                Utils.toast(`⚠️ ${hazards.length} hazard(s) detected!`, 'error');
            } else {
                Utils.toast('✅ No hazards detected in image', 'success');
            }

        } catch (error) {
            console.error('Analysis failed:', error);
            Utils.toast('❌ Analysis failed: ' + error.message, 'error');
        }
    }

    formatAnalysis(analysis) {
        if (typeof analysis === 'string') return analysis;
        if (analysis && analysis.labels && analysis.scores) {
            return `
                <p><strong>Detected Objects:</strong></p>
                <ul>
                    ${analysis.labels.slice(0, 5).map((label, i) => `
                        <li>${label}: ${(analysis.scores[i] * 100).toFixed(1)}% confidence</li>
                    `).join('')}
                </ul>
            `;
        }
        return `<p>Analysis complete. No significant hazards detected.</p>`;
    }

    detectHazardsFromImage(analysis) {
        const hazards = [];
        const hazardKeywords = ['iceberg', 'ice', 'snow', 'glacier', 'island', 'mountain'];
        if (analysis && analysis.labels) {
            analysis.labels.forEach((label, i) => {
                const confidence = analysis.scores[i] || 0;
                if (confidence > 0.6) {
                    hazardKeywords.forEach(keyword => {
                        if (label.toLowerCase().includes(keyword)) {
                            hazards.push({ type: keyword, confidence: confidence });
                        }
                    });
                }
            });
        }
        return hazards;
    }
}

// ============================================================
// 8. ADMIN MANAGER
// ============================================================

class AdminManager {
    constructor() {
        this.initAPIKeys();
        this.loadSavedKeys();
        this.loadPrompt();
        this.updateStatus();
    }

    initAPIKeys() {
        const container = document.getElementById('api-keys-container');
        if (!container) return;
        container.innerHTML = Object.keys(CONFIG.apis).map(key => `
            <div class="api-key-row">
                <label>${key.toUpperCase()}</label>
                <input type="password" id="key-${key}" placeholder="Enter API key..." />
                <button onclick="adminManager.saveKey('${key}')">Save</button>
                <button onclick="adminManager.testKey('${key}')">Test</button>
            </div>
        `).join('');
    }

    loadSavedKeys() {
        Object.keys(CONFIG.apis).forEach(key => {
            const saved = localStorage.getItem(`polaris_api_${key}`);
            if (saved) {
                CONFIG.apis[key].key = saved;
                const input = document.getElementById(`key-${key}`);
                if (input) input.value = saved;
            }
        });
    }

    saveKey(key) {
        const input = document.getElementById(`key-${key}`);
        if (!input) return;

        const value = input.value.trim();
        if (!value) {
            Utils.toast('⚠️ Please enter an API key', 'error');
            return;
        }

        CONFIG.apis[key].key = value;
        localStorage.setItem(`polaris_api_${key}`, value);
        Utils.toast(`✅ ${key.toUpperCase()} API key saved`, 'success');
        this.updateStatus();
    }

    async testKey(key) {
        const config = CONFIG.apis[key];
        if (!config.key) {
            Utils.toast(`⚠️ No API key set for ${key}`, 'error');
            return;
        }

        Utils.toast(`🔍 Testing ${key.toUpperCase()}...`, 'info');

        try {
            const response = await fetch(`${config.url}/health`, {
                headers: { 'Authorization': `Bearer ${config.key}` }
            });

            if (response.ok || response.status < 500) {
                Utils.toast(`✅ ${key.toUpperCase()} API is reachable`, 'success');
            } else {
                Utils.toast(`⚠️ ${key.toUpperCase()} API returned status ${response.status}`, 'error');
            }
        } catch (e) {
            Utils.toast(`❌ ${key.toUpperCase()} API test failed`, 'error');
        }
    }

    loadPrompt() {
        const saved = Utils.load('promptTemplate');
        const textarea = document.getElementById('prompt-template');
        if (!textarea) return;
        if (saved) {
            CONFIG.promptTemplate = saved;
            textarea.value = saved;
        } else {
            textarea.value = CONFIG.promptTemplate;
        }
    }

    savePrompt() {
        const textarea = document.getElementById('prompt-template');
        if (!textarea) return;
        const value = textarea.value.trim();
        if (!value) {
            Utils.toast('⚠️ Please enter a prompt template', 'error');
            return;
        }

        CONFIG.promptTemplate = value;
        Utils.save('promptTemplate', value);
        Utils.toast('✅ AI prompt template saved', 'success');
    }

    updateStatus() {
        const container = document.getElementById('system-status');
        if (!container) return;
        const total = Object.keys(CONFIG.apis).length;
        const configured = Object.values(CONFIG.apis).filter(a => a.key).length;

        container.innerHTML = `
            <div class="status-grid">
                <div class="status-item">
                    <span class="label">API Services</span>
                    <span class="value">${configured}/${total}</span>
                </div>
                <div class="status-item">
                    <span class="label">AI Model</span>
                    <span class="value">${CONFIG.aiModel.toUpperCase()}</span>
                </div>
                <div class="status-item">
                    <span class="label">Vessel Type</span>
                    <span class="value">${CONFIG.vesselType}</span>
                </div>
                <div class="status-item">
                    <span class="label">Polling</span>
                    <span class="value">${STATE.isPolling ? '🟢 Active' : '⏸️ Paused'}</span>
                </div>
            </div>
        `;
    }
}

// ============================================================
// 9. DATA POLLING
// ============================================================

class DataPoller {
    constructor() {
        this.interval = null;
        this.start();
    }

    start() {
        if (this.interval) clearInterval(this.interval);
        this.poll();
        this.interval = setInterval(() => this.poll(), CONFIG.pollingInterval);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            STATE.isPolling = false;
            Utils.toast('⏸️ Data polling paused', 'info');
        }
    }

    async poll() {
        try {
            const pos = STATE.position;
            if (!pos) return;

            // Get weather
            STATE.weather = await API.weather.getCurrent(pos.lat, pos.lng);
            this.updateWeatherUI(STATE.weather);

            // Get ice data
            STATE.iceData = await API.ice.getConcentration(pos.lat, pos.lng);
            this.updateIceUI(STATE.iceData);

            // Get hazards
            STATE.hazards = await API.hazards.getHazards(pos.lat, pos.lng);

            // Update map layers
            mapManager.updateIceLayer(STATE.iceData);
            mapManager.updateWeather(STATE.weather);
            mapManager.updateHazards(STATE.hazards);

            // Update position
            mapManager.updatePosition(pos.lat, pos.lng);

        } catch (error) {
            console.error('Polling error:', error);
        }
    }

    updateWeatherUI(weather) {
        if (!weather) return;

        const widget = document.getElementById('weather-widget');
        if (widget) {
            const tempEl = widget.querySelector('.weather-temp');
            const descEl = widget.querySelector('.weather-desc');
            const detailsEl = widget.querySelector('.weather-details');
            if (tempEl) tempEl.textContent = `${Math.round(weather.temp)}°C`;
            if (descEl) descEl.textContent = weather.description || 'Clear';
            if (detailsEl) {
                detailsEl.innerHTML = `
                    <span><i class="fas fa-wind"></i> ${Math.round(weather.windSpeed)} km/h</span>
                    <span><i class="fas fa-tint"></i> ${weather.humidity}%</span>
                `;
            }
        }

        const currentWeather = document.getElementById('current-weather');
        if (currentWeather) {
            currentWeather.innerHTML = `
                <div class="value">${Math.round(weather.temp)}°C</div>
                <div class="label">${weather.description}</div>
                <div style="margin-top:8px;font-size:13px;color:var(--text-muted);">
                    <div>Wind: ${Math.round(weather.windSpeed)} km/h</div>
                    <div>Humidity: ${weather.humidity}%</div>
                    <div>Pressure: ${weather.pressure || '--'} hPa</div>
                </div>
            `;
        }
    }

    updateIceUI(ice) {
        if (!ice) return;

        const widget = document.getElementById('ice-widget');
        if (widget) {
            const percentage = Math.round(ice.concentration || 0);
            const percentEl = widget.querySelector('.ice-percentage');
            const statusEl = widget.querySelector('.ice-status');
            const barEl = widget.querySelector('.ice-progress-bar');
            if (percentEl) percentEl.textContent = `${percentage}%`;
            if (statusEl) statusEl.textContent = ice.area || 'Unknown';
            if (barEl) barEl.style.width = `${Math.min(percentage, 100)}%`;
        }
    }
}

// ============================================================
// 10. APP CONTROLLER
// ============================================================

class App {
    constructor() {
        this.init();
    }

    init() {
        // Initialize managers
        window.mapManager = new MapManager();
        window.routeManager = new RouteManager();
        window.aiManager = new AIManager();
        window.cameraManager = new CameraManager();
        window.adminManager = new AdminManager();
        window.dataPoller = new DataPoller();

        // Setup navigation
        this.setupNavigation();

        // Setup chat input
        const chatInput = document.getElementById('user-input');
        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') aiManager.sendMessage();
            });
        }

        // Setup chat toggle
        const chatHeader = document.querySelector('.chat-header');
        if (chatHeader) {
            chatHeader.addEventListener('click', (e) => {
                if (e.target.closest('.chat-toggle')) return;
                const chat = document.getElementById('ai-chat');
                if (chat) chat.classList.toggle('minimized');
            });
        }

        const chatToggle = document.querySelector('.chat-toggle');
        if (chatToggle) {
            chatToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const chat = document.getElementById('ai-chat');
                if (chat) chat.classList.toggle('minimized');
                const icon = e.target;
                if (icon) {
                    icon.className = chat?.classList.contains('minimized') 
                        ? 'fas fa-chevron-up' 
                        : 'fas fa-chevron-down';
                }
            });
        }

        // Get initial position
        this.getPosition();

        // Load saved state
        this.loadState();

        // Show API status
        this.showAPIStatus();

        Utils.toast('❄️ Polaris Nav ready!', 'success');
    }

    setupNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = btn.dataset.page;
                this.navigateTo(page);
            });
        });
    }

    navigateTo(page) {
        STATE.currentPage = page;

        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === page);
        });

        document.querySelectorAll('.page').forEach(p => {
            p.classList.toggle('active', p.id === `page-${page}`);
        });

        if (page === 'camera') {
            cameraManager.init();
        }

        if (page === 'route') {
            const results = document.getElementById('route-results');
            if (results) results.className = 'route-results';
        }

        if (page === 'admin') {
            adminManager.updateStatus();
        }
    }

    getPosition() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    STATE.position = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude
                    };
                    mapManager.updatePosition(STATE.position.lat, STATE.position.lng);
                    mapManager.centerOnVessel();
                    Utils.toast('📍 Position acquired via GPS', 'success');
                },
                () => {
                    Utils.toast('⚠️ Using default position (GPS unavailable)', 'info');
                }
            );
        } else {
            Utils.toast('⚠️ GPS not available', 'error');
        }
    }

    loadState() {
        const savedPos = Utils.load('position');
        if (savedPos) {
            STATE.position = savedPos;
            mapManager.updatePosition(savedPos.lat, savedPos.lng);
        }

        const savedRoute = Utils.load('route');
        if (savedRoute && savedRoute.length > 0) {
            STATE.route = savedRoute;
            mapManager.updateRoute(savedRoute);
        }
    }

    showAPIStatus() {
        const statusDiv = document.getElementById('api-status');
        if (!statusDiv) return;
        
        const services = Object.keys(CONFIG.apis);
        const available = services.filter(key => CONFIG.apis[key].key);
        const missing = services.filter(key => !CONFIG.apis[key].key);
        
        statusDiv.innerHTML = `
            <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;margin-top:8px;">
                <div style="width:100%;font-size:12px;color:var(--text-secondary);margin-bottom:4px;">
                    📊 ${available.length}/${services.length} API keys configured
                    ${available.length === 0 ? ' - Using MOCK DATA' : ''}
                </div>
                ${services.map(key => `
                    <span style="padding:2px 8px;border-radius:4px;background:${CONFIG.apis[key].key ? 'rgba(0,255,136,0.1)' : 'rgba(255,165,0,0.1)'};color:${CONFIG.apis[key].key ? '#00ff88' : '#ffa500'};">
                        ${key} ${CONFIG.apis[key].key ? '✅' : '🎭'}
                    </span>
                `).join('')}
            </div>
        `;
    }
}

// ============================================================
// 11. INITIALIZE APP
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    // Add required CSS
    const style = document.createElement('style');
    style.textContent = `
        .hazard-icon div {
            animation: pulse-hazard 2s infinite;
        }
        @keyframes pulse-hazard {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.2); }
        }
        .waypoint-icon div {
            font-family: monospace;
        }
        .status-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }
        .status-item {
            display: flex;
            flex-direction: column;
            padding: 8px 12px;
            background: rgba(255,255,255,0.02);
            border-radius: 6px;
        }
        .status-item .label {
            font-size: 10px;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        .status-item .value {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-primary);
            margin-top: 2px;
        }
        .analysis-content ul {
            margin: 4px 0 0 16px;
            list-style: none;
        }
        .analysis-content ul li {
            padding: 2px 0;
            font-size: 13px;
        }
    `;
    document.head.appendChild(style);

    window.app = new App();
});

// ============================================================
// 12. EXPOSE GLOBALS
// ============================================================

window.zoomIn = () => mapManager?.zoomIn();
window.zoomOut = () => mapManager?.zoomOut();
window.centerOnVessel = () => mapManager?.centerOnVessel();
window.toggleLayer = (layer) => mapManager?.toggleLayer(layer);
window.sendMessage = () => aiManager?.sendMessage();
window.capture = () => cameraManager?.capture();
window.analyzeImage = () => cameraManager?.analyze();
window.uploadImage = () => cameraManager?.uploadImage();
window.saveAPIKey = (key) => adminManager?.saveKey(key);
window.testAPIKey = (key) => adminManager?.testKey(key);
window.savePrompt = () => adminManager?.savePrompt();
window.optimizeRoute = () => routeManager?.optimize();
window.setStart = () => routeManager?.setStart();
window.setEnd = () => routeManager?.setEnd();

console.log('❄️ Polaris Nav loaded successfully!');
console.log(`📊 API Services: ${Object.values(CONFIG.apis).filter(a => a.key).length}/${Object.keys(CONFIG.apis).length} configured`);
console.log(`🤖 AI Model: ${CONFIG.aiModel}`);
console.log(`📍 Current Position: ${STATE.position.lat.toFixed(4)}, ${STATE.position.lng.toFixed(4)}`);
console.log(`🌐 Backend URL: ${API_BASE_URL}`);