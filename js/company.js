/* =====================================================================
 * company.js — ذكاء الشركات: إثراء (Cache-First) + اكتشاف HR الحقيقيين
 *              + خط أنابيب اكتشاف الإيميلات + صفحة قاعدة الشركات + الملف الشخصي
 *
 * قواعد صارمة:
 *  - لا تخمين إيميلات ولا روابط LinkedIn — مصادر حقيقية فقط (Serper / Hunter)
 *  - قاعدة البيانات أولاً (Smart Cache) قبل أي بحث ويب
 *  - الإيميلات بحالة Guessed لا تُعرض كحقيقية ولا يُسمح بالإرسال إليها
 * ===================================================================== */
const CompanyModule = (() => {

  const now = () => Date.now();
  const SENDABLE_STATUSES = ['Verified', 'Found'];

  /* =====================================================================
   * 1) إثراء الشركة (Company Intelligence) — Cache-First
   * ===================================================================== */

  /**
   * يعيد سجل الشركة كاملاً. يبحث في القاعدة أولاً؛ إن كانت حديثة (14 يوماً)
   * يستخدمها مباشرة، وإلا يبحث عبر Serper ثم يحدّث القاعدة.
   */
  async function enrichCompany(name, { forceRefresh = false, websiteHint = '' } = {}) {
    if (!name) return null;
    if (!forceRefresh) {
      const cached = await DB.findCompany(name);
      if (cached && cached.fresh) return { ...cached.company, fromCache: true };
    }

    const fields = { name: name.trim(), sources: ['Web Search'] };
    const hasSerper = !!AppState.settings.serperKey;

    if (hasSerper) {
      // أ) الموقع الرسمي والدومين
      try {
        const data = await SearchModule.serperSearch(`"${name}" Egypt official website`, { num: 8 });
        const items = (data.organic || []).filter(i => !/linkedin|wuzzuf|indeed|glassdoor|facebook|twitter|instagram|wikipedia/i.test(i.link || ''));
        const best = items[0];
        if (best) {
          const domain = DB.extractDomain(best.link);
          if (domain) {
            fields.website = `https://${domain}`;
            fields.domain = domain;
            fields.domain_confidence = 70;
            fields.domain_source = 'Serper — نتيجة بحث الويب';
          }
        }
        // صفحات Careers / Contact / About من نتائج البحث
        for (const it of (data.organic || [])) {
          const u = (it.link || '').toLowerCase();
          if (/(career|jobs|وظائف|join)/i.test(u) && !fields.careers_page) fields.careers_page = it.link;
          if (/(contact|اتصل|تواصل)/i.test(u) && !fields.contact_page) fields.contact_page = it.link;
          if (/(about|من-نحن|عن-الشركة)/i.test(u) && !fields.about_page) fields.about_page = it.link;
        }
      } catch (_) { /* نكمل بدون Serper */ }

      // ب) LinkedIn الرسمي للشركة (رابط حقيقي من نتيجة بحث — لا تخمين)
      try {
        const li = await SearchModule.serperSearch(`site:linkedin.com/company "${name}"`, { num: 5 });
        const liItem = (li.organic || []).find(i => /linkedin\.com\/company\//i.test(i.link || ''));
        if (liItem) fields.linkedin_url = liItem.link.split('?')[0];
      } catch (_) { /* تجاهل */ }

      // ج) استنتاج المجال (تصنيف AI تحليلي فقط — ليس بيانات مختلقة)
      if (AI.isConfigured()) {
        try {
          const r = await AI.generateJSON(
            `ما هو مجال عمل شركة "${name}" في مصر؟ أعد JSON فقط: {"industry":"<المجال بالعربية>","city":"<المدينة الرئيسية إن عُرفت وإلا فارغ>"}`,
            { maxTokens: 256, temperature: 0.2 });
          if (r.industry) fields.industry = r.industry;
          if (r.city) fields.city = r.city;
        } catch (_) { /* تجاهل */ }
      }
    }

    // هـ) تحقق Hunter من الدومين (يرفع الثقة)
    if (AppState.settings.hunterKey && (fields.domain || websiteHint)) {
      const dom = fields.domain || DB.extractDomain(websiteHint);
      if (dom) {
        try {
          const res = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(dom)}&limit=1&api_key=${encodeURIComponent(AppState.settings.hunterKey)}`);
          if (res.ok) {
            const d = await res.json();
            if (d.data?.domain) {
              fields.domain = d.data.domain;
              fields.website = fields.website || `https://${d.data.domain}`;
              fields.domain_confidence = 95;
              fields.domain_source = 'Hunter.io — تحقق من النطاق';
              if (!fields.sources.includes('Hunter.io')) fields.sources.push('Hunter.io');
            }
          }
        } catch (_) { /* تجاهل */ }
      }
    }

    // د) تلميح موقع من نتيجة JSearch إن وُجد
    if (!fields.domain && websiteHint) {
      const dom = DB.extractDomain(websiteHint);
      if (dom) {
        fields.domain = dom;
        fields.website = `https://${dom}`;
        fields.domain_confidence = 60;
        fields.domain_source = 'من رابط الوظيفة (JSearch)';
      }
    }

    const record = await DB.upsertCompany(fields);
    return { ...record, fromCache: false };
  }

  /* =====================================================================
   * 2) اكتشاف HR والموظفين الحقيقيين (Serper — إنجليزي وعربي)
   * ===================================================================== */

  const HR_TITLE_PATTERNS = /\b(HR|Human Resources|Recruiter|Recruitment|Talent Acquisition|People|Hiring)\b|موارد بشرية|توظيف|مسؤول توظيف|استقطاب/i;

  function parseLinkedInPerson(item) {
    const url = (item.link || '').split('?')[0];
    if (!/linkedin\.com\/in\//i.test(url)) return null;
    // العنوان النمطي: "Name - Job Title at Company | LinkedIn" أو "Name – Title – Company"
    const raw = (item.title || '').replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
    let name = '', jobTitle = '';
    let m = raw.match(/^([^-–—|]+?)\s*[-–—]\s*(.+)$/);
    if (m) { name = m[1].trim(); jobTitle = m[2].trim(); }
    else name = raw.trim();
    if (!name || name.length < 3) return null;
    return {
      name,
      job_title: jobTitle.replace(/\s*(at|في|لدى)\s*.*$/i, '').trim() || jobTitle,
      linkedin_url: url,
      source: 'Serper',
      source_url: url,
      confidence: 80
    };
  }

  async function discoverHR(company, { onProgress } = {}) {
    const name = company.name;
    const queries = [
      `"${name}" HR Egypt LinkedIn`,
      `"${name}" Recruiter Egypt LinkedIn`,
      `"${name}" "Talent Acquisition" LinkedIn`,
      `"${name}" "HR Manager" LinkedIn`,
      `"${name}" موارد بشرية LinkedIn`,
      `"${name}" مسؤول توظيف LinkedIn`,
      `"${name}" توظيف LinkedIn`
    ];
    if (!AppState.settings.serperKey) throw new Error('مفتاح Serper غير مُعدّ — أضِفه من إدارة الـ APIs');

    let found = 0;
    for (let i = 0; i < queries.length; i++) {
      onProgress?.(`(${i + 1}/${queries.length}) ${queries[i]}`);
      try {
        const data = await SearchModule.serperSearch(queries[i], { num: 8 });
        for (const item of (data.organic || [])) {
          const person = parseLinkedInPerson(item);
          if (!person) continue;
          // فقط من له صلة بالتوظيف/الموارد البشرية (أو نتيجة من استعلام عربي متخصص)
          const isHr = HR_TITLE_PATTERNS.test(person.job_title) || HR_TITLE_PATTERNS.test(item.snippet || '') || i >= 4;
          if (!isHr) continue;
          person.department = 'HR';
          person.email_status = 'None';
          await DB.upsertContact(company.id, person);
          found++;
        }
      } catch (e) {
        if (/غير صالح|429/.test(e.message)) throw e;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    await DB.update('companies', company.id, { last_verified: now() });
    return found;
  }

  /* =====================================================================
   * 3) خط أنابيب اكتشاف الإيميلات
   *    Hunter → Serper → صفحات الموقع الرسمي → التحقق — بدون أي تخمين
   * ===================================================================== */

  function classifyEmailType(email, position = '') {
    const e = email.toLowerCase();
    const p = (position || '').toLowerCase();
    if (/hr|recruit|talent|hiring|people/.test(p)) return 'HR';
    if (/^(hr|recruit|recruitment|talent|hiring)@/.test(e)) return 'Recruitment';
    if (/^(careers|jobs|vacancies)@/.test(e)) return 'Careers';
    if (/^(info|contact|hello|support)@/.test(e)) return 'Contact';
    return 'General';
  }

  const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const EMAIL_BLACKLIST = /^(noreply|no-reply|donotreply|example|test|email|your)/i;

  /** استخراج إيميلات حقيقية من نتائج بحث (snippets) لنطاق معين */
  function extractEmailsFromText(text, domain) {
    const out = new Set();
    for (const m of (text || '').matchAll(EMAIL_RE)) {
      const email = m[0].toLowerCase();
      if (EMAIL_BLACKLIST.test(email)) continue;
      if (domain && !email.endsWith('@' + domain)) continue; // فقط إيميلات نطاق الشركة
      if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(email)) continue; // بقايا أصول
      out.add(email);
    }
    return [...out];
  }

  /**
   * اكتشاف الإيميلات لشركة. لا يُنتج أبداً إيميلات مُخمَّنة.
   * @returns { found: number }
   */
  async function discoverEmails(company, { onProgress } = {}) {
    let found = 0;
    const key = AppState.settings.hunterKey;
    const domain = company.domain || '';

    // ── المرحلة 1: Hunter.io (المصدر الأعلى ثقة)
    if (key) {
      onProgress?.('Hunter.io: البحث عن إيميلات النطاق...');
      try {
        let targetDomain = domain;
        if (!targetDomain) {
          const r0 = await fetch(`https://api.hunter.io/v2/domain-search?company=${encodeURIComponent(company.name)}&limit=1&api_key=${encodeURIComponent(key)}`);
          if (r0.ok) {
            const d0 = await r0.json();
            targetDomain = d0.data?.domain || '';
            if (targetDomain) {
              await DB.update('companies', company.id, {
                domain: targetDomain, website: company.website || `https://${targetDomain}`,
                domain_confidence: 95, domain_source: 'Hunter.io — تحقق من النطاق'
              });
              company.domain = targetDomain;
            }
          }
        }
        if (targetDomain) {
          const res = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(targetDomain)}&limit=20&api_key=${encodeURIComponent(key)}`);
          if (res.ok) {
            const data = await res.json();
            for (const e of (data.data?.emails || [])) {
              if (!e.value || (e.confidence ?? 0) < 50 || e.verification?.status === 'invalid') continue;
              const status = e.verification?.status === 'valid' ? 'Verified' : 'Found';
              await DB.upsertEmail(company.id, {
                email: e.value,
                type: classifyEmailType(e.value, e.position),
                status,
                source: 'Hunter.io',
                source_url: (e.sources && e.sources[0] && e.sources[0].uri) || `https://${targetDomain}`,
                confidence: e.confidence
              });
              // إن كان له اسم ومنصب — سجّله كجهة اتصال أيضاً
              const fullName = [e.first_name, e.last_name].filter(Boolean).join(' ');
              if (fullName && HR_TITLE_PATTERNS.test(e.position || '')) {
                await DB.upsertContact(company.id, {
                  name: fullName, job_title: e.position || '', department: 'HR',
                  email: e.value, email_status: status,
                  source: 'Hunter.io', source_url: `https://${targetDomain}`, confidence: e.confidence
                });
              }
              found++;
            }
          }
        }
      } catch (_) { /* نكمل للمرحلة التالية — لا نتوقف عند فشل Hunter */ }
    }

    // ── المرحلة 2: Serper — إيميلات مذكورة علناً على نطاق الشركة/الويب
    if (AppState.settings.serperKey) {
      const dom = company.domain || domain;
      const queries = [];
      if (dom) {
        queries.push(`site:${dom} email`, `site:${dom} contact`, `site:${dom} careers`, `site:${dom} recruitment`);
      }
      queries.push(`"${company.name}" اتصل بنا`, `"${company.name}" البريد الإلكتروني`, `"${company.name}" وظائف email`);

      for (const q of queries.slice(0, dom ? 6 : 3)) {
        onProgress?.(`Serper: ${q}`);
        try {
          const data = await SearchModule.serperSearch(q, { num: 8 });
          for (const item of (data.organic || [])) {
            const emails = extractEmailsFromText(`${item.title || ''} ${item.snippet || ''}`, dom);
            for (const email of emails) {
              await DB.upsertEmail(company.id, {
                email,
                type: classifyEmailType(email),
                status: 'Unverified', // ظهرت علناً لكن لم تتحقق — ليست Guessed
                source: 'Serper — الويب العام',
                source_url: item.link || '',
                confidence: 60
              });
              found++;
            }
          }
        } catch (e) { if (/غير صالح|429/.test(e.message)) break; }
        await new Promise(r => setTimeout(r, 300));
      }
    }

    await DB.update('companies', company.id, { last_verified: now() });
    return found;
  }

  /* =====================================================================
   * 4) صفحة قاعدة الشركات (Company Database)
   * ===================================================================== */
  const state = { companies: [], emails: [], contacts: [], jobs: [], filter: '', sortKey: 'last_verified', sortDir: -1 };

  async function refreshDb({ force = false } = {}) {
    [state.companies, state.emails, state.contacts, state.jobs] = await Promise.all([
      DB.list('companies', { force }), DB.list('company_emails', { force }),
      DB.list('company_contacts', { force }), DB.list('jobs', { force })
    ]);
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function freshnessBadge(ts) {
    if (!ts) return '<span class="fresh-badge stale">لم يُتحقق</span>';
    const days = Math.floor((Date.now() - ts) / 86400000);
    if (days <= DB.FRESH_DAYS) return `<span class="fresh-badge fresh"><i class="fa-solid fa-circle-check"></i> ${fmtDate(ts)}</span>`;
    return `<span class="fresh-badge stale"><i class="fa-solid fa-triangle-exclamation"></i> قديمة — ${fmtDate(ts)}</span>`;
  }

  const statusBadge = st => {
    const map = {
      Verified: ['#d1fae5', '#047857', 'مُتحقَّق'], Found: ['#dbeafe', '#1d4ed8', 'موجود'],
      Unverified: ['#fef3c7', '#b45309', 'غير مؤكد'], Invalid: ['#fee2e2', '#b91c1c', 'غير صالح'],
      Guessed: ['#f1f5f9', '#64748b', 'مُخمَّن — لا يُستخدم']
    };
    const [bg, fg, label] = map[st] || map.Unverified;
    return `<span class="mini-badge" style="background:${bg};color:${fg}">${label}</span>`;
  };

  function renderDbPage() {
    const tbody = document.getElementById('companies-tbody');
    if (!tbody) return;
    const f = state.filter.toLowerCase();
    let rows = state.companies.filter(c => !f ||
      (c.name || '').toLowerCase().includes(f) || (c.domain || '').toLowerCase().includes(f) ||
      (c.industry || '').includes(state.filter));

    rows.sort((a, b) => {
      const k = state.sortKey;
      const va = a[k] ?? '', vb = b[k] ?? '';
      return (va > vb ? 1 : va < vb ? -1 : 0) * state.sortDir;
    });

    document.getElementById('companies-count').textContent = rows.length;

    tbody.innerHTML = rows.map(c => {
      const emails = state.emails.filter(e => e.company_id === c.id && e.status !== 'Guessed');
      const sendable = emails.filter(e => SENDABLE_STATUSES.includes(e.status));
      const contacts = state.contacts.filter(x => x.company_id === c.id);
      const jobs = state.jobs.filter(j => j.company_id === c.id || DB.normalizeName(j.company_name) === c.normalized_name);
      return `<tr>
        <td><button class="link-btn btn-open-company" data-id="${c.id}"><strong>${escapeHtml(c.name)}</strong></button></td>
        <td>${escapeHtml(c.industry || '—')}</td>
        <td>${c.domain ? `<span class="ltr" style="font-family:monospace;font-size:.8rem">${escapeHtml(c.domain)}</span>${c.domain_confidence ? `<br><span class="conf-badge">${c.domain_confidence}%</span>` : ''}` : '—'}</td>
        <td>${emails.length ? `${sendable.length} صالح / ${emails.length}` : '—'}</td>
        <td>${contacts.length || '—'}</td>
        <td>${c.linkedin_url ? `<a href="${escapeHtml(c.linkedin_url)}" target="_blank" rel="noopener" class="icon-btn" title="LinkedIn"><i class="fa-brands fa-linkedin" style="color:#0a66c2"></i></a>` : '—'}</td>
        <td>${jobs.length || '—'}</td>
        <td style="white-space:nowrap">${freshnessBadge(c.last_verified)}</td>
        <td style="white-space:nowrap">
          <button class="icon-btn btn-open-company" data-id="${c.id}" title="فتح الملف"><i class="fa-solid fa-eye"></i></button>
          <button class="icon-btn btn-refresh-company" data-id="${c.id}" title="تحديث البيانات"><i class="fa-solid fa-rotate"></i></button>
          <button class="icon-btn btn-edit-company" data-id="${c.id}" title="تعديل"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn btn-del-company" data-id="${c.id}" title="حذف" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:30px">لا توجد شركات بعد — تُضاف تلقائياً عند البحث عن الوظائف أو من "اكتشاف شركة" أدناه</td></tr>';

    bindDbPageEvents(tbody);
  }

  function bindDbPageEvents(tbody) {
    tbody.querySelectorAll('.btn-open-company').forEach(b =>
      b.addEventListener('click', () => openProfile(b.dataset.id)));
    tbody.querySelectorAll('.btn-del-company').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('حذف هذه الشركة نهائياً؟ (لن تُحذف الإيميلات وجهات الاتصال المرتبطة تلقائياً)')) return;
        try {
          await DB.remove('companies', b.dataset.id);
          await refreshDb({ force: true });
          renderDbPage();
          toast('تم حذف الشركة', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }));
    tbody.querySelectorAll('.btn-refresh-company').forEach(b =>
      b.addEventListener('click', async () => {
        const c = state.companies.find(x => x.id === b.dataset.id);
        if (!c) return;
        b.disabled = true;
        toast(`جارٍ تحديث بيانات ${c.name}...`, 'info');
        try {
          await enrichCompany(c.name, { forceRefresh: true, websiteHint: c.website || '' });
          await refreshDb({ force: true });
          renderDbPage();
          toast('تم التحديث', 'success');
        } catch (err) { toast(err.message, 'error'); }
        finally { b.disabled = false; }
      }));
    tbody.querySelectorAll('.btn-edit-company').forEach(b =>
      b.addEventListener('click', () => openEditModal(b.dataset.id)));
  }

  /* ---------- نافذة تعديل شركة ---------- */
  function openEditModal(id) {
    const c = state.companies.find(x => x.id === id);
    if (!c) return;
    const modal = document.getElementById('company-modal');
    document.getElementById('co-edit-id').value = c.id;
    document.getElementById('co-name').value = c.name || '';
    document.getElementById('co-website').value = c.website || '';
    document.getElementById('co-domain').value = c.domain || '';
    document.getElementById('co-industry').value = c.industry || '';
    document.getElementById('co-city').value = c.city || '';
    document.getElementById('co-linkedin').value = c.linkedin_url || '';
    document.getElementById('co-careers').value = c.careers_page || '';
    document.getElementById('co-contact').value = c.contact_page || '';
    document.getElementById('co-notes').value = c.notes || '';
    modal.classList.remove('hidden');
  }

  async function saveEditModal() {
    const id = document.getElementById('co-edit-id').value;
    if (!id) return;
    const domain = document.getElementById('co-domain').value.trim();
    try {
      await DB.update('companies', id, {
        name: document.getElementById('co-name').value.trim(),
        website: document.getElementById('co-website').value.trim(),
        domain,
        industry: document.getElementById('co-industry').value.trim(),
        city: document.getElementById('co-city').value.trim(),
        linkedin_url: document.getElementById('co-linkedin').value.trim(),
        careers_page: document.getElementById('co-careers').value.trim(),
        contact_page: document.getElementById('co-contact').value.trim(),
        notes: document.getElementById('co-notes').value.trim(),
        domain_source: domain ? 'إدخال يدوي — المستخدم' : '',
        domain_confidence: domain ? 100 : 0,
        last_verified: now()
      });
      document.getElementById('company-modal').classList.add('hidden');
      await refreshDb({ force: true });
      renderDbPage();
      toast('تم حفظ بيانات الشركة', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ---------- تصدير CSV ---------- */
  function exportCsv() {
    const rows = state.companies.map(c => {
      const emails = state.emails.filter(e => e.company_id === c.id && e.status !== 'Guessed').map(e => e.email).join(' | ');
      return {
        'الشركة': c.name, 'المجال': c.industry || '', 'الدومين': c.domain || '',
        'الموقع': c.website || '', 'المدينة': c.city || '', 'LinkedIn': c.linkedin_url || '',
        'إيميلات': emails, 'آخر تحقق': c.last_verified ? new Date(c.last_verified).toISOString().slice(0, 10) : ''
      };
    });
    if (!rows.length) return toast('لا توجد شركات للتصدير', 'error');
    const headers = Object.keys(rows[0]);
    const csv = '﻿' + [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h]).replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `companies-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`تم تصدير ${rows.length} شركة`, 'success');
  }

  /* =====================================================================
   * 5) صفحة الملف الشخصي للشركة (Company Profile)
   * ===================================================================== */
  async function openProfile(companyId) {
    document.querySelector('.nav-btn[data-view="company-profile"]')?.click();
    const container = document.getElementById('company-profile-content');
    container.innerHTML = '<div class="note-box"><span class="spinner" style="border-color:#93c5fd;border-top-color:#1e40af"></span> جارٍ تحميل ملف الشركة...</div>';

    try {
      const [companies, emails, contacts, jobs, comms, apps] = await Promise.all([
        DB.list('companies'), DB.companyEmails(companyId), DB.companyContacts(companyId),
        DB.list('jobs'), DB.companyCommunications(companyId), DB.list('applications')
      ]);
      const c = companies.find(x => x.id === companyId);
      if (!c) { container.innerHTML = '<div class="note-box">الشركة غير موجودة.</div>'; return; }
      const companyJobs = jobs.filter(j => j.company_id === companyId || DB.normalizeName(j.company_name) === c.normalized_name);
      const companyApps = apps.filter(a => a.company_id === companyId || DB.normalizeName(a.company) === c.normalized_name);
      const visibleEmails = emails.filter(e => e.status !== 'Guessed');

      const COMM_LABELS = { email_sent: 'إيميل مُرسل', followup_sent: 'متابعة مُرسلة', reply_received: 'رد مُستلم', call: 'مكالمة', note: 'ملاحظة' };
      const COMM_ICONS = { email_sent: 'fa-paper-plane', followup_sent: 'fa-reply', reply_received: 'fa-inbox', call: 'fa-phone', note: 'fa-note-sticky' };
      const JOB_STATUS = { Active: ['#d1fae5', '#047857', 'نشطة'], Closed: ['#fee2e2', '#b91c1c', 'مغلقة'], Expired: ['#fee2e2', '#b91c1c', 'منتهية'], Unknown: ['#f1f5f9', '#64748b', 'غير معروف'] };

      container.innerHTML = `
        <div class="profile-header">
          <div>
            <h3><i class="fa-solid fa-building"></i> ${escapeHtml(c.name)}</h3>
            <div class="profile-meta">
              ${c.industry ? `<span><i class="fa-solid fa-industry"></i> ${escapeHtml(c.industry)}</span>` : ''}
              ${c.city ? `<span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(c.city)}، ${escapeHtml(c.country || 'مصر')}</span>` : ''}
              ${c.domain ? `<span class="ltr" style="font-family:monospace"><i class="fa-solid fa-globe"></i> ${escapeHtml(c.domain)}</span>` : ''}
              ${c.domain_confidence ? `<span class="conf-badge">ثقة الدومين: ${c.domain_confidence}%</span>` : ''}
            </div>
            <div class="profile-meta" style="margin-top:6px">
              ${c.domain_source ? `<span class="src-line">المصدر: ${escapeHtml(c.domain_source)}</span>` : ''}
              <span class="src-line">آخر تحقق: ${fmtDate(c.last_verified)}</span>
            </div>
            <div class="btn-row" style="margin-top:12px">
              ${c.website ? `<a class="btn btn-outline btn-sm" href="${escapeHtml(c.website)}" target="_blank" rel="noopener"><i class="fa-solid fa-globe"></i> الموقع</a>` : ''}
              ${c.linkedin_url ? `<a class="btn btn-outline btn-sm" href="${escapeHtml(c.linkedin_url)}" target="_blank" rel="noopener"><i class="fa-brands fa-linkedin"></i> LinkedIn</a>` : ''}
              ${c.careers_page ? `<a class="btn btn-outline btn-sm" href="${escapeHtml(c.careers_page)}" target="_blank" rel="noopener"><i class="fa-solid fa-briefcase"></i> صفحة الوظائف</a>` : ''}
              ${c.contact_page ? `<a class="btn btn-outline btn-sm" href="${escapeHtml(c.contact_page)}" target="_blank" rel="noopener"><i class="fa-solid fa-envelope"></i> اتصل بنا</a>` : ''}
            </div>
          </div>
          <div class="profile-actions">
            <button class="btn btn-primary btn-sm" id="cp-btn-hr"><i class="fa-solid fa-users"></i> اكتشاف HR</button>
            <button class="btn btn-primary btn-sm" id="cp-btn-emails"><i class="fa-solid fa-at"></i> اكتشاف الإيميلات</button>
            <button class="btn btn-outline btn-sm" id="cp-btn-refresh"><i class="fa-solid fa-rotate"></i> تحديث</button>
          </div>
        </div>

        <div class="card"><h3><i class="fa-solid fa-briefcase"></i> الوظائف (${companyJobs.length})</h3>
          ${companyJobs.length ? companyJobs.map(j => {
            const [bg, fg, label] = JOB_STATUS[j.job_status] || JOB_STATUS.Unknown;
            return `<div class="mini-row">
              <div><strong>${escapeHtml(j.job_title)}</strong>
                <span class="mini-badge" style="background:${bg};color:${fg}">${label}</span>
                ${(j.sources || []).map(s => `<span class="mini-badge" style="background:#ede9fe;color:#6d28d9">${escapeHtml(s)}</span>`).join('')}
              </div>
              ${j.job_url ? `<a href="${escapeHtml(j.job_url)}" target="_blank" rel="noopener" class="icon-btn"><i class="fa-solid fa-arrow-up-left-from-square"></i></a>` : ''}
            </div>`;
          }).join('') : '<p class="empty-line">لا توجد وظائف مسجلة لهذه الشركة.</p>'}
        </div>

        <div class="card"><h3><i class="fa-solid fa-users"></i> جهات اتصال HR (${contacts.length})</h3>
          <div id="cp-hr-progress"></div>
          ${contacts.length ? contacts.map(p => `
            <div class="contact-card">
              <div><strong>${escapeHtml(p.name)}</strong>
                ${p.job_title ? `<span style="color:var(--text-muted);font-size:.78rem"> — ${escapeHtml(p.job_title)}</span>` : ''}
                <br><span class="src-line">المصدر: ${escapeHtml(p.source || '—')} · آخر تحقق: ${fmtDate(p.last_verified)}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                ${p.email ? `<span class="email" style="font-family:monospace;direction:ltr">${escapeHtml(p.email)}</span> ${statusBadge(p.email_status)}` : ''}
                ${p.linkedin_url ? `<a href="${escapeHtml(p.linkedin_url)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm"><i class="fa-brands fa-linkedin"></i> الملف</a>` : ''}
              </div>
            </div>`).join('') : '<p class="empty-line">لم يُكتشف جهات اتصال بعد — اضغط "اكتشاف HR".</p>'}
        </div>

        <div class="card"><h3><i class="fa-solid fa-at"></i> الإيميلات (${visibleEmails.length})</h3>
          <div id="cp-email-progress"></div>
          ${visibleEmails.length ? visibleEmails.map(e => `
            <div class="mini-row">
              <div>
                <span style="font-family:monospace;direction:ltr">${escapeHtml(e.email)}</span>
                <span class="mini-badge" style="background:var(--primary-light);color:var(--primary)">${escapeHtml(e.type || 'General')}</span>
                ${statusBadge(e.status)}
                ${e.confidence ? `<span class="conf-badge">${e.confidence}%</span>` : ''}
                <br><span class="src-line">المصدر: ${escapeHtml(e.source || '—')}${e.source_url ? ` · <a href="${escapeHtml(e.source_url)}" target="_blank" rel="noopener">الرابط</a>` : ''} · آخر تحقق: ${fmtDate(e.last_verified)}</span>
              </div>
              <button class="icon-btn btn-copy" data-copy="${escapeHtml(e.email)}" title="نسخ"><i class="fa-solid fa-copy"></i></button>
            </div>`).join('') : '<p class="empty-line">لا توجد إيميلات — اضغط "اكتشاف الإيميلات".</p>'}
        </div>

        <div class="card"><h3><i class="fa-solid fa-file-signature"></i> طلبات التقديم (${companyApps.length})</h3>
          ${companyApps.length ? companyApps.map(a => `
            <div class="mini-row">
              <div><strong>${escapeHtml(a.job_title)}</strong>
                <span class="status-badge ${a.status}">${escapeHtml(a.status)}</span>
                <span class="src-line">${escapeHtml(a.applied_date || '')}</span></div>
              ${a.job_url ? `<a href="${escapeHtml(a.job_url)}" target="_blank" rel="noopener" class="icon-btn"><i class="fa-solid fa-link"></i></a>` : ''}
            </div>`).join('') : '<p class="empty-line">لا توجد طلبات تقديم لهذه الشركة.</p>'}
        </div>

        <div class="card"><h3><i class="fa-solid fa-clock-rotate-left"></i> سجل التواصل (${comms.length})</h3>
          ${comms.length ? `<div class="timeline">${comms.map(m => `
            <div class="timeline-item ${m.direction || 'outbound'}">
              <div class="timeline-dot"><i class="fa-solid ${COMM_ICONS[m.type] || 'fa-circle'}"></i></div>
              <div class="timeline-body">
                <div class="timeline-head"><strong>${COMM_LABELS[m.type] || m.type}</strong>
                  <span>${new Date(m.comm_date || m.created_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' })}</span></div>
                ${m.subject ? `<div class="timeline-subject">${escapeHtml(m.subject)}</div>` : ''}
                ${m.body ? `<div class="timeline-text">${escapeHtml(m.body.slice(0, 220))}${m.body.length > 220 ? '…' : ''}</div>` : ''}
              </div>
            </div>`).join('')}</div>` : '<p class="empty-line">لا يوجد تواصل مسجل بعد — يُسجَّل تلقائياً عند إرسال الرسائل.</p>'}
        </div>`;

      // أحداث الملف الشخصي
      container.querySelectorAll('.btn-copy').forEach(b =>
        b.addEventListener('click', () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('تم النسخ', 'success'))));

      document.getElementById('cp-btn-refresh')?.addEventListener('click', async e => {
        const btn = e.currentTarget;
        setLoading(btn, true, 'جارٍ التحديث...');
        try {
          await enrichCompany(c.name, { forceRefresh: true, websiteHint: c.website || '' });
          await openProfile(c.id);
          toast('تم تحديث بيانات الشركة', 'success');
        } catch (err) { toast(err.message, 'error'); setLoading(btn, false); }
      });

      document.getElementById('cp-btn-hr')?.addEventListener('click', async e => {
        const btn = e.currentTarget;
        const prog = document.getElementById('cp-hr-progress');
        setLoading(btn, true, 'جارٍ البحث...');
        prog.innerHTML = '<div class="progress-text" id="cp-hr-ptext"></div>';
        try {
          const n = await discoverHR(c, { onProgress: t => { const el = document.getElementById('cp-hr-ptext'); if (el) el.textContent = t; } });
          toast(n ? `تم اكتشاف ${n} جهة اتصال جديدة/محدثة` : 'لم يتم العثور على HR جدد من مصادر حقيقية', n ? 'success' : 'info');
          await openProfile(c.id);
        } catch (err) { toast(err.message, 'error'); setLoading(btn, false); }
      });

      document.getElementById('cp-btn-emails')?.addEventListener('click', async e => {
        const btn = e.currentTarget;
        const prog = document.getElementById('cp-email-progress');
        setLoading(btn, true, 'جارٍ البحث...');
        prog.innerHTML = '<div class="progress-text" id="cp-em-ptext"></div>';
        try {
          const n = await discoverEmails(c, { onProgress: t => { const el = document.getElementById('cp-em-ptext'); if (el) el.textContent = t; } });
          toast(n ? `تم العثور على ${n} إيميل` : 'لم يتم العثور على إيميلات حقيقية — لم نخمّن أي إيميل', n ? 'success' : 'info');
          await openProfile(c.id);
        } catch (err) { toast(err.message, 'error'); setLoading(btn, false); }
      });
    } catch (err) {
      container.innerHTML = `<div class="note-box" style="background:#fef2f2;border-color:#fecaca;color:#991b1b"><i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(err.message)}</div>`;
    }
  }

  /* ---------- اكتشاف شركة يدوياً من صفحة قاعدة الشركات ---------- */
  async function discoverCompanyManual() {
    const input = document.getElementById('company-search-input');
    const name = input.value.trim();
    if (!name) return toast('اكتب اسم الشركة أولاً', 'error');
    // إن كانت موجودة — افتح ملفها مباشرة
    const cached = await DB.findCompany(name);
    if (cached) { openProfile(cached.company.id); return; }
    try {
      const c = await enrichCompany(name);
      await refreshDb({ force: true });
      renderDbPage();
      if (c?.id) openProfile(c.id);
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ---------- ربط الواجهة ---------- */
  function init() {
    const searchInput = document.getElementById('company-filter-input');
    if (searchInput) searchInput.addEventListener('input', () => { state.filter = searchInput.value.trim(); renderDbPage(); });

    document.getElementById('btn-company-discover')?.addEventListener('click', discoverCompanyManual);
    document.getElementById('btn-companies-refresh')?.addEventListener('click', async e => {
      setLoading(e.currentTarget, true);
      await refreshDb({ force: true });
      renderDbPage();
      setLoading(e.currentTarget, false);
      toast('تم تحديث القائمة من قاعدة البيانات', 'success');
    });
    document.getElementById('btn-companies-csv')?.addEventListener('click', exportCsv);
    document.getElementById('company-sort-select')?.addEventListener('change', e => {
      state.sortKey = e.target.value;
      renderDbPage();
    });
    document.getElementById('btn-company-modal-save')?.addEventListener('click', saveEditModal);
    document.querySelectorAll('[data-close="company-modal"]').forEach(b =>
      b.addEventListener('click', () => document.getElementById('company-modal').classList.add('hidden')));
  }

  /** تُستدعى عند فتح صفحة قاعدة الشركات */
  async function loadDbPage() {
    await refreshDb();
    renderDbPage();
  }

  return {
    init, loadDbPage, openProfile, enrichCompany, discoverHR, discoverEmails,
    refreshDb, renderDbPage, SENDABLE_STATUSES
  };
})();
