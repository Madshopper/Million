/* Tilbudsavisen (templates/butiksavis.html): bladr side for side med pilene,
 * ved at swipe (CSS scroll-snap) eller med piletasterne. På brede skærme står
 * to sider ved siden af hinanden som et opslag. */
(function () {
  'use strict';
  var book = document.querySelector('[data-avis-book]');
  if (!book) return;
  var track = book.querySelector('[data-avis-track]');
  var prev = book.querySelector('[data-avis-prev]');
  var next = book.querySelector('[data-avis-next]');
  var counter = book.querySelector('[data-avis-counter]');
  var pages = track ? track.querySelectorAll('.avis-page') : [];
  if (!track || !pages.length) return;

  function pageWidth() { return pages[0].getBoundingClientRect().width || 1; }
  function perView() { return Math.max(1, Math.round(track.clientWidth / pageWidth())); }
  function current() { return Math.round(track.scrollLeft / pageWidth()); }

  function update() {
    var i = current();
    var n = perView();
    var last = Math.min(pages.length, i + n);
    if (counter) counter.textContent = last > i + 1 ? 'Side ' + (i + 1) + '-' + last : 'Side ' + (i + 1);
    if (prev) prev.disabled = i <= 0;
    if (next) next.disabled = last >= pages.length;
  }

  function goTo(i) {
    i = Math.max(0, Math.min(pages.length - 1, i));
    track.scrollTo({ left: i * pageWidth(), behavior: 'smooth' });
  }

  if (prev) prev.addEventListener('click', function () { goTo(current() - perView()); });
  if (next) next.addEventListener('click', function () { goTo(current() + perView()); });

  var t = null;
  track.addEventListener('scroll', function () {
    if (t) cancelAnimationFrame(t);
    t = requestAnimationFrame(update);
  }, { passive: true });
  window.addEventListener('resize', update);

  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.target.isContentEditable) return;
    if (document.body.classList.contains('no-scroll')) return; // vare, kurv eller menu er åben
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current() + perView()); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current() - perView()); }
  });

  function jump(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var idx = Array.prototype.indexOf.call(pages, el);
    if (idx >= 0) goTo(idx);
  }
  book.querySelectorAll('[data-avis-jump]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      jump(a.getAttribute('data-avis-jump'));
      track.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
  if (location.hash) jump(location.hash.slice(1));
  update();
})();
