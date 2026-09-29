# QA: fused_gt (Leo's GT as hard reference + model fusion). AI + surgeon GT, NOT diagnostic
Generated —. Venous grid 512×512×404, 0.934×0.934×1.5 mm, LAS (k = z-slice index, z = −965 + 1.5·k mm). Educational / planning use only. Every number below was computed from the masks; nothing was measured by hand or made up.

## What was done
1. **tumor_left / kidney_left / collecting_system = Leo's interp GT** (out/leo_gt/interp), used as-is inside his drawn region (k102–244 × grid crop i209–468, j157–416). Hierarchy: collecting system > tumour > kidney (pelvis wins where yellow and red overlap).
2. **Outside the drawn region**: model-fusion voxels were allowed in only if 26-connected to Leo's structure AND HU-consistent (contact ≥20 voxels, median HU inside Leo's P5–P95). **Added: 0.0 mL ('modelo, fora do desenho')**. The fused tumour runs only k110–218 and the fused left kidney k191–242, so both sit entirely inside the drawn region; the fused collecting system has 6.29 mL outside it, all of which is disconnected (right pelvis k177–215, plus stray lung-base fragments k368–386). **No model (fused, rsuper, KiTS21 venous/arterial) reaches below k104**, so nothing could be extended caudal to k102. Leo's caudal nodules at k102–104 are still open (README: HU cannot separate them from bowel); settling them needs Leo's caudal extension grid (grade_extra_caudal k101→66). The flag layer `model_outside_drawing.nii.gz` is empty.
3. **All other structures** come from out/fused (colon, small bowel and left iliopsoas from TotalSegmentator, out/masks), minus any overlap with Leo's masks. TotalSegmentator's false 'small bowel' inside the mass was removed. The **thrombus** is kept only as a flagged LOW-CONFIDENCE layer. The fused collecting system was split: the right pelvis became `collecting_system_right` (UNesT model), the left part was replaced by Leo's, and the stray lung-base fragments were dropped.

## Volumes / z-extent / agreement with the previous fusion
| structure | source | final mL | k-range | previous mL | previous k | Dice vs prev | HD95 vs prev (mm) | overlap with Leo removed (mL) | flag |
|---|---|---|---|---|---|---|---|---|---|
| tumor_left | cirurgiao | 1198.95 | k102–227 | 955.88 | k110–218 | 0.8569 | 35.01 | – |  |
| kidney_left | cirurgiao | 64.69 | k213–241 | 141.76 | k191–242 | 0.5941 | 22.5 | – |  |
| collecting_system | cirurgiao | 19.52 | k205–238 | 12.96 | k177–386 | 0.1464 (left only: Dice 0.1816, HD95 93.56) | 225.99 | – |  |
| collecting_system_right | modelo | 6.61 | k177–215 | 4.26 | k177–378 | 0.7061 | 13.04 | 0.0 | model only (UNesT), not drawn by Leo |
| kidney_right | modelo | 142.15 | k163–230 | 142.15 | k163–230 | 1.0 | 0.0 | 0.0 |  |
| aorta | modelo | 153.08 | k137–346 | 153.08 | k137–346 | 1.0 | 0.0 | 0.0 |  |
| inferior_vena_cava | modelo | 105.24 | k133–275 | 105.24 | k133–275 | 1.0 | 0.0 | 0.0 |  |
| thrombus | modelo | 15.48 | k135–271 | 15.48 | k135–271 | 1.0 | 0.0 | 0.0 | LOW CONFIDENCE candidate only (single-source HU filling-defect search: |
| renal_arteries | modelo | 1.17 | k122–333 | 1.17 | k122–333 | 1.0 | 0.0 | 0.0 | unreliable (CECT single source failed QC; fragments not at renal hila) |
| renal_veins_other | modelo | 4.02 | k193–261 | 4.02 | k193–261 | 1.0 | 0.0 | 0.0 | unreliable (CECT single source failed QC; right-sided only, no left re |
| iliac_artery_left | modelo | 10.36 | k27–139 | 10.36 | k27–139 | 0.9997 | 0.0 | 0.01 |  |
| iliac_artery_right | modelo | 9.3 | k32–138 | 9.3 | k32–138 | 1.0 | 0.0 | 0.0 |  |
| iliac_vena_left | modelo | 27.99 | k24–133 | 27.99 | k24–133 | 1.0 | 0.0 | 0.0 |  |
| iliac_vena_right | modelo | 21.41 | k32–133 | 21.41 | k32–133 | 1.0 | 0.0 | 0.0 |  |
| portal_vein_and_splenic_vein | modelo | 25.64 | k204–242 | 25.64 | k204–242 | 1.0 | 0.0 | 0.0 |  |
| spleen | modelo | 178.51 | k213–263 | 178.98 | k213–263 | 0.9987 | 0.0 | 0.47 |  |
| pancreas | modelo | 64.32 | k177–231 | 64.32 | k177–231 | 1.0 | 0.0 | 0.0 |  |
| liver | modelo | 1826.24 | k157–274 | 1826.24 | k157–274 | 1.0 | 0.0 | 0.0 |  |
| duodenum | modelo | 38.09 | k163–210 | 38.09 | k163–210 | 1.0 | 0.0 | 0.0 |  |
| stomach | modelo | 168.09 | k195–256 | 168.09 | k195–256 | 1.0 | 0.0 | 0.0 |  |
| gallbladder | modelo | 24.9 | k180–211 | 24.9 | k180–211 | 1.0 | 0.0 | 0.0 |  |
| colon | modelo | 676.72 | k35–219 | 682.76 | k35–219 | 0.9956 | 0.0 | 6.03 |  |
| small_bowel | modelo | 549.4 | k67–197 | 993.03 | k67–208 | 0.7124 | 45.75 | 435.86 | TotalSegmentator; false 'small bowel' inside the mass removed (overlap |
| iliopsoas_left | modelo | 192.44 | k8–215 | 194.05 | k8–215 | 0.9958 | 0.0 | 1.61 | TotalSegmentator context; overlap with Leo tumour subtracted (Leo wins |
| adrenal_gland_left | modelo | 2.88 | k221–242 | 2.88 | k221–242 | 1.0 | 0.0 | 0.0 |  |
| adrenal_gland_right | modelo | 2.58 | k216–239 | 2.58 | k216–239 | 1.0 | 0.0 | 0.0 |  |
| kidney_cyst_left | modelo | 0.0 | – | 0.0 | k218–220 | 0.0 | – | 0.0 |  |
| kidney_cyst_right | modelo | 0.72 | k159–166 | 0.72 | k159–166 | 1.0 | 0.0 | 0.0 |  |
| vertebrae_T11 | modelo | 30.89 | k232–262 | 30.89 | k232–262 | 1.0 | 0.0 | 0.0 |  |
| vertebrae_T12 | modelo | 31.66 | k216–245 | 31.66 | k216–245 | 1.0 | 0.0 | 0.0 |  |
| vertebrae_L1 | modelo | 36.78 | k192–228 | 36.78 | k192–228 | 1.0 | 0.0 | 0.0 |  |
| vertebrae_L2 | modelo | 42.11 | k172–208 | 42.11 | k172–208 | 1.0 | 0.0 | 0.0 |  |
| vertebrae_L3 | modelo | 47.24 | k150–186 | 47.24 | k150–186 | 1.0 | 0.0 | 0.0 |  |
| vertebrae_L4 | modelo | 48.91 | k133–164 | 48.91 | k133–164 | 1.0 | 0.0 | 0.0 |  |
| vertebrae_L5 | modelo | 47.75 | k116–145 | 47.75 | k116–145 | 1.0 | 0.0 | 0.0 |  |

Previous sources: out/fused/*.nii.gz; colon and small_bowel compared against TotalSegmentator (out/masks). kidney_left: Leo drew kidney only on k213–241 and marked everything below as tumour. collecting_system: the previous UNesT mask covered both kidneys plus stray fragments, so a left-only comparison is also given.

### Previous-fusion voxels superseded by Leo inside the drawn region
- fused tumor_left outside Leo's union: **32.35 mL** (k111–217). Mostly a thin boundary rim: median 1.5 mm, P90 3 mm, max 6 mm from Leo's contour. The largest pieces are at k114–115, where Leo did not draw the anteromedial lobule.
- fused kidney_left: 52.33 mL is now Leo **tumour**, 16.58 mL is Leo collecting system, and 11.52 mL is unlabeled (thin rim: median 1.3 mm, max 4.5 mm; the most is at k213, 2.1 mL).
- fused left collecting system outside Leo's union: 0.53 mL.

### Overlaps removed (Leo wins)
| structure | overlap removed (mL) | other cleanup |
|---|---|---|
| iliac_artery_left | 0.01 |  |
| spleen | 0.47 |  |
| colon | 6.03 |  |
| small_bowel | 435.86 | crumbs <0.1 mL touching Leo: 1.53 mL; TS rims hugging the mass: 6.24 mL (16 comps) |
| iliopsoas_left | 1.61 |  |

Small bowel (TotalSegmentator 993.03 mL): **435.86 mL lay inside Leo's tumour** (false 'small bowel' = mass) and was removed, along with rims (6.24 mL) and crumbs (1.53 mL). Final: 549.4 mL. Two residual components still touch the caudal tumour and were KEPT as bowel because Leo left them unlabeled: 5.45 mL at k111–116 (HU 78) and 1.58 mL at k103–109 (HU 74). They sit next to the caudal anteromedial nodules and should be reviewed.

## Distances from the final tumour (Leo)
| structure | source | min distance (mm) | nearest at k | overlap with Leo tumour before removal (mL) | comment |
|---|---|---|---|---|---|
| pancreas | modelo | 2.0 | 224 | 0.0 | close (<5 mm, 2-4 voxels); masks never overlapped |
| spleen | modelo | 2.09 | 222 | 0.0 | close (<5 mm, 2-4 voxels); masks never overlapped |
| aorta | modelo | 2.64 | 147 | 0.0 | close (<5 mm, 2-4 voxels); masks never overlapped |
| inferior_vena_cava | modelo | 17.1 | 137 | 0.0 | separated |
| kidney_left (Leo) | cirurgiao | 0.93 | 219 | – | same source (Leo): adjacent/contiguous by construction |
| collecting_system (Leo, renal pelvis) | cirurgiao | 0.93 | 206 | – | same source (Leo): adjacent/contiguous by construction |
| renal_arteries (unreliable) | modelo | 11.36 | 135 | 0.0 | separated |
| renal_veins_other (unreliable, right-sided) | modelo | 49.67 | 201 | 0.0 | separated |
| colon | modelo | 0.93 | 122 | 6.03 | contact (adjacent voxel): masks from different sources abut; 6.03 mL overlap was removed, so this is NOT evidence of invasion |
| small_bowel | modelo | 0.93 | 127 | 435.86 | contact (adjacent voxel): masks from different sources abut; 435.86 mL overlap was removed, so this is NOT evidence of invasion |
| duodenum | modelo | 5.3 | 176 | 0.0 | separated |
| adrenal_gland_left | modelo | 15.78 | 223 | 0.0 | separated |
| iliac_artery_left | modelo | 0.93 | 135 | 0.01 | contact (adjacent voxel): masks from different sources abut; 0.01 mL overlap was removed, so this is NOT evidence of invasion |
| iliac_vena_left | modelo | 6.69 | 120 | 0.0 | separated |
| portal_vein_and_splenic_vein | modelo | 8.06 | 228 | 0.0 | separated |
| stomach | modelo | 10.14 | 208 | 0.0 | separated |
| liver | modelo | 28.28 | 205 | 0.0 | separated |
| kidney_right | modelo | 62.55 | 211 | 0.0 | separated |
| thrombus (candidate) | modelo | 15.38 | 137 | 0.0 | separated |
| iliopsoas_left (TotalSegmentator, Leo overlap subtracted) | modelo | 0.93 | 136 | 1.61 | contact (adjacent voxel): masks from different sources abut; 1.61 mL overlap was removed, so this is NOT evidence of invasion |
| left renal hilum (approx. point: centroid of the most medial 10% of Leo collecting-system voxels) | cirurgiao (derived landmark) | 20.88 | – | – | approximate landmark (point ijk [315, 206, 226]), inside tumour: False |
| left renal vein / left renal artery | – | n/a | – | – | no reliable left renal vessel mask: CECT vessel model failed QC (renal_arteries = fragments not at the hila; renal_veins_other = right-sided only); TotalSegmentator has no renal vessels. Assess on CT. |

Method: minimum Euclidean distance between boundary-voxel centres (world mm). 0 = overlap; ~0.93–1.5 mm = adjacent voxels. **For masks from different sources, 0 mm or ~1 voxel only means the masks overlap or abut (overlaps with Leo were removed during the fusion). It is not evidence of invasion; judge contact on the CT.** There is no reliable left renal vein or left renal artery mask: the CECT vessel model failed QC, and TotalSegmentator has no renal vessels. The 'hilum' is a point derived from Leo's collecting system.

## Problems / inconsistencies found in Leo's GT
- **Midline crossing**: 16.32 mL of tumour lies right of the vertebral midline (per-slice centroid of TotalSegmentator vertebrae + sacrum), k104–154. The biggest slices are k124–136 (0.9–1.8 mL each; the anteromedial lobule, drawn on alternating slices) plus 0.3–0.5 mL/slice at k146–154 (anterior to the aorta/spine; tumour–aorta minimum 2.6 mm at k147). The drawing shows no overlap with the aorta or IVC.
- **Anteromedial lobule drawn on alternating slices** (drawn on k136, 135, 132, 128–126, 124–116, 114, 112–104; not drawn on k134, 131, 130, 115). In 3D this gives a comb/flange-like surface (see the 3D anterior view). Interpolated slices k133/k129 add only 0.03–0.04 mL right of midline. The previous fusion has 1.5 mL on k114–115, where Leo drew nothing. README confirms this is faithful to the drawing; Leo should still confirm whether the gaps are intentional.
- **Tumour is not one piece**: 4 components, main 1196.67 mL + 1.45 mL at k110–110 (i≈354), 0.7 mL at k104–110 (i≈250), 0.13 mL at k114–114 (i≈218). The 0.7 mL (k104–110) and 0.13 mL (k114) islands are right of the midline and anterior (caudal anterior nodules; they could be bowel). The 1.45 mL island at k110 is lateral, on a single slice.
- **Collecting system is fragmented**: 5 components (7.29 mL k213–220, 7.13 mL k227–238, 2.9 mL k222–225, 2.11 mL k205–207, 0.08 mL k220–220). The pelvis and calyces are not continuous in 3D (gaps at interpolated / undrawn slices). The lowest piece (k205–207, 2.1 mL) lies inside the tumour region below the drawn kidney.
- **Holes**: kidney_left has 8.77 mL of in-plane holes (k216–238, renal sinus), almost all filled by the collecting system. The union tumour+kidney+CS still has 0.55 mL of unlabeled in-plane holes (median 47.5 HU; sinus fat/vessels or gaps between colours) and 0.49 mL of enclosed 3D holes. The tumour itself has no holes (0 mL).
- **Kidney drawn only on k213–241** (64.7 mL, versus 141.8 mL fused kidney k191–242). Leo classes 52.3 mL of the models' 'kidney' as tumour (34.9 mL below k213, i.e. the lower pole where Leo drew everything red; 17.5 mL at k213–227 along the tumour/kidney interface). This is a deliberate clinical call that changes the kidney/tumour split.
- **Crop edge**: 11 voxels of Leo's union touch the grid crop edge i=209 (medial clipping at k127/k124, 7 + 4 voxels; see README). This is covered by the medial extension grid.
- **Overlaps with other masks** before removal (mL): {'iliac_artery_left': 0.01, 'spleen': 0.47, 'colon': 6.03, 'small_bowel': 435.86, 'iliopsoas_left': 1.61}. Of note: Leo's **kidney** overlaps the fused spleen by 0.47 mL at the upper pole (k234–238), and Leo's tumour overlapped TotalSegmentator iliopsoas_left by 1.61 mL: now **subtracted** (Leo wins); iliopsoas_left is in out/fused_gt (id 35) and the viewer label map (id 26).
- Tumour HU (venous): median 69.0, IQR 44.0–85.0; only 0.44% of voxels are below −50 HU, so there is no gross fat or air inclusion. Slice-area jumps at k110 and k215 (single-slice outliers).

## Viewer outputs
- Label map `out/volume/labels_roi_fused_gt_u8.raw` + `volume_meta_fused_gt.json`: same ROI and grid as labels_roi_fused_u8.raw (dims [302, 239, 347], 0.8 mm, same affine and byte format). Geometry self-check (rebuilding the previous fused map with this code gives an identical file): {'rebuilt_fused_labelmap_identical_to_labels_roi_fused_u8': True, 'rebuilt_TS_labelmap_identical_to_labels_roi_u8': True}. Same ids and colours as before, plus 18 collecting_system (Leo), 19 collecting_system_right, 24 colon, 25 small_bowel, 26 iliopsoas_left. Thrombus (21) is painted *below* the aorta/IVC. The Leo structures are not clipped by the ROI: {'tumor_left': {'source_ml': 1198.95, 'roi_ml': 1195.71}, 'kidney_left': {'source_ml': 64.69, 'roi_ml': 64.63}, 'collecting_system': {'source_ml': 19.52, 'roi_ml': 20.28}} (the small differences come from nearest-neighbour resampling to 0.8 mm).
- 3D assets `out/viewer_assets_gt/` (build_viewer_assets.py; masks_dir = out/fused_gt/leo_derived with --alias tumor_left/kidney_left/collecting_system and --masks-fonte cirurgiao; fallback = out/fused_gt; labels = fused_gt_labels.json): 36 structures. fonte=cirurgiao for tumor_left, kidney_left, collecting_system; tumour colour check: True. Not built: ['kidney_cyst_left', 'disagreement_tumor_left', 'disagreement_kidney_left', 'disagreement_kidney_cyst_left']. Built with the gt wrapper out/fused_gt/work/build_viewer_assets_gt.py (v1 script unchanged): all components of Leo's masks kept (incl. single-slice tumour islands), collecting_system_right and small_bowel added, hilum text corrected. iliopsoas_left is NIfTI + label map only.

## Images
- `out/qa/fused_gt/qa_fused_gt_axial_montage_1.png` (reduced: `qa_fused_gt_axial_montage_1_chat.jpg`)
- `out/qa/fused_gt/qa_fused_gt_axial_montage_2.png` (reduced: `qa_fused_gt_axial_montage_2_chat.jpg`)
- `out/qa/fused_gt/qa_fused_gt_3d_anterior.png` (reduced: `qa_fused_gt_3d_anterior_chat.jpg`)
- `out/qa/fused_gt/qa_fused_gt_3d_posterior_left_oblique.png` (reduced: `qa_fused_gt_3d_posterior_left_oblique_chat.jpg`)
- `out/qa/fused_gt/qa_fused_gt_3d_left_anterior_caudal_oblique_colon.png` (reduced: `qa_fused_gt_3d_left_anterior_caudal_oblique_colon_chat.jpg`)

Axial montages: k102–240 every 6 slices, radiological view, venous W400/L40. Red = tumour, green = kidney, yellow = collecting system, magenta = model outside the drawing (none). White ticks = vertebral midline.
