import { randomUUID } from 'node:crypto';
import {
  hairstyles,
  hairColors,
  hijabStyles,
  hijabColors,
  makeupPresets,
  makeupStrengths,
  occasionTypes,
  garmentCategories,
  defaultLook,
  maxLookItems,
} from '../public/options.js';
import { AppError } from './errors.mjs';
import { readPngDataUrl } from './png.mjs';
import { coordinates, eventDate } from './weather.mjs';

export const occasions = occasionTypes;
const WARDROBE_LIMIT = 50;
const hexColor = /^#[a-fA-F0-9]{6}$/;
/** Fields whose change makes a previous recommendation stale. */
const recommendationInputs = ['type', 'date', 'setting', 'style', 'preference', 'source'];

/** Per-account wardrobe and occasions. Every query is scoped by the owning user id. */
export class Workspace {
  constructor(db) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS wardrobe(
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
        color TEXT NOT NULL, occasions TEXT NOT NULL, image BLOB NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS occasions(
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS wardrobe_user_idx ON wardrobe(user_id, created);
      CREATE INDEX IF NOT EXISTS occasions_user_idx ON occasions(user_id, updated);
    `);
    if (
      !db
        .prepare('PRAGMA table_info(wardrobe)')
        .all()
        .some((c) => c.name === 'modest')
    )
      db.exec('ALTER TABLE wardrobe ADD COLUMN modest INTEGER NOT NULL DEFAULT 0');
  }

  listWardrobe(user) {
    return this.db
      .prepare(
        'SELECT id,name,category,color,occasions,created,modest FROM wardrobe WHERE user_id=? ORDER BY created DESC',
      )
      .all(user.id)
      .map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        colorName: row.color,
        occasions: JSON.parse(row.occasions),
        image: `/api/wardrobe/${row.id}/image`,
        source: 'wardrobe',
        modest: row.modest === 1,
        detail: 'من خزانتك الخاصة',
        createdAt: row.created,
      }));
  }

  addWardrobe(user, input) {
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM wardrobe WHERE user_id=?').get(user.id).n;
    if (count >= WARDROBE_LIMIT)
      throw new AppError(422, `وصلت الخزانة التجريبية إلى ${WARDROBE_LIMIT} قطعة.`);
    if (
      typeof input?.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 100 ||
      !Object.hasOwn(garmentCategories, input.category) ||
      typeof input.color !== 'string' ||
      !input.color.trim() ||
      input.color.length > 60 ||
      !Array.isArray(input.occasions) ||
      input.occasions.some((x) => !occasionTypes.includes(x))
    )
      throw new AppError(400, 'راجعي اسم القطعة ونوعها ولونها ومناسباتها.');
    if (input.modest !== undefined && typeof input.modest !== 'boolean')
      throw new AppError(400, 'خيار الاحتشام غير صالح.');
    const bytes = readPngDataUrl(input.image, {
      maxBytes: 6 * 1024 * 1024,
      maxSide: 2000,
      message: 'ارفعي صورة صالحة عبر الواجهة.',
    });
    const id = 'own-' + randomUUID();
    this.db
      .prepare(
        'INSERT INTO wardrobe(id,user_id,name,category,color,occasions,image,created,modest) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        user.id,
        input.name.trim(),
        input.category,
        input.color.trim(),
        JSON.stringify([...new Set(input.occasions)]),
        bytes,
        new Date().toISOString(),
        input.modest === true ? 1 : 0,
      );
    return this.listWardrobe(user).find((item) => item.id === id);
  }

  removeWardrobe(user, id) {
    const result = this.db.prepare('DELETE FROM wardrobe WHERE id=? AND user_id=?').run(id, user.id);
    if (!result.changes) throw new AppError(404, 'القطعة غير موجودة في خزانتك.');
    // Saved looks must never reference a garment that no longer exists.
    for (const event of this.listEvents(user)) {
      const cleaned = {};
      if (event.look?.itemIds.includes(id))
        cleaned.look = { ...event.look, itemIds: event.look.itemIds.filter((itemId) => itemId !== id) };
      if (event.recommendations?.some((r) => r.itemId === id))
        cleaned.recommendations = event.recommendations.filter((r) => r.itemId !== id);
      if (Object.keys(cleaned).length) this.patch(user, event.id, cleaned);
    }
  }

  wardrobeImage(user, id) {
    const row = this.db.prepare('SELECT image FROM wardrobe WHERE id=? AND user_id=?').get(id, user.id);
    if (!row) throw new AppError(404, 'القطعة غير موجودة في خزانتك.');
    return Buffer.from(row.image);
  }

  listEvents(user) {
    return this.db
      .prepare('SELECT data FROM occasions WHERE user_id=? ORDER BY updated DESC')
      .all(user.id)
      .map((row) => JSON.parse(row.data));
  }

  event(user, id) {
    const row = this.db.prepare('SELECT data FROM occasions WHERE id=? AND user_id=?').get(id, user.id);
    if (!row) throw new AppError(404, 'المناسبة غير موجودة في حسابك.');
    return JSON.parse(row.data);
  }

  validate(input) {
    if (
      !occasionTypes.includes(input?.type) ||
      typeof input.location?.name !== 'string' ||
      !input.location.name.trim() ||
      input.location.name.length > 250 ||
      !['indoor', 'outdoor', 'mixed'].includes(input.setting) ||
      typeof input.style !== 'string' ||
      input.style.length > 200 ||
      typeof input.preference !== 'string' ||
      input.preference.length > 1000 ||
      !['all', 'wardrobe', 'catalog'].includes(input.source)
    )
      throw new AppError(400, 'راجعي تفاصيل المناسبة والموقع والأسلوب.');
    return {
      type: input.type,
      date: eventDate(input.date),
      location: {
        name: input.location.name.trim(),
        ...coordinates(input.location.latitude, input.location.longitude),
      },
      setting: input.setting,
      style: input.style.trim(),
      preference: input.preference.trim(),
      source: input.source,
    };
  }

  /** Creates an occasion, or updates it while keeping whatever the edit did not make stale. */
  saveEvent(user, input, weather, id) {
    const data = this.validate(input);
    const old = id ? this.event(user, id) : null;
    const now = new Date().toISOString();
    const sameContext =
      !!old &&
      recommendationInputs.every((key) => old[key] === data[key]) &&
      old.location.latitude === data.location.latitude &&
      old.location.longitude === data.location.longitude;
    const event = {
      ...data,
      id: old?.id || randomUUID(),
      weather,
      look: old && old.source === data.source ? old.look : null,
      recommendations: sameContext ? old.recommendations || [] : [],
      advice: sameContext ? old.advice || '' : '',
      createdAt: old?.createdAt || now,
      updatedAt: now,
    };
    this.db
      .prepare(
        'INSERT INTO occasions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated',
      )
      .run(event.id, user.id, JSON.stringify(event), event.createdAt, now);
    return event;
  }

  removeEvent(user, id) {
    this.event(user, id);
    this.db.prepare('DELETE FROM occasions WHERE id=? AND user_id=?').run(id, user.id);
    this.db.prepare('DELETE FROM generated_images WHERE event_id=? AND user_id=?').run(id, user.id);
  }

  patch(user, id, changes) {
    const event = { ...this.event(user, id), ...changes, updatedAt: new Date().toISOString() };
    this.db
      .prepare('UPDATE occasions SET data=?,updated=? WHERE id=? AND user_id=?')
      .run(JSON.stringify(event), event.updatedAt, id, user.id);
    return event;
  }

  saveLook(user, id, input, catalog) {
    // Looks saved before hijab wraps existed simply receive the default wrap.
    const look = { ...defaultLook(), ...(input && typeof input === 'object' ? input : {}) };
    const valid =
      Array.isArray(look.itemIds) &&
      look.itemIds.length <= maxLookItems &&
      new Set(look.itemIds).size === look.itemIds.length &&
      look.itemIds.every((itemId) => typeof itemId === 'string' && catalog.some((c) => c.id === itemId)) &&
      hairstyles.some((h) => h.id === look.hair) &&
      hairColors.some((c) => c.name === look.color) &&
      hijabStyles.some((h) => h.id === look.hijabWrap) &&
      hijabColors.some((c) => c.name === look.hijabColor) &&
      makeupPresets.some((m) => m.id === look.makeup) &&
      Object.hasOwn(makeupStrengths, look.strength) &&
      ['lip', 'eye', 'blush'].every((key) => hexColor.test(look[key] || ''));
    if (!valid) throw new AppError(400, 'اختيارات الإطلالة غير صالحة أو تضم قطعة غير متاحة لحسابك.');
    const safe = Object.fromEntries(Object.keys(defaultLook()).map((key) => [key, look[key]]));
    return this.patch(user, id, { look: safe });
  }
}
