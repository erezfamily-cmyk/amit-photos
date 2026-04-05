// ===== STATE =====
let allPhotos = [];
let filteredPhotos = [];
let currentIndex = 0;
let displayedCount = 0;
const PAGE_SIZE = 25;
let slideshowTimer = null;
let isZoomed = false;

// ===== IMAGE PROTECTION =====
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') e.preventDefault();
});

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  initNav();
  initScrollReveal();
  initBackToTop();
  await loadPhotos();
  initFilters();
  initSearch();
  initFeatured();
  initLightbox();
  initContactForm();
  initCart();
  handleInitialHash();
});

// ===== NAV =====
function initNav() {
  const nav = document.getElementById('main-nav');
  const hamburger = document.querySelector('.nav-hamburger');
  const navLinks = document.querySelector('.nav-links');

  // Scrolled state
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  // Hamburger
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      hamburger.classList.toggle('open');
    });
  }

  // Close menu on link click
  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      navLinks.classList.remove('open');
      hamburger.classList.remove('open');
    });
  });

  // Active link on scroll
  const sections = document.querySelectorAll('[data-section]');
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        navLinks.querySelectorAll('a').forEach(a => a.classList.remove('active'));
        const link = navLinks.querySelector(`a[href="#${e.target.id}"]`);
        if (link) link.classList.add('active');
      }
    });
  }, { threshold: 0.35 });

  sections.forEach(s => io.observe(s));
}

// ===== SCROLL REVEAL =====
function initScrollReveal() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}

// ===== LOAD PHOTOS =====
async function loadPhotos() {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;

  showSkeletons(grid);

  try {
    const [jsonRes, apiRes] = await Promise.allSettled([
      fetch('data/photos.json?v=' + Date.now()).then(r => r.ok ? r.json() : []),
      fetch('/api/photos').then(r => r.ok ? r.json() : [])
    ]);
    const jsonPhotos = jsonRes.status === 'fulfilled' ? (jsonRes.value || []) : [];
    const apiPhotos  = apiRes.status  === 'fulfilled' ? (apiRes.value  || []) : [];
    const apiIds = new Set(apiPhotos.map(p => p.id));
    allPhotos = [...apiPhotos, ...jsonPhotos.filter(p => !apiIds.has(p.id))];
    if (!allPhotos.length) allPhotos = getDemoPhotos();
  } catch {
    allPhotos = getDemoPhotos();
  }

  const shuffled = [...allPhotos].sort(() => Math.random() - 0.5);
  filteredPhotos = shuffled.slice(0, 100);
  displayedCount = Math.min(PAGE_SIZE, filteredPhotos.length);
  renderGallery();
}

// ===== SKELETONS =====
function showSkeletons(grid) {
  const heights = [280, 200, 340, 220, 300, 180, 260, 310];
  grid.innerHTML = heights.map(h => `
    <div class="skeleton" style="height:${h}px"></div>
  `).join('');
}

// ===== DEMO DATA =====
function getDemoPhotos() {
  const items = [
    { title: 'שקיעה בנגב', cat: 'טבע', w: 800, h: 1100, bg: '1a1208/c8a96e' },
    { title: 'פורטרט עירוני', cat: 'פורטרט', w: 800, h: 1000, bg: '111111/f0ede8' },
    { title: 'רחוב יפו', cat: 'עירוני', w: 800, h: 600, bg: '0d1b2a/c8a96e' },
    { title: 'חתונה על הים', cat: 'אירועים', w: 800, h: 800, bg: '1a0f0f/e0c080' },
    { title: 'פרח בר', cat: 'טבע', w: 800, h: 1200, bg: '0f1a0f/c8a96e' },
    { title: 'עיניים', cat: 'פורטרט', w: 800, h: 700, bg: '1a1a1a/888888' },
    { title: 'מגדל דוד', cat: 'עירוני', w: 800, h: 1100, bg: '1a1208/c8a96e' },
    { title: 'בר מצווה', cat: 'אירועים', w: 800, h: 600, bg: '0a0a1a/c8a96e' },
    { title: 'ים בעלות השחר', cat: 'טבע', w: 800, h: 900, bg: '0a1520/e0c080' },
    { title: 'סמטת ירושלים', cat: 'עירוני', w: 800, h: 1300, bg: '180f08/c8a96e' },
    { title: 'אמא ובת', cat: 'פורטרט', w: 800, h: 800, bg: '111111/f0ede8' },
    { title: 'אירוסין', cat: 'אירועים', w: 800, h: 650, bg: '12090a/e0c080' },
  ];

  return items.map((it, i) => ({
    id: `demo-${i}`,
    title: it.title,
    category: it.cat,
    url: `https://placehold.co/${it.w}x${it.h}/${it.bg}?text=${encodeURIComponent(it.title)}`,
    thumbnail: `https://placehold.co/${it.w}x${it.h}/${it.bg}?text=${encodeURIComponent(it.title)}`,
    description: '',
  }));
}

// ===== RENDER GALLERY =====
function renderGallery(append = false) {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;

  if (filteredPhotos.length === 0) {
    grid.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:4rem">אין תמונות בקטגוריה זו.</p>`;
    updateLoadMoreBtn();
    return;
  }

  const slice = filteredPhotos.slice(append ? displayedCount - PAGE_SIZE : 0, displayedCount);
  const startIdx = append ? displayedCount - PAGE_SIZE : 0;

  if (!append) grid.innerHTML = '';

  slice.forEach((photo, i) => {
    const idx = startIdx + i;
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.dataset.idx = idx;
    item.innerHTML = `
      <img
        src="${photo.thumbnail || photo.url}"
        alt="${photo.title}"
        loading="lazy"
        onload="this.closest('.gallery-item').classList.add('loaded')"
        draggable="false"
        oncontextmenu="return false"
      />
      <div class="img-protect-overlay"></div>
      <div class="gallery-item-overlay">
        <div class="gallery-item-info">
          <h3>${photo.title}</h3>
          <span>${photo.category}</span>
        </div>
        <div class="gallery-item-actions">
          <button class="gallery-cart-btn" data-idx="${idx}" aria-label="הוסף לסל">+ סל</button>
          <button class="gallery-buy-btn" data-idx="${idx}" aria-label="רכישת ${photo.title}">רכישה ←</button>
        </div>
      </div>`;
    setTimeout(() => item.classList.add('loaded'), i * 55);
    item.addEventListener('click', e => {
      if (e.target.closest('.gallery-cart-btn')) {
        addToCart(photo, item);
      } else if (e.target.closest('.gallery-buy-btn')) {
        openBuyModal(photo);
      } else {
        openLightbox(idx);
      }
    });
    grid.appendChild(item);
  });

  updateLoadMoreBtn();
}

function updateLoadMoreBtn() {
  const btn = document.getElementById('load-more-btn');
  if (!btn) return;
  const remaining = filteredPhotos.length - displayedCount;
  if (remaining > 0) {
    btn.style.display = 'block';
    btn.textContent = `טען עוד (${remaining} נותרו)`;
  } else {
    btn.style.display = 'none';
  }
}

// ===== FEATURED =====
function initFeatured() {
  const grid = document.getElementById('featured-grid');
  if (!grid || allPhotos.length === 0) return;

  const picks = allPhotos.slice(0, 5);
  grid.innerHTML = picks.map((photo, i) => `
    <div class="featured-item" data-idx="${i}">
      <img src="${photo.thumbnail || photo.url}" alt="${photo.title}" loading="lazy" />
      <div class="featured-item-overlay">
        <span class="featured-item-title">${photo.title}</span>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.featured-item').forEach(item => {
    item.addEventListener('click', () => {
      filteredPhotos = [...allPhotos];
      displayedCount = Math.min(PAGE_SIZE, filteredPhotos.length);
      openLightbox(parseInt(item.dataset.idx));
    });
  });
}

// ===== SEARCH =====
function initSearch() {
  const input = document.getElementById('gallery-search');
  if (!input) return;

  input.addEventListener('input', () => {
    applyFilters();
  });
}

function getActiveCategory() {
  const active = document.querySelector('.filter-btn.active');
  if (!active) return { cat: 'all', parent: null };
  return { cat: active.dataset.cat || 'all', parent: active.dataset.parent || null };
}

function applyFilters() {
  const query = (document.getElementById('gallery-search')?.value || '').trim().toLowerCase();
  const { cat, parent } = getActiveCategory();

  let pool = allPhotos.filter(p => {
    let matchCat;
    if (cat === 'all') {
      matchCat = true;
    } else if (parent) {
      // תת-קטגוריה ספציפית
      matchCat = p.category === cat && p.parent_category === parent;
    } else {
      matchCat = p.category === cat && !p.parent_category;
    }
    const matchSearch = !query || p.title.toLowerCase().includes(query);
    return matchCat && matchSearch;
  });

  if (cat === 'all' && !query) {
    pool = [...pool].sort(() => Math.random() - 0.5).slice(0, 100);
  }
  filteredPhotos = pool;
  displayedCount = Math.min(PAGE_SIZE, filteredPhotos.length);
  renderGallery();
}

// ===== FILTERS =====
function initFilters() {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;

  // בנה מבנה היררכי: { null: ['טבע','ישראל',...], 'מקומות בעולם': ['צכיה','פולין',...] }
  const hierarchy = {};
  allPhotos.forEach(p => {
    const parent = p.parent_category || null;
    if (!hierarchy[parent]) hierarchy[parent] = new Set();
    hierarchy[parent].add(p.category);
  });

  let html = `<button class="filter-btn active" data-cat="all">הכל <span class="filter-count">${allPhotos.length}</span></button>`;

  // קטגוריות ראשיות (ללא parent)
  (hierarchy[null] || new Set()).forEach(cat => {
    const count = allPhotos.filter(p => p.category === cat && !p.parent_category).length;
    html += `<button class="filter-btn" data-cat="${cat}">${cat} <span class="filter-count">${count}</span></button>`;
  });

  // קבוצות עם parent
  Object.keys(hierarchy).filter(k => k !== 'null' && k !== null).forEach(parent => {
    const totalCount = allPhotos.filter(p => p.parent_category === parent).length;
    html += `<div class="filter-group">
      <button class="filter-btn filter-group-btn" data-parent="${parent}">
        ${parent} <span class="filter-count">${totalCount}</span> <span class="filter-arrow">▾</span>
      </button>
      <div class="filter-group-sub" style="display:none">`;
    hierarchy[parent].forEach(sub => {
      const count = allPhotos.filter(p => p.category === sub && p.parent_category === parent).length;
      html += `<button class="filter-btn filter-sub-btn" data-cat="${sub}" data-parent="${parent}">${sub} <span class="filter-count">${count}</span></button>`;
    });
    html += `</div></div>`;
  });

  bar.innerHTML = html;

  // לחיצה על כפתור רגיל
  bar.querySelectorAll('.filter-btn:not(.filter-group-btn)').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
  });

  // לחיצה על כפתור קבוצה — פתח/סגור תפריט
  bar.querySelectorAll('.filter-group-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sub = btn.nextElementSibling;
      const isOpen = sub.style.display !== 'none';
      // סגור כל שאר הקבוצות
      bar.querySelectorAll('.filter-group-sub').forEach(s => s.style.display = 'none');
      bar.querySelectorAll('.filter-group-btn .filter-arrow').forEach(a => a.textContent = '▾');
      if (!isOpen) {
        sub.style.display = 'flex';
        btn.querySelector('.filter-arrow').textContent = '▴';
      }
    });
  });
}

// ===== LOAD MORE =====
function initLoadMore() {
  const btn = document.getElementById('load-more-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    displayedCount = Math.min(displayedCount + PAGE_SIZE, filteredPhotos.length);
    renderGallery(true);
  });
}

// ===== LIGHTBOX =====
function initLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;

  initLoadMore();

  const lbImg = document.getElementById('lb-img');
  if (lbImg) {
    lbImg.setAttribute('draggable', 'false');
    lbImg.addEventListener('contextmenu', e => e.preventDefault());
  }

  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  document.getElementById('lb-prev').addEventListener('click', () => { stopSlideshow(); navigateLightbox(-1); });
  document.getElementById('lb-next').addEventListener('click', () => { stopSlideshow(); navigateLightbox(1); });
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });

  // Buy button
  const buyBtn = document.getElementById('lb-buy');
  if (buyBtn) {
    buyBtn.addEventListener('click', () => openBuyModal(filteredPhotos[currentIndex]));
  }

  PrintShop.init();

  // Back to gallery button (mobile)
  const backBtn = document.getElementById('lb-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      closeLightbox();
      document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Buy modal
  initBuyModal();

  // Slideshow
  const ssBtn = document.getElementById('lb-slideshow');
  if (ssBtn) {
    ssBtn.addEventListener('click', () => {
      if (slideshowTimer) { stopSlideshow(); } else { startSlideshow(); }
    });
  }

  // Zoom on image click
  const img = document.getElementById('lb-img');
  if (img) {
    img.addEventListener('click', () => {
      isZoomed = !isZoomed;
      img.classList.toggle('zoomed', isZoomed);
    });
  }

  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') { if (isZoomed) { isZoomed = false; img.classList.remove('zoomed'); } else { closeLightbox(); } }
    if (e.key === 'ArrowRight') { stopSlideshow(); navigateLightbox(-1); }
    if (e.key === 'ArrowLeft') { stopSlideshow(); navigateLightbox(1); }
    if (e.key === ' ') { e.preventDefault(); slideshowTimer ? stopSlideshow() : startSlideshow(); }
  });

  // Touch swipe support
  let touchX = null;
  lb.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    if (touchX === null) return;
    const diff = touchX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) { stopSlideshow(); navigateLightbox(diff > 0 ? 1 : -1); }
    touchX = null;
  });
}

function startSlideshow() {
  const btn = document.getElementById('lb-slideshow');
  if (btn) btn.textContent = '⏸ עצור';
  slideshowTimer = setInterval(() => navigateLightbox(1), 3000);
}

function stopSlideshow() {
  clearInterval(slideshowTimer);
  slideshowTimer = null;
  const btn = document.getElementById('lb-slideshow');
  if (btn) btn.textContent = '▶ מצגת';
}

function getLightboxUrl(url) {
  const match = url.match(/[?&]id=([\w-]+)/);
  if (match && url.includes('drive.google.com')) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1600`;
  }
  return url;
}

function openLightbox(idx) {
  currentIndex = idx;
  const photo = filteredPhotos[idx];
  if (!photo) return;
  const img = document.getElementById('lb-img');
  const spinner = document.getElementById('lb-spinner');
  img.style.opacity = '0';
  spinner.style.display = 'block';
  img.onload = () => {
    spinner.style.display = 'none';
    img.style.opacity = '1';
  };
  window._currentLightboxPhoto = photo;
  img.src = getLightboxUrl(photo.url);
  img.alt = photo.title;
  document.getElementById('lb-title').textContent = photo.title;
  const catEl = document.getElementById('lb-cat');
  catEl.textContent = photo.category;
  catEl.className = 'lb-cat-link';
  catEl.onclick = () => {
    closeLightbox();
    const btn = document.querySelector(`.filter-btn[data-cat="${photo.category}"]`);
    if (btn) { btn.click(); }
    document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' });
  };
  document.getElementById('lb-counter').textContent = `${idx + 1} / ${filteredPhotos.length}`;
  const descEl = document.getElementById('lb-desc');
  descEl.textContent = photo.description || '';
  descEl.style.display = photo.description ? 'block' : 'none';

  // Progress bar
  const progress = document.getElementById('lb-progress');
  if (progress) progress.style.width = `${((idx + 1) / filteredPhotos.length) * 100}%`;

  // Download button — עם הגנת סיסמה
  const dlBtn = document.getElementById('lb-download');
  if (dlBtn) {
    dlBtn.onclick = (e) => {
      e.preventDefault();
      const driveMatch = photo.url.match(/[?&]id=([\w-]+)/);
      if (!driveMatch) { window.open(photo.url, '_blank'); return; }
      const fileId = driveMatch[1];
      const pwd = prompt('הזן סיסמה להורדת התמונה:');
      if (!pwd) return;
      fetch('/functions/download', {
        method: 'POST',
        body: JSON.stringify({ password: pwd, fileId }),
      }).then(r => r.json()).then(data => {
        if (data.url) {
          window.open(data.url, '_blank');
        } else {
          alert('סיסמה שגויה. נסה שוב.');
        }
      }).catch(() => alert('שגיאה. נסה שוב.'));
    };
    dlBtn.href = '#';
  }

  // Share buttons
  const pageUrl = window.location.href.split('#')[0] + '#photo-' + photo.id;
  const waBtn = document.getElementById('lb-share-wa');
  if (waBtn) waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(photo.title + ' — ' + pageUrl)}`;

  const fbBtn = document.getElementById('lb-share-fb');
  if (fbBtn) fbBtn.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`;

  const copyBtn = document.getElementById('lb-copy-link');
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(pageUrl).then(() => {
        const orig = copyBtn.textContent;
        copyBtn.textContent = '✓ הועתק!';
        setTimeout(() => { copyBtn.textContent = orig; }, 2000);
      });
    };
  }

  // Update meta tags for sharing
  const photoThumb = photo.thumbnail || photo.url;
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', `${photo.title} — עמית ארז`);
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', photo.description || 'תמונה אמנותית מגלריית עמית ארז — לרכישה ולהדפסה');
  document.querySelector('meta[property="og:image"]')?.setAttribute('content', photoThumb);
  document.querySelector('meta[property="og:url"]')?.setAttribute('content', window.location.href.split('#')[0] + '#photo-' + photo.id);

  // URL hash for direct sharing
  history.replaceState(null, '', '#photo-' + photo.id);

  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  stopSlideshow();
  isZoomed = false;
  const img = document.getElementById('lb-img');
  if (img) img.classList.remove('zoomed');
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

function navigateLightbox(dir) {
  // reset zoom
  isZoomed = false;
  const img = document.getElementById('lb-img');
  if (img) img.classList.remove('zoomed');

  // fade out then switch
  if (img) img.style.opacity = '0';
  setTimeout(() => {
    currentIndex = (currentIndex + dir + filteredPhotos.length) % filteredPhotos.length;
    openLightbox(currentIndex);
  }, 200);
}

// ===== DEEP LINK — פתיחה לפי hash =====
function handleInitialHash() {
  const hash = window.location.hash;
  if (!hash.startsWith('#photo-')) return;
  const photoId = hash.replace('#photo-', '');
  const idx = filteredPhotos.findIndex(p => String(p.id) === photoId);
  if (idx !== -1) {
    // וודא שהתמונה נמצאת בתצוגה
    if (idx >= displayedCount) {
      displayedCount = idx + 1;
      renderGallery();
    }
    setTimeout(() => openLightbox(idx), 300);
  }
}

// ===== BACK TO TOP =====
function initBackToTop() {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// ===== CONTACT FORM =====
function validateForm(form) {
  let valid = true;
  form.querySelectorAll('.field-error-msg').forEach(el => el.remove());
  form.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));

  const name = form.querySelector('[name="name"]');
  if (!name.value.trim()) {
    showFieldError(name, 'נא להזין שם');
    valid = false;
  }

  const email = form.querySelector('[name="email"]');
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
  if (!emailOk) {
    showFieldError(email, 'נא להזין כתובת אימייל תקינה');
    valid = false;
  }

  const msg = form.querySelector('[name="message"]');
  if (!msg.value.trim()) {
    showFieldError(msg, 'נא להזין הודעה');
    valid = false;
  }

  return valid;
}

function showFieldError(input, text) {
  input.classList.add('field-error');
  const err = document.createElement('span');
  err.className = 'field-error-msg';
  err.textContent = text;
  input.parentElement.appendChild(err);
  input.addEventListener('input', () => {
    input.classList.remove('field-error');
    err.remove();
  }, { once: true });
}

function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateForm(form)) return;

    const btn = form.querySelector('.form-submit');
    btn.textContent = 'שולח...';
    btn.disabled = true;

    try {
      const formData = new FormData(form);
      const name    = formData.get('name')    || '';
      const email   = formData.get('email')   || '';
      const subject = formData.get('subject') || '';
      const message = formData.get('message') || '';

      // שמור פנייה בDB
      await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, notes: message, type: 'פנייה', status: 'ממתין' }),
      });

      // שלח התראה למייל דרך Web3Forms
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || `status ${res.status}`);
    } catch (err) {
      console.error('Form error:', err);
      btn.textContent = 'שלח הודעה ←';
      btn.disabled = false;
      alert('שגיאה בשליחה, נסה שוב.');
      return;
    }

    form.style.display = 'none';
    document.getElementById('form-success').style.display = 'block';
  });
}

// ===== CART =====
let cart = []; // [{ id, title, thumbnail, url, width, height }]
let cartSize = 'small';
const CART_PRICES = { small: 19, medium: 59, large: 129 };
const BUNDLE_DISCOUNT = 0.2;
const BUNDLE_MIN = 3;

function initCart() {
  document.getElementById('cart-open-btn')?.addEventListener('click', openCartModal);
  document.getElementById('cart-modal-close')?.addEventListener('click', closeCartModal);
  document.getElementById('cart-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('cart-modal')) closeCartModal();
  });

  document.querySelectorAll('.cart-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cart-size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cartSize = btn.dataset.size;
      renderCartSummary();
    });
  });

  document.getElementById('cart-checkout-btn')?.addEventListener('click', cartCheckout);
}

function addToCart(photo, itemEl) {
  if (cart.find(p => p.id === photo.id)) {
    // כבר בסל — הסר
    cart = cart.filter(p => p.id !== photo.id);
    itemEl?.classList.remove('in-cart');
  } else {
    cart.push(photo);
    itemEl?.classList.add('in-cart');
  }
  updateCartBadge();
}

function updateCartBadge() {
  const count = cart.length;
  document.getElementById('cart-count').textContent = count;
  document.getElementById('cart-float').style.display = count > 0 ? 'flex' : 'none';
}

function openCartModal() {
  renderCartItems();
  renderCartSummary();
  document.getElementById('cart-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCartModal() {
  document.getElementById('cart-modal').classList.remove('open');
  document.body.style.overflow = '';
}

function renderCartItems() {
  const container = document.getElementById('cart-items');
  if (cart.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem">הסל ריק</p>';
    return;
  }
  container.innerHTML = cart.map(photo => `
    <div class="cart-item" data-id="${photo.id}">
      <img src="${photo.thumbnail || photo.url}" alt="${photo.title}" />
      <span class="cart-item-title">${photo.title}</span>
      <button class="cart-item-remove" data-id="${photo.id}" aria-label="הסר">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      cart = cart.filter(p => String(p.id) !== id);
      // עדכן סימון בגלריה
      document.querySelectorAll('.gallery-item').forEach(el => {
        const idx = parseInt(el.dataset.idx);
        const photo = filteredPhotos[idx];
        if (photo && String(photo.id) === id) el.classList.remove('in-cart');
      });
      updateCartBadge();
      renderCartItems();
      renderCartSummary();
    });
  });
}

function renderCartSummary() {
  const price = CART_PRICES[cartSize] || 39;
  const total = cart.length * price;
  const hasDiscount = cart.length >= BUNDLE_MIN;
  const discount = hasDiscount ? Math.round(total * BUNDLE_DISCOUNT) : 0;
  const final = total - discount;

  document.getElementById('cart-total-original').textContent = `₪${total}`;
  document.getElementById('cart-discount-row').style.display = hasDiscount ? 'flex' : 'none';
  document.getElementById('cart-discount-amount').textContent = `-₪${discount}`;
  document.getElementById('cart-total-final').textContent = `₪${final}`;
}

function cartCheckout() {
  if (cart.length === 0) return;
  const price = CART_PRICES[cartSize] || 39;
  const total = cart.length * price;
  const hasDiscount = cart.length >= BUNDLE_MIN;
  const discount = hasDiscount ? Math.round(total * BUNDLE_DISCOUNT) : 0;
  const finalPrice = total - discount;

  const itemIds = cart.map(p => p.id).join(',');
  const itemNames = cart.map(p => p.title).join(', ');

  const params = new URLSearchParams({
    cmd: '_xclick',
    business: PAYPAL_EMAIL,
    item_name: `חבילת תמונות (${cart.length}) — ${cartSize}`,
    item_number: `CART_${cartSize}_${itemIds}`,
    amount: finalPrice,
    currency_code: 'ILS',
    no_shipping: '1',
    return: `${SITE_URL}/download.html`,
    cancel_return: `${SITE_URL}/`,
    rm: '1',
  });

  window.location.href = `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
}

// ===== BUY MODAL =====
const PAYPAL_EMAIL = 'erez.family@gmail.com';
const SITE_URL = 'https://amitphotos.com';

const SIZES = {
  small:  { label: 'קובץ רשת (1500px)',   price: 19,  sz: 'w1500' },
  medium: { label: 'קובץ הדפסה (3000px)', price: 59,  sz: 'w3000' },
  large:  { label: 'קובץ מלא',            price: 129, sz: 'w6000' },
};

function initBuyModal() {
  const modal = document.getElementById('buy-modal');
  if (!modal) return;

  document.getElementById('buy-modal-close').addEventListener('click', closeBuyModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeBuyModal(); });

  modal.querySelectorAll('.buy-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const size = btn.dataset.size;
      const photo = modal._photo;
      if (!photo) return;
      redirectToPayPal(photo, size);
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeBuyModal();
  });
}

function openBuyModal(photo) {
  if (!photo) return;
  const modal = document.getElementById('buy-modal');
  modal._photo = photo;
  document.getElementById('buy-modal-title').textContent = photo.title;
  const previewImg = document.getElementById('buy-modal-img');
  if (previewImg) { previewImg.src = photo.thumbnail || photo.url; previewImg.alt = photo.title; }

  // קבע אילו גדלים זמינים לפי רזולוציית המקור
  const maxDim = Math.max(photo.width || 0, photo.height || 0);
  modal.querySelectorAll('.buy-size-btn').forEach(btn => {
    const size = btn.dataset.size;
    let available = true;
    if (size === 'medium' && maxDim < 3000) available = false;
    if (size === 'large'  && maxDim < 5000) available = false;

    btn.disabled = !available;
    btn.classList.toggle('buy-size-unavailable', !available);

    // עדכן תיאור הגודל בפועל
    const pxEl = btn.querySelector('.buy-size-px');
    if (size === 'large' && pxEl) {
      pxEl.textContent = maxDim >= 5000
        ? `${photo.width}×${photo.height}px`
        : `נדרש ${5000}px+ (קובץ זה: ${maxDim}px)`;
    }
    if (size === 'medium' && pxEl && maxDim < 3000) {
      pxEl.textContent = `נדרש 3000px+ (קובץ זה: ${maxDim}px)`;
    }
  });

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeBuyModal() {
  const modal = document.getElementById('buy-modal');
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

function redirectToPayPal(photo, size) {
  const s = SIZES[size];
  const fileIdMatch = photo.url.match(/[?&]id=([\w-]+)/);
  const fileId = fileIdMatch ? fileIdMatch[1] : photo.id;

  const params = new URLSearchParams({
    cmd: '_xclick',
    business: PAYPAL_EMAIL,
    item_name: `${photo.title} — ${s.label}`,
    item_number: `${fileId}_${size}`,
    amount: s.price,
    currency_code: 'ILS',
    no_shipping: '1',
    return: `${SITE_URL}/download.html`,
    cancel_return: `${SITE_URL}/`,
    rm: '1',
  });

  window.location.href = `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
}

// ===== FAQ ACCORDION =====
document.querySelectorAll('.faq-question').forEach(btn => {
  btn.addEventListener('click', () => {
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    // Close all
    document.querySelectorAll('.faq-question').forEach(b => {
      b.setAttribute('aria-expanded', 'false');
      b.nextElementSibling.style.maxHeight = null;
    });
    // Open clicked if it was closed
    if (!isOpen) {
      btn.setAttribute('aria-expanded', 'true');
      btn.nextElementSibling.style.maxHeight = btn.nextElementSibling.scrollHeight + 'px';
    }
  });
});

// ===== PRINT SHOP =====
const PrintShop = (() => {
  let catalog = null;
  let currentPhoto = null;
  let selectedType = null;
  let selectedSku = null;
  let selectedPrice = null;

  function showStep(n) {
    [1, 2, 3].forEach(i => {
      document.getElementById(`print-step-${i}`).classList.toggle('active', i === n);
      const prog = document.getElementById(`print-prog-${i}`);
      if (prog) prog.className = 'print-prog-item' + (i === n ? ' current' : i < n ? ' done' : '');
    });
  }

  async function open(photo) {
    currentPhoto = photo;
    selectedType = null; selectedSku = null; selectedPrice = null;
    document.getElementById('print-modal-img').src = photo.thumbnail || photo.url;
    document.getElementById('print-modal-title').textContent = photo.title || '';
    document.getElementById('print-price-display').textContent = '';
    document.getElementById('print-error').textContent = '';
    showStep(1);
    document.getElementById('print-modal').classList.add('open');
    document.body.style.overflow = 'hidden';

    if (!catalog) {
      try {
        const r = await fetch('/api/print/catalog');
        catalog = await r.json();
      } catch { catalog = {}; }
    }
    renderTypes();
  }

  const TYPE_ICONS = {
    photo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="5" width="20" height="15" rx="1.5"/><circle cx="12" cy="12.5" r="3.5"/><path d="M9 5l1.2-2h3.6L15 5" stroke-linecap="round"/><circle cx="18.5" cy="8" r=".8" fill="currentColor" stroke="none"/></svg>`,
    canvas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 8h18M3 16h18M8 3v18M16 3v18" stroke-width="1" opacity=".5"/><circle cx="12" cy="12" r="2" stroke-width="1.5"/></svg>`,
    poster: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5" y="2" width="14" height="20" rx="1"/><path d="M8 7h8M8 11h8M8 15h5" stroke-linecap="round"/></svg>`,
  };

  function renderTypes() {
    const container = document.getElementById('print-type-options');
    container.innerHTML = Object.entries(catalog).map(([key, val]) =>
      `<button type="button" class="print-type-btn" data-type="${key}">
        <span class="print-type-icon">${TYPE_ICONS[key] || ''}</span>
        <span class="print-type-text">
          <strong>${val.label}</strong>
          <span class="print-type-desc">${val.desc}</span>
        </span>
      </button>`
    ).join('');
    container.querySelectorAll('.print-type-btn').forEach(btn => {
      btn.addEventListener('click', () => selectType(btn.dataset.type));
    });
  }

  function sizeVisual(w, h) {
    const maxDim = 28;
    const fw = parseFloat(w), fh = parseFloat(h);
    const isSquare = fw === fh;
    if (isSquare) return `<div class="size-vis" style="width:${maxDim}px;height:${maxDim}px"></div>`;
    const landscape = fw > fh;
    const ratio = landscape ? fh / fw : fw / fh;
    const vW = landscape ? maxDim : Math.max(12, Math.round(maxDim * ratio));
    const vH = landscape ? Math.max(12, Math.round(maxDim * ratio)) : maxDim;
    return `<div class="size-vis" style="width:${vW}px;height:${vH}px"></div>`;
  }

  function selectType(type) {
    selectedType = type;
    const t = catalog[type];
    document.getElementById('print-type-label').textContent = t.label;
    const container = document.getElementById('print-size-options');
    container.innerHTML = t.sizes.map(s =>
      `<button type="button" class="print-size-btn" data-sku="${s.sku}" data-w="${s.w}" data-h="${s.h}" data-minw="${s.minW}" data-minh="${s.minH}">
        ${sizeVisual(s.w, s.h)}
        <span>${s.label}</span>
      </button>`
    ).join('');
    container.querySelectorAll('.print-size-btn').forEach(btn => {
      btn.addEventListener('click', () => selectSize(btn));
    });
    document.getElementById('print-price-display').textContent = '';
    showStep(2);
  }

  // Crop preview state
  let cropOffsetX = 0, cropOffsetY = 0;
  let cropDragStartX, cropDragStartY, cropDragOffsetX, cropDragOffsetY;
  let cropImgNaturalW = 0, cropImgNaturalH = 0;
  let cropFrameW = 0, cropFrameH = 0;

  function initCropPreview(imageUrl, aspectW, aspectH, minW, minH) {
    const wrap = document.getElementById('print-preview-wrap');
    const frame = document.getElementById('print-crop-frame');
    const img = document.getElementById('print-crop-img');

    // Set frame aspect ratio, capped at 220px height
    const MAX_CROP_H = 220;
    const maxW = frame.parentElement.clientWidth || 400;
    const rawH = Math.round(maxW * aspectH / aspectW);
    if (rawH > MAX_CROP_H) {
      cropFrameH = MAX_CROP_H;
      cropFrameW = Math.round(MAX_CROP_H * aspectW / aspectH);
    } else {
      cropFrameH = rawH;
      cropFrameW = maxW;
    }
    frame.style.width = cropFrameW + 'px';
    frame.style.height = cropFrameH + 'px';

    // Reset offset
    cropOffsetX = 0;
    cropOffsetY = 0;

    img.onload = () => {
      cropImgNaturalW = img.naturalWidth;
      cropImgNaturalH = img.naturalHeight;

      // Scale image so it covers the frame (like object-fit: cover)
      const scaleX = cropFrameW / cropImgNaturalW;
      const scaleY = cropFrameH / cropImgNaturalH;
      const scale = Math.max(scaleX, scaleY);
      const dispW = Math.round(cropImgNaturalW * scale);
      const dispH = Math.round(cropImgNaturalH * scale);
      img.style.width = dispW + 'px';
      img.style.height = dispH + 'px';

      // Center
      cropOffsetX = Math.round((cropFrameW - dispW) / 2);
      cropOffsetY = Math.round((cropFrameH - dispH) / 2);
      img.style.transform = `translate(${cropOffsetX}px, ${cropOffsetY}px)`;

      // Resolution check
      if (minW && minH) {
        const resEl = document.getElementById('print-res-warning');
        const level = checkResolution(img, minW, minH);
        if (level === 'block') {
          resEl.className = 'print-res-block';
          resEl.textContent = '❌ הרזולוציה נמוכה מדי לגודל זה — בחר גודל קטן יותר';
          document.getElementById('print-to-details-btn').classList.remove('visible');
          selectedPrice = null;
        } else if (level === 'warn') {
          resEl.className = 'print-res-warn';
          resEl.textContent = '⚠️ הרזולוציה בינונית — התוצאה עשויה להיות פחות חדה';
        } else {
          resEl.className = '';
          resEl.textContent = '✓ רזולוציה מתאימה להדפסה';
          resEl.className = 'print-res-ok';
        }
      }
    };
    img.src = imageUrl;
    wrap.classList.remove('hidden');

    // Drag — mouse
    frame.onmousedown = e => {
      e.preventDefault();
      frame.classList.add('dragging');
      cropDragStartX = e.clientX;
      cropDragStartY = e.clientY;
      cropDragOffsetX = cropOffsetX;
      cropDragOffsetY = cropOffsetY;
      document.onmousemove = dragMove;
      document.onmouseup = dragEnd;
    };

    // Drag — touch
    frame.ontouchstart = e => {
      const t = e.touches[0];
      frame.classList.add('dragging');
      cropDragStartX = t.clientX;
      cropDragStartY = t.clientY;
      cropDragOffsetX = cropOffsetX;
      cropDragOffsetY = cropOffsetY;
      document.ontouchmove = dragMoveTouch;
      document.ontouchend = dragEnd;
    };
  }

  function clampOffset(ox, oy) {
    const img = document.getElementById('print-crop-img');
    const dispW = parseInt(img.style.width);
    const dispH = parseInt(img.style.height);
    const minX = cropFrameW - dispW;
    const minY = cropFrameH - dispH;
    return {
      x: Math.min(0, Math.max(minX, ox)),
      y: Math.min(0, Math.max(minY, oy))
    };
  }

  function applyOffset(ox, oy) {
    const { x, y } = clampOffset(ox, oy);
    cropOffsetX = x; cropOffsetY = y;
    document.getElementById('print-crop-img').style.transform = `translate(${x}px, ${y}px)`;
  }

  function dragMove(e) {
    applyOffset(cropDragOffsetX + e.clientX - cropDragStartX, cropDragOffsetY + e.clientY - cropDragStartY);
  }
  function dragMoveTouch(e) {
    const t = e.touches[0];
    applyOffset(cropDragOffsetX + t.clientX - cropDragStartX, cropDragOffsetY + t.clientY - cropDragStartY);
  }
  function dragEnd() {
    document.getElementById('print-crop-frame').classList.remove('dragging');
    document.onmousemove = document.onmouseup = document.ontouchmove = document.ontouchend = null;
  }

  function checkResolution(imgEl, minW, minH) {
    // Returns: 'ok' | 'warn' | 'block'
    // Uses real Prodigi pixel requirements (minW x minH)
    const pw = imgEl.naturalWidth;
    const ph = imgEl.naturalHeight;
    if (!pw || !ph || !minW || !minH) return 'ok';

    // For fillPrintArea: image must cover the print area
    // Scale to fill: take max scale so both dimensions are covered
    const scaleW = minW / pw;
    const scaleH = minH / ph;
    const scale = Math.max(scaleW, scaleH);

    // scale > 1 means image needs to be upscaled
    if (scale > 2.0) return 'block';   // need more than 2x upscale
    if (scale > 1.2) return 'warn';    // need 20%-200% upscale
    return 'ok';
  }

  async function selectSize(btn) {
    document.getElementById('print-size-options').querySelectorAll('.print-size-btn')
      .forEach(b => b.classList.toggle('active', b === btn));
    selectedSku = btn.dataset.sku;
    selectedPrice = null;
    document.getElementById('print-to-details-btn').classList.remove('visible');

    // Show crop preview immediately
    const aspectW = parseFloat(btn.dataset.w);
    const aspectH = parseFloat(btn.dataset.h);
    const minW    = parseFloat(btn.dataset.minw);
    const minH    = parseFloat(btn.dataset.minh);
    initCropPreview(getLightboxUrl(currentPhoto.url), aspectW, aspectH, minW, minH);

    document.getElementById('print-price-display').textContent = 'טוען מחיר...';
    try {
      const r = await fetch('/api/print/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: selectedSku })
      });
      const data = await r.json();
      if (r.ok) {
        selectedPrice = data.sellPrice;
        document.getElementById('print-price-display').textContent = `$${data.sellPrice} — כולל משלוח לישראל`;
        document.getElementById('print-to-details-btn').classList.add('visible');
      } else {
        document.getElementById('print-price-display').textContent = data.error || 'שגיאה בטעינת מחיר';
      }
    } catch {
      document.getElementById('print-price-display').textContent = 'שגיאת רשת';
    }
  }

  function goToDetails() {
    if (!selectedSku || !selectedPrice) return;
    document.getElementById('print-pay-amount').textContent = `$${selectedPrice}`;
    document.getElementById('print-error').textContent = '';
    showStep(3);
  }

  function close() {
    document.getElementById('print-modal').classList.remove('open');
    document.body.style.overflow = '';
  }

  function pay() {
    const name = document.getElementById('print-name').value.trim();
    const phone = document.getElementById('print-phone').value.trim();
    const email = document.getElementById('print-email').value.trim();
    const line1 = document.getElementById('print-line1').value.trim();
    const city = document.getElementById('print-city').value.trim();
    const zip = document.getElementById('print-zip').value.trim();

    if (!name || !phone || !line1 || !city || !zip) {
      document.getElementById('print-error').textContent = 'נא למלא את כל השדות המסומנים ב-*';
      return;
    }

    const address = { name, phone, email, line1, city, zip };
    const customB64 = btoa(unescape(encodeURIComponent(JSON.stringify(address))));
    const itemNumber = `PRINT_${currentPhoto.id}_${selectedSku}`;
    const itemName = `${currentPhoto.title || 'תמונה'} — ${catalog[selectedType]?.sizes.find(s => s.sku === selectedSku)?.label || ''}`;

    const params = new URLSearchParams({
      cmd: '_xclick',
      business: PAYPAL_EMAIL,
      item_name: itemName,
      item_number: itemNumber,
      amount: selectedPrice,
      currency_code: 'USD',
      no_shipping: '1',
      custom: customB64,
      return: `${SITE_URL}/print-complete.html`,
      cancel_return: `${SITE_URL}/`,
      rm: '1',
    });
    window.location.href = `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
  }

  function init() {
    document.getElementById('print-modal-close').addEventListener('click', close);
    document.getElementById('print-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('print-modal')) close();
    });
    document.getElementById('print-back-1').addEventListener('click', () => {
      showStep(1);
      document.getElementById('print-preview-wrap').classList.add('hidden');
    });
    document.getElementById('print-back-2').addEventListener('click', () => {
      showStep(2);
      if (!selectedPrice) document.getElementById('print-to-details-btn').classList.remove('visible');
    });
    document.getElementById('lb-print').addEventListener('click', () => {
      const photo = window._currentLightboxPhoto;
      if (photo) open(photo);
    });
    document.getElementById('print-to-details-btn').addEventListener('click', goToDetails);
    document.getElementById('print-pay-btn').addEventListener('click', pay);
  }

  return { init, open };
})();

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
