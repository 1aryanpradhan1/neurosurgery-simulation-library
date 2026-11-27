(() => {
    'use strict';
    const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
    const guideData = window.__GUIDE_DATA__;
    const meshes = guideData?.['mesh-data'] ?? JSON.parse($('#mesh-data').textContent);
    meshes.push(...(window.pterionalExternalLandmarks || []));
    delete window.pterionalExternalLandmarks;
    const manifest = guideData?.['manifest-data'] ?? JSON.parse($('#manifest-data').textContent);
    const displayConflicts = window.__GUIDE_DATA__?.['clearance-data'] ??
        JSON.parse($('#clearance-data')?.textContent || '{}');
    const clearanceMeshById = new Map(meshes.map(mesh => [mesh.id, mesh]));
    const papers = manifest.papers;
    const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const mobileQuery = matchMedia('(max-width:760px)');
    let isMobile = mobileQuery.matches, desktopLabelPreference = true, mobileLabelPreference = false, viewZoom = 1;
    let config = { region: 'anterior' }, steps = [], stage = 0, mode = '3d', selected = -1, contextAlpha = 1, contextSide = 'right', procedure = true, prelabelsOn = !isMobile, opening = 1, animationToken = 0, separateLayers = false, instrumentsOn = true, beforeCurrent = false, regionalContext = true, contextLayerSnapshot = null;
    const enabled = { skin: true, galea: true, pericranium: true, bone: true, brain: true, arteries: true, veins: true, dura: true, arachnoid: true };
    // Surgical palette: approximate unlit tissue albedo (sRGB) used by the material shader; Atlas keeps the manifest colours.
    const palettes = { atlas: { skin: '#d9a184', galea: '#d8dad3', pericranium: '#dcd6e4', bone: '#e2d5b8', brain: '#bca99d', muscle: '#b87367', fascia: '#a4c7ba', deepfascia: '#75a99a', fat: '#debd69', arteries: '#dd6268', veins: '#5f6fae', nerves: '#f2d776', dura: '#95b7bb', arachnoid: '#cfe3ea' }, surgical: { skin: '#cf9a7f', galea: '#dcdbd3', pericranium: '#d8d9e0', bone: '#dccdb0', brain: '#d4aa9c', muscle: '#82302a', fascia: '#e2ddd1', deepfascia: '#d9dcd8', fat: '#e3c677', arteries: '#c4423d', veins: '#5e3e66', nerves: '#ede3c6', dura: '#c4bcb5', arachnoid: '#e6eef1' } };
    // Distinct Surgical tones for the temporal fat pads and fascial laminae, so the separated planes stay
    // distinguishable (the Atlas palette keeps the manifest colours).
    const surgicalLayerTints = { 'ILL-subfat': '#d2a256', 'ILL-interfat': '#e3c677', 'ILL-suprafat': '#ece0bd', 'ILL-superfascia': '#e8e3d6', 'ILL-deepfascia': '#c3c8c4' };
    const materialIds = { bone: 0, brain: 1, muscle: 2, fascia: 3, deepfascia: 3, fat: 4, arteries: 5, nerves: 6, dura: 7, veins: 8, arachnoid: 9, skin: 10, galea: 11, pericranium: 12 };
    let palette = 'surgical';
    try {
        if (localStorage.getItem('transfalcine-palette') === 'atlas')
            palette = 'atlas';
    }
    catch (error) { }
    const hexRgb = c => c.match(/\w\w/g).map(x => parseInt(x, 16) / 255);
    const surgicalRgb = Object.fromEntries(Object.entries(palettes.surgical).map(([k, c]) => [k, hexRgb(c)]));
    const allEnabled = Object.fromEntries(Object.keys(enabled).map(k => [k, false]));
    const canvas = $('#canvas'), host = $('#viewport');
    // Midpoint of the native cranial vault bounds, shared by every camera preset.
    const anatomyCenter = Object.freeze([0, -.35, -.41]);
    // Camera state: viewQ/camFrame are described with the orientation helpers below; distance, pan (screen
    // space, before projection) and viewZoom follow Pterional PR #1.
    let gl = null, program = null, uniforms = {}, buffer = null, available = false, viewQ = qFromAngles(1.0, .25, 0), camFrame = 'head', distance = 15, pan = [0, 0], aspect = 1, scheduled = false, pickDirty = true, interactionActive = false, interactionTimer = 0;
    const scale = 2.05, LINE_MIN_HALF_PX = 1.3, LINE_NUDGE = .03;
    const regions = manifest.regions;
    const regionName = name => name[0].toUpperCase() + name.slice(1);
    const configs = Object.keys(regions).map(region => ({ region }));
    const measures = {
        anterior: ['4.8 (2–7)', '18.6 (11–30)', '22.9 (18–38)'],
        middle: ['9.7 (7–14)', '17.0 (12–24)', '22.4 (16–31)'],
        posterior: ['12.6 (8–15)', '15.6 (12–22)', '21.3 (17–28)']
    };
    const landmarks = {
        anterior: ['genu', 'midway between the glabella and coronal suture', 'Figure 1'],
        middle: ['body', 'with two-thirds anterior and one-third posterior to the coronal suture', 'Figure 2'],
        posterior: ['splenium', 'over the lambda', 'Figure 3']
    };
    const cases = [
        ['Middle third · Mesial parietal cavernous malformation', 'The right paracentral lesion reached the medial surface and extended 22 mm laterally. The upper margin was 11 mm below the cortical surface. A left entry was used.', 'middle', 'left', 'Figure 5'],
        ['Posterior third · Parieto-occipital AVM', 'The right mesial arteriovenous malformation extended 25 mm lateral to midline. A left entry used gravity to open the corridor. The operative photographs show the falx before and after flap mobilization.', 'posterior', 'left', 'Figure 6'],
        ['Middle third · Falcine meningioma', 'The deep falcine lesion extended 27 mm to the left. A right entry exposed the left-sided component through the falx.', 'middle', 'right', 'Figure 7']
    ];
    function buildSteps() {
        const r = regions[config.region];
        const [targetName, boneLandmark, figure] = landmarks[config.region];
        const posterior = config.region === 'posterior';
        const anterior = config.region === 'anterior';
        const soft = ['skin', 'galea', 'pericranium', 'bone', 'dura'];
        const bone = ['bone', 'dura'];
        const deep = ['bone', 'dura'];
        const outerView = { frame: 'head', eye: [-.82, .45, posterior ? -.35 : .48], up: [0, 1, 0], distance: 17, zoom: 1.05 };
        const closeView = { ...outerView, distance: 8.8, zoom: 1.44, target: [-.47, r.floor+.7, r.z] };
        const viewDepth = (r.falx_top + r.deep) / 2;
        const scope = { ...closeView, eye: [-.47, r.floor+.87-viewDepth, r.z-r.falx_z], up: [0,0,1],
            target: [-.10,viewDepth,r.falx_z], distance: 7.7, zoom: 1.35 };
        let state = {};
        const make = (id, title, body, groups, change, updates, view, labels, evidence = figure) => {
            const beforeState = {...state};
            state = {...state, ...updates};
            return { id, title, body, groups, change, changes: Object.keys(updates), beforeState, state, view, labels,
                sources: ['alexander'], visualAction: id, evidence, page: r.page, note: '',
                contextLayers: ['skin','galea','pericranium'],
                stagger: undefined };
        };
        return [
            make('orient', 'Orient the parasagittal approach', 'The working corridor begins on the side opposite the target. Follow the sagittal midline and identify the intended level of the interhemispheric fissure.', soft, '', {}, outerView, ['Planned scalp incision']),
            make('position', 'Position the head for gravity-assisted exposure', posterior
                ? 'Use a three-quarter prone setup with the lesion side uppermost and the chin angled slightly down. This brings the approach hemisphere below the falx.'
                : 'Place the lesion side up in a lateral setup. Elevate the vertex 45° and keep the superior sagittal sinus parallel to the floor in the reported setup to favor gravity-assisted exposure.', soft, 'position', {position:true},
                {frame:'world', eye:[-.35,.52,.78],up:[0,1,0],target:[0,.25,0],distance:17,zoom:1}, []),
            make('incision', anterior ? 'Mark the bicoronal incision' : 'Mark the linear incision', anterior
                ? 'Place the bicoronal incision behind the hairline to expose frontal bone without an incision on the forehead. The anteriorly reflected scalp gives access to the planned rectangle.'
                : 'Center the linear incision over the planned craniotomy. Carry the exposure in the subpericranial plane to the surrounding calvarium.', soft, 'incision', {incision:true}, outerView, ['Planned scalp incision']),
            make('reflect', 'Reflect the scalp and galea', 'Open the soft-tissue exposure and clear the pericranium over the intended bone window. Keep the sagittal and nearby transverse sutural landmarks in view.', soft, 'skin', {skin:true,galea:true,pericranium:true}, closeView, ['Reflected skin']),
            make('burr', 'Place five burr holes', 'Place the central hole over the superior sagittal sinus. Place paired anterior and posterior holes about 1 cm to either side of the midline.', soft, 'burr', {burr:true}, closeView, ['Burr hole at the sinus']),
            make('separate', 'Separate dura from the inner table', 'Release the dura from the underside of the planned flap with a Penfield No. 3 dissector. This frees the bone before elevation, including at the sagittal sinus.', soft, 'separate', {separate:true}, closeView, ['Penfield No. 3 dissector']),
            make('elevate', 'Lift the rectangular bone flap', 'The craniotomy is centered ' + boneLandmark + '. Expose the full width of the sinus, the entry-side dura and a narrow margin of opposite dura.', bone, 'bone', {bone:true}, closeView, ['Superior sagittal sinus']),
            make('dura', 'Reflect the sinus-based dural flap', 'Open the entry-side dura with its base at the superior sagittal sinus. Reflect it medially while retaining the sinus and the opposite dural margin.', deep, 'dura', {dura:true}, closeView, ['Sagittal sinus based dural flap']),
            make('interhemispheric', 'Open the interhemispheric corridor', 'Dissect arachnoid between the hemispheres while preserving bridging veins. Follow the medial surface to the ' + targetName + ' of the corpus callosum.' + (posterior ? ' Identify the straight sinus at the anteroinferior boundary.' : ' Identify the pericallosal and callosomarginal vessels where they border the exposure.'), deep,
                'retract', {retract:true,arachnoid:true}, scope, ['Corpus callosum','Superior sagittal sinus']),
            make('falx', 'Open the rectangular falcine window', 'Create the falcine window with a No. 11 blade and microscissors. Keep its upper limit below the superior sagittal sinus and under direct view.' + (posterior ? ' The straight sinus bounds the inferior side, and the inferior sagittal sinus can limit the anterior edge.' : ' The bone opening bounds the anterior and posterior extent.'), deep,
                'falx', {falx:true}, scope, ['Falx cerebri']),
            make('limits', 'Compare superior and lateral exposure', 'Mark the highest point visible across the falx. In the cadaveric dissection, the view extended farther laterally at the ' + targetName + ' than halfway down the fissure. Open Indications to compare the measurements for all three corridors.', deep, 'limits', {limits:true}, scope,
                ['Superior comparison level','Corpus callosum'], 'Table and Figure 4'),
            make('release', 'Release the working corridor', 'Restore the illustrated hemisphere to its resting position. The paper emphasizes confirming bridging vein patency before dural closure.', deep, 'retract', {retract:false}, scope, ['Superior sagittal sinus'], 'Discussion, pages 7–8'),
            make('dura-close', 'Return the dural flap', 'Return the flap to the dural opening. This reconstruction view illustrates closure of the entry exposure once the study corridor is complete.', deep, 'dura', {dura:false}, closeView, ['Sagittal sinus based dural flap'], 'Schematic reversal'),
            make('bone-replace', 'Replace the bone flap', 'Return the rectangular flap to its original calvarial position. The restored surface marks the boundary of the initial exposure.', bone, 'bone', {bone:false,burr:false}, closeView, ['Frontal bone','Right parietal bone','Occipital bone'], 'Schematic reversal'),
            make('close', 'Return the soft-tissue layers', 'Return the pericranium, galea and skin over the exposure. The model shows the restored relationship of the three layers.', soft, 'skin', {skin:false,galea:false,pericranium:false}, outerView, ['Vault skin'], 'Schematic reversal')
        ];
    }
    function operativeSide() { return contextSide === 'left' ? 'left' : 'right'; }
    function sideSign() { return operativeSide() === 'left' ? -1 : 1; }
    function canonicalPoint(p) { return [p[0] * sideSign(), p[1], p[2]]; }
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
    // POSE_PIVOT estimates the craniocervical junction from the atlas: the mean of the Occipital bone vertices within
    // 0.35 units (7 mm) of its lowest point (the occipital condyles beside the foramen magnum) is (0, -4.01, -1.30).
    // Neck and body are not modeled; the pivot only decides how the head swings relative to the table and the room.
    const POSE_PIVOT = [0, -4.0, -1.3];
    // Approximate cranial vault center from the atlas skull bounds. Procedure views may focus
    // on a local target, while free orbit turns around the head as a whole.
    // Illustrative lateral operative pose for anterior and middle approaches.
    const POSE_DEFAULT = { rotation: 90, extension: -45, lateral: 0 }, POSE_KEYS = ['rotation', 'extension', 'lateral'];
    // poseSettings: the user-adjustable operative pose. poseOverride: null (follow the step), 'anatomical' or
    // 'operative' (Position toggle; cleared on every step change). poseShown/poseR: the pose drawn this frame.
    let poseSettings = { ...POSE_DEFAULT }, poseOverride = null, poseShown = { rotation: 0, extension: 0, lateral: 0 }, poseR = [1, 0, 0, 0, 1, 0, 0, 0, 1], poseBlend = null, poseClock = 0, propsOn = true, viewCache = null;
    // 0 = anatomical (neutral supine) ... 1 = operative pose, as the current step requests it. A step requests the
    // operative pose through its state ('position' is a state change like 'bone' or 'dura'): steps before 'position'
    // are anatomical, 'position' animates with the stage progress (opening slider, Before/After), later steps keep it.
    function poseFraction() { return poseOverride === 'operative' ? 1 : 0; }
    function requestedPose() { const f = poseFraction(); return Object.fromEntries(POSE_KEYS.map(k => [k, poseSettings[k] * f])); }
    function poseMatrix(p) { const s = sideSign(), r = Math.PI / 180; return qMat(qMul(qAxis([1, 0, 0], -p.extension * r), qMul(qAxis([0, 0, 1], -s * p.lateral * r), qAxis([0, 1, 0], -s * p.rotation * r)))); }
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
    let roomCameraAuto = false, cameraExplicit = false;
    function stopGlide(user = true) { camGlide = null; if (user)
        roomCameraAuto = false; }
    function updateGlide() { if (!camGlide)
        return; const { from, to } = camGlide, t = Math.max(0, Math.min(1, (poseClock - camGlide.start) / camGlide.duration)), e = smoothstep01(t), mix = (a, b) => a + (b - a) * e; viewQ = qSlerp(from.q, to.q, e); distance = mix(from.distance, to.distance); viewZoom = mix(from.zoom, to.zoom); viewChanged(); if (t >= 1)
        camGlide = null;
    else
        render(); }
    // Roll about the line of sight; a positive angle turns the image counter-clockwise.
    function rollView(angle) { viewQ = qNorm(qMul(qAxis([0, 0, 1], angle), viewQ)); viewChanged(); }
    function meshSide(m) { if (m.procedureSide)
        return m.procedureSide; if (m.nativeName.endsWith('.l'))
        return 'left'; if (m.nativeName.endsWith('.r'))
        return 'right'; return 'both'; }
    function onOperativeSide(m) { const side = meshSide(m); return side === 'both' || side === operativeSide(); }
    function baseId(m) { return m.baseId || m.id; }
    // contextOnly meshes count as relevant only for groups a step lists in contextGroups (the 'position' step shows the
    // whole skull, face included, so the head's orientation in the room is legible).
    function relevantMesh(m) { const s = steps[stage]; if (m.contextOnly)
        return !!s?.contextGroups?.includes(m.group) && !m.nativeName.startsWith('Hyoid'); if (m.group === 'bone' && s?.isolateBone && !s.isolateBone.includes(m.nativeName))
        return false; // The isolated skull-base view omits cortex (and the arachnoid on it), as the About panel states.
    if (s?.isolateBone && ['brain', 'arachnoid'].includes(m.group))
        return false; return true; }
    // A step's recommended camera, mirrored for a left-sided procedure (yaw and roll change sign; eye/up x flip).
    function stepView(s) { const sign = sideSign(), v = s.view, mx = p => p && [p[0] * sign, p[1], p[2]]; return { ...v, frame: v.frame || 'head', yaw: v.yaw * sign, roll: (v.roll || 0) * sign, eye: mx(v.eye), up: mx(v.up) }; }
    function setProcedureSide(side) { if (!['right', 'left', 'both'].includes(side))
        return; contextSide = side; clearSelection(); syncControls(); updateChangeControls(); if (mode === '2d')
        showSourceFigures();
    else
        render(); }
    function setPalette(next) { if (!palettes[next])
        return; palette = next; try {
        localStorage.setItem('transfalcine-palette', next);
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
    function chooseIndication(region, side = contextSide) {
        choose({region});
        setProcedureSide(side);
        setTab('steps');
        activate(0);
        setMode('3d');
        applyRecommendedView();
    }
    function titleCase(value) { return String(value).replace(/\b([a-z][a-z0-9]*)\b/gi, (word, _, offset) => { const low = word.toLowerCase(); if (/^(ii|iii|iv|vi|vii|viii|ix|xi|xii|ica|mca|aca|sta|csf|m1|m2)$/.test(low))
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
    function modelIndex() { return configs.findIndex(c => JSON.stringify(c) === JSON.stringify(config)); }
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
    function setMode(next) { animationToken++; mode = next; $('#mode3d').setAttribute('aria-pressed', mode === '3d'); $('#mode2d').setAttribute('aria-pressed', mode === '2d'); for (const s of ['#canvas', '#viewinfo', '.floating', '#gesturehint', '.viewtools', '#mobileModelDock', '#stepLabels', '#labelLines', '#orientGizmo'])
        $(s).toggleAttribute('hidden', mode !== '3d'); $('#figurepanel').hidden = mode === '3d'; $('#popup').hidden = true; if (mode === '2d') {
        $('#labelLines').replaceChildren();
        $('#stepLabels').replaceChildren();
        showSourceFigures();
    }
    else {
        playStepAnimation();
        render();
    } updateChangeControls(); }
    $('#mode3d').onclick = () => { stopGlide(); pan = [0, 0]; setMode('3d'); };
    $('#mode2d').onclick = () => setMode('2d');
    $('#creditsOpen').onclick = () => $('#credits').showModal();
    $('#creditsClose').onclick = () => $('#credits').close();
    const publicSummaries = {};
    const relevant = () => true;
    function hasStageChange() { return !!steps[stage]?.change; }
    function updateChangeControls() { const s = steps[stage]; if (!s)
        return; $('#regionalContext').hidden = false; $('#regionalContext').textContent = 'Full Head Context'; const keys = Object.keys(enabled).filter(k => enabled[k]), expanded = keys.length > 0 && keys.every(k => allEnabled[k]), partial = Object.values(allEnabled).some(Boolean); regionalContext = !expanded; $('#regionalContext').setAttribute('aria-pressed', expanded ? 'true' : partial ? 'mixed' : 'false'); $('#viewlabel').textContent = 'Focused Corridor'; $('#viewlabel').hidden = !(s.isolateBone && !allEnabled.bone); $('#sideCaption').textContent = contextSide === 'both' ? 'Both Sides · Right Entry' : (operativeSide() === 'left' ? 'Left' : 'Right') + ' Entry · Opposite Target'; $('#focusChange').hidden = mode !== '3d'; $('#compareChange').hidden = mode !== '3d' || !hasStageChange(); const tools = meshes.filter(m => m.instrument && visible(m)); $('#visualnote').textContent = (tools.length ? 'Cyan: instrument · ' : '') + 'Colored markings are schematic · ' + (operativeSide() === 'left' ? 'Left' : 'Right') + ' procedure'; $('#surgeonView').hidden = mode !== '3d'; }
    function changeKind() { return 0; }
    const indicationGroups = cases;
    function renderIndications() {
        const panel = $('#indications');
        panel.innerHTML = `<article class="paper-card"><h2>When to Consider the Corridor</h2>
        <p>Targets presenting at or near the mesial surface can benefit from a medial-to-lateral line of sight across the falx. Bridging veins and the superior sagittal sinus bound working access.</p>
        <p>The cadaveric values below describe visual exposure in ten specimens. Lesion consistency, edema, gravity and venous anatomy affect the available clinical corridor.</p></article>
        <article class="paper-card"><h2>Cadaveric Exposure (mm)</h2><p>Means with observed ranges. The superior value is measured below the cortical surface. The other two values are measured lateral to the midline.</p>
        ${Object.keys(measures).map(key => `<p><strong>${regionName(key)} Third</strong><br>Superior: ${measures[key][0]}<br>Mid-fissure lateral: ${measures[key][1]}<br>Callosal level lateral: ${measures[key][2]}</p>`).join('')}</article>`;
        for (const [title, body, region, side, figure] of cases) {
            const card = document.createElement('article');
            card.className = 'paper-card';
            card.innerHTML = `<div class="meta">${figure} · Illustrative Case</div><h2>${title}</h2><p>${body}</p><div class="paper-actions"><button type="button">Show Approach</button></div>`;
            card.querySelector('button').onclick = () => chooseIndication(region, side);
            panel.append(card);
        }
    }
    function renderPapers() { const q = $('#paperSearch').value.toLowerCase(); $('#papers').replaceChildren(); let count = 0; for (const p of papers) {
        if (q && !(JSON.stringify(p) + ' ' + (publicSummaries[p.id] || '')).toLowerCase().includes(q))
            continue;
        count++;
        const card = document.createElement('article');
        card.className = 'paper-card';
        card.id = 'paper-' + p.id;
        card.innerHTML = `<div class="meta">${escape(p.citation)}</div><h2>${escape(p.title)}</h2><div class="meta">${escape(p.kind)} ${relevant(p) ? '<span class="match">Current selection</span>' : ''}</div><p>${escape(publicSummaries[p.id] || p.summary)}</p><div class="paper-actions"><a href="${escape(p.url)}" target="_blank" rel="noopener">Read source ↗</a><button data-paper-model="${p.id}">◇ Related anatomy</button>${p.doi ? `<a href="https://doi.org/${p.doi}" target="_blank" rel="noopener">DOI ↗</a>` : ''}</div>`;
        card.querySelector('button').onclick = () => {
            setTab('steps');
            setMode('3d');
            activate(steps.findIndex(step => step.id === 'limits'));
            applyRecommendedView();
        };
        $('#papers').append(card);
    } $('#paperEmpty').hidden = count > 0; $('#paperCount').textContent = papers.length; }
    $('#paperSearch').oninput = renderPapers;
    const studyGuide = {
  "overviewCitations": [
    "alexander"
  ],
  "steps": {
    "orient": {
      "citations": [
        "alexander"
      ],
      "detail": "A contralateral transfalcine approach reaches the medial surface of one cerebral hemisphere from the opposite side. The interhemispheric fissure is the cleft between the hemispheres, and the falx is the vertical fold of dura within it. A window in that fold provides a view across the midline. Compare the anterior, middle and posterior corridors to see how the entry aligns with a different part of the corpus callosum.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Surface landmarks and the position of the bone window.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1A–B"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2A–B"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3A–B"
            }
          },
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "position": {
      "citations": [
        "alexander"
      ],
      "detail": "The specimens were positioned with the target side uppermost so gravity could help the approach hemisphere fall away from the falx. The anterior and middle exposures used a lateral setup with the vertex elevated. The posterior exposure used a three-quarter prone position. The purpose of these positions is to improve the natural space between the medial cortex and the falx.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Head position in the corresponding cadaveric setup.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1A"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2A"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3A"
            }
          },
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "incision": {
      "citations": [
        "alexander"
      ],
      "detail": "The anterior dissection used a broad bicoronal incision behind the hairline to expose the frontal vault. The other two corridors used a linear incision over a smaller target region. Relate the black mark to the sagittal suture and the intended bone opening beneath it. The mark travels with the scalp surface as the soft tissues are reflected.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Skin marking and incision course.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1A"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2A"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3A"
            }
          },
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "reflect": {
      "citations": [
        "alexander"
      ],
      "detail": "The scalp and galea lift over the calvarium, the bony vault of the skull. The pericranium lies deeper against the outer table and is cleared from the planned bone opening. The sagittal suture marks where the two parietal bones meet. Comparing it with the transverse sutures helps localize the intended corridor.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Compare the initial surface exposure with the exposed bone.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1A–B"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2A–B"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3A–B"
            }
          },
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "burr": {
      "citations": [
        "alexander"
      ],
      "detail": "The central burr hole is positioned in relation to the superior sagittal sinus, a large venous channel beneath the midline. The paired holes on either side frame the edges of the rectangular opening. Their arrangement allows a view of the entry-side dura and the sinus region after the bone flap lifts. Follow the relationship between the visible sutures and the venous channel beneath them.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Burr holes and parasagittal craniotomy.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1B"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2B"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3B"
            }
          },
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "separate": {
      "citations": [
        "alexander"
      ],
      "detail": "The inner table is the compact inner layer of the skull. The underlying dura can adhere to it, especially near the midline and the superior sagittal sinus. Releasing this interface lets the bone flap lift while the dura remains below. The illustrated plane is extradural, between the bone and the outer dural surface.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Transition from bone work to dural exposure.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1B–C"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2B–C"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3B–C"
            }
          },
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "elevate": {
      "citations": [
        "alexander"
      ],
      "detail": "The raised bone flap exposes dura on the entry side and across a narrow strip of the opposite side. The superior sagittal sinus runs in the attached edge of the falx under the sagittal suture. Exposing its width helps establish where the dural opening and interhemispheric corridor will sit. Compare the bone window with the midline and the selected third.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Dural exposure following elevation of the bone flap.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1C"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2C"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3C"
            }
          },
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "dura": {
      "citations": [
        "alexander"
      ],
      "detail": "The dural flap is based medially near the superior sagittal sinus. Reflecting it exposes the entry-side medial brain surface while keeping the venous channel in view. Branches draining the brain can enter the sinus near this edge. The dural opening is the surface entrance to the deeper space between the hemispheres.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Sinus-based dural opening and reflection.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1D"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2D"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3D"
            }
          },
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "interhemispheric": {
      "citations": [
        "alexander"
      ],
      "detail": "The arachnoid spans the interhemispheric fissure, and bridging veins travel from the cortical surface to the superior sagittal sinus. The corridor follows the medial hemisphere toward the genu, body or splenium of the corpus callosum, depending on its level. These are the front bend, central portion and thick posterior end of the fiber bundle joining the hemispheres. Identify the veins that can limit the working angle.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Interhemispheric exposure near the corpus callosum.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1E"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2E"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3E"
            }
          },
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "falx": {
      "citations": [
        "alexander"
      ],
      "detail": "The falx is a sagittal sheet of dura separating the hemispheres. The study’s window accesses the opposite side through this sheet while remaining below the superior sagittal sinus. The straight sinus, where the falx meets the tentorium posteriorly, is an additional posterior landmark. Compare the location of the window with both the venous boundaries and the original bone opening.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Falcine opening and the revealed contralateral hemisphere.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1F"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2F"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3F"
            }
          },
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "limits": {
      "citations": [
        "alexander"
      ],
      "detail": "The study measured how far upward and laterally the opposite hemisphere could be seen through the falcine opening. The upper reach was farther below the cortical surface in more posterior exposures. The lateral field also varied with depth within the fissure. These measurements describe the cadaveric specimens and help explain why an opening at one level gives a different view from an opening at another.",
      "figures": [
        {
          "paper": "alexander",
          "label": "Figure 4",
          "takeaway": "Comparison of the superior and lateral exposure limits in all three thirds.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "image": "../assets/source-figures/transfalcine/figure-4.jpg",
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "release": {
      "citations": [
        "alexander"
      ],
      "detail": "The model lets the medial hemisphere return toward the falx after the working corridor is released. Bridging veins connect the moving brain surface with fixed dural venous channels, so their position can change as the space closes. Follow their path back toward the superior sagittal sinus. This step illustrates the return from the working position.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Interhemispheric exposure near the corpus callosum.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1E"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2E"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3E"
            }
          },
          "related": true,
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "dura-close": {
      "citations": [
        "alexander"
      ],
      "detail": "The dural leaflet returns toward the margins of its earlier opening. Its base stays adjacent to the superior sagittal sinus, the landmark that oriented the opening from the start. Watch which surface is covered as the leaflet returns. The related paper figure shows the open stage that the model reverses here.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Sinus-based dural opening and reflection.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1D"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2D"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3D"
            }
          },
          "related": true,
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "bone-replace": {
      "citations": [
        "alexander"
      ],
      "detail": "The rectangular calvarial flap returns to its original position after the dura has been reapproximated. Its edges line up with the surrounding skull, and the original relationship to the sagittal suture becomes visible again. This step illustrates how the bony covering is restored. The related paper figure shows the original exposure.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Dural exposure following elevation of the bone flap.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1C"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2C"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3C"
            }
          },
          "related": true,
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    },
    "close": {
      "citations": [
        "alexander"
      ],
      "detail": "The pericranium, galea and skin return above the replaced bone. The pericranium coats the skull, the galea forms the strong fibrous layer of the scalp, and the skin lies outermost. The black line helps trace the original planned opening after these layers come together. The model illustrates closure by reversing the earlier exposure.",
      "figures": [
        {
          "paper": "alexander",
          "takeaway": "Skin marking and incision course.",
          "url": "https://doi.org/10.1227/ons.0000000000002057",
          "byRegion": {
            "anterior": {
              "image": "../assets/source-figures/transfalcine/figure-1.jpg",
              "label": "Figure 1A"
            },
            "middle": {
              "image": "../assets/source-figures/transfalcine/figure-2.jpg",
              "label": "Figure 2A"
            },
            "posterior": {
              "image": "../assets/source-figures/transfalcine/figure-3.jpg",
              "label": "Figure 3A"
            }
          },
          "related": true,
          "credit": "Alexander AY, Graepel S, Peris-Celda M, Lanzino G. Operative Neurosurgery. 2026. doi:10.1227/ons.0000000000002057. © Congress of Neurological Surgeons."
        }
      ]
    }
  }
};
    const paperById = id => papers.find(paper => paper.id === id);
    const sourceLink = (url, text) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(text)}</a>`;

    function studyEntry(step) {
        const key = step.phase || step.id;
        const variation = key === 'muscle' ? config.muscle : key === 'clinoid' ? config.clinoid : null;
        return studyGuide.steps[key + ':' + variation] || studyGuide.steps[key];
    }
    function studyCitations(ids) {
        return [...new Set(ids)].map(paperById).filter(Boolean);
    }

    function stepCitations(ids) {
        const sources = studyCitations(ids);
        return sources.length ? `<ul class="study-citations">${sources.map(paper =>
            `<li>${sourceLink(paper.url, paper.citation || paper.title)}</li>`).join('')}</ul>` : '';
    }

    function studyNotes(step, index) {
        const entry = studyEntry(step);
        if (!entry) return '';
        const reading = index === 0 ? studyGuide.reading : null;
        const citations = studyCitations(index === 0
            ? [...entry.citations, ...studyGuide.overviewCitations] : entry.citations);
        const links = citations.map((paper, i) =>
            `<a href="${escape(paper.url)}" title="${escape(paper.citation || paper.title)}" aria-label="${escape(paper.citation || paper.title)}" target="_blank" rel="noopener noreferrer">[${i + 1}]</a>`);
        if (reading) links.push(sourceLink(reading.url, 'Atlas'));
        return `<details class="study-notes"><summary>Details</summary>
            <p>${escape(entry.detail)}${links.length ? ` <span class="study-reference-links">${links.join(' ')}</span>` : ''}</p>
            ${citations.length || reading ? `<h4>Sources for this step</h4><ul class="study-citations">${citations.map(paper => `<li>${sourceLink(paper.url, paper.citation || paper.title)}</li>`).join('')}${reading ? `<li>${sourceLink(reading.url, reading.label || 'Atlas')}</li>` : ''}</ul>` : ''}</details>`;
    }

    function stepFigures(step) {
        return (studyEntry(step)?.figures || []).map(figure =>
            figure.byRegion ? { ...figure, ...figure.byRegion[config.region] } : figure);
    }

    function showSourceFigures() {
        const panel = $('#figurepanel');
        const step = steps[stage];
        const figures = stepFigures(step);
        const images = figures.map(figure => {
            const paper = paperById(figure.paper);
            const url = figure.url || paper?.url;
            const credit = figure.credit || paper?.citation || paper?.title || '';
            const label = figure.related ? 'Related figure · ' + figure.label : figure.label;
            const license = figure.licenseUrl
                ? ' · ' + sourceLink(figure.licenseUrl, figure.license)
                : '';
            return `<figure class="source-figure">
                <a class="source-figure-image" href="${escape(figure.image)}" target="_blank" rel="noopener noreferrer">
                    <img src="${escape(figure.image)}" alt="${escape(figure.takeaway)}" loading="lazy">
                </a>
                <figcaption><strong>${escape(label)}</strong><p>${escape(figure.takeaway)}</p>
                    <p class="figure-credit">${escape(credit)}${license}</p>${url ? sourceLink(url, 'Open published source') : ''}
                </figcaption>
            </figure>`;
        }).join('');
        panel.innerHTML = `<section class="diagram source-figure-panel">
            <h2>${escape(titleCase(step.title))}</h2>
            ${images || `<p>See the cited sources for this step.</p>${stepCitations(step.sources || [])}`}
        </section>`;
        for (const image of panel.querySelectorAll('.source-figure-image img')) {
            image.addEventListener('error', () => {
                const message = document.createElement('p');
                message.textContent = 'The bundled figure could not load. Open the published source below.';
                image.closest('a').replaceWith(message);
            }, { once: true });
        }
    }
    function rebuild({ reset = false } = {}) { animationToken++; const old = steps[stage]?.id; steps = buildSteps(); $('#steps').replaceChildren(); steps.forEach((s, i) => { const card = document.createElement('article'); card.className = 'step'; card.tabIndex = 0; card.innerHTML = `<div class="step-heading"><span class="step-number">${String(i + 1).padStart(2, '0')}</span><div class="step-heading-text"><h2>${escape(titleCase(s.title))}</h2></div></div><p>${escape(s.body)}</p>${studyNotes(s, i)}`; card.onclick = event => { if (!event.target.closest('details, a, button')) activate(i); }; card.onkeydown = e => { if (e.target === card && ['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        activate(i);
    } }; $('#steps').append(card); });  renderPapers(); renderIndications(); activate(reset ? 0 : Math.max(0, steps.findIndex(s => s.id === old))); $('#planLive').textContent = steps.length + ' guide steps. Configuration updated.'; }
    function choose(c) {
        if (!regions[c.region]) return;
        roomCameraAuto = false;
        config = {...c};
        poseSettings = corridorPose();
        const selector = $(`input[name="region"][value="${c.region}"]`);
        if (selector) selector.checked = true;
        rebuild();
        applyRecommendedView();
    }
    // Static snapshot of the guide steps for all 12 configurations, as stored in data/manifest.json `variants`
    // (regenerate with JSON.stringify(guideQA.variantSnapshot()) in the browser console; the build keeps the field).
    const VARIANT_KEYS = ['id', 'title', 'body', 'note', 'sources', 'groups', 'labels', 'state', 'beforeState', 'change', 'changes', 'stagger', 'visualAction', 'markings', 'isolateBone', 'contextGroups', 'contextLayers', 'view', 'evidence', 'figure', 'page'];
    function variantSnapshot() { const keep = { ...config }, at = stage, out = configs.map((c, i) => { choose(c); return { number: i + 1, config: { ...c }, steps: steps.map(s => Object.fromEntries(VARIANT_KEYS.map(k => [k, s[k] ?? null]))), evidence_conflict: false }; }); choose(keep); activate(at); return out; }
    $$('.config input').forEach(i => i.onchange = e => { if (e.target.checked) choose({region:e.target.value}); });
    function syncControls() { $$('[data-layer]').forEach(e => e.checked = enabled[e.dataset.layer]); $$('[data-swatch]').forEach(e => e.style.background = palettes[palette][e.dataset.swatch]); if ($('#palette'))
        $('#palette').value = palette; $$('[data-all-layer]').forEach(e => e.checked = allEnabled[e.dataset.allLayer]); $('#side').value = contextSide; $('#procedure').checked = procedure; $('#prelabels').checked = prelabelsOn; $('#instruments').checked = instrumentsOn; }
    const persistentLayers = new Set(['brain', 'arteries', 'veins', 'arachnoid']);
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
    function activate(i) { animationToken++; stopGlide(false); beforeCurrent = false; $('#compareChange').setAttribute('aria-pressed', false); $('#compareChange').textContent = 'Before'; stage = Math.max(0, Math.min(steps.length - 1, i)); opening = 1; $$('.step').forEach((c, j) => { c.classList.toggle('active', j === stage); c.setAttribute('aria-current', j === stage ? 'step' : 'false'); }); $('#stagecaption').textContent = String(stage + 1).padStart(2, '0') + ' · ' + titleCase(steps[stage].title); $('#stagecount').textContent = String(stage + 1).padStart(2, '0') + ' / ' + steps.length; $('#previous').disabled = stage === 0; $('#next').disabled = stage === steps.length - 1; // Entering the 'position' step glides the camera to the step's room-fixed view while the head turns into the
    // operative pose (the camera is pinned to the room, so the head moves rather than the room around it). Leaving it
    // with that framing untouched glides on to the new step's recommended (head-framed) view, so the walkthrough
    // returns to the anatomy, which then looks as it did before positioning existed.
    const changed = activeStepId !== steps[stage].id;
    if (changed && steps[stage].change === 'position' && $('#positionControls')) $('#positionControls').open = true;
    if (changed && !cameraExplicit && steps[stage].change === 'position') {
        glideCamera(stepView(steps[stage]), 1100);
        roomCameraAuto = true;
    }
    else if (changed && !cameraExplicit && (roomCameraAuto || activeStepId === 'position' && camFrame === 'world')) {
        glideCamera(stepView(steps[stage]), 900);
        roomCameraAuto = false;
    }
    activeStepId = steps[stage].id; applyRecommendedView({ preserveCamera: true }); updateChangeControls(); updateMobileReaderHeight(); alignActiveStep(); if (mode === '2d')
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
    function hiddenByClearance() {
        const hidden = new Set();
        if (separateLayers)
            return hidden;
        const stepId = procedure ? steps[stage]?.id : 'rest';
        const variant = Object.keys(config).sort()
            .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(config[key])).join('&');
        const pairs = displayConflicts[[variant, operativeSide(), stepId].join('|')] || [];
        for (const [keep, hide] of pairs) {
            if (!hidden.has(keep) && baseVisible(clearanceMeshById.get(keep), true) &&
                baseVisible(clearanceMeshById.get(hide), true))
                hidden.add(hide);
        }
        return hidden;
    }
    function visible(m) {
        return baseVisible(m) && !hiddenByClearance().has(m.id);
    }
    function baseVisible(m, wholeStep = false) {
        if (!m || m.hidden || m.region && (m.region !== config.region || m.entrySide !== operativeSide())) return false;
        const step = steps[stage];
        if (m.marker)
            return procedure && (step.id === 'orient' || !m.id.endsWith('-incision')) && m.markerStages.includes(step.id) && (wholeStep || (!beforeCurrent || m.markerAt == null) && opening >= (m.markerAt ?? 0) && opening <= (m.markerUntil ?? 1));
        if (m.instrument)
            return procedure && instrumentsOn && m.instrumentStage === step.id &&
                (wholeStep || !beforeCurrent && opening >= (m.fromProgress ?? 0) && opening <= (m.to ?? 1));
        if (!enabled[m.group] && !allEnabled[m.group]) return false;
        if (m.externalSurface && separateLayers) return false;
        if (m.part === 'vaultOriginal') return !procedure || stateProgress('bone') === 0;
        if (m.part === 'rim' || m.part === 'boneFlap') {
            const progress = stateProgress('bone');
            if (!procedure || progress === 0 || m.part === 'boneFlap' && progress >= 1) return false;
        }
        if (m.part === 'falxLeaf' && stateProgress('falx') >= .999) return false;
        if (m.part === 'corridorVeil' && procedure && stateProgress('arachnoid') >= .999) return false;
        return true;
    }
    function opacity(m) { return Math.max(0, Math.min(1, m.opacity ?? 1)); }
    function surgicalState() { return {cut:0,motion:0,action:1,windowAction:1,burrAction:0}; }
    // Model point -> view space (JS mirror of the vertex shader: p = uView * (q - uTarget)).
    function transform(p) { const { M, target: t } = viewBasis(); return mApply(M, [p[0] - t[0], p[1] - t[1], p[2] - t[2]]); }
    // Match the shader projection, including PR #1 view-space pan.
    function project(p) { const t = transform(p), w = distance - t[2]; return [(t[0] + pan[0]) * scale * viewZoom / aspect / w * host.clientWidth / 2 + host.clientWidth / 2, host.clientHeight / 2 - (t[1] + pan[1]) * scale * viewZoom / w * host.clientHeight / 2]; }
    const smoothstep01 = t => t * t * (3 - 2 * t);
    // Both the shader and label projection use the same sampled hinge height to curl flaps.
    const SHELL_C = [0, -.4, -.4], CURL_NA = 16, CURL_ND = 24, INC_N = 24;
    // Preserved for guideQA consumers. computeDeformation sets the study-specific fold values.
    const CURL_TUNING = { scalp: { R: .32, thetaS: .8 * Math.PI, P1: .8 }, pericranium: { R: .32, thetaS: .6 * Math.PI, P1: .75 }, fascia: { R: .32, thetaS: .6 * Math.PI, P1: .75 }, temporalis: { R: .3, thetaS: .75 * Math.PI, P1: .8, Tf: .95 * Math.PI }, dura: { R: .12, thetaS: .7 * Math.PI, P1: .85, Tf: .9 * Math.PI } };
    // Reference ellipse parameters for legacy dural markers.
    const DURA_OPENINGS = { wide: { kind: 1, c: [.3, 1.25], r: [1.08, 1.08], base: [-.8, .6], chord: .8 }, low: { kind: 2, c: [-.62, 1.65], r: [.38, .55], base: [-.6, .8], chord: .72 } };
    const DURA_CUT = .3; // share of the dural step spent cutting along the C before the leaf folds
    const clamp01 = x => Math.max(0, Math.min(1, x));
    function sideOf(m) { return meshSide(m) === 'left' ? 'left' : 'right'; }
    function meshesWhere(side, pred) { return meshes.filter(x => !x.marker && !x.instrument && sideOf(x) === side && meshSide(x) !== 'both' && pred(x)); }
    function gatherPoints(mesh) {
        ensureGeometry(mesh);
        const positions = [];
        const vertices = mesh.vertexData;
        for (let i = 0; i < vertices.length; i += 6)
            positions.push(vertices[i], vertices[i + 1], vertices[i + 2]);
        return positions;
    }
    // Sample the highest tissue points over the hinge travel and across its axis.
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
    function maxAway(fr, pts, floor = 0) { let d = floor; for (let i = 0; i < pts.length; i += 3) d = Math.max(d, (pts[i] - fr.pivot[0]) * fr.away[0] + (pts[i + 1] - fr.pivot[1]) * fr.away[1] + (pts[i + 2] - fr.pivot[2]) * fr.away[2]); return d; }
    // Incision polyline of a side (from the scalp flap's incisionLine, resampled to INC_N points by arc length) and
    // the sign that turns the polyline's perpendicular (tangent x shell radial) toward the flap.
    const incisionCache = {};
    function incisionFor(side) { if (side in incisionCache)
        return incisionCache[side]; const flap = meshesWhere(side, x => x.group === 'skin' && x.flap && x.incisionLine?.length > 1)[0]; if (!flap)
        return incisionCache[side] = null; const L = flap.incisionLine, acc = [0]; for (let i = 1; i < L.length; i++)
        acc.push(acc[i - 1] + Math.hypot(...vSub(L[i], L[i - 1]))); const pts = []; for (let k = 0, i = 1; k < INC_N; k++) {
        const s = acc[acc.length - 1] * k / (INC_N - 1);
        while (i < L.length - 1 && acc[i] < s) i++;
        const f = clamp01((s - acc[i - 1]) / ((acc[i] - acc[i - 1]) || 1));
        pts.push(L[i - 1].map((x, j) => x + (L[i][j] - x) * f));
    } const inc = { pts, flat: new Float32Array(pts.flat()), sign: 1 }; ensureGeometry(flap); const f = flap.vertexData, sides = []; for (let i = 0; i < f.length && sides.length < 4000; i += 6 * 7) {
        const c = incisionCoords(inc, [f[i], f[i + 1], f[i + 2]]);
        if (c.dist < .3) sides.push(c.side);
    } sides.sort((a, b) => a - b); inc.sign = sides.length && sides[sides.length >> 1] < 0 ? -1 : 1; return incisionCache[side] = inc; }
    // Nearest incision segment measured in the plane tangent to the shell: signed offset (along tangent x radial),
    // arc parameter (0 at the zygomatic end E0, 1 at the midline end E1) and distance. Mirrors the vertex shader.
    function incisionCoords(inc, p) { const rad = vNorm(vSub(p, SHELL_C)); let best = Infinity, bt = 0, tan = [0, 1, 0], be = [0, 0, 0]; for (let i = 0; i < INC_N - 1; i++) {
        const a = inc.pts[i], ab = vSub(inc.pts[i + 1], a), t = clamp01(vDot(vSub(p, a), ab) / Math.max(vDot(ab, ab), 1e-8));
        let e = vSub(p, vAdd(a, vScale(ab, t)));
        e = vSub(e, vScale(rad, vDot(e, rad)));
        const d = Math.hypot(e[0], e[1], e[2]);
        if (d < best) { best = d; bt = (i + t) / (INC_N - 1); tan = ab; be = e; }
    } const perp = vNorm(vCross(vNorm(tan), rad)); return { side: vDot(be, perp), t: bt, dist: best, perp }; }
    // Hinge travel dh and fold angle T for progress P (see 1. above).
    function curlSchedule(mo, P) { const dh = mo.dmax * (1 - smoothstep01(clamp01(P / mo.P1))), T = mo.thetaS * smoothstep01(clamp01(P / .15)) + (mo.Tf - mo.thetaS) * smoothstep01(clamp01((P - mo.P1 + .05) / (1.05 - mo.P1))); return { dh, T }; }
    // Per-draw curl state: schedule plus the hinge-height row interpolated at the current hinge travel.
    function curlState(mo, P) { if (!mo || !(P > 0))
        return null; const { dh, T } = curlSchedule(mo, Math.min(1, P)); if (T <= 1e-4)
        return null; const rows = mo.prof.rows, f = Math.max(0, Math.min(CURL_ND - 1, dh / mo.prof.dmax * (CURL_ND - 1))), j0 = Math.floor(f), j1 = Math.min(j0 + 1, CURL_ND - 1), w = f - j0, row = new Float32Array(CURL_NA); for (let i = 0; i < CURL_NA; i++)
        row[i] = rows[j0 * CURL_NA + i] * (1 - w) + rows[j1 * CURL_NA + i] * w; return { mo, P, dh, T, row }; }
    // Mirror the vertex shader's curl for projected labels and picking.
    function curlPoint(cs, p) {
        const { mo, dh, T, row } = cs;
        const v = vSub(p, mo.pivot), d = vDot(v, mo.away), dd = d - dh;
        if (dd <= 0) return p;
        const fi = Math.max(0, Math.min(CURL_NA - 1, (vDot(v, mo.axis) - mo.prof.a0) * mo.prof.ia));
        const i0 = Math.floor(fi), i1 = Math.min(i0 + 1, CURL_NA - 1);
        const hp = row[i0] + (row[i1] - row[i0]) * (fi - i0), hh = vDot(v, mo.lift);
        const R = mo.R, s = Math.min(dd, R * T), ph = s / R, c = Math.cos(ph), sn = Math.sin(ph);
        const aw = vAdd(vScale(mo.away, c), vScale(mo.lift, sn));
        const li = vSub(vScale(mo.lift, c), vScale(mo.away, sn));
        const rest = vSub(v, vAdd(vScale(mo.away, d), vScale(mo.lift, hh)));
        return [mo.pivot, vScale(mo.away, dh + R * sn), vScale(mo.lift, hp + R * (1 - c)),
            rest, vScale(aw, dd - s), vScale(li, hh - hp)].reduce(vAdd);
    }
    // Marking reveal (uMarkReveal). Markings draw in with the stage progress: kinds 1/2 sweep by angle about
    // markerCenter or along markerAxis. The incision and closure stitches use kind 3 instead, the arc parameter along
    // the scalp incision (the same parameter as the incision parting, E0 at the zygomatic arch to E1 at the midline),
    // so the incision line draws in exactly behind the knife. While a returning scalp flap is still travelling (galea
    // closure) these skin markings wait until it is home. The dural opening line draws in with the C-shaped dural cut
    // (groove) and stays on the rim, as the closure line, while the dura is closed. Galeal stitches (on the galea, galea
    // closure) draw in as the galea closes; skin stitches and the skin incision line belong to the skin closure.
    const INCISION_MARKS = new Set(['MARK-incision', 'MARK-scalp-sutures', 'MARK-galea-sutures']);
    function incisionMarker(m) { return INCISION_MARKS.has(baseId(m).replace(/-l$/, '')) ? incisionFor(sideOf(m)) : null; }
    function duraMarkReveal(m, gr) { if (!(gr > 0))
        return 0; const o = DURA_OPENINGS[/^MARK-dural-low/.test(baseId(m)) ? 'low' : 'wide'], a0 = Math.atan2(o.base[1], o.base[0]) + Math.acos(o.chord), th = a0 + gr * (2 * Math.PI - 2 * Math.acos(o.chord)), c = m.markerCenter || [0, o.c[0], o.c[1]], y = o.c[0] + o.r[0] * Math.cos(th), z = o.c[1] + o.r[1] * Math.sin(th); let t = (Math.atan2(z - c[2], y - c[1]) + Math.PI) / (2 * Math.PI); if (th < 1.5 * Math.PI && t > .5)
        t = 0; return t; }
    function markReveal(m) { if (beforeCurrent)
        return 0; const s = steps[stage], id = baseId(m).replace(/-l$/, ''); if (/^MARK-dural-(cut|low)$/.test(id) && s.changes.includes('dura'))
        return duraMarkReveal(m, s.state.dura ? clamp01(stateProgress('dura') / DURA_CUT) : 1); if (id === 'MARK-galea-sutures' && s.changes.includes('galea') && !s.state.galea)
        return (1 - stateProgress('galea')) * 1.05; // buried galeal stitches draw in along the cut as the galea closes
    if (incisionMarker(m)) {
        if (s.changes.includes('skin') && s.state.skin)
            return stateProgress('skin') * 1.05; // knife tip (partPoint opens where 1.05 * progress exceeds t)
        if (s.changes.includes('scalp') && !s.state.scalp) {
            const home = s.stagger?.scalp?.[1] ?? 1;
            return home < 1 ? clamp01((opening - home) / (1 - home)) * 1.05 : opening >= 1 ? 1.05 : 0;
        }
        return opening * 1.05;
    } return opening; }
    // Progress (0..1) of a state flag in the current step: 1/0 when static, animated by the stage progress (opening)
    // when the step changes it, optionally within a sub-range of the step (step.stagger[id] = [from, to]).
    function stateProgress(id) { const s = steps[stage]; if (!s)
        return 0; if (beforeCurrent || !s.changes.includes(id))
        return (beforeCurrent ? s.beforeState : s.state)[id] ? 1 : 0; const r = s.stagger?.[id] || [0, 1], t = clamp01((opening - r[0]) / (r[1] - r[0])); return s.state[id] ? t : 1 - t; }
    // Cache flap curl geometry per step and animation frame.
    let deformKey = '', deformCache = new Map();
    function deformation(m) { const key = [stage, opening, beforeCurrent, procedure, contextSide, steps.length, separateLayers].join('|'); if (key !== deformKey) {
        deformKey = key;
        deformCache = new Map();
    } if (!deformCache.has(m.index ?? m.id))
        deformCache.set(m.index ?? m.id, computeDeformation(m)); return deformCache.get(m.index ?? m.id); }
    function computeDeformation(m) {
        if (!procedure || !m.fold || separateLayers) return null;
        let progress = stateProgress(m.fold);
        // Complete the dural cut before rolling the leaf off its fitted bed.
        if (m.fold === 'dura' && steps[stage].id === 'dura')
            progress = clamp01((progress - .28) / .72);
        if (!progress) return null;
        if (!m.studyCurl) {
            const reference = m.part === 'skinFlap'
                ? clearanceMeshById.get(m.region + '-' + m.entrySide + '-skin-flap')
                : m;
            const points = gatherPoints(reference);
            const { pivot, away, lift } = reference;
            const frame = { pivot, away, lift, axis:vNorm(vCross(lift,away)) };
            const prof = curlProfile(frame, points);
            if (!prof) return null;
            const dmax = maxAway(frame, points);
            if (!(dmax > 0)) return null;
            m.studyCurl = {...frame, key:reference.fold, R:m.fold === 'dura' ? .22 : .50,
                Tf:m.fold === 'dura' ? 2.33 : 1.40, thetaS:.2, P1:.58, dmax, prof};
        }
        const curl = curlState(m.studyCurl, progress);
        return curl ? {curl} : null;
    }
    function movePoint(m, p) {
        const d = meshOffset(m);
        const curl = m.instrument ? null : deformation(m)?.curl;
        let q = curl ? curlPoint(curl, p) : p;
        const flap = m.part === 'boneFlap' ? boneFlapTravel() : null;
        if (flap) {
            const v = vSub(q, flap.pivot), c = Math.cos(flap.angle), s = Math.sin(flap.angle);
            q = vAdd(flap.pivot, [c*v[0] - s*v[1], s*v[0] + c*v[1], v[2]]);
        }
        return vAdd(shiftPoint(m,q), d);
    }
    function meshOffset(m) {
        if (separateLayers && ['skin','galea','pericranium','dura'].includes(m.group) && !m.marker)
            return [0, {skin:1.12,galea:.72,pericranium:.36,dura:0}[m.group], 0];
        if (!procedure) return [0,0,0];
        if (m.part === 'skinFlap') {
            const lift = config.region === 'posterior' ? .65 : .45;
            return [0, lift * Math.sin(Math.PI * stateProgress(m.fold) / 2), 0];
        }
        if (m.part === 'boneFlap') return boneFlapTravel()?.offset || [0,0,0];
        if (m.part === 'falxLeaf') {
            const f = stateProgress('falx');
            return [-sideSign()*f*.45,f*1.3,0];
        }
        if (m.instrument && m.travel) return vScale(m.travel, 1-smoothstep01(opening));
        return [0,0,0];
    }
    function studyShift(m) {
        const r = regions[config.region];
        if (!procedure || m.gravitySide !== operativeSide()) return [0,r.falx_z,0,0];
        return [-sideSign() * 1.02 * stateProgress('retract'),r.falx_z,r.z,m.name === 'Cortical bridging vein' ? 2 : 1];
    }
    function shiftPoint(m, p) {
        const [amount,center,entry,active] = studyShift(m);
        if (!active) return p;
        const zDistance = Math.abs(p[2]-(center+entry)/2);
        let weight = (1-smoothstep01(clamp01((Math.abs(p[0])-.3)/1.65))) *
            (1-smoothstep01(clamp01((zDistance-1.05)/1.45))) * smoothstep01(clamp01((p[1]+.48)/1.25));
        if (active === 2) weight *= smoothstep01(clamp01((Math.abs(p[0])-.04)/.61));
        return [p[0]+amount*weight,p[1]-.28*Math.abs(amount)*weight,p[2]];
    }
    const vaultLayers = ['skin','galea','pericranium','dura'];
    let vaultLayerSnapshot = null;
    $('#separateLayers').onclick = () => {
        separateLayers = !separateLayers;
        const button = $('#separateLayers');
        button.setAttribute('aria-pressed', separateLayers);
        button.textContent = separateLayers ? 'Join Vault Layers' : 'Separate Vault Layers';
        if (separateLayers) {
            vaultLayerSnapshot = Object.fromEntries(vaultLayers.map(key => [key,enabled[key]]));
            for (const key of vaultLayers) enabled[key] = true;
        } else if (vaultLayerSnapshot) {
            Object.assign(enabled,vaultLayerSnapshot);
            vaultLayerSnapshot = null;
        }
        syncControls();
        clearSelection();
        render();
    };
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
    function procedureLabelRegion(m) { return { target:m.anchor, radius:2.1, cranial:false }; }
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
        return steps[stage].labels.map(name => {
            const sided = operativeSide() === 'left' ? name.replace(/^Right /,'Left ') : name;
            return meshes.find(mesh => mesh.name === sided && visible(mesh));
        }).find(Boolean) || null;
    }
    function labelName(m) { return titleCase(m.name); }
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
        const [elevation, approach] = { anterior: [.60, .73], middle: [.65, .53], posterior: [.43, -1.26] }[config.region];
        setCamera({ frame: 'head', eye: [-.47 * sideSign(), elevation, approach], up: [0, 0, 1],
            distance: 16.5, zoom: 1 });
    }
    // ---- Patient Position controls (Layers & View panel) -------------------------------------------------------------
    // Changing the pose re-attaches the camera to the room first (same image), so the head visibly turns while the
    // table, holder and gizmo stay put. Slider input applies directly; the toggle and the defaults glide.
    function headFixed() { if (poseOverride)
        return poseOverride === 'operative'; const s = steps[stage]; return !!s && !!(beforeCurrent ? s.beforeState.position : s.state.position); }
    function poseState() { return { shown: { ...poseShown }, requested: requestedPose(), fraction: poseFraction(), settings: { ...poseSettings }, override: poseOverride, defaults: corridorPose(), pivot: [...POSE_PIVOT], matrix: [...poseR], headFixed: headFixed(), props: propsOn && propsVisible() }; }
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
    function corridorPose() { return config.region === 'posterior' ? {rotation:133,extension:8,lateral:0} : {...POSE_DEFAULT}; }
    function resetPose() { stopGlide(false); pan = [0, 0]; attachCamera('world'); startPoseBlend(); poseSettings = corridorPose(); syncPoseControls(); render(); }
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
    // ---- Schematic room cues: head holder and table edge ----------------------------------------------------------
    // Thin-tube line drawings in the style of the coloured markings: a Mayfield-type three-pin skull clamp fixed to the
    // head (single pin behind the operative-side ear, two-pin rocker on the contralateral side, C-frame behind the
    // occiput, swivel arm to the table) and the head end of the table fixed in the room. Pin sites are illustrative,
    // chosen away from the incision: points ray-cast onto the atlas calvaria (canonical right-sided procedure) with the
    // outward surface normals listed. Shown only in room-fixed views (camFrame 'world') once the head is fixed
    // (step 'position' onward or the Operative toggle), so head-framed anatomical views are unchanged.
    const HOLDER_PINS = { single: { at: [-3.32, -.77, -2.66], n: [-.95, -.09, -.3] }, pair: [{ at: [3.24, .31, 1.18], n: [.98, .05, .18] }, { at: [3.09, -.29, -3.23], n: [.89, .08, -.44] }] };
    // Room coordinates: table top 2.4 cm below the lowest occipital point in the neutral pose, head edge at the
    // shoulders about 12 cm below the craniocervical pivot, 44 cm wide; only the head edge and 10 cm of the side rails
    // are drawn. Illustrative.
    const TABLE = { topZ: -6.4, headY: -10, halfWidth: 11, footY: -15, mount: [0, -10, -7.2] };
    const PROP_COLORS = { holder: hexRgb('#7fd6e8'), table: hexRgb('#8aa4ae') };
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
    // Prop vertices in model coordinates for the displayed pose (room-fixed parts go through poseInverse).
    function propGeometry() { const sign = sideSign(), key = sign + '|' + poseR.map(x => x.toFixed(4)).join(); if (propCache?.key === key)
        return propCache; const mx = p => [p[0] * sign, p[1], p[2]], along = (pin, d) => mx(vAdd(pin.at, vScale(pin.n, d))), holder = [], table = [], single = HOLDER_PINS.single, [pa, pb] = HOLDER_PINS.pair; tubeInto(holder, [along(single, 0), along(single, .9)], .035); tubeInto(holder, [along(single, .9), along(single, 1.7)], .11, true); for (const pin of [pa, pb]) {
        tubeInto(holder, [along(pin, 0), along(pin, .7)], .035);
        tubeInto(holder, [along(pin, .7), along(pin, 1.1)], .09, true);
    } // Rocker: a bar bowed outward between the two pin barrels, with a stem from its middle.
    const ra = along(pa, 1.1), rb = along(pb, 1.1), outward = vNorm(mx(vAdd(pa.n, pb.n))), rmid = vScale(vAdd(ra, rb), .5); tubeInto(holder, Array.from({ length: 13 }, (_, i) => vAdd(vAdd(vScale(ra, 1 - i / 12), vScale(rb, i / 12)), vScale(outward, .45 * Math.sin(Math.PI * i / 12)))), .08); const stem = vAdd(rmid, vScale(outward, 1.25)); tubeInto(holder, [vAdd(rmid, vScale(outward, .45)), stem], .1, true); // C-frame: half ellipse from the single-pin barrel to the rocker stem, passing behind the occiput.
    const s0 = along(single, 1.7), half = vScale(vSub(stem, s0), .5), mid = vAdd(s0, half), back = [0, -.25, -1], w = vScale(vNorm(vSub(back, vScale(half, vDot(back, half) / vDot(half, half)))), 5.4), arc = Array.from({ length: 41 }, (_, i) => vAdd(vSub(mid, vScale(half, Math.cos(Math.PI * i / 40))), vScale(w, Math.sin(Math.PI * i / 40)))); tubeInto(holder, arc, .1); tubeInto(holder, [arc[20], poseInverse(TABLE.mount)], .09); const room = p => poseInverse(p), { topZ: z, headY: y0, halfWidth: hw, footY: y1 } = TABLE; for (const [a, b] of [[[-hw, y0, z], [hw, y0, z]], [[-hw, y0, z], [-hw, y1, z]], [[hw, y0, z], [hw, y1, z]], [[-hw, y0, z - .9], [hw, y0, z - .9]], [[-hw, y0, z], [-hw, y0, z - .9]], [[hw, y0, z], [hw, y0, z - .9]]])
        tubeInto(table, [room(a), room(b)], .07); /* top edge, side rails and the end face of the table top */ propCache = { key, data: new Float32Array([...holder, ...table]), parts: [{ first: 0, count: holder.length / 6, rgb: PROP_COLORS.holder }, { first: holder.length / 6, count: table.length / 6, rgb: PROP_COLORS.table }], uploaded: false }; return propCache; }
    function bindVertexBuffer(buf) { gl.bindBuffer(gl.ARRAY_BUFFER, buf); for (const [name, start] of [['aPosition', 0], ['aNormal', 12]])
        gl.vertexAttribPointer(gl.getAttribLocation(program, name), 3, gl.FLOAT, false, 24, start); }
    // Drawn opaque before the anatomy; in the picking pass as background (id 0) so they hide what they cover.
    function drawProps(picking) { if (!propsVisible())
        return; const geo = propGeometry(); if (!propBuffer)
        propBuffer = gl.createBuffer(); bindVertexBuffer(propBuffer); if (!geo.uploaded) {
        gl.bufferData(gl.ARRAY_BUFFER, geo.data, gl.DYNAMIC_DRAW);
        geo.uploaded = true;
    } for (const [n, v] of [['Material', -1], ['IsMarker', 1], ['Line', 0], ['MarkKind', 0], ['MarkReveal', 1], ['Cut', 0], ['Burrs', 0], ['Change', 0], ['FlapAngle', 0], ['BoneSection', 0], ['Selected', 0], ['Region', 0], ['FisVeil', 0], ['WindowAction', 1], ['Action', 1], ['Motion', 0], ['Side', sideSign()], ['CurlOn', 0], ['PartOn', 0], ['IncReveal', 0], ['SplitKind', 0], ['SplitPass', 0]])
        gl.uniform1f(uniforms[n], v); gl.uniform4fv(uniforms.Groove, [0, 0, 0, 1]); gl.uniform3fv(uniforms.Offset, [0, 0, 0]); for (const part of geo.parts) {
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
    $('#manifestDownload').onclick = () => downloadBlob(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), 'transfalcine-mesh-manifest.json');
    $('#exportPlan').onclick = () => downloadBlob(new Blob([JSON.stringify({ model: modelIndex() + 1, config, steps, papers, side: operativeSide(), contextSide, palette, layers: { relevant: { ...enabled }, all: { ...allEnabled } }, positioning: { operativePose: { ...poseSettings }, defaults: corridorPose(), units: 'degrees', pivot: [...POSE_PIVOT], note: 'The operative pose illustrates the lesion side uppermost, with lateral positioning and elevated vertex for the anterior and middle thirds and a three-quarter prone setup posteriorly. Holder and table geometry are schematic.' }, rendering: (palette === 'surgical' ? 'Surgical palette: per-tissue shading with baked ambient occlusion and procedural surface texture (porosity, pores, fibres, lobules, faint vessel-like patterns); the texture is decorative, not anatomical.' : 'Atlas palette: manifest teaching colours with simple shading and baked ambient occlusion.') + ' The vault layers and dural flap use the reference curl and peel deformation. Amber marks show the planned field. Cyan instruments illustrate the working field.', limitations: manifest.limitations }, null, 2)], { type: 'application/json' }), 'transfalcine-model-' + String(modelIndex() + 1).padStart(2, '0') + '-reading-plan.json');
    $('#pdfRequests').onclick = () => downloadBlob(new Blob([papers.map(p => `${p.title}\n${p.citation}\n${p.url}\n`).join('\n')], { type: 'text/plain' }), 'transfalcine-requested-papers.txt');
    mobileQuery.addEventListener?.('change', syncMobileLayout);
    $('#layerControls').addEventListener('toggle', () => { if (isMobile) updateStepLabels(); });
    window.addEventListener?.('resize', () => { if (isMobile)
        requestAnimationFrame(updateMobileReaderHeight); });
    syncMobileLayout();
    new ResizeObserver(() => { if (isMobile)
        updateMobileReaderHeight(); }).observe($('.layout'));
    function ensureGeometry(m) { if (m.geometryReady)
        return; const bytes = decode64(m.data), floats = new Float32Array(bytes.buffer); if (floats.length !== m.count * 6)
        throw Error('Invalid geometry buffer ' + m.id);
        m.vertexData = floats; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferSubData(gl.ARRAY_BUFFER, m.first * 24, floats); m.geometryReady = true; delete m.data; }
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
        gl.attachShader(program, shader(gl.VERTEX_SHADER, `attribute vec3 aPosition;attribute vec3 aNormal;uniform mediump float uLine;uniform float uLinePx,uLineNudge;uniform float uDistance,uAspect,uScale,uSide;uniform mat3 uView;uniform vec2 uPan;uniform vec3 uTarget;uniform vec3 uOffset;uniform vec4 uStudyShift;uniform float uFlapAngle;uniform vec3 uFlapAxis,uFlapPivot;
uniform float uCurlOn,uCurlIA;uniform vec3 uCurlPivot,uCurlAxis,uCurlAway,uCurlLift;uniform vec4 uCurlP;uniform float uCurlRow[16];uniform float uIncReveal;uniform vec3 uInc[24];
varying mediump vec3 vNormal;varying highp vec3 vOriginal;varying highp vec3 vEye;varying mediump float vAO;varying mediump vec3 vObjN;varying highp float vIncT;
/* Curl the flap about a hinge that follows the tabulated tissue height. */
vec3 curlF(vec3 q){vec3 v=q-uCurlPivot;float d=dot(v,uCurlAway),dd=d-uCurlP.z;if(dd<=0.)return q;float a=dot(v,uCurlAxis),fi=clamp((a-uCurlP.w)*uCurlIA,0.,15.);int i0=int(floor(fi));int i1=i0<15?i0+1:15;float hp=mix(uCurlRow[i0],uCurlRow[i1],fi-float(i0)),hh=dot(v,uCurlLift),R=uCurlP.x,s=min(dd,R*uCurlP.y),ph=s/R,c=cos(ph),sn=sin(ph);vec3 aw=c*uCurlAway+sn*uCurlLift,li=c*uCurlLift-sn*uCurlAway;
 return uCurlPivot+(uCurlP.z+R*sn)*uCurlAway+(hp+R*(1.-c))*uCurlLift+(v-d*uCurlAway-hh*uCurlLift)+(dd-s)*aw+(hh-hp)*li;}
void main(){vAO=length(aNormal);vOriginal=vec3(aPosition.x*uSide,aPosition.y,aPosition.z);vec3 q=aPosition;vec3 norm=aNormal/max(vAO,1e-4);vIncT=0.;
if(uIncReveal>.5){vec3 rad=normalize(aPosition-vec3(0.,-.4,-.4));float best=1e3;
 for(int i=0;i<23;i++){vec3 a=uInc[i],ab=uInc[i+1]-a;float t=clamp(dot(aPosition-a,ab)/max(dot(ab,ab),1e-8),0.,1.);vec3 e=aPosition-a-ab*t;e-=dot(e,rad)*rad;float d=length(e);if(d<best){best=d;vIncT=(float(i)+t)/23.;}}}
/* Curl: the normal is taken from the deformed surface itself (curlF at two offsets along the rest tangent plane), so
   the roll and the hinge-height shear shade correctly. */
if(uCurlOn>.5){vec3 t1=normalize(cross(norm,abs(norm.x)<.9?vec3(1.,0.,0.):vec3(0.,1.,0.))),t2=cross(norm,t1);vec3 q0=curlF(q);norm=normalize(cross(curlF(q+.002*t1)-q0,curlF(q+.002*t2)-q0));q=q0;}
if(uFlapAngle!=0.){
  float ct=cos(uFlapAngle),st=sin(uFlapAngle);vec3 k=uFlapAxis,v=q-uFlapPivot;
  q=uFlapPivot+v*ct+cross(k,v)*st+k*dot(k,v)*(1.-ct);
  norm=norm*ct+cross(k,norm)*st+k*dot(k,norm)*(1.-ct);
}
if(uStudyShift.w>.5){
 float dz=abs(q.z-(uStudyShift.y+uStudyShift.z)*.5);
 float t=(1.-smoothstep(.3,1.95,abs(q.x)))*(1.-smoothstep(1.05,2.5,dz))*smoothstep(-.48,.77,q.y);
 if(uStudyShift.w>1.5)t*=smoothstep(.04,.65,abs(q.x));
 q.x+=uStudyShift.x*t;
 q.y-=.28*abs(uStudyShift.x)*t;
}
q+=uOffset;
// View: uView = head(model)->view rotation (camera orientation x head pose), uTarget = orbit centre in model space.
// q/norm are model-space after flap motion.
if(uLine>0.){float w0=uDistance-(uView*(q-uTarget)).z;q+=norm*max(0.,w0*uLinePx-uLine);}vec3 p=uView*(q-uTarget);vNormal=uView*norm;vObjN=vec3(aNormal.x*uSide,aNormal.yz)/max(vAO,1e-4);float w=uDistance-p.z;vEye=vec3(-(p.x+uPan.x),-(p.y+uPan.y),w);float wz=uLine>0.?max(w-uLineNudge,.05):w;gl_Position=vec4((p.x+uPan.x)*uScale/uAspect,(p.y+uPan.y)*uScale,(1.0125786-1.0062893/wz)*w,w);}`));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define FISSURE_N ${fissureN}
uniform sampler2D uInkMask;uniform vec4 uInkBounds;uniform float uInkProgress;
uniform mediump float uLine;uniform vec4 uColor;uniform float uSelected,uPick,uIsMarker,uMarkKind,uMarkAxis,uMarkReveal,uMaterial,uSurgical,uQuality;uniform vec3 uMarkCenter;uniform vec2 uMarkRange,uViewport;uniform vec3 uFissure[FISSURE_N];uniform float uFisVeil;uniform vec3 uInner;varying mediump vec3 vNormal;varying vec3 vOriginal;varying vec3 vEye;varying mediump float vAO;varying mediump vec3 vObjN;varying float vIncT;
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
uniform vec4 uStudyBurr;
uniform float uBoneSection;
void main(){if(uStudyBurr.w>0.&&vOriginal.y>uStudyBurr.z){
 float x=vOriginal.x;float z=vOriginal.z-uStudyBurr.x;float h=uStudyBurr.y-.12;
 float tick=uStudyBurr.w*5.;
 if(length(vec2(x,z))<.103*clamp(tick,0.,1.) ||
 length(vec2(x+.5,z+h))<.103*clamp(tick-1.,0.,1.) ||
 length(vec2(x-.5,z+h))<.103*clamp(tick-2.,0.,1.) ||
 length(vec2(x+.5,z-h))<.103*clamp(tick-3.,0.,1.) ||
 length(vec2(x-.5,z-h))<.103*clamp(tick-4.,0.,1.))discard;
}if(uIsMarker>.5){if(uMarkReveal<=.001)discard;float t=0.;if(uMarkKind==1.)t=(atan(vOriginal.z-uMarkCenter.z,vOriginal.y-uMarkCenter.y)+3.14159265)/6.2831853;else if(uMarkKind==2.){float v=uMarkAxis==2.?vOriginal.z:uMarkAxis==0.?vOriginal.x:vOriginal.y;t=(v-uMarkRange.x)/max(.001,uMarkRange.y-uMarkRange.x);}else if(uMarkKind==3.)t=vIncT;if(t>uMarkReveal)discard;}float fisT=.5,veil=0.;if(uFisVeil>.5){float d=fissureDist(vOriginal,fisT);veil=(1.-smoothstep(.06,.22,d))*smoothstep(0.,.12,fisT)*smoothstep(1.,.88,fisT);}
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
  if(uBoneSection>.5){
   base*=vec3(.92,.85,.77)*(.90+.16*vnoise(P*80.));shin=20.;wrap=.3;
  }
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
if(arach&&veil>0.){c=mix(c,vec3(.92,.94,.95),.4*veil);alpha=max(alpha,.62*veil);}
if(uInkProgress>0.){
  vec2 uv=(vOriginal.xz-uInkBounds.xy)/uInkBounds.zw;
  vec4 ink=texture2D(uInkMask,uv);
  float outer=smoothstep(.18,.55,vObjN.y);
  c=mix(c,vec3(.052,.041,.038),ink.a*outer*step(ink.r,uInkProgress));
}
if(uSelected>.5)c=mix(c,vec3(.66,1.,.62),.50);if(uIsMarker>.5)c=mix(c,uColor.rgb,.8);gl_FragColor=vec4(c,alpha);}`));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw Error(gl.getProgramInfoLog(program));
        gl.useProgram(program);
        ['InkMask', 'InkBounds', 'InkProgress', 'View', 'StudyShift', 'StudyBurr', 'BoneSection', 'Distance', 'Aspect', 'Scale', 'Pan', 'Color', 'Selected', 'Pick', 'Target', 'Offset', 'FlapAngle', 'Side', 'IsMarker', 'Line', 'LinePx', 'LineNudge', 'MarkKind', 'MarkAxis', 'MarkReveal', 'MarkCenter', 'MarkRange', 'Material', 'Surgical', 'Quality', 'Viewport', 'Fissure', 'FlapAxis', 'FlapPivot', 'FisVeil', 'CurlOn', 'CurlIA', 'CurlPivot', 'CurlAxis', 'CurlAway', 'CurlLift', 'CurlP', 'CurlRow', 'Inc', 'IncReveal', 'Inner'].forEach(n => uniforms[n] = gl.getUniformLocation(program, 'u' + n));
        gl.uniform1i(uniforms.InkMask, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.activeTexture(gl.TEXTURE0);
        let vertexCount = 0;
        meshes.forEach((m, i) => { m.index = i; m.hidden = false; m.first = vertexCount; vertexCount += m.count; m.rgb = m.color.match(/\w\w/g).map(x => parseInt(x, 16) / 255); m.innerRgb = m.innerColor ? hexRgb(m.innerColor) : null; m.surgicalTint = /^ILL-sulcal-backing/.test(m.id) ? surgicalRgb.brain.map(x => x * .62) : surgicalLayerTints[baseId(m)] ? hexRgb(surgicalLayerTints[baseId(m)]) : null; });
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
        window.guideQA = { solidDepth: true, zoomBy, syncMobileLayout, alignActiveStep, updateMobileReaderHeight, changeKind, procedureLabelRegion, activeLabelMesh, fixedLabelRect, visible, indicationGroups, chooseIndication, setProcedureSide, operativeSide, sideSign, canonicalPoint, onOperativeSide, relevantMesh, stepView, baseId, meshSide, meshOffset, scanPickAnchors, pickIdAt, meshCount: meshes.length, vertexCount, draw, activate, choose, configs, select, setTab, setView, enabled, allEnabled, getMeshes: () => meshes.map(({ data, vertexData, procedureCandidates, fissureCache, ...m }) => m), visibleCount: () => meshes.filter(visible).length, getSteps: () => steps, getState: () => ({ palette, viewZoom, isMobile, config: { ...config }, model: modelIndex() + 1, stage, mode, selected, contextAlpha, contextSide, prelabelsOn, opening, beforeCurrent, regionalContext, instrumentsOn, separateLayers, ...cameraState(), distance, pan: [...pan], enabled: { ...enabled }, allEnabled: { ...allEnabled } }), surgicalState, setPalette, opacity, refreshLabels: updateStepLabels,
            // Camera / head-pose API (see the orientation and head-positioning blocks near the top of this file).
            getCamera: () => ({ q: [...viewQ], frame: camFrame, target: camFrame === 'world' ? posePoint(anatomyCenter) : [...anatomyCenter], distance, pan: [...pan], viewZoom }), setCamera, rotateByDrag: (dx, dy) => { stopGlide(); rotateByDrag(dx, dy); render(); }, rollView: a => { stopGlide(); rollView(a); render(); }, attachCamera: f => { attachCamera(f); render(); }, viewBasis: () => ({ M: [...viewBasis().M], target: [...viewBasis().target] }), project, transform, pickAt: (x, y) => { draw(true); cacheLabelVisibility(); const id = pickIdAt(x, y); draw(); return id; }, setSurgeonView,
            getPose: poseState, setPose, setPoseMode, resetPose, gravityInModel, posePoint, poseInverse, posePivot: [...POSE_PIVOT], poseDefault: corridorPose(),
            // Soft-tissue deformation and projected mesh coordinates.
            stateProgress, movePoint: (i, p) => movePoint(meshes[i], p), getDeformation: i => { const d = deformation(meshes[i]); return d && { curl: d.curl && { key: d.curl.mo.key, progress: d.curl.P, hingeTravel: d.curl.dh, angle: d.curl.T, radius: d.curl.mo.R, dmax: d.curl.mo.dmax }, split: d.split && { kind: d.split.kind, margin: d.split.margin, plane: d.split.plane }, part: d.part && { reveal: d.part.reveal, gap: d.part.gap, sign: d.part.sign }, groove: d.groove, leafCut: !!d.leafCut }; }, curlTuning: CURL_TUNING, variantSnapshot };
        $('#loading').hidden = true;
        render();
    }
    let pickTarget = null, fissureN = 12;
    function fissureUniform(m) { if (m.fissureCache?.n !== fissureN) {
        // Resample the record's fissure polyline to fissureN points at equal arc length.
        const pts = m.fissureLine, lens = [0];
        for (let i = 1; i < pts.length; i++)
            lens.push(lens[i - 1] + Math.hypot(...pts[i].map((x, j) => x - pts[i - 1][j])));
        const total = lens[lens.length - 1] || 1, out = [];
        for (let k = 0, i = 1; k < fissureN; k++) {
            const d = total * k / (fissureN - 1);
            while (i < pts.length - 1 && lens[i] < d)
                i++;
            const f = Math.max(0, Math.min(1, (d - lens[i - 1]) / ((lens[i] - lens[i - 1]) || 1)));
            out.push(pts[i - 1].map((x, j) => x + (pts[i][j] - x) * f));
        }
        m.fissureCache = { n: fissureN, points: out };
    } return m.fissureCache.points.flatMap(canonicalPoint); }
    function preparePickTarget(w, h) { if (pickTarget && pickTarget.w === w && pickTarget.h === h)
        return; if (pickTarget) {
        gl.deleteFramebuffer(pickTarget.fbo);
        gl.deleteTexture(pickTarget.texture);
        gl.deleteRenderbuffer(pickTarget.depth);
    } const fbo = gl.createFramebuffer(), texture = gl.createTexture(), depth = gl.createRenderbuffer(); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth); if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw Error('Selection buffer is unavailable'); pickTarget = { fbo, texture, depth, w, h }; gl.bindTexture(gl.TEXTURE_2D, null); gl.bindRenderbuffer(gl.RENDERBUFFER, null); }
    // Deformation uniforms (see the vertex shader): curl / peel, incision parting and two-pass regions.
    function setCurlUniforms(cs) { gl.uniform1f(uniforms.CurlOn, cs ? 1 : 0); if (!cs)
        return; const mo = cs.mo; gl.uniform3fv(uniforms.CurlPivot, mo.pivot); gl.uniform3fv(uniforms.CurlAxis, mo.axis); gl.uniform3fv(uniforms.CurlAway, mo.away); gl.uniform3fv(uniforms.CurlLift, mo.lift); gl.uniform4f(uniforms.CurlP, mo.R, cs.T, cs.dh, mo.prof.a0); gl.uniform1f(uniforms.CurlIA, mo.prof.ia); gl.uniform1fv(uniforms.CurlRow, cs.row);
    }
    function boneFlapTravel() {
        const progress = stateProgress('bone');
        if (progress <= 0 || progress >= 1) return null;
        const side = sideSign(), region = regions[config.region];
        const lift = smoothstep01(clamp01(progress / .22));
        const tilt = smoothstep01(clamp01((progress - .28) / .32));
        const carry = smoothstep01(clamp01((progress - .56) / .44));
        // Elevate the entry edge before carrying the freed flap away. Closure
        // uses the same poses in reverse so the flap returns to its kerf.
        return {
            pivot: [.62 * side, region.boneHingeY?.[operativeSide()] ?? region.floor + 1, region.z],
            angle: -.24 * side * tilt,
            offset: [-side * 3.8 * carry, 1.05 * lift + 1.95 * carry, -.45 * carry]
        };
    }
    // Largest drawable size (an oversized layout, e.g. a very wide page, must not break the selection buffer).
    let drawLimitCache = 0;
    function drawLimit() { if (!drawLimitCache) {
        const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
        drawLimitCache = Math.max(256, Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096, vp ? Math.min(vp[0], vp[1]) : 4096));
    } return drawLimitCache; }
    function skinInkPath() {
        const mark = clearanceMeshById.get(config.region + '-' + operativeSide() + '-incision');
        if (!mark) return null;
        const [start, end] = mark.markerRange;
        return mark.markerAxis === 0
            ? [[start, mark.anchor[2]], [end, mark.anchor[2]]]
            : [[mark.anchor[0] * sideSign(), start], [mark.anchor[0] * sideSign(), end]];
    }

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
        const marking = steps.findIndex(step => step.id === 'incision');
        if (marking < 0 || stage < marking || stage === marking && beforeCurrent) return 0;
        const progress = stage === marking ? opening : 1;
        if (progress <= 0) return 0;
        const key = config.region + ':' + operativeSide();
        if (!skinInkMasks.has(key)) {
            const points = skinInkPath();
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
        gl.uniform1f(uniforms.Scale, scale * viewZoom); gl.uniform1f(uniforms.LinePx, 2 * LINE_MIN_HALF_PX / (scale * viewZoom * gl.drawingBufferHeight)); gl.uniform1f(uniforms.LineNudge, LINE_NUDGE);
        // Scale by w in the vertex shader so the offset is uniform after perspective division.
        gl.uniform2fv(uniforms.Pan, pan);
        gl.uniform3fv(uniforms.Target, viewBasis().target);
        gl.uniform1f(uniforms.Pick, picking ? 1 : 0);
        gl.uniform1f(uniforms.Surgical, palette === 'surgical' ? 1 : 0);
        gl.uniform1f(uniforms.Quality, isMobile ? 0 : 1);
        gl.uniform2f(uniforms.Viewport, w, h);
        // Opaque meshes first; translucent ones afterwards, back to front, without depth writes. In the picking
        // pass translucent meshes are drawn after the opaque ones with the depth test, so a click identifies the
        // nearest surface; the arachnoid veil is left out (pickThrough) so clicks reach the cortex and vessels.
        const hidden = hiddenByClearance();
        const visibleList = meshes.filter(m => baseVisible(m) && !hidden.has(m.id)), opaque = visibleList.filter(m => opacity(m) >= 1), depth = m => transform(movePoint(m, m.anchor))[2];
        const translucent = visibleList.filter(m => opacity(m) < 1 && opacity(m) > 0 && !(picking && m.group === 'arachnoid')).map(m => [depth(m), m]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
        const list = [...opaque, ...translucent];
        gl.disable(gl.BLEND);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.uniform4fv(uniforms.StudyShift,[0,0,0,0]);
        gl.uniform4fv(uniforms.StudyBurr,[0,0,0,0]);
        gl.uniform1f(uniforms.InkProgress, 0);
        drawProps(picking); // schematic head holder and table (room views only); restores the anatomy buffer
        const inkProgress = prepareSkinInk(picking);
        for (const m of list) {
            ensureGeometry(m);
            const flat = m.marker || m.instrument || !(m.group in materialIds), see = !picking && opacity(m) < 1;
            // The illustrative sulcal backing gets a darker, recessed cortex tone in the Surgical palette too.
            let rgb = palette === 'surgical' && !flat ? (m.surgicalTint || surgicalRgb[m.group]) : m.rgb;
            gl.uniform1f(uniforms.InkProgress, m.group === 'skin' && !m.externalSurface && !m.marker ? inkProgress : 0);
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
            gl.uniform1f(uniforms.Side, sideSign());
            gl.uniform1f(uniforms.IsMarker, m.marker ? 1 : 0); gl.uniform1f(uniforms.Line, m.marker || m.instrument ? (m.markerRadius || .035) : 0);
            const incMark = m.marker ? incisionMarker(m) : null;
            gl.uniform1f(uniforms.MarkKind, incMark ? 3 : m.markerKind || 0);
            gl.uniform1f(uniforms.MarkAxis, m.markerAxis || 1);
            gl.uniform1f(uniforms.MarkReveal, m.marker ? markReveal(m) : 1);
            gl.uniform3fv(uniforms.MarkCenter, canonicalPoint(m.markerCenter || [0, 0, 0]));
            gl.uniform2fv(uniforms.MarkRange, m.markerRange || [0, 1]);
            gl.uniform3fv(uniforms.Offset, meshOffset(m));
            gl.uniform4fv(uniforms.StudyShift, studyShift(m));
            const region = regions[config.region];
            gl.uniform4fv(uniforms.StudyBurr, [region.z,region.half,region.floor,
                m.part === 'vaultOriginal' && procedure ? stateProgress('burr') : 0]);
            gl.depthMask(!see);
            gl.uniform4fv(uniforms.Color, [...rgb, picking ? 1 : opacity(m)]);
            gl.uniform1f(uniforms.Selected, m.index === selected ? 1 : 0);
            const flap = m.part === 'boneFlap' ? boneFlapTravel() : null;
            gl.uniform1f(uniforms.FlapAngle, flap?.angle ?? 0);
            if (flap) {
                gl.uniform3fv(uniforms.FlapAxis, [0, 0, 1]);
                gl.uniform3fv(uniforms.FlapPivot, flap.pivot);
            }
            gl.uniform1f(uniforms.BoneSection, m.boneSection ? 1 : 0);
            gl.uniform3fv(uniforms.Inner, m.innerRgb || m.rgb);
            gl.uniform1f(uniforms.IncReveal, incMark ? 1 : 0);
            if (incMark)
                gl.uniform3fv(uniforms.Inc, incMark.flat);
            gl.uniform1f(uniforms.FisVeil, m.group === 'arachnoid' && m.fissureLine?.length > 1 ? 1 : 0);
            if (m.group === 'arachnoid' && m.fissureLine?.length > 1)
                gl.uniform3fv(uniforms.Fissure, fissureUniform(m));
            setCurlUniforms(deformation(m)?.curl ?? null);
            gl.drawArrays(gl.TRIANGLES, m.first, m.count);
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
        const unit = 2 * distance / (scale * viewZoom * Math.max(1, host.clientHeight));
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
    rebuild({ reset: true });
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
