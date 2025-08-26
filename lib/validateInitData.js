
import crypto from 'crypto';
import querystring from 'querystring';
export function validateInitData(initData, botToken, maxAgeSeconds = 86400) {
  try {
    if (!initData || !botToken) return { ok: false, error: 'NO_DATA' };
    const parsed = querystring.parse(initData);
    const receivedHash = parsed.hash;
    if (!receivedHash) return { ok: false, error: 'NO_HASH' };
    delete parsed.hash;
    const pairs = Object.keys(parsed)
      .map((k) => [k, Array.isArray(parsed[k]) ? parsed[k][parsed[k].length-1] : parsed[k]])
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([k,v]) => `${k}=${v}`);
    const dataCheckString = pairs.join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (computedHash !== receivedHash) return { ok: false, error: 'HASH_MISMATCH' };
    const authDate = Number(parsed.auth_date);
    if (Number.isFinite(authDate)) {
      const now = Math.floor(Date.now()/1000);
      if (now - authDate > maxAgeSeconds) return { ok: false, error: 'EXPIRED' };
    }
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, error: 'VALIDATION_ERROR' };
  }
}
