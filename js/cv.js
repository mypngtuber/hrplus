/* =====================================================================
 * cv.js — معالج السيرة الذاتية: استخراج PDF/DOCX، حفظ/استرجاع النسخ،
 *         استخراج الملف المهني بالـ AI، تحسين ATS، تصدير PDF/DOCX
 * ===================================================================== */
const CVModule = (() => {
  const TABLE = 'cv_profiles';

  /* ---------- استخراج النص من الملفات ---------- */
  async function extractFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') return await extractPdf(file);
    if (ext === 'docx') return await extractDocx(file);
    if (ext === 'txt') return await file.text();
    throw new Error('صيغة غير مدعومة — الرجاء رفع PDF أو DOCX أو TXT');
  }

  async function extractPdf(file) {
    if (typeof pdfjsLib === 'undefined') throw new Error('مكتبة PDF لم تُحمَّل بعد');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let lastY = null;
      for (const item of content.items) {
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 4) text += '\n';
        text += item.str;
        lastY = item.transform[5];
      }
      text += '\n\n';
    }
    return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function extractDocx(file) {
    if (typeof mammoth === 'undefined') throw new Error('مكتبة DOCX لم تُحمَّل بعد');
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value.trim();
  }

  /* ---------- استخراج الملف المهني بالـ AI ---------- */
  async function extractProfile(cvText) {
    const prompt = `حلّل السيرة الذاتية التالية واستخرج الملف المهني بدقة.

السيرة الذاتية:
"""
${cvText.slice(0, 10000)}
"""

أعد JSON بالبنية التالية حرفياً:
{
  "name": "<اسم صاحب السيرة>",
  "job_titles": ["<المسميات الوظيفية السابقة والحالية>"],
  "skills": ["<أهم المهارات التقنية والشخصية — حتى 20>"],
  "industries": ["<المجالات/القطاعات التي عمل بها — مثل: بنوك، اتصالات، تعليم، تصنيع>"],
  "education": ["<المؤهلات>"],
  "years_experience": <رقم تقديري>,
  "keywords": ["<أهم الكلمات المفتاحية>"],
  "summary": "<ملخص مهني في سطرين بالعربية>"
}`;
    return await AI.generateJSON(prompt, { maxTokens: 2048 });
  }

  /* ---------- إدارة نسخ الـ CV المحفوظة ---------- */
  async function fetchSavedCvs() {
    const res = await fetch(`tables/${TABLE}?limit=50&sort=-created_at`);
    if (!res.ok) return [];
    const data = await res.json();
    AppState.savedCvs = (data.data || []).filter(r => !r.deleted);
    return AppState.savedCvs;
  }

  async function saveCvProfile(name, rawText) {
    // استخراج الملف المهني إن أمكن (غير مانع عند الفشل)
    let profile = null;
    if (AI.isConfigured()) {
      try { profile = await extractProfile(rawText); }
      catch (e) { console.warn('تعذر استخراج الملف المهني:', e); }
    }

    // إلغاء تفعيل النسخ الأخرى
    for (const cv of AppState.savedCvs.filter(c => c.is_active)) {
      await fetch(`tables/${TABLE}/${cv.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false })
      }).catch(() => {});
      cv.is_active = false;
    }

    const res = await fetch(`tables/${TABLE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        raw_text: rawText,
        profile_json: profile ? JSON.stringify(profile) : '',
        is_active: true
      })
    });
    if (!res.ok) throw new Error('فشل حفظ نسخة الـ CV');
    const record = await res.json();
    AppState.savedCvs.unshift(record);
    setActiveCv(record);
    return record;
  }

  function setActiveCv(record) {
    AppState.activeCvId = record.id;
    AppState.activeCvName = record.name;
    AppState.cvRawText = record.raw_text || '';
    try { AppState.cvProfile = record.profile_json ? JSON.parse(record.profile_json) : null; }
    catch (_) { AppState.cvProfile = null; }

    // ملء الحقول المرتبطة في كل الوحدات
    const rawTextEl = document.getElementById('cv-raw-text');
    if (rawTextEl) rawTextEl.value = AppState.cvRawText;
    const gapEl = document.getElementById('gap-cv-text');
    if (gapEl) gapEl.value = AppState.cvRawText;
    const msgEl = document.getElementById('msg-cv-context');
    if (msgEl && AppState.cvRawText) msgEl.value = AppState.cvRawText.slice(0, 1500);

    renderActiveCvBar();
    renderSavedCvs();
    if (typeof BulkModule !== 'undefined') BulkModule.refreshCvSlot();
  }

  function renderActiveCvBar() {
    const bar = document.getElementById('active-cv-bar');
    if (!AppState.activeCvId) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    document.getElementById('active-cv-name').textContent = AppState.activeCvName;
    const p = AppState.cvProfile;
    document.getElementById('active-cv-skills').textContent = p
      ? `${(p.skills || []).slice(0, 6).join(' · ')}${p.years_experience ? ` — خبرة ~${p.years_experience} سنوات` : ''}`
      : `${AppState.cvRawText.length} حرف — فعّل Gemini لاستخراج الملف المهني`;
  }

  function renderSavedCvs() {
    const container = document.getElementById('saved-cvs-list');
    if (!AppState.savedCvs.length) {
      container.innerHTML = '<div class="note-box small"><i class="fa-solid fa-circle-info"></i><span>لا توجد نسخ محفوظة — ارفع سيرتك واحفظها لتُستخدم تلقائياً في البحث والحملات.</span></div>';
      return;
    }
    container.innerHTML = AppState.savedCvs.map(cv => {
      let meta = `${(cv.raw_text || '').length} حرف`;
      try {
        const p = cv.profile_json ? JSON.parse(cv.profile_json) : null;
        if (p?.skills?.length) meta = p.skills.slice(0, 5).join(' · ');
      } catch (_) { /* تجاهل */ }
      const date = cv.created_at ? new Date(cv.created_at).toLocaleDateString('ar-EG') : '';
      return `<div class="saved-cv-item ${cv.is_active ? 'active' : ''}">
        <i class="fa-solid fa-file-lines fa-xl" style="color:${cv.is_active ? 'var(--success)' : 'var(--text-muted)'}"></i>
        <div class="cv-meta">
          <strong>${escapeHtml(cv.name)}</strong>
          <span>${escapeHtml(meta)} ${date ? '· ' + date : ''}</span>
        </div>
        ${cv.is_active ? '<span class="active-badge"><i class="fa-solid fa-check"></i> نشطة</span>' : ''}
        ${!cv.is_active ? `<button class="btn btn-outline btn-sm btn-activate-cv" data-id="${cv.id}"><i class="fa-solid fa-circle-check"></i> تفعيل</button>` : ''}
        <button class="btn btn-outline btn-sm btn-load-cv" data-id="${cv.id}"><i class="fa-solid fa-eye"></i> عرض</button>
        <button class="icon-btn btn-delete-cv" data-id="${cv.id}" title="حذف" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
      </div>`;
    }).join('');

    container.querySelectorAll('.btn-activate-cv').forEach(b => b.addEventListener('click', async () => {
      const cv = AppState.savedCvs.find(c => c.id === b.dataset.id);
      if (!cv) return;
      // إلغاء تفعيل الأخرى في الخلفية
      for (const other of AppState.savedCvs.filter(c => c.is_active && c.id !== cv.id)) {
        fetch(`tables/${TABLE}/${other.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: false }) }).catch(() => {});
        other.is_active = false;
      }
      cv.is_active = true;
      fetch(`tables/${TABLE}/${cv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: true }) }).catch(() => {});
      setActiveCv(cv);
      toast(`تم تفعيل "${cv.name}" — ستُستخدم في كل الأنظمة`, 'success');
    }));

    container.querySelectorAll('.btn-load-cv').forEach(b => b.addEventListener('click', () => {
      const cv = AppState.savedCvs.find(c => c.id === b.dataset.id);
      if (cv) {
        document.getElementById('cv-raw-text').value = cv.raw_text || '';
        window.scrollTo({ top: document.getElementById('cv-raw-text').offsetTop - 100, behavior: 'smooth' });
      }
    }));

    container.querySelectorAll('.btn-delete-cv').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('حذف هذه النسخة نهائياً؟')) return;
      const res = await fetch(`tables/${TABLE}/${b.dataset.id}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        AppState.savedCvs = AppState.savedCvs.filter(c => c.id !== b.dataset.id);
        if (AppState.activeCvId === b.dataset.id) {
          AppState.activeCvId = null; AppState.activeCvName = ''; AppState.cvProfile = null;
          renderActiveCvBar();
          if (typeof BulkModule !== 'undefined') BulkModule.refreshCvSlot();
        }
        renderSavedCvs();
        toast('تم حذف النسخة', 'success');
      } else toast('فشل الحذف', 'error');
    }));
  }

  /* ---------- التحليل والتحسين بالذكاء الاصطناعي ---------- */
  async function analyzeAts(cvText, targetRole) {
    const prompt = `أنت خبير توظيف وأنظمة تتبع المتقدمين (ATS). حلّل السيرة الذاتية التالية للوظيفة المستهدفة "${targetRole}" في سوق العمل المصري.

السيرة الذاتية:
"""
${cvText.slice(0, 12000)}
"""

أعد JSON بالبنية التالية حرفياً:
{
  "score": <رقم من 0 إلى 100 يمثل توافق السيرة مع ATS>,
  "summary": "<ملخص التقييم في سطرين بالعربية>",
  "strengths": ["<نقطة قوة>"],
  "weaknesses": ["<نقطة ضعف>"],
  "missing_keywords": ["<كلمة مفتاحية ناقصة مهمة للوظيفة>"],
  "formatting_issues": ["<مشكلة تنسيق تؤثر على قراءة ATS>"],
  "recommendations": ["<توصية عملية محددة>"]
}
اكتب كل القيم النصية بالعربية (ما عدا الكلمات المفتاحية التقنية فتبقى بلغتها الأصلية).`;
    return await AI.generateJSON(prompt, { maxTokens: 4096 });
  }

  async function optimizeCv(cvText, targetRole) {
    const prompt = `أنت كاتب سير ذاتية محترف متخصص في أنظمة ATS. أعد صياغة السيرة الذاتية التالية بالكامل للوظيفة المستهدفة "${targetRole}" في السوق المصري.

القواعد الإلزامية:
1. استخدم أفعالاً قوية (Action Verbs) في بداية كل نقطة: "طوّرت"، "أدرت"، "حققت"، "قدت"...
2. اجعل الإنجازات قابلة للقياس بأرقام ونسب حيثما أمكن.
3. أضف قسم "الملخص المهني" في البداية (3 أسطر) غنياً بالكلمات المفتاحية.
4. نظّم الأقسام بترتيب ATS القياسي: الملخص المهني، المهارات، الخبرات، التعليم، الشهادات.
5. لا تخترع معلومات غير موجودة في الأصل — حسّن الصياغة فقط.
6. أعد الناتج كنص سيرة ذاتية كامل منسّق بعناوين أقسام واضحة ونقاط (-)، جاهز للتصدير — بدون أي شرح خارج السيرة.

السيرة الذاتية الأصلية:
"""
${cvText.slice(0, 12000)}
"""`;
    return await AI.generate(prompt, { maxTokens: 8192, temperature: 0.5 });
  }

  /* ---------- التصدير ---------- */
  function exportPdf(cvText, filename = 'CV-Optimized.pdf') {
    if (typeof html2pdf === 'undefined') { toast('مكتبة PDF غير محمّلة', 'error'); return; }
    const container = document.createElement('div');
    container.style.cssText = 'direction:rtl;font-family:Cairo,Arial,sans-serif;padding:40px;font-size:13px;line-height:1.9;color:#111;background:#fff;width:750px;';
    container.innerHTML = mdToHtml(cvText);
    document.body.appendChild(container);
    html2pdf().set({
      margin: 10, filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(container).save().then(() => container.remove());
  }

  async function exportDocx(cvText, filename = 'CV-Optimized.docx') {
    if (typeof docx === 'undefined') { toast('مكتبة Word غير محمّلة', 'error'); return; }
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;
    const children = [];
    for (const line of cvText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { children.push(new Paragraph({})); continue; }
      const isHeading = /^#{1,4}\s/.test(trimmed) || /^(الملخص|المهارات|الخبرات|الخبرة|التعليم|الشهادات|المشاريع|اللغات|SUMMARY|SKILLS|EXPERIENCE|EDUCATION)/i.test(trimmed);
      const isBullet = /^[-*•]\s+/.test(trimmed);
      const text = trimmed.replace(/^#{1,4}\s+/, '').replace(/^[-*•]\s+/, '').replace(/\*\*/g, '');
      if (isHeading) {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2, alignment: AlignmentType.RIGHT, bidirectional: true,
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text, bold: true, size: 28, font: 'Arial' })]
        }));
      } else if (isBullet) {
        children.push(new Paragraph({
          alignment: AlignmentType.RIGHT, bidirectional: true, bullet: { level: 0 },
          children: [new TextRun({ text, size: 22, font: 'Arial' })]
        }));
      } else {
        children.push(new Paragraph({
          alignment: AlignmentType.RIGHT, bidirectional: true,
          children: [new TextRun({ text, size: 22, font: 'Arial' })]
        }));
      }
    }
    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function renderAnalysis(a) {
    const box = document.getElementById('cv-analysis-result');
    const list = arr => (arr || []).map(x => `<li>${escapeHtml(x)}</li>`).join('') || '<li>—</li>';
    const tags = arr => (arr || []).map(k => `<span class="skill-tag missing">${escapeHtml(k)}</span>`).join('') || '—';
    box.innerHTML = `
      <h4><i class="fa-solid fa-gauge"></i> درجة التوافق مع ATS: ${a.score ?? '؟'}%</h4>
      <div class="score-bar"><div class="score-bar-fill" style="width:0%"></div></div>
      <p>${escapeHtml(a.summary || '')}</p>
      <h4><i class="fa-solid fa-circle-check" style="color:var(--success)"></i> نقاط القوة</h4><ul>${list(a.strengths)}</ul>
      <h4><i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> نقاط الضعف</h4><ul>${list(a.weaknesses)}</ul>
      <h4><i class="fa-solid fa-key"></i> كلمات مفتاحية ناقصة</h4><div>${tags(a.missing_keywords)}</div>
      <h4><i class="fa-solid fa-align-right"></i> مشاكل التنسيق</h4><ul>${list(a.formatting_issues)}</ul>
      <h4><i class="fa-solid fa-lightbulb" style="color:var(--primary)"></i> التوصيات</h4><ul>${list(a.recommendations)}</ul>`;
    box.classList.remove('hidden');
    requestAnimationFrame(() => { box.querySelector('.score-bar-fill').style.width = `${a.score || 0}%`; });
  }

  /* ---------- ربط الواجهة ---------- */
  function init() {
    const zone = document.getElementById('cv-upload-zone');
    const fileInput = document.getElementById('cv-file-input');
    const rawText = document.getElementById('cv-raw-text');
    const defaultZoneHtml = zone.innerHTML;

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

    async function handleFile(file) {
      zone.innerHTML = '<span class="spinner" style="border-color:#cbd5e1;border-top-color:var(--primary)"></span> جارٍ استخراج النص من الملف...';
      try {
        const text = await extractFromFile(file);
        if (text.length < 50) throw new Error('لم يتم العثور على نص كافٍ — قد يكون الملف صورة ممسوحة ضوئياً (Scanned)');
        rawText.value = text;
        zone.innerHTML = `<i class="fa-solid fa-circle-check fa-3x" style="color:var(--success)"></i><p><strong>${escapeHtml(file.name)}</strong> — تم استخراج ${text.length} حرفاً. اضغط "حفظ وتفعيل" لاستخدامها في كل الأنظمة.</p>`;
        toast('تم استخراج النص — احفظ النسخة لتفعيلها', 'success');
      } catch (err) {
        zone.innerHTML = defaultZoneHtml;
        toast(err.message, 'error');
      }
    }

    // حفظ وتفعيل النسخة
    document.getElementById('btn-save-cv-profile').addEventListener('click', async e => {
      const btn = e.currentTarget;
      const text = rawText.value.trim();
      if (text.length < 50) return toast('ارفع ملفاً أو الصق نص السيرة أولاً', 'error');
      const name = prompt('اسم هذه النسخة:', `CV — ${new Date().toLocaleDateString('ar-EG')}`);
      if (!name) return;
      setLoading(btn, true, 'جارٍ الحفظ والتحليل...');
      try {
        await saveCvProfile(name, text);
        toast('تم حفظ وتفعيل النسخة — ستُستخدم في البحث والحملات تلقائياً', 'success');
      } catch (err) { toast(err.message, 'error'); }
      finally { setLoading(btn, false); }
    });

    // تغيير الـ CV من الشريط العلوي
    document.getElementById('btn-change-cv').addEventListener('click', () =>
      document.querySelector('.nav-btn[data-view="cv"]')?.click());

    // تحليل ATS
    document.getElementById('btn-analyze-cv').addEventListener('click', async e => {
      const btn = e.currentTarget;
      const cvText = rawText.value.trim();
      const role = document.getElementById('cv-target-role').value.trim() || 'الوظيفة العامة';
      if (cvText.length < 50) return toast('ارفع سيرة ذاتية أو الصق نصها أولاً', 'error');
      if (!AI.isConfigured()) return toast('أعدّ مفتاح Gemini من إدارة الـ APIs أولاً', 'error');
      setLoading(btn, true, 'جارٍ التحليل...');
      try {
        AppState.cvAnalysis = await analyzeAts(cvText, role);
        renderAnalysis(AppState.cvAnalysis);
        toast('اكتمل تحليل ATS', 'success');
      } catch (err) { toast(err.message, 'error'); }
      finally { setLoading(btn, false); }
    });

    // إعادة الصياغة
    document.getElementById('btn-optimize-cv').addEventListener('click', async e => {
      const btn = e.currentTarget;
      const cvText = rawText.value.trim();
      const role = document.getElementById('cv-target-role').value.trim() || 'الوظيفة العامة';
      if (cvText.length < 50) return toast('ارفع سيرة ذاتية أو الصق نصها أولاً', 'error');
      if (!AI.isConfigured()) return toast('أعدّ مفتاح Gemini من إدارة الـ APIs أولاً', 'error');
      setLoading(btn, true, 'جارٍ إعادة الصياغة...');
      try {
        AppState.cvOptimized = await optimizeCv(cvText, role);
        document.getElementById('cv-original-view').value = cvText;
        document.getElementById('cv-optimized-view').value = AppState.cvOptimized;
        document.getElementById('cv-compare').classList.remove('hidden');
        document.getElementById('cv-export-card').style.display = '';
        toast('تم تحسين السيرة الذاتية بنجاح', 'success');
      } catch (err) { toast(err.message, 'error'); }
      finally { setLoading(btn, false); }
    });

    // التصدير
    document.getElementById('btn-export-pdf').addEventListener('click', () => {
      const text = document.getElementById('cv-optimized-view').value.trim();
      if (!text) return toast('لا توجد نسخة محسّنة للتصدير', 'error');
      exportPdf(text);
    });
    document.getElementById('btn-export-docx').addEventListener('click', () => {
      const text = document.getElementById('cv-optimized-view').value.trim();
      if (!text) return toast('لا توجد نسخة محسّنة للتصدير', 'error');
      exportDocx(text);
    });
    document.getElementById('btn-save-cv-template').addEventListener('click', async () => {
      const text = document.getElementById('cv-optimized-view').value.trim();
      if (!text) return toast('لا توجد نسخة محسّنة للحفظ', 'error');
      const role = document.getElementById('cv-target-role').value.trim();
      try {
        await TemplatesModule.create({
          title: `CV — ${role || 'سيرة محسّنة'} — ${new Date().toLocaleDateString('ar-EG')}`,
          type: 'cv', content: text
        });
        toast('تم حفظ النسخة في مكتبة النماذج', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });

    // تحميل النسخ المحفوظة وتفعيل النشطة
    fetchSavedCvs().then(() => {
      renderSavedCvs();
      const active = AppState.savedCvs.find(c => c.is_active);
      if (active) setActiveCv(active);
    }).catch(err => console.warn('تعذر تحميل نسخ الـ CV:', err));
  }

  return { init, exportPdf, extractProfile };
})();
