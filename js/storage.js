/* =====================================================================
 * storage.js — التخزين المشفّر الآمن للمفاتيح والإعدادات
 * AES-GCM 256 عبر Web Crypto API مع مفتاح مشتق من بصمة الجهاز
 * عبر PBKDF2 (120,000 تكرار) — لا تُرسل المفاتيح لأي خادم إطلاقاً.
 * ===================================================================== */
const SecureStore = (() => {
  const SALT_KEY = 'acc_salt_v1';
  const DATA_KEY = 'acc_secure_v2';
  const LEGACY_KEY = 'acc_secure_v1';

  function getDeviceMaterial() {
    let material = localStorage.getItem(SALT_KEY);
    if (!material) {
      const arr = new Uint8Array(32);
      crypto.getRandomValues(arr);
      material = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(SALT_KEY, material);
    }
    return material;
  }

  async function deriveKey(salt) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey(
      'raw', enc.encode(getDeviceMaterial() + '|' + navigator.userAgent), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  const bufToB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const b64ToBuf = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  async function encryptObj(obj) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(salt);
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return JSON.stringify({ s: bufToB64(salt), i: bufToB64(iv), d: bufToB64(cipher) });
  }

  async function decryptObj(payload) {
    try {
      const { s, i, d } = JSON.parse(payload);
      const key = await deriveKey(b64ToBuf(s));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(i) }, key, b64ToBuf(d));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (e) {
      console.error('فشل فك التشفير:', e);
      return {};
    }
  }

  return {
    async save(settings) {
      localStorage.setItem(DATA_KEY, await encryptObj(settings));
    },
    async load() {
      // ترحيل تلقائي من النسخة القديمة إن وُجدت
      let settings = {};
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        settings = await decryptObj(legacy);
        localStorage.removeItem(LEGACY_KEY);
      }
      const raw = localStorage.getItem(DATA_KEY);
      if (raw) settings = Object.assign(settings, await decryptObj(raw));
      return settings;
    },
    clear() {
      localStorage.removeItem(DATA_KEY);
      localStorage.removeItem(LEGACY_KEY);
    },
    hasData() { return !!(localStorage.getItem(DATA_KEY) || localStorage.getItem(LEGACY_KEY)); }
  };
})();

/* ============ حالة التطبيق المشتركة ============ */
const DEFAULT_SETTINGS = {
  // Gemini
  geminiKey: '',
  model: 'gemini-2.5-flash',
  // بحث الوظائف
  rapidApiKey: '',
  // Serper Web Search (بديل Google Custom Search بالكامل)
  serperKey: '',
  // الإيميلات المُتحقَّق منها
  hunterKey: '',
  // الإرسال المباشر (EmailJS)
  emailjsPublicKey: '',
  emailjsServiceId: '',
  emailjsTemplateId: '',
  senderName: ''
};

const AppState = {
  settings: { ...DEFAULT_SETTINGS },
  // الـ CV النشط
  activeCvId: null,
  activeCvName: '',
  cvRawText: '',
  cvProfile: null,          // الملف الشخصي المستخرج بالـ AI
  savedCvs: [],
  // معالج الـ CV
  cvOptimized: '',
  cvAnalysis: null,
  // البحث والحملة
  jobs: [],
  campaignJobs: [],         // الوظائف/الشركات المختارة للحملة
  bulkMessages: [],         // الرسائل المولّدة {id, company, jobTitle, email, subject, body, status}
  // التتبع والنماذج
  applications: [],
  templates: [],
  boardMode: 'kanban',
  templateFilter: ''
};

async function loadSettings() {
  const loaded = await SecureStore.load();
  AppState.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
}

async function saveSettings() {
  await SecureStore.save(AppState.settings);
}
