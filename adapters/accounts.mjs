import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { validateFeatures, faceLabels, bodyLabels } from '../public/appearance-features.js';
import { AppError } from './errors.mjs';
import { RateLimiter } from './limits.mjs';
import { readPngDataUrl, pngSize } from './png.mjs';

export { AppError };

const scrypt = promisify(scryptCallback);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const cookiePattern = /\bsab_session=([a-f0-9]{64})(?:;|$)/;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

const appearanceChoices = {
  hijabStyle: { allowed: ['none', 'hijab'], fallback: 'none' },
  modesty: { allowed: ['standard', 'modest'], fallback: 'standard' },
  faceShape: { allowed: ['auto', ...Object.keys(faceLabels)], fallback: 'auto' },
  bodyBalance: { allowed: ['auto', ...Object.keys(bodyLabels)], fallback: 'auto' },
};
const measurementRanges = [
  ['heightCm', 80, 230],
  ['chestCm', 40, 250],
  ['waistCm', 40, 250],
  ['hipsCm', 40, 250],
];

export class Accounts {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.attempts = new RateLimiter();
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS users(
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL,
        password BLOB NOT NULL, profile TEXT NOT NULL DEFAULT '{}', face BLOB, body BLOB, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
    `);
    const columns = this.db.prepare('PRAGMA table_info(users)').all();
    if (!columns.some((c) => c.name === 'analysis'))
      this.db.exec("ALTER TABLE users ADD COLUMN analysis TEXT NOT NULL DEFAULT '{}'");
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  }

  user(id) {
    return this.db.prepare('SELECT * FROM users WHERE id=?').get(id) || null;
  }

  /** Fingerprint of both profile photos; analyses are only accepted for the photos they were made from. */
  revision(user) {
    return user.face && user.body
      ? createHash('sha256').update(Buffer.from(user.face)).update(Buffer.from(user.body)).digest('hex')
      : null;
  }

  /** The user as the browser may see it: no password material and no photo bytes. */
  safe(user) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      profile: JSON.parse(user.profile),
      hasFace: !!user.face,
      hasBody: !!user.body,
      photoRevision: this.revision(user),
      analysis: JSON.parse(user.analysis || '{}'),
    };
  }

  session(req) {
    const token = cookiePattern.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    const row = this.db
      .prepare('SELECT user_id,expires FROM sessions WHERE token_hash=?')
      .get(hashToken(token));
    if (!row) return null;
    if (row.expires < Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
      return null;
    }
    return this.user(row.user_id);
  }

  require(req) {
    const user = this.session(req);
    if (!user) throw new AppError(401, 'سجّلي الدخول أولاً.');
    return user;
  }

  start(res, user, secure = false) {
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hashToken(token), user.id, now + SESSION_MS);
    res.setHeader(
      'Set-Cookie',
      `sab_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`,
    );
    return this.safe(user);
  }

  logout(req, res) {
    const token = cookiePattern.exec(req.headers.cookie || '')?.[1];
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
    res.setHeader('Set-Cookie', 'sab_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  }

  async auth(input, register, req, res) {
    // Behind the demo tunnel every visitor shares the loopback address, so use the forwarded client address.
    const client = (req.sabPublicHttps && req.headers['cf-connecting-ip']) || req.socket.remoteAddress;
    this.attempts.take('auth:' + client, 30, 15 * 60 * 1000, 'محاولات كثيرة. حاولي بعد ربع ساعة.');

    const { name, email, password } = input || {};
    if (
      typeof email !== 'string' ||
      email.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      typeof password !== 'string' ||
      password.length < 8 ||
      password.length > 128
    )
      throw new AppError(400, 'أدخلي بريداً صالحاً وكلمة مرور من 8 إلى 128 حرفاً.');
    const normalized = email.trim().toLowerCase();

    if (register) {
      if (typeof name !== 'string' || !name.trim() || name.length > 60)
        throw new AppError(400, 'أدخلي اسماً من 1 إلى 60 حرفاً.');
      if (input.hijab !== undefined && typeof input.hijab !== 'boolean')
        throw new AppError(400, 'تفضيل الحجاب غير صالح.');
      const profile = input.hijab ? { hijabStyle: 'hijab', modesty: 'modest' } : {};
      const salt = randomBytes(16).toString('hex');
      const hash = await scrypt(password, salt, 64);
      try {
        this.db
          .prepare('INSERT INTO users(id,email,name,salt,password,profile,created) VALUES(?,?,?,?,?,?,?)')
          .run(
            randomUUID(),
            normalized,
            name.trim(),
            salt,
            hash,
            JSON.stringify(profile),
            new Date().toISOString(),
          );
      } catch (e) {
        if (e.errcode === 2067 || e.code?.startsWith('ERR_SQLITE_CONSTRAINT'))
          throw new AppError(409, 'هذا البريد مسجل مسبقاً.');
        throw e;
      }
    }

    const user = this.db.prepare('SELECT * FROM users WHERE email=?').get(normalized);
    // Always derive a hash so that unknown e-mails take as long as wrong passwords.
    const hash = await scrypt(password, user?.salt || 'unregistered-user', 64);
    if (!user || !timingSafeEqual(hash, Buffer.from(user.password)))
      throw new AppError(401, 'البريد أو كلمة المرور غير صحيحين.');
    return this.start(res, user, req.sabPublicHttps === true);
  }

  /** Partial profile update: fields that are not sent keep their saved value. */
  update(req, input) {
    const user = this.require(req);
    if (!input || typeof input !== 'object') throw new AppError(400, 'بيانات غير صالحة.');
    const previous = JSON.parse(user.profile);
    const profile = {};

    for (const key of ['style', 'favoriteColors', 'size']) {
      const value = input[key] === undefined ? previous[key] || '' : input[key];
      if (typeof value !== 'string' || value.length > 200) throw new AppError(400, 'تحققي من بيانات الملف.');
      profile[key] = value.trim();
    }
    for (const [key, { allowed, fallback }] of Object.entries(appearanceChoices)) {
      const value = input[key] ?? previous[key] ?? fallback;
      if (!allowed.includes(value)) throw new AppError(400, 'تفضيلات المظهر غير صالحة.');
      profile[key] = value;
    }
    for (const [key, min, max] of measurementRanges) {
      const value = input[key] === undefined ? previous[key] : input[key];
      const empty = value === undefined || value === null || value === '';
      if (!empty && (!Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max))
        throw new AppError(400, 'راجعي القياسات الاختيارية بالسنتيمتر.');
      profile[key] = empty ? null : Number(value);
    }

    this.db.prepare('UPDATE users SET profile=? WHERE id=?').run(JSON.stringify(profile), user.id);
    return this.safe(this.user(user.id));
  }

  photos(req, input) {
    const user = this.require(req);
    const read = (value) =>
      readPngDataUrl(value, {
        maxBytes: 6 * 1024 * 1024,
        maxSide: 2000,
        message: 'ارفعي صورة PNG صالحة عبر الواجهة.',
      });
    const face = read(input?.face);
    const body = read(input?.body);
    // New photos invalidate every analysis made from the previous ones.
    this.db.prepare("UPDATE users SET face=?,body=?,analysis='{}' WHERE id=?").run(face, body, user.id);
    return this.safe(this.user(user.id));
  }

  saveAnalysis(req, input) {
    const user = this.require(req);
    if (!user.face || !user.body) throw new AppError(400, 'احفظي صورتَي الحساب أولاً.');
    if (input?.photoRevision !== this.revision(user))
      throw new AppError(409, 'تغيرت الصور. احفظي الصورتين وأعيدي التحليل قبل حفظ النتيجة.');
    const data = input.result;
    const bodySize = pngSize(Buffer.from(user.body));
    if (
      !data ||
      data.version !== 1 ||
      data.model !== 'mediapipe-pose-lite' ||
      data.landmarkCount !== 33 ||
      !Number.isInteger(data.visibleLandmarks) ||
      data.visibleLandmarks < 0 ||
      data.visibleLandmarks > 33 ||
      typeof data.fullBodyVisible !== 'boolean' ||
      !['upright', 'other'].includes(data.pose) ||
      data.width !== bodySize.width ||
      data.height !== bodySize.height
    )
      throw new AppError(400, 'بيانات التحليل غير صالحة أو لا تطابق الصورة المحفوظة.');
    if (
      (data.fullBodyVisible && data.visibleLandmarks < 9) ||
      (data.pose === 'upright' && !data.fullBodyVisible)
    )
      throw new AppError(400, 'نتيجة تحليل غير متسقة.');
    const band = data.upperBodyBand;
    if (
      band &&
      (!Number.isFinite(band.top) ||
        !Number.isFinite(band.bottom) ||
        band.top < 0 ||
        band.bottom > 1 ||
        band.bottom - band.top < 0.05 ||
        data.pose !== 'upright')
    )
      throw new AppError(400, 'حدود الجزء العلوي غير صالحة. أعيدي فحص الجسم.');

    const analysis = {
      version: 1,
      model: data.model,
      landmarkCount: 33,
      visibleLandmarks: data.visibleLandmarks,
      fullBodyVisible: data.fullBodyVisible,
      pose: data.pose,
      width: data.width,
      height: data.height,
      upperBodyBand: band ? { top: band.top, bottom: band.bottom } : null,
      analyzedAt: new Date().toISOString(),
      features: JSON.parse(user.analysis || '{}').features || null,
      source: 'browser-local-mediapipe',
    };
    this.db.prepare('UPDATE users SET analysis=? WHERE id=?').run(JSON.stringify(analysis), user.id);
    return this.safe(this.user(user.id));
  }

  saveFeatures(req, input) {
    const user = this.require(req);
    if (!user.face || !user.body || input?.photoRevision !== this.revision(user))
      throw new AppError(409, 'احفظي الصورتين وأعيدي التحليل للصورتين الحاليتين.');
    let features;
    try {
      features = validateFeatures(input.features);
    } catch {
      throw new AppError(400, 'بيانات السمات غير صالحة.');
    }
    const analysis = {
      ...JSON.parse(user.analysis || '{}'),
      features: { ...features, analyzedAt: new Date().toISOString() },
    };
    this.db.prepare('UPDATE users SET analysis=? WHERE id=?').run(JSON.stringify(analysis), user.id);
    return this.safe(this.user(user.id));
  }

  close() {
    this.db.close();
  }
}
