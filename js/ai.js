/* =====================================================================
 * ai.js — وحدة الذكاء الاصطناعي (Google Gemini) وإدارة الـ API
 * ===================================================================== */
const AI = (() => {
  const MODELS = [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ];

  const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  function isConfigured() {
    return !!(AppState.settings.geminiKey && AppState.settings.model);
  }

  /**
   * استدعاء Gemini generateContent
   * @param {string} prompt  النص المطلوب
   * @param {object} opts    { json: boolean, maxTokens: number }
   */
  async function generate(prompt, opts = {}) {
    const { geminiKey, model } = AppState.settings;
    if (!geminiKey) throw new Error('لم يتم إعداد مفتاح Gemini API — أضِفه من صفحة الإعدادات أولاً.');

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxTokens ?? 8192
      }
    };
    if (opts.json) body.generationConfig.responseMimeType = 'application/json';

    const res = await fetch(`${API_BASE}/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let msg = `خطأ ${res.status}`;
      try {
        const err = await res.json();
        msg = err.error?.message || msg;
      } catch (_) { /* تجاهل */ }
      if (res.status === 400 && /api key/i.test(msg)) msg = 'مفتاح API غير صالح.';
      if (res.status === 404) msg = `الموديل "${model}" غير متاح — جرّب موديلاً آخر من الإعدادات.`;
      if (res.status === 429) msg = 'تم تجاوز حد الاستخدام (Quota) — انتظر قليلاً أو استخدم مفتاحاً آخر.';
      throw new Error(msg);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    if (!text) throw new Error('لم يُرجع الموديل أي نص — حاول مرة أخرى.');
    return text;
  }

  /** توليد JSON مضمون البنية (مع محاولة إصلاح) */
  async function generateJSON(prompt, opts = {}) {
    const raw = await generate(prompt + '\n\nأجب بصيغة JSON صالحة فقط بدون أي شرح إضافي.', { ...opts, json: true });
    try {
      return JSON.parse(raw);
    } catch (_) {
      // محاولة استخراج JSON من داخل النص
      const match = raw.match(/\{[\s\S]*\}/) || raw.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
      throw new Error('تعذّر تحليل استجابة الذكاء الاصطناعي كـ JSON.');
    }
  }

  /**
   * مُختبِر الاتصال: يتحقق من صحة المفتاح ويقيس زمن الاستجابة
   */
  async function testConnection(model, key) {
    const started = performance.now();
    const body = {
      contents: [{ parts: [{ text: 'أجب بكلمة واحدة فقط: تم' }] }],
      generationConfig: { maxOutputTokens: 10, temperature: 0 }
    };
    const res = await fetch(`${API_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const latency = Math.round(performance.now() - started);

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        msg = err.error?.message || msg;
      } catch (_) { /* تجاهل */ }
      return { ok: false, latency, message: msg };
    }
    return { ok: true, latency, message: 'الاتصال ناجح والمفتاح صالح' };
  }

  return { MODELS, isConfigured, generate, generateJSON, testConnection };
})();

/* ============ أدوات مساعدة عامة ============ */
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${escapeHtml(message)}`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 400); }, 4200);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setLoading(btn, loading, loadingText = 'جارٍ المعالجة...') {
  if (loading) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${loadingText}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
  }
}

/** تحويل Markdown بسيط إلى HTML آمن للعرض */
function mdToHtml(md) {
  let html = escapeHtml(md);
  html = html.replace(/^####\s*(.+)$/gm, '<h4>$1</h4>')
             .replace(/^###\s*(.+)$/gm, '<h4>$1</h4>')
             .replace(/^##\s*(.+)$/gm, '<h4>$1</h4>')
             .replace(/^#\s*(.+)$/gm, '<h4>$1</h4>')
             .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
             .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
             .replace(/^\s*(\d+)\.\s+(.+)$/gm, '<li>$2</li>')
             .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
             .replace(/<\/ul>\s*<ul>/g, '')
             .replace(/\n{2,}/g, '<br><br>')
             .replace(/\n/g, '<br>');
  return html;
}

function updateAiStatusChip() {
  const chip = document.getElementById('ai-status-chip');
  const txt = document.getElementById('ai-status-text');
  if (AI.isConfigured()) {
    chip.className = 'ai-status-chip on';
    txt.textContent = `الذكاء الاصطناعي: ${AppState.settings.model}`;
  } else {
    chip.className = 'ai-status-chip off';
    txt.textContent = 'الذكاء الاصطناعي: غير مفعّل';
  }
}
