(async () => {
    const files = ['assets/anatomy-01.bin', 'assets/anatomy-02.bin', 'assets/anatomy-03.bin'];
    const message = document.getElementById('guide-loading-message');
    try {
        if (typeof DecompressionStream === 'undefined')
            throw new Error('Please open this guide in a current version of Chrome, Edge, Firefox or Safari.');

        // The files are consecutive pieces of one gzip stream.
        const decoder = new DecompressionStream('gzip');
        const load = async () => {
            try {
                for (const [index, file] of files.entries()) {
                    const response = await fetch(file);
                    if (!response.ok) throw new Error('Anatomy data could not be loaded (' + response.status + ').');
                    await response.body.pipeTo(decoder.writable, { preventClose: true });
                    message.textContent = 'Loading Anatomy… ' + Math.round((index + 1) / files.length * 100) + '%';
                }
                await decoder.writable.close();
            } catch (error) {
                await decoder.writable.abort(error);
                throw error;
            }
        };
        const [data] = await Promise.all([new Response(decoder.readable).json(), load()]);
        if (!Array.isArray(data['mesh-data']) || data['mesh-data'].length !== 631)
            throw new Error('Anatomy data is incomplete. Please refresh the page.');

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
