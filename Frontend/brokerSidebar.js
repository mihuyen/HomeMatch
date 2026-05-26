// Load shared broker sidebar HTML and mark the active item.
(function () {
  async function loadSidebar() {
    const container = document.getElementById('broker-sidebar');
    if (!container) return;

    let html = '';
    try {
      const response = await fetch('brokerSidebar.html');
      if (!response.ok) throw new Error('Failed to fetch brokerSidebar.html');
      html = await response.text();
    } catch (error) {
      console.warn('Using fallback broker sidebar.', error);
      html = `
<nav class="hidden md:flex flex-col fixed left-0 top-0 h-full w-[280px] bg-surface-container border-r border-outline-variant p-md space-y-sm z-20">
  <div class="flex-1 space-y-xs pt-lg">
    <a class="flex items-center space-x-md px-md py-sm rounded-lg font-label-md text-label-md" href="brokerAssign.html">
      <span class="material-symbols-outlined">assignment</span>
      <span>Bảng điều khiển</span>
    </a>
  </div>
  <div class="mt-auto space-y-sm">
    <div class="flex items-center space-x-sm px-sm mb-md">
      <div>
        <h1 class="font-headline-md text-headline-md font-extrabold text-primary">HomeMatch</h1>
        <p class="font-label-sm text-label-sm text-secondary">Broker Portal</p>
      </div>
    </div>
  </div>
</nav>`;
    }

    container.innerHTML = html;

    const nav = container.querySelector('nav');
    if (!nav) return;

    nav.classList.remove('z-50');
    nav.classList.add('z-20');
    nav.classList.remove('relative');
    nav.classList.add('fixed');
    nav.style.position = 'fixed';
    nav.style.left = '0';
    nav.style.top = '0';

    const currentPath = location.pathname.split('/').pop() || '';
    nav.querySelectorAll('a[href]').forEach((link) => {
      const target = (link.getAttribute('href') || '').split('?')[0].split('/').pop();
      if (target && target === currentPath) {
        link.classList.add('bg-primary-container', 'text-on-primary', 'font-bold');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSidebar);
  } else {
    loadSidebar();
  }
})();
