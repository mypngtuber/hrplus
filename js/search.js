/* =====================================================================
 * search.js — محرك البحث الحقيقي: Serper Web Search + JSearch
 * - Serper يبحث في: LinkedIn + Wuzzuf + مواقع الشركات + Job Boards + Google
 * - لا Mock Data ولا بيانات مولدة بالـ AI — نتائج ويب حقيقية فقط
 * - Deduplication + Dead Job Detection + Job Freshness + Smart Cache
 * ===================================================================== */
const SearchModule = (() => {

  /* ============ Serper API ============ */
  async function serperSearch(query, { num = 10 } = {}) {
    const key = AppState.settings.serperKey;
    if (!key) throw new Error('مفتاح Serper غير مُعدّ — أضِفه من إدارة الـ APIs');
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'eg', hl: 'ar', num })
    });
    if (res.status === 403 || res.status === 401) throw new Error('مفتاح Serper غير صالح');
    if (res.status === 429) throw new Error('تجاوزت حد استخدام Serper');
    if (!res.ok) throw new Error(`Serper: HTTP ${res.status}`);
    return await res.json();
  }

  /* تصنيف مصدر النتيجة من الرابط */
  function classifySource(url) {
    const u = (url || '').toLowerCase();
    if (u.includes('linkedin.com')) return 'LinkedIn';
    if (u.includes('wuzzuf.net')) return 'Wuzzuf';
    if (/indeed|glassdoor|bayt|forasna|shaghlni|tanqeeb|jobzella|olx/i.test(u)) return 'Job Board';
    return 'Web Search';
  }

  /* استخراج شركة/مسمى من عنوان نتيجة البحث */
  function parseOrganicItem(item) {
    const url = item.link || '';
    const source = classifySource(url);
    let title = (item.title || '').replace(/\s*\|.*$/, '').trim();
    let company = '';

    // أنماط شائعة: "Job Title - Company | Site" / "Job Title at Company"
    let m = (item.title || '').match(/^(.+?)\s+(?:at|في|لدى)\s+([^|–—]+?)(?:\s*[|–—].*)?$/i);
    if (m) { title = m[1].trim(); company = m[2].trim(); }
    if (!company) {
      m = (item.title || '').match(/^(.+?)\s*[-–—]\s*([^|]+?)(?:\s*\|.*)?$/);
      if (m && m[2].length < 60 && !/jobs|وظائف|careers/i.test(m[2])) { title = m[1].trim(); company = m[2].trim(); }
    }
    if (source === 'Wuzzuf') {
      const wm = (item.title || '').match(/^(.+?)\s*-\s*([^-]+?)\s*-\s*Wuzzuf/i) || (item.title || '').match(/^(.+?)\s*at\s+(.+)$/i);
      if (wm) { title = wm[1].trim(); company = wm[2].replace(/\s*\|\s*Wuzzuf.*/i, '').trim(); }
    }
    if (!company) company = DB.extractCompanyFromLinkedIn(url) || '';
    // LinkedIn company pages
    if (/linkedin\.com\/company\//i.test(url) && !company) {
      company = decodeURIComponent(url.split('/company/')[1] || '').split('/')[0].replace(/-/g, ' ');
    }

    const snippet = item.snippet || '';
    return {
      job_title: title,
      company_name: company,
      location: extractLocation(snippet) || 'مصر',
      job_url: url,
      source,
      description: snippet.slice(0, 500),
      date_posted: item.date || '',
    };
  }

  function extractLocation(text) {
    const cities = ['القاهرة', 'Cairo', 'الإسكندرية', 'Alexandria', 'الجيزة', 'Giza', 'المنصورة', 'Mansoura', 'طنطا', 'أسيوط', 'New Cairo', 'القاهرة الجديدة', '6th of October', 'أكتوبر', 'Maadi', 'المعادي', 'Nasr City', 'مدينة نصر', 'Smart Village', 'القرية الذكية'];
    for (const c of cities) if (text.includes(c)) return c;
    return '';
  }

  /* فلتر مصر */
  const EGYPT_MARKERS = ['egypt', 'مصر', 'cairo', 'القاهرة', 'alexandria', 'الإسكندرية', 'giza', 'الجيزة', 'mansoura', 'المنصورة', 'maadi', 'المعادي', 'nasr city', 'مدينة نصر', 'smart village', 'أكتوبر', 'october', 'remote', 'عن بعد', 'عن بُعد'];
  function isEgyptRelated(job) {
    if (job.source === 'JSearch') return true; // مفلتر مسبقاً country=eg
    const hay = `${job.job_title} ${job.location} ${job.description} ${job.job_url}`.toLowerCase();
    return EGYPT_MARKERS.some(m => hay.includes(m.toLowerCase()));
  }

  /* ============ بناء استعلامات البحث المتعددة ============ */
  function buildQueries(query, city) {
    const loc = city && city !== 'Remote' ? city : 'Egypt';
    const locEn = city && city !== 'Remote' ? arabicCityToEn(city) : 'Egypt';
    const q = [];
    q.push({ q: `site:linkedin.com/jobs "${query}" Egypt`, label: 'LinkedIn' });
    q.push({ q: `site:wuzzuf.net "${query}"`, label: 'Wuzzuf' });
    q.push({ q: `"${query}" ${locEn} jobs`, label: 'Web' });
    q.push({ q: `"${query}" ${locEn} careers`, label: 'Careers' });
    q.push({ q: `"${query}" وظائف ${loc}`, label: 'Arabic' });
    return q;
  }
  function arabicCityToEn(c) {
    return { 'القاهرة': 'Cairo', 'الجيزة': 'Giza', 'الإسكندرية': 'Alexandria', 'المنصورة': 'Mansoura' }[c] || 'Egypt';
  }

  /* ============ JSearch (مصدر إضافي إن وُجد المفتاح) ============ */
  async function searchJSearch(query, city) {
    const key = AppState.settings.rapidApiKey;
    if (!key) return [];
    const q = encodeURIComponent(`${query} in ${city && city !== 'Remote' ? arabicCityToEn(city) + ', Egypt' : 'Egypt'}`);
    let url = `https://jsearch.p.rapidapi.com/search?query=${q}&page=1&num_pages=1&date_posted=month&country=eg`;
    if (city === 'Remote') url += '&remote_jobs_only=true';
    const res = await fetch(url, { headers: { 'x-rapidapi-host': 'jsearch.p.rapidapi.com', 'x-rapidapi-key': key } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map(j => ({
      job_title: j.job_title || '',
      company_name: j.employer_name || '',
      location: [j.job_city, 'مصر'].filter(Boolean).join('، '),
      job_url: j.job_apply_link || j.job_google_link || '',
      source: 'JSearch',
      description: (j.job_description || '').slice(0, 500),
      date_posted: j.job_posted_at_datetime_utc || '',
      remote: !!j.job_is_remote,
      website: j.employer_website || ''
    }));
  }

  /* ============ Deduplication (البند 10) ============ */
  function dedupeJobs(jobs) {
    const map = new Map();
    for (const j of jobs) {
      const key = j.job_url
        ? 'url:' + j.job_url.toLowerCase().split('?')[0].replace(/\/$/, '')
        : 'ct:' + DB.normalizeName(j.company_name) + '|' + DB.normalizeName(j.job_title) + '|' + DB.normalizeName(j.location);
      if (map.has(key)) {
        const ex = map.get(key);
        ex.sources = [...new Set([...ex.sources, j.source])];
        if (!ex.description && j.description) ex.description = j.description;
        if (!ex.date_posted && j.date_posted) ex.date_posted = j.date_posted;
        if (!ex.website && j.website) ex.website = j.website;
      } else {
        map.set(key, { ...j, sources: [j.source] });
      }
    }
    return [...map.values()];
  }

  /* ============ Dead Job Detection (البند 11) ============ */
  const CLOSED_PATTERNS = [
    /no longer (available|accepting)/i, /job (has )?(expired|closed|been filled)/i,
    /this job is no longer/i, /انتهت صلاحية/i, /الوظيفة (مغلقة|لم تعد متاحة)/i,
    /لم تعد متاحة/i, /انتهى التقديم/i, /position has been filled/i
  ];

  async function checkJobStatus(job) {
    if (!job.job_url) return 'Unknown';
    // فحص أولي من الـ snippet
    if (CLOSED_PATTERNS.some(p => p.test(job.description || ''))) return 'Closed';
    // محاولة HEAD/GET عبر fetch — كثير من المواقع تحظر CORS لذا الفشل = Unknown
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(job.job_url, { method: 'GET', mode: 'no-cors', signal: controller.signal });
      clearTimeout(t);
      // no-cors لا يكشف الحالة — نعتمد على نجاح الجلب فقط
      return 'Active';
    } catch (_) {
      return 'Unknown'; // CORS أو انتهاء المهلة — لا نستطيع الجزم
    }
  }

  /* ============ Job Freshness (البند 12) ============ */
  function jobAge(dateStr, searchDate) {
    const d = dateStr ? new Date(dateStr) : (searchDate ? new Date(searchDate) : null);
    if (!d || isNaN(d)) return { label: 'غير معروف', days: 999 };
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return { label: 'اليوم', days: 0 };
    if (days === 1) return { label: 'منذ يوم', days: 1 };
    if (days <= 7) return { label: `منذ ${days} أيام`, days };
    if (days <= 14) return { label: `منذ ${days} يوماً`, days };
    return { label: 'أقدم', days };
  }

  /* ============ البحث الشامل مع تقدم وإلغاء ============ */
  let abortFlag = false;
  function cancelSearch() { abortFlag = true; }

  /**
   * بحث شامل حقيقي عبر Serper (+ JSearch إن وُجد)
   * @returns { jobs, usedQueries, stats }
   */
  async function searchAll(query, city, { onProgress } = {}) {
    abortFlag = false;
    const hasSerper = !!AppState.settings.serperKey;
    const hasJSearch = !!AppState.settings.rapidApiKey;
    if (!hasSerper && !hasJSearch) return { jobs: [], usedQueries: [], noKeys: true };

    // توسيع الاستعلامات من الـ CV بالـ AI (تحليل فقط — ليس توليد وظائف)
    const queries = await expandQueries(query);
    const usedQueries = [];
    const rawJobs = [];
    const errors = [];

    // 1) JSearch لأول استعلامين
    if (hasJSearch) {
      for (const q of queries.slice(0, 2)) {
        if (abortFlag) break;
        try {
          onProgress?.(`JSearch: ${q}`);
          rawJobs.push(...await searchJSearch(q, city));
          usedQueries.push(`JSearch: ${q}`);
        } catch (e) { errors.push(e.message); }
      }
    }

    // 2) Serper: عدة queries لكل استعلام أساسي
    if (hasSerper) {
      for (const baseQ of queries.slice(0, 2)) {
        for (const { q, label } of buildQueries(baseQ, city).slice(0, 4)) {
          if (abortFlag) break;
          try {
            onProgress?.(`Serper (${label}): ${baseQ}`);
            const data = await serperSearch(q, { num: 10 });
            usedQueries.push(q);
            (data.organic || []).forEach(item => {
              const job = parseOrganicItem(item);
              if (job.job_title && job.job_url && isEgyptRelated(job)) rawJobs.push(job);
            });
          } catch (e) { errors.push(e.message); if (/غير صالح|429/.test(e.message)) { abortFlag = true; } }
          await new Promise(r => setTimeout(r, 250));
        }
      }
    }

    if (abortFlag && !rawJobs.length) return { jobs: [], usedQueries, cancelled: true };

    // 3) Deduplication
    const unique = dedupeJobs(rawJobs);

    // 4) حفظ في قاعدة البيانات (Smart Cache) + كشف الجديد
    let newCount = 0;
    for (const j of unique) {
      try {
        const { record, isNew } = await DB.upsertJob({
          job_title: j.job_title, company_name: j.company_name,
          location: j.location, job_url: j.job_url,
          sources: j.sources, description: j.description,
          date_posted: j.date_posted, job_status: j.job_status || 'Unknown'
        });
        j.dbId = record.id;
        j.isNew = isNew;
        if (isNew) newCount++;
      } catch (_) { j.isNew = false; }
    }

    // 5) تسجيل في سجل البحث
    try {
      await DB.logSearch({
        query: query || queries[0] || '', location: city || 'مصر',
        sources_used: [...new Set(unique.flatMap(j => j.sources))],
        results_count: unique.length, new_jobs_count: newCount
      });
    } catch (_) { /* غير حرج */ }

    return { jobs: unique, usedQueries, errors, newCount, cancelled: abortFlag };
  }

  /* ---------- توسيع الاستعلامات من الـ CV (تحليل AI فقط) ---------- */
  async function expandQueries(baseQuery) {
    const profile = AppState.cvProfile;
    if (!profile || !AI.isConfigured()) return baseQuery ? [baseQuery] : [];
    try {
      const prompt = `بناءً على الملف المهني التالي:
- المسميات السابقة: ${(profile.job_titles || []).join('، ')}
- المهارات: ${(profile.skills || []).slice(0, 15).join('، ')}
- المجالات: ${(profile.industries || []).join('، ')}

${baseQuery ? `المستخدم يستهدف وظيفة: "${baseQuery}"` : 'لم يحدد المستخدم وظيفة — استنتج الأنسب من ملفه.'}

اقترح 3 مسميات وظيفية للبحث في سوق العمل المصري. لا تلتزم بنفس المجال حرفياً — اكتشف مجالات مختلفة تناسب مهاراته القابلة للنقل.
أعد JSON: {"queries": ["<استعلام إنجليزي 1>", "<2>", "<3>"]}`;
      const r = await AI.generateJSON(prompt, { maxTokens: 512 });
      const qs = (r.queries || []).filter(Boolean).slice(0, 3);
      return qs.length ? qs : (baseQuery ? [baseQuery] : []);
    } catch (_) {
      return baseQuery ? [baseQuery] : [];
    }
  }

  /* ---------- روابط بديلة (بدون مفاتيح) ---------- */
  function renderFallback(container, query, city) {
    const q = encodeURIComponent(query || '');
    const links = [
      { name: 'LinkedIn — مصر', cls: 'linkedin', icon: 'fa-linkedin', url: `https://www.linkedin.com/jobs/search/?keywords=${q}&location=Egypt` },
      { name: 'Wuzzuf', cls: 'wuzzuf', icon: 'fa-magnifying-glass', url: `https://wuzzuf.net/search/jobs/?q=${q}` },
      { name: 'Indeed — مصر', cls: 'indeed', icon: 'fa-magnifying-glass', url: `https://eg.indeed.com/jobs?q=${q}&l=Egypt` },
      { name: 'Google — شركات توظف في مصر', cls: 'google-link', icon: 'fa-google', url: `https://www.google.com/search?q=${encodeURIComponent((query || '') + ' وظائف شركات مصر توظف')}` }
    ];
    container.innerHTML = `
      <div class="note-box" style="margin-top:14px"><i class="fa-solid fa-circle-info"></i>
      <span>لم يُضَف مفتاح <strong>Serper</strong> بعد — أضِفه من <button class="link-btn" data-goto-link="settings">إدارة الـ APIs</button> ليعمل البحث الحقيقي داخل التطبيق. حتى ذلك الحين، روابط مباشرة:</span></div>
      <div class="platform-links">
        ${links.map(l => `<a class="platform-link ${l.cls}" href="${l.url}" target="_blank" rel="noopener"><i class="fa-brands ${l.icon}"></i> ${l.name}</a>`).join('')}
      </div>`;
    container.querySelectorAll('[data-goto-link]').forEach(el =>
      el.addEventListener('click', () => document.querySelector(`.nav-btn[data-view="${el.dataset.gotoLink}"]`)?.click()));
  }

  /* ---------- شارات المصادر ---------- */
  function renderSourceChips(container) {
    const chips = [
      { name: 'Serper (LinkedIn · Wuzzuf · Web)', active: !!AppState.settings.serperKey },
      { name: 'JSearch', active: !!AppState.settings.rapidApiKey },
      { name: 'روابط مباشرة (بدون مفاتيح)', active: true }
    ];
    container.innerHTML = chips.map(c =>
      `<span class="source-chip ${c.active ? 'active' : 'inactive'}">
        <i class="fa-solid ${c.active ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${c.name}</span>`).join('');
  }

  return {
    serperSearch, searchAll, cancelSearch, dedupeJobs, checkJobStatus, jobAge,
    expandQueries, renderFallback, renderSourceChips, classifySource, parseOrganicItem, isEgyptRelated
  };
})();

/* مساعد مشترك */
DB.extractCompanyFromLinkedIn = function (url) {
  const m = (url || '').match(/linkedin\.com\/company\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).replace(/-/g, ' ') : '';
};
