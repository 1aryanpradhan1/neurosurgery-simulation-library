(() => {
    const back = document.querySelector('[data-case-back]');
    if (!back) return;

    const fallback = new URL(back.href, location.href);
    const destinations = {
        home: new URL('index.html', fallback),
        procedures: new URL('procedures.html', fallback),
        cases: new URL('cases.html', fallback),
    };
    const from = new URLSearchParams(location.search).get('from');
    const caseRedirect = new URL('case-simulation.html', fallback);
    let previous = null;
    try {
        const candidate = new URL(document.referrer);
        const isCaseRedirect = candidate.origin === caseRedirect.origin && candidate.pathname === caseRedirect.pathname;
        if (!isCaseRedirect && ['http:', 'https:'].includes(candidate.protocol) &&
            (candidate.origin !== location.origin || candidate.pathname !== location.pathname)) {
            previous = candidate;
        }
    } catch (_) {
        // Direct entry or a browser that does not expose the referrer.
    }
    back.href = (previous || destinations[from] || fallback).href;
})();
