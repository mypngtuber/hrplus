/* =====================================================================
 * gap.js — تحليل الفجوة المهنية واقتراح مسار التعلّم
 * ===================================================================== */
const GapModule = (() => {

  const PLATFORM_STYLES = {
    coursera: { color: '#0056d2', icon: 'fa-graduation-cap', name: 'Coursera' },
    udemy: { color: '#a435f0', icon: 'fa-circle-play', name: 'Udemy' },
    youtube: { color: '#ff0000', icon: 'fa-youtube', name: 'YouTube' },
    edx: { color: '#02262b', icon: 'fa-book-open', name: 'edX' }
  };

  async function analyzeGap(cvText, role) {
    const prompt = `أنت مستشار مهني خبير في تحليل سوق العمل المصري. قارن السيرة الذاتية التالية بمتطلبات سوق العمل الحالية لوظيفة "${role}" في مصر.

السيرة الذاتية:
"""
${cvText.slice(0, 10000)}
"""

أعد JSON بالبنية التالية حرفياً:
{
  "match_percentage": <نسبة التطابق الحالية من 0 إلى 100>,
  "summary": "<تحليل موجز في 3 أسطر بالعربية>",
  "owned_skills": ["<مهارة يمتلكها بالفعل وذُكرت في السيرة>"],
  "missing_hard_skills": [
    {"skill": "<اسم المهارة التقنية الناقصة>", "importance": "high|medium|low", "reason": "<لماذا يطلبها السوق — سطر واحد>"}
  ],
  "missing_soft_skills": ["<مهارة شخصية ناقصة>"],
  "courses": [
    {"skill": "<المهارة التي يغطيها الكورس>", "title": "<اسم كورس حقيقي موجود>", "platform": "coursera|udemy|youtube|edx", "search_query": "<عبارة بحث دقيقة بالإنجليزية للعثور على الكورس>", "level": "مبتدئ|متوسط|متقدم"}
  ],
  "learning_path": ["<خطوة 1 من خطة التعلم المرتبة زمنياً>", "<خطوة 2>"]
}
- اذكر من 4 إلى 8 مهارات تقنية ناقصة كحد أقصى، مرتبة بالأهمية.
- اقترح كورساً واحداً لكل مهارة ناقصة مهمة (بحد أقصى 6 كورسات) ووزّعها على المنصات الأربع.
- كل النصوص بالعربية ما عدا أسماء الكورسات وعبارات البحث.`;
    return await AI.generateJSON(prompt, { maxTokens: 6000 });
  }

  function courseUrl(platform, searchQuery) {
    const q = encodeURIComponent(searchQuery);
    switch (platform) {
      case 'coursera': return `https://www.coursera.org/search?query=${q}`;
      case 'udemy': return `https://www.udemy.com/courses/search/?q=${q}`;
      case 'youtube': return `https://www.youtube.com/results?search_query=${q}`;
      case 'edx': return `https://www.edx.org/search?q=${q}`;
      default: return `https://www.google.com/search?q=${q}`;
    }
  }

  function render(container, r) {
    const importanceBadge = { high: ['عالية', '#fee2e2', '#b91c1c'], medium: ['متوسطة', '#fef3c7', '#b45309'], low: ['منخفضة', '#e0e7ff', '#4338ca'] };

    container.innerHTML = `
      <div class="result-box">
        <h4><i class="fa-solid fa-gauge-high"></i> نسبة التطابق الحالية مع السوق: ${r.match_percentage ?? '؟'}%</h4>
        <div class="score-bar"><div class="score-bar-fill" style="width:0%"></div></div>
        <p>${escapeHtml(r.summary || '')}</p>

        <h4><i class="fa-solid fa-circle-check" style="color:var(--success)"></i> مهارات تمتلكها بالفعل</h4>
        <div>${(r.owned_skills || []).map(s => `<span class="skill-tag owned"><i class="fa-solid fa-check"></i> ${escapeHtml(s)}</span>`).join('') || '—'}</div>

        <h4><i class="fa-solid fa-screwdriver-wrench" style="color:var(--danger)"></i> المهارات التقنية الناقصة (Hard Skills)</h4>
        ${(r.missing_hard_skills || []).map(s => {
          const [label, bg, color] = importanceBadge[s.importance] || importanceBadge.medium;
          return `<div class="contact-card">
            <div><strong>${escapeHtml(s.skill)}</strong>
            <span class="status-badge" style="background:${bg};color:${color};margin-right:8px">${label}</span>
            <div style="font-size:.78rem;color:var(--text-muted);margin-top:4px">${escapeHtml(s.reason || '')}</div></div>
          </div>`;
        }).join('') || '<p>لا يوجد</p>'}

        <h4><i class="fa-solid fa-handshake" style="color:var(--warning)"></i> المهارات الشخصية الناقصة (Soft Skills)</h4>
        <div>${(r.missing_soft_skills || []).map(s => `<span class="skill-tag soft"><i class="fa-solid fa-user-plus"></i> ${escapeHtml(s)}</span>`).join('') || '—'}</div>

        <h4><i class="fa-solid fa-graduation-cap" style="color:var(--primary)"></i> الكورسات الموصى بها</h4>
        ${(r.courses || []).map(c => {
          const p = PLATFORM_STYLES[c.platform] || PLATFORM_STYLES.youtube;
          return `<div class="course-card">
            <div class="platform-icon" style="background:${p.color}"><i class="fa-solid ${p.icon}"></i></div>
            <h4>${escapeHtml(c.title)}<div class="course-skill"><i class="fa-solid fa-bullseye"></i> ${escapeHtml(c.skill)} · ${escapeHtml(c.level || '')} · ${p.name}</div></h4>
            <a class="btn btn-outline btn-sm" href="${courseUrl(c.platform, c.search_query || c.title)}" target="_blank" rel="noopener">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> فتح الكورس</a>
          </div>`;
        }).join('') || '<p>لا يوجد</p>'}

        <h4><i class="fa-solid fa-route" style="color:var(--primary)"></i> مسار التعلّم المقترح</h4>
        <ol style="padding-right:22px;line-height:2">${(r.learning_path || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
      </div>`;

    requestAnimationFrame(() => {
      const bar = container.querySelector('.score-bar-fill');
      if (bar) bar.style.width = `${r.match_percentage || 0}%`;
    });
  }

  function init() {
    document.getElementById('btn-analyze-gap').addEventListener('click', async e => {
      const btn = e.currentTarget;
      const role = document.getElementById('gap-role').value.trim();
      const cvText = document.getElementById('gap-cv-text').value.trim() || AppState.cvRawText;
      const container = document.getElementById('gap-results');

      if (!role) return toast('أدخل الوظيفة المستهدفة', 'error');
      if (cvText.length < 50) return toast('الصق نص سيرتك أو فعّل نسخة CV محفوظة من صفحة الـ CV', 'error');
      if (!AI.isConfigured()) return toast('أعدّ مفتاح Gemini من إدارة الـ APIs أولاً', 'error');

      setLoading(btn, true, 'جارٍ تحليل الفجوة المهارية...');
      try {
        const result = await analyzeGap(cvText, role);
        render(container, result);
        toast('اكتمل تحليل الفجوة المهارية', 'success');
      } catch (err) { toast(err.message, 'error'); }
      finally { setLoading(btn, false); }
    });
  }

  return { init };
})();
