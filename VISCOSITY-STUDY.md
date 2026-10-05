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

## Physics and limits

The slider changes the existing symmetric velocity-gradient viscous stress in `p2g_2.wgsl`. It does not add global velocity drag or alter the speed control. Explicit stress integration uses additional substeps as viscosity increases, keeping viscosity times substep duration at or below 0.12 in simulation units. This is a conservative exploration setting, not a general proof of numerical stability. Total simulated time and pointer impulse per rendered frame are preserved.

The upstream engine advances time per rendered frame. Lower rendering frame rates therefore still slow wall-clock progress; this experiment does not introduce a wall-clock scheduler. More substeps also introduce additional transfer dissipation. Precise material calibration requires convergence comparisons beyond this exploratory pass.

This is viscous liquid, not a yield-stress clay model, elasticity, surface adhesion, or stringy slime. The original transparent water rendering is retained so material appearance does not disguise the motion comparison.

## Verification

- Three Node tests check the original water step, preserved simulated time/pointer impulse, the timestep bound, and invalid-input handling.
- Production build passes; shader compilation and rendering exercised in Ego Browser.
- At 70,000 particles, viscosity 4, and speed 0.8, an interactive GPU readback found zero non-finite values in sampled active particle position, velocity, and affine matrices; no captured WebGPU errors. This is a bounded check, not a long-duration soak.
- A short 30-frame browser sample at that setting measured median 33.4 ms and p95 49.9 ms between animation frames. This is whole-page timing, not isolated GPU timing or an installation performance guarantee.
- No camera input or multi-display support added.

The upstream dependency audit findings remain. For this experiment serve the production output locally rather than exposing the upstream development server.
