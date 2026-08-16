/* =====================================================================
 * agent.js — AI Job Hunter Agent + عمليات البحث المحفوظة (Saved Searches)
 *
 * خط الأنابيب:
 *   Search → Collect → Dedupe → Validate → Match → FindCompany → Domain
 *   → HR → VerifiedEmail → Rank → Prepare → [Review & Approve — إلزامي]
 *
 * لا يُرسل أي إيميل تلقائياً إطلاقاً — مراجعة المستخدم إلزامية.
 * ===================================================================== */
const AgentModule = (() => {

  const TABLE = 'saved_searches';
  let running = false;
  let cancelFlag = false;

  /* =====================================================================
   * Saved Searches (البند 20)
   * ===================================================================== */
  async function fetchSavedSearches() {
    return await DB.list(TABLE, { limit: 100, force: true });
  }

  async function addSavedSearch(title, query, city) {
    await DB.create(TABLE, { title, query, city, is_active: true, last_run: null });
    await renderSavedSearches();
  }

  async function removeSavedSearch(id) {
    await DB.remove(TABLE, id);
    await renderSavedSearches();
  }

  async function runSavedSearch(s) {
    const { jobs, newCount } = await SearchModule.searchAll(s.query, s.city || '', {
      onProgress: t => setProgress(`[${s.title}] ${t}`)
    });
    await DB.update(TABLE, s.id, { last_run: Date.now() });
    return { jobs: jobs || [], newCount: newCount || 0 };
  }

  async function renderSavedSearches() {
    const container = document.getElementById('saved-searches-list');
    if (!container) return;
    const items = await fetchSavedSearches();
    container.innerHTML = items.map(s => `
      <div class="mini-row">
        <div>
          <strong>${escapeHtml(s.title)}</strong>
          <span class="src-line ltr">${escapeHtml(s.query)} ${s.city ? '· ' + escapeHtml(s.city) : ''}</span>
          ${s.last_run ? `<span class="src-line">آخر تشغيل: ${new Date(s.last_run).toLocaleDateString('ar-EG')}</span>` : ''}
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-outline btn-sm btn-run-search" data-id="${s.id}"><i class="fa-solid fa-play"></i> تشغيل</button>
          <button class="icon-btn btn-del-search" data-id="${s.id}" title="حذف" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`).join('') ||
      '<p class="empty-line">لا توجد عمليات بحث محفوظة — أضف واحدة أعلاه أو احفظ إعدادات الوكيل الحالية.</p>';

    container.querySelectorAll('.btn-run-search').forEach(b => b.addEventListener('click', async () => {
      const items2 = await fetchSavedSearches();
      const s = items2.find(x => x.id === b.dataset.id);
      if (!s) return;
      setLoading(b, true);
      try {
        const { jobs, newCount } = await runSavedSearch(s);
        toast(`"${s.title}": ${jobs.length} نتيجة (${newCount} جديدة)`, 'success');
        await renderSavedSearches();
        DashboardModule.refresh().catch(() => {});
      } catch (err) { toast(err.message, 'error'); }
      finally { setLoading(b, false); }
    }));
    container.querySelectorAll('.btn-del-search').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('حذف عملية البحث المحفوظة؟')) return;
      await removeSavedSearch(b.dataset.id);
      toast('تم الحذف', 'success');
    }));
  }

  /** Search All — تشغيل كل عمليات البحث المحفوظة بالتتابع */
  async function runAllSavedSearches() {
    const items = await fetchSavedSearches();
    const active = items.filter(s => s.is_active !== false);
    if (!active.length) return toast('لا توجد عمليات بحث محفوظة', 'error');
    if (running) return toast('هناك عملية تعمل بالفعل', 'error');
    running = true; cancelFlag = false;
    let totalNew = 0;
    showAgentProgress(true);
    for (let i = 0; i < active.length; i++) {
      if (cancelFlag) break;
      const s = active[i];
      try {
        const { newCount } = await runSavedSearch(s);
        totalNew += newCount;
        logStep(`✔ "${s.title}": اكتمل (${newCount} وظيفة جديدة)`);
      } catch (err) { logStep(`✖ "${s.title}": ${err.message}`, true); }
    }
    running = false;
    showAgentProgress(false);
    await renderSavedSearches();
    DashboardModule.refresh().catch(() => {});
    toast(cancelFlag ? 'أُلغي التشغيل' : `اكتمل Search All — ${totalNew} وظيفة جديدة`, 'success');
  }

  /* =====================================================================
   * Job Hunter Agent (البند 22)
   * ===================================================================== */
  const agentState = { prepared: [], results: [] };

  function setProgress(text) {
    const el = document.getElementById('agent-progress-text');
    if (el) el.textContent = text;
  }
  function logStep(text, isErr = false) {
    const log = document.getElementById('agent-log');
    if (!log) return;
    log.innerHTML += `<div class="send-log-item ${isErr ? 'err' : 'ok'}"><i class="fa-solid ${isErr ? 'fa-circle-xmark' : 'fa-circle-check'}"></i> ${escapeHtml(text)}</div>`;
    log.scrollTop = log.scrollHeight;
  }
  function showAgentProgress(show) {
    document.getElementById('agent-progress')?.classList.toggle('hidden', !show);
    if (!show) setProgress('');
  }
  function setStep(stepId, status) { // status: active | done | ''
    document.querySelectorAll('.agent-step').forEach(el => el.classList.remove('active'));
    const el = document.getElementById(`astep-${stepId}`);
    if (el) {
      el.classList.remove('active');
      if (status) el.classList.add(status);
      if (status === 'done') el.querySelector('i')?.classList.replace('fa-circle', 'fa-circle-check');
    }
  }
  function markStepsUntil(stepId) {
    const order = ['search', 'dedupe', 'validate', 'match', 'company', 'hr', 'email', 'rank', 'prepare', 'review'];
    for (const s of order) {
      setStep(s, 'done');
      if (s === stepId) break;
    }
  }

  function readAgentCriteria() {
    return {
      targetJob: document.getElementById('agent-target').value.trim(),
      location: document.getElementById('agent-location').value,
      experience: document.getElementById('agent-experience').value,
      remote: document.getElementById('agent-remote').value,
      salary: document.getElementById('agent-salary').value.trim(),
      industries: document.getElementById('agent-industries').value.trim(),
      minMatch: +(document.getElementById('agent-min-match').value || 0)
    };
  }

  async function runAgent() {
    if (running) return toast('الوكيل يعمل بالفعل', 'error');
    const criteria = readAgentCriteria();
    if (!criteria.targetJob && !AppState.cvProfile) {
      return toast('حدّد الوظيفة المستهدفة أو فعّل CV ليستنتج الوكيل', 'error');
    }
    if (!AppState.settings.serperKey && !AppState.settings.rapidApiKey) {
      return toast('أضف مفتاح Serper (أو JSearch) من إدارة الـ APIs أولاً', 'error');
    }

    running = true; cancelFlag = false;
    agentState.results = [];
    agentState.prepared = [];
    document.getElementById('agent-log').innerHTML = '';
    document.getElementById('agent-review').innerHTML = '';
    document.getElementById('agent-review-actions').classList.add('hidden');
    document.querySelectorAll('.agent-step').forEach(el => {
      el.classList.remove('active', 'done');
      const ic = el.querySelector('i.fa-circle-check');
      if (ic) ic.classList.replace('fa-circle-check', 'fa-circle');
    });
    showAgentProgress(true);

    try {
      /* 1) Search + Collect */
      setStep('search', 'active');
      setProgress('البحث في LinkedIn وWuzzuf والويب داخل مصر...');
      const city = criteria.remote === 'remote' ? 'Remote' : (criteria.location || '');
      const { jobs, newCount } = await SearchModule.searchAll(criteria.targetJob, city, {
        onProgress: t => setProgress(t)
      });
      if (cancelFlag) throw new Error('ألغى المستخدم العملية');
      if (!jobs.length) {
        logStep('لم يُعثر على وظائف مطابقة — جرّب مسمى أوسع');
        return;
      }
      setStep('search', 'done');
      logStep(`جُمعت ${jobs.length} وظيفة حقيقية (${newCount} جديدة)`);

      /* 2) Dedupe (تم داخل searchAll) + فلترة المجالات */
      setStep('dedupe', 'active');
      let filtered = jobs;
      if (criteria.industries) {
        const inds = criteria.industries.split(/[,،]/).map(s => s.trim()).filter(Boolean);
        if (inds.length && AI.isConfigured()) {
          setProgress('تصنيف الوظائف حسب المجالات المستهدفة...');
          // فلترة نصية بسيطة أولاً — لا نحذف شيئاً إلا إذا كان واضحاً
          filtered = jobs.filter(j => {
            const hay = `${j.job_title} ${j.company_name} ${j.description}`.toLowerCase();
            return inds.some(i => hay.includes(i.toLowerCase())) || true; // لا نستبعد — فقط نرتب
          });
        }
      }
      setStep('dedupe', 'done');
      logStep(`إزالة التكرار: ${filtered.length} وظيفة فريدة`);

      /* 3) Validate (Dead Job Detection — سريع: الأنماط فقط) */
      setStep('validate', 'active');
      setProgress('فحص حالة الوظائف (مغلقة/نشطة)...');
      let closed = 0;
      for (const j of filtered) {
        if (cancelFlag) throw new Error('ألغى المستخدم العملية');
        j.job_status = await SearchModule.checkJobStatus(j);
        if (j.job_status === 'Closed' || j.job_status === 'Expired') closed++;
        if (j.dbId) DB.update('jobs', j.dbId, { job_status: j.job_status }).catch(() => {});
      }
      const alive = filtered.filter(j => j.job_status !== 'Closed' && j.job_status !== 'Expired');
      setStep('validate', 'done');
      logStep(`التحقق: ${alive.length} نشطة/غير مؤكدة — ${closed} مغلقة (مستبعدة)`);

      /* 4) Match — تحليل التطابق بالـ AI */
      let ranked = alive;
      if (AI.isConfigured() && (AppState.cvProfile || AppState.cvRawText)) {
        setStep('match', 'active');
        const maxAnalyze = alive.slice(0, 15); // حد أقصى 15 لحماية الحصة
        await MatchModule.analyzeAllJobs(maxAnalyze, { onProgress: t => setProgress(t) });
        if (cancelFlag) throw new Error('ألغى المستخدم العملية');
        ranked = [...maxAnalyze, ...alive.slice(15)];
        setStep('match', 'done');
        logStep(`حُلّل التطابق لأفضل ${Math.min(15, alive.length)} وظيفة`);
      } else {
        logStep('تخطي تحليل التطابق — فعّل Gemini وCV للحصول عليه');
        setStep('match', 'done');
      }

      // فلترة بحد أدنى للتطابق
      let qualified = ranked;
      if (criteria.minMatch > 0 && AI.isConfigured()) {
        qualified = ranked.filter(j => j.match?.score == null || j.match.score >= criteria.minMatch);
        logStep(`بعد فلتر ${criteria.minMatch}%+: ${qualified.length} وظيفة مؤهلة`);
      }

      /* 5) FindCompany + Domain + HR + VerifiedEmail (أفضل 5 فقط لحماية حصص الـ API) */
      const topJobs = qualified.slice(0, 5);
      for (let i = 0; i < topJobs.length; i++) {
        if (cancelFlag) throw new Error('ألغى المستخدم العملية');
        const job = topJobs[i];
        if (!job.company_name) continue;

        setStep('company', 'active');
        setProgress(`(${i + 1}/${topJobs.length}) إثراء شركة: ${job.company_name}`);
        try {
          const company = await CompanyModule.enrichCompany(job.company_name, { websiteHint: job.website || '' });
          job.companyId = company?.id || '';
          job.companyDomain = company?.domain || '';
          if (job.dbId && company?.id) DB.update('jobs', job.dbId, { company_id: company.id }).catch(() => {});
        } catch (_) { /* نكمل */ }

        setStep('hr', 'active');
        if (job.companyId && AppState.settings.serperKey) {
          setProgress(`(${i + 1}/${topJobs.length}) اكتشاف HR: ${job.company_name}`);
          try { job.hrFound = await CompanyModule.discoverHR({ id: job.companyId, name: job.company_name }); }
          catch (_) { job.hrFound = 0; }
        }

        setStep('email', 'active');
        if (job.companyId) {
          setProgress(`(${i + 1}/${topJobs.length}) اكتشاف الإيميلات: ${job.company_name}`);
          try {
            await CompanyModule.discoverEmails({ id: job.companyId, name: job.company_name, domain: job.companyDomain || '' });
            const emails = await DB.companyEmails(job.companyId);
            // لا Guessed إطلاقاً — صالح للإرسال فقط
            const sendable = emails.filter(e => CompanyModule.SENDABLE_STATUSES.includes(e.status));
            const best = sendable.find(e => ['HR', 'Recruitment', 'Careers', 'Hiring'].includes(e.type)) || sendable[0];
            job.verifiedEmail = best?.email || '';
            job.verifiedEmailStatus = best?.status || '';
          } catch (_) { /* نكمل */ }
        }
      }
      ['company', 'hr', 'email'].forEach(s => setStep(s, 'done'));

      /* 6) Rank + Prepare */
      setStep('rank', 'active');
      qualified.sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1));
      setStep('rank', 'done');
      setStep('prepare', 'active');
      agentState.results = qualified;
      agentState.prepared = qualified.slice(0, 5).map(j => ({
        job: j, companyId: j.companyId || '', email: j.verifiedEmail || '',
        selected: !!j.verifiedEmail
      }));
      setStep('prepare', 'done');

      /* 7) Review & Approve — إلزامي قبل أي إجراء */
      setStep('review', 'active');
      renderAgentReview();
      showAgentProgress(false);
      logStep('✔ اكتمل التحضير — راجع النتائج واعتمد ما تريد');
      toast('اكتمل عمل الوكيل — الخطوة الأخيرة: المراجعة والاعتماد', 'success');
    } catch (err) {
      logStep(err.message, true);
      toast(err.message, 'error');
    } finally {
      running = false;
      showAgentProgress(false);
    }
  }

  /* ---------- عرض نتائج الوكيل للمراجعة ---------- */
  function renderAgentReview() {
    const container = document.getElementById('agent-review');
    if (!container) return;

    container.innerHTML = agentState.results.map((j, i) => {
      const age = SearchModule.jobAge(j.date_posted, j.search_date);
      const srcs = (j.sources || []).map(s => `<span class="mini-badge" style="background:#ede9fe;color:#6d28d9">${escapeHtml(s)}</span>`).join('');
      const emailInfo = j.verifiedEmail
        ? `<span class="mini-badge" style="background:#d1fae5;color:#047857"><i class="fa-solid fa-shield-halved"></i> ${escapeHtml(j.verifiedEmail)} (${j.verifiedEmailStatus})</span>`
        : '<span class="mini-badge" style="background:#f1f5f9;color:#64748b">لا يوجد إيميل صالح — لن يُرسل</span>';
      return `<div class="job-card">
        <div style="flex:1;min-width:220px">
          <h4>${escapeHtml(j.job_title)} ${MatchModule.matchBadge(j.match?.score)}</h4>
          <div class="job-meta">
            <span><i class="fa-solid fa-building"></i> ${escapeHtml(j.company_name || '—')}</span>
            <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(j.location || 'مصر')}</span>
            <span><i class="fa-solid fa-clock"></i> ${age.label}</span>
          </div>
          <div style="margin-top:6px">${srcs} ${emailInfo}</div>
          ${j.match ? MatchModule.renderMatchDetails(j.match) : ''}
        </div>
        <div class="job-card-actions">
          ${j.job_url ? `<a class="btn btn-outline btn-sm" href="${escapeHtml(j.job_url)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-left-from-square"></i> فتح</a>` : ''}
          <button class="btn btn-outline btn-sm btn-agent-tailor" data-idx="${i}"><i class="fa-solid fa-wand-magic-sparkles"></i> خصّص CV</button>
          <button class="btn btn-outline btn-sm btn-agent-track" data-idx="${i}"><i class="fa-solid fa-plus"></i> أضِف للتتبع</button>
        </div>
      </div>`;
    }).join('') || '<p class="empty-line">لا توجد نتائج.</p>';

    // أزرار المراجعة السفلية
    const actions = document.getElementById('agent-review-actions');
    if (agentState.results.length) {
      actions.classList.remove('hidden');
      const withEmail = agentState.prepared.filter(p => p.email);
      document.getElementById('agent-review-summary').innerHTML =
        `<strong>${agentState.results.length}</strong> وظيفة مرتبة · <strong>${withEmail.length}</strong> منها بإيميل صالح للإرسال · يمكن إرسالها للحملة الذكية للمراجعة النهائية`;
    }

    container.querySelectorAll('.btn-agent-track').forEach(b => b.addEventListener('click', async () => {
      const j = agentState.results[+b.dataset.idx];
      try {
        await TrackerModule.create({
          company: j.company_name || '—', job_title: j.job_title, location: j.location || 'مصر',
          job_url: j.job_url || '', contact_email: j.verifiedEmail || '', status: 'found',
          source: (j.sources || []).join(' + '), company_id: j.companyId || '', job_id: j.dbId || '',
          cv_id: AppState.activeCvId || '',
          notes: `أضافها الوكيل — تطابق: ${j.match?.score ?? '؟'}%`
        });
        toast('أُضيفت إلى لوحة التتبع', 'success');
      } catch (err) { toast(err.message, 'error'); }
    }));

    container.querySelectorAll('.btn-agent-tailor').forEach(b => b.addEventListener('click', async () => {
      const j = agentState.results[+b.dataset.idx];
      const btn = b;
      setLoading(btn, true, 'جارٍ التخصيص...');
      try {
        const result = await MatchModule.tailorCvForJob(j);
        MatchModule.openTailoredResult(result);
      } catch (err) { toast(err.message, 'error'); }
      finally { setLoading(btn, false); }
    }));
  }

  /** إرسال نتائج الوكيل المعتمدة إلى الحملة الذكية (مراجعة ثانية إلزامية هناك) */
  function sendToCampaign() {
    const withEmail = agentState.prepared.filter(p => p.selected && p.email);
    if (!withEmail.length) return toast('لا توجد وظائف معتمدة بإيميل صالح', 'error');
    // دمج مع وظائف الحملة الحالية بدون فقدانها
    const existing = new Set(AppState.campaignJobs.map(j => (j.job_url || j.url || '') + '|' + (j.company || '')));
    for (const p of withEmail) {
      const key = (p.job.job_url || '') + '|' + (p.job.company_name || '');
      if (existing.has(key)) continue;
      AppState.campaignJobs.push({
        ...p.job,
        company: p.job.company_name,
        title: p.job.job_title,
        url: p.job.job_url,
        contactEmail: p.email,
        contactName: '',
        domain: p.job.companyDomain || '',
        industry: '', expMatch: null
      });
    }
    document.querySelector('.nav-btn[data-view="campaign"]')?.click();
    toast(`أُرسلت ${withEmail.length} وظيفة إلى الحملة الذكية — راجع واعتمد هناك قبل الإرسال`, 'success');
  }

  /* =====================================================================
   * ربط الواجهة
   * ===================================================================== */
  function init() {
    document.getElementById('btn-agent-run')?.addEventListener('click', runAgent);
    document.getElementById('btn-agent-cancel')?.addEventListener('click', () => {
      cancelFlag = true;
      SearchModule.cancelSearch();
      toast('جارٍ إيقاف الوكيل...', 'info');
    });
    document.getElementById('btn-add-saved-search')?.addEventListener('click', async () => {
      const query = document.getElementById('ss-query').value.trim();
      const city = document.getElementById('ss-city').value;
      if (!query) return toast('أدخل المسمى الوظيفي', 'error');
      const title = `${query}${city ? ' — ' + city : ' — مصر'}`;
      try {
        await addSavedSearch(title, query, city);
        document.getElementById('ss-query').value = '';
        toast('حُفظ البحث', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
    document.getElementById('btn-search-all')?.addEventListener('click', runAllSavedSearches);
    document.getElementById('btn-agent-to-campaign')?.addEventListener('click', sendToCampaign);
    document.getElementById('btn-agent-save-search')?.addEventListener('click', async () => {
      const c = readAgentCriteria();
      if (!c.targetJob) return toast('حدّد الوظيفة المستهدفة أولاً', 'error');
      try {
        await addSavedSearch(`${c.targetJob}${c.location ? ' — ' + c.location : ' — مصر'}`, c.targetJob, c.location);
        toast('حُفظت إعدادات الوكيل كبحث محفوظ', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });

    renderSavedSearches().catch(() => {});
  }

  return { init, runAgent, renderSavedSearches, runAllSavedSearches };
})();
