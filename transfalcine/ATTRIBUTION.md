# Contralateral Transfalcine Approach

Atlas geometry: [Z-Anatomy](https://www.z-anatomy.com/), CC BY-SA 4.0. Upstream BodyParts3D by DBCLS, CC BY-SA 2.1 Japan. Derivatives include the fitted vault layers, cutaways, and operative markings.

Source: Alexander AY, Graepel S, Peris-Celda M, Lanzino G. The Contralateral Transfalcine Approach: An Anatomic Study Quantifying Its Superior and Lateral Limits of Exposure. Operative Neurosurgery. Published online May 21, 2026. DOI: 10.1227/ons.0000000000002057.

The interactive page uses the Pterional Craniotomy reference from nyuolab/operative-website-skill. The paper's figures and full text are excluded.


The revised cutaway includes thin cut edges fitted between the atlas skull tables. The dural leaf follows the inner table and curls from its sagittal sinus base after the incision is shown. The illustrated bone flap rises clear of the rim before tilting and is returned along the same path.

The geometry generator is in `tools/build_transfalcine_geometry.py`. To regenerate the mesh and regional data, provide the native cranial reference records in the shared model frame with `--reference-json`, the original guide containing the native medial records with `--medial-guide`, and an output directory with `--output`. The hosted and standalone guides bundle the derived geometry and do not need either source file at runtime.
