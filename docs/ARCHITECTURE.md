# البنية والتدفقات — Smart AI Beauty 1.0

## نظرة عامة

```text
المتصفح (public/)  ──REST/JSON──►  خادم Node (server.mjs + adapters/)  ──►  SQLite (runtime/)
   │                                        ├──► Open-Meteo   (المدن والطقس)
   │                                        ├──► Gemini       (الاقتراح والمحادثة، نص فقط)
   │                                        └──► Cloudflare   (توليد الصور، بعد الموافقة)
   └── MediaPipe + WASM + Canvas (تحليل السمات ومعاينات المكياج والشعر، محلياً)
```

لا يوجد إطار عمل ولا خطوة بناء ولا اعتماديات npm. الخادم يستمع على `127.0.0.1` فقط.

## الخادم

`server.mjs` يبني جدول مسارات بالدالة `route(method, pattern, handler)`. كل معالج يستقبل `{ req, res, url, params, body }` ويعيد كائناً يُرسل كـJSON (`status` اختياري)، أو يكتب الرد بنفسه للصور. الأخطاء المتوقعة تُرمى كـ`AppError(status, رسالة عربية)`.

| الملف | المسؤولية |
| --- | --- |
| `adapters/accounts.mjs` | المستخدمون، كلمات المرور (scrypt)، الجلسات الدائمة (يُخزَّن تجزئة الرمز فقط)، الملف والصور والتحليل |
| `adapters/workspace.mjs` | الخزانة والمناسبات والإطلالات؛ كل استعلام مقيّد بمعرّف المالكة |
| `adapters/suggestions.mjs` | بناء سياق الاقتراح واستدعاء Gemini بمخطط JSON يقيّد المعرفات |
| `adapters/chat.mjs` | المستشارة: مصنّف مجال ثم الرد |
| `adapters/images.mjs` | التحقق من طلب التوليد وبناء التعليمات من خيارات معتمدة فقط |
| `adapters/weather.mjs` | البحث عن المدن والتوقع اليومي |
| `adapters/limits.mjs` | حصص لكل حساب (صور، محادثة، اقتراحات) تحمي الحصص المجانية |
| `adapters/png.mjs` | التحقق من صور PNG المرفوعة |

### المصدر المشترك للخيارات

`public/options.js` و`public/appearance-features.js` يستوردهما المتصفح **والخادم**. إضافة تسريحة أو لفة حجاب أو لون في مكان واحد تكفي للعرض والتحقق وتعليمات الصور معاً.

### واجهات API

| المسار | الوظيفة |
| --- | --- |
| `POST /api/register` · `/api/login` · `/api/logout` | الحساب والجلسة. التسجيل يقبل `hijab: true` |
| `GET /api/me` · `POST /api/profile` | الملف والتفضيلات (تحديث جزئي) |
| `POST /api/photos` · `GET /api/photo/face\|body` | صورتا الحساب |
| `POST /api/analysis` · `POST /api/features` | حفظ فحص الوضعية والسمات المرتبطة ببصمة الصورتين |
| `GET /api/styling-brief` | ملخص التنسيق المشتق من السمات والتصحيحات اليدوية |
| `GET /api/catalog` | الخزانة الخاصة ثم الكتالوج العام |
| `GET\|POST /api/wardrobe` · `DELETE /api/wardrobe/:id` · `GET /api/wardrobe/:id/image` | الخزانة |
| `GET /api/locations` · `GET /api/weather` | المدن والطقس |
| `GET\|POST /api/events` · `GET\|POST\|DELETE /api/events/:id` | المناسبات |
| `POST /api/events/:id/recommend` · `/weather` · `/look` | الاقتراح، تحديث الطقس، حفظ الإطلالة |
| `GET\|POST\|DELETE /api/chat` | المحادثة |
| `POST /api/images` · `GET /api/images[?eventId]` · `GET /api/images/:id` | الصور المولدة |
| `POST /api/suggestions` | اقتراح نصي حر (مزود Ollama التجريبي) |
| `GET /api/status` | حالة الإعداد والإصدار |

كل المسارات عدا `status` و`me` و`catalog` والتسجيل تتطلب جلسة. طلبات التعديل ذات `Origin` خارجي تُرفض، و`Host` غير المحلي يُرفض.

## الواجهة

أربع وحدات ES مستقلة تتواصل بأحداث `CustomEvent` على `window`، وتتشارك أدوات `ui.js`:

| الوحدة | المسؤولية |
| --- | --- |
| `account.js` | حالة المستخدم، نافذة الدخول والتفضيلات، حفظ الصور والتحليل |
| `dashboard.js` | لوحة التحكم، نموذج المناسبة، الخزانة، شريط المناسبة والحفظ التلقائي |
| `app.js` | محرّر الإطلالة بخطواته الخمس، التحليل المحلي، المعاينات والتوليد |
| `chat.js` | نافذة مستشارة الجمال |

### الأحداث

| الحدث | المصدر ← المستقبل | المعنى |
| --- | --- | --- |
| `sab-user-state` | account ← الكل | المستخدم الحالي (أو `null`) بعد أي تغيير |
| `sab-session-ready` | account ← dashboard | انتهى فحص الجلسة الأول |
| `sab-analysis-state` | account ← app | التحليل المحفوظ وبصمة الصورتين |
| `sab-account-photos` | account ← app | الصورتان المحفوظتان بعد الدخول |
| `sab-photos-saved` | account ← app | حُفظت الصورتان؛ يبدأ التحليل التلقائي |
| `sab-save-photos` · `sab-save-analysis` · `sab-set-profile` | app ← account | طلبات حفظ |
| `sab-catalog` | dashboard ← app | قائمة القطع المتاحة |
| `sab-start-event` · `sab-leave-event` · `sab-edit-profile` | dashboard ← app, chat | فتح مناسبة أو مغادرتها |
| `sab-apply-outfit` | dashboard ← app | اعتماد القطع المقترحة |
| `sab-look-change` | app ← dashboard | تغيّرت الإطلالة؛ تُحفظ تلقائياً بعد مهلة قصيرة |
| `sab-open-account` · `sab-notify` · `sab-account-cleared` | عام | فتح الحساب، إشعار، تسجيل خروج |

## التدفقات الأساسية

### 1. الملف وتحليل السمات

1. المستخدمة تختار «بالحجاب / دون حجاب» وتضيف صورتين (تُطبَّعان إلى PNG حتى 1600px) وتحفظهما.
2. `app.js` يشغّل تلقائياً Pose Landmarker وFace Landmarker محلياً، ويستخرج: وضوح الجسم والوضعية، شكل الوجه، نسبة الكتفين للوركين، نسبة الساقين للجذع.
3. النتيجة تُرسل للخادم مع بصمة الصورتين؛ الخادم يرفض أي تحليل لا يطابق الصور المحفوظة ويتحقق من القيم.
4. `stylingBrief()` يحوّل السمات والتصحيحات اليدوية إلى قواعد تنسيق تُعرض في الواجهة وتدخل في سياق Gemini.

### 2. المناسبة والاقتراح

1. نموذج المناسبة ← `POST /api/events`؛ الخادم يجلب الطقس بنفسه.
2. `POST /api/events/:id/recommend` يفلتر القطع حسب المصدر والاحتشام، ويرسل نصاً منظماً إلى Gemini مع مخطط JSON لا يقبل إلا معرفات موجودة، ثم يتحقق من الرد.
3. إعادة حفظ المناسبة دون تغيير سياقها تُبقي الاقتراح ولا تستهلك الحصة.

### 3. الإطلالة

خمس خطوات: ملفك ← الملابس ← الشعر أو الحجاب ← المكياج ← إطلالتك. كل تغيير يُحفظ تلقائياً. التوليد يرسل صوراً مصغّرة (480px) إلى `POST /api/images`؛ تفضيل الحجاب والاحتشام يؤخذان من الملف المحفوظ على الخادم لا من الطلب.

## قاعدة البيانات

| الجدول | المحتوى |
| --- | --- |
| `users` | الحساب، الملف (JSON)، الصورتان (BLOB)، التحليل (JSON) |
| `sessions` | تجزئة رمز الجلسة، المالكة، وقت الانتهاء |
| `wardrobe` | قطع الخزانة وصورها |
| `occasions` | المناسبة والطقس والاقتراح والإطلالة (JSON) |
| `generated_images` | الصور المولدة |
| `chat_messages` | رسائل المحادثة |

الترقيات تُجرى عند الإقلاع بـ`CREATE TABLE IF NOT EXISTS` و`ALTER TABLE` دون مسح البيانات.
