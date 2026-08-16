/* =====================================================================
 * search.js — محرك البحث متعدد المصادر بتركيز جغرافي على مصر
 * المصادر: JSearch (RapidAPI) + Google Custom Search (LinkedIn / Wuzzuf / عام)
 * مع توسيع ذكي لكلمات البحث بناءً على الـ CV (مجالات مختلفة لكن مناسبة)
 * ===================================================================== */
const SearchModule = (() => {

  const EGYPT_MARKERS = ['egypt', 'مصر', 'cairo', 'القاهرة', 'alexandria', 'الإسكندرية', 'giza', 'الجيزة', 'mansoura', 'المنصورة', 'eg'];

  /* ---------- توسيع كلمات البحث من الـ CV ---------- */
  async function expandQueries(baseQuery) {
    const profile = AppState.cvProfile;
    if (!profile || !AI.isConfigured()) return baseQuery ? [baseQuery] : [];
    try {
      const prompt = `بناءً على الملف المهني التالي:
- المسميات السابقة: ${(profile.job_titles || []).join('، ')}
- المهارات: ${(profile.skills || []).slice(0, 15).join('، ')}
- المجالات: ${(profile.industries || []).join('، ')}

${baseQuery ? `المستخدم يستهدف وظيفة: "${baseQuery}"` : 'لم يحدد المستخدم وظيفة — استنتج الأنسب من ملفه.'}

اقترح 3 مسميات وظيفية للبحث في سوق العمل المصري. لا تلتزم بنفس المجال حرفياً — اكتشف مجالات مختلفة تناسب مهاراته وخبراته القابلة للنقل.
أعد JSON: {"queries": ["<استعلام بحث إنجليزي 1>", "<استعلام 2>", "<استعلام 3>"]}`;
      const r = await AI.generateJSON(prompt, { maxTokens: 512 });
      const queries = (r.queries || []).filter(Boolean).slice(0, 3);
      return queries.length ? queries : (baseQuery ? [baseQuery] : []);
    } catch (_) {
      return baseQuery ? [baseQuery] : [];
    }
  }

  /* ---------- المصدر 1: JSearch ---------- */
  async function searchJSearch(query, city) {
    const key = AppState.settings.rapidApiKey;
    if (!key) return [];
    const q = encodeURIComponent(`${query} in ${city && city !== 'Remote' ? city + ', Egypt' : 'Egypt'}`);
    let url = `https://jsearch.p.rapidapi.com/search?query=${q}&page=1&num_pages=1&date_posted=month&country=eg`;
    if (city === 'Remote') url += '&remote_jobs_only=true';
    const res = await fetch(url, {
      headers: { 'x-rapidapi-host': 'jsearch.p.rapidapi.com', 'x-rapidapi-key': key }
    });
    if (!res.ok) throw new Error(`JSearch: HTTP ${res.status}`);
    const data = await res.json();
    return (data.data || []).map(j => ({
      source: 'jsearch',
      title: j.job_title || '',
      company: j.employer_name || '',
      location: [j.job_city, j.job_country].filter(Boolean).join('، ') || 'مصر',
      url: j.job_apply_link || j.job_google_link || '',
      description: (j.job_description || '').slice(0, 400),
      remote: !!j.job_is_remote,
      date: j.job_posted_at_datetime_utc || '',
      website: j.employer_website || ''
    }));
  }

  /* ---------- المصدر 2: Google CSE (LinkedIn / Wuzzuf / عام) ---------- */
  async function searchGoogle(query, city) {
    const { googleApiKey, googleCx } = AppState.settings;
    if (!googleApiKey || !googleCx) return [];

    const cityPart = city && city !== 'Remote' ? ` "${city}"` : '';
    const searches = [
      { source: 'linkedin', q: `site:linkedin.com/jobs "${query}" مصر${cityPart}` },
      { source: 'wuzzuf', q: `site:wuzzuf.net/jobs "${query}"${cityPart}` },
      { source: 'google', q: `"${query}" وظائف${cityPart} مصر` }
    ];

    const results = [];
    await Promise.all(searches.map(async s => {
      try {
        const res = await fetch(
          `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(googleApiKey)}&cx=${encodeURIComponent(googleCx)}&q=${encodeURIComponent(s.q)}&num=6&gl=eg&hl=ar`
        );
        if (!res.ok) return;
        const data = await res.json();
        (data.items || []).forEach(item => {
          const parsed = parseSearchItem(item, s.source);
          if (parsed && isEgyptRelated(parsed)) results.push(parsed);
        });
      } catch (_) { /* تجاهل أخطاء مصدر واحد */ }
    }));
    return results;
  }

  function parseSearchItem(item, source) {
    const url = item.link || '';
    if (source === 'linkedin' && !/linkedin\.com\/(jobs|company)/i.test(url)) return null;
    if (source === 'wuzzuf' && !/wuzzuf\.net/i.test(url)) return null;

    // استخراج الشركة والمسمى من العنوان
    let title = (item.title || '').replace(/\s*\|.*$/, '').replace(/\s*-\s*(LinkedIn|وظف|Wuzzuf|وظائف).*$/i, '').trim();
    let company = '';
    const companyMatch = (item.title || '').match(/(?:at|في|لدى)\s+([^|–—-]+)/i);
    if (companyMatch) company = companyMatch[1].trim();
    // محاولة من الـ pagemap
    const meta = item.pagemap?.metatags?.[0] || {};
    if (!company && meta['og:site_name'] === 'Wuzzuf') {
      const m = (item.title || '').match(/-\s*([^-]+)$/);
      if (m) company = m[1].trim();
    }

    return {
      source,
      title: title || item.title || '',
      company: company || extractCompanyFromUrl(url) || '—',
      location: 'مصر',
      url,
      description: (item.snippet || '').slice(0, 300),
      remote: false,
      date: '',
      website: ''
    };
  }

  function extractCompanyFromUrl(url) {
    const m = url.match(/linkedin\.com\/company\/([^/?#]+)/i);
    if (m) return decodeURIComponent(m[1]).replace(/-/g, ' ');
    return '';
  }

  /* ---------- فلتر مصر ---------- */
  function isEgyptRelated(job) {
    const haystack = `${job.title} ${job.location} ${job.description}`.toLowerCase();
    if (job.source === 'jsearch') return true; // مفلتر مسبقاً بـ country=eg
    return EGYPT_MARKERS.some(m => haystack.includes(m));
  }

  /* ---------- البحث الشامل ---------- */
  async function searchAll(query, city) {
    const queries = await expandQueries(query);
    if (!queries.length) queries.push(query || 'وظائف');

    const hasKeys = AppState.settings.rapidApiKey || (AppState.settings.googleApiKey && AppState.settings.googleCx);
    if (!hasKeys) return { jobs: [], usedQueries: queries, noKeys: true };

    const allJobs = [];
    const errors = [];

    // JSearch لكل استعلام
    if (AppState.settings.rapidApiKey) {
      for (const q of queries.slice(0, 2)) {
        try { allJobs.push(...await searchJSearch(q, city)); }
        catch (e) { errors.push(e.message); }
      }
    }
    // Google CSE لأول استعلامين
    if (AppState.settings.googleApiKey && AppState.settings.googleCx) {
      for (const q of queries.slice(0, 2)) {
        try { allJobs.push(...await searchGoogle(q, city)); }
        catch (e) { errors.push(e.message); }
      }
    }

    // إزالة التكرار (نفس الرابط أو نفس العنوان+الشركة)
    const seen = new Set();
    const unique = allJobs.filter(j => {
      const key = (j.url || `${j.title}|${j.company}`).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return j.title;
    });

    return { jobs: unique, usedQueries: queries, errors };
  }

  /* ---------- روابط بديلة (بدون مفاتيح) ---------- */
  function fallbackLinks(query, city) {
    const q = encodeURIComponent(query || '');
    const cityQ = encodeURIComponent(city && city !== 'Remote' ? city : 'Egypt');
    return [
      { name: 'LinkedIn — مصر', cls: 'linkedin', icon: 'fa-linkedin',
        url: `https://www.linkedin.com/jobs/search/?keywords=${q}&location=Egypt` },
      { name: 'Wuzzuf', cls: 'wuzzuf', icon: 'fa-magnifying-glass',
        url: `https://wuzzuf.net/search/jobs/?q=${q}${city && city !== 'Remote' ? '&filters[city][0]=' + cityQ : ''}` },
      { name: 'Indeed — مصر', cls: 'indeed', icon: 'fa-magnifying-glass',
        url: `https://eg.indeed.com/jobs?q=${q}&l=${cityQ}` },
      { name: 'Glassdoor', cls: 'glassdoor', icon: 'fa-door-open',
        url: `https://www.glassdoor.com/Job/egypt-jobs-SRCH_IL.0,5_IN69_KO6,${6 + (query || '').length}.htm?sc.keyword=${q}` },
      { name: 'Google — شركات توظف في مصر', cls: 'google-link', icon: 'fa-google',
        url: `https://www.google.com/search?q=${encodeURIComponent((query || '') + ' وظائف شركات مصر توظف')}` }
    ];
  }

  function renderFallback(container, query, city) {
    const links = fallbackLinks(query, city);
    container.innerHTML = `
      <div class="note-box" style="margin-top:14px"><i class="fa-solid fa-circle-info"></i>
      <span>لم تُضَف مفاتيح بحث بعد (JSearch أو Google CSE) — هذه روابط بحث مباشرة جاهزة بتركيز مصر. أضف المفاتيح من <button class="link-btn" data-goto-link="settings">إدارة الـ APIs</button> لجمع النتائج تلقائياً داخل التطبيق.</span></div>
      <div class="platform-links">
        ${links.map(l => `<a class="platform-link ${l.cls}" href="${l.url}" target="_blank" rel="noopener"><i class="fa-brands ${l.icon}"></i> ${l.name}</a>`).join('')}
      </div>`;
    container.querySelectorAll('[data-goto-link]').forEach(el =>
      el.addEventListener('click', () => document.querySelector(`.nav-btn[data-view="${el.dataset.gotoLink}"]`)?.click()));
  }

  /* ---------- عرض النتائج ---------- */
  const SOURCE_LABELS = { jsearch: 'JSearch', linkedin: 'LinkedIn', wuzzuf: 'Wuzzuf', google: 'Google' };

  function renderJobs(container, jobs, { selectable = false } = {}) {
    if (!jobs.length) {
      container.innerHTML = '<div class="note-box" style="margin-top:14px"><i class="fa-solid fa-circle-info"></i><span>لا نتائج داخل مصر لهذا البحث — جرّب مسمى أوسع أو فعّل مصادر إضافية.</span></div>';
      return;
    }
    container.innerHTML = jobs.map((j, i) => `
      <div class="job-card ${selectable ? 'job-select-card' : ''}">
        ${selectable ? `<input type="checkbox" class="job-check" data-idx="${i}" checked>` : ''}
        <div style="flex:1;min-width:220px">
          <h4>${escapeHtml(j.title)} <span class="source-tag ${j.source}">${SOURCE_LABELS[j.source] || j.source}</span></h4>
          <div class="job-meta">
            <span><i class="fa-solid fa-building"></i> ${escapeHtml(j.company)}</span>
            <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(j.location)}</span>
            ${j.remote ? '<span><i class="fa-solid fa-wifi"></i> عن بُعد</span>' : ''}
            ${j.date ? `<span><i class="fa-solid fa-calendar"></i> ${new Date(j.date).toLocaleDateString('ar-EG')}</span>` : ''}
          </div>
          ${j.description ? `<p class="job-desc">${escapeHtml(j.description)}…</p>` : ''}
        </div>
        <div class="job-card-actions">
          ${j.url ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(j.url)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> فتح</a>` : ''}
          <button class="btn btn-outline btn-sm btn-track-job" data-idx="${i}"><i class="fa-solid fa-plus"></i> تتبّع</button>
        </div>
      </div>`).join('');

    container.querySelectorAll('.btn-track-job').forEach(btn => {
      btn.addEventListener('click', async () => {
        const j = jobs[+btn.dataset.idx];
        try {
          await TrackerModule.create({
            company: j.company, job_title: j.title,
            location: j.location, job_url: j.url, status: 'sent'
          });
          toast('أُضيفت الوظيفة إلى لوحة التتبع', 'success');
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  /* ---------- شارات المصادر النشطة ---------- */
  function renderSourceChips(container) {
    const chips = [
      { name: 'JSearch', active: !!AppState.settings.rapidApiKey },
      { name: 'LinkedIn (عبر Google CSE)', active: !!(AppState.settings.googleApiKey && AppState.settings.googleCx) },
      { name: 'Wuzzuf (عبر Google CSE)', active: !!(AppState.settings.googleApiKey && AppState.settings.googleCx) },
      { name: 'Google Search', active: !!(AppState.settings.googleApiKey && AppState.settings.googleCx) },
      { name: 'روابط مباشرة (بدون مفاتيح)', active: true }
    ];
    container.innerHTML = chips.map(c =>
      `<span class="source-chip ${c.active ? 'active' : 'inactive'}">
        <i class="fa-solid ${c.active ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${c.name}</span>`
    ).join('');
  }

  return { searchAll, expandQueries, renderJobs, renderFallback, renderSourceChips, fallbackLinks };
})();
