(function () {
  const mqFine = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: fine)') : null;
  const mqWide = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 721px)') : null;
  const mqReduceMotion =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  let ring = null;
  let enabled = false;
  let raf = 0;
  let mx = 0;
  let my = 0;

  function shouldEnable() {
    return mqFine && mqFine.matches && mqWide && mqWide.matches && mqReduceMotion && !mqReduceMotion.matches;
  }

  function disable() {
    enabled = false;
    document.documentElement.classList.remove('has-custom-cursor');
    if (ring) {
      ring.classList.remove('is-visible', 'is-pressed');
    }
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
  }

  function ensureRing() {
    if (ring) return ring;
    ring = document.createElement('div');
    ring.className = 'custom-cursor-ring';
    ring.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ring);
    return ring;
  }

  function enable() {
    if (!shouldEnable()) return;
    enabled = true;
    document.documentElement.classList.add('has-custom-cursor');
    ensureRing();
  }

  function paint() {
    raf = 0;
    if (!enabled || !ring) return;
    ring.style.transform = `translate3d(${mx}px, ${my}px, 0) translate(-50%, -50%)`;
    ring.classList.add('is-visible');
  }

  function onPointerMove(e) {
    if (!enabled) return;
    if (typeof e.clientX !== 'number') return;
    mx = e.clientX;
    my = e.clientY;
    if (!raf) raf = window.requestAnimationFrame(paint);
  }

  function sync() {
    if (shouldEnable()) {
      enable();
    } else {
      disable();
    }
  }

  if (mqFine) mqFine.addEventListener('change', sync);
  if (mqWide) mqWide.addEventListener('change', sync);
  if (mqReduceMotion) mqReduceMotion.addEventListener('change', sync);
  window.addEventListener('resize', sync);

  document.addEventListener('pointermove', onPointerMove, { passive: true });

  function clearPressed() {
    if (ring) ring.classList.remove('is-pressed');
  }

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!enabled || !ring) return;
      if (e.button !== 0) return;
      ring.classList.add('is-pressed');
    },
    true
  );

  window.addEventListener('pointerup', clearPressed, true);
  window.addEventListener('pointercancel', clearPressed, true);
  window.addEventListener('blur', clearPressed);

  document.documentElement.addEventListener(
    'pointerleave',
    () => {
      if (ring) {
        ring.classList.remove('is-visible');
        ring.classList.remove('is-pressed');
      }
    },
    true
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync);
  } else {
    sync();
  }
})();
