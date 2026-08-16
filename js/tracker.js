/* =====================================================================
 * tracker.js — لوحة تتبع التقديمات (Kanban / Table) + مكتبة النماذج
 * يعتمد على RESTful Table API المدمج
 * ===================================================================== */
const TrackerModule = (() => {
  const TABLE = 'applications';
  const STATUS = {
    sent: { label: 'مُرسل', icon: 'fa-paper-plane', cls: 'sent' },
    interview: { label: 'مقابلة', icon: 'fa-handshake', cls: 'interview' },
    pending: { label: 'معلق', icon: 'fa-clock', cls: 'pending' },
    accepted: { label: 'مقبول', icon: 'fa-circle-check', cls: 'accepted' },
    rejected: { label: 'مرفوض', icon: 'fa-circle-xmark', cls: 'rejected' }
  };

  /* ---------- CRUD ---------- */
  async function fetchAll() {
    const res = await fetch(`tables/${TABLE}?limit=200&sort=-created_at`);
    if (!res.ok) throw new Error('تعذر تحميل الطلبات');
    const data = await res.json();
    AppState.applications = data.data || [];
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
    const current = AppState.applications.find(a => a.id === id);
    const res = await fetch(`tables/${TABLE}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...current, ...fields })
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

  /* ---------- العرض ---------- */
  function updateStats() {
    const apps = AppState.applications;
    document.getElementById('stat-total').textContent = apps.length;
    document.getElementById('stat-interviews').textContent = apps.filter(a => a.status === 'interview').length;
    document.getElementById('stat-pending').textContent = apps.filter(a => a.status === 'pending' || a.status === 'sent').length;
    document.getElementById('stat-accepted').textContent = apps.filter(a => a.status === 'accepted').length;
  }

  function render() {
    updateStats();
    renderKanban();
    renderTable();
  }

  function renderKanban() {
    const board = document.getElementById('kanban-board');
    board.innerHTML = Object.entries(STATUS).map(([key, s]) => {
      const cards = AppState.applications.filter(a => (a.status || 'sent') === key);
      return `
        <div class="kanban-col" data-status="${key}">
          <div class="kanban-col-header">
            <h4><i class="fa-solid ${s.icon}"></i> ${s.label}</h4>
            <span class="kanban-count">${cards.length}</span>
          </div>
          ${cards.map(a => `
            <div class="kanban-card status-${key}" draggable="true" data-id="${a.id}">
              <strong>${escapeHtml(a.company)}</strong>
              <span class="job-title">${escapeHtml(a.job_title)}</span>
              <div class="card-date"><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(a.applied_date || '')}</div>
              <div class="card-actions">
                ${a.job_url ? `<a class="icon-btn" href="${escapeHtml(a.job_url)}" target="_blank" rel="noopener" title="رابط الوظيفة"><i class="fa-solid fa-link"></i></a>` : ''}
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
    tbody.innerHTML = AppState.applications.map(a => {
      const s = STATUS[a.status] || STATUS.sent;
      return `<tr>
        <td><strong>${escapeHtml(a.company)}</strong></td>
        <td>${escapeHtml(a.job_title)}</td>
        <td>${escapeHtml(a.location || '—')}</td>
        <td><span class="status-badge ${s.cls}">${s.label}</span></td>
        <td>${escapeHtml(a.applied_date || '—')}</td>
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
        if (app && app.status !== newStatus) {
          app.status = newStatus;
          render();
          try { await update(draggedId, { status: newStatus }); toast(`نُقل إلى "${STATUS[newStatus].label}"`, 'success'); }
          catch (err) { toast(err.message, 'error'); await refresh(); }
        }
      });
    });
  }

  /* ---------- النافذة المنبثقة ---------- */
  function openModal(editId = null, prefill = {}) {
    const modal = document.getElementById('app-modal');
    const app = editId ? AppState.applications.find(a => a.id === editId) : null;
    document.getElementById('modal-title').textContent = app ? 'تعديل طلب التقديم' : 'إضافة طلب تقديم';
    document.getElementById('app-edit-id').value = app?.id || '';
    document.getElementById('app-company').value = app?.company || prefill.company || '';
    document.getElementById('app-job-title').value = app?.job_title || prefill.job_title || '';
    document.getElementById('app-location').value = app?.location || prefill.location || '';
    document.getElementById('app-status').value = app?.status || prefill.status || 'sent';
    document.getElementById('app-job-url').value = app?.job_url || prefill.job_url || '';
    document.getElementById('app-contact-email').value = app?.contact_email || prefill.contact_email || '';
    document.getElementById('app-notes').value = app?.notes || '';
    modal.classList.remove('hidden');
  }

  function closeModal() { document.getElementById('app-modal').classList.add('hidden'); }

  async function saveFromModal() {
    const id = document.getElementById('app-edit-id').value;
    const fields = {
      company: document.getElementById('app-company').value.trim(),
      job_title: document.getElementById('app-job-title').value.trim(),
      location: document.getElementById('app-location').value.trim(),
      status: document.getElementById('app-status').value,
      job_url: document.getElementById('app-job-url').value.trim(),
      contact_email: document.getElementById('app-contact-email').value.trim(),
      notes: document.getElementById('app-notes').value.trim()
    };
    if (!fields.company || !fields.job_title) return toast('الشركة والمسمى الوظيفي مطلوبان', 'error');
    try {
      if (id) { await update(id, fields); toast('تم تحديث الطلب', 'success'); }
      else { await create(fields); toast('تمت إضافة الطلب', 'success'); }
      closeModal();
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

    // تبديل Kanban / جدول
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

  return { init, create, refresh, render };
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
    AppState.templates = data.data || [];
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
    // تصدير نموذج CV محفوظ كـ PDF عبر نفس أداة المعالج
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

    // الفلاتر
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
