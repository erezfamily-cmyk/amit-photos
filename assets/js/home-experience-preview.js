// The warm emotional homepage experience is now the default live homepage.
(function () {
  document.documentElement.classList.add('home-experience-preview');
  document.addEventListener('DOMContentLoaded', function () {
    const previewSection = document.getElementById('home-value');
    if (previewSection) previewSection.hidden = false;
  });
})();
