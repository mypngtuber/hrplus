/* =====================================================================
 * matching.js — المطابقة الذكية CV ↔ وظيفة + ترشيح أفضل نسخة CV
 *               + زر "حسّن CV لهذه الوظيفة" (بدون اختلاق خبرات)
 * الـ AI هنا للتحليل فقط — لا يخترع وظائف ولا بيانات.
 * ===================================================================== */
const MatchModule = (() => {

  /* =====================================================================
   * 1) تحليل مطابقة وظيفة واحدة مقابل الـ CV النشط
   * ===================================================================== */
  async function analyzeJobMatch(job) {
    if (!AI.isConfigured()) throw new Error('أعدّ مفتاح Gemini من إدارة الـ APIs أولاً');
    const profile = AppState.cvProfile;
    if (!profile && !AppState.cvRawText) throw new Error('فعّل نسخة CV محفوظة أولاً ليتم التحليل');

    const profilePart = profile ? `
الملف المهني للمرشح:
- المسميات: ${(profile.job_titles || []).join('، ')}
- المهارات: ${(profile.skills || []).join('، ')}
- المجالات: ${(profile.industries || []).join('، ')}
- التعليم: ${(profile.education || []).join('، ')}
- سنوات الخبرة: ${profile.years_experience || 'غير محددة'}
- كلمات مفتاحية: ${(profile.keywords || []).join('، ')}` : `
نص سيرة المرشح (مختصر):
"""${AppState.cvRawText.slice(0, 2500)}"""`;

    const prompt = `أنت خبير توظيف. قارن ملف المرشح التالي بالوظيفة المعلنة، وأنتج تقييم مطابقة دقيقاً وصادقاً (لا تبالغ).

${profilePart}

الوظيفة:
- المسمى: ${job.job_title}
- الشركة: ${job.company_name || job.company || 'غير معروفة'}
- الموقع: ${job.location || 'مصر'}
- الوصف: """${(job.description || '').slice(0, 1200)}"""

أعد JSON بهذه البنية حرفياً (كل النصوص بالعربية):
{
  "score": <0-100>,
  "skills_match": "<جملة قصيرة>",
  "experience_match": "<جملة قصيرة>",
  "education_match": "<جملة قصيرة>",
  "location_match": "<جملة قصيرة>",
  "seniority_match": "<جملة قصيرة>",
  "keywords_match": ["<كلمات مشتركة>"],
  "missing_skills": ["<مهارات مطلوبة غير موجودة>"],
  "strengths": ["<نقاط قوة المرشح لهذه الوظيفة>"],
  "weaknesses": ["<نقاط ضعف>"]
}`;
    return await AI.generateJSON(prompt, { maxTokens: 2048, temperature: 0.3 });
  }

  /** تخزين نتيجة التحليل في سجل الوظيفة */
  async function saveMatch(jobDbId, analysis) {
    if (!jobDbId) return;
    try {
      await DB.update('jobs', jobDbId, {
        match_score: analysis.score || 0,
        match_analysis: JSON.stringify(analysis)
      });
    } catch (_) { /* غير حرج */ }
  }

  /* =====================================================================
   * 2) تحليل جماعي + ترتيب تنازلي حسب الدرجة
   * ===================================================================== */
  let analyzing = false;
  async function analyzeAllJobs(jobs, { onProgress } = {}) {
    if (analyzing) return jobs;
    analyzing = true;
    let done = 0;
    for (const job of jobs) {
      if (job.match?.score != null) { done++; continue; }
      try {
        onProgress?.(`تحليل التطابق (${done + 1}/${jobs.length}): ${job.job_title}`);
        const analysis = await analyzeJobMatch(job);
        job.match = analysis;
        if (job.dbId) await saveMatch(job.dbId, analysis);
      } catch (e) {
        job.match = { error: e.message };
      }
      done++;
      onProgress?.(`تحليل التطابق (${done}/${jobs.length})`);
      await new Promise(r => setTimeout(r, 700)); // احترام حدود Gemini
    }
    analyzing = false;
    // ترتيب من الأعلى تطابقاً إلى الأقل
    jobs.sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1));
    return jobs;
  }

  /* ---------- عرض بطاقة المطابقة ---------- */
  function matchBadge(score) {
    if (score == null) return '';
    const cls = score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low';
    return `<span class="match-badge ${cls}"><i class="fa-solid fa-bullseye"></i> تطابق ${score}%</span>`;
  }

  function renderMatchDetails(m) {
    if (!m) return '';
    if (m.error) return `<div class="note-box small" style="background:#fef2f2;border-color:#fecaca;color:#991b1b"><i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(m.error)}</div>`;
    const line = (icon, label, val) => val ? `<div class="match-line"><i class="fa-solid ${icon}"></i> <strong>${label}:</strong> ${escapeHtml(val)}</div>` : '';
    const tags = (arr, cls) => (arr || []).length ? arr.map(s => `<span class="skill-tag ${cls}">${escapeHtml(s)}</span>`).join('') : '';
    return `<div class="match-details">
      <div class="score-bar"><div class="score-bar-fill" style="width:${m.score || 0}%"></div></div>
      ${line('fa-screwdriver-wrench', 'المهارات', m.skills_match)}
      ${line('fa-briefcase', 'الخبرة', m.experience_match)}
      ${line('fa-graduation-cap', 'التعليم', m.education_match)}
      ${line('fa-location-dot', 'الموقع', m.location_match)}
      ${line('fa-layer-group', 'المستوى الوظيفي', m.seniority_match)}
      ${m.keywords_match?.length ? `<div class="match-line"><i class="fa-solid fa-key"></i> <strong>كلمات مشتركة:</strong> ${tags(m.keywords_match, 'owned')}</div>` : ''}
      ${m.missing_skills?.length ? `<div class="match-line"><i class="fa-solid fa-circle-minus"></i> <strong>مهارات ناقصة:</strong> ${tags(m.missing_skills, 'missing')}</div>` : ''}
      ${m.strengths?.length ? `<div class="match-line"><i class="fa-solid fa-circle-check" style="color:var(--success)"></i> <strong>نقاط القوة:</strong> ${(m.strengths).map(escapeHtml).join(' · ')}</div>` : ''}
      ${m.weaknesses?.length ? `<div class="match-line"><i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> <strong>نقاط الضعف:</strong> ${(m.weaknesses).map(escapeHtml).join(' · ')}</div>` : ''}
    </div>`;
  }

  /* =====================================================================
   * 3) ترشيح أفضل نسخة CV لوظيفة (CV Versions — البند 18)
   * ===================================================================== */
  async function recommendBestCv(job) {
    const cvs = AppState.savedCvs;
    if (!cvs.length) return null;
    if (cvs.length === 1) {
      const only = cvs[0];
      return { cv: only, score: only.id === AppState.activeCvId ? (job.match?.score ?? null) : null, single: true };
    }
    if (!AI.isConfigured()) return null;

    // ملخصات النسخ للمقارنة السريعة
    const cvSummaries = cvs.map((c, i) => {
      let desc = c.name;
      try {
        const p = c.profile_json ? JSON.parse(c.profile_json) : null;
        if (p) desc += ` — مهارات: ${(p.skills || []).slice(0, 8).join('، ')} — مسميات: ${(p.job_titles || []).slice(0, 3).join('، ')}`;
      } catch (_) { /* تجاهل */ }
      return `${i + 1}. ${desc}`;
    }).join('\n');

    try {
      const r = await AI.generateJSON(`لدي ${cvs.length} نسخ سيرة ذاتية:
${cvSummaries}

الوظيفة: "${job.job_title}" في "${job.company_name || ''}" — ${(job.description || '').slice(0, 500)}

أي نسخة هي الأنسب لهذه الوظيفة؟ أعد JSON فقط:
{"best_index": <رقم النسخة 1..${cvs.length}>, "match": <0-100>, "reason": "<سبب قصير بالعربية>"}`, { maxTokens: 512, temperature: 0.2 });
      const idx = (r.best_index || 1) - 1;
      if (idx >= 0 && idx < cvs.length) return { cv: cvs[idx], score: r.match, reason: r.reason };
    } catch (_) { /* تجاهل */ }
    return null;
  }

  /* =====================================================================
   * 4) تخصيص الـ CV لوظيفة محددة (AI CV Tailoring — البند 19)
   *    ممنوع اختلاق خبرات أو مهارات أو شهادات.
   * ===================================================================== */
  async function tailorCvForJob(job) {
    if (!AI.isConfigured()) throw new Error('أعدّ مفتاح Gemini من إدارة الـ APIs أولاً');
    const cvText = AppState.cvRawText;
    if (!cvText || cvText.length < 50) throw new Error('فعّل نسخة CV أولاً');

    const prompt = `أنت خبير ATS وكاتب سير ذاتية. حلّل السيرة الذاتية مقابل الوظيفة التالية واقترح تحسينات دقيقة.

الوظيفة: "${job.job_title}" — ${job.company_name || ''}
الوصف: """${(job.description || '').slice(0, 1500)}"""

السيرة الذاتية الحالية:
"""${cvText.slice(0, 9000)}"""

القواعد الصارمة:
- ممنوع منعاً باتاً اختلاق خبرات أو مهارات أو شهادات غير موجودة في السيرة.
- التحسينات تعتمد فقط على إعادة الصياغة والترتيب وإبراز الموجود.

أعد JSON بهذه البنية:
{
  "summary_improvements": ["<اقتراح لتحسين الملخص المهني>"],
  "relevant_skills": ["<مهارات موجودة في السيرة يجب إبرازها لهذه الوظيفة>"],
  "keyword_improvements": ["<كلمات مفتاحية من الوظيفة يجب تضمينها بصياغة صادقة>"],
  "missing_keywords": ["<كلمات مهمة غير موجودة — للتعلّم وليس للادعاء>"],
  "experience_ordering": "<كيف تعيد ترتيب/تقديم خبراته الموجودة لتناسب الوظيفة>",
  "tailored_cv": "<النسخة المخصصة الكاملة من السيرة — نفس الحقائق بصياغة وترتيب أفضل>"
}`;
    return await AI.generateJSON(prompt, { maxTokens: 8192, temperature: 0.45 });
  }

  /** فتح نتيجة التخصيص في تبويب الـ CV (عرض المقارنة + التصدير الجاهز) */
  function openTailoredResult(result) {
    document.querySelector('.nav-btn[data-view="cv"]')?.click();
    const original = AppState.cvRawText;
    document.getElementById('cv-original-view').value = original;
    document.getElementById('cv-optimized-view').value = result.tailored_cv || '';
    document.getElementById('cv-compare').classList.remove('hidden');
    document.getElementById('cv-export-card').style.display = '';

    // عرض التحليل في صندوق النتائج
    const box = document.getElementById('cv-analysis-result');
    const list = arr => (arr || []).map(x => `<li>${escapeHtml(x)}</li>`).join('') || '<li>—</li>';
    box.innerHTML = `
      <h4><i class="fa-solid fa-wand-magic-sparkles"></i> نتيجة التخصيص للوظيفة</h4>
      <h4><i class="fa-solid fa-align-right"></i> تحسينات الملخص المهني</h4><ul>${list(result.summary_improvements)}</ul>
      <h4><i class="fa-solid fa-screwdriver-wrench" style="color:var(--success)"></i> مهارات يجب إبرازها</h4><ul>${list(result.relevant_skills)}</ul>
      <h4><i class="fa-solid fa-key"></i> تحسينات الكلمات المفتاحية</h4><ul>${list(result.keyword_improvements)}</ul>
      <h4><i class="fa-solid fa-circle-minus" style="color:var(--danger)"></i> كلمات ناقصة (للتعلّم — لا تدّعها)</h4><ul>${list(result.missing_keywords)}</ul>
      <h4><i class="fa-solid fa-arrow-down-wide-short"></i> ترتيب الخبرات المقترح</h4><p>${escapeHtml(result.experience_ordering || '')}</p>`;
    box.classList.remove('hidden');
    toast('تم تخصيص الـ CV — راجع المقارنة وصدّر النسخة', 'success');
  }

  return { analyzeJobMatch, analyzeAllJobs, saveMatch, matchBadge, renderMatchDetails, recommendBestCv, tailorCvForJob, openTailoredResult };
})();
