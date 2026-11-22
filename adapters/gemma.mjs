// Text recommendations only. No portrait upload or image synthesis here.
export async function suggest({ occasion, preference }) {
  if (!process.env.OLLAMA_MODEL)
    throw new Error('مستشارة الإطلالة غير موصولة حالياً. يمكنك متابعة الاختيار بنفسك.');
  try {
    const response = await fetch(`${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'أنت مستشارة تنسيق ملابس. أجيبي بالعربية بثلاث اقتراحات قصيرة للملابس والشعر والمكياج. لا تدعي تحليل صورة أو تنفيذ تعديلات عليها. لا تقدمي تشخيصاً طبياً.',
          },
          { role: 'user', content: `المناسبة: ${occasion}\nالتفضيلات: ${preference}` },
        ],
      }),
    });
    if (!response.ok) throw new Error('upstream');
    const data = await response.json();
    if (typeof data.message?.content !== 'string' || !data.message.content.trim()) throw new Error('empty');
    return data.message.content;
  } catch {
    throw new Error('تعذر الاتصال بالمستشارة المحلية. تحققي من تشغيل Ollama واسم النموذج.');
  }
}
