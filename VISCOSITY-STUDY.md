# Viscosity study

Exploratory Newtonian-liquid thickness control built on Splash. Original MIT attribution remains in LICENSE and README.md.

## Try it

Build with `npm ci` and `npm run build`, then serve the built files:

```sh
python3 -m http.server 5174 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:5174 in a WebGPU browser. Stop the server with Ctrl-C.

The Fluid thickness folder provides a live relative viscosity slider and three presets:

- Water: 0.1, the original coefficient.
- Syrup: 1.0, ten times that coefficient (initial selection).
- Thick: 4.0, forty times that coefficient.

These are exploratory names, not measured real-world viscosities. Select a preset, then Reset fluid to compare a fresh collapse and stir with the pointer. Reset resumes the simulation and restores the full container width. Presets leave color and simulation speed unchanged.

The visual default is warm tan clay (RGB 190, 151, 114; color density 2.4), with diffuse scattering, soft satin highlights, and transmission limited to thin edges. The approved Clayface poster sits beneath the clay in the existing background pass, centered with its full portrait proportions preserved and black around the unused space. Stirring reveals the face and red title through gaps. The image is loaded once and shared across renderer replacements on resize. Encoded sRGB image values pass through the existing unorm background/compositing targets; the fluid shader decodes them only for transmission. The original environment cubemap still contributes a small amount of reflection lighting. The official white stacked Groove Jones SVG and dark backing keep the existing branding and controls legible over both the poster and clay. The Diffuse Color folder still controls color and optical density.

## Physics and limits

The slider changes the symmetric velocity-gradient viscous stress in `p2g_2.wgsl`. Sparse droplets exposed an instability in the explicit affine update: its symmetric mode is multiplied by `1 - 8 * viscosity * dt / density`. Bounding viscosity times timestep alone misses low-density particles, allowing a small stir to create growing motion.

The stress now uses `viscosity / (1 + 8 * viscosity * dt / density)`, giving that local mode a positive backward-Euler relaxation factor. This is a local constitutive approximation, not a full global implicit viscosity solve or a general stability proof. Existing viscosity substeps remain; total simulated time and pointer impulse per rendered frame are preserved. No global velocity drag or speed cap is added.

Walls apply frictionless, inelastic collision projection. Only outward normal velocity and the collided affine velocity row are removed; tangential motion, inward release, and gravity along side walls remain free. The old timestep-independent wall spring is removed. The safe particle boundary is `[3, boxSize - 4]` in each axis. These walls provide collision, not adhesion.

Pointer entry/reentry no longer creates an impulse from an invalid previous coordinate. Pointer projection uses the displayed canvas size, so changing render resolution does not change the force scale.

The upstream engine advances time per rendered frame. Lower rendering frame rates therefore still slow wall-clock progress; this experiment does not introduce a wall-clock scheduler. More substeps also introduce additional transfer dissipation. Precise material calibration requires convergence comparisons beyond this exploratory pass.

This remains a viscous-liquid simulation with clay-like shading, not a yield-stress clay model, elasticity, surface adhesion, or stringy slime. Changing the visual appearance does not change viscosity, collision, or pointer forces.

## Verification

`node --test tests/*.test.mjs` covers timestep/impulse preservation, pointer entry/reentry, top-down camera framing, responsive render targets, full-poster fit at the displayed aspect, and a single shared poster upload through resize and both rendering modes. These Node checks exercise the actual application lifecycle with mocked GPU calls; they do not execute WGSL. `npm run build` passes.

`tests/gpu-kernels.mjs` dispatches the production WGSL directly in a WebGPU browser. All 33 checks pass: collision position and normal/tangential velocity, affine rows, inward grid release, gravity, no spring energy during box projection, and sparse affine relaxation at viscosity 0.1, 1, and 4. The same fixture against pre-fix commit `f4b9017` fails 25 checks, including all three sparse relaxation cases. Shader validation errors are zero in both runs.

`tests/fluid-stability-probe.js` seeds the initial particles and reads all 70,000 active particles from the production GPU buffer. Each advance processes a complete animation callback batch, which contains one simulation frame and a GUI callback. Earlier single-callback probe counts were callback ticks, not simulation frames.

At speed 0.8, each preset ran 300 initial frames, 45 small mouse-movement frames, 300 rest frames, 120 circular-stir frames, and 600 rest frames. After the circular stir, all particles returned to the bottom layer:

| Viscosity | Mean squared speed, stir → rest | Highest particle Y, stir → rest | Particles above Y=20 after rest |
| --- | --- | --- | --- |
| 0.1 | 2.490 → 0.325 | 31.265 → 9.308 | 0 |
| 1.0 | 2.469 → 0.109 | 13.111 → 8.443 | 0 |
| 4.0 | 1.865 → 0.000435 | 12.516 → 8.153 | 0 |

Thick additionally ran 120 side-stir frames and 900 rest frames. At speed 0.8, elevated particles fell from 924 to zero (including 393 near walls); highest Y fell from 31.270 to 8.074 and mean squared speed from 3.016 to 0.000346. Repeating from reset at maximum speed 1.0 reached the ceiling at Y=46 with 1,612 elevated particles; after 900 rest frames, all returned below Y=8.107 and mean squared speed fell from 2.867 to 0.0000341. No captured GPU errors or non-finite particle values occurred in these samples.

These are bounded recovery tests on the local browser/GPU, not a long-duration soak or calibrated material measurements. Water and syrup retain more motion in the bottom layer; frictionless walls do not impose tangential drag.

To repeat the kernel fixture from the Ego Browser Node runtime, import `runKernelRegressions` from `tests/gpu-kernels.mjs`, read `g2p.wgsl`, `updateGrid.wgsl`, `p2g_1.wgsl`, and `p2g_2.wgsl` into an object keyed by `g2p`, `updateGrid`, `p2g1`, and `p2g2`, then call `page.evaluate(runKernelRegressions, sources)` on the local WebGPU page. Install the recovery probe with `Page.addScriptToEvaluateOnNewDocument` and reload in the same browser invocation; use `__advance(n, motion)` and `__sample()`. Motion accepts `true` for the small path, `circle`, or `sides`. Keep advance batches under the browser evaluation timeout. Reload without instrumentation after testing to restore ordinary live animation.

The upstream dependency audit findings remain. For this experiment serve the production output locally rather than exposing the upstream development server.
