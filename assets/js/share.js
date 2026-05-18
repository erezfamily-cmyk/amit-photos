(function () {
  var CSS = `
.share-bar {
  max-width: 900px;
  margin: 0 auto 0;
  padding: 1.25rem 1.25rem 0;
  display: flex;
  align-items: center;
  gap: .75rem;
  flex-wrap: wrap;
}
.share-bar-label {
  font-size: .78rem;
  color: #888;
  white-space: nowrap;
}
.share-btns {
  display: flex;
  gap: .5rem;
  flex-wrap: wrap;
}
.share-btn {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  padding: .35rem .75rem;
  border-radius: 20px;
  font-size: .75rem;
  font-weight: 700;
  cursor: pointer;
  text-decoration: none;
  border: none;
  transition: opacity .2s, transform .15s;
  white-space: nowrap;
}
.share-btn:hover { opacity: .85; transform: translateY(-1px); }
.share-btn svg { width: 14px; height: 14px; flex-shrink: 0; }
.share-btn-wa   { background: #25d366; color: #fff; }
.share-btn-fb   { background: #1877f2; color: #fff; }
.share-btn-tw   { background: #000;    color: #fff; }
.share-btn-copy { background: #c8a96e; color: #000; }
.share-btn-copy.copied { background: #4caf50; color: #fff; }
`;

  function inject() {
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);

    var bar = document.createElement('div');
    bar.className = 'share-bar';
    bar.id = 'shareBar';
    bar.innerHTML = buildHTML();

    var navPrev = document.querySelector('.nav-prev');
    if (navPrev) {
      navPrev.parentNode.insertBefore(bar, navPrev);
    } else {
      document.body.appendChild(bar);
    }

    // wire copy button
    var copyBtn = document.getElementById('shareCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        navigator.clipboard.writeText(window.location.href).then(function () {
          copyBtn.classList.add('copied');
          copyBtn.querySelector('.share-copy-label').textContent =
            (localStorage.getItem('lang') === 'en') ? 'Copied!' : 'הועתק!';
          setTimeout(function () {
            copyBtn.classList.remove('copied');
            updateLabels();
          }, 2000);
        });
      });
    }

    // sync with language changes
    window.addEventListener('storage', function (e) {
      if (e.key === 'lang') updateLabels();
    });

    // also hook into setLang if defined after us
    var _orig = window.setLang;
    Object.defineProperty(window, 'setLang', {
      get: function () { return _orig; },
      set: function (fn) {
        _orig = function () {
          fn.apply(this, arguments);
          updateLabels();
        };
      },
      configurable: true
    });
  }

  function buildHTML() {
    var url = encodeURIComponent(window.location.href);
    var title = encodeURIComponent(document.title.split('|')[0].trim());
    var lang = localStorage.getItem('lang') || 'he';
    var isEn = lang === 'en';

    var label  = isEn ? 'Share this guide:' : 'שתפו את המדריך:';
    var waText = isEn ? 'WhatsApp' : 'WhatsApp';
    var fbText = isEn ? 'Facebook' : 'Facebook';
    var twText = isEn ? 'Twitter' : 'Twitter';
    var cpText = isEn ? 'Copy link' : 'העתק קישור';

    var waURL = 'https://api.whatsapp.com/send?text=' + title + '%0A' + url;
    var fbURL = 'https://www.facebook.com/sharer/sharer.php?u=' + url;
    var twURL = 'https://twitter.com/intent/tweet?text=' + title + '&url=' + url;

    return (
      '<span class="share-bar-label" id="shareLabel">' + label + '</span>' +
      '<div class="share-btns">' +
        '<a class="share-btn share-btn-wa" id="shareWa" href="' + waURL + '" target="_blank" rel="noopener">' +
          svgWA() + '<span class="share-wa-label">' + waText + '</span>' +
        '</a>' +
        '<a class="share-btn share-btn-fb" id="shareFb" href="' + fbURL + '" target="_blank" rel="noopener">' +
          svgFB() + '<span class="share-fb-label">' + fbText + '</span>' +
        '</a>' +
        '<a class="share-btn share-btn-tw" id="shareTw" href="' + twURL + '" target="_blank" rel="noopener">' +
          svgTW() + '<span class="share-tw-label">' + twText + '</span>' +
        '</a>' +
        '<button class="share-btn share-btn-copy" id="shareCopyBtn">' +
          svgCopy() + '<span class="share-copy-label">' + cpText + '</span>' +
        '</button>' +
      '</div>'
    );
  }

  function updateLabels() {
    var bar = document.getElementById('shareBar');
    if (!bar) return;
    var lang = localStorage.getItem('lang') || 'he';
    var isEn = lang === 'en';

    var url   = encodeURIComponent(window.location.href);
    var title = encodeURIComponent(document.title.split('|')[0].trim());
    var waURL = 'https://api.whatsapp.com/send?text=' + title + '%0A' + url;
    var fbURL = 'https://www.facebook.com/sharer/sharer.php?u=' + url;
    var twURL = 'https://twitter.com/intent/tweet?text=' + title + '&url=' + url;

    var lbl = document.getElementById('shareLabel');
    if (lbl) lbl.textContent = isEn ? 'Share this guide:' : 'שתפו את המדריך:';

    var wa = document.getElementById('shareWa');
    if (wa) { wa.href = waURL; wa.querySelector('.share-wa-label').textContent = 'WhatsApp'; }

    var fb = document.getElementById('shareFb');
    if (fb) { fb.href = fbURL; fb.querySelector('.share-fb-label').textContent = 'Facebook'; }

    var tw = document.getElementById('shareTw');
    if (tw) { tw.href = twURL; tw.querySelector('.share-tw-label').textContent = 'Twitter'; }

    var cp = document.getElementById('shareCopyBtn');
    if (cp && !cp.classList.contains('copied')) {
      cp.querySelector('.share-copy-label').textContent = isEn ? 'Copy link' : 'העתק קישור';
    }
  }

  function svgWA() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.549 4.099 1.51 5.828L.057 23.09a.75.75 0 0 0 .916.928l5.303-1.392A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.707 9.707 0 0 1-4.95-1.354l-.357-.213-3.7.97.988-3.607-.23-.37A9.719 9.719 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/></svg>';
  }

  function svgFB() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>';
  }

  function svgTW() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
  }

  function svgCopy() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
