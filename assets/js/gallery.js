// ===== STATE =====
let allPhotos = [];
let filteredPhotos = [];
let currentIndex = 0;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  initNav();
  initScrollReveal();
  initBackToTop();
  await loadPhotos();
  initFilters();
  initLightbox();
  initContactForm();
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
    const res = await fetch('data/photos.json?v=' + Date.now());
    if (!res.ok) throw new Error();
    allPhotos = await res.json();
  } catch {
    allPhotos = getDemoPhotos();
  }

  filteredPhotos = [...allPhotos];
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
function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;

  if (filteredPhotos.length === 0) {
    grid.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:4rem">אין תמונות בקטגוריה זו.</p>`;
    return;
  }

  grid.innerHTML = filteredPhotos.map((photo, idx) => `
    <div class="gallery-item" data-idx="${idx}">
      <img
        src="${photo.thumbnail || photo.url}"
        alt="${photo.title}"
        loading="lazy"
        onload="this.closest('.gallery-item').classList.add('loaded')"
      />
      <div class="gallery-item-overlay">
        <div class="gallery-item-info">
          <h3>${photo.title}</h3>
          <span>${photo.category}</span>
        </div>
      </div>
    </div>
  `).join('');

  // Staggered entrance animation
  grid.querySelectorAll('.gallery-item').forEach((item, i) => {
    setTimeout(() => item.classList.add('loaded'), i * 55);
    item.addEventListener('click', () => openLightbox(parseInt(item.dataset.idx)));
  });
}

// ===== FILTERS =====
function initFilters() {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;

  const categories = ['all', ...new Set(allPhotos.map(p => p.category))];

  bar.innerHTML = categories.map(cat => {
    const count = cat === 'all' ? allPhotos.length : allPhotos.filter(p => p.category === cat).length;
    return `
    <button class="filter-btn ${cat === 'all' ? 'active' : ''}" data-cat="${cat}">
      ${cat === 'all' ? 'הכל' : cat} <span class="filter-count">${count}</span>
    </button>`;
  }).join('');

  bar.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filteredPhotos = btn.dataset.cat === 'all'
        ? [...allPhotos]
        : allPhotos.filter(p => p.category === btn.dataset.cat);
      renderGallery();
    });
  });
}

// ===== LIGHTBOX =====
function initLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;

  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  document.getElementById('lb-prev').addEventListener('click', () => navigateLightbox(-1));
  document.getElementById('lb-next').addEventListener('click', () => navigateLightbox(1));
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });

  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') navigateLightbox(-1);
    if (e.key === 'ArrowLeft') navigateLightbox(1);
  });

  // Touch swipe support
  let touchX = null;
  lb.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    if (touchX === null) return;
    const diff = touchX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) navigateLightbox(diff > 0 ? 1 : -1);
    touchX = null;
  });
}

function getLightboxUrl(url) {
  // Replace full Google Drive export URL with a resized thumbnail (max 1600px wide)
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
  img.src = getLightboxUrl(photo.url);
  img.alt = photo.title;
  document.getElementById('lb-title').textContent = photo.title;
  document.getElementById('lb-cat').textContent = photo.category;
  document.getElementById('lb-counter').textContent = `${idx + 1} / ${filteredPhotos.length}`;
  const descEl = document.getElementById('lb-desc');
  descEl.textContent = photo.description || '';
  descEl.style.display = photo.description ? 'block' : 'none';

  // Progress bar
  const progress = document.getElementById('lb-progress');
  if (progress) progress.style.width = `${((idx + 1) / filteredPhotos.length) * 100}%`;

  // Download button — use Google Drive export=download if possible
  const dlBtn = document.getElementById('lb-download');
  if (dlBtn) {
    const driveMatch = photo.url.match(/[?&]id=([\w-]+)/);
    dlBtn.href = driveMatch
      ? `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`
      : photo.url;
  }

  // WhatsApp share
  const waBtn = document.getElementById('lb-share-wa');
  if (waBtn) {
    const shareText = `${photo.title} — ${window.location.href}`;
    waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
  }

  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
}

function navigateLightbox(dir) {
  currentIndex = (currentIndex + dir + filteredPhotos.length) % filteredPhotos.length;
  openLightbox(currentIndex);
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
// כדי לחבר לשליחה אמיתית: הרשם ב-https://formspree.io, צור טופס, והחלף את FORMSPREE_ID למטה
const FORMSPREE_ID = null; // לדוגמה: 'xpwzabcd'

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

    if (FORMSPREE_ID) {
      try {
        const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: new FormData(form),
        });
        if (!res.ok) throw new Error();
      } catch {
        btn.textContent = 'שלח הודעה ←';
        btn.disabled = false;
        alert('שגיאה בשליחה, נסה שוב.');
        return;
      }
    }

    form.style.display = 'none';
    document.getElementById('form-success').style.display = 'block';
  });
}
