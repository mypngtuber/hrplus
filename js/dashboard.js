/* =====================================================================
 * dashboard.js — إحصائيات موسّعة + رسوم Chart.js + تنبيهات الوظائف الجديدة
 * ===================================================================== */
const DashboardModule = (() => {

  let charts = {}; // لتدمير الرسوم قبل إعادة الرسم

  function setStat(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /* ---------- تنبيهات (Alerts): جديد منذ آخر 24 ساعة ---------- */
  function computeAlerts(jobs, companies, contacts) {
    const dayAgo = Date.now() - 86400000;
    const newJobs = jobs.filter(j => (j.search_date || j.created_at || 0) > dayAgo).length;
    const highMatch = jobs.filter(j => (j.match_score || 0) >= 70).length;
    const newCompanies = companies.filter(c => (c.created_at || 0) > dayAgo).length;
    const newContacts = contacts.filter(c => (c.created_at || 0) > dayAgo).length;
    return { newJobs, highMatch, newCompanies, newContacts };
  }

  function renderAlerts(alerts, followups) {
    const box = document.getElementById('alerts-box');
    if (!box) return;
    const items = [];
    if (alerts.newJobs) items.push({ icon: 'fa-briefcase', text: `<strong>${alerts.newJobs}</strong> وظيفة جديدة خلال 24 ساعة`, cls: 'info' });
    if (alerts.highMatch) items.push({ icon: 'fa-bullseye', text: `<strong>${alerts.highMatch}</strong> وظيفة عالية التطابق (+70%)`, cls: 'success' });
    if (alerts.newCompanies) items.push({ icon: 'fa-building', text: `<strong>${alerts.newCompanies}</strong> شركة جديدة اكتُشفت`, cls: 'info' });
    if (alerts.newContacts) items.push({ icon: 'fa-users', text: `<strong>${alerts.newContacts}</strong> جهة اتصال HR جديدة`, cls: 'info' });
    followups.forEach(a => items.push({
      icon: 'fa-reply',
      text: `متابعة مستحقة: <strong>${escapeHtml(a.company)}</strong> — ${escapeHtml(a.job_title)}`,
      cls: 'warn'
    }));
    if (!items.length) {
      box.innerHTML = '';
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = `<h4><i class="fa-solid fa-bell"></i> التنبيهات</h4>` +
      items.map(i => `<div class="alert-item ${i.cls}"><i class="fa-solid ${i.icon}"></i><span>${i.text}</span></div>`).join('');
  }

  /* ---------- الرسوم البيانية ---------- */
  function destroyCharts() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch (_) {} });
    charts = {};
  }

  function makeChart(id, config) {
    const el = document.getElementById(id);
    if (!el || typeof Chart === 'undefined') return;
    charts[id] = new Chart(el.getContext('2d'), config);
  }

  function lastNDays(n) {
    const days = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      days.push(d.toISOString().slice(0, 10));
    }
    return days;
  }

  function renderCharts(jobs, apps) {
    if (typeof Chart === 'undefined') return;
    destroyCharts();
    Chart.defaults.font.family = 'Cairo';
    Chart.defaults.color = '#64748b';

    // 1) وظائف مكتشفة لكل يوم (آخر 14 يوماً)
    const days14 = lastNDays(14);
    const jobsPerDay = days14.map(day =>
      jobs.filter(j => new Date(j.search_date || j.created_at || 0).toISOString().slice(0, 10) === day).length);
    makeChart('chart-jobs-per-day', {
      type: 'bar',
      data: {
        labels: days14.map(d => d.slice(5)),
        datasets: [{ label: 'وظائف', data: jobsPerDay, backgroundColor: '#6366f1', borderRadius: 6 }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, maintainAspectRatio: false }
    });

    // 2) طلبات التقديم لكل أسبوع (آخر 8 أسابيع)
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const end = Date.now() - i * 7 * 86400000;
      weeks.push({ start: end - 7 * 86400000, end });
    }
    const appsPerWeek = weeks.map(w =>
      apps.filter(a => { const t = a.created_at || 0; return t >= w.start && t < w.end; }).length);
    makeChart('chart-apps-per-week', {
      type: 'line',
      data: {
        labels: weeks.map((_, i) => `أسبوع ${8 - i}`),
        datasets: [{ label: 'طلبات', data: appsPerWeek, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,.12)', fill: true, tension: .35 }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, maintainAspectRatio: false }
    });

    // 3) مصادر الوظائف (Top Sources)
    const srcCount = {};
    jobs.forEach(j => (j.sources || [j.source]).filter(Boolean).forEach(s => { srcCount[s] = (srcCount[s] || 0) + 1; }));
    const srcEntries = Object.entries(srcCount).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (srcEntries.length) {
      makeChart('chart-sources', {
        type: 'doughnut',
        data: {
          labels: srcEntries.map(e => e[0]),
          datasets: [{ data: srcEntries.map(e => e[1]), backgroundColor: ['#0a66c2', '#00b8d4', '#6366f1', '#f59e0b', '#10b981', '#94a3b8'] }]
        },
        options: { plugins: { legend: { position: 'bottom' } }, maintainAspectRatio: false }
      });
    }

    // 4) قمع التقديم (Pipeline)
    const norm = s => TrackerModule.normStatus(s);
    const funnel = ['applied', 'contacted', 'interview', 'offer'].map(st =>
      apps.filter(a => norm(a.status) === st).length);
    makeChart('chart-funnel', {
      type: 'bar',
      data: {
        labels: ['تم التقديم', 'تم التواصل', 'مقابلة', 'عرض عمل'],
        datasets: [{ data: funnel, backgroundColor: ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981'], borderRadius: 6 }]
      },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }, maintainAspectRatio: false }
    });

    // 5) أكثر الشركات (وظائف + طلبات)
    const compCount = {};
    jobs.forEach(j => { const n = j.company_name; if (n) compCount[n] = (compCount[n] || 0) + 1; });
    apps.forEach(a => { const n = a.company; if (n) compCount[n] = (compCount[n] || 0) + 1; });
    const top = Object.entries(compCount).sort((a, b) => b[1] - a[1]).slice(0, 7);
    if (top.length) {
      makeChart('chart-top-companies', {
        type: 'bar',
        data: {
          labels: top.map(e => e[0].length > 22 ? e[0].slice(0, 22) + '…' : e[0]),
          datasets: [{ data: top.map(e => e[1]), backgroundColor: '#4f46e5', borderRadius: 6 }]
        },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }, maintainAspectRatio: false }
      });
    }
  }

  /* ---------- التحديث الرئيسي ---------- */
  async function refresh() {
    try {
      const [jobs, companies, contacts, emails, apps] = await Promise.all([
        DB.list('jobs').catch(() => []),
        DB.list('companies').catch(() => []),
        DB.list('company_contacts').catch(() => []),
        DB.list('company_emails').catch(() => []),
        Promise.resolve(AppState.applications || [])
      ]);

      const norm = s => TrackerModule.normStatus(s);
      const responded = apps.filter(a => ['contacted', 'interview', 'offer'].includes(norm(a.status))).length;
      const sentOrApplied = apps.filter(a => !['found', 'interested'].includes(norm(a.status))).length;
      const responseRate = sentOrApplied ? Math.round((responded / sentOrApplied) * 100) : 0;

      setStat('d-jobs', jobs.length);
      setStat('d-new-jobs', jobs.filter(j => j.is_new).length);
      setStat('d-high-match', jobs.filter(j => (j.match_score || 0) >= 70).length);
      setStat('d-companies', companies.length);
      setStat('d-contacts', contacts.length);
      setStat('d-verified-emails', emails.filter(e => ['Verified', 'Found'].includes(e.status)).length);
      setStat('d-applications', apps.length);
      setStat('d-interviews', apps.filter(a => norm(a.status) === 'interview').length);
      setStat('d-offers', apps.filter(a => norm(a.status) === 'offer').length);
      setStat('d-response-rate', responseRate + '%');

      const followups = TrackerModule.dueFollowups();
      renderAlerts(computeAlerts(jobs, companies, contacts), followups);
      renderCharts(jobs, apps);
    } catch (err) {
      console.warn('تعذر تحديث لوحة التحكم:', err);
    }
  }

  function init() {
    document.getElementById('btn-dashboard-refresh')?.addEventListener('click', async e => {
      setLoading(e.currentTarget, true);
      await TrackerModule.refresh().catch(() => {});
      await refresh();
      setLoading(e.currentTarget, false);
      toast('تم تحديث لوحة التحكم', 'success');
    });
  }

  return { init, refresh };
})();
