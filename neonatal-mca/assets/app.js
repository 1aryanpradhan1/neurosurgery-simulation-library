(() => {
    'use strict';
    const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
    const guideData = window.__GUIDE_DATA__;
    const backLink = $('[data-case-back]');
    if (backLink?.getAttribute('href') === '#') {
        backLink.href = 'https://github.com/1aryanpradhan1/neurosurgery-simulation-library';
    }
    const meshes = guideData?.['mesh-data'] ?? JSON.parse($('#mesh-data').textContent);
    meshes.push(...(window.pterionalExternalLandmarks || []));
    delete window.pterionalExternalLandmarks;
    const manifest = guideData?.['manifest-data'] ?? JSON.parse($('#manifest-data').textContent);
    const papers = manifest.papers;
    const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const mobileQuery = matchMedia('(max-width:760px)');
    let isMobile = mobileQuery.matches, desktopLabelPreference = true, mobileLabelPreference = false, viewZoom = 1;
    let steps = [], stage = 0, mode = '3d', selected = -1, contextAlpha = 1, contextSide = 'both', procedure = true, prelabelsOn = !isMobile, opening = 1, animationToken = 0, instrumentsOn = true, beforeCurrent = false, regionalContext = true, contextLayerSnapshot = null;
    const enabled = { skin: true, galea: true, pericranium: true, bone: true, brain: true, muscle: true, fascia: true, deepfascia: true, fat: true, arteries: true, veins: true, nerves: true, dura: true, arachnoid: true, clot: true };
    // Surgical palette: approximate unlit tissue albedo (sRGB) used by the material shader; Atlas keeps the manifest colours.
    const palettes = { atlas: { skin: '#d9a184', galea: '#d8dad3', pericranium: '#dcd6e4', bone: '#e2d5b8', brain: '#bca99d', muscle: '#b87367', fascia: '#a4c7ba', deepfascia: '#75a99a', fat: '#debd69', arteries: '#dd6268', veins: '#5f6fae', nerves: '#f2d776', dura: '#95b7bb', arachnoid: '#cfe3ea', clot: '#631b29' }, surgical: { skin: '#cf9a7f', galea: '#dcdbd3', pericranium: '#d8d9e0', bone: '#dccdb0', brain: '#d4aa9c', muscle: '#82302a', fascia: '#e2ddd1', deepfascia: '#d9dcd8', fat: '#e3c677', arteries: '#c4423d', veins: '#5e3e66', nerves: '#ede3c6', dura: '#c4bcb5', arachnoid: '#e6eef1', clot: '#631b29' } };
    const materialIds = { bone: 0, brain: 1, muscle: 2, fascia: 3, deepfascia: 3, fat: 4, arteries: 5, nerves: 6, dura: 7, veins: 8, arachnoid: 9, skin: 10, galea: 11, pericranium: 12, clot: 1 };
    let palette = 'surgical';
    try {
        if (localStorage.getItem('neonatal-mca-palette') === 'atlas')
            palette = 'atlas';
    }
    catch (error) { }
    const hexRgb = c => c.match(/\w\w/g).map(x => parseInt(x, 16) / 255);
    const surgicalRgb = Object.fromEntries(Object.entries(palettes.surgical).map(([k, c]) => [k, hexRgb(c)]));
    const allEnabled = Object.fromEntries(Object.keys(enabled).map(k => [k, false]));
    const canvas = $('#canvas'), host = $('#viewport');
    // Midpoint of the native cranial vault bounds, shared by every camera preset.
    const anatomyCenter = Object.freeze([...manifest.anatomyCenter]);
    // Camera state: viewQ/camFrame are described with the orientation helpers below; distance, pan (screen
    // space, before projection) and viewZoom follow Pterional PR #1.
    let gl = null, program = null, uniforms = {}, buffer = null, available = false, viewQ = qFromAngles(1.0, .25, 0), camFrame = 'head', distance = 15, pan = [0, 0], aspect = 1, scheduled = false, pickDirty = true, interactionActive = false, interactionTimer = 0;
    const LINE_MIN_HALF_PX = 1.3, LINE_NUDGE = .03;
    const projectionScale = () => 2.05 * viewZoom * Math.min(1, aspect / .88);
    const operativeSide = () => 'left';
    const sideSign = () => -1;

    // ---- Free rotation: orientation helpers -----------------------------------------------------------------------
    // Rotations are row-major 3x3 arrays [m00, m01, m02, m10, ...]; quaternions are [x, y, z, w].
    // View space: +x right, +y up, +z toward the viewer. The eye sits at +z = `distance` from the orbit target and the
    // perspective projection uses w = distance - z. Pan offsets the projected image in CSS pixels.
    // The camera orientation is the quaternion viewQ, which rotates the camera's reference frame (camFrame) into view
    // space:
    //   'head'  - patient model coordinates (+X patient left, +Y superior, +Z anterior). The camera moves with the head,
    //             so a head-pose change leaves the anatomy still on screen (only the room cues move). All anatomical
    //             presets are head-framed: Anterior/Right/Left/Top and step (recommended) views.
    //   'world' - the operating room (see the head-pose block below). The camera stays in the room while the head is
    //             posed; used by Surgeon's View, the 'position' step view and whenever the user changes the pose.
    // viewBasis() resolves the rotation and common anatomy center in model coordinates; the shader (uView, uTarget), transform(), project(),
    // picking, label anchors, depth sorting and cameraPosition() all use that basis.
    // Presets may still be authored as yaw/pitch(/roll): M = Rz(roll) * Rx(pitch) * Ry(yaw). The old
    // screenOrientation = -1 (image turned 180 degrees so the skull base is at the top) is roll = PI.
    function qMul(a, b) { return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; }
    function qNorm(q) { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map(x => x / n); }
    function qConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }
    function qAxis(axis, angle) { const n = Math.hypot(axis[0], axis[1], axis[2]) || 1, s = Math.sin(angle / 2) / n; return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]; }
    function qFromAngles(yaw, pitch, roll = 0) { return qMul(qAxis([0, 0, 1], roll), qMul(qAxis([1, 0, 0], pitch), qAxis([0, 1, 0], yaw))); }
    function qMat(q) { const [x, y, z, w] = q; return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]; }
    function matQ(m) { const [a, b, c, d, e, f, g, h, i] = m, t = a + e + i; let s; if (t > 0) {
        s = Math.sqrt(t + 1) * 2;
        return qNorm([(h - f) / s, (c - g) / s, (d - b) / s, s / 4]);
    } if (a > e && a > i) {
        s = Math.sqrt(1 + a - e - i) * 2;
        return qNorm([s / 4, (b + d) / s, (c + g) / s, (h - f) / s]);
    } if (e > i) {
        s = Math.sqrt(1 + e - a - i) * 2;
        return qNorm([(b + d) / s, s / 4, (f + h) / s, (c - g) / s]);
    } s = Math.sqrt(1 + i - a - e) * 2; return qNorm([(c + g) / s, (f + h) / s, s / 4, (d - b) / s]); }
    function mMul(a, b) { const r = []; for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
            r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]); return r; }
    function mT(a) { return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]; }
    function mApply(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
    const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], vScale = (a, k) => [a[0] * k, a[1] * k, a[2] * k], vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], vNorm = a => vScale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
    // Look-at orientation: `eye` is the direction from the target to the eye, `up` the frame direction drawn upward.
    function qLook(eye, up) { const z = vNorm(eye), x = vNorm(vCross(up, z)), y = vCross(z, x); return matQ([...x, ...y, ...z]); }
    // Best-effort yaw/pitch/roll of a head->view rotation (inverse of qFromAngles with |pitch| <= PI/2, so a view past
    // the vertex reports yaw + PI and roll + PI).
    function anglesOf(M) { return { yaw: Math.atan2(-M[6], M[8]), pitch: Math.asin(Math.max(-1, Math.min(1, M[7]))), roll: Math.atan2(-M[1], M[4]) }; }
    // ---- Surgical head positioning --------------------------------------------------------------------------------
    // World (operating-room) frame: patient supine, +Z_w toward the ceiling (gravity is -Z_w), +Y_w toward the head of
    // the table (where the surgeon sits), +X_w toward the patient's left. In the anatomical (neutral supine) pose the
    // model and world frames coincide. A head pose is a rigid rotation of the whole model (every mesh, marker,
    // instrument, label anchor and pick target) about POSE_PIVOT that maps model directions to world directions:
    //   P = Rx(-extension) * Rz(-s * lateral) * Ry(s * rotation),  s = sideSign(): +1 right-sided, -1 left (mirror)
    //   rotation  - contralateral turn about the patient's long axis (the face turns away from the operative side)
    //   extension - the vertex drops toward the floor (rotation about the table's left-right axis)
    //   lateral   - lateral flexion; positive tilts the vertex toward the contralateral shoulder
    //   world point = POSE_PIVOT + P * (model point - POSE_PIVOT)
    const POSE_PIVOT = manifest.casePositionPivot;
    // Illustrative left-up pose using a padded support.
    const POSE_DEFAULT = { rotation: 78, extension: 0, lateral: 0 }, POSE_KEYS = ['rotation', 'extension', 'lateral'];
    // poseSettings: the user-adjustable operative pose. poseOverride: null (follow the step), 'anatomical' or
    // 'operative' (Position toggle; cleared on every step change). poseShown/poseR: the pose drawn this frame.
    let poseSettings = { ...POSE_DEFAULT }, poseOverride = null, poseShown = { rotation: 0, extension: 0, lateral: 0 }, poseR = [1, 0, 0, 0, 1, 0, 0, 0, 1], poseBlend = null, poseClock = 0, propsOn = true, viewCache = null;
    // 0 = anatomical (neutral supine) ... 1 = operative pose, as the current step requests it. A step requests the
    // operative pose through its state ('position' is a state change like 'bone' or 'dura'): steps before 'position'
    // are anatomical, 'position' animates with the stage progress (opening slider, Before/After), later steps keep it.
    function poseFraction() { if (poseOverride)
        return poseOverride === 'operative' ? 1 : 0; const s = steps[stage]; if (!s)
        return 0; if (beforeCurrent)
        return s.beforeState.position ? 1 : 0; if (s.change === 'position')
        return smoothstep01(Math.max(0, Math.min(1, opening))); return s.state.position ? 1 : 0; }
    function requestedPose() { const f = poseFraction(); return Object.fromEntries(POSE_KEYS.map(k => [k, poseSettings[k] * f])); }
    function poseMatrix(p) { const s = sideSign(), r = Math.PI / 180; return qMat(qMul(qAxis([1, 0, 0], -p.extension * r), qMul(qAxis([0, 0, 1], -s * p.lateral * r), qAxis([0, 1, 0], s * p.rotation * r)))); }
    // Advance the displayed pose; called at the start of every draw. Step changes and the Anatomical/Operative toggle
    // glide over 0.65 s (poseBlend, timed by poseClock = the render frame time); slider input and the 'position' step
    // progress apply directly.
    function updatePose() { const want = requestedPose(); let shown = want; if (poseBlend && POSE_KEYS.every(k => Math.abs(poseBlend.from[k] - want[k]) < 1e-3))
        poseBlend = null; if (poseBlend) {
        const t = Math.max(0, Math.min(1, (poseClock - poseBlend.start) / poseBlend.duration)), e = smoothstep01(t);
        shown = Object.fromEntries(POSE_KEYS.map(k => [k, poseBlend.from[k] + (want[k] - poseBlend.from[k]) * e]));
        if (t >= 1)
            poseBlend = null;
        else
            render();
    } poseShown = shown; poseR = poseMatrix(shown); viewCache = null; }
    function startPoseBlend() { poseBlend = matchMedia('(prefers-reduced-motion: reduce)').matches ? null : { from: { ...poseShown }, start: performance.now(), duration: 650 }; }
    function posePoint(p, P = poseR) { return vAdd(POSE_PIVOT, mApply(P, vSub(p, POSE_PIVOT))); } // model -> world
    function poseInverse(p, P = poseR) { return vAdd(POSE_PIVOT, mApply(mT(P), vSub(p, POSE_PIVOT))); } // world -> model
    // Unit gravity direction in raw model coordinates (x not mirrored; the canonical, operative-side-right direction
    // is [g[0] * sideSign(), g[1], g[2]]). Neutral supine: [0, 0, -1], toward the occiput. Also uploaded each frame as
    // the vertex-shader uniform uGravity (declared for later work such as brain relaxation; unused until then).
    function gravityInModel() { return [-poseR[6], -poseR[7], -poseR[8]]; }
    function viewChanged() { viewCache = null; }
    // All cameras look at the same anatomical point. Room framing changes the
    // orientation relative to the patient pose, while the center follows the anatomy.
    function viewBasis() {
        if (!viewCache) {
            const V = qMat(viewQ);
            viewCache = { M: camFrame === 'world' ? mMul(V, poseR) : V, target: anatomyCenter };
        }
        return viewCache;
    }
    let camGlide = null;
    // Change the orientation frame while keeping the model-space pivot fixed.
    function attachCamera(frame) {
        if (frame === camFrame) return;
        const pose = matQ(poseR);
        const convert = q => qNorm(qMul(q, frame === 'world' ? qConj(pose) : pose));
        viewQ = convert(viewQ);
        if (camGlide) {
            camGlide.from.q = convert(camGlide.from.q);
            camGlide.to.q = convert(camGlide.to.q);
        }
        camFrame = frame;
        viewChanged();
    }

    function applyCamera(v) {
        if (v.frame) attachCamera(v.frame);
        if (v.q) viewQ = qNorm(v.q);
        else if (v.eye) viewQ = qLook(v.eye, v.up || [0, 1, 0]);
        else if (v.yaw != null) viewQ = qFromAngles(v.yaw, v.pitch || 0, v.roll || 0);
        if (v.distance != null) distance = v.distance;
        if (v.zoom != null) viewZoom = v.zoom;
        pan = [0, 0];
        viewChanged();
    }

    // Route explicit presets through the same centered camera as Reset and Recommended.
    function setCamera(v = {}) {
        stopGlide();
        cameraExplicit = true;
        applyCamera(v);
        render();
    }

    // Apply PR #1's incremental trackball in the screen plane for every view.
    function rotateByDrag(dx, dy, k = .008) { const len = Math.hypot(dx, dy); if (!len)
        return; viewQ = qNorm(qMul(qAxis([dy, dx, 0], len * k), viewQ)); viewChanged(); }
    function markInteraction() { interactionActive = true; pickDirty = false; clearTimeout(interactionTimer); interactionTimer = setTimeout(() => { if (pointers.size)
        return; interactionActive = false; render(true); }, 140); }
    // Camera glide: slerp the orientation and ease distance and zoom to a preset (same frame) over
    // `duration` ms, timed by poseClock like the pose blend. Used when the 'position' step frames the room; any user
    // camera input or preset cancels it (stopGlide).
    function qSlerp(a, b, t) { let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; if (d < 0) {
        b = b.map(x => -x);
        d = -d;
    } if (d > .9995)
        return qNorm(a.map((x, i) => x + (b[i] - x) * t)); const th = Math.acos(d), sa = Math.sin((1 - t) * th) / Math.sin(th), sb = Math.sin(t * th) / Math.sin(th); return a.map((x, i) => x * sa + b[i] * sb); }
    function glideCamera(v, duration = 1000) { attachCamera(v.frame || 'head'); const from = { q: viewQ, distance, zoom: viewZoom }; applyCamera(v); const to = { q: viewQ, distance, zoom: v.zoom ?? 1 }; if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        pan = [0, 0];
        viewZoom = to.zoom;
        camGlide = null;
    }
    else {
        viewQ = from.q;
        distance = from.distance;
        viewZoom = from.zoom;
        camGlide = { from, to, start: performance.now(), duration };
    } viewChanged(); render(); }
    // User camera input ends automatic room framing. An explicit preset also
    // prevents the Position step from taking control of the camera.
    let cameraExplicit = false;
    function stopGlide(user = true) {
        camGlide = null;
        if (user) cameraExplicit = true;
    }
    function updateGlide() { if (!camGlide)
        return; const { from, to } = camGlide, t = Math.max(0, Math.min(1, (poseClock - camGlide.start) / camGlide.duration)), e = smoothstep01(t), mix = (a, b) => a + (b - a) * e; viewQ = qSlerp(from.q, to.q, e); distance = mix(from.distance, to.distance); viewZoom = mix(from.zoom, to.zoom); viewChanged(); if (t >= 1)
        camGlide = null;
    else
        render(); }
    // Roll about the line of sight; a positive angle turns the image counter-clockwise.
    function rollView(angle) { viewQ = qNorm(qMul(qAxis([0, 0, 1], angle), viewQ)); viewChanged(); }
    const meshSide = m => m.procedureSide;
    const stepView = s => s.view;
    function setProcedureSide(side) {
        if (!['left', 'both'].includes(side)) return;
        contextSide = side;
        syncControls();
        updateChangeControls();
        clearSelection();
    }
    function setPalette(next) { if (!palettes[next])
        return; palette = next; try {
        localStorage.setItem('neonatal-mca-palette', next);
    }
    catch (error) { } syncControls(); if (mode === '2d')
        showSourceFigures();
    else
        render(); }
    function toggleFullContext() { const expanded = Object.keys(enabled).filter(k => enabled[k]).every(k => allEnabled[k]); if (!expanded) {
        contextLayerSnapshot = { ...allEnabled };
        // A step's contextLayers (the reflected scalp and soft tissue around the bony and intradural steps) join the
        // expanded view even though the step's relevant view leaves them out.
        const extra = steps[stage]?.contextLayers || [];
        for (const k in allEnabled)
            allEnabled[k] = enabled[k] || extra.includes(k);
        regionalContext = false;
    }
    else {
        Object.assign(allEnabled, contextLayerSnapshot || Object.fromEntries(Object.keys(allEnabled).map(k => [k, false])));
        regionalContext = true;
    } syncControls(); clearSelection(); updateChangeControls(); if (mode === '2d')
        showSourceFigures();
    else
        render(); }
    function titleCase(value) { return String(value).replace(/\b([a-z][a-z0-9]*)\b/gi, (word, _, offset) => { const low = word.toLowerCase(); if (/^(ii|iii|iv|vi|vii|viii|ix|xi|xii|ica|mca|aca|sta|csf|m1|m2|ct|cta|ssep)$/.test(low))
        return low.toUpperCase(); if (offset > 0 && ['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with'].includes(low))
        return low; return low[0].toUpperCase() + low.slice(1); }); }
    function updateMobilePanelHeight() { if (isMobile)
        $('#mobileModelDock').style.setProperty('--mobile-panel-height', Math.max(0, host.clientHeight - 62) + 'px'); }
    function zoomBy(factor, refreshPicking = true) { if (!Number.isFinite(factor) || factor <= 0)
        return; viewZoom = Math.max(.25, Math.min(16, viewZoom * factor)); render(refreshPicking); }
    function alignActiveStep() { const card = $$('.step')[stage], panel = $('#steps-panel'); if (!card || panel.hidden)
        return; if (isMobile) {
        panel.scrollTop += card.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    }
    else
        card.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    function updateMobileReaderHeight() { if (!isMobile)
        return; const card = $$('.step')[stage], panel = $('#steps-panel'), layout = $('.layout'); if (!card || panel.hidden || !panel.clientWidth)
        return; const probe = document.createElement('article'); probe.className = 'step active mobile-step-measure'; probe.setAttribute('aria-hidden', 'true'); probe.style.width = panel.clientWidth + 'px'; probe.innerHTML = `<div class="step-heading"><span class="step-number">${String(stage + 1).padStart(2, '0')}</span><div class="step-heading-text"><h2>${escape(titleCase(steps[stage].title))}</h2></div></div><p>${escape(steps[stage].body.split(/(?<=[.!?])\s+/).slice(0, 2).join(' '))}</p>`; document.body.append(probe); const available = layout.getBoundingClientRect().height, desired = Math.ceil(probe.getBoundingClientRect().height + $('#guideTabs').getBoundingClientRect().height + 3), height = Math.min(Math.max(132, available * .42), Math.max(150, desired)); probe.remove(); layout.style.setProperty('--mobile-reader-height', Math.round(height) + 'px'); updateMobilePanelHeight(); alignActiveStep(); }
    function syncMobileLayout() { const next = mobileQuery.matches; if (next !== isMobile) {
        if (isMobile)
            mobileLabelPreference = prelabelsOn;
        else
            desktopLabelPreference = prelabelsOn;
        isMobile = next;
        prelabelsOn = isMobile ? mobileLabelPreference : desktopLabelPreference;
        clearSelection();
    } const layers = $('#layerControls'), reset = $('#resetView'), pager = $('#stepPager'); if (isMobile) {
        $('#mobileModelDock').append(layers, reset);
        $('#mobileStepNav').append(pager);
    }
    else {
        $('#viewport').append(layers);
        $('#viewTools').append(reset);
        $('#stepStatus').append(pager);
    } syncControls(); requestAnimationFrame(() => { updateMobileReaderHeight(); alignActiveStep(); render(); }); }
    function downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); }
    function decode64(s) { const str = atob(s), bytes = new Uint8Array(str.length); for (let i = 0; i < str.length; i++)
        bytes[i] = str.charCodeAt(i); return bytes; }
    function setTab(t) { for (const k of ['overview', 'steps', 'indications', 'papers']) {
        $('#tab-' + k).setAttribute('aria-selected', k === t);
        $('#' + k + '-panel').hidden = k !== t;
    } if (t === 'steps') {
        updateMobileReaderHeight();
        alignActiveStep();
    } }
    $$('[role=tab]').forEach(b => b.onclick = () => setTab(b.id.slice(4)));
    const readingLayout = $('.layout'), readingToggle = $('.reading-toggle');
    readingToggle.addEventListener('click', () => {
        const expanded = readingLayout.classList.toggle('reading-expanded');
        readingToggle.setAttribute('aria-pressed', String(expanded));
        readingToggle.setAttribute('aria-label', expanded ? 'Restore model view' : 'Expand reading panel');
        readingToggle.title = expanded ? 'Restore model view' : 'Expand reading panel';
        readingToggle.textContent = expanded ? '›' : '‹';
        window.dispatchEvent(new Event('resize'));
    });
    function setMode(next) { animationToken++; mode = next; $('#mode3d').setAttribute('aria-pressed', mode === '3d'); $('#mode2d').setAttribute('aria-pressed', mode === '2d'); for (const s of ['#canvas', '#viewinfo', '.floating', '#gesturehint', '.viewtools', '#mobileModelDock', '#stepLabels', '#labelLines', '#orientGizmo'])
        $(s).toggleAttribute('hidden', mode !== '3d'); $('#figurepanel').hidden = mode === '3d'; $('#popup').hidden = true; if (mode === '2d') {
        $('#labelLines').replaceChildren();
        $('#stepLabels').replaceChildren();
        showSourceFigures();
    }
    else {
        render();
    } updateChangeControls(); }
    $('#mode3d').onclick = () => setMode('3d');
    $('#mode2d').onclick = () => setMode('2d');
    $('#creditsOpen').onclick = () => $('#credits').showModal();
    $('#creditsClose').onclick = () => $('#credits').close();
    const paperById = id => papers.find(p => p.id === id);
    const sourceLink = (url, label) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`;
    const caseSource = paperById('case');
    const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    const video = $('#caseVideo');
    const figureVideo = document.createElement('video');
    figureVideo.preload = 'metadata';
    figureVideo.muted = true;
    figureVideo.playsInline = true;
    let videoUrl = '', pendingSeek = null, figureSeek = null, videoFailed = false;
    let previousVideoTime = null, followingVideo = false, seekingFromGuide = false;
    let bufferingForSeek = false, resumeAfterLoad = false;

    function makeVideoSeekable() {
        if (bufferingForSeek) return;
        const source = videoUrl;
        bufferingForSeek = true;
        fetch(source).then(response => {
            if (!response.ok) throw Error('Video unavailable');
            return response.blob();
        }).then(blob => {
            if (videoUrl === source) attachVideo(blob, !video.paused);
        }).catch(() => {
            if (videoUrl !== source) return;
            pendingSeek = null;
            $('#caseVideoStatus').textContent = 'This server does not support video seeking. Load the MP4 from About to synchronize it with the guide.';
        });
    }

    function seekPendingVideo() {
        if (pendingSeek === null || video.readyState < 1 || videoFailed) return;
        if (pendingSeek < video.duration && Math.abs(video.currentTime - pendingSeek) > 0.01) {
            if (!videoUrl.startsWith('blob:') &&
                (!video.seekable.length || video.seekable.end(video.seekable.length - 1) < pendingSeek)) {
                makeVideoSeekable();
                return;
            }
            seekingFromGuide = true;
            video.currentTime = pendingSeek;
        }
        pendingSeek = null;
        if (resumeAfterLoad) {
            resumeAfterLoad = false;
            video.play().catch(() => {});
        }
    }

    function syncVideoStep() {
        const step = steps[stage];
        if (!step) return;
        const displayTime = step.videoTime === null ? '' : ' · ' + (step.time === null ? '~' : '') + formatTime(step.videoTime);
        if (followingVideo) {
            $('#caseVideoTime').textContent = displayTime;
            return;
        }
        pendingSeek = step.videoTime;
        $('#caseVideoTime').textContent = displayTime;
        seekPendingVideo();
    }

    function drawSourceFrame() {
        const canvas = $('#caseStill');
        if (!canvas || figureSeek === null || figureVideo.readyState < 2 ||
            Math.abs(figureVideo.currentTime - figureSeek) > .20) return;
        const width = Math.min(figureVideo.videoWidth, 1000);
        canvas.width = width;
        canvas.height = Math.round(width * figureVideo.videoHeight / figureVideo.videoWidth);
        canvas.getContext('2d').drawImage(figureVideo, 0, 0, canvas.width, canvas.height);
        canvas.hidden = false;
        $('#caseStillStatus').hidden = true;
    }

    function requestSourceFrame() {
        if (figureSeek === null || figureVideo.readyState < 1) return;
        if (figureSeek >= figureVideo.duration) {
            $('#caseStillStatus').textContent = 'This local file does not contain the cited timestamp.';
            return;
        }
        if (Math.abs(figureVideo.currentTime - figureSeek) > .025) figureVideo.currentTime = figureSeek;
        else drawSourceFrame();
    }

    function attachVideo(file, resume = false) {
        if (!file) return;
        if (videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
        videoUrl = URL.createObjectURL(file);
        previousVideoTime = null;
        seekingFromGuide = false;
        bufferingForSeek = false;
        resumeAfterLoad = resume;
        pendingSeek = null;
        videoFailed = false;
        $('#caseVideoPlayer').hidden = false;
        $('#caseVideoStatus').textContent = '';
        video.src = videoUrl;
        video.load();
        figureVideo.src = videoUrl;
        figureVideo.load();
        syncVideoStep();
        if (mode === '2d') showSourceFigures();
    }

    video.addEventListener('loadedmetadata', () => {
        seekPendingVideo();
        if (resumeAfterLoad && pendingSeek === null) {
            resumeAfterLoad = false;
            video.play().catch(() => {});
        }
    });
    video.addEventListener('seeking', () => { previousVideoTime = null; });
    video.addEventListener('seeked', () => {
        const now = video.currentTime;
        previousVideoTime = now;
        if (seekingFromGuide) {
            seekingFromGuide = false;
            return;
        }
        let selectedStep = 0;
        for (let i = 0; i < steps.length; i++) {
            if (steps[i].videoTime !== null && steps[i].videoTime <= now) selectedStep = i;
        }
        if (selectedStep >= 0 && selectedStep !== stage) {
            followingVideo = true;
            try { activate(selectedStep); } finally { followingVideo = false; }
        }
    });
    video.addEventListener('timeupdate', () => {
        const now = video.currentTime;
        if (!seekingFromGuide && pendingSeek === null && !video.seeking && !video.paused && previousVideoTime !== null && now >= previousVideoTime) {
            let next = -1;
            for (let i = 0; i < steps.length; i++) {
                const time = steps[i].videoTime;
                if (time !== null && time > previousVideoTime && time <= now) next = i;
            }
            if (next >= 0 && next !== stage) {
                followingVideo = true;
                try { activate(next); } finally { followingVideo = false; }
            }
        }
        previousVideoTime = now;
    });
    video.addEventListener('error', () => {
        if (!videoUrl) return;
        videoFailed = true;
        $('#caseVideoPlayer').hidden = true;
        $('#caseVideoImport').hidden = false;
        $('#caseVideoStatus').textContent = 'The video could not play. Load an MP4 from About.';
    });
    figureVideo.addEventListener('loadedmetadata', requestSourceFrame);
    figureVideo.addEventListener('loadeddata', drawSourceFrame);
    figureVideo.addEventListener('seeked', drawSourceFrame);
    figureVideo.addEventListener('error', () => {
        const status = $('#caseStillStatus');
        if (status) status.textContent = 'The local video frame could not load. The teaching figure is available below.';
    });
    $('#caseVideoFile').addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
            attachVideo(file);
            $('#credits').close();
        }
        e.target.value = '';
    });
    $('#operativeVideo').addEventListener('toggle', () => {
        updateMobileReaderHeight();
        alignActiveStep();
    });

    function stepCitations(ids) {
        const sources = ids.map(paperById);
        return `<ul class="study-citations">${sources.map(p => `<li>${sourceLink(p.url, p.citation)}</li>`).join('')}</ul>`;
    }

    function studyNotes(step) {
        const sources = step.sources.map(paperById);
        const numbers = sources.map((p, i) => sourceLink(p.url, `[${i + 1}]`)).join(' ');
        return `<details class="study-notes"><summary>Details</summary>
            <p>${escape(step.detail)} <span class="study-reference-links">${numbers}</span></p>
            <h4>Sources for This Step</h4>${stepCitations(step.sources)}</details>`;
    }

    function showSourceFigures() {
        const step = steps[stage], panel = $('#figurepanel');
        figureSeek = step.still ?? step.context;
        const related = step.time === null;
        const frame = figureSeek === null ? '' : `<figure class="source-figure">
            <canvas hidden id="caseStill" role="img" aria-label="${escape(step.caption)}"></canvas>
            <p id="caseStillStatus">${videoUrl ? 'Loading local frame…' : 'Load the recording from About to see this frame.'}</p>
            <figcaption><strong>${related ? 'Related frame' : 'Operative video'} · ${formatTime(figureSeek)}</strong>
                <p>${escape(step.caption)}</p>
                <p class="figure-credit">${escape(caseSource.citation)} © Congress of Neurological Surgeons 2026.</p>
                ${sourceLink(caseSource.url, 'Open published source')}</figcaption></figure>`;
        const reference = step.referenceFigure ? `<figure class="source-figure">
            <img src="${escape(step.referenceFigure)}" alt="Cadaveric views of the MCA in the Sylvian fissure and the M1 perforators">
            <figcaption><strong>Related Figure 5 · MCA Course and Perforators</strong>
                <p>Adult cadaveric context showing the MCA trajectory and its lenticulostriate branches.</p>
                <p class="figure-credit">${escape(paperById('mca').citation)}
                    ${sourceLink('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}</p>
                ${sourceLink(paperById('mca').url, 'Open published source')}</figcaption></figure>` : '';
        panel.innerHTML = `<section class="diagram source-figure-panel">
            <h2>${escape(titleCase(step.title))}</h2>
            ${frame}
            <figure class="source-figure">
                <img src="${escape(step.figure)}" alt="${escape(step.figureDescription)}">
                <figcaption><strong>Teaching Schematic</strong>
                    <p>${escape(step.figureDescription)}</p>
                    ${sourceLink(caseSource.url, 'Read the case report')}</figcaption></figure>
            ${reference}
            </section>`;
        if (videoUrl) requestSourceFrame();
    }

    function renderIndications() {
        const panel = $('#indications');
        for (const item of manifest.indications) {
            const button = document.createElement('button');
            button.className = 'indication-card';
            button.innerHTML = `<strong>${escape(item.title)}</strong><span>${escape(item.body)}</span>`;
            button.onclick = () => {
                setTab('steps');
                activate(steps.findIndex(s => s.id === item.step));
            };
            panel.append(button);
        }
    }

    function renderPapers() {
        const q = $('#paperSearch').value.trim().toLowerCase(), panel = $('#papers');
        const found = papers.filter(p => !q || JSON.stringify(p).toLowerCase().includes(q));
        panel.replaceChildren();
        for (const paper of found) {
            const card = document.createElement('article');
            card.className = 'paper-card';
            card.innerHTML = `<div class="meta">${escape(paper.citation)}</div><h2>${escape(paper.title)}</h2>
                <div class="meta">${escape(paper.kind)}</div><p>${escape(paper.summary)}</p>
                <div class="paper-actions">${sourceLink(paper.url, 'Read source ↗')}<button>◇ Related anatomy</button></div>`;
            card.querySelector('button').onclick = () => {
                setTab('steps');
                activate(steps.findIndex(s => s.id === paper.step));
            };
            panel.append(card);
        }
        $('#paperCount').textContent = papers.length;
        $('#paperEmpty').hidden = found.length > 0;
    }

    $('#paperSearch').oninput = renderPapers;

    const surface = ['skin', 'galea', 'pericranium', 'bone', 'muscle', 'fascia', 'deepfascia', 'fat', 'dura'];
    const boneExposure = ['bone', 'dura'];
    const deepScalp = ['galea', 'pericranium', 'bone', 'muscle', 'fascia', 'deepfascia', 'fat', 'dura'];
    const oblique = { yaw: -1.02, pitch: .28, distance: 17, zoom: 1.0 };
    function rebuild() {
        let state = {};
        steps = manifest.stepData.map(record => {
            const beforeState = state;
            state = { ...beforeState, ...record.changes };
            let groups = surface;
            let view = oblique;
            if (record.phase === 'exposure') {
                groups = ['scalp','expose-bone'].includes(record.id) ? surface : boneExposure;
                view = { yaw: -1.27, pitch: .18, distance: 16, zoom: 1.44 };
            }
            if (record.phase === 'deep' || record.phase === 'vascular-map') {
                groups = record.phase === 'deep' ? ['bone', 'dura'] : [];
                view = { yaw: -1.18, pitch: .12, distance: 14, zoom: 2.14 };
            }
            if (record.id === 'ct') groups = ['bone'];
            if (record.phase === 'galeal') groups = deepScalp;
            if (record.id === 'position') {
                view = { frame: 'world', eye: [.16, .76, .62], up: [0, 0, 1], distance: 17, zoom: 1.05 };
            }
            if (record.id === 'close-dura') groups = boneExposure;
            return { ...record, state, beforeState, groups, contextLayers: surface, view,
                change: record.changes.position ? 'position' : Object.keys(record.changes)[0] };
        });
        // Interpolate only between recorded timestamps; preserve original times for source captions.
        steps.forEach(step => { step.videoTime = step.time; });
        let previous = -1;
        for (let i = 0; i < steps.length; i++) {
            if (steps[i].time == null) continue;
            if (previous >= 0 && steps[i].time >= steps[previous].time) {
                for (let j = previous + 1; j < i; j++) {
                    steps[j].videoTime = steps[previous].time +
                        (steps[i].time - steps[previous].time) * (j - previous) / (i - previous);
                }
            }
            previous = i;
        }
        const panel = $('#steps');
        steps.forEach((step, i) => {
            const card = document.createElement('article');
            card.className = 'step';
            card.tabIndex = 0;
            card.innerHTML = `<div class="step-heading"><span class="step-number">${String(i + 1).padStart(2, '0')}</span>
                <div class="step-heading-text"><h2>${escape(titleCase(step.title))}</h2></div></div>
                <p>${escape(step.body)}</p>${studyNotes(step)}`;
            card.onclick = e => { if (!e.target.closest('details, a, button')) activate(i); };
            card.onkeydown = e => {
                if (e.target === card && ['Enter', ' '].includes(e.key)) {
                    e.preventDefault();
                    activate(i);
                }
            };
            panel.append(card);
        });
        renderIndications();
        renderPapers();
        activate(0);
        $('#planLive').textContent = steps.length + ' case steps.';
        const privateVideo = $('#privateVideo');
        if (privateVideo) {
            const payload = privateVideo.textContent.trim();
            try { attachVideo(new Blob([decode64(payload)], { type: 'video/mp4' })); }
            catch (error) {
                $('#caseVideoImport').hidden = false;
                $('#caseVideoStatus').textContent = 'The video could not load. Load an MP4 from About.';
            }
            privateVideo.remove();
        } else {
            // Add the authorized video at this repository-relative path.
            videoUrl = 'assets/operative-video.mp4';
            video.src = videoUrl;
            figureVideo.src = videoUrl;
            $('#caseVideoPlayer').hidden = false;
            $('#caseVideoImport').hidden = false;
            video.load();
            figureVideo.load();
            syncVideoStep();
        }
    }

    function hasStageChange() {
        return !!steps[stage]?.change;
    }
    function updateChangeControls() {
        if (!steps[stage]) return;
        const keys = Object.keys(enabled).filter(k => enabled[k]);
        const expanded = keys.every(k => allEnabled[k]), partial = Object.values(allEnabled).some(Boolean);
        regionalContext = !expanded;
        $('#regionalContext').hidden = mode !== '3d';
        $('#regionalContext').setAttribute('aria-pressed', expanded ? 'true' : partial ? 'mixed' : 'false');
        $('#sideCaption').textContent = contextSide === 'both' ? 'Both Hemispheres · Left Operative Side' : 'Left Operative Side';
        $('#focusChange').hidden = mode !== '3d';
        $('#compareChange').hidden = mode !== '3d' || !hasStageChange();
        const tool = meshes.some(m => m.instrument && visible(m));
        $('#visualnote').textContent = tool ? 'Cyan instruments show the maneuver schematically.' : 'Atlas anatomy with illustrative procedure states.';
        $('#surgeonView').hidden = mode !== '3d';
    }
    function syncControls() { $$('[data-layer]').forEach(e => e.checked = enabled[e.dataset.layer]); $$('[data-swatch]').forEach(e => e.style.background = palettes[palette][e.dataset.swatch]); if ($('#palette'))
        $('#palette').value = palette; $$('[data-all-layer]').forEach(e => e.checked = allEnabled[e.dataset.allLayer]); $('#side').value = contextSide; $('#procedure').checked = procedure; $('#prelabels').checked = prelabelsOn; $('#instruments').checked = instrumentsOn; }
    const persistentLayers = new Set(['brain', 'arteries', 'veins', 'nerves', 'arachnoid', 'clot']);
    function applyRecommendedView({ preserveCamera = false } = {}) { const s = steps[stage]; for (const k in enabled)
        enabled[k] = persistentLayers.has(k) || s.groups.includes(k); contextAlpha = 1; procedure = true; meshes.forEach(m => m.hidden = false); if (!preserveCamera) {
        cameraExplicit = false;
        viewZoom = 1;
        regionalContext = true;
        for (const k in allEnabled)
            allEnabled[k] = false;
        stopGlide();
        applyCamera({ frame: 'head', ...stepView(s) }); // head-framed, or world-framed for the 'position' step
        pan = [0, 0];
    } $('#presetname').textContent = titleCase(s.title); syncControls(); clearSelection(); playStepAnimation(); updateChangeControls(); render(); }
    let activeStepId = null;
    function activate(i) { animationToken++; stopGlide(false); startPoseBlend(); poseOverride = null; beforeCurrent = false; $('#compareChange').setAttribute('aria-pressed', false); $('#compareChange').textContent = 'Before'; stage = Math.max(0, Math.min(steps.length - 1, i)); opening = 1; $$('.step').forEach((c, j) => { c.classList.toggle('active', j === stage); c.setAttribute('aria-current', j === stage ? 'step' : 'false'); }); $('#stagecaption').textContent = String(stage + 1).padStart(2, '0') + ' · ' + titleCase(steps[stage].title); $('#stagecount').textContent = String(stage + 1).padStart(2, '0') + ' / ' + steps.length; $('#previous').disabled = stage === 0; $('#next').disabled = stage === steps.length - 1; // Entering the 'position' step glides the camera to the step's room-fixed view while the head turns into the
    // operative pose (the camera is pinned to the room, so the head moves rather than the room around it). Leaving it
    // with that framing untouched glides on to the new step's recommended (head-framed) view, so the walkthrough
    // returns to the anatomy, which then looks as it did before positioning existed.
    const changed = activeStepId !== steps[stage].id; if (changed && steps[stage].change === 'position' && $('#positionControls'))
        $('#positionControls').open = true; if (changed && !cameraExplicit && steps[stage].change === 'position') {
        glideCamera(stepView(steps[stage]), 1100);

    }
 activeStepId = steps[stage].id; syncVideoStep(); applyRecommendedView({ preserveCamera: true }); updateChangeControls(); updateMobileReaderHeight(); alignActiveStep(); if (mode === '2d')
        showSourceFigures(); }
    $('#previous').onclick = () => { setTab('steps'); activate(stage - 1); };
    $('#next').onclick = () => { setTab('steps'); activate(stage + 1); };
    $('#recommendedView').onclick = () => applyRecommendedView();
    $$('[data-layer]').forEach(e => e.onchange = () => { enabled[e.dataset.layer] = e.checked; clearSelection(); updateChangeControls(); render(); });
    $$('[data-all-layer]').forEach(e => e.onchange = () => { allEnabled[e.dataset.allLayer] = e.checked; regionalContext = !Object.values(allEnabled).some(Boolean); clearSelection(); updateChangeControls(); render(); });
    $('#side').onchange = e => setProcedureSide(e.target.value);
    $('#palette').onchange = e => setPalette(e.target.value);
    $('#procedure').onchange = e => { procedure = e.target.checked; playStepAnimation(); render(); };
    $('#prelabels').onchange = e => { prelabelsOn = e.target.checked; render(); };
    $('#instruments').onchange = e => { instrumentsOn = e.target.checked; syncControls(); updateChangeControls(); if (mode === '2d')
        showSourceFigures();
    else
        render(); };
    $('#focusChange').onclick = () => applyRecommendedView();
    $('#regionalContext').onclick = toggleFullContext;
    $('#compareChange').onclick = () => { startPoseBlend(); beforeCurrent = !beforeCurrent; animationToken++; opening = 1; $('#compareChange').setAttribute('aria-pressed', beforeCurrent); $('#compareChange').textContent = beforeCurrent ? 'After' : 'Before'; if (mode === '2d')
        showSourceFigures();
    else
        render(); };
    function playStepAnimation() { const token = ++animationToken; opening = 1; if (mode !== '3d' || !procedure || !hasStageChange() || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        $('#opening').value = 100;
        $('#openingValue').textContent = '100%';
        render();
        return;
    } const start = performance.now(); opening = 0; $('#opening').value = 0; $('#openingValue').textContent = '0%'; function tick(now) { if (token !== animationToken || mode !== '3d' || !procedure)
        return; opening = Math.min(1, (now - start) / 1500); $('#opening').value = Math.round(opening * 100); $('#openingValue').textContent = Math.round(opening * 100) + '%'; render(); if (opening < 1)
        requestAnimationFrame(tick); } requestAnimationFrame(tick); }
    $('#replay').onclick = () => { beforeCurrent = false; $('#compareChange').setAttribute('aria-pressed', false); $('#compareChange').textContent = 'Before'; playStepAnimation(); };
    $('#opening').oninput = e => { animationToken++; opening = +e.target.value / 100; $('#openingValue').textContent = Math.round(opening * 100) + '%'; render(); };
    function stateProgress(key) {
        if (!procedure || !steps[stage]) return 0;
        const s = steps[stage];
        if (s.id === 'scan' && ['proximal', 'distal'].includes(key)) return 1;
        const from = s.beforeState[key] || 0, to = s.state[key] || 0;
        return beforeCurrent ? from : from + (to - from) * opening;
    }

    function visible(m) {
        if (!m || m.hidden || (contextSide === 'left' && meshSide(m) === 'right' && !m.externalSurface)) return false;
        const step = steps[stage];
        if (m.marker) return procedure && !beforeCurrent && m.markerStages.includes(step.id) &&
            opening > (m.finish ? .88 : .06);
        if (m.instrument) return procedure && !beforeCurrent && instrumentsOn &&
            step.id === m.instrumentStage && opening > .08;
        const preview = step.id === 'scan' && m.preview;
        const relevant = m.externalSurface || !m.contextOnly || step.phase === 'overview' && m.overview;
        const inLayer = m.clip ? enabled.arteries || allEnabled.arteries :
            allEnabled[m.group] || enabled[m.group] && relevant;
        if (!inLayer) return false;
        if (!procedure) return !m.show || m.show === 'dura' && m.group === 'arachnoid';
        if (m.afterBone && stateProgress(m.afterBone) <= .015) return false;
        if (m.show && !preview && stateProgress(m.show) <= .03) return false;
        if (m.hide && stateProgress(m.hide) >= (m.move ? .985 : m.group === 'arachnoid' ? .94 : .55)) return false;
        if (m.move === 'posteriorBone' && stateProgress('posteriorBone') >= .995) return false;
        return true;
    }

    const opacity = m => m.opacity ?? 1;
    const changeKind = m => procedure && !beforeCurrent && m.highlight?.includes(steps[stage].id) ? 5 : 0;

    // Model point -> view space (JS mirror of the vertex shader: p = uView * (q - uTarget)).
    function transform(p) { const { M, target: t } = viewBasis(); return mApply(M, [p[0] - t[0], p[1] - t[1], p[2] - t[2]]); }
    // Eye position in the canonical (operative-side = right) model frame used by the fragment shader (vOriginal).
    function cameraPosition() { const { M, target: t } = viewBasis(); return vAdd(t, mApply(mT(M), [-pan[0], -pan[1], distance])); }
    // Match the shader projection, including PR #1 view-space pan.
    function project(p) { const t = transform(p), w = distance - t[2]; return [(t[0] + pan[0]) * projectionScale() / aspect / w * host.clientWidth / 2 + host.clientWidth / 2, host.clientHeight / 2 - (t[1] + pan[1]) * projectionScale() / w * host.clientHeight / 2]; }
    const smoothstep01 = t => t * t * (3 - 2 * t);
    // Retained pterional curl/peel with case-fitted hinge frames and a hinge-height table.
    const SHELL_C = manifest.shellCenter, CURL_NA = 16, CURL_ND = 24, INC_N = 24;
    const clamp01 = x => Math.max(0, Math.min(1, x));
    function gatherPoints(list, keep = () => true) { const out = []; for (const m of list) {
        ensureGeometry(m);
        const f = m.vertexData;
        for (let i = 0; i < f.length; i += 6)
            if (keep(f[i], f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5]))
                out.push(f[i], f[i + 1], f[i + 2]);
    } return out; }
    const outerOnShell = (x, y, z, nx, ny, nz) => { const r = [x - SHELL_C[0], y - SHELL_C[1], z - SHELL_C[2]]; return (nx * r[0] + ny * r[1] + nz * r[2]) / ((Math.hypot(...r) * Math.hypot(nx, ny, nz)) || 1) > .5; };
    // Hinge-height table (see 2. above): rows over hinge travel d in [0, dmax], CURL_NA bins over a; each entry is the
    // highest h of the source points within a band around that row, gaps interpolated along a, 3-tap smoothed.
    function curlProfile(fr, pts) { const n = pts.length / 3, A = [], D = [], H = []; let a0 = Infinity, a1 = -Infinity, dmax = 0; for (let i = 0; i < n; i++) {
        const v = [pts[3 * i] - fr.pivot[0], pts[3 * i + 1] - fr.pivot[1], pts[3 * i + 2] - fr.pivot[2]], d = vDot(v, fr.away);
        if (d <= -.05)
            continue;
        const a = vDot(v, fr.axis);
        A.push(a); D.push(d); H.push(vDot(v, fr.lift)); a0 = Math.min(a0, a); a1 = Math.max(a1, a); dmax = Math.max(dmax, d);
    } if (!A.length)
        return null; const da = Math.max(1e-3, (a1 - a0) / (CURL_NA - 1)), dd = Math.max(1e-3, dmax / (CURL_ND - 1)), band = Math.max(dd, .1), rows = new Float32Array(CURL_ND * CURL_NA).fill(-Infinity); for (let i = 0; i < A.length; i++) {
        const ai = Math.max(0, Math.min(CURL_NA - 1, Math.round((A[i] - a0) / da)));
        for (let j = Math.max(0, Math.ceil((D[i] - band) / dd)); j <= Math.min(CURL_ND - 1, Math.floor((D[i] + band) / dd)); j++)
            rows[j * CURL_NA + ai] = Math.max(rows[j * CURL_NA + ai], H[i]);
    } for (let j = 0; j < CURL_ND; j++) {
        const r = rows.subarray(j * CURL_NA, (j + 1) * CURL_NA), ok = [];
        r.forEach((x, i) => { if (Number.isFinite(x)) ok.push(i); });
        if (!ok.length) {
            if (j) r.set(rows.subarray((j - 1) * CURL_NA, j * CURL_NA)); else r.fill(0);
            continue;
        }
        for (let i = 0; i < CURL_NA; i++)
            if (!Number.isFinite(r[i])) {
                const lo = ok.filter(x => x < i).pop(), hi = ok.find(x => x > i);
                r[i] = lo === undefined ? r[hi] : hi === undefined ? r[lo] : r[lo] + (r[hi] - r[lo]) * (i - lo) / (hi - lo);
            }
        const c = Array.from(r);
        for (let i = 1; i < CURL_NA - 1; i++) r[i] = (c[i - 1] + 2 * c[i] + c[i + 1]) / 4;
    } return { a0, ia: 1 / da, dmax, rows }; }
    const DRAPE_NA = 12, DRAPE_NE = 8, DRAPE_ALLOW = .45, DRAPE_ALLOW_DURA = .065, DRAPE_BLEND = .4, DRAPE_DEEP = .25, DRAPE_KEYS = new Set(['scalp', 'myo', 'fascia', 'pericranium', 'dura-wide', 'dura-low']), SMALL_BONE = /incus|malleus|stapes|concha|ethmoid|hyoid|vomer|palatine|sinus/i;
    const drapeCache = {};
    function drapeTable(m, mo) {
        const dura = mo.key === 'dura';
        const skinFlap = meshes.find(x => x.id === 'scalp-leaf');
        if (!dura && !skinFlap) return null;
        const allow = dura ? DRAPE_ALLOW_DURA : DRAPE_ALLOW, ck = m.id + '|' + [...mo.pivot, ...mo.axis, ...mo.away, ...mo.lift, mo.R, mo.Tf].map(x => x.toFixed(5)).join(','); if (ck in drapeCache)
        return drapeCache[ck]; const NA = DRAPE_NA, NE = DRAPE_NE, R = mo.R, T = mo.Tf, RT = R * T, c = Math.cos(T), sn = Math.sin(T), awf = vAdd(vScale(mo.away, c), vScale(mo.lift, sn)), lif = vSub(vScale(mo.lift, c), vScale(mo.away, sn)), row0 = mo.prof.rows.subarray(0, CURL_NA), hpAt = a => { const fi = Math.max(0, Math.min(CURL_NA - 1, (a - mo.prof.a0) * mo.prof.ia)), i0 = Math.floor(fi), i1 = Math.min(i0 + 1, CURL_NA - 1); return row0[i0] + (row0[i1] - row0[i0]) * (fi - i0); };
        // skin-top samples of the flap in (a, e, t): t is the height above the rigidly folded plane along li
        const ref = dura ? gatherPoints([m]) : gatherPoints([skinFlap], outerOnShell), A = [], E = [], H = []; let a0 = Infinity, a1 = -Infinity, em = .1; for (let i = 0; i < ref.length; i += 3) {
            const v = [ref[i] - mo.pivot[0], ref[i + 1] - mo.pivot[1], ref[i + 2] - mo.pivot[2]], a = vDot(v, mo.axis), e = vDot(v, mo.away) - RT;
            if (e <= -.2) continue;
            A.push(a); E.push(e); H.push(vDot(v, mo.lift) - hpAt(a)); a0 = Math.min(a0, a); a1 = Math.max(a1, a); em = Math.max(em, e);
        } if (!A.length)
        return drapeCache[ck] = null; const da = Math.max(1e-3, (a1 - a0) / (NA - 1)), de = em / (NE - 1), sum = new Float64Array(NA * NE), cnt = new Float64Array(NA * NE); for (let k = 0; k < A.length; k++) {
            const i = Math.round((A[k] - a0) / da), j = Math.round(E[k] / de);
            if (i >= 0 && i < NA && j >= 0 && j < NE) { sum[j * NA + i] += H[k]; cnt[j * NA + i]++; }
        } const top = Array.from(sum, (x, k) => cnt[k] ? x / cnt[k] : NaN), gf = new Float64Array(NA * NE).fill(Infinity), gc = new Float64Array(NA * NE).fill(Infinity);
        // support: bone (without the small internal bones) and every other skin record, every 2nd vertex
        for (const m of meshes) {
            if (m.marker || m.instrument || m.move || m.cutEdge || m.externalSurface || !(m.group === 'bone' && !SMALL_BONE.test(m.name) || !dura && m.group === 'skin' && !m.flap)) continue;
            ensureGeometry(m);
            const f = m.vertexData;
            for (let p = 0; p < f.length; p += dura ? 6 : 12) {
                const w = [f[p] - mo.pivot[0], f[p + 1] - mo.pivot[1], f[p + 2] - mo.pivot[2]], a = vDot(w, mo.axis), fa = (a - a0) / da;
                if (fa < -2 || fa > NA + 1) continue;
                const hb = hpAt(a) + R * (1 - c), fe = (vDot(w, awf) - R * sn * c - hb * sn) / de;
                if (fe < -2 || fe > NE + 1) continue;
                const t = vDot(w, lif) + R * sn * sn - hb * c;
                for (let j = Math.max(0, Math.ceil(fe - 2)); j <= Math.min(NE - 1, Math.floor(fe + 2)); j++)
                    for (let i = Math.max(0, Math.ceil(fa - 2)); i <= Math.min(NA - 1, Math.floor(fa + 2)); i++) {
                        const k = j * NA + i;
                        if (!(t > top[k] - (dura ? .1 : .5))) continue;
                        if (t < gc[k]) gc[k] = t;
                        if (Math.abs(fa - i) <= .75 && Math.abs(fe - j) <= .75 && t < gf[k]) gf[k] = t;
                    }
            }
        } const raw = top.map((x, k) => { const g = Math.min(gf[k], gc[k] + DRAPE_DEEP); return Number.isFinite(x) && Number.isFinite(g) ? g - allow - x : dura ? 0 : NaN; }), ok = []; raw.forEach((x, k) => { if (Number.isFinite(x)) ok.push(k); }); if (!ok.length)
        return drapeCache[ck] = null; const full = raw.map((x, k) => { if (Number.isFinite(x)) return x; const j = Math.floor(k / NA), i = k % NA; let best = Infinity, acc = 0, n = 0; for (const q of ok) { const dd = (Math.floor(q / NA) - j) ** 2 + (q % NA - i) ** 2; if (dd < best) { best = dd; acc = 0; n = 0; } if (dd === best) { acc += raw[q]; n++; } } return acc / n; }), tab = new Float32Array(NA * NE), K = [.25, .5, .25];
        for (let j = 0; j < NE; j++)
            for (let i = 0; i < NA; i++) {
                let v = 0;
                for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) v += K[y + 1] * K[x + 1] * full[Math.max(0, Math.min(NE - 1, j + y)) * NA + Math.max(0, Math.min(NA - 1, i + x))];
                tab[j * NA + i] = v;
            }
        return drapeCache[ck] = { a0, ia: 1 / da, ie: 1 / de, RT, tab }; }
    function drapeAt(dr, a, d) { const fa = Math.max(0, Math.min(DRAPE_NA - 1, (a - dr.a0) * dr.ia)), fe = Math.max(0, Math.min(DRAPE_NE - 1, (d - dr.RT) * dr.ie)), i0 = Math.floor(fa), j0 = Math.floor(fe), i1 = Math.min(i0 + 1, DRAPE_NA - 1), j1 = Math.min(j0 + 1, DRAPE_NE - 1), u = fa - i0, w = fe - j0, t = dr.tab; return (t[j0 * DRAPE_NA + i0] * (1 - u) + t[j0 * DRAPE_NA + i1] * u) * (1 - w) + (t[j1 * DRAPE_NA + i0] * (1 - u) + t[j1 * DRAPE_NA + i1] * u) * w; }
    const motionCache = new Map();
    function motionFor(m) {
        if (!motionCache.has(m.id)) {
            const fr = m.flap;
            const shared = ['skin','galea','pericranium','fascia'].includes(fr.key);
            const skin = meshes.find(x => x.id === 'scalp-leaf');
            const profile = curlProfile(fr, gatherPoints(shared ? [skin] : [m], outerOnShell));
            if (!profile || profile.dmax <= 0) return null;
            const motion = { ...fr, R: fr.radius, Tf: fr.angle, thetaS: fr.angle * .76,
                P1: .8, prof: profile, dmax: profile.dmax };
            if (['skin','galea','pericranium','fascia','dura'].includes(fr.key)) motion.drape = drapeTable(m,motion);
            motionCache.set(m.id, motion);
        }
        return motionCache.get(m.id);
    }
    // Hinge travel dh and fold angle T for progress P (see 1. above).
    function curlSchedule(mo, P) { const dh = mo.dmax * (1 - smoothstep01(clamp01(P / mo.P1))), T = mo.thetaS * smoothstep01(clamp01(P / .15)) + (mo.Tf - mo.thetaS) * smoothstep01(clamp01((P - mo.P1 + .05) / (1.05 - mo.P1))); return { dh, T }; }
    // Per-draw curl state: schedule plus the hinge-height row interpolated at the current hinge travel.
    function curlState(mo, progress) {
        if (!mo || progress <= 0) return null;
        const { dh, T } = curlSchedule(mo, progress);
        if (T <= 1e-4) return null;
        const f = Math.max(0, Math.min(CURL_ND - 1, dh / mo.prof.dmax * (CURL_ND - 1)));
        const i0 = Math.floor(f), i1 = Math.min(CURL_ND - 1, i0 + 1), w = f - i0;
        const row = new Float32Array(CURL_NA);
        for (let i = 0; i < CURL_NA; i++) {
            row[i] = mo.prof.rows[i0 * CURL_NA + i] * (1 - w) + mo.prof.rows[i1 * CURL_NA + i] * w;
        }
        return { mo, dh, T, row, wD: mo.drape ? smoothstep01(clamp01((T - mo.thetaS) / Math.max(.001, mo.Tf - mo.thetaS))) : 0 };
    }
    // Curl one point (and optionally its normal, rotated with the roll only: the vertex shader instead differentiates the
    // whole map, including the hinge-height shear and the drape). Mirrors the vertex shader's curlF.
    function curlPoint(cs, p, n) { const { mo, dh, T, row } = cs, v = vSub(p, mo.pivot), d = vDot(v, mo.away), dd = d - dh; if (dd <= 0)
        return n ? [p, n] : p; const fi = Math.max(0, Math.min(CURL_NA - 1, (vDot(v, mo.axis) - mo.prof.a0) * mo.prof.ia)), i0 = Math.floor(fi), i1 = Math.min(i0 + 1, CURL_NA - 1), hp = row[i0] + (row[i1] - row[i0]) * (fi - i0), hh = vDot(v, mo.lift), R = mo.R, s = Math.min(dd, R * T), ph = s / R, c = Math.cos(ph), sn = Math.sin(ph), aw = vAdd(vScale(mo.away, c), vScale(mo.lift, sn)), li = vSub(vScale(mo.lift, c), vScale(mo.away, sn)), rest = vSub(v, vAdd(vScale(mo.away, d), vScale(mo.lift, hh))); let q = [mo.pivot, vScale(mo.away, dh + R * sn), vScale(mo.lift, hp + R * (1 - c)), rest, vScale(aw, dd - s), vScale(li, hh - hp)].reduce(vAdd); if (cs.wD > 0 && dd > s)
        q = vAdd(q, vScale(li, cs.wD * smoothstep01(clamp01((dd - s) / DRAPE_BLEND)) * drapeAt(mo.drape, vDot(v, mo.axis), d))); if (!n)
        return q; const na = vDot(n, mo.away), nl = vDot(n, mo.lift); return [q, vAdd(n, vAdd(vScale(vSub(aw, mo.away), na), vScale(vSub(li, mo.lift), nl)))]; }
    function incisionCoords(inc, p) { const rad = vNorm(vSub(p, SHELL_C)); let best = Infinity, bt = 0, tan = [0, 1, 0], be = [0, 0, 0]; for (let i = 0; i < INC_N - 1; i++) {
        const a = inc.pts[i], ab = vSub(inc.pts[i + 1], a), t = clamp01(vDot(vSub(p, a), ab) / Math.max(vDot(ab, ab), 1e-8));
        let e = vSub(p, vAdd(a, vScale(ab, t)));
        e = vSub(e, vScale(rad, vDot(e, rad)));
        const d = Math.hypot(e[0], e[1], e[2]);
        if (d < best) { best = d; bt = (i + t) / (INC_N - 1); tan = ab; be = e; }
    } const perp = vNorm(vCross(vNorm(tan), rad)); return { side: vDot(be, perp), t: bt, dist: best, perp }; }
    // Motions per side and key, built lazily from the data: frame, tuning, hinge-height table and hinge travel.
    function partPoint(pt, p) { const c = incisionCoords(pt.inc, p), open = smoothstep01(clamp01((pt.reveal * 1.05 - c.t) / .05)) * (1 - smoothstep01(clamp01((c.t - .94) / .06))), fall = 1 - smoothstep01(clamp01(c.dist / PART_FALLOFF)); return vAdd(p, vScale(c.perp, pt.sign * pt.gap * fall * open)); }

    const PART_FALLOFF = .30;
    function sampleIncision(points) {
        const length = [0];
        for (let i = 1; i < points.length; i++) {
            length.push(length[i-1] + Math.hypot(...vSub(points[i], points[i-1])));
        }
        const samples = [];
        for (let i = 0, index = 1; i < INC_N; i++) {
            const d = length.at(-1) * i / (INC_N - 1);
            while (index < length.length - 1 && length[index] < d) index++;
            const fraction = (d - length[index-1]) / Math.max(1e-5,length[index]-length[index-1]);
            samples.push(vAdd(points[index-1],vScale(vSub(points[index],points[index-1]),fraction)));
        }
        return { pts: samples, flat: samples.flat() };
    }
    const incision = sampleIncision(manifest.ink);
    const flapAnchor = meshes.find(m => m.id === 'scalp-leaf').anchor;
    incision.sign = Math.sign(incisionCoords(incision, flapAnchor).side) || 1;
    function movesWithFlap(m, p) {
        return !m.splitFlap || incisionCoords(incision, p).side * incision.sign > .08;
    }
    function incisionState(m) {
        if (!m.incisionPart) return null;
        const reveal = stateProgress('incision');
        if (reveal <= 0) return null;
        return { inc: incision, reveal, gap: .065, sign: m.incisionPart === 'flap' ? -1 : 1 };
    }
    function flapState(m) {
        if (!m.flap) return null;
        let progress = stateProgress(m.flap.key);
        if (m.flap.key === 'dura') progress = clamp01((progress - .20) / .80);
        return progress > 0 ? curlState(motionFor(m), progress) : null;
    }

    const flapAxis = [0, 1, 0];
    const flapPivot = [2.62, -.37, 2.44];
    function boneAngle(m) {
        if (m.move !== 'anteriorBone') return 0;
        return -1.46 * smoothstep01(clamp01((stateProgress('anteriorBone') - .08) / .92));
    }

    function meshOffset(m) {
        const progress = m.move ? stateProgress(m.move) : 0;
        if (m.move === 'anteriorBone') return [.48 * smoothstep01(clamp01(progress / .19)) + .25 * progress, .02 * progress, .22 * progress];
        if (m.move === 'posteriorBone') {
            const lift = smoothstep01(Math.min(1, progress / .38));
            const travel = smoothstep01(clamp01((progress - .38) / .62));
            return [.66 * lift + 3.6 * travel, 2.3 * travel, -.82 * travel];
        }
        if (m.move === 'decompressed') return [1.6 * progress, 0, -.18 * progress];
        if (m.move === 'resected') return [2.35 * progress, .32 * progress, -.24 * progress];
        if (m.clip) return [1.08 * (1 - stateProgress(m.show)), .16 * (1 - stateProgress(m.show)), 0];
        if (m.instrument) return [.48 * Math.abs(1 - opening), 0, 0];
        return [0, 0, 0];
    }

    const stepSmooth = (a, b, t) => smoothstep01(clamp01((t - a) / (b - a)));
    function retractionFactor(p) {
        const [x,y,z] = p, base = -.55 - .20 * z;
        const region = stepSmooth(.78, 2.35, x) * (1 - stepSmooth(.24, 1.48, Math.abs(y - base))) *
            stepSmooth(-1.9,-1.08,z) * (1 - stepSmooth(2.0,2.62,z));
        const blend = stepSmooth(.23,1.12,z), proximal = stateProgress('proximal'), distal = stateProgress('distal');
        return .48 * region * (proximal * (blend + (1-blend) * .50) + distal * .50 * (1-blend));
    }

    function movePoint(m, p) {
        const part = incisionState(m);
        let q = part ? partPoint(part,p) : p;
        const curl = flapState(m);
        if (curl && movesWithFlap(m, p)) q = curlPoint(curl, q);
        if (m.retract) q = vAdd(q, [0, m.retract * retractionFactor(p), 0]);
        const angle = boneAngle(m);
        if (angle) q = vAdd(flapPivot, mApply(qMat(qAxis(flapAxis, angle)), vSub(q, flapPivot)));
        return vAdd(q, meshOffset(m));
    }

    const labelVisibility = new Set(), surfaceAnchors = new Map();
    let pickPixels = null, pickWidth = 0, pickHeight = 0;
    function scanPickAnchors(pixels, w, h, cssw, cssh) { const stats = new Map(), out = new Map(); for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const k = (y * w + x) * 4, id = pixels[k] + (pixels[k + 1] << 8) + (pixels[k + 2] << 16) - 1;
            if (id < 0 || id >= meshes.length)
                continue;
            let s = stats.get(id);
            if (!s) {
                s = { x: 0, y: 0, n: 0, best: Infinity };
                stats.set(id, s);
            }
            s.x += x;
            s.y += y;
            s.n++;
        } for (const s of stats.values()) {
        s.x /= s.n;
        s.y /= s.n;
    } for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const k = (y * w + x) * 4, id = pixels[k] + (pixels[k + 1] << 8) + (pixels[k + 2] << 16) - 1, s = stats.get(id);
            if (!s)
                continue;
            const d = (x - s.x) ** 2 + (y - s.y) ** 2;
            if (d < s.best) {
                s.best = d;
                out.set(id, { x: (x + .5) / w * cssw, y: (h - y - .5) / h * cssh });
            }
        } return out; }
    function cacheLabelVisibility() { labelVisibility.clear(); surfaceAnchors.clear(); if (!available || !pickTarget)
        return; pickWidth = pickTarget.w; pickHeight = pickTarget.h; if (!pickPixels || pickPixels.length !== pickWidth * pickHeight * 4)
        pickPixels = new Uint8Array(pickWidth * pickHeight * 4); gl.readPixels(0, 0, pickWidth, pickHeight, gl.RGBA, gl.UNSIGNED_BYTE, pickPixels); }
    function pickIdAt(cssx, cssy) { if (!pickPixels || cssx < 0 || cssy < 0 || cssx >= host.clientWidth || cssy >= host.clientHeight || !host.clientWidth || !host.clientHeight)
        return -1; const x = Math.min(pickWidth - 1, Math.floor(cssx / host.clientWidth * pickWidth)), y = Math.min(pickHeight - 1, Math.floor((host.clientHeight - cssy) / host.clientHeight * pickHeight)); let best = -1, bestD = Infinity; for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= pickWidth || yy >= pickHeight)
                continue;
            const at = (yy * pickWidth + xx) * 4, id = pickPixels[at] + (pickPixels[at + 1] << 8) + (pickPixels[at + 2] << 16) - 1, d = dx * dx + dy * dy;
            if (id >= 0 && id < meshes.length && d < bestD) {
                best = id;
                bestD = d;
            }
        } return best; }
    const procedureLabelRegion = m => ({ target: m.anchor, radius: m.group === 'brain' ? 1.4 : 1.0 });
    function pointRetained(m, p) {
        const open = stateProgress('sacOpen');
        if (m.sacMask && open > 0 && p[0] > m.anchor[0] + .096 + .23 * (1 - open)) return false;
        return true;
    }
    function candidatesForLabel(m) { const spec = procedureLabelRegion(m), key = spec.target.join(',') + '|' + spec.radius; if (m.procedureCandidates?.key === key)
        return m.procedureCandidates.points; const a = m.vertexData, points = [], seen = new Set(); if (a)
        for (let i = 0; i < a.length; i += 6) {
            const p = [a[i], a[i + 1], a[i + 2]];
            if (spec.cranial && p[1] < -2.25)
                continue;
            const d = p.reduce((sum, x, j) => sum + (x - spec.target[j]) ** 2, 0);
            if (d > spec.radius ** 2)
                continue;
            const k = p.map(x => x.toFixed(5)).join(',');
            if (seen.has(k))
                continue;
            seen.add(k);
            points.push({ p, d });
        } points.sort((a, b) => a.d - b.d); // large shells (scalp layers): keep an even subsample so a hidden region costs at most ~1200 moved points per frame
    const keep = points.length > 1200 ? points.filter((_, i) => i % Math.ceil(points.length / 1200) === 0) : points; m.procedureCandidates = { key, points: keep.map(x => x.p) }; return m.procedureCandidates.points; }
    function regionSurfaceAnchor(m) { const points = candidatesForLabel(m), spec = procedureLabelRegion(m); for (const p of points) {
        if (!pointRetained(m, p))
            continue;
        const world = movePoint(m, p), q = project(world), x = Math.floor(q[0] / host.clientWidth * pickWidth), y = Math.floor((host.clientHeight - q[1]) / host.clientHeight * pickHeight);
        if (!pickPixels || q[0] < 0 || q[1] < 0 || q[0] >= host.clientWidth || q[1] >= host.clientHeight)
            continue;
        let found = false;
        for (let dy = -1; dy <= 1 && !found; dy++)
            for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx, yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= pickWidth || yy >= pickHeight)
                    continue;
                const at = (yy * pickWidth + xx) * 4;
                if (pickPixels[at] + (pickPixels[at + 1] << 8) + (pickPixels[at + 2] << 16) - 1 === m.index) {
                    found = true;
                    break;
                }
            }
        if (found) {
            labelVisibility.add(m.index);
            return { x: q[0], y: q[1], visible: true, world };
        }
    } const q = project(movePoint(m, spec.target)); return { x: q[0], y: q[1], visible: false }; }
    function activeLabelMesh() {
        if (selected >= 0) return visible(meshes[selected]) ? meshes[selected] : null;
        if (!prelabelsOn) return null;
        const target = meshes.find(m => m.id === steps[stage].target);
        return visible(target) ? target : null;
    }
    const labelName = m => m.name;
    function fixedLabelRect(w, h) { return { x: Math.max(8, Math.min(14, host.clientWidth - w - 8)), y: Math.max(8, Math.min(isMobile ? 36 : 86, host.clientHeight - h - (isMobile ? 64 : 100))), w, h }; }
    let labelKey = '';
    function clearSelection() { selected = -1; labelKey = ''; render(); }
    function select(i) { if (i < 0 || i >= meshes.length || !visible(meshes[i])) {
        clearSelection();
        return;
    } selected = i; labelKey = ''; render(); }
    function updateStepLabels() { const popup = $('#popup'), svg = $('#labelLines'); $('#stepLabels').replaceChildren(); svg.replaceChildren(); if (mode !== '3d') {
        popup.hidden = true;
        return;
    } const m = activeLabelMesh(); if (!m) {
        popup.hidden = true;
        labelKey = '';
        return;
    } const key = m.id + '|' + stage + '|' + (selected >= 0 ? 'selected' : 'auto'); if (labelKey !== key) {
        popup.replaceChildren();
        const close = document.createElement('button');
        close.className = 'close';
        close.textContent = '×';
        close.setAttribute('aria-label', 'Hide anatomy label');
        close.onclick = () => { selected = -1; prelabelsOn = false; labelKey = ''; syncControls(); render(); };
        const title = document.createElement('strong');
        title.textContent = labelName(m);
        title.title = m.description;
        const status = document.createElement('div');
        status.className = 'label-status';
        status.id = 'labelStatus';
        const row = document.createElement('div');
        row.className = 'popup-actions';
        for (const [label, fn] of [['Hide', () => { m.hidden = true; clearSelection(); }], ['Isolate', () => { meshes.forEach(x => x.hidden = x !== m); for (const k in enabled)
                    enabled[k] = k === m.group; if (m.instrument)
                    instrumentsOn = true; selected = m.index; syncControls(); render(); }]]) {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.width = 'auto';
            b.onclick = fn;
            row.append(b);
        }
        popup.append(close, title, status, row);
        labelKey = key;
    } popup.hidden = isMobile && !!$('#layerControls').open; // on phones the open Layers & View dock takes precedence
    const a = regionSurfaceAnchor(m), r = fixedLabelRect(popup.offsetWidth || 190, popup.offsetHeight || 75); popup.style.left = r.x + 'px'; popup.style.top = r.y + 'px'; $('#labelStatus').textContent = a.visible ? '' : procedureLabelRegion(m).cranial ? 'Cranial segment hidden in this view' : 'Region hidden in this view'; if (a.visible) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', a.x);
        line.setAttribute('y1', a.y);
        line.setAttribute('x2', Math.max(r.x, Math.min(r.x + r.w, a.x)));
        line.setAttribute('y2', Math.max(r.y, Math.min(r.y + r.h, a.y)));
        svg.append(line);
    } }
    function overviewCamera() {
        const view = stepView(steps[0]);
        return { ...view, zoom: view.zoom ?? 1 };
    }
    function setView(v) {
        const views = { anterior: [0, 0], right: [Math.PI / 2, 0], left: [-Math.PI / 2, 0], posterior: [Math.PI, 0], superior: [0, 1.5] };
        if (!views[v]) return;
        const { distance, zoom } = overviewCamera();
        setCamera({ frame: 'head', yaw: views[v][0], pitch: views[v][1], distance, zoom });
    }
    function resetView() {
        // Restore the opening camera and leave the active procedure step in place.
        stopGlide();
        cameraExplicit = false;
        applyCamera(overviewCamera());
        render();
    }
    // Center the anatomy at the surgeon preset’s orientation and magnification.
    function setSurgeonView() {
        setCamera({ frame: 'world', eye: [.14, .36, .94], up: [0, 1, 0], distance: 13, zoom: 1.25 });
    }
    // ---- Patient Position controls (Layers & View panel) -------------------------------------------------------------
    // Changing the pose re-attaches the camera to the room first (same image), so the head visibly turns while the
    // table, holder and gizmo stay put. Slider input applies directly; the toggle and the defaults glide.
    function headFixed() { if (poseOverride)
        return poseOverride === 'operative'; const s = steps[stage]; return !!s && !!(beforeCurrent ? s.beforeState.position : s.state.position); }
    function poseState() { return { shown: { ...poseShown }, requested: requestedPose(), fraction: poseFraction(), settings: { ...poseSettings }, override: poseOverride, defaults: { ...POSE_DEFAULT }, pivot: [...POSE_PIVOT], matrix: [...poseR], headFixed: headFixed(), props: propsOn && propsVisible() }; }
    // Reported by guideQA.getState(): the orientation plus best-effort legacy yaw/pitch/roll of the effective
    // head-relative view (screenOrientation -1 when the image is turned by more than 90 degrees).
    function cameraState() { const M = viewBasis().M, a = anglesOf(M); return { orientation: { q: [...viewQ], frame: camFrame, matrix: [...M] }, yaw: a.yaw, pitch: a.pitch, roll: a.roll, screenOrientation: Math.abs(a.roll) > Math.PI / 2 ? -1 : 1, pose: poseState(), gravity: gravityInModel() }; }
    function poseInput(k) { return $(`[data-pose="${k}"]`); }
    // Set operative-pose angles (degrees, clamped to the slider ranges). If the step shows the anatomical pose the
    // operative pose is switched on, otherwise the change would be invisible.
    function setPose(partial = {}) { attachCamera('world'); if (poseFraction() < 1) {
        startPoseBlend();
        poseOverride = 'operative';
    } for (const k of POSE_KEYS)
        if (Number.isFinite(+partial[k]) && partial[k] !== null && partial[k] !== '') {
            const el = poseInput(k);
            poseSettings[k] = el ? Math.max(+el.min, Math.min(+el.max, +partial[k])) : +partial[k];
        } syncPoseControls(); render(); }
    // 'anatomical' | 'operative' override the step until the next step change; null follows the step again.
    function setPoseMode(next) { if (!['anatomical', 'operative', null].includes(next))
        return; stopGlide(false); pan = [0, 0]; attachCamera('world'); startPoseBlend(); poseOverride = next; syncPoseControls(); render(); }
    function resetPose() { stopGlide(false); pan = [0, 0]; attachCamera('world'); startPoseBlend(); poseSettings = { ...POSE_DEFAULT }; syncPoseControls(); render(); }
    let poseUiKey = '';
    function syncPoseControls() { if (!$('#positionControls'))
        return; const operative = poseFraction() >= .5, key = POSE_KEYS.map(k => poseSettings[k]).join() + operative + propsOn + camFrame; if (key === poseUiKey)
        return; poseUiKey = key; for (const k of POSE_KEYS) {
        const el = poseInput(k);
        if (+el.value !== poseSettings[k])
            el.value = poseSettings[k];
        el.closest('.pose-slider').querySelector('output').textContent = Math.round(poseSettings[k]) + '°';
    } $('#poseAnatomical').setAttribute('aria-pressed', !operative); $('#poseOperative').setAttribute('aria-pressed', operative); $('#poseProps').checked = propsOn; }
    $$('[data-pose]').forEach(el => el.oninput = () => setPose({ [el.dataset.pose]: +el.value }));
    $('#poseAnatomical').onclick = () => setPoseMode('anatomical');
    $('#poseOperative').onclick = () => setPoseMode('operative');
    $('#poseReset').onclick = resetPose;
    $('#poseProps').onchange = e => { propsOn = e.target.checked; poseUiKey = ''; render(); };
    $('#surgeonView').onclick = setSurgeonView;
    $('#surgeonViewPanel').onclick = setSurgeonView;
    // Schematic padded donut and table edge in the room-fixed camera.
    const PROP_COLORS = { holder: hexRgb('#5ca7a4'), table: hexRgb('#8aa4ae') };
    let propBuffer = null, propCache = null;
    function propsVisible() { return propsOn && mode === '3d' && camFrame === 'world' && headFixed(); }
    // Append an unindexed tube (position + unit normal per vertex) along a polyline; parallel-transport frames.
    function tubeInto(out, pts, r, caps = false, sides = 10) { const n = pts.length; if (n < 2)
        return; const T = pts.map((p, i) => vNorm(vSub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]))), rings = []; let u = vNorm(vCross(T[0], Math.abs(T[0][1]) < .9 ? [0, 1, 0] : [1, 0, 0])); for (let i = 0; i < n; i++) {
        if (i)
            u = vNorm(vSub(u, vScale(T[i], vDot(u, T[i]))));
        const v = vCross(T[i], u);
        rings.push(Array.from({ length: sides }, (_, k) => { const a = 2 * Math.PI * k / sides, d = vAdd(vScale(u, Math.cos(a)), vScale(v, Math.sin(a))); return [vAdd(pts[i], vScale(d, r)), d]; }));
    } const put = ([p, nn]) => out.push(p[0], p[1], p[2], nn[0], nn[1], nn[2]); for (let i = 0; i + 1 < n; i++)
        for (let k = 0; k < sides; k++) {
            const a = rings[i][k], b = rings[i][(k + 1) % sides], c = rings[i + 1][k], d = rings[i + 1][(k + 1) % sides];
            [a, c, b, b, c, d].forEach(put);
        } if (caps)
        for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
            const nn = vScale(T[i], dir);
            for (let k = 0; k < sides; k++)
                [[pts[i], nn], [rings[i][k][0], nn], [rings[i][(k + 1) % sides][0], nn]].forEach(put);
        } }
    function propGeometry() {
        const key = poseR.map(x => x.toFixed(4)).join();
        if (propCache?.key === key) return propCache;
        const holder = [], table = [];
        const cushion = Array.from({ length: 81 }, (_, i) => {
            const a = i * Math.PI / 40;
            return poseInverse([2.44 * Math.cos(a), 2.28 * Math.sin(a), -4.38]);
        });
        tubeInto(holder, cushion, .53, false, 16);
        for (const [a,b] of [
            [[-5,3,-4.96],[5,3,-4.96]], [[-5,3,-4.96],[-5,-8,-4.96]],
            [[5,3,-4.96],[5,-8,-4.96]]
        ]) tubeInto(table, [poseInverse(a),poseInverse(b)], .09);
        propCache = { key, data: new Float32Array([...holder,...table]), uploaded: false,
            parts: [{ first: 0, count: holder.length/6, rgb: PROP_COLORS.holder },
                    { first: holder.length/6, count: table.length/6, rgb: PROP_COLORS.table }] };
        return propCache;
    }
    function bindVertexBuffer(buf) { gl.bindBuffer(gl.ARRAY_BUFFER, buf); for (const [name, start] of [['aPosition', 0], ['aNormal', 12]])
        gl.vertexAttribPointer(gl.getAttribLocation(program, name), 3, gl.FLOAT, false, 24, start); }
    // Drawn opaque before the anatomy; in the picking pass as background (id 0) so they hide what they cover.
    function drawProps(picking) { if (!propsVisible())
        return; const geo = propGeometry(); if (!propBuffer)
        propBuffer = gl.createBuffer(); bindVertexBuffer(propBuffer); if (!geo.uploaded) {
        gl.bufferData(gl.ARRAY_BUFFER, geo.data, gl.DYNAMIC_DRAW);
        geo.uploaded = true;
    } for (const [n, v] of [['Material', -1], ['IsMarker', 1], ['Line', 0], ['Change', 0], ['FlapAngle', 0], ['Selected', 0], ['CurlOn', 0], ['PartOn', 0], ['SplitPass', 0], ['Groove', 0], ['OpenSac', 0], ['BonePiece', 0]])
        gl.uniform1f(uniforms[n], v); gl.uniform3fv(uniforms.Offset, [0, 0, 0]); gl.uniform3fv(uniforms.Retract, [0, 0, 0]); gl.uniform2f(uniforms.FissureProgress, 0, 0); for (const part of geo.parts) {
        gl.uniform4fv(uniforms.Color, picking ? [0, 0, 0, 1] : [...part.rgb, 1]);
        gl.drawArrays(gl.TRIANGLES, part.first, part.count);
    } bindVertexBuffer(buffer); }
    // ---- Orientation gizmo -----------------------------------------------------------------------------------------
    // Viewport corner: the posed head's patient axes (S superior, A anterior, R/L) and an amber gravity arrow onto a
    // small floor tile, seen through the current camera, so pose changes stay legible during free rotation. The
    // caption names the pose and whether the view follows the head or is fixed to the room.
    let gizmoKey = '';
    function updateGizmo() { const box = $('#orientGizmo'); if (!box || mode !== '3d')
        return; const { M } = viewBasis(), W = mMul(M, mT(poseR)), R = 31, f = v => [v[0] * R, -v[1] * R], fx = n => n.toFixed(1), key = M.concat(W).map(x => x.toFixed(3)).join() + poseFraction() + camFrame + POSE_KEYS.map(k => Math.round(poseShown[k])).join(); if (key === gizmoKey)
        return; gizmoKey = key; const line = (a, b, color, width, opacity, dash) => `<line x1="${fx(a[0])}" y1="${fx(a[1])}" x2="${fx(b[0])}" y2="${fx(b[1])}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`, label = (p, s, color, opacity) => `<text x="${fx(p[0])}" y="${fx(p[1] + 3.2)}" fill="${color}" opacity="${opacity}">${s}</text>`, g = mApply(W, [0, 0, -1]), tile = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => f(mApply(W, [a * .4, b * .4, -1.08]))); let svg = `<polygon points="${tile.map(p => fx(p[0]) + ',' + fx(p[1])).join(' ')}" fill="#e9c35a24" stroke="#e9c35a99" stroke-width="1"/>`; const items = [{ d: mApply(M, [0, 1, 0]), text: 'S', color: '#a3db7f' }, { d: mApply(M, [0, 0, 1]), text: 'A', color: '#82bdff' }, { d: mApply(M, [-1, 0, 0]), text: 'R', color: '#ff9483' }, { d: mApply(M, [1, 0, 0]), text: 'L', color: '#ff9483', thin: true }, { d: g, text: 'Floor', color: '#f0c45a', gravity: true }].sort((a, b) => a.d[2] - b.d[2]); for (const it of items) {
        const tip = f(it.d), op = it.d[2] < -.05 ? .42 : 1, len = Math.hypot(tip[0], tip[1]);
        if (it.gravity) {
            const u = len > 1 ? [tip[0] / len, tip[1] / len] : [0, 1], end = [tip[0] * .9, tip[1] * .9];
            svg += line([0, 0], end, it.color, 2, op, '3 2.5') + (len > 4 ? `<polygon points="${fx(end[0] + u[0] * 5)},${fx(end[1] + u[1] * 5)} ${fx(end[0] - u[1] * 3.6)},${fx(end[1] + u[0] * 3.6)} ${fx(end[0] + u[1] * 3.6)},${fx(end[1] - u[0] * 3.6)}" fill="${it.color}" opacity="${op}"/>` : `<circle r="4" fill="none" stroke="${it.color}" stroke-width="1.6" opacity="${op}"/>`) + label(len < 12 ? [0, 15] : [tip[0] * 1.78, tip[1] * 1.78 + 2], it.text, it.color, op);
        }
        else // an axis pointing at the viewer is short: push its label off the centre
            svg += line([0, 0], tip, it.color, it.thin ? 1.3 : 2.6, op) + label(len < 12 ? [tip[0] + (tip[0] >= 0 ? 9 : -9), tip[1] - 8] : [tip[0] * 1.3, tip[1] * 1.3], it.text, it.color, op);
    } box.querySelector('svg').innerHTML = svg + '<circle r="2.4" fill="#d7e5da"/>'; const p = poseShown, posed = POSE_KEYS.some(k => Math.abs(p[k]) > .5); box.querySelector('small').textContent = (posed ? `Pose ${Math.round(p.rotation)}° rot · ${Math.round(p.extension)}° ext${Math.round(p.lateral) ? ` · ${Math.round(p.lateral)}° tilt` : ''}` : 'Anatomical position') + '\n' + (camFrame === 'world' ? 'View fixed to room' : 'View follows head'); }
    $$('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
    $('#resetView').onclick = resetView;
    $('#manifestDownload').onclick = () => downloadBlob(
        new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), 'neonatal-mca-mesh-manifest.json');
    $('#exportPlan').onclick = () => downloadBlob(
        new Blob([JSON.stringify({ title: manifest.title, steps, papers, limitations: manifest.limitations }, null, 2)],
            { type: 'application/json' }), 'neonatal-mca-reading-plan.json');
    $('#pdfRequests').onclick = () => downloadBlob(
        new Blob([papers.map(p => p.citation + ' — ' + p.url).join('\n')], { type: 'text/plain' }), 'neonatal-mca-sources.txt');
    mobileQuery.addEventListener?.('change', syncMobileLayout);
    $('#layerControls').addEventListener('toggle', () => { if (isMobile) updateStepLabels(); });
    window.addEventListener?.('resize', () => { if (isMobile)
        requestAnimationFrame(updateMobileReaderHeight); });
    syncMobileLayout();
    new ResizeObserver(() => { if (isMobile)
        updateMobileReaderHeight(); }).observe($('.layout'));
    function ensureGeometry(m) { if (m.geometryReady)
        return; const bytes = decode64(m.data), floats = new Float32Array(bytes.buffer); if (floats.length !== m.count * 6)
        throw Error('Invalid geometry buffer ' + m.id); if (m.group === 'skin' && !m.externalSurface)
        tiltSkinWalls(floats); m.vertexData = floats; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferSubData(gl.ARRAY_BUFFER, m.first * 24, floats); m.geometryReady = true; delete m.data; }
    // Skin slabs: cut-wall triangles (face normal across the shell radial) span the whole slab; tilt each wall vertex
    // normal by about 20 degrees outward (outer-surface vertex) or inward (inner-surface vertex), keeping its length
    // (baked AO). The fragment shader reads the interpolated tilt as depth across the wall (dermis over fat) and the
    // tilt also rounds the shading of the cut edge.
    function tiltSkinWalls(f) { const k = .36; for (let t = 0; t + 18 <= f.length; t += 18) {
        const P = [0, 1, 2].map(i => [f[t + i * 6], f[t + i * 6 + 1], f[t + i * 6 + 2]]), fn = vNorm(vCross(vSub(P[1], P[0]), vSub(P[2], P[0]))), rc = vNorm(vSub(vScale(vAdd(vAdd(P[0], P[1]), P[2]), 1 / 3), SHELL_C));
        if (Math.abs(vDot(fn, rc)) >= .5)
            continue;
        const r = P.map(q => Math.hypot(...vSub(q, SHELL_C))), mid = (Math.max(...r) + Math.min(...r)) / 2;
        if (Math.max(...r) - Math.min(...r) < 1e-4)
            continue;
        for (let i = 0; i < 3; i++) {
            const o = t + i * 6 + 3, n = [f[o], f[o + 1], f[o + 2]], len = Math.hypot(...n) || 1, out = vNorm(vSub(P[i], SHELL_C)), nn = vScale(vNorm(vAdd(vScale(n, 1 / len), vScale(out, r[i] > mid ? k : -k))), len);
            f[o] = nn[0]; f[o + 1] = nn[1]; f[o + 2] = nn[2];
        }
    } }
    function shader(type, text) { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(s)); return s; }
    function initGL() {
        skinInkMasks.clear();
        gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
        if (!gl)
            throw Error('WebGL is unavailable');
        const fragmentVectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 16;
        fissureN = fragmentVectors >= 64 ? 12 : fragmentVectors >= 40 ? 8 : 4;
        program = gl.createProgram();
        gl.attachShader(program, shader(gl.VERTEX_SHADER, `attribute vec3 aPosition;attribute vec3 aNormal;
uniform mediump float uLine;
uniform float uLinePx,uLineNudge,uDistance,uAspect,uScale;
uniform mat3 uView;
uniform vec2 uPan;
uniform vec3 uRetract;
uniform vec3 uTarget,uOffset,uFlapAxis,uFlapPivot;
uniform float uFlapAngle;
uniform float uCurlOn,uCurlIA;
uniform vec3 uCurlPivot,uCurlAxis,uCurlAway,uCurlLift;
uniform vec4 uCurlP;
uniform float uCurlRow[16];
uniform float uDrapeW;
uniform vec4 uDrapeP;
uniform float uDrape[96];
uniform float uPartOn,uSplitPass;
uniform vec2 uSplitInc;
uniform vec4 uPart;
uniform vec3 uInc[24];
varying mediump vec3 vNormal,vObjN;
varying highp vec3 vOriginal,vEye;
varying highp float vSplit;
varying mediump float vAO;
/* Hinge travel and tabulated height are shared with the CPU capture and label transform. */
vec3 curlF(vec3 q){vec3 v=q-uCurlPivot;float d=dot(v,uCurlAway),dd=d-uCurlP.z;if(dd<=0.)return q;float a=dot(v,uCurlAxis),fi=clamp((a-uCurlP.w)*uCurlIA,0.,15.);int i0=int(floor(fi));int i1=i0<15?i0+1:15;float hp=mix(uCurlRow[i0],uCurlRow[i1],fi-float(i0)),hh=dot(v,uCurlLift),R=uCurlP.x,s=min(dd,R*uCurlP.y),ph=s/R,c=cos(ph),sn=sin(ph);vec3 aw=c*uCurlAway+sn*uCurlLift,li=c*uCurlLift-sn*uCurlAway;
 vec3 r=uCurlPivot+(uCurlP.z+R*sn)*uCurlAway+(hp+R*(1.-c))*uCurlLift+(v-d*uCurlAway-hh*uCurlLift)+(dd-s)*aw+(hh-hp)*li;
 if(uDrapeW>0.&&dd>s){float fa=clamp((a-uDrapeP.x)*uDrapeP.y,0.,11.),fe=clamp((d-uDrapeP.w)*uDrapeP.z,0.,7.);int j0=int(floor(fa));int k0=int(floor(fe));int j1=j0<11?j0+1:11;int k1=k0<7?k0+1:7;float u=fa-float(j0),w=fe-float(k0);
  r+=li*(uDrapeW*smoothstep(0.,.4,dd-s)*mix(mix(uDrape[k0*12+j0],uDrape[k0*12+j1],u),mix(uDrape[k1*12+j0],uDrape[k1*12+j1],u),w));}
 return r;}
vec3 retractF(vec3 p) {
    float x=p.x,y=p.y,z=p.z;
    float b=-.55-.20*z;
    float region=smoothstep(.78,2.35,x)*(1.-smoothstep(.24,1.48,abs(y-b)))*
        smoothstep(-1.9,-1.08,z)*(1.-smoothstep(2.0,2.62,z));
    float blend=smoothstep(.23,1.12,z);
    p.y+=uRetract.z*.48*region*(uRetract.x*(blend+(1.-blend)*.50)+uRetract.y*.50*(1.-blend));
    return p;
}
void main(){
    vAO=length(aNormal); vOriginal=aPosition;
    vec3 norm=aNormal/max(vAO,1e-4), q=aPosition;
    vSplit=1.;
    if (uPartOn>.5 || uSplitPass>0.) {
        vec3 rad=normalize(aPosition-vec3(0.,-.4,-.4));
        float best=1e3, bt=0.;
        vec3 tg=vec3(0.,1.,0.), be=vec3(0.);
        for(int i=0;i<23;i++){
            vec3 a=uInc[i],ab=uInc[i+1]-a;
            float t=clamp(dot(aPosition-a,ab)/max(dot(ab,ab),1e-8),0.,1.);
            vec3 e=aPosition-a-ab*t;
            e-=dot(e,rad)*rad;
            float d=length(e);
            if(d<best){best=d;bt=(float(i)+t)/23.;tg=ab;be=e;}
        }
        vec3 perp=normalize(cross(normalize(tg),rad));
        vSplit=dot(be,perp)*uSplitInc.x-uSplitInc.y;
        if(uPartOn>.5) q+=perp*(uPart.z*uPart.y*(1.-smoothstep(0.,uPart.w,best))*smoothstep(0.,.05,uPart.x*1.05-bt)*(1.-smoothstep(.94,1.,bt)));
    }
    if (uRetract.z!=0. && uRetract.x+uRetract.y>0.) {
        vec3 t1=normalize(cross(norm,abs(norm.x)<.9?vec3(1.,0.,0.):vec3(0.,1.,0.)));
        vec3 t2=cross(norm,t1);
        vec3 p=retractF(q);
        norm=normalize(cross(retractF(q+.002*t1)-p,retractF(q+.002*t2)-p));
        q=p;
    }
/* Curl: the normal is taken from the deformed surface itself (curlF at two offsets along the rest tangent plane), so
   the roll, the hinge-height shear and the drape all shade correctly. */
if(uCurlOn>.5){vec3 t1=normalize(cross(norm,abs(norm.x)<.9?vec3(1.,0.,0.):vec3(0.,1.,0.))),t2=cross(norm,t1);vec3 q0=curlF(q);norm=normalize(cross(curlF(q+.002*t1)-q0,curlF(q+.002*t2)-q0));q=q0;}
if(uFlapAngle!=0.){
  float ct=cos(uFlapAngle),st=sin(uFlapAngle);vec3 k=uFlapAxis,v=q-uFlapPivot;
  q=uFlapPivot+v*ct+cross(k,v)*st+k*dot(k,v)*(1.-ct);
  norm=norm*ct+cross(k,norm)*st+k*dot(k,norm)*(1.-ct);
}
q+=uOffset;
// View: uView = head(model)->view rotation (camera orientation x head pose), uTarget = orbit centre in model space.
// q/norm are model-space (after flap motion); deformations belong above this line. uGravity (unit, model space) is
// provided for later gravity-driven deformation and is optimised away while unused.
if(uLine>0.){float w0=uDistance-(uView*(q-uTarget)).z;q+=norm*max(0.,w0*uLinePx-uLine);}vec3 p=uView*(q-uTarget);vNormal=uView*norm;vObjN=aNormal/max(vAO,1e-4);float w=uDistance-p.z;vEye=vec3(-(p.x+uPan.x),-(p.y+uPan.y),w);float wz=uLine>0.?max(w-uLineNudge,.05):w;gl_Position=vec4((p.x+uPan.x)*uScale/uAspect,(p.y+uPan.y)*uScale,(1.0125786-1.0062893/wz)*w,w);}`));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uInkMask;
uniform vec4 uInkBounds,uColor;
uniform float uInkProgress,uSelected,uPick,uChange,uIsMarker,uMaterial,uSurgical,uQuality,uOpenSac,uBonePiece,uGroove,uSplitPass;
uniform vec4 uDuralWindow;
uniform vec2 uFissureProgress;
#define FISSURE_N ${fissureN}
uniform vec3 uFissure[FISSURE_N];
uniform mediump float uLine;
uniform vec2 uViewport;
uniform vec3 uInner;
varying mediump vec3 vNormal,vObjN;
varying highp vec3 vOriginal,vEye;
varying highp float vSplit;
varying mediump float vAO;
#ifdef GL_FRAGMENT_PRECISION_HIGH
float hsh(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
#define NOISE 1.
#else
float hsh(vec3 p){return .5;}
#define NOISE 0.
#endif
float vnoise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(hsh(i),hsh(i+vec3(1.,0.,0.)),f.x),mix(hsh(i+vec3(0.,1.,0.)),hsh(i+vec3(1.,1.,0.)),f.x),f.y),mix(mix(hsh(i+vec3(0.,0.,1.)),hsh(i+vec3(1.,0.,1.)),f.x),mix(hsh(i+vec3(0.,1.,1.)),hsh(i+vec3(1.,1.,1.)),f.x),f.y),f.z);}
float fbm(vec3 p){float f=.5*vnoise(p)+.25*vnoise(p*2.03);f+=uQuality>.5?.125*vnoise(p*4.07):.0625;return f/.875;}
float ridge(vec3 p){return NOISE*(1.-abs(2.*vnoise(p)-1.));}
float fissureDist(vec3 p,out float t){float best=1e3;t=.5;for(int i=0;i<FISSURE_N-1;i++){vec3 a=uFissure[i],ab=uFissure[i+1]-a;float h=clamp(dot(p-a,ab)/max(dot(ab,ab),1e-6),0.,1.);float d=distance(p,a+ab*h);if(d<best){best=d;t=(float(i)+h)/float(FISSURE_N-1);}}return best;}
void main(){
if(uOpenSac>0.&&vOriginal.x>uOpenSac)discard;
if(uSplitPass>0. && (uSplitPass<1.5 ? vSplit>0. : vSplit<=0.))discard;
if(uFissureProgress.x+uFissureProgress.y>0.){
    float t=.5, d=fissureDist(vOriginal,t);
    float end=smoothstep(.30,.79,t);
    float split=uFissureProgress.x*end+uFissureProgress.y*(1.-end);
    float width=.23*split*smoothstep(0.,.11,t)*(1.-smoothstep(.89,1.,t));
    if(d<width)discard;
}
if(uPick>.5){gl_FragColor=uColor;return;}if(uLine>0.){vec3 n=normalize(vNormal),V=normalize(vEye);float nv=abs(dot(n,V));vec3 c=uColor.rgb*(.82+.18*max(0.,dot(n,normalize(vec3(-.35,.55,1.)))))+vec3(.10)*pow(nv,30.);c=mix(uColor.rgb*.45,c,smoothstep(.12,.45,nv));if(uSelected>.5)c=mix(c,vec3(.66,1.,.62),.5);gl_FragColor=vec4(c,1.);return;}
vec3 n=normalize(vNormal),V=normalize(vEye);float nv=dot(n,V),ao=clamp(vAO,0.,1.),alpha=uColor.a,rim=pow(1.-abs(nv),2.);bool tissue=uMaterial>-.5&&uIsMarker<.5,arach=uMaterial>8.5&&uMaterial<9.5,slab=uMaterial>9.5&&uMaterial<10.5,skin=slab||uMaterial>12.5;
/* skin slab faces (rest pose): outer skin srad > .45, inner (subcutaneous) < -.45, cut walls between; wall vertex
   normals are tilted +-.34 toward/away from the shell centre at load, so srad runs from the epidermis (+.34) to the
   deep subcutaneous edge (-.34) across a wall. */
float srad=slab?dot(normalize(vObjN),normalize(vOriginal-vec3(0.,-.4,-.4))):1.;
float light=.30+.55*abs(dot(n,normalize(vec3(-.5,.7,1.))))+.12*abs(dot(n,normalize(vec3(.9,-.2,.3))));vec3 c=uColor.rgb*light;
if(tissue&&uSurgical<.5){if(skin&&srad<.45)c=uInner*light;c*=mix(1.,ao,.75);if(arach)alpha=clamp(alpha*(.55+.8*rim),0.,.85);}
if(tissue&&uSurgical>.5){
 if(nv<0.)n=-n;nv=abs(nv);
 vec3 P=vOriginal,base=uColor.rgb;float shin=30.,specI=.2,wrap=.3,sss=0.;
 if(uMaterial<.5){
   base*=.88+.16*fbm(P*38.);shin=14.;specI=.05;wrap=.1;
   float radial=abs(dot(vObjN,normalize(P-vec3(0.,-.4,-.4))));
   float cut=uBonePiece*(1.-smoothstep(.22,.58,radial));
   base=mix(base,vec3(.83,.61,.54)*(.84+.21*vnoise(P*88.)),cut*.68);
 }
 else if(uMaterial<1.5){float m=fbm(P*9.);base*=.91+.13*m;float v=smoothstep(.975,.995,ridge(P*3.+m*1.2))*.12+smoothstep(.985,.997,ridge(P*8.+3.1))*.06;base=mix(base,vec3(.66,.24,.25),v*mix(.6,1.,ao));shin=70.;specI=.42;wrap=.55;sss=.45;}
 else if(uMaterial<2.5){base*=.74+.42*vnoise(vec3(P.x*70.,P.y*3.5,P.z*70.));shin=36.;specI=.28;wrap=.45;sss=.35;}
 else if(uMaterial<3.5){base*=.88+.16*vnoise(vec3(P.x*55.,P.y*6.,P.z*55.));shin=95.;specI=.55;wrap=.35;}
 else if(uMaterial<4.5){float l=fbm(P*9.);base*=.92+.1*smoothstep(.25,.75,l)-.05*smoothstep(.95,.995,ridge(P*9.+l));shin=60.;specI=.3;wrap=.65;sss=.4;}
 else if(uMaterial<5.5){base*=.94+.08*vnoise(P*30.);shin=90.;specI=.55;wrap=.35;sss=.3;}
 else if(uMaterial<6.5){base*=.9+.12*vnoise(P*48.);shin=55.;specI=.32;wrap=.45;sss=.15;}
 else if(uMaterial<7.5){float m=fbm(P*5.);base*=.94+.06*m+.05*vnoise(vec3(P.x*30.,P.y*90.,P.z*30.));base=mix(base,vec3(.64,.67,.74),.22*smoothstep(.35,.75,fbm(P*2.3+3.)));shin=150.;specI=.24;wrap=.35;sss=.1;}
 else if(uMaterial<8.5){base*=.9+.12*vnoise(P*26.);shin=110.;specI=.6;wrap=.3;sss=.2;}
 else if(uMaterial<9.5){shin=130.;specI=.75;wrap=.6;}
 else if(skin){
  /* skin: mottled warm epidermis with fine pores and a faint sheen; cut edge = pink-white dermis over lobulated
     yellow subcutaneous fat with a thin bloody line at the epidermis; inner face = subcutaneous fat */
  if(srad>.45){float m=fbm(P*3.5);base*=.96+.08*m;base=mix(base,base*vec3(1.04,.93,.92),.24*smoothstep(.45,.8,fbm(P*2.3+5.)));base*=1.-.025*NOISE*smoothstep(.68,.9,vnoise(P*60.));shin=16.;specI=.09;wrap=.57;sss=.6;}
  else if(srad>-.45){float f=clamp(.5-srad*1.47,0.,1.);vec3 derm=vec3(.9,.72,.67)*(.93+.1*vnoise(P*120.)),fat=uInner*(.86+.2*fbm(P*45.));base=mix(derm,fat,smoothstep(.5,.62,f));base=mix(base,vec3(.52,.12,.1),.55*(1.-smoothstep(.02,.1,f)));shin=80.;specI=.4;wrap=.5;sss=.35;}
  else{base=uInner*(.86+.2*fbm(P*40.));shin=70.;specI=.35;wrap=.6;sss=.4;}}
 else if(uMaterial<11.5){
  /* galea: glistening white-grey aponeurosis with fibres running front to back and faint small vessels */
  float fib=vnoise(vec3(P.x*55.,P.y*55.,P.z*7.));base*=.9+.12*fib+.04*vnoise(P*30.);base=mix(base,vec3(.7,.42,.42),.1*smoothstep(.986,.998,ridge(P*6.+fib)));shin=140.;specI=.65;wrap=.35;sss=.12;}
 else{
  /* pericranium: thin translucent bluish-white membrane over the outer table (bone tone shows through), fine vessels */
  float m=fbm(P*12.);vec3 bone=vec3(.86,.8,.7)*(.9+.1*m);base=mix(bone,base,.5+.25*smoothstep(.3,.8,fbm(P*3.5+2.)));base=mix(base,vec3(.72,.4,.42),.12*smoothstep(.985,.997,ridge(P*7.+m)));shin=110.;specI=.5;wrap=.4;sss=.15;}
 vec3 alb=base*base,L1=normalize(vec3(-.35,.55,1.));float n1=dot(n,L1),dAO=mix(1.,ao,.75);
 float d1=max(0.,(n1+wrap)/(1.+wrap)),d2=max(0.,(nv+wrap)/(1.+wrap));
 vec3 col=alb*(.50*d1+.36*d2)*dAO;
 col+=sss*alb*vec3(1.,.32,.22)*max(0.,(n1+.9)/1.9-max(0.,n1))*.9*dAO;
 col+=alb*mix(vec3(.07,.06,.06),vec3(.17,.17,.19),.5+.5*n.y)*ao;
 float F=.04+.96*pow(1.-nv,5.),s1=pow(max(0.,dot(n,normalize(L1+V))),shin),s2=pow(nv,shin*2.);
 col+=vec3(1.,.97,.93)*specI*(s1*.9+s2*.7)*(1.+2.*F)*mix(1.,ao,.8);
 vec2 sc=(gl_FragCoord.xy/uViewport-.5)*vec2(uViewport.x/uViewport.y,1.);
 col*=.8*mix(1.1,.66,smoothstep(.15,.9,length(sc)));
 col=(col*(2.51*col+.03))/(col*(2.43*col+.59)+.14);
 c=sqrt(clamp(col,0.,1.));light=clamp(dot(c,vec3(.33)),0.,1.);
 if(arach)alpha=clamp(alpha*(.55+1.3*pow(1.-nv,2.))+specI*(s1+s2)*.5,0.,.92);
}
if(uGroove>0.){
    vec2 g=(vOriginal.yz-uDuralWindow.xy)/uDuralWindow.zw;
    float r=abs(length(g)-1.), a=mod(atan(g.y,g.x)+4.65,6.2831853)/6.2831853;
    if(a<uGroove && r<.04)c=mix(c,vec3(.37,.12,.14),1.-smoothstep(.012,.04,r));
}
if(uChange>0.)c=mix(c,vec3(1.,.65,.17)*(.6+.4*light),.31*(.27+.73*rim));
if(uInkProgress>0.){
  vec2 uv=(vOriginal.yz-uInkBounds.xy)/uInkBounds.zw;
  vec4 ink=texture2D(uInkMask,uv);
  float outer=smoothstep(.18,.55,dot(vObjN, normalize(vOriginal - vec3(0., -.4, -.4))));
  c=mix(c,vec3(.052,.041,.038),ink.a*outer*step(ink.r,uInkProgress));
}
if(uSelected>.5)c=mix(c,vec3(.66,1.,.62),.50);if(uIsMarker>.5)c=mix(c,uColor.rgb,.8);gl_FragColor=vec4(c,alpha);}`));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw Error(gl.getProgramInfoLog(program));
        gl.useProgram(program);
        ['InkMask','InkBounds','InkProgress','View','Distance','Aspect','Scale','Pan','Color','Selected','Pick',
         'Target','Offset','Change','FlapAngle','IsMarker','Line','LinePx','LineNudge','Material','Surgical','Quality',
         'Viewport','FlapAxis','FlapPivot','CurlOn','CurlIA','CurlPivot','CurlAxis','CurlAway','CurlLift','CurlP',
         'CurlRow','Inner','Retract','OpenSac','BonePiece','Groove','DuralWindow','PartOn','Part','Inc','DrapeW','DrapeP','Drape','Fissure','FissureProgress','SplitPass','SplitInc'].forEach(n => uniforms[n] = gl.getUniformLocation(program, 'u' + n));
        gl.uniform1i(uniforms.InkMask, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.activeTexture(gl.TEXTURE0);
        let vertexCount = 0;
        meshes.forEach((m, i) => { m.index = i; m.hidden = false; m.first = vertexCount; vertexCount += m.count; m.rgb = m.color.match(/\w\w/g).map(x => parseInt(x, 16) / 255); m.innerRgb = m.innerColor ? hexRgb(m.innerColor) : null;; });
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertexCount * 24, gl.STATIC_DRAW);
        meshes.filter(m => !m.contextOnly).forEach(ensureGeometry);
        for (const [name, start] of [['aPosition', 0], ['aNormal', 12]]) {
            const loc = gl.getAttribLocation(program, name);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 24, start);
        }
        available = true;
        window.guideQA = {
            activate, visible, getMeshes: () => meshes.map(({ data, vertexData, procedureCandidates, ...m }) => m),
            getSteps: () => steps, getCamera: () => ({ ...cameraState(), distance, pan: [...pan], viewZoom }), getPose: poseState,
            getState: () => ({ stage, mode, opening, beforeCurrent, contextSide, palette, viewZoom }),
            project, stateProgress, setView, setTab, setProcedureSide, setSurgeonView,
            movePoint: (id, p) => movePoint(meshes.find(m => m.id === id), p),
            pickAt: (x, y) => { draw(true); cacheLabelVisibility(); return pickIdAt(x, y); }
        };
        $('#loading').hidden = true;
        render();
    }
    let pickTarget = null, fissureN = 12;
    function fissureUniform(m) {
        if (!m.fissurePoints) {
            const line = m.fissureLine;
            m.fissurePoints = Array.from({length:fissureN},
                (_,i) => line[Math.round(i*(line.length-1)/(fissureN-1))]).flat();
        }
        return m.fissurePoints;
    }
    function preparePickTarget(w, h) { if (pickTarget && pickTarget.w === w && pickTarget.h === h)
        return; if (pickTarget) {
        gl.deleteFramebuffer(pickTarget.fbo);
        gl.deleteTexture(pickTarget.texture);
        gl.deleteRenderbuffer(pickTarget.depth);
    } const fbo = gl.createFramebuffer(), texture = gl.createTexture(), depth = gl.createRenderbuffer(); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth); if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw Error('Selection buffer is unavailable'); pickTarget = { fbo, texture, depth, w, h }; gl.bindTexture(gl.TEXTURE_2D, null); gl.bindRenderbuffer(gl.RENDERBUFFER, null); }
    function setCurlUniforms(cs) {
        gl.uniform1f(uniforms.CurlOn, cs ? 1 : 0);
        if (!cs) return;
        const mo = cs.mo;
        gl.uniform3fv(uniforms.CurlPivot, mo.pivot);
        gl.uniform3fv(uniforms.CurlAxis, mo.axis);
        gl.uniform3fv(uniforms.CurlAway, mo.away);
        gl.uniform3fv(uniforms.CurlLift, mo.lift);
        gl.uniform4f(uniforms.CurlP, mo.R, cs.T, cs.dh, mo.prof.a0);
        gl.uniform1f(uniforms.CurlIA, mo.prof.ia);
        gl.uniform1fv(uniforms.CurlRow, cs.row);
        const drape = cs.mo.drape;
        gl.uniform1f(uniforms.DrapeW, drape ? cs.wD : 0);
        if (drape && cs.wD > 0) {
            gl.uniform4f(uniforms.DrapeP, drape.a0, drape.ia, drape.ie, drape.RT);
            gl.uniform1fv(uniforms.Drape, drape.tab);
        }
    }
    // Largest drawable size (an oversized layout, e.g. a very wide page, must not break the selection buffer).
    let drawLimitCache = 0;
    function drawLimit() { if (!drawLimitCache) {
        const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
        drawLimitCache = Math.max(256, Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096, vp ? Math.min(vp[0], vp[1]) : 4096));
    } return drawLimitCache; }
    // Draw ink in the skin's rest coordinates. The same pixels then follow the
    // parted edges, reflected flap and closure through the existing mesh transforms.
    const skinInkMasks = new Map();
    function skinInkTexture(points) {
        const size = 512, radius = .065, padding = .12;
        const left = Math.min(...points.map(([x]) => x)) - padding;
        const bottom = Math.min(...points.map(([, y]) => y)) - padding;
        const width = Math.max(...points.map(([x]) => x)) + padding - left;
        const height = Math.max(...points.map(([, y]) => y)) + padding - bottom;
        const pixels = new Uint8Array(size * size * 4);
        const u = x => (x - left) / width * size;
        const v = y => (y - bottom) / height * size;
        const clampPixel = n => Math.min(size - 1, Math.max(0, Math.floor(n)));
        for (let i = 1; i < points.length; i++) {
            const [ax, ay] = points[i - 1], [bx, by] = points[i];
            const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
            for (let py = clampPixel(v(Math.min(ay, by) - radius)); py <= clampPixel(v(Math.max(ay, by) + radius)); py++) {
                for (let px = clampPixel(u(Math.min(ax, bx) - radius)); px <= clampPixel(u(Math.max(ax, bx) + radius)); px++) {
                    const x = left + (px + .5) * width / size - ax;
                    const y = bottom + (py + .5) * height / size - ay;
                    const t = Math.max(0, Math.min(1, (x * dx + y * dy) / (lengthSquared || 1)));
                    const alpha = Math.round(255 * Math.max(0, Math.min(1, (radius - Math.hypot(x - dx * t, y - dy * t)) / .02)));
                    const index = 4 * (py * size + px);
                    if (alpha <= pixels[index + 3]) continue;
                    pixels[index] = Math.round(255 * (i - 1 + t) / (points.length - 1));
                    pixels[index + 3] = alpha;
                }
            }
        }
        const texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.activeTexture(gl.TEXTURE0);
        return { texture, bounds: [left, bottom, width, height] };
    }

    function prepareSkinInk(picking) {
        if (picking || !procedure) return 0;
        const marking = steps.findIndex(step => step.id === 'prepare');
        if (marking < 0 || stage < marking || stage === marking && beforeCurrent) return 0;
        const progress = stage === marking ? opening : 1;
        if (progress <= 0) return 0;
        const key = operativeSide();
        if (!skinInkMasks.has(key)) {
            const points = manifest.ink.map(([, y, z]) => [y, z]);
            if (!points?.length) return 0;
            skinInkMasks.set(key, skinInkTexture(points));
        }
        const { texture, bounds } = skinInkMasks.get(key);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform4fv(uniforms.InkBounds, bounds);
        return progress;
    }

    function draw(picking = false) {
        if (!available)
            return;
        updateGlide();
        updatePose();
        const ratio = picking ? 1 : Math.min(devicePixelRatio || 1, 1.5), maxDim = drawLimit(), w = Math.max(1, Math.min(maxDim, Math.round(host.clientWidth * ratio))), h = Math.max(1, Math.min(maxDim, Math.round(host.clientHeight * ratio)));
        if (!picking && (canvas.width !== w || canvas.height !== h)) {
            canvas.width = w;
            canvas.height = h;
        }
        aspect = w / h;
        if (picking)
            preparePickTarget(w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, picking ? pickTarget.fbo : null);
        gl.viewport(0, 0, w, h);
        gl.clearColor(picking ? 0 : .058, picking ? 0 : .093, picking ? 0 : .12, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.DITHER);
        gl.uniformMatrix3fv(uniforms.View, false, mT(viewBasis().M)); // GLSL mat3 is column-major

        gl.uniform1f(uniforms.Distance, distance);
        gl.uniform1f(uniforms.Aspect, aspect);
        gl.uniform1f(uniforms.Scale, projectionScale()); gl.uniform1f(uniforms.LinePx, 2 * LINE_MIN_HALF_PX / (projectionScale() * gl.drawingBufferHeight)); gl.uniform1f(uniforms.LineNudge, LINE_NUDGE);
        // Scale by w in the vertex shader so the offset is uniform after perspective division.
        gl.uniform2fv(uniforms.Pan, pan);
        gl.uniform3fv(uniforms.Target, viewBasis().target);
        gl.uniform1f(uniforms.Pick, picking ? 1 : 0);
        gl.uniform1f(uniforms.Surgical, palette === 'surgical' ? 1 : 0);
        gl.uniform1f(uniforms.Quality, isMobile ? 0 : 1);
        gl.uniform2f(uniforms.Viewport, w, h);
        gl.uniform3fv(uniforms.CamPos, cameraPosition());
        // Opaque meshes first; translucent ones afterwards, back to front, without depth writes. In the picking
        // pass translucent meshes are drawn after the opaque ones with the depth test, so a click identifies the
        // nearest surface; the arachnoid veil is left out (pickThrough) so clicks reach the cortex and vessels.
        const visibleList = meshes.filter(visible), opaque = visibleList.filter(m => opacity(m) >= 1), depth = m => transform(movePoint(m, m.anchor))[2];
        const translucent = visibleList.filter(m => opacity(m) < 1 && opacity(m) > 0 && !(picking && m.group === 'arachnoid')).map(m => [depth(m), m]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
        const list = [...opaque, ...translucent];
        gl.disable(gl.BLEND);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.uniform1f(uniforms.InkProgress, 0);
        drawProps(picking); // schematic head holder and table (room views only); restores the anatomy buffer
        const inkProgress = prepareSkinInk(picking);
        for (const m of list) {
            ensureGeometry(m);
            const flat = m.marker || m.instrument || !(m.group in materialIds), see = !picking && opacity(m) < 1;
            let rgb = palette === 'surgical' && !flat ? surgicalRgb[m.id === 'sac' ? 'clot' : m.group] : m.rgb;
            gl.uniform1f(uniforms.InkProgress, m.group === 'skin' && !m.externalSurface && meshSide(m) === 'left' ? inkProgress : 0);
            if (m.id.startsWith('EXT-brow')) rgb = m.rgb;
            if (see) {
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            }
            gl.uniform1f(uniforms.Material, flat ? -1 : m.externalSurface ? 13 : materialIds[m.group]);
            if (picking) {
                const id = m.index + 1;
                rgb = [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255];
            }
            gl.uniform1f(uniforms.IsMarker, m.marker ? 1 : 0);
            gl.uniform1f(uniforms.Line, m.marker || m.instrument ? (m.markerRadius || .035) : 0);
            gl.uniform1f(uniforms.Change, changeKind(m));
            gl.uniform3fv(uniforms.Offset, meshOffset(m));
            gl.uniform1f(uniforms.FlapAngle, boneAngle(m));
            gl.uniform3fv(uniforms.FlapAxis, flapAxis);
            gl.uniform3fv(uniforms.FlapPivot, flapPivot);
            gl.uniform3fv(uniforms.Retract, m.retract ? [stateProgress('proximal'), stateProgress('distal'), m.retract] : [0, 0, 0]);
            const part = incisionState(m);
            gl.uniform1f(uniforms.PartOn, part ? 1 : 0);
            if (part) {
                gl.uniform3fv(uniforms.Inc, part.inc.flat);
                gl.uniform4f(uniforms.Part, part.reveal, part.gap, part.sign, PART_FALLOFF);
            }
            gl.uniform2fv(uniforms.FissureProgress, m.fissureLine
                ? [stateProgress('proximal'), stateProgress('distal')] : [0, 0]);
            if (m.fissureLine) gl.uniform3fv(uniforms.Fissure, fissureUniform(m));
            const groove = m.group === 'dura' && meshSide(m) === 'left'
                ? clamp01(stateProgress('dura') / .20) : 0;
            gl.uniform1f(uniforms.Groove, groove);
            if (groove) gl.uniform4fv(uniforms.DuralWindow, [...manifest.duraWindow.center,...manifest.duraWindow.radii]);
            const sacOpen = m.sacMask && stateProgress('sacOpen');
            gl.uniform1f(uniforms.OpenSac, sacOpen ? m.anchor[0] + .096 + .23 * (1 - sacOpen) : 0);
            gl.uniform1f(uniforms.BonePiece, m.cutEdge ? 1 : 0);
            gl.depthMask(!see);
            gl.uniform4fv(uniforms.Color, [...rgb, picking ? 1 : opacity(m)]);
            gl.uniform1f(uniforms.Selected, m.index === selected ? 1 : 0);
            gl.uniform3fv(uniforms.Inner, m.innerRgb || m.rgb);
            const curl = flapState(m);
            if (m.splitFlap && curl) {
                gl.uniform3fv(uniforms.Inc, incision.flat);
                gl.uniform2f(uniforms.SplitInc, incision.sign, .08);
                gl.uniform1f(uniforms.SplitPass, 1);
                setCurlUniforms(null);
                gl.drawArrays(gl.TRIANGLES, m.first, m.count);
                gl.uniform1f(uniforms.SplitPass, 2);
                setCurlUniforms(curl);
                gl.drawArrays(gl.TRIANGLES, m.first, m.count);
            } else {
                gl.uniform1f(uniforms.SplitPass, 0);
                setCurlUniforms(curl);
                gl.drawArrays(gl.TRIANGLES, m.first, m.count);
            }
        }
        gl.disable(gl.BLEND);
        gl.depthMask(true);
        if (!picking) {
            updateStepLabels();
            updateGizmo();
            syncPoseControls();
        }
    }
    function render(refreshPicking = true) { if (interactionActive)
        pickDirty = false;
    else if (refreshPicking)
        pickDirty = true; if (scheduled)
        return; scheduled = true; requestAnimationFrame(now => { scheduled = false; poseClock = now; if (mode === '3d') {
        if (pickDirty) { pickDirty = false; draw(true); cacheLabelVisibility(); }
        draw();
    } }); }
    // Pterional PR #1 trackball, pan, pinch, twist and keyboard gestures.
    const pointers = new Map();
    let dragging = false, press = null;
    const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

    function touchPair() {
        const [a, b] = pointers.values();
        const dx = b[0] - a[0], dy = b[1] - a[1];
        return {
            center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
            distance: Math.hypot(dx, dy),
            angle: Math.atan2(dy, dx)
        };
    }

    function panBy(dx, dy) {
        const unit = 2 * distance / (projectionScale() * Math.max(1, host.clientHeight));
        pan[0] += dx * unit;
        pan[1] -= dy * unit;
    }

    canvas.onpointerdown = e => {
        if (e.button !== 0 && e.button !== 2) return;
        stopGlide(false);
        try {
            canvas.setPointerCapture(e.pointerId);
        } catch {
            // Synthetic or already released pointers cannot be captured.
        }
        const point = [e.clientX, e.clientY];
        if (!pointers.size) {
            press = point;
            dragging = false;
        } else {
            dragging = true;
        }
        pointers.set(e.pointerId, point);
        markInteraction();
    };

    canvas.onpointermove = e => {
        const previous = pointers.get(e.pointerId);
        if (!previous) return;
        const point = [e.clientX, e.clientY];
        const pair = pointers.size === 2 ? touchPair() : null;
        pointers.set(e.pointerId, point);

        const origin = dragging ? previous : press;
        const dx = point[0] - origin[0], dy = point[1] - origin[1];
        if (!dragging && Math.hypot(dx, dy) < 5) return;
        if (pointers.size > 2 || (!pair && !dx && !dy)) return;
        dragging = true;
        stopGlide();
        markInteraction();

        if (pair) {
            const next = touchPair();
            if (pair.distance > 0 && next.distance > 0) {
                zoomBy(next.distance / pair.distance, false);
                rollView(-wrapAngle(next.angle - pair.angle));
            }
            panBy(next.center[0] - pair.center[0], next.center[1] - pair.center[1]);
        } else if (e.shiftKey || (e.buttons & 2)) {
            panBy(dx, dy);
        } else if (e.altKey) {
            const rect = canvas.getBoundingClientRect();
            const [x, y] = project(anatomyCenter);
            const angle = p => Math.atan2(p[1] - rect.top - y, p[0] - rect.left - x);
            rollView(-wrapAngle(angle(point) - angle(origin)));
        } else {
            rotateByDrag(dx, dy);
        }
        render(false);
    };

    function cancelPointer(e) {
        if (pointers.delete(e.pointerId) && !pointers.size) markInteraction();
    }

    canvas.onpointerup = e => {
        if (!pointers.has(e.pointerId)) return;
        const click = !dragging && e.button === 0 &&
            Math.hypot(e.clientX - press[0], e.clientY - press[1]) < 5;
        cancelPointer(e);
        if (click && available) {
            draw(true);
            cacheLabelVisibility();
            const rect = canvas.getBoundingClientRect();
            select(pickIdAt(e.clientX - rect.left, e.clientY - rect.top));
            render();
        }
    };
    canvas.onpointercancel = cancelPointer;
    canvas.addEventListener('lostpointercapture', cancelPointer);
    window.addEventListener('blur', () => {
        if (!pointers.size) return;
        pointers.clear();
        markInteraction();
    });
    canvas.oncontextmenu = e => e.preventDefault();

    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        stopGlide(false);
        markInteraction();
        const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host.clientHeight : 1);
        zoomBy(Math.exp(-delta * .0015), false);
    }, { passive: false });

    canvas.onkeydown = e => {
        if (e.key === 'Escape') {
            clearSelection();
            return;
        }
        const key = e.code === 'KeyQ' ? 'q' : e.code === 'KeyE' ? 'e' : e.key.toLowerCase();
        const actions = {
            arrowleft: () => rotateByDrag(-.13, 0, 1),
            arrowright: () => rotateByDrag(.13, 0, 1),
            arrowup: () => rotateByDrag(0, .1, 1),
            arrowdown: () => rotateByDrag(0, -.1, 1),
            q: () => rollView(.1),
            e: () => rollView(-.1),
            '+': () => zoomBy(1.15),
            '=': () => zoomBy(1.15),
            '-': () => zoomBy(1 / 1.15),
            home: () => $('#resetView').click()
        };
        if (!Object.hasOwn(actions, key)) return;
        e.preventDefault();
        stopGlide();
        actions[key]();
        render();
    };
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); available = false; $('#noGL').hidden = false; });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
    new ResizeObserver(() => { updateMobilePanelHeight(); render(); }).observe(host);
    rebuild();
    applyRecommendedView();
    requestAnimationFrame(() => { try {
        initGL();
    }
    catch (error) {
        $('#loading').hidden = true;
        $('#noGL').hidden = false;
        $('#noGL').textContent = 'The 3D renderer could not start: ' + error.message + '. The paper library and reading sequence remain available.';
        console.error(error);
    } });
})();
