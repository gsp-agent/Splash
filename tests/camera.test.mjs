import test from 'node:test';
import assert from 'node:assert/strict';
import { mat4 } from 'wgpu-matrix';
import { Camera, renderUniformsViews } from '../camera.ts';

const fov = 40 * Math.PI / 180;

function fixture(scale = 0.7, width = 1000, height = 600, boxSize = [70, 50, 70]) {
    const listeners = {};
    const canvas = {
        width: width * scale, height: height * scale,
        clientWidth: width, clientHeight: height,
        getBoundingClientRect: () => ({left: 20, top: 30, width: canvas.clientWidth, height: canvas.clientHeight}),
        addEventListener: (name, cb) => { listeners[name] = cb; },
    };
    const camera = new Camera(canvas);
    camera.reset(boxSize, [boxSize[0] / 2, 12, boxSize[2] / 2], fov, 0.7);
    const move = (x,y) => listeners.mousemove({clientX:x+20, clientY:y+30});
    return {camera, canvas, listeners, move};
}

function projectedPoint(point) {
    const transform = (matrix, vector) => Array.from({length: 4}, (_, row) =>
        vector.reduce((sum, value, col) => sum + matrix[col * 4 + row] * value, 0));
    const view = transform(renderUniformsViews.viewMatrix, [...point, 1]);
    const clip = transform(renderUniformsViews.projectionMatrix, view);
    return [clip[0] / clip[3], clip[1] / clip[3]];
}

function projectedBedSpan(boxSize, y) {
    const corners = [
        [3, y, 3], [boxSize[0] - 4, y, 3],
        [3, y, boxSize[2] - 4], [boxSize[0] - 4, y, boxSize[2] - 4],
    ].map(projectedPoint);
    return [0, 1].map(axis => Math.max(...corners.map(p => p[axis])) - Math.min(...corners.map(p => p[axis])));
}

function assertFiniteCamera() {
    for (const key of ['projectionMatrix', 'invProjectionMatrix', 'viewMatrix', 'invViewMatrix']) {
        assert.ok(renderUniformsViews[key].every(Number.isFinite), `${key} must remain finite`);
    }
    const identity = mat4.multiply(renderUniformsViews.viewMatrix, renderUniformsViews.invViewMatrix);
    identity.forEach((value, index) => assert.ok(Math.abs(value - (index % 5 === 0 ? 1 : 0)) < 1e-5));
}

test('pointer projection uses displayed canvas size, independent of render scale', () => {
    const a=fixture(.7).camera, b=fixture(1).camera;
    assert.deepEqual(a.calcPlaneCoord(500,300), [0,0]);
    assert.deepEqual(a.calcPlaneCoord(510,310), b.calcPlaneCoord(510,310));
});
test('first entry, reentry and reset do not inject a jump impulse', () => {
    const {camera:c,listeners,move}=fixture();
    assert.deepEqual(c.calcMouseVelocity().slice(0,2),[0,0]);
    move(400,300);
    assert.deepEqual(c.calcMouseVelocity().slice(0,2),[0,0]);
    c.setNewPrevMouseCoord(); move(410,310);
    assert.ok(c.calcMouseVelocity().every(Number.isFinite));
    assert.ok(c.calcMouseVelocity()[0]>0);
    listeners.mouseleave(); move(850,100);
    assert.deepEqual(c.calcMouseVelocity().slice(0,2),[0,0]);
    c.reset([70,50,70],[35,12,35],fov,.7);
    assert.deepEqual(c.calcMouseVelocity().slice(0,2),[0,0]);
});

test('reset looks straight down with an invertible camera transform at the pole', () => {
    const {camera} = fixture();
    assert.equal(camera.currentYtheta, -Math.PI / 2);
    assertFiniteCamera();
    const inverse = renderUniformsViews.invViewMatrix;
    assert.ok(Math.abs(inverse[12] - camera.target[0]) < 1e-5);
    assert.ok(Math.abs(inverse[13] - camera.target[1] - camera.currentDistance) < 1e-5);
    assert.ok(Math.abs(inverse[14] - camera.target[2]) < 1e-5);
});

test('portrait and landscape cover the bed without stretching its world axes', () => {
    for (const [width, height, boxSize] of [
        [2030, 2492, [70, 50, 70]], [390, 844, [70, 50, 70]],
        [1920, 1080, [70, 50, 70]], [1080, 1920, [110, 50, 50]],
        [1920, 1080, [110, 50, 50]],
    ]) {
        const {camera} = fixture(.7, width, height, boxSize);
        assertFiniteCamera();
        // The target plane checks cover framing; Y=8 samples the observed settled clay height.
        const targetSpan = projectedBedSpan(boxSize, camera.target[1]);
        const settledSpan = projectedBedSpan(boxSize, 8);
        assert.ok(Math.min(...targetSpan) >= 2, `target plane must cover ${width}×${height}`);
        assert.ok(Math.min(...targetSpan) <= 2.1, 'the fitted dimension should crop only slightly');
        assert.ok(Math.min(...settledSpan) >= 1.85, `settled clay must nearly fill ${width}×${height}`);

        const center = projectedPoint(camera.target);
        const alongX = projectedPoint([camera.target[0] + 1, camera.target[1], camera.target[2]]);
        const alongZ = projectedPoint([camera.target[0], camera.target[1], camera.target[2] + 1]);
        const pixelLength = point => Math.hypot((point[0] - center[0]) * width, (point[1] - center[1]) * height);
        assert.ok(Math.abs(pixelLength(alongX) - pixelLength(alongZ)) < 1e-4, 'one world unit has the same pixel length on both bed axes');
        const xMotion = camera.calcPlaneCoord(width / 2 + 10, height / 2)[0];
        const yMotion = camera.calcPlaneCoord(width / 2, height / 2 - 10)[1];
        assert.ok(Math.abs(xMotion - yMotion) < 1e-10, 'equal pointer motion should remain isotropic');
    }
});

test('resize refits the bed while preserving the chosen orbit and relative zoom', () => {
    const {camera, canvas, listeners, move} = fixture(.7, 390, 844);
    move(195, 422);
    listeners.mousedown({clientX: 215, clientY: 452});
    move(185, 402);
    listeners.mouseup();
    listeners.wheel({deltaY: 1, preventDefault() {}});
    const angles = [camera.currentXtheta, camera.currentYtheta];
    const zoom = camera.currentDistance / camera.defaultDistance;
    canvas.clientWidth = 844;
    canvas.clientHeight = 390;
    camera.updateViewport();
    assert.deepEqual([camera.currentXtheta, camera.currentYtheta], angles);
    assert.ok(Math.abs(camera.currentDistance / camera.defaultDistance - zoom) < 1e-10);
    assert.ok(Math.abs(renderUniformsViews.projectionMatrix[5] / renderUniformsViews.projectionMatrix[0] - 844 / 390) < 1e-6);
    assert.deepEqual(camera.calcMouseVelocity().slice(0,2), [0,0]);
    assertFiniteCamera();
});

test('dragging, zoom limits and reset remain finite without stirring on release', () => {
    const {camera, listeners, move} = fixture();
    const initialView = [...renderUniformsViews.viewMatrix];
    const initialDistance = camera.currentDistance;
    move(500,300);
    listeners.mousedown({clientX:520, clientY:330});
    move(510,200);
    listeners.mouseup();
    assert.ok(camera.currentYtheta > -Math.PI / 2, 'drag must orbit away from overhead');
    assert.deepEqual(camera.calcMouseVelocity().slice(0,2), [0,0]);
    assertFiniteCamera();
    for (const deltaY of [-1, 1]) {
        for (let i=0; i<200; i++) listeners.wheel({deltaY, preventDefault() {}});
        assert.equal(camera.currentDistance, deltaY < 0 ? camera.minDistance : camera.maxDistance);
        assertFiniteCamera();
    }
    camera.reset([70,50,70],[35,12,35],fov,.7);
    assert.equal(camera.currentDistance, initialDistance);
    assert.deepEqual([...renderUniformsViews.viewMatrix], initialView);
    assert.deepEqual(camera.calcMouseVelocity().slice(0,2), [0,0]);
});
