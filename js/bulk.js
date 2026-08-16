/* =====================================================================
 * bulk.js — الحملة الذكية: بحث → إيميلات حقيقية → توليد جماعي مخصص
 *           → مراجعة وتعديل → إرسال (EmailJS) بموافقة المستخدم فقط
 * ===================================================================== */
const BulkModule = (() => {

  /* ============ الخطوة 1: عرض الـ CV في الحملة ============ */
  function renderCampaignCvSlot() {
    const slot = document.getElementById('campaign-cv-slot');
    if (AppState.activeCvId && AppState.cvRawText) {
      const p = AppState.cvProfile;
      slot.innerHTML = `
        <div class="saved-cv-item active">
          <i class="fa-solid fa-file-circle-check fa-xl" style="color:var(--success)"></i>
          <div class="cv-meta">
            <strong>${escapeHtml(AppState.activeCvName)}</strong>
            <span>${p ? `المهارات: ${(p.skills || []).slice(0, 8).join('، ')}` : `${AppState.cvRawText.length} حرف`}</span>
          </div>
          <span class="active-badge"><i class="fa-solid fa-check"></i> نشط — سيُستخدم في البحث والرسائل</span>
          <button class="btn btn-outline btn-sm" data-goto-cv><i class="fa-solid fa-rotate"></i> تغيير</button>
        </div>`;
    } else {
      slot.innerHTML = `
        <div class="note-box"><i class="fa-solid fa-circle-info"></i>
          <span>لم يُفعَّل أي CV بعد. رفع الـ CV <strong>اختياري</strong> لكنه يحسّن مطابقة الوظائف وتخصيص الرسائل بشكل كبير.</span>
          <button class="btn btn-primary btn-sm" data-goto-cv><i class="fa-solid fa-cloud-arrow-up"></i> رفع / اختيار CV</button>
        </div>`;
    }
    slot.querySelectorAll('[data-goto-cv]').forEach(b =>
      b.addEventListener('click', () => document.querySelector('.nav-btn[data-view="cv"]')?.click()));
  }

  /* ============ الخطوة 2: بحث الحملة ============ */
  async function campaignSearch() {
    const query = document.getElementById('campaign-query').value.trim();
    const city = document.getElementById('campaign-city').value;
    const container = document.getElementById('campaign-jobs');

    const hasKeys = AppState.settings.rapidApiKey || (AppState.settings.googleApiKey && AppState.settings.googleCx);
    if (!hasKeys) {
      SearchModule.renderFallback(container, query, city);
      return;
    }

    container.innerHTML = '<div class="note-box" style="margin-top:14px"><span class="spinner" style="border-color:#93c5fd;border-top-color:#1e40af"></span> جارٍ البحث في جميع المصادر داخل مصر...</div>';
    const { jobs, usedQueries } = await SearchModule.searchAll(query, city);

    AppState.campaignJobs = jobs.map(j => ({ ...j, contactEmail: '', contactName: '', industry: '', expMatch: null }));
    let html = '';
    if (usedQueries?.length && usedQueries[0] !== query) {
      html += `<div class="note-box small" style="margin-top:14px"><i class="fa-solid fa-brain"></i><span>استعلامات البحث الموسّعة من الـ CV: <strong class="ltr">${usedQueries.map(escapeHtml).join(' · ')}</strong></span></div>`;
    }
    container.innerHTML = html;
    const listDiv = document.createElement('div');
    container.appendChild(listDiv);
    SearchModule.renderJobs(listDiv, AppState.campaignJobs, { selectable: true });
    if (jobs.length) toast(`تم العثور على ${jobs.length} نتيجة — حدّد الشركات ثم انتقل للخطوة 3`, 'success');
  }

  function getSelectedJobs() {
    const checks = document.querySelectorAll('#campaign-jobs .job-check');
    const selected = [];
    checks.forEach(c => { if (c.checked) selected.push(AppState.campaignJobs[+c.dataset.idx]); });
    return selected;
  }

  /* ============ الخطوة 3: استخراج الإيميلات الحقيقية ============ */
  async function findAllEmails() {
    const container = document.getElementById('campaign-contacts');
    const selected = getSelectedJobs();
    if (!selected.length) return toast('حدّد شركة واحدة على الأقل من نتائج البحث', 'error');
    if (!AppState.settings.hunterKey) {
      container.innerHTML = `<div class="note-box" style="margin-top:14px;background:#fef3c7;border-color:#fde68a;color:#92400e">
        <i class="fa-solid fa-key"></i><span>استخراج الإيميلات يتطلب مفتاح <strong>Hunter.io</strong> (مجاني) — أضِفه من إدارة الـ APIs. نلتزم بعرض الإيميلات الحقيقية المُتحقَّق منها فقط ولا نلجأ للتخمين.</span></div>`;
      return;
    }

    // تجميع الشركات الفريدة
    const companies = [...new Map(selected.filter(j => j.company && j.company !== '—').map(j => [j.company, j])).values()];
    if (!companies.length) return toast('نتائج البحث المحددة لا تحتوي أسماء شركات واضحة', 'error');

    container.innerHTML = `<div class="progress-text" id="email-progress-text">جارٍ البحث عن النطاقات والإيميلات المؤكدة...</div>
      <div class="progress-bar"><div class="progress-bar-fill" id="email-progress-fill" style="width:0%"></div></div>
      <div id="email-results-list"></div>`;
    const fill = document.getElementById('email-progress-fill');
    const ptext = document.getElementById('email-progress-text');
    const listEl = document.getElementById('email-results-list');

    let found = 0;
    for (let i = 0; i < companies.length; i++) {
      const job = companies[i];
      ptext.textContent = `(${i + 1}/${companies.length}) ${job.company}`;
      fill.style.width = `${((i + 1) / companies.length) * 100}%`;
      try {
        const result = await JobsModule.findVerifiedContacts(job.company, job.website ? new URL(job.website).hostname.replace(/^www\./, '') : '');
        // أولوية: إيميل بمنصب HR/توظيف، ثم أعلى ثقة
        const hrEmail = result.emails.find(e => /hr|recruit|talent|hiring|people|career/i.test(e.position || '')) || result.emails[0];
        if (hrEmail) {
          // وزّع الإيميل على كل وظائف هذه الشركة في الحملة
          AppState.campaignJobs.forEach(j => {
            if (j.company === job.company) { j.contactEmail = hrEmail.email; j.contactName = hrEmail.name; j.domain = result.domain; }
          });
          found++;
          listEl.innerHTML += `<div class="contact-card">
            <div><strong>${escapeHtml(job.company)}</strong>
              ${hrEmail.position ? `<span style="color:var(--text-muted);font-size:.78rem"> — ${escapeHtml(hrEmail.position)}</span>` : ''}</div>
            <div><span class="email">${escapeHtml(hrEmail.email)}</span>
              <span class="status-badge accepted"><i class="fa-solid fa-shield-halved"></i> مُتحقَّق ${hrEmail.confidence}%</span></div>
          </div>`;
        } else {
          listEl.innerHTML += `<div class="contact-card" style="opacity:.7">
            <div><strong>${escapeHtml(job.company)}</strong></div>
            <span style="font-size:.78rem;color:var(--warning)"><i class="fa-solid fa-triangle-exclamation"></i> لا يوجد إيميل مؤكد — لن نخمّن</span>
          </div>`;
        }
      } catch (err) {
        listEl.innerHTML += `<div class="contact-card" style="opacity:.7">
          <div><strong>${escapeHtml(job.company)}</strong></div>
          <span style="font-size:.78rem;color:var(--danger)">${escapeHtml(err.message)}</span>
        </div>`;
      }
      await new Promise(r => setTimeout(r, 400)); // احترام حدود الـ API
    }
    ptext.textContent = `اكتمل: إيميلات مؤكدة لـ ${found} من ${companies.length} شركة`;
    if (found) toast(`تم العثور على ${found} إيميل مُتحقَّق منه`, 'success');
  }

  /* ============ الخطوة 4: التوليد الجماعي المخصص ============ */
  async function generateBulk() {
    const withEmail = AppState.campaignJobs.filter(j => j.contactEmail);
    if (!withEmail.length) return toast('لا توجد شركات بإيميلات مؤكدة — نفّذ الخطوتين 2 و 3 أولاً', 'error');
    if (!AI.isConfigured()) return toast('أعدّ مفتاح Gemini من إدارة الـ APIs أولاً', 'error');

    const progress = document.getElementById('bulk-progress');
    progress.classList.remove('hidden');
    progress.innerHTML = `<div class="progress-text" id="bulk-progress-text"></div>
      <div class="progress-bar"><div class="progress-bar-fill" id="bulk-progress-fill" style="width:0%"></div></div>`;
    const fill = document.getElementById('bulk-progress-fill');
    const ptext = document.getElementById('bulk-progress-text');

    AppState.bulkMessages = [];
    const profile = AppState.cvProfile;
    const cvText = AppState.cvRawText.slice(0, 3500);

    for (let i = 0; i < withEmail.length; i++) {
      const job = withEmail[i];
      ptext.textContent = `(${i + 1}/${withEmail.length}) توليد رسالة لـ ${job.company}...`;
      fill.style.width = `${((i + 1) / withEmail.length) * 100}%`;
      try {
        const msg = await generateOneMessage(job, profile, cvText);
        AppState.bulkMessages.push({
          id: `msg-${Date.now()}-${i}`,
          company: job.company,
          jobTitle: job.title,
          jobUrl: job.url,
          email: job.contactEmail,
          contactName: job.contactName,
          industry: msg.industry,
          expMatch: msg.exp_match,
          subject: msg.subject,
          body: msg.body,
          status: 'draft'
        });
      } catch (err) {
        AppState.bulkMessages.push({
          id: `msg-${Date.now()}-${i}`,
          company: job.company, jobTitle: job.title, jobUrl: job.url,
          email: job.contactEmail, contactName: job.contactName,
          industry: '', expMatch: null,
          subject: '', body: `تعذّر التوليد: ${err.message}`,
          status: 'failed'
        });
      }
      renderBulkMessages();
      await new Promise(r => setTimeout(r, 800)); // احترام حدود Gemini
    }
    ptext.textContent = `اكتمل التوليد: ${AppState.bulkMessages.filter(m => m.status !== 'failed').length} رسالة جاهزة للمراجعة`;
    toast('اكتمل التوليد — راجع وعدّل الرسائل ثم اعتمدها', 'success');
  }

  async function generateOneMessage(job, profile, cvText) {
    const profilePart = profile ? `
الملف المهني للمتقدم:
- المسميات السابقة: ${(profile.job_titles || []).join('، ')}
- المهارات: ${(profile.skills || []).slice(0, 15).join('، ')}
- المجالات التي عمل بها: ${(profile.industries || []).join('، ')}
- المؤهلات: ${(profile.education || []).join('، ')}
- سنوات الخبرة التقريبية: ${profile.years_experience || 'غير محددة'}
` : '';

    const prompt = `أنت خبير توظيف تكتب رسائل تقديم مخصصة للغاية (وليست قوالب عامة).

الشركة: "${job.company}" — الوظيفة: "${job.title}"
وصف الوظيفة: """${(job.description || '').slice(0, 600)}"""

${profilePart}
نص سيرة المتقدم (للتفاصيل):
"""${cvText || 'غير متوفر — اعتمد على الملف المهني أعلاه'}"""

المطلوب بصرامة:
1. حدّد مجال عمل الشركة (industry) من اسمها ووصف الوظيفة.
2. قارنه بمجالات خبرة المتقدم: هل عمل في نفس المجال سابقاً؟
   - إن نعم: ركّز الرسالة على تلك الخبرة المباشرة بالتحديد.
   - إن لا: أبرز المهارات والخبرات **القابلة للنقل** المناسبة للوظيفة فقط — ممنوع منعاً باتاً الادعاء بخبرة غير موجودة في السيرة.
3. رسالة عربية فصحى مهنية: افتتاحية مخصصة للشركة، 2-3 نقاط قوة مرتبطة بالوظيفة، دعوة واضحة لمقابلة، توقيع باسم "${AppState.settings.senderName || 'المتقدم'}".
4. طول الرسالة: 120-180 كلمة.

أعد JSON فقط:
{"industry": "<مجال الشركة بالعربية>", "exp_match": true/false, "subject": "<عنوان الإيميل>", "body": "<نص الرسالة>"}`;

    return await AI.generateJSON(prompt, { maxTokens: 2048, temperature: 0.65 });
  }

  /* ---------- عرض الرسائل للمراجعة والتعديل ---------- */
  function renderBulkMessages() {
    const container = document.getElementById('bulk-messages');
    const STATUS_LABELS = { draft: 'مسودة', approved: 'معتمدة', sent: 'أُرسلت', failed: 'فشلت' };

    container.innerHTML = AppState.bulkMessages.map(m => `
      <div class="bulk-msg-card ${m.status}" data-id="${m.id}">
        <div class="bulk-msg-header">
          <strong>${escapeHtml(m.company)}</strong>
          <span style="font-size:.78rem;color:var(--text-muted)">${escapeHtml(m.jobTitle)}</span>
          ${m.industry ? `<span class="industry-tag"><i class="fa-solid fa-industry"></i> ${escapeHtml(m.industry)}</span>` : ''}
          ${m.expMatch === true ? '<span class="exp-match-tag match"><i class="fa-solid fa-check"></i> خبرة بنفس المجال</span>' : ''}
          ${m.expMatch === false ? '<span class="exp-match-tag transfer"><i class="fa-solid fa-shuffle"></i> مهارات قابلة للنقل</span>' : ''}
          <span class="email-target"><i class="fa-solid fa-at"></i> ${escapeHtml(m.email)}</span>
          <span class="msg-status ${m.status}">${STATUS_LABELS[m.status]}</span>
        </div>
        <div class="bulk-msg-body">
          <div class="subject-line">العنوان: <input type="text" class="input ltr-input msg-subject" data-id="${m.id}" value="${escapeHtml(m.subject)}" style="display:inline-block;width:80%;padding:6px 10px;font-size:.84rem"></div>
          <textarea class="textarea msg-body" data-id="${m.id}" rows="7">${escapeHtml(m.body)}</textarea>
        </div>
        <div class="bulk-msg-actions">
          ${m.status === 'draft' ? `<button class="btn btn-success btn-sm btn-approve" data-id="${m.id}"><i class="fa-solid fa-check"></i> اعتماد</button>` : ''}
          ${m.status === 'approved' ? `<button class="btn btn-outline btn-sm btn-unapprove" data-id="${m.id}"><i class="fa-solid fa-rotate-left"></i> إلغاء الاعتماد</button>` : ''}
          <button class="btn btn-outline btn-sm btn-mailto" data-id="${m.id}"><i class="fa-solid fa-envelope"></i> فتح في البريد</button>
          <button class="btn btn-outline btn-sm btn-save-tpl" data-id="${m.id}"><i class="fa-solid fa-bookmark"></i> حفظ</button>
          ${m.status === 'failed' ? `<button class="btn btn-outline btn-sm btn-retry" data-id="${m.id}"><i class="fa-solid fa-rotate"></i> إعادة التوليد</button>` : ''}
        </div>
      </div>`).join('');

    // ربط الأحداث
    container.querySelectorAll('.msg-subject').forEach(inp =>
      inp.addEventListener('input', () => { findMsg(inp.dataset.id).subject = inp.value; }));
    container.querySelectorAll('.msg-body').forEach(ta =>
      ta.addEventListener('input', () => { findMsg(ta.dataset.id).body = ta.value; }));
    container.querySelectorAll('.btn-approve').forEach(b =>
      b.addEventListener('click', () => setStatus(b.dataset.id, 'approved')));
    container.querySelectorAll('.btn-unapprove').forEach(b =>
      b.addEventListener('click', () => setStatus(b.dataset.id, 'draft')));
    container.querySelectorAll('.btn-mailto').forEach(b =>
      b.addEventListener('click', () => openInMail(findMsg(b.dataset.id))));
    container.querySelectorAll('.btn-save-tpl').forEach(b => b.addEventListener('click', async () => {
      const m = findMsg(b.dataset.id);
      try {
        await TemplatesModule.create({ title: `حملة — ${m.company} — ${m.jobTitle}`, type: 'email', content: `العنوان: ${m.subject}\n\n${m.body}` });
        toast('حُفظت في المكتبة', 'success');
      } catch (err) { toast(err.message, 'error'); }
    }));
    container.querySelectorAll('.btn-retry').forEach(b => b.addEventListener('click', async () => {
      const m = findMsg(b.dataset.id);
      const job = AppState.campaignJobs.find(j => j.company === m.company && j.title === m.jobTitle);
      if (!job || !AI.isConfigured()) return;
      try {
        const msg = await generateOneMessage(job, AppState.cvProfile, AppState.cvRawText.slice(0, 3500));
        Object.assign(m, { industry: msg.industry, expMatch: msg.exp_match, subject: msg.subject, body: msg.body, status: 'draft' });
        renderBulkMessages();
      } catch (err) { toast(err.message, 'error'); }
    }));

    // تحديث تحذير EmailJS
    const ejsReady = AppState.settings.emailjsPublicKey && AppState.settings.emailjsServiceId && AppState.settings.emailjsTemplateId;
    document.getElementById('emailjs-warning').classList.toggle('hidden', !!ejsReady);
  }

  const findMsg = id => AppState.bulkMessages.find(m => m.id === id);
  function setStatus(id, status) {
    const m = findMsg(id);
    if (m) { m.status = status; renderBulkMessages(); }
  }

  function openInMail(m) {
    const url = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
    window.location.href = url;
  }

  /* ============ الخطوة 5: الإرسال بموافقة المستخدم ============ */
  async function sendApproved() {
    const approved = AppState.bulkMessages.filter(m => m.status === 'approved' && m.email);
    if (!approved.length) return toast('لا توجد رسائل معتمدة — راجع الرسائل واضغط "اعتماد" أولاً', 'error');

    const { emailjsPublicKey, emailjsServiceId, emailjsTemplateId, senderName } = AppState.settings;
    const log = document.getElementById('send-log');

    if (!emailjsPublicKey || !emailjsServiceId || !emailjsTemplateId) {
      // بديل: فتح في تطبيق البريد واحدة تلو الأخرى
      if (confirm('EmailJS غير مُعدّ. هل تريد فتح الرسائل المعتمدة في تطبيق بريدك (واحدة تلو الأخرى) بدلاً من ذلك؟')) {
        approved.forEach((m, i) => setTimeout(() => openInMail(m), i * 1200));
        log.innerHTML = `<div class="send-log-item ok"><i class="fa-solid fa-envelope-open"></i> فُتحت ${approved.length} رسالة في تطبيق البريد — أكمل الإرسال يدوياً من هناك.</div>`;
      }
      return;
    }

    if (!confirm(`سيتم إرسال ${approved.length} رسالة الآن عبر بريدك. متابعة؟`)) return;

    emailjs.init({ publicKey: emailjsPublicKey });
    log.innerHTML = '';
    let sentCount = 0;

    for (const m of approved) {
      try {
        await emailjs.send(emailjsServiceId, emailjsTemplateId, {
          to_email: m.email,
          subject: m.subject,
          message: m.body,
          from_name: senderName || 'متقدم لوظيفة',
          to_name: m.contactName || 'مسؤول التوظيف'
        });
        m.status = 'sent';
        sentCount++;
        log.innerHTML += `<div class="send-log-item ok"><i class="fa-solid fa-circle-check"></i> أُرسلت إلى ${escapeHtml(m.company)} (${escapeHtml(m.email)})</div>`;
        // إضافة تلقائية للوحة التتبع
        TrackerModule.create({
          company: m.company, job_title: m.jobTitle,
          location: 'مصر', job_url: m.jobUrl || '',
          contact_email: m.email, status: 'sent',
          notes: `أُرسلت عبر الحملة الذكية — العنوان: ${m.subject}`
        }).catch(() => {});
      } catch (err) {
        log.innerHTML += `<div class="send-log-item err"><i class="fa-solid fa-circle-xmark"></i> فشل الإرسال إلى ${escapeHtml(m.company)}: ${escapeHtml(err?.text || err?.message || 'خطأ')}</div>`;
      }
      renderBulkMessages();
      await new Promise(r => setTimeout(r, 1500)); // فاصل زمني آمن بين الرسائل
    }
    toast(`اكتمل الإرسال: ${sentCount} من ${approved.length}`, sentCount ? 'success' : 'error');
  }

  /* ============ ربط الواجهة ============ */
  function init() {
    renderCampaignCvSlot();
    SearchModule.renderSourceChips(document.getElementById('source-chips'));

    document.getElementById('btn-campaign-search').addEventListener('click', async e => {
      const btn = e.currentTarget;
      setLoading(btn, true, 'جارٍ البحث الشامل...');
      try { await campaignSearch(); } catch (err) { toast(err.message, 'error'); }
      finally { setLoading(btn, false); }
    });

    document.getElementById('btn-find-all-emails').addEventListener('click', findAllEmails);

    document.getElementById('btn-generate-bulk').addEventListener('click', async e => {
      const btn = e.currentTarget;
      setLoading(btn, true);
      try { await generateBulk(); } finally { setLoading(btn, false); }
    });

    document.getElementById('btn-approve-all').addEventListener('click', () => {
      AppState.bulkMessages.forEach(m => { if (m.status === 'draft') m.status = 'approved'; });
      renderBulkMessages();
      toast('تم اعتماد جميع المسودات', 'success');
    });

    document.getElementById('btn-send-approved').addEventListener('click', sendApproved);
  }

  /** تُستدعى عند تغيير الـ CV النشط لتحديث عرض الحملة */
  function refreshCvSlot() { renderCampaignCvSlot(); }

  return { init, refreshCvSlot, renderBulkMessages };
})();
