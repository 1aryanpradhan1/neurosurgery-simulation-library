(() => {
    const back = document.querySelector('[data-case-back]');
    const fallback = new URL(back.href);
    const destinations = {
        home: new URL('index.html', fallback),
        procedures: new URL('procedures.html', fallback),
        cases: new URL('cases.html', fallback),
    };
    const directory = new URL('./', fallback);
    const from = new URLSearchParams(location.search).get('from');
    const referrer = document.referrer ? new URL(document.referrer) : null;
    const isFrom = page => referrer?.origin === page.origin && referrer.pathname === page.pathname;
    const previous = isFrom(directory) ? 'home' : Object.keys(destinations).find(key => isFrom(destinations[key]));
    const destination = Object.hasOwn(destinations, from) ? from : previous;

    back.href = (destinations[destination] || fallback).href;
    if (destination && destination === previous) {
        back.href = referrer.href;
        back.addEventListener('click', event => {
            if (event.button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || history.length < 2) return;
            event.preventDefault();
            history.back();
        });
    }
})();
