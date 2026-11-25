// Tema claro/oscuro. Se carga en <head> (script externo, sin inline) para evitar parpadeo.
// La preferencia ('system' | 'light' | 'dark') no es sensible: va en localStorage.
(function () {
  var KEY = 'boveda.theme';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  var COLORS = { dark: '#141A24', light: '#F3EFE6' };
  function pref() { try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch (e) { return 'system'; } }
  function resolved() { var p = pref(); return p === 'system' ? (mq && mq.matches ? 'light' : 'dark') : p; }
  function apply() {
    var r = resolved();
    document.documentElement.setAttribute('data-theme', r);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', COLORS[r]);
  }
  function set(v) { try { if (v === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch (e) { /* sin almacenamiento */ } apply(); }
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
  window.bovedaTheme = { pref: pref, resolved: resolved, set: set };
  apply();
})();
