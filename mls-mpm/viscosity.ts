// Relative simulation units, not calibrated physical material measurements.
export function viscositySteps(viscosity: number, frameDt: number) {
    if (!Number.isFinite(viscosity) || !Number.isFinite(frameDt)) {
        throw new Error('Viscosity and timestep must be finite');
    }
    const mu = Math.max(0.1, Math.min(4, viscosity));
    const dt = Math.max(0, Math.min(0.4, frameDt));
    // Explicit viscous stress needs smaller steps as viscosity increases.
    // Preserve total simulated time; subdividing must not mean slow motion.
    const count = Math.max(1, Math.ceil(mu * dt / 0.12));
    return { viscosity: mu, count, dt: dt / count, impulseScale: 1 / count };
}
