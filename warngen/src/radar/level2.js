(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./bzip2.js"));
    } else {
        root.WarngenLevel2 = factory(root.WarngenBzip2);
    }
}(typeof self !== "undefined" ? self : this, function (Bzip2) {
    "use strict";

    /**
     * NEXRAD Archive II (ICD 2620010) reader for the pieces WarnGen draws: Message 31 radials,
     * grouped into sweeps. Accepts a whole volume, the start chunk plus any "I"/"E" chunks
     * from the real-time feed, or files that were gunzipped or bunzipped wholesale.
     */

    var CTM_BYTES = 12;
    var HEADER_BYTES = 16;
    var LEGACY_FRAME = 2432;
    var MOMENTS = ["REF", "VEL", "SW", "ZDR", "PHI", "RHO", "CFP"];

    var MOMENT_INFO = {
        REF: { label: "Reflectivity", units: "dBZ" },
        VEL: { label: "Velocity", units: "m/s" },
        SW: { label: "Spectrum width", units: "m/s" },
        ZDR: { label: "Differential reflectivity", units: "dB" },
        PHI: { label: "Differential phase", units: "deg" },
        RHO: { label: "Correlation coefficient", units: "" },
        CFP: { label: "Clutter filter power removed", units: "dB" }
    };

    function ascii(bytes, start, length) {
        var s = "";
        for (var i = 0; i < length; i++) s += String.fromCharCode(bytes[start + i]);
        return s;
    }

    function isGzip(bytes) {
        return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    }

    function gunzip(bytes) {
        if (typeof DecompressionStream === "function") {
            var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
            return new Response(stream).arrayBuffer().then(function (buf) {
                return new Uint8Array(buf);
            });
        }
        if (typeof require === "function") {
            return Promise.resolve(new Uint8Array(require("zlib").gunzipSync(bytes)));
        }
        return Promise.reject(new Error("This browser cannot open gzip files."));
    }

    function readVolumeHeader(bytes) {
        if (bytes.length < 24 || ascii(bytes, 0, 4) !== "AR2V") return null;
        var view = new DataView(bytes.buffer, bytes.byteOffset, 24);
        var days = view.getUint32(12);
        var ms = view.getUint32(16);
        return {
            version: ascii(bytes, 4, 4),
            time: new Date((days - 1) * 86400000 + ms),
            icao: ascii(bytes, 20, 4).replace(/\0/g, "").trim()
        };
    }

    // Splits the LDM-compressed record stream into decompressed message buffers.
    function unpackRecords(bytes, start, records) {
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        var pos = start;
        if (pos + 8 <= bytes.length && !Bzip2.isStream(bytes, pos + 4)) {
            records.push(bytes.subarray(pos));
            return;
        }
        while (pos + 8 <= bytes.length) {
            var size = Math.abs(view.getInt32(pos));
            if (!size || !Bzip2.isStream(bytes, pos + 4)) break;
            var end = Math.min(bytes.length, pos + 4 + size);
            records.push(Bzip2.decompress(bytes.subarray(pos + 4, end)));
            pos = end;
        }
    }

    function readMoment(body, view, ptr) {
        var name = ascii(body, ptr + 1, 3).trim();
        var gates = view.getUint16(ptr + 8);
        var wordSize = body[ptr + 19];
        var bytesPerGate = wordSize === 16 ? 2 : 1;
        var start = ptr + 28;
        var end = Math.min(body.length, start + gates * bytesPerGate);
        return {
            name: name,
            gates: Math.floor((end - start) / bytesPerGate),
            first: view.getUint16(ptr + 10),
            spacing: view.getUint16(ptr + 12),
            wordSize: wordSize,
            scale: view.getFloat32(ptr + 20),
            offset: view.getFloat32(ptr + 24),
            data: body.subarray(start, end)
        };
    }

    function readMessage31(body, state) {
        var view = new DataView(body.buffer, body.byteOffset, body.byteLength);
        var radial = {
            time: (view.getUint16(8) - 1) * 86400000 + view.getUint32(4),
            azimuth: view.getFloat32(12),
            azimuthResolution: body[20] === 1 ? 0.5 : 1,
            status: body[21],
            elevationNumber: body[22],
            elevation: view.getFloat32(24),
            moments: {}
        };
        var blocks = Math.min(10, view.getUint16(30));
        for (var i = 0; i < blocks; i++) {
            var ptr = view.getUint32(32 + i * 4);
            if (!ptr || ptr + 4 > body.length) continue;
            var type = String.fromCharCode(body[ptr]);
            var name = ascii(body, ptr + 1, 3);
            if (type === "R" && name === "VOL") {
                state.site = {
                    lat: view.getFloat32(ptr + 8),
                    lon: view.getFloat32(ptr + 12),
                    height: view.getInt16(ptr + 16) + view.getUint16(ptr + 18)
                };
                state.vcp = view.getUint16(ptr + 40);
            } else if (type === "D") {
                var moment = readMoment(body, view, ptr);
                if (MOMENTS.indexOf(moment.name) !== -1 && moment.gates > 0) {
                    radial.moments[moment.name] = moment;
                }
            }
        }
        state.icao = state.icao || ascii(body, 0, 4).replace(/\0/g, "").trim();
        return radial;
    }

    function walkMessages(record, state, radials) {
        var pos = 0;
        while (pos + CTM_BYTES + HEADER_BYTES <= record.length) {
            var head = new DataView(record.buffer, record.byteOffset + pos + CTM_BYTES, HEADER_BYTES);
            var halfwords = head.getUint16(0);
            var type = record[pos + CTM_BYTES + 3];
            if (type === 31) {
                var length = halfwords * 2;
                if (length < HEADER_BYTES) break;
                var start = pos + CTM_BYTES + HEADER_BYTES;
                radials.push(readMessage31(record.subarray(start, pos + CTM_BYTES + length), state));
                pos += CTM_BYTES + length;
            } else {
                if (type === 1) state.legacy = true;
                pos += LEGACY_FRAME;
            }
        }
    }

    function buildSweeps(radials) {
        var sweeps = [];
        var current = null;
        radials.forEach(function (radial) {
            var names = Object.keys(radial.moments).sort().join(",");
            var startsSweep = !current || radial.elevationNumber !== current.elevationNumber ||
                radial.status === 0 || radial.status === 3 || radial.status === 5;
            if (startsSweep) {
                current = {
                    elevationNumber: radial.elevationNumber,
                    radials: [],
                    momentNames: {},
                    time: radial.time
                };
                sweeps.push(current);
            }
            Object.keys(radial.moments).forEach(function (m) { current.momentNames[m] = true; });
            current.radials.push(radial);
            current.signature = names;
        });
        sweeps = sweeps.filter(function (s) { return s.radials.length >= 90; });
        sweeps.forEach(function (sweep, index) {
            var sum = 0;
            sweep.radials.forEach(function (r) { sum += r.elevation; });
            sweep.index = index;
            sweep.elevation = Math.round(sum / sweep.radials.length * 10) / 10;
            sweep.moments = MOMENTS.filter(function (m) { return sweep.momentNames[m]; });
            sweep.radials.sort(function (a, b) { return a.azimuth - b.azimuth; });
            delete sweep.momentNames;
            delete sweep.signature;
        });
        return sweeps;
    }

    function parseBytes(parts) {
        var state = { header: null, site: null, vcp: null, icao: "", legacy: false };
        var records = [];
        parts.forEach(function (bytes) {
            var header = readVolumeHeader(bytes);
            if (header && !state.header) state.header = header;
            unpackRecords(bytes, header ? 24 : 0, records);
        });
        var radials = [];
        records.forEach(function (record) { walkMessages(record, state, radials); });
        if (!radials.length) {
            if (state.legacy) {
                throw new Error("This file uses the pre-2008 Message 1 format, which isn't supported.");
            }
            throw new Error("No radar data was found. Expected a NEXRAD Level II (Archive II) file.");
        }
        if (!state.site) throw new Error("The file has no radar site location (missing VOL block).");
        var sweeps = buildSweeps(radials);
        if (!sweeps.length) throw new Error("The file has no complete sweeps.");
        return {
            icao: (state.header && state.header.icao) || state.icao,
            time: state.header ? state.header.time : new Date(radials[0].time),
            vcp: state.vcp,
            site: state.site,
            sweeps: sweeps
        };
    }

    // Accepts one or more ArrayBuffer/Uint8Array parts, in feed order.
    function parse(inputs) {
        var list = Array.isArray(inputs) ? inputs : [inputs];
        return Promise.all(list.map(function (input) {
            var bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
            if (isGzip(bytes)) return gunzip(bytes);
            if (Bzip2.isStream(bytes, 0)) return Bzip2.decompress(bytes);
            return bytes;
        })).then(parseBytes);
    }

    function value(moment, gate) {
        var code = moment.wordSize === 16
            ? (moment.data[gate * 2] << 8) | moment.data[gate * 2 + 1]
            : moment.data[gate];
        if (code < 2) return code === 1 ? "RF" : null;
        return (code - moment.offset) / moment.scale;
    }

    return {
        parse: parse,
        value: value,
        MOMENTS: MOMENTS,
        MOMENT_INFO: MOMENT_INFO
    };
}));
