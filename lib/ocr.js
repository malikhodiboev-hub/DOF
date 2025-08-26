
import Tesseract from 'tesseract.js';

export async function ocrPlateFromUrl(url) {
  const provider = (process.env.OCR_PROVIDER || 'tesseract').toLowerCase();
  if (provider === 'plate_recognizer') return plateRecognizer(url);
  if (provider === 'openalpr') return openAlpr(url);
  if (provider === 'external') return externalOcr(url);
  return tesseract(url);
}

async function tesseract(url) {
  const { data } = await Tesseract.recognize(url, 'eng');
  const raw = (data.text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalizePlate(raw);
}

async function plateRecognizer(url) {
  const token = process.env.PLATE_RECOGNIZER_TOKEN;
  if (!token) throw new Error('PLATE_RECOGNIZER_TOKEN missing');
  const r = await fetch('https://api.platerecognizer.com/v1/plate-reader/', {
    method: 'POST', headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ regions: [], upload_url: url })
  });
  const j = await r.json();
  const cand = j?.results?.[0]?.plate || '';
  return normalizePlate(String(cand).toUpperCase());
}

async function openAlpr(url) {
  const key = process.env.OPENALPR_SECRET_KEY; const country = process.env.OPENALPR_COUNTRY || 'eu';
  if (!key) throw new Error('OPENALPR_SECRET_KEY missing');
  const u = new URL('https://api.openalpr.com/v3/recognize_url');
  u.searchParams.set('secret_key', key);
  u.searchParams.set('country', country);
  u.searchParams.set('recognize_vehicle', '0');
  u.searchParams.set('return_plate', '1');
  u.searchParams.set('image_url', url);
  const r = await fetch(u.toString());
  const j = await r.json();
  const cand = j?.results?.[0]?.plate || '';
  return normalizePlate(String(cand).toUpperCase());
}

async function externalOcr(url) {
  const endpoint = process.env.OCR_EXTERNAL_URL;
  const key = process.env.OCR_EXTERNAL_API_KEY;
  if (!endpoint || !key) throw new Error('EXTERNAL OCR config missing');
  const headers = { 'Content-Type': 'application/json', Authorization: `Token ${key}` };
  const body = { upload_url: url };
  const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await resp.json();
  const cand = j?.results?.[0]?.plate || j?.results?.[0]?.candidates?.[0]?.plate || '';
  return normalizePlate(String(cand).toUpperCase());
}

export function normalizePlate(txt) {
  return txt.replace(/O/g,'0').replace(/I/g,'1').replace(/Z/g,'2');
}
