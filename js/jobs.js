/* =====================================================================
 * jobs.js — البحث الفردي + استخراج الإيميلات المُتحقَّق منها فقط + رسالة واحدة
 * سياسة صارمة: لا تخمين إيميلات إطلاقاً — Hunter.io فقط.
 * ===================================================================== */
const JobsModule = (() => {

  /* ---------- بحث الوظائف (عبر المحرك متعدد المصادر) ---------- */
  async function runJobSearch() {
    const query = document.getElementById('job-query').value.trim();
    const city = document.getElementById('job-city').value;
    const container = document.getElementById('jobs-results');

    if (!query && !AppState.cvProfile) return toast('أدخل المسمى الوظيفي أو فعّل نسخة CV محفوظة', 'error');

    const hasKeys = AppState.settings.serperKey || AppState.settings.rapidApiKey;
    if (!hasKeys) {
      SearchModule.renderFallback(container, query, city);
      return;
    }

    try {
      const { jobs, usedQueries } = await SearchModule.searchAll(query, city);
      AppState.jobs = jobs;
      if (usedQueries?.length && usedQueries[0] !== query) {
        container.innerHTML = `<div class="note-box small" style="margin-top:14px"><i class="fa-solid fa-brain"></i><span>وسّع الذكاء الاصطناعي البحث بناءً على الـ CV: <strong class="ltr">${usedQueries.map(escapeHtml).join(' · ')}</strong></span></div>`;
      } else {
        container.innerHTML = '';
      }
      const listDiv = document.createElement('div');
      container.appendChild(listDiv);
      BulkModule.renderJobCards(listDiv, jobs, { showMatch: true });
      if (jobs.length) toast(`تم العثور على ${jobs.length} نتيجة في مصر`, 'success');
    } catch (err) {
      toast(err.message, 'error');
      SearchModule.renderFallback(container, query, city);
    }
  }

  /* ---------- الإيميلات المُتحقَّق منها فقط (Hunter.io) ---------- */

  /**
   * البحث عن نطاق الشركة أولاً، ثم إيميلاتها المؤكدة.
   * يُعيد: { emails, domain, companyName } — بدون أي تخمين.
   */
  async function findVerifiedContacts(company, domain = '') {
    const key = AppState.settings.hunterKey;
    if (!key) throw new Error('مفتاح Hunter.io غير مُعدّ — أضِفه من إدارة الـ APIs (25 بحثاً مجانياً شهرياً)');

    let targetDomain = domain.trim();
    let companyName = company;

    // إن لم يُدخل نطاق: ابحث عن نطاق الشركة الحقيقي عبر Hunter
    if (!targetDomain) {
      const res = await fetch(`https://api.hunter.io/v2/domain-search?company=${encodeURIComponent(company)}&limit=1&api_key=${encodeURIComponent(key)}`);
      if (res.status === 401) throw new Error('مفتاح Hunter.io غير صالح');
      if (!res.ok) throw new Error(`Hunter: HTTP ${res.status}`);
      const data = await res.json();
      targetDomain = data.data?.domain || '';
      companyName = data.data?.organization || company;
      if (!targetDomain) {
        return { emails: [], domain: '', companyName, notFound: true };
      }
    }

    // جلب الإيميلات الموجودة فعلياً على النطاق
    const res2 = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(targetDomain)}&limit=15&api_key=${encodeURIComponent(key)}`);
    if (!res2.ok) throw new Error(`Hunter: HTTP ${res2.status}`);
    const data2 = await res2.json();

    // فقط الإيميلات التي أكد Hunter وجودها (لم تفشل في التحقق / ثقة معقولة)
    const emails = (data2.data?.emails || [])
      .filter(e => e.value && (e.confidence ?? 0) >= 50)
      .map(e => ({
        name: [e.first_name, e.last_name].filter(Boolean).join(' ') || '',
        position: e.position || '',
        email: e.value,
        confidence: e.confidence,
        verified: e.verification?.status !== 'invalid'
      }))
      .filter(e => e.verified);

    return { emails, domain: targetDomain, companyName: data2.data?.organization || companyName };
  }

  /* ---------- عرض نتائج البحث الفردي عن الإيميلات ---------- */
  function renderContacts(container, result, company) {
    const liQ = encodeURIComponent(`"${company}" (HR OR Recruiter OR "Talent Acquisition")`);
    const liPeopleUrl = `https://www.linkedin.com/search/results/people/?keywords=${liQ}`;
    const liCompanyUrl = `https://www.linkedin.com/company/${encodeURIComponent(company.trim().toLowerCase().replace(/\s+/g, '-'))}/people/`;

    let html = '';
    if (result.emails.length) {
      html += `<h4 style="margin-top:16px"><i class="fa-solid fa-circle-check" style="color:var(--success)"></i> إيميلات مُتحقَّق منها على <span class="ltr" style="font-family:monospace">${escapeHtml(result.domain)}</span></h4>`;
      html += result.emails.map(c => `
        <div class="contact-card">
          <div>
            <strong>${escapeHtml(c.name || c.email.split('@')[0])}</strong>
            ${c.position ? `<span style="color:var(--text-muted);font-size:.78rem"> — ${escapeHtml(c.position)}</span>` : ''}
            <span class="status-badge accepted" style="margin-right:6px">ثقة ${c.confidence}%</span>
          </div>
          <div>
            <span class="email">${escapeHtml(c.email)}</span>
            <button class="icon-btn btn-copy" data-copy="${escapeHtml(c.email)}" title="نسخ"><i class="fa-solid fa-copy"></i></button>
          </div>
        </div>`).join('');
    } else if (result.notFound) {
      html += `<div class="note-box" style="margin-top:14px;background:#fef3c7;border-color:#fde68a;color:#92400e">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>لم يعثر Hunter على نطاق مؤكد لهذه الشركة، ولا نعرض أي إيميل مُخمَّن. التواصل البديل الآمن عبر LinkedIn:</span></div>`;
    } else {
      html += `<div class="note-box" style="margin-top:14px;background:#fef3c7;border-color:#fde68a;color:#92400e">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>لا توجد إيميلات مُتحقَّق منها على نطاق <span class="ltr" style="font-family:monospace">${escapeHtml(result.domain)}</span> حالياً — لا نعرض أنماطاً متوقعة. جرّب LinkedIn:</span></div>`;
    }

    html += `<h4 style="margin-top:16px"><i class="fa-brands fa-linkedin"></i> التواصل المباشر عبر LinkedIn</h4>
      <div class="platform-links">
        <a class="platform-link linkedin" href="${liPeopleUrl}" target="_blank" rel="noopener"><i class="fa-brands fa-linkedin"></i> بحث عن HR / Recruiters في ${escapeHtml(company)}</a>
        <a class="platform-link linkedin" href="${liCompanyUrl}" target="_blank" rel="noopener" style="background:#0e7490"><i class="fa-solid fa-users"></i> صفحة موظفي الشركة</a>
      </div>`;

    container.innerHTML = html;
    container.querySelectorAll('.btn-copy').forEach(b =>
      b.addEventListener('click', () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('تم نسخ الإيميل', 'success'))));
  }

  /* ---------- مولّد الرسالة الواحدة ---------- */
  async function generateMessage({ company, role, type, cvContext }) {
    const isLinkedIn = type === 'linkedin';
    const profile = AppState.cvProfile;
    const profilePart = profile
      ? `\nملف المتقدم المهني: مهاراته (${(profile.skills || []).slice(0, 12).join('، ')}) — مجالات عمله السابقة (${(profile.industries || []).join('، ')})`
      : '';
    const prompt = `أنت خبير في كتابة رسائل التواصل المهني (Outreach). اكتب ${isLinkedIn ? 'رسالة LinkedIn قصيرة (بحد أقصى 90 كلمة)' : 'إيميل توظيف احترافي (Cold Email)'} موجّهة لمسؤول توظيف في شركة "${company}" بخصوص وظيفة "${role}" في السوق المصري.
${profilePart}
معلومات عن المتقدم (من سيرته الذاتية):
"""
${(cvContext || 'خبرة مهنية في المجال').slice(0, 2500)}
"""

القواعد:
1. الرسالة بالعربية الفصحى المهنية مع تحية رسمية.
2. ابدأ بجملة افتتاحية مخصصة للشركة (ليست عامة).
3. اربط أبرز 2-3 إنجازات/مهارات من السيرة بما تحتاجه الوظيفة — لا تدّعِ خبرة غير موجودة.
4. ${isLinkedIn ? 'اختتم بطلب تواصل لطيف ومباشر. بدون عنوان بريدي.' : 'اختتم بدعوة واضحة لإجراء مقابلة + خانة توقيع. أضف سطر "العنوان:" جذاباً في البداية.'}
5. لا تستخدم عبارات مبتذلة.
أعد نص الرسالة فقط بدون شرح.`;
    return await AI.generate(prompt, { maxTokens: 2048, temperature: 0.7 });
  }

  /* ---------- ربط الواجهة ---------- */
  function init() {
    document.getElementById('btn-search-jobs').addEventListener('click', async e => {
      const btn = e.currentTarget;
      setLoading(btn, true, 'جارٍ البحث في مصر...');
      try { await runJobSearch(); } finally { setLoading(btn, false); }
    });

    document.getElementById('btn-find-contacts').addEventListener('click', async e => {
      const btn = e.currentTarget;
      const company = document.getElementById('hr-company').value.trim();
      const domain = document.getElementById('hr-domain').value.trim();
      const container = document.getElementById('contacts-results');
      if (!company) return toast('أدخل اسم الشركة', 'error');

      setLoading(btn, true, 'جارٍ التحقق...');
      try {
        const result = await findVerifiedContacts(company, domain);
        renderContacts(container, result, company);
        if (result.emails.length) toast(`تم العثور على ${result.emails.length} إيميل مُتحقَّق منه`, 'success');
      } catch (err) {
        toast(err.message, 'error');
        renderContacts(container, { emails: [], notFound: true }, company);
      } finally { setLoading(btn, false); }
    });

    document.getElementById('btn-generate-msg').addEventListener('click', async e => {
      const btn = e.currentTarget;
      const company = document.getElementById('msg-company').value.trim();
      const role = document.getElementById('msg-role').value.trim();
      const type = document.getElementById('msg-type').value;
      const cvContext = document.getElementById('msg-cv-context').value.trim() || AppState.cvRawText;
      if (!company || !role) return toast('أدخل الشركة والوظيفة', 'error');
      if (!AI.isConfigured()) return toast('أعدّ مفتاح Gemini من إدارة الـ APIs أولاً', 'error');

      setLoading(btn, true, 'جارٍ توليد الرسالة...');
      try {
        const msg = await generateMessage({ company, role, type, cvContext });
        const box = document.getElementById('msg-result');
        box.innerHTML = `
          ${mdToHtml(msg)}
          <div class="btn-row" style="margin-top:14px">
            <button class="btn btn-outline btn-sm" id="btn-copy-msg"><i class="fa-solid fa-copy"></i> نسخ</button>
            <button class="btn btn-outline btn-sm" id="btn-save-msg"><i class="fa-solid fa-bookmark"></i> حفظ في المكتبة</button>
          </div>`;
        box.classList.remove('hidden');
        document.getElementById('btn-copy-msg').addEventListener('click', () =>
          navigator.clipboard.writeText(msg).then(() => toast('تم النسخ', 'success')));
        document.getElementById('btn-save-msg').addEventListener('click', async () => {
          try {
            await TemplatesModule.create({
              title: `${type === 'email' ? 'إيميل' : 'LinkedIn'} — ${company} — ${role}`,
              type, content: msg
            });
            toast('تم الحفظ في مكتبة النماذج', 'success');
          } catch (err) { toast(err.message, 'error'); }
        });
      } catch (err) { toast(err.message, 'error'); }
      finally { setLoading(btn, false); }
    });
  }

  return { init, findVerifiedContacts, generateMessage };
})();
