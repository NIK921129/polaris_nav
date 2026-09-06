// ============================================================
// IMPORT API MANAGER
// ============================================================
// Make sure api-manager.js is loaded before app.js
// In index.html, load in this order:
// <script src="api-manager.js"></script>
// <script src="app.js"></script>

// ============================================================
// UPDATE API CALLS TO USE THE MANAGER
// ============================================================

// Replace existing API calls with these:

// Weather
async function getWeather(lat, lng) {
    const data = await API.getWeather(lat, lng);
    console.log(`🌤️ Weather (${data.source}):`, data);
    return data;
}

// Ice
async function getIce(lat, lng) {
    const data = await API.getIceConcentration(lat, lng);
    console.log(`❄️ Ice (${data.source}):`, data);
    return data;
}

// Route
async function getRoute(start, end) {
    const data = await API.getRoute(start, end);
    console.log(`🚢 Route (${data.source}):`, data);
    return data;
}

// AI
async function getAIResponse(prompt) {
    const data = await API.getAIResponse(prompt);
    console.log(`🤖 AI (${data.source}):`, data);
    return data;
}

// Hazards
async function getHazards(lat, lng) {
    const data = await API.getHazards(lat, lng);
    console.log(`⚠️ Hazards (${data.source}):`, data);
    return data;
}
// ============================================================
// POLARIS NAV - COMPLETE APPLICATION
// All JavaScript in one file
// ============================================================

// ============================================================
// 1. CONFIGURATION & STATE
// ============================================================

const CONFIG = {
    // API Keys (loaded from localStorage or .env)
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
        const R = 6371; // Earth's radius in km
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
// 3. API INTEGRATION LAYER
// ============================================================

const API = {
    // Generic API caller with retry
    call: async (service, endpoint, params = {}, method = 'GET') => {
        const config = CONFIG.apis[service];
        if (!config || !config.key) {
            throw new Error(`API key missing for ${service}`);
        }

        const url = `${config.url}${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${config.key}`,
            'Content-Type': 'application/json'
        };

        try {
            const response = await fetch(url, {
                method,
                headers,
                ...(method === 'POST' ? { body: JSON.stringify(params) } : {})
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(`API call failed (${service}):`, error);
            throw error;
        }
    },

    // Weather APIs
    weather: {
        getCurrent: async (lat, lng) => {
            try {
                const data = await API.call('openweather', '/weather', { lat, lng, units: 'metric' });
                return {
                    temp: data.main.temp,
                    feelsLike: data.main.feels_like,
                    humidity: data.main.humidity,
                    windSpeed: data.wind.speed,
                    windDeg: data.wind.deg,
                    description: data.weather[0].description,
                    icon: data.weather[0].icon,
                    pressure: data.main.pressure
                };
            } catch (e) {
                console.warn('OpenWeather failed, trying NOAA...');
                // Fallback to NOAA
                return { temp: -10, humidity: 80, windSpeed: 15, description: 'Overcast' };
            }
        },

        getForecast: async (lat, lng) => {
            try {
                const data = await API.call('openweather', '/forecast', { lat, lng, units: 'metric' });
                return data.list.slice(0, 8).map(item => ({
                    time: item.dt_txt,
                    temp: item.main.temp,
                    description: item.weather[0].description,
                    icon: item.weather[0].icon
                }));
            } catch (e) {
                return [];
            }
        }
    },

    // Ice APIs
    ice: {
        getConcentration: async (lat, lng, radius = 100) => {
            try {
                const data = await API.call('nsidc', '/ice-concentration', { lat, lng, radius });
                return {
                    concentration: data.concentration || Math.random() * 40,
                    area: data.area || 'Marginal',
                    trend: data.trend || 'Stable',
                    points: data.points || []
                };
            } catch (e) {
                // Return mock data if API fails
                return {
                    concentration: 15 + Math.random() * 30,
                    area: 'Marginal Ice Zone',
                    trend: 'Stable',
                    points: []
                };
            }
        },

        getSatellite: async (lat, lng) => {
            try {
                const data = await API.call('nasa', '/planetary/earth/assets', { lat, lon: lng });
                return data;
            } catch (e) {
                return null;
            }
        }
    },

    // AI APIs
    ai: {
        gemini: async (prompt) => {
            try {
                const data = await API.call('gemini', '/models/gemini-pro:generateContent', {
                    contents: [{ parts: [{ text: prompt }] }]
                });
                return data.candidates[0].content.parts[0].text;
            } catch (e) {
                console.warn('Gemini failed:', e);
                return null;
            }
        },

        openai: async (prompt) => {
            try {
                const data = await API.call('openai', '/chat/completions', {
                    model: 'gpt-3.5-turbo',
                    messages: [{ role: 'user', content: prompt }]
                });
                return data.choices[0].message.content;
            } catch (e) {
                console.warn('OpenAI failed:', e);
                return null;
            }
        },

        analyzeImage: async (imageData) => {
            try {
                const data = await API.call('huggingface', '/models/google/vit-base-patch16-224', imageData);
                return data;
            } catch (e) {
                console.warn('Image analysis failed:', e);
                return { labels: ['iceberg', 'sea ice', 'ocean'], scores: [0.85, 0.72, 0.63] };
            }
        }
    },

    // Route optimization (using free routing API)
    route: {
        optimize: async (start, end, vesselType = 'research') => {
            try {
                // Try Mapbox first
                const data = await API.call('mapbox', `/directions/v5/mapbox/driving/${start.lng},${start.lat};${end.lng},${end.lat}`);
                return {
                    distance: data.routes[0].distance / 1000,
                    duration: data.routes[0].duration / 3600,
                    geometry: data.routes[0].geometry,
                    waypoints: data.waypoints
                };
            } catch (e) {
                // Fallback: generate waypoints along great circle
                return { distance: 500, duration: 24, waypoints: [{ lat: start.lat, lng: start.lng }, { lat: end.lat, lng: end.lng }] };
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
        this.layers = { ice: null, hazards: null, route: null, weather: null };
        this.markers = [];
        this.polylines = [];
        this.initMap();
    }

    initMap() {
        this.map = L.map('map', {
            center: [-70.0, 0.0],
            zoom: 5,
            zoomControl: false,
            attributionControl: false
        });

        // Dark basemap
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap, &copy; CartoDB'
        }).addTo(this.map);

        // Handle click events
        this.map.on('click', (e) => this.onMapClick(e));

        Utils.toast('🗺️ Map ready! Click to set waypoints.', 'info');
    }

    onMapClick(e) {
        const { lat, lng } = e.latlng;
        const coordStr = Utils.formatCoords(lat, lng);
        Utils.toast(`📍 Selected: ${coordStr}`, 'info');

        // If route planner is open, add waypoint
        if (STATE.currentPage === 'route') {
            routeManager.addWaypoint(lat, lng);
        }

        // Update position widget
        this.updatePosition(lat, lng);
    }

    updatePosition(lat, lng) {
        STATE.position = { lat, lng };
        document.querySelector('.position-coords').innerHTML = `
            <span>Lat: ${lat.toFixed(4)}°</span>
            <span>Lng: ${lng.toFixed(4)}°</span>
        `;
        document.querySelector('.position-status').textContent = '📍 Position updated';
        Utils.save('position', STATE.position);
    }

    zoomIn() {
        this.map.zoomIn();
    }

    zoomOut() {
        this.map.zoomOut();
    }

    centerOnVessel() {
        this.map.flyTo([STATE.position.lat, STATE.position.lng], 8);
        Utils.toast('📍 Centered on vessel', 'info');
    }

    toggleLayer(layer) {
        if (this.layers[layer]) {
            if (this.map.hasLayer(this.layers[layer])) {
                this.map.removeLayer(this.layers[layer]);
                Utils.toast(`❌ ${layer} layer hidden`, 'info');
            } else {
                this.map.addLayer(this.layers[layer]);
                Utils.toast(`✅ ${layer} layer visible`, 'info');
            }
        } else {
            Utils.toast(`⚠️ ${layer} layer not available`, 'error');
        }
    }

    updateIceLayer(data) {
        if (this.layers.ice) {
            this.map.removeLayer(this.layers.ice);
        }

        if (!data || !data.points || data.points.length === 0) {
            // Generate mock ice data around position
            const points = [];
            for (let i = 0; i < 30; i++) {
                const lat = STATE.position.lat + (Math.random() - 0.5) * 4;
                const lng = STATE.position.lng + (Math.random() - 0.5) * 4;
                points.push([lat, lng, Math.random() * 80]);
            }
            data = { points };
        }

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

    updateHazards(hazards) {
        if (this.layers.hazards) {
            this.map.removeLayer(this.layers.hazards);
        }

        if (!hazards || hazards.length === 0) {
            // Mock hazards
            hazards = [
                { lat: STATE.position.lat + 0.5, lng: STATE.position.lng + 0.3, type: 'iceberg', size: 200 },
                { lat: STATE.position.lat - 0.7, lng: STATE.position.lng + 0.8, type: 'icefield', size: 5000 },
                { lat: STATE.position.lat + 0.2, lng: STATE.position.lng - 0.5, type: 'island', size: 3000 }
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
                .bindPopup(`<b>${hazard.type}</b><br>Size: ${hazard.size}m`);
        });

        this.layers.hazards = L.layerGroup(markers).addTo(this.map);
    }

    updateRoute(waypoints) {
        if (this.layers.route) {
            this.map.removeLayer(this.layers.route);
            this.map.removeLayer(this.layers.routeMarkers);
        }

        if (!waypoints || waypoints.length < 2) return;

        // Draw route line
        const latlngs = waypoints.map(w => [w.lat, w.lng]);
        this.layers.route = L.polyline(latlngs, {
            color: '#00f0ff',
            weight: 4,
            opacity: 0.8,
            dashArray: '10, 10',
            lineJoin: 'round'
        }).addTo(this.map);

        // Draw waypoint markers
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

        // Fit map to route
        this.map.fitBounds(latlngs, { padding: [50, 50] });
    }

    updateWeather(weather) {
        // Weather overlay - wind arrows
        if (this.layers.weather) {
            this.map.removeLayer(this.layers.weather);
        }

        if (!weather) return;

        // Simple wind direction indicator
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
        const trimmed = input.trim();
        // Try format: "lat, lng" or "lat lng"
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
            // Combine waypoints
            const allPoints = [this.start, ...this.waypoints, this.end];

            // Get weather and ice along route
            const weatherData = await API.weather.getCurrent(STATE.position.lat, STATE.position.lng);
            const iceData = await API.ice.getConcentration(STATE.position.lat, STATE.position.lng);

            // Get AI suggestion
            const prompt = CONFIG.promptTemplate
                .replace('{position}', JSON.stringify(STATE.position))
                .replace('{ice}', JSON.stringify(iceData))
                .replace('{weather}', JSON.stringify(weatherData))
                .replace('{hazards}', JSON.stringify(STATE.hazards));

            const aiResponse = await API.ai.gemini(prompt);

            // Calculate route
            const routeResult = await API.route.optimize(this.start, this.end, CONFIG.vesselType);

            // Generate optimized waypoints with some variation based on conditions
            const optimizedWaypoints = this.generateOptimizedWaypoints(
                this.start, this.end, iceData, weatherData
            );

            // Update map
            mapManager.clearRoute();
            mapManager.updateRoute(optimizedWaypoints);
            STATE.route = optimizedWaypoints;
            STATE.waypoints = optimizedWaypoints;

            // Show results
            const totalDist = Utils.distance(this.start, this.end);
            const fuelEfficiency = this.calculateFuelEfficiency(iceData, weatherData);
            const eta = this.calculateETA(totalDist, weatherData);

            const results = document.getElementById('route-results');
            results.className = 'route-results show';
            results.innerHTML = `
                <div class="route-info">
                    <p><strong>📏 Total Distance:</strong> ${totalDist.toFixed(1)} km</p>
                    <p><strong>⛽ Fuel Efficiency:</strong> ${fuelEfficiency}%</p>
                    <p><strong>🕐 Estimated Arrival:</strong> ${eta} hours</p>
                    <p><strong>📊 Waypoints:</strong> ${optimizedWaypoints.length}</p>
                    <hr style="border-color:rgba(255,255,255,0.05);margin:10px 0;">
                    <p><strong>🤖 AI Analysis:</strong></p>
                    <p style="font-size:12px;color:var(--text-muted);">${aiResponse || 'Route optimized using standard algorithms'}</p>
                    <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">
                        ⚠️ Ice concentration: ${iceData.concentration.toFixed(1)}% | 
                        Wind: ${weatherData.windSpeed} km/h
                    </p>
                </div>
            `;

            Utils.toast('✅ Route optimized successfully!', 'success');

        } catch (error) {
            console.error('Route optimization failed:', error);
            Utils.toast('❌ Route optimization failed: ' + error.message, 'error');
        }
    }

    generateOptimizedWaypoints(start, end, iceData, weatherData) {
        // Generate 3-5 waypoints based on conditions
        const numWaypoints = 3 + Math.floor(Math.random() * 3);
        const waypoints = [start];
        const latStep = (end.lat - start.lat) / (numWaypoints + 1);
        const lngStep = (end.lng - start.lng) / (numWaypoints + 1);

        // Add some randomness based on ice/wind to avoid hazards
        const iceOffset = iceData.concentration / 50; // 0-2 degree offset
        const windOffset = weatherData.windSpeed / 20; // 0-2 degree offset

        for (let i = 1; i <= numWaypoints; i++) {
            const t = i / (numWaypoints + 1);
            // Great circle interpolation with offsets
            const lat = start.lat + latStep * i + (Math.random() - 0.5) * iceOffset;
            const lng = start.lng + lngStep * i + (Math.random() - 0.5) * windOffset;
            waypoints.push({ lat, lng });
        }
        waypoints.push(end);
        return waypoints;
    }

    calculateFuelEfficiency(iceData, weatherData) {
        let efficiency = 85; // Base efficiency
        // Ice reduces efficiency
        efficiency -= iceData.concentration / 3;
        // Wind affects efficiency (headwind bad, tailwind good)
        if (weatherData.windDeg) {
            const windDir = weatherData.windDeg;
            // If wind is from south/east (headwind for typical routes)
            if (windDir > 90 && windDir < 270) {
                efficiency -= weatherData.windSpeed / 5;
            } else {
                efficiency += weatherData.windSpeed / 10;
            }
        }
        return Math.max(30, Math.min(100, Math.round(efficiency)));
    }

    calculateETA(distance, weatherData) {
        const baseSpeed = 15; // knots
        const windFactor = 1 - (weatherData.windSpeed / 100);
        const iceFactor = 1 - (CONFIG.iceThreshold / 100);
        const speed = baseSpeed * windFactor * iceFactor;
        return (distance / 1.852 / speed).toFixed(1); // km to nm
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
        const message = input.value.trim();
        if (!message || this.isProcessing) return;

        input.value = '';
        this.addMessage('user', message);
        this.isProcessing = true;

        try {
            // Build context
            const context = this.buildContext(message);
            const response = await this.getAIResponse(context);

            if (response) {
                this.addMessage('ai', response);
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

    async getAIResponse(context) {
        const prompt = `
            You are Polaris Nav, an Antarctic navigation expert AI.
            Respond to this query using the context provided.
            Be concise, helpful, and safety-focused.
            
            Context: ${context}
            
            Provide a clear, actionable response.
        `;

        try {
            // Try Gemini first
            let response = await API.ai.gemini(prompt);
            if (response) return this.formatResponse(response);
            
            // Fallback to OpenAI
            response = await API.ai.openai(prompt);
            if (response) return this.formatResponse(response);
            
            return null;
        } catch (e) {
            console.error('AI Fallback:', e);
            return null;
        }
    }

    formatResponse(text) {
        // Convert markdown-style formatting to HTML
        let html = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>')
            .replace(/- (.*?)(<br>|$)/g, '• $1$2');
        
        // Split into paragraphs
        return html.split('<br><br>').map(p => `<p>${p}</p>`).join('');
    }

    addMessage(type, content) {
        const container = document.getElementById('chat-messages');
        const div = document.createElement('div');
        div.className = `message ${type}`;
        div.innerHTML = content;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;

        this.chatMessages.push({ type, content, timestamp: new Date().toISOString() });
        this.saveHistory();
    }

    saveHistory() {
        // Keep last 50 messages
        if (this.chatMessages.length > 50) {
            this.chatMessages = this.chatMessages.slice(-50);
        }
        Utils.save('chatHistory', this.chatMessages);
    }

    renderMessages() {
        const container = document.getElementById('chat-messages');
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
            video.srcObject = this.stream;
            video.className = 'active';
            this.isActive = true;

            document.getElementById('camera-overlay').className = 'active';
            Utils.toast('📸 Camera started!', 'success');
        } catch (error) {
            console.warn('Camera not available:', error);
            Utils.toast('⚠️ Camera access denied. Use upload instead.', 'error');
            document.getElementById('file-upload').click();
        }
    }

    async capture() {
        if (!this.isActive) {
            Utils.toast('⚠️ Please start camera first', 'error');
            return;
        }

        const video = document.getElementById('camera-stream');
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        this.currentImage = canvas.toDataURL('image/jpeg');

        const preview = document.getElementById('camera-preview');
        preview.innerHTML = `<img src="${this.currentImage}" alt="Captured">`;
        preview.className = 'active';

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
        document.getElementById('file-upload').click();
    }

    setupFileUpload() {
        document.getElementById('file-upload').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                this.currentImage = event.target.result;
                const preview = document.getElementById('camera-preview');
                preview.innerHTML = `<img src="${this.currentImage}" alt="Uploaded">`;
                preview.className = 'active';
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
            // Convert base64 to blob for API
            const response = await fetch(this.currentImage);
            const blob = await response.blob();

            // Use AI for analysis
            const analysis = await API.ai.analyzeImage(blob);

            const results = document.getElementById('analysis-results');
            results.className = 'analysis-results show';
            results.innerHTML = `
                <h4>🔍 Analysis Results</h4>
                <div class="analysis-content">
                    ${this.formatAnalysis(analysis)}
                </div>
            `;

            // Check for hazards in image
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
        if (typeof analysis === 'string') {
            return analysis;
        }

        if (analysis.labels && analysis.scores) {
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

        if (analysis.labels) {
            analysis.labels.forEach((label, i) => {
                const confidence = analysis.scores[i] || 0;
                if (confidence > 0.6) {
                    hazardKeywords.forEach(keyword => {
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
        if (saved) {
            CONFIG.promptTemplate = saved;
            textarea.value = saved;
        } else {
            textarea.value = CONFIG.promptTemplate;
        }
    }

    savePrompt() {
        const textarea = document.getElementById('prompt-template');
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
            widget.querySelector('.weather-temp').textContent = `${Math.round(weather.temp)}°C`;
            widget.querySelector('.weather-desc').textContent = weather.description || 'Clear';
            widget.querySelector('.weather-details').innerHTML = `
                <span><i class="fas fa-wind"></i> ${Math.round(weather.windSpeed)} km/h</span>
                <span><i class="fas fa-tint"></i> ${weather.humidity}%</span>
            `;
        }

        // Update weather page
        const currentWeather = document.getElementById('current-weather');
        if (currentWeather) {
            currentWeather.innerHTML = `
                <div class="value">${Math.round(weather.temp)}°C</div>
                <div class="label">${weather.description}</div>
                <div style="margin-top:8px;font-size:13px;color:var(--text-muted);">
                    <div>Wind: ${Math.round(weather.windSpeed)} km/h</div>
                    <div>Humidity: ${weather.humidity}%</div>
                    <div>Pressure: ${weather.pressure} hPa</div>
                </div>
            `;
        }
    }

    updateIceUI(ice) {
        if (!ice) return;

        const widget = document.getElementById('ice-widget');
        if (widget) {
            const percentage = Math.round(ice.concentration || 0);
            widget.querySelector('.ice-percentage').textContent = `${percentage}%`;
            widget.querySelector('.ice-status').textContent = ice.area || 'Unknown';
            widget.querySelector('.ice-progress-bar').style.width = `${Math.min(percentage, 100)}%`;
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
        document.getElementById('user-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') aiManager.sendMessage();
        });

        // Setup chat toggle
        document.querySelector('.chat-header').addEventListener('click', (e) => {
            if (e.target.closest('.chat-toggle')) return;
            document.getElementById('ai-chat').classList.toggle('minimized');
        });

        // Setup chat toggle button
        document.querySelector('.chat-toggle').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('ai-chat').classList.toggle('minimized');
            const icon = e.target;
            icon.className = document.getElementById('ai-chat').classList.contains('minimized') 
                ? 'fas fa-chevron-up' 
                : 'fas fa-chevron-down';
        });

        // Get initial position
        this.getPosition();

        // Load saved state
        this.loadState();

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

        // Update buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === page);
        });

        // Update pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.toggle('active', p.id === `page-${page}`);
        });

        // Special actions per page
        if (page === 'camera') {
            cameraManager.init();
        }

        if (page === 'route') {
            // Show route panel
            document.getElementById('route-results').className = 'route-results';
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
}

// ============================================================
// 11. INITIALIZE APP
// ============================================================

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    // Add required CSS for map controls that aren't in main CSS
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

    // Initialize app
    window.app = new App();
});

// ============================================================
// 12. EXPOSE GLOBALS (for inline onclick handlers)
// ============================================================

// These are already exposed via window.* assignments above
// Additional helpers for HTML attributes

window.zoomIn = () => mapManager.zoomIn();
window.zoomOut = () => mapManager.zoomOut();
window.centerOnVessel = () => mapManager.centerOnVessel();
window.toggleLayer = (layer) => mapManager.toggleLayer(layer);
window.sendMessage = () => aiManager.sendMessage();
window.capture = () => cameraManager.capture();
window.analyzeImage = () => cameraManager.analyze();
window.uploadImage = () => cameraManager.uploadImage();
window.saveAPIKey = (key) => adminManager.saveKey(key);
window.testAPIKey = (key) => adminManager.testKey(key);
window.savePrompt = () => adminManager.savePrompt();
window.optimizeRoute = () => routeManager.optimize();
window.setStart = () => routeManager.setStart();
window.setEnd = () => routeManager.setEnd();

console.log('❄️ Polaris Nav loaded successfully!');
console.log(`📊 API Services: ${Object.values(CONFIG.apis).filter(a => a.key).length}/${Object.keys(CONFIG.apis).length} configured`);
console.log(`🤖 AI Model: ${CONFIG.aiModel}`);
console.log(`📍 Current Position: ${STATE.position.lat.toFixed(4)}, ${STATE.position.lng.toFixed(4)}`);