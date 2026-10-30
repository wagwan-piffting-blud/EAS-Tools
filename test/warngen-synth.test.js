import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const synth = require('../warngen/src/radar/synth.js');

const site = { lat: 40, lon: -100, height: 300 };
const storm = { lat: 40.5, lon: -99.5 };

describe('WarnGen synthetic radar volumes', () => {
    it('rejects invalid, too-close, and out-of-range geometry', () => {
        expect(() => synth.generate()).toThrow('radar site needs');
        expect(() => synth.generate({ site })).toThrow('storm needs');
        expect(() => synth.generate({ site, storm: site })).toThrow('too close');
        expect(() => synth.generate({ site, storm: { lat: 45, lon: -90 } })).toThrow('within');
    });

    it('generates a deterministic tornadic supercell volume and feature locations', () => {
        const volume = synth.generate({
            site, storm, icao: 'ksnx-extra', type: 'supercell', tornadic: true,
            intensity: 'strong', seed: 42, motionBearing: -45, motionSpeedMph: 55,
            time: '2026-01-01T00:00:00.999Z',
        });

        expect(volume).toMatchObject({
            icao: 'KSNX', vcp: 212, site, synthetic: {
                type: 'supercell', label: 'classic supercell', tornadic: true,
                intensity: 'strong', seed: 42, motionBearing: 315, motionSpeedMph: 55,
            },
        });
        expect(volume.time.toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(volume.sweeps).toHaveLength(synth.ELEVATIONS.length);
        expect(volume.sweeps[0].radials).toHaveLength(720);
        expect(volume.sweeps[0]).toMatchObject({ index: 0, elevation: 0.5, moments: synth.MOMENTS });
        expect(volume.sweeps[0].radials[0].moments.REF.data).toHaveLength(920);
        expect(volume.synthetic.features.tornado).toEqual(volume.synthetic.features.meso);
        expect(Number.isFinite(volume.synthetic.features.core.lat)).toBe(true);
    });

    it('generates a QLCS volume with normalized fallback options', () => {
        const volume = synth.generate({
            site: { lat: '40', lon: '-100' }, storm, type: 'qlcs', intensity: 'weak',
            seed: 'not-a-number', motionBearing: 'not-a-number', motionSpeedMph: -10,
            time: 0,
        });

        expect(volume.synthetic).toMatchObject({
            type: 'qlcs', label: 'QLCS / bow echo', tornadic: false,
            intensity: 'weak', seed: 1, motionBearing: 45, motionSpeedMph: 0,
        });
        expect(volume.site).toEqual({ lat: 40, lon: -100, height: 0 });
        expect(volume.synthetic.features.tornado).toBeNull();
        expect(volume.synthetic.features.bookend).not.toBeNull();
        expect(volume.sweeps.at(-1).radials.at(-1).status).toBe(4);
    });

    it('supports the non-tornadic supercell branch and unknown option fallbacks', () => {
        const volume = synth.generate({
            site, storm, type: 'unknown', intensity: 'unknown', tornadic: false,
            time: '2026-01-01T00:00:00Z',
        });
        expect(volume.synthetic).toMatchObject({
            type: 'supercell', tornadic: false, intensity: 'moderate', seed: 1,
            motionBearing: 45, motionSpeedMph: 35,
        });
        expect(volume.synthetic.features.tornado).toBeNull();
    });
});
