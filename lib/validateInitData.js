import crypto from 'crypto';

/**
 * Validate the X-Telegram-Init-Data header as described in
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
export function validateInitData(initData, botToken, maxAgeSeconds = 86400) {
  try {
    if (!initData || !botToken) return { ok: false, error: 'NO_DATA' };

    const params = new URLSearchParams(initData);
    const parsed = Object.create(null);
    for (const [k, v] of params) parsed[k] = v;

    const receivedHash = parsed.hash;
    if (!receivedHash) return { ok: false, error: 'NO_HASH' };
    delete parsed.hash;

    const dataCheckString = Object.keys(parsed)
      .sort()
      .map((k) => `${k}=${parsed[k]}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();
    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest();
    if (computedHash.length !== Buffer.from(receivedHash, 'hex').length) {
      return { ok: false, error: 'HASH_MISMATCH' };
    }
    if (!crypto.timingSafeEqual(computedHash, Buffer.from(receivedHash, 'hex'))) {
      return { ok: false, error: 'HASH_MISMATCH' };
    }

    const authDate = Number(parsed.auth_date);
    if (Number.isFinite(authDate)) {
      const now = Math.floor(Date.now() / 1000);
      if (now - authDate > maxAgeSeconds) return { ok: false, error: 'EXPIRED' };
    }

    return { ok: true, data: parsed };
  } catch {
    return { ok: false, error: 'VALIDATION_ERROR' };
  }
}
