// ============================================================
// POLARIS NAV — FRONTEND APPLICATION (CLEAN)
// Vanilla JS. No frameworks. Backend + mock fallback.
// ============================================================

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------
// Change to your live backend URL for production:
// const API_BASE_URL = 'https://polarisnav.onrender.com/api';
const API_BASE_URL = 'http://localhost:3000/api';

const CONFIG = {
  apis: {
    openweather: { url: 'https://api.openweathermap.org/data/2.5' },
    noaa:        { url: 'https://api.weather.gov' },
    nsidc:       { url: 'https://api.nsidc.org' },
    nasa:        { url: 'https://api.nasa.gov' },
    mapbox:      { url: 'https://api.mapbox.com' },
    gemini:      { url: 'https://generativelanguage.googleapis.com/v1beta' },
    openai:      { url: 'https://api.openai.com/v1' }
  },
  aiModel: 'gemini',
  promptTemplate: `You are an Antarctic navigation expert. Analyze:
Position: {position}
Ice: {ice}
Weather: {weather}
Hazards: {hazards}
Provide a route recommendation.`,
  pollingInterval: 300000,
  vesselType: 'research',
  iceThreshold: 30,
  windThreshold: 20
};

const STATE = {
  position: { lat: -70.0, lng: 0.0 },
  route: [],
  waypoints: [],
  hazards: [],
  iceData: null,
  weather: null,
  currentPage: 'dashboard',
  chatHistory: [],
  isPolling: true
};

// ------------------------------------------------------------
// UTILS
// ------------------------------------------------------------
const Utils = {
  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) { console.log(`[${type}] ${message}`); return; }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(40px)';
      setTimeout(() => el.remove(), 300);
    }, 3200);
  },

  formatCoords(lat, lng) {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lngDir = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}°${latDir} ${Math.abs(lng).toFixed(4)}°${lngDir}`;
  },

  distance(p1, p2) {
    const R = 6371;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  save(key, data) {
    try { localStorage.setItem(`polaris_${key}`, JSON.stringify(data)); } catch {}
  },
  load(key) {
    try {
      const raw = localStorage.getItem(`polaris_${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
};

// ------------------------------------------------------------
// API LAYER (with mock fallback)
// ------------------------------------------------------------
const API = {
  async call(endpoint, params = {}, method = 'GET', body = null) {
    const url = new URL(`${API_BASE_URL}${endpoint}`);
    if (method === 'GET') {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.append(k, v);
      });
    }
    try {
      const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      };
      const res = await fetch(url.toString(), opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      data._source = 'api';
      return data;
    } catch (e) {
      console.warn(`API fail (${endpoint}):`, e.message);
      return null;
    }
  },

  weather: {
    async getCurrent(lat, lng) {
      const d = await API.call('/weather/current', { lat, lng });
      if (d?.current) return { ...d.current, temp: d.current.temperature, source: d.current.source || 'api' };
      return this._mock(lat, lng);
    },
    _mock() {
      const conds = ['Partly Cloudy', 'Overcast', 'Light Snow', 'Clear Skies', 'Foggy'];
      return {
        temp: -5 + Math.random() * 10,
        feelsLike: -8 + Math.random() * 8,
        humidity: 65 + Math.random() * 25,
        windSpeed: 10 + Math.random() * 30,
        windDeg: Math.round(Math.random() * 360),
        description: conds[Math.floor(Math.random() * conds.length)],
        pressure: 980 + Math.random() * 40,
        source: 'mock'
      };
    }
  },

  ice: {
    async getConcentration(lat, lng, radius = 100) {
      const d = await API.call('/ice/concentration', { lat, lng, radius });
      if (d?.ice) return d.ice;
      return this._mock(lat, lng);
    },
    _mock(lat, lng) {
      const points = [];
      for (let i = 0; i < 50; i++) {
        const pLat = lat + (Math.random() - 0.5) * 4;
        const pLng = lng + (Math.random() - 0.5) * 4;
        const dist = Math.hypot(pLat - lat, pLng - lng);
        points.push([pLat, pLng, Math.max(0, Math.min(80, 40 - dist * 10 + Math.random() * 20))]);
      }
      return {
        concentration: 15 + Math.random() * 40,
        area: ['Marginal Ice Zone', 'Pack Ice', 'Fast Ice', 'Open Water'][Math.floor(Math.random() * 4)],
        trend: ['Stable', 'Increasing', 'Decreasing'][Math.floor(Math.random() * 3)],
        points,
        source: 'mock'
      };
    }
  },

  hazards: {
    async getHazards(lat, lng, radius = 50) {
      const d = await API.call('/hazards', { lat, lng, radius });
      if (d?.hazards) return d.hazards;
      return this._mock(lat, lng);
    },
    _mock(lat, lng) {
      const types = ['iceberg', 'icefield', 'island', 'mountain'];
      const sev = ['low', 'medium', 'high', 'critical'];
      return Array.from({ length: 2 + Math.floor(Math.random() * 4) }, () => ({
        lat: lat + (Math.random() - 0.5) * 0.6,
        lng: lng + (Math.random() - 0.5) * 0.6,
        type: types[Math.floor(Math.random() * types.length)],
        size: 50 + Math.random() * 900,
        confidence: 0.6 + Math.random() * 0.35,
        severity: sev[Math.floor(Math.random() * sev.length)],
        source: 'mock'
      }));
    }
  },

  route: {
    async optimize(start, end, vesselType = 'research') {
      const d = await API.call('/route/optimize', {}, 'POST', { start, end, vesselType });
      if (d?.route) return d.route;
      return this._mock(start, end);
    },
    _mock(start, end) {
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
      return {
        distance: 200 + Math.random() * 800,
        duration: 12 + Math.random() * 36,
        fuelEfficiency: 60 + Math.random() * 35,
        waypoints,
        source: 'mock'
      };
    }
  },

  ai: {
    async chat(message, context = '') {
      const d = await API.call('/ai/chat', {}, 'POST', { message, context });
      if (d?.response) return d.response;
      return this._mockResponse(message);
    },
    _mockResponse(message) {
      const r = [
        `Based on current ice conditions and winds, I recommend heading ${Math.round(Math.random() * 360)}° at ${Math.round(8 + Math.random() * 8)} knots. Watch for icebergs.`,
        `Forecast shows improving conditions. Ice concentration expected to drop ${Math.round(5 + Math.random() * 15)}%.`,
        `Multiple hazards within ${Math.round(20 + Math.random() * 30)} NM. Maintain 5 NM safe distance.`,
        `Weather advisory: ${['Blizzard', 'High Winds', 'Heavy Snow', 'Freezing Spray'][Math.floor(Math.random() * 4)]} expected. Fuel efficiency ${Math.round(60 + Math.random() * 35)}%.`
      ];
      const q = message.toLowerCase();
      if (q.includes('weather')) return r[3];
      if (q.includes('ice')) return r[0];
      if (q.includes('hazard') || q.includes('danger')) return r[2];
      if (q.includes('route') || q.includes('path')) return r[1];
      return r[Math.floor(Math.random() * r.length)];
    },
    async analyzeImage(imageData) {
      const d = await API.call('/ai/analyze-image', {}, 'POST', { image: imageData });
      if (d?.analysis) return d;
      const labels = ['iceberg', 'sea ice', 'ocean', 'snow', 'cloud'];
      const scores = labels.map(() => 0.6 + Math.random() * 0.35);
      return { analysis: { labels, scores }, hazards: [] };
    }
  }
};

// ------------------------------------------------------------
// MAP MANAGER
// ------------------------------------------------------------
class MapManager {
  constructor() {
    this.map = null;
    this.layers = { ice: null, hazards: null, route: null, weather: null, routeMarkers: null };
    this.markers = [];
    this.init();
  }

  init() {
    if (typeof L === 'undefined') {
      console.error('Leaflet not loaded');
      return;
    }
    this.map = L.map('map', {
      center: [STATE.position.lat, STATE.position.lng],
      zoom: 5,
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CartoDB',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(this.map);
    this.map.on('click', e => this.onMapClick(e));
    Utils.toast('🗺️ Map ready — click to set waypoints', 'info');
  }

  onMapClick(e) {
    const { lat, lng } = e.latlng;
    if (STATE.currentPage === 'route' && window.routeManager) {
      window.routeManager.addWaypoint(lat, lng);
    }
    this.updatePosition(lat, lng);
  }

  updatePosition(lat, lng) {
    STATE.position = { lat, lng };
    const widget = document.querySelector('.position-coords');
    if (widget) widget.innerHTML = `<span>Lat: ${lat.toFixed(4)}°</span><span>Lng: ${lng.toFixed(4)}°</span>`;
    const status = document.querySelector('.position-status');
    if (status) status.textContent = '📍 Position updated';
    Utils.save('position', STATE.position);
  }

  zoomIn() { this.map?.zoomIn(); }
  zoomOut() { this.map?.zoomOut(); }
  centerOnVessel() {
    this.map?.flyTo([STATE.position.lat, STATE.position.lng], 8);
    Utils.toast('📍 Centered on vessel', 'info');
  }

  toggleLayer(name) {
    if (!this.layers[name]) {
      Utils.toast(`⚠️ ${name} layer not ready`, 'error');
      return;
    }
    if (this.map.hasLayer(this.layers[name])) {
      this.map.removeLayer(this.layers[name]);
      Utils.toast(`❌ ${name} hidden`, 'info');
    } else {
      this.map.addLayer(this.layers[name]);
      Utils.toast(`✅ ${name} visible`, 'info');
    }
  }

  updateIceLayer(data) {
    if (this.layers.ice) this.map.removeLayer(this.layers.ice);
    let points = data?.points;
    if (!points || !points.length) {
      points = [];
      for (let i = 0; i < 30; i++) {
        const lat = STATE.position.lat + (Math.random() - 0.5) * 4;
        const lng = STATE.position.lng + (Math.random() - 0.5) * 4;
        points.push([lat, lng, Math.random() * 80]);
      }
    }
    if (L.heatLayer) {
      this.layers.ice = L.heatLayer(points, {
        radius: 22, blur: 16, maxZoom: 10,
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
    if (this.layers.hazards) this.map.removeLayer(this.layers.hazards);
    if (!hazards?.length) return;
    const markers = hazards.map(h => {
      const icon = L.divIcon({
        className: 'hazard-icon',
        html: `<div style="width:22px;height:22px;border-radius:50%;background:rgba(255,0,102,0.85);border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;box-shadow:0 0 18px rgba(255,0,102,0.5);">⚠</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      return L.marker([h.lat, h.lng], { icon })
        .bindPopup(`<b>${h.type}</b><br>Size: ${h.size || '?'}m<br>Severity: ${h.severity || '?'}`);
    });
    this.layers.hazards = L.layerGroup(markers).addTo(this.map);
  }

  updateRoute(waypoints) {
    if (this.layers.route) this.map.removeLayer(this.layers.route);
    if (this.layers.routeMarkers) this.map.removeLayer(this.layers.routeMarkers);
    if (!waypoints || waypoints.length < 2) return;

    const latlngs = waypoints.map(w => [w.lat, w.lng]);
    this.layers.route = L.polyline(latlngs, {
      color: '#00f0ff', weight: 4, opacity: 0.85, dashArray: '10,10', lineJoin: 'round'
    }).addTo(this.map);

    const markers = waypoints.map((w, i) => {
      const icon = L.divIcon({
        className: 'waypoint-icon',
        html: `<div style="width:24px;height:24px;border-radius:50%;background:rgba(0,240,255,0.85);border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#0a0e17;">${i + 1}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      return L.marker([w.lat, w.lng], { icon });
    });
    this.layers.routeMarkers = L.layerGroup(markers).addTo(this.map);
    this.map.fitBounds(latlngs, { padding: [60, 60] });
  }

  updateWeather(weather) {
    if (this.layers.weather) this.map.removeLayer(this.layers.weather);
    if (!weather) return;
    const icon = L.divIcon({
      className: 'wind-arrow',
      html: `<div style="transform:rotate(${weather.windDeg || 0}deg);font-size:26px;color:rgba(0,240,255,0.7);text-shadow:0 0 8px rgba(0,240,255,0.5);">↑</div>`,
      iconSize: [26, 26]
    });
    this.layers.weather = L.marker(
      [STATE.position.lat + 0.2, STATE.position.lng + 0.2],
      { icon }
    ).addTo(this.map);
  }

  addMarker(lat, lng, popup = '') {
    const m = L.marker([lat, lng]).addTo(this.map);
    if (popup) m.bindPopup(popup);
    this.markers.push(m);
    return m;
  }

  clearMarkers() {
    this.markers.forEach(m => this.map.removeLayer(m));
    this.markers = [];
  }

  clearRoute() {
    if (this.layers.route) { this.map.removeLayer(this.layers.route); this.layers.route = null; }
    if (this.layers.routeMarkers) { this.map.removeLayer(this.layers.routeMarkers); this.layers.routeMarkers = null; }
    STATE.route = [];
    STATE.waypoints = [];
  }
}

// ------------------------------------------------------------
// ROUTE MANAGER
// ------------------------------------------------------------
class RouteManager {
  constructor() {
    this.start = null;
    this.end = null;
    this.waypoints = [];
  }

  setStart() {
    const input = document.getElementById('route-start');
    const coords = this.parseCoords(input?.value);
    if (coords) {
      this.start = coords;
      window.mapManager.addMarker(coords.lat, coords.lng, 'Start');
      Utils.toast(`✅ Start: ${Utils.formatCoords(coords.lat, coords.lng)}`, 'success');
    } else if (STATE.position) {
      this.start = { ...STATE.position };
      window.mapManager.addMarker(this.start.lat, this.start.lng, 'Start');
      if (input) input.value = `${this.start.lat}, ${this.start.lng}`;
      Utils.toast('✅ Start = current position', 'success');
    } else {
      Utils.toast('⚠️ Enter coordinates or use current position', 'error');
    }
  }

  setEnd() {
    const input = document.getElementById('route-end');
    const coords = this.parseCoords(input?.value);
    if (coords) {
      this.end = coords;
      window.mapManager.addMarker(coords.lat, coords.lng, 'End');
      Utils.toast(`✅ End: ${Utils.formatCoords(coords.lat, coords.lng)}`, 'success');
    } else {
      Utils.toast('⚠️ Enter valid end coordinates', 'error');
    }
  }

  addWaypoint(lat, lng) {
    this.waypoints.push({ lat, lng });
    window.mapManager.addMarker(lat, lng, `Waypoint ${this.waypoints.length}`);
    Utils.toast(`📍 Waypoint ${this.waypoints.length} added`, 'info');
  }

  parseCoords(input) {
    if (!input) return null;
    const parts = input.trim().split(/[,\s]+/).filter(Boolean);
    if (parts.length < 2) return null;
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  async optimize() {
    if (!this.start || !this.end) {
      Utils.toast('⚠️ Set both start and end first', 'error');
      return;
    }
    Utils.toast('🔄 Optimizing route…', 'info');

    try {
      const vesselType = document.getElementById('vessel-type')?.value || CONFIG.vesselType;
      const [weatherData, iceData] = await Promise.all([
        API.weather.getCurrent(STATE.position.lat, STATE.position.lng),
        API.ice.getConcentration(STATE.position.lat, STATE.position.lng)
      ]);
      const routeResult = await API.route.optimize(this.start, this.end, vesselType);

      const prompt = CONFIG.promptTemplate
        .replace('{position}', JSON.stringify(STATE.position))
        .replace('{ice}', JSON.stringify(iceData))
        .replace('{weather}', JSON.stringify(weatherData))
        .replace('{hazards}', JSON.stringify(STATE.hazards));

      const aiResponse = await API.ai.chat(prompt);

      const optimized = routeResult.waypoints?.length
        ? routeResult.waypoints
        : this.generateWaypoints(this.start, this.end, iceData, weatherData);

      window.mapManager.clearRoute();
      window.mapManager.updateRoute(optimized);
      STATE.route = optimized;
      STATE.waypoints = optimized;

      const totalDist = Utils.distance(this.start, this.end);
      const fuel = routeResult.fuelEfficiency ?? this.calcFuel(iceData, weatherData);
      const eta = routeResult.duration ?? this.calcETA(totalDist, weatherData);

      const results = document.getElementById('route-results');
      if (results) {
        results.classList.add('show');
        results.innerHTML = `
          <div class="route-info">
            <p><strong>📏 Distance:</strong> ${(routeResult.distance || totalDist).toFixed(1)} km</p>
            <p><strong>⛽ Fuel efficiency:</strong> ${typeof fuel === 'number' ? fuel.toFixed(0) : fuel}%</p>
            <p><strong>🕐 ETA:</strong> ${typeof eta === 'number' ? eta.toFixed(1) : eta} h</p>
            <p><strong>📊 Waypoints:</strong> ${optimized.length}</p>
            <hr>
            <p><strong>🤖 AI:</strong></p>
            <p style="font-size:12px;color:var(--text-muted);">${aiResponse || 'Route optimized.'}</p>
            <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">
              ⚠️ Ice: ${(iceData.concentration || 0).toFixed(1)}% ·
              Wind: ${(weatherData.windSpeed || 0).toFixed(0)} km/h
            </p>
          </div>`;
      }
      Utils.toast('✅ Route optimized', 'success');
    } catch (e) {
      console.error(e);
      Utils.toast('❌ Route optimization failed: ' + e.message, 'error');
    }
  }

  generateWaypoints(start, end, iceData, weatherData) {
    const n = 3 + Math.floor(Math.random() * 3);
    const out = [start];
    const latStep = (end.lat - start.lat) / (n + 1);
    const lngStep = (end.lng - start.lng) / (n + 1);
    const iceOff = (iceData.concentration || 0) / 50;
    const windOff = (weatherData.windSpeed || 0) / 20;
    for (let i = 1; i <= n; i++) {
      out.push({
        lat: start.lat + latStep * i + (Math.random() - 0.5) * iceOff,
        lng: start.lng + lngStep * i + (Math.random() - 0.5) * windOff
      });
    }
    out.push(end);
    return out;
  }

  calcFuel(ice, weather) {
    let e = 85;
    if (ice?.concentration) e -= ice.concentration / 3;
    if (weather?.windSpeed > 20) e -= (weather.windSpeed - 20) * 0.5;
    return Math.max(30, Math.min(100, Math.round(e)));
  }

  calcETA(distance, weather) {
    const base = 15;
    const wind = 1 - ((weather?.windSpeed || 0) / 100);
    const ice = 1 - CONFIG.iceThreshold / 100;
    const speed = base * Math.max(0.3, wind) * ice;
    return parseFloat((distance / 1.852 / speed).toFixed(1));
  }
}

// ------------------------------------------------------------
// AI CHAT MANAGER
// ------------------------------------------------------------
class AIManager {
  constructor() {
    this.messages = [];
    this.processing = false;
    this.load();
    if (!this.messages.length) this.welcome();
  }

  load() {
    const saved = Utils.load('chatHistory');
    if (saved) { this.messages = saved; this.render(); }
  }
  save() {
    if (this.messages.length > 50) this.messages = this.messages.slice(-50);
    Utils.save('chatHistory', this.messages);
  }

  welcome() {
    this.add('ai', `
      <p>🌊 Welcome to <strong>Polaris Nav</strong>!</p>
      <p>I'm your AI navigation assistant for Antarctic waters.</p>
      <p style="font-size:12px;color:var(--text-muted);">Ask me about:</p>
      <ul style="font-size:12px;color:var(--text-muted);">
        <li>Route planning</li>
        <li>Ice conditions</li>
        <li>Weather forecasts</li>
        <li>Hazard warnings</li>
      </ul>
    `);
  }

  async send() {
    const input = document.getElementById('user-input');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg || this.processing) return;
    input.value = '';
    this.add('user', msg);
    this.processing = true;
    const btn = document.getElementById('send-btn');
    if (btn) btn.disabled = true;

    try {
      const ctx = this.buildContext(msg);
      const resp = await API.ai.chat(msg, ctx);
      this.add('ai', this.format(resp || 'I could not process that request. Try asking about ice, weather, or route optimization.'));
    } catch (e) {
      this.add('ai', '❌ Error: ' + e.message);
    } finally {
      this.processing = false;
      if (btn) btn.disabled = false;
      this.save();
    }
  }

  buildContext(query) {
    const ice = STATE.iceData || { concentration: 0, area: 'Unknown' };
    const weather = STATE.weather || { temp: 0, windSpeed: 0, description: 'Unknown' };
    const p = STATE.position;
    return `Position: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}
Ice: ${ice.concentration || 0}%
Weather: ${weather.temp || 0}°C, ${weather.windSpeed || 0} km/h, ${weather.description || 'Unknown'}
Hazards: ${STATE.hazards.length}
User query: ${query}`;
  }

  format(text) {
    if (!text) return '<p>No response.</p>';
    let html = text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
    return html.split('<br><br>').map(p => `<p>${p}</p>`).join('');
  }

  add(type, content) {
    const box = document.getElementById('chat-messages');
    if (box) {
      const el = document.createElement('div');
      el.className = `message ${type}`;
      el.innerHTML = content;
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
    }
    this.messages.push({ type, content, t: new Date().toISOString() });
    this.save();
  }

  render() {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    box.innerHTML = '';
    this.messages.forEach(m => {
      const el = document.createElement('div');
      el.className = `message ${m.type}`;
      el.innerHTML = m.content;
      box.appendChild(el);
    });
    box.scrollTop = box.scrollHeight;
  }
}

// ------------------------------------------------------------
// CAMERA MANAGER
// ------------------------------------------------------------
class CameraManager {
  constructor() {
    this.stream = null;
    this.active = false;
    this.facing = 'environment';
    this.image = null;
    this.bindUpload();
  }

  async init() {
    if (this.active) { Utils.toast('📸 Camera already running', 'info'); return; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facing, width: { ideal: 1280 } },
        audio: false
      });
      const video = document.getElementById('camera-stream');
      const overlay = document.getElementById('camera-overlay');
      if (video) { video.srcObject = this.stream; video.classList.add('active'); }
      if (overlay) overlay.hidden = false;
      this.active = true;
      Utils.toast('📸 Camera started', 'success');
    } catch (e) {
      console.warn('Camera error:', e);
      Utils.toast('⚠️ Camera unavailable — use upload instead', 'error');
      document.getElementById('file-upload')?.click();
    }
  }

  async switch() {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.active = false;
    await this.init();
    Utils.toast('🔄 Camera switched', 'info');
  }

  capture() {
    if (!this.active) { Utils.toast('⚠️ Start camera first', 'error'); return; }
    const video = document.getElementById('camera-stream');
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);
    this.image = canvas.toDataURL('image/jpeg', 0.85);
    this.showPreview(this.image);
    Utils.toast('📸 Image captured', 'success');
  }

  showPreview(src) {
    const preview = document.getElementById('camera-preview');
    if (preview) preview.innerHTML = `<img src="${src}" alt="Captured">`;
  }

  bindUpload() {
    const upload = document.getElementById('file-upload');
    if (!upload) return;
    upload.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        this.image = ev.target.result;
        this.showPreview(this.image);
        Utils.toast('📤 Image uploaded', 'success');
      };
      reader.readAsDataURL(file);
    });
  }

  upload() { document.getElementById('file-upload')?.click(); }

  async analyze() {
    if (!this.image) { Utils.toast('⚠️ Capture or upload an image first', 'error'); return; }
    Utils.toast('🤖 Analyzing image…', 'info');
    try {
      const res = await API.ai.analyzeImage(this.image);
      const box = document.getElementById('analysis-results');
      if (box) {
        box.classList.add('show');
        box.innerHTML = `<h4>🔍 Analysis</h4><div class="analysis-content">${this.render(res)}</div>`;
      }
      const hazards = this.extractHazards(res);
      if (hazards.length) {
        hazards.forEach(h => STATE.hazards.push({ ...h, detectedAt: new Date().toISOString(), source: 'camera' }));
        Utils.toast(`⚠️ ${hazards.length} hazard(s) detected`, 'error');
      } else {
        Utils.toast('✅ No hazards detected', 'success');
      }
    } catch (e) {
      Utils.toast('❌ Analysis failed: ' + e.message, 'error');
    }
  }

  render(res) {
    if (typeof res === 'string') return res;
    if (res?.analysis?.labels) {
      return `<p><strong>Detected:</strong></p><ul>${res.analysis.labels
        .slice(0, 6)
        .map((l, i) => `<li>${l} — ${(res.analysis.scores[i] * 100).toFixed(1)}%</li>`)
        .join('')}</ul>`;
    }
    return '<p>Analysis complete.</p>';
  }

  extractHazards(res) {
    const out = [];
    const keys = ['iceberg', 'ice', 'snow', 'glacier', 'island', 'mountain'];
    res?.analysis?.labels?.forEach((label, i) => {
      const conf = res.analysis.scores[i] || 0;
      if (conf > 0.6 && keys.some(k => label.toLowerCase().includes(k))) {
        out.push({ type: label, confidence: conf });
      }
    });
    return out;
  }
}

// ------------------------------------------------------------
// ADMIN MANAGER
// ------------------------------------------------------------
class AdminManager {
  constructor() {
    this.initKeyInputs();
    this.loadKeys();
    this.loadPrompt();
    this.updateStatus();
  }

  initKeyInputs() {
    const box = document.getElementById('api-keys-container');
    if (!box) return;
    box.innerHTML = Object.keys(CONFIG.apis).map(k => `
      <div class="api-key-row">
        <label for="key-${k}">${k.toUpperCase()}</label>
        <input type="password" id="key-${k}" placeholder="Enter API key…" />
        <button data-action="save-key" data-key="${k}">Save</button>
        <button data-action="test-key" data-key="${k}">Test</button>
      </div>
    `).join('');
  }

  loadKeys() {
    Object.keys(CONFIG.apis).forEach(k => {
      const v = localStorage.getItem(`polaris_api_${k}`);
      if (v) {
        CONFIG.apis[k].key = v;
        const input = document.getElementById(`key-${k}`);
        if (input) input.value = v;
      }
    });
  }

  saveKey(key) {
    const input = document.getElementById(`key-${key}`);
    if (!input) return;
    const val = input.value.trim();
    if (!val) { Utils.toast('⚠️ Enter a key first', 'error'); return; }
    CONFIG.apis[key].key = val;
    localStorage.setItem(`polaris_api_${key}`, val);
    Utils.toast(`✅ ${key} saved`, 'success');
    this.updateStatus();
    this.updateBanner();
  }

  async testKey(key) {
    const cfg = CONFIG.apis[key];
    if (!cfg.key) { Utils.toast(`⚠️ No key for ${key}`, 'error'); return; }
    Utils.toast(`🔍 Testing ${key}…`, 'info');
    try {
      const res = await fetch(`${cfg.url}/health`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${cfg.key}` }
      });
      if (res.status < 500) Utils.toast(`✅ ${key} reachable`, 'success');
      else Utils.toast(`⚠️ ${key} status ${res.status}`, 'error');
    } catch {
      Utils.toast(`❌ ${key} test failed`, 'error');
    }
  }

  loadPrompt() {
    const ta = document.getElementById('prompt-template');
    if (!ta) return;
    const saved = Utils.load('promptTemplate');
    ta.value = saved || CONFIG.promptTemplate;
    if (saved) CONFIG.promptTemplate = saved;
  }

  savePrompt() {
    const ta = document.getElementById('prompt-template');
    if (!ta) return;
    const val = ta.value.trim();
    if (!val) { Utils.toast('⚠️ Prompt is empty', 'error'); return; }
    CONFIG.promptTemplate = val;
    Utils.save('promptTemplate', val);
    Utils.toast('✅ Prompt saved', 'success');
  }

  updateStatus() {
    const box = document.getElementById('system-status');
    if (!box) return;
    const total = Object.keys(CONFIG.apis).length;
    const ready = Object.values(CONFIG.apis).filter(a => a.key).length;
    box.innerHTML = `
      <div class="api-status-grid">
        <div class="api-status-item"><span class="status-dot ${ready ? 'online' : 'offline'}"></span><span class="service-name">API Keys</span><span class="service-status">${ready}/${total}</span></div>
        <div class="api-status-item"><span class="status-dot online"></span><span class="service-name">AI Model</span><span class="service-status">${CONFIG.aiModel.toUpperCase()}</span></div>
        <div class="api-status-item"><span class="status-dot online"></span><span class="service-name">Vessel</span><span class="service-status">${CONFIG.vesselType}</span></div>
        <div class="api-status-item"><span class="status-dot ${STATE.isPolling ? 'online' : 'offline'}"></span><span class="service-name">Polling</span><span class="service-status">${STATE.isPolling ? 'Active' : 'Paused'}</span></div>
      </div>`;
  }

  updateBanner() {
    const banner = document.getElementById('api-status-banner');
    const text = document.getElementById('demo-banner-text');
    if (!banner || !text) return;
    const total = Object.keys(CONFIG.apis).length;
    const ready = Object.values(CONFIG.apis).filter(a => a.key).length;
    if (ready === 0) {
      banner.hidden = false;
      text.textContent = '🎭 Demo Mode — using realistic mock data';
    } else {
      banner.hidden = true;
    }
  }

  renderAPIGrid() {
    const box = document.getElementById('api-status');
    if (!box) return;
    box.innerHTML = Object.entries(CONFIG.apis).map(([k, v]) => `
      <div class="api-status-item">
        <span class="status-dot ${v.key ? 'online' : 'offline'}"></span>
        <span class="service-name">${k}</span>
        <span class="service-status">${v.key ? 'LIVE' : 'DEMO'}</span>
      </div>`).join('');
  }
}

// ------------------------------------------------------------
// DATA POLLER
// ------------------------------------------------------------
class DataPoller {
  constructor() { this.start(); }

  start() {
    this.poll();
    this.interval = setInterval(() => this.poll(), CONFIG.pollingInterval);
  }

  async poll() {
    const p = STATE.position;
    if (!p) return;
    try {
      const [weather, ice, hazards] = await Promise.all([
        API.weather.getCurrent(p.lat, p.lng),
        API.ice.getConcentration(p.lat, p.lng),
        API.hazards.getHazards(p.lat, p.lng)
      ]);
      STATE.weather = weather;
      STATE.iceData = ice;
      STATE.hazards = hazards;

      this.updateWeatherUI(weather);
      this.updateIceUI(ice);
      this.updateHazardsUI(hazards);

      window.mapManager?.updateIceLayer(ice);
      window.mapManager?.updateWeather(weather);
      window.mapManager?.updateHazards(hazards);
      window.mapManager?.updatePosition(p.lat, p.lng);
    } catch (e) {
      console.error('Poll error:', e);
    }
  }

  updateWeatherUI(w) {
    if (!w) return;
    const widget = document.getElementById('weather-widget');
    if (widget) {
      const t = widget.querySelector('.weather-temp');
      const d = widget.querySelector('.weather-desc');
      const det = widget.querySelector('.weather-details');
      if (t) t.textContent = `${Math.round(w.temp)}°C`;
      if (d) d.textContent = w.description || 'Clear';
      if (det) det.innerHTML = `
        <span><i class="fas fa-wind"></i> ${Math.round(w.windSpeed)} km/h</span>
        <span><i class="fas fa-tint"></i> ${Math.round(w.humidity)}%</span>`;
    }
    const card = document.getElementById('current-weather');
    if (card) {
      card.innerHTML = `
        <div class="value">${Math.round(w.temp)}°C</div>
        <div class="label">${w.description}</div>
        <div style="margin-top:8px;font-size:12px;color:var(--text-muted);line-height:1.7;">
          <div>Wind: ${Math.round(w.windSpeed)} km/h</div>
          <div>Humidity: ${Math.round(w.humidity)}%</div>
          <div>Pressure: ${Math.round(w.pressure || 0)} hPa</div>
        </div>`;
    }
  }

  updateIceUI(ice) {
    if (!ice) return;
    const pct = Math.round(ice.concentration || 0);
    const widget = document.getElementById('ice-widget');
    if (widget) {
      const num = widget.querySelector('.ice-percentage');
      const stat = widget.querySelector('.ice-status');
      const bar = widget.querySelector('.ice-progress-bar');
      if (num) num.textContent = `${pct}%`;
      if (stat) stat.textContent = ice.area || 'Unknown';
      if (bar) bar.style.width = `${Math.min(pct, 100)}%`;
    }
  }

  updateHazardsUI(hazards) {
    const widget = document.getElementById('hazards-widget');
    if (!widget) return;
    const count = hazards?.length || 0;
    const c = widget.querySelector('.hazards-count');
    const list = widget.querySelector('.hazards-list');
    if (c) c.textContent = `${count} detected`;
    if (list) {
      list.innerHTML = (hazards || []).slice(0, 3).map(h =>
        `<div style="padding:2px 0;">• ${h.type} (${h.severity || 'unknown'})</div>`
      ).join('');
    }
  }
}

// ------------------------------------------------------------
// APP CONTROLLER
// ------------------------------------------------------------
class App {
  constructor() {
    window.mapManager = new MapManager();
    window.routeManager = new RouteManager();
    window.aiManager = new AIManager();
    window.cameraManager = new CameraManager();
    window.adminManager = new AdminManager();
    window.dataPoller = new DataPoller();

    this.bindNav();
    this.bindChat();
    this.bindMapControls();
    this.bindActionButtons();
    this.bindBannerLink();

    this.getPosition();
    this.loadState();
    window.adminManager.renderAPIGrid();
    window.adminManager.updateBanner();

    Utils.toast('❄️ Polaris Nav ready', 'success');
  }

  bindNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.page));
    });
  }

  navigate(page) {
    STATE.currentPage = page;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
    if (page === 'camera') window.cameraManager.init();
    if (page === 'admin') {
      window.adminManager.updateStatus();
      window.adminManager.renderAPIGrid();
    }
  }

  bindChat() {
    const input = document.getElementById('user-input');
    if (input) input.addEventListener('keypress', e => { if (e.key === 'Enter') window.aiManager.send(); });

    const header = document.getElementById('chat-header');
    const toggle = document.getElementById('chat-toggle');
    const doToggle = e => {
      if (e && e.target.closest('#chat-toggle') !== toggle && e.target !== header && !header.contains(e.target)) return;
      const chat = document.getElementById('ai-chat');
      chat.classList.toggle('minimized');
      const icon = toggle?.querySelector('i');
      if (icon) icon.className = chat.classList.contains('minimized') ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
    };
    header?.addEventListener('click', doToggle);
    toggle?.addEventListener('click', e => { e.stopPropagation(); doToggle(e); });
  }

  bindMapControls() {
    document.getElementById('map-controls')?.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      const m = window.mapManager;
      if (!m) return;
      if (action === 'zoom-in') m.zoomIn();
      if (action === 'zoom-out') m.zoomOut();
      if (action === 'center-vessel') m.centerOnVessel();
      if (action === 'toggle-ice') m.toggleLayer('ice');
      if (action === 'toggle-hazards') m.toggleLayer('hazards');
      if (action === 'toggle-weather') m.toggleLayer('weather');
    });
  }

  bindActionButtons() {
    document.body.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const key = btn.dataset.key;
      switch (action) {
        case 'set-start': window.routeManager.setStart(); break;
        case 'set-end': window.routeManager.setEnd(); break;
        case 'optimize-route': window.routeManager.optimize(); break;
        case 'send-message': window.aiManager.send(); break;
        case 'init-camera': window.cameraManager.init(); break;
        case 'switch-camera': window.cameraManager.switch(); break;
        case 'capture': window.cameraManager.capture(); break;
        case 'upload-image': window.cameraManager.upload(); break;
        case 'analyze-image': window.cameraManager.analyze(); break;
        case 'save-prompt': window.adminManager.savePrompt(); break;
        case 'save-key': window.adminManager.saveKey(key); break;
        case 'test-key': window.adminManager.testKey(key); break;
      }
    });
  }

  bindBannerLink() {
    document.getElementById('banner-admin-link')?.addEventListener('click', e => {
      e.preventDefault();
      this.navigate('admin');
    });
  }

  getPosition() {
    if (!navigator.geolocation) {
      Utils.toast('⚠️ GPS unavailable — using default position', 'info');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        STATE.position = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        window.mapManager.updatePosition(STATE.position.lat, STATE.position.lng);
        window.mapManager.centerOnVessel();
        Utils.toast('📍 Position via GPS', 'success');
      },
      () => Utils.toast('⚠️ GPS denied — using default', 'info'),
      { timeout: 8000 }
    );
  }

  loadState() {
    const savedPos = Utils.load('position');
    if (savedPos) {
      STATE.position = savedPos;
      window.mapManager.updatePosition(savedPos.lat, savedPos.lng);
    }
    const savedRoute = Utils.load('route');
    if (savedRoute?.length) {
      STATE.route = savedRoute;
      window.mapManager.updateRoute(savedRoute);
    }
  }
}

// ------------------------------------------------------------
// BOOT
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  console.log('❄️ Polaris Nav frontend loaded');
  console.log(`🌐 Backend: ${API_BASE_URL}`);
});