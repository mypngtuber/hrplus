/* =====================================================================
 * bulk.js — الحملة الذكية: بحث → إيميلات حقيقية → توليد جماعي مخصص
 *           → مراجعة وتعديل → إرسال (EmailJS) بموافقة المستخدم فقط
 *
 * قواعد صارمة:
 *  - لا إرسال أبداً إلى إيميل بحالة Guessed أو غير مؤكد
 *  - الإرسال يدعم: Pause / Resume / Cancel + حالات Sent/Failed/Skipped
 *  - كل إرسال يُسجَّل في سجل التواصل (communications) ولوحة التتبع
 * ===================================================================== */
const BulkModule = (() => {

  /* حالة دورة الإرسال */
  const sendState = { running: false, paused: false, cancelled: false };
  const genState = { cancelled: false };

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

    const hasKeys = AppState.settings.rapidApiKey || AppState.settings.serperKey;
    if (!hasKeys) {
      SearchModule.renderFallback(container, query, city);
      return;
    }

    container.innerHTML = `<div class="note-box" style="margin-top:14px">
      <span class="spinner" style="border-color:#93c5fd;border-top-color:#1e40af"></span>
      <span id="campaign-search-progress">جارٍ البحث في جميع المصادر داخل مصر...</span>
      <button class="btn btn-danger-outline btn-sm" id="btn-cancel-campaign-search" style="margin-inline-start:auto"><i class="fa-solid fa-stop"></i> إلغاء</button>
    </div>`;
    document.getElementById('btn-cancel-campaign-search').addEventListener('click', () => {
      SearchModule.cancelSearch();
      toast('جارٍ إلغاء البحث...', 'info');
    });

    const { jobs, usedQueries, newCount } = await SearchModule.searchAll(query, city, {
      onProgress: t => { const el = document.getElementById('campaign-search-progress'); if (el) el.textContent = t; }
    });

    AppState.campaignJobs = jobs.map(j => ({
      ...j,
      company: j.company_name, title: j.job_title, url: j.job_url,
      contactEmail: '', contactName: '', industry: '', expMatch: null
    }));
    let html = '';
    if (usedQueries?.length) {
      html += `<div class="note-box small" style="margin-top:14px"><i class="fa-solid fa-brain"></i><span>استعلامات البحث: <strong class="ltr">${usedQueries.slice(0, 6).map(escapeHtml).join(' · ')}</strong></span></div>`;
    }
    if (newCount != null) {
      html += `<div class="note-box small"><i class="fa-solid fa-bell"></i><span><strong>${newCount}</strong> وظيفة جديدة من أصل ${jobs.length} (الباقي موجود مسبقاً في قاعدة البيانات)</span></div>`;
    }
    container.innerHTML = html;
    const listDiv = document.createElement('div');
    container.appendChild(listDiv);
    renderJobCards(listDiv, AppState.campaignJobs, { selectable: true });
    if (jobs.length) toast(`تم العثور على ${jobs.length} نتيجة — حدّد الشركات ثم انتقل للخطوة 3`, 'success');
    DashboardModule.refresh().catch(() => {});
  }

  /* ---------- عرض بطاقات الوظائف (مشترك مع صفحة البحث الفردي) ---------- */
  function renderJobCards(container, jobs, { selectable = false, showMatch = false } = {}) {
    const SRC_CLS = { 'LinkedIn': 'linkedin', 'Wuzzuf': 'wuzzuf', 'JSearch': 'jsearch', 'Job Board': 'jsearch', 'Web Search': 'google' };
    container.innerHTML = jobs.map((j, i) => {
      const age = SearchModule.jobAge(j.date_posted, j.search_date);
      const srcs = (j.sources || [j.source]).filter(Boolean).map(s =>
        `<span class="source-tag ${SRC_CLS[s] || 'google'}">${escapeHtml(s)}</span>`).join(' ');
      const statusBadge = j.job_status && j.job_status !== 'Unknown'
        ? `<span class="mini-badge" style="background:${j.job_status === 'Active' ? '#d1fae5' : '#fee2e2'};color:${j.job_status === 'Active' ? '#047857' : '#b91c1c'}">${j.job_status === 'Active' ? 'نشطة' : 'مغلقة/منتهية'}</span>` : '';
      return `<div class="job-card ${selectable ? 'job-select-card' : ''}">
        ${selectable ? `<input type="checkbox" class="job-check" data-idx="${i}" aria-label="اختيار">` : ''}
        <div style="flex:1;min-width:220px">
          <h4>${escapeHtml(j.job_title)} ${showMatch && j.match ? MatchModule.matchBadge(j.match.score) : ''} ${j.isNew ? '<span class="mini-badge" style="background:#dbeafe;color:#1d4ed8">جديدة</span>' : ''}</h4>
          <div class="job-meta">
            <span><i class="fa-solid fa-building"></i> ${escapeHtml(j.company_name || j.company || '—')}</span>
            <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(j.location || 'مصر')}</span>
            <span><i class="fa-solid fa-clock"></i> ${age.label}</span>
          </div>
          <div style="margin-top:6px">${srcs} ${statusBadge}</div>
          ${j.description ? `<p class="job-desc">${escapeHtml(j.description)}</p>` : ''}
          ${showMatch && j.match ? MatchModule.renderMatchDetails(j.match) : ''}
        </div>
        <div class="job-card-actions">
          ${(j.job_url || j.url) ? `<a class="btn btn-outline btn-sm" href="${escapeHtml(j.job_url || j.url)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-left-from-square"></i> فتح</a>` : ''}
          ${showMatch ? `<button class="btn btn-outline btn-sm btn-tailor-job" data-idx="${i}"><i class="fa-solid fa-wand-magic-sparkles"></i> خصّص CV</button>` : ''}
        </div>
      </div>`;
    }).join('') || '<div class="note-box" style="margin-top:14px"><i class="fa-solid fa-circle-info"></i><span>لا توجد نتائج. جرّب مسمى وظيفي أوسع أو أضف مفاتيح Serper/JSearch من إدارة الـ APIs.</span></div>';

    if (showMatch) {
      container.querySelectorAll('.btn-tailor-job').forEach(b => b.addEventListener('click', async () => {
        const job = jobs[+b.dataset.idx];
        setLoading(b, true, 'جارٍ التخصيص...');
        try {
          const result = await MatchModule.tailorCvForJob(job);
          MatchModule.openTailoredResult(result);
        } catch (err) { toast(err.message, 'error'); }
        finally { setLoading(b, false); }
      }));
    }
  }

  function getSelectedJobs() {
    const checks = document.querySelectorAll('#campaign-jobs .job-check');
    const selected = [];
    checks.forEach(c => { if (c.checked) selected.push(AppState.campaignJobs[+c.dataset.idx]); });
    return selected;
  }

  /* ============ الخطوة 3: استخراج الإيميلات الحقيقية (خط أنابيب company.js) ============ */
  async function findAllEmails() {
    const container = document.getElementById('campaign-contacts');
    const selected = getSelectedJobs();
    if (!selected.length) return toast('حدّد شركة واحدة على الأقل من نتائج البحث', 'error');
    if (!AppState.settings.hunterKey && !AppState.settings.serperKey) {
      container.innerHTML = `<div class="note-box" style="margin-top:14px;background:#fef3c7;border-color:#fde68a;color:#92400e">
        <i class="fa-solid fa-key"></i><span>اكتشاف الإيميلات يتطلب مفتاح <strong>Hunter.io</strong> أو <strong>Serper</strong> — أضِفهما من إدارة الـ APIs. نلتزم بالإيميلات الحقيقية فقط ولا نلجأ للتخمين.</span></div>`;
      return;
    }

    // تجميع الشركات الفريدة
    const companies = [...new Map(selected.filter(j => (j.company || j.company_name) && (j.company || j.company_name) !== '—')
      .map(j => [j.company || j.company_name, j])).values()];
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
      const companyName = job.company || job.company_name;
      ptext.textContent = `(${i + 1}/${companies.length}) ${companyName}`;
      fill.style.width = `${((i + 1) / companies.length) * 100}%`;
      try {
        // إثراء الشركة (Cache-First) ثم اكتشاف الإيميلات
        const company = await CompanyModule.enrichCompany(companyName, { websiteHint: job.website || '' });
        await CompanyModule.discoverEmails(company);
        const emails = await DB.companyEmails(company.id);
        const sendable = emails.filter(e => CompanyModule.SENDABLE_STATUSES.includes(e.status));
        // أولوية: HR/Recruitment/Careers ثم الأعلى ثقة
        const best = sendable.find(e => ['HR', 'Recruitment', 'Careers', 'Hiring'].includes(e.type)) ||
                     sendable.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
        if (best) {
          AppState.campaignJobs.forEach(j => {
            if ((j.company || j.company_name) === companyName) {
              j.contactEmail = best.email; j.contactName = ''; j.domain = company.domain; j.companyId = company.id;
            }
          });
          found++;
          listEl.innerHTML += `<div class="contact-card">
            <div><strong>${escapeHtml(companyName)}</strong>
              ${company.domain ? `<span class="ltr" style="color:var(--text-muted);font-size:.78rem;font-family:monospace"> — ${escapeHtml(company.domain)}</span>` : ''}</div>
            <div><span class="email">${escapeHtml(best.email)}</span>
              <span class="status-badge accepted"><i class="fa-solid fa-shield-halved"></i> ${best.status === 'Verified' ? 'مُتحقَّق' : 'موجود'} ${best.confidence || ''}%</span>
              <span class="mini-badge" style="background:var(--primary-light);color:var(--primary)">${escapeHtml(best.type)}</span></div>
          </div>`;
        } else {
          listEl.innerHTML += `<div class="contact-card" style="opacity:.7">
            <div><strong>${escapeHtml(companyName)}</strong></div>
            <span style="font-size:.78rem;color:var(--warning)"><i class="fa-solid fa-triangle-exclamation"></i> لا يوجد إيميل مؤكد — لن نخمّن ولن نرسل</span>
          </div>`;
        }
      } catch (err) {
        listEl.innerHTML += `<div class="contact-card" style="opacity:.7">
          <div><strong>${escapeHtml(companyName)}</strong></div>
          <span style="font-size:.78rem;color:var(--danger)">${escapeHtml(err.message)}</span>
        </div>`;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    ptext.textContent = `اكتمل: إيميلات صالحة للإرسال لـ ${found} من ${companies.length} شركة`;
    if (found) toast(`تم العثور على ${found} إيميل صالح`, 'success');
  }

  /* ============ الخطوة 4: التوليد الجماعي المخصص ============ */
  async function generateBulk() {
    const withEmail = AppState.campaignJobs.filter(j => j.contactEmail);
    if (!withEmail.length) return toast('لا توجد شركات بإيميلات مؤكدة — نفّذ الخطوتين 2 و 3 أولاً', 'error');
    if (!AI.isConfigured()) return toast('أعدّ مفتاح Gemini من إدارة الـ APIs أولاً', 'error');

    const progress = document.getElementById('bulk-progress');
    progress.classList.remove('hidden');
    progress.innerHTML = `<div class="progress-text" id="bulk-progress-text"></div>
      <div class="progress-bar"><div class="progress-bar-fill" id="bulk-progress-fill" style="width:0%"></div></div>
      <button class="btn btn-danger-outline btn-sm" id="btn-cancel-gen"><i class="fa-solid fa-stop"></i> إيقاف التوليد</button>`;
    const fill = document.getElementById('bulk-progress-fill');
    const ptext = document.getElementById('bulk-progress-text');
    genState.cancelled = false;
    document.getElementById('btn-cancel-gen').addEventListener('click', () => {
      genState.cancelled = true;
      toast('جارٍ إيقاف التوليد...', 'info');
    });

    AppState.bulkMessages = [];
    const profile = AppState.cvProfile;
    const cvText = AppState.cvRawText.slice(0, 3500);

    for (let i = 0; i < withEmail.length; i++) {
      if (genState.cancelled) {
        // الباقي = Skipped
        for (let k = i; k < withEmail.length; k++) {
          const job = withEmail[k];
          AppState.bulkMessages.push({
            id: `msg-${Date.now()}-${k}`,
            company: job.company || job.company_name, jobTitle: job.title || job.job_title,
            jobUrl: job.url || job.job_url, email: job.contactEmail, contactName: job.contactName,
            companyId: job.companyId || '', industry: '', expMatch: null,
            subject: '', body: '', status: 'skipped'
          });
        }
        break;
      }
      const job = withEmail[i];
      ptext.textContent = `(${i + 1}/${withEmail.length}) توليد رسالة لـ ${job.company || job.company_name}...`;
      fill.style.width = `${((i + 1) / withEmail.length) * 100}%`;
      try {
        const msg = await generateOneMessage(job, profile, cvText);
        AppState.bulkMessages.push({
          id: `msg-${Date.now()}-${i}`,
          company: job.company || job.company_name,
          jobTitle: job.title || job.job_title,
          jobUrl: job.url || job.job_url,
          email: job.contactEmail,
          contactName: job.contactName,
          companyId: job.companyId || '',
          industry: msg.industry,
          expMatch: msg.exp_match,
          subject: msg.subject,
          body: msg.body,
          status: 'draft'
        });
      } catch (err) {
        AppState.bulkMessages.push({
          id: `msg-${Date.now()}-${i}`,
          company: job.company || job.company_name, jobTitle: job.title || job.job_title,
          jobUrl: job.url || job.job_url, email: job.contactEmail, contactName: job.contactName,
          companyId: job.companyId || '', industry: '', expMatch: null,
          subject: '', body: `تعذّر التوليد: ${err.message}`,
          status: 'failed'
        });
      }
      renderBulkMessages();
      await new Promise(r => setTimeout(r, 800));
    }
    const ready = AppState.bulkMessages.filter(m => m.status === 'draft' || m.status === 'approved').length;
    ptext.textContent = genState.cancelled
      ? `أُوقف التوليد: ${ready} جاهزة — ${AppState.bulkMessages.filter(m => m.status === 'skipped').length} تم تخطيها`
      : `اكتمل التوليد: ${ready} رسالة جاهزة للمراجعة`;
    toast('اكتمل التوليد — راجع وعدّل الرسائل ثم اعتمدها', 'success');
  }

  async function generateOneMessage(job, profile, cvText) {
    const companyName = job.company || job.company_name;
    const jobTitle = job.title || job.job_title;
    const profilePart = profile ? `
الملف المهني للمتقدم:
- المسميات السابقة: ${(profile.job_titles || []).join('، ')}
- المهارات: ${(profile.skills || []).slice(0, 15).join('، ')}
- المجالات التي عمل بها: ${(profile.industries || []).join('، ')}
- المؤهلات: ${(profile.education || []).join('، ')}
- سنوات الخبرة التقريبية: ${profile.years_experience || 'غير محددة'}
` : '';

    const prompt = `أنت خبير توظيف تكتب رسائل تقديم مخصصة للغاية (وليست قوالب عامة).

الشركة: "${companyName}" — الوظيفة: "${jobTitle}"
وصف الوظيفة: """${(job.description || '').slice(0, 600)}"""
${job.contactName ? `اسم مسؤول التوظيف (إن كان متاحاً): ${job.contactName}` : ''}

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
  const STATUS_LABELS = { draft: 'مسودة', approved: 'معتمدة', sent: 'أُرسلت', failed: 'فشلت', skipped: 'تم تخطيها' };

  function renderBulkMessages() {
    const container = document.getElementById('bulk-messages');

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
          <textarea class="textarea msg-body" data-id="${m.id}" rows="7" ${['sent', 'skipped'].includes(m.status) ? 'disabled' : ''}>${escapeHtml(m.body)}</textarea>
        </div>
        <div class="bulk-msg-actions">
          ${m.status === 'draft' ? `<button class="btn btn-success btn-sm btn-approve" data-id="${m.id}"><i class="fa-solid fa-check"></i> اعتماد</button>` : ''}
          ${m.status === 'approved' ? `<button class="btn btn-outline btn-sm btn-unapprove" data-id="${m.id}"><i class="fa-solid fa-rotate-left"></i> إلغاء الاعتماد</button>` : ''}
          ${m.status === 'skipped' ? `<button class="btn btn-outline btn-sm btn-restore" data-id="${m.id}"><i class="fa-solid fa-rotate-left"></i> استعادة</button>` : ''}
          ${!['sent'].includes(m.status) && m.email ? `<button class="btn btn-outline btn-sm btn-mailto" data-id="${m.id}"><i class="fa-solid fa-envelope"></i> فتح في البريد</button>` : ''}
          ${m.body && !m.body.startsWith('تعذّر') ? `<button class="btn btn-outline btn-sm btn-save-tpl" data-id="${m.id}"><i class="fa-solid fa-bookmark"></i> حفظ</button>` : ''}
          ${m.status === 'failed' ? `<button class="btn btn-outline btn-sm btn-retry" data-id="${m.id}"><i class="fa-solid fa-rotate"></i> إعادة التوليد</button>` : ''}
        </div>
      </div>`).join('');

    container.querySelectorAll('.msg-subject').forEach(inp =>
      inp.addEventListener('input', () => { findMsg(inp.dataset.id).subject = inp.value; }));
    container.querySelectorAll('.msg-body').forEach(ta =>
      ta.addEventListener('input', () => { findMsg(ta.dataset.id).body = ta.value; }));
    container.querySelectorAll('.btn-approve').forEach(b =>
      b.addEventListener('click', () => setStatus(b.dataset.id, 'approved')));
    container.querySelectorAll('.btn-unapprove').forEach(b =>
      b.addEventListener('click', () => setStatus(b.dataset.id, 'draft')));
    container.querySelectorAll('.btn-restore').forEach(b =>
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
      const job = AppState.campaignJobs.find(j => (j.company || j.company_name) === m.company && (j.title || j.job_title) === m.jobTitle);
      if (!job || !AI.isConfigured()) return;
      try {
        const msg = await generateOneMessage(job, AppState.cvProfile, AppState.cvRawText.slice(0, 3500));
        Object.assign(m, { industry: msg.industry, expMatch: msg.exp_match, subject: msg.subject, body: msg.body, status: 'draft' });
        renderBulkMessages();
      } catch (err) { toast(err.message, 'error'); }
    }));

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

  /* ============ الخطوة 5: الإرسال بموافقة المستخدم (Pause/Cancel/Skipped) ============ */
  function renderSendControls() {
    const bar = document.getElementById('send-controls');
    if (!bar) return;
    if (!sendState.running) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.innerHTML = `
      <button class="btn ${sendState.paused ? 'btn-success' : 'btn-outline'} btn-sm" id="btn-send-pause">
        <i class="fa-solid ${sendState.paused ? 'fa-play' : 'fa-pause'}"></i> ${sendState.paused ? 'استئناف' : 'إيقاف مؤقت'}
      </button>
      <button class="btn btn-danger-outline btn-sm" id="btn-send-cancel"><i class="fa-solid fa-stop"></i> إلغاء الإرسال</button>
      <div class="progress-bar" style="flex:1;min-width:150px;margin:0"><div class="progress-bar-fill" id="send-progress-fill" style="width:0%"></div></div>
      <span class="progress-text" id="send-progress-text"></span>`;
    document.getElementById('btn-send-pause').addEventListener('click', () => {
      sendState.paused = !sendState.paused;
      renderSendControls();
    });
    document.getElementById('btn-send-cancel').addEventListener('click', () => {
      sendState.cancelled = true;
      toast('جارٍ إلغاء الإرسال — ستُعلَّم المتبقية كـ "تم تخطيها"', 'info');
    });
  }

  async function sendApproved() {
    if (sendState.running) return toast('الإرسال يعمل بالفعل', 'error');
    const approved = AppState.bulkMessages.filter(m => m.status === 'approved' && m.email);
    if (!approved.length) return toast('لا توجد رسائل معتمدة — راجع الرسائل واضغط "اعتماد" أولاً', 'error');

    const { emailjsPublicKey, emailjsServiceId, emailjsTemplateId, senderName } = AppState.settings;
    const log = document.getElementById('send-log');

    if (!emailjsPublicKey || !emailjsServiceId || !emailjsTemplateId) {
      if (confirm('EmailJS غير مُعدّ. هل تريد فتح الرسائل المعتمدة في تطبيق بريدك (واحدة تلو الأخرى) بدلاً من ذلك؟')) {
        approved.forEach((m, i) => setTimeout(() => openInMail(m), i * 1200));
        log.innerHTML = `<div class="send-log-item ok"><i class="fa-solid fa-envelope-open"></i> فُتحت ${approved.length} رسالة في تطبيق البريد — أكمل الإرسال يدوياً من هناك.</div>`;
      }
      return;
    }

    if (!confirm(`سيتم إرسال ${approved.length} رسالة الآن عبر بريدك. متابعة؟`)) return;

    emailjs.init({ publicKey: emailjsPublicKey });
    log.innerHTML = '';
    sendState.running = true; sendState.paused = false; sendState.cancelled = false;
    renderSendControls();
    let sentCount = 0, failCount = 0, skippedCount = 0;

    for (let idx = 0; idx < approved.length; idx++) {
      const m = approved[idx];

      // إلغاء: الباقي → skipped
      if (sendState.cancelled) {
        m.status = 'skipped';
        skippedCount++;
        continue;
      }
      // إيقاف مؤقت: انتظر حتى الاستئناف أو الإلغاء
      while (sendState.paused && !sendState.cancelled) {
        await new Promise(r => setTimeout(r, 400));
      }
      if (sendState.cancelled) { m.status = 'skipped'; skippedCount++; continue; }

      // فحص أخير: لا إرسال أبداً إلى Guessed
      const fillEl = document.getElementById('send-progress-fill');
      const textEl = document.getElementById('send-progress-text');
      if (fillEl) fillEl.style.width = `${((idx + 1) / approved.length) * 100}%`;
      if (textEl) textEl.textContent = `(${idx + 1}/${approved.length}) ${m.company}`;

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
        log.scrollTop = log.scrollHeight;

        // تسجيل في لوحة التتبع + سجل التواصل
        const followupDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
        TrackerModule.create({
          company: m.company, job_title: m.jobTitle,
          location: 'مصر', job_url: m.jobUrl || '',
          contact_email: m.email, status: 'applied',
          email_sent: true, followup_date: followupDate,
          source: 'الحملة الذكية', company_id: m.companyId || '',
          cv_id: AppState.activeCvId || '',
          notes: `أُرسلت عبر الحملة الذكية — العنوان: ${m.subject}`
        }).catch(() => {});
        if (m.companyId) {
          DB.logCommunication({
            company_id: m.companyId, type: 'email_sent',
            subject: m.subject, body: m.body, direction: 'outbound'
          }).catch(() => {});
        }
      } catch (err) {
        m.status = 'failed';
        failCount++;
        log.innerHTML += `<div class="send-log-item err"><i class="fa-solid fa-circle-xmark"></i> فشل الإرسال إلى ${escapeHtml(m.company)}: ${escapeHtml(err?.text || err?.message || 'خطأ')}</div>`;
        log.scrollTop = log.scrollHeight;
      }
      renderBulkMessages();
      await new Promise(r => setTimeout(r, 1500));
    }

    sendState.running = false; sendState.paused = false;
    renderSendControls();
    renderBulkMessages();
    const parts = [`أُرسلت: ${sentCount}`];
    if (failCount) parts.push(`فشلت: ${failCount}`);
    if (skippedCount) parts.push(`تُخطيت: ${skippedCount}`);
    toast(`اكتمل الإرسال — ${parts.join(' · ')}`, sentCount ? 'success' : 'error');
    DashboardModule.refresh().catch(() => {});
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

  return { init, refreshCvSlot, renderBulkMessages, renderJobCards, generateOneMessage };
})();
