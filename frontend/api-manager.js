// ============================================================
// POLARIS NAV - API MANAGER WITH DEMO DATA
// Complete fallback system with realistic demo data
// ============================================================

class APIManager {
    constructor() {
        // Check which API keys are available
        this.apiStatus = this.checkAPIKeys();
        this.demoMode = !Object.values(this.apiStatus).some(status => status === true);
        
        // Log status on startup
        console.log('🔑 API Status:', this.apiStatus);
        console.log('📊 Available APIs:', Object.keys(this.apiStatus).filter(k => this.apiStatus[k]));
        console.log('🎭 Demo Mode:', this.demoMode ? 'ACTIVE' : 'OFF');
        
        if (this.demoMode) {
            console.log('💡 Running in DEMO MODE - Using realistic mock data');
        }
    }

    // ============================================================
    // CHECK AVAILABLE API KEYS
    // ============================================================
    checkAPIKeys() {
        const keys = {
            // Weather APIs
            openweather: !!localStorage.getItem('polaris_api_openweather'),
            noaa: !!localStorage.getItem('polaris_api_noaa'),
            copernicus: !!localStorage.getItem('polaris_api_copernicus'),
            
            // Ice APIs
            nsidc: !!localStorage.getItem('polaris_api_nsidc'),
            nasa: !!localStorage.getItem('polaris_api_nasa'),
            
            // Mapping APIs
            mapbox: !!localStorage.getItem('polaris_api_mapbox'),
            
            // AI APIs
            gemini: !!localStorage.getItem('polaris_api_gemini'),
            openai: !!localStorage.getItem('polaris_api_openai'),
        };
        
        return keys;
    }

    // ============================================================
    // RICH DEMO DATA GENERATOR
    // ============================================================
    generateDemoData(type, params = {}) {
        const { lat = -70, lng = 0, radius = 100 } = params;
        
        const demoData = {
            // ============================================================
            // WEATHER DEMO DATA
            // ============================================================
            weather: {
                temperature: -5 + Math.random() * 10,
                feelsLike: -8 + Math.random() * 8,
                humidity: 65 + Math.random() * 25,
                windSpeed: 10 + Math.random() * 30,
                windDirection: Math.round(Math.random() * 360),
                description: this.getRandomWeatherDesc(),
                pressure: 980 + Math.random() * 40,
                icon: this.getRandomWeatherIcon(),
                visibility: 5 + Math.random() * 15,
                clouds: 20 + Math.random() * 60,
                dewPoint: -10 + Math.random() * 10,
                uvIndex: Math.floor(Math.random() * 3),
                sunrise: new Date(Date.now() + 3600000 * (3 + Math.random() * 4)).toISOString(),
                sunset: new Date(Date.now() + 3600000 * (12 + Math.random() * 4)).toISOString(),
                source: 'demo',
                demo: true
            },
            
            // ============================================================
            // FORECAST DEMO DATA
            // ============================================================
            forecast: {
                list: Array.from({ length: 8 }, (_, i) => ({
                    dt: Date.now() + i * 10800000,
                    main: {
                        temp: -8 + Math.random() * 12,
                        feels_like: -10 + Math.random() * 10,
                        humidity: 60 + Math.random() * 30,
                        pressure: 980 + Math.random() * 40
                    },
                    weather: [{
                        description: this.getRandomWeatherDesc(),
                        icon: this.getRandomWeatherIcon()
                    }],
                    wind: {
                        speed: 8 + Math.random() * 25,
                        deg: Math.round(Math.random() * 360)
                    },
                    clouds: { all: 20 + Math.random() * 60 },
                    pop: Math.random() * 0.4
                })),
                source: 'demo',
                demo: true
            },
            
            // ============================================================
            // MARINE DEMO DATA
            // ============================================================
            marine: {
                seaState: ['Calm', 'Slight', 'Moderate', 'Rough', 'Very Rough'][Math.floor(Math.random() * 5)],
                waveHeight: 0.5 + Math.random() * 4,
                wavePeriod: 4 + Math.random() * 8,
                swellHeight: 0.5 + Math.random() * 3,
                swellDirection: Math.round(Math.random() * 360),
                seaTemperature: -2 + Math.random() * 4,
                tideHeight: 1 + Math.random() * 2,
                tideStatus: ['Rising', 'Falling', 'High', 'Low'][Math.floor(Math.random() * 4)],
                currentSpeed: 0.5 + Math.random() * 2,
                currentDirection: Math.round(Math.random() * 360),
                source: 'demo',
                demo: true
            },
            
            // ============================================================
            // ICE DEMO DATA
            // ============================================================
            ice: {
                concentration: 15 + Math.random() * 40,
                area: this.getRandomIceArea(),
                trend: ['Stable', 'Increasing', 'Decreasing'][Math.floor(Math.random() * 3)],
                thickness: 0.5 + Math.random() * 2,
                age: ['First Year', 'Multi-Year', 'Young Ice', 'Fast Ice'][Math.floor(Math.random() * 4)],
                floeSize: 10 + Math.random() * 100,
                iceEdge: Math.random() > 0.5,
                pressure: Math.random() > 0.7,
                ridges: Math.random() > 0.8,
                points: this.generateIcePoints(lat, lng),
                source: 'demo',
                demo: true
            },
            
            // ============================================================
            // ICEBERGS DEMO DATA
            // ============================================================
            icebergs: {
                icebergs: Array.from({ length: 3 + Math.floor(Math.random() * 5) }, (_, i) => ({
                    id: `iceberg_${i}`,
                    lat: lat + (Math.random() - 0.5) * 0.8,
                    lng: lng + (Math.random() - 0.5) * 0.8,
                    size: 50 + Math.random() * 500,
                    height: 10 + Math.random() * 40,
                    type: ['Tabular', 'Dome', 'Pinnacle', 'Blocky', 'Drydock'][Math.floor(Math.random() * 5)],
                    speed: 0.5 + Math.random() * 2,
                    direction: Math.round(Math.random() * 360),
                    confidence: 0.7 + Math.random() * 0.25,
                    detectedAt: new Date().toISOString()
                })),
                source: 'demo',
                demo: true
            },
            
            // ============================================================
            // ROUTE DEMO DATA
            // ============================================================
            route: {
                distance: 200 + Math.random() * 800,
                duration: 12 + Math.random() * 36,
                fuelEfficiency: 60 + Math.random() * 35,
                waypoints: this.generateWaypoints(params.start || { lat: -70, lng: 0 }, params.end || { lat: -65, lng: -60 }),
                geometry: this.generateRouteGeometry(params.start || { lat: -70, lng: 0 }, params.end || { lat: -65, lng: -60 }),
                elevation: Array.from({ length: 10 }, () => Math.random() * 100),
                turns: Math.floor(Math.random() * 5),
                roadConditions: ['Good', 'Fair', 'Poor', 'Icy'][Math.floor(Math.random() * 4)],
                source: 'demo',
                demo: true
            },
            
            // ============================================================
            // AI DEMO RESPONSES
            // ============================================================
            ai: {
                response: this.generateAIResponse(params.message || ''),
                confidence: 0.7 + Math.random() * 0.25,
                sources: ['Satellite Data', 'Weather Models', 'Historical Routes', 'Expert Knowledge'][Math.floor(Math.random() * 4)],
                source: 'demo',
                demo: true
            },
            
            // ============================================================
            // HAZARDS DEMO DATA
            // ============================================================
            hazards: {
                hazards: Array.from({ length: 2 + Math.floor(Math.random() * 4) }, (_, i) => ({
                    id: `hazard_${i}`,
                    lat: lat + (Math.random() - 0.5) * 0.6,
                    lng: lng + (Math.random() - 0.5) * 0.6,
                    type: ['iceberg', 'icefield', 'island', 'mountain', 'ice_shelf', 'unknown'][Math.floor(Math.random() * 6)],
                    size: 50 + Math.random() * 900,
                    height: 10 + Math.random() * 50,
                    confidence: 0.6 + Math.random() * 0.35,
                    severity: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)],
                    status: ['active', 'melting', 'moving', 'stationary'][Math.floor(Math.random() * 4)],
                    detectedAt: new Date().toISOString(),
                    lastSeen: new Date(Date.now() - Math.random() * 86400000).toISOString()
                })),
                source: 'demo',
                demo: true
            },
            
            // ============================================================
            // SATELLITE DEMO DATA
            // ============================================================
            satellite: {
                imageUrl: null, // Will be generated as data URI if needed
                date: new Date().toISOString(),
                cloudCover: 10 + Math.random() * 50,
                resolution: 30 + Math.random() * 20,
                sensor: ['Sentinel-1', 'Sentinel-2', 'Landsat-8', 'MODIS'][Math.floor(Math.random() * 4)],
                bands: ['Visible', 'Infrared', 'Radar'][Math.floor(Math.random() * 3)],
                source: 'demo',
                demo: true
            },
            
            // ============================================================
            // SYSTEM STATUS DEMO
            // ============================================================
            system: {
                status: 'operational',
                uptime: Math.floor(Math.random() * 2592000), // Up to 30 days
                connections: {
                    database: Math.random() > 0.05,
                    cache: Math.random() > 0.1,
                    websocket: Math.random() > 0.05
                },
                resources: {
                    cpu: Math.random() * 60,
                    memory: 30 + Math.random() * 40,
                    storage: 20 + Math.random() * 30
                },
                services: {
                    weather: Math.random() > 0.1,
                    ice: Math.random() > 0.1,
                    routing: Math.random() > 0.05,
                    ai: Math.random() > 0.1
                },
                source: 'demo',
                demo: true
            }
        };
        
        return demoData[type] || { message: 'Demo data generated', source: 'demo', demo: true };
    }

    // ============================================================
    // HELPER FUNCTIONS FOR DEMO DATA
    // ============================================================
    
    getRandomWeatherDesc() {
        const descriptions = [
            'Partly Cloudy', 'Overcast', 'Light Snow', 'Clear Skies', 
            'Foggy', 'Misty', 'Snow Showers', 'Blizzard Conditions',
            'Freezing Drizzle', 'Ice Crystals', 'Drifting Snow', 'Whiteout',
            'Aurora Visible', 'Gale Force Winds', 'Calm Conditions'
        ];
        return descriptions[Math.floor(Math.random() * descriptions.length)];
    }

    getRandomWeatherIcon() {
        const icons = ['01d', '02d', '03d', '04d', '09d', '10d', '11d', '13d', '50d'];
        return icons[Math.floor(Math.random() * icons.length)];
    }

    getRandomIceArea() {
        const areas = [
            'Marginal Ice Zone', 'Pack Ice', 'Fast Ice', 'Open Water',
            'Ice Shelf', 'Glacier Front', 'Polynya', 'Lead',
            'Sea Ice Edge', 'Ice Arch', 'Bergy Bit', 'Growler'
        ];
        return areas[Math.floor(Math.random() * areas.length)];
    }

    generateIcePoints(lat, lng) {
        const points = [];
        for (let i = 0; i < 50; i++) {
            const pLat = lat + (Math.random() - 0.5) * 4;
            const pLng = lng + (Math.random() - 0.5) * 4;
            const dist = Math.sqrt((pLat - lat) ** 2 + (pLng - lng) ** 2);
            const conc = Math.max(0, Math.min(80, 40 - dist * 10 + Math.random() * 20));
            points.push([pLat, pLng, conc]);
        }
        return points;
    }

    generateWaypoints(start, end) {
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
        return waypoints;
    }

    generateRouteGeometry(start, end) {
        const coordinates = [];
        const numPoints = 20;
        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            const lat = start.lat + (end.lat - start.lat) * t + Math.sin(t * 10) * 0.3;
            const lng = start.lng + (end.lng - start.lng) * t + Math.cos(t * 8) * 0.3;
            coordinates.push([lng, lat]);
        }
        return {
            type: 'LineString',
            coordinates: coordinates
        };
    }

    generateAIResponse(message) {
        const responses = [
            `Based on current ice concentration of ${Math.round(15 + Math.random() * 40)}% and wind speeds of ${Math.round(10 + Math.random() * 30)} km/h, I recommend maintaining a heading of ${Math.round(Math.random() * 360)}° at ${Math.round(8 + Math.random() * 8)} knots. Keep watch for potential icebergs in the area.`,
            
            `The forecast shows improving conditions over the next 6-8 hours. Ice concentration is expected to decrease by ${Math.round(5 + Math.random() * 15)}%. Consider adjusting your route to take advantage of the open water leads to the ${['north', 'south', 'east', 'west'][Math.floor(Math.random() * 4)]}.`,
            
            `Multiple hazards detected within ${Math.round(20 + Math.random() * 30)} nautical miles. Two icebergs (${Math.round(100 + Math.random() * 400)}m and ${Math.round(100 + Math.random() * 400)}m) are drifting ${['north', 'south', 'east', 'west'][Math.floor(Math.random() * 4)]} at ${Math.round(1 + Math.random() * 2)} knots. Recommended safe distance: 5 NM.`,
            
            `Weather advisory: ${['Blizzard', 'High Winds', 'Heavy Snow', 'Freezing Spray', 'Aurora Interference'][Math.floor(Math.random() * 5)]} conditions expected in the next ${Math.round(2 + Math.random() * 6)} hours. Fuel efficiency is currently ${Math.round(60 + Math.random() * 35)}%. Consider sheltering near ${['the ice edge', 'a protected cove', 'an ice shelf', 'open water'][Math.floor(Math.random() * 4)]}.`,
            
            `Route optimization complete. The safest and most fuel-efficient path avoids ${['iceberg fields', 'heavy ice concentrations', 'shallow waters', 'storm areas'][Math.floor(Math.random() * 4)]}. Estimated fuel savings: ${Math.round(5 + Math.random() * 15)}%. ETA: ${Math.round(12 + Math.random() * 24)} hours.`
        ];
        
        // If message contains specific keywords, return relevant response
        if (message.toLowerCase().includes('weather')) return responses[3];
        if (message.toLowerCase().includes('ice')) return responses[0];
        if (message.toLowerCase().includes('hazard') || message.toLowerCase().includes('danger')) return responses[2];
        if (message.toLowerCase().includes('route') || message.toLowerCase().includes('path')) return responses[4];
        
        return responses[Math.floor(Math.random() * responses.length)];
    }

    // ============================================================
    // API CALL WITH DEMO FALLBACK
    // ============================================================
    async callAPI(service, endpoint, params = {}, method = 'GET', body = null) {
        const apiKeys = {
            openweather: localStorage.getItem('polaris_api_openweather'),
            noaa: localStorage.getItem('polaris_api_noaa'),
            nsidc: localStorage.getItem('polaris_api_nsidc'),
            nasa: localStorage.getItem('polaris_api_nasa'),
            mapbox: localStorage.getItem('polaris_api_mapbox'),
            gemini: localStorage.getItem('polaris_api_gemini'),
            openai: localStorage.getItem('polaris_api_openai'),
        };

        const key = apiKeys[service];
        const baseURLs = {
            openweather: 'https://api.openweathermap.org/data/2.5',
            noaa: 'https://api.noaa.gov',
            nsidc: 'https://api.nsidc.org',
            nasa: 'https://api.nasa.gov',
            mapbox: 'https://api.mapbox.com',
            gemini: 'https://generativelanguage.googleapis.com/v1beta',
            openai: 'https://api.openai.com/v1',
        };

        // If no API key, return demo data
        if (!key) {
            console.warn(`⚠️ No API key for ${service}, using DEMO data`);
            const mockType = this.getMockType(service, endpoint);
            return this.generateDemoData(mockType, params);
        }

        try {
            const url = this.buildURL(baseURLs[service], endpoint, params, key, method);
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(method === 'POST' ? {} : {})
                },
                ...(body ? { body: JSON.stringify(body) } : {})
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            data.source = 'api';
            data.demo = false;
            return data;
        } catch (error) {
            console.warn(`⚠️ API call failed for ${service}:`, error.message);
            console.log(`🔄 Falling back to DEMO data for ${service}`);
            const mockType = this.getMockType(service, endpoint);
            return this.generateDemoData(mockType, params);
        }
    }

    buildURL(baseURL, endpoint, params, key, method) {
        let url = `${baseURL}${endpoint}`;
        const queryParams = new URLSearchParams();
        
        // Add API key to params
        if (method === 'GET') {
            if (endpoint.includes('weather') || endpoint.includes('forecast')) {
                queryParams.append('appid', key);
                queryParams.append('units', 'metric');
            } else if (endpoint.includes('earth')) {
                queryParams.append('api_key', key);
            } else if (endpoint.includes('directions')) {
                queryParams.append('access_token', key);
            } else {
                queryParams.append('key', key);
            }
        }

        // Add other params
        Object.keys(params).forEach(k => {
            if (params[k] !== undefined && params[k] !== null) {
                queryParams.append(k, params[k]);
            }
        });

        if (queryParams.toString()) {
            url += `?${queryParams.toString()}`;
        }

        return url;
    }

    getMockType(service, endpoint) {
        const mapping = {
            'openweather': 'weather',
            'noaa': 'weather',
            'nsidc': 'ice',
            'nasa': 'ice',
            'mapbox': 'route',
            'gemini': 'ai',
            'openai': 'ai',
        };
        return mapping[service] || 'weather';
    }

    // ============================================================
    // SPECIFIC API METHODS WITH DEMO DATA
    // ============================================================

    // Weather
    async getWeather(lat, lng) {
        const data = await this.callAPI('openweather', '/weather', { lat, lon: lng });
        if (data.demo) {
            return data;
        }
        return {
            temperature: data.main.temp,
            feelsLike: data.main.feels_like,
            humidity: data.main.humidity,
            windSpeed: data.wind.speed * 3.6,
            windDirection: data.wind.deg,
            description: data.weather[0].description,
            pressure: data.main.pressure,
            icon: data.weather[0].icon,
            source: 'api',
            demo: false
        };
    }

    async getForecast(lat, lng) {
        const data = await this.callAPI('openweather', '/forecast', { lat, lon: lng });
        if (data.demo) {
            return data;
        }
        return {
            forecast: data.list.slice(0, 8).map(item => ({
                time: new Date(item.dt * 1000),
                temperature: item.main.temp,
                description: item.weather[0].description,
                icon: item.weather[0].icon
            })),
            source: 'api',
            demo: false
        };
    }

    async getMarineData(lat, lng) {
        const data = await this.callAPI('copernicus', '/marine-data', { lat, lng });
        if (data.demo) {
            return data;
        }
        return {
            seaState: data.sea_state || 'Moderate',
            waveHeight: data.wave_height || 2,
            swellDirection: data.swell_direction || 180,
            seaTemperature: data.sea_temperature || 2,
            source: 'api',
            demo: false
        };
    }

    // Ice
    async getIceConcentration(lat, lng, radius = 100) {
        const data = await this.callAPI('nsidc', '/ice-concentration', { lat, lng, radius });
        if (data.demo) {
            return data;
        }
        return {
            concentration: data.concentration || 0,
            area: data.area || 'Unknown',
            trend: data.trend || 'Stable',
            points: data.points || [],
            source: 'api',
            demo: false
        };
    }

    async getIcebergs(lat, lng, radius = 50) {
        const data = await this.callAPI('nasa', '/icebergs', { lat, lng, radius });
        if (data.demo) {
            return data;
        }
        return {
            icebergs: data.icebergs || [],
            source: 'api',
            demo: false
        };
    }

    // Route
    async getRoute(start, end, vesselType = 'research') {
        const data = await this.callAPI('mapbox', `/directions/v5/mapbox/driving/${start.lng},${start.lat};${end.lng},${end.lat}`, {}, 'GET');
        if (data.demo) {
            return data;
        }
        const route = data.routes?.[0];
        return {
            distance: route?.distance / 1000 || 0,
            duration: route?.duration / 3600 || 0,
            waypoints: route?.geometry?.coordinates.map(c => ({ lat: c[1], lng: c[0] })) || [],
            source: 'api',
            demo: false
        };
    }

    // AI
    async getAIResponse(prompt, context = '') {
        const data = await this.callAPI('gemini', '/models/gemini-pro:generateContent', {}, 'POST', {
            contents: [{ parts: [{ text: `${context}\n\nUser: ${prompt}` }] }]
        });
        if (data.demo) {
            return data;
        }
        return {
            response: data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI',
            source: 'api',
            demo: false
        };
    }

    // Hazards
    async getHazards(lat, lng, radius = 50) {
        const data = await this.callAPI('nasa', '/hazards', { lat, lng, radius });
        if (data.demo) {
            return data;
        }
        return {
            hazards: data.hazards || [],
            source: 'api',
            demo: false
        };
    }

    // System Status
    async getSystemStatus() {
        const data = await this.callAPI('openweather', '/system', {});
        if (data.demo) {
            return data;
        }
        return {
            status: 'operational',
            uptime: process.uptime(),
            source: 'api',
            demo: false
        };
    }

    // ============================================================
    // DEMO MODE INDICATOR
    // ============================================================
    isDemoMode() {
        return this.demoMode;
    }

    getAPIStatus() {
        return this.apiStatus;
    }

    getDemoStatusMessage() {
        if (this.demoMode) {
            return {
                status: 'DEMO MODE',
                message: 'Using realistic demo data. Add API keys for live data.',
                color: '#ffa500',
                icon: '🎭'
            };
        }
        return {
            status: 'LIVE MODE',
            message: 'Using live API data',
            color: '#00ff88',
            icon: '🔴'
        };
    }
}

// ============================================================
// CREATE SINGLETON INSTANCE
// ============================================================
const API = new APIManager();

// Expose for use in other files
window.API = API;

console.log('✅ API Manager loaded successfully!');
console.log(`🎭 Demo Mode: ${API.isDemoMode() ? 'ACTIVE' : 'OFF'}`);
console.log('📊 Available APIs:', Object.keys(API.apiStatus).filter(k => API.apiStatus[k]));