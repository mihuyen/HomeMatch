// Load shared broker sidebar HTML and mark active item
(function(){
  async function loadSidebar(){
    const container = document.getElementById('broker-sidebar');
    if(!container) return;
    let html = null;
    try{
      const res = await fetch('brokerSidebar.html');
      if(res.ok) html = await res.text();
      else throw new Error('fetch status ' + res.status);
    }catch(err){
      console.warn('Load sidebar failed, using fallback UI:', err);
    }
    if(!html){
      html = `\
<nav class="hidden md:flex flex-col fixed left-0 top-0 h-full w-[280px] bg-surface-container border-r border-outline-variant p-md space-y-sm z-20">\
  <div class="flex-1 space-y-xs pt-lg">\
    <a class="flex items-center space-x-md px-md py-sm rounded-lg text-secondary hover:bg-surface-variant duration-200 ease-in-out font-label-md text-label-md" href="home.html">\
      <span class="material-symbols-outlined">dashboard</span>\
      <span>Bảng điều khiển</span>\
    </a>\
    <a id="nav-assign" class="flex items-center space-x-md px-md py-sm rounded-lg font-label-md text-label-md" href="brokerAssign.html">\
      <span class="material-symbols-outlined">assignment</span>\
      <span>Phân công</span>\
    </a>\
    <a id="nav-meet" class="flex items-center space-x-md px-md py-sm rounded-lg font-label-md text-label-md" href="brokerMeet.html">\
      <span class="material-symbols-outlined">calendar_today</span>\
      <span>Lịch hẹn</span>\
    </a>\
    <a class="flex items-center space-x-md px-md py-sm rounded-lg text-secondary hover:bg-surface-variant duration-200 ease-in-out font-label-md text-label-md" href="settings.html">\
      <span class="material-symbols-outlined">settings</span>\
      <span>Cài đặt</span>\
    </a>\
  </div>\
  <div class="mt-auto space-y-sm">\
    <div class="flex items-center space-x-sm px-sm mb-md">\
      <div>\
        <h1 class="font-headline-md text-headline-md font-extrabold text-primary">HomeMatch</h1>\
        <p class="font-label-sm text-label-sm text-secondary">Broker Portal</p>\
      </div>\
    </div>\
    <div class="border-t border-outline-variant pt-sm space-y-xs">\
      <a class="flex items-center space-x-md px-md py-sm rounded-lg text-secondary hover:bg-surface-variant duration-200 ease-in-out font-label-md text-label-md" href="#">\
        <span class="material-symbols-outlined">contact_support</span>\
        <span>Hỗ trợ</span>\
      </a>\
      <a class="flex items-center space-x-md px-md py-sm rounded-lg text-secondary hover:bg-surface-variant duration-200 ease-in-out font-label-md text-label-md" href="#">\
        <span class="material-symbols-outlined">logout</span>\
        <span>Đăng xuất</span>\
      </a>\
    </div>\
  </div>\
</nav>\
`;
    }
    container.innerHTML = html;
    // ensure sidebar does not sit above the top header: lower z-index if present
    const nav = container.querySelector('nav');
    if(nav){
      // prefer non-fixed sidebar so it doesn't overlay page content
      nav.classList.remove('fixed');
      if(!nav.classList.contains('relative')) nav.classList.add('relative');
      nav.classList.remove('z-50');
      if(!nav.classList.contains('z-20')) nav.classList.add('z-20');
      nav.style.position = 'relative';
      nav.style.top = '0';
      // ensure main content shifts right so text isn't hidden under fixed sidebar
      try{
        const main = document.querySelector('main');
        const bottomBar = document.querySelector('div.fixed.bottom-0');
        const w = nav.getBoundingClientRect().width || 280;
        if(window.innerWidth >= 768 && main){
          const desired = Math.max(0, Math.round(w - 48));
          main.style.paddingLeft = desired + 'px';
        }
        if(window.innerWidth >= 768 && bottomBar){
          const desiredBar = Math.max(0, Math.round(w - 48));
          bottomBar.style.left = desiredBar + 'px';
        }
      }catch(e){
        console.warn('Adjusting layout for sidebar failed', e);
      }
    }
    // mark active robustly (compare pathname only)
    const currentPath = location.pathname.split('/').pop() || 'brokerAssign.html';
    const links = container.querySelectorAll('a[href]');
    links.forEach(a=>{
      const href = a.getAttribute('href');
      const target = href.split('?')[0].split('/').pop();
      a.classList.remove('bg-primary-container','text-on-primary-container','font-bold','border-r-4');
      if(target === currentPath){
        a.classList.add('bg-primary-container','text-on-primary-container','font-bold');
      }
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', loadSidebar);
  else loadSidebar();
})();
