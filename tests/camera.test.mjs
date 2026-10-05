import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../camera.ts';

function fixture(scale = 0.7) {
    const listeners = {};
    const canvas = {
        width: 1000 * scale, height: 600 * scale,
        clientWidth: 1000, clientHeight: 600,
        getBoundingClientRect: () => ({left: 20, top: 30, width: 1000, height: 600}),
        addEventListener: (name, cb) => { listeners[name] = cb; },
    };
    const camera = new Camera(canvas);
    camera.reset(60, [35, 12, 35], Math.PI / 3, 0.7);
    const move = (x,y) => listeners.mousemove({clientX:x+20, clientY:y+30});
    return {camera, listeners, move};
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
    c.reset(60,[35,12,35],Math.PI/3,.7);
    assert.deepEqual(c.calcMouseVelocity().slice(0,2),[0,0]);
});
