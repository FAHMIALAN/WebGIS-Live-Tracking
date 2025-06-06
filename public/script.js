/* =========================================================
   1) Nama pengguna & kompas
   ========================================================= */
const username     = prompt("Masukkan nama kamu:") || "Pengguna Anonim";
const compassArrow = document.getElementById('compass-arrow');

/* =========================================================
   2) Peta & basemap
   ========================================================= */
const map = L.map('map').setView([-7.8, 110.3], 13);

const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
});
const satellite = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
  subdomains: ['mt0','mt1','mt2','mt3'],
  attribution: '© Google Satellite'
});
const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '© CartoDB Dark'
});
const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenTopoMap'
});

osm.addTo(map); // default

L.control.layers({
  "OpenStreetMap": osm,
  "Satelit":       satellite,
  "Dark Mode":     dark,
  "Terrain":       terrain
}).addTo(map);

/* =========================================================
   3) GEOCODER (pencarian lokasi)
   ========================================================= */
let searchMarker; // marker hasil pencarian

L.Control.geocoder({
  defaultMarkGeocode: false,
  placeholder: 'Cari lokasi ...'
})
  .on('markgeocode', e => {
    const center = e.geocode.center;
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker(center).addTo(map)
      .bindPopup(e.geocode.name).openPopup();
    map.setView(center, 17);
  })
  .addTo(map);

/* =========================================================
   4) POI kategori (Overpass API)
   ========================================================= */
const poiLayer = L.layerGroup().addTo(map);

function fetchPOI(tag) {
  const { lat, lng } = map.getCenter();
  const radius = 1000; // 1 km
  const query = `[out:json][timeout:25];
    (
      node["amenity"="${tag}"](around:${radius},${lat},${lng});
      way["amenity"="${tag}"](around:${radius},${lat},${lng});
      rel["amenity"="${tag}"](around:${radius},${lat},${lng});
    );
    out center;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  fetch(url)
    .then(r => r.json())
    .then(data => {
      poiLayer.clearLayers();
      if (!data.elements.length) {
        alert('Tidak ada data di radius 1 km!');
        return;
      }
      data.elements.forEach(el => {
        const y  = el.lat   || el.center.lat;
        const x  = el.lon   || el.center.lon;
        const nm = el.tags?.name || tag.toUpperCase();
        L.marker([y, x]).addTo(poiLayer)
          .bindPopup(`<strong>${nm}</strong><br>(${tag})`);
      });
    })
    .catch(err => console.error('Overpass error', err));
}

// tombol kategori di #category-bar
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    fetchPOI(btn.dataset.tag);
  });
});

/* =========================================================
   5) Socket & variabel global
   ========================================================= */
const socket       = io();
let   myMarker;
const userMarkers  = {};
const tracePath    = [];
let   traceLine;
let   heading      = 0;

/* =========================================================
   6) Kompas (deviceorientation)
   ========================================================= */
if (window.DeviceOrientationEvent) {
  window.addEventListener('deviceorientationabsolute', updateHeading, true);
  window.addEventListener('deviceorientation',           updateHeading, true);
}
function updateHeading(evt) {
  heading = (evt.alpha !== null ? evt.alpha : 0);
  if (myMarker?.setRotationAngle) myMarker.setRotationAngle(heading);
  if (compassArrow) compassArrow.style.transform = `rotate(${heading}deg)`;
}

/* =========================================================
   7) Fungsi trace jejak
   ========================================================= */
function addToTrace(lat, lng) {
  tracePath.push([lat, lng]);
  if (traceLine) traceLine.setLatLngs(tracePath);
  else           traceLine = L.polyline(tracePath, { color: 'blue' }).addTo(map);
}

/* =========================================================
   8) Live-tracking posisi
   ========================================================= */
navigator.geolocation.watchPosition(
  pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    if (!myMarker) {
      myMarker = L.marker([lat, lng], {
        draggable: true,
        rotationAngle: heading
      }).addTo(map)
        .bindPopup(`📍 ${username}`).openPopup();
      map.setView([lat, lng], 15);

      myMarker.on('dragend', e => {
        const { lat: newLat, lng: newLng } = e.target.getLatLng();
        addToTrace(newLat, newLng);
        socket.emit('locationUpdate', { lat: newLat, lng: newLng, heading, username });
        myMarker.setPopupContent(
          `📍 Posisi baru:<br>Lat ${newLat.toFixed(5)}<br>Lng ${newLng.toFixed(5)}`
        ).openPopup();
      });
    } else {
      myMarker.setLatLng([lat, lng]);
      myMarker.setRotationAngle?.(heading);
    }

    addToTrace(lat, lng);
    socket.emit('locationUpdate', { lat, lng, heading, username });
  },
  err => console.warn('Gagal dapat lokasi:', err.message),
  { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
);

/* =========================================================
   9) Sinkronisasi user lain (socket.io)
   ========================================================= */
socket.on('userMoved', data => {
  const { id, lat, lng, heading: hdg = 0, username: otherName = id } = data;

  if (!userMarkers[id]) {
    userMarkers[id] = L.marker([lat, lng], {
      icon: L.icon({
        iconUrl:  'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png',
        iconSize: [25, 41],
        iconAnchor:[12, 41]
      }),
      rotationAngle: hdg
    }).addTo(map)
      .bindPopup(`👤 ${otherName}`);
  } else {
    userMarkers[id].setLatLng([lat, lng]);
    userMarkers[id].setRotationAngle?.(hdg);
  }
});

socket.on('userDisconnected', id => {
  if (userMarkers[id]) {
    map.removeLayer(userMarkers[id]);
    delete userMarkers[id];
  }
});
