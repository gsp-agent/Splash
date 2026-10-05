// Test instrumentation only: install before navigation with Page.addScriptToEvaluateOnNewDocument.
// Each advance processes the entire queued RAF batch, including the GUI callback.
// Counting a single callback as a simulation frame would undercount by about 2x.
window.__probe = {errors: [], frames: [], buffers: {}, count: 70000, simulationFrames: 0, callbacks: 0};
let seed = 12345;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};
window.requestAnimationFrame = cb => {window.__probe.frames.push(cb); return window.__probe.frames.length;};
const originalCreate = GPUDevice.prototype.createBuffer;
GPUDevice.prototype.createBuffer = function(desc) {
    const capture = ['particles buffer', 'density buffer'].includes(desc.label);
    const b = originalCreate.call(this, capture ? {...desc, usage: desc.usage | GPUBufferUsage.COPY_SRC} : desc);
    window.__probe.buffers[desc.label] = b;
    if (desc.label === 'particles buffer') {
        window.__probe.device = this;
        this.addEventListener('uncapturederror', e => window.__probe.errors.push(e.error.message));
    }
    return b;
};
window.__advance = async (n, motion = false) => {
    const p = window.__probe, c = document.querySelector('canvas'), rect = c.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
        if (motion) {
            const t = i, w = rect.width, h = rect.height;
            const xy = motion === 'sides' ? [w * (.5 + .34 * Math.sin(t * .2)), h * (.66 - .16 * Math.cos(t * .2))]
                : motion === 'circle' ? [w * .5 + 100 * Math.sin(t * .4), h * .68 + 100 * Math.cos(t * .4)]
                : motion === 'zigzag' ? [w * (t % 2 ? .45 : .55), h * .7]
                : [650 + 50 * Math.sin(t * .2), 550 + 25 * Math.cos(t * .2)];
            c.dispatchEvent(new MouseEvent('mousemove', {clientX: rect.left + xy[0], clientY: rect.top + xy[1], bubbles: true}));
        }
        const batch = p.frames.splice(0);
        if (!batch.length) throw new Error('No animation frame queued');
        for (const cb of batch) {await cb(p.simulationFrames * 1000 / 60); p.callbacks++;}
        await p.device.queue.onSubmittedWorkDone(); p.simulationFrames++;
    }
    return {simulationFrames: p.simulationFrames, callbacks: p.callbacks};
};
window.__sample = async () => {
    const p = window.__probe, d = p.device, b = d.createBuffer({size: p.count * 80, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const e = d.createCommandEncoder(); e.copyBufferToBuffer(p.buffers['particles buffer'], 0, b, 0, b.size); d.queue.submit([e.finish()]);
    await b.mapAsync(GPUMapMode.READ); const f = new Float32Array(b.getMappedRange());
    let invalid = 0, energy = 0, maxSpeed = 0, maxY = 0, minY = Infinity, meanY = 0, high = 0, wallHigh = 0;
    for (let i = 0; i < p.count; i++) {
        const o = i * 20, v2 = f[o + 4] ** 2 + f[o + 5] ** 2 + f[o + 6] ** 2;
        for (const j of [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18]) if (!Number.isFinite(f[o + j])) invalid++;
        energy += v2; maxSpeed = Math.max(maxSpeed, Math.sqrt(v2)); maxY = Math.max(maxY, f[o + 1]); minY = Math.min(minY, f[o + 1]); meanY += f[o + 1];
        if (f[o + 1] > 20) {high++; if (f[o] < 4 || f[o] > 65 || f[o + 2] < 4 || f[o + 2] > 65) wallHigh++;}
    }
    b.unmap(); b.destroy();
    return {simulationFrames: p.simulationFrames, callbacks: p.callbacks, invalid, meanV2: energy / p.count, maxSpeed, minY, maxY, meanY: meanY / p.count, high, wallHigh, errors: p.errors};
};
