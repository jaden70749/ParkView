(() => {
  const numbers = new Set([66, 54, 38, 71, 59, 47, 50]);
  const demo = window.PARKVIEW_DEMO = {
    active: false, revealed: false, lotId: null, floorId: null,
    applies(lotId, floorId) { return this.active && this.lotId === String(lotId) && this.floorId === floorId; },
    occupied(number) { return this.revealed && numbers.has(number); }
  };
  const update = () => {
    const button = document.querySelector('#demoModeButton');
    button.setAttribute('aria-pressed', String(demo.active));
    const label = demo.active ? '수동 시연 종료' : '수동 시연 시작';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    document.querySelector('#demoModeStatus').textContent = demo.active
      ? `수동 시연 · ${demo.revealed ? '사전 설정 7칸 표시' : 'CCTV 영상 확인'}` : '';
    window.dispatchEvent(new CustomEvent('parkview:demo-mode'));
  };
  document.querySelector('#demoModeButton').addEventListener('click', () => {
    const context = window.PARKVIEW_ACTIVE_FLOOR_CONTEXT;
    if (!demo.active && (!context?.lotId || !context?.floorId)) return;
    demo.active = !demo.active;
    demo.revealed = false;
    demo.lotId = String(context?.lotId || '');
    demo.floorId = context?.floorId;
    update();
  });
  document.addEventListener('keydown', event => {
    if (!demo.active || event.repeat || event.ctrlKey || event.metaKey || event.altKey
        || event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    const context = window.PARKVIEW_ACTIVE_FLOOR_CONTEXT;
    if (!demo.applies(context?.lotId, context?.floorId)) return;
    if (event.key !== '₩' && event.key !== '\\' && event.code !== 'Backslash') return;
    event.preventDefault();
    demo.revealed = !demo.revealed;
    update();
  });
})();
