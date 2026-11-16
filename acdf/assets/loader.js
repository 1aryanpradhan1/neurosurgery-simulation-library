(async () => {
    const message = document.getElementById('guide-loading-message');
    try {
        if (typeof DecompressionStream === 'undefined')
            throw new Error('Please open this guide in a current version of Chrome, Edge, Firefox or Safari.');

        const response = await fetch('assets/anatomy-01.bin');
        if (!response.ok) throw new Error('Anatomy data could not be loaded (' + response.status + ').');
        const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
        if (!Array.isArray(data['mesh-data']) || data['mesh-data'].length !== 314)
            throw new Error('Anatomy data is incomplete. Please refresh the page.');

        message.textContent = 'Loading Anatomy… 100%';
        window.__GUIDE_DATA__ = data;
        const script = document.createElement('script');
        script.src = 'assets/app.js?v=overview-1';
        script.onload = () => document.getElementById('guide-loading')?.remove();
        script.onerror = () => { message.textContent = 'The guide could not be loaded. Please refresh the page.'; };
        document.body.append(script);
    } catch (error) {
        message.textContent = error.message || 'Anatomy could not be loaded. Please refresh the page.';
        console.error(error);
    }
})();
