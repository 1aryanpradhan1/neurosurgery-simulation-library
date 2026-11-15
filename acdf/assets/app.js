(() => {
    'use strict';
    const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
    const guideData = window.__GUIDE_DATA__;
    const meshes = guideData?.['mesh-data'] ?? JSON.parse($('#mesh-data').textContent);
    const manifest = guideData?.['manifest-data'] ?? JSON.parse($('#manifest-data').textContent);
    const papers = manifest.papers;
    const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const mobileQuery = matchMedia('(max-width:760px)');
    let isMobile = mobileQuery.matches, desktopLabelPreference = true, mobileLabelPreference = false, viewZoom = 1;
    const anatomy = guideData?.['anatomy-data'] ?? JSON.parse($('#anatomy-data').textContent);
    const displayConflicts = guideData?.['clearance-data'] ??
        JSON.parse($('#clearance-data')?.textContent || '{}');
    const byId = new Map(meshes.map(mesh=>[mesh.id,mesh]));
    let config = { levels: '1', construct: 'plated' }, steps = [], stage = 0, mode = '3d',
        selected = -1, contextAlpha = 1, contextSide = 'right', procedure = true, prelabelsOn = !isMobile,
        opening = 1, animationToken = 0, separateLayers = false, regionalContext = true, beforeCurrent = false,
        contextLayerSnapshot = null, instrumentsOn = true, capturing = false;
    const enabled = { skin: true, fat: true, galea: true, fascia: true, deepfascia: true,
        muscle: true, bone: true, disc: true, viscera: true, arteries: true, veins: true,
        nerves: true, brain: true, dura: true, implant: true };
    // Surgical palette: approximate unlit tissue albedo (sRGB) used by the material shader; Atlas keeps the manifest colours.
    const palettes = { atlas: { skin: '#d9a184', galea: '#d8dad3', pericranium: '#dcd6e4', bone: '#e2d5b8', brain: '#bca99d', muscle: '#b87367', fascia: '#a4c7ba', deepfascia: '#75a99a', fat: '#debd69', arteries: '#dd6268', veins: '#5f6fae', nerves: '#f2d776', dura: '#95b7bb', arachnoid: '#cfe3ea' }, surgical: { skin: '#cf9a7f', galea: '#dcdbd3', pericranium: '#d8d9e0', bone: '#dccdb0', brain: '#d4aa9c', muscle: '#82302a', fascia: '#e2ddd1', deepfascia: '#d9dcd8', fat: '#e3c677', arteries: '#c4423d', veins: '#5e3e66', nerves: '#ede3c6', dura: '#c4bcb5', arachnoid: '#e6eef1' } };
    Object.assign(palettes.atlas, {disc:'#8ebfbc',viscera:'#d4a393',implant:'#a0b4c4',galea:'#bd8274',dura:'#95aeb7'});
    Object.assign(palettes.surgical, {disc:'#83a8a2',viscera:'#bd8a7a',implant:'#a0b4c4',galea:'#bc8278'});
    const materialIds = {bone:0,brain:1,muscle:2,fascia:3,deepfascia:3,fat:4,arteries:5,nerves:6,
        dura:7,veins:8,skin:10,galea:11,disc:7,viscera:2};
    let palette = 'surgical';
    try {
        if (localStorage.getItem('acdf-palette') === 'atlas')
            palette = 'atlas';
    }
    catch (error) { }
    const hexRgb = c => c.match(/\w\w/g).map(x => parseInt(x, 16) / 255);
    const surgicalRgb = Object.fromEntries(Object.entries(palettes.surgical).map(([k, c]) => [k, hexRgb(c)]));
    const allEnabled = Object.fromEntries(Object.keys(enabled).map(k => [k, false]));
    const canvas = $('#canvas'), host = $('#viewport');
    // Midpoint of the C3–T1 vertebral bounds, shared by every camera preset.
    const anatomyCenter = [0, 1.96, -3.12];
    // Camera state: viewQ/camFrame are described with the orientation helpers below; distance, pan (screen
    // space, after rotation) and viewZoom keep their original meaning.
    let gl = null, program = null, uniforms = {}, buffer = null, available = false, viewQ = qFromAngles(1.0, .25, 0), camFrame = 'head', distance = 15, pan = [0, 0], aspect = 1, scheduled = false, pickDirty = true, interactionActive = false, interactionTimer = 0;
    const scale = 2.05, LINE_MIN_HALF_PX = 1.3, LINE_NUDGE = .03;
    const levelOptions = {
        '1': { span: 'C5–6', levels: ['C5-C6'], title: 'Single-Level ACDF' },
        '2': { span: 'C5–7', levels: ['C5-C6', 'C6-C7'], title: 'Two-Level ACDF' },
        '3': { span: 'C4–7', levels: ['C4-C5', 'C5-C6', 'C6-C7'], title: 'Three-Level ACDF' }
    };
    const constructs = { plated: 'Cage + anterior plate', zero: 'Anchored zero-profile cage' };
    const configs = Object.keys(levelOptions).flatMap(levels => Object.keys(constructs).map(construct => ({levels, construct})));
    const configName = c => levelOptions[c.levels].span + ' · ' + constructs[c.construct];
    const centerLevel = () => levelOptions[config.levels].levels.reduce((sum, k) => sum + anatomy.levels[k].y, 0) / Number(config.levels);
    const stageLevel = () => steps[stage]?.level;

    function courseView(kind, level) {
        const mid = centerLevel(), one = level ? anatomy.levels[level] : null;
        const current = [0, one?.y ?? mid, one ? (one.front + one.back)/2 : -.45];
        const field = {yaw:.15, pitch:.08, target:current, distance:7.8, zoom:1};
        const external = {yaw:.19, pitch:.04, target:[-.48,mid,1.30], distance:15.2, zoom:1};
        return ({
            overview:{yaw:.29, pitch:.10, target:[0,2.05,-1.65], distance:12.2, zoom:1},
            room:{frame:'world', eye:[-.47,.22,.86], up:[0,1,0], target:[0,2.45,-.5], distance:15.5, zoom:1},
            external,
            corridor:{yaw:.12, pitch:.07, target:[-.22,mid,.40], distance:9.6, zoom:1},
            disc:field,
            foramen:{...field,yaw:-.24,pitch:-.24,distance:8.3},
            construct:{yaw:.10, pitch:.015, target:[0,mid-.03,-.70], distance:9.5, zoom:1}
        })[kind];
    }

    function buildSteps() {
        const { levels, span } = levelOptions[config.levels];
        const list = [];
        let state = {};
        const keyFor = (action, level) => level ? action + ':' + level : action;
        const text = (str, level) => str.replaceAll('{span}',span)
            .replaceAll('{level}',level ? level.replace(/-C/,'–') : '')
            .replaceAll('{lower}',level?.split('-')[1] || '');
        function add(template, level) {
            if (template.construct && template.construct !== config.construct)
                return;
            const { id:phase, action, groups, labels, sources } = template;
            const next = {...state}, changes = {};
            if (action && !['mark','trial','verify'].includes(action))
                changes[keyFor(action,level)] = 1;
            if (phase === 'release') {
                changes.interval = changes.fascia = changes.longus = changes.blades = 0;
            }
            if (phase === 'close-platysma')
                changes.platysma = 0;
            if (phase === 'close-skin')
                changes.skin = 0;
            if (phase === 'cage')
                changes[keyFor('distraction',level)] = 0;
            Object.assign(next,changes);
            list.push({
                id:level ? phase+'-'+level : phase, phase, level,
                title:text(template.title,level), body:text(template.body,level), groups,
                labels:labels.map(s => text(s,level)),
                sources:sources.filter(id => papers.find(p => p.id === id)?.levels.includes(config.levels)),
                state:next, beforeState:state, changes:Object.keys(changes),
                change:action, view:courseView(template.view,level)
            });
            state = next;
        }
        manifest.steps.forEach(s => add(s));
        for (const level of levels)
            manifest.repeat.forEach(s => add(s,level));
        manifest.tail.forEach(s => add(s));
        return list;
    }

    function relevantMesh(m) {
        const phase = steps[stage]?.phase;
        if (m.retract === 'fascia')
            return ['interval','fascia','localize','longus','blades'].includes(phase);
        if (m.retract === 'superficial')
            return ['platysma','interval','fascia','release'].includes(phase);
        if (!m.contextOnly)
            return true;
        if (['C3','T1','disc-C3-C4','disc-C7-T1'].includes(m.id))
            return true;
        if (['position','prepare','incise','platysma','interval','release','close-platysma','close-skin'].includes(phase))
            return m.id === 'jaw' && phase === 'position' || /^(scm-|hyoid|larynx|cricoid)/.test(m.id);
        return ['fascia','localize','longus','blades'].includes(phase) && m.id.startsWith('sympathetic-');
    }

    function stateProgress(action, level) {
        if (!procedure)
            return 0;
        const s = steps[stage];
        if (!s)
            return 0;
        const key = level ? action+':'+level : action;
        const before = s.beforeState[key] || 0, after = s.state[key] || 0;
        return beforeCurrent ? before : before + (after-before)*smoothstep01(opening);
    }

    function updateChangeControls() {
        const s = steps[stage];
        if (!s)
            return;
        const expanded = Object.keys(allEnabled).every(k => allEnabled[k]);
        $('#regionalContext').hidden = mode !== '3d';
        $('#regionalContext').setAttribute('aria-pressed', expanded);
        $('#viewlabel').hidden = true;
        const side = operativeSide() === 'left' ? 'Left' : 'Right';
        $('#sideCaption').textContent = contextSide === 'both' ? 'Both Sides · Right Approach' : side+' Approach';
        $('#focusChange').hidden = mode !== '3d';
        $('#compareChange').hidden = mode !== '3d' || !hasStageChange();
        $('#surgeonView').hidden = mode !== '3d';
        $('#openingControl').hidden = !hasStageChange();
        updateClearanceStatus();
    }

    function updateClearanceStatus(hidden = hiddenByClearance()) {
        const hasTool = instrumentsOn && meshes.some(m => m.instrument && baseVisible(m) && !hidden.has(m.id));
        const notice = $('#clearanceNotice');
        notice.hidden = hidden.size === 0;
        const text = procedure ? 'Stationary overlaps hidden for this step' : 'Overlapping objects hidden';
        if (notice.textContent !== text)
            notice.textContent = text;
        const side = operativeSide() === 'left' ? 'Left' : 'Right';
        const status = (hasTool ? 'Cyan: Instrument · ' : '') + configName(config) + ' · ' + side + ' approach';
        if ($('#visualnote').textContent !== status)
            $('#visualnote').textContent = status;
    }

    function changeKind(m) {
        if (!procedure || beforeCurrent || m.instrument || m.marker)
            return 0;
        const s = steps[stage];
        if (!s.change)
            return 0;
        if (m.edge && ((s.phase === 'incise' || s.phase === 'close-skin') && m.group === 'skin' ||
            ['platysma','close-platysma'].includes(s.phase) && m.group === 'galea'))
            return meshSide(m) === operativeSide() ? 5 : 0;
        if (m.retract && ['interval','fascia','longus','release'].includes(s.phase))
            return m.retract === s.phase || s.phase === 'release' || ['medial','lateral'].includes(m.retract) && s.phase === 'interval' ? 5 : 0;
        if (m.level && m.level !== s.level)
            return 0;
        if (m.remove === s.change || m.insert === s.change || m.group === 'disc' && ['annulus','discectomy'].includes(s.phase))
            return 5;
        return 0;
    }

    function hasStageChange() { return !!steps[stage]?.change && steps[stage].phase !== 'verify'; }
    const indicationGroups = [
        { title: 'Clinical findings', key:'clinical', items: [
            {title:'Cervical Radiculopathy',body:'Arm pain, weakness, sensory loss or reflex changes can localize to an exiting nerve root. Consider the correspondence between examination and foraminal or lateral disc pathology on imaging.',sources:['aaos','technique']},
            {title:'Degenerative Cervical Myelopathy',body:'Hand clumsiness, gait changes or upper motor neuron signs can accompany cord compression. Management depends on severity, progression, alignment and the pattern of compression.',sources:['dcm','technique']},
            {title:'Laterality of Exposure',body:'The approach side identifies which side of the neck is opened. Either corridor can reach the central disc and contralateral foramen when indicated.',sources:['ao','gajski','valero']}
        ]},
        { title:'Number of treated levels', key:'levels', items:[
            {value:'1',title:'Single Level · C5–6',body:'An example of a focal symptomatic disc-space lesion. The C6 root exits through the C5–6 foramen.',sources:['zhang','aaos']},
            {value:'2',title:'Two Levels · C5–7',body:'An example with two concordant adjacent levels. The C6 and C7 roots exit at the represented spaces.',sources:['kang','valero']},
            {value:'3',title:'Three Levels · C4–7',body:'An example of three contiguous levels with concordant ventral disease. Long constructs call for attention to alignment, fixation and fusion across every treated level.',sources:['gajski','he']}
        ]},
        {title:'Interbody fixation',key:'construct',items:[
            {value:'plated',title:'Cage + Anterior Plate',body:'Each interbody cage supports one disc space. One anterior plate spans the selected vertebral bodies and uses screw fixation.',sources:['technique','gajski','kang']},
            {value:'zero',title:'Anchored Zero-Profile Cage',body:'Each cage has its own integrated fixation at the disc space. Anchor designs and approved indications vary by device.',sources:['zhang','kang','he']}
        ]}
    ];
    function chooseIndication(key,value) {
        choose({...config,[key]:value});
        const phase = key === 'levels' ? 'orient' : value === 'plated' ? 'plate' : 'anchor';
        setTab('steps');
        setMode('3d');
        activate(Math.max(0,steps.findIndex(s => s.phase === phase)));
        applyRecommendedView();
    }

    function geometryAllowed(m) {
        if (m.configuration && m.configuration !== config.levels || m.construct && m.construct !== config.construct)
            return false;
        if (m.level && (m.marker || m.instrument || m.insert || m.remove || m.targetOnly)
            && !levelOptions[config.levels].levels.includes(m.level))
            return false;
        return true;
    }

    function bladeProgress() {
        return steps[stage].phase === 'release' && !beforeCurrent
            ? 1-smoothstep01(clamp01(opening/.38)) : stateProgress('blades');
    }

    // Crossings anywhere in a step apply to the complete step. The same result is
    // used by the color pass, picking, labels and captured comparison images.
    function conflictsAtStage() {
        const {phase,level=''} = procedure ? steps[stage] : {phase:'rest'};
        const suffix = [operativeSide(),phase,level].join('|');
        return displayConflicts[`${config.levels}|${config.construct}|${suffix}`] ||
            displayConflicts[`${config.levels}|any|${suffix}`] || [];
    }
    function hiddenByClearance() {
        const hidden = new Set();
        if (separateLayers)
            return hidden;
        // Motion has priority. Only a mesh included by the current view and
        // layer settings can hide another one. Ignore its animation progress.
        for (const [source,target] of conflictsAtStage()) {
            if (!hidden.has(source) && baseVisible(byId.get(source), true) && baseVisible(byId.get(target), true))
                hidden.add(target);
        }
        return hidden;
    }
    function visible(m) {
        return baseVisible(m) && !hiddenByClearance().has(m.id);
    }
    function baseVisible(m, wholeStep = false) {
        if (!m || m.hidden || !geometryAllowed(m))
            return false;
        const s = steps[stage], side = meshSide(m), active = operativeSide();
        if (m.marker) {
            return procedure && (side === 'both' || side === active || m.bilateral)
                && m.markerStages.includes(s.phase) && (!s.level || !m.level || m.level === s.level)
                && (!beforeCurrent || s.phase === 'orient');
        }
        if (m.instrument) {
            if (!procedure || !instrumentsOn || (side !== 'both' && side !== active))
                return false;
            if (m.instrumentStage === 'blades') {
                const edge = m.retractor_side === active ? 'lateral' : 'medial';
                return m.retractor_edge === edge && s.groups.includes('viscera') &&
                    (wholeStep || bladeProgress() > .01 || !beforeCurrent && s.phase === 'blades');
            }
            return (wholeStep || !beforeCurrent) && m.instrumentStage === s.phase && (!m.level || m.level === s.level);
        }
        if (!wholeStep && m.insert && stateProgress(m.insert,m.level) <= .002)
            return false;
        if (!wholeStep && m.remove && stateProgress(m.remove,m.level) >= .999)
            return false;
        if (!wholeStep && m.group === 'disc' && stateProgress('disc',m.level) >= .999)
            return false;
        if (m.id === 'all-context' || m.id === 'pll-context')
            return false;
        if (m.id.startsWith('platysma-') &&
            (s.groups.includes('galea') || allEnabled.galea))
            return false;
        if (side !== 'both' && contextSide !== 'both' && side !== active && !['galea','skin','fat','deepfascia'].includes(m.group)
            && m.retract !== 'longus' && !m.id.startsWith('va-') && !m.name.includes('Exiting Nerve Root') && !allEnabled[m.group])
            return false;
        if (separateLayers && m.group === 'skin')
            return false;
        return !!allEnabled[m.group] || !!enabled[m.group] && relevantMesh(m);
    }

    const opacity = m => m.opacity ?? 1;
    function cutProgress(m) {
        if (m.remove)
            return stateProgress(m.remove,m.level);
        if (m.group === 'disc')
            return Math.max(.25*stateProgress('annulus',m.level),stateProgress('disc',m.level));
        return 0;
    }
    function surgicalState(m) { return {cut:cutProgress(m),offset:meshOffset(m)}; }
    function pointRetained(m,p) {
        const t = cutProgress(m);
        if (t <= .001)
            return true;
        const [lo,hi] = m.bounds;
        const inset = (hi[2]-lo[2])*(1-t);
        if (m.group === 'disc' && t <= .25)
            return Math.abs(p[0]) > .62 || p[2] <= hi[2] - (hi[2]-lo[2])*t;
        return p[2] <= lo[2]+inset;
    }

    function meshOffset(m) {
        const n = meshSide(m) === 'left' ? 1 : -1, active = -sideSign(), s = steps[stage];
        const release = s.phase === 'release' && !beforeCurrent;
        const releaseTime = smoothstep01(clamp01((opening-.38)/.62));
        const amount = release ? 1-releaseTime : stateProgress('interval');
        const d = [0,0,0], animated = beforeCurrent ? 0 : smoothstep01(opening);
        if (m.edge && meshSide(m) === operativeSide() && !separateLayers) {
            const layer = m.group === 'galea' ? 'platysma' : 'skin', p = stateProgress(layer);
            d[1] += (m.edge === 'upper' ? 1 : -1)*p*(m.group === 'galea' ? .29 : .19);
        }
        if (m.retract === 'lateral' && meshSide(m) === operativeSide())
            d[0] += n*1.1*amount;
        if (m.retract === 'medial')
            d[0] -= active*1.49*amount;
        if (m.retract === 'superficial')
            d[0] += n*1.16*amount;
        if (m.retract === 'fascia')
            d[0] += n*.92*(release ? 1-releaseTime : stateProgress('fascia'));
        if (m.retract === 'longus')
            d[0] += n*.62*(release ? 1-releaseTime : stateProgress('longus'));
        if (m.instrument && m.approach) {
            const t = m.instrumentStage === 'blades' ? bladeProgress() : animated;
            d.forEach((_,i) => d[i] += m.approach[i]*(1-t));
        }
        if (m.instrument && m.travel) {
            d[0] += m.travel[0]*animated;
            // Keep the scalpel tip on the curved path marked on skin.
            const start=.46, x=start+Math.abs(m.travel[0])*animated;
            d[2] += -.057*(x*x-start*start)-.04*animated;
        }
        if (m.insert) {
            const t = stateProgress(m.insert,m.level);
            if (m.insert === 'anchor' && m.approach) {
                for (let i=0;i<d.length;i++) d[i] += (1-t)*m.approach[i];
            } else {
                const retreat = (1-t)*(m.insert === 'cage' ? 2.05 : .94);
                d[2] += retreat;
                if (m.insert === 'cage')
                    d[1] += retreat * anatomy.implant_fit.values[m.level][3];
            }
        }
        if ((m.group === 'bone' && !m.remove || m.pin_body || m.id.startsWith('root-')) && s.level && anatomy.levels[s.level]) {
            const [upper,lower] = s.level.split('-');
            const t = stateProgress('distraction',s.level);
            const body = m.pin_body || m.id;
            if (m.id.startsWith('root-') && m.level !== s.level && m.level.endsWith('-'+upper))
                d[1] += .08*t;
            if (body === upper || body === lower)
                d[1] += (body === upper ? .08 : -.055)*t;
        }
        if (separateLayers && !m.instrument && !m.marker)
            d[2] += ({ fat:1.5, galea:1.12, fascia:.85, deepfascia:.43 }[m.group] || 0);
        return d;
    }

    const CURL_NA = 16, CURL_ND = 24, DRAPE_BLEND = .4;
    const clamp01 = x => Math.max(0,Math.min(1,x));
    const curlTuning = {skin:.94,fat:.94,galea:.73};
    function deformation(m) {
        if (!m.edge || separateLayers || meshSide(m) !== operativeSide())
            return null;
        const p = stateProgress(m.group === 'galea' ? 'platysma' : 'skin');
        if (p <= .001)
            return null;
        const direction = m.edge === 'upper' ? -1 : 1;
        const xBounds = m.bounds.map(b => b[0]), a0 = xBounds[0], ia = 15/(xBounds[1]-a0);
        const hinge = m.incisionY-direction*.72, shift = ({skin:0,fat:-.19,galea:-.37})[m.group];
        const surfaceHeight = (x,y) =>
            4.69 - .057*x*x + .038*(y-1.5) - .023*(y-1.5)**2 + .31*Math.max(0,y-3.5);
        const mo = {key:m.group,R:.44,axis:[1,0,0],away:[0,direction,0],lift:[0,0,1],
            pivot:[0,hinge,surfaceHeight(0,hinge)+shift],prof:{a0,ia},dmax:.66};
        const dh = .66*(1-p), angle = curlTuning[m.group]*p;
        const row = Float32Array.from({length:16},(_,i) =>
            surfaceHeight(a0+i/ia,hinge+direction*dh)-surfaceHeight(0,hinge));
        return {curl:{mo,P:p,dh,T:angle,row,wD:0}};
    }
    function movePoint(m,p) {
        const motion = deformation(m);
        return vAdd(motion ? curlPoint(motion.curl,p) : p,meshOffset(m));
    }

    function markReveal() {
        if (!procedure || beforeCurrent)
            return 0;
        return steps[stage].phase === 'orient' ? 1 : Math.max(opening,.001);
    }

    function procedureLabelRegion(m) {
        return { target:m.labelAnchor || m.anchor,
            radius:Math.max(.68,Math.hypot(...m.bounds[1].map((x,i) => x-m.bounds[0][i]))*.54) };
    }
    function activeLabelMesh(hidden = hiddenByClearance()) {
        if (selected >= 0)
            return baseVisible(meshes[selected]) && !hidden.has(meshes[selected].id) ? meshes[selected] : null;
        if (!prelabelsOn)
            return null;
        const s=steps[stage], key = name => titleCase(name.replace(/^(Right|Left) /,'')).replace(/-C(?=\d)/g,'–');
        for (const name of s.labels) {
            const matches = meshes.filter(m => baseVisible(m) && !hidden.has(m.id) && (!s.level || !m.level || s.level === m.level) &&
                key(m.name).toLowerCase() === key(name).toLowerCase());
            const match = matches.find(m=>meshSide(m)===operativeSide() && labelVisibility.has(m.index)) ||
                matches.find(m=>labelVisibility.has(m.index)) || matches.find(m=>meshSide(m)===operativeSide()) || matches[0];
            if (match)
                return match;
        }
        return null;
    }
    function labelName(m) { return titleCase(m.name).replace(/-C(?=\d)/g,'–'); }
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
    // Pose the cervical teaching model rigidly about a lower cervical reference point relative to the table.
    const POSE_PIVOT = [0,-1.45,-2.32];
    const POSE_DEFAULT = {rotation:0,extension:8,lateral:0}, POSE_KEYS=['rotation','extension','lateral'];
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
    // progress apply directly. Study-plate captures always use the requested pose.
    function updatePose() { const want = requestedPose(); let shown = want; if (poseBlend && POSE_KEYS.every(k => Math.abs(poseBlend.from[k] - want[k]) < 1e-3))
        poseBlend = null; if (poseBlend && !capturing) {
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
    // Re-express the orientation in another frame at the currently displayed pose.
    function attachCamera(frame) {
        if (frame === camFrame) return;
        const Pq = matQ(poseR);
        const convert = q => qNorm(qMul(q, frame === 'world' ? qConj(Pq) : Pq));
        viewQ = convert(viewQ);
        if (camGlide) {
            camGlide.from.q = convert(camGlide.from.q);
            camGlide.to.q = convert(camGlide.to.q);
        }
        camFrame = frame;
        viewChanged();
    }
    function applyCamera(v) {
        camFrame = v.frame || 'head';
        viewQ = v.eye ? qLook(v.eye, v.up || [0, 1, 0]) : qFromAngles(v.yaw, v.pitch, v.roll || 0);
        if (v.distance != null) distance = v.distance;
        if (v.zoom != null) viewZoom = v.zoom;
        viewChanged();
    }
    // Explicit camera selections survive the automatic Position demonstration.
    function setCamera(v = {}) {
        stopGlide();
        cameraExplicit = true;
        if (v.frame && v.frame !== camFrame) attachCamera(v.frame);
        if (v.q) viewQ = qNorm(v.q);
        else if (v.eye || v.yaw != null)
            viewQ = v.eye ? qLook(v.eye, v.up || [0, 1, 0]) : qFromAngles(v.yaw, v.pitch || 0, v.roll || 0);
        if (v.distance != null) distance = v.distance;
        if (v.zoom != null) viewZoom = v.zoom;
        if (v.pan) pan = [...v.pan];
        viewChanged();
        render();
    }
    // Keep the signed elevation across input events. Deriving it from asin on
    // each move would fold it back at the poles and reverse the drag direction.
    let orbit = null;
    function rotateByDrag(dx, dy, k = .008) {
        if (!dx && !dy) return;
        if (orbit?.q !== viewQ) {
            const M = qMat(viewQ);
            const yaw = Math.hypot(M[6], M[8]) > 1e-8 ? Math.atan2(-M[6], M[8]) : Math.atan2(M[2], M[0]);
            const pitch = Math.asin(Math.max(-1, Math.min(1, M[7])));
            orbit = { yaw, pitch, roll: qMul(viewQ, qConj(qFromAngles(yaw, pitch))) };
        }
        orbit.yaw = wrapAngle(orbit.yaw + dx * k);
        orbit.pitch = wrapAngle(orbit.pitch + dy * k);
        viewQ = orbit.q = qNorm(qMul(orbit.roll, qFromAngles(orbit.yaw, orbit.pitch)));
        viewChanged();
    }
    function markInteraction() { interactionActive = true; pickDirty = false; clearTimeout(interactionTimer); interactionTimer = setTimeout(() => { if (pointers.size)
        return; interactionActive = false; render(true); }, 140); }
    // Camera glide: slerp the orientation and ease distance, pan and zoom to a preset (same frame) over
    // `duration` ms, timed by poseClock like the pose blend. Used when the 'position' step frames the room; any user
    // camera input or preset cancels it (stopGlide). Study-plate captures ignore it.
    function qSlerp(a, b, t) { let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; if (d < 0) {
        b = b.map(x => -x);
        d = -d;
    } if (d > .9995)
        return qNorm(a.map((x, i) => x + (b[i] - x) * t)); const th = Math.acos(d), sa = Math.sin((1 - t) * th) / Math.sin(th), sb = Math.sin(t * th) / Math.sin(th); return a.map((x, i) => x * sa + b[i] * sb); }
    function glideCamera(v, duration = 1000) { attachCamera(v.frame || 'head'); const from = { q: [...viewQ], distance, pan: [...pan], zoom: viewZoom }; applyCamera(v); const to = { q: [...viewQ], distance, pan: [0, 0], zoom: v.zoom ?? 1 }; if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
    function updateGlide() { if (!camGlide || capturing)
        return; const { from, to } = camGlide, t = Math.max(0, Math.min(1, (poseClock - camGlide.start) / camGlide.duration)), e = smoothstep01(t), mix = (a, b) => a + (b - a) * e; viewQ = qSlerp(from.q, to.q, e); distance = mix(from.distance, to.distance); pan = from.pan.map((x, i) => mix(x, to.pan[i])); viewZoom = mix(from.zoom, to.zoom); viewChanged(); if (t >= 1)
        camGlide = null;
    else
        render(); }
    // Roll about the line of sight; a positive angle turns the image counter-clockwise.
    function rollView(angle) {
        const delta = qAxis([0, 0, 1], angle);
        const continuingOrbit = orbit?.q === viewQ;
        viewQ = qNorm(qMul(delta, viewQ));
        if (continuingOrbit) {
            orbit.roll = qNorm(qMul(delta, orbit.roll));
            orbit.q = viewQ;
        }
        viewChanged();
    }
    function meshSide(m) { if (m.procedureSide)
        return m.procedureSide; if (m.nativeName.endsWith('.l'))
        return 'left'; if (m.nativeName.endsWith('.r'))
        return 'right'; return 'both'; }
    function onOperativeSide(m) { const side = meshSide(m); return side === 'both' || side === operativeSide(); }
    function baseId(m) { return m.baseId || m.id; }
    // A step's recommended camera, mirrored for a left-sided procedure (yaw and roll change sign; eye/up x flip).
    function stepView(s) { const sign = sideSign(), v = s.view, mx = p => p && [p[0] * sign, p[1], p[2]]; return { ...v, frame: v.frame || 'head', yaw: v.yaw * sign, roll: (v.roll || 0) * sign, eye: mx(v.eye), up: mx(v.up) }; }
    function setProcedureSide(side) { if (!['right', 'left', 'both'].includes(side))
        return; contextSide = side; clearSelection(); syncControls(); updateChangeControls(); if (mode === '2d')
        showDiagram();
    else
        render(); }
    function setPalette(next) { if (!palettes[next])
        return; palette = next; try {
        localStorage.setItem('acdf-palette', next);
    }
    catch (error) { } syncControls(); if (mode === '2d')
        showDiagram();
    else
        render(); }
    function toggleFullContext() {
        if (Object.keys(allEnabled).every(k=>allEnabled[k])) {
            Object.assign(allEnabled,contextLayerSnapshot || Object.fromEntries(Object.keys(enabled).map(k=>[k,false])));
            contextLayerSnapshot=null;
        } else {
            contextLayerSnapshot={...allEnabled};
            for (const k in allEnabled) allEnabled[k]=true;
        }
        regionalContext=!Object.values(allEnabled).some(Boolean);
        syncControls(); clearSelection(); updateChangeControls(); render();
    }
    function titleCase(value) { return String(value).replace(/\b([a-z][a-z0-9]*)\b/gi, (word, _, offset) => { const low = word.toLowerCase(); if (/^(acdf|pll|all|scm|rln|ct|mri|ap|c[1-8]|t1)$/.test(low))
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
    function setTab(t) { for (const k of ['steps', 'indications', 'papers']) {
        $('#tab-' + k).setAttribute('aria-selected', k === t);
        $('#' + k + '-panel').hidden = k !== t;
    } if (t === 'steps') {
        updateMobileReaderHeight();
        alignActiveStep();
    } }
    $$('[role=tab]').forEach(b => b.onclick = () => setTab(b.id.slice(4)));
    function setMode(next) { animationToken++; mode = next; $('#mode3d').setAttribute('aria-pressed', mode === '3d'); $('#mode2d').setAttribute('aria-pressed', mode === '2d'); for (const s of ['#canvas', '#viewinfo', '.floating', '#gesturehint', '.viewtools', '#mobileModelDock', '#stepLabels', '#labelLines', '#orientGizmo'])
        $(s).hidden = mode !== '3d'; $('#figurepanel').hidden = mode === '3d'; $('#popup').hidden = true; if (mode === '2d')
        showDiagram();
    else
        render();
    updateChangeControls(); }
    $('#mode3d').onclick = () => setMode('3d');
    $('#mode2d').onclick = () => setMode('2d');
    $('#creditsOpen').onclick = () => $('#credits').showModal();
    $('#creditsClose').onclick = () => $('#credits').close();
    function renderIndications() { const p = $('#indications'); p.replaceChildren(); const intro = document.createElement('p'); intro.className = 'indication-intro'; intro.textContent = 'The guide compares selected patterns of ventral degeneration and anterior interbody fixation. Each level selection loads a corresponding operative sequence.'; p.append(intro); for (const group of indicationGroups) {
        const h = document.createElement('h2');
        h.className = 'indication-group';
        h.textContent = group.title;
        p.append(h);
        for (const item of group.items) {
            const card = document.createElement('article');
            card.className = 'indication-card' + (item.value && config[group.key] === item.value ? ' active' : '');
            if (!item.value) {
                const title = document.createElement('h3'), body = document.createElement('p');
                title.textContent=item.title; body.textContent=item.body; card.append(title,body); p.append(card);
                continue;
            }
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.setAttribute('aria-pressed', config[group.key] === item.value);
            card.setAttribute('aria-label', 'Select ' + item.title);
            card.dataset.optionKey = group.key;
            card.dataset.optionValue = item.value;
            const title = document.createElement('h3');
            title.textContent = item.title;
            const body = document.createElement('p');
            body.textContent = item.body;
            card.append(title, body);
            card.onclick = () => chooseIndication(group.key, item.value);
            card.onkeydown = e => { if (['Enter', ' '].includes(e.key)) {
                e.preventDefault();
                chooseIndication(group.key, item.value);
            } };
            p.append(card);
        }
    } }
    function relevant(p) { return p.levels.includes(config.levels); }
    function renderPapers() { const q = $('#paperSearch').value.toLowerCase(); $('#papers').replaceChildren(); let count = 0; for (const p of papers) {
        if (q && !(JSON.stringify(p)).toLowerCase().includes(q))
            continue;
        count++;
        const card = document.createElement('article');
        card.className = 'paper-card';
        card.id = 'paper-' + p.id;
        card.innerHTML = `<div class="meta">${escape(p.citation)}</div><h2>${escape(p.title)}</h2><div class="meta">${escape(p.kind)} ${relevant(p) ? '<span class="match">Current selection</span>' : ''}</div><p>${escape(p.summary)}</p><div class="paper-actions"><a href="${escape(p.url)}" target="_blank" rel="noopener">Read source ↗</a><button data-paper-model="${p.id}">◇ Related anatomy</button>${p.doi ? `<a href="https://doi.org/${p.doi}" target="_blank" rel="noopener">DOI ↗</a>` : ''}</div>`;
        card.querySelector('button').onclick = () => {
            const levels = relevant(p) ? config.levels : p.levels[0];
            const construct = p.id === 'gajski' ? 'plated' : config.construct;
            if (levels !== config.levels || construct !== config.construct) choose({levels,construct});
            const preferred = ({gajski:'plate',he:'cage',zhang:'cage',kang:'cage',uncinate:'foramen',ao:'interval',
                valero:'foramen',yin:'longus',aaos:'orient',dcm:'orient'})[p.id];
            const index = steps.findIndex(s => s.phase === preferred);
            setTab('steps'); setMode('3d');
            activate(index < 0 ? Math.max(0,steps.findIndex(s => s.sources.includes(p.id))) : index);
            applyRecommendedView();
        };
        $('#papers').append(card);
    } $('#paperEmpty').hidden = count > 0; $('#paperCount').textContent = papers.length; }
    $('#paperSearch').oninput = renderPapers;
    function openPaper(id) { setTab('papers'); $('#paperSearch').value = ''; renderPapers(); $('#paper-' + id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    function captureStepImages() { if (!available || typeof canvas.toDataURL !== 'function')
        return manifest.study_plates || []; const saved = { viewQ, camFrame, poseOverride, distance, viewZoom, pan: [...pan], selected, opening, procedure, contextSide, separateLayers, enabled: { ...enabled }, allEnabled: { ...allEnabled }, beforeCurrent, regionalContext, hidden: meshes.map(m => m.hidden) }; const s = steps[stage], vside = stepView(s), images = []; capturing = true; try {
        viewZoom = 1;
        regionalContext = saved.regionalContext;
        selected = -1;
        opening = 1;
        procedure = true;
        for (const k in enabled)
            enabled[k] = persistentLayers.has(k) || s.groups.includes(k);
        meshes.forEach(m => m.hidden = false);
        poseOverride = null; // plates show the pose the step itself requests
        // Plate cameras: the step's recommended camera (head-framed, except the world-framed 'position' view) and,
        // without a stage change, a second head-framed oblique view.
        const second = {...vside,frame:'head',eye:undefined,up:undefined,yaw:.76*sideSign(),pitch:.29,
            target:[0,stageLevel() ? anatomy.levels[stageLevel()].y : centerLevel(),-.48],distance:9.8,
            title:'Anterior oblique view'};
        const views = s.phase === 'verify' ? [
            {...vside,yaw:0,pitch:0,title:'Anterior Construct'},
            {...vside,yaw:Math.PI/2*sideSign(),pitch:0,title:'Lateral Construct'}
        ] : hasStageChange() ? [{...vside,title:'Before this step',before:true},
            {...vside,title:'After this step',before:false},second] : [{...vside,title:'Approach view'},second];
        for (const v of views) {
            beforeCurrent = v.before ?? saved.beforeCurrent;
            updatePose(); // Render the plate with its own patient pose.
            applyCamera(v);
            viewZoom = v.zoom ?? 1;
            pan = [0, 0];
            separateLayers = false;
            draw(false);
            images.push({ image: canvas.toDataURL('image/png'), alt: v.title + ' for ' + s.title, caption: v.title + ' · ' + operativeSide() });
        }
    }
    catch (error) {
        console.warn('2D snapshot unavailable', error);
        return manifest.study_plates || [];
    }
    finally {
        viewQ = saved.viewQ;
        camFrame = saved.camFrame;
        poseOverride = saved.poseOverride;
        distance = saved.distance;
        viewZoom = saved.viewZoom;
        viewChanged();
        pan = saved.pan;
        selected = saved.selected;
        opening = saved.opening;
        procedure = saved.procedure;
        contextSide = saved.contextSide;
        separateLayers = saved.separateLayers;
        beforeCurrent = saved.beforeCurrent;
        regionalContext = saved.regionalContext;
        Object.assign(enabled, saved.enabled);
        Object.assign(allEnabled, saved.allEnabled);
        meshes.forEach((m, i) => m.hidden = saved.hidden[i]);
        capturing = false;
        draw(false);
    } return images; }
    function showDiagram() {
        const p=$('#figurepanel'), images=captureStepImages(), phase=steps[stage].phase;
        const side=operativeSide(), sx=side==='left'?1:-1;
        const layers=[['Skin and Subcutaneous Tissue','#d9a184'],['Platysma','#bd8274'],
            ['Investing Fascia','#a4c7ba'],['Carotid Sheath Lateral · Trachea and Esophagus Medial','#c8b3a0'],
            ['Prevertebral Fascia','#75a99a'],['Longus Colli and Anterior Vertebral Column','#d0c3a5']];
        p.innerHTML=`<div class="diagram"><h2>${escape(titleCase(steps[stage].title))}</h2>
            <div class="reference-plates">${images.map((im,i)=>`<figure><img src="${im.image}" alt="${escape(im.alt)}" data-expand="${i}"><figcaption>${escape(im.caption)}</figcaption><button class="image-save" data-save="${i}">Save PNG</button></figure>`).join('')}</div>
            <details class="plane-details" ${['interval','fascia','longus'].includes(phase)?'open':''}><summary>Anterior Cervical Tissue Planes</summary>
            <svg viewBox="0 0 740 295" role="img" aria-label="The superficial to deep layers of the anterior cervical approach">
            <g font-family="system-ui" font-size="14" fill="#dce9dd">${layers.map(([name,color],i)=>`<rect x="22" y="${15+i*45}" width="185" height="26" rx="6" fill="${color}"/><text x="230" y="${33+i*45}">${escape(name)}</text>`).join('')}</g></svg></details>
            <details class="plane-details" ${phase==='interval'?'open':''}><summary>Axial Approach Corridor</summary>
            <svg viewBox="0 0 580 355" role="img" aria-label="Axial ${side} anterior approach between the visceral and carotid complexes">
                <g font-family="system-ui" fill="#e7e8e2" font-size="14">
                <text x="290" y="30" text-anchor="middle">Anterior</text><text x="290" y="337" text-anchor="middle">Posterior</text>
                <text x="26" y="178">Patient Right</text><text x="459" y="178">Patient Left</text>
                <rect x="223" y="185" width="134" height="86" rx="34" fill="#b9a589"/><text x="290" y="232" text-anchor="middle" fill="#132029">Vertebral Body</text>
                <ellipse cx="290" cy="284" rx="36" ry="14" fill="#a9b7c5"/><text x="290" y="311" text-anchor="middle">Spinal Cord</text>
                <ellipse cx="290" cy="91" rx="45" ry="27" fill="#92746f" stroke="#d1a79a"/><text x="290" y="96" text-anchor="middle">Trachea</text>
                <ellipse cx="290" cy="132" rx="34" ry="12" fill="#9c685d"/><text x="290" y="162" text-anchor="middle">Esophagus</text>
                ${[-1,1].map(d=>`<ellipse cx="${290+d*126}" cy="124" rx="28" ry="39" fill="none" stroke="#71949c" stroke-dasharray="4 3"/><circle cx="${290+d*119}" cy="112" r="12" fill="#db6d70"/><circle cx="${290+d*136}" cy="136" r="13" fill="#627cb6"/><text x="${290+d*126}" y="69" text-anchor="middle">Carotid Sheath</text><ellipse cx="${290+d*60}" cy="191" rx="23" ry="11" fill="#a96d63"/>`).join('')}
                <path d="M ${290+sx*88} 52 Q ${290+sx*74} 136 ${290+sx*13} 181" stroke="#e7c677" stroke-width="4" fill="none" stroke-dasharray="7 6"/><path d="M ${290+sx*24} 175 L ${290+sx*13} 181 L ${290+sx*22} 187" stroke="#e7c677" stroke-width="3" fill="none"/></g></svg></details></div>`;
        p.querySelectorAll('[data-expand]').forEach(img=>img.onclick=()=>img.parentElement.classList.toggle('expanded'));
        p.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>{
            const im=images[+b.dataset.save];
            downloadBlob(new Blob([decode64(im.image.split(',')[1])],{type:'image/png'}),
                'acdf-'+steps[stage].id+'-'+(+b.dataset.save+1)+'.png');
        });
    }
    function rebuild({ reset = false } = {}) { animationToken++; const old = steps[stage]?.id; steps = buildSteps(); $('#steps').replaceChildren(); steps.forEach((s, i) => { const card = document.createElement('article'); card.className = 'step'; card.tabIndex = 0; card.innerHTML = `<div class="step-heading"><span class="step-number">${String(i + 1).padStart(2, '0')}</span><div class="step-heading-text"><h2>${escape(titleCase(s.title))}</h2></div></div><p>${escape(s.body)}</p>`; card.onclick = () => activate(i); card.onkeydown = e => { if (e.target === card && ['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        activate(i);
    } }; $('#steps').append(card); }); renderPapers(); renderIndications(); activate(reset ? 0 : Math.max(0, steps.findIndex(s => s.id === old))); $('#planLive').textContent = steps.length + ' guide steps. Configuration updated.'; }
    function choose(c) { config = { ...c }; for (const [k, v] of Object.entries(config))
        $(`input[name="${k}"][value="${v}"]`).checked = true; rebuild(); }
    function variantSnapshot() {
        const current=config, results=[];
        try {
            for (const choice of configs) { config=choice; results.push({config:choice,steps:buildSteps()}); }
        } finally { config=current; }
        return results;
    }
    $$('.config input').forEach(i => i.onchange = e => { config[e.target.name] = e.target.value; rebuild(); });
    function syncControls() { $$('[data-layer]').forEach(e => e.checked = enabled[e.dataset.layer]); $$('[data-swatch]').forEach(e => e.style.background = palettes[palette][e.dataset.swatch]); if ($('#palette'))
        $('#palette').value = palette; $$('[data-all-layer]').forEach(e => e.checked = allEnabled[e.dataset.allLayer]); $('#side').value = contextSide; $('#procedure').checked = procedure; $('#prelabels').checked = prelabelsOn; $('#instruments').checked = instrumentsOn; }
    const persistentLayers = new Set(['brain','arteries','veins','nerves']);
    function applyRecommendedView({ preserveCamera = false } = {}) { const s = steps[stage]; for (const k in enabled)
        enabled[k] = persistentLayers.has(k) || s.groups.includes(k); contextAlpha = 1; procedure = true; meshes.forEach(m => m.hidden = false); if (!preserveCamera) {
        cameraExplicit = false;
        viewZoom = 1;
        regionalContext = true;
        for (const k in allEnabled)
            allEnabled[k] = false;
        stopGlide();
        applyCamera(stepView(s)); // head-framed, or world-framed for the 'position' step
        pan = [0, 0];
    } $('#presetname').textContent = titleCase(s.title); syncControls(); clearSelection(); playStepAnimation(); updateChangeControls(); render(); }
    let activeStepId = null;
    function activate(i) { animationToken++; stopGlide(false); startPoseBlend(); poseOverride = null; beforeCurrent = false; $('#compareChange').setAttribute('aria-pressed', false); $('#compareChange').textContent = 'Before'; stage = Math.max(0, Math.min(steps.length - 1, i)); opening = 1; $$('.step').forEach((c, j) => { c.classList.toggle('active', j === stage); c.setAttribute('aria-current', j === stage ? 'step' : 'false'); }); $('#stagecaption').textContent = String(stage + 1).padStart(2, '0') + ' · ' + titleCase(steps[stage].title); $('#stagecount').textContent = String(stage + 1).padStart(2, '0') + ' / ' + steps.length; $('#previous').disabled = stage === 0; $('#next').disabled = stage === steps.length - 1; // Entering the 'position' step glides the camera to the step's room-fixed view while the head turns into the
    // operative pose (the camera is pinned to the room, so the head moves rather than the room around it). Leaving it
    // with that framing untouched glides on to the new step's recommended (head-framed) view, so the walkthrough
    // returns to the anatomy, which then looks as it did before positioning existed.
    const changed = activeStepId !== steps[stage].id; if (changed && !cameraExplicit && steps[stage].change === 'position') {
        glideCamera(stepView(steps[stage]), 1100);
        roomCameraAuto = true;
    }
    else if (changed && !cameraExplicit && (roomCameraAuto || activeStepId === 'position' && camFrame === 'world')) {
        glideCamera(stepView(steps[stage]), 900);
        roomCameraAuto = false;
    } activeStepId = steps[stage].id; applyRecommendedView({ preserveCamera: true }); updateChangeControls(); updateMobileReaderHeight(); alignActiveStep(); if (mode === '2d')
        showDiagram(); }
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
        showDiagram();
    else
        render(); };
    $('#focusChange').onclick = () => applyRecommendedView();
    $('#regionalContext').onclick = toggleFullContext;
    $('#compareChange').onclick = () => { startPoseBlend(); beforeCurrent = !beforeCurrent; animationToken++; opening = 1; $('#opening').value=100; $('#openingValue').textContent='100%'; $('#compareChange').setAttribute('aria-pressed', beforeCurrent); $('#compareChange').textContent = beforeCurrent ? 'After' : 'Before'; if (mode === '2d')
        showDiagram();
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
    $('#opening').oninput = e => { animationToken++; beforeCurrent=false; $('#compareChange').textContent='Before'; $('#compareChange').setAttribute('aria-pressed',false); opening = +e.target.value / 100; $('#openingValue').textContent = Math.round(opening * 100) + '%'; render(); };
    // Model point -> view space (JS mirror of the vertex shader: p = uView * (q - uTarget)).
    function transform(p) { const { M, target: t } = viewBasis(); return mApply(M, [p[0] - t[0], p[1] - t[1], p[2] - t[2]]); }
    // Eye position in the canonical (operative-side = right) model frame used by the fragment shader (vOriginal).
    function cameraPosition() { const { M, target: t } = viewBasis(); return canonicalPoint(vAdd(t, mApply(mT(M), [0, 0, distance]))); }
    // Pan is a screen offset in CSS pixels, shared by drawing, picking and labels.
    function project(p) {
        const t = transform(p), magnification = scale * viewZoom / (distance - t[2]);
        const x = (1 + t[0] * magnification / aspect) * host.clientWidth / 2;
        const y = (1 - t[1] * magnification) * host.clientHeight / 2;
        return [x + pan[0], y + pan[1]];
    }
    const smoothstep01 = t => t * t * (3 - 2 * t);
    // ---- Soft-tissue curl / peel ------------------------------------------------------------------------------------
    // Flaps fold by the FLAP CONTRACT shared with the data build (record.flap = {key, pivot, axis, away, lift, radius,
    // angle}; reference: tools/anatomy_build/scalp.py flap_deform). With v = p - pivot, d = v.away and h = v.lift, a
    // point with d > 0 wraps a cylinder of radius R about the hinge for an arc of R*T and the rest of the flap continues
    // straight, folded by T. Normals turn with it, the baked AO (normal length) is kept, and only the away/lift plane
    // is used, so x-mirrored fields work for left-sided records. The renderer refines the contract into a peel:
    //  1. Hinge travel: the hinge starts at the flap's free edge (d = dmax) and moves to the base (d = 0) while the
    //     freed part is held folded by thetaS (dissection from the incision toward the base); then the fold completes
    //     to the final angle Tf. At progress 1 the result is the contract with the hinge at the record pivot.
    //  2. Hinge height: the pivot moves along `lift` to the highest point of the motion's outer surface near the
    //     current hinge line, tabulated over the axial coordinate a = v.axis (CURL_NA bins) and the hinge travel
    //     (CURL_ND rows). The roll therefore stays tangent to the tissue, and deeper layers folding about the same hinge
    //     roll outside shallower ones (row 0 plays the role of the record's optional hingeProfile).
    // The same mapping runs in the vertex shader and in curlPoint (labels, picking anchors, depth sort). Points are raw
    // model coordinates of the mesh's own side; the head pose lives only in uView.
    function curlPoint(cs, p, n) { const { mo, dh, T, row } = cs, v = vSub(p, mo.pivot), d = vDot(v, mo.away), dd = d - dh; if (dd <= 0)
        return n ? [p, n] : p; const fi = Math.max(0, Math.min(CURL_NA - 1, (vDot(v, mo.axis) - mo.prof.a0) * mo.prof.ia)), i0 = Math.floor(fi), i1 = Math.min(i0 + 1, CURL_NA - 1), hp = row[i0] + (row[i1] - row[i0]) * (fi - i0), hh = vDot(v, mo.lift), R = mo.R, s = Math.min(dd, R * T), ph = s / R, c = Math.cos(ph), sn = Math.sin(ph), aw = vAdd(vScale(mo.away, c), vScale(mo.lift, sn)), li = vSub(vScale(mo.lift, c), vScale(mo.away, sn)), rest = vSub(v, vAdd(vScale(mo.away, d), vScale(mo.lift, hh))); let q = [mo.pivot, vScale(mo.away, dh + R * sn), vScale(mo.lift, hp + R * (1 - c)), rest, vScale(aw, dd - s), vScale(li, hh - hp)].reduce(vAdd); if (cs.wD > 0 && dd > s)
        q = vAdd(q, vScale(li, cs.wD * smoothstep01(clamp01((dd - s) / DRAPE_BLEND)) * drapeAt(mo.drape, vDot(v, mo.axis), d))); if (!n)
        return q; const na = vDot(n, mo.away), nl = vDot(n, mo.lift); return [q, vAdd(n, vAdd(vScale(vSub(aw, mo.away), na), vScale(vSub(li, mo.lift), nl)))]; }
    function labelPoint(m) { return movePoint(m,m.labelAnchor || m.anchor); }
    $('#separateLayers').onclick = () => {
        separateLayers=!separateLayers;
        $('#separateLayers').setAttribute('aria-pressed',separateLayers);
        $('#separateLayers').textContent=separateLayers?'Join Fascial Layers':'Separate Fascial Layers';
        if (separateLayers) enabled.fat=enabled.galea=enabled.fascia=enabled.deepfascia=enabled.muscle=true;
        syncControls(); clearSelection(); render();
    };
    const labelVisibility = new Set(), surfaceAnchors = new Map();
    let pickPixels = null, pickWidth = 0, pickHeight = 0, anchorScanReady = false;
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
    function cacheLabelVisibility() { labelVisibility.clear(); surfaceAnchors.clear(); anchorScanReady=false; if (!available || !pickTarget)
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
    function candidatesForLabel(m) { const spec = procedureLabelRegion(m), key = spec.target.join(',') + '|' + spec.radius; if (m.procedureCandidates?.key === key)
        return m.procedureCandidates.points; const a = m.vertexData, points = [], seen = new Set(); if (a)
        for (let i = 0; i < a.length; i += 6) {
            const p = [a[i], a[i + 1], a[i + 2]];
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
    }
    if (pickPixels && !anchorScanReady && opening >= 1) {
        for (const [id,anchor] of scanPickAnchors(pickPixels,pickWidth,pickHeight,host.clientWidth,host.clientHeight)) {
            surfaceAnchors.set(id,anchor);
            labelVisibility.add(id);
        }
        anchorScanReady=true;
    }
    const sample = surfaceAnchors.get(m.index);
    if (sample) return {x:sample.x,y:sample.y,visible:true};
    const q = project(movePoint(m, spec.target)); return { x: q[0], y: q[1], visible: false }; }
    function fixedLabelRect(w, h) { return { x: Math.max(8, Math.min(14, host.clientWidth - w - 8)), y: Math.max(8, Math.min(isMobile ? 36 : 86, host.clientHeight - h - (isMobile ? 64 : 100))), w, h }; }
    let labelKey = '';
    function clearSelection() { selected = -1; labelKey = ''; render(); }
    function select(i) { if (i < 0 || i >= meshes.length || !visible(meshes[i])) {
        clearSelection();
        return;
    } selected = i; labelKey = ''; render(); }
    function positionPopup() { return null; }
    function updateStepLabels(hidden) { const popup = $('#popup'), svg = $('#labelLines'); $('#stepLabels').replaceChildren(); svg.replaceChildren(); if (mode !== '3d') {
        popup.hidden = true;
        return;
    } const m = activeLabelMesh(hidden); if (!m) {
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
    if (interactionActive) return;
    const a = regionSurfaceAnchor(m), r = fixedLabelRect(popup.offsetWidth || 190, popup.offsetHeight || 75); popup.style.left = r.x + 'px'; popup.style.top = r.y + 'px'; $('#labelStatus').textContent = a.visible ? '' : 'Region hidden in this view'; if (a.visible) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', a.x);
        line.setAttribute('y1', a.y);
        line.setAttribute('x2', Math.max(r.x, Math.min(r.x + r.w, a.x)));
        line.setAttribute('y2', Math.max(r.y, Math.min(r.y + r.h, a.y)));
        svg.append(line);
    } }
    function setView(v) {
        const views = { anterior: [0, 0], right: [Math.PI / 2, 0], left: [-Math.PI / 2, 0], superior: [0, 1.5] };
        if (!views[v]) return;
        setCamera({ frame: 'head', yaw: views[v][0], pitch: views[v][1], pan: [0, 0] });
    }
    // Move to the surgeon camera position and keep the user’s pan and lens zoom.
    function setSurgeonView() {
        setCamera({ frame: 'world', eye: [-.59 * sideSign(), .05, .81], up: [0, 1, 0], distance: 16 });
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
        return; attachCamera('world'); startPoseBlend(); poseOverride = next; syncPoseControls(); render(); }
    function resetPose() { attachCamera('world'); startPoseBlend(); poseSettings = { ...POSE_DEFAULT }; syncPoseControls(); render(); }
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
    const PROP_COLORS = {holder:hexRgb('#7fd6e8'),table:hexRgb('#8aa4ae')};
    let propBuffer=null, propCache=null;
    function propsVisible() { return propsOn && (mode==='3d'||capturing) && camFrame==='world' && headFixed(); }
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
    // Soft support outline and operating table expressed in room coordinates.
    function propGeometry() {
        const key=poseR.map(x=>x.toFixed(4)).join();
        if (propCache?.key===key) return propCache;
        const holder=[],table=[], room=p=>poseInverse(p);
        const support=Array.from({length:29},(_,i)=>{
            const a=i/28*Math.PI;
            return room([2.45*Math.cos(a),5.2+1.35*Math.sin(a),-4.38]);
        });
        tubeInto(holder,support,.12,true);
        const frame=[[-5.9,7.3,-5.34],[5.9,7.3,-5.34],[5.9,-6,-5.34],[-5.9,-6,-5.34],[-5.9,7.3,-5.34]];
        tubeInto(table,frame.map(room),.067);
        propCache={key,data:new Float32Array([...holder,...table]),parts:[
            {first:0,count:holder.length/6,rgb:PROP_COLORS.holder},
            {first:holder.length/6,count:table.length/6,rgb:PROP_COLORS.table}],uploaded:false};
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
    } for (const [n, v] of [['Material', -1], ['IsMarker', 1], ['Line', 0], ['MarkKind', 0], ['MarkReveal', 1], ['Cut', 0], ['Burrs', 0], ['Change', 0], ['FlapAngle', 0], ['Selected', 0], ['Region', 0], ['FisVeil', 0], ['WindowAction', 1], ['Action', 1], ['Motion', 0], ['Side', sideSign()], ['CurlOn', 0], ['PartOn', 0], ['IncReveal', 0], ['SplitKind', 0], ['SplitPass', 0]])
        gl.uniform1f(uniforms[n], v); gl.uniform4f(uniforms.CervicalCut,0,0,0,0); gl.uniform3fv(uniforms.Offset, [0, 0, 0]); for (const part of geo.parts) {
        gl.uniform4fv(uniforms.Color, picking ? [0, 0, 0, 1] : [...part.rgb, 1]);
        gl.drawArrays(gl.TRIANGLES, part.first, part.count);
    } bindVertexBuffer(buffer); }
    // ---- Orientation gizmo -----------------------------------------------------------------------------------------
    // Viewport corner: the posed head's patient axes (S superior, A anterior, R/L) and an amber gravity arrow onto a
    // small floor tile, seen through the current camera, so pose changes stay legible during orbit. The
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
    } box.querySelector('svg').innerHTML = svg + '<circle r="2.4" fill="#d7e5da"/>'; const p = poseShown, posed = POSE_KEYS.some(k => Math.abs(p[k]) > .5); box.querySelector('small').textContent = (posed ? `Pose ${Math.round(p.rotation)}° rot · ${Math.round(p.extension)}° ext${Math.round(p.lateral) ? ` · ${Math.round(p.lateral)}° tilt` : ''}` : 'Anatomical position') + '\n' + (camFrame === 'world' ? 'View fixed to room' : 'View follows anatomy'); }
    $$('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
    $('#resetView').onclick = () => applyRecommendedView();
    $('#manifestDownload').onclick = () => downloadBlob(new Blob([JSON.stringify(anatomy, null, 2)], { type: 'application/json' }), 'acdf-mesh-manifest.json');
    $('#exportPlan').onclick = () => downloadBlob(new Blob([JSON.stringify({
        model:modelIndex()+1,config,steps,papers,side:operativeSide(),contextSide,palette,
        layers:{relevant:{...enabled},all:{...allEnabled}},
        positioning:{operativePose:{...poseSettings},defaults:POSE_DEFAULT,units:'degrees'},
        limitations:manifest.limitations
    },null,2)],{type:'application/json'}),'acdf-reading-plan.json');
    $('#pdfRequests').onclick = () => downloadBlob(new Blob([papers.map(p=>[p.title,p.citation,p.url].join('\n')).join('\n\n')],
        {type:'text/plain'}),'acdf-sources.txt');
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
        m.vertexData=floats;
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferSubData(gl.ARRAY_BUFFER,m.first*24,floats);
        m.geometryReady=true; delete m.data;
    }
    function shader(type, text) { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(s)); return s; }
    function initGL() {
        gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
        if (!gl)
            throw Error('WebGL is unavailable');
        program = gl.createProgram();
        gl.attachShader(program, shader(gl.VERTEX_SHADER, `attribute vec3 aPosition;attribute vec3 aNormal;uniform mediump float uLine;uniform float uLinePx,uLineNudge;uniform float uDistance,uAspect,uScale,uMotion,uSide;uniform mat3 uView;uniform vec3 uGravity;uniform mediump float uAction;uniform vec2 uPan;uniform vec3 uTarget;uniform vec3 uOffset;uniform float uFlapAngle;uniform vec3 uFlapAxis,uFlapPivot;
uniform float uCurlOn,uCurlIA;uniform vec3 uCurlPivot,uCurlAxis,uCurlAway,uCurlLift;uniform vec4 uCurlP;uniform float uCurlRow[16];uniform float uDrapeW;uniform vec4 uDrapeP;uniform float uDrape[96];uniform float uPartOn,uIncReveal;uniform vec4 uPart;uniform vec3 uInc[24];uniform mediump float uSplitKind;uniform vec4 uSplitPlane;uniform vec2 uSplitInc;
varying mediump vec3 vNormal;varying highp vec3 vOriginal;varying highp vec3 vEye;varying mediump float vAO;varying mediump vec3 vObjN;varying highp float vSplit;varying highp float vIncT;
/* Curl / peel (see curlPoint in JS): hinge travelled uCurlP.z along away, pivot raised along lift to the tabulated
   hinge height uCurlRow over the axial coordinate (start uCurlP.w, 1/step uCurlIA); radius uCurlP.x, angle uCurlP.y.
   Drape (see drapeTable): beyond the roll, shift along li by uDrapeW x the 12 x 8 table uDrape over (a, d - R*Tf);
   uDrapeP = (a0, 1/da, 1/de, R*Tf). */
vec3 curlF(vec3 q){vec3 v=q-uCurlPivot;float d=dot(v,uCurlAway),dd=d-uCurlP.z;if(dd<=0.)return q;float a=dot(v,uCurlAxis),fi=clamp((a-uCurlP.w)*uCurlIA,0.,15.);int i0=int(floor(fi));int i1=i0<15?i0+1:15;float hp=mix(uCurlRow[i0],uCurlRow[i1],fi-float(i0)),hh=dot(v,uCurlLift),R=uCurlP.x,s=min(dd,R*uCurlP.y),ph=s/R,c=cos(ph),sn=sin(ph);vec3 aw=c*uCurlAway+sn*uCurlLift,li=c*uCurlLift-sn*uCurlAway;
 vec3 r=uCurlPivot+(uCurlP.z+R*sn)*uCurlAway+(hp+R*(1.-c))*uCurlLift+(v-d*uCurlAway-hh*uCurlLift)+(dd-s)*aw+(hh-hp)*li;
 if(uDrapeW>0.&&dd>s){float fa=clamp((a-uDrapeP.x)*uDrapeP.y,0.,11.),fe=clamp((d-uDrapeP.w)*uDrapeP.z,0.,7.);int j0=int(floor(fa));int k0=int(floor(fe));int j1=j0<11?j0+1:11;int k1=k0<7?k0+1:7;float u=fa-float(j0),w=fe-float(k0);
  r+=li*(uDrapeW*smoothstep(0.,.4,dd-s)*mix(mix(uDrape[k0*12+j0],uDrape[k0*12+j1],u),mix(uDrape[k1*12+j0],uDrape[k1*12+j1],u),w));}
 return r;}
void main(){vAO=length(aNormal);vOriginal=vec3(aPosition.x*uSide,aPosition.y,aPosition.z);vec3 q=aPosition;vec3 norm=aNormal/max(vAO,1e-4);vSplit=1.;vIncT=0.;
/* Incision (uInc, 24 points of this side): nearest segment in the plane tangent to the scalp shell (centre 0,-.4,-.4).
   uPart = (knife progress, gap, side sign, falloff): skin/galea edges part behind the knife. uSplitKind 3: signed
   offset to the flap side (uSplitInc = flap sign, margin), optionally limited by the plane uSplitPlane (n.p > w). */
if(uPartOn>.5||uSplitKind>2.5||uIncReveal>.5){vec3 rad=normalize(aPosition-vec3(0.,-.4,-.4));float best=1e3,bt=0.;vec3 tg=vec3(0.,1.,0.),be=vec3(0.);
 for(int i=0;i<23;i++){vec3 a=uInc[i],ab=uInc[i+1]-a;float t=clamp(dot(aPosition-a,ab)/max(dot(ab,ab),1e-8),0.,1.);vec3 e=aPosition-a-ab*t;e-=dot(e,rad)*rad;float d=length(e);if(d<best){best=d;bt=(float(i)+t)/23.;tg=ab;be=e;}}
 vec3 perp=normalize(cross(normalize(tg),rad));vIncT=bt;
 if(uSplitKind>2.5)vSplit=min(dot(be,perp)*uSplitInc.x-uSplitInc.y,dot(aPosition,uSplitPlane.xyz)-uSplitPlane.w);
 if(uPartOn>.5)q+=perp*(uPart.z*uPart.y*(1.-smoothstep(0.,uPart.w,best))*smoothstep(0.,.05,uPart.x*1.05-bt)*(1.-smoothstep(.94,1.,bt)));}
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
if(uLine>0.){float w0=uDistance-(uView*(q-uTarget)).z;q+=norm*max(0.,w0*uLinePx-uLine);}vec3 p=uView*(q-uTarget);vNormal=uView*norm;vObjN=vec3(aNormal.x*uSide,aNormal.yz)/max(vAO,1e-4);float w=uDistance-p.z;vEye=vec3(-p.x,-p.y,w);float wz=uLine>0.?max(w-uLineNudge,.05):w;gl_Position=vec4(p.x*uScale/uAspect+uPan.x*w,p.y*uScale+uPan.y*w,(1.0125786-1.0062893/wz)*w,w);}`));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform mediump float uLine;uniform vec4 uColor;uniform float uSelected,uPick,uRegion,uCut,uChange,uWindowAction,uBurrs,uIsMarker,uMarkKind,uMarkAxis,uMarkReveal,uMaterial,uSurgical,uQuality;uniform vec3 uMarkCenter;uniform vec2 uMarkRange,uViewport;uniform mediump float uAction;uniform vec4 uCervicalCut;uniform vec3 uCamPos;uniform float uFisVeil;uniform mediump float uSplitKind;uniform float uSplitPass;uniform vec4 uGroove;uniform vec3 uInner;varying mediump vec3 vNormal;varying vec3 vOriginal;varying vec3 vEye;varying mediump float vAO;varying mediump vec3 vObjN;varying float vSplit;varying float vIncT;
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
void main(){
if(uIsMarker>.5){
 if(uMarkReveal<=.001)discard;
 if(uMarkKind==2.){
   float p=uMarkAxis==0.?abs(vOriginal.x):uMarkAxis==2.?vOriginal.z:vOriginal.y;
   if((p-uMarkRange.x)/max(.001,uMarkRange.y-uMarkRange.x)>uMarkReveal)discard;
 }
}
if(uCervicalCut.x>.001 && vOriginal.z>uCervicalCut.y &&
   (uCervicalCut.z<.5 || abs(vOriginal.x)<.62))discard;
if(uPick>.5){gl_FragColor=uColor;return;}if(uLine>0.){vec3 n=normalize(vNormal),V=normalize(vEye);float nv=abs(dot(n,V));vec3 c=uColor.rgb*(.82+.18*max(0.,dot(n,normalize(vec3(-.35,.55,1.)))))+vec3(.10)*pow(nv,30.);c=mix(uColor.rgb*.45,c,smoothstep(.12,.45,nv));if(uSelected>.5)c=mix(c,vec3(.66,1.,.62),.5);gl_FragColor=vec4(c,1.);return;}
vec3 n=normalize(vNormal),V=normalize(vEye);float nv=dot(n,V),ao=clamp(vAO,0.,1.),alpha=uColor.a,rim=pow(1.-abs(nv),2.);bool tissue=uMaterial>-.5&&uIsMarker<.5,arach=uMaterial>8.5&&uMaterial<9.5,skin=uMaterial>9.5&&uMaterial<10.5;
/* skin slab faces (rest pose): outer skin srad > .45, inner (subcutaneous) < -.45, cut walls between; wall vertex
   normals are tilted +-.34 toward/away from the shell centre at load, so srad runs from the epidermis (+.34) to the
   deep subcutaneous edge (-.34) across a wall. */
float srad=skin?abs(normalize(vObjN).z):1.;
float light=.30+.55*abs(dot(n,normalize(vec3(-.5,.7,1.))))+.12*abs(dot(n,normalize(vec3(.9,-.2,.3))));vec3 c=uColor.rgb*light;
if(tissue&&uSurgical<.5){if(skin&&srad<.45)c=uInner*light;c*=mix(1.,ao,.75);if(arach)alpha=clamp(alpha*(.55+.8*rim),0.,.85);}
if(tissue&&uSurgical>.5){
 if(nv<0.)n=-n;nv=abs(nv);
 vec3 P=vOriginal,base=uColor.rgb;float shin=30.,specI=.2,wrap=.3,sss=0.;
 if(uMaterial<.5){base*=.88+.16*fbm(P*38.);shin=14.;specI=.05;wrap=.1;}
 else if(uMaterial<1.5){float m=fbm(P*9.);base*=.91+.13*m;float v=smoothstep(.975,.995,ridge(P*3.+m*1.2))*.12+smoothstep(.985,.997,ridge(P*8.+3.1))*.06;base=mix(base,vec3(.66,.24,.25),v*mix(.6,1.,ao));shin=70.;specI=.42;wrap=.55;sss=.45;}
 else if(uMaterial<2.5){base*=.74+.42*vnoise(vec3(P.x*70.,P.y*3.5,P.z*70.));shin=36.;specI=.28;wrap=.45;sss=.35;}
 else if(uMaterial<3.5){base*=.88+.16*vnoise(vec3(P.x*55.,P.y*6.,P.z*55.));shin=95.;specI=.55;wrap=.35;}
 else if(uMaterial<4.5){float l=fbm(P*9.);base*=.92+.1*smoothstep(.25,.75,l)-.05*smoothstep(.95,.995,ridge(P*9.+l));shin=60.;specI=.3;wrap=.65;sss=.4;}
 else if(uMaterial<5.5){base*=.94+.08*vnoise(P*30.);shin=90.;specI=.55;wrap=.35;sss=.3;}
 else if(uMaterial<6.5){base*=.9+.12*vnoise(P*48.);shin=55.;specI=.32;wrap=.45;sss=.15;}
 else if(uMaterial<7.5){float m=fbm(P*5.);base*=.94+.06*m+.05*vnoise(vec3(P.x*30.,P.y*90.,P.z*30.));base=mix(base,vec3(.64,.67,.74),.22*smoothstep(.35,.75,fbm(P*2.3+3.)));shin=150.;specI=.24;wrap=.35;sss=.1;}
 else if(uMaterial<8.5){base*=.9+.12*vnoise(P*26.);shin=110.;specI=.6;wrap=.3;sss=.2;}
 else if(uMaterial<9.5){shin=130.;specI=.75;wrap=.6;}
 else if(uMaterial<10.5){
  /* skin: mottled warm epidermis with fine pores and a faint sheen; cut edge = pink-white dermis over lobulated
     yellow subcutaneous fat with a thin bloody line at the epidermis; inner face = subcutaneous fat */
  if(srad>.45){float m=fbm(P*6.);base*=.9+.13*m;base=mix(base,base*vec3(1.07,.86,.84),.3*smoothstep(.45,.8,fbm(P*2.3+5.)));base*=1.-.07*NOISE*smoothstep(.68,.9,vnoise(P*95.));shin=24.;specI=.13;wrap=.5;sss=.6;}
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
float edge=uCervicalCut.x>.001 ? abs(vOriginal.z-uCervicalCut.y) : 1.;
if(edge<.038)c=mix(c,vec3(.71,.49,.40),.4*(1.-edge/.038));
if(uChange==5.)c=mix(c,vec3(1.,.65,.17)*(.6+.4*light),.14+.20*rim);
if(uSelected>.5)c=mix(c,vec3(.66,1.,.62),.50);if(uIsMarker>.5)c=mix(c,uColor.rgb,.8);gl_FragColor=vec4(c,alpha);}`));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw Error(gl.getProgramInfoLog(program));
        gl.useProgram(program);
        ['View', 'Gravity', 'Distance', 'Aspect', 'Scale', 'Pan', 'Color', 'Selected', 'Pick', 'Region', 'Target', 'Cut', 'Motion', 'Action', 'Offset', 'Change', 'WindowAction', 'FlapAngle', 'Side', 'Burrs', 'IsMarker', 'Line', 'LinePx', 'LineNudge', 'MarkKind', 'MarkAxis', 'MarkReveal', 'MarkCenter', 'MarkRange', 'Material', 'Surgical', 'Quality', 'Viewport', 'CervicalCut', 'FlapAxis', 'FlapPivot', 'CamPos', 'FisVeil', 'CurlOn', 'CurlIA', 'CurlPivot', 'CurlAxis', 'CurlAway', 'CurlLift', 'CurlP', 'CurlRow', 'DrapeW', 'DrapeP', 'Drape', 'PartOn', 'Part', 'Inc', 'IncReveal', 'SplitKind', 'SplitPlane', 'SplitInc', 'SplitPass', 'Groove', 'Inner'].forEach(n => uniforms[n] = gl.getUniformLocation(program, 'u' + n));
        let vertexCount = 0;
        meshes.forEach((m, i) => { m.index = i; m.hidden = false; m.first = vertexCount; vertexCount += m.count; m.rgb = m.color.match(/\w\w/g).map(x => parseInt(x, 16) / 255); m.innerRgb = m.innerColor ? hexRgb(m.innerColor) : null; m.surgicalTint=null; });
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
        window.guideQA = { solidDepth: true, zoomBy, syncMobileLayout, alignActiveStep, updateMobileReaderHeight, changeKind, procedureLabelRegion, activeLabelMesh, fixedLabelRect, visible, indicationGroups, chooseIndication, setProcedureSide, operativeSide, sideSign, canonicalPoint, onOperativeSide, relevantMesh, stepView, baseId, meshSide, meshOffset, scanPickAnchors, pickIdAt, meshCount: meshes.length, vertexCount, draw, activate, choose, configs, select, setTab, setView, enabled, allEnabled, getMeshes: () => meshes.map(({ data, vertexData, procedureCandidates, fissureCache, ...m }) => m), visibleCount: () => meshes.filter(visible).length, getSteps: () => steps, getState: () => ({ palette, viewZoom, isMobile, config: { ...config }, model: modelIndex() + 1, stage, mode, selected, contextAlpha, contextSide, prelabelsOn, opening, beforeCurrent, regionalContext, instrumentsOn, separateLayers, ...cameraState(), distance, pan: [...pan], enabled: { ...enabled }, allEnabled: { ...allEnabled } }), surgicalState, setPalette, opacity, refreshLabels: () => updateStepLabels(),
            // Camera / head-pose API (see the orientation and head-positioning blocks near the top of this file).
            getCamera: () => ({ q: [...viewQ], frame: camFrame, target: camFrame === 'world' ? posePoint(anatomyCenter) : [...anatomyCenter], distance, pan: [...pan], viewZoom }), setCamera, rotateByDrag: (dx, dy) => { stopGlide(); rotateByDrag(dx, dy); render(); }, rollView: a => { stopGlide(); rollView(a); render(); }, attachCamera: f => { attachCamera(f); render(); }, viewBasis: () => ({ M: [...viewBasis().M], target: [...viewBasis().target] }), project, transform, pickAt: (x, y) => { draw(true); cacheLabelVisibility(); const id = pickIdAt(x, y); draw(); return id; }, setSurgeonView,
            getPose: poseState, setPose, setPoseMode, resetPose, gravityInModel, posePoint, poseInverse, posePivot: [...POSE_PIVOT], poseDefault: { ...POSE_DEFAULT },
            // Soft-tissue deformation (curl / peel, incision parting, two-pass regions); see the curl block above.
            stateProgress, movePoint: (i, p) => movePoint(meshes[i], p), getDeformation: i => { const d = deformation(meshes[i]); return d && { curl: d.curl && { key: d.curl.mo.key, progress: d.curl.P, hingeTravel: d.curl.dh, angle: d.curl.T, radius: d.curl.mo.R, dmax: d.curl.mo.dmax }, split: d.split && { kind: d.split.kind, margin: d.split.margin, plane: d.split.plane }, part: d.part && { reveal: d.part.reveal, gap: d.part.gap, sign: d.part.sign }, groove: d.groove, leafCut: !!d.leafCut }; }, curlTuning, variantSnapshot };
        $('#loading').hidden = true;
        render();
    }
    let pickTarget=null;
    function preparePickTarget(w, h) { if (pickTarget && pickTarget.w === w && pickTarget.h === h)
        return; if (pickTarget) {
        gl.deleteFramebuffer(pickTarget.fbo);
        gl.deleteTexture(pickTarget.texture);
        gl.deleteRenderbuffer(pickTarget.depth);
    } const fbo = gl.createFramebuffer(), texture = gl.createTexture(), depth = gl.createRenderbuffer(); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth); if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw Error('Selection buffer is unavailable'); pickTarget = { fbo, texture, depth, w, h }; gl.bindTexture(gl.TEXTURE_2D, null); gl.bindRenderbuffer(gl.RENDERBUFFER, null); }
    function setCurlUniforms(cs) { gl.uniform1f(uniforms.CurlOn, cs ? 1 : 0); if (!cs)
        return; const mo = cs.mo; gl.uniform3fv(uniforms.CurlPivot, mo.pivot); gl.uniform3fv(uniforms.CurlAxis, mo.axis); gl.uniform3fv(uniforms.CurlAway, mo.away); gl.uniform3fv(uniforms.CurlLift, mo.lift); gl.uniform4f(uniforms.CurlP, mo.R, cs.T, cs.dh, mo.prof.a0); gl.uniform1f(uniforms.CurlIA, mo.prof.ia); gl.uniform1fv(uniforms.CurlRow, cs.row); const dr = cs.wD > 0 && mo.drape; gl.uniform1f(uniforms.DrapeW, dr ? cs.wD : 0); if (dr) {
        gl.uniform4f(uniforms.DrapeP, dr.a0, dr.ia, dr.ie, dr.RT);
        gl.uniform1fv(uniforms.Drape, dr.tab);
    } }
    let drawLimitCache = 0;
    function drawLimit() { if (!drawLimitCache) {
        const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
        drawLimitCache = Math.max(256, Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096, vp ? Math.min(vp[0], vp[1]) : 4096));
    } return drawLimitCache; }
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
        gl.uniform3fv(uniforms.Gravity, gravityInModel());
        gl.uniform1f(uniforms.Distance, distance);
        gl.uniform1f(uniforms.Aspect, aspect);
        gl.uniform1f(uniforms.Scale, scale * viewZoom); gl.uniform1f(uniforms.LinePx, 2 * LINE_MIN_HALF_PX / (scale * viewZoom * gl.drawingBufferHeight)); gl.uniform1f(uniforms.LineNudge, LINE_NUDGE);
        // Scale by w in the vertex shader so the offset is uniform after perspective division.
        gl.uniform2f(uniforms.Pan, 2 * pan[0] / Math.max(1, host.clientWidth),
            -2 * pan[1] / Math.max(1, host.clientHeight));
        gl.uniform3fv(uniforms.Target, viewBasis().target);
        gl.uniform1f(uniforms.Pick, picking ? 1 : 0);
        gl.uniform1f(uniforms.Surgical, palette === 'surgical' ? 1 : 0);
        gl.uniform1f(uniforms.Quality, isMobile ? 0 : 1);
        gl.uniform2f(uniforms.Viewport, w, h);
        gl.uniform3fv(uniforms.CamPos, cameraPosition());
        const hidden = hiddenByClearance();
        const list=meshes.filter(m=>baseVisible(m) && !hidden.has(m.id));
        gl.disable(gl.BLEND);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        drawProps(picking); // schematic head holder and table (room views only); restores the anatomy buffer
        for (const m of list) {
            ensureGeometry(m);
            const flat=!(m.group in materialIds);
            let rgb=palette==='surgical' && !flat ? surgicalRgb[m.group] : m.rgb;
            if(picking) {
                const id=m.index+1; rgb=[(id&255)/255,((id>>8)&255)/255,((id>>16)&255)/255];
            }
            const cut=cutProgress(m), [lo,hi]=m.bounds;
            const limit=hi[2]-(hi[2]-lo[2])*cut;
            gl.uniform4f(uniforms.CervicalCut,cut,limit,m.group==='disc'&&cut<=.25?1:0,0);
            for(const [name,value] of [
                ['Material',flat?-1:materialIds[m.group]],['IsMarker',+!!m.marker],
                ['Line',m.marker ? (m.markerRadius||.025) : 0],['MarkKind',m.markerKind||0],
                ['MarkAxis',m.markerAxis||0],['MarkReveal',m.marker?markReveal():1],
                ['Side',sideSign()],['Change',changeKind(m)],['Selected',+(m.index===selected)],
                ['FlapAngle',0],['PartOn',0],['SplitKind',0],['SplitPass',0],['IncReveal',0]
            ]) gl.uniform1f(uniforms[name],value);
            gl.uniform2fv(uniforms.MarkRange,m.markerRange||[0,1]);
            gl.uniform3fv(uniforms.Offset,meshOffset(m));
            gl.uniform3fv(uniforms.Inner,m.innerRgb||m.rgb);
            gl.uniform4fv(uniforms.Color,[...rgb,1]);
            setCurlUniforms(deformation(m)?.curl || null);
            gl.drawArrays(gl.TRIANGLES,m.first,m.count);
        }
        gl.disable(gl.BLEND);
        gl.depthMask(true);
        if (!picking && !capturing) {
            updateClearanceStatus(hidden);
            updateStepLabels(hidden);
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
    // One pointer orbits upright by default and rolls with Alt/Option held.
    // Shift/right-drag pans; two pointers pan and pinch.
    let pointers = new Map(), last = null, start = null, moved = 0, dragging = false, pinch = 0, hadMulti = false, pinchCenter = null;
    const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
    canvas.onpointerdown = e => { stopGlide(false); try {
        canvas.setPointerCapture(e.pointerId);
    }
    catch (error) { } /* synthetic / already-released pointers cannot be captured */ if (pointers.size === 0) {
        hadMulti = false;
        dragging = false;
        moved = 0;
        start = [e.clientX, e.clientY];
        markInteraction();
    } pointers.set(e.pointerId, [e.clientX, e.clientY]); if (pointers.size > 1) {
        hadMulti = true;
        dragging = true;
    } last = [e.clientX, e.clientY]; if (pointers.size === 2) {
        const p = [...pointers.values()];
        pinch = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
        pinchCenter = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
    } };
    canvas.onpointermove = e => { if (!pointers.has(e.pointerId))
        return; if (!last) {
        last = [e.clientX, e.clientY];
        return;
    } const dx = e.clientX - last[0], dy = e.clientY - last[1]; moved = start ? Math.hypot(e.clientX - start[0], e.clientY - start[1]) : moved; if (dx || dy)
        stopGlide(moved >= 5 || pointers.size > 1); pointers.set(e.pointerId, [e.clientX, e.clientY]); if (pointers.size === 1 && !dragging && moved < 5) {
        last = [e.clientX, e.clientY];
        return;
    } dragging = true; if (pointers.size === 2) {
        const p = [...pointers.values()], d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
        markInteraction();
        if (pinch > 0 && d > 0)
            zoomBy(d / pinch, false);
        const center = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
        if (pinchCenter) {
            pan[0] += center[0] - pinchCenter[0];
            pan[1] += center[1] - pinchCenter[1];
        }
        pinchCenter = center;
        pinch = d;
    }
    else if (e.shiftKey || (e.buttons & 2)) {
        markInteraction();
        pan[0] += dx;
        pan[1] += dy;
    }
    else if (e.altKey) {
        const r = canvas.getBoundingClientRect(), cx = r.left + r.width / 2 + pan[0], cy = r.top + r.height / 2 + pan[1];
        const angle = (x, y) => Math.atan2(y - cy, x - cx);
        markInteraction(); rollView(-wrapAngle(angle(e.clientX, e.clientY) - angle(last[0], last[1])));
    }
    else {
        markInteraction(); rotateByDrag(dx, dy);
    } last = [e.clientX, e.clientY]; render(false); };
    canvas.onpointerup = e => { pointers.delete(e.pointerId); if (!dragging && available && !hadMulti) {
        draw(true);
        cacheLabelVisibility();
        const r = canvas.getBoundingClientRect(), id = pickIdAt(e.clientX - r.left, e.clientY - r.top);
        select(id);
        render();
    } last = null; if (!pointers.size && interactionActive)
        markInteraction(); };
    canvas.onpointercancel = e => { pointers.delete(e.pointerId); last = null; if (!pointers.size && interactionActive)
        markInteraction(); };
    canvas.oncontextmenu = e => e.preventDefault();
    canvas.addEventListener('wheel', e => { e.preventDefault(); stopGlide(false); markInteraction(); const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host.clientHeight : 1); zoomBy(Math.exp(-delta * .0015), false); }, { passive: false });
    canvas.onkeydown = e => { if (e.key === 'Escape') {
        clearSelection();
        return;
    } const key = e.code === 'KeyQ' ? 'q' : e.code === 'KeyE' ? 'e' : e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', '+', '-', '=', 'home'].includes(key) ||
        e.altKey && ['q', 'e'].includes(key)) {
        e.preventDefault();
        stopGlide();
        // Arrow keys orbit. Alt/Option + Q/E rolls.
        if (e.key === 'ArrowLeft')
            rotateByDrag(-.13, 0, 1);
        if (e.key === 'ArrowRight')
            rotateByDrag(.13, 0, 1);
        if (e.key === 'ArrowUp')
            rotateByDrag(0, .1, 1);
        if (e.key === 'ArrowDown')
            rotateByDrag(0, -.1, 1);
        if (key === 'q')
            rollView(.1);
        if (key === 'e')
            rollView(-.1);
        if (['+', '='].includes(e.key))
            zoomBy(1.15);
        if (e.key === '-')
            zoomBy(1 / 1.15);
        if (e.key === 'Home')
            $('#resetView').click();
        render();
    } };
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
