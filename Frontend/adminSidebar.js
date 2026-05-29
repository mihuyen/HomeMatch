// Load shared admin sidebar HTML and mark the active item.
(function () {
  window.handleAdminSidebarLogout = async function handleAdminSidebarLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'login.html';
    return false;
  };

  async function loadSidebar() {
    const container = document.getElementById('admin-sidebar');
    if (!container) return;

    let html = '';
    try {
      const response = await fetch('adminSidebar.html');
      if (!response.ok) throw new Error('Failed to fetch adminSidebar.html');
      html = await response.text();
    } catch (error) {
      console.warn('Using fallback admin sidebar.', error);
      html = `
<nav class="bg-surface border-b border-outline-variant shadow-sm sticky top-0 z-50 transition-colors h-[72px]">
    <div class="flex justify-between items-center w-full px-8 md:px-12 h-full max-w-[1440px] mx-auto">
        <div class="text-[22px] font-black text-primary cursor-pointer flex items-center gap-3" onclick="window.location.href='landingpage.html'">
            <span class="material-symbols-outlined text-[28px] text-primary icon-filled">real_estate_agent</span>
            <span>HomeMatch <span class="text-xs font-bold bg-primary-container text-on-primary-container px-2 py-0.5 rounded-full ml-1">ADMIN</span></span>
        </div>
        <div class="hidden md:flex gap-10 h-full items-center">
            <a class="nav-link text-on-surface-variant hover:text-primary pb-1 transition-colors h-full flex items-center pt-1 text-[15px] font-semibold cursor-pointer" href="landingpage.html">Trang chủ</a>
            <a class="nav-link text-on-surface-variant hover:text-primary pb-1 transition-colors h-full flex items-center pt-1 text-[15px] font-semibold cursor-pointer" href="adminDashboard.html">Báo cáo thống kê</a>
            <a class="nav-link text-on-surface-variant hover:text-primary pb-1 transition-colors h-full flex items-center pt-1 text-[15px] font-semibold cursor-pointer" href="adminSurveyAssignment.html">Phân công khảo sát</a>
        </div>
        <div class="flex items-center gap-6">
            <button onclick="localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href='login.html';" 
                    class="hidden md:block text-[14px] font-semibold text-error border border-error rounded-full px-6 py-2 hover:bg-error-container transition-colors active:scale-95">
                Đăng xuất
            </button>
            <button class="w-11 h-11 rounded-full overflow-hidden border-2 border-outline-variant hover:border-primary transition-all">
                <img alt="Admin profile avatar" class="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDvF5IyIAqH0f939YhH--Z7FKqt49YVt0xLeF7ei_5BsJHAU12kb3GQYgIZDN8-jeqoc1x5V3qul8r7RlfR8W70HcP5EKqTxr-w8ryMppbnbFVUc_eLtjLr2TdMOa_nnKrmF_6fum1Ffi0k1JqagVJTxn7Fpmf7NLCJlLrdGjBUfakEv1HiBGQgGIv2EY0AHIJ-KU16kdAlm63zdIGQG3mw4siiML1YTJSS86-UcRrwqezsAfQI1ZV2BtMULbVJSL5qzBe3eA4MPmY">
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
