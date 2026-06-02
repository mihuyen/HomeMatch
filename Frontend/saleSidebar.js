// Load shared sale sidebar HTML and mark the active item.
(function () {
  window.handleSaleSidebarLogout = async function handleSaleSidebarLogout() {
    try {
      if (typeof logout === 'function') {
        await logout();
        return false;
      }
    } catch (error) {
      console.warn('Sale sidebar logout fallback.', error);
    }

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'login.html';
    return false;
  };

  async function loadSidebar() {
    const container = document.getElementById('sale-sidebar');
    if (!container) return;

    let html = '';
    try {
      const response = await fetch('saleSidebar.html');
      if (!response.ok) throw new Error('Failed to fetch saleSidebar.html');
      html = await response.text();
    } catch (error) {
      console.warn('Using fallback sale sidebar.', error);
      html = `
<nav class="w-full bg-surface border-b border-outline-variant sticky top-0 z-40">
  <div class="flex items-center justify-between h-16 px-6">
    <a class="flex items-center gap-2 text-primary font-bold" href="home.html">
      <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">real_estate_agent</span>
      <span>HomeMatch</span>
    </a>
    <div class="hidden md:flex items-center gap-6">
      <a class="nav-link text-on-surface-variant hover:text-primary transition-colors pb-1" href="saleAssign.html">Phân công</a>
      <a class="nav-link text-on-surface-variant hover:text-primary transition-colors pb-1" href="saleContracts.html">Hợp đồng</a>
    </div>
    <div class="flex items-center gap-3">
      <button class="px-4 py-1.5 rounded-full border border-outline-variant text-secondary hover:bg-surface-container-low transition-colors" type="button" onclick="return window.handleSaleSidebarLogout && window.handleSaleSidebarLogout();">Đăng xuất</button>
      <button class="w-10 h-10 rounded-full overflow-hidden border border-outline-variant" type="button">
        <img alt="User profile avatar" class="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDvF5IyIAqH0f939YhH--Z7FKqt49YVt0xLeF7ei_5BsJHAU12kb3GQYgIZDN8-jeqoc1x5V3qul8r7RlfR8W70HcP5EKqTxr-w8ryMppbnbFVUc_eLtjLr2TdMOa_nnKrmF_6fum1Ffi0k1JqagVJTxn7Fpmf7NLCJlLrdGjBUfakEv1HiBGQgGIv2EY0AHIJ-KU16kdAlm63zdIGQG3mw4siiML1YTJSS86-UcRrwqezsAfQI1ZV2BtMULbVJSL5qzBe3eA4MPmY">
      </button>
    </div>
  </div>
</nav>`;
    }

    container.innerHTML = html;

    const nav = container.querySelector('nav');
    if (!nav) return;

    const currentPath = location.pathname.split('/').pop() || '';
    nav.querySelectorAll('a[href]').forEach((link) => {
      const target = (link.getAttribute('href') || '').split('?')[0].split('/').pop();
      if (target && target === currentPath) {
        link.classList.add('text-primary', 'border-b-2', 'border-primary', 'font-bold');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSidebar);
  } else {
    loadSidebar();
  }
})();
