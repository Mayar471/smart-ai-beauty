import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Accounts } from './adapters/accounts.mjs';
import { AppError } from './adapters/errors.mjs';
import { RateLimiter } from './adapters/limits.mjs';
import { isJpeg } from './adapters/png.mjs';
import { Workspace } from './adapters/workspace.mjs';
import { loadCatalog } from './adapters/catalog.mjs';
import { beautyChat } from './adapters/chat.mjs';
import { recommend, provider } from './adapters/suggestions.mjs';
import { searchLocations, getWeather } from './adapters/weather.mjs';
import { generateImage, imageConfigured, validateImageRequest } from './adapters/images.mjs';
import { stylingBrief } from './public/appearance-features.js';
import { wearsHijab, prefersModest, matchesSource } from './public/options.js';

export const VERSION = '1.0.0';

const publicRoot = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};
const compressible = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);
const KB = 1024;
const MB = 1024 * KB;
const HOUR = 60 * 60 * 1000;
const localHost = /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/;
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AppError(413, 'الطلب أكبر من الحد المسموح.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'طلب غير صالح.');
  }
}

/**
 * Builds the HTTP server. Every external dependency can be replaced, which is how the tests run offline.
 */
export function createServer({
  database = process.env.SAB_DATABASE || fileURLToPath(new URL('./runtime/accounts.sqlite', import.meta.url)),
  imageRunner = generateImage,
  chatResponder = beautyChat,
  publicOrigin = process.env.SAB_PUBLIC_ORIGIN || null,
  weatherReader = getWeather,
  locationSearch = searchLocations,
  recommender = recommend,
  limits = { imagesPerHour: 12, chatPerHour: 60, recommendationsPerHour: 20, concurrentImages: 2 },
} = {}) {
  const accounts = new Accounts(database);
  const db = accounts.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS generated_images(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_id TEXT, mode TEXT NOT NULL, image BLOB NOT NULL, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS generated_images_user_idx ON generated_images(user_id, created);
    CREATE TABLE IF NOT EXISTS chat_messages(
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS chat_user_idx ON chat_messages(user_id, id);
  `);
  const workspace = new Workspace(db);
  const quota = new RateLimiter();
  const chatBusy = new Set();
  const imageBusy = new Set();
  const gzipCache = new Map();

  const profileOf = (user) => JSON.parse(user.profile);
  const analysisOf = (user) => JSON.parse(user.analysis || '{}');
  const catalogFor = async (user) => [...workspace.listWardrobe(user), ...(await loadCatalog())];

  // ---------------------------------------------------------------- routes

  const routes = [];
  /** Registers a route. `pattern` is an exact path or a RegExp whose groups become `ctx.params`. */
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  route('GET', '/api/status', () => ({
    version: VERSION,
    provider: provider(),
    suggestions: provider() === 'none' ? 'disconnected' : 'configured',
    imageGeneration: imageConfigured() ? 'configured' : 'disconnected',
    fullOutfitGeneration: imageConfigured() ? 'configured' : 'disconnected',
    visualAnalysis: 'face-hair-and-pose-local',
  }));

  // Accounts ---------------------------------------------------------------

  for (const [pathname, register] of [
    ['/api/register', true],
    ['/api/login', false],
  ])
    route('POST', pathname, async ({ req, res, body }) => ({
      user: await accounts.auth(await body(4 * KB), register, req, res),
    }));

  route('POST', '/api/logout', ({ req, res }) => {
    accounts.logout(req, res);
    return { ok: true };
  });

  route('GET', '/api/me', ({ req }) => {
    const user = accounts.session(req);
    return { user: user ? accounts.safe(user) : null };
  });

  route('POST', '/api/profile', async ({ req, body }) => ({
    user: accounts.update(req, await body(4 * KB)),
  }));
  route('POST', '/api/features', async ({ req, body }) => ({
    user: accounts.saveFeatures(req, await body(4 * KB)),
  }));
  route('POST', '/api/analysis', async ({ req, body }) => ({
    user: accounts.saveAnalysis(req, await body(4 * KB)),
  }));

  route('POST', '/api/photos', async ({ req, body }) => {
    accounts.require(req);
    return { user: accounts.photos(req, await body(17 * MB)) };
  });

  route('GET', /^\/api\/photo\/(face|body)$/, ({ req, res, params }) => {
    const data = accounts.require(req)[params[0]];
    if (!data) throw new AppError(404, 'لم تُحفظ صورة بعد.');
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.from(data));
  });

  // Styling brief: the reviewed interpretation of the saved features, shown to the user and sent to the AI.
  route('GET', '/api/styling-brief', ({ req }) => {
    const user = accounts.require(req);
    return { brief: stylingBrief(profileOf(user), analysisOf(user).features || null) };
  });

  // Catalog and wardrobe -----------------------------------------------------

  route('GET', '/api/catalog', async ({ req }) => {
    const user = accounts.session(req);
    return { items: user ? await catalogFor(user) : await loadCatalog() };
  });

  route('GET', '/api/wardrobe', ({ req }) => ({ items: workspace.listWardrobe(accounts.require(req)) }));

  route('POST', '/api/wardrobe', async ({ req, body }) => {
    const user = accounts.require(req);
    return { status: 201, item: workspace.addWardrobe(user, await body(9 * MB)) };
  });

  route('DELETE', /^\/api\/wardrobe\/(own-[a-f0-9-]{36})$/, ({ req, params }) => {
    workspace.removeWardrobe(accounts.require(req), params[0]);
    return { ok: true };
  });

  route('GET', /^\/api\/wardrobe\/(own-[a-f0-9-]{36})\/image$/, ({ req, res, params }) => {
    const image = workspace.wardrobeImage(accounts.require(req), params[0]);
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(image);
  });

  // Location and weather -----------------------------------------------------

  route('GET', '/api/locations', async ({ req, url }) => {
    accounts.require(req);
    return { locations: await locationSearch(url.searchParams.get('q')) };
  });

  route('GET', '/api/weather', async ({ req, url }) => {
    accounts.require(req);
    const location = {
      latitude: url.searchParams.get('latitude'),
      longitude: url.searchParams.get('longitude'),
    };
    return { weather: await weatherReader(location, url.searchParams.get('date')) };
  });

  // Occasions ----------------------------------------------------------------

  route('GET', '/api/events', ({ req }) => ({ events: workspace.listEvents(accounts.require(req)) }));

  route('POST', '/api/events', async ({ req, body }) => {
    const user = accounts.require(req);
    const input = workspace.validate(await body(8 * KB));
    const weather = await weatherReader(input.location, input.date);
    return { status: 201, event: workspace.saveEvent(user, input, weather) };
  });

  const eventPath = (suffix = '') => new RegExp(`^/api/events/([a-f0-9-]{36})${suffix}$`);

  route('GET', eventPath(), ({ req, params }) => ({
    event: workspace.event(accounts.require(req), params[0]),
  }));

  route('POST', eventPath(), async ({ req, params, body }) => {
    const user = accounts.require(req);
    workspace.event(user, params[0]);
    const input = workspace.validate(await body(8 * KB));
    const weather = await weatherReader(input.location, input.date);
    return { event: workspace.saveEvent(user, input, weather, params[0]) };
  });

  route('DELETE', eventPath(), ({ req, params }) => {
    workspace.removeEvent(accounts.require(req), params[0]);
    return { ok: true };
  });

  route('POST', eventPath('/look'), async ({ req, params, body }) => {
    const user = accounts.require(req);
    workspace.event(user, params[0]);
    return { event: workspace.saveLook(user, params[0], await body(8 * KB), await catalogFor(user)) };
  });

  route('POST', eventPath('/weather'), async ({ req, params }) => {
    const user = accounts.require(req);
    const event = workspace.event(user, params[0]);
    return {
      event: workspace.patch(user, params[0], { weather: await weatherReader(event.location, event.date) }),
    };
  });

  route('POST', eventPath('/recommend'), async ({ req, params }) => {
    const user = accounts.require(req);
    const event = workspace.event(user, params[0]);
    const profile = profileOf(user);
    const modest = prefersModest(profile);
    // Personal garments are always allowed: the user knows her own wardrobe better than a tag does.
    const catalog = (await catalogFor(user)).filter(
      (item) =>
        matchesSource(item, event.source) && (!modest || item.modest === true || item.source === 'wardrobe'),
    );
    if (!catalog.length)
      throw new AppError(
        422,
        'لا توجد قطع في المصدر المختار. أضيفي قطعاً لخزانتك أو اختاري الخزانة والكتالوج معاً.',
      );
    const quotaKey = 'recommend:' + user.id;
    quota.take(
      quotaKey,
      limits.recommendationsPerHour,
      HOUR,
      'وصلتِ إلى حد الاقتراحات لهذه الساعة. حاولي لاحقاً.',
    );

    const weather = await weatherReader(event.location, event.date);
    workspace.patch(user, params[0], { weather });
    try {
      const result = await recommender({
        occasion: event.type,
        preference: event.preference,
        profile: { ...profile, ...(event.style ? { style: event.style } : {}) },
        analysis: analysisOf(user),
        catalog,
        event: { type: event.type, date: event.date, location: event.location.name, setting: event.setting },
        weather,
      });
      return {
        event: workspace.patch(user, params[0], {
          advice: result.text,
          recommendations: result.recommendations,
        }),
      };
    } catch (e) {
      quota.refund(quotaKey);
      throw new AppError(503, e.message);
    }
  });

  // Free-text suggestions (used by the local Gemma/Ollama provider) --------------

  route('POST', '/api/suggestions', async ({ req, body }) => {
    const user = accounts.require(req);
    const input = await body(8 * KB);
    if (
      typeof input?.occasion !== 'string' ||
      input.occasion.length > 200 ||
      typeof input.preference !== 'string' ||
      input.preference.length > 1000
    )
      throw new AppError(400, 'تحققي من المناسبة والتفضيلات.');
    const quotaKey = 'recommend:' + user.id;
    quota.take(
      quotaKey,
      limits.recommendationsPerHour,
      HOUR,
      'وصلتِ إلى حد الاقتراحات لهذه الساعة. حاولي لاحقاً.',
    );
    try {
      return await recommender({
        occasion: input.occasion,
        preference: input.preference,
        profile: profileOf(user),
        analysis: analysisOf(user),
        catalog: await catalogFor(user),
      });
    } catch (e) {
      quota.refund(quotaKey);
      throw new AppError(503, e.message);
    }
  });

  // Beauty advisor chat --------------------------------------------------------

  route('GET', '/api/chat', ({ req }) => {
    const user = accounts.require(req);
    const messages = db
      .prepare('SELECT id,role,text,created FROM chat_messages WHERE user_id=? ORDER BY id DESC LIMIT 60')
      .all(user.id)
      .reverse();
    return { messages };
  });

  route('DELETE', '/api/chat', ({ req }) => {
    db.prepare('DELETE FROM chat_messages WHERE user_id=?').run(accounts.require(req).id);
    return { ok: true };
  });

  route('POST', '/api/chat', async ({ req, body }) => {
    const user = accounts.require(req);
    const input = await body(10 * KB);
    const message = typeof input?.message === 'string' ? input.message.trim() : '';
    if (!message || message.length > 2000) throw new AppError(400, 'اكتبي رسالة بين حرف و2000 حرف.');
    if (chatBusy.has(user.id)) throw new AppError(429, 'انتظري رد المستشارة قبل إرسال رسالة أخرى.');

    const profile = profileOf(user);
    let event = null;
    if (input.eventId) {
      const saved = workspace.event(user, input.eventId);
      event = { type: saved.type, date: saved.date, style: saved.style, setting: saved.setting };
    }
    const history = db
      .prepare('SELECT role,text FROM chat_messages WHERE user_id=? ORDER BY id DESC LIMIT 16')
      .all(user.id)
      .reverse();
    const quotaKey = 'chat:' + user.id;
    quota.take(quotaKey, limits.chatPerHour, HOUR, 'وصلتِ إلى حد الرسائل لهذه الساعة. حاولي لاحقاً.');

    chatBusy.add(user.id);
    try {
      const result = await chatResponder({
        message,
        history,
        context: {
          profile: {
            style: profile.style || '',
            favoriteColors: profile.favoriteColors || '',
            hijabStyle: profile.hijabStyle || 'none',
            modesty: profile.modesty || 'standard',
          },
          stylingBrief: stylingBrief(profile, analysisOf(user).features || null),
          event,
        },
      });
      const created = new Date().toISOString();
      const insert = db.prepare('INSERT INTO chat_messages(user_id,role,text,created) VALUES(?,?,?,?)');
      db.exec('BEGIN');
      let first, second;
      try {
        first = insert.run(user.id, 'user', message, created);
        second = insert.run(user.id, 'assistant', result.text, created);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return {
        messages: [
          { id: Number(first.lastInsertRowid), role: 'user', text: message, created },
          { id: Number(second.lastInsertRowid), role: 'assistant', text: result.text, created },
        ],
        inScope: result.inScope,
      };
    } catch (e) {
      quota.refund(quotaKey);
      throw e;
    } finally {
      chatBusy.delete(user.id);
    }
  });

  // Generated images -----------------------------------------------------------

  route('POST', '/api/images', async ({ req, body }) => {
    const user = accounts.require(req);
    const input = await body(9 * MB);
    if (!input || typeof input !== 'object') throw new AppError(400, 'طلب غير صالح.');
    if (input.eventId) workspace.event(user, input.eventId);
    // Head covering and modesty always come from the saved profile, never from the request.
    const profile = profileOf(user);
    input.hijab = wearsHijab(profile);
    input.modest = prefersModest(profile);
    validateImageRequest(input);

    if (imageBusy.has(user.id))
      throw new AppError(429, 'لديك صورة قيد التوليد. انتظري انتهاءها ثم حاولي مجدداً.');
    if (imageBusy.size >= limits.concurrentImages)
      throw new AppError(429, 'محرك الصور مشغول بطلبات أخرى الآن. أعيدي المحاولة بعد دقيقة.');
    const quotaKey = 'images:' + user.id;
    quota.take(quotaKey, limits.imagesPerHour, HOUR, 'وصلتِ إلى حد توليد الصور لهذه الساعة. حاولي لاحقاً.');

    imageBusy.add(user.id);
    try {
      const bytes = await imageRunner(input);
      const id = randomUUID();
      db.prepare('INSERT INTO generated_images VALUES(?,?,?,?,?,?)').run(
        id,
        user.id,
        input.eventId || null,
        input.mode,
        bytes,
        new Date().toISOString(),
      );
      return { status: 201, id, url: '/api/images/' + id, provider: 'cloudflare' };
    } catch (e) {
      quota.refund(quotaKey);
      throw e;
    } finally {
      imageBusy.delete(user.id);
    }
  });

  route('GET', '/api/images', ({ req, url }) => {
    const user = accounts.require(req);
    const eventId = url.searchParams.get('eventId');
    if (eventId) workspace.event(user, eventId);
    const columns = 'SELECT id,event_id AS eventId,mode,created FROM generated_images WHERE user_id=?';
    const rows = eventId
      ? db.prepare(`${columns} AND event_id=? ORDER BY created DESC LIMIT 30`).all(user.id, eventId)
      : db.prepare(`${columns} ORDER BY created DESC LIMIT 30`).all(user.id);
    return { images: rows.map((image) => ({ ...image, url: '/api/images/' + image.id })) };
  });

  route('GET', /^\/api\/images\/([a-f0-9-]{36})$/, ({ req, res, params }) => {
    const user = accounts.require(req);
    const item = db
      .prepare('SELECT image FROM generated_images WHERE id=? AND user_id=?')
      .get(params[0], user.id);
    if (!item) throw new AppError(404, 'الصورة غير موجودة.');
    const bytes = Buffer.from(item.image);
    const jpeg = isJpeg(bytes);
    res.writeHead(200, {
      'Content-Type': jpeg ? 'image/jpeg' : 'image/png',
      'Content-Disposition': `inline; filename="${params[0]}.${jpeg ? 'jpg' : 'png'}"`,
    });
    res.end(bytes);
  });

  // ---------------------------------------------------------------- static files

  async function serveStatic(req, res, url) {
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendJson(res, 400, { error: 'Invalid path' });
    }
    const file = path.resolve(publicRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(publicRoot + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
    let info;
    try {
      info = await stat(file);
      if (!info.isFile()) throw Error('not a file');
    } catch {
      return sendJson(res, 404, { error: 'Not found' });
    }

    const extension = path.extname(file);
    const demoPage = process.env.SAB_DEMO === '1' && pathname === '/';
    const etag = `"${info.size.toString(16)}-${Math.round(info.mtimeMs).toString(16)}${demoPage ? '-demo' : ''}"`;
    const headers = {
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
      // Vendored models and artwork change only with a release; application code is revalidated every time.
      'Cache-Control': /^\/(vendor|assets)\//.test(pathname) ? 'public, max-age=604800' : 'no-cache',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }

    if (!compressible.has(extension)) {
      res.writeHead(200, { ...headers, 'Content-Length': info.size });
      if (req.method === 'HEAD') return res.end();
      return createReadStream(file).pipe(res);
    }

    let data = await readFile(file);
    if (demoPage)
      data = Buffer.from(
        data
          .toString('utf8')
          .replace('على جهازك</span>', 'عرض مؤقت للطلاب</span>')
          .replace(
            'يمكن حفظ الصور في حسابك على هذا الجهاز.',
            'تُحفظ بيانات العرض في قاعدة منفصلة على جهاز مقدم العرض.',
          ),
      );
    headers.Vary = 'Accept-Encoding';
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && data.length > 1024) {
      let cached = gzipCache.get(file);
      if (cached?.etag !== etag) gzipCache.set(file, (cached = { etag, data: gzipSync(data) }));
      data = cached.data;
      headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, { ...headers, 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  // ---------------------------------------------------------------- dispatcher

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', contentSecurityPolicy);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const url = new URL(req.url, 'http://localhost');
      req.sabPublicHttps = !!publicOrigin;
      // Only loopback hosts are served; the demo tunnel rewrites its Host header to localhost.
      if (!localHost.test(req.headers.host || '')) return sendJson(res, 403, { error: 'Host not allowed' });
      const safeMethod = req.method === 'GET' || req.method === 'HEAD';
      const origin = req.headers.origin;
      if (!safeMethod && origin && origin !== `http://${req.headers.host}` && origin !== publicOrigin)
        return sendJson(res, 403, { error: 'Origin not allowed' });

      for (const { method, pattern, handler } of routes) {
        if (method !== req.method) continue;
        const params =
          typeof pattern === 'string'
            ? pattern === url.pathname
              ? []
              : null
            : pattern.exec(url.pathname)?.slice(1);
        if (!params) continue;
        const result = await handler({ req, res, url, params, body: (limit) => readJsonBody(req, limit) });
        if (res.writableEnded || res.headersSent) return;
        const { status = 200, ...data } = result;
        return sendJson(res, status, data);
      }

      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'المسار غير موجود.' });
      if (!safeMethod) return sendJson(res, 405, { error: 'Method not allowed' });
      return await serveStatic(req, res, url);
    } catch (e) {
      if (!(e instanceof AppError)) console.error(e);
      if (res.headersSent) return res.end();
      return sendJson(res, e instanceof AppError ? e.status : 500, {
        error: e instanceof AppError ? e.message : 'تعذر إكمال الطلب.',
      });
    }
  });
  server.on('close', () => accounts.close());
  return server;
}

function loadPrivateEnv(name) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(`./runtime/${name}`, import.meta.url)));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Could not read runtime/${name}.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Secrets live outside the repository, in runtime/*.env (see .env.example).
  for (const name of ['.env', 'gemini.env', 'cloudflare.env']) loadPrivateEnv(name);
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, '127.0.0.1', () =>
    console.log(`Smart AI Beauty ${VERSION}: http://127.0.0.1:${port}`),
  );
}
