/* =====================================================================
 * tracker.js — لوحة تتبع التقديمات (Kanban 7 مراحل / جدول) + متابعات ذكية
 *              + مكتبة النماذج — يعتمد على RESTful Table API المدمج
 * المراحل: Found → Interested → Applied → Contacted → Interview → Offer → Rejected
 * (الحالات القديمة sent/pending/accepted تُعيَّن تلقائياً للأقرب)
 * ===================================================================== */
const TrackerModule = (() => {
  const TABLE = 'applications';

  const STATUS = {
    found: { label: 'مُكتشفة', icon: 'fa-magnifying-glass', cls: 'found' },
    interested: { label: 'مهتم', icon: 'fa-star', cls: 'interested' },
    applied: { label: 'تم التقديم', icon: 'fa-paper-plane', cls: 'applied' },
    contacted: { label: 'تم التواصل', icon: 'fa-comments', cls: 'contacted' },
    interview: { label: 'مقابلة', icon: 'fa-handshake', cls: 'interview' },
    offer: { label: 'عرض عمل', icon: 'fa-trophy', cls: 'offer' },
    rejected: { label: 'مرفوض', icon: 'fa-circle-xmark', cls: 'rejected' }
  };
  // تعيين الحالات القديمة (توافقية عكسية)
  const LEGACY_MAP = { sent: 'applied', pending: 'interested', accepted: 'offer' };
  const normStatus = s => LEGACY_MAP[s] || (STATUS[s] ? s : 'applied');

  /* ---------- CRUD ---------- */
  async function fetchAll() {
    const res = await fetch(`tables/${TABLE}?limit=300&sort=-created_at`);
    if (!res.ok) throw new Error('تعذر تحميل الطلبات');
    const data = await res.json();
    AppState.applications = (data.data || []).filter(r => !r.deleted);
    return AppState.applications;
  }

  async function create(fields) {
    const res = await fetch(`tables/${TABLE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, applied_date: new Date().toISOString().slice(0, 10) })
    });
    if (!res.ok) throw new Error('فشل حفظ الطلب');
    const record = await res.json();
    AppState.applications.unshift(record);
    render();
    return record;
  }

  async function update(id, fields) {
    const res = await fetch(`tables/${TABLE}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    if (!res.ok) throw new Error('فشل تحديث الطلب');
    const record = await res.json();
    const idx = AppState.applications.findIndex(a => a.id === id);
    if (idx > -1) AppState.applications[idx] = record;
    render();
    return record;
  }

  async function remove(id) {
    const res = await fetch(`tables/${TABLE}/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('فشل حذف الطلب');
    AppState.applications = AppState.applications.filter(a => a.id !== id);
    render();
  }

  /* ---------- المتابعات المستحقة (Smart Follow-up) ---------- */
  function dueFollowups() {
    const today = new Date().toISOString().slice(0, 10);
    return AppState.applications.filter(a => {
      const st = normStatus(a.status);
      return a.followup_date && a.followup_date <= today && ['applied', 'contacted'].includes(st);
    });
  }

  /* ---------- الإحصائيات السريعة ---------- */
  function updateStats() {
    const apps = AppState.applications;
    const el = id => document.getElementById(id);
    if (!el('stat-total')) return;
    el('stat-total').textContent = apps.length;
    el('stat-interviews').textContent = apps.filter(a => normStatus(a.status) === 'interview').length;
    el('stat-pending').textContent = apps.filter(a => ['applied', 'contacted'].includes(normStatus(a.status))).length;
    el('stat-accepted').textContent = apps.filter(a => normStatus(a.status) === 'offer').length;
  }

  /* ---------- العرض ---------- */
  function render() {
    updateStats();
    renderKanban();
    renderTable();
  }

  function followupBadge(a) {
    if (!a.followup_date) return '';
    const today = new Date().toISOString().slice(0, 10);
    const due = a.followup_date <= today;
    return `<span class="mini-badge" style="background:${due ? '#fee2e2' : '#fef3c7'};color:${due ? '#b91c1c' : '#b45309'}">
      <i class="fa-solid fa-reply"></i> متابعة ${due ? 'مستحقة' : ''}: ${escapeHtml(a.followup_date)}</span>`;
  }

  function renderKanban() {
    const board = document.getElementById('kanban-board');
    if (!board) return;
    board.innerHTML = Object.entries(STATUS).map(([key, s]) => {
      const cards = AppState.applications.filter(a => normStatus(a.status) === key);
      return `
        <div class="kanban-col" data-status="${key}">
          <div class="kanban-col-header">
            <h4><i class="fa-solid ${s.icon}"></i> ${s.label}</h4>
            <span class="kanban-count">${cards.length}</span>
          </div>
          ${cards.map(a => `
            <div class="kanban-card status-${s.cls}" draggable="true" data-id="${a.id}">
              <strong>${escapeHtml(a.company)}</strong>
              <span class="job-title">${escapeHtml(a.job_title)}</span>
              <div class="card-date"><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(a.applied_date || '')}
                ${a.cv_id ? ' · <i class="fa-solid fa-file-lines"></i>' : ''}</div>
              ${followupBadge(a)}
              <div class="card-actions">
                ${a.job_url ? `<a class="icon-btn" href="${escapeHtml(a.job_url)}" target="_blank" rel="noopener" title="رابط الوظيفة"><i class="fa-solid fa-link"></i></a>` : ''}
                ${['applied', 'contacted'].includes(key) ? `<button class="icon-btn btn-followup" data-id="${a.id}" title="توليد متابعة بالـ AI" style="color:var(--warning)"><i class="fa-solid fa-reply"></i></button>` : ''}
                <button class="icon-btn btn-edit" data-id="${a.id}" title="تعديل"><i class="fa-solid fa-pen"></i></button>
                <button class="icon-btn btn-del" data-id="${a.id}" title="حذف"><i class="fa-solid fa-trash"></i></button>
              </div>
            </div>`).join('')}
        </div>`;
    }).join('');
    bindCardEvents(board);
    bindDragDrop(board);
  }

  function renderTable() {
    const tbody = document.getElementById('apps-tbody');
    if (!tbody) return;
    tbody.innerHTML = AppState.applications.map(a => {
      const st = normStatus(a.status);
      const s = STATUS[st];
      const cvName = AppState.savedCvs.find(c => c.id === a.cv_id)?.name || '';
      return `<tr>
        <td><strong>${escapeHtml(a.company)}</strong>${a.source ? `<br><span class="src-line">${escapeHtml(a.source)}</span>` : ''}</td>
        <td>${escapeHtml(a.job_title)}${cvName ? `<br><span class="src-line"><i class="fa-solid fa-file-lines"></i> ${escapeHtml(cvName)}</span>` : ''}</td>
        <td>${escapeHtml(a.location || '—')}</td>
        <td><span class="status-badge ${s.cls}">${s.label}</span></td>
        <td>${escapeHtml(a.applied_date || '—')}${a.followup_date ? `<br>${followupBadge(a)}` : ''}</td>
        <td>
          ${a.job_url ? `<a class="icon-btn" href="${escapeHtml(a.job_url)}" target="_blank" rel="noopener" title="الرابط"><i class="fa-solid fa-link"></i></a>` : ''}
          <button class="icon-btn btn-edit" data-id="${a.id}" title="تعديل"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn btn-del" data-id="${a.id}" title="حذف"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">لا توجد طلبات بعد — أضف أول طلب تقديم</td></tr>';
    bindCardEvents(tbody);
  }

  function bindCardEvents(scope) {
    scope.querySelectorAll('.btn-edit').forEach(b =>
      b.addEventListener('click', () => openModal(b.dataset.id)));
    scope.querySelectorAll('.btn-del').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('حذف هذا الطلب نهائياً؟')) return;
        try { await remove(b.dataset.id); toast('تم الحذف', 'success'); }
        catch (err) { toast(err.message, 'error'); }
      }));
    scope.querySelectorAll('.btn-followup').forEach(b =>
      b.addEventListener('click', () => openFollowupModal(b.dataset.id)));
  }

  function bindDragDrop(board) {
    let draggedId = null;
    board.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('dragstart', () => { draggedId = card.dataset.id; });
    });
    board.querySelectorAll('.kanban-col').forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', async e => {
        e.preventDefault(); col.classList.remove('drag-over');
        const newStatus = col.dataset.status;
        const app = AppState.applications.find(a => a.id === draggedId);
        if (app && normStatus(app.status) !== newStatus) {
          app.status = newStatus;
          render();
          try { await update(draggedId, { status: newStatus }); toast(`نُقل إلى "${STATUS[newStatus].label}"`, 'success'); }
          catch (err) { toast(err.message, 'error'); await refresh(); }
        }
      });
    });
  }

  /* ---------- نافذة الطلب (حقول موسعة) ---------- */
  function openModal(editId = null, prefill = {}) {
    const modal = document.getElementById('app-modal');
    const app = editId ? AppState.applications.find(a => a.id === editId) : null;
    document.getElementById('modal-title').textContent = app ? 'تعديل طلب التقديم' : 'إضافة طلب تقديم';
    document.getElementById('app-edit-id').value = app?.id || '';
    document.getElementById('app-company').value = app?.company || prefill.company || '';
    document.getElementById('app-job-title').value = app?.job_title || prefill.job_title || '';
    document.getElementById('app-location').value = app?.location || prefill.location || '';
    document.getElementById('app-status').value = normStatus(app?.status || prefill.status || 'applied');
    document.getElementById('app-job-url').value = app?.job_url || prefill.job_url || '';
    document.getElementById('app-contact-email').value = app?.contact_email || prefill.contact_email || '';
    document.getElementById('app-notes').value = app?.notes || '';
    // الحقول الموسعة
    const cvSel = document.getElementById('app-cv');
    if (cvSel) {
      cvSel.innerHTML = '<option value="">— بدون —</option>' + AppState.savedCvs.map(c =>
        `<option value="${c.id}" ${c.id === (app?.cv_id || prefill.cv_id) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    }
    const setVal = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v || ''; };
    setVal('app-source', app?.source || prefill.source || '');
    setVal('app-followup', app?.followup_date || prefill.followup_date || '');
    setVal('app-interview', app?.interview_date || prefill.interview_date || '');
    const sentEl = document.getElementById('app-email-sent');
    if (sentEl) sentEl.checked = !!(app?.email_sent ?? prefill.email_sent);
    modal.classList.remove('hidden');
  }

  function closeModal() { document.getElementById('app-modal').classList.add('hidden'); }

  async function saveFromModal() {
    const id = document.getElementById('app-edit-id').value;
    const getVal = elId => document.getElementById(elId)?.value.trim() || '';
    const fields = {
      company: getVal('app-company'),
      job_title: getVal('app-job-title'),
      location: getVal('app-location'),
      status: document.getElementById('app-status').value,
      job_url: getVal('app-job-url'),
      contact_email: getVal('app-contact-email'),
      notes: getVal('app-notes'),
      cv_id: document.getElementById('app-cv')?.value || '',
      source: getVal('app-source'),
      followup_date: getVal('app-followup'),
      interview_date: getVal('app-interview'),
      email_sent: !!document.getElementById('app-email-sent')?.checked
    };
    if (!fields.company || !fields.job_title) return toast('الشركة والمسمى الوظيفي مطلوبان', 'error');
    try {
      if (id) { await update(id, fields); toast('تم تحديث الطلب', 'success'); }
      else { await create(fields); toast('تمت إضافة الطلب', 'success'); }
      closeModal();
    } catch (err) { toast(err.message, 'error'); }
  }

  /* =====================================================================
   * Smart Follow-up (البند 15): 5 أيام → متابعة 1 → 7 أيام → متابعة 2
   * توليد مخصص بالـ AI بناءً على الشركة + الوظيفة + التواصل السابق
   * ===================================================================== */
  let followupApp = null;

  async function openFollowupModal(appId) {
    followupApp = AppState.applications.find(a => a.id === appId);
    if (!followupApp) return;
    const modal = document.getElementById('followup-modal');
    document.getElementById('followup-target').innerHTML =
      `<strong>${escapeHtml(followupApp.company)}</strong> — ${escapeHtml(followupApp.job_title)}`;
    document.getElementById('followup-result').classList.add('hidden');
    document.getElementById('followup-subject').value = '';
    document.getElementById('followup-body').value = '';
    modal.classList.remove('hidden');
  }

  async function generateFollowup(which) {
    if (!followupApp) return;
    if (!AI.isConfigured()) return toast('أعدّ مفتاح Gemini من إدارة الـ APIs أولاً', 'error');
    const btn = document.getElementById(`btn-followup-${which}`);
    setLoading(btn, true, 'جارٍ التوليد...');
    try {
      let prevComms = [];
      try {
        if (followupApp.company_id) prevComms = await DB.companyCommunications(followupApp.company_id);
      } catch (_) { /* تجاهل */ }
      const prevText = prevComms.slice(0, 3).map(c => `- ${c.type}: ${c.subject || ''} ${(c.body || '').slice(0, 200)}`).join('\n') || 'لا يوجد تواصل سابق مسجل';
      const profile = AppState.cvProfile;
      const numLabel = which === 1 ? 'الأولى (بعد 5 أيام من التقديم)' : 'الثانية (بعد 7 أيام من الأولى)';

      const prompt = `اكتب إيميل متابعة (Follow-up) ${numLabel} مهذباً واحترافياً لطلب توظيف.

الشركة: ${followupApp.company}
الوظيفة: ${followupApp.job_title}
${followupApp.contact_email ? `المستلم: ${followupApp.contact_email}` : ''}
${profile ? `ملخص المرشح: مهارات ${(profile.skills || []).slice(0, 10).join('، ')} — خبرة ~${profile.years_experience || '؟'} سنوات` : ''}

التواصل السابق مع الشركة:
${prevText}

القواعد: عربية فصحى مهنية، 80-120 كلمة، تذكير لطيف بالتقديم، إبراز نقطة قوة واحدة حقيقية، سؤال مباشر عن حالة الطلب، توقيع باسم "${AppState.settings.senderName || 'المتقدم'}". لا تختلق معلومات.
أعد JSON: {"subject":"<العنوان>","body":"<النص>"}`;

      const r = await AI.generateJSON(prompt, { maxTokens: 1024, temperature: 0.6 });
      document.getElementById('followup-subject').value = r.subject || '';
      document.getElementById('followup-body').value = r.body || '';
      document.getElementById('followup-result').classList.remove('hidden');
      document.getElementById('followup-result').dataset.which = which;
    } catch (err) { toast(err.message, 'error'); }
    finally { setLoading(btn, false); }
  }

  async function applyFollowup() {
    if (!followupApp) return;
    const which = +document.getElementById('followup-result').dataset.which || 1;
    const subject = document.getElementById('followup-subject').value.trim();
    const body = document.getElementById('followup-body').value.trim();
    if (!body) return toast('ولّد الرسالة أولاً', 'error');
    try {
      const next = which === 1
        ? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
        : '';
      await update(followupApp.id, { followup_date: next, status: 'contacted' });
      let companyId = followupApp.company_id;
      if (!companyId) {
        const found = await DB.findCompany(followupApp.company).catch(() => null);
        companyId = found?.company?.id || '';
      }
      if (companyId) {
        await DB.logCommunication({
          company_id: companyId, application_id: followupApp.id,
          type: 'followup_sent', subject, body, direction: 'outbound'
        });
        if (!followupApp.company_id) await DB.update('applications', followupApp.id, { company_id: companyId });
      }
      if (followupApp.contact_email) {
        window.location.href = `mailto:${encodeURIComponent(followupApp.contact_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      } else {
        await navigator.clipboard.writeText(`${subject}\n\n${body}`);
        toast('لا يوجد إيميل مستلم — نُسخت الرسالة للحافظة', 'info');
      }
      document.getElementById('followup-modal').classList.add('hidden');
      toast(which === 1 ? 'سُجّلت المتابعة الأولى — القادمة بعد 7 أيام' : 'سُجّلت المتابعة الثانية — اكتملت الدورة', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function refresh() {
    await fetchAll();
    render();
  }

  function init() {
    document.getElementById('btn-add-app').addEventListener('click', () => openModal());
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', saveFromModal);
    document.getElementById('app-modal').addEventListener('click', e => {
      if (e.target.id === 'app-modal') closeModal();
    });

    document.getElementById('btn-followup-1')?.addEventListener('click', () => generateFollowup(1));
    document.getElementById('btn-followup-2')?.addEventListener('click', () => generateFollowup(2));
    document.getElementById('btn-followup-send')?.addEventListener('click', applyFollowup);
    document.querySelectorAll('[data-close="followup-modal"]').forEach(b =>
      b.addEventListener('click', () => document.getElementById('followup-modal').classList.add('hidden')));

    document.querySelectorAll('#board-toggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#board-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        AppState.boardMode = btn.dataset.mode;
        document.getElementById('kanban-board').classList.toggle('hidden', AppState.boardMode !== 'kanban');
        document.getElementById('table-view').classList.toggle('hidden', AppState.boardMode !== 'table');
      });
    });

    refresh().catch(err => console.warn('تعذر تحميل الطلبات:', err));
  }

  return { init, create, update, refresh, render, openModal, dueFollowups, normStatus, STATUS };
})();

/* =====================================================================
 * TemplatesModule — مكتبة النماذج (CV / رسائل)
 * ===================================================================== */
const TemplatesModule = (() => {
  const TABLE = 'templates';
  const TYPE_LABELS = { cv: 'سيرة ذاتية', email: 'إيميل', linkedin: 'رسالة LinkedIn', cover_letter: 'خطاب تقديم' };
  const TYPE_ICONS = { cv: 'fa-file-lines', email: 'fa-envelope', linkedin: 'fa-linkedin', cover_letter: 'fa-file-signature' };

  async function fetchAll() {
    const res = await fetch(`tables/${TABLE}?limit=200&sort=-created_at`);
    if (!res.ok) throw new Error('تعذر تحميل النماذج');
    const data = await res.json();
    AppState.templates = (data.data || []).filter(r => !r.deleted);
    return AppState.templates;
  }

  async function create(fields) {
    const res = await fetch(`tables/${TABLE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    if (!res.ok) throw new Error('فشل حفظ النموذج');
    const record = await res.json();
    AppState.templates.unshift(record);
    render();
    return record;
  }

  async function update(id, fields) {
    const current = AppState.templates.find(t => t.id === id);
    const res = await fetch(`tables/${TABLE}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...current, ...fields })
    });
    if (!res.ok) throw new Error('فشل تحديث النموذج');
    const record = await res.json();
    const idx = AppState.templates.findIndex(t => t.id === id);
    if (idx > -1) AppState.templates[idx] = record;
    render();
  }

  async function remove(id) {
    const res = await fetch(`tables/${TABLE}/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('فشل حذف النموذج');
    AppState.templates = AppState.templates.filter(t => t.id !== id);
    render();
  }

  function render() {
    const grid = document.getElementById('templates-grid');
    const filter = AppState.templateFilter;
    const items = filter ? AppState.templates.filter(t => t.type === filter) : AppState.templates;

    grid.innerHTML = items.map(t => `
      <article class="template-card">
        <h4><i class="fa-solid ${TYPE_ICONS[t.type] || 'fa-file'}"></i> ${escapeHtml(t.title)}
          <span class="tpl-type-badge">${TYPE_LABELS[t.type] || t.type}</span></h4>
        <div class="tpl-preview">${escapeHtml((t.content || '').slice(0, 400))}</div>
        <div class="tpl-actions">
          <button class="btn btn-outline btn-sm btn-copy-tpl" data-id="${t.id}"><i class="fa-solid fa-copy"></i> نسخ</button>
          <button class="btn btn-outline btn-sm btn-edit-tpl" data-id="${t.id}"><i class="fa-solid fa-pen"></i> تعديل</button>
          ${t.type === 'cv' ? `<button class="btn btn-outline btn-sm btn-dl-tpl" data-id="${t.id}"><i class="fa-solid fa-file-pdf"></i> PDF</button>` : ''}
          <button class="icon-btn btn-del-tpl" data-id="${t.id}" title="حذف" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>`).join('') ||
      '<div class="note-box"><i class="fa-solid fa-circle-info"></i><span>المكتبة فارغة — احفظ نسخ الـ CV والرسائل المولّدة هنا لإعادة استخدامها.</span></div>';

    grid.querySelectorAll('.btn-copy-tpl').forEach(b => b.addEventListener('click', () => {
      const t = AppState.templates.find(x => x.id === b.dataset.id);
      navigator.clipboard.writeText(t?.content || '').then(() => toast('تم نسخ المحتوى', 'success'));
    }));
    grid.querySelectorAll('.btn-edit-tpl').forEach(b => b.addEventListener('click', () => openModal(b.dataset.id)));
    grid.querySelectorAll('.btn-del-tpl').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('حذف هذا النموذج نهائياً؟')) return;
      try { await remove(b.dataset.id); toast('تم الحذف', 'success'); }
      catch (err) { toast(err.message, 'error'); }
    }));
    grid.querySelectorAll('.btn-dl-tpl').forEach(b => b.addEventListener('click', () => {
      const t = AppState.templates.find(x => x.id === b.dataset.id);
      if (t) CVModule && exportTemplatePdf(t);
    }));
  }

  function exportTemplatePdf(t) {
    const container = document.createElement('div');
    container.style.cssText = 'direction:rtl;font-family:Cairo,Arial,sans-serif;padding:40px;font-size:13px;line-height:1.9;color:#111;background:#fff;width:750px;';
    container.innerHTML = mdToHtml(t.content);
    document.body.appendChild(container);
    html2pdf().set({ margin: 10, filename: `${t.title}.pdf`, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4' } })
      .from(container).save().then(() => container.remove());
  }

  function openModal(editId = null) {
    const modal = document.getElementById('template-modal');
    const tpl = editId ? AppState.templates.find(t => t.id === editId) : null;
    document.getElementById('tpl-edit-id').value = tpl?.id || '';
    document.getElementById('tpl-title').value = tpl?.title || '';
    document.getElementById('tpl-type').value = tpl?.type || 'cv';
    document.getElementById('tpl-content').value = tpl?.content || '';
    modal.classList.remove('hidden');
  }

  function init() {
    document.getElementById('btn-new-template').addEventListener('click', () => openModal());
    document.getElementById('tpl-save').addEventListener('click', async () => {
      const id = document.getElementById('tpl-edit-id').value;
      const fields = {
        title: document.getElementById('tpl-title').value.trim(),
        type: document.getElementById('tpl-type').value,
        content: document.getElementById('tpl-content').value.trim()
      };
      if (!fields.title || !fields.content) return toast('العنوان والمحتوى مطلوبان', 'error');
      try {
        if (id) { await update(id, fields); toast('تم تحديث النموذج', 'success'); }
        else { await create(fields); toast('تم حفظ النموذج', 'success'); }
        document.getElementById('template-modal').classList.add('hidden');
      } catch (err) { toast(err.message, 'error'); }
    });
    document.querySelectorAll('[data-close="template-modal"]').forEach(b =>
      b.addEventListener('click', () => document.getElementById('template-modal').classList.add('hidden')));
    document.getElementById('template-modal').addEventListener('click', e => {
      if (e.target.id === 'template-modal') e.target.classList.add('hidden');
    });

    document.querySelectorAll('#templates-filter .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#templates-filter .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        AppState.templateFilter = btn.dataset.type;
        render();
      });
    });

    fetchAll().then(render).catch(err => console.warn('تعذر تحميل النماذج:', err));
  }

  return { init, create, render };
})();
