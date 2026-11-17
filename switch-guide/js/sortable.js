// Touch-friendly drag-to-reorder using a handle. (HTML5 drag-and-drop doesn't work on iPhone.)
// makeSortable(listEl, { item: '.room', handle: '.room-handle', onEnd: (ids) => {} })
// Items need data-id. Works with nested lists because each handle only moves its own item.

export function makeSortable(list, { item, handle, onEnd }) {
  list.addEventListener('pointerdown', (e) => {
    const hEl = e.target.closest(handle);
    if (!hEl || !list.contains(hEl)) return;
    const dragEl = hEl.closest(item);
    if (!dragEl || dragEl.parentElement !== list) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    start(e, dragEl, hEl);
  });

  function start(e, dragEl, hEl) {
    const items = [...list.children].filter((c) => c.matches(item));
    const from = items.indexOf(dragEl);
    const rects = items.map((el) => el.getBoundingClientRect());
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
    const dragH = rects[from].height + gap;
    const startY = e.clientY;
    const startScroll = window.scrollY;
    let pointerY = e.clientY;
    let to = from;
    let raf = 0;
    try { hEl.setPointerCapture(e.pointerId); } catch (err) {}
    dragEl.classList.add('dragging');
    document.body.classList.add('is-dragging');
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) {} }

    const update = () => {
      const scrollDelta = window.scrollY - startScroll;
      const dy = pointerY - startY + scrollDelta;
      dragEl.style.transform = `translateY(${dy}px)`;
      // Moving up: the dragged item's top edge passes a neighbor's middle. Moving down: its bottom edge.
      // (Edges, not centers, so tall expanded rooms don't need to be dragged extra far.)
      const top = rects[from].top + dy, bottom = rects[from].bottom + dy;
      let target = from;
      for (let i = 0; i < items.length; i++) {
        if (i === from) continue;
        const mid = rects[i].top + rects[i].height / 2;
        if (i < from && top < mid) { target = Math.min(target, i); }
        if (i > from && bottom > mid) { target = Math.max(target, i); }
      }
      to = target;
      items.forEach((el, i) => {
        if (i === from) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -dragH;
        if (from > to && i < from && i >= to) shift = dragH;
        el.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };

    const autoScroll = () => {
      const edge = 70;
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      let v = 0;
      if (pointerY < edge) v = -Math.ceil((edge - pointerY) / 6);
      else if (pointerY > vh - edge) v = Math.ceil((pointerY - (vh - edge)) / 6);
      if (v) { window.scrollBy(0, v); update(); }
      raf = requestAnimationFrame(autoScroll);
    };
    raf = requestAnimationFrame(autoScroll);

    const move = (ev) => { if (ev.pointerId !== e.pointerId) return; pointerY = ev.clientY; update(); ev.preventDefault(); };
    const end = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      cancelAnimationFrame(raf);
      hEl.removeEventListener('pointermove', move);
      hEl.removeEventListener('pointerup', end);
      hEl.removeEventListener('pointercancel', end);
      items.forEach((el) => { el.style.transform = ''; });
      dragEl.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      if (to !== from) {
        const ref = to > from ? items[to].nextSibling : items[to];
        list.insertBefore(dragEl, ref);
        const ids = [...list.children].filter((c) => c.matches(item)).map((c) => c.dataset.id);
        onEnd(ids);
      }
    };
    hEl.addEventListener('pointermove', move, { passive: false });
    hEl.addEventListener('pointerup', end);
    hEl.addEventListener('pointercancel', end);
  }
}
