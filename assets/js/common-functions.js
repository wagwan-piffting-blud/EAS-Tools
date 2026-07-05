export async function saveFile(filename, content, mime, opts = {}) {
    const blob = (content instanceof Blob) ? content : new Blob([content], { type: mime });

    if(!/eas-recording-.*/.test(filename)) {
        let random_bytes = new Uint8Array(8);
        crypto.getRandomValues(random_bytes);
        const random_suffix = Array.from(random_bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        var unique_filename = `${filename.replace(/(\.[^.]*)?$/, `_${random_suffix}$1`)}`;
    }

    else {
        var unique_filename = filename;
    }

    if (window.EASDownloads?.saveBlob) {
        await window.EASDownloads.saveBlob(blob, unique_filename, mime, opts);
        if (window.EASBridge?.send) {
            window.EASBridge.send('download:complete', { filename: unique_filename });
        }
        return;
    }

    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = unique_filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        URL.revokeObjectURL(url);
    }
}

function freezeBurstList(list) {
    return Object.freeze(list.map((item) => Object.freeze(item)));
}

const ENDEC_MODE_PROFILE_SOURCE = {
    DEFAULT: {
        label: "None (Default)/DASDEC",
        signature: { tail: "none", lead: "none", burstGapMs: 1000 },
        betweenGapMs: 1000,
        afterGapMs: 1000,
        headerBursts: [{ prefix: "", suffix: "" }, { prefix: "", suffix: "" }, { prefix: "", suffix: "" }],
        eomBursts: [{ prefix: "", suffix: "" }, { prefix: "", suffix: "" }, { prefix: "", suffix: "" }]
    },
    NWS: {
        label: "National Weather Service (Legacy/EAS.js)",
        signature: { tail: "00 00", lead: "none", burstGapMs: 1000 },
        betweenGapMs: 1000,
        afterGapMs: 1000,
        headerBursts: [{ prefix: "", suffix: "\x00\x00" }, { prefix: "", suffix: "\x00\x00" }, { prefix: "", suffix: "\x00\x00" }],
        eomBursts: [{ prefix: "", suffix: "\x00\x00" }, { prefix: "", suffix: "\x00\x00" }, { prefix: "", suffix: "\x00\x00" }]
    },
    NWS_CRS: {
        label: "National Weather Service - Console Replacement System (CRS, 1998-2016)",
        signature: { tail: "00", lead: "none", burstGapMs: 1000 },
        betweenGapMs: 1000,
        afterGapMs: 1000,
        headerBursts: [{ prefix: "", suffix: "\x00\x00\x00" }, { prefix: "", suffix: "\x00\x00\x00" }, { prefix: "", suffix: "\x00\x00\x00" }],
        eomBursts: [{ prefix: "\x00", suffix: "\x00" }, { prefix: "\x00", suffix: "\x00" }, { prefix: "\x00", suffix: "\x00" }]
    },
    NWS_BMH: {
        label: "National Weather Service - Broadcast Message Handler (BMH, 2016-present)",
        signature: { tail: "00 00 00", lead: "none", burstGapMs: 1000 },
        betweenGapMs: 1000,
        afterGapMs: 1000,
        headerBursts: [{ prefix: "", suffix: "\x00\x00\x00" }, { prefix: "", suffix: "\x00\x00\x00" }, { prefix: "", suffix: "\x00\x00\x00" }],
        eomBursts: [{ prefix: "", suffix: "\x00\x00\x00" }, { prefix: "", suffix: "\x00\x00\x00" }, { prefix: "", suffix: "\x00\x00\x00" }]
    },
    SAGE_DIGITAL_3644: {
        label: "SAGE 3644/DIGITAL",
        signature: { tail: "FF FF FF", lead: "00 on first burst", burstGapMs: 1000 },
        betweenGapMs: 1000,
        afterGapMs: 1000,
        headerBursts: [{ prefix: "\x00", suffix: "\xFF\xFF\xFF" }, { prefix: "\xAB", suffix: "\xFF\xFF\xFF" }, { prefix: "\xAB", suffix: "\xFF\xFF\xFF" }],
        eomBursts: [{ prefix: "\x00", suffix: "\xFF\xFF\xFF" }, { prefix: "", suffix: "\xFF\xFF\xFF" }, { prefix: "", suffix: "\xFF\xFF\xFF" }]
    },
    SAGE_ANALOG_1822: {
        label: "SAGE 1822/ANALOG",
        signature: { tail: "FF", lead: "none", burstGapMs: 1000 },
        betweenGapMs: 1000,
        afterGapMs: 1000,
        headerBursts: [{ prefix: "", suffix: "\xFF" }, { prefix: "", suffix: "\xFF" }, { prefix: "", suffix: "\xFF" }],
        eomBursts: [{ prefix: "", suffix: "\xFF" }, { prefix: "", suffix: "\xFF" }, { prefix: "", suffix: "\xFF" }]
    },
    TRILITHIC: {
        label: "Trilithic EASyPLUS",
        signature: { tail: "none", lead: "none", burstGapMs: 868 },
        betweenGapMs: 868,
        afterGapMs: 1118,
        relayPop: {
            enabled: false
        },
        headerBursts: [{ prefix: "", suffix: "" }, { prefix: "", suffix: "" }, { prefix: "", suffix: "" }],
        eomBursts: [{ prefix: "", suffix: "" }, { prefix: "", suffix: "" }, { prefix: "", suffix: "" }]
    },
    TRILITHIC_POP: {
        label: "Trilithic EASyPLUS with Pop",
        signature: { tail: "none", lead: "none", burstGapMs: 868 },
        betweenGapMs: 868,
        afterGapMs: 1118,
        relayPop: {
            enabled: true,
            fileStart: "assets/pop_start.wav",
            fileEnd: "assets/pop.wav"
        },
        headerBursts: [{ prefix: "", suffix: "" }, { prefix: "", suffix: "" }, { prefix: "", suffix: "" }],
        eomBursts: [{ prefix: "", suffix: "" }, { prefix: "", suffix: "" }, { prefix: "", suffix: "" }]
    }
};

export const ENDEC_MODE_OPTIONS = Object.freeze(
    Object.entries(ENDEC_MODE_PROFILE_SOURCE).map(([mode, profile]) => Object.freeze({
        value: mode,
        label: profile.label
    }))
);

export const ENDEC_MODE_PROFILES = Object.freeze(
    Object.fromEntries(
        Object.entries(ENDEC_MODE_PROFILE_SOURCE).map(([mode, profile]) => {
            const frozenProfile = Object.freeze({
                signature: Object.freeze(profile.signature),
                betweenGapMs: profile.betweenGapMs,
                afterGapMs: profile.afterGapMs,
                relayPop: profile.relayPop ? Object.freeze({ ...profile.relayPop }) : null,
                headerBursts: freezeBurstList(profile.headerBursts),
                eomBursts: freezeBurstList(profile.eomBursts)
            });
            return [mode, frozenProfile];
        })
    )
);

export const ENDEC_MODES = Object.freeze(Object.keys(ENDEC_MODE_PROFILES));

export const ENDEC_MODE_SIGNATURES = Object.freeze(
    Object.fromEntries(
        ENDEC_MODES.map((mode) => [mode, ENDEC_MODE_PROFILES[mode].signature])
    )
);

export function normalizeEndecMode(mode) {
    const value = (typeof mode === "string") ? mode.trim().toUpperCase() : "DEFAULT";
    return ENDEC_MODE_PROFILES[value] ? value : "DEFAULT";
}

export function getEndecModeProfile(mode) {
    return ENDEC_MODE_PROFILES[normalizeEndecMode(mode)];
}

export function createEndecModeVotes(initialValue = 0) {
    const votes = {};
    for (let i = 0; i < ENDEC_MODES.length; i++) {
        votes[ENDEC_MODES[i]] = initialValue;
    }
    return votes;
}

export function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const CODEMIRROR_LIGHT_THEME_NAME = "elegant";
export const CODEMIRROR_DARK_THEME_NAME = "dracula";

export const USES_DARK_THEME = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? true : false;

export const PIPER_BUNDLE_URL = 'assets/piper-tts/piper.tts.bundle.js';
export const PIPER_ORT_WASM_BASE = 'assets/piper-tts/onnxruntime-web/';
export const PIPER_DEFAULT_VOICE_ID = 'en_US-joe-medium';
export const PIPER_DEFAULT_VOICE = Object.freeze({
    id: PIPER_DEFAULT_VOICE_ID,
    modelUrl: 'assets/piper-tts/voices/en_US-joe-medium.onnx',
    configUrl: 'assets/piper-tts/voices/en_US-joe-medium.onnx.json',
});

export const REMOTE_VOICE_LIST_URL = 'https://wagspuzzle.space/tools/eas-tts/index.php?handler=toolkit&voicelist=true';

export const NANO_TTS_LANGUAGE = 'en-US';
export const NANO_TTS_VOLUME = 0.5;
export const NANO_TTS_WORKER_URL = new URL('./text2wav-worker.js', import.meta.url);

export const SPFY_WORKER_URL = new URL('./spfy-worker.js', import.meta.url);
export const ACU_WORKER_URL = new URL('./acu-worker.js', import.meta.url);

export function resamplePcm(pcm, fromRate, toRate) {
    if (!pcm) return new Float32Array(0);
    if (fromRate === toRate) return new Float32Array(pcm);
    const ratio = fromRate / toRate;
    const newLen = Math.max(1, Math.round(pcm.length / ratio));
    const out = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
        const pos = i * ratio;
        const idx = Math.floor(pos);
        const frac = pos - idx;
        const a = pcm[idx] ?? 0;
        const b = pcm[idx + 1] ?? a;
        out[i] = a + (b - a) * frac;
    }
    return out;
}

export function vmifyPcm(pcm, sampleRate, options = {}) {
    if (!(pcm instanceof Float32Array) || pcm.length === 0) {
        return pcm;
    }

    const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    const nyquist = sr / 2;
    if (nyquist < 5000) return pcm;

    let intensity = Number.isFinite(options.intensity) ? options.intensity : 1;
    if (intensity < 0) intensity = 0;
    else if (intensity > 3) intensity = 3;

    const drive = 3.16;
    const driven = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
        driven[i] = Math.tanh(pcm[i] * drive);
    }

    const freq = Math.min(4000, nyquist * 0.8);
    const w0 = 2 * Math.PI * freq / sr;
    const cos0 = Math.cos(w0);
    const alp = Math.sin(w0) / (2 * 0.707);
    const norm = 1 / (1 + alp);
    const b0 = ((1 + cos0) / 2) * norm;
    const b1 = -(1 + cos0) * norm;
    const b2 = b0;
    const a1 = (-2 * cos0) * norm;
    const a2 = (1 - alp) * norm;

    let s1x1 = 0, s1x2 = 0, s1y1 = 0, s1y2 = 0;
    let s2x1 = 0, s2x2 = 0, s2y1 = 0, s2y2 = 0;

    const hfGain = 1.41 * intensity;
    const out = new Float32Array(pcm.length);
    let peak = 0;

    for (let i = 0; i < pcm.length; i++) {
        const x0 = driven[i];
        const y0 = b0 * x0 + b1 * s1x1 + b2 * s1x2 - a1 * s1y1 - a2 * s1y2;
        s1x2 = s1x1; s1x1 = x0;
        s1y2 = s1y1; s1y1 = y0;

        const y1 = b0 * y0 + b1 * s2x1 + b2 * s2x2 - a1 * s2y1 - a2 * s2y2;
        s2x2 = s2x1; s2x1 = y0;
        s2y2 = s2y1; s2y1 = y1;

        out[i] = pcm[i] + y1 * hfGain;
        const abs = out[i] < 0 ? -out[i] : out[i];
        if (abs > peak) peak = abs;
    }

    if (peak > 0.9441) {
        const g = 0.9441 / peak;
        for (let i = 0; i < out.length; i++) out[i] *= g;
    }

    return out;
}

function indexToLineCol(s, idx) {
    let line = 1, col = 1;
    for (let i = 0; i < idx; i++) {
        if (s[i] === "\n") { line++; col = 1; }
        else col++;
    }
    return { line, col };
}

export function findLikelyXmlMismatch(xml) {
    const stack = [];
    const len = xml.length;

    let i = 0;
    while (i < len) {
        const lt = xml.indexOf("<", i);
        if (lt === -1) break;

        i = lt;

        if (i + 1 >= len) break;

        const gt = xml.indexOf(">", i + 1);
        if (gt === -1) {
            return { type: "unterminated-tag", index: i, ...indexToLineCol(xml, i) };
        }

        const raw = xml.slice(i + 1, gt).trim();

        if (raw.startsWith("?") || raw.startsWith("!")) {
            i = gt + 1;
            continue;
        }

        const isClose = raw.startsWith("/");
        const isSelfClose = raw.endsWith("/");

        if (isClose) {
            const name = raw.slice(1).trim().split(/\s+/)[0];
            const top = stack[stack.length - 1];

            if (!top) {
                return { type: "unexpected-close", name, index: i, ...indexToLineCol(xml, i) };
            }
            if (top.name !== name) {
                return {
                    type: "mismatched-close",
                    got: name,
                    expected: top.name,
                    closeIndex: i,
                    closeLineCol: indexToLineCol(xml, i),
                    openIndex: top.index,
                    ...indexToLineCol(xml, top.index),
                };
            }
            stack.pop();
        } else if (!isSelfClose) {
            const name = raw.split(/\s+/)[0];
            stack.push({ name, index: i });
        }

        i = gt + 1;
    }

    if (stack.length) {
        const top = stack[stack.length - 1];
        return {
            type: "unexpected-eof",
            expectedClose: top.name,
            openIndex: top.index,
            ...indexToLineCol(xml, top.index),
        };
    }

    return null;
}

function customAlertDiv(message) {
    const alertDiv = document.createElement("div");
    alertDiv.style.position = "fixed";
    alertDiv.style.top = "50%";
    alertDiv.style.left = "50%";
    alertDiv.style.transform = "translate(-50%, -50%)";
    alertDiv.style.backgroundColor = "#050505";
    alertDiv.style.border = "2px solid #f5f5f5";
    alertDiv.style.padding = "20px";
    alertDiv.style.zIndex = "10000";
    alertDiv.style.maxWidth = "80%";
    alertDiv.style.maxHeight = "80%";
    alertDiv.style.overflowY = "auto";
    alertDiv.style.fontFamily = "Hack, monospace";
    alertDiv.style.color = "#f5f5f5";
    alertDiv.innerText = message;

    const closeButton = document.createElement("button");
    closeButton.innerText = "Close";
    closeButton.style.marginTop = "10px";
    closeButton.onclick = () => {
        document.body.removeChild(alertDiv);
    };
    alertDiv.appendChild(closeButton);

    document.body.appendChild(alertDiv);
}

export function validateTtsText(voiceBackendMap, voice, text) {
    const requiredBackend = Object.keys(voiceBackendMap).find(backend => voiceBackendMap[backend].includes(voice));
    const normalizedBackend = requiredBackend ? requiredBackend.toLowerCase() : "";
    let ttsText = text;
    const usesBalPhonemes = /<\s*\/?\s*(silence|pron|phoneme)/i.test(ttsText);
    const usesVtmlTags = /<\s*\/?\s*vtml/i.test(ttsText);
    const usesDtPhonemes = /\[:phoneme/i.test(ttsText);

    if (normalizedBackend.includes("bal")) {
        if (usesVtmlTags || usesDtPhonemes) {
            alert("BAL backend cannot include VT or DT phoneme markup.");
            return false;
        }

        if (usesBalPhonemes && !/<(silence|pron|phoneme).*/i.test(ttsText)) {
            alert("TTS Text contains invalid BAL phonemes or formatting.");
            return false;
        }

        if (ttsText.match(/“|”/)) {
            ttsText = ttsText.replace(/“|”/g, '"');
            window.ttsText = ttsText;
            return true;
        }
    }
    else if (normalizedBackend.includes("vt")) {
        if (usesBalPhonemes || usesDtPhonemes) {
            alert("VT backend cannot include BAL or DT phoneme markup.");
            return false;
        }

        if (usesVtmlTags && !/<vtml.*/i.test(ttsText)) {
            alert("TTS Text contains invalid VT phonemes or formatting.");
            return false;
        }

        if (ttsText.match(/“|”/)) {
            ttsText = ttsText.replace(/“|”/g, '"');
            window.ttsText = ttsText;
            return true;
        }
    }
    else if (normalizedBackend.includes("dt")) {
        if (usesBalPhonemes || usesVtmlTags) {
            alert("DT backend cannot include BAL or VT phoneme markup.");
            return false;
        }

        if (usesDtPhonemes && !/\[:phoneme on].*/i.test(ttsText)) {
            alert("TTS Text contains invalid DT phonemes or formatting.");
            return false;
        }
    }
    else if (!normalizedBackend.includes("bal") && !normalizedBackend.includes("vt") && !normalizedBackend.includes("dt")) {
        if (usesBalPhonemes || usesVtmlTags || usesDtPhonemes) {
            alert("Selected TTS voice backend does not support BAL, VT, or DT phoneme markup.");
            return false;
        }
    }
    return true;
}

export async function validateMarkupAndText(voiceBackendMap, voice, text) {
    const isValidTextForBackend = await validateTtsText(voiceBackendMap, voice, text);
    if (!isValidTextForBackend) {
        return false;
    }
    else {
        let ttsText = text;
        const err = findLikelyXmlMismatch(ttsText);
        const context = 50;
        if (err) {
            console.log(err);
            let substring = "";
            substring = ttsText.slice(err.col - context, err.col + context).replace(/\n/g, " ");
            let message = `Announcement text contains malformed XML/markup at line ${err.line}, column ${err.col}.\n\n${substring}\n${"-".repeat(context)}^${"-".repeat(context - 1)}\n\nMake sure all XML tags are properly opened and closed or are self-closing.\n`;
            customAlertDiv(message);
            return false;
        }
        return true;
    }
}

export function createNanoTtsEngine(config = {}) {
    const {
        reportStatus = () => {},
        decodeBlob,
        readyStatus = null,
        workerUrl = NANO_TTS_WORKER_URL,
        language = NANO_TTS_LANGUAGE,
        volume = NANO_TTS_VOLUME,
    } = config;

    const state = {
        worker: null,
        ready: false,
        queue: [],
        currentJob: null,
    };

    const flushQueue = (error) => {
        while (state.queue.length) {
            const job = state.queue.shift();
            job.reject(error);
        }
    };

    const startNextJob = () => {
        if (!state.worker || !state.ready) return;
        if (state.currentJob || !state.queue.length) return;
        const job = state.queue.shift();
        state.currentJob = job;
        state.worker.postMessage({
            lang: job.lang || language,
            volume: `${job.volume ?? volume}`,
            text: job.text,
        });
    };

    const processBlob = async (blob) => {
        const job = state.currentJob;
        if (!job) return;
        try {
            const result = await decodeBlob(blob);
            job.resolve(result);
        } catch (err) {
            job.reject(err);
        } finally {
            state.currentJob = null;
            startNextJob();
        }
    };

    const handleWorkerError = (message, fatal = false) => {
        const error = message instanceof Error ? message : new Error(message || 'NanoTTS error');
        reportStatus(error.message, "ERROR");
        if (state.currentJob) {
            state.currentJob.reject(error);
            state.currentJob = null;
        }
        if (fatal) {
            if (state.worker) {
                state.worker.terminate();
            }
            state.worker = null;
            state.ready = false;
            flushQueue(error);
        } else {
            startNextJob();
        }
    };

    const handleWorkerMessage = (event) => {
        const data = event?.data || {};
        if (data.type === "ready") {
            state.ready = true;
            if (readyStatus) reportStatus(readyStatus, "LOG");
            startNextJob();
            return;
        }
        if (data.type === "progress") {
            if (data.error) {
                handleWorkerError(data.error);
            } else if (data.data) {
                reportStatus(data.data, "LOG");
            }
            return;
        }
        if (data.error) {
            handleWorkerError(data.error);
            return;
        }
        if (data.blob) {
            processBlob(data.blob);
        }
    };

    const ensureWorker = () => {
        if (!window.Worker) {
            throw new Error('NanoTTS requires Web Worker support in this browser.');
        }
        if (state.worker) return state.worker;
        let worker;
        try {
            worker = new Worker(workerUrl, { type: 'classic' });
        } catch (err) {
            worker = new Worker(workerUrl);
        }
        worker.addEventListener('message', handleWorkerMessage);
        worker.addEventListener('error', (event) => handleWorkerError(event?.message || 'NanoTTS worker error', true));
        worker.addEventListener('messageerror', () => handleWorkerError('NanoTTS worker message error', true));
        state.worker = worker;
        state.ready = false;
        return worker;
    };

    const synth = (text) => {
        ensureWorker();
        return new Promise((resolve, reject) => {
            state.queue.push({
                text,
                resolve,
                reject,
                lang: language,
                volume,
            });
            startNextJob();
        });
    };

    return { synth, ensureWorker, state };
}

export function createWasmVoiceWorkerEngine(config = {}) {
    const { workerUrl, readyStatus = null } = config;
    let reportStatus = typeof config.reportStatus === 'function' ? config.reportStatus : () => {};
    let onProgress = typeof config.onProgress === 'function' ? config.onProgress : () => {};

    const state = {
        worker: null,
        ready: false,
        queue: [],
        currentJob: null,
    };

    const failAll = (error) => {
        if (state.currentJob) {
            state.currentJob.reject(error);
            state.currentJob = null;
        }
        while (state.queue.length) {
            state.queue.shift().reject(error);
        }
    };

    const teardown = (error) => {
        if (state.worker) {
            state.worker.terminate();
            state.worker = null;
        }
        state.ready = false;
        onProgress(null);
        failAll(error);
    };

    const pump = () => {
        if (!state.worker || !state.ready || state.currentJob || !state.queue.length) return;
        const job = state.queue.shift();
        state.currentJob = job;
        state.worker.postMessage({ type: 'synth', text: job.text });
    };

    const handleMessage = (event) => {
        const data = event?.data || {};
        if (data.type === 'download') {
            onProgress({ loaded: data.loaded, total: data.total, label: data.label });
            return;
        }
        if (data.type === 'progress') {
            onProgress(null);
            if (data.data) reportStatus(data.data, 'LOG');
            return;
        }
        if (data.type === 'ready') {
            onProgress(null);
            state.ready = true;
            if (readyStatus) reportStatus(readyStatus, 'LOG');
            pump();
            return;
        }
        if (data.type === 'audio') {
            const job = state.currentJob;
            state.currentJob = null;
            if (job) job.resolve({ pcm: new Float32Array(data.pcm), sampleRate: data.sampleRate });
            pump();
            return;
        }
        if (data.type === 'synth-error') {
            const job = state.currentJob;
            state.currentJob = null;
            if (job) job.reject(new Error(data.error || 'Synthesis failed'));
            pump();
            return;
        }
        if (data.type === 'fatal') {
            const error = new Error(data.error || 'Voice engine failed to load');
            reportStatus(error.message, 'ERROR');
            teardown(error);
        }
    };

    const ensureWorker = () => {
        if (!window.Worker) {
            throw new Error('This voice requires Web Worker support in this browser.');
        }
        if (state.worker) return state.worker;
        let worker;
        try {
            worker = new Worker(workerUrl, { type: 'classic' });
        } catch (err) {
            worker = new Worker(workerUrl);
        }
        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', (event) => {
            const message = event?.message || 'Voice worker error';
            reportStatus(message, 'ERROR');
            teardown(new Error(message));
        });
        worker.addEventListener('messageerror', () => teardown(new Error('Voice worker message error')));
        state.worker = worker;
        state.ready = false;
        return worker;
    };

    const synth = (text, opts = {}) => {
        if (typeof opts.reportStatus === 'function') reportStatus = opts.reportStatus;
        if (typeof opts.onProgress === 'function') onProgress = opts.onProgress;
        ensureWorker();
        return new Promise((resolve, reject) => {
            state.queue.push({ text, resolve, reject });
            pump();
        });
    };

    return { synth, ensureWorker, state };
}

let __spfyEngine = null;
export function getSpfyEngine() {
    if (!__spfyEngine) {
        __spfyEngine = createWasmVoiceWorkerEngine({
            workerUrl: SPFY_WORKER_URL,
            readyStatus: 'Speechify voice ready.',
        });
    }
    return __spfyEngine;
}

let __acuEngine = null;
export function getAcuEngine() {
    if (!__acuEngine) {
        __acuEngine = createWasmVoiceWorkerEngine({
            workerUrl: ACU_WORKER_URL,
            readyStatus: 'AcuVoice ready.',
        });
    }
    return __acuEngine;
}

export function createTtsTextEditor(config = {}) {
    const {
        textareaId,
        ariaLabel,
        theme,
        width = '27vw',
        height = '15rem',
        onChange = null,
    } = config;

    if (!window.CodeMirror) return null;
    const textarea = document.getElementById(textareaId);
    if (!textarea) return null;

    const editor = window.CodeMirror.fromTextArea(textarea, {
        lineNumbers: true,
        mode: 'text/xml',
        matchBrackets: true,
        theme,
        lineWrapping: true,
    });

    editor.getInputField().setAttribute('aria-label', ariaLabel);
    editor.setSize(width, height);

    const wrapper = editor.getWrapperElement();
    wrapper.classList.add('ttsText', 'ttsText--editor');

    editor.on('change', () => {
        editor.save();
        if (onChange) onChange(editor);
    });

    return editor;
}

let __piperLoading = null;

export function ensurePiperLoaded(config = {}) {
    const {
        reportStatus = () => {},
        voice = PIPER_DEFAULT_VOICE,
        bundleUrl = PIPER_BUNDLE_URL,
        wasmBase = PIPER_ORT_WASM_BASE,
    } = config;

    return (async () => {
        if (window.PiperTTS?.pcmFor || window.PiperTTS?.predict) return;

        if (!__piperLoading) {
            __piperLoading = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = bundleUrl;
                s.async = true;
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
            });
        }
        await __piperLoading;

        if (window.ort?.env?.wasm) {
            window.ort.env.wasm.wasmPaths = wasmBase;
        }

        const HF_URL_HINT = '/rhasspy/piper-voices/resolve';
        const origFetch = window.fetch.bind(window);

        window.fetch = async (input, init) => {
            const url = typeof input === 'string' ? input : (input?.url || '');
            if (url.includes(HF_URL_HINT) || /voices(\.json)?$/.test(url)) {
                const manifest = {};
                manifest[voice.id] = { model: voice.modelUrl, config: voice.configUrl };
                return new Response(new Blob([JSON.stringify(manifest)], { type: 'application/json' }), { status: 200 });
            }
            return origFetch(input, init);
        };

        if (window.PiperTTS?.init) {
            try {
                await window.PiperTTS.init({ voiceId: voice.id, warmup: false });
            } catch {
                reportStatus('PiperTTS: init failed.', "ERROR");
            }
        }
    })();
}

export async function getPiperPcm(text, targetRate, config = {}) {
    const {
        ensureLoaded = null,
        reportStatus = () => {},
        voiceId = PIPER_DEFAULT_VOICE_ID,
    } = config;

    if (!text || !text.trim()) return null;

    if (ensureLoaded) await ensureLoaded();

    reportStatus("Generating local TTS audio... this may take a while, especially if your text is longer than a few sentences.");

    if (window.PiperTTS?.pcmFor) {
        return new Float32Array(await window.PiperTTS.pcmFor(text, voiceId, targetRate));
    }

    let wavBlob = null;

    if (window.PiperTTS?.synthToWavBlob) {
        wavBlob = await window.PiperTTS.synthToWavBlob(text);
    }

    else {
        reportStatus('PiperTTS: no synthToWavBlob/pcmFor found.', "WARN");
        return null;
    }

    if (window.wavefile?.WaveFile) {
        const WaveFile = window.wavefile.WaveFile;
        const ab = await wavBlob.arrayBuffer();
        let w = new WaveFile(new Uint8Array(ab));

        if (w.fmt.sampleRate !== targetRate) {
            w.toSampleRate(targetRate, { algorithm: 'sinc' });
        }

        w.toBitDepth('32f');
        const f64 = w.getSamples();
        return new Float32Array(f64);
    }

    if (window.PiperTTS?.wavBlobToPcm) {
        const { pcm, sampleRate } = await window.PiperTTS.wavBlobToPcm(wavBlob);
        return resamplePcm(pcm, sampleRate, targetRate);
    }

    reportStatus('No decoder for WAV to PCM.', "WARN");
    return null;
}

export async function populateRemoteVoiceList(config = {}) {
    const {
        selectElement,
        voiceBackendMap,
        reportError = () => {},
        url = REMOTE_VOICE_LIST_URL,
    } = config;

    if (!selectElement) return false;

    try {
        const response = await fetch(url);
        const data = await response.json();

        for (const [voiceId, voiceName] of Object.entries(data.voices)) {
            if (voiceName.toLowerCase().includes("emnet")) {
                const option = document.createElement("option");
                option.value = voiceId;
                option.textContent = "[EMNet] EMNet (uses generated headers as input)";
                selectElement.appendChild(option);
            }

            else {
                const backendMatch = voiceName.match(/\[(.*?)\]/);
                let backend = backendMatch ? backendMatch[1] : "Unknown";

                if (voiceName.toLowerCase().includes("bal/spfy")) {
                    backend = "BAL";
                }

                if (!voiceBackendMap[backend]) {
                    voiceBackendMap[backend] = [];
                }

                voiceBackendMap[backend].push(voiceId);
                const option = document.createElement("option");
                option.value = voiceId;
                option.textContent = voiceName;
                selectElement.appendChild(option);
            }
        }

        return true;
    }

    catch (error) {
        console.error("Error fetching voice list:", error);
        reportError(error);
        return false;
    }
}
