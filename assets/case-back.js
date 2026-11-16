(() => {
    const back = document.querySelector('[data-case-back]');
    const cases = new URL(back.href);
    const home = new URL('index.html', cases);
    const homeDirectory = new URL('./', cases);
    const from = new URLSearchParams(location.search).get('from');
    const referrer = document.referrer ? new URL(document.referrer) : null;
    const isFrom = page => referrer?.origin === page.origin && referrer.pathname === page.pathname;
    const fromHome = isFrom(home) || isFrom(homeDirectory);
    const fromCases = isFrom(cases);
    const useHome = from === 'home' || (from !== 'cases' && fromHome);

    back.href = useHome ? home.href : cases.href;
    if (useHome ? fromHome : fromCases) {
        back.href = referrer.href;
        back.addEventListener('click', event => {
            if (event.button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || history.length < 2) return;
            event.preventDefault();
            history.back();
        });
    }
})();
