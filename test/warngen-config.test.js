import { DOMParser } from '@xmldom/xmldom';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const xml = require('../warngen/src/config/xmlParser.js');

const CONFIG = `
<config>
  <include file="geospatialConfig_ALASKA_MARINE.xml"/>
  <productId>FFW</productId>
  <phensig>FF.W</phensig><phensig>FA.W</phensig>
  <includedWatch>FF.A</includedWatch>
  <defaultDuration>30</defaultDuration><duration>15</duration><duration>60</duration>
  <enableDuration>false</enableDuration><trackEnabled>false</trackEnabled>
  <unitDistance> km </unitDistance><unitSpeed> kph </unitSpeed>
  <autoLockText>false</autoLockText><lockedGroupsOnFollowup> locations, CALL TO ACTION, </lockedGroupsOnFollowup>
  <bulletActionGroup/>
  <bulletActionGroup action="NEW" phen="FF" sig="W">
    <bullet bulletName="rain" bulletText="Heavy rain" bulletGroup="basis" bulletType="list" bulletDefault="true" parseString="parse" showString="show"/>
    <damInfoBullet bulletName="Dam A" bulletText="Failure" coords="LAT...LON 2982 9279 2984 9303 3000 9300"/>
  </bulletActionGroup>
  <bulletActionGroup action="NEW" phen="FA"><bullet bulletName="other"/></bulletActionGroup>
  <bulletActionGroup action="CAN" phen="FF"><bullet bulletName="cancel"/></bulletActionGroup>
</config>`;

describe('WarnGen XML configuration parsing', () => {
    beforeEach(() => vi.stubGlobal('DOMParser', DOMParser));
    afterEach(() => vi.unstubAllGlobals());

    it('parses product defaults, actions, bullets, and dam polygons', () => {
        const cfg = xml.parseBulletConfig(CONFIG);
        expect(cfg).toMatchObject({
            productId: 'FFW', phensigs: ['FF.W', 'FA.W'], includedWatches: ['FF.A'], areaSource: 'MARINE',
            defaultDuration: 30, durations: [15, 60], enableDuration: false, trackEnabled: false,
            unitDistance: 'km', unitSpeed: 'kph', autoLockText: false,
            lockedGroupsOnFollowup: ['locations', 'call to action'], actionList: ['NEW', 'CAN'],
        });
        expect(cfg.groups).toHaveLength(3);
        expect(cfg.groups[0].bullets[0]).toEqual({
            name: 'rain', text: 'Heavy rain', group: 'basis', type: 'list', default: true,
            parseString: 'parse', showString: 'show',
        });
        expect(cfg.groups[0].damBullets[0].coords).toEqual([
            [-92.79, 29.82], [-93.03, 29.84], [-93, 30],
        ]);
        expect(cfg.actions.NEW[0].name).toBe('rain');
    });

    it('applies omitted-field defaults and recognizes county and zone sources', () => {
        const county = xml.parseBulletConfig('<config><bulletActionGroup action="NEW"><bullet/></bulletActionGroup></config>');
        expect(county).toMatchObject({
            productId: '', areaSource: 'COUNTY', defaultDuration: 0, durations: [],
            enableDuration: true, trackEnabled: true, unitDistance: 'mi', unitSpeed: 'mph', autoLockText: true,
        });
        expect(county.groups[0]).toMatchObject({ phen: '', sig: 'W' });
        expect(county.groups[0].bullets[0]).toMatchObject({ text: '', default: false });

        const zone = xml.parseBulletConfig('<config><include file="geospatialConfig_ZONE.xml"/></config>');
        expect(zone.areaSource).toBe('ZONE');
        const fallback = xml.parseBulletConfig('<config><include file="geospatialConfig_UNKNOWN.xml"/></config>');
        expect(fallback.areaSource).toBe('COUNTY');
    });

    it('requires a DOM parser and reports malformed XML', () => {
        vi.stubGlobal('DOMParser', undefined);
        expect(() => xml.parseBulletConfig('<config/>')).toThrow('DOMParser not available');
        class ErrorParser {
            parseFromString() {
                return { getElementsByTagName: () => [{ textContent: 'broken markup' }] };
            }
        }
        vi.stubGlobal('DOMParser', ErrorParser);
        expect(() => xml.parseBulletConfig('<broken>')).toThrow('malformed XML: broken markup');
    });

    it('parses pathcast values while retaining defaults for absent and commented fields', () => {
        expect(xml.parsePathcastConfig('')).toEqual({
            distanceThreshold: 4, distanceThresholdLOS: 5, intervalMin: 5, deltaMin: 5, maxResults: 10, maxGroup: 8,
        });
        expect(xml.parsePathcastConfig(`
          <!-- <pathcastConfig><maxResults>99</maxResults></pathcastConfig> -->
          <pathcastConfig><distanceThreshold>2.5</distanceThreshold><distanceThresholdLOS>7</distanceThresholdLOS>
          <interval>3</interval><delta>4</delta><maxResults>12</maxResults><maxGroup>6</maxGroup></pathcastConfig>
        `)).toEqual({ distanceThreshold: 2.5, distanceThresholdLOS: 7, intervalMin: 3, deltaMin: 4, maxResults: 12, maxGroup: 6 });
    });

    it('validates dam coordinates and queries groups without inventing matches', () => {
        expect(xml.parseCoords()).toBeNull();
        expect(xml.parseCoords('LAT...LON 1 2')).toBeNull();
        expect(xml.parseCoords('1 2 3 4 5')).toBeNull();
        expect(xml.phensForAction({ groups: [{ action: 'NEW', phen: 'FF' }, { action: 'NEW', phen: 'FF' }, { action: 'NEW', phen: '' }, { action: 'CAN', phen: 'FA' }] }, 'NEW')).toEqual(['FF']);

        const cfg = xml.parseBulletConfig(CONFIG);
        expect(xml.groupFor(cfg, 'NEW', 'FF')).toBe(cfg.groups[0]);
        expect(xml.groupFor(cfg, 'NEW')).toBe(cfg.groups[0]);
        expect(xml.groupFor(cfg, 'EXP', 'FF')).toBeNull();
        expect(xml.bulletsFor(cfg, 'NEW', 'FF')).toHaveLength(2);
        expect(xml.bulletsFor(cfg, 'NEW', 'missing')).toEqual(cfg.actions.NEW);
        expect(xml.bulletsFor({}, 'NEW', 'FF')).toEqual([]);
        expect(xml.coordsForBullets(cfg, 'NEW', 'FF', ['Dam A'])).toEqual([[-92.79, 29.82], [-93.03, 29.84], [-93, 30]]);
        expect(xml.coordsForBullets(cfg, 'NEW', 'FF', ['missing'])).toBeNull();
        expect(xml.coordsForBullets(cfg, 'EXP', 'FF', ['Dam A'])).toBeNull();
    });
});
