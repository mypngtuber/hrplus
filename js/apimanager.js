/* =====================================================================
 * apimanager.js — إدارة واختبار جميع الـ APIs من واجهة واحدة
 * كل خدمة: حقول مفاتيح + زر حفظ + زر اختبار + نتيجة واضحة
 * ===================================================================== */
const ApiManager = (() => {

  /* تعريف كل خدمة: الحقول + اختبارها */
  const SERVICES = [
    {
      id: 'gemini',
      name: 'Google Gemini — الذكاء الاصطناعي',
      icon: 'fa-brain',
      required: true,
      desc: 'المحرك الأساسي لكل ميزات الـ AI (تحسين CV، توليد الرسائل، تحليل الفجوة). احصل على مفتاح مجاني من Google AI Studio.',
      hint: 'ai.google.dev',
      hintUrl: 'https://aistudio.google.com/apikey',
      fields: [
        { key: 'geminiKey', label: 'API Key', placeholder: 'AIza...', password: true },
        { key: 'model', label: 'الموديل', type: 'select', options: () => AI.MODELS }
      ],
      async test(s) {
        if (!s.geminiKey) throw new Error('أدخل المفتاح أولاً');
        return await AI.testConnection(s.model, s.geminiKey);
      }
    },
    {
      id: 'jsearch',
      name: 'JSearch (RapidAPI) — بحث الوظائف',
      icon: 'fa-briefcase',
      required: false,
      desc: 'يجمع أحدث الوظائف من LinkedIn وIndeed وGlassdoor في مصر. خطة مجانية متاحة على RapidAPI.',
      hint: 'rapidapi.com → JSearch',
      hintUrl: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
      fields: [
        { key: 'rapidApiKey', label: 'RapidAPI Key', placeholder: 'اختياري', password: true }
      ],
      async test(s) {
        if (!s.rapidApiKey) throw new Error('أدخل المفتاح أولاً');
        const t0 = performance.now();
        const res = await fetch('https://jsearch.p.rapidapi.com/search?query=accountant%20in%20Egypt&page=1&num_pages=1', {
          headers: { 'x-rapidapi-host': 'jsearch.p.rapidapi.com', 'x-rapidapi-key': s.rapidApiKey }
        });
        const latency = Math.round(performance.now() - t0);
        if (!res.ok) return { ok: false, latency, message: `HTTP ${res.status} — تحقق من المفتاح والاشتراك في JSearch` };
        return { ok: true, latency, message: 'المفتاح يعمل والبحث متاح' };
      }
    },
    {
      id: 'google',
      name: 'Google Custom Search — LinkedIn + Wuzzuf + Google',
      icon: 'fa-google',
      required: false,
      desc: 'يبحث داخل LinkedIn وWuzzuf وGoogle عن وظائف وشركات في مصر. يحتاج API Key + Search Engine ID (CX) — كلاهما مجاني.',
      hint: 'programmablesearchengine.google.com',
      hintUrl: 'https://programmablesearchengine.google.com/controlpanel/create',
      fields: [
        { key: 'googleApiKey', label: 'Google API Key', placeholder: 'اختياري', password: true },
        { key: 'googleCx', label: 'Search Engine ID (CX)', placeholder: 'اختياري', password: false }
      ],
      async test(s) {
        if (!s.googleApiKey || !s.googleCx) throw new Error('أدخل API Key و CX معاً');
        const t0 = performance.now();
        const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(s.googleApiKey)}&cx=${encodeURIComponent(s.googleCx)}&q=test&num=1`);
        const latency = Math.round(performance.now() - t0);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { ok: false, latency, message: err.error?.message || `HTTP ${res.status}` };
        }
        return { ok: true, latency, message: 'محرك البحث يعمل بنجاح' };
      }
    },
    {
      id: 'hunter',
      name: 'Hunter.io — الإيميلات المُتحقَّق منها',
      icon: 'fa-at',
      required: false,
      desc: 'المصدر الوحيد للإيميلات: يعرض فقط الإيميلات الحقيقية الموجودة فعلياً على نطاقات الشركات (25 بحثاً مجانياً شهرياً).',
      hint: 'hunter.io/api_keys',
      hintUrl: 'https://hunter.io/api-keys',
      fields: [
        { key: 'hunterKey', label: 'Hunter API Key', placeholder: 'اختياري', password: true }
      ],
      async test(s) {
        if (!s.hunterKey) throw new Error('أدخل المفتاح أولاً');
        const t0 = performance.now();
        const res = await fetch(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(s.hunterKey)}`);
        const latency = Math.round(performance.now() - t0);
        if (!res.ok) return { ok: false, latency, message: `HTTP ${res.status} — مفتاح غير صالح` };
        const data = await res.json();
        const remaining = data.data?.requests?.searches?.available ?? '؟';
        return { ok: true, latency, message: `المفتاح صالح — عمليات البحث المتبقية هذا الشهر: ${remaining}` };
      }
    },
    {
      id: 'emailjs',
      name: 'EmailJS — الإرسال المباشر من التطبيق',
      icon: 'fa-paper-plane',
      required: false,
      desc: 'يرسل الإيميلات مباشرة من المتصفح عبر حساب بريدك (Gmail/Outlook) — 200 رسالة مجاناً شهرياً. أنشئ حساباً ثم Service ثم Template.',
      hint: 'dashboard.emailjs.com',
      hintUrl: 'https://dashboard.emailjs.com/sign-up',
      fields: [
        { key: 'emailjsPublicKey', label: 'Public Key', placeholder: 'اختياري', password: true },
        { key: 'emailjsServiceId', label: 'Service ID', placeholder: 'service_...', password: false },
        { key: 'emailjsTemplateId', label: 'Template ID', placeholder: 'template_...', password: false },
        { key: 'senderName', label: 'اسم المُرسل (اسمك)', placeholder: 'مثال: أحمد محمد', password: false }
      ],
      note: 'في قالب EmailJS استخدم المتغيرات: {{to_email}} و{{subject}} و{{message}} و{{from_name}}',
      async test(s) {
        if (!s.emailjsPublicKey || !s.emailjsServiceId || !s.emailjsTemplateId) {
          throw new Error('أدخل Public Key و Service ID و Template ID');
        }
        if (typeof emailjs === 'undefined') throw new Error('مكتبة EmailJS لم تُحمَّل — حدّث الصفحة');
        const t0 = performance.now();
        // اختبار خفيف: إرسال لعنوان وهمي يكشف صحة الإعدادات دون إزعاج أحد
        try {
          emailjs.init({ publicKey: s.emailjsPublicKey });
          await emailjs.send(s.emailjsServiceId, s.emailjsTemplateId, {
            to_email: 'test@example.com', subject: 'اختبار اتصال',
            message: 'رسالة اختبار من مساعد التوظيف الذكي', from_name: s.senderName || 'اختبار'
          });
        } catch (e) {
          const latency = Math.round(performance.now() - t0);
          const txt = (e?.text || e?.message || '').toLowerCase();
          // رفض الخادم لعنوان المستلم يعني أن الإعدادات نفسها صحيحة
          if (txt.includes('recipient') || txt.includes('address') || txt.includes('invalid to')) {
            return { ok: true, latency, message: 'الإعدادات صحيحة (رفض الخادم العنوان التجريبي فقط)' };
          }
          return { ok: false, latency, message: e?.text || e?.message || 'فشل الاختبار — تحقق من القيم الثلاثة' };
        }
        const latency = Math.round(performance.now() - t0);
        return { ok: true, latency, message: 'الإعدادات تعمل — أُرسلت رسالة اختبار' };
      }
    }
  ];

  /* ---------- العرض ---------- */
  function render() {
    const container = document.getElementById('api-cards');
    container.innerHTML = SERVICES.map(svc => {
      const configured = svc.fields.some(f => AppState.settings[f.key]);
      const badge = svc.required && !configured
        ? '<span class="api-badge required">مطلوب</span>'
        : configured
          ? '<span class="api-badge ok"><i class="fa-solid fa-check"></i> مُعدّ</span>'
          : '<span class="api-badge missing">اختياري — غير مُعدّ</span>';

      const fieldsHtml = svc.fields.map(f => {
        const val = AppState.settings[f.key] || '';
        if (f.type === 'select') {
          const opts = f.options().map(o => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('');
          return `<div class="form-group"><label>${f.label}</label><select class="input ltr" data-api="${svc.id}" data-key="${f.key}">${opts}</select></div>`;
        }
        return `<div class="form-group" style="flex:1;min-width:200px">
          <label>${f.label}</label>
          <input type="${f.password ? 'password' : 'text'}" class="input ltr" data-api="${svc.id}" data-key="${f.key}"
                 value="${escapeHtml(val)}" placeholder="${f.placeholder || ''}" autocomplete="off">
        </div>`;
      }).join('');

      return `<div class="api-card ${configured ? 'configured' : ''}" id="api-card-${svc.id}">
        <div class="api-card-header">
          <h3><i class="fa-solid ${svc.icon}"></i> ${svc.name}</h3>
          ${badge}
        </div>
        <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px;line-height:1.7">${svc.desc}</p>
        <div class="api-fields">${fieldsHtml}</div>
        ${svc.note ? `<p class="api-hint"><i class="fa-solid fa-circle-info"></i> ${svc.note}</p>` : ''}
        <div class="api-actions">
          <button class="btn btn-success btn-sm btn-api-save" data-api="${svc.id}"><i class="fa-solid fa-floppy-disk"></i> حفظ</button>
          <button class="btn btn-outline btn-sm btn-api-test" data-api="${svc.id}"><i class="fa-solid fa-plug-circle-bolt"></i> اختبار API</button>
          <span class="api-test-result hidden" id="api-result-${svc.id}"></span>
        </div>
        <p class="api-hint"><i class="fa-solid fa-link"></i> احصل على المفتاح من: <a href="${svc.hintUrl}" target="_blank" rel="noopener">${svc.hint}</a> — يُحفظ مشفراً (AES-256) في متصفحك فقط.</p>
      </div>`;
    }).join('');

    bind();
  }

  function bind() {
    document.querySelectorAll('.btn-api-save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const svc = SERVICES.find(s => s.id === btn.dataset.api);
        collectFields(svc);
        try {
          await saveSettings();
          updateAiStatusChip();
          render();
          toast(`تم حفظ إعدادات ${svc.name} مشفّرة`, 'success');
        } catch (err) { toast('فشل الحفظ: ' + err.message, 'error'); }
      });
    });

    document.querySelectorAll('.btn-api-test').forEach(btn => {
      btn.addEventListener('click', async () => {
        const svc = SERVICES.find(s => s.id === btn.dataset.api);
        const resultBox = document.getElementById(`api-result-${svc.id}`);
        collectFields(svc); // اختبر القيم المكتوبة حالياً حتى قبل الحفظ
        resultBox.className = 'api-test-result loading';
        resultBox.innerHTML = '<span class="spinner" style="border-color:#93c5fd;border-top-color:#1e40af"></span> جارٍ الاختبار...';
        try {
          const r = await svc.test(AppState.settings);
          if (r.ok) {
            resultBox.className = 'api-test-result ok';
            resultBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${escapeHtml(r.message)} — ${r.latency}ms`;
          } else {
            resultBox.className = 'api-test-result err';
            resultBox.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${escapeHtml(r.message)} (${r.latency}ms)`;
          }
        } catch (err) {
          resultBox.className = 'api-test-result err';
          resultBox.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${escapeHtml(err.message)}`;
        }
      });
    });
  }

  function collectFields(svc) {
    document.querySelectorAll(`[data-api="${svc.id}"]`).forEach(input => {
      AppState.settings[input.dataset.key] = input.value.trim();
    });
  }

  function init() {
    render();
    document.getElementById('btn-clear-all-keys').addEventListener('click', async () => {
      if (!confirm('سيتم مسح جميع المفاتيح والإعدادات نهائياً. متابعة؟')) return;
      SecureStore.clear();
      AppState.settings = { ...DEFAULT_SETTINGS };
      updateAiStatusChip();
      render();
      toast('تم مسح جميع المفاتيح', 'success');
    });
  }

  /** هل خدمة معينة مُعدّة؟ */
  function isReady(serviceId) {
    const svc = SERVICES.find(s => s.id === serviceId);
    return svc ? svc.fields.some(f => AppState.settings[f.key]) : false;
  }

  return { init, render, isReady, SERVICES };
})();
