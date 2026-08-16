/* =====================================================================
 * main.js — نقطة الانطلاق: التنقل بين الوحدات + الإقلاع
 * ===================================================================== */

/* ============ التنقل بين الوحدات ============ */
function initNavigation() {
  const sidebar = document.getElementById('app-sidebar');
  const buttons = document.querySelectorAll('.nav-btn');

  function goTo(view) {
    buttons.forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    sidebar.classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // تحديثات عند فتح وحدات معينة
    if (view === 'campaign' && typeof BulkModule !== 'undefined') {
      BulkModule.refreshCvSlot();
      SearchModule.renderSourceChips(document.getElementById('source-chips'));
    }
    if (view === 'settings' && typeof ApiManager !== 'undefined') ApiManager.render();
    // صفحة قاعدة الشركات: تحميل من قاعدة البيانات
    if (view === 'companies' && typeof CompanyModule !== 'undefined') {
      CompanyModule.loadDbPage().catch(() => {});
    }
    // لوحة التحكم: تحديث الإحصائيات والرسوم البيانية
    if (view === 'dashboard' && typeof DashboardModule !== 'undefined') {
      DashboardModule.refresh().catch(() => {});
    }
  }

  buttons.forEach(btn => btn.addEventListener('click', () => goTo(btn.dataset.view)));

  // روابط داخلية بين الوحدات
  document.querySelectorAll('[data-goto]').forEach(el =>
    el.addEventListener('click', () => goTo(el.dataset.goto)));

  // زر القائمة للموبايل
  document.getElementById('menu-toggle').addEventListener('click', () =>
    sidebar.classList.toggle('open'));
  document.addEventListener('click', e => {
    if (window.innerWidth <= 860 && sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) && !document.getElementById('menu-toggle').contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });
}

/* ============ الإقلاع ============ */
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  updateAiStatusChip();
  initNavigation();
  ApiManager.init();
  CVModule.init();
  JobsModule.init();
  GapModule.init();
  BulkModule.init();
  TrackerModule.init();
  TemplatesModule.init();
  // وحدات المرحلة الثالثة
  if (typeof CompanyModule !== 'undefined') CompanyModule.init();
  if (typeof DashboardModule !== 'undefined') {
    DashboardModule.init();
    DashboardModule.refresh().catch(() => {});
  }
  if (typeof AgentModule !== 'undefined') AgentModule.init();
});
