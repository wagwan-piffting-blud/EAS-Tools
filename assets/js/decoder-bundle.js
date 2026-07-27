import {
    ENDEC_MODES,
    ENDEC_MODE_SIGNATURES,
    createEndecModeVotes,
    getEndecModeProfile,
    normalizeEndecMode,
    saveFile,
    isObject,
    USES_DARK_THEME
} from './common-functions.js';

import { E2T } from '../E2T/EAS2Text-NG.js';

async function fetchAndStore() {
    function processSameCodes(usCodes, caCodes) {
        window.rgn = {};
        window.state = {};
        window.county = {};
        window.canadaCounty = {};
        window.abbrvs = {
            "United States": "US",
            "Alabama": "AL",
            "Alaska": "AK",
            "Arizona": "AZ",
            "Arkansas": "AR",
            "California": "CA",
            "Colorado": "CO",
            "Connecticut": "CT",
            "Delaware": "DE",
            "District of Columbia": "DC",
            "Florida": "FL",
            "Georgia": "GA",
            "Hawaii": "HI",
            "Idaho": "ID",
            "Illinois": "IL",
            "Indiana": "IN",
            "Iowa": "IA",
            "Kansas": "KS",
            "Kentucky": "KY",
            "Louisiana": "LA",
            "Maine": "ME",
            "Maryland": "MD",
            "Massachusetts": "MA",
            "Michigan": "MI",
            "Minnesota": "MN",
            "Mississippi": "MS",
            "Missouri": "MO",
            "Montana": "MT",
            "Nebraska": "NE",
            "Nevada": "NV",
            "New Hampshire": "NH",
            "New Jersey": "NJ",
            "New Mexico": "NM",
            "New York": "NY",
            "North Carolina": "NC",
            "North Dakota": "ND",
            "Ohio": "OH",
            "Oklahoma": "OK",
            "Oregon": "OR",
            "Pennsylvania": "PA",
            "Rhode Island": "RI",
            "South Carolina": "SC",
            "South Dakota": "SD",
            "Tennessee": "TN",
            "Texas": "TX",
            "Utah": "UT",
            "Vermont": "VT",
            "Virginia": "VA",
            "Washington": "WA",
            "West Virginia": "WV",
            "Wisconsin": "WI",
            "Wyoming": "WY",
            "American Samoa": "AS",
            "Guam": "GU",
            "Northern Mariana Islands": "MP",
            "Puerto Rico": "PR",
            "U.S. Virgin Islands": "VI",
        };
        window.entryPoints = {};
        window.entryNames = {
            "WXR": "National Weather Service",
            "PEP": "Primary Entry Point",
            "EAS": "Emergency Alert System",
            "CIV": "Civil Authority"
        };
        window.events = {};

        const eventSelect = document.getElementById("easyplusEventCode");

        function appendEventOption(code, label) {
            if (!eventSelect) {
                return;
            }
            const option = document.createElement("option");
            option.value = code;
            option.textContent = label;
            eventSelect.appendChild(option);
        }

        const datasets = [
            { data: usCodes, isCanada: false },
            { data: caCodes, isCanada: true }
        ];

        for (const { data, isCanada } of datasets) {
            if (!data) {
                continue;
            }

            if (data['SUBDIV']) {
                for (const code in data['SUBDIV']) {
                    window.rgn[code] = data['SUBDIV'][code];
                }
            }

            if (data['ORGS']) {
                for (const code in data['ORGS']) {
                    if (!window.entryPoints[code]) {
                        window.entryPoints[code] = data['ORGS'][code];
                    }
                }
            }

            if (data['EVENTS']) {
                for (const code in data['EVENTS']) {
                    if (!window.events[code]) {
                        const label = data['EVENTS'][code].replace(/^(a|an|the) /, '').trim();
                        window.events[code] = label;
                        appendEventOption(code, label);
                    }
                }
            }

            if (data['SAME']) {
                if (isCanada) {
                    for (const code in data['SAME']) {
                        window.canadaCounty[code.padStart(5, "0")] = data['SAME'][code];
                    }
                } else {
                    for (const code in data['SAME']) {
                        const stcode = code.slice(0, 2);
                        const countycode = code.slice(2);
                        const name = data['SAME'][code];
                        window.county[stcode] = window.county[stcode] || {};
                        if (!window.county[stcode][countycode]) {
                            window.county[stcode][countycode] = name;
                        }
                        if (countycode === '000' && !window.state[stcode]) {
                            let statename = name.replace(/^State of /, '').trim();
                            const abbrv = window.abbrvs[statename] || statename;
                            window.state[stcode] = abbrv;
                        }
                    }
                }
            }
        }

        const originatorSelect = document.getElementById("easyplusOriginator");
        if (originatorSelect) {
            for (const code in window.entryNames) {
                const name = window.entryNames[code];
                const option = document.createElement("option");
                option.value = code;
                option.textContent = name;
                originatorSelect.appendChild(option);
            }
        }
    }

    const response = await fetch('assets/E2T/include/same-us.json');
    const response2 = await fetch('assets/E2T/include/same-ca.json');
    const dataUS = await response.json();
    const dataCA = await response2.json();
    processSameCodes(dataUS, dataCA);
}

(async function () {
    'use strict';
    await fetchAndStore().catch((error) => {
        console.error('Error fetching and storing data:', error);
    });

    const rgn = window.rgn || {};
    const state = window.state || {};
    const county = window.county || {};
    const entryPoints = window.entryPoints || {};
    const entryNames = window.entryNames || {};
    const events = window.events || {};
    const canadaCounty = window.canadaCounty || {};

    let _offlineDecode = false;
    const CSS_COLOR_TO_HEX = {
        red: '#F44336', green: '#4CAF50', yellow: '#FFEB3B', white: '#FFFFFF',
        black: '#000000', orange: '#FF9800', blue: '#2196F3'
    };
    function addStatus(stat, color = null) {
        const statuselem = document.getElementById("sync");
        statuselem.innerHTML = "STATUS: " + stat;
        if (color) {
            statuselem.style.color = color;
        }
        if (window.EASBridge && !_offlineDecode) {
            const hexColor = (color && color.startsWith('#')) ? color : (CSS_COLOR_TO_HEX[color] || '#FFFFFF');
            window.EASBridge.send('decoder:status', { text: stat, color: hexColor });
        }
    }

    window.modalShown = false;
    window.isRecording = false;

    let sampleRate = 44100;

    const decodeContext = new AudioContext();

    decodeContext.addEventListener("statechange", () => {
        if (window.isRecording &&
            (decodeContext.state === "suspended" || decodeContext.state === "interrupted")) {
            decodeContext.resume().catch(() => {});
        }
    });

    const filter = decodeContext.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1822.9;
    filter.Q.value = 3;

    let micSource = null;
    let streamElement = null;
    let streamSource = null;
    let streamToggleActive = false;
    const trackedStreamElements = new Set();
    const streamProbeAbortControllers = new Set();
    const STREAM_AUTO_GAIN_MIN_RMS = 0.08912509381337455;
    const STREAM_AUTO_GAIN_NOISE_FLOOR_RMS = 0.01;
    const STREAM_AUTO_GAIN_NOISE_FLOOR_PEAK = 0.03;
    const STREAM_AUTO_GAIN_CALIBRATION_TICKS = 16;
    const STREAM_AUTO_GAIN_MIN_ACTIVE_TICKS = 4;
    const STREAM_AUTO_GAIN_MAX = 6;
    const STREAM_AUTO_GAIN_POLL_MS = 220;
    let streamAutoGainSource = null;
    let streamAutoGainNode = null;
    let streamAutoGainAnalyser = null;
    let streamAutoGainBuffer = null;
    let streamAutoGainTimer = 0;
    let streamAutoGainCurrent = 1;
    let streamAutoGainActiveTicks = 0;

    function isCapacitorIOS() {
        try {
            const cap = window.Capacitor;
            if (!cap || typeof cap.getPlatform !== "function" || typeof cap.isNativePlatform !== "function") {
                return false;
            }
            if (!cap.isNativePlatform() || cap.getPlatform() !== "ios") {
                return false;
            }

            const ua = navigator.userAgent || "";
            const isDesktopMac = /\bMacintosh\b/i.test(ua) && !(/\biPhone|\biPad|\biPod\b/i.test(ua)) && !(navigator.maxTouchPoints > 1);
            return !isDesktopMac;
        } catch {
            return false;
        }
    }

    function removeStreamControlsOnCapacitorIOS() { }

    removeStreamControlsOnCapacitorIOS();

    const IOS_STREAM_DECODE_SR = 44100;
    const IOS_STREAM_CHUNK_BYTES = 24576;
    const IOS_STREAM_FRAME_SIZE = 128;
    let iosDecoderFrameRemainder = new Float32Array(0);

    class MiniFFmpeg {
        constructor() {
            this._worker = null;
            this._nextId = 1;
            this._pending = {};
            this.loaded = false;
            this._logs = [];
        }
        _post(type, data, transfer) {
            return new Promise((resolve, reject) => {
                const id = this._nextId++;
                this._pending[id] = { resolve, reject };
                this._worker.postMessage({ id, type, data }, transfer || []);
            });
        }
        _onMessage({ data: msg }) {
            if (msg.type === "LOG") {
                const logMsg = msg.data?.message || msg.data;
                this._logs.push(logMsg);
                if (this._logs.length > 200) this._logs.splice(0, this._logs.length - 100);
                return;
            }
            if (msg.type === "PROGRESS") {
                return;
            }
            const entry = this._pending[msg.id];
            if (!entry) return;
            delete this._pending[msg.id];
            if (msg.type === "ERROR") {
                entry.reject(new Error(String(msg.data)));
            } else {
                entry.resolve(msg.data);
            }
        }
        drainLogs() {
            const copy = this._logs.slice();
            this._logs.length = 0;
            return copy;
        }
        async load() {
            if (this.loaded) return;
            const base = new URL("./", window.location.href).href;
            const workerURL = new URL("assets/muxer/138.bundle.js", base).href;
            this._worker = new Worker(workerURL);
            this._worker.onmessage = (e) => this._onMessage(e);
            this._worker.onerror = (e) => console.error("[iOS stream] Worker error event:", e);
            const coreURL = new URL("assets/muxer/ffmpeg-wasm/ffmpeg-core-single.js", base).href;
            const wasmURL = new URL("assets/muxer/ffmpeg-wasm/ffmpeg-core-single.wasm", base).href;
            await this._post("LOAD", { coreURL, wasmURL });
            this.loaded = true;
        }
        writeFile(path, data) {
            const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
            return this._post("WRITE_FILE", { path, data: buf }, [buf.buffer.slice(0)]);
        }
        readFile(path) { return this._post("READ_FILE", { path, encoding: "binary" }); }
        exec(args) { return this._post("EXEC", { args, timeout: -1 }); }
        deleteFile(path) { return this._post("DELETE_FILE", { path }); }
        terminate() {
            if (this._worker) { this._worker.terminate(); this._worker = null; }
            this.loaded = false;
            this._pending = {};
        }
    }

    class SoftwareBandpass {
        constructor(sr, freq, Q) {
            const w0 = 2 * Math.PI * freq / sr;
            const alpha = Math.sin(w0) / (2 * Q);
            const a0 = 1 + alpha;
            this.b0 = alpha / a0;
            this.b2 = -alpha / a0;
            this.a1 = (-2 * Math.cos(w0)) / a0;
            this.a2 = (1 - alpha) / a0;
            this.x1 = 0; this.x2 = 0;
            this.y1 = 0; this.y2 = 0;
        }
        process(input) {
            const out = new Float32Array(input.length);
            for (let i = 0; i < input.length; i++) {
                const x = input[i];
                const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
                this.x2 = this.x1; this.x1 = x;
                this.y2 = this.y1; this.y1 = y;
                out[i] = y;
            }
            return out;
        }
        reset() { this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
    }

    let iosFFmpeg = null;
    let iosStreamAbort = null;
    let iosBandpass = null;
    let nativeStreamActive = false;
    let iosLoopbackCtx = null;
    let iosLoopbackNode = null;
    let iosLoopbackRing = null;

    class LoopbackRing {
        constructor(capacity) {
            this.buf = new Float32Array(capacity);
            this.w = 0;
            this.r = 0;
            this.len = 0;
            this.cap = capacity;
        }
        push(samples) {
            for (let i = 0; i < samples.length; i++) {
                this.buf[this.w] = samples[i];
                this.w = (this.w + 1) % this.cap;
                if (this.len < this.cap) {
                    this.len++;
                } else {
                    this.r = (this.r + 1) % this.cap;
                }
            }
        }
        pull(output) {
            const n = Math.min(output.length, this.len);
            for (let i = 0; i < n; i++) {
                output[i] = this.buf[this.r];
                this.r = (this.r + 1) % this.cap;
            }
            this.len -= n;
            for (let i = n; i < output.length; i++) output[i] = 0;
        }
    }

    function startIOSLoopback() {
        if (iosLoopbackCtx && iosLoopbackCtx.state !== "closed") {
            if (iosLoopbackCtx.state === "suspended") {
                iosLoopbackCtx.resume().catch(() => {});
            }
            return;
        }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;

        iosLoopbackCtx = new Ctx({ sampleRate: IOS_STREAM_DECODE_SR });
        iosLoopbackRing = new LoopbackRing(IOS_STREAM_DECODE_SR * 2);

        iosLoopbackNode = iosLoopbackCtx.createScriptProcessor(4096, 0, 1);
        iosLoopbackNode.onaudioprocess = (e) => {
            iosLoopbackRing.pull(e.outputBuffer.getChannelData(0));
        };
        iosLoopbackNode.connect(iosLoopbackCtx.destination);

        if (iosLoopbackCtx.state === "suspended") {
            iosLoopbackCtx.resume().catch(() => {});
        }
    }

    function stopIOSLoopback() {
        if (iosLoopbackNode) {
            try { iosLoopbackNode.disconnect(); } catch {}
            iosLoopbackNode = null;
        }
        if (iosLoopbackCtx) {
            iosLoopbackCtx.close().catch(() => {});
            iosLoopbackCtx = null;
        }
        iosLoopbackRing = null;
    }

    function queueIOSLoopbackPCM(pcm) {
        if (iosLoopbackRing && pcm && pcm.length) {
            iosLoopbackRing.push(pcm);
        }
    }

    async function ensureIOSFFmpeg() {
        if (iosFFmpeg && iosFFmpeg.loaded) return iosFFmpeg;
        if (iosFFmpeg) iosFFmpeg.terminate();
        iosFFmpeg = new MiniFFmpeg();
        await iosFFmpeg.load();
        return iosFFmpeg;
    }

    function isFfmpegMemoryFault(err) {
        const msg = String(err?.message || err || "");
        return msg.includes("Out of bounds memory access")
            || msg.includes("_malloc")
            || msg.includes("_ffmpeg");
    }

    function ensureIOSBandpass() {
        if (!iosBandpass) {
            iosBandpass = new SoftwareBandpass(IOS_STREAM_DECODE_SR, 1822.9, 3);
        }
        return iosBandpass;
    }

    async function ffmpegDecodeChunk(ff, rawBytes) {
        const inFile = "ios_in.dat";
        const outFile = "ios_out.raw";

        ff.drainLogs();
        await ff.writeFile(inFile, rawBytes);

        try {
            await ff.exec([
                "-hide_banner", "-loglevel", "error",
                "-i", inFile,
                "-vn", "-f", "f32le", "-acodec", "pcm_f32le",
                "-ar", String(IOS_STREAM_DECODE_SR), "-ac", "1",
                outFile
            ]);
        } catch (e) {
            ff.deleteFile(inFile).catch(() => {});
            ff.deleteFile(outFile).catch(() => {});
            if (isFfmpegMemoryFault(e)) {
                const err = new Error("FFMPEG_MEMORY_FAULT");
                err.code = "FFMPEG_MEMORY_FAULT";
                throw err;
            }
            return null;
        }

        ff.drainLogs();

        let pcmBytes;
        try {
            pcmBytes = await ff.readFile(outFile);
        } catch {
            ff.deleteFile(inFile).catch(() => {});
            return null;
        }
        ff.deleteFile(inFile).catch(() => {});
        ff.deleteFile(outFile).catch(() => {});

        if (!pcmBytes || pcmBytes.length < 4) return null;

        const alignedLen = pcmBytes.length - (pcmBytes.length % 4);
        const aligned = new Uint8Array(alignedLen);
        aligned.set(pcmBytes.subarray(0, alignedLen));
        return new Float32Array(aligned.buffer);
    }

    function feedDecoderFrames(filtered) {
        const combined = concatFloat32(iosDecoderFrameRemainder, filtered);
        let i = 0;
        for (; i + IOS_STREAM_FRAME_SIZE <= combined.length; i += IOS_STREAM_FRAME_SIZE) {
            runDecoder(combined.subarray(i, i + IOS_STREAM_FRAME_SIZE));
        }
        iosDecoderFrameRemainder = i < combined.length
            ? combined.slice(i)
            : new Float32Array(0);
    }

    function concatUint8(a, b) {
        const c = new Uint8Array(a.length + b.length);
        c.set(a, 0);
        c.set(b, a.length);
        return c;
    }

    function concatFloat32(a, b) {
        if (!a || a.length === 0) return b;
        if (!b || b.length === 0) return a;
        const out = new Float32Array(a.length + b.length);
        out.set(a, 0);
        out.set(b, a.length);
        return out;
    }

    function extractOggHeaderPages(data) {
        let offset = 0;
        let headerEnd = 0;

        while (offset + 27 <= data.length) {
            if (data[offset] !== 0x4F || data[offset + 1] !== 0x67 ||
                data[offset + 2] !== 0x67 || data[offset + 3] !== 0x53) {
                break;
            }

            const numSegments = data[offset + 26];
            if (offset + 27 + numSegments > data.length) break;

            let bodySize = 0;
            for (let i = 0; i < numSegments; i++) {
                bodySize += data[offset + 27 + i];
            }

            const pageEnd = offset + 27 + numSegments + bodySize;
            if (pageEnd > data.length) break;

            const g0 = data[offset + 6];
            const g1 = data[offset + 7];
            const g2 = data[offset + 8];
            const g3 = data[offset + 9];
            const g4 = data[offset + 10];
            const g5 = data[offset + 11];
            const g6 = data[offset + 12];
            const g7 = data[offset + 13];
            const granLow = g0 | (g1 << 8) | (g2 << 16) | ((g3 << 24) >>> 0);
            const granHigh = g4 | (g5 << 8) | (g6 << 16) | ((g7 << 24) >>> 0);

            const isGranuleZeroOrFF =
                (granLow === 0 && granHigh === 0) ||
                (granLow === 0xFFFFFFFF && granHigh === 0xFFFFFFFF);

            if (!isGranuleZeroOrFF) {
                break;
            }

            headerEnd = pageEnd;
            offset = pageEnd;
        }

        return data.slice(0, headerEnd);
    }

    function isOggStream(data) {
        return data.length >= 4 &&
            data[0] === 0x4F && data[1] === 0x67 &&
            data[2] === 0x67 && data[3] === 0x53;
    }

    function isOggBosPage(data) {
        return isOggStream(data) && data.length >= 6 && ((data[5] & 0x02) !== 0);
    }

    function getLastCompleteOggPageEnd(data) {
        let offset = 0;
        let lastCompleteEnd = 0;
        while (offset + 27 <= data.length) {
            if (!isOggStream(data.subarray(offset, offset + 4))) {
                break;
            }
            const numSegments = data[offset + 26];
            const lacingEnd = offset + 27 + numSegments;
            if (lacingEnd > data.length) {
                break;
            }
            let bodySize = 0;
            for (let i = 0; i < numSegments; i++) {
                bodySize += data[offset + 27 + i];
            }
            const pageEnd = lacingEnd + bodySize;
            if (pageEnd > data.length) {
                break;
            }
            lastCompleteEnd = pageEnd;
            offset = pageEnd;
        }
        return lastCompleteEnd;
    }

    function getLastSafeOggSplit(data, minBytes = 0) {
        let offset = 0;
        const pages = [];
        while (offset + 27 <= data.length) {
            if (!isOggStream(data.subarray(offset, offset + 4))) {
                break;
            }
            const numSegments = data[offset + 26];
            const lacingEnd = offset + 27 + numSegments;
            if (lacingEnd > data.length) {
                break;
            }
            let bodySize = 0;
            for (let i = 0; i < numSegments; i++) {
                bodySize += data[offset + 27 + i];
            }
            const pageEnd = lacingEnd + bodySize;
            if (pageEnd > data.length) {
                break;
            }
            pages.push({
                end: pageEnd,
                continued: (data[offset + 5] & 0x01) !== 0
            });
            offset = pageEnd;
        }

        if (pages.length < 2) {
            return 0;
        }

        let split = 0;
        for (let i = 0; i < pages.length - 1; i++) {
            const boundary = pages[i].end;
            const nextPageContinued = pages[i + 1].continued;
            if (!nextPageContinued && boundary >= minBytes) {
                split = boundary;
            }
        }
        return split;
    }

    function flattenChunks(list) {
        if (list.length === 1) return list[0];
        let total = 0;
        for (let i = 0; i < list.length; i++) total += list[i].length;
        const out = new Uint8Array(total);
        let off = 0;
        for (let i = 0; i < list.length; i++) {
            out.set(list[i], off);
            off += list[i].length;
        }
        return out;
    }

    async function startIOSStreamDecoder(url) {
        await stopIOSStreamDecoder();
        iosDecoderFrameRemainder = new Float32Array(0);

        addStatus("LOADING FFMPEG...", "yellow");

        let ff;
        try {
            ff = await ensureIOSFFmpeg();
        } catch (e) {
            console.error("[iOS stream] FFmpeg load failed:", e);
            addStatus("FFMPEG LOAD FAILED!", "red");
            return null;
        }

        const bandpass = ensureIOSBandpass();
        bandpass.reset();
        updateSampleRate(IOS_STREAM_DECODE_SR);

        const controller = new AbortController();
        iosStreamAbort = controller;

        let response;
        try {
            response = await fetch(url, { signal: controller.signal });
        } catch (e) {
            if (e.name === "AbortError") return null;
            console.error("[iOS stream] Fetch failed:", e);
            addStatus("STREAM FETCH FAILED!", "red");
            return null;
        }

        if (!response.ok || !response.body) {
            addStatus("STREAM RESPONSE ERROR!", "red");
            return null;
        }

        addStatus("STREAMING...", "green");
        setStreamToggleState(true);

        const clearBtn = document.querySelector('[data-decoder-clear-stream-url]');
        if (clearBtn) clearBtn.style.display = "inline-block";

        setMeterSupported(false);

        if (isLoopbackEnabled()) startIOSLoopback();

        const processPCM = (pcm) => {
            if (!pcm || pcm.length === 0) return;
            if (isLoopbackEnabled()) queueIOSLoopbackPCM(pcm);
            feedDecoderFrames(bandpass.process(pcm));
        };

        (async () => {
            const reader = response.body.getReader();
            const accumChunks = [];
            let accumBytes = 0;
            let oggHeaders = null;
            let isOgg = false;
            let headerExtracted = false;
            let pendingDecode = null;

            const awaitPending = async () => {
                if (!pendingDecode) return null;
                try {
                    const pcm = await pendingDecode;
                    pendingDecode = null;
                    return pcm;
                } catch (e) {
                    pendingDecode = null;
                    if (e?.code === "FFMPEG_MEMORY_FAULT") {
                        try { ff.terminate(); } catch {}
                        ff = await ensureIOSFFmpeg();
                    }
                    return null;
                }
            };

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    accumChunks.push(value);
                    accumBytes += value.length;

                    if (accumBytes < IOS_STREAM_CHUNK_BYTES) continue;

                    let accum = flattenChunks(accumChunks);
                    accumChunks.length = 0;
                    accumBytes = 0;

                    if (!headerExtracted) {
                        if (isOggStream(accum)) {
                            isOgg = true;
                            oggHeaders = extractOggHeaderPages(accum);
                            if (!oggHeaders || oggHeaders.length === 0) {
                                accumChunks.push(accum);
                                accumBytes = accum.length;
                                continue;
                            }
                        }
                        headerExtracted = true;
                    }

                    let raw;
                    if (isOgg) {
                        const splitEnd = getLastSafeOggSplit(accum, IOS_STREAM_CHUNK_BYTES);
                        if (splitEnd <= 0) {
                            accumChunks.push(accum);
                            accumBytes = accum.length;
                            continue;
                        }
                        if (splitEnd < accum.length) {
                            raw = accum.slice(0, splitEnd);
                            const remainder = accum.slice(splitEnd);
                            accumChunks.push(remainder);
                            accumBytes = remainder.length;
                        } else {
                            raw = accum;
                        }
                    } else {
                        raw = accum;
                    }

                    if (isOgg && oggHeaders && oggHeaders.length > 0 && !isOggBosPage(raw)) {
                        raw = concatUint8(oggHeaders, raw);
                    }

                    const prevPCM = await awaitPending();
                    pendingDecode = ffmpegDecodeChunk(ff, raw);
                    processPCM(prevPCM);
                }

                const finalPCM = await awaitPending();
                processPCM(finalPCM);

                addStatus("STREAM ENDED", "yellow");
            } catch (e) {
                if (e.name !== "AbortError") {
                    console.error("[iOS stream] Read error:", e);
                    addStatus("STREAM ERROR!", "red");
                }
            } finally {
                try { processPCM(await awaitPending()); } catch {}

                if (accumChunks.length > 0) {
                    try {
                        let tail = flattenChunks(accumChunks);
                        accumChunks.length = 0;
                        if (isOgg) {
                            const end = getLastCompleteOggPageEnd(tail);
                            tail = end > 0 ? tail.slice(0, end) : new Uint8Array(0);
                        }
                        if (tail.length > 0) {
                            if (isOgg && oggHeaders && oggHeaders.length > 0 && !isOggBosPage(tail)) {
                                tail = concatUint8(oggHeaders, tail);
                            }
                            const pcm = await ffmpegDecodeChunk(ff, tail);
                            processPCM(pcm);
                        }
                    } catch (e) {
                        if (e?.code === "FFMPEG_MEMORY_FAULT") {
                            try { ff.terminate(); } catch {}
                        }
                    }
                }

                if (iosDecoderFrameRemainder.length > 0) {
                    const padded = new Float32Array(IOS_STREAM_FRAME_SIZE);
                    padded.set(iosDecoderFrameRemainder);
                    runDecoder(padded);
                    iosDecoderFrameRemainder = new Float32Array(0);
                }
                flushPendingDecodeTail();
                finalizeActiveSameProduct();
                iosStreamAbort = null;
            }
        })();

        return true;
    }

    async function stopIOSStreamDecoder() {
        if (iosStreamAbort) {
            iosStreamAbort.abort();
            iosStreamAbort = null;
        }
        iosDecoderFrameRemainder = new Float32Array(0);
        stopIOSLoopback();
    }

    let inputTapNode = null;
    let inputTapSource = null;
    let meterInputSource = null;
    const meterElement = document.querySelector("[data-level-meter]");
    const meterFill = meterElement ? meterElement.querySelector("[data-level-fill]") : null;
    const signalStatusEl = document.getElementById("signal-status");
    const SIGNAL_THRESHOLD = 0.05;
    let signalPresent = false;
    let lastSignalAnnounceAt = 0;
    function announceSignalTransition(level) {
        if (!signalStatusEl) return;
        const now = performance.now();
        const isPresent = level >= SIGNAL_THRESHOLD;
        if (isPresent === signalPresent) return;
        if (now - lastSignalAnnounceAt < 2000) return;
        signalPresent = isPresent;
        lastSignalAnnounceAt = now;
        signalStatusEl.textContent = isPresent ? "Audio signal present." : "No audio signal.";
    }
    let levelAnalyser = null;
    let levelBuffer = null;
    let levelFreqBuffer = null;
    let meterSinkGain = null;
    let meterAnimation = 0;
    let meterRunning = false;
    let meterLevel = 0;
    let decoderMeterTarget = 0;
    const METER_DB_MIN = -60;
    const METER_DB_MAX = 0;
    let meterHiddenBySupport = false;
    let loopbackDest = null;
    let loopbackSourceNode = null;
    let streamMonitorGain = null;
    let streamMonitorSourceNode = null;
    const STREAM_RECOVERY_DELAY = 2000;
    const STREAM_RECOVERY_MAX_ATTEMPTS = 5;
    let streamRecoveryTimer = null;
    let streamRecoveryAttempts = 0;
    let streamHasStartedPlayback = false;
    let recordingNode = null;
    let recordingSinkGain = null;
    let recordingSourceNode = null;
    let recordingChunks = [];
    let recordingSampleRate = 0;
    let recordingLength = 0;
    let workletModulePromise = null;
    const AUTO_RECORD_MAX_DURATION = 5 * 60 * 1000;
    let autoRecordingTimer = null;
    let autoRecordingEngaged = false;
    let autoRecordingTriggered = false;

    if (meterFill) {
        levelAnalyser = decodeContext.createAnalyser();
        levelAnalyser.fftSize = 256;
        levelAnalyser.smoothingTimeConstant = 0.25;
        levelBuffer = new Uint8Array(levelAnalyser.fftSize);
        levelFreqBuffer = new Uint8Array(levelAnalyser.frequencyBinCount);
        meterSinkGain = decodeContext.createGain();
        meterSinkGain.gain.value = 0;
        levelAnalyser.connect(meterSinkGain);
        meterSinkGain.connect(decodeContext.destination);
    }

    function rmsToMeterLevel(rms) {
        if (!rms || rms <= 0) {
            return 0;
        }
        const db = 20 * Math.log10(rms);
        if (db <= METER_DB_MIN) {
            return 0;
        }
        if (db >= METER_DB_MAX) {
            return 1;
        }
        return (db - METER_DB_MIN) / (METER_DB_MAX - METER_DB_MIN);
    }

    function setMeterSupported(supported) {
        if (!meterElement) {
            return;
        }
        if (supported) {
            if (meterHiddenBySupport) {
                meterElement.style.display = "";
                meterElement.removeAttribute("aria-hidden");
                meterHiddenBySupport = false;
            }
            return;
        }
        if (!meterHiddenBySupport) {
            meterElement.style.display = "none";
            meterElement.setAttribute("aria-hidden", "true");
            meterHiddenBySupport = true;
        }
        stopMeter();
    }

    const METER_FRAME_INTERVAL = 1000 / 30;
    let meterLastFrameTime = 0;
    let meterLastInset = "";

    function renderMeter(now) {
        if (!meterRunning || !meterFill || !levelAnalyser || !levelBuffer) {
            meterRunning = false;
            meterAnimation = 0;
            return;
        }
        meterAnimation = requestAnimationFrame(renderMeter);
        if (typeof document !== "undefined" && document.hidden) {
            return;
        }
        const ts = typeof now === "number" ? now : 0;
        if (ts && meterLastFrameTime && (ts - meterLastFrameTime) < METER_FRAME_INTERVAL) {
            return;
        }
        meterLastFrameTime = ts;
        let target = 0;
        if (levelAnalyser && levelBuffer) {
            levelAnalyser.getByteTimeDomainData(levelBuffer);
            let sum = 0;
            for (let i = 0; i < levelBuffer.length; i++) {
                const sample = (levelBuffer[i] - 128) / 128;
                sum += sample * sample;
            }
            const rms = Math.sqrt(sum / levelBuffer.length);
            target = rmsToMeterLevel(rms);
        }
        if (decoderMeterTarget > target) {
            target = decoderMeterTarget;
        }
        decoderMeterTarget *= 0.88;
        if (decoderMeterTarget < 0.001) {
            decoderMeterTarget = 0;
        }
        const smoothing = target > meterLevel ? 0.35 : 0.18;
        meterLevel += (target - meterLevel) * smoothing;
        if (meterLevel < 0.001) {
            meterLevel = 0;
        }
        const meterRightInset = (100 - (meterLevel * 100)).toFixed(2) + "%";
        if (meterRightInset !== meterLastInset) {
            meterLastInset = meterRightInset;
            meterFill.style.width = "100%";
            meterFill.style.clipPath = "inset(0 " + meterRightInset + " 0 0)";
            meterFill.style.webkitClipPath = "inset(0 " + meterRightInset + " 0 0)";
            if (meterElement) {
                meterElement.setAttribute("aria-valuenow", meterLevel.toFixed(3));
                let levelLabel;
                if (meterLevel < SIGNAL_THRESHOLD) levelLabel = "No signal";
                else if (meterLevel < 0.25) levelLabel = "Signal: low";
                else if (meterLevel < 0.7) levelLabel = "Signal: medium";
                else levelLabel = "Signal: high";
                meterElement.setAttribute("aria-valuetext", levelLabel);
            }
        }
        announceSignalTransition(meterLevel);
    }

    function startMeter() {
        if (!meterFill || !levelAnalyser || meterRunning) {
            return;
        }
        meterRunning = true;
        meterLastFrameTime = 0;
        meterLastInset = "";
        meterAnimation = requestAnimationFrame(renderMeter);
    }

    function stopMeter() {
        meterRunning = false;
        meterLastInset = "";
        if (meterAnimation) {
            cancelAnimationFrame(meterAnimation);
            meterAnimation = 0;
        }
        meterLevel = 0;
        if (meterFill) {
            meterFill.style.width = "100%";
            meterFill.style.clipPath = "inset(0 100% 0 0)";
            meterFill.style.webkitClipPath = "inset(0 100% 0 0)";
        }
        if (meterElement) {
            meterElement.setAttribute("aria-valuenow", "0");
            meterElement.setAttribute("aria-valuetext", "No signal");
        }
        signalPresent = false;
        lastSignalAnnounceAt = 0;
        if (signalStatusEl) signalStatusEl.textContent = "";
    }

    if (decodeContext.audioWorklet && typeof decodeContext.audioWorklet.addModule === "function") {
        workletModulePromise = decodeContext.audioWorklet.addModule("assets/js/processor.js").then(() => {
            const decodeNode = new AudioWorkletNode(decodeContext, "eas-processor");
            decodeNode.port.onmessage = function (event) {
                if (nativeStreamActive) return;
                const chunk = event.data;
                if (!chunk || !chunk.length) {
                    return;
                }
                const frame = 128;
                if (chunk.length === frame) {
                    runDecoder(chunk);
                    return;
                }
                for (let offset = 0; offset + frame <= chunk.length; offset += frame) {
                    runDecoder(chunk.subarray(offset, offset + frame));
                }
            };
            filter.connect(decodeNode);
            return true;
        });
        workletModulePromise.catch((error) => {
            console.error("Failed to load EAS processor", error);
        });
    } else {
        const error = new Error("AudioWorklet is NOT supported in this context.");
        console.warn(error.message, "Decoder functionality will be limited.");
        workletModulePromise = Promise.reject(error);
        workletModulePromise.catch(() => { });
    }

    const MOBILE_MIC_GAIN = 7;
    const shouldApplyMobileInputGain = typeof navigator !== "undefined" && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent || "");

    function createInputNode(sourceNode, applyMobileGain) {
        if (!applyMobileGain) {
            return sourceNode;
        }
        const gainNode = decodeContext.createGain();
        gainNode.gain.value = MOBILE_MIC_GAIN;
        sourceNode.connect(gainNode);
        return gainNode;
    }

    function createMicInputNode(sourceNode) {
        return createInputNode(sourceNode, shouldApplyMobileInputGain);
    }

    function createStreamInputNode(sourceNode) {
        return createInputNode(sourceNode, false);
    }

    const sel = document.querySelector("#device");
    const micContainer = document.querySelector("[data-mic-container]");
    async function startDecoder(id) {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: id,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        }).catch((error) => {
            console.error("Error accessing microphone:", error);
            return null;
        }).finally(() => { return 1; });
        if (!stream) {
            return null;
        }
        await startDecode(stream);
    }

    function attachInputTap(sourceNode) {
        if (!sourceNode) {
            return;
        }
        detachInputTap();
        const tapNode = decodeContext.createGain();
        tapNode.gain.value = 1;
        try {
            sourceNode.connect(tapNode);
        } catch (error) {
            console.warn("Unable to connect input tap:", error);
            return;
        }
        inputTapSource = sourceNode;
        tapNode.connect(filter);
        if (levelAnalyser) {
            tapNode.connect(levelAnalyser);
            meterInputSource = tapNode;
            startMeter();
        } else {
            meterInputSource = null;
        }
        inputTapNode = tapNode;
    }

    function stopStreamAutoGain() {
        if (streamAutoGainTimer) {
            clearInterval(streamAutoGainTimer);
            streamAutoGainTimer = 0;
        }
        if (streamAutoGainSource) {
            try {
                streamAutoGainSource.disconnect();
            } catch (error) {
                console.warn("Error disconnecting stream source from auto gain path:", error);
            }
        }
        if (streamAutoGainNode) {
            try {
                streamAutoGainNode.disconnect();
            } catch (error) {
                console.warn("Error disconnecting stream auto gain node:", error);
            }
        }
        if (streamAutoGainAnalyser) {
            try {
                streamAutoGainAnalyser.disconnect();
            } catch (error) {
                console.warn("Error disconnecting stream auto gain analyser:", error);
            }
        }
        streamAutoGainSource = null;
        streamAutoGainNode = null;
        streamAutoGainAnalyser = null;
        streamAutoGainBuffer = null;
        streamAutoGainCurrent = 1;
        streamAutoGainActiveTicks = 0;
    }

    function attachStreamInputTap(sourceNode) {
        if (!sourceNode) {
            return;
        }
        stopStreamAutoGain();
        const gainNode = decodeContext.createGain();
        gainNode.gain.value = 1;
        const analyser = decodeContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.75;
        const analyserBuffer = new Float32Array(analyser.fftSize);
        try {
            sourceNode.connect(gainNode);
            sourceNode.connect(analyser);
        } catch (error) {
            console.warn("Unable to create stream auto gain path:", error);
            attachInputTap(sourceNode);
            return;
        }
        streamAutoGainSource = sourceNode;
        streamAutoGainNode = gainNode;
        streamAutoGainAnalyser = analyser;
        streamAutoGainBuffer = analyserBuffer;
        streamAutoGainCurrent = 1;
        streamAutoGainActiveTicks = 0;
        let calibrationTicks = 0;
        let observedRms = 0;
        let observedPeak = 0;
        streamAutoGainTimer = setInterval(() => {
            if (!streamAutoGainAnalyser || !streamAutoGainNode || !streamAutoGainBuffer) {
                return;
            }
            streamAutoGainAnalyser.getFloatTimeDomainData(streamAutoGainBuffer);
            let sumSquares = 0;
            let peak = 0;
            for (let i = 0; i < streamAutoGainBuffer.length; i++) {
                const sample = streamAutoGainBuffer[i];
                const abs = sample < 0 ? -sample : sample;
                if (abs > peak) {
                    peak = abs;
                }
                sumSquares += sample * sample;
            }
            const rms = Math.sqrt(sumSquares / streamAutoGainBuffer.length);
            const hasSignal = rms >= STREAM_AUTO_GAIN_NOISE_FLOOR_RMS || peak >= STREAM_AUTO_GAIN_NOISE_FLOOR_PEAK;
            if (hasSignal) {
                streamAutoGainActiveTicks++;
                if (rms > observedRms) {
                    observedRms = rms;
                }
                if (peak > observedPeak) {
                    observedPeak = peak;
                }
            }
            calibrationTicks++;
            if (calibrationTicks < STREAM_AUTO_GAIN_CALIBRATION_TICKS) {
                return;
            }

            if (streamAutoGainTimer) {
                clearInterval(streamAutoGainTimer);
                streamAutoGainTimer = 0;
            }

            let targetGain = 1;
            if (streamAutoGainActiveTicks >= STREAM_AUTO_GAIN_MIN_ACTIVE_TICKS && observedRms > 0 && observedPeak > 0 && observedRms <= STREAM_AUTO_GAIN_MIN_RMS) {
                const rmsGain = STREAM_AUTO_GAIN_MIN_RMS / observedRms;
                const peakGain = 0.99 / observedPeak;
                targetGain = Math.min(rmsGain, peakGain);
                if (targetGain > STREAM_AUTO_GAIN_MAX) {
                    targetGain = STREAM_AUTO_GAIN_MAX;
                }
            }
            if (targetGain < 1) {
                targetGain = 1;
            }
            streamAutoGainCurrent = targetGain;
            streamAutoGainNode.gain.setValueAtTime(streamAutoGainCurrent, decodeContext.currentTime);

            if (streamAutoGainSource && streamAutoGainAnalyser) {
                try {
                    streamAutoGainSource.disconnect(streamAutoGainAnalyser);
                } catch (error) {
                    console.warn("Error disconnecting stream source from auto gain analyser after calibration:", error);
                }
            }
            if (streamAutoGainAnalyser) {
                try {
                    streamAutoGainAnalyser.disconnect();
                } catch (error) {
                    console.warn("Error disconnecting stream auto gain analyser after calibration:", error);
                }
                streamAutoGainAnalyser = null;
            }
            streamAutoGainBuffer = null;
        }, STREAM_AUTO_GAIN_POLL_MS);
        attachInputTap(gainNode);
    }

    function detachInputTap() {
        if (inputTapSource) {
            try {
                inputTapSource.disconnect();
            } catch (error) {
                console.warn("Error disconnecting source from input tap:", error);
            }
        }
        if (inputTapNode) {
            try {
                inputTapNode.disconnect();
            } catch (error) {
                console.warn("Error disconnecting input tap:", error);
            }
        }
        inputTapSource = null;
        inputTapNode = null;
        meterInputSource = null;
        disconnectStreamMonitorSource();
    }

    function teardownStreamElement(audioElement) {
        if (!audioElement) {
            return;
        }
        trackedStreamElements.delete(audioElement);
        try {
            audioElement.pause();
        } catch (error) {
            console.warn("Error pausing stream element:", error);
        }
        audioElement.autoplay = false;
        audioElement.preload = "none";
        audioElement.muted = true;
        try {
            audioElement.srcObject = null;
        } catch (error) {
            console.warn("Error clearing stream srcObject:", error);
        }
        try {
            audioElement.removeAttribute("src");
            audioElement.src = "";
            if (typeof audioElement.load === "function") {
                audioElement.load();
            }
        } catch (error) {
            console.warn("Error aborting stream element network request:", error);
        }
        audioElement.remove();
    }

    function abortPendingStreamProbes() {
        streamProbeAbortControllers.forEach((controller) => {
            try {
                controller.abort();
            } catch { }
        });
        streamProbeAbortControllers.clear();
    }

    function getCapturedAudioStream(audio) {
        if (!audio) return null;
        const capture = audio.captureStream || audio.webkitCaptureStream;
        if (typeof capture !== "function") {
            return null;
        }
        try {
            return capture.call(audio);
        } catch (error) {
            console.warn("Unable to capture audio stream:", error);
            return null;
        }
    }

    function tryPromoteStreamSourceToCapture(audio) {
        const captured = getCapturedAudioStream(audio);
        if (!captured) {
            return false;
        }
        const tracks = captured.getAudioTracks ? captured.getAudioTracks() : [];
        if (!tracks || tracks.length === 0) {
            return false;
        }
        let source;
        try {
            source = decodeContext.createMediaStreamSource(captured);
        } catch (error) {
            console.warn("Unable to create media stream source from captured stream:", error);
            return false;
        }
        try {
            if (streamSource) {
                streamSource.disconnect();
            }
        } catch (error) {
            console.warn("Error disconnecting original stream source:", error);
        }
        const promotedInputNode = createStreamInputNode(source);
        attachStreamInputTap(promotedInputNode);
        streamSource = source;
        updateSampleRate(decodeContext.sampleRate);
        updateSync(false);
        return true;
    }

    async function startStreamDecoder(url) {
        if (!url) {
            addStatus("INVALID STREAM URL!", "red");
            window.streamUrl = null;
            return null;
        }
        try {
            await decodeContext.resume();
        } catch (error) {
            console.warn("Unable to resume audio context before starting stream:", error);
        }
        if (streamElement) {
            await stopStreamDecode(streamElement.src);
        }

        if (isCapacitorIOS()) {
            try { decodeContext.suspend(); } catch { }
            resetDecoderState();
            const result = await startIOSStreamDecoder(url);
            if (!result) {
                addStatus("STREAM ACCESS FAILED!", "red");
                window.streamUrl = null;
                setStreamToggleState(false);
                return null;
            }
            document.querySelector('[data-decoder-record-toggle]').disabled = true;
            return true;
        }

        setMeterSupported(true);
        streamHasStartedPlayback = false;

        try {
            const clearStreamURLButton = document.querySelector('[data-decoder-clear-stream-url]');
            if (clearStreamURLButton) {
                clearStreamURLButton.style.display = "inline-block";
            }
            const audio = document.createElement("audio");
            audio.crossOrigin = "anonymous";
            audio.src = url;
            audio.autoplay = false;
            audio.controls = false;
            audio.preload = "auto";
            audio.playsInline = true;
            audio.style.display = "none";
            audio.setAttribute("aria-hidden", "true");
            audio.setAttribute("data-decoder-stream", "true");
            audio.muted = false;
            audio.volume = 1;
            document.body.appendChild(audio);
            trackedStreamElements.add(audio);
            const source = decodeContext.createMediaElementSource(audio);
            const streamInputNode = createStreamInputNode(source);
            attachStreamInputTap(streamInputNode);
            updateSampleRate(decodeContext.sampleRate);
            updateSync(false);
            resetStreamRecovery();
            audio.addEventListener("playing", () => {
                if (streamElement === audio) {
                    streamHasStartedPlayback = true;
                    resetStreamRecovery();
                    addStatus("STREAMING...", "green");
                }
            });
            audio.addEventListener("error", (event) => {
                if (streamElement !== audio || !streamToggleActive) {
                    return;
                }
                const mediaError = audio.error;
                if (isRecoverableStreamError(mediaError)) {
                    handleStreamFailure(event, false);
                    scheduleStreamRecovery(audio);
                    return;
                }
                handleStreamFailure(event, true);
                void stopStreamDecode(audio.src);
            });
            streamElement = audio;
            streamSource = source;
            setStreamToggleState(true);
            await playStreamElementWithFallback(audio);
            if (isCapacitorIOS()) {
                tryPromoteStreamSourceToCapture(audio);
            }
            document.querySelector('[data-decoder-record-toggle]').disabled = false;
            addStatus("STREAMING...", "green");
            refreshLoopback();
            return audio;
        } catch (error) {
            console.error("Error starting stream decoder:", error);
            if (streamSource) {
                try {
                    streamSource.disconnect();
                } catch (disconnectError) {
                    console.warn("Error cleaning up failed stream source:", disconnectError);
                }
            }
            if (streamElement) {
                teardownStreamElement(streamElement);
            }
            streamElement = null;
            streamSource = null;
            stopStreamAutoGain();
            detachInputTap();
            stopMeter();
            addStatus("STREAM ACCESS FAILED!", "red");
            window.streamUrl = null;
            setStreamToggleState(false);
            streamHasStartedPlayback = false;
            return null;
        }
    }

    async function stopStreamDecode(url) {
        flushPendingDecodeTail();
        finalizeActiveSameProduct();
        resetDecoderState();
        resetStreamRecovery();
        setStreamToggleState(false);
        abortPendingStreamProbes();
        setMeterSupported(true);

        await stopIOSStreamDecoder();

        if (window.isRecording) {
            stopRecording();
        }
        const activeStreamSource = streamSource;
        stopStreamAutoGain();
        if (loopbackSourceNode) {
            stopLoopback();
        }
        if (activeStreamSource) {
            try {
                activeStreamSource.disconnect();
            } catch (error) {
                console.warn("Error disconnecting stream source:", error);
            }
            streamSource = null;
        }
        detachInputTap();
        stopMeter();
        const teardownTargets = new Set();
        if (streamElement) {
            teardownTargets.add(streamElement);
        }
        if (activeStreamSource && activeStreamSource.mediaElement) {
            teardownTargets.add(activeStreamSource.mediaElement);
        }
        let targetElement = streamElement;
        streamElement = null;
        if (!targetElement && url) {
            const mediaElements = document.getElementsByTagName("audio");
            for (let i = 0; i < mediaElements.length; i++) {
                if (mediaElements[i].src === url || mediaElements[i].getAttribute("data-decoder-stream") === "true") {
                    targetElement = mediaElements[i];
                    break;
                }
            }
        }
        if (targetElement) {
            teardownTargets.add(targetElement);
        }
        document.querySelectorAll("audio[data-decoder-stream='true']").forEach((audio) => teardownTargets.add(audio));
        trackedStreamElements.forEach((audio) => teardownTargets.add(audio));
        teardownTargets.forEach(teardownStreamElement);
        trackedStreamElements.clear();
        streamHasStartedPlayback = false;
        decodeContext.suspend();
        document.querySelector('[data-decoder-toggle]').disabled = false;
        document.querySelector('[data-decoder-load]').disabled = false;
        document.querySelector('[data-decoder-record-toggle]').disabled = true;
        addStatus("WAITING...", USES_DARK_THEME ? "white" : "black");
        if (window.EASBridge) window.EASBridge.send('decoder:streamState', { active: false });
    }

    const RECORD_LABEL_START = "Start Recording (alerts toggle this automatically)";
    const RECORD_LABEL_STOP = "Stop Recording (alerts toggle this automatically)";

    async function startRecording() {
        if (window.isRecording) {
            return true;
        }
        if (nativeStreamActive) {
            recordingSampleRate = sampleRate;
            recordingChunks = [];
            recordingLength = 0;
            window.isRecording = true;
            if (window.EASBridge) window.EASBridge.send('decoder:recordingState', { active: true, auto: false });
            updateRecordButtonLabel(true);
            return true;
        }
        const activeSource = inputTapNode;
        if (!inputTapNode) {
            addStatus("NO AUDIO SOURCE TO RECORD!", "red");
            return;
        }
        if (!workletModulePromise) {
            addStatus("RECORDING NOT SUPPORTED IN THIS BROWSER", "red");
            return false;
        }
        try {
            await workletModulePromise;
        } catch (error) {
            console.warn("Recording worklet unavailable:", error);
            addStatus("RECORDING NOT SUPPORTED IN THIS BROWSER", "red");
            return false;
        }
        try {
            decodeContext.resume();
        } catch (error) {
            console.warn("Unable to resume audio context before recording:", error);
        }
        recordingSampleRate = decodeContext.sampleRate || sampleRate;
        recordingChunks = [];
        recordingLength = 0;
        recordingSourceNode = activeSource;
        const tapChannels = inputTapSource ? inputTapSource.channelCount : activeSource.channelCount;
        const sourceChannels = Math.max(1, tapChannels || 1);
        recordingNode = new AudioWorkletNode(decodeContext, "eas-recorder", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: sourceChannels,
            channelCountMode: "explicit"
        });
        recordingNode.port.onmessage = function (event) {
            if (!window.isRecording) {
                return;
            }
            const channels = event.data;
            if (!channels || !channels.length || !channels[0] || !channels[0].length) {
                return;
            }
            const frameCount = channels[0].length;
            const channelCount = channels.length;
            const chunk = new Float32Array(frameCount);
            for (let channel = 0; channel < channelCount; channel++) {
                const channelData = channels[channel];
                if (!channelData) {
                    continue;
                }
                for (let i = 0; i < frameCount; i++) {
                    chunk[i] += channelData[i];
                }
            }
            if (channelCount > 1) {
                for (let i = 0; i < frameCount; i++) {
                    chunk[i] /= channelCount;
                }
            }
            recordingChunks.push(chunk);
            recordingLength += chunk.length;
        };
        recordingSinkGain = decodeContext.createGain();
        recordingSinkGain.gain.value = 0;
        recordingNode.connect(recordingSinkGain);
        recordingSinkGain.connect(decodeContext.destination);
        try {
            recordingSourceNode.connect(recordingNode);
        } catch (error) {
            console.warn("Unable to connect recording tap:", error);
            if (recordingNode) {
                recordingNode.disconnect();
                recordingNode = null;
            }
            if (recordingSinkGain) {
                recordingSinkGain.disconnect();
                recordingSinkGain = null;
            }
            recordingSourceNode = null;
            recordingChunks = [];
            recordingLength = 0;
            recordingSampleRate = 0;
            return false;
        }
        window.isRecording = true;
        if (window.EASBridge) window.EASBridge.send('decoder:recordingState', { active: true, auto: false });
        updateRecordButtonLabel(true);
        return true;
    }

    async function stopRecording(shouldPatchBoundaries = false) {
        if (!window.isRecording) {
            return false;
        }
        window.isRecording = false;
        if (window.EASBridge) window.EASBridge.send('decoder:recordingState', { active: false, auto: false });
        autoRecordingTriggered = false;
        if (recordingSourceNode && recordingNode) {
            try {
                recordingSourceNode.disconnect(recordingNode);
            } catch (error) {
                console.warn("Error disconnecting recording tap:", error);
            }
        }
        if (recordingNode) {
            recordingNode.port.onmessage = null;
            recordingNode.disconnect();
            recordingNode = null;
        }
        if (recordingSinkGain) {
            recordingSinkGain.disconnect();
            recordingSinkGain = null;
        }
        recordingSourceNode = null;
        updateRecordButtonLabel(false);
        if (!recordingChunks.length || !recordingLength) {
            recordingChunks = [];
            recordingLength = 0;
            return true;
        }
        let pcmData = mergeRecordingChunks(recordingChunks, recordingLength);
        recordingChunks = [];
        recordingLength = 0;
        const outputSampleRate = recordingSampleRate || sampleRate;
        if (shouldPatchBoundaries) {
            pcmData = patchAutoRecordingPcmBoundaries(pcmData, outputSampleRate);
        }
        const wavBuffer = encodeWavBuffer(pcmData, outputSampleRate);
        recordingSampleRate = 0;
        triggerRecordingDownload(wavBuffer);
        resetAutoRecordingState();
        return true;
    }

    function resetAutoRecordingState() {
        if (autoRecordingTimer) {
            clearTimeout(autoRecordingTimer);
            autoRecordingTimer = null;
        }
        autoRecordingEngaged = false;
    }

    function scheduleAutoRecordingTimeout() {
        if (autoRecordingTimer) {
            clearTimeout(autoRecordingTimer);
        }
        autoRecordingTimer = setTimeout(() => {
            autoRecordingTimer = null;
            stopAutoRecording();
        }, AUTO_RECORD_MAX_DURATION);
    }

    function startAutoRecording() {
        if (autoRecordingEngaged || window.isRecording || (!inputTapNode && !nativeStreamActive)) {
            return;
        }
        autoRecordingEngaged = true;
        startRecording().then((started) => {
            if (!started) {
                resetAutoRecordingState();
                autoRecordingTriggered = false;
                return;
            }
            if (!autoRecordingEngaged) {
                if (window.isRecording) {
                    stopRecording();
                }
                return;
            }
            scheduleAutoRecordingTimeout();
            if (window.EASBridge) window.EASBridge.send('decoder:recordingState', { active: true, auto: true });
        }).catch((error) => {
            console.error("Auto recording failed to start:", error);
            resetAutoRecordingState();
            autoRecordingTriggered = false;
        });
    }

    function stopAutoRecording(shouldPatchBoundaries = false) {
        const wasEngaged = autoRecordingEngaged;
        resetAutoRecordingState();
        autoRecordingTriggered = false;
        if (wasEngaged && window.isRecording) {
            stopRecording(shouldPatchBoundaries);
        }
    }

    function mergeRecordingChunks(chunks, totalLength) {
        const merged = new Float32Array(totalLength);
        let offset = 0;
        for (let i = 0; i < chunks.length; i++) {
            merged.set(chunks[i], offset);
            offset += chunks[i].length;
        }
        return merged;
    }

    function encodeWavBuffer(samples, sampleRate) {
        const bytesPerSample = 2;
        const channelCount = 1;
        const dataLength = samples.length * bytesPerSample;
        const buffer = new ArrayBuffer(44 + dataLength);
        const view = new DataView(buffer);

        writeString(view, 0, "RIFF");
        view.setUint32(4, 36 + dataLength, true);
        writeString(view, 8, "WAVE");
        writeString(view, 12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channelCount, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
        view.setUint16(32, channelCount * bytesPerSample, true);
        view.setUint16(34, bytesPerSample * 8, true);
        writeString(view, 36, "data");
        view.setUint32(40, dataLength, true);

        let offset = 44;
        for (let i = 0; i < samples.length; i++, offset += 2) {
            let s = samples[i];
            s = Math.max(-1, Math.min(1, s));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return buffer;
    }

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    async function triggerRecordingDownload(buffer) {
        const filename = `eas-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`;
        try {
            await saveFile(filename, buffer, "audio/wav");
        } catch (e) {
            console.error("saveFile failed:", e, e?.message, e?.stack);
            throw e;
        }
    }

    function updateRecordButtonLabel(isRecordingState) {
        const button = document.querySelector('[data-decoder-record-toggle]');
        if (button) {
            button.innerText = isRecordingState ? RECORD_LABEL_STOP : RECORD_LABEL_START;
        }
    }

    async function getMicrophones() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(e => e.kind == "audioinput");
    }

    async function runDecode(button) {
        const uploadFileButton = document.querySelector('[data-decoder-load]');
        const startStopButton = document.querySelector('[data-decoder-toggle]');
        const streamStartStopButton = document.querySelector('[data-decoder-stream-toggle]');
        const recordButton = document.querySelector('[data-decoder-record-toggle]');
        if (micSource) {
            uploadFileButton.disabled = false;
            await stopDecode();
            button.innerText = "Start Microphone Decoder";
            if (window.EASBridge) window.EASBridge.send('decoder:micState', { active: false });
        } else {
            uploadFileButton.disabled = true;
            resetDecoderState();
            let retval = await startDecoder(sel.value);
            if (retval === null) {
                uploadFileButton.disabled = false;
                startStopButton.disabled = true;
                addStatus("MICROPHONE ACCESS DENIED!", "red");
                return;
            }
            streamStartStopButton.disabled = true;
            recordButton.disabled = false;
            button.innerText = "Stop Microphone Decoder";
            if (window.EASBridge) window.EASBridge.send('decoder:micState', { active: true });
        }
    }

    async function runStreamDecoder(url) {
        const uploadFileButton = document.querySelector('[data-decoder-load]');
        const micStartStopButton = document.querySelector('[data-decoder-toggle]');
        const streamStartStopButton = document.querySelector('[data-decoder-stream-toggle]');

        if (!url) {
            uploadFileButton.disabled = false;
            micStartStopButton.disabled = false;
            setStreamToggleState(false);
            return;
        }
        window.streamUrl = url;

        resetDecoderState();

        let retval = await startStreamDecoder(url);

        if (retval === null) {
            uploadFileButton.disabled = false;
            micStartStopButton.disabled = false;
            addStatus("STREAM ACCESS FAILED!", "red");
            window.streamUrl = null;
            return;
        }

        else {
            uploadFileButton.disabled = true;
            micStartStopButton.disabled = true;
            streamStartStopButton.disabled = false;
        }

        setStreamToggleState(true);
        if (window.EASBridge) window.EASBridge.send('decoder:streamState', { active: true });
    }

    async function populateMicrophones() {
        const mics = await getMicrophones();
        sel.innerHTML = "";
        mics.forEach(mic => {
            const option = document.createElement("option");
            option.value = mic.deviceId;
            option.innerText = mic.label;
            sel.appendChild(option);
        });
        if (micContainer) {
            micContainer.hidden = mics.length === 0;
        }
        sel.disabled = mics.length === 0;
        if (window.EASBridge) {
            const deviceList = mics.map(mic => ({ deviceId: mic.deviceId, label: mic.label || 'Microphone' }));
            window.EASBridge.send('decoder:devices', { devices: deviceList });
        }
    }

    async function startDecode(stream) {
        setMeterSupported(true);
        stopStreamAutoGain();
        const source = decodeContext.createMediaStreamSource(stream);
        const micInputNode = createMicInputNode(source);
        micSource = source;
        attachInputTap(micInputNode);
        updateSampleRate(decodeContext.sampleRate);
        updateSync(false);
        decodeContext.resume();
        refreshLoopback();
    }

    async function stopDecode(resetEndec = true) {
        _bridgeLevelPeak = 0;
        if (window.EASBridge) window.EASBridge.send('decoder:level', { db: METER_DB_MIN });
        flushPendingDecodeTail();
        finalizeActiveSameProduct();
        resetDecoderState(resetEndec);
        if (window.isRecording) {
            stopRecording();
        }
        if (!micSource) {
            if (loopbackSourceNode) {
                stopLoopback();
            }
            detachInputTap();
            stopMeter();
            decodeContext.suspend();
            addStatus("WAITING...", USES_DARK_THEME ? "white" : "black");
            return;
        }
        micSource.mediaStream.getTracks().forEach(e => e.stop());
        try {
            micSource.disconnect();
        } catch (error) {
            console.warn("Error disconnecting microphone source:", error);
        }
        micSource = null;
        if (loopbackSourceNode) {
            stopLoopback();
        }
        detachInputTap();
        stopMeter();
        decodeContext.suspend();
        const streamToggleButton = document.querySelector('[data-decoder-stream-toggle]');
        if (streamToggleButton) {
            streamToggleButton.disabled = false;
        }
        document.querySelector('[data-decoder-record-toggle]').disabled = true;
        addStatus("WAITING...", USES_DARK_THEME ? "white" : "black");
    }
    populateMicrophones();

    function isLoopbackEnabled() {
        const loopbackToggle = document.getElementById("decoder-loopback");
        return !!(loopbackToggle && loopbackToggle.checked);
    }

    function ensureStreamMonitorGain() {
        if (streamMonitorGain) {
            return streamMonitorGain;
        }
        streamMonitorGain = decodeContext.createGain();
        streamMonitorGain.gain.value = 0;
        streamMonitorGain.connect(decodeContext.destination);
        return streamMonitorGain;
    }

    function connectStreamMonitorSource(sourceNode = inputTapNode) {
        if (!sourceNode) {
            return;
        }
        const monitorGain = ensureStreamMonitorGain();
        if (streamMonitorSourceNode === sourceNode) {
            return;
        }
        if (streamMonitorSourceNode) {
            try {
                streamMonitorSourceNode.disconnect(monitorGain);
            } catch (error) {
                console.warn("Error disconnecting previous stream monitor source:", error);
            }
        }
        try {
            sourceNode.connect(monitorGain);
            streamMonitorSourceNode = sourceNode;
        } catch (error) {
            console.warn("Unable to connect stream monitor source:", error);
        }
    }

    function disconnectStreamMonitorSource() {
        if (streamMonitorSourceNode && streamMonitorGain) {
            try {
                streamMonitorSourceNode.disconnect(streamMonitorGain);
            } catch (error) {
                console.warn("Error disconnecting stream monitor source:", error);
            }
        }
        streamMonitorSourceNode = null;
        if (streamMonitorGain) {
            streamMonitorGain.gain.setValueAtTime(0, decodeContext.currentTime);
        }
    }

    function setStreamMonitorEnabled(enabled) {
        if (streamElement && !micSource) {
            connectStreamMonitorSource(inputTapNode);
            if (streamMonitorGain) {
                streamMonitorGain.gain.setValueAtTime(enabled ? 1 : 0, decodeContext.currentTime);
            }
            return;
        }
        disconnectStreamMonitorSource();
    }

    function syncStreamElementLoopbackState(targetElement = streamElement) {
        if (!targetElement) {
            return;
        }
        if (streamElement && !micSource) {
            targetElement.muted = false;
            targetElement.volume = 1;
            if (targetElement.paused && streamToggleActive && typeof targetElement.play === "function") {
                const playPromise = targetElement.play();
                if (playPromise && typeof playPromise.catch === "function") {
                    playPromise.catch(() => { });
                }
            }
            return;
        }
        targetElement.muted = false;
        targetElement.volume = 1;
    }

    function refreshLoopback() {
        syncStreamElementLoopbackState();
        if (streamElement && !micSource) {
            if (loopbackSourceNode) {
                stopLoopback();
            }
            setStreamMonitorEnabled(isLoopbackEnabled());
            return;
        }
        setStreamMonitorEnabled(false);
        if (!isLoopbackEnabled()) {
            if (loopbackSourceNode) {
                stopLoopback();
            }
            return;
        }
        startLoopback();
    }

    async function startLoopback() {
        await stopLoopback();
        syncStreamElementLoopbackState();

        const loopbackSource = inputTapNode;
        if (!loopbackSource) return;

        loopbackDest = decodeContext.createMediaStreamDestination();
        loopbackSourceNode = loopbackSource;
        loopbackSourceNode.connect(loopbackDest);

        const audio = document.createElement("audio");
        audio.srcObject = loopbackDest.stream;
        audio.autoplay = true;
        audio.controls = false;
        audio.style.display = "none";
        audio.setAttribute("aria-hidden", "true");
        audio.setAttribute("aria-loopback", "true");
        document.body.appendChild(audio);

        const playPromise = audio.play && audio.play();
        if (playPromise?.catch) playPromise.catch(() => { });
    }

    async function stopLoopback() {
        syncStreamElementLoopbackState();

        if (loopbackSourceNode && loopbackDest) {
            try { loopbackSourceNode.disconnect(loopbackDest); }
            catch (e) { console.warn("Error disconnecting loopback source", e); }
        }
        loopbackSourceNode = null;
        loopbackDest = null;

        document.querySelectorAll("audio[aria-loopback='true']").forEach(a => {
            a.srcObject = null;
            a.remove();
        });
    }

    function setStreamToggleState(active) {
        streamToggleActive = active;
        const streamStartStopButton = document.querySelector('[data-decoder-stream-toggle]');
        if (streamStartStopButton) {
            streamStartStopButton.innerText = active ? "Stop Stream Decoder" : "Start Stream Decoder";
        }
    }

    function resetStreamRecovery() {
        if (streamRecoveryTimer) {
            clearTimeout(streamRecoveryTimer);
            streamRecoveryTimer = null;
        }
        streamRecoveryAttempts = 0;
    }

    function isAutoplayBlockError(error) {
        const name = String(error?.name || "");
        if (name === "NotAllowedError") {
            return true;
        }
        const message = String(error?.message || "").toLowerCase();
        return message.includes("notallowederror")
            || message.includes("gesture")
            || message.includes("user activation")
            || message.includes("autoplay");
    }

    async function playStreamElementWithFallback(audioElement) {
        if (!audioElement || typeof audioElement.play !== "function") {
            return;
        }
        syncStreamElementLoopbackState(audioElement);
        try {
            await audioElement.play();
            return;
        } catch (error) {
            if (!isAutoplayBlockError(error)) {
                throw error;
            }
            audioElement.muted = true;
            audioElement.volume = 0;
            await audioElement.play();
            syncStreamElementLoopbackState(audioElement);
        }
    }

    function isRecoverableStreamError(mediaError) {
        if (!mediaError) {
            return true;
        }
        const abortedCode = typeof MediaError !== "undefined" && MediaError.MEDIA_ERR_ABORTED ? MediaError.MEDIA_ERR_ABORTED : 1;
        const networkCode = typeof MediaError !== "undefined" && MediaError.MEDIA_ERR_NETWORK ? MediaError.MEDIA_ERR_NETWORK : 2;
        if (mediaError.code === abortedCode || mediaError.code === networkCode) {
            return true;
        }
        const decodeCode = typeof MediaError !== "undefined" && MediaError.MEDIA_ERR_DECODE ? MediaError.MEDIA_ERR_DECODE : 3;
        const srcNotSupportedCode = typeof MediaError !== "undefined" && MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED : 4;
        return streamHasStartedPlayback && (mediaError.code === decodeCode || mediaError.code === srcNotSupportedCode);
    }

    function scheduleStreamRecovery(audioElement) {
        if (streamRecoveryTimer || !streamToggleActive) {
            return;
        }
        if (streamRecoveryAttempts >= STREAM_RECOVERY_MAX_ATTEMPTS) {
            handleStreamFailure(new Error("Stream recovery failed"), true);
            void stopStreamDecode(audioElement.src);
            return;
        }
        streamRecoveryAttempts++;
        addStatus("RECONNECTING STREAM...", "yellow");
        streamRecoveryTimer = setTimeout(async () => {
            streamRecoveryTimer = null;
            if (streamElement !== audioElement || !streamToggleActive) {
                return;
            }
            try {
                audioElement.load();
                await playStreamElementWithFallback(audioElement);
                addStatus("STREAMING...", "green");
                resetStreamRecovery();
            } catch (retryError) {
                scheduleStreamRecovery(audioElement);
            }
        }, STREAM_RECOVERY_DELAY);
    }

    function handleStreamFailure(error, fatal = false) {
        console.warn("Stream playback error", error);
        if (fatal) {
            addStatus("STREAM ERROR!", "red");
            setStreamToggleState(false);
            window.streamUrl = null;
            return;
        }
        addStatus("STREAM INTERRUPTED...", "yellow");
    }

    document.addEventListener("click", () => {
        if (!sel.innerHTML) {
            populateMicrophones();
        }
    });

    const ENDEC_DEBUG_HEAD_BYTES = 96;
    const ENDEC_DEBUG_TAIL_BYTES = 96;

    function createEndecCharacteristicsState() {
        return {
            knownModes: ENDEC_MODE_SIGNATURES,
            votes: createEndecModeVotes(),
            markers: {
                preambleSplit: 0,
                preambleRun16: 0,
                preambleRun17Plus: 0,
                terminatorZero: 0,
                validTerminatorZero: 0,
                terminatorZeroRun2Plus: 0,
                terminatorFF: 0,
                validTerminatorFF: 0,
                terminatorFFRun1: 0,
                terminatorFFRun3Plus: 0,
                digitalLeadZero: 0
            },
            timing: {
                samples: 0,
                averageGapMs: 0,
                lastGapMs: 0,
                trilithicGapHits: 0,
                trilithicAfterGapHits: 0,
                standardGapHits: 0
            }
        };
    }

    let endecCharacteristics = createEndecCharacteristicsState();
    let detectedEndecMode = "DEFAULT";
    let sameProductSequence = 0;
    let activeSameProduct = null;
    const sameProductResults = new Map();
    if (typeof window !== "undefined" && typeof window.endecDebug !== "boolean") {
        window.endecDebug = false;
    }

    function snapshotEndecCounters() {
        return {
            markers: Object.assign({}, endecCharacteristics.markers),
            timing: Object.assign({}, endecCharacteristics.timing)
        };
    }

    function createSameProductState() {
        sameProductSequence++;
        return {
            id: sameProductSequence,
            headerKey: "",
            baseline: snapshotEndecCounters(),
            segments: [],
            alerts: [],
            rawBytes: {
                total: 0,
                head: [],
                tail: []
            },
            mode: "Detecting...",
            ready: false
        };
    }

    function ensureActiveSameProduct() {
        if (!activeSameProduct) {
            activeSameProduct = createSameProductState();
        }
        return activeSameProduct;
    }

    function normalizeSameProductHeaderKey(rawHeader) {
        return (typeof rawHeader === "string") ? rawHeader.trim().toUpperCase() : "";
    }

    function maybeRotateSameProduct(rawHeader) {
        const product = ensureActiveSameProduct();
        const key = normalizeSameProductHeaderKey(rawHeader);
        if (!key || key.startsWith("NNNN")) {
            return product;
        }
        if (!product.headerKey) {
            product.headerKey = key;
            return product;
        }
        if (product.headerKey !== key && product.segments.length > 0) {
            finalizeActiveSameProduct();
            const next = ensureActiveSameProduct();
            next.headerKey = key;
            return next;
        }
        return product;
    }

    function clearSameProductState() {
        activeSameProduct = null;
        sameProductSequence = 0;
        sameProductResults.clear();
        eomCount = 0;
    }

    function diffCounterObjects(current, baseline) {
        const out = {};
        for (const key in current) {
            const cur = current[key] || 0;
            const base = baseline[key] || 0;
            out[key] = Math.max(0, cur - base);
        }
        return out;
    }

    function formatHexByteList(bytes) {
        if (!Array.isArray(bytes) || bytes.length === 0) {
            return "";
        }
        return bytes.map((byteValue) => (byteValue & 0xFF).toString(16).padStart(2, "0")).join(" ");
    }

    function noteSameProductByte(byteValue) {
        if (!Number.isFinite(byteValue)) {
            return;
        }
        const byte = byteValue & 0xFF;
        const product = ensureActiveSameProduct();
        const raw = product.rawBytes;
        raw.total++;
        if (raw.head.length < ENDEC_DEBUG_HEAD_BYTES) {
            raw.head.push(byte);
            return;
        }
        if (raw.tail.length >= ENDEC_DEBUG_TAIL_BYTES) {
            raw.tail.shift();
        }
        raw.tail.push(byte);
    }

    function buildSameProductAnalysis(mode, rule, metrics) {
        return { mode, rule, metrics };
    }

    function logSameProductAnalysis(product, analysis) {
        if (!(typeof window !== "undefined" && window.endecDebug)) {
            return;
        }
        const headerPreview = (product.headerKey || "").slice(0, 96);
        const rawInfo = {
            total: product.rawBytes?.total || 0,
            headHex: formatHexByteList(product.rawBytes?.head || []),
            tailHex: formatHexByteList(product.rawBytes?.tail || []),
            headCount: product.rawBytes?.head?.length || 0,
            tailCount: product.rawBytes?.tail?.length || 0
        };
        const compactSegments = product.segments.map((segment) => ({
            type: segment.type,
            reason: segment.reason,
            termByte: segment.terminatorByte,
            termRun: segment.terminatorRunLength
        }));
        console.groupCollapsed(`[ENDEC DEBUG] product=${product.id} mode=${analysis.mode} rule=${analysis.rule}`);
        console.log("header", headerPreview);
        console.log("alerts", product.alerts.length, "segments", product.segments.length);
        console.log("metrics", analysis.metrics);
        console.log("segments", compactSegments);
        console.log("rawBytes", rawInfo);
        console.groupEnd();
        const exportRecord = {
            productId: product.id,
            header: headerPreview,
            mode: analysis.mode,
            rule: analysis.rule,
            metrics: analysis.metrics,
            segments: compactSegments,
            rawBytes: rawInfo
        };
        window.lastEndecDebug = exportRecord;
        if (!Array.isArray(window.endecDebugHistory)) {
            window.endecDebugHistory = [];
        }
        window.endecDebugHistory.push(exportRecord);
        if (window.endecDebugHistory.length > 200) {
            window.endecDebugHistory.shift();
        }
        console.log(`[ENDEC DEBUG EXPORT] ${JSON.stringify(exportRecord)}`);
    }

    function analyzeSameProductMode(product) {
        if (!product || !product.segments.length) {
            return buildSameProductAnalysis("DEFAULT", "empty_product", {
                alerts: 0,
                segments: 0
            });
        }
        let termZeroRun2Plus = 0;
        let termFFRun1 = 0;
        let termFFRun3Plus = 0;
        let preambleSplits = 0;
        let maxZeroTermRun = 0;
        let minZeroTermRun = Number.POSITIVE_INFINITY;
        let maxFFTermRun = 0;

        for (let i = 0; i < product.segments.length; i++) {
            const segment = product.segments[i];
            if (segment.reason === "PREAMBLE_SPLIT") {
                preambleSplits++;
            }
            if (segment.reason !== "TERM_BYTE") {
                continue;
            }
            if (segment.terminatorByte === 0x00 && segment.terminatorRunLength >= 2) {
                termZeroRun2Plus++;
                if (segment.terminatorRunLength > maxZeroTermRun) {
                    maxZeroTermRun = segment.terminatorRunLength;
                }
                if (segment.terminatorRunLength < minZeroTermRun) {
                    minZeroTermRun = segment.terminatorRunLength;
                }
            } else if (segment.terminatorByte === 0xFF && segment.terminatorRunLength >= 3) {
                termFFRun3Plus++;
                if (segment.terminatorRunLength > maxFFTermRun) {
                    maxFFTermRun = segment.terminatorRunLength;
                }
            } else if (segment.terminatorByte === 0xFF && segment.terminatorRunLength === 1) {
                termFFRun1++;
            }
        }

        const deltas = snapshotEndecCounters();
        const markers = diffCounterObjects(deltas.markers, product.baseline.markers);
        const timing = diffCounterObjects(deltas.timing, product.baseline.timing);
        const zeroRunSpread = (termZeroRun2Plus > 0 && minZeroTermRun !== Number.POSITIVE_INFINITY)
            ? (maxZeroTermRun - minZeroTermRun)
            : 0;
        const digitalSignalMarkers = (markers.digitalLeadZero >= 1) ? 1 : 0;
        const minNwsRuns = Math.max(4, product.alerts.length + 1);
        const metrics = {
            alerts: product.alerts.length,
            segments: product.segments.length,
            termZeroRun2Plus,
            termFFRun1,
            termFFRun3Plus,
            maxZeroTermRun,
            zeroRunSpread,
            maxFFTermRun,
            preambleSplits,
            minNwsRuns,
            digitalSignalMarkers,
            markers: Object.assign({}, markers),
            timing: Object.assign({}, timing)
        };
        const minSageRuns = Math.max(3, product.alerts.length + 1);
        const exactSage1822ByRun1 = termZeroRun2Plus === 0
            && termFFRun3Plus === 0
            && termFFRun1 >= minSageRuns
            && markers.validTerminatorFF === termFFRun1
            && markers.validTerminatorZero === 0
            && markers.digitalLeadZero === 0
            && timing.trilithicGapHits === 0
            && timing.trilithicAfterGapHits === 0;
        const exactSage1822ByRun3Profile = termZeroRun2Plus === 0
            && termFFRun1 === 0
            && termFFRun3Plus >= minSageRuns
            && markers.validTerminatorFF >= termFFRun3Plus
            && markers.validTerminatorZero === 0
            && markers.digitalLeadZero === 0
            && markers.preambleRun17Plus === 0
            && timing.standardGapHits >= 2
            && timing.trilithicGapHits === 0
            && timing.trilithicAfterGapHits === 0
            && timing.averageGapMs >= 900
            && timing.averageGapMs <= 1055
            && maxFFTermRun <= 160;
        const exactSage1822ByPartialCapture = termZeroRun2Plus === 0
            && termFFRun1 === 0
            && termFFRun3Plus === 2
            && markers.validTerminatorFF >= termFFRun3Plus
            && markers.validTerminatorZero === 0
            && markers.digitalLeadZero === 0
            && markers.preambleRun17Plus === 0
            && preambleSplits >= 1
            && timing.trilithicGapHits === 0
            && timing.trilithicAfterGapHits === 0
            && timing.standardGapHits === 0
            && maxFFTermRun <= 96
            && timing.averageGapMs >= 1040
            && timing.averageGapMs <= 1110;
        const exactSage1822 = exactSage1822ByRun1 || exactSage1822ByRun3Profile || exactSage1822ByPartialCapture;
        metrics.exactSage1822 = exactSage1822;
        metrics.exactSage1822ByRun1 = exactSage1822ByRun1;
        metrics.exactSage1822ByRun3Profile = exactSage1822ByRun3Profile;
        metrics.exactSage1822ByPartialCapture = exactSage1822ByPartialCapture;

        const strongTrilithic = timing.trilithicGapHits >= 2
            && (timing.trilithicAfterGapHits >= 1 || timing.trilithicGapHits > (timing.standardGapHits + 1));
        if (strongTrilithic) {
            return buildSameProductAnalysis("TRILITHIC", "strong_trilithic", metrics);
        }

        const strongDigitalWithLead = markers.digitalLeadZero >= 1
            && (termFFRun3Plus >= 1 || markers.validTerminatorFF >= 2);
        const strongDigitalByFfAndTiming = markers.digitalLeadZero === 0
            && termZeroRun2Plus === 0
            && termFFRun3Plus >= Math.max(3, product.alerts.length + 1)
            && markers.validTerminatorFF >= termFFRun3Plus
            && (timing.trilithicAfterGapHits >= 2 || (maxFFTermRun >= 192 && timing.averageGapMs >= 1065));
        if (strongDigitalWithLead || strongDigitalByFfAndTiming) {
            return buildSameProductAnalysis("SAGE DIGITAL 3644", "strong_digital", metrics);
        }
        const strongDigitalByZeroTiming = markers.digitalLeadZero === 0
            && termFFRun3Plus === 0
            && termFFRun1 === 0
            && termZeroRun2Plus >= minNwsRuns
            && markers.validTerminatorZero >= termZeroRun2Plus
            && timing.standardGapHits >= 3
            && timing.averageGapMs >= 1180
            && maxZeroTermRun <= 192;
        if (strongDigitalByZeroTiming) {
            return buildSameProductAnalysis("SAGE DIGITAL 3644", "digital_zero_timing", metrics);
        }

        const sageLike = (termFFRun1 >= 2 && termFFRun3Plus === 0)
            || (markers.digitalLeadZero === 0 && termFFRun3Plus >= Math.max(3, product.alerts.length + 1))
            || (termFFRun1 >= 3 && termFFRun1 >= (termFFRun3Plus + 2) && digitalSignalMarkers === 0);
        if (sageLike
            && termZeroRun2Plus === 0
            && markers.digitalLeadZero === 0) {
            if (exactSage1822) {
                return buildSameProductAnalysis("SAGE ANALOG 1822", "strong_sage_1822_exact", metrics);
            }
            return buildSameProductAnalysis("SAGE DIGITAL 3644", "sage_like_prefer_digital", metrics);
        }

        const strongNws = termZeroRun2Plus >= minNwsRuns
            && termFFRun3Plus === 0
            && termFFRun1 === 0
            && markers.digitalLeadZero === 0
            && preambleSplits === 0
            && timing.standardGapHits === 0
            && termZeroRun2Plus >= (preambleSplits + 3)
            && timing.trilithicGapHits === 0
            && timing.trilithicAfterGapHits === 0;
        if (strongNws) {
            return buildSameProductAnalysis("NWS", "strong_nws", metrics);
        }

        if (termZeroRun2Plus === 0 && (termFFRun1 > 0 || termFFRun3Plus > 0 || markers.validTerminatorFF > 0)) {
            if (markers.digitalLeadZero === 0) {
                if (exactSage1822) {
                    return buildSameProductAnalysis("SAGE ANALOG 1822", "ff_fallback_exact_1822", metrics);
                }
                return buildSameProductAnalysis("SAGE DIGITAL 3644", "ff_fallback_prefer_digital", metrics);
            }
            const digitalScore =
                (termFFRun3Plus * 1.5) +
                (markers.digitalLeadZero * 2);
            const sageScore =
                (termFFRun1 * 2) +
                (Math.max(0, markers.validTerminatorFF - termFFRun3Plus) * 0.5);
            const fallbackMetrics = Object.assign({}, metrics, { digitalScore, sageScore });
            if (!exactSage1822 && digitalScore === sageScore) {
                return buildSameProductAnalysis("SAGE DIGITAL 3644", "ff_fallback_tie_prefer_digital", fallbackMetrics);
            }
            return buildSameProductAnalysis(digitalScore > sageScore ? "SAGE DIGITAL 3644" : "SAGE ANALOG 1822", "ff_fallback", fallbackMetrics);
        }

        return buildSameProductAnalysis("DEFAULT", "default_fallback", metrics);
    }

    function finalizeActiveSameProduct() {
        if (!activeSameProduct) {
            return;
        }
        const product = activeSameProduct;
        const analysis = analyzeSameProductMode(product);
        const mode = analysis.mode;
        product.mode = mode;
        product.ready = true;
        for (let i = 0; i < product.alerts.length; i++) {
            product.alerts[i].endecMode = mode;
            product.alerts[i].endecModeReady = true;
        }
        sameProductResults.set(product.id, { mode, ready: true, analysis });
        if (sameProductResults.size > 256) {
            const first = sameProductResults.keys().next().value;
            sameProductResults.delete(first);
        }
        logSameProductAnalysis(product, analysis);
        activeSameProduct = null;
    }

    function getEndecCharacteristicsState() {
        if (!endecCharacteristics || typeof endecCharacteristics !== "object") {
            endecCharacteristics = createEndecCharacteristicsState();
        }
        return endecCharacteristics;
    }

    function resetEndecDetection() {
        endecCharacteristics = createEndecCharacteristicsState();
        detectedEndecMode = "DEFAULT";
        activeSameProduct = null;
        sameProductResults.clear();
    }

    function addEndecVote(mode, weight) {
        const characteristics = getEndecCharacteristicsState();
        const normalized = normalizeEndecMode(mode);
        characteristics.votes[normalized] = (characteristics.votes[normalized] || 0) + (weight || 0);
    }

    function isLikelySamePayload(payload) {
        if (typeof payload !== "string") {
            return false;
        }
        const msg = payload.trim().toUpperCase();
        if (!msg) {
            return false;
        }
        if (msg.startsWith("NNNN")) {
            return true;
        }
        if (!msg.startsWith("ZCZC")) {
            return false;
        }
        if (msg.length < 20) {
            return false;
        }
        return msg.includes("+") && msg.includes("-");
    }

    function noteEndecPreambleRun(runLength) {
        if (!Number.isFinite(runLength) || runLength < 15 || runLength > 24) {
            return;
        }
        const characteristics = getEndecCharacteristicsState();
        if (runLength >= 17) {
            characteristics.markers.preambleRun17Plus++;
            addEndecVote("SAGE DIGITAL 3644", 4);
        } else if (runLength >= 15) {
            characteristics.markers.preambleRun16++;
            addEndecVote("DEFAULT", 1.5);
        } else {
            return;
        }
        refreshDetectedEndecMode();
    }

    function detectEndecModeFromCharacteristics() {
        const characteristics = getEndecCharacteristicsState();
        const markers = characteristics.markers;
        const timing = characteristics.timing;
        const votes = characteristics.votes;

        const strongTrilithic = timing.trilithicGapHits >= 2
            && (timing.trilithicGapHits > (timing.standardGapHits + 1) || timing.trilithicAfterGapHits >= 1);
        if (strongTrilithic) {
            return "TRILITHIC";
        }

        const digitalEvidence =
            ((markers.digitalLeadZero >= 1) ? 2 : 0) +
            ((markers.preambleRun17Plus >= 1) ? 1 : 0) +
            ((markers.terminatorFFRun3Plus >= 1) ? 2 : 0);
        const digitalRunTimingSupport = markers.terminatorFFRun3Plus >= 2
            && (timing.trilithicAfterGapHits >= 1 || timing.averageGapMs >= 1065);
        const strongDigital =
            ((markers.digitalLeadZero >= 1) && (markers.preambleRun17Plus >= 1 || markers.terminatorFFRun3Plus >= 1))
            || digitalRunTimingSupport
            || digitalEvidence >= 4;

        const strongSage = markers.terminatorFFRun1 >= 2
            && markers.terminatorFFRun3Plus === 0
            && markers.validTerminatorZero === 0
            && markers.digitalLeadZero === 0
            && markers.preambleRun17Plus === 0;
        const exactSage1822ByRun1 = strongSage
            && markers.validTerminatorFF === markers.terminatorFFRun1;
        const exactSage1822ByRun3Profile = markers.terminatorZeroRun2Plus === 0
            && markers.terminatorFFRun1 === 0
            && markers.terminatorFFRun3Plus >= 3
            && markers.validTerminatorFF >= markers.terminatorFFRun3Plus
            && markers.validTerminatorZero === 0
            && markers.digitalLeadZero === 0
            && markers.preambleRun17Plus === 0
            && timing.standardGapHits >= 2
            && timing.trilithicGapHits === 0
            && timing.trilithicAfterGapHits === 0
            && timing.averageGapMs >= 900
            && timing.averageGapMs <= 1055;
        const exactSage1822ByPartialCapture = markers.terminatorZeroRun2Plus === 0
            && markers.terminatorFFRun1 === 0
            && markers.terminatorFFRun3Plus === 2
            && markers.validTerminatorFF >= markers.terminatorFFRun3Plus
            && markers.validTerminatorZero === 0
            && markers.digitalLeadZero === 0
            && markers.preambleRun17Plus === 0
            && markers.preambleSplit >= 1
            && timing.trilithicGapHits === 0
            && timing.trilithicAfterGapHits === 0
            && timing.standardGapHits === 0
            && timing.averageGapMs >= 1040
            && timing.averageGapMs <= 1110;
        const exactSage1822 = exactSage1822ByRun1 || exactSage1822ByRun3Profile || exactSage1822ByPartialCapture;
        const sageLike = markers.validTerminatorFF >= 2
            && markers.validTerminatorZero === 0
            && markers.digitalLeadZero === 0;

        const strongNws = markers.terminatorZeroRun2Plus >= 2
            && markers.validTerminatorFF === 0
            && markers.digitalLeadZero === 0
            && markers.preambleSplit <= 1
            && timing.trilithicGapHits === 0
            && timing.trilithicAfterGapHits === 0;

        if (strongDigital) {
            return "SAGE DIGITAL 3644";
        }
        if (exactSage1822) {
            return "SAGE ANALOG 1822";
        }
        if (strongSage || sageLike) {
            return "SAGE DIGITAL 3644";
        }
        if (strongNws) {
            return "NWS";
        }

        let bestMode = "DEFAULT";
        let bestScore = votes.DEFAULT;
        for (let i = 1; i < ENDEC_MODES.length; i++) {
            const mode = ENDEC_MODES[i];
            const score = votes[mode];
            if (score > bestScore) {
                bestScore = score;
                bestMode = mode;
            }
        }
        return bestMode;
    }

    function refreshDetectedEndecMode() {
        const mode = detectEndecModeFromCharacteristics();
        detectedEndecMode = mode;
        return mode;
    }

    function getDetectedEndecMode() {
        return normalizeEndecMode(detectedEndecMode);
    }

    function noteEndecSplitReason(reason, byteValue, payload, terminatorRunLength = 1) {
        const characteristics = getEndecCharacteristicsState();
        const validPayload = isLikelySamePayload(payload);
        switch (reason) {
            case "PREAMBLE_SPLIT":
                characteristics.markers.preambleSplit++;
                addEndecVote("DEFAULT", 1.5);
                addEndecVote("TRILITHIC", 2);
                break;
            case "TERM_BYTE":
                if (byteValue === 0x00) {
                    characteristics.markers.terminatorZero++;
                    if (validPayload) {
                        if (terminatorRunLength >= 2) {
                            characteristics.markers.validTerminatorZero++;
                            characteristics.markers.terminatorZeroRun2Plus++;
                            addEndecVote("NWS", 3.5);
                        } else {
                            addEndecVote("NWS", 0.5);
                        }
                    }
                } else if (byteValue === 0xFF) {
                    characteristics.markers.terminatorFF++;
                    if (validPayload) {
                        characteristics.markers.validTerminatorFF++;
                        if (terminatorRunLength >= 3) {
                            characteristics.markers.terminatorFFRun3Plus++;
                            addEndecVote("SAGE DIGITAL 3644", 4);
                            addEndecVote("SAGE ANALOG 1822", 0.5);
                        } else if (terminatorRunLength === 1) {
                            characteristics.markers.terminatorFFRun1++;
                            addEndecVote("SAGE ANALOG 1822", 4);
                            addEndecVote("SAGE DIGITAL 3644", 0.5);
                        } else {
                            addEndecVote("SAGE ANALOG 1822", 1.5);
                            addEndecVote("SAGE DIGITAL 3644", 1.5);
                        }
                    }
                }
                break;
            default:
                break;
        }
        refreshDetectedEndecMode();
    }

    function noteEndecLeadingByteBeforePreamble(byteValue) {
        if (byteValue !== 0x00) {
            return;
        }
        const characteristics = getEndecCharacteristicsState();
        characteristics.markers.digitalLeadZero++;
        addEndecVote("SAGE DIGITAL 3644", 5.5);
        refreshDetectedEndecMode();
    }

    function noteEndecGapMs(gapMs) {
        if (!Number.isFinite(gapMs) || gapMs < 200 || gapMs > 2500) {
            return;
        }
        const characteristics = getEndecCharacteristicsState();
        const timing = characteristics.timing;
        timing.lastGapMs = gapMs;
        timing.samples++;
        timing.averageGapMs += (gapMs - timing.averageGapMs) / timing.samples;

        if (gapMs >= 760 && gapMs <= 930) {
            timing.trilithicGapHits++;
            addEndecVote("TRILITHIC", 5);
        } else if (gapMs >= 1080 && gapMs <= 1160) {
            timing.trilithicAfterGapHits++;
            addEndecVote("TRILITHIC", 3);
        } else if (gapMs >= 930 && gapMs < 1050) {
            timing.standardGapHits++;
            addEndecVote("DEFAULT", 2);
        }
        refreshDetectedEndecMode();
    }

    function getOverallEndecMode() {
        const detected = getDetectedEndecMode();
        if (detected !== "DEFAULT") {
            return detected;
        }
        const el = document.getElementById("overallEndecMode");
        const raw = (el && typeof el.value === "string") ? el.value : detected;
        return normalizeEndecMode(raw);
    }

    function samplesFromMs(ms) {
        return Math.round(sampleRate * (ms / 1000));
    }

    const SAME_PREAMBLE = "\xAB".repeat(16);

    function stripLeadingPreamble16(s) {
        return (typeof s === "string" && s.startsWith(SAME_PREAMBLE)) ? s.slice(16) : s;
    }

    function bitsFromStringLSB(str) {
        const bits = [];
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i) & 0xFF;
            for (let b = 0; b < 8; b++) {
                bits.push((c >> b) & 1);
            }
        }
        return bits;
    }

    function buildTxStringsFromBursts(base, bursts) {
        const txStrings = new Array(bursts.length);
        for (let i = 0; i < bursts.length; i++) {
            const burst = bursts[i];
            txStrings[i] = burst.prefix + base + burst.suffix;
        }
        return txStrings;
    }

    function buildHeaderTxStrings(header, mode) {
        const msg = stripLeadingPreamble16(header);
        const data = SAME_PREAMBLE + msg;
        const profile = getEndecModeProfile(mode);
        return buildTxStringsFromBursts(data, profile.headerBursts);
    }

    function buildEomTxStrings(mode) {
        const core = SAME_PREAMBLE + "NNNN";
        const profile = getEndecModeProfile(mode);
        return buildTxStringsFromBursts(core, profile.eomBursts);
    }

    function emitTxBurstsFromStrings(txStrings, betweenSilenceSamples, finalSilenceSamples) {
        if (typeof generate_afsk !== "function" || typeof generate_silence !== "function") {
            return;
        }
        const cache = new Map();

        for (let i = 0; i < txStrings.length; i++) {
            const s = txStrings[i];
            let bits = cache.get(s);
            if (!bits) {
                bits = bitsFromStringLSB(s);
                cache.set(s, bits);
            }

            generate_afsk(bits);

            const isLast = (i === txStrings.length - 1);
            if (!isLast) {
                generate_silence(betweenSilenceSamples);
            } else if (finalSilenceSamples != null) {
                generate_silence(finalSilenceSamples);
            }
        }
    }

    function create_header_tones(header) {
        const mode = getOverallEndecMode();
        const profile = getEndecModeProfile(mode);
        const txStrings = buildHeaderTxStrings(header, mode);
        const between = samplesFromMs(profile.betweenGapMs);
        const after = samplesFromMs(profile.afterGapMs);
        emitTxBurstsFromStrings(txStrings, between, after);
    }

    function create_eom_tones() {
        const mode = getOverallEndecMode();
        const profile = getEndecModeProfile(mode);
        const oneSecondSamples = samplesFromMs(1000);
        if (typeof generate_silence === "function") {
            generate_silence(oneSecondSamples);
        }
        const txStrings = buildEomTxStrings(mode);
        const between = samplesFromMs(profile.betweenGapMs);
        emitTxBurstsFromStrings(txStrings, between, oneSecondSamples);
    }

    resetEndecDetection();
    let buffer = [];

    let _runDecoderCallCount = 0;
    let _lastHeaderTimesLog = 0;
    let _lastBridgeLevelSent = 0;
    let _bridgeLevelPeak = 0;
    function runDecoder(buf) {
        if (!buf || !buf.length) {
            return;
        }
        _runDecoderCallCount++;
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
            const s = buf[i];
            sum += s * s;
        }
        const rms = Math.sqrt(sum / buf.length);
        const mapped = rmsToMeterLevel(rms);
        if (mapped > decoderMeterTarget) {
            decoderMeterTarget = mapped;
        }
        if (window.EASBridge && !_offlineDecode) {
            if (mapped > _bridgeLevelPeak) _bridgeLevelPeak = mapped;
            const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (nowMs - _lastBridgeLevelSent >= METER_FRAME_INTERVAL) {
                _lastBridgeLevelSent = nowMs;
                const db = _bridgeLevelPeak > 0 ? (METER_DB_MIN + _bridgeLevelPeak * (METER_DB_MAX - METER_DB_MIN)) : METER_DB_MIN;
                window.EASBridge.send('decoder:level', { db: db });
                _bridgeLevelPeak = 0;
            }
        }

        if (_runDecoderCallCount <= 5 || _runDecoderCallCount % 500 === 0) {
        }

        afskdemod(buf);

        if (headerTimes !== _lastHeaderTimesLog) {
            _lastHeaderTimesLog = headerTimes;
        }
    }

    let dcWindow = [];

    let fMark = 0;
    let fSpace = 0;
    let phaseMark = 0;
    let phaseSpace = 0;
    let bitPeriod = 0;

    function updateSampleRate(sr) {
        fMark = 2083.3 / sr;
        fSpace = 1562.5 / sr;
        phaseMark = 2 * Math.PI * fMark;
        phaseSpace = 2 * Math.PI * fSpace;
        bitPeriod = Math.round(sr / 520.8333333333);
        sampleRate = sr;

        for (let i = 0; i < bitPeriod; i++) {
            markIwindow[i] = 0;
            markQwindow[i] = 0;
            spaceIwindow[i] = 0;
            spaceQwindow[i] = 0;
        }
    }

    for (let i = 0; i < 128; i++) {
        dcWindow[i] = 0;
    }

    const TWO_PI = 2 * Math.PI;
    let markIwindow = [];
    let markQwindow = [];
    let spaceIwindow = [];
    let spaceQwindow = [];
    let markIInteg = 0;
    let markQInteg = 0;
    let spaceIInteg = 0;
    let spaceQInteg = 0;

    let prevSample = 0;
    let clock = 0;
    let markIndex = 0;
    let spaceIndex = 0;

    let dcSum = 0;

    let _afskCallCount = 0;
    function afskdemod(signal) {
        _afskCallCount++;
        let discMin = Infinity, discMax = -Infinity, discSum = 0;
        for (var i = 0; i < 128; i++) {
            const sig = signal[i];
            const markI = sig * Math.sin(markIndex);
            const markQ = sig * Math.cos(markIndex);
            const spaceI = sig * Math.sin(spaceIndex);
            const spaceQ = sig * Math.cos(spaceIndex);
            markIndex += phaseMark;
            spaceIndex += phaseSpace;
            if (markIndex > TWO_PI) {
                markIndex -= TWO_PI;
            }
            if (spaceIndex > TWO_PI) {
                spaceIndex -= TWO_PI;
            }
            markIInteg += markI - markIwindow[clock];
            markQInteg += markQ - markQwindow[clock];
            spaceIInteg += spaceI - spaceIwindow[clock];
            spaceQInteg += spaceQ - spaceQwindow[clock];

            markIwindow[clock] = markI;
            markQwindow[clock] = markQ;
            spaceIwindow[clock] = spaceI;
            spaceQwindow[clock] = spaceQ;

            let s1 = markIInteg * markIInteg + markQInteg * markQInteg;
            let s2 = spaceIInteg * spaceIInteg + spaceQInteg * spaceQInteg;
            const disc = s1 - s2;
            discSum += disc;
            if (disc < discMin) discMin = disc;
            if (disc > discMax) discMax = disc;
            clockdemod(disc);
            clock++;
            if (clock >= bitPeriod) {
                clock = 0;
            }
        }
        if (_afskCallCount <= 5 || _afskCallCount % 500 === 0) {
        }
    }

    updateSampleRate(sampleRate);

    let bitclock = 0;
    let prevbit = 0;
    let shift = 0;

    let bits = [];
    let bytes = [];
    let currentByte = 0;
    let bytePos = 0;
    let samples = [];
    let decoding = false;
    let headerTimes = 0;
    let syncReg = 0;
    let tolerance = 0.05;
    let demodSampleCounter = 0;
    let previousCompletedByte = -1;
    let abRunLength = 0;
    let preambleByteRun = 0;
    let terminatorRunByte = -1;
    let terminatorRunCount = 0;
    let lastPayloadByteSample = 0;

    let currentMsg = "";
    let container = null;
    let currentMsgFastPathHandled = false;

    function hasCompleteSameHeaderTail(msg) {
        if (!msg || !msg.startsWith("ZCZC-") || msg[msg.length - 1] !== "-") {
            return false;
        }
        const lastDash = msg.length - 1;
        const senderDash = msg.lastIndexOf("-", lastDash - 1);
        if (senderDash < 0) {
            return false;
        }
        return (lastDash - senderDash - 1) === 8;
    }

    function finalizeAlert(reason = "UNKNOWN", terminatorByte = null, terminatorRunLength = 1) {
        decoding = false;
        abRunLength = 0;
        preambleByteRun = 0;
        terminatorRunByte = -1;
        terminatorRunCount = 0;
        updateSync(false);
        maybeRotateSameProduct(currentMsg);
        noteEndecSplitReason(reason, terminatorByte, currentMsg, terminatorRunLength);
        const segmentMeta = {
            reason,
            terminatorByte,
            terminatorRunLength,
            observedMode: getDetectedEndecMode()
        };
        if (container) {
            container.appendChild(document.createTextNode(" "));
            try {
                if (currentMsgFastPathHandled) {
                    const product = maybeRotateSameProduct(currentMsg);
                    product.segments.push({
                        type: "header",
                        reason: segmentMeta.reason || "UNKNOWN",
                        terminatorByte: segmentMeta.terminatorByte ?? null,
                        terminatorRunLength: segmentMeta.terminatorRunLength ?? 0,
                        observedMode: segmentMeta.observedMode || "DEFAULT"
                    });
                } else {
                    processHeader(currentMsg, container, segmentMeta);
                }
            } catch (e) {
                console.error("Error finalizing alert:", e?.message || e);
            }
        }
        container = null;
        currentMsg = "";
        currentMsgFastPathHandled = false;
        headerTimes = 0;
    }

    function resetDecoderState(resetEndec = true) {
        stopAutoRecording();
        bitclock = 0;
        prevbit = 0;
        shift = 0;
        bits = [];
        bytes = [];
        samples = [];
        currentByte = 0;
        bytePos = 0;
        decoding = false;
        headerTimes = 0;
        syncReg = 0;
        currentMsg = "";
        container = null;
        currentMsgFastPathHandled = false;
        demodSampleCounter = 0;
        previousCompletedByte = -1;
        abRunLength = 0;
        preambleByteRun = 0;
        terminatorRunByte = -1;
        terminatorRunCount = 0;
        lastPayloadByteSample = 0;
        _runDecoderCallCount = 0;
        _lastHeaderTimesLog = 0;
        _clockdemodByteCount = 0;
        _afskCallCount = 0;
        if (resetEndec) {
            resetEndecDetection();
        }
        clock = 0;
        markIndex = 0;
        spaceIndex = 0;
        markIInteg = 0;
        markQInteg = 0;
        spaceIInteg = 0;
        spaceQInteg = 0;
        for (let i = 0; i < bitPeriod; i++) {
            markIwindow[i] = 0;
            markQwindow[i] = 0;
            spaceIwindow[i] = 0;
            spaceQwindow[i] = 0;
        }
    }

    function flushPendingDecodeTail() {
        if (!decoding || !currentMsg.length) {
            return;
        }
        if (terminatorRunCount > 0 && (terminatorRunByte === 0x00 || terminatorRunByte === 0xFF)) {
            finalizeAlert("TERM_BYTE", terminatorRunByte, terminatorRunCount);
        } else {
            finalizeAlert("PREAMBLE_SPLIT");
        }
    }

    let _clockdemodByteCount = 0;
    function clockdemod(sample) {
        demodSampleCounter++;
        const bit = discriminator(sample);
        if (bit !== prevbit) {
            bitclock = 0;
        }
        if (bitclock == Math.floor(bitPeriod / 2)) {
            currentByte |= (bit << bytePos);
            syncReg = ((syncReg << 1) | bit) & 0xFF;
            if (syncReg == 0xAB && !decoding) {
                bytePos = 0;
                headerTimes++;
            }
            bytePos++;
            if (bytePos == 8) {
                _clockdemodByteCount++;
                if (_clockdemodByteCount <= 20 || _clockdemodByteCount % 200 === 0) {
                }
                const byteSample = demodSampleCounter;
                if (!decoding) {
                    if (terminatorRunCount > 0) {
                        terminatorRunByte = -1;
                        terminatorRunCount = 0;
                    }
                    if (currentByte === 0xAB) {
                        if (abRunLength === 0) {
                            noteEndecLeadingByteBeforePreamble(previousCompletedByte);
                            if (lastPayloadByteSample > 0) {
                                const gapMs = ((byteSample - lastPayloadByteSample) * 1000) / sampleRate;
                                noteEndecGapMs(gapMs);
                            }
                        }
                        abRunLength++;
                    } else {
                        abRunLength = 0;
                    }
                }
                if (currentByte === 0xAB && currentMsg.length === 0 && (preambleByteRun > 0 || headerTimes > 0)) {
                    preambleByteRun++;
                } else if (preambleByteRun > 0) {
                    noteEndecPreambleRun(preambleByteRun);
                    preambleByteRun = 0;
                }
                if (currentByte == 0xAB) {
                    headerTimes++;
                    if (headerTimes > 4) {
                        decoding = true;
                        abRunLength = 0;
                        updateSync(true);
                    }
                } else {
                    headerTimes = 0;
                }
                if (decoding) {
                    noteSameProductByte(currentByte);
                    let handledByte = false;
                    const isTerminatorByte = (currentByte == 0 || currentByte == 0xFF);
                    if (isTerminatorByte) {
                        if (terminatorRunCount === 0) {
                            terminatorRunByte = currentByte;
                            terminatorRunCount = 1;
                        } else if (terminatorRunByte === currentByte) {
                            terminatorRunCount++;
                        } else {
                            const termByte = terminatorRunByte;
                            const termCount = terminatorRunCount;
                            finalizeAlert("TERM_BYTE", termByte, termCount);
                        }
                        handledByte = true;
                    } else if (terminatorRunCount > 0) {
                        const termByte = terminatorRunByte;
                        const termCount = terminatorRunCount;
                        finalizeAlert("TERM_BYTE", termByte, termCount);
                        headerTimes = (currentByte == 0xAB) ? 1 : 0;
                        handledByte = true;
                    }

                    if (!handledByte) {
                        if (!micSource && currentByte == 0xAB && headerTimes > 4 && currentMsg.length && container) {
                            if (lastPayloadByteSample > 0) {
                                const splitGapMs = ((byteSample - lastPayloadByteSample) * 1000) / sampleRate;
                                noteEndecGapMs(splitGapMs);
                            }
                            finalizeAlert("PREAMBLE_SPLIT");
                            headerTimes = 1;
                        } else if (currentByte !== 0xAB) {
                            lastPayloadByteSample = byteSample;
                            if (!container) {
                                container = document.createElement("div");
                                container.className = "alert";
                                document.querySelector("#output").appendChild(container);
                            }
                            const currentChar = String.fromCharCode(currentByte);
                            if (currentByte >= 32 && currentByte <= 126 && /^[A-Za-z0-9\-\+\/\(\)\\ ]$/.test(currentChar) === false) { }
                            else {
                                container.innerText += currentChar;
                                currentMsg += currentChar;
                                if (currentMsg === "NNNN" && eomCount === 2) {
                                    finalizeAlert("EOM_PAYLOAD");
                                } else if (!currentMsgFastPathHandled && currentChar === "-" && hasCompleteSameHeaderTail(currentMsg)) {
                                    const product = maybeRotateSameProduct(currentMsg);
                                    const parsedHeader = parseHeader(currentMsg, product.id);
                                    if (parsedHeader && !parsedHeader.eom) {
                                        product.alerts.push(parsedHeader);
                                        if (window.EASBridge) {
                                            const alertName = events[parsedHeader.event] || parsedHeader.event || '';
                                            const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                                            const cleanHeader = parsedHeader.rawHeader.trim().replace(window.EASREGEX, 'ZCZC-$1-$2-$3+$4-$5-$6-');
                                            let easText = '';
                                            try { easText = E2T(cleanHeader, null, false, userTimezone); } catch(e) {}
                                            let severity = 'Information';
                                            if (easText.match(/(Warning|Emergency|Immediate)/i) && !easText.match(/(Demo)/i)) severity = 'Warning';
                                            else if (easText.match(/(Watch)/i)) severity = 'Watch';
                                            else if (easText.match(/(Advisory)/i)) severity = 'Advisory';
                                            else if (easText.match(/(Statement)/i)) severity = 'Statement';
                                            else if (easText.match(/(Information|Test|Demo)/i)) severity = 'Information';
                                            const issueTime = parsedHeader.issueTime;
                                            const expirationTime = typeof getExpirationTime === 'function' ? getExpirationTime(issueTime, parsedHeader.alertTime) : null;
                                            window.EASBridge.send('decoder:header', {
                                                raw: parsedHeader.rawHeader || '',
                                                summary: easText.split('\n')[0] || '',
                                                details: easText || '',
                                                severity: severity,
                                                eventType: alertName,
                                                areas: typeof locationsToReadable === 'function' ? locationsToReadable(parsedHeader.locationCodes) : '',
                                                issueTime: issueTime && typeof dateToReadable === 'function' ? dateToReadable(issueTime, false) : '',
                                                expireTime: expirationTime && typeof dateToReadable === 'function' ? dateToReadable(expirationTime, false) : '',
                                                sender: parsedHeader.sender || '',
                                                originator: entryNames[parsedHeader.originator] || parsedHeader.originator || '',
                                            });
                                        }
                                        const view = document.createElement("button");
                                        view.addEventListener("click", () => {
                                            showModal(parsedHeader);
                                            window.modalShown = true;
                                        });
                                        view.innerText = "View Alert";
                                        container.appendChild(document.createElement("span")).innerHTML = "&emsp;&emsp;";
                                        container.appendChild(view);
                                        currentMsgFastPathHandled = true;
                                    }
                                }
                            }
                            handleAutoRecordingTriggers();
                        }
                    }
                }
                previousCompletedByte = currentByte;
                bytePos = 0;
                currentByte = 0;
            }
        }
        if (bitclock >= bitPeriod) {
            bitclock = 0;
        }
        bitclock++;
        prevbit = bit;
    }

    function samplesFromMsAtRate(ms, rate) {
        return Math.max(0, Math.round(rate * (ms / 1000)));
    }

    function synthesizeAfskTxStrings(txStrings, rate, betweenSilenceSamples = 0, finalSilenceSamples = 0) {
        if (!Array.isArray(txStrings) || !txStrings.length || !Number.isFinite(rate) || rate <= 0) {
            return new Float32Array(0);
        }
        const validTxStrings = txStrings.filter((s) => typeof s === "string" && s.length > 0);
        if (!validTxStrings.length) {
            return new Float32Array(0);
        }

        const bitSamples = Math.max(1, Math.ceil(rate * 0.00192));
        const amplitude = 0.79;
        const markStep = (2 * Math.PI * 2083.3) / rate;
        const spaceStep = (2 * Math.PI * 1562.5) / rate;
        const markBit = new Float32Array(bitSamples);
        const spaceBit = new Float32Array(bitSamples);
        for (let i = 0; i < bitSamples; i++) {
            markBit[i] = Math.sin(i * markStep) * amplitude;
            spaceBit[i] = Math.sin(i * spaceStep) * amplitude;
        }

        let totalSamples = (finalSilenceSamples > 0) ? finalSilenceSamples : 0;
        for (let i = 0; i < validTxStrings.length; i++) {
            totalSamples += validTxStrings[i].length * 8 * bitSamples;
        }
        if (betweenSilenceSamples > 0 && validTxStrings.length > 1) {
            totalSamples += betweenSilenceSamples * (validTxStrings.length - 1);
        }
        if (!totalSamples) {
            return new Float32Array(0);
        }

        const out = new Float32Array(totalSamples);
        let offset = 0;
        for (let i = 0; i < validTxStrings.length; i++) {
            const tx = validTxStrings[i];
            for (let charIndex = 0; charIndex < tx.length; charIndex++) {
                const byteValue = tx.charCodeAt(charIndex) & 0xFF;
                for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
                    out.set(((byteValue >> bitIndex) & 1) ? markBit : spaceBit, offset);
                    offset += bitSamples;
                }
            }

            const isLast = (i === validTxStrings.length - 1);
            if (!isLast && betweenSilenceSamples > 0) {
                offset += betweenSilenceSamples;
            } else if (isLast && finalSilenceSamples > 0) {
                offset += finalSilenceSamples;
            }
        }

        return out;
    }

    function getAutoRecordingHeaderForPatch() {
        const activeHeader = (activeSameProduct && typeof activeSameProduct.headerKey === "string")
            ? activeSameProduct.headerKey.trim().toUpperCase()
            : "";
        if (activeHeader.startsWith("ZCZC-")) {
            return activeHeader;
        }

        const liveHeader = (typeof currentMsg === "string") ? currentMsg.trim().toUpperCase() : "";
        if (liveHeader.startsWith("ZCZC-")) {
            return liveHeader;
        }

        return "";
    }

    function trimFirstCapturedHeaderBurst(pcmData, rate, expectedGapSamples) {
        if (!(pcmData instanceof Float32Array) || !pcmData.length) {
            return pcmData;
        }
        const safeRate = (Number.isFinite(rate) && rate > 0) ? rate : sampleRate;
        const minGapSamples = Math.max(1, Math.floor(expectedGapSamples * 0.45));
        if (minGapSamples <= 0 || pcmData.length <= minGapSamples) {
            return pcmData;
        }

        let peak = 0;
        for (let i = 0; i < pcmData.length; i++) {
            const v = Math.abs(pcmData[i]);
            if (v > peak) {
                peak = v;
            }
        }
        if (!peak) {
            return pcmData;
        }

        const silenceThreshold = Math.max(0.005, Math.min(0.08, peak * 0.16));
        const windowSize = Math.max(1, Math.round(safeRate * 0.004));
        const consecutiveWindows = Math.max(1, Math.ceil(minGapSamples / windowSize));
        const maxScanSample = Math.min(pcmData.length - windowSize, Math.round(safeRate * 8));

        let lowWindowRun = 0;
        for (let start = 0; start <= maxScanSample; start += windowSize) {
            let sumAbs = 0;
            const end = Math.min(start + windowSize, pcmData.length);
            for (let i = start; i < end; i++) {
                sumAbs += Math.abs(pcmData[i]);
            }
            const avgAbs = sumAbs / (end - start);
            if (avgAbs <= silenceThreshold) {
                lowWindowRun++;
                if (lowWindowRun >= consecutiveWindows) {
                    const gapEndSample = Math.min(pcmData.length, end);
                    if (gapEndSample > 0 && gapEndSample < pcmData.length) {
                        return pcmData.subarray(gapEndSample);
                    }
                    break;
                }
            } else {
                lowWindowRun = 0;
            }
        }

        return pcmData;
    }

    function patchAutoRecordingPcmBoundaries(pcmData, rate) {
        if (!(pcmData instanceof Float32Array) || !pcmData.length) {
            return pcmData;
        }

        const safeRate = (Number.isFinite(rate) && rate > 0) ? rate : sampleRate;
        const mode = getOverallEndecMode();
        const profile = getEndecModeProfile(mode);
        const betweenGapSamples = samplesFromMsAtRate((profile && Number.isFinite(profile.betweenGapMs)) ? profile.betweenGapMs : 1000, safeRate);
        const oneSecondSamples = samplesFromMsAtRate(1000, safeRate);

        let headerLeadIn = new Float32Array(0);
        const headerForPatch = getAutoRecordingHeaderForPatch();
        let trimmedPcmData = pcmData;
        if (hasCompleteSameHeaderTail(headerForPatch)) {
            const cleanHeader = stripLeadingPreamble16(headerForPatch);
            const headerBurst = SAME_PREAMBLE + cleanHeader;
            headerLeadIn = synthesizeAfskTxStrings([headerBurst], safeRate, 0, oneSecondSamples);
            trimmedPcmData = trimFirstCapturedHeaderBurst(pcmData, safeRate, betweenGapSamples);
        }

        const eomBurst = SAME_PREAMBLE + "NNNN";
        let eomTail = synthesizeAfskTxStrings([eomBurst, eomBurst], safeRate, betweenGapSamples, oneSecondSamples);
        if (eomTail.length && betweenGapSamples > 0) {
            const withLeadGap = new Float32Array(betweenGapSamples + eomTail.length);
            withLeadGap.set(eomTail, betweenGapSamples);
            eomTail = withLeadGap;
        }

        if (!headerLeadIn.length && !eomTail.length) {
            return trimmedPcmData;
        }

        const merged = new Float32Array(headerLeadIn.length + trimmedPcmData.length + eomTail.length);
        let offset = 0;
        if (headerLeadIn.length) {
            merged.set(headerLeadIn, offset);
            offset += headerLeadIn.length;
        }
        merged.set(trimmedPcmData, offset);
        offset += trimmedPcmData.length;
        if (eomTail.length) {
            merged.set(eomTail, offset);
        }
        return merged;
    }

    function handleAutoRecordingTriggers() {
        if (!autoRecordingTriggered && currentMsg.length >= 4) {
            const prefix = currentMsg.slice(0, 4).toUpperCase();
            if (prefix === "ZCZC") {
                autoRecordingTriggered = true;
                startAutoRecording();
            }
        }
        if (autoRecordingTriggered && currentMsg.length >= 4) {
            const tailWindow = currentMsg.slice(-8).toUpperCase();
            if (tailWindow.includes("NNNN")) {
                stopAutoRecording(true);
            }
        }
    }

    let thres = 15;

    let bitState = 0;

    function discriminator(sample) {
        if (sample > thres) {
            bitState = 1;
        } else if (sample < -thres) {
            bitState = 0;
        }
        return bitState;
    }

    function updateSync(sync) {
        addStatus(sync ? "SYNC" : "NO SYNC", sync ? "green" : "red");
    }

    function parseHeader(input, productId = null) {
        if (input.startsWith("NNNN")) {
            eomCount++;
            const isFinalEomBurst = (eomCount === 3);
            if (isFinalEomBurst) {
                finalizeActiveSameProduct();
                eomCount = 0;
            }
            return {
                eom: true,
                endecMode: "Detecting...",
                endecModeReady: false,
                productId,
                isFinalEomBurst
            };
        }
        let output = {};
        const parts = input.split("+");
        const first = parts[0].split("-");
        const second = parts[1].split("-");
        if (first.length < 3 || second.length !== 4) {
            return;
        }
        first.shift();
        output.originator = first.shift();
        output.event = first.shift();
        output.locationCodes = first.map(e => parseLocation(e));
        output.alertTime = second.shift();
        output.issueTime = parseTime(second.shift());
        output.sender = second.shift();
        output.rawHeader = input;
        output.endecMode = "Detecting...";
        output.endecModeReady = false;
        output.productId = productId;
        return output;
    }

    function parseLocation(loc) {
        let ret = {};
        if (loc.length !== 6) {
            return "UNKNOWN";
        }
        ret.region = rgn[loc[0]] || "None";
        const st = loc.slice(1, 3);
        const countyCode = loc.slice(3, 6);
        const countyMap = county[st];
        if (countyMap && countyMap[countyCode]) {
            ret.state = state[st] || "US";
            ret.county = countyMap[countyCode];
        } else {
            const caName = canadaCounty[loc.slice(1)];
            if (caName) {
                ret.state = "Canada";
                ret.county = caName;
            } else {
                ret.state = state[st] || "Unknown";
                ret.county = `FIPS Code ${loc}`;
            }
        }
        return ret;
    }

    function parseTime(str) {
        if (str.length !== 7) {
            return;
        }
        const date = new Date(new Date().getFullYear(), 0, parseInt(str.slice(0, 3)));
        date.setUTCHours(parseInt(str.slice(3, 5)), parseInt(str.slice(5, 7)));
        return date;
    }

    function locationsToReadable(codes) {
        let output = "";

        for (let i = 0; i < codes.length; i++) {
            if (codes[i].region !== "None") {
                output += codes[i].region + " ";
            }
            output += codes[i].county ? codes[i].county : "Unknown Location";
            output += (i == (codes.length - 1)) ? "." : ", ";
        }
        return output;
    }

    let eomCount = 0;

    function processHeader(header, container, segmentMeta = null) {
        let product = null;
        let parsedHeader = null;

        if (isObject(header)) {
            product = maybeRotateSameProduct(header.rawHeader);
            parsedHeader = parseHeader(header.rawHeader, product.id);
            parsedHeader.endecMode = "NONE (Raw Header)";
            parsedHeader.endecModeReady = true;
            parsedHeader.productId = null;
        } else {
            product = maybeRotateSameProduct(header);
            parsedHeader = parseHeader(header, product.id);
        }

        const view = document.createElement("button");

        product.segments.push({
            type: parsedHeader.eom ? "eom" : "header",
            reason: segmentMeta?.reason || "UNKNOWN",
            terminatorByte: segmentMeta?.terminatorByte ?? null,
            terminatorRunLength: segmentMeta?.terminatorRunLength ?? 0,
            observedMode: segmentMeta?.observedMode || "DEFAULT"
        });

        if (parsedHeader.eom) {
            const eomIndicator = document.createElement("div");
            eomIndicator.style.color = "var(--color-border-light)";
            eomIndicator.style.display = "inline";
            eomIndicator.innerText = "[EOM]";
            container.appendChild(eomIndicator);
            if (parsedHeader.isFinalEomBurst) {
                const eomSeparator = document.createElement("hr");
                eomSeparator.classList = "eom-hr";
                container.appendChild(eomSeparator);
            }
            return;
        }

        product.alerts.push(parsedHeader);

        if (window.EASBridge) {
            const alertName = events[parsedHeader.event] || parsedHeader.event || '';
            const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const cleanHeader = parsedHeader.rawHeader.trim().replace(window.EASREGEX, 'ZCZC-$1-$2-$3+$4-$5-$6-');
            let easText = '';
            try { easText = E2T(cleanHeader, null, false, userTimezone); } catch(e) {}
            let severity = 'Information';
            if (easText.match(/(Warning|Emergency|Immediate)/i) && !easText.match(/(Demo)/i)) severity = 'Warning';
            else if (easText.match(/(Watch)/i)) severity = 'Watch';
            else if (easText.match(/(Advisory)/i)) severity = 'Advisory';
            else if (easText.match(/(Statement)/i)) severity = 'Statement';
            else if (easText.match(/(Information|Test|Demo)/i)) severity = 'Information';
            const issueTime = parsedHeader.issueTime;
            const expirationTime = typeof getExpirationTime === 'function' ? getExpirationTime(issueTime, parsedHeader.alertTime) : null;
            window.EASBridge.send('decoder:header', {
                raw: parsedHeader.rawHeader || '',
                summary: easText.split('\n')[0] || '',
                details: easText || '',
                severity: severity,
                eventType: alertName,
                areas: typeof locationsToReadable === 'function' ? locationsToReadable(parsedHeader.locationCodes) : '',
                issueTime: issueTime && typeof dateToReadable === 'function' ? dateToReadable(issueTime, false) : '',
                expireTime: expirationTime && typeof dateToReadable === 'function' ? dateToReadable(expirationTime, false) : '',
                sender: parsedHeader.sender || '',
                originator: entryNames[parsedHeader.originator] || parsedHeader.originator || '',
            });
        }

        view.addEventListener("click", () => {
            showModal(parsedHeader);
            window.modalShown = true;
        });

        view.innerText = "View Alert";

        container.appendChild(document.createElement("span")).innerHTML = "&emsp;&emsp;";
        container.appendChild(view);
    }

    const modalClose = document.querySelector("#close");
    const modalContainer = document.querySelector(".modalContainer");
    const infoContainer = document.querySelector(".modalInfo");
    const modalBox = document.querySelector(".modalBox");
    let modalRequestToken = 0;

    let previousFocus = null;

    function getDialogTabbables() {
        return Array.from(modalContainer.querySelectorAll(
            'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
        )).filter((el) => !el.disabled && el.offsetParent !== null);
    }

    function onModalKeydown(event) {
        if (event.key === 'Escape' && window.modalShown) {
            closeModal();
            return;
        }
        if (event.key !== 'Tab') return;
        const tabbables = getDialogTabbables();
        if (tabbables.length === 0) {
            event.preventDefault();
            return;
        }
        const first = tabbables[0];
        const last = tabbables[tabbables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function openModalA11y() {
        previousFocus = document.activeElement;
        document.addEventListener('keydown', onModalKeydown);
        requestAnimationFrame(() => {
            modalClose.focus();
        });
    }

    function closeModal() {
        if (!window.modalShown) return;
        modalRequestToken++;
        modalContainer.style.display = "none";
        window.modalShown = false;
        document.removeEventListener('keydown', onModalKeydown);
        if (previousFocus && typeof previousFocus.focus === 'function') {
            try { previousFocus.focus(); } catch {}
        }
        previousFocus = null;
    }

    modalClose.addEventListener("click", closeModal);

    modalContainer.addEventListener("click", (e) => {
        if (e.target === modalContainer) closeModal();
    });

    async function showAlertInfo(header) {
        const requestToken = ++modalRequestToken;
        if (requestToken !== modalRequestToken) {
            return;
        }
        let alertType = "Information";

        infoContainer.innerHTML = "";

        const alertName = events[header.event];
        const issueTime = header.issueTime;
        const expirationTime = getExpirationTime(issueTime, header.alertTime);
        const regex = window.EASREGEX;
        let endecMode = header.endecMode || "Detecting...";
        if (!header.endecModeReady) {
            const resolved = sameProductResults.get(header.productId);
            if (resolved && resolved.ready) {
                endecMode = resolved.mode;
                header.endecMode = resolved.mode;
                header.endecModeReady = true;
            } else {
                endecMode = "Detecting...";
            }
        }
        const cleanHeader = header.rawHeader.trim().replace(regex, 'ZCZC-$1-$2-$3+$4-$5-$6-');
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        let eas = E2T(cleanHeader, null, false, userTimezone);
        const encodedHeader = encodeURIComponent(header.rawHeader);
        const easText = eas.replace(/\n/g, "<br>");
        const openInEncoderButton = `<button id="openInEncoderButton${requestToken}">Open in SAME Encoder</button>`;

        if (easText.match(/(Warning|Emergency|Immediate)/i) && !easText.match(/(Demo)/i)) {
            modalBox.style.border = "3px solid red";
            modalBox.style.borderRadius = "10px";
            alertType = "Warning";
        }

        else if (easText.match(/(Watch)/i)) {
            modalBox.style.border = "3px solid orange";
            modalBox.style.borderRadius = "10px";
            alertType = "Watch";
        }

        else if (easText.match(/(Advisory)/i)) {
            modalBox.style.border = "3px solid yellow";
            modalBox.style.borderRadius = "10px";
            alertType = "Advisory";
        }

        else if (easText.match(/(Statement)/i)) {
            modalBox.style.border = "3px solid blue";
            modalBox.style.borderRadius = "10px";
            alertType = "Statement";
        }

        else if (easText.match(/(Information|Test|Demo)/i)) {
            modalBox.style.border = "3px solid green";
            modalBox.style.borderRadius = "10px";
            alertType = "Information";
        }

        else {
            modalBox.style.border = "3px solid gray";
            modalBox.style.borderRadius = "10px";
            alertType = "Unknown";
        }

        infoContainer.appendChild(createInfo(`Severity: ${alertType}`));
        infoContainer.appendChild(createInfo(`Type: ${alertName}`));
        infoContainer.appendChild(createInfo(`Issuer: ${entryNames[header.originator]}`));
        infoContainer.appendChild(createInfo(`Affected Locations: ${locationsToReadable(header.locationCodes)}`));
        infoContainer.appendChild(createInfo(`Issue date: ${dateToReadable(issueTime, false)}`));
        infoContainer.appendChild(createInfo(`Expires on: ${dateToReadable(expirationTime, false)}`));
        infoContainer.appendChild(createInfo(`Time until Expiration: ${isExpired(issueTime, expirationTime) ? "EXPIRED" : relativeToReadable(subtractRelative(expirationTime, new Date()), false)}`));
        infoContainer.appendChild(createInfo(`Sender ID: ${header.sender}`));
        infoContainer.appendChild(createInfo(`ENDEC Used (best-guess): ${endecMode}`));
        infoContainer.appendChild(document.createElement("br"));
        infoContainer.appendChild(createInfo(`Human-Readable Alert Text: "${easText}"`));
        infoContainer.appendChild(document.createElement("br"));
        infoContainer.appendChild(createInfo(openInEncoderButton));

        const openInEncoderBtn = document.getElementById(`openInEncoderButton${requestToken}`);
        if (openInEncoderBtn) {
            openInEncoderBtn.addEventListener("click", () => {
                const encoderUrl = `index.html?tool=encoder&header=${encodedHeader}`;
                window.location.href = encoderUrl;
            });
        }
    }

    function timeToReadable(time, use24) {
        if (use24) {
            return time.getHours().toString().padStart(2, "0") + ":" + time.getMinutes().toString().padStart(2, "0");
        } else {
            const hrs = (time.getHours() % 12);
            return (((hrs == 0) ? 12 : hrs).toString().padStart(2, "0") + ":" + time.getMinutes().toString().padStart(2, "0") + " " + ((time.getHours() >= 12) ? "PM" : "AM"));
        }
    }

    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    function dateToReadable(time, use24) {
        const readableTime = timeToReadable(time, use24);
        return months[time.getMonth()] + " " + numberPrefix(time.getDate()) + ", " + readableTime;
    }

    const pre = ["th", "st", "nd", "rd"];
    function numberPrefix(num) {
        if (Math.floor(num / 10) == 1) {
            return num + "th";
        }
        const prefix = pre[num % 10];
        return num + (prefix ? prefix : "th")
    }

    function isExpired(issueTime, expirationTime) {
        const now = Date.now();
        if (issueTime.getTime() > now) {
            return true;
        }
        return now > expirationTime.getTime();
    }

    function relativeToReadable(time) {
        let output = "";
        if (time.hrs > 0) {
            output += time.hrs.toString().padStart(2, "0") + " hrs ";
        }
        output += time.mins.toString().padStart(2, "0") + ((time.mins == 1) ? " min" : " mins");
        return output;
    }

    function subtractRelative(date1, date2) {
        const time = Math.floor((date1.getTime() - date2.getTime()) / 1000) / 60;
        return {
            hrs: Math.floor(time / 60),
            mins: Math.floor(time % 60)
        };
    }

    function getExpirationTime(issueTime, inputStr) {
        const hrs = parseInt(inputStr.slice(0, 2));
        const mins = parseInt(inputStr.slice(2));
        const date = new Date(issueTime);
        date.setHours(issueTime.getHours() + hrs, issueTime.getMinutes() + mins);
        return date;
    }

    function createInfo(content) {
        const infoElem = document.createElement("div");
        infoElem.className = "info";
        infoElem.innerHTML = content;
        return infoElem;
    }

    function showModal(parsedHeader) {
        modalContainer.style.display = "flex";
        window.modalShown = true;
        showAlertInfo(parsedHeader);
        openModalA11y();
        const announcer = document.getElementById("alert-announcer");
        if (announcer) {
            const eventName = (events && events[parsedHeader.event]) || parsedHeader.event || "alert";
            announcer.textContent = "";
            requestAnimationFrame(() => {
                announcer.textContent = "Alert decoded: " + eventName + ".";
            });
        }
    }

    async function testAudioStream(url) {
        const MAX_BYTES = 32768;
        const FETCH_TIMEOUT_MS = 9000;
        const WRAPPER_TIMEOUT_MS = 5000;

        function normalizeUrl(input, base) {
            if (!input || typeof input !== "string") {
                return null;
            }
            try {
                const parsed = base ? new URL(input, base) : new URL(input);
                if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
                    return null;
                }
                return parsed.href;
            } catch {
                return null;
            }
        }

        async function fetchBytes(targetUrl, timeoutMs) {
            const controller = new AbortController();
            streamProbeAbortControllers.add(controller);
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(targetUrl, {
                    method: "GET",
                    mode: "cors",
                    cache: "no-store",
                    headers: {
                        Range: `bytes=0-${MAX_BYTES - 1}`
                    },
                    signal: controller.signal
                });
                if (!response.ok && response.status !== 206) {
                    return null;
                }
                const contentType = (response.headers && response.headers.get("content-type")) ? response.headers.get("content-type").toLowerCase() : "";
                if (!response.body || typeof response.body.getReader !== "function") {
                    const buffer = await response.arrayBuffer();
                    if (!buffer || buffer.byteLength === 0) {
                        return null;
                    }
                    return {
                        bytes: buffer.slice(0, Math.min(buffer.byteLength, MAX_BYTES)),
                        contentType
                    };
                }
                const reader = response.body.getReader();
                const chunks = [];
                let total = 0;
                try {
                    while (total < MAX_BYTES) {
                        const { value, done } = await reader.read();
                        if (done) {
                            break;
                        }
                        if (!value || value.byteLength === 0) {
                            continue;
                        }
                        chunks.push(value);
                        total += value.byteLength;
                        if (total >= MAX_BYTES) {
                            break;
                        }
                    }
                } catch (error) {
                    const aborted = error && (error.name === "AbortError" || /abort/i.test(error.message || ""));
                    if (!aborted || total === 0) {
                        return null;
                    }
                } finally {
                    try {
                        await reader.cancel();
                    } catch { }
                }
                if (total === 0) {
                    return null;
                }
                const merged = new Uint8Array(Math.min(total, MAX_BYTES));
                let offset = 0;
                for (let i = 0; i < chunks.length && offset < merged.length; i++) {
                    const chunk = chunks[i];
                    const copyLength = Math.min(chunk.byteLength, merged.length - offset);
                    merged.set(chunk.subarray(0, copyLength), offset);
                    offset += copyLength;
                }
                return {
                    bytes: merged.buffer,
                    contentType
                };
            } catch {
                return null;
            } finally {
                clearTimeout(timeoutId);
                streamProbeAbortControllers.delete(controller);
            }
        }

        function looksLikeAudioStream(bytes, contentType, targetUrl) {
            if (!bytes || bytes.byteLength < 4) {
                return false;
            }
            if (contentType && (
                contentType.startsWith("audio/") ||
                contentType.includes("application/ogg") ||
                contentType.includes("application/x-ogg") ||
                contentType.includes("application/vnd.apple.mpegurl") ||
                contentType.includes("application/x-mpegurl")
            )) {
                return true;
            }

            const data = new Uint8Array(bytes);
            if (
                data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53 ||
                data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33 ||
                data[0] === 0x66 && data[1] === 0x4c && data[2] === 0x61 && data[3] === 0x43 ||
                data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
            ) {
                return true;
            }
            if ((data[0] === 0xff) && ((data[1] & 0xf0) === 0xf0)) {
                return true;
            }
            const lowerUrl = (targetUrl || "").toLowerCase();
            return (
                lowerUrl.includes(".ogg") ||
                lowerUrl.includes(".mp3") ||
                lowerUrl.includes(".aac") ||
                lowerUrl.includes(".m3u8")
            );
        }

        async function canDecodeStreamAudio(targetUrl) {
            const sample = await fetchBytes(targetUrl, FETCH_TIMEOUT_MS);
            if (!sample || !sample.bytes || sample.bytes.byteLength < 1024) {
                return false;
            }
            try {
                const probe = sample.bytes.slice(0);
                const decoded = await decodeContext.decodeAudioData(probe);
                return !!decoded && decoded.length > 0;
            } catch {
                return looksLikeAudioStream(sample.bytes, sample.contentType, targetUrl);
            }
        }

        function isLikelyPlaylistUrl(targetUrl) {
            return /\.(pls|m3u8?|xspf)(?:$|[?#])/i.test(targetUrl) || /playerservices\.streamtheworld\.com\/pls\//i.test(targetUrl);
        }

        async function fetchText(targetUrl, timeoutMs) {
            const controller = new AbortController();
            streamProbeAbortControllers.add(controller);
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(targetUrl, {
                    method: "GET",
                    mode: "cors",
                    cache: "no-store",
                    signal: controller.signal
                });
                if (!response.ok) {
                    return "";
                }
                return await response.text();
            } catch {
                return "";
            } finally {
                clearTimeout(timeoutId);
                streamProbeAbortControllers.delete(controller);
            }
        }

        function extractHttpUrls(text, baseUrl) {
            if (!text) {
                return [];
            }
            const output = [];
            const seen = new Set();
            const matches = text.match(/https?:\/\/[^\s"'<>]+/ig) || [];
            for (let i = 0; i < matches.length; i++) {
                const candidate = matches[i].replace(/[),.;]+$/, "");
                const normalized = normalizeUrl(candidate, baseUrl);
                if (normalized && !seen.has(normalized)) {
                    seen.add(normalized);
                    output.push(normalized);
                }
            }
            return output;
        }

        async function expandPlaylistCandidates(targetUrl) {
            if (!isLikelyPlaylistUrl(targetUrl)) {
                return [];
            }
            const text = await fetchText(targetUrl, WRAPPER_TIMEOUT_MS);
            return extractHttpUrls(text, targetUrl);
        }

        async function fetchJsonp(jsonpUrl, timeoutMs) {
            return await new Promise((resolve, reject) => {
                const callbackName = "__easToolsJsonp" + Math.random().toString(36).slice(2);
                const joiner = jsonpUrl.includes("?") ? "&" : "?";
                const script = document.createElement("script");
                let timeoutId = null;

                const cleanup = () => {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                    if (script.parentNode) {
                        script.parentNode.removeChild(script);
                    }
                    try {
                        delete window[callbackName];
                    } catch {
                        window[callbackName] = undefined;
                    }
                };

                window[callbackName] = (data) => {
                    cleanup();
                    resolve(data);
                };

                script.async = true;
                script.src = `${jsonpUrl}${joiner}callback=${callbackName}`;
                script.onerror = () => {
                    cleanup();
                    reject(new Error("JSONP request failed"));
                };

                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error("JSONP request timed out"));
                }, timeoutMs);

                document.head.appendChild(script);
            });
        }

        async function resolveTuneInCandidates(targetUrl) {
            const stationByPath = targetUrl.match(/-s(\d+)(?:[/?#]|$)/i);
            const stationById = targetUrl.match(/[?&]id=s?(\d+)(?:[&#]|$)/i);
            const stationRaw = stationByPath ? stationByPath[1] : (stationById ? stationById[1] : null);
            if (!stationRaw) {
                return [];
            }
            const stationId = `s${stationRaw}`;
            const candidates = [];
            try {
                const endpoint = `https://opml.radiotime.com/Tune.ashx?id=${encodeURIComponent(stationId)}&render=json`;
                const payload = await fetchJsonp(endpoint, WRAPPER_TIMEOUT_MS);
                if (payload && Array.isArray(payload.body)) {
                    for (let i = 0; i < payload.body.length; i++) {
                        const item = payload.body[i];
                        if (!item || typeof item.url !== "string") {
                            continue;
                        }
                        const normalized = normalizeUrl(item.url);
                        if (normalized) {
                            candidates.push(normalized);
                        }
                        if (item.url.includes("playerservices.streamtheworld.com/pls/")) {
                            const direct = item.url.match(/\/pls\/([^/?#]+)\.pls/i);
                            if (direct && direct[1]) {
                                candidates.push(`https://playerservices.streamtheworld.com/api/livestream-redirect/${direct[1]}`);
                            }
                        }
                    }
                }
            } catch { }

            const output = [];
            const seen = new Set();
            for (let i = 0; i < candidates.length; i++) {
                const normalized = normalizeUrl(candidates[i]);
                if (normalized && !seen.has(normalized)) {
                    seen.add(normalized);
                    output.push(normalized);
                }
            }
            return output;
        }

        function resolveBroadcastifyCandidates(targetUrl) {
            const candidates = [];
            const directMatch = targetUrl.match(/https:\/\/broadcastify\.cdnstream[^\s"'<>]+/i);
            if (directMatch && directMatch[0]) {
                candidates.push(directMatch[0]);
            }
            const feedMatch = targetUrl.match(/\/feed\/(\d+)(?:[/?#]|$)/i);
            if (feedMatch && feedMatch[1]) {
                const feedId = feedMatch[1];
                for (let i = 1; i <= 6; i++) {
                    candidates.push(`https://broadcastify.cdnstream${i}.com/${feedId}`);
                }
                candidates.push(`https://broadcastify.cdnstream.com/${feedId}`);
            }
            return candidates;
        }

        const normalizedInput = normalizeUrl((url || "").trim());
        if (!normalizedInput) {
            return false;
        }

        const seen = new Set();
        const queue = [];
        const skipProbe = new Set();
        const expandedPlaylists = new Set();
        const pushCandidate = (candidate) => {
            const normalized = normalizeUrl(candidate);
            if (!normalized || seen.has(normalized)) {
                return;
            }
            seen.add(normalized);
            queue.push(normalized);
        };

        pushCandidate(normalizedInput);

        try {
            const parsed = new URL(normalizedInput);
            const host = parsed.hostname.toLowerCase();
            if (host.includes("broadcastify.com")) {
                skipProbe.add(normalizedInput);
                const broadcastifyCandidates = resolveBroadcastifyCandidates(normalizedInput);
                for (let i = 0; i < broadcastifyCandidates.length; i++) {
                    pushCandidate(broadcastifyCandidates[i]);
                }
            } else if (host.includes("tunein.com")) {
                skipProbe.add(normalizedInput);
                const tuneInCandidates = await resolveTuneInCandidates(normalizedInput);
                for (let i = 0; i < tuneInCandidates.length; i++) {
                    pushCandidate(tuneInCandidates[i]);
                }
            }
        } catch {
            return false;
        }

        for (let i = 0; i < queue.length; i++) {
            const candidate = queue[i];
            if (skipProbe.has(candidate)) {
                continue;
            }
            if (!expandedPlaylists.has(candidate) && isLikelyPlaylistUrl(candidate)) {
                expandedPlaylists.add(candidate);
                const playlistCandidates = await expandPlaylistCandidates(candidate);
                for (let j = 0; j < playlistCandidates.length; j++) {
                    pushCandidate(playlistCandidates[j]);
                }
            }
            const ok = await canDecodeStreamAudio(candidate);
            if (ok) {
                window.streamUrl = candidate;
                return true;
            }
        }

        return false;
    }

    const decoderToggle = document.querySelector('[data-decoder-toggle]');
    if (decoderToggle) {
        decoderToggle.addEventListener('click', function () {
            runDecode(this);
        });
    }

    const streamToggle = document.querySelector('[data-decoder-stream-toggle]');
    if (streamToggle) {
        streamToggle.addEventListener('click', async function () {
            if (!streamToggleActive) {
                if (!window.streamUrl) {
                    const streamUrl = prompt("Enter the URL of the DIRECT audio stream (YouTube NOT supported!):");
                    if (!streamUrl) {
                        return;
                    }
                    const trimmed = streamUrl.trim();
                    if (!trimmed.match(/^https?:\/\/.+/i)) {
                        alert("Invalid URL. Please enter a valid http:// or https://... URL.");
                        return;
                    }
                    window.streamUrl = trimmed;
                }
                const isStreamPlayable = await testAudioStream(window.streamUrl);
                if (!isStreamPlayable) {
                    alert("The provided stream URL is not playable by EAS Tools. This is not a problem with EAS Tools, it simply means the stream is not direct audio, and will remain unsupported. Please try a different stream URL.");
                    window.streamUrl = null;
                    return;
                }
                await runStreamDecoder(window.streamUrl);
            } else {
                await stopStreamDecode(window.streamUrl);
            }
        });
    }

    const decoderClear = document.querySelector('[data-decoder-clear]');
    if (decoderClear) {
        decoderClear.addEventListener('click', function () {
            const output = document.getElementById('output');
            if (output) {
                output.innerHTML = "";
                clearSameProductState();
                decoderClear.disabled = true;
            }
        });
    }

    const decoderLoad = document.querySelector('[data-decoder-load]');
    if (decoderLoad) {
        decoderLoad.addEventListener('click', function () {
            const audiofileInput = document.getElementById('audiofile');
            if (audiofileInput) {
                audiofileInput.value = "";
                if (typeof audiofileInput.showPicker === "function") {
                    try {
                        audiofileInput.showPicker();
                    } catch {
                        audiofileInput.click();
                    }
                } else {
                    audiofileInput.click();
                }
            }
        });
    }

    const audiofileInput = document.getElementById('audiofile');
    if (audiofileInput) {
        audiofileInput.addEventListener('change', async function () {
            const file = this.files && this.files[0];
            if (!file) return;
            addStatus("PROCESSING...", "yellow");
            audiofileInput.disabled = true;
            decoderToggle.disabled = true;
            decoderLoad.disabled = true;
            resetDecoderState();
            try {
                const arrayBuffer = await file.arrayBuffer();
                const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer);
                updateSampleRate(audioBuffer.sampleRate);
                const channelData = audioBuffer.getChannelData(0);
                let sumSquares = 0;
                let peak = 0;
                for (let i = 0; i < channelData.length; i++) {
                    const sample = channelData[i];
                    const abs = sample < 0 ? -sample : sample;
                    if (abs > peak) peak = abs;
                    sumSquares += sample * sample;
                }
                if (peak > 0 && channelData.length > 0) {
                    const rms = Math.sqrt(sumSquares / channelData.length);
                    const minRms = 0.08912509381337455;
                    if (rms > 0 && rms <= minRms) {
                        const gain = 0.99 / peak;
                        if (gain > 1) {
                            for (let i = 0; i < channelData.length; i++) {
                                channelData[i] *= gain;
                            }
                        }
                    }
                }
                const chunkSize = 128;
                _offlineDecode = true;
                try {
                    for (let i = 0; i < channelData.length; i += chunkSize) {
                        const chunk = channelData.subarray(i, i + chunkSize);
                        runDecoder(chunk);
                    }
                } finally {
                    _offlineDecode = false;
                }
                stopDecode(false);
            } catch (e) {
                console.error("Failed to decode uploaded audio file:", e);
                addStatus("FAILED TO READ AUDIO FILE!", "red");
            } finally {
                audiofileInput.disabled = false;
                decoderToggle.disabled = false;
                decoderLoad.disabled = false;
                audiofileInput.value = "";
            }
        });
    }

    const decoderLoopback = document.getElementById('decoder-loopback');
    if (decoderLoopback) {
        decoderLoopback.addEventListener('change', function () {
            if (isCapacitorIOS() && iosStreamAbort) {
                if (this.checked) {
                    startIOSLoopback();
                } else {
                    stopIOSLoopback();
                }
            } else {
                refreshLoopback();
            }
        });
    }

    const recordToggle = document.querySelector('[data-decoder-record-toggle]');
    if (recordToggle) {
        recordToggle.addEventListener('click', function () {
            if (window.isRecording) {
                stopRecording();
            } else {
                startRecording().catch((error) => {
                    console.error("Unable to start recording:", error);
                });
            }
        });
    }

    const clearStreamURLButton = document.querySelector('[data-decoder-clear-stream-url]');
    if (clearStreamURLButton) {
        clearStreamURLButton.addEventListener('click', function () {
            window.streamUrl = null;
            clearStreamURLButton.style.display = "none";
        });
    }

    const rawHeaderButton = document.querySelector('[data-decoder-load-raw]');
    if (rawHeaderButton) {
        rawHeaderButton.addEventListener('click', function () {
            const rawHeader = prompt("Enter the raw SAME header (e.g. \"ZCZC-PEP-NPT-000000+0030-2761820-KETV    -\"): ");
            if (window.EASREGEX.test(rawHeader)) {
                const container = document.createElement("div");
                container.className = "raw-alert";
                container.style.display = "inline-block";
                document.querySelector("#output").appendChild(document.createElement("span")).innerHTML = rawHeader;
                document.querySelector("#output").appendChild(container);
                const rawHeaderObject = {
                    rawHeader: rawHeader
                }
                processHeader(rawHeaderObject, container);
                const eomHr = document.createElement("hr");
                eomHr.classList.add("eom-hr");
                document.querySelector("#output").appendChild(eomHr);
            } else {
                alert("Invalid SAME header format. Please enter a valid header.");
            }
        });
    }

    const dropArea = document.getElementById('decoder-panel');
    if (dropArea) {
        dropArea.addEventListener('dragover', (event) => {
            event.preventDefault();
            dropArea.classList.add('dragover');
        });

        dropArea.addEventListener('dragleave', () => {
            dropArea.classList.remove('dragover');
        });

        dropArea.addEventListener('drop', async (event) => {
            event.preventDefault();
            dropArea.classList.remove('dragover');
            const files = event.dataTransfer.files;
            if (files.length > 0) {
                addStatus("PROCESSING...", "yellow");
                resetDecoderState();
                const file = files[0];
                const arrayBuffer = await file.arrayBuffer();
                const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer);
                updateSampleRate(audioBuffer.sampleRate);
                const channelData = audioBuffer.getChannelData(0);
                const chunkSize = 128;
                _offlineDecode = true;
                try {
                    for (let i = 0; i < channelData.length; i += chunkSize) {
                        const chunk = channelData.slice(i, i + chunkSize);
                        runDecoder(chunk);
                    }
                } finally {
                    _offlineDecode = false;
                }
                stopDecode(false);
            }
        });
    }

    const mutationObserver = new MutationObserver(() => {
        const alertElements = document.querySelectorAll('.alert');
        if (alertElements.length > 0) {
            decoderClear.disabled = false;
        } else {
            decoderClear.disabled = true;
        }
    });

    mutationObserver.observe(document.getElementById('output'), { childList: true, subtree: true });

    if (window.EASBridge) {
        window.EASBridge.on('decoder:requestDevices', async () => {
            await populateMicrophones();
        });

        window.EASBridge.on('decoder:startMic', async (params) => {
            const deviceId = params?.deviceId || sel?.value || '';
            if (sel && deviceId) sel.value = deviceId;
            const btn = document.querySelector('[data-decoder-toggle]');
            if (btn && !micSource) await runDecode(btn);
        });

        window.EASBridge.on('decoder:stopMic', async () => {
            const btn = document.querySelector('[data-decoder-toggle]');
            if (btn && micSource) await runDecode(btn);
        });

        window.EASBridge.on('decoder:startStream', async (params) => {
            const url = params?.url;
            if (url) await runStreamDecoder(url);
        });

        window.EASBridge.on('decoder:stopStream', async () => {
            if (window.streamUrl) await stopStreamDecode(window.streamUrl);
        });

        window.EASBridge.on('decoder:loadFileData', async (params) => {
            const b64 = params?.base64;
            if (!b64) return;
            try {
                const binaryStr = atob(b64);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                const arrayBuffer = bytes.buffer;
                addStatus("PROCESSING...", "yellow");
                const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer);
                resetDecoderState();
                updateSampleRate(audioBuffer.sampleRate);
                const channelData = audioBuffer.getChannelData(0);
                let sumSquares = 0, peak = 0;
                for (let i = 0; i < channelData.length; i++) {
                    const s = channelData[i];
                    const abs = s < 0 ? -s : s;
                    if (abs > peak) peak = abs;
                    sumSquares += s * s;
                }
                if (peak > 0 && channelData.length > 0) {
                    const rms = Math.sqrt(sumSquares / channelData.length);
                    const minRms = 0.08912509381337455;
                    if (rms > 0 && rms <= minRms) {
                        const gain = 0.99 / peak;
                        if (gain > 1) {
                            for (let i = 0; i < channelData.length; i++) channelData[i] *= gain;
                        }
                    }
                }
                const chunkSize = 128;
                _offlineDecode = true;
                try {
                    for (let i = 0; i < channelData.length; i += chunkSize) {
                        runDecoder(channelData.subarray(i, i + chunkSize));
                    }
                } finally {
                    _offlineDecode = false;
                }
                stopDecode(false);
            } catch (err) {
                console.error('[EASBridge] loadFileData error:', err);
                addStatus("FILE ERROR: " + err.message, "red");
            }
        });

        window.EASBridge.on('decoder:loadRawHeader', (params) => {
            const header = params?.header;
            if (!header) return;
            const regex = window.EASREGEX;
            if (!regex || !regex.test(header)) {
                if (window.EASBridge) window.EASBridge.send('decoder:status', { text: 'INVALID HEADER FORMAT', color: 'red' });
                return;
            }
            const container = document.createElement("div");
            container.className = "alert";
            document.querySelector("#output").appendChild(container);
            container.innerText = header;
            processHeader({ rawHeader: header }, container);
        });

        window.EASBridge.on('decoder:startRecording', async () => {
            if (!window.isRecording) await startRecording();
        });

        window.EASBridge.on('decoder:stopRecording', () => {
            if (window.isRecording) stopRecording();
        });

        window.EASBridge.on('decoder:setLoopback', (params) => {
            const loopbackToggle = document.getElementById("decoder-loopback");
            if (loopbackToggle) {
                loopbackToggle.checked = !!params?.enabled;
                if (isCapacitorIOS() && iosStreamAbort) {
                    if (params?.enabled) {
                        startIOSLoopback();
                    } else {
                        stopIOSLoopback();
                    }
                } else {
                    refreshLoopback();
                }
            }
        });

        window.EASBridge.on('decoder:nativeStreamStart', (params) => {
            const sr = params?.sampleRate || 44100;
            nativeStreamActive = true;
            updateSampleRate(sr);
            iosBandpass = new SoftwareBandpass(sr, 1822.9, 3);
            iosDecoderFrameRemainder = new Float32Array(0);
            resetDecoderState();
        });

        window.EASBridge.on('decoder:nativePCM', (params) => {
            if (!params?.pcm) return;
            const binary = atob(params.pcm);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const pcm = new Float32Array(bytes.buffer);
            if (window.isRecording && nativeStreamActive) {
                recordingChunks.push(pcm.slice());
                recordingLength += pcm.length;
            }
            const bp = ensureIOSBandpass();
            feedDecoderFrames(bp.process(pcm));
        });

        window.EASBridge.on('decoder:nativeStreamEnd', () => {
            if (iosDecoderFrameRemainder.length > 0) {
                const padded = new Float32Array(IOS_STREAM_FRAME_SIZE);
                padded.set(iosDecoderFrameRemainder);
                runDecoder(padded);
                iosDecoderFrameRemainder = new Float32Array(0);
            }
            flushPendingDecodeTail();
            finalizeActiveSameProduct();
            if (window.isRecording) stopRecording(true);
            nativeStreamActive = false;
        });

        window.EASBridge.on('decoder:clearOutput', () => {
            const output = document.querySelector("#output");
            if (output) output.innerHTML = "";
        });

        console.log('[EASBridge] Decoder bridge handlers registered');
    }
})();
