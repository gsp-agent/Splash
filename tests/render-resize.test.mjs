import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Exercise the real app lifecycle and GPU descriptors; this does not execute WGSL.
const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL('../main.ts', import.meta.url))],
    bundle: true, write: false, format: 'iife', loader: { '.wgsl': 'text' },
    plugins: [{ name: 'test-gui', setup(build) {
        build.onResolve({ filter: /^lil-gui$/ }, () => ({ path: 'gui', namespace: 'test' }));
        build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
            export default class GUI {
                addFolder() { return this; }
                add(params) { globalThis.guiParams = params; return this; }
                name() { return this; }
                listen() { return this; }
                close() { return this; }
            }
        ` }));
    } }],
});

async function fixture() {
    const frames = [], textures = [], buffers = [], pipelines = [], writes = [], passes = [];
    const fetches = [], uploads = [], bitmaps = [];
    const canvas = { clientWidth: 390, clientHeight: 844, addEventListener() {} };
    for (const dimension of ['width', 'height']) {
        let value = 0;
        Object.defineProperty(canvas, dimension, {
            get: () => value, set: next => { value = Math.trunc(next); },
        });
    }
    const texture = descriptor => {
        const result = { descriptor, destroyed: false, destroyCount: 0,
            createView() { return { texture: result }; },
            destroy() { result.destroyed = true; result.destroyCount++; },
        };
        return result;
    };
    const validateResource = resource => {
        assert.ok(!resource.texture?.destroyed, 'a submitted pass must not reference a destroyed texture');
        assert.ok(!resource.buffer?.destroyed, 'a submitted pass must not reference a destroyed buffer');
    };
    const beginPass = (descriptor, mode) => {
        const pass = { descriptor, mode, draws: [], dispatches: [] };
        if (mode === 'render') {
            const attachments = [...descriptor.colorAttachments, descriptor.depthStencilAttachment].filter(Boolean);
            for (const attachment of attachments) validateResource(attachment.view);
            assert.ok(attachments.every(a =>
                a.view.texture.descriptor.size[0] === attachments[0].view.texture.descriptor.size[0] &&
                a.view.texture.descriptor.size[1] === attachments[0].view.texture.descriptor.size[1]),
            'attachments in a render pass must have equal dimensions');
        }
        passes.push(pass);
        let pipeline, bindGroup;
        const validate = () => {
            assert.equal(bindGroup.layout.pipeline, pipeline, 'bind group must belong to the selected pipeline');
            bindGroup.entries.forEach(entry => validateResource(entry.resource));
        };
        return {
            setBindGroup(index, value) { bindGroup = value; pass.bindGroup = value; },
            setPipeline(value) { pipeline = value; pass.pipeline = value; },
            draw(...args) { validate(); pass.draws.push(args); },
            dispatchWorkgroups(...args) { validate(); pass.dispatches.push({ args, pipeline, bindGroup }); },
            end() {},
        };
    };
    const device = {
        lost: new Promise(() => {}),
        queue: {
            writeBuffer(buffer, offset, data) {
                const bytes = data instanceof ArrayBuffer ? data : data.buffer;
                writes.push({ buffer, byteLength: data.byteLength,
                    floats: data.byteLength <= 272 ? Array.from(new Float32Array(bytes, data.byteOffset ?? 0, data.byteLength / 4)) : [],
                });
            },
            copyExternalImageToTexture(source, destination, size) { uploads.push({ source, destination, size }); }, submit() {},
        },
        createTexture(descriptor) { const result = texture(descriptor); textures.push(result); return result; },
        createBuffer(descriptor) {
            const result = { descriptor, destroyed: false, destroyCount: 0,
                destroy() { result.destroyed = true; result.destroyCount++; },
            };
            buffers.push(result); return result;
        },
        createShaderModule(descriptor) { return descriptor; },
        createSampler(descriptor) { return descriptor; },
        createBindGroup(descriptor) { return { ...descriptor, entries: descriptor.entries.map(entry => ({ ...entry })) }; },
        createRenderPipeline(descriptor) { return this.createComputePipeline(descriptor); },
        createComputePipeline(descriptor) {
            const result = { descriptor, getBindGroupLayout(index) { return { pipeline: result, index }; } };
            pipelines.push(result); return result;
        },
        createCommandEncoder() { return {
            beginRenderPass: descriptor => beginPass(descriptor, 'render'),
            beginComputePass: descriptor => beginPass(descriptor, 'compute'),
            copyBufferToTexture() {}, finish() { return {}; },
        }; },
    };
    const context = { configure() {}, getCurrentTexture: () => texture({ size: [canvas.width, canvas.height, 1] }) };
    canvas.getContext = () => context;
    const elements = { fluidCanvas: canvas, particle: { checked: false }, slider: { value: '100' }, 'error-reason': {} };
    const globals = vm.createContext({
        console: { log() {} },
        navigator: { gpu: { requestAdapter: async () => ({ requestDevice: async () => device }), getPreferredCanvasFormat: () => 'bgra8unorm' } },
        document: { querySelector: () => canvas, getElementById: id => elements[id], addEventListener() {} },
        window: { matchMedia: () => ({ matches: true }) },
        fetch: async src => { fetches.push(src); return { ok: true, blob: async () => ({ src }) }; },
        createImageBitmap: async blob => {
            const poster = blob.src === 'clayface-poster.jpg';
            const bitmap = { width: poster ? 2000 : 8, height: poster ? 3000 : 8,
                closeCount: 0, close() { this.closeCount++; },
            };
            bitmaps.push(bitmap); return bitmap;
        },
        requestAnimationFrame: callback => frames.push(callback),
        GPUTextureUsage: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 },
        GPUBufferUsage: { STORAGE: 1, COPY_DST: 2, UNIFORM: 4, COPY_SRC: 8 }, GPUColorWrite: { RED: 1 },
        ArrayBuffer, Float32Array, Int32Array,
    });
    vm.runInContext(outputFiles[0].text, globals);
    // main() waits for adapter and background/environment assets before scheduling its first frame.
    for (let i = 0; !frames.length && i < 40; i++) await Promise.resolve();
    assert.equal(frames.length, 1, 'initialization must schedule a frame');
    const frame = async () => { passes.length = 0; await frames.shift()(); };
    await frame();
    return { canvas, device, globals, elements, frame, textures, buffers, pipelines, writes, passes, fetches, uploads, bitmaps };
}

test('portrait/landscape resize updates every render target and shader scale, preserves state and releases prior resources', async () => {
    const app = await fixture();
    const params = app.globals.guiParams;
    params.viscosity = 2.4;
    params.r = 100;
    params.colorDensity = 3.2;
    const particleBuffer = app.buffers.find(buffer => buffer.descriptor.label === 'particles buffer');
    const particleWrites = () => app.writes.filter(write => write.buffer === particleBuffer).length;
    assert.equal(particleWrites(), 1, 'initial particle state is seeded once');
    const initialComputePipelines = app.pipelines.filter(pipeline => pipeline.descriptor.compute);
    const poster = app.textures.find(t => t.descriptor.label === 'Clayface poster texture');
    let priorTextures = app.textures.slice(1).filter(t => t !== poster && t.descriptor.dimension !== '3d'); // Keep the poster, cubemap and density grid.
    let priorRenderBuffers = app.buffers.slice(-6);
    for (const [width, height, particleMode] of [
        [844, 390, false], [390, 844, true], [1200, 800, false],
        [600, 400, true], [1, 1, false], [390, 844, true],
    ]) {
        app.canvas.clientWidth = width;
        app.canvas.clientHeight = height;
        app.elements.particle.checked = particleMode;
        await app.frame();
        const renderWidth = Math.max(1, Math.floor(width * 0.7));
        const renderHeight = Math.max(1, Math.floor(height * 0.7));
        assert.equal(app.canvas.width, renderWidth, 'drawing buffer must follow displayed width');
        assert.equal(app.canvas.height, renderHeight, 'drawing buffer must follow displayed height');
        const activeTextures = app.textures.filter(t => t !== poster && !t.destroyed && t.descriptor.dimension !== '3d' && t.descriptor.size[2] !== 6);
        assert.equal(activeTextures.length, 6, 'there must be exactly one current set of render targets');
        for (const texture of activeTextures) {
            const thickness = texture.descriptor.format === 'r16float';
            assert.deepEqual(Array.from(texture.descriptor.size), thickness
                ? [Math.max(1, Math.floor(renderWidth / 2)), Math.max(1, Math.floor(renderHeight / 2)), 1]
                : [renderWidth, renderHeight, 1]);
        }
        for (const pipeline of app.pipelines.slice(-9)) {
            const { vertex, fragment } = pipeline.descriptor;
            if (vertex.constants) assert.deepEqual({ ...vertex.constants }, { screenHeight: renderHeight, screenWidth: renderWidth });
            if (fragment.constants?.projectedParticleConstant !== undefined) {
                const expected = 12 * 1.2 * 0.05 * (renderHeight / 2) / Math.tan(40 * Math.PI / 360);
                assert.equal(fragment.constants.projectedParticleConstant, expected);
            }
            if (fragment.constants?.thicknessTextureWidth !== undefined) {
                assert.equal(fragment.constants.thicknessTextureWidth, Math.max(1, Math.floor(renderWidth / 2)));
                assert.equal(fragment.constants.thicknessTextureHeight, Math.max(1, Math.floor(renderHeight / 2)));
            }
        }
        const compute = app.passes.find(pass => pass.mode === 'compute');
        assert.ok(compute, 'the existing simulation must still execute');
        const update = app.writes.filter(write => write.buffer.descriptor.label === 'mouse info buffer').at(-1);
        assert.deepEqual(update.floats.slice(0, 2), [renderWidth, renderHeight], 'stirring must sample the resized depth map');
        const uniforms = app.writes.filter(write => write.byteLength === 272).at(-1).floats;
        assert.ok(uniforms.every(Number.isFinite), 'camera and rendering uniforms must remain finite');
        assert.ok(Math.abs(uniforms[25] / uniforms[20] - width / height) < 1e-6,
            'the camera projection must use the displayed aspect alongside the resized render targets');
        const renderedDepth = app.passes.find(pass => pass.pipeline?.descriptor.label === (particleMode ? 'sphere pipeline' : 'depthMap pipeline'));
        assert.ok(renderedDepth, 'both fluid and particle modes must draw their current depth target');
        const depthTexture = renderedDepth.descriptor.colorAttachments[0].view.texture;
        const depthBinding = compute.dispatches.flatMap(dispatch => dispatch.bindGroup.entries)
            .find(entry => entry.binding === 4 && entry.resource.texture);
        assert.ok(depthBinding, 'the simulation must have a depth-map binding');
        assert.equal(depthBinding.resource.texture, depthTexture, 'stirring must read the depth map currently being rendered');
        assert.ok(app.passes[0].descriptor.colorAttachments?.[0].view.texture === depthTexture,
            'a new depth map must be cleared before the first simulation reads it');
        assert.equal(app.passes[0].descriptor.colorAttachments[0].clearValue.r, 1e6);
        assert.equal(particleWrites(), 1, 'resize must preserve particle state');
        assert.deepEqual(app.pipelines.filter(pipeline => pipeline.descriptor.compute), initialComputePipelines);
        assert.equal(app.globals.guiParams, params, 'GUI callbacks must keep their existing settings object');
        assert.deepEqual([params.viscosity, params.r, params.colorDensity], [2.4, 100, 3.2]);
        assert.equal(renderedDepth.draws[0][1], 70000, 'the chosen particle count must persist');
        assert.ok(priorTextures.every(t => t.destroyCount === 1), 'prior render textures must be released exactly once');
        assert.ok(priorRenderBuffers.every(b => b.destroyCount === 1), 'prior renderer uniform buffers must be released exactly once');
        priorTextures = activeTextures;
        priorRenderBuffers = app.buffers.slice(-6);
    }
    const counts = [app.textures.length, app.buffers.length, app.pipelines.length];
    await app.frame();
    assert.deepEqual([app.textures.length, app.buffers.length, app.pipelines.length], counts, 'unchanged dimensions must not reallocate');
    assert.ok(priorTextures.every(t => !t.destroyed));
});

test('poster stays centered and fully contained at the displayed aspect, including resizes within one drawing-buffer size', async () => {
    const app = await fixture();
    for (const [width, height, expectedScale] of [
        [600, 900, [1, 1]],
        [1200, 900, [0.5, 1]],
        [300, 900, [1, 0.5]],
        [844, 390, [130 / 422, 1]],
        [390, 844, [1, 585 / 844]],
        [1, 1, [2 / 3, 1]],
        [1, 2, [1, 0.75]],
    ]) {
        app.canvas.clientWidth = width;
        app.canvas.clientHeight = height;
        await app.frame();
        const background = app.passes.find(pass => pass.pipeline?.descriptor.label === 'bgColor pipeline');
        assert.ok(background, 'the actual app must draw the poster through the background pass');
        const scaleBinding = background.bindGroup.entries.find(entry => entry.binding === 0);
        assert.ok(scaleBinding?.resource.buffer, 'the background must bind its current contain scale');
        const write = app.writes.filter(write => write.buffer === scaleBinding.resource.buffer).at(-1);
        assert.ok(write, 'the visible aspect must be written before rendering');
        const scale = write.floats;
        assert.equal(scale.length, 2);
        scale.forEach((value, axis) => assert.ok(Math.abs(value - expectedScale[axis]) < 1e-7));
        assert.ok(Math.abs(scale[0] * width / (scale[1] * height) - 2 / 3) < 1e-7,
            'displayed poster dimensions must retain the original 2:3 proportions');
        assert.ok(scale.every(value => value > 0 && value <= 1), 'the whole poster must fit inside the viewport');
        assert.equal(Math.max(...scale), 1, 'contain fit must use all available space along one axis');
    }
});

test('poster is uploaded once, survives every renderer replacement, and feeds the clay reveal texture', async () => {
    const app = await fixture();
    const poster = app.textures.find(t => t.descriptor.label === 'Clayface poster texture');
    assert.ok(poster, 'the app must create the approved image texture');
    assert.deepEqual(Array.from(poster.descriptor.size), [2000, 3000, 1]);
    assert.equal(poster.descriptor.format, 'rgba8unorm', 'background values must keep their sRGB encoding through the unorm compositor');
    const upload = app.uploads.find(upload => upload.destination.texture === poster);
    assert.ok(upload, 'the decoded poster must actually be uploaded');
    assert.deepEqual(Array.from(upload.size), [2000, 3000]);
    assert.equal(upload.destination.colorSpace, 'srgb');
    assert.equal(upload.source.source.closeCount, 1, 'release the decoded image after its upload');
    assert.equal(app.fetches.filter(src => src === 'clayface-poster.jpg').length, 1);
    for (const [width, height, particleMode] of [[844, 390, false], [390, 844, true], [1200, 800, false]]) {
        app.canvas.clientWidth = width;
        app.canvas.clientHeight = height;
        app.elements.particle.checked = particleMode;
        await app.frame();
        const background = app.passes.find(pass => pass.pipeline?.descriptor.label === 'bgColor pipeline');
        assert.ok(background);
        assert.equal(background.bindGroup.entries.find(entry => entry.binding === 2)?.resource.texture, poster,
            'every replacement renderer must reuse the original image');
        const composite = app.passes.find(pass => pass.pipeline?.descriptor.label ===
            (particleMode ? 'density raymarch pipeline' : 'fluid rendering pipeline'));
        assert.ok(composite, 'the selected clay rendering path must still execute');
        assert.equal(composite.bindGroup.entries.find(entry => entry.binding === 5)?.resource.texture,
            background.descriptor.colorAttachments[0].view.texture,
            'the fluid compositor must sample the rendered poster, allowing it through actual gaps');
        assert.equal(poster.destroyCount, 0, 'a renderer owns its targets, not the shared poster');
    }
    assert.equal(app.textures.filter(t => t.descriptor.label === 'Clayface poster texture').length, 1);
    assert.equal(app.uploads.filter(upload => upload.destination.texture === poster).length, 1);
    assert.equal(app.fetches.filter(src => src === 'clayface-poster.jpg').length, 1);
});
