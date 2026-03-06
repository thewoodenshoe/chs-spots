/**
 * Google Places API helpers for discovery scripts.
 * Handles geocoding, photo downloads, and basic HTTP utilities.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

function getPlacesApiKey() {
  return process.env.GOOGLE_PLACES_SERVER_KEY
    || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
    || process.env.GOOGLE_PLACES_KEY;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (e) => { fs.unlinkSync(dest); reject(e); });
  });
}

async function geocodePlace(name, address) {
  const apiKey = getPlacesApiKey();
  const query = encodeURIComponent(`${name} ${address || 'Charleston SC'}`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`;
  const data = await fetchJson(url);
  if (!data.results?.length) return null;
  const place = data.results[0];
  return {
    lat: place.geometry.location.lat,
    lng: place.geometry.location.lng,
    placeId: place.place_id,
  };
}

async function downloadPlacePhoto(placeId, fileLabel, log) {
  const apiKey = getPlacesApiKey();
  const spotsDir = path.join(__dirname, '..', '..', 'public', 'spots');
  if (!fs.existsSync(spotsDir)) fs.mkdirSync(spotsDir, { recursive: true });
  const dest = path.join(spotsDir, `${fileLabel}.jpg`);
  if (fs.existsSync(dest)) return `/spots/${fileLabel}.jpg`;

  const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos&key=${apiKey}`;
  const detail = await fetchJson(detailUrl);
  const photoRef = detail?.result?.photos?.[0]?.photo_reference;
  if (!photoRef) return null;

  const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${apiKey}`;
  await downloadFile(photoUrl, dest);
  if (log) log(`  Downloaded photo → /spots/${fileLabel}.jpg`);
  return `/spots/${fileLabel}.jpg`;
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
  if (!token || !chatId) return;
  try {
    const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  } catch (e) {
    console.error(`Telegram send failed: ${e.message}`);
  }
}

module.exports = {
  getPlacesApiKey,
  fetchJson,
  downloadFile,
  geocodePlace,
  downloadPlacePhoto,
  sendTelegram,
};
