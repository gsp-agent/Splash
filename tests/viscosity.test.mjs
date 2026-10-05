import test from 'node:test';
import assert from 'node:assert/strict';
import { viscositySteps } from '../mls-mpm/viscosity.ts';

test('water keeps the original single step', () => {
    assert.deepEqual(viscositySteps(0.1, 0.32), {
        viscosity: 0.1, count: 1, dt: 0.32, impulseScale: 1,
    });
});
test('thickening preserves elapsed simulation time and total pointer impulse', () => {
    for (const mu of [0.1, 0.5, 1, 2, 4]) {
        for (const dt of [0.12, 0.32, 0.4]) {
            const step = viscositySteps(mu, dt);
            assert.ok(Math.abs(step.dt * step.count - dt) < 1e-12);
            assert.ok(Math.abs(step.impulseScale * step.count - 1) < 1e-12);
            assert.ok(step.viscosity * step.dt <= 0.12000001);
        }
    }
    assert.ok(viscositySteps(4, 0.32).count > 1);
});
test('invalid inputs fail and finite inputs stay within the explored range', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
        assert.throws(() => viscositySteps(value, 0.32));
        assert.throws(() => viscositySteps(1, value));
    }
    assert.equal(viscositySteps(100, 1).viscosity, 4);
    assert.equal(viscositySteps(-1, -1).dt, 0);
});
