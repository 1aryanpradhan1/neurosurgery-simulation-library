# Agent guide: adding simulations

This repository is the Neurosurgical Simulation Library. For a new procedure guide or an article-specific operative case, use the **operative procedure website** skill: `$artifact-template-operative-procedure-website`. Read its current `SKILL.md` and referenced guidance before building. If the skill is installed, use the installed copy. Otherwise obtain the current skill from [nyuolab/operative-website-skill](https://github.com/nyuolab/operative-website-skill) and follow its setup; do not substitute a generic website template. The skill's retained Pterional page is the interface and interaction reference. Work on a copy, never alter the installed reference while generating a guide.

## Choose the page type

- **Procedure Library:** an educational guide to a named procedure or the specifically requested family of techniques. Base the anatomy and steps on primary technique sources. Add only requested, evidence-supported options.
- **Operative Cases:** a simulation of the particular operation in a specific article. Preserve its patient-specific side, approach, sequence, scope and reported findings. Do not convert a general procedure guide into a case merely by changing its title. Distinguish case evidence from general anatomical context.

For either type, read the complete relevant source material and map evidence to steps before building. When required full text or a video is inaccessible, follow the skill's intake workflow and clearly identify what is missing; do not infer unseen details. If the article has an accessible video, review it in full and map verified timestamps and relevant 2D frames to steps. For a supplied video file, follow the skill's expandable, step-synchronized video player requirements. Check permissions for figures, frames and video before bundling or public distribution; an accessible article is not necessarily reusable media.

## Build and integrate

1. Use the skill's materialization and adaptation workflow in a separate working directory. Preserve the established site design, camera and controls, mobile layout, accessibility, step-by-step 3D states, 2D Figures, Details with explicit citations, and Papers. Replace example-specific anatomy and content with evidence-supported material. Follow the skill's checks and document limitations.
2. Place the completed guide and its required runtime assets in this repository using a stable relative URL. Keep source attribution, license information, and asset paths intact. Where a guide has both a standalone `*-guide.html` and a directory-based version, update and verify both if both are retained; do not leave them inconsistent. Keep large media and anatomy files out of Git unless appropriate for the destination and permitted for redistribution.
3. Add a Back link using the shared `assets/case-back.css` and `assets/case-back.js`, with an appropriate Procedure Library or Operative Cases fallback. Preserve origin information in navigation; test home, library and direct-entry routes. Use relative links so the site works at a subpath.

### Add a procedure

- `procedures.html` loads `assets/procedure-library.js`. Add the procedure to the appropriate `groups` list if absent and register its real guide in `simulations` using the existing entries as examples (`title`, relative `url`, `keywords`, and, only when applicable, `variants`). Make each option's query parameter and values match the guide's actual configuration handling; verify each choice changes the intended guide state. Existing planned entries without a simulation remain marked as coming soon.
- `catalog.json` is a separate catalog of procedure names. If the category or list changes, inspect its consumers and update it where appropriate; do not assume it automatically registers a simulation.

### Add an operative case

- `assets/case-articles.js` provides the case records displayed in `cases.html` and used by `case-simulation.html`. Add or update the matching article record with accurate `title`, `issue`, `specialty`, `video`, and string `pmid`; set `simulation` to the completed guide's relative URL. Preserve any applicable `formatLabel` and `publicationDate` fields. Do not mark a case as available until the guide is complete.
- `case-simulation.html?case=<pmid>` resolves that record and redirects available cases to their simulation, carrying the home/cases origin. Verify the correct case and Back destination from both entry points. Update the home page only if the user requests or the existing featured entry needs to point to the new case.

## Verify and deliver

Run focused syntax and link checks for changed code and assets, and the skill's source, anatomy, laterality, state, 2D/media and responsive checks appropriate to the new guide. Open the real site in a supported browser when available: exercise the library entry, options, guide, figures and Details, Back, and mobile layout. For video, test opening/collapsing, step changes, timestamp seeking, missing timestamps and media failures. Check a deployment subpath and document any unverified behavior. Do not claim clinical validation.

Inspect `git status` and the complete outgoing diff, including binaries and publication rights, before committing or pushing. Never commit credentials, source PDFs or patient data without authorization. Follow the user's instructions and the repository's normal review and publication workflow; do not merge or deploy without authorization.
