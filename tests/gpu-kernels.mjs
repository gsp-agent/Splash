// Run in a WebGPU page with the production WGSL strings. See VISCOSITY-STUDY.md.
// No copy of the collision or constitutive implementation lives in this fixture.
export async function runKernelRegressions(sources) {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    const device = await adapter.requestDevice();
    const buffers = [], results = [], errors = [];
    device.addEventListener('uncapturederror', e => errors.push(e.error.message));
    device.pushErrorScope('validation');
    const multiplier = 1e7, size = 12, cellsCount = size ** 3;
    const makeBuffer = (data, usage) => {
        const b = device.createBuffer({size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC});
        device.queue.writeBuffer(b, 0, data);
        buffers.push(b);
        return b;
    };
    const uniform = data => makeBuffer(data, GPUBufferUsage.UNIFORM);
    const storage = data => makeBuffer(data, GPUBufferUsage.STORAGE);
    const pipeline = async (code, constants) => {
        const module = device.createShaderModule({code});
        const info = await module.getCompilationInfo();
        for (const m of info.messages) if (m.type === 'error') errors.push(m.message);
        return device.createComputePipelineAsync({layout: 'auto', compute: {module, constants}});
    };
    const group = (p, resources) => device.createBindGroup({layout: p.getBindGroupLayout(0), entries: resources.map((b, binding) => ({binding, resource: b instanceof GPUBuffer ? {buffer: b} : b}))});
    const dispatch = async (p, g, count = 1) => {
        const e = device.createCommandEncoder(), pass = e.beginComputePass();
        pass.setPipeline(p); pass.setBindGroup(0, g); pass.dispatchWorkgroups(count); pass.end();
        device.queue.submit([e.finish()]);
        await device.queue.onSubmittedWorkDone();
    };
    const read = async b => {
        const out = device.createBuffer({size: b.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
        const e = device.createCommandEncoder(); e.copyBufferToBuffer(b, 0, out, 0, b.size); device.queue.submit([e.finish()]);
        await out.mapAsync(GPUMapMode.READ);
        const copy = out.getMappedRange().slice(0); out.unmap(); out.destroy(); return copy;
    };
    const check = (name, actual, expected, tolerance = 2e-5) => {
        const pass = actual.length === expected.length && actual.every((v, i) => Number.isFinite(v) && Math.abs(v - expected[i]) <= tolerance);
        results.push({name, pass, actual, expected});
    };
    try {
        const box = uniform(new Float32Array([size, size, size]));
        const count = uniform(new Uint32Array([1]));
        const dt = uniform(new Float32Array([.1]));
        const particle = storage(new Float32Array(20));
        const cells = storage(new Int32Array(cellsCount * 4));
        const g2p = await pipeline(sources.g2p, {fixedPointMultiplierInverse: 1 / multiplier});
        const g2pGroup = group(g2p, [particle, cells, box, box, count, dt]);
        const affine = [[-.6, .25, .1], [1, -.75, .2], [.5, .25, -.2]]; // columns
        async function particleCase(name, position, velocity, collidedAxes = [], outsideRepair = false) {
            const data = new Float32Array(20); data.set(position); device.queue.writeBuffer(particle, 0, data);
            const grid = new Int32Array(cellsCount * 4);
            for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) {
                const o = ((x * size + y) * size + z) * 4, d = [x + .5 - position[0], y + .5 - position[1], z + .5 - position[2]];
                for (let row = 0; row < 3; row++) grid[o + row] = Math.round(multiplier * (velocity[row] + affine.reduce((v, col, axis) => v + col[row] * d[axis], 0)));
                grid[o + 3] = multiplier;
            }
            device.queue.writeBuffer(cells, 0, grid); await dispatch(g2p, g2pGroup);
            const f = new Float32Array(await read(particle));
            const expectedPosition = position.map((v, axis) => Math.max(3, Math.min(size - 4, v + velocity[axis] * .1)));
            const expectedV = velocity.map((v, axis) => collidedAxes.includes(axis) ? 0 : v);
            check(name + ': position', Array.from(f.slice(0, 3)), expectedPosition);
            check(name + ': normal/tangent velocity', Array.from(f.slice(4, 7)), expectedV);
            check(name + ': affine rows', [8, 9, 10, 12, 13, 14, 16, 17, 18].map(i => f[i]), affine.flat().map((v, i) => collidedAxes.includes(i % 3) ? 0 : v));
            if (outsideRepair) results.push({name: name + ': no added kinetic energy', pass: f.slice(4, 7).reduce((a, v) => a + v * v, 0) <= velocity.reduce((a, v) => a + v * v, 0) + 1e-5});
        }
        await particleCase('left collision falls and slides', [3.01, 6, 6], [-1, -.25, .75], [0]);
        await particleCase('right collision falls and slides', [7.99, 6, 6], [1, -.25, .75], [0]);
        await particleCase('left wall releases inward', [3, 6, 6], [1, -.25, .75]);
        await particleCase('side wall retains gravity', [3, 6, 6], [0, -.4, 0]);
        await particleCase('floor collision retains tangents', [6, 3.01, 6], [.5, -1, .75], [1]);
        await particleCase('ceiling collision releases downward', [6, 7.99, 6], [.5, 1, .75], [1]);
        await particleCase('resized wall projects without spring', [9, 6, 6], [-.1, -.25, .75], [], true);

        const render = uniform(new Float32Array(68));
        const mouse = uniform(new Float32Array([1, 1, 0, 0, 0, 0, 15, 0]));
        const texture = device.createTexture({size: [1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
        device.queue.writeTexture({texture}, new Float32Array([1e5]), {bytesPerRow: 4}, [1, 1]);
        const gridPipeline = await pipeline(sources.updateGrid, {fixedPointMultiplier: multiplier, fixedPointMultiplierInverse: 1 / multiplier});
        const gridGroup = group(gridPipeline, [cells, box, box, render, texture.createView(), mouse, dt]);
        for (const [name, xyz, v, expected] of [
            ['left grid stops outward', [1, 6, 6], [-1, -.25, .75], [0, -.29, .75]],
            ['left grid releases inward', [1, 6, 6], [1, -.25, .75], [1, -.29, .75]],
            ['right grid releases inward', [10, 6, 6], [-1, -.25, .75], [-1, -.29, .75]],
            ['floor grid releases upward', [6, 1, 6], [.5, 1, .75], [.5, .96, .75]],
            ['ceiling grid retains gravity', [6, 10, 6], [.5, 0, .75], [.5, -.04, .75]],
        ]) {
            const grid = new Int32Array(cellsCount * 4), o = ((xyz[0] * size + xyz[1]) * size + xyz[2]) * 4;
            grid.set([...v.map(x => Math.round(x * multiplier)), multiplier], o); device.queue.writeBuffer(cells, 0, grid);
            await dispatch(gridPipeline, gridGroup, Math.ceil(cellsCount / 64));
            const f = new Int32Array(await read(cells)); check(name, [f[o], f[o + 1], f[o + 2]].map(x => x / multiplier), expected);
        }
        texture.destroy();

        const density = storage(new Float32Array(1)), muBuffer = uniform(new Float32Array(1));
        const p2g1 = await pipeline(sources.p2g1, {fixedPointMultiplier: multiplier});
        const p2g2 = await pipeline(sources.p2g2, {fixedPointMultiplier: multiplier, fixedPointMultiplierInverse: 1 / multiplier, stiffness: 50, restDensity: 3});
        const p2g1Group = group(p2g1, [particle, cells, box, count]);
        const p2g2Group = group(p2g2, [particle, cells, box, count, density, dt, muBuffer]);
        const normalize = await pipeline('struct Cell {x:i32,y:i32,z:i32,m:i32}; @group(0) @binding(0) var<storage,read_write> c:array<Cell>; @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u) {if(id.x<arrayLength(&c) && c[id.x].m>0) {let m=f32(c[id.x].m)/1e7; c[id.x].x=i32(f32(c[id.x].x)/m); c[id.x].y=i32(f32(c[id.x].y)/m); c[id.x].z=i32(f32(c[id.x].z)/m);}}', {});
        const normalizeGroup = group(normalize, [cells]);
        for (const mu of [.1, 1, 4]) {
            const stepDt = .32 / Math.ceil(mu * .32 / .12), data = new Float32Array(20);
            data.set([6, 6, 6]); data[8] = 1; data[13] = -.5; data[18] = -.5;
            device.queue.writeBuffer(particle, 0, data); device.queue.writeBuffer(cells, 0, new Int32Array(cellsCount * 4));
            device.queue.writeBuffer(dt, 0, new Float32Array([stepDt])); device.queue.writeBuffer(muBuffer, 0, new Float32Array([mu]));
            await dispatch(p2g1, p2g1Group); await dispatch(p2g2, p2g2Group); await dispatch(normalize, normalizeGroup, Math.ceil(cellsCount / 64)); await dispatch(g2p, g2pGroup);
            const f = new Float32Array(await read(particle)), rho = new Float32Array(await read(density))[0], factor = f[8], expectedFactor = 1 / (1 + 8 * mu * stepDt / rho);
            check('sparse affine relaxation mu=' + mu, [factor, f[13], f[18]], [expectedFactor, -.5 * expectedFactor, -.5 * expectedFactor]);
            results.push({name: 'sparse affine dissipates without reversal mu=' + mu, pass: Number.isFinite(factor) && factor >= 0 && factor <= 1, density: rho, factor, squaredAffineNorm: f[8] ** 2 + f[13] ** 2 + f[18] ** 2});
        }
        const validation = await device.popErrorScope(); if (validation) errors.push(validation.message);
        return {pass: errors.length === 0 && results.every(r => r.pass), results, errors};
    } finally {
        for (const b of buffers) b.destroy(); device.destroy();
    }
}
