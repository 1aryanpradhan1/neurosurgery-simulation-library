const groups = {
    "Shared Cranial Approaches": [
        "Pterional",
        "Supraorbital",
        "Anterior Subfrontal and Transbasal",
        "Interhemispheric",
        "Transcortical and Transventricular",
        "Subtemporal",
        "Retrosigmoid",
        "Suboccipital Posterior Fossa",
        "Pineal and Tentorial",
        "Petrosal and Lateral Skull Base",
        "Far Lateral",
        "Expanded Endonasal and Ventral Skull Base"
    ],
    "Cranial Oncology": [
        "Stereotactic Biopsy",
        "Supratentorial Intra-Axial Tumor Resection",
        "Deep and Eloquent Intra-Axial Tumor Resection",
        "Convexity and Parasagittal Meningioma Resection",
        "Skull Base Meningioma Resection",
        "Vestibular and Other Cranial Nerve Schwannoma Resection",
        "Transsphenoidal Sellar Surgery",
        "Suprasellar and Craniopharyngioma Surgery",
        "Intraventricular and Pineal Lesion Surgery",
        "Posterior Fossa Tumor Resection",
        "Cranial Tumor LITT"
    ],
    "Open Cerebrovascular": [
        "Anterior Circulation Aneurysm Clipping",
        "Posterior Circulation Aneurysm Clipping",
        "Complex Aneurysm Trapping and Bypass",
        "Brain AVM Resection",
        "Cranial AV Fistula Disconnection",
        "Cavernous Malformation Resection",
        "Moyamoya Revascularization",
        "Carotid Endarterectomy and Open Cervical Revascularization"
    ],
    "Endovascular": [
        "Catheter Angiography and Diagnostic Testing",
        "Mechanical Thrombectomy",
        "Aneurysm Coiling",
        "Flow Diversion and Intrasaccular Treatment",
        "Brain and Spinal Shunt Embolization",
        "MMA and Tumor Embolization",
        "Cervical and Intracranial Angioplasty or Stenting",
        "Venous Sinus and Thrombosis Intervention"
    ],
    "Emergency and Reconstruction": [
        "Acute Extra-Axial Hematoma Evacuation",
        "Chronic Subdural Drainage",
        "Intracerebral and Intraventricular Clot Evacuation",
        "Decompressive Craniectomy",
        "Depressed Skull Fracture and Penetrating Injury Repair",
        "Intracranial Infection Surgery",
        "Cranioplasty and Cranial Wound Reconstruction"
    ],
    "CSF and Hydrocephalus": [
        "Temporary CSF Access and Monitoring",
        "Permanent Shunt Surgery",
        "Ventricular Neuroendoscopy",
        "Cranial CSF Leak Repair",
        "Spinal CSF Leak and CSF–Venous Fistula Repair"
    ],
    "Spine": [
        "Chiari Decompression",
        "Upper Cervical Posterior Fixation",
        "Ventral Craniocervical Decompression and Odontoid Fixation",
        "ACDF",
        "Anterior Cervical Corpectomy",
        "Cervical Disc Arthroplasty and Hybrid Reconstruction",
        "Posterior Cervical Decompression and Fusion",
        "Posterior Cervical Foraminotomy",
        "Thoracic Discectomy and Corpectomy",
        "Lumbar Discectomy",
        "Lumbar Stenosis Decompression",
        "Posterior Lumbar Fusion",
        "ALIF and Anterior Lumbar Replacement",
        "Lateral Lumbar Interbody Fusion",
        "Oblique Lumbar Interbody Fusion",
        "Deformity Correction and Osteotomy",
        "Spine Trauma Reduction and Stabilization",
        "Vertebral Augmentation",
        "Extradural and Vertebral Tumor Surgery",
        "Intradural Extramedullary Tumor Surgery",
        "Intramedullary Tumor Surgery",
        "Spinal Vascular and Non-Neoplastic Intradural Surgery",
        "Spinal Infection and Postoperative Revision"
    ],
    "Functional, Epilepsy and Pain": [
        "DBS",
        "Stereotactic Lesioning",
        "Invasive Epilepsy Monitoring",
        "Temporal Epilepsy Surgery",
        "Extratemporal Epilepsy Surgery",
        "Hemispheric Disconnection and Corpus Callosotomy",
        "Hypothalamic Hamartoma Surgery and Epilepsy Ablation",
        "Epilepsy Neuromodulation",
        "Cranial Nerve Microvascular Decompression",
        "Percutaneous Trigeminal Procedures",
        "Spasticity Surgery",
        "Spinal and Peripheral Stimulation",
        "Intrathecal Pump Surgery",
        "Ablative Pain Surgery"
    ],
    "Peripheral Nerve": [
        "Upper-Extremity Entrapment Release",
        "Lower-Extremity and Truncal Entrapment Release",
        "Brachial Plexus Reconstruction and Thoracic Outlet",
        "Peripheral Nerve Repair and Transfer",
        "Peripheral Nerve Tumors and Biopsy",
        "Neuroma and Amputation-Related Nerve Surgery"
    ],
    "Pediatric-Specific": [
        "Craniosynostosis and Cranial Vault Reconstruction",
        "Neural Tube Defect and Encephalocele Closure",
        "Fetal Myelomeningocele Repair",
        "Spinal Dysraphism and Untethering",
        "Pediatric Spine Deformity"
    ],
    "Radiosurgery": [
        "Cranial Stereotactic Radiosurgery",
        "Spine Stereotactic Radiation"
    ]
};

const simulations = {
    ACDF: {
        title: 'Anterior Cervical Discectomy and Fusion (ACDF)',
        url: 'acdf-guide.html',
        keywords: 'cervical fusion cage plated zero profile',
        variants: [
            ['Levels', 'levels', [['1 level', '1'], ['2 levels', '2'], ['3 levels', '3']]],
            ['Fixation', 'construct', [['Anterior plate', 'plated'], ['Zero-profile cage', 'zero']]]
        ]
    },
    Pterional: {
        title: 'Pterional Craniotomy',
        url: 'pterional-guide.html',
        keywords: 'clinoidectomy orbitozygomatic sylvian',
        variants: [
            ['Clinoidectomy', 'clinoid', [['None', 'none'], ['Extradural', 'extra'], ['Intradural', 'intra']]],
            ['Muscle approach', 'muscle', [['Subfascial', 'subfascial'], ['Muscle-splitting', 'split']]],
            ['Sylvian fissure', 'fissure', [['Split', 'yes'], ['No split', 'no']]]
        ]
    }
};

const procedures = Object.entries(groups).flatMap(([group, names]) =>
    names.map(name => ({name, group, title: simulations[name]?.title ?? name})));
const list = document.querySelector('#list');
const filters = document.querySelector('#filters');
const search = document.querySelector('#search');
const modal = document.querySelector('#modal');
const options = document.querySelector('#modal-options');
const action = document.querySelector('#modal-action');
const allProcedures = 'All Procedures';
const onLibraryPage = document.body.dataset.page === 'procedures';
const previewLimit = 6;
let selectedGroup = allProcedures;
let expanded = false;

function draw() {
    filters.innerHTML = '<p class="eyebrow">Specialties</p>' +
        [allProcedures, ...Object.keys(groups)].map(group => {
            const count = groups[group]?.length ?? procedures.length;
            return `<button class="filter ${selectedGroup === group ? 'active' : ''}" data-group="${group}">${group} <span>${count}</span></button>`;
        }).join('');

    const query = search.value.toLowerCase().trim();
    const items = procedures.filter(({name, title, group}) =>
        (selectedGroup === allProcedures || group === selectedGroup) &&
        `${title} ${group} ${simulations[name]?.keywords ?? ''}`.toLowerCase().includes(query));
    if (selectedGroup === allProcedures) {
        items.sort((a, b) => Number(Object.hasOwn(simulations, b.name)) - Number(Object.hasOwn(simulations, a.name)));
    }

    document.querySelector('#heading').textContent = selectedGroup;
    document.querySelector('#count').textContent = items.length + ' procedures';
    const shown = expanded ? items : items.slice(0, previewLimit);
    list.innerHTML = shown.map(({name, title, group}) => {
        const available = Object.hasOwn(simulations, name);
        return `<button type="button" class="row" data-name="${name}"><span><strong>${title}</strong><small>${group}</small></span><span class="pill ${available ? 'live' : ''}">${available ? 'Available' : 'Coming soon'} &nbsp; ↗</span></button>`;
    }).join('') || '<p class="results">No procedures match your search.</p>';

    if (items.length > previewLimit) {
        const more = document.createElement('button');
        more.className = 'show-more';
        more.textContent = onLibraryPage
            ? (expanded ? 'Show less' : 'Show all ' + items.length + ' procedures')
            : 'Show all procedures ↗';
        more.onclick = () => {
            if (onLibraryPage) {
                expanded = !expanded;
                draw();
            } else {
                location.href = 'procedures.html';
            }
        };
        list.append(more);
    }
}

function openDetail(name) {
    const {group, title} = procedures.find(procedure => procedure.name === name);
    const simulation = simulations[name];
    document.querySelector('#modal-group').textContent = group;
    document.querySelector('#modal-title').textContent = title;
    document.querySelector('#modal-description').textContent = simulation
        ? 'Choose a starting configuration, then open the interactive guide. The guide contains the complete variant controls.'
        : 'Explore the planned procedure and select a starting variant.';

    const variants = simulation?.variants ?? [['Approach', '', [['Standard', ''], ['Alternative', '']]]];
    options.innerHTML = variants.map(([label, parameter, choices]) =>
        `<div class="eyebrow">${label}</div><div class="options" data-parameter="${parameter}">${choices.map(([text, value], index) =>
            `<button type="button" class="opt ${index === 0 ? 'selected' : ''}" data-value="${value}">${text}</button>`
        ).join('')}</div>`
    ).join('');

    if (simulation) {
        action.innerHTML = `<a class="launch" href="${simulation.url}?from=procedures">Open simulation</a><p class="note">Your selected options will open in the guide.</p>`;
        const launch = action.querySelector('a');
        launch.onclick = () => {
            const params = new URLSearchParams({ from: 'procedures' });
            for (const button of options.querySelectorAll('.opt.selected')) {
                params.set(button.parentElement.dataset.parameter, button.dataset.value);
            }
            launch.href = simulation.url + '?' + params;
        };
    } else {
        action.innerHTML = '<div class="launch muted-button">Simulation Coming Soon</div>';
    }
    modal.showModal();
}

filters.onclick = event => {
    const button = event.target.closest('[data-group]');
    if (button) {
        selectedGroup = button.dataset.group;
        expanded = false;
        draw();
    }
};
search.oninput = () => {
    expanded = false;
    draw();
};
list.onclick = event => {
    const button = event.target.closest('[data-name]');
    if (button) openDetail(button.dataset.name);
};
options.onclick = event => {
    const button = event.target.closest('.opt');
    if (button) {
        button.parentElement.querySelector('.selected').classList.remove('selected');
        button.classList.add('selected');
    }
};
document.querySelectorAll('[data-procedure]').forEach(button => {
    button.onclick = () => openDetail(button.dataset.procedure);
});
modal.querySelector('.close').onclick = () => modal.close();
draw();
