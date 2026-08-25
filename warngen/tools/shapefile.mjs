/**
 * Minimal ESRI shapefile reader and ring simplifier, enough for the NWS zone and marine
 * shapefiles the data builders consume. Deliberately dependency-free, like the rest of
 * warngen/tools.
 */

import fs from 'node:fs';

/** Attribute rows from a .dbf, in record order. */
export function readDbf(file) {
    const buf = fs.readFileSync(file);
    const count = buf.readUInt32LE(4);
    const headerLen = buf.readUInt16LE(8);
    const recordLen = buf.readUInt16LE(10);

    const fields = [];
    for (let off = 32; buf[off] !== 0x0d && off < headerLen; off += 32) {
        fields.push({
            name: buf.toString('latin1', off, off + 11).replace(/\0.*$/, ''),
            len: buf[off + 16]
        });
    }

    const rows = [];
    for (let i = 0; i < count; i++) {
        let off = headerLen + i * recordLen + 1;
        const row = {};
        for (const f of fields) {
            row[f.name] = buf.toString('latin1', off, off + f.len).trim();
            off += f.len;
        }
        rows.push(row);
    }
    return rows;
}

/** Shape type 5 (polygon) records, each an array of rings; other types come back empty. */
export function readShp(file) {
    const buf = fs.readFileSync(file);
    const shapes = [];
    let off = 100;

    while (off < buf.length) {
        const contentLen = buf.readInt32BE(off + 4) * 2;
        const body = off + 8;

        if (buf.readInt32LE(body) === 5) {
            const numParts = buf.readInt32LE(body + 36);
            const numPoints = buf.readInt32LE(body + 40);
            const partsAt = body + 44;
            const pointsAt = partsAt + numParts * 4;

            const starts = [];
            for (let p = 0; p < numParts; p++) starts.push(buf.readInt32LE(partsAt + p * 4));

            const rings = [];
            for (let p = 0; p < numParts; p++) {
                const from = starts[p];
                const to = (p + 1 < numParts) ? starts[p + 1] : numPoints;
                const ring = [];
                for (let i = from; i < to; i++) {
                    ring.push([
                        buf.readDoubleLE(pointsAt + i * 16),
                        buf.readDoubleLE(pointsAt + i * 16 + 8)
                    ]);
                }
                rings.push(ring);
            }
            shapes.push(rings);
        } else {
            shapes.push([]);
        }
        off = body + contentLen;
    }
    return shapes;
}

/* ----------------------------------------------------------- simplifying --- */

function perpDistance(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    const cl = t < 0 ? a : t > 1 ? b : [a[0] + t * dx, a[1] + t * dy];
    return Math.hypot(p[0] - cl[0], p[1] - cl[1]);
}

function douglasPeucker(pts, tol) {
    if (pts.length < 3) return pts.slice();
    let maxD = -1;
    let idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
        const d = perpDistance(pts[i], pts[0], pts[pts.length - 1]);
        if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
    return douglasPeucker(pts.slice(0, idx + 1), tol)
        .slice(0, -1)
        .concat(douglasPeucker(pts.slice(idx), tol));
}

/** Simplify a closed ring, keeping it closed and never dropping below a triangle. */
export function simplifyRing(ring, tol) {
    if (ring.length <= 4) return ring;
    const open = ring.slice(0, -1);
    let out = douglasPeucker(open, tol);
    if (out.length < 3) out = open.filter((_, i) => i % Math.ceil(open.length / 3) === 0).slice(0, 3);
    return out.concat([out[0]]);
}

export function roundRing(ring, places) {
    const f = Math.pow(10, places === undefined ? 4 : places);
    return ring.map(p => [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f]);
}

/* -------------------------------------------------------------- winding --- */

/** Shoelace area: positive when the ring winds counter-clockwise. */
export function ringArea(ring) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
    }
    return a / 2;
}

/** Shapefiles wind outer rings clockwise; GeoJSON wants them counter-clockwise. */
export function isOuterRing(ring) {
    return ringArea(ring) < 0;
}

export function orient(ring, wantCcw) {
    return (ringArea(ring) >= 0) === wantCcw ? ring : ring.slice().reverse();
}

/**
 * Turn one shapefile record's rings into a GeoJSON geometry, applying `place` to every
 * vertex first. Holes attach to the first outer ring, which is what the source data means.
 */
export function toGeometry(rings, tolerance, place) {
    const outers = [];
    const holes = [];
    let vertsIn = 0;
    let vertsOut = 0;

    for (const ring of rings) {
        vertsIn += ring.length;
        const outer = isOuterRing(ring);
        const placed = place ? ring.map(place) : ring;
        const simple = roundRing(orient(simplifyRing(placed, tolerance), outer));
        vertsOut += simple.length;
        (outer ? outers : holes).push(simple);
    }
    if (!outers.length) return null;

    const geometry = outers.length === 1
        ? { type: 'Polygon', coordinates: [outers[0]].concat(holes) }
        : { type: 'MultiPolygon', coordinates: outers.map((o, n) => n === 0 ? [o].concat(holes) : [o]) };

    return { geometry, vertsIn, vertsOut };
}
