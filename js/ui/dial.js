// Puerta de caja fuerte con dial circular (SVG). Cada tecla gira el dial.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createDoor(host) {
  host.replaceChildren();
  // Placa fija: disco, tornillos y marca superior
  const face = el('svg', { viewBox: '0 0 280 280', class: 'door-face' }, host);
  el('circle', { cx: 140, cy: 140, r: 138, class: 'd-plate' }, face);
  el('circle', { cx: 140, cy: 140, r: 118, class: 'd-bevel' }, face);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    el('circle', { cx: (140 + Math.sin(a) * 128).toFixed(2), cy: (140 - Math.cos(a) * 128).toFixed(2), r: 3.2, class: 'd-bolt' }, face);
  }
  el('path', { d: 'M131 6h18l-9 24z', class: 'd-mark' }, face);

  // Dial giratorio: marcas de graduación y números
  const dial = el('svg', { viewBox: '0 0 200 200', class: 'door-dial' }, host);
  el('circle', { cx: 100, cy: 100, r: 98, class: 'd-disc' }, dial);
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, long = i % 5 === 0, r1 = 93, r2 = long ? 82 : 88;
    el('line', { x1: (100 + Math.sin(a) * r1).toFixed(2), y1: (100 - Math.cos(a) * r1).toFixed(2), x2: (100 + Math.sin(a) * r2).toFixed(2), y2: (100 - Math.cos(a) * r2).toFixed(2), class: long ? 'd-tick long' : 'd-tick' }, dial);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const t = el('text', { x: (100 + Math.sin(a) * 68).toFixed(2), y: (100 - Math.cos(a) * 68 + 3.6).toFixed(2), 'text-anchor': 'middle', class: 'd-num' }, dial);
    t.textContent = String(i * 10);
  }
  el('circle', { cx: 100, cy: 100, r: 52, class: 'd-inner' }, dial);

  // Cubo central fijo con ojo de cerradura
  const hub = el('svg', { viewBox: '0 0 24 24', class: 'door-hub' }, host);
  el('circle', { cx: 12, cy: 12, r: 11.5, class: 'd-hub' }, hub);
  el('circle', { cx: 12, cy: 10.2, r: 2.4, class: 'd-key' }, hub);
  el('path', { d: 'M12 12.4l-1.9 5.4h3.8z', class: 'd-key' }, hub);

  let angle = 0, dir = 1;
  const apply = () => { dial.style.transform = `rotate(${angle}deg)`; };
  return {
    turn() {
      host.classList.remove('err');
      if (reduced()) return;
      angle += dir * (dir > 0 ? 27 : 24);
      dir = -dir;
      apply();
    },
    shake() {
      host.classList.add('err');
      host.classList.remove('shake');
      void host.offsetWidth; // reinicia la animación
      host.classList.add('shake');
    },
    open() { if (!reduced()) { angle += 200; apply(); } },
    clear() { host.classList.remove('err', 'shake', 'open'); },
  };
}
