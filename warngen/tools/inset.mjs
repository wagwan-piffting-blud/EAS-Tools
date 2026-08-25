/**
 * us_counties.geojson and us_cities.json lay Alaska and Hawaii out as map insets rather
 * than at their true coordinates -- Alaska sits at lon -129..-109, lat 12..27, southwest of
 * the CONUS. Any dataset built from real-world coordinates has to be moved into the same
 * inset space or it lands in the ocean off Baja.
 *
 * The transforms below were fit by least squares against 16 Alaskan and 7 Hawaiian places
 * that appear in both us_cities.json (inset) and authoritative gazetteers (true), by
 * tools/fit_inset.mjs. Residuals: Alaska 0.001 degrees, Hawaii 0.015 degrees. The scales
 * are anisotropic because the inset squashes Alaska horizontally to fit the layout.
 */

export const INSETS = {
    AK: { lat: [0.750031, -26.251927], lon: [0.349976, -63.803602], cwas: ['AFC', 'AFG', 'AJK'] },
    HI: { lat: [0.996108, 6.080350], lon: [0.999200, 51.874379], cwas: ['HFO'] }
};

/**
 * Offices whose areas are inset in the basemap but have no verified transform here.
 * Puerto Rico, Guam, the Marianas and American Samoa are laid out as insets too, but the
 * city anchors available for them are too ambiguous to fit confidently, so anything they
 * own is dropped rather than placed somewhere wrong.
 */
export const UNPLACEABLE_CWAS = ['SJU', 'GUM', 'PQE', 'PQW', 'STU'];

const BY_CWA = {};
for (const [state, spec] of Object.entries(INSETS)) {
    for (const cwa of spec.cwas) BY_CWA[cwa] = { state, spec };
}

export function insetForCwa(cwa) {
    return BY_CWA[cwa] || null;
}

export function isUnplaceable(cwa) {
    return UNPLACEABLE_CWAS.indexOf(cwa) !== -1;
}

/**
 * Alaska straddles the antimeridian, and the western Aleutians come through the source data
 * as positive longitudes. Unwrap them so the linear fit stays continuous across 180.
 */
function unwrapLon(lon, state) {
    return (state === 'AK' && lon > 0) ? lon - 360 : lon;
}

export function applyInset(spec, state, lat, lon) {
    return [
        spec.lat[0] * lat + spec.lat[1],
        spec.lon[0] * unwrapLon(lon, state) + spec.lon[1]
    ];
}
