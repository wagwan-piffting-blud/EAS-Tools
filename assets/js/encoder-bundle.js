import { ENDEC_MODE_OPTIONS, getEndecModeProfile, normalizeEndecMode, saveFile, CODEMIRROR_DARK_THEME_NAME, CODEMIRROR_LIGHT_THEME_NAME, resamplePcm, resamplePcmSinc, emulateSampleRate, vmifyPcm, validateMarkupAndText, createNanoTtsEngine, createTtsTextEditor, ensurePiperLoaded, getPiperPcm, populateRemoteVoiceList, getSpfyEngine, getAcuEngine } from './common-functions.js';

if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
        console.error('Uncaught error:', event.message, event.filename, event.lineno, event.error);
    });

    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled rejection:', event.reason);
    });
}

(async function () {
    let encoderTextEditor = null;

    function initEncoderTextEditor() {
        if (encoderTextEditor || !window.CodeMirror) return encoderTextEditor;

        const encoderEditor = createTtsTextEditor({
            textareaId: 'ttsText',
            ariaLabel: 'Text to speak in the alert announcement',
            theme: window.matchMedia('(prefers-color-scheme: light)').matches ? CODEMIRROR_LIGHT_THEME_NAME : CODEMIRROR_DARK_THEME_NAME,
            onChange: (editor) => {
                window.ttsText = editor.getValue().trim();
            },
        });
        if (!encoderEditor) return null;

        encoderTextEditor = encoderEditor;
        return encoderEditor;
    }

    window.encoderEditor = initEncoderTextEditor();
    window.encoderEditor.refresh();
})();

async function fetchAndStore() {
    function processSameCodes(sameCodes) {
        window.rgn = {};
        window.state = {};
        window.county = {};
        window.sameEvents = {};
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

        for (const code in sameCodes['SUBDIV']) {
            const name = sameCodes['SUBDIV'][code];
            window.rgn[code] = name;
        }

        const usStateAbbrSet = new Set(
            Object.values(window.abbrvs).filter((abbrv) => typeof abbrv === 'string' && abbrv.length === 2 && abbrv !== 'US')
        );
        for (const code in sameCodes['SAME']) {
            let stcode = code.slice(0, 2);
            let countycode = code.slice(2);
            const name = sameCodes['SAME'][code];

            const expectedStateAbbr = window.state[stcode];
            if (countycode !== '000' && usStateAbbrSet.has(expectedStateAbbr)) {
                const suffixMatch = name.match(/,\s*([A-Z]{2})$/);
                if (suffixMatch && suffixMatch[1] !== expectedStateAbbr) {
                    continue;
                }
            }

            window.county[stcode] = window.county[stcode] || {};
            window.county[stcode][countycode] = name;
            if (countycode === '000') {
                let statename = name.replace(/^State of /, '').trim();
                const abbrv = window.abbrvs[statename] || statename;
                window.state[stcode] = abbrv;
            }
        }

        if (sameCodes['EVENTS'] && typeof sameCodes['EVENTS'] === 'object') {
            window.sameEvents = { ...sameCodes['EVENTS'] };
        }
    }

    const response = await fetch('assets/E2T/include/same-us.json');
    const data = await response.json();
    processSameCodes(data);

    window.canadaCounty = {};
    try {
        const caResponse = await fetch('assets/E2T/include/same-ca.json');
        const caData = await caResponse.json();
        if (caData['SAME']) {
            for (const code in caData['SAME']) {
                window.canadaCounty[code.padStart(5, "0")] = caData['SAME'][code];
            }
        }
    } catch (e) {
        console.error('Error loading Canadian FIPS:', e);
    }
}

(async function () {
    'use strict';

    await fetchAndStore().catch((error) => {
        console.error('Error fetching and storing data:', error);
    });

    const rgn = window.rgn || {};
    const state = window.state || {};
    const county = window.county || {};
    const canadaCounty = window.canadaCounty || {};

    const caProvinces = {};
    const caLocationsByProvince = {};
    for (const [code, name] of Object.entries(canadaCounty)) {
        const provDigit = code.charAt(0);
        const suffix = code.slice(1);
        if (suffix === "0000") {
            caProvinces[provDigit] = name.replace(/^All of /, '');
        }
        if (!caLocationsByProvince[provDigit]) caLocationsByProvince[provDigit] = {};
        caLocationsByProvince[provDigit][suffix] = name;
    }

    var context = new AudioContext();
    var gain = context.createGain();
    gain.gain.value = 0.25;
    gain.connect(context.destination);
    var AFSK_TIME = 0.00192;
    var SPACE_FREQ = 1562.5;
    var MARK_FREQ = 2083.3333333;
    var SAMPLE_RATE = 44100;
    var NRW_WAT_FREQ = 1050;
    var WAT_FREQ_1 = 853;
    var WAT_FREQ_2 = 960;
    var EOM = "NNNN";
    var HEADER = "ZCZC";
    var PREAMBLE = 0xD5; //0xab read from lsb to msb
    var samples = [];
    var TWO_PI = 2 * Math.PI;
    var SAME_SAMPLES_PER_BIT = SAMPLE_RATE * AFSK_TIME;
    var MARK_PHASE_INC = TWO_PI * MARK_FREQ / SAMPLE_RATE;
    var SPACE_PHASE_INC = TWO_PI * SPACE_FREQ / SAMPLE_RATE;

    function generate_afsk(message) {
        let phase = 0;
        let clock = 0;
        for (let k = 0; k < message.length; k++) {
            const inc = message[k] ? MARK_PHASE_INC : SPACE_PHASE_INC;
            const bitEnd = (k + 1) * SAME_SAMPLES_PER_BIT;
            while (clock < bitEnd) {
                let s = Math.sin(phase);
                if (cl) {
                    if (s > 0.79) {
                        s = 0.79;
                    } else if (s < -0.79) {
                        s = -0.79;
                    }
                }
                samples.push(s);
                phase += inc;
                if (phase >= TWO_PI) {
                    phase -= TWO_PI;
                }
                clock++;
            }
        }
    }

    //cache the two frequencies
    function generate_tone(freq, length) {
        for (let i = 0; i < length; i++) {
            let s = Math.sin((i / SAMPLE_RATE) * 2 * Math.PI * freq);
            if (cl) {
                if (s > 0.79) {
                    s = 0.79;
                } else if (s < -0.79) {
                    s = -0.79;
                }
            }
            samples.push(s);
        }
    }

    function generate_dual_tone(freq1, freq2, length) {
        for (let i = 0; i < length; i++) {
            let s = 0.5 * (Math.sin((i * 2 * Math.PI * freq1) / SAMPLE_RATE) + Math.sin((i * 2 * Math.PI * freq2) / SAMPLE_RATE));
            if (cl) {
                if (s > 0.79) {
                    s = 0.79;
                } else if (s < -0.79) {
                    s = -0.79;
                }
            }
            samples.push(s);
        }
    }

    function generate_silence(length) {
        for (let i = 0; i < length; i++) {
            samples.push(0);
        }
    }

    function __clampSample(s) {
        if (cl) {
            if (s > 0.79) return 0.79;
            if (s < -0.79) return -0.79;
            return s;
        }
        if (s > 0.99) return 0.99;
        if (s < -0.99) return -0.99;
        return s;
    }

    const __relayPopFileCache = new Map();
    const __relayPopFileLoaders = new Map();

    function __loadRelayPopFile(file) {
        if (__relayPopFileCache.has(file)) return Promise.resolve(__relayPopFileCache.get(file));
        if (__relayPopFileLoaders.has(file)) return __relayPopFileLoaders.get(file);

        const loader = (async () => {
            try {
                const response = await fetch(file);
                if (!response.ok) {
                    throw new Error("Failed to fetch relay pop file.");
                }

                const arrayBuffer = await response.arrayBuffer();
                const decodeContext = new (window.AudioContext || window.webkitAudioContext)();
                const decode = decodeContext.decodeAudioData.bind(decodeContext);
                const audioBuffer = decode.length > 1
                    ? await new Promise((resolve, reject) => decode(arrayBuffer.slice(0), resolve, reject))
                    : await decode(arrayBuffer.slice(0));

                if (typeof decodeContext.close === "function") {
                    decodeContext.close().catch(() => { });
                }

                const channels = Math.max(1, audioBuffer.numberOfChannels);
                const length = audioBuffer.length;
                const merged = new Float32Array(length);
                const invChannels = 1 / channels;

                for (let channel = 0; channel < channels; channel++) {
                    const channelData = audioBuffer.getChannelData(channel);
                    for (let i = 0; i < length; i++) {
                        merged[i] += channelData[i] * invChannels;
                    }
                }

                const pcm = (audioBuffer.sampleRate === SAMPLE_RATE)
                    ? merged
                    : resamplePcm(merged, audioBuffer.sampleRate, SAMPLE_RATE);
                __relayPopFileCache.set(file, pcm);
                return pcm;
            } catch (error) {
                __relayPopFileCache.set(file, null);
                console.error("Unable to decode relay pop audio.", error);
                return null;
            } finally {
                __relayPopFileLoaders.delete(file);
            }
        })();

        __relayPopFileLoaders.set(file, loader);
        return loader;
    }

    function appendRelayPop(cfg) {
        if (!cfg) return;
        const popPcm = __relayPopFileCache.get(cfg);
        if (!popPcm || !popPcm.length) return;
        for (let i = 0; i < popPcm.length; i++) {
            samples.push(__clampSample(popPcm[i]));
        }
    }

    async function ensureRelayPopReady(cfg) {
        if (!cfg || cfg.enabled === false || !cfg.fileStart || !cfg.fileEnd) return;
        await __loadRelayPopFile(cfg.fileStart);
        await __loadRelayPopFile(cfg.fileEnd);
    }

    const piperReportStatus = (message, level = "LOG") => addStatus(message, level);
    const ensurePiper = () => ensurePiperLoaded({ reportStatus: piperReportStatus });

    const nanoTts = createNanoTtsEngine({
        reportStatus: (message, level = "LOG") => {
            if (!message) return;
            addStatus(`NanoTTS: ${message}`, level);
        },
        readyStatus: "Local voice ready.",
        decodeBlob: async (blob) => {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            try {
                const buffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
                const pcm = buffer.getChannelData(0);
                const copy = new Float32Array(pcm.length);
                copy.set(pcm);
                return { pcm: copy, sampleRate: buffer.sampleRate };
            } finally {
                if (typeof audioContext.close === "function") {
                    audioContext.close().catch(() => { });
                }
            }
        },
    });

    function dbToLin(db) { return Math.pow(10, db / 20); }

    function normalizeTtsPcm(pcm, { targetDb = -3, maxGainDb = 24, softClip = true, softClipK = 1.5 } = {}) {
        if (!pcm || !pcm.length) return pcm;

        let peak = 0;

        for (let i = 0; i < pcm.length; i++) {
            const a = Math.abs(pcm[i]);
            if (a > peak) peak = a;
        }

        if (peak <= 1e-8) return pcm;

        const target = dbToLin(targetDb);
        let gain = target / peak;
        const maxGain = dbToLin(maxGainDb);

        if (gain > maxGain) gain = maxGain;

        const out = new Float32Array(pcm.length);

        if (softClip) {
            const k = softClipK;
            const denom = Math.tanh(k);
            for (let i = 0; i < pcm.length; i++) {
                const x = pcm[i] * gain;
                out[i] = Math.tanh(k * x) / denom;
            }
        }

        else {
            for (let i = 0; i < pcm.length; i++) {
                let x = pcm[i] * gain;
                if (x > 0.999) x = 0.999; else if (x < -0.999) x = -0.999;
                out[i] = x;
            }
        }

        return out;
    }



    function appendPcmToSamples(pcm) {
        if (!pcm) return;
        for (let i = 0; i < pcm.length; i++) {
            let s = pcm[i];
            if (s > 0.99) s = 0.99;
            else if (s < -0.99) s = -0.99;
            samples.push(s);
        }
    }

    var wav = new wavefile.WaveFile();

    function zero_pad_int(num, totalLength) {
        return num.toString().padStart(totalLength, '0');
    }

    function getDay(date) { return zero_pad_int(Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000), 3); }

    function getHour(date) { return zero_pad_int(date.getUTCHours(), 2); }

    function getMinute(date) { return zero_pad_int(date.getUTCMinutes(), 2); }

    function bytetobits(byteArray) {
        const bitsArray = [];
        for (let i = 0; i < byteArray.length; i++) {
            let byte = byteArray[i];
            for (let j = 7; j >= 0; j--) {
                bitsArray.push((byte & (1 << j)) >> j);
            }
        }
        return bitsArray;
    }

    function genPreamble() {
        const byteArray = new Uint8Array(16);
        byteArray.fill(PREAMBLE);
        return byteArray;
    }

    function preamble() {
        return bytetobits(genPreamble());
    }

    function getLocalDT(currentLocalDateTime) {
        const year = currentLocalDateTime.getFullYear();
        const month = ('0' + (currentLocalDateTime.getMonth() + 1)).slice(-2);
        const day = ('0' + currentLocalDateTime.getDate()).slice(-2);
        const hours = ('0' + currentLocalDateTime.getHours()).slice(-2);
        const minutes = ('0' + currentLocalDateTime.getMinutes()).slice(-2);
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    function genArray(str) {
        let pre = preamble();
        let byteData = [];
        for (let j = 0; j < str.length; j++) {
            for (let i = 0; i < 8; i++) {
                if ((str.charCodeAt(j) >> i) & 1) {
                    byteData.push(1);
                } else {
                    byteData.push(0);
                }
            }
        }
        let b = pre.concat(byteData);
        return b;
    }

    const MAX_PURGE_HOURS = 99;

    function populateHourOptions() {
        if (!hrselect) { return; }
        var previous = hrselect.value;
        hrselect.innerHTML = "";
        for (var h = 0; h <= MAX_PURGE_HOURS; h++) {
            var label = h.toString().padStart(2, "0");
            var o = document.createElement("option");
            o.innerHTML = label;
            o.value = label;
            hrselect.appendChild(o);
        }
        if (previous && Array.from(hrselect.options).some(opt => opt.value === previous)) {
            hrselect.value = previous;
        }
    }

    function getMinNodes() {
        var m = [0, 15, 30, 45];

        if (hr == 0) {
            m = [0, 15, 30, 45];
        }

        else if (hr > 5) {
            m = [0];
        }

        else if (hr > 0) {
            m = [0, 30];
        }

        else {
            m = [0, 15, 30, 45];
        }

        var nodes = [];
        m.forEach(e => { var o = document.createElement("option"); o.innerHTML = e.toString().padStart(2, "0"); o.value = e.toString().padStart(2, "0"); nodes.push(o); }); return nodes;
    }

    async function saveToWav() {
        addStatus("Generating wav file...");
        const endecRate = getEndecModeProfile(getOverallEndecMode()).sampleRate;
        const useEndecRate = shouldEmulateEndecRate() && endecRate !== SAMPLE_RATE;
        const outRate = useEndecRate ? endecRate : SAMPLE_RATE;
        const outSamples = useEndecRate ? Array.from(resamplePcmSinc(samples, SAMPLE_RATE, endecRate)) : samples;
        wav.fromScratch(1, outRate, '32', outSamples.map(e => {
            return e * (2147483647 / 2);
        }));
        const wavBuffer = wav.toBuffer().buffer;
        await saveFile('eas.wav', wavBuffer, 'audio/wav');
        addStatus(useEndecRate ? `Download started (${outRate} Hz ENDEC rate).` : "Download started...");
    }

    function getOverallEndecMode() {
        const el = document.getElementById("overallEndecMode");
        const raw = (el && typeof el.value === "string") ? el.value : "DEFAULT";
        const normalized = (typeof raw === "string") ? raw.trim().toUpperCase() : "DEFAULT";

        if (normalized === LEGACY_DIGITAL_MODE) {
            return LEGACY_DIGITAL_MODE;
        }

        if (normalized === "DIGITAL") {
            return "SAGE_DIGITAL_3644";
        }

        if (normalized === "SAGE") {
            return "SAGE_ANALOG_1822";
        }

        return normalizeEndecMode(normalized);
    }

    function shouldEmulateEndecRate() {
        return document.getElementById("endecResample")?.checked !== false;
    }

    function samplesFromMs(ms) {
        return Math.round(SAMPLE_RATE * (ms / 1000));
    }

    const LEGACY_DIGITAL_MODE = "DIGITAL_LEGACY";
    const LEGACY_DIGITAL_LABEL = "SAGE 3644/DIGITAL (Legacy)";
    const SAME_PREAMBLE = "\xAB".repeat(16);
    const DIGITAL_TAIL = "\xFF\xFF\xFF";

    function ensureLegacyDigitalModeOption() {
        const modeSelect = document.getElementById("overallEndecMode");
        if (!modeSelect) {
            return;
        }

        const selectedValue = getOverallEndecMode();
        const optionsByValue = new Map();

        for (let i = 0; i < ENDEC_MODE_OPTIONS.length; i++) {
            const mode = ENDEC_MODE_OPTIONS[i];
            optionsByValue.set(mode.value, mode.label);
        }

        optionsByValue.set(LEGACY_DIGITAL_MODE, LEGACY_DIGITAL_LABEL);

        const fragment = document.createDocumentFragment();
        optionsByValue.forEach((label, value) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            fragment.appendChild(option);
        });

        modeSelect.replaceChildren(fragment);

        if (optionsByValue.has(selectedValue)) {
            modeSelect.value = selectedValue;
        } else {
            modeSelect.value = "DEFAULT";
        }
    }

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

        if (mode === LEGACY_DIGITAL_MODE) {
            const first = "\x00" + data + DIGITAL_TAIL;
            const std = "\xAB" + data + DIGITAL_TAIL;
            return [first, std, std];
        }

        const profile = getEndecModeProfile(mode);
        return buildTxStringsFromBursts(data, profile.headerBursts);
    }

    function buildEomTxStrings(mode) {
        const core = SAME_PREAMBLE + "NNNN";

        if (mode === LEGACY_DIGITAL_MODE) {
            const part1 = "\x00" + core + DIGITAL_TAIL;
            const part2 = core + DIGITAL_TAIL;
            return [part1, part2, part2];
        }

        const profile = getEndecModeProfile(mode);
        return buildTxStringsFromBursts(core, profile.eomBursts);
    }

    function emitTxBurstsFromStrings(txStrings, betweenSilenceSamples, finalSilenceSamples, relayPopCfg = null) {
        const cache = new Map();

        for (let i = 0; i < txStrings.length; i++) {
            const s = txStrings[i];
            let bits = cache.get(s);
            if (!bits) {
                bits = bitsFromStringLSB(s);
                cache.set(s, bits);
            }

            if (relayPopCfg !== null) appendRelayPop(relayPopCfg.fileStart);
            generate_afsk(bits);
            if (relayPopCfg !== null) appendRelayPop(relayPopCfg.fileEnd);

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
        const txStrings = buildHeaderTxStrings(header, mode);
        const isLegacyDigital = (mode === LEGACY_DIGITAL_MODE);
        const profile = isLegacyDigital ? null : getEndecModeProfile(mode);
        const between = samplesFromMs(isLegacyDigital ? 1000 : profile.betweenGapMs);
        const after = samplesFromMs(isLegacyDigital ? 1000 : profile.afterGapMs);
        const relayPop = (mode === "TRILITHIC_POP") ? profile.relayPop : null;
        emitTxBurstsFromStrings(txStrings, between, after, relayPop);
    }

    function create_eom_tones() {
        const mode = getOverallEndecMode();
        const isLegacyDigital = (mode === LEGACY_DIGITAL_MODE);
        const profile = isLegacyDigital ? null : getEndecModeProfile(mode);
        const oneSecondSamples = samplesFromMs(1000);
        generate_silence(oneSecondSamples);
        const txStrings = buildEomTxStrings(mode);
        const between = samplesFromMs(isLegacyDigital ? 1000 : profile.betweenGapMs);
        const relayPop = (mode === "TRILITHIC_POP") ? profile.relayPop : null;
        emitTxBurstsFromStrings(txStrings, between, oneSecondSamples, relayPop);
    }

    var pelmorexTonePromise = null;

    function loadPelmorexAttentionTone() {
        if (pelmorexTonePromise) {
            return pelmorexTonePromise;
        }

        pelmorexTonePromise = (async function () {
            try {
                const response = await fetch("assets/pelmorex.wav");
                if (!response.ok) {
                    throw new Error("Failed to fetch Pelmorex attention tone reference.");
                }

                const arrayBuffer = await response.arrayBuffer();
                const decodeContext = new (window.AudioContext || window.webkitAudioContext)();
                const decode = decodeContext.decodeAudioData.bind(decodeContext);
                const audioBuffer = decode.length > 1
                    ? await new Promise((resolve, reject) => decode(arrayBuffer.slice(0), resolve, reject))
                    : await decode(arrayBuffer.slice(0));

                if (typeof decodeContext.close === "function") {
                    decodeContext.close().catch(() => { });
                }

                const channels = Math.max(1, audioBuffer.numberOfChannels);
                const length = audioBuffer.length;
                const merged = new Float32Array(length);
                const invChannels = 1 / channels;

                for (let channel = 0; channel < channels; channel++) {
                    const channelData = audioBuffer.getChannelData(channel);
                    for (let i = 0; i < length; i++) {
                        merged[i] += channelData[i] * invChannels;
                    }
                }

                return audioBuffer.sampleRate === SAMPLE_RATE
                    ? merged
                    : resamplePcm(merged, audioBuffer.sampleRate, SAMPLE_RATE);
            } catch (error) {
                console.error("Unable to decode Pelmorex reference tone.", error);
                return null;
            }
        })();

        return pelmorexTonePromise;
    }

    async function create_pelmorex_attention_tone() {
        const referenceTone = await loadPelmorexAttentionTone();
        if (referenceTone && referenceTone.length) {
            appendPcmToSamples(referenceTone);
            return;
        }
    }

    var buzzerTonePromise = null;

    function loadBuzzerTone() {
        if (buzzerTonePromise) {
            return buzzerTonePromise;
        }

        buzzerTonePromise = (async function () {
            try {
                const response = await fetch("assets/buzzer.wav");
                if (!response.ok) {
                    throw new Error("Failed to fetch Buzzer tone reference.");
                }

                const arrayBuffer = await response.arrayBuffer();
                const decodeContext = new (window.AudioContext || window.webkitAudioContext)();
                const decode = decodeContext.decodeAudioData.bind(decodeContext);
                const audioBuffer = decode.length > 1
                    ? await new Promise((resolve, reject) => decode(arrayBuffer.slice(0), resolve, reject))
                    : await decode(arrayBuffer.slice(0));

                if (typeof decodeContext.close === "function") {
                    decodeContext.close().catch(() => { });
                }

                const channels = Math.max(1, audioBuffer.numberOfChannels);
                const length = audioBuffer.length;
                const merged = new Float32Array(length);
                const invChannels = 1 / channels;

                for (let channel = 0; channel < channels; channel++) {
                    const channelData = audioBuffer.getChannelData(channel);
                    for (let i = 0; i < length; i++) {
                        merged[i] += channelData[i] * invChannels;
                    }
                }

                return audioBuffer.sampleRate === SAMPLE_RATE
                    ? merged
                    : resamplePcm(merged, audioBuffer.sampleRate, SAMPLE_RATE);
            } catch (error) {
                console.error("Unable to decode Buzzer reference tone.", error);
                return null;
            }
        })();

        return buzzerTonePromise;
    }

    async function create_buzzer_tone() {
        const referenceTone = await loadBuzzerTone();
        if (referenceTone && referenceTone.length) {
            appendPcmToSamples(referenceTone);
            return;
        }
    }

    function create_header_string(origin, event, locations, length, date, par) {
        var h = "";
        var lengthCode = /^\d{4}$/.test(String(length)) ? String(length) : "0000";
        h += HEADER;
        h += "-";
        h += origin;
        h += "-";
        h += event;
        for (var i = 0; i < locations.length; i++) {
            h += "-";
            h += zero_pad_int(locations[i], 6);
        }
        h += "+";
        h += lengthCode;
        h += "-";
        h += getDay(date);
        h += getHour(date);
        h += getMinute(date);
        h += "-";
        h += par;
        h += "-";
        return h;
    }

    function create_wat() {
        generate_dual_tone(WAT_FREQ_1, WAT_FREQ_2, SAMPLE_RATE * tlen);
    }

    function create_nwr_tone() {
        generate_tone(1050, SAMPLE_RATE * tlen);
    }

    const voiceBackendMap = {};

    async function getVoiceList() {
        const voiceListElement = document.getElementById("ttsVoice");

        await populateRemoteVoiceList({
            selectElement: voiceListElement,
            voiceBackendMap,
            reportError: (error) => addStatus("Error fetching voice list: " + error.message + ". There will not be any voices available from the TTS service, only the in-browser WebAssembly voice.", "ERROR"),
        });

        voiceListElement.dispatchEvent(new Event('change'));
    }

    async function getAudioFromPage(response) {
        const decoder = new TextDecoder("utf-8");
        const responseText = decoder.decode(response);
        const audioMatch = responseText.match(/id="downloadlink"><a href="(.*)" download/i);
        const jsonMatch = responseText.match(/<span id="jsonErrorMsg">(.*)</i);

        if (jsonMatch && jsonMatch[1]) {
            var cleanMatch = jsonMatch[1].replace(/.*Exact error: (.*)/, "$1");
            if (cleanMatch != '') {
                addStatus("TTS Generation Error: " + cleanMatch, "ERROR");
            }
            else {
                addStatus("TTS Generation Error: " + jsonMatch[1], "ERROR");
            }
            return null;
        }

        if (audioMatch && audioMatch[1]) {
            const audioSrc = audioMatch[1];
            const audioResponse = await fetch("https://wagspuzzle.space/tools/eas-tts/" + audioSrc);
            const audioArrayBuffer = await audioResponse.arrayBuffer();
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const buffer = await audioContext.decodeAudioData(audioArrayBuffer);
            return buffer;
        }

        return null;
    }

    function checkZCZCIsValid(header) {
        const zczcPattern = /^ZCZC-([A-Z]{3})-([A-Z]{3})-((?:\d{6}(?:-?)){1,31})\+(\d{4})-(\d{7})-([A-Za-z0-9\/ ]{0,8})-?$/;
        return zczcPattern.test(header);
    }

    async function webTTSGenerate(useOverrideTZ, header) {
        addStatus("Generating TTS audio using web request, this may take a while...");

        return new Promise((resolve) => {
            let settled = false;

            const safeResolve = () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };

            const finishWithSilence = () => {
                generate_silence(Math.floor(SAMPLE_RATE * 1));
                safeResolve();
            };

            const handleDecodeError = (error) => {
                console.error("Error decoding TTS audio:", error);
                addStatus("Error decoding TTS audio. There will instead be silence.", "ERROR");
                finishWithSilence();
            };

            const xhr = new XMLHttpRequest();
            const url = "https://wagspuzzle.space/tools/eas-tts/index.php?handler=toolkit";

            const ttsRate = document.getElementById("ttsRate")?.value || "0";
            const ttsPitch = document.getElementById("ttsPitch")?.value || "0";
            const voiceBackend = voiceBackendMap[Object.keys(voiceBackendMap).find(backend => voiceBackendMap[backend].includes(window.ttsVoice))] ? Object.keys(voiceBackendMap).find(backend => voiceBackendMap[backend].includes(window.ttsVoice)) : "Unknown";

            if (voiceBackend.toLowerCase().includes("bal") && (ttsRate !== "0" || ttsPitch !== "0")) {
                window.oldTtsText = window.ttsText;
                if (ttsRate !== "0") {
                    window.ttsText = `<rate absspeed="${ttsRate}">${window.ttsText}</rate>`;
                }
                if (ttsPitch !== "0") {
                    window.ttsText = `<pitch absmiddle="${ttsPitch}">${window.ttsText}</pitch>`;
                }
            }

            else if (voiceBackend.toLowerCase().includes("vt") && (ttsRate !== "0" || ttsPitch !== "0")) {
                window.oldTtsText = window.ttsText;
                const vtValue = (value) => {
                    const parsed = Number(value);
                    if (!Number.isFinite(parsed)) { return 100; }
                    const scaled = Math.round((parsed * 10) + 100);
                    return Math.min(200, Math.max(0, scaled));
                };
                if (ttsRate !== "0") {
                    window.ttsText = `<vtml_speed value="${vtValue(ttsRate)}">${window.ttsText}</vtml_speed>`;
                }
                if (ttsPitch !== "0") {
                    window.ttsText = `<vtml_pitch value="${vtValue(ttsPitch)}">${window.ttsText}</vtml_pitch>`;
                }
            }

            const params = new URLSearchParams();
            params.append("text", window.ttsVoice === "EMNet" ? header : window.ttsText);
            params.append("voice", window.ttsVoice);
            params.append("useOverrideTZ", useOverrideTZ ?? "UTC");

            xhr.open("POST", url, true);
            xhr.responseType = "arraybuffer";
            xhr.setRequestHeader("Accept", "*/*");
            xhr.setRequestHeader("User-Agent", "EAS-Tools/wagwan-piffting-blud.github.io");
            xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");

            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300 && xhr.getResponseHeader("Content-Type") === "audio/wav") {
                    window.updateTTSRequestsCounter();
                    const rawPayload = xhr.response ?? xhr.responseText;

                    const toArrayBuffer = (payload) => {
                        if (payload instanceof ArrayBuffer) {
                            return Promise.resolve(payload);
                        }

                        if (payload instanceof Blob) {
                            return payload.arrayBuffer();
                        }

                        if (typeof payload === "string") {
                            const withoutPrefix = payload.replace(/^data:audio\/[\w.+-]+;base64,/, "");
                            const candidate = withoutPrefix.replace(/\s/g, "");

                            return new Promise((resolvePayload, rejectPayload) => {
                                try {
                                    const binary = atob(candidate);
                                    const buffer = new ArrayBuffer(binary.length);
                                    const bytes = new Uint8Array(buffer);

                                    for (let i = 0; i < binary.length; i++) {
                                        bytes[i] = binary.charCodeAt(i);
                                    }

                                    resolvePayload(buffer);
                                    return;
                                } catch (error) {
                                    try {
                                        const buffer = new ArrayBuffer(withoutPrefix.length);
                                        const bytes = new Uint8Array(buffer);

                                        for (let i = 0; i < withoutPrefix.length; i++) {
                                            bytes[i] = withoutPrefix.charCodeAt(i) & 0xff;
                                        }

                                        resolvePayload(buffer);
                                        return;
                                    }

                                    catch (fallbackError) {
                                        rejectPayload(error);
                                    }
                                }
                            });
                        }
                        return Promise.reject(new TypeError("Unsupported payload type"));
                    };

                    async function bitcrushPcm(pcm) {
                        if (!(pcm instanceof Float32Array) || pcm.length === 0) {
                            return pcm;
                        }

                        const fallbackExciter = () => {
                            const nyquist = SAMPLE_RATE / 2;
                            if (nyquist < 5000) return pcm;

                            const out = new Float32Array(pcm.length);

                            const drive = 3.16;
                            const driven = new Float32Array(pcm.length);
                            for (let i = 0; i < pcm.length; i++) {
                                driven[i] = Math.tanh(pcm[i] * drive);
                            }

                            const freq = Math.min(4000, nyquist * 0.8);
                            const w0 = 2 * Math.PI * freq / SAMPLE_RATE;
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

                            const hfGain = 1.41;
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
                        };

                        if (typeof window.SOXModule !== "function") {
                            return fallbackExciter();
                        }

                        const input16 = new Int16Array(pcm.length);
                        for (let i = 0; i < pcm.length; i++) {
                            let s = pcm[i];
                            if (s > 1) s = 1; else if (s < -1) s = -1;
                            input16[i] = s < 0 ? (s * 0x8000) : (s * 0x7fff);
                        }
                        const inputRaw = new Uint8Array(input16.buffer);

                        const runSox = async (args, files) => {
                            const cfg = {
                                arguments: args,
                                preRun(mod) {
                                    const vfs = (mod || cfg).FS;
                                    for (const [name, data] of files) {
                                        vfs.writeFile(name, data);
                                    }
                                },
                                postRun() { }
                            };

                            const ret = window.SOXModule(cfg);
                            let inst = cfg;
                            if (ret && typeof ret.then === "function") {
                                inst = await ret;
                            } else if (ret && ret.FS) {
                                inst = ret;
                            }

                            const fs = inst.FS || cfg.FS;
                            if (!fs) return null;

                            try {
                                const raw = fs.readFile("out.raw", { encoding: "binary" });
                                if (!raw || !raw.length) return null;
                                const safe = new Uint8Array(raw.length);
                                safe.set(raw);
                                return safe;
                            } catch {
                                return null;
                            }
                        };

                        const toInt16 = (u8) => {
                            const buf = new ArrayBuffer(u8.byteLength);
                            new Uint8Array(buf).set(u8);
                            return new Int16Array(buf);
                        };

                        try {
                            const needsUpsample = SAMPLE_RATE < 21000;
                            const workRate = needsUpsample ? 44100 : SAMPLE_RATE;
                            let workData = inputRaw;

                            if (needsUpsample) {
                                const upRaw = await runSox([
                                    "-t", "raw", "-r", String(SAMPLE_RATE), "-L",
                                    "-e", "signed-integer", "-b", "16", "-c", "1", "in.raw",
                                    "-t", "raw", "-r", String(workRate), "-L",
                                    "-e", "signed-integer", "-b", "16", "-c", "1", "out.raw",
                                    "rate", "-v", String(workRate)
                                ], [["in.raw", inputRaw]]);

                                if (!upRaw) return fallbackExciter();
                                workData = upRaw;
                            }

                            const hfRaw = await runSox([
                                "-t", "raw", "-r", String(workRate), "-L",
                                "-e", "signed-integer", "-b", "16", "-c", "1", "in.raw",
                                "-t", "raw", "-r", String(workRate), "-L",
                                "-e", "signed-integer", "-b", "16", "-c", "1", "out.raw",
                                "overdrive", "10",
                                "sinc", "4k-10.5k",
                                "gain", "3"
                            ], [["in.raw", workData]]);

                            if (!hfRaw) return fallbackExciter();

                            const orig = toInt16(workData);
                            const hf = toInt16(hfRaw);
                            const mixLen = Math.min(orig.length, hf.length);

                            let peak = 0;
                            for (let i = 0; i < mixLen; i++) {
                                const v = orig[i] + hf[i];
                                const a = v < 0 ? -v : v;
                                if (a > peak) peak = a;
                            }

                            const ceiling = 30934;
                            const gain = peak > ceiling ? ceiling / peak : 1.0;

                            const inv = 1 / 0x7fff;
                            const result = new Float32Array(mixLen);
                            for (let i = 0; i < mixLen; i++) {
                                result[i] = (orig[i] + hf[i]) * gain * inv;
                            }

                            return result;
                        } catch (err) {
                            return fallbackExciter();
                        }
                    }

                    toArrayBuffer(rawPayload).then((arrayBuffer) => {
                        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                        const decode = audioContext.decodeAudioData.bind(audioContext);
                        const decodePromise = decode.length > 1
                            ? new Promise((resolveDecode, rejectDecode) => decode(arrayBuffer, resolveDecode, rejectDecode))
                            : decode(arrayBuffer);

                        decodePromise.then(async (buffer) => {
                            if (typeof audioContext.close === "function") {
                                audioContext.close().catch(() => { });
                            }

                            const pcm = resamplePcm(buffer.getChannelData(0), buffer.sampleRate, SAMPLE_RATE);

                            const normalizedPcm = normalizeTtsPcm(pcm, { targetDb: 3, maxGainDb: 24, softClip: cl, softClipK: 1.6 });

                            generate_silence(Math.floor(SAMPLE_RATE * 0.25));

                            if (/Speechify/i.test(window.ttsVoice) && document.getElementById('shouldBitcrushSpeechify').checked) {
                                const bitcrushed = await bitcrushPcm(normalizedPcm);
                                appendPcmToSamples(bitcrushed);
                            }

                            else {
                                appendPcmToSamples(normalizedPcm);
                            }

                            generate_silence(Math.floor(SAMPLE_RATE * 0.25));

                            safeResolve();
                        }).catch((error) => {
                            if (typeof audioContext.close === "function") {
                                audioContext.close().catch(() => { });
                            }
                            handleDecodeError(error);
                        });
                    }).catch(handleDecodeError);
                }

                else if (xhr.getResponseHeader("Content-Type") === "application/json") {
                    let responseJSON = {};

                    try {
                        const decoder = new TextDecoder("utf-8");
                        responseJSON = JSON.parse(decoder.decode(xhr.response));
                    }

                    catch (error) {
                        console.error("Failed to parse JSON response:", error);
                    }

                    console.error("Request failed with status:", xhr.status, xhr.response);
                    addStatus("Error fetching TTS audio. The server said: '" + responseJSON.error + "'. There will instead be silence.", "ERROR");

                    finishWithSilence();
                }

                else {
                    console.error("Unexpected response type:", xhr.getResponseHeader("Content-Type"), xhr.response);

                    addStatus("Unexpected response type while fetching TTS audio. Trying to fall back to getting audio or JSON error from page...", "WARN");

                    try {
                        getAudioFromPage(xhr.response).then((pcmRaw) => {
                            if (pcmRaw !== null) {
                                const normalizedPcm = normalizeTtsPcm(pcmRaw, { targetDb: 3, maxGainDb: 24, softClip: cl, softClipK: 1.6 });
                                generate_silence(Math.floor(SAMPLE_RATE * 0.25));
                                appendPcmToSamples(normalizedPcm);
                                generate_silence(Math.floor(SAMPLE_RATE * 0.25));
                                safeResolve();
                            }

                            else {
                                addStatus("Failed to find audio in TTS HTML response. There will instead be silence.", "ERROR");
                                finishWithSilence();
                            }
                        }).catch((error) => {
                            console.error("Failed to get audio from page:", error);
                            addStatus("Failed to get audio from page. There will instead be silence.", "ERROR");
                            finishWithSilence();
                        });
                    }

                    catch (error) {
                        console.error("Failed to decode response:", error);
                        addStatus("Failed to decode TTS HTML response. There will instead be silence.", "ERROR");
                        finishWithSilence();
                    }

                }
            };

            xhr.onerror = function () {
                console.error("Unhandled network error occurred.", xhr.status, xhr.statusText);
                addStatus("Unhandled network error occurred while fetching TTS audio. There will instead be silence.", "ERROR");
                finishWithSilence();
            };

            xhr.send(params.toString());
            window.ttsText = window.oldTtsText || window.ttsText;
        });
    }

    async function create_alert_async(header, useOverrideTZ, { allowCustomAudio = false } = {}) {
        document.getElementById("generate").disabled = true;
        document.getElementById("save").disabled = true;
        addStatus("Generating EAS...");

        const endecMode = getOverallEndecMode();
        if (endecMode === "TRILITHIC_POP") {
            const profile = getEndecModeProfile(endecMode);
            await ensureRelayPopReady(profile.relayPop);
        }

        if (tone !== null) {
            switch (tone.toString()) {
                case "0":
                    create_header_tones(header);
                    create_wat();
                    break;
                case "1":
                    create_header_tones(header);
                    if(endecMode === "NWS_CRS") {
                        generate_silence(Math.floor(SAMPLE_RATE * 1));
                    }
                    create_nwr_tone();
                    break;
                case "2":
                    await create_pelmorex_attention_tone();
                    break;
                case "3":
                    create_header_tones(header);
                    await create_buzzer_tone();
                    break;
                case "4":
                    create_header_tones(header);
                    break;
            }
        }

        const appendAnnouncement = (pcmRaw) => {
            const pcm = normalizeTtsPcm(pcmRaw, { targetDb: 3, maxGainDb: 24, softClip: cl, softClipK: 1.6 });
            generate_silence(Math.floor(SAMPLE_RATE * 0.25));
            appendPcmToSamples(pcm);
            generate_silence(Math.floor(SAMPLE_RATE * 0.25));
        };

        const selectedVoiceRaw = (window.ttsVoice || '').trim();
        const normalizedVoice = selectedVoiceRaw.toLowerCase();

        if (window.announcementType === "tts") {
            if (normalizedVoice === "wasm") {
                if (await validateMarkupAndText(voiceBackendMap, window.ttsVoice, window.ttsText || "") !== true) {
                    addStatus("Your text contains invalid or incomplete phoneme codes for the selected backend. This text will not be processed by the voice correctly. There will instead be silence. Try getting rid of ANY phoneme markups, if you're trying to use the WebAssembly voices.", "ERROR");
                    document.getElementById("generate").disabled = false;
                    document.getElementById("save").disabled = false;
                    generate_silence(Math.floor(SAMPLE_RATE * 1));
                    return;
                }
                const pcmRaw = await getPiperPcm(window.ttsText, SAMPLE_RATE, { ensureLoaded: ensurePiper, reportStatus: piperReportStatus });
                if (pcmRaw) {
                    appendAnnouncement(pcmRaw);
                } else {
                    generate_silence(Math.floor(SAMPLE_RATE * 1));
                }
            }

            else if (normalizedVoice === "nanotts") {
                const announcementText = (window.ttsText || '').trim();
                if (!announcementText) {
                    addStatus("NanoTTS requires announcement text. There will instead be silence.", "ERROR");
                    generate_silence(Math.floor(SAMPLE_RATE * 1));
                } else {
                    try {
                        if (await validateMarkupAndText(voiceBackendMap, window.ttsVoice, window.ttsText || "") !== true) {
                            addStatus("Your text contains invalid or incomplete phoneme codes for the selected backend. This text will not be processed by the voice correctly. There will instead be silence. Try getting rid of ANY phoneme markups, if you're trying to use the WebAssembly voices.", "ERROR");
                            document.getElementById("generate").disabled = false;
                            document.getElementById("save").disabled = false;
                            generate_silence(Math.floor(SAMPLE_RATE * 1));
                            return;
                        }
                        const result = await nanoTts.synth(announcementText);
                        if (result?.pcm?.length) {
                            const resampled = resamplePcm(result.pcm, result.sampleRate, SAMPLE_RATE);
                            appendAnnouncement(resampled);
                        } else {
                            addStatus("NanoTTS did not return audio. There will instead be silence.", "ERROR");
                            generate_silence(Math.floor(SAMPLE_RATE * 1));
                        }
                    } catch (error) {
                        console.error(error);
                        addStatus("NanoTTS generation failed. There will instead be silence.", "ERROR");
                        generate_silence(Math.floor(SAMPLE_RATE * 1));
                    }
                }
            }

            else if (normalizedVoice === "spfy" || normalizedVoice === "acuvoice") {
                const announcementText = (window.ttsText || '').trim();
                const engine = normalizedVoice === "spfy" ? getSpfyEngine() : getAcuEngine();
                const engineLabel = normalizedVoice === "spfy" ? "Speechify" : "AcuVoice";
                if (!announcementText) {
                    addStatus(`${engineLabel} requires announcement text. There will instead be silence.`, "ERROR");
                    generate_silence(Math.floor(SAMPLE_RATE * 1));
                } else {
                    try {
                        if (await validateMarkupAndText(voiceBackendMap, window.ttsVoice, window.ttsText || "") !== true) {
                            addStatus("Your text contains invalid or incomplete phoneme codes for the selected backend. This text will not be processed by the voice correctly. There will instead be silence. Try getting rid of ANY phoneme markups, if you're trying to use the WebAssembly voices.", "ERROR");
                            document.getElementById("generate").disabled = false;
                            document.getElementById("save").disabled = false;
                            generate_silence(Math.floor(SAMPLE_RATE * 1));
                            return;
                        }
                        const result = await engine.synth(announcementText, { reportStatus: piperReportStatus, onProgress: setVoiceDownloadProgress });
                        if (result?.pcm?.length) {
                            const resampled = resamplePcm(result.pcm, result.sampleRate, SAMPLE_RATE);
                            appendAnnouncement(resampled);
                        } else {
                            addStatus(`${engineLabel} did not return audio. There will instead be silence.`, "ERROR");
                            generate_silence(Math.floor(SAMPLE_RATE * 1));
                        }
                    } catch (error) {
                        console.error(error);
                        addStatus(`${engineLabel} generation failed. There will instead be silence.`, "ERROR");
                        generate_silence(Math.floor(SAMPLE_RATE * 1));
                    }
                }
            }

            else if (normalizedVoice.startsWith('ios-native:')) {
                const announcementText = (window.ttsText || '').trim();
                if (!announcementText) {
                    addStatus("Native TTS requires announcement text. There will instead be silence.", "ERROR");
                    generate_silence(Math.floor(SAMPLE_RATE * 1));
                } else if (window.EASBridge) {
                    addStatus("Generating native iOS TTS audio...");
                    const voiceId = selectedVoiceRaw.slice('ios-native:'.length);
                    const ttsRate = window._nativeTtsRate ?? 0.5;
                    const ttsPitch = window._nativeTtsPitch ?? 1.0;

                    const nativeTTSResult = await new Promise((resolve) => {
                        window.EASBridge.on('encoder:nativeTTSResult', (result) => {
                            resolve(result);
                        });
                        window.EASBridge.send('encoder:nativeTTS', {
                            text: announcementText,
                            voiceId: voiceId,
                            rate: ttsRate,
                            pitch: ttsPitch,
                        });
                    });

                    if (nativeTTSResult.error) {
                        addStatus("Native TTS error: " + nativeTTSResult.error + ". There will instead be silence.", "ERROR");
                        generate_silence(Math.floor(SAMPLE_RATE * 1));
                    } else if (nativeTTSResult.base64) {
                        const binary = atob(nativeTTSResult.base64);
                        const bytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                        const buffer = await audioContext.decodeAudioData(bytes.buffer);
                        const pcmRaw = buffer.getChannelData(0);
                        const resampled = resamplePcm(pcmRaw, buffer.sampleRate, SAMPLE_RATE);
                        appendAnnouncement(resampled);
                        addStatus("Native TTS audio generated successfully.");
                    } else {
                        addStatus("Native TTS returned no audio. There will instead be silence.", "ERROR");
                        generate_silence(Math.floor(SAMPLE_RATE * 1));
                    }
                } else {
                    addStatus("Native TTS is not available in this environment. There will instead be silence.", "ERROR");
                    generate_silence(Math.floor(SAMPLE_RATE * 1));
                }
            }

            else if (selectedVoiceRaw) {
                if (await validateMarkupAndText(voiceBackendMap, window.ttsVoice, window.ttsText || "") !== true) {
                    addStatus("Your text contains invalid or incomplete phoneme codes for the selected backend. This will not be processed by the voice correctly. There will instead be silence.", "ERROR");
                    document.getElementById("generate").disabled = false;
                    document.getElementById("save").disabled = false;
                    generate_silence(Math.floor(SAMPLE_RATE * 1));
                    return;
                }

                await webTTSGenerate(useOverrideTZ, header);
            }

            else {
                generate_silence(Math.floor(SAMPLE_RATE * 1));
            }
        }

        else if (allowCustomAudio && window.announcementType === "custom") {
            let customAudioFile = document.getElementById("customAudioFile")?.files?.[0];
            let arrayBuffer = customAudioFile
                ? await customAudioFile.arrayBuffer()
                : window._nativeCustomAudioBuffer;
            if (arrayBuffer) {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const bufferCopy = arrayBuffer.slice(0);
                const buffer = await audioContext.decodeAudioData(bufferCopy);
                const pcmRaw = buffer.getChannelData(0);
                let pcm = resamplePcm(pcmRaw, buffer.sampleRate, SAMPLE_RATE);
                if (document.getElementById("enable-vmify-custom")?.checked) {
                    const vmifyIntensityEl = document.getElementById("vmify-custom-intensity");
                    const vmifyIntensity = vmifyIntensityEl ? parseFloat(vmifyIntensityEl.value) : 1;
                    pcm = vmifyPcm(pcm, SAMPLE_RATE, { intensity: Number.isFinite(vmifyIntensity) ? vmifyIntensity : 1 });
                }
                generate_silence(Math.floor(SAMPLE_RATE * 0.25));
                appendPcmToSamples(pcm);
                generate_silence(Math.floor(SAMPLE_RATE * 0.25));
            }
            else {
                addStatus("You must select a custom audio file when using Custom Audio! There will instead be silence.", "ERROR");
                generate_silence(Math.floor(SAMPLE_RATE * 1));
            }
        }

        if (tone !== null) {
            switch (tone.toString()) {
                case "0":
                    create_eom_tones();
                    break;
                case "1":
                    if(endecMode === "NWS_CRS") {
                        generate_silence(Math.floor(SAMPLE_RATE * 1));
                    }
                    create_eom_tones();
                    break;
                case "2":
                    break;
                case "3":
                    create_eom_tones();
                    break;
                case "4":
                    create_eom_tones();
                    break;
            }
        }

        const endecRate = getEndecModeProfile(endecMode).sampleRate;
        if (endecRate !== SAMPLE_RATE) {
            if (shouldEmulateEndecRate()) {
                samples = emulateSampleRate(samples, SAMPLE_RATE, endecRate);
                addStatus("Emulated " + endecRate + " Hz ENDEC sample rate.");
            } else {
                addStatus("ENDEC sample rate emulation is off; keeping full-bandwidth audio.");
            }
        }

        document.getElementById("generate").disabled = false;
        document.getElementById("save").disabled = false;
    }

    var events = document.getElementById("events");
    var originators = document.getElementById("originators");
    var hrselect = document.getElementById("hr");
    var minselect = document.getElementById("min");
    populateHourOptions();
    var timeselect = document.getElementById("time");
    var parinput = document.getElementById("par");
    var statuselem = document.getElementById("status");
    var saveb = document.getElementById("save");
    var clr = document.getElementById("clr");
    var tl = document.getElementById("tlen");
    var att = document.getElementById("att");
    var extram = document.getElementById("em");
    var clip = document.getElementById("clip");
    var stateselect = document.getElementById("stateselect");
    var countyselect = document.getElementById("countyselect");
    var spaces = document.getElementById("spaces");
    var regionselect = document.getElementById("rgselect");
    var fipsinput = document.getElementById("fipsinput");
    var fipsModeSelect = document.getElementById("fipsMode");
    var rawinput = document.getElementById("cheader");

    function selectHasValue(selectElement, value) {
        if (!selectElement) { return false; }
        return Array.from(selectElement.options || []).some(opt => opt.value === value);
    }

    function setSelectNumericValue(selectElement, value) {
        if (!selectElement) { return false; }
        const raw = String(value).trim();
        const num = parseInt(raw, 10);
        if (!Number.isFinite(num)) { return false; }
        const candidates = [num.toString().padStart(2, "0"), num.toString(), raw];
        for (const candidate of candidates) {
            if (selectHasValue(selectElement, candidate)) {
                selectElement.value = candidate;
                return true;
            }
        }
        return false;
    }

    function readSelectInt(selectElement, fallback) {
        if (!selectElement) { return fallback; }
        const num = parseInt(selectElement.value, 10);
        return Number.isFinite(num) ? num : fallback;
    }

    function getDurationCode() {
        let hours = readSelectInt(hrselect, 0);
        let minutes = readSelectInt(minselect, 0);
        if (hours < 0) { hours = 0; }
        if (minutes < 0) { minutes = 0; }
        return hours.toString().padStart(2, "0") + minutes.toString().padStart(2, "0");
    }

    const EVENT_GROUP_KEYS = ["weather", "non_weather", "administrative", "national", "unimplemented", "nws_misc"];

    const WEATHER_EVENT_KEYWORDS = [
        "BLIZZARD", "COASTAL FLOOD", "DUST STORM", "EXTREME WIND", "FLASH FLOOD", "FLOOD",
        "HIGH WIND", "HURRICANE", "SEVERE THUNDERSTORM", "SEVERE WEATHER", "SNOW SQUALL",
        "SPECIAL MARINE", "SPECIAL WEATHER", "STORM SURGE", "TORNADO", "TROPICAL STORM", "TSUNAMI", "WINTER STORM"
    ];

    const NON_WEATHER_EVENT_KEYWORDS = [
        "AVALANCHE", "BLUE ALERT", "CHILD ABDUCTION", "CIVIL DANGER", "CIVIL EMERGENCY",
        "EARTHQUAKE", "IMMEDIATE EVACUATION", "FIRE WARNING", "HAZARDOUS MATERIALS",
        "LAW ENFORCEMENT", "LOCAL AREA EMERGENCY", "MISSING AND ENDANGERED",
        "911 TELEPHONE OUTAGE", "NUCLEAR PLANT", "RADIOLOGICAL HAZARD", "SHELTER IN PLACE", "VOLCANO WARNING"
    ];

    const ADMIN_EVENT_KEYWORDS = ["ADMINISTRATIVE MESSAGE", "PRACTICE/DEMO", "REQUIRED WEEKLY TEST", "REQUIRED MONTHLY TEST", "NETWORK MESSAGE"];

    const NATIONAL_EVENT_KEYWORDS = ["EMERGENCY ACTION", "NATIONAL ", "INFORMATION CENTER"];

    const UNIMPLEMENTED_EVENT_KEYWORDS = ["INDUSTRIAL FIRE", "WILD FIRE WARNING", "DUST STORM WATCH", "CIVIL DANGER WATCH", "RADIOLOGICAL HAZARD WATCH", "HAZARDOUS MATERIALS WATCH", "EARTHQUAKE WATCH", "NUCLEAR PLANT TEST", "IMMEDIATE EVACUATION WARNING"];

    saveb.addEventListener("click", saveToWav);

    function hasAnyEventKeyword(labelUpper, keywords) {
        for (let i = 0; i < keywords.length; i++) {
            if (labelUpper.includes(keywords[i])) {
                return true;
            }
        }
        return false;
    }

    function normalizeEventLabel(description, code) {
        const text = (description || '').toString().trim();
        if (!text) return code;
        return text.replace(/^(?:a|an)\s+/i, '').trim();
    }

    function getEventGroupKey(code, labelUpper) {
        if ((code || '').startsWith('TX') || labelUpper.includes('TRANSMITTER')) {
            return "nws_misc";
        }
        if (hasAnyEventKeyword(labelUpper, UNIMPLEMENTED_EVENT_KEYWORDS)) {
            return "unimplemented";
        }
        if (hasAnyEventKeyword(labelUpper, NATIONAL_EVENT_KEYWORDS)) {
            return "national";
        }
        if (hasAnyEventKeyword(labelUpper, ADMIN_EVENT_KEYWORDS)) {
            return "administrative";
        }
        if (hasAnyEventKeyword(labelUpper, WEATHER_EVENT_KEYWORDS)) {
            return "weather";
        }
        if (hasAnyEventKeyword(labelUpper, NON_WEATHER_EVENT_KEYWORDS)) {
            return "non_weather";
        }
        return "unimplemented";
    }

    function populateEventOptions(selectElement, sameEvents) {
        if (!selectElement || !sameEvents || typeof sameEvents !== 'object') {
            return;
        }

        const groupElements = {};
        const fragments = {};
        const optgroups = selectElement.querySelectorAll('optgroup[data-event-group]');
        for (let i = 0; i < optgroups.length; i++) {
            const groupElement = optgroups[i];
            const key = groupElement.getAttribute('data-event-group');
            if (!key) continue;
            groupElements[key] = groupElement;
            groupElement.innerHTML = '';
        }
        for (let i = 0; i < EVENT_GROUP_KEYS.length; i++) {
            fragments[EVENT_GROUP_KEYS[i]] = document.createDocumentFragment();
        }

        const eventEntries = Object.entries(sameEvents)
            .filter(([code]) => /^[A-Z0-9]{3}$/.test(code) || /^\?\?[A-Z]$/.test(code))
            .map(([code, description]) => {
                const label = normalizeEventLabel(description, code);
                return { code, label, sortKey: label.toUpperCase() };
            })
            .sort((a, b) => {
                if (a.sortKey < b.sortKey) return -1;
                if (a.sortKey > b.sortKey) return 1;
                return a.code.localeCompare(b.code);
            });

        for (let i = 0; i < eventEntries.length; i++) {
            const eventEntry = eventEntries[i];
            const groupKey = getEventGroupKey(eventEntry.code, eventEntry.sortKey);
            const option = document.createElement('option');
            option.value = eventEntry.code;
            option.textContent = eventEntry.label;
            (fragments[groupKey] || fragments.unimplemented).appendChild(option);
        }

        for (let i = 0; i < EVENT_GROUP_KEYS.length; i++) {
            const key = EVENT_GROUP_KEYS[i];
            if (groupElements[key]) {
                groupElements[key].appendChild(fragments[key]);
            }
        }

        const preferredDefault = selectElement.querySelector('option[value="TOR"]');
        if (preferredDefault) {
            selectElement.value = "TOR";
            return;
        }

        const firstOption = selectElement.querySelector('option');
        if (firstOption) {
            selectElement.value = firstOption.value;
        }
    }

    populateEventOptions(events, window.sameEvents);
    var NWR = 1;
    var hr = 0;
    window.locations = ["036071"];
    var locations = window.locations;
    var es = false;
    var em = false;
    var cl = false;
    var tone = NWR;
    var tlen = 10;
    let startTime = null;
    let showTime = localStorage["showTime"];
    let lastValidTimeselectValue = "";
    const TIMSELECT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

    function isTimeselectValueValid(value) {
        if (!value) { return false; }
        const match = TIMSELECT_PATTERN.exec(value.trim());
        if (!match) { return false; }
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        const day = parseInt(match[3], 10);
        const hour = parseInt(match[4], 10);
        const minute = parseInt(match[5], 10);
        if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) { return false; }
        const candidate = new Date(year, month - 1, day, hour, minute, 0, 0);
        return candidate.getFullYear() === year &&
            candidate.getMonth() === month - 1 &&
            candidate.getDate() === day &&
            candidate.getHours() === hour &&
            candidate.getMinutes() === minute;
    }

    function guardTimeselectValue(showAlert = true) {
        const value = timeselect.value;
        if (isTimeselectValueValid(value)) {
            lastValidTimeselectValue = value.trim();
            return true;
        }
        if (showAlert) {
            alert("Invalid date/time. Please enter a valid calendar date.");
        }
        if (lastValidTimeselectValue) {
            timeselect.value = lastValidTimeselectValue;
        } else {
            stime();
        }
        return false;
    }

    function stime() {
        const currentValue = getLocalDT(new Date());
        timeselect.value = currentValue;
        lastValidTimeselectValue = currentValue;
        updateHeaderPreview();
    }

    stime();

    function updateVoiceOptions(t) {
        const selectedVoice = t.value;
        const selectedBackend = Object.keys(voiceBackendMap).find(backend => voiceBackendMap[backend].includes(selectedVoice)) || "Unknown";
        window.ttsVoice = (selectedVoice || '').trim();
        const overrideTZElements = document.getElementsByClassName('overrideTZ');
        const ttsRatePitchControls = document.getElementById('ttsRatePitchControls');

        if (selectedVoice === 'EMNet') {
            for (let i = 0; i < overrideTZElements.length; i++) {
                overrideTZElements[i].style.display = 'inline-block';
            }
        }

        else {
            for (let i = 0; i < overrideTZElements.length; i++) {
                overrideTZElements[i].style.display = 'none';
            }
        }

        if (selectedBackend.toLowerCase().includes("bal") || selectedBackend.toLowerCase().includes("vt")) {
            ttsRatePitchControls.style.display = 'block';
        }

        else {
            ttsRatePitchControls.style.display = 'none';
        }

        if (selectedBackend.toLowerCase().includes("spfy") || /Speechify/i.test(window.ttsVoice)) {
            document.getElementById('shouldBitcrushSpeechifyContainer').style.display = 'block';
        }

        else {
            document.getElementById('shouldBitcrushSpeechifyContainer').style.display = 'none';
        }
    }

    hrselect.addEventListener("change", function () {
        var parsedHr = parseInt(hrselect.value, 10);
        if (!Number.isFinite(parsedHr)) {
            parsedHr = 0;
            setSelectNumericValue(hrselect, 0);
        }
        hr = parsedHr;
        var previousMin = readSelectInt(minselect, 0);
        minselect.innerHTML = "";
        var nodes = getMinNodes();
        nodes.forEach(e => { minselect.appendChild(e); });
        if (!setSelectNumericValue(minselect, previousMin) && minselect.options.length) {
            minselect.value = minselect.options[0].value;
        }
    });


    window.ttsText = (document.getElementById('ttsText')?.value || '').trim();
    window.ttsVoice = (document.getElementById('ttsVoice')?.value || '').trim();

    const audioPlayback = document.getElementById("audioPlayback");
    ensureLegacyDigitalModeOption();

    let encoderMode = document.getElementById("encoderMode").value;
    let event = document.getElementById("events").value;
    let originator = document.getElementById("originators").value;
    let hour = document.getElementById("hr").value
    let minute = document.getElementById("min").value;
    let senderid = document.getElementById("par").value;
    let locationsList = locations.slice();
    let attentionTone = document.getElementById("att").value;
    let attentionToneDuration = document.getElementById("tlen").value;
    let announcementType = document.getElementById("announcementType").value;
    let overrideTZ = document.getElementById("useOverrideTZ")?.value || '';
    let ttsText = (document.getElementById('ttsText')?.value || '').trim();
    let ttsVoice = (document.getElementById('ttsVoice')?.value || '').trim();
    let rawInput = (document.getElementById("cheader")?.value || '').trim();
    let clipSignal = document.getElementById("clip").checked;
    let endecResample = shouldEmulateEndecRate();
    let overallEndecMode = document.getElementById("overallEndecMode").value;

    async function generateEas() {
        encoderMode = document.getElementById("encoderMode").value;
        let eventCode = document.getElementById("events").value;
        let originatorCode = document.getElementById("originators").value;
        hour = document.getElementById("hr").value;
        minute = readSelectInt(minselect, 0).toString().padStart(2, "0");
        senderid = document.getElementById("par").value;
        locationsList = locations.slice();
        attentionTone = document.getElementById("att").value;
        attentionToneDuration = document.getElementById("tlen").value;
        announcementType = document.getElementById("announcementType").value;
        overrideTZ = document.getElementById("useOverrideTZ")?.value || '';
        ttsText = (document.getElementById('ttsText')?.value || '').trim();
        ttsVoice = (document.getElementById('ttsVoice')?.value || '').trim();
        rawInput = (document.getElementById("cheader")?.value || '').trim();
        clipSignal = document.getElementById("clip").checked;
        endecResample = shouldEmulateEndecRate();
        overallEndecMode = document.getElementById("overallEndecMode").value;

        localStorage.setItem("eas-tools-encoder-settings", JSON.stringify({
            'encoderMode': encoderMode,
            'events': eventCode,
            'originators': originatorCode,
            'hr': hour,
            'min': minute,
            'par': senderid,
            'locs': locationsList,
            'att': attentionTone,
            'tlen': attentionToneDuration,
            'overallEndecMode': overallEndecMode,
            'announcementType': announcementType,
            'useOverrideTZ': overrideTZ,
            'ttsText': ttsText,
            'ttsVoice': ttsVoice,
            'ttsRate': ttsRate?.value || '0',
            'ttsPitch': ttsPitch?.value || '0',
            'cheader': rawInput,
            'clip': clipSignal,
            'endecResample': endecResample,
            'enable-vmify-custom': document.getElementById('enable-vmify-custom')?.checked || false,
            'vmify-custom-intensity': document.getElementById('vmify-custom-intensity')?.value || '1'
        }));

        samples = [];
        startTime = performance.now();
        cl = clipSignal;

        var par = parinput.value;
        if (par.length < 8) {
            var neededPadding = 8 - par.length;
            par += " ".repeat(neededPadding);
        }
        if (locations.length < 1) { addStatus("There must be at least one location!", "ERROR"); return; }

        if (!guardTimeselectValue()) { return; }

        var time = new Date(timeselect.value);
        var originator = originators.value;
        var event = events.value;
        tlen = parseInt(tl.value);
        var l = getDurationCode();
        if (!/^\d{4}$/.test(l)) {
            addStatus("Invalid purge time selection, please re-select the duration!", "ERROR");
            return;
        }
        tone = parseInt(att.value);
        var usesCustomHeader = (window.useCustom && window.mode === "header");

        if (!rawinput.value && usesCustomHeader) {
            alert("ZCZC header cannot be empty!");
            return;
        }

        else if (!checkZCZCIsValid(rawinput.value) && usesCustomHeader) {
            alert("Invalid ZCZC header format!");
            return;
        }

        const useOverrideTZ = (document.getElementById('useOverrideTZ')?.value || '').trim();
        const header = create_header_string(originator, event, locations, l, time, par);

        if (!window.ttsText && window.ttsVoice !== "EMNet" && window.announcementType === "tts") {
            alert("TTS text is required.");
            return;
        }

        const allowCustomAudio = window.announcementType === "custom";
        await create_alert_async(usesCustomHeader ? rawinput.value : header, useOverrideTZ, { allowCustomAudio }).catch((error) => {
            console.error("Error generating alert:", error);
            addStatus("Error generating alert: " + error.message, "ERROR");
            throw error;
        });

        var elapsedMs = performance.now() - startTime;
        var minutes = Math.floor(elapsedMs / 60000);
        var seconds = Math.floor((elapsedMs % 60000) / 1000);
        var hundredths = Math.floor((elapsedMs % 1000) / 10);
        var timeTaken = ", Time taken to generate: " + (minutes.toString().padStart(2, "0") === "00" ? "" : minutes.toString().padStart(2, "0") + ":") + seconds.toString().padStart(2, "0") + "." + hundredths.toString().padStart(2, "0") + (minutes.toString().padStart(2, "0") !== "00" ? "m" : "s");

        saveb.style.display = "inline-block";
        addStatus("EAS Generated! Samples: " + samples.length.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (showTime ? timeTaken : ""));
        addStatus("Generated header: <br class=\"mobileBreak\"><pre class=\"generatedHeader\">" + ((window.useCustom && window.mode === "header") ? rawinput.value : header) + "</pre>");

        const playbackElement = audioPlayback ?? (() => {
            const el = document.createElement("audio");
            el.id = "audioPlayback";
            document.querySelector(".control-panel")?.appendChild(el);
            return el;
        })();

        if (playbackElement.dataset.objectUrl) {
            URL.revokeObjectURL(playbackElement.dataset.objectUrl);
        }

        wav.fromScratch(1, SAMPLE_RATE, '32', samples.map(e => {
            return e * (2147483647 / 2);
        }));
        const wavBuffer = wav.toBuffer().buffer;
        const wavBlob = new Blob([new DataView(wavBuffer)], { type: 'audio/wav' });
        const wavUrl = URL.createObjectURL(wavBlob);
        playbackElement.dataset.objectUrl = wavUrl;
        playbackElement.setAttribute("src", wavUrl);
        playbackElement.src = wavUrl;
        playbackElement.style.display = "block";
        playbackElement.style.visibility = "visible";
        playbackElement.controls = true;
        playbackElement.autoplay = false;
        playbackElement.load();
    }

    function addStatus(stat, type = "LOG") {
        var new_status = document.createElement("div");
        var d = new Date();
        new_status.innerHTML = zero_pad_int(d.getHours().toString() % 12 || 12, 2) + ":" + zero_pad_int(d.getMinutes().toString(), 2) + ":" + zero_pad_int(d.getSeconds().toString(), 2) + " " + (d.getHours() >= 12 ? "PM" : "AM") + " [" + type + "]: " + stat;
        statuselem.appendChild(new_status);
        clr.style.display = "inline-block";
    }

    function resetStatus() {
        statuselem.innerHTML = "";
        clr.disabled = true;
    }

    let __voiceDownloadUI = null;
    let __voiceDownloadPct = -1;
    function ensureVoiceDownloadUI() {
        if (__voiceDownloadUI || !statuselem) return __voiceDownloadUI;
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:none;margin:4px 0";
        const label = document.createElement("div");
        label.style.cssText = "font-size:0.9em;opacity:0.85;margin-bottom:2px";
        const track = document.createElement("div");
        track.style.cssText = "height:6px;background:#333;border-radius:3px;overflow:hidden";
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-label", "Voice download progress");
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", "100");
        track.setAttribute("aria-valuenow", "0");
        track.setAttribute("aria-valuetext", "0%");
        const bar = document.createElement("div");
        bar.style.cssText = "height:100%;width:0%;background:#7ae37a;transition:width .1s linear";
        track.appendChild(bar);
        wrap.appendChild(label);
        wrap.appendChild(track);
        statuselem.appendChild(wrap);
        __voiceDownloadUI = { wrap, label, track, bar };
        return __voiceDownloadUI;
    }

    function setVoiceDownloadProgress(progress) {
        const ui = ensureVoiceDownloadUI();
        if (!ui) return;
        if (!progress) {
            ui.wrap.style.display = "none";
            __voiceDownloadPct = -1;
            return;
        }
        if (statuselem.lastChild !== ui.wrap) statuselem.appendChild(ui.wrap);
        const mb = (n) => (n / 1048576).toFixed(1);
        const frac = progress.total ? Math.min(1, progress.loaded / progress.total) : 0;
        const pct = Math.round(frac * 100);
        ui.wrap.style.display = "block";
        ui.bar.style.width = pct + "%";
        ui.label.textContent = progress.total
            ? `Downloading ${progress.label} (${mb(progress.loaded)} / ${mb(progress.total)} MB)`
            : `Downloading ${progress.label}...`;
        if (pct !== __voiceDownloadPct) {
            __voiceDownloadPct = pct;
            ui.track.setAttribute("aria-valuenow", String(pct));
            ui.track.setAttribute("aria-valuetext", pct + "%");
        }
        clr.style.display = "inline-block";
    }

    function normalizeFipsCode(code, fallbackSubdiv) {
        if (!code) return "";
        const digits = code.toString().replace(/\D/g, "");

        if (fipsModeSelect && fipsModeSelect.value === "ca") {
            let subdiv, caCode;
            if (digits.length === 6) {
                subdiv = digits.charAt(0);
                caCode = digits.slice(1);
            } else if (digits.length === 5) {
                subdiv = fallbackSubdiv;
                caCode = digits;
            } else {
                return "";
            }
            if (rgn[subdiv] === undefined || !canadaCounty[caCode]) return "";
            return subdiv + caCode;
        }

        let subdiv = "";
        let st = "";
        let co = "";

        if (digits.length === 6) {
            subdiv = digits.charAt(0);
            st = digits.slice(1, 3);
            co = digits.slice(3, 6);
        } else if (digits.length === 5) {
            subdiv = fallbackSubdiv;
            st = digits.slice(0, 2);
            co = digits.slice(2, 5);
        } else {
            return "";
        }

        const countyForState = county[st];
        if (rgn[subdiv] === undefined || !countyForState || countyForState[co] === undefined) {
            return "";
        }

        return subdiv + st + co;
    }

    function addLoc() {
        const fallbackSubdiv = (regionselect?.value || "0").toString().charAt(0) || "0";
        const manualInput = (fipsinput?.value || "").trim();
        const rawCodes = manualInput
            ? manualInput.split("-").map(code => code.trim()).filter(Boolean)
            : [(regionselect.value || "").toString() + (stateselect.value || "").toString() + (countyselect.value || "").toString()];
        const existing = new Set(locations);
        const invalid = [];
        let addedCount = 0;
        let duplicateCount = 0;

        for (let i = 0; i < rawCodes.length; i++) {
            const normalized = normalizeFipsCode(rawCodes[i], fallbackSubdiv);
            if (!normalized) {
                invalid.push(rawCodes[i]);
                continue;
            }
            if (existing.has(normalized)) {
                duplicateCount++;
                continue;
            }
            existing.add(normalized);
            locations.push(normalized);
            addedCount++;
        }

        if (addedCount > 0) {
            updateTable();
        }

        if (addedCount === 0 && duplicateCount > 0 && invalid.length === 0) {
            addStatus("You can't add the same location code twice!");
            return;
        }

        if (invalid.length) {
            addStatus("Skipped invalid FIPS code(s): " + invalid.join(", "), "ERROR");
        }

        if (duplicateCount > 0 && addedCount > 0) {
            addStatus("Skipped duplicate FIPS code(s): " + duplicateCount.toString(), "WARN");
        }
    }

    function updateTable() {
        var fcont = document.getElementById("container");
        var fipstable = document.getElementById("fips");
        locations = window.locations;
        fcont.innerHTML = "";
        const isCA = fipsModeSelect && fipsModeSelect.value === "ca";
        for (var i = 0; i < locations.length; i++) {
            var tr = document.createElement("tr");
            var c = document.createElement("td");
            var s = document.createElement("td");
            var l = document.createElement("td");
            var r = document.createElement("td");
            c.innerText = locations[i];
            if (isCA) {
                const caCode = locations[i].slice(1);
                l.innerText = canadaCounty[caCode] || locations[i];
                const provDigit = caCode.charAt(0);
                s.innerText = caProvinces[provDigit] || "Unknown";
                var re = locations[i].charAt(0);
                r.innerText = rgn[re] || re;
            } else {
                var st = locations[i].slice(1, 3);
                var co = locations[i].slice(3, 6);
                var re = locations[i].charAt(0);
                l.innerText = (county[st] && county[st][co]) || locations[i];
                if (co == "000" && st !== "00") { l.innerText = "Entire State"; }
                r.innerText = rgn[re] || re; s.innerText = state[st] || st;
            }
            tr.appendChild(l); tr.appendChild(s); tr.appendChild(r); tr.appendChild(c);
            tr.setAttribute("class", "entry");
            tr.setAttribute("data-val", i.toString());
            tr.addEventListener("click", function (e) { locations.splice(parseInt(e.srcElement.parentElement.getAttribute("data-val")), 1); updateTable(); });
            fcont.appendChild(tr);
        }
        if (typeof updateHeaderPreview === "function") updateHeaderPreview();
    }
    updateTable();

    const stateLabel = document.querySelector('label[for="stateselect"]');
    const countyLabel = document.querySelector('label[for="countyselect"]');
    const regionLabel = document.querySelector('label[for="rgselect"]');
    const fipsTableHeaders = document.querySelectorAll('#fips tr.title td');

    function updateCounties(stateCode) {
        countyselect.innerHTML = "";
        if (stateCode !== "00") {
            let entState = document.createElement("option");
            entState.value = "000";
            entState.innerText = "Entire State";
            countyselect.appendChild(entState);
        }
        Object.keys(county[stateCode]).sort().forEach(e => {
            var option = document.createElement("option");
            option.innerHTML = county[stateCode][e];
            option.setAttribute("value", e);
            countyselect.appendChild(option);
        });
    }

    function updateCALocations(provDigit) {
        countyselect.innerHTML = "";
        const locs = caLocationsByProvince[provDigit] || {};
        if (locs["0000"]) {
            let entProv = document.createElement("option");
            entProv.value = "0000";
            entProv.innerText = "Entire Province";
            countyselect.appendChild(entProv);
        }
        Object.keys(locs).sort().forEach(e => {
            if (e === "0000") return;
            var option = document.createElement("option");
            option.innerHTML = locs[e];
            option.setAttribute("value", e);
            countyselect.appendChild(option);
        });
    }

    function populateUSSelectors() {
        stateselect.innerHTML = "";
        Object.keys(state).sort().forEach(e => {
            var option = document.createElement("option");
            option.innerHTML = state[e];
            option.setAttribute("value", e);
            stateselect.appendChild(option);
        });
        updateCounties("00");

        regionselect.innerHTML = "";
        Object.keys(rgn).sort().forEach(e => {
            var option = document.createElement("option");
            option.innerHTML = rgn[e];
            option.setAttribute("value", e);
            regionselect.appendChild(option);
        });
        if (stateLabel) stateLabel.textContent = "State:\u00a0";
        if (countyLabel) countyLabel.textContent = "County:";
        if (fipsTableHeaders.length >= 2) {
            fipsTableHeaders[0].textContent = "County";
            fipsTableHeaders[1].textContent = "State";
        }
    }

    function populateCASelectors() {
        stateselect.innerHTML = "";
        Object.keys(caProvinces).sort().forEach(e => {
            var option = document.createElement("option");
            option.innerHTML = caProvinces[e];
            option.setAttribute("value", e);
            stateselect.appendChild(option);
        });
        updateCALocations(Object.keys(caProvinces).sort()[0] || "0");

        if (stateLabel) stateLabel.textContent = "Province:\u00a0";
        if (countyLabel) countyLabel.textContent = "Location:";
        if (fipsTableHeaders.length >= 2) {
            fipsTableHeaders[0].textContent = "Location";
            fipsTableHeaders[1].textContent = "Province";
        }
    }

    stateselect.addEventListener("change", function () {
        if (fipsModeSelect && fipsModeSelect.value === "ca") {
            updateCALocations(stateselect.value);
        } else {
            updateCounties(stateselect.value);
        }
    });

    if (fipsModeSelect) {
        const wxrOption = originators ? originators.querySelector('option[value="WXR"]') : null;
        fipsModeSelect.addEventListener("change", function () {
            locations.length = 0;
            updateTable();
            if (fipsModeSelect.value === "ca") {
                populateCASelectors();
                if (wxrOption) wxrOption.textContent = "Environment Canada";
            } else {
                populateUSSelectors();
                if (wxrOption) wxrOption.textContent = "National Weather Service";
            }
        });
    }

    populateUSSelectors();

    function parseSameHeaderParam(rawHeader) {
        if (!rawHeader) {
            return null;
        }

        const sanitized = rawHeader.replace(/[ -]/g, '').toUpperCase();

        const match = sanitized.match(/ZCZC-[^\s]*/);

        if (!match) {
            return null;
        }

        const line = match[0];
        const segments = line.split('-').filter(Boolean);

        if (segments.length < 5) {
            return null;
        }

        const origin = segments[1];
        const eventCode = segments[2];
        const locationsList = [];
        let durationText = null;
        let index = 3;

        for (; index < segments.length; index++) {
            const segment = segments[index];
            if (!segment) {
                continue;
            }

            if (segment.startsWith('+')) {
                durationText = segment.slice(1);
                break;
            }

            if (segment.includes('+')) {
                const parts = segment.split('+');
                if (parts[0]) {
                    locationsList.push(parts[0]);
                }
                durationText = parts[1] || '';
                break;
            }

            locationsList.push(segment);
        }

        if (durationText == null) {
            return null;
        }

        const issue = segments[index + 1] || '';
        const station = segments[index + 2] || '';

        return {
            origin,
            event: eventCode,
            locations: locationsList,
            duration: durationText,
            issue,
            station
        };
    }

    function applyHeaderDetails(parsed) {
        if (!parsed) {
            return;
        }

        const { origin, event: eventCode, locations: locationList, duration, issue, station } = parsed;

        if (originators && origin) {
            const originOption = Array.from(originators.options || []).find(opt => opt.value === origin);
            if (originOption) {
                originators.value = origin;
            }
        }

        if (events && eventCode) {
            const eventOption = Array.from(events.options || []).find(opt => opt.value === eventCode);
            if (eventOption) {
                events.value = eventCode;
            }
        }

        if (Array.isArray(locationList) && locationList.length) {
            const validLocations = locationList.filter(code => /^\d{6}$/.test(code));
            if (validLocations.length) {
                locations.length = 0;
                validLocations.forEach(code => locations.push(code));
                updateTable();
            }
        }

        if (typeof duration === 'string' && /^\d{4}$/.test(duration) && hrselect && minselect) {
            let hours = parseInt(duration.slice(0, 2), 10);
            let mins = parseInt(duration.slice(2, 4), 10);
            if (Number.isFinite(hours) && Number.isFinite(mins)) {
                const hrValues = Array.from(hrselect.options || []).map(opt => parseInt(opt.value, 10)).filter(num => !Number.isNaN(num));
                if (hrValues.length) {
                    const maxHr = Math.max.apply(null, hrValues);
                    hours = Math.min(Math.max(hours, 0), maxHr);
                    hr = hours;
                    setSelectNumericValue(hrselect, hours);
                    hrselect.dispatchEvent(new Event('change'));
                    const validMins = Array.from(minselect.options || []).map(opt => parseInt(opt.value, 10)).filter(num => !Number.isNaN(num));
                    if (validMins.length) {
                        let closest = validMins[0];
                        for (const vm of validMins) {
                            if (Math.abs(vm - mins) < Math.abs(closest - mins)) {
                                closest = vm;
                            }
                        }
                        setSelectNumericValue(minselect, closest);
                    }
                }
            }
        }

        if (issue && /^\d{7}$/.test(issue) && timeselect) {
            const dayOfYear = parseInt(issue.slice(0, 3), 10);
            const hour = parseInt(issue.slice(3, 5), 10);
            const minute = parseInt(issue.slice(5, 7), 10);
            if (dayOfYear >= 1 && dayOfYear <= 366 && hour < 24 && minute < 60) {
                const currentUTCYear = new Date().getUTCFullYear();
                const base = new Date(Date.UTC(currentUTCYear, 0, 1, 0, 0, 0));
                base.setUTCDate(dayOfYear);
                base.setUTCHours(hour, minute, 0, 0);
                timeselect.value = getLocalDT(base);
                lastValidTimeselectValue = timeselect.value;
                updateHeaderPreview();
            }
        }

        if (station && parinput) {
            const cleanedStation = station.toUpperCase();
            if (cleanedStation.length === 8) {
                parinput.value = cleanedStation;
            }
            else {
                parinput.value = cleanedStation.padEnd(8, " ");
            }
        }
    }

    const params = new URLSearchParams(window.location.search);
    const headerParam = params.get("header");
    if (headerParam) {
        const trimmedHeader = headerParam.trim();
        const encoderModeSelect = document.getElementById("encoderMode");

        if (encoderModeSelect) {
            encoderModeSelect.value = "header";
        }

        window.useCustom = true;
        const headerField = document.querySelector("#cheader");

        if (headerField) {
            headerField.value = trimmedHeader;
        }

        const parsedHeader = parseSameHeaderParam(trimmedHeader);
        if (parsedHeader) {
            applyHeaderDetails(parsedHeader);
        }

        else {
            addStatus("Unable to parse SAME header from query string.", "WARN");
        }
    }

    const nowButton = document.querySelector('[data-encoder-now]');
    if (nowButton) {
        nowButton.addEventListener('click', () => stime());
    }

    const addLocButton = document.querySelector('[data-encoder-add-loc]');
    if (addLocButton) {
        addLocButton.addEventListener('click', () => addLoc());
    }

    const generateButton = document.querySelector('[data-encoder-generate]');
    if (generateButton) {
        generateButton.addEventListener('click', () => generateEas());
    }

    const clearButton = document.querySelector('[data-encoder-clear]');
    if (clearButton) {
        clearButton.addEventListener('click', () => resetStatus());
    }

    const voiceSelect = document.getElementById('ttsVoice');
    if (voiceSelect) {
        voiceSelect.addEventListener('change', (event) => updateVoiceOptions(event.target));
    }

    const ttsTextInput = document.getElementById('ttsText');
    if (ttsTextInput) {
        ttsTextInput.addEventListener('change', (event) => window.ttsText = event.target.value.trim());
    }

    const encoderModeSelect = document.getElementById("encoderMode");
    const announcementTypeSelect = document.getElementById("announcementType");
    const customHeader = document.getElementById("customEncoder");
    const stringEncoder = document.getElementById("stringEncoder");
    const ttsOuterDiv = document.getElementById("tts");
    const customAnnouncementDiv = document.getElementById("customAudioDiv");
    const transferButton = document.querySelector('[data-encoder-transfer]');

    if (transferButton) {
        transferButton.addEventListener('click', () => {
            const cheader = document.getElementById("cheader").value;
            const parsedHeader = parseSameHeaderParam(cheader);
            if (parsedHeader) {
                applyHeaderDetails(parsedHeader);
            }
            encoderModeSelect.value = "builder";
            encoderModeSelect.dispatchEvent(new Event('change'));
        });
    }

    await getVoiceList();

    if (!headerParam) {
        localStorage.getItem("eas-tools-encoder-settings") && (() => {
            try {
                const savedSettings = JSON.parse(localStorage.getItem("eas-tools-encoder-settings"));
                for (const [key, value] of Object.entries(savedSettings)) {
                    if (key === 'locs' && Array.isArray(value)) {
                        locations.length = 0;
                        value.forEach(loc => locations.push(loc));
                        updateTable();
                        continue;
                    }
                    else {
                        const element = document.getElementById(key);
                        if (element) {
                            if (element.tagName === "SELECT") {
                                const stringValue = String(value);
                                if (selectHasValue(element, stringValue)) {
                                    element.value = stringValue;
                                } else {
                                    setSelectNumericValue(element, stringValue);
                                }
                            } else if (element.tagName === "INPUT") {
                                if (element.type === "checkbox") {
                                    element.checked = value;
                                } else {
                                    element.value = value;
                                }
                            } else if (element.tagName === "TEXTAREA") {
                                element.value = value;
                            }
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to load encoder settings:", error);
            }
        })();

        addStatus("Loaded saved encoder settings!");
    }

    encoderModeSelect.addEventListener("change", function () {
        window.mode = encoderModeSelect.value;

        if (window.mode === "builder") {
            customHeader.style.display = "block";
            stringEncoder.style.display = "none";
            window.useCustom = false;
        }

        else {
            customHeader.style.display = "none";
            stringEncoder.style.display = "block";
            window.useCustom = true;
        }
    });

    announcementTypeSelect.addEventListener("change", function () {
        window.announcementType = announcementTypeSelect.value;

        if (window.announcementType === "tts") {
            ttsOuterDiv.style.display = "block";
            customAnnouncementDiv.style.display = "none";
        }

        else if (window.announcementType === "custom") {
            ttsOuterDiv.style.display = "none";
            customAnnouncementDiv.style.display = "block";
        }

        else {
            ttsOuterDiv.style.display = "none";
            customAnnouncementDiv.style.display = "none";
        }
    });

    const enableVmifyCustomCheckbox = document.getElementById("enable-vmify-custom");
    const vmifyCustomOptions = document.getElementById("vmifyCustomOptions");
    const vmifyCustomIntensityInput = document.getElementById("vmify-custom-intensity");

    const syncVmifyCustomUi = () => {
        if (!enableVmifyCustomCheckbox || !vmifyCustomOptions) return;
        vmifyCustomOptions.style.display = enableVmifyCustomCheckbox.checked ? "block" : "none";
    };

    if (enableVmifyCustomCheckbox) {
        syncVmifyCustomUi();
        enableVmifyCustomCheckbox.addEventListener("change", syncVmifyCustomUi);
    }

    if (vmifyCustomIntensityInput) {
        vmifyCustomIntensityInput.addEventListener("change", () => {
            const intensity = parseFloat(vmifyCustomIntensityInput.value);
            if (Number.isNaN(intensity) || intensity < 0 || intensity > 3) {
                vmifyCustomIntensityInput.value = "1";
            }
        });
    }

    const ttsRate = document.getElementById("ttsRate");
    const ttsRateReset = document.getElementById("ttsRateReset");
    ttsRateReset.addEventListener("click", function () {
        ttsRate.value = "0";
        ttsRate.dispatchEvent(new Event('change'));
    });
    const ttsPitch = document.getElementById("ttsPitch");
    const ttsPitchReset = document.getElementById("ttsPitchReset");
    ttsPitchReset.addEventListener("click", function () {
        ttsPitch.value = "0";
        ttsPitch.dispatchEvent(new Event('change'));
    });

    const syncTtsSlider = (element, spanId) => {
        const valueSpan = document.getElementById(spanId);
        valueSpan.textContent = element.value;
    };

    ["input", "change"].forEach((evtName) => {
        ttsRate.addEventListener(evtName, function () {
            syncTtsSlider(ttsRate, "ttsRateValue");
        });

        ttsPitch.addEventListener(evtName, function () {
            syncTtsSlider(ttsPitch, "ttsPitchValue");
        });
    });

    const attentionToneDiv = document.getElementById("tlenContainer");
    const currentAttentionTone = document.getElementById("att");
    const attentionToneDurationSettable = ["0", "1"];

    currentAttentionTone.addEventListener("change", function () {
        if (currentAttentionTone.value && attentionToneDurationSettable.includes(currentAttentionTone.value)) {
            attentionToneDiv.style.display = "inline";
        } else {
            attentionToneDiv.style.display = "none";
        }
    });

    const endecModeSelect = document.getElementById("overallEndecMode");

    let endecModeInitializing = true;

    endecModeSelect.addEventListener("change", function () {
        if (endecModeSelect.value.includes("NWS")) {
            tone = 1;

            if (!endecModeInitializing && currentAttentionTone) {
                currentAttentionTone.value = "1";
            }
        }

        else {
            tone = 0;

            if (!endecModeInitializing && currentAttentionTone) {
                currentAttentionTone.value = "0";
            }
        }
    });

    const changeEvent = new Event('change');

    currentAttentionTone.dispatchEvent(changeEvent);
    endecModeSelect.dispatchEvent(changeEvent);
    endecModeInitializing = false;
    currentAttentionTone.dispatchEvent(changeEvent);
    encoderModeSelect.dispatchEvent(changeEvent);
    announcementTypeSelect.dispatchEvent(changeEvent);
    ttsTextInput.dispatchEvent(changeEvent);
    voiceSelect.dispatchEvent(changeEvent);
    ttsRate.dispatchEvent(changeEvent);
    ttsPitch.dispatchEvent(changeEvent);
    hrselect.dispatchEvent(changeEvent);

    const clearAllLocationsButton = document.querySelector('[data-encoder-clear-locs]');
    if (clearAllLocationsButton) {
        clearAllLocationsButton.addEventListener('click', () => {
            if (confirm("Are you sure you want to clear all location codes?")) {
                locations.length = 0;
                updateTable();
            }
        });
    }

    function updateHeaderPreview() {
        const headerPreviewElem = document.getElementById("headerPreview");
        if (!headerPreviewElem) return;
        if (window.mode === "header") {
            headerPreviewElem.textContent = "";
            return;
        }
        if (locations.length < 1) {
            headerPreviewElem.textContent = "";
            return;
        }
        if (!isTimeselectValueValid(timeselect.value)) {
            headerPreviewElem.textContent = "";
            return;
        }
        var par = parinput.value;
        if (par.length < 8) {
            par += " ".repeat(8 - par.length);
        }
        var l = getDurationCode();
        var time = new Date(timeselect.value);
        headerPreviewElem.textContent = create_header_string(originators.value, events.value, locations, l, time, par);
    }

    minselect.addEventListener("change", function () {
        if (!Number.isFinite(parseInt(minselect.value, 10)) && minselect.options.length) {
            minselect.value = minselect.options[0].value;
        }
    });

    events.addEventListener("change", updateHeaderPreview);
    originators.addEventListener("change", updateHeaderPreview);
    minselect.addEventListener("change", updateHeaderPreview);
    parinput.addEventListener("input", updateHeaderPreview);
    timeselect.addEventListener("change", updateHeaderPreview);
    hrselect.addEventListener("change", updateHeaderPreview);

    updateHeaderPreview();

    const noaaProductToFips = function (noaaProduct) {
        const regex = /([A-Z]{3}\d{3}-)(\d{3}-)*/g;
        const matches = noaaProduct.matchAll(regex);
        const locationsToPropagate = [];
        for (const match of matches) {
            try {
                if (match[0] && match[1]) {
                    const stateCode = match[1];
                    const countyCodes = [];
                    countyCodes.push(match[1].slice(3, 6));
                    countyCodes.push(...match[0].slice(stateCode.length).split('-').filter(Boolean));
                    const stateAbbr = stateCode.slice(0, 2).replace(/[C-]/, '').toUpperCase();
                    const stateFips = Object.keys(state).find(key => state[key].toUpperCase() === stateAbbr);
                    if (stateFips) {
                        const countyFips = countyCodes.map(countyCode => {
                            const countyAbbr = countyCode.padStart(3, '0');
                            const county = window.county || {};
                            const countyFipsKey = Object.keys(county[stateFips] || {}).find(key => key === countyAbbr);
                            const countyName = countyFipsKey ? county[stateFips][countyFipsKey] : null;
                            return countyName ? { fips: `0${stateFips}${countyFipsKey}`, name: countyName } : null;
                        });
                        locationsToPropagate.push(...countyFips.filter(c => c !== null));
                    }
                }
            } catch (error) {
                console.error("Failed to convert NOAA product to FIPS:", error);
                return 0;
            }
        }
        console.log("Converted NOAA product to FIPS:", locationsToPropagate);
        window.locations = locationsToPropagate.map(c => c.fips);
        updateTable();
        return 1;
    };

    window.noaaProductToFips = noaaProductToFips;

    if (window.EASBridge) {
        function sendEncoderData() {
            const eventsArr = [];
            const eventsEl = document.getElementById('events');
            if (eventsEl) {
                for (const og of eventsEl.querySelectorAll('optgroup')) {
                    const group = og.getAttribute('data-event-group') || og.label || '';
                    for (const opt of og.querySelectorAll('option')) {
                        eventsArr.push({ code: opt.value, label: opt.textContent, group: group });
                    }
                }
            }
            window.EASBridge.send('encoder:eventsData', { events: eventsArr });

            const statesArr = [];
            if (window.state) {
                for (const [code, abbr] of Object.entries(window.state)) {
                    statesArr.push({ code: code, name: abbr });
                }
                statesArr.sort((a, b) => a.code.localeCompare(b.code));
            }
            window.EASBridge.send('encoder:statesData', { states: statesArr });

            const canadaArr = [];
            if (window.canadaCounty) {
                for (const [code, name] of Object.entries(window.canadaCounty)) {
                    canadaArr.push({ code: code, name: name });
                }
                canadaArr.sort((a, b) => a.code.localeCompare(b.code));
            }
            window.EASBridge.send('encoder:canadaFipsData', { entries: canadaArr });

            const voicesArr = [];
            const voiceEl = document.getElementById('ttsVoice');
            if (voiceEl) {
                for (const opt of voiceEl.options) {
                    voicesArr.push({ id: opt.value, label: opt.textContent });
                }
            }
            window.EASBridge.send('encoder:voicesData', { voices: voicesArr });

            const modesArr = [];
            const modeEl = document.getElementById('overallEndecMode');
            if (modeEl) {
                for (const opt of modeEl.options) {
                    modesArr.push({ value: opt.value, label: opt.textContent });
                }
            }
            window.EASBridge.send('encoder:endecModesData', { modes: modesArr });

            const originatorsArr = [];
            const originatorsEl = document.getElementById('originators');
            if (originatorsEl) {
                for (const opt of originatorsEl.options) {
                    originatorsArr.push({ value: opt.value, label: opt.textContent });
                }
            }
            window.EASBridge.send('encoder:originatorsData', { options: originatorsArr });

            const attentionTonesArr = [];
            const attEl = document.getElementById('att');
            if (attEl) {
                for (const opt of attEl.options) {
                    attentionTonesArr.push({ value: opt.value, label: opt.textContent });
                }
            }
            window.EASBridge.send('encoder:attentionTonesData', { options: attentionTonesArr });

            const announcementTypesArr = [];
            const announcementTypeEl = document.getElementById('announcementType');
            if (announcementTypeEl) {
                for (const opt of announcementTypeEl.options) {
                    announcementTypesArr.push({ value: opt.value, label: opt.textContent });
                }
            }
            window.EASBridge.send('encoder:announcementTypesData', { options: announcementTypesArr });

            const regionsArr = [];
            if (window.rgn) {
                for (const code of Object.keys(window.rgn).sort()) {
                    regionsArr.push({ value: code, label: window.rgn[code] });
                }
            }
            window.EASBridge.send('encoder:regionsData', { options: regionsArr });

            const eventGroupsArr = [];
            if (eventsEl) {
                for (const og of eventsEl.querySelectorAll('optgroup')) {
                    eventGroupsArr.push({ key: og.getAttribute('data-event-group') || '', label: og.label || '' });
                }
            }
            window.EASBridge.send('encoder:eventGroupsData', { groups: eventGroupsArr });
        }

        window.EASBridge.on('encoder:requestData', () => {
            sendEncoderData();
        });

        window.EASBridge.on('encoder:requestCounties', (params) => {
            const stateCode = params?.state;
            if (!stateCode || !window.county || !window.county[stateCode]) {
                window.EASBridge.send('encoder:countiesData', { counties: [] });
                return;
            }
            const countiesArr = [];
            for (const [code, name] of Object.entries(window.county[stateCode])) {
                countiesArr.push({ code: code, name: name });
            }
            countiesArr.sort((a, b) => a.code.localeCompare(b.code));
            window.EASBridge.send('encoder:countiesData', { counties: countiesArr });
        });

        window.EASBridge.on('encoder:generate', async (params) => {
            try {
                window.EASBridge.send('encoder:generateState', { active: true });
                const el = (id) => document.getElementById(id);
                if (params.originator && el('originators')) el('originators').value = params.originator;
                if (params.event && el('events')) el('events').value = params.event;
                if (params.hours != null && el('hr')) { setSelectNumericValue(el('hr'), params.hours); el('hr').dispatchEvent(new Event('change')); }
                if (params.minutes != null && el('min')) setSelectNumericValue(el('min'), params.minutes);
                if (params.sender && el('par')) el('par').value = params.sender;
                if (params.attentionTone != null && el('att')) { el('att').value = params.attentionTone.toString(); el('att').dispatchEvent(new Event('change')); }
                if (params.toneDuration != null && el('tlen')) el('tlen').value = params.toneDuration.toString();
                if (params.endecMode && el('overallEndecMode')) el('overallEndecMode').value = params.endecMode;
                if (params.clip != null && el('clip')) el('clip').checked = params.clip;
                if (params.endecResample != null && el('endecResample')) el('endecResample').checked = params.endecResample;
                if (params.announcementType && el('announcementType')) { el('announcementType').value = params.announcementType; el('announcementType').dispatchEvent(new Event('change')); }
                if (params.ttsText != null) { window.ttsText = params.ttsText; if (el('ttsText')) el('ttsText').value = params.ttsText; }
                if (params.ttsVoice) {
                    if (el('ttsVoice')) {
                        el('ttsVoice').value = params.ttsVoice;
                        if (el('ttsVoice').value === params.ttsVoice) {
                            el('ttsVoice').dispatchEvent(new Event('change'));
                        }
                    }
                    window.ttsVoice = params.ttsVoice;
                }
                if (params.nativeTtsRate != null) window._nativeTtsRate = params.nativeTtsRate;
                if (params.nativeTtsPitch != null) window._nativeTtsPitch = params.nativeTtsPitch;
                if (params.ttsRate != null && el('ttsRate')) { el('ttsRate').value = params.ttsRate.toString(); el('ttsRate').dispatchEvent(new Event('input')); }
                if (params.ttsPitch != null && el('ttsPitch')) { el('ttsPitch').value = params.ttsPitch.toString(); el('ttsPitch').dispatchEvent(new Event('input')); }
                if (params.bitcrushSpeechify != null && el('shouldBitcrushSpeechify')) el('shouldBitcrushSpeechify').checked = params.bitcrushSpeechify;
                if (params.vmifyCustom != null && el('enable-vmify-custom')) { el('enable-vmify-custom').checked = params.vmifyCustom; el('enable-vmify-custom').dispatchEvent(new Event('change')); }
                if (params.vmifyCustomIntensity != null && el('vmify-custom-intensity')) el('vmify-custom-intensity').value = params.vmifyCustomIntensity.toString();

                if (params.fipsMode && el('fipsMode')) {
                    el('fipsMode').value = params.fipsMode;
                }

                if (Array.isArray(params.locations)) {
                    window.locations.length = 0;
                    params.locations.forEach(loc => window.locations.push(loc));
                    updateTable();
                }

                if (el('encoderMode')) { el('encoderMode').value = 'builder'; el('encoderMode').dispatchEvent(new Event('change')); }

                if (params.time && isTimeselectValueValid(params.time)) {
                    timeselect.value = params.time;
                    lastValidTimeselectValue = params.time;
                    updateHeaderPreview();
                } else {
                    stime();
                }

                await generateEas();
                window.EASBridge.send('encoder:generateState', { active: false, success: true });
            } catch (err) {
                console.error('[EASBridge] Generate error:', err);
                window.EASBridge.send('encoder:status', { text: 'ERROR: ' + err.message });
                window.EASBridge.send('encoder:generateState', { active: false, success: false });
            }
        });

        window._nativeCustomAudioBuffer = null;
        window.EASBridge.on('encoder:loadCustomAudio', async (params) => {
            try {
                const base64 = params?.base64;
                if (!base64) return;
                const binaryStr = atob(base64);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                }
                window._nativeCustomAudioBuffer = bytes.buffer;
                window.EASBridge.send('encoder:status', { text: '[LOG] Custom audio loaded (' + Math.round(bytes.length / 1024) + ' KB)' });
            } catch (err) {
                console.error('[EASBridge] loadCustomAudio error:', err);
                window.EASBridge.send('encoder:status', { text: 'ERROR: Failed to load custom audio: ' + err.message });
            }
        });

        window.EASBridge.on('encoder:togglePlayback', () => {
            const el = document.getElementById('audioPlayback');
            if (!el || !el.src) return;
            if (el.paused) {
                el.play();
            } else {
                el.pause();
            }
        });

        window.EASBridge.on('encoder:stopPlayback', () => {
            const el = document.getElementById('audioPlayback');
            if (!el) return;
            el.pause();
            el.currentTime = 0;
        });

        window.EASBridge.on('encoder:seekPlayback', (params) => {
            const el = document.getElementById('audioPlayback');
            if (!el || !el.duration) return;
            el.currentTime = (params?.fraction || 0) * el.duration;
        });

        const _setupPlaybackReporting = () => {
            const el = document.getElementById('audioPlayback');
            if (!el) return;
            const send = () => {
                window.EASBridge.send('encoder:playbackState', {
                    playing: !el.paused,
                    currentTime: el.currentTime || 0,
                    duration: el.duration || 0,
                });
            };
            el.addEventListener('play', send);
            el.addEventListener('pause', send);
            el.addEventListener('ended', () => { el.currentTime = 0; send(); });
            el.addEventListener('timeupdate', send);
        };
        _setupPlaybackReporting();
        new MutationObserver(() => _setupPlaybackReporting())
            .observe(document.querySelector('.control-panel') || document.body, { childList: true, subtree: true });

        window.EASBridge.on('encoder:save', async () => {
            try {
                await saveToWav();
            } catch (err) {
                console.error('[EASBridge] Save error:', err);
            }
        });

        window.EASBridge.on('encoder:requestHeaderPreview', (params) => {
            try {
                const locs = Array.isArray(params && params.locations) ? params.locations : [];
                if (locs.length < 1) {
                    window.EASBridge.send('encoder:headerPreview', { header: '' });
                    return;
                }
                const hours = String((params && params.hours) || '0').padStart(2, '0');
                const minutes = String((params && params.minutes) || '0').padStart(2, '0');
                let par = (params && params.sender) || '';
                if (par.length < 8) par += ' '.repeat(8 - par.length);
                const headerTime = (params && params.time && isTimeselectValueValid(params.time)) ? new Date(params.time) : new Date();
                const header = create_header_string(
                    (params && params.originator) || '',
                    (params && params.event) || '',
                    locs,
                    hours + minutes,
                    headerTime,
                    par
                );
                window.EASBridge.send('encoder:headerPreview', { header: header || '' });
            } catch (err) {
                window.EASBridge.send('encoder:headerPreview', { header: '' });
            }
        });

        window.EASBridge.on('encoder:setTimeToNow', () => {
            stime();
        });

        const _origAddStatus = addStatus;
        addStatus = function(stat, type) {
            _origAddStatus(stat, type);
            if (window.EASBridge) {
                const plainText = stat.replace(/<[^>]*>/g, '');
                window.EASBridge.send('encoder:status', { text: '[' + (type || 'LOG') + '] ' + plainText });
            }
        };

        window.EASBridge.on('encoder:resolveFips', (params) => {
            const codes = params?.codes;
            if (!Array.isArray(codes)) return;
            const results = codes.map((fips) => {
                const stateCode = fips.slice(1, 3);
                const countyCode = fips.slice(3, 6);
                const countyName = window.county?.[stateCode]?.[countyCode] || '';
                const stateAbbr = window.state?.[stateCode] || '';
                if (countyName || stateAbbr) {
                    return { code: fips, county: countyName, state: stateAbbr };
                }
                const caCode = fips.slice(1);
                const caName = window.canadaCounty?.[caCode] || '';
                return { code: fips, county: caName, state: caName ? 'CA' : '' };
            });
            window.EASBridge.send('encoder:fipsResolved', { results: results });
        });

        window.EASBridge.on('normalizer:run', (params) => {
            const text = params?.text || '';
            const repeat = params?.repeat || false;
            const result = window.normalizeNwsBulletin
                ? window.normalizeNwsBulletin(text, { repeat })
                : text;
            window.EASBridge.send('normalizer:result', { result });
        });

        sendEncoderData();

        console.log('[EASBridge] Encoder bridge handlers registered');
    }
})();
