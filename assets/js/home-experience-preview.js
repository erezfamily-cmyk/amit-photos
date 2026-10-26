// Optional visual review mode. This is deliberately off in the normal homepage.
(function () {
  if (new URLSearchParams(window.location.search).get('experience') !== 'warm') return;
  document.documentElement.classList.add('home-experience-preview');
  document.addEventListener('DOMContentLoaded', function () {
    const previewSection = document.getElementById('home-value');
    if (previewSection) previewSection.hidden = false;
  });
})();
