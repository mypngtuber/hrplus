/* =====================================================================
 * db.js — طبقة قاعدة البيانات: Cache-First + منع التكرار + توحيد الأسماء
 * تعمل فوق RESTful Table API المدمج (لا يوجد Backend منفصل في هذا المشروع).
 *
 * منع التكرار (Unique Constraints منطقية):
 *   companies:        normalized_name
 *   company_emails:   company_id + email
 *   company_contacts: company_id + linkedin_url (أو name+title)
 *   jobs:             company_id + job_url (أو company+title+location)
 * ===================================================================== */
const DB = (() => {

  /* ---------- أدوات توحيد ---------- */
  function normalizeName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/[^a-z0-9ء-ي]/g, '')
      .trim();
  }

  function extractDomain(url) {
    try {
      return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, '').toLowerCase();
    } catch (_) { return ''; }
  }

  const now = () => Date.now();
  const DAY = 86400000;
  const FRESH_DAYS = 14; // البيانات "حديثة" إذا تحققنا منها خلال 14 يوماً

  /* ---------- CRUD عام مع كاش في الذاكرة ---------- */
  const cache = {};

  async function list(table, { limit = 300, force = false } = {}) {
    if (!force && cache[table] && (Date.now() - cache[table].at < 60000)) return cache[table].rows;
    const res = await fetch(`tables/${table}?limit=${limit}&sort=-created_at`);
    if (!res.ok) throw new Error(`تعذر تحميل ${table}`);
    const data = await res.json();
    const rows = (data.data || []).filter(r => !r.deleted);
    cache[table] = { rows, at: Date.now() };
    return rows;
  }

  function invalidate(table) { delete cache[table]; }

  async function create(table, fields) {
    const res = await fetch(`tables/${table}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    if (!res.ok) throw new Error(`فشل الحفظ في ${table}`);
    invalidate(table);
    return await res.json();
  }

  async function update(table, id, fields) {
    const res = await fetch(`tables/${table}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    if (!res.ok) throw new Error(`فشل التحديث في ${table}`);
    invalidate(table);
    return await res.json();
  }

  async function remove(table, id) {
    const res = await fetch(`tables/${table}/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error(`فشل الحذف من ${table}`);
    invalidate(table);
  }

  /* ---------- الشركات: Smart Cache ---------- */

  /** ابحث عن شركة في القاعدة أولاً. يعيد { company, fresh } أو null */
  async function findCompany(name) {
    const norm = normalizeName(name);
    if (!norm) return null;
    const rows = await list('companies');
    const company = rows.find(c => c.normalized_name === norm) || null;
    if (!company) return null;
    const fresh = company.last_verified && (Date.now() - company.last_verified < FRESH_DAYS * DAY);
    return { company, fresh };
  }

  /** إنشاء أو تحديث شركة (upsert بالاسم الموحد) */
  async function upsertCompany(fields) {
    const norm = normalizeName(fields.normalized_name || fields.name);
    const rows = await list('companies');
    const existing = rows.find(c => c.normalized_name === norm);
    const payload = { ...fields, normalized_name: norm, last_verified: now() };
    if (existing) {
      // دمج المصادر بدون تكرار
      const mergedSources = [...new Set([...(existing.sources || []), ...(fields.sources || [])])];
      return await update('companies', existing.id, { ...payload, sources: mergedSources });
    }
    return await create('companies', { ...payload, country: fields.country || 'مصر' });
  }

  /* ---------- الإيميلات: منع تكرار company_id + email ---------- */
  async function upsertEmail(companyId, fields) {
    const email = String(fields.email || '').toLowerCase().trim();
    if (!email) return null;
    const rows = await list('company_emails');
    const existing = rows.find(e => e.company_id === companyId && String(e.email).toLowerCase() === email);
    if (existing) {
      // رفع الحالة إن تحسنت + تحديث last_verified
      const rank = { Guessed: 0, Invalid: 1, Unverified: 2, Found: 3, Verified: 4 };
      const newStatus = (rank[fields.status] || 0) >= (rank[existing.status] || 0) ? fields.status : existing.status;
      return await update('company_emails', existing.id, {
        ...fields, email, status: newStatus,
        confidence: Math.max(fields.confidence || 0, existing.confidence || 0),
        last_verified: now()
      });
    }
    return await create('company_emails', { ...fields, email, company_id: companyId, first_found: now(), last_verified: now() });
  }

  async function companyEmails(companyId) {
    const rows = await list('company_emails');
    return rows.filter(e => e.company_id === companyId);
  }

  /* ---------- جهات الاتصال: منع تكرار company_id + linkedin_url ---------- */
  async function upsertContact(companyId, fields) {
    const li = String(fields.linkedin_url || '').toLowerCase().trim();
    const rows = await list('company_contacts');
    const existing = rows.find(c => c.company_id === companyId && (
      (li && String(c.linkedin_url || '').toLowerCase() === li) ||
      (!li && c.name === fields.name && c.job_title === fields.job_title)
    ));
    if (existing) {
      return await update('company_contacts', existing.id, { ...fields, last_verified: now() });
    }
    return await create('company_contacts', { ...fields, company_id: companyId, first_found: now(), last_verified: now() });
  }

  async function companyContacts(companyId) {
    const rows = await list('company_contacts');
    return rows.filter(c => c.company_id === companyId);
  }

  /* ---------- الوظائف: منع تكرار company+url أو company+title+location ---------- */
  function jobDedupeKey(j) {
    if (j.job_url) return 'url:' + j.job_url.toLowerCase().split('?')[0].replace(/\/$/, '');
    return 'ct:' + normalizeName(j.company_name) + '|' + normalizeName(j.job_title) + '|' + normalizeName(j.location);
  }

  async function upsertJob(fields) {
    const rows = await list('jobs');
    const key = jobDedupeKey(fields);
    const existing = rows.find(j => jobDedupeKey(j) === key);
    if (existing) {
      const mergedSources = [...new Set([...(existing.sources || []), ...(fields.sources || [])])];
      return { record: await update('jobs', existing.id, {
        ...fields, sources: mergedSources, is_new: false
      }), isNew: false };
    }
    return { record: await create('jobs', { ...fields, is_new: true, search_date: now() }), isNew: true };
  }

  /* ---------- تسجيل التواصل ---------- */
  async function logCommunication(fields) {
    return await create('communications', { ...fields, comm_date: now() });
  }

  async function companyCommunications(companyId) {
    const rows = await list('communications');
    return rows.filter(c => c.company_id === companyId).sort((a, b) => (b.comm_date || 0) - (a.comm_date || 0));
  }

  /* ---------- سجل البحث ---------- */
  async function logSearch(fields) {
    return await create('search_history', { ...fields, search_date: now() });
  }

  return {
    normalizeName, extractDomain, FRESH_DAYS,
    list, create, update, remove, invalidate,
    findCompany, upsertCompany, upsertEmail, companyEmails,
    upsertContact, companyContacts, upsertJob, jobDedupeKey,
    logCommunication, companyCommunications, logSearch
  };
})();
