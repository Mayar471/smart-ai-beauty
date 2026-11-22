# مكونات الطرف الثالث

## MediaPipe Tasks Vision

- الحزمة: `@mediapipe/tasks-vision`، الإصدار المثبت `1.1.1`.
- الناشر: Google / MediaPipe.
- الترخيص المعلن في package.json: Apache-2.0. النص في `public/vendor/mediapipe/LICENSE.txt`.
- المصدر: https://www.npmjs.com/package/@mediapipe/tasks-vision
- المستودع: https://github.com/google-ai-edge/mediapipe
- نسخة ملفات JavaScript وWASM المضمنة كما نُشرت، دون تعديل. منطق التطبيق في `public/beauty.js` منفصل عنها.

## ملفات النماذج

- Face Landmarker: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- Hair Segmenter: https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite
- Pose Landmarker Lite: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task
- توثيق النماذج وبطاقاتها: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker وhttps://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter
- النسخ المحلية مثبتة فعلياً في هذه الحزمة ولا تُحدَّث تلقائياً. بصمات SHA-256 في `public/vendor/mediapipe/manifest.json`.

أسماء التقنيات والعلامات تعود لأصحابها. لا تُستنتج حقوق استخدام بيانات Fashionpedia أو نماذج CatVTON من ترخيص مكتبة MediaPipe؛ تُراجع شروط كل مورد عند ربطه.

## Fashionpedia sample

الصور والـannotations من عينة مستودع KMnP/fashionpedia-api. ملفات الكتالوج مشتقة بقص الأقنعة؛ المصدر ومعرّفات الصور والـannotations في `data/fashionpedia-provenance.json`. أسماء العرض والألوان والمناسبات منسقة لهذه العينة، وليست تنبؤاً آلياً. الصور الأصلية تحمل حقوق المصورين؛ الاستخدام الحالي عرض تعليمي محلي ولا يُفترض منه حق نشر تجاري مفتوح.

## خدمة IDM-VTON وعميل Gradio

- خدمة خارجية: https://huggingface.co/spaces/yisol/IDM-VTON
- المصدر وشروط النموذج: https://github.com/yisol/IDM-VTON
- العميل المثبت: `@gradio/client` إصدار `2.7.1`، عبر npm، مع lockfile. الترخيص المعلن في package.json: ISC. لا نوزع أوزان IDM-VTON في هذا المشروع.
- التجربة ترسل صورة الجسم والقطعة إلى خدمة عامة بعد موافقة المستخدمة. قيود الحصة والتوفر وسياسة ملفات الخدمة الخارجية تنطبق عليها، ولا يضمن تخزين النتائج محلياً أن نسخ الخدمة الخارجية خاصة.
- صورة فحص الجسم المستخدمة في الاختبار من https://storage.googleapis.com/mediapipe-assets/pose.jpg. صورة `upper-tryon-example.png` نتيجة اختبار باستخدام هذه الصورة العامة، وليست صورة شخصية للمستخدمة.

## معالجة الصور في النسخة 0.5

- pngjs إصدار 7.0.0، ترخيص MIT بحسب الحزمة، مثبت في package-lock.json. المصدر: https://github.com/pngjs/pngjs.
- تفسير mask_gray ومسار الصورة مبنيان على المصدر الرسمي لخدمة IDM-VTON: https://github.com/yisol/IDM-VTON/blob/main/gradio_demo/app.py. لا توزع أوزان إضافية.
- combined-colors-example.png اختبار مشتق من لقطة الديمو المرجعية الموجودة في references، ويعرض تلوين الشعر والمكياج فقط. upper-tryon-fitted-example.png مشتق من صورة pose.jpg العامة قبل إضافة حماية نطاق الجسم؛ ليس صورة للمستخدمة ولا نتيجة الحماية النهائية.

## الطقس والمدن — النسخة 0.6

- Open-Meteo Forecast API: https://open-meteo.com/en/docs، والبحث الجغرافي: https://open-meteo.com/en/docs/geocoding-api. بيانات أسماء المواقع تعتمد على GeoNames كما يوضح توثيق الخدمة.
- شروط الاستخدام والحصة المجانية غير التجارية: https://open-meteo.com/en/terms. تعرض الواجهة الإسناد إلى Open-Meteo؛ يلزم مراجعة الشروط قبل نشر تجاري.
- تتطلب هذه الوظيفة إنترنت؛ لا تتضمن حزمة المشروع قاعدة طقس أو مدن كاملة.
- عميل Gradio ومكتبة pngjs وملفات الربط السابق تبقى آثار تطوير سابقة؛ توليد الصور عبر Hugging Face غير نشط في النسخة 0.6.
