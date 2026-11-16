(() => {
  const layout = document.querySelector('.layout');
  const button = document.querySelector('.reading-toggle');
  if (!layout || !button) return;
  button.addEventListener('click', () => {
    const expanded = layout.classList.toggle('reading-expanded');
    button.setAttribute('aria-pressed', String(expanded));
    button.setAttribute('aria-label', expanded ? 'Restore model view' : 'Expand reading panel');
    button.title = expanded ? 'Restore model view' : 'Expand reading panel';
    button.textContent = expanded ? '›' : '‹';
    window.dispatchEvent(new Event('resize'));
  });
})();
