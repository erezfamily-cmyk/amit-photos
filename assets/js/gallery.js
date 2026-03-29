// ===== GALLERY STATE =====
let allPhotos = [];
let filteredPhotos = [];
let currentIndex = 0;
let currentCategory = 'all';

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  initNav();
  await loadPhotos();
  initFilters();
  initLightbox();
  initContactForm();
});

// ===== NAV =====
function initNav() {
  const hamburger = document.querySelector('.nav-hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });
  }

  // Active link on scroll
  const sections = document.querySelectorAll('[data-section]');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        const id = e.target.dataset.section;
        const link = document.querySelector(`.nav-links a[href="#${id}"]`);
        if (link) link.classList.add('active');
      }
    });
  }, { threshold: 0.4 });

  sections.forEach(s => observer.observe(s));
}

// ===== LOAD PHOTOS =====
async function loadPhotos() {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;

  grid.innerHTML = `<div class="gallery-loading"><div class="spinner"></div>טוען תמונות...</div>`;

  try {
    const res = await fetch('data/photos.json');
    if (!res.ok) throw new Error('no data');
    allPhotos = await res.json();
  } catch {
    // Use demo data if no real data
    allPhotos = getDemoPhotos();
  }

  filteredPhotos = [...allPhotos];
  renderGallery();
}

// ===== DEMO DATA =====
function getDemoPhotos() {
  const categories = ['טבע', 'פורטרט', 'עירוני', 'אירועים'];
  const photos = [];
  const sizes = [
    [800, 1200], [800, 600], [800, 1000], [800, 800],
    [800, 1100], [800, 700], [800, 900], [800, 1300],
  ];

  const colors = [
    '1a1a2e/c8a96e', '16213e/e0c080', '0f3460/c8a96e',
    '533483/ffffff', '2d4739/c8a96e', '3d2b1f/e0c080',
    '1c1c1c/888888', '2a1a0e/c8a96e',
  ];

  for (let i = 0; i < 16; i++) {
    const cat = categories[i % categories.length];
    const [w, h] = sizes[i % sizes.length];
    const color = colors[i % colors.length];
    photos.push({
      id: `demo-${i}`,
      title: `תמונה ${i + 1}`,
      category: cat,
      url: `https://placehold.co/${w}x${h}/${color}?text=${encodeURIComponent(cat)}`,
      thumbnail: `https://placehold.co/${w}x${h}/${color}?text=${encodeURIComponent(cat)}`,
      description: `תיאור תמונה לדוגמה — ${cat}`,
    });
  }
  return photos;
}

// ===== RENDER GALLERY =====
function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;

  if (filteredPhotos.length === 0) {
    grid.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding:4rem; width:100%">אין תמונות בקטגוריה זו.</p>`;
    return;
  }

  grid.innerHTML = filteredPhotos.map((photo, idx) => `
    <div class="gallery-item" data-idx="${idx}" data-category="${photo.category}">
      <img
        src="${photo.thumbnail || photo.url}"
        alt="${photo.title}"
        loading="lazy"
      />
      <div class="gallery-item-overlay">
        <div class="gallery-item-info">
          <h3>${photo.title}</h3>
          <span>${photo.category}</span>
        </div>
      </div>
    </div>
  `).join('');

  // Attach click handlers
  grid.querySelectorAll('.gallery-item').forEach(item => {
    item.addEventListener('click', () => {
      currentIndex = parseInt(item.dataset.idx);
      openLightbox(currentIndex);
    });
  });
}

// ===== FILTERS =====
function initFilters() {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;

  const categories = ['all', ...new Set(allPhotos.map(p => p.category))];

  bar.innerHTML = categories.map(cat => `
    <button class="filter-btn ${cat === 'all' ? 'active' : ''}" data-cat="${cat}">
      ${cat === 'all' ? 'הכל' : cat}
    </button>
  `).join('');

  bar.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.dataset.cat;
      filterGallery(currentCategory);
    });
  });
}

function filterGallery(cat) {
  filteredPhotos = cat === 'all' ? [...allPhotos] : allPhotos.filter(p => p.category === cat);
  renderGallery();
}

// ===== LIGHTBOX =====
function initLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;

  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  document.getElementById('lb-prev').addEventListener('click', () => navigateLightbox(-1));
  document.getElementById('lb-next').addEventListener('click', () => navigateLightbox(1));

  lb.addEventListener('click', e => {
    if (e.target === lb) closeLightbox();
  });

  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') navigateLightbox(-1);
    if (e.key === 'ArrowLeft') navigateLightbox(1);
  });
}

function openLightbox(idx) {
  currentIndex = idx;
  const photo = filteredPhotos[idx];
  if (!photo) return;

  const lb = document.getElementById('lightbox');
  document.getElementById('lb-img').src = photo.url;
  document.getElementById('lb-img').alt = photo.title;
  document.getElementById('lb-title').textContent = photo.title;
  document.getElementById('lb-cat').textContent = photo.category;
  lb.classList.add('open');
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

// ===== CONTACT FORM =====
function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  form.addEventListener('submit', e => {
    e.preventDefault();
    const btn = form.querySelector('.form-submit');
    btn.textContent = 'שולח...';
    btn.disabled = true;

    // Simulate send (replace with real service later)
    setTimeout(() => {
      form.style.display = 'none';
      document.getElementById('form-success').style.display = 'block';
    }, 1200);
  });
}
