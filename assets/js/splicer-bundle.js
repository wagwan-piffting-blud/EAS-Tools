import * as SM from './splicer/model.js';
import * as SR from './splicer/render.js';
import * as SG from './splicer/generators.js';
import * as SW from './splicer/wav.js';
import * as SE from './splicer/encode.js';
import * as SZ from './splicer/zip.js';
import * as SL from './splicer/limiter.js';
import { openAlertDialog } from './splicer/alert-ui.js';
import { createEditor } from './splicer/editor.js';
import { buildPanel } from './splicer/layout.js';
import { saveFile, CODEMIRROR_DARK_THEME_NAME, CODEMIRROR_LIGHT_THEME_NAME, USES_DARK_THEME, PIPER_DEFAULT_VOICE_ID as PIPER_VOICE, resamplePcm, resamplePcmSinc, vmifyPcm, validateMarkupAndText, createNanoTtsEngine, createTtsTextEditor, ensurePiperLoaded, getPiperPcm, populateRemoteVoiceList, populateSpfyVoiceList, getSpfyEngine, getAcuEngine, parseSpfyVoiceId, getEspeakEngine, parseEspeakVoiceId, espeakRateFromSlider, espeakPitchFromSlider, bindSliderNumberPair, fetchRemoteTtsAudio, resolveVoiceBackend, readTtsProsodyControls, backendSupportsProsody, backendSupportsVolumeBoost } from './common-functions.js';
import { createSendMenu, receive, audioFile } from './handoff.js';

buildPanel(document.getElementById('splicer-panel'));

(async function () {
    let splicerTextEditor = null;

    function initSplicerTextEditor() {
        if (splicerTextEditor || !window.CodeMirror) return splicerTextEditor;

        const splicerEditor = createTtsTextEditor({
            textareaId: 'ttsText2',
            ariaLabel: 'Text to convert to speech',
            width: '100%',
            height: 'auto',
            theme: USES_DARK_THEME ? CODEMIRROR_DARK_THEME_NAME : CODEMIRROR_LIGHT_THEME_NAME,
        });
        if (!splicerEditor) return null;

        splicerTextEditor = splicerEditor;
        return splicerEditor;
    }

    window.splicerEditor = initSplicerTextEditor();
    window.splicerEditor.refresh();
})();

(async function () {
    const panel = document.getElementById('splicer-panel');
    if (!panel) return;

    const fileInput = panel.querySelector('[data-splice-file]');
    const ttsInput = panel.querySelector('#ttsText2') || panel.querySelector('.ttsText');
    const ttsButton = panel.querySelector('[data-splice-tts-generate]') || panel.querySelector('#spliceTTSGenerator button');
    const ttsClearButton = panel.querySelector('[data-splice-tts-clear]');
    const ttsStatus = panel.querySelector('[data-splice-tts-status]') || panel.querySelector('#spliceTTSGenerator [data-splice-tts-status]');
    const voiceSelect = panel.querySelector('#ttsVoice2');
    const overrideTzSelect = panel.querySelector('#useSplicerOverrideTZ');
    const silenceInput = panel.querySelector('[data-splice-silence]');
    const silenceStatus = panel.querySelector('[data-splice-silence-status]');
    const silenceBtn = panel.querySelector('[data-splice-add-silence]');
    const exportBtn = panel.querySelector('[data-splice-export]');
    const clearBtn = panel.querySelector('[data-splice-clear]');
    const persistLabel = panel.querySelector('[data-splice-persist]');
    const loadFileBtn = panel.querySelector('[data-splice-load]');
    const macroSelect = panel.querySelector('[data-splice-macro-select]');
    const macroUploadInput = panel.querySelector('[data-splice-macro-upload]');
    const macroUploadBtn = panel.querySelector('[data-splice-macro-upload-btn]');
    const macroRemoveBtn = panel.querySelector('[data-splice-macro-remove-btn]');
    const previewMacroBtn = panel.querySelector('[data-splice-preview-macro]');
    const exportMacroBtn = panel.querySelector('[data-splice-export-macro]');
    let sendMenu = null;
    const spliceLoudnessInput = panel.querySelector('[data-splice-loudness]');
    const spliceSilenceInput = panel.querySelector('[data-splice-silence]');
    const previewMacroBtnDefaultText = previewMacroBtn && previewMacroBtn.textContent
        ? previewMacroBtn.textContent.trim() || 'Preview Macro'
        : 'Preview Macro';
    let previewMacroBtnWasDisabled = previewMacroBtn ? previewMacroBtn.disabled : false;
    let previewMacroBtnDisabledByTask = false;
    const enableStaticNoiseCheckbox = panel.querySelector('#enable-static-noise');
    const staticNoiseOptions = panel.querySelector('#staticNoiseOptions');
    const enable60HzHumCheckbox = panel.querySelector('#enable-60hz-hum');
    const humOptions = panel.querySelector('#humOptions');
    const staticNoiseLevelInput = panel.querySelector('#static-noise-level');
    const staticNoiseFadeDepthInput = panel.querySelector('#static-noise-fade-depth');
    const staticNoiseFadeRateInput = panel.querySelector('#static-noise-fade-rate');
    const humLevelInput = panel.querySelector('#hum-level');
    const enableBitcrushCheckbox = panel.querySelector('#enable-bitcrush');
    const bitcrushOptions = panel.querySelector('#bitcrushOptions');
    const bitcrushBitsInput = panel.querySelector('#bitcrush-bits');
    const bitcrushDownsampleInput = panel.querySelector('#bitcrush-downsample');
    const enableVmifyCheckbox = panel.querySelector('#enable-vmify');
    const vmifyOptions = panel.querySelector('#vmifyOptions');
    const vmifyIntensityInput = panel.querySelector('#vmify-intensity');
    const shouldBitcrushSpeechifyDiv = panel.querySelector('#shouldBitcrushSpeechifyContainer2');
    const shouldBitcrushSpeechifyCheckbox = panel.querySelector('#shouldBitcrushSpeechify2');

    const DB_NAME = 'eas-splicer';
    const DB_VERSION = 2;
    const STORE = 'projects';
    const MACRO_STORE = 'customMacros';
    const CACHE_KEY = 'current';
    const voiceBackendMap = {};
    let enable60HzHum = enable60HzHumCheckbox?.checked === true;
    let macroPreviewPlayback = null;
    let macroPreviewMarkerInterval = null;
    let macroRenderBlobCache = null;
    let macroWaveformPcm = null;
    let macroWaveformSampleRate = 0;
    let macroWaveformActiveKey = null;
    let macroWaveformOutputSig = null;
    let macroWaveformPendingKey = null;
    let macroWaveformCancelledKey = null;
    let macroWaveformJobSeq = 0;
    let macroWaveformJob = null;
    let macroWaveformDebounce = null;
    let macroComboBtn = null;
    let macroRenderActiveCount = 0;

    const state = {
        sampleRate: 44100,
        pcm: new Float32Array(0),
        selection: { start: 0, end: 0 },
        disk: null,
    };

    let project = SM.createProject(44100);
    SM.addTrack(project, 'voice');
    const editHistory = SM.createHistory(150);
    let editor = null;
    let lastOutputSig = null;
    let lastOutputPcmRef = null;

    const OUTPUT_KEY = 'eas-splicer-output';
    const outputPrefs = (() => {
        try {
            const v = JSON.parse(localStorage.getItem(OUTPUT_KEY) || 'null');
            if (v && typeof v === 'object') {
                const bitrates = v.bitrates && typeof v.bitrates === 'object' ? v.bitrates : {};
                return { format: SE.formatOf(v.format), channels: v.channels === 2 ? 2 : 1, limit: v.limit !== false, bitrates };
            }
        } catch (_) {}
        return { format: 'pcm16', channels: 1, limit: true, bitrates: {} };
    })();
    const limitOn = () => outputPrefs.limit !== false;
    const finishChans = (chans, sr, gain) => (limitOn() ? SL.limitAll(chans, sr, gain) : null);
    const overNote = (over, limited, format) => {
        if (!(over > 1.0001)) return '';
        const db = SL.overDb(over).toFixed(1);
        if (limited) return ` Peaks up to +${db} dB were limited to prevent clipping.`;
        if (format === 'float32') return ` Peaks go +${db} dB over full scale.`;
        return ` Warning: peaks reached +${db} dB and were clipped. Turn on Prevent clipping or lower Master.`;
    };
    const saveOutputPrefs = () => {
        try { localStorage.setItem(OUTPUT_KEY, JSON.stringify(outputPrefs)); } catch (_) {}
    };
    const outFormat = () => SE.formatOf(outputPrefs.format);
    const outBitrate = () => SE.bitrateOf(outFormat(), outputPrefs.bitrates[outFormat()]);
    const outInfo = () => SE.infoOf(outFormat());
    const outFileName = (base) => `${base}.${outInfo().ext}`;
    const outStereo = () => outputPrefs.channels === 2;
    const stereoPanned = () => outStereo() && SM.isPanned(project);
    const outputSig = () => outFormat() + ':' + outBitrate() + '|' + (limitOn() ? 'L' : 'C') + '|' + (!outStereo() ? 'M' : (!SM.isPanned(project) ? 'S0'
        : 'S:' + SM.audibleTracks(project).map((t) => t.id + '=' + SM.clampPan(t.pan)).join(',')));
    let stereoCache = null;
    const outputChannels = () => {
        if (!outStereo()) return [state.pcm];
        if (!SM.isPanned(project)) return [state.pcm, state.pcm];
        if (!stereoCache || stereoCache.ref !== state.pcm) {
            const n = SM.projectLength(project);
            stereoCache = { ref: state.pcm, chans: ['L', 'R'].map((side) => SM.mixdown(project, 0, n, { ...fxResolve, side })) };
        }
        return stereoCache.chans;
    };
    const NAMED_PREFIX = 'named:';
    let editorModeShown = null;
    let applyingMaster = false;
    let pendingMasterMacro = null;
    let masterBypass = false;
    let openEffectsEditorFn = null;
    let refreshEffectsEditorFn = null;

    const syncEditorMode = () => {
        if (!editor || editorModeShown) return;
        editorModeShown = true;
        editor.setVisible(true);
        editor.render();
    };

    let audioCtx = null;
    let playingSource = null;
    let playingMode = null;
    let playStartOffset = 0;
    let playSpan = 0;
    let playStartedAt = 0;
    let pausedPlayback = null;
    let playheadTime = 0;
    let cacheDbPromise = null;
    let voiceListLoaded = false;

    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
    const LOUDNESS_DBFS_DEFAULT = -16;
    const LOUDNESS_DBFS_MIN = -60;
    const LOUDNESS_DBFS_MAX = 12;
    const EXPORT_GAIN_TOLERANCE = 1e-6;

    const getExportLoudnessDbfs = () => {
        if (!spliceLoudnessInput) return LOUDNESS_DBFS_DEFAULT;
        const val = parseFloat(spliceLoudnessInput.value);
        if (!Number.isFinite(val)) return LOUDNESS_DBFS_DEFAULT;
        return clamp(val, LOUDNESS_DBFS_MIN, LOUDNESS_DBFS_MAX);
    };

    const getExportGain = () => {
        const dbfs = getExportLoudnessDbfs();
        return Math.pow(10, dbfs / 20);
    };

    const exportGainFactor = () => {
        const g = getExportGain();
        return Math.abs(g - 1) > EXPORT_GAIN_TOLERANCE ? g : 1;
    };

    const clonePcmWithGain = (pcm, gain = getExportGain()) => {
        if (!pcm || !pcm.length || Math.abs(gain - 1) < EXPORT_GAIN_TOLERANCE) return pcm;
        const out = new Float32Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) {
            let sample = pcm[i] * gain;
            if (sample > 1) sample = 1;
            else if (sample < -1) sample = -1;
            out[i] = sample;
        }
        return out;
    };

    const buildSoxLoudnessArgs = (dbfs) => {
        if (!Number.isFinite(dbfs) || Math.abs(dbfs) < 1e-6) return [];
        const normalized = Number(dbfs.toFixed(2));
        const suffix = Number.isFinite(normalized) ? normalized.toString() : dbfs.toString();
        return ['vol', `${suffix}dB`];
    };

    const applyGainToAudioBuffer = (buffer, pcm, gain = getExportGain(), ch = 0) => {
        if (!buffer || !pcm) return;
        const channelData = buffer.getChannelData(ch);
        if (!channelData) return;
        if (Math.abs(gain - 1) < EXPORT_GAIN_TOLERANCE) {
            channelData.set(pcm);
            return;
        }
        for (let i = 0; i < pcm.length; i++) {
            let sample = pcm[i] * gain;
            if (sample > 1) sample = 1;
            else if (sample < -1) sample = -1;
            channelData[i] = sample;
        }
    };

    const getStaticNoiseOptions = () => {
        const level = parseFloat(staticNoiseLevelInput?.value);
        const fadeDepth = parseFloat(staticNoiseFadeDepthInput?.value);
        const fadeRateHz = parseFloat(staticNoiseFadeRateInput?.value);
        return {
            level: Number.isFinite(level) ? level : 0.14,
            fadeDepth: Number.isFinite(fadeDepth) ? fadeDepth : 0.45,
            fadeRateHz: Number.isFinite(fadeRateHz) ? fadeRateHz : 0.6,
        };
    };

    const decodeWavBlobToFloat32 = async (blob) => {
        if (!blob) return null;
        try {
            const ctx = getAudioCtx();
            const buffer = await blob.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(buffer);
            const channel = audioBuffer.getChannelData(0);
            return {
                pcm: new Float32Array(channel),
                sampleRate: audioBuffer.sampleRate,
            };
        } catch (err) {
            console.error('Failed to decode macro waveform blob', err);
            return null;
        }
    };

    const shouldUseMacroWaveform = () => {
        if (!state.pcm.length) return false;
        const macroId = (typeof getSelectedMacroId === 'function' ? getSelectedMacroId() : 'FLAT') || 'FLAT';
        const staticEnabled = enableStaticNoiseCheckbox?.checked === true;
        const bitcrushEnabled = enableBitcrushCheckbox?.checked === true;
        const vmifyEnabled = enableVmifyCheckbox?.checked === true;
        return macroId !== 'FLAT' || staticEnabled || bitcrushEnabled || vmifyEnabled;
    };

    const getMacroWaveformKey = () => {
        if (!shouldUseMacroWaveform()) return null;
        const macroId = (typeof getSelectedMacroId === 'function' ? getSelectedMacroId() : 'FLAT') || 'FLAT';
        const staticEnabled = enableStaticNoiseCheckbox?.checked === true;
        const opts = staticEnabled ? getStaticNoiseOptions() : null;
        const bitcrushEnabled = enableBitcrushCheckbox?.checked === true;
        const vmifyEnabled = enableVmifyCheckbox?.checked === true;
        const parts = [
            macroId,
            staticEnabled ? '1' : '0',
            opts ? opts.level : '0',
            opts ? opts.fadeDepth : '0',
            opts ? opts.fadeRateHz : '0',
            bitcrushEnabled ? '1' : '0',
            bitcrushEnabled ? (bitcrushBitsInput?.value ?? '') : '',
            bitcrushEnabled ? (bitcrushDownsampleInput?.value ?? '') : '',
            vmifyEnabled ? '1' : '0',
            vmifyEnabled ? (vmifyIntensityInput?.value ?? '') : '',
            macroId === 'CHAIN' ? chainSig() : '',
            macroLevelSig(),
            state.pcm.length,
            state.sampleRate,
        ];
        return parts.join('|');
    };

    const cancelMacroWaveformComputation = () => {
        macroWaveformJobSeq += 1;
        macroWaveformPendingKey = null;
        if (macroWaveformJob) {
            macroWaveformJob.abort();
            macroWaveformJob = null;
        }
        if (macroWaveformDebounce) {
            clearTimeout(macroWaveformDebounce);
            macroWaveformDebounce = null;
        }
    };

    const invalidateMacroWaveformCache = (skipDraw = false) => {
        cancelMacroWaveformComputation();
        macroWaveformPcm = null;
        macroWaveformSampleRate = 0;
        macroWaveformActiveKey = null;
        if (!skipDraw) drawWaveform();
    };

    const setMacroControlsRendering = (rendering) => {
        if (rendering) {
            macroRenderActiveCount++;
        } else {
            macroRenderActiveCount = Math.max(0, macroRenderActiveCount - 1);
        }
        const busy = macroRenderActiveCount > 0;
        if (macroSelect) macroSelect.disabled = busy;
        if (macroComboBtn) macroComboBtn.disabled = busy;
        if (previewMacroBtn) previewMacroBtn.disabled = busy || !state.pcm.length;
        if (editor) editor.refreshMaster();
    };

    const scheduleMacroWaveformUpdate = (immediate = false) => {
        if (!state.pcm.length) {
            invalidateMacroWaveformCache();
            return;
        }
        const key = getMacroWaveformKey();
        if (!key) {
            invalidateMacroWaveformCache();
            return;
        }
        if (macroWaveformActiveKey === key || macroWaveformPendingKey === key) return;
        if (!immediate && macroWaveformCancelledKey === key) return;
        if (macroWaveformActiveKey) {
            macroWaveformActiveKey = null;
            macroWaveformPcm = null;
            macroWaveformSampleRate = 0;
            drawWaveform();
        }
        macroWaveformPendingKey = key;
        const delay = immediate ? 0 : 200;
        if (macroWaveformDebounce) clearTimeout(macroWaveformDebounce);
        macroWaveformDebounce = setTimeout(() => {
            macroWaveformDebounce = null;
            generateMacroWaveformForKey(key);
        }, delay);
    };

    const generateMacroWaveformForKey = (key) => {
        if (!state.pcm.length) return;
        const pcmRef = state.pcm;
        const sr = state.sampleRate || 44100;
        const macroId = (typeof getSelectedMacroId === 'function' ? getSelectedMacroId() : 'FLAT') || 'FLAT';
        const jobId = ++macroWaveformJobSeq;
        setMacroControlsRendering(true);
        const job = renderSelectedMacroPcm(pcmRef, sr, macroId, macroProgressCb);
        macroWaveformJob = job;

        job.settled = (async () => {
            try {
                let processed = null;
                try {
                    const out = await trackMacroJob(() => job);
                    const doneLabel = macroRenderDoneLabel(macroId, true);
                    if (doneLabel) setMacroProgress(1, doneLabel);
                    if (out.pcm !== pcmRef) processed = out;
                    macroWaveformCancelledKey = null;
                } catch (err) {
                    setMacroProgress(1, '');
                    if (isMacroCancelError(err) && jobId !== macroWaveformJobSeq) {
                        return;
                    } else if (isMacroCancelError(err)) {
                        macroWaveformCancelledKey = key;
                        cancelStatus('Macro processing cancelled.');
                    } else if (isMacroAssetError(err)) {
                        persistStatus(err.message, false);
                    } else {
                        console.error('Macro waveform render failed', err);
                    }
                }

                if (macroWaveformJob === job) macroWaveformJob = null;
                if (jobId !== macroWaveformJobSeq) return;
                if (!shouldUseMacroWaveform() || key !== getMacroWaveformKey()) {
                    macroWaveformPendingKey = null;
                    return;
                }
                if (state.pcm !== pcmRef) {
                    macroWaveformPendingKey = null;
                    return;
                }

                if (processed?.pcm?.length) {
                    macroWaveformPcm = processed.pcm;
                    macroWaveformSampleRate = processed.sampleRate || sr;
                    macroWaveformActiveKey = key;
                    macroWaveformOutputSig = getMacroOutputSignature(macroId);
                } else {
                    macroWaveformPcm = null;
                    macroWaveformSampleRate = 0;
                    macroWaveformActiveKey = null;
                    macroWaveformOutputSig = null;
                }
                macroWaveformPendingKey = null;
                drawWaveform();
            } finally {
                setMacroControlsRendering(false);
            }
        })().catch((err) => {
            if (jobId === macroWaveformJobSeq) {
                macroWaveformPendingKey = null;
            }
            console.error('Failed to compute macro waveform', err);
        });
    };

    const getWaveformRenderData = () => {
        const useMacro = macroWaveformPcm && macroWaveformActiveKey && shouldUseMacroWaveform();
        if (useMacro) {
            return {
                pcm: macroWaveformPcm,
                sampleRate: macroWaveformSampleRate || state.sampleRate || 44100,
            };
        }
        return {
            pcm: state.pcm,
            sampleRate: state.sampleRate || 44100,
        };
    };

    const persistStatus = (msg, ok = true) => {
        if (!persistLabel) return;
        persistLabel.textContent = msg;
        persistLabel.style.color = ok
            ? (USES_DARK_THEME ? '#7ae37a' : '#1a7a1a')
            : (USES_DARK_THEME ? '#f48383' : '#b00000');
    };

    const spokenStatus = (msg, ok = true) => {
        persistStatus(msg, ok);
        if (editor) editor.announce(msg);
    };

    const cancelStatus = (msg) => {
        if (!macroCancelPending && Date.now() > statusHoldUntil) persistStatus(msg, true);
    };

    let macroProgressUI = null;
    let macroProgressPct = -1;
    const ensureMacroProgress = () => {
        if (macroProgressUI || !persistLabel || !persistLabel.parentNode) return macroProgressUI;
        const wrap = document.createElement('div');
        wrap.className = 'splice-progress';
        wrap.style.cssText = 'height:4px;background:#333;border-radius:2px;margin-top:3px;overflow:hidden;display:none';
        wrap.setAttribute('role', 'progressbar');
        wrap.setAttribute('aria-label', 'Macro processing progress');
        wrap.setAttribute('aria-valuemin', '0');
        wrap.setAttribute('aria-valuemax', '100');
        wrap.setAttribute('aria-valuenow', '0');
        wrap.setAttribute('aria-valuetext', '0%');
        const bar = document.createElement('div');
        bar.style.cssText = 'height:100%;width:0%;background:#7ae37a;transition:width .08s linear';
        wrap.appendChild(bar);
        persistLabel.parentNode.insertBefore(wrap, persistLabel.nextSibling);
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel Macro';
        cancelBtn.hidden = true;
        cancelBtn.setAttribute('data-splice-macro-cancel', '');
        cancelBtn.addEventListener('click', cancelMacroJobs);
        wrap.parentNode.insertBefore(cancelBtn, wrap.nextSibling);
        macroProgressUI = { wrap, bar, cancelBtn };
        return macroProgressUI;
    };
    let macroJobsActive = 0;
    let macroCancelSeq = 0;
    const macroJobCtls = new Set();
    let macroCancelPending = 0;
    let statusHoldUntil = 0;
    const macroCancelError = () => {
        const e = new Error('Macro processing cancelled');
        e.name = 'AbortError';
        return e;
    };
    const syncMacroCancelBtn = () => {
        const ui = ensureMacroProgress();
        if (!ui) return;
        const show = macroJobsActive > 0 || macroJobCtls.size > 0;
        if (!show && macroCancelPending) {
            const n = macroCancelPending;
            macroCancelPending = 0;
            statusHoldUntil = Date.now() + 4000;
            spokenStatus(n === 1 ? 'Macro processing cancelled.' : `Cancelled ${n} macro jobs.`, true);
        }
        if (!show) {
            const hadFocus = document.activeElement === ui.cancelBtn;
            ui.cancelBtn.disabled = false;
            ui.cancelBtn.textContent = 'Cancel Macro';
            if (hadFocus && macroSelect && !macroSelect.disabled) macroSelect.focus();
        }
        ui.cancelBtn.hidden = !show;
    };
    const trackMacroJob = async (fn) => {
        macroJobsActive++;
        syncMacroCancelBtn();
        try {
            return await fn();
        } finally {
            macroJobsActive = Math.max(0, macroJobsActive - 1);
            syncMacroCancelBtn();
        }
    };
    function cancelMacroJobs() {
        if (!macroJobsActive && !macroJobCtls.size) return;
        macroCancelSeq++;
        macroCancelPending = Math.max(1, macroJobCtls.size);
        for (const ctl of [...macroJobCtls]) ctl.abort();
        if (window.AudacityMacroEngine && window.AudacityMacroEngine.cancel) window.AudacityMacroEngine.cancel();
        const ui = ensureMacroProgress();
        if (ui) {
            ui.cancelBtn.disabled = true;
            ui.cancelBtn.textContent = 'Cancelling...';
        }
        persistStatus('Cancelling macro...', true);
    }
    const setMacroProgress = (fraction, label) => {
        const ui = ensureMacroProgress();
        if (ui) {
            const active = fraction >= 0 && fraction < 1;
            const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
            ui.wrap.style.display = active ? 'block' : 'none';
            ui.bar.style.width = pct + '%';
            if (active) {
                if (pct !== macroProgressPct) {
                    macroProgressPct = pct;
                    ui.wrap.setAttribute('aria-valuenow', String(pct));
                    ui.wrap.setAttribute('aria-valuetext', pct + '%');
                }
            } else {
                macroProgressPct = -1;
            }
        }
        if (label) persistStatus(label, true);
    };
    const macroProgressCb = ({ step, total, cmd, fraction }) =>
        setMacroProgress(fraction, `Macro ${step}/${total}: ${cmd} (${Math.round(fraction * 100)}%)`);

    const syncPlayButtons = () => {
        if (editor) editor.syncTransport();
    };

    const setPreviewMacroButtonState = (label, disabled) => {
        if (!previewMacroBtn) return;
        previewMacroBtn.textContent = label;
        previewMacroBtn.disabled = !!disabled;
        previewMacroBtnDisabledByTask = !!disabled;
    };

    const resetPreviewMacroButton = () => {
        if (!previewMacroBtn) return;
        const shouldDisable = previewMacroBtnDisabledByTask
            ? previewMacroBtnWasDisabled
            : previewMacroBtn.disabled || previewMacroBtnWasDisabled;
        previewMacroBtnDisabledByTask = false;
        previewMacroBtn.textContent = previewMacroBtnDefaultText;
        previewMacroBtn.disabled = shouldDisable;
        previewMacroBtnWasDisabled = previewMacroBtn.disabled;
    };

    const clearMacroPreviewInterval = () => {
        if (macroPreviewMarkerInterval) {
            clearInterval(macroPreviewMarkerInterval);
            macroPreviewMarkerInterval = null;
        }
    };

    const invalidateMacroPreview = () => {
        if (!macroPreviewPlayback) return;
        const audio = macroPreviewPlayback.audio;
        if (audio) {
            try {
                audio.pause();
            } catch (err) {
                reportErrorStatus(`Failed to pause macro preview during reset: ${err}`, err);
            }
            try {
                audio.currentTime = 0;
            } catch (err) {
                reportErrorStatus(`Failed to reset macro preview audio position: ${err}`, err);
            }
        }
        try {
            macroPreviewPlayback.cleanup?.();
        } catch (err) {
            reportErrorStatus(`Failed to cleanup macro preview: ${err}`, err);
        }
        if (playingSource === audio) {
            playingSource = null;
            playingMode = null;
            pausedPlayback = null;
            playSpan = 0;
            playStartOffset = 0;
            syncPlayButtons();
        }
        macroPreviewPlayback = null;
        clearMacroPreviewInterval();
        resetPreviewMacroButton();
    };

    const pauseMacroPreview = () => {
        if (!macroPreviewPlayback?.audio) return false;
        try {
            macroPreviewPlayback.audio.pause();
        } catch (err) {
            reportErrorStatus(`Failed to pause macro preview: ${err}`, err);
        }
        const pausedAt = macroPreviewPlayback.audio.currentTime;
        if (Number.isFinite(pausedAt)) {
            playheadTime = clamp(pausedAt, 0, duration());
        }
        macroPreviewPlayback.paused = true;
        clearMacroPreviewInterval();
        setPreviewMacroButtonState('Resume Preview', false);
        playingSource = null;
        playingMode = null;
        pausedPlayback = null;
        drawWaveform();
        return true;
    };

    const resumeMacroPreview = async () => {
        if (!macroPreviewPlayback?.audio) return false;
        const audio = macroPreviewPlayback.audio;
        if (!audio.paused && !macroPreviewPlayback.paused) return true;
        if (playingSource && playingSource !== audio) {
            stopPlayback({ preserveMacroPreview: true });
        }
        const ctxAudio = audioCtx || getAudioCtx();
        if (ctxAudio && ctxAudio.state === 'suspended' && typeof ctxAudio.resume === 'function') {
            try {
                await ctxAudio.resume();
            } catch (err) {
                reportErrorStatus(`Failed to resume audio context for macro preview: ${err}`);
            }
        }
        const resumeTarget = clamp(playheadTime, 0, Math.max(0, duration()));
        try {
            const dur = (Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : null;
            const target = dur !== null ? Math.min(resumeTarget, Math.max(0, dur - 0.01)) : resumeTarget;
            if (Math.abs((audio.currentTime || 0) - target) > 0.05) {
                audio.currentTime = target;
            }
        } catch (err) {
            reportErrorStatus(`Failed to seek macro preview to needle position: ${err}`, err);
        }
        playingSource = audio;
        playingMode = 'macro-preview';
        playStartOffset = audio.currentTime || 0;
        playSpan = Math.max(0.001, audio.duration || playSpan || 0.001);
        playStartedAt = ctxAudio ? ctxAudio.currentTime : 0;
        macroPreviewPlayback.paused = false;
        clearMacroPreviewInterval();
        setPreviewMacroButtonState('Pause Preview', false);
        try {
            await audio.play();
        } catch (err) {
            reportErrorStatus(`Failed to resume macro preview audio playback: ${err}`, err);
            macroPreviewPlayback.paused = true;
            clearMacroPreviewInterval();
            setPreviewMacroButtonState('Resume Preview', false);
            return false;
        }
        return true;
    };

    const getDb = () => {
        if (!window.indexedDB) {
            persistStatus('IndexedDB unavailable; caching disabled.', false);
            return null;
        }
        if (!cacheDbPromise) {
            cacheDbPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
                    if (!db.objectStoreNames.contains(MACRO_STORE)) db.createObjectStore(MACRO_STORE);
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        return cacheDbPromise;
    };

    const saveProject = async (key = CACHE_KEY) => {
        const dbp = getDb();
        if (!dbp) return;
        try {
            const db = await dbp;
            SM.gcSources(project, editHistory.referencedSources());
            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                const payload = {
                    ...SM.serialize(project),
                    savedAt: Date.now(),
                    ttsVoiceSelection: voiceSelect ? voiceSelect.value : null,
                    ttsText: ttsInput ? ttsInput.value : null,
                    spliceLoudnessInput: spliceLoudnessInput ? parseFloat(spliceLoudnessInput.value) : 0,
                    spliceSilenceInput: spliceSilenceInput ? parseFloat(spliceSilenceInput.value) : 0.5,
                    macroSelection: macroSelect ? macroSelect.value : null,
                    macroLevel: getMacroLevel(),
                    staticEnabled: enableStaticNoiseCheckbox ? enableStaticNoiseCheckbox.checked : false,
                    staticOptions: {
                        level: staticNoiseLevelInput ? staticNoiseLevelInput.value : null,
                        fadeDepth: staticNoiseFadeDepthInput ? staticNoiseFadeDepthInput.value : null,
                        fadeRateHz: staticNoiseFadeRateInput ? staticNoiseFadeRateInput.value : null,
                    },
                    humEnabled: enable60HzHumCheckbox ? enable60HzHumCheckbox.checked : false,
                    humOptions: {
                        level: humLevelInput ? humLevelInput.value : null,
                    },
                    bitcrushEnabled: enableBitcrushCheckbox ? enableBitcrushCheckbox.checked : false,
                    bitcrushOptions: {
                        bits: bitcrushBitsInput ? bitcrushBitsInput.value : null,
                        downsample: bitcrushDownsampleInput ? bitcrushDownsampleInput.value : null,
                    },
                    vmifyEnabled: enableVmifyCheckbox ? enableVmifyCheckbox.checked : false,
                    vmifyOptions: {
                        intensity: vmifyIntensityInput ? vmifyIntensityInput.value : null,
                    },
                };
                tx.objectStore(STORE).put(payload, key);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
            if (key === CACHE_KEY && Date.now() > statusHoldUntil) persistStatus(`Saved locally @ ${new Date().toLocaleTimeString()}.`);
        } catch (err) {
            console.error('Failed to save splicer project!', err);
            persistStatus('Local save failed.', false);
            if (key !== CACHE_KEY) throw err;
        }
    };

    let saveTimer = null;
    const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { saveTimer = null; saveProject(); }, 400);
    };

    const loadProject = async (key = CACHE_KEY) => {
        const dbp = getDb();
        if (!dbp) return null;
        try {
            const db = await dbp;
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.error('Failed to load splicer project!', err);
            persistStatus('Local load failed.', false);
            return null;
        }
    };

    const listNamedProjects = async () => {
        const dbp = getDb();
        if (!dbp) return [];
        const db = await dbp;
        const keys = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).getAllKeys();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
        return keys.filter((k) => typeof k === 'string' && k.startsWith(NAMED_PREFIX)).map((k) => k.slice(NAMED_PREFIX.length)).sort((a, b) => a.localeCompare(b));
    };

    const deleteNamedProject = async (name) => {
        const dbp = getDb();
        if (!dbp) return;
        const db = await dbp;
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(NAMED_PREFIX + name);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    };

    const projectFromPayload = (payload) => {
        if (!payload) return null;
        if (payload.version === 3) return SM.deserialize(payload);
        if (Array.isArray(payload.segments)) return SM.migrateV2(payload);
        return null;
    };

    const clearCache = async () => {
        const dbp = getDb();
        if (!dbp) return;
        try {
            const db = await dbp;
            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(CACHE_KEY);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } catch (err) {
            persistStatus(`Failed clearing cache: ${err}.`, false);
        }
    };

    const saveCustomMacroToDb = async (file, text) => {
        const dbp = getDb();
        if (!dbp) return;
        try {
            const db = await dbp;
            if (!db.objectStoreNames.contains(MACRO_STORE)) return;
            await new Promise((resolve, reject) => {
                const tx = db.transaction(MACRO_STORE, 'readwrite');
                tx.objectStore(MACRO_STORE).put({ file, text, savedAt: Date.now() }, file);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } catch (err) {
            persistStatus(`Failed saving custom macro: ${err}.`, false);
        }
    };

    const deleteCustomMacroFromDb = async (file) => {
        const dbp = getDb();
        if (!dbp) return;
        try {
            const db = await dbp;
            if (!db.objectStoreNames.contains(MACRO_STORE)) return;
            await new Promise((resolve, reject) => {
                const tx = db.transaction(MACRO_STORE, 'readwrite');
                tx.objectStore(MACRO_STORE).delete(file);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } catch (err) {
            persistStatus(`Failed removing custom macro: ${err}.`, false);
        }
    };

    const loadCustomMacrosFromDb = async () => {
        const dbp = getDb();
        if (!dbp) return [];
        try {
            const db = await dbp;
            if (!db.objectStoreNames.contains(MACRO_STORE)) return [];
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(MACRO_STORE, 'readonly');
                const req = tx.objectStore(MACRO_STORE).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.error('Failed to load custom macros!', err);
            return [];
        }
    };

    const getAudioCtx = () => {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioCtx;
    };

    const duration = () => {
        if (state.disk) return SM.projectLength(project) / (project.sampleRate || 44100);
        return state.pcm.length ? state.pcm.length / state.sampleRate : 0;
    };

    const hasAudio = () => (state.disk ? SM.projectLength(project) > 0 : state.pcm.length > 0);

    const samePcm = (a, b) => {
        if (a === b) return true;
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    };

    const rebuildTimeline = ({ preserveMacroWaveform = false } = {}) => {
        syncEditorMode();
        const prevPcm = state.pcm;
        const prevRate = state.sampleRate;
        state.sampleRate = project.sampleRate;
        syncRenderedLengths();
        state.disk = SM.usesDisk(project) ? { big: true } : null;
        const next = state.disk ? new Float32Array(0) : SM.mixdown(project, 0, SM.projectLength(project), fxResolve);
        const unchanged = !state.disk && next.length > 0 && prevRate === state.sampleRate && samePcm(prevPcm, next);
        state.pcm = unchanged ? prevPcm : next;
        stereoCache = null;
        const key = getMacroWaveformKey();
        const keepMacroWaveform = (preserveMacroWaveform || unchanged)
            && ((macroWaveformActiveKey && macroWaveformActiveKey === key)
                || (unchanged && macroWaveformPendingKey && macroWaveformPendingKey === key));
        if (!keepMacroWaveform) {
            invalidateMacroWaveformCache(true);
        }
        if (state.disk) queueMissingFx();
        macroRenderBlobCache = null;
        const d = duration();
        const sel = editor ? editor.selectionSeconds() : { start: 0, end: 0 };
        state.selection = { start: clamp(sel.start, 0, d), end: clamp(sel.end, 0, d) };
        if (playheadTime > d) playheadTime = d;
        lastOutputSig = null;
        if (editor) editor.render();
        scheduleSave();
        setButtonDisabledState(!hasAudio());
        if (!keepMacroWaveform && shouldUseMacroWaveform()) {
            scheduleMacroWaveformUpdate();
        }
    };

    const projectChanged = () => {
        if (playingSource || pausedPlayback) stopPlayback();
        syncControlsFromMaster();
        rebuildTimeline();
        if (refreshEffectsEditorFn) refreshEffectsEditorFn();
    };

    let fxCache = null;
    const fxStore = () => fxCache || (fxCache = SR.createRenderCache((IN_APP_WEBVIEW ? 96 : 512) * 1024 * 1024));
    const fxJobs = new Map();
    const fxFailed = new Map();
    let fxLock = Promise.resolve();
    let fxRebuildTimer = null;

    const runExclusive = (fn) => {
        const ctl = new AbortController();
        macroJobCtls.add(ctl);
        syncMacroCancelBtn();
        const guarded = () => (ctl.signal.aborted ? Promise.reject(macroCancelError()) : fn(ctl.signal));
        const run = fxLock.then(guarded, guarded);
        fxLock = run.catch(() => { });
        const done = () => {
            macroJobCtls.delete(ctl);
            syncMacroCancelBtn();
        };
        run.then(done, done);
        run.abort = () => ctl.abort();
        return run;
    };

    const clipFxKey = (c) => 'c|' + c.sourceId + '|' + c.offset + '|' + c.length + '|' + project.sampleRate + '|' + SR.chainSig(c.effects);
    const trackFxKey = (t) => 't|' + project.sampleRate + '|' + SR.chainSig(t.effects) + '|' + t.clips.map((c) => [
        c.sourceId, c.offset, c.length, c.start, c.gainDb,
        SM.hasFx(c) ? (fxStore().has(clipFxKey(c)) ? clipFxKey(c) : 'dry>' + SR.chainSig(c.effects)) : '',
    ].join(':')).join(',');

    const fxLiveKeys = () => {
        const keys = new Set();
        for (const t of project.tracks) {
            for (const c of t.clips) if (SM.hasFx(c)) keys.add(clipFxKey(c));
            if (SM.hasFx(t)) keys.add(trackFxKey(t));
        }
        return keys;
    };

    const scheduleFxRebuild = () => {
        if (fxRebuildTimer) clearTimeout(fxRebuildTimer);
        fxRebuildTimer = setTimeout(() => {
            fxRebuildTimer = null;
            rebuildTimeline();
        }, 60);
    };

    const queueFxRender = (key, label, input, items) => {
        if (fxJobs.has(key)) return fxJobs.get(key);
        const sr = project.sampleRate;
        const job = runExclusive(async (signal) => {
            if (!fxLiveKeys().has(key)) return;
            try {
                const data = typeof input === 'function' ? await input() : input;
                const out = await trackMacroJob(() => renderEffectChain(data, sr, items, ({ step, total, cmd, fraction }) =>
                    setMacroProgress(fraction, `${label} ${step}/${total}: ${cmd} (${Math.round(fraction * 100)}%)`), signal));
                let pcm = out.pcm;
                if (out.sampleRate !== sr) pcm = resamplePcmSinc(pcm, out.sampleRate, sr);
                if (!pcm || !pcm.length) throw new Error('the effects returned no audio');
                fxStore().set(key, pcm);
                setMacroProgress(1, `${label} ready.`);
            } catch (err) {
                fxFailed.set(key, err);
                setMacroProgress(1, '');
                if (isMacroCancelError(err)) cancelStatus(`${label} cancelled; playing the clip without its effects.`);
                else reportErrorStatus(`${label} failed; playing without them.`, err);
            }
        }).catch((err) => {
            fxFailed.set(key, err);
            cancelStatus(`${label} cancelled; playing the clip without its effects.`);
        }).finally(() => {
            fxJobs.delete(key);
            if (editor) editor.redraw();
            scheduleFxRebuild();
        });
        fxJobs.set(key, job);
        if (editor) editor.redraw();
        return job;
    };

    const tooLongForFx = (frames) => {
        const err = new Error(`effects need the audio in memory; keep it under ${(MACRO_MEM_FRAMES / project.sampleRate / 60).toFixed(1)} minutes`);
        return frames > MACRO_MEM_FRAMES ? err : null;
    };

    const fxResolve = {
        clip: (c) => {
            const key = clipFxKey(c);
            const hit = fxStore().get(key);
            if (hit) return hit.pcm;
            const src = project.sources.get(c.sourceId);
            if (!src || fxFailed.has(key)) return null;
            const input = SM.isDisk(src)
                ? async () => {
                    const err = tooLongForFx(c.length);
                    if (err) throw err;
                    return readDisk(src, c.offset, c.offset + c.length);
                }
                : src.pcm.slice(c.offset, c.offset + c.length);
            queueFxRender(key, 'Clip effects', input, c.effects.map(SR.cleanItem));
            return null;
        },
        track: (t) => {
            const key = trackFxKey(t);
            const hit = fxStore().get(key);
            if (hit) return hit.pcm;
            if (fxFailed.has(key)) return null;
            const onDisk = t.clips.some((c) => SM.isDisk(project.sources.get(c.sourceId)));
            const input = onDisk ? () => trackBusAsync(t) : SM.trackBus(project, t, fxResolve);
            queueFxRender(key, `${t.name} track effects`, input, t.effects.map(SR.cleanItem));
            return null;
        },
    };

    const diskFiles = new Map();
    const diskFile = async (name) => {
        let f = diskFiles.get(name);
        if (f) return f;
        const dir = await opfsHugeDir();
        f = await (await dir.getFileHandle(name)).getFile();
        diskFiles.set(name, f);
        return f;
    };

    const readDisk = async (src, a, b) => {
        a = Math.max(0, a);
        b = Math.min(src.length, b);
        if (b <= a) return new Float32Array(0);
        const file = await diskFile(src.file);
        return new Float32Array(await file.slice(a * 4, b * 4).arrayBuffer());
    };

    const diskSlices = async (tracks, a, b) => {
        const slices = new Map();
        for (const t of tracks) {
            for (const c of t.clips) {
                const src = project.sources.get(c.sourceId);
                if (!SM.isDisk(src)) continue;
                if (SM.hasFx(c) && fxStore().has(clipFxKey(c))) continue;
                const s = Math.max(a, c.start), e = Math.min(b, c.start + Math.min(c.length, SM.clipSpan(c)));
                if (e <= s) continue;
                const o0 = c.offset + (s - c.start);
                slices.set(c.id, { pcm: await readDisk(src, o0, o0 + (e - s)), offset: o0 });
            }
        }
        return (c) => slices.get(c.id) || null;
    };

    const mixRange = async (a, b) => {
        if (b <= a) return null;
        const source = await diskSlices(SM.audibleTracks(project), a, b);
        return SM.mixdown(project, a, b, { ...fxResolve, source });
    };

    const mixRangeChannels = async (a, b, stereo = outStereo()) => {
        if (b <= a) return null;
        if (!stereo) return [await mixRange(a, b)];
        const source = await diskSlices(SM.audibleTracks(project), a, b);
        if (!SM.isPanned(project)) {
            const m = SM.mixdown(project, a, b, { ...fxResolve, source });
            return [m, m];
        }
        return ['L', 'R'].map((side) => SM.mixdown(project, a, b, { ...fxResolve, source, side }));
    };

    const trackBusAsync = async (t) => {
        const n = SM.trackEnd(t);
        const err = tooLongForFx(n);
        if (err) throw err;
        const source = await diskSlices([t], 0, n);
        return SM.trackBus(project, t, { clip: fxResolve.clip, source });
    };

    const fxPeek = {
        clip: (c) => {
            const hit = fxStore().get(clipFxKey(c));
            return hit ? hit.pcm : null;
        },
    };

    const syncRenderedLengths = () => {
        for (const t of project.tracks) {
            for (const c of [...t.clips]) {
                if (!SM.hasFx(c)) continue;
                const hit = fxStore().get(clipFxKey(c));
                if (hit && c.outLen !== hit.pcm.length) SM.setRenderedLength(project, c.id, hit.pcm.length);
            }
        }
    };

    const fxMissing = () => {
        for (const t of SM.audibleTracks(project)) {
            for (const c of t.clips) {
                if (!SM.hasFx(c)) continue;
                const key = clipFxKey(c);
                if (!fxStore().has(key) && !fxFailed.has(key)) return true;
            }
            if (SM.hasFx(t)) {
                const key = trackFxKey(t);
                if (!fxStore().has(key) && !fxFailed.has(key)) return true;
            }
        }
        return false;
    };

    const queueMissingFx = () => {
        for (const t of SM.audibleTracks(project)) {
            for (const c of t.clips) if (SM.hasFx(c)) fxResolve.clip(c);
            if (SM.hasFx(t)) fxResolve.track(t);
        }
    };

    const ensureFxReady = async () => {
        for (let guard = 0; guard < 50; guard++) {
            if (fxJobs.size) {
                await Promise.all([...fxJobs.values()]);
                continue;
            }
            if (!fxMissing()) break;
            queueMissingFx();
            if (!fxJobs.size) break;
        }
        if (fxRebuildTimer) {
            clearTimeout(fxRebuildTimer);
            fxRebuildTimer = null;
            rebuildTimeline();
        }
    };

    const addSegment = (pcm, sampleRate, label, sourceText = '', adopt = false, role = 'voice') => {
        if (!pcm || !pcm.length) return;
        let finalPcm = pcm;
        if (sampleRate && sampleRate !== project.sampleRate) {
            finalPcm = resamplePcm(pcm, sampleRate, project.sampleRate);
            adopt = true;
        }
        const data = adopt ? finalPcm : new Float32Array(finalPcm);
        editHistory.push(project, `add ${label || 'audio'}`);
        let trackId = editor ? editor.targetTrackId(role) : null;
        if (!trackId || !SM.findTrack(project, trackId)) {
            const t = project.tracks.find((x) => x.role === role) || project.tracks[0] || SM.addTrack(project, role);
            trackId = t.id;
        }
        const sid = SM.addSource(project, data, label || 'Clip');
        const clip = SM.appendClip(project, trackId, sid, { label: label || 'Clip', text: sourceText || '' });
        projectChanged();
        if (editor && clip) {
            editor.selectClip(clip.id);
            const t = SM.findTrack(project, trackId);
            editor.announce(`Added ${label || 'audio'} clip, ${(clip.length / project.sampleRate).toFixed(2)} seconds, to ${t ? t.name : 'track'}.`);
        }
    };

    const addSilence = () => {
        const secs = parseFloat(silenceInput?.value || '0');
        if (Number.isNaN(secs) || secs <= 0) {
            if (silenceStatus) silenceStatus.textContent = 'Enter a silence length greater than 0.';
            return;
        }
        const samples = Math.max(1, Math.round(secs * state.sampleRate));
        const pcm = new Float32Array(samples);
        addSegment(pcm, state.sampleRate, 'Silence', `Silence ${secs.toFixed(2)}s`);
        if (silenceStatus) silenceStatus.textContent = `Added ${secs.toFixed(2)}s of silence.`;
        setButtonDisabledState(false);
        drawWaveform();
    };

    const drawWaveform = () => {
        syncEditorMode();
        if (!editor) return;
        const out = getWaveformRenderData();
        const sig = out.pcm ? `${out.pcm.length}|${getExportGain()}|${macroWaveformActiveKey || ''}` : '';
        if (sig !== lastOutputSig || out.pcm !== lastOutputPcmRef) {
            lastOutputSig = sig;
            lastOutputPcmRef = out.pcm;
            editor.refreshOutput();
        } else {
            editor.tick();
        }
    };

    const getMacroPreviewAbsoluteTime = () => {
        if (playingMode !== 'macro-preview') return null;
        const macroAudio = macroPreviewPlayback?.audio
            || (typeof playingSource?.currentTime === 'number' ? playingSource : null);
        if (macroAudio && typeof macroAudio.currentTime === 'number' && Number.isFinite(macroAudio.currentTime)) {
            return Math.max(0, macroAudio.currentTime + (macroPreviewPlayback?.offset || 0));
        }
        return null;
    };

    const getNeedleTime = () => {
        if (playingSource && playSpan > 0) {
            const macroT = getMacroPreviewAbsoluteTime();
            if (macroT !== null) return macroT;
            const ctxAudio = audioCtx || getAudioCtx();
            const elapsed = Math.max(0, ctxAudio.currentTime - playStartedAt);
            return Math.min(playStartOffset + elapsed, playStartOffset + playSpan);
        }
        return clamp(playheadTime, 0, duration());
    };

    const updatePlaybackMarker = () => {
        if (!playingSource || playSpan <= 0) return;
        drawWaveform();
    };


    const stopPlayback = ({ preserveMacroPreview = false } = {}) => {
        stopDiskPlayback();
        const isMacroPreviewActive = playingMode === 'macro-preview';
        const hasPausedMacroPreview = !!macroPreviewPlayback && !isMacroPreviewActive;
        const shouldHandleMacroPreview = isMacroPreviewActive || (hasPausedMacroPreview && !preserveMacroPreview);
        const macroAudio = shouldHandleMacroPreview
            ? (macroPreviewPlayback?.audio || (isMacroPreviewActive ? playingSource : null))
            : null;
        if (playingSource) {
            try {
                playingSource.onended = null;
                playingSource.stop();
            } catch (err) {
                persistStatus(err, false);
            }
        }
        playingSource = null;
        playingMode = null;
        pausedPlayback = null;
        playSpan = 0;
        syncPlayButtons();
        if (!editor) rebuildTimeline({ preserveMacroWaveform: true });
        drawWaveform();
        if (shouldHandleMacroPreview) {
            if (!playingSource && macroAudio) {
                try {
                    if (typeof macroAudio.pause === 'function') macroAudio.pause();
                } catch (err) {
                    reportErrorStatus(`Failed to pause macro preview audio during stop: ${err}`, err);
                }
                try {
                    macroAudio.currentTime = 0;
                } catch (err) {
                    reportErrorStatus(`Failed to reset macro preview audio during stop: ${err}`, err);
                }
                macroPreviewPlayback?.cleanup?.();
            }
            clearMacroPreviewInterval();
            macroPreviewPlayback = null;
            resetPreviewMacroButton();
        }
    };

    const pausePlayback = () => {
        if (!playingSource) return;
        const wasMacroPreview = playingMode === 'macro-preview';
        if (wasMacroPreview && pauseMacroPreview()) {
            return;
        }
        const ctxAudio = audioCtx || getAudioCtx();
        const elapsed = Math.max(0, ctxAudio.currentTime - playStartedAt);
        const endPos = playStartOffset + playSpan;
        const resumeFrom = Math.min(endPos, playStartOffset + elapsed);
        pausedPlayback = playingMode ? { mode: playingMode, resumeFrom, end: endPos } : null;
        try {
            playingSource.onended = null;
            playingSource.stop();
        }

        catch (err) {
            persistStatus(err, false);
        }
        playingSource = null;
        playingMode = null;
        syncPlayButtons();
        if (wasMacroPreview) {
            resetPreviewMacroButton();
        }
    };

    const getPlaybackPcm = () => {
        if (editor && stereoPanned()) {
            const chans = outputChannels();
            const macroId = (typeof getSelectedMacroId === 'function' ? getSelectedMacroId() : 'FLAT') || 'FLAT';
            const out = masterBypass ? chans : chans.map((c) => applyExportFxToPcm(c, state.sampleRate, macroId));
            return { pcm: out[0], chans: out, sampleRate: state.sampleRate };
        }
        if (editor && masterBypass) return { pcm: state.pcm, sampleRate: state.sampleRate };
        if (editor && macroWaveformPcm && macroWaveformActiveKey && shouldUseMacroWaveform() && macroWaveformActiveKey === getMacroWaveformKey()) {
            return { pcm: macroWaveformPcm, sampleRate: macroWaveformSampleRate || state.sampleRate };
        }
        const macroId = (typeof getSelectedMacroId === 'function' ? getSelectedMacroId() : 'FLAT') || 'FLAT';
        return { pcm: applyExportFxToPcm(state.pcm, state.sampleRate, macroId), sampleRate: state.sampleRate };
    };

    const startBufferPlayback = async (mode, start, endPos, src = getPlaybackPcm()) => {
        const srcDur = src.pcm.length / src.sampleRate;
        const end = Math.min(endPos, srcDur);
        const len = Math.max(0.001, end - start);
        if (start >= srcDur || end <= start) return null;
        if (playingSource) stopPlayback();
        const ctxAudio = getAudioCtx();
        if (ctxAudio.state === 'suspended') await ctxAudio.resume();
        const chans = src.chans || [src.pcm];
        const buffer = ctxAudio.createBuffer(chans.length, src.pcm.length, src.sampleRate);
        const limited = finishChans(chans, src.sampleRate, exportGainFactor());
        if (limited) limited.chans.forEach((c, ch) => buffer.getChannelData(ch).set(c));
        else chans.forEach((c, ch) => applyGainToAudioBuffer(buffer, c, getExportGain(), ch));
        const source = ctxAudio.createBufferSource();
        source.buffer = buffer;
        source.connect(ctxAudio.destination);
        source.start(0, start, len);
        playingSource = source;
        playingMode = mode;
        playStartOffset = start;
        playSpan = len;
        playStartedAt = ctxAudio.currentTime;
        const playbackInterval = setInterval(updatePlaybackMarker, 1);
        pausedPlayback = null;
        syncPlayButtons();
        source.onended = () => {
            playingSource = null;
            playingMode = null;
            pausedPlayback = null;
            playSpan = 0;
            playStartOffset = 0;
            clearInterval(playbackInterval);
            drawWaveform();
            syncPlayButtons();
        };
        return source;
    };

    let diskPlayer = null;

    const materializeTimelineRange = async (aFrame, bFrame) => {
        if (bFrame - aFrame <= 0) return null;
        try {
            return await mixRange(aFrame, bFrame);
        } catch (e) {
            persistStatus('Not enough memory to apply this effect. Trim to a shorter selection.', false);
            return null;
        }
    };

    const stopDiskPlayback = () => {
        const p = diskPlayer;
        diskPlayer = null;
        if (!p) return;
        p.stopped = true;
        if (p.marker) clearInterval(p.marker);
        for (const s of p.sources) {
            try { s.onended = null; s.stop(); } catch (_) {}
            try { s.disconnect(); } catch (_) {}
        }
        p.sources.length = 0;
    };

    const streamDiskTimeline = async (startTime, endTime, mode) => {
        stopPlayback();
        const sr = project.sampleRate || 44100;
        const a = Math.max(0, Math.floor(startTime * sr));
        const b = Math.min(SM.projectLength(project), Math.floor(endTime * sr));
        if (b <= a) return;
        const ctxAudio = getAudioCtx();
        if (ctxAudio.state === 'suspended') await ctxAudio.resume();
        const gain = getExportGain();
        const applyGain = Math.abs(gain - 1) > EXPORT_GAIN_TOLERANCE;
        const CHUNK = Math.max(1, Math.floor(sr * 2));

        const player = { sources: [], stopped: false, pumping: false, cursor: a, done: false, scheduleTime: ctxAudio.currentTime + 0.15, marker: null, lim: limitOn() ? SL.createLimiter({ sampleRate: sr }) : null };
        diskPlayer = player;

        playingMode = mode;
        playStartOffset = startTime;
        playSpan = (b - a) / sr;
        playStartedAt = player.scheduleTime;
        playingSource = { stop: stopDiskPlayback, disconnect: () => {}, __disk: true };

        const finish = () => {
            if (diskPlayer !== player) return;
            stopDiskPlayback();
            playingSource = null;
            playingMode = null;
            playSpan = 0;
            syncPlayButtons();
            drawWaveform();
        };

        const pump = async () => {
            if (player.stopped || diskPlayer !== player || player.pumping) return;
            player.pumping = true;
            try {
                while (!player.stopped && (player.scheduleTime - ctxAudio.currentTime) < 3.0) {
                    if (player.cursor >= b) { player.done = true; break; }
                    const n = Math.min(CHUNK, b - player.cursor);
                    let chans;
                    const ahead = player.lim ? Math.min(player.lim.lookahead, b - player.cursor - n) : 0;
                    try { chans = await mixRangeChannels(player.cursor, player.cursor + n + ahead, stereoPanned()); }
                    catch (e) { persistStatus('Could not read the audio from storage.', false); player.done = true; break; }
                    if (player.stopped || diskPlayer !== player) return;
                    if (player.lim) chans = player.lim.process(chans, 0, n, applyGain ? gain : 1);
                    const abuf = ctxAudio.createBuffer(chans.length, Math.max(1, chans[0].length), sr);
                    chans.forEach((f32, ch) => {
                        const chd = abuf.getChannelData(ch);
                        if (applyGain && !player.lim) {
                            for (let i = 0; i < f32.length; i++) { let v = f32[i] * gain; if (v > 1) v = 1; else if (v < -1) v = -1; chd[i] = v; }
                        } else {
                            chd.set(f32);
                        }
                    });
                    if (player.scheduleTime < ctxAudio.currentTime + 0.02) player.scheduleTime = ctxAudio.currentTime + 0.05;
                    const s = ctxAudio.createBufferSource();
                    s.buffer = abuf;
                    s.connect(ctxAudio.destination);
                    s.start(player.scheduleTime);
                    s.onended = () => {
                        const i = player.sources.indexOf(s);
                        if (i >= 0) player.sources.splice(i, 1);
                        try { s.disconnect(); } catch (_) {}
                        if (!player.stopped && player.done && player.sources.length === 0) finish();
                    };
                    player.sources.push(s);
                    player.scheduleTime += abuf.duration;
                    player.cursor += n;
                }
            } finally {
                player.pumping = false;
            }
        };

        player.marker = setInterval(() => {
            if (player.stopped || diskPlayer !== player) return;
            updatePlaybackMarker();
            pump().catch(() => {});
        }, 30);
        await pump();
        syncPlayButtons();
    };

    const playSelection = async () => {
        if (state.disk) {
            const selStart = state.selection.start;
            const selEnd = (state.selection.end > selStart) ? state.selection.end : duration();
            const resume = (pausedPlayback && pausedPlayback.mode === 'selection'
                && pausedPlayback.resumeFrom >= selStart - 1e-6 && pausedPlayback.resumeFrom < selEnd)
                ? pausedPlayback.resumeFrom : null;
            await streamDiskTimeline(resume != null ? resume : selStart, selEnd, 'selection');
            return;
        }
        if (!state.pcm.length) return;
        const blob = pcmToWav(state.pcm, state.sampleRate);
        window.blob = blob;
        const selectionStart = state.selection.start;
        const selectionLen = Math.max(0.001, state.selection.end - state.selection.start || duration());
        const selectionEnd = selectionStart + selectionLen;
        const resumeInfo = (pausedPlayback && pausedPlayback.mode === 'selection' && pausedPlayback.resumeFrom >= selectionStart && pausedPlayback.resumeFrom <= selectionEnd)
            ? pausedPlayback
            : null;
        const playheadInSelection = playheadTime > selectionStart && playheadTime < selectionEnd;
        const start = resumeInfo ? resumeInfo.resumeFrom : (playheadInSelection ? playheadTime : selectionStart);
        const endPos = resumeInfo ? Math.min(selectionEnd, resumeInfo.end) : selectionEnd;
        if (start >= duration() || endPos <= start) return;
        await startBufferPlayback('selection', start, endPos);
    };

    const playWholeFile = async () => {
        if (state.disk) {
            const d = duration();
            const resume = (pausedPlayback && pausedPlayback.mode === 'all'
                && pausedPlayback.resumeFrom > 0 && pausedPlayback.resumeFrom < d)
                ? pausedPlayback.resumeFrom : null;
            await streamDiskTimeline(resume != null ? resume : 0, d, 'all');
            return;
        }
        if (!state.pcm.length) return;
        const resumeInfo = pausedPlayback && pausedPlayback.mode === 'all' ? pausedPlayback : null;
        const start = resumeInfo ? resumeInfo.resumeFrom : clamp(playheadTime, 0, duration());
        const src = getPlaybackPcm();
        const endPos = Math.max(duration(), src.pcm.length / src.sampleRate);
        if (start >= endPos) return;
        await startBufferPlayback('all', start, endPos, src);
    };

    const pcmToWav = (pcm, sampleRate) => SW.encodeWav([pcm], sampleRate, 'pcm16', exportGainFactor());

    const bindOutputControls = () => {
        const formatSel = panel.querySelector('#spliceOutFormat');
        const channelSel = panel.querySelector('#spliceOutChannels');
        const limBox = panel.querySelector('#spliceOutLimit');
        if (!formatSel || !channelSel || !limBox) return;
        const rateRow = panel.querySelector('#spliceOutBitrateRow');
        const rateSel = panel.querySelector('#spliceOutBitrate');
        const changed = () => {
            saveOutputPrefs();
            macroRenderBlobCache = null;
            if (playingSource || pausedPlayback) stopPlayback();
        };
        const syncRates = () => {
            if (!rateSel || !rateRow) return;
            const info = outInfo();
            rateRow.hidden = !info.bitrates;
            rateSel.replaceChildren(...(info.bitrates || []).map((k) => new Option(`${k} kbps${k === info.bitrate ? ' (default)' : ''}`, String(k))));
            if (info.bitrates) rateSel.value = String(outBitrate());
        };
        for (const [k, f] of Object.entries(SE.FORMATS)) formatSel.add(new Option(f.label, k));
        formatSel.value = outFormat();
        channelSel.value = String(outputPrefs.channels);
        limBox.checked = limitOn();
        syncRates();
        for (const opt of [...formatSel.options]) {
            SE.canEncode(opt.value).then((ok) => {
                if (ok) return;
                opt.disabled = true;
                opt.hidden = true;
                if (formatSel.value === opt.value) {
                    formatSel.value = 'pcm16';
                    outputPrefs.format = 'pcm16';
                    syncRates();
                    changed();
                }
            });
        }
        formatSel.addEventListener('change', () => {
            outputPrefs.format = SE.formatOf(formatSel.value);
            syncRates();
            changed();
        });
        rateSel?.addEventListener('change', () => {
            outputPrefs.bitrates = { ...outputPrefs.bitrates, [outFormat()]: Number(rateSel.value) };
            changed();
        });
        channelSel.addEventListener('change', () => {
            outputPrefs.channels = channelSel.value === '2' ? 2 : 1;
            changed();
        });
        limBox.addEventListener('change', () => {
            outputPrefs.limit = limBox.checked;
            changed();
        });
    };
    bindOutputControls();

    const exportWavDisk = async () => {
        const sr = project.sampleRate || 44100;
        if (fxJobs.size || fxMissing()) {
            persistStatus('Finishing clip and track effects before export...');
            await ensureFxReady();
        }
        const totalFrames = SM.projectLength(project);
        if (totalFrames <= 0) return;
        const fmt = outFormat();
        const info = outInfo();
        let outFh, writable;
        try {
            const dir = await opfsHugeDir();
            outFh = await dir.getFileHandle('export.' + info.ext, { create: true });
            writable = await outFh.createWritable();
        } catch (e) { persistStatus('Could not open device storage for export.', false); return; }

        persistStatus(`Exporting ${info.name}...`);
        const nch = outStereo() ? 2 : 1;
        const gain = exportGainFactor();
        const lim = limitOn() ? SL.createLimiter({ sampleRate: sr }) : null;
        let over = 1;
        const CHUNK = 1 << 20;
        let out = null;
        try {
            out = await SE.createWriter(fmt, { sampleRate: sr, channels: nch, frames: totalFrames, bitrate: outBitrate(), sink: writable });
            for (let pos = 0; pos < totalFrames; pos += CHUNK) {
                const n = Math.min(CHUNK, totalFrames - pos);
                const ahead = lim ? Math.min(lim.lookahead, totalFrames - pos - n) : 0;
                const chans = await mixRangeChannels(pos, pos + n + ahead);
                if (lim) {
                    await out.write(lim.process(chans, 0, n, gain), 0, n, 1);
                } else {
                    over = Math.max(over, SL.peakRatio(chans, gain));
                    await out.write(chans, 0, n, gain);
                }
                persistStatus(`Exporting ${info.name}... ` + Math.round(((pos + n) / totalFrames) * 100) + '%');
                await new Promise((rr) => setTimeout(rr));
            }
            await out.finish();
        } catch (e) {
            if (out) await out.cancel();
            try { await writable.close(); } catch (_) {}
            reportErrorStatus('Export failed.', e);
            return;
        }

        let outFile;
        try { outFile = await outFh.getFile(); } catch (e) { spokenStatus('Export failed while reading back.', false); return; }
        try {
            await saveFile(outFileName('splice'), outFile, info.mime);
            spokenStatus(`${info.name} exported!` + overNote(lim ? lim.over : over, !!lim, fmt), true);
        } catch (e) {
            spokenStatus('Export save failed: ' + e + '.', false);
        }
    };

    const renderMixBlob = async () => {
        if (fxJobs.size || fxMissing()) {
            persistStatus('Finishing clip and track effects before export...');
            await ensureFxReady();
        }
        const chans = outputChannels();
        const info = outInfo();
        const limited = finishChans(chans, state.sampleRate, exportGainFactor());
        persistStatus(`Exporting ${info.name}...`);
        let blob;
        try {
            blob = await SE.encodeAll(limited ? limited.chans : chans, state.sampleRate, outFormat(),
                { gain: limited ? 1 : exportGainFactor(), bitrate: outBitrate() });
        } catch (err) {
            reportErrorStatus(`${info.name} export failed.`, err);
            return null;
        }
        const over = limited ? limited.over : SL.peakRatio(chans, exportGainFactor());
        return { blob, info, over, limited };
    };

    const sendMixToDecoder = async () => {
        if (state.disk) throw new Error('This project is too large to send. Export it, then load the file in the Decoder.');
        if (!state.pcm.length) throw new Error('The project is empty.');
        const mix = await renderMixBlob();
        if (!mix) return null;
        persistStatus('Sent the mix to the Decoder.', true);
        return { audio: audioFile(mix.blob, outFileName('splice'), mix.info.mime) };
    };

    const exportWav = async () => {
        if (state.disk) {
            await exportWavDisk();
            return;
        }
        if (!state.pcm.length) return;
        const mix = await renderMixBlob();
        if (!mix) return;
        const { blob, info, over, limited } = mix;
        await saveFile(outFileName('splice'), blob, info.mime);
        const doneMsg = `${info.name} exported!` + overNote(over, !!limited, outFormat());
        spokenStatus(doneMsg, true);
        const intervalId2 = setInterval(() => persistStatus(doneMsg, true), 5);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        clearInterval(intervalId2);
    };

    const IN_APP_WEBVIEW = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '')
        || (/Macintosh/.test(navigator.userAgent || '') && (navigator.maxTouchPoints || 0) > 1);
    const MAX_PCM_BYTES = (IN_APP_WEBVIEW ? 384 : 1400) * 1024 * 1024;
    const MAX_LOAD_FILE_BYTES = (IN_APP_WEBVIEW ? 384 : 2048) * 1024 * 1024;
    const DECODE_FILE_LIMIT = (IN_APP_WEBVIEW ? 48 : 400) * 1024 * 1024;
    const MACRO_MEM_FRAMES = (IN_APP_WEBVIEW ? 10 : 96) * 1024 * 1024;
    const MACRO_STREAM_W = 262144;
    const STREAM_WIN_FRAMES = (IN_APP_WEBVIEW ? 4 : 32) * 1024 * 1024;
    const MACRO_CHUNK_SAFE = new Set([
        'Amplify', 'Invert', 'High-passFilter', 'Low-passFilter', 'BassAndTreble',
        'ParametricEq', 'NotchFilter', 'ChebyshevTypeIFilter', 'MultibandEq',
        'FilterCurve', 'GraphicEq', 'Distortion', 'Clipper', 'TapeSaturationLimiter',
        'PopMute', 'NoiseGate', 'HarmonicEnhancer',
    ]);

    const readWavStructure = async (file) => {
        const readDV = async (off, len) =>
            new DataView(await file.slice(off, off + len).arrayBuffer());
        if (file.size < 44) return null;
        const head = await readDV(0, 12);
        if (head.getUint32(0, false) !== 0x52494646 || head.getUint32(8, false) !== 0x57415645) {
            return null;
        }
        let offset = 12, fmt = null, dataOffset = -1, dataSize = 0;
        while (offset + 8 <= file.size) {
            const hdr = await readDV(offset, 8);
            const id = hdr.getUint32(0, false);
            const size = hdr.getUint32(4, true);
            const body = offset + 8;
            if (id === 0x666d7420) {
                const f = await readDV(body, Math.min(Math.max(size, 16), 40));
                let audioFormat = f.getUint16(0, true);
                if (audioFormat === 0xFFFE && size >= 40) audioFormat = f.getUint16(24, true);
                fmt = {
                    audioFormat,
                    channels: f.getUint16(2, true),
                    sampleRate: f.getUint32(4, true),
                    bitsPerSample: f.getUint16(14, true),
                };
            } else if (id === 0x64617461) {
                dataOffset = body; dataSize = size; break;
            }
            if (size <= 0) break;
            offset = body + size + (size & 1);
        }
        if (!fmt || dataOffset < 0) return null;
        return { fmt, dataOffset, dataSize };
    };

    const loadWavMonoFloat32 = async (file) => {
        const info = await readWavStructure(file);
        if (!info) return null;
        const { audioFormat, channels, sampleRate, bitsPerSample } = info.fmt;
        if (!channels || !sampleRate || !bitsPerSample) return null;
        const isFloat = audioFormat === 3;
        const isPcmInt = audioFormat === 1;
        if (!isFloat && !isPcmInt) return null;
        const bytesPerSample = bitsPerSample >> 3;
        const frameBytes = bytesPerSample * channels;
        if (frameBytes <= 0) return null;
        const dataSize = Math.min(info.dataSize || (file.size - info.dataOffset), file.size - info.dataOffset);
        const numFrames = Math.floor(dataSize / frameBytes);
        if (numFrames <= 0) return null;
        if (numFrames * 4 > MAX_PCM_BYTES) {
            const gb = (numFrames * 4 / (1024 * 1024 * 1024)).toFixed(1);
            persistStatus(`File too large to load on this device (needs ~${gb} GB). Try a shorter clip or a lower sample rate.`);
            return { tooLarge: true };
        }
        let out;
        try {
            out = new Float32Array(numFrames);
        } catch (e) {
            persistStatus('File too large to load on this device.');
            return { tooLarge: true };
        }
        const CHUNK_FRAMES = 1 << 20;
        let frame = 0, pos = info.dataOffset;
        while (frame < numFrames) {
            const framesThis = Math.min(CHUNK_FRAMES, numFrames - frame);
            const slice = await file.slice(pos, pos + framesThis * frameBytes).arrayBuffer();
            if (isFloat && bitsPerSample === 32) {
                const f32 = new Float32Array(slice);
                if (channels === 1) out.set(f32.subarray(0, framesThis), frame);
                else for (let i = 0; i < framesThis; i++) out[frame + i] = f32[i * channels];
            } else if (isPcmInt && bitsPerSample === 16) {
                const i16 = new Int16Array(slice);
                for (let i = 0; i < framesThis; i++) out[frame + i] = i16[i * channels] / 32768;
            } else {
                const dv = new DataView(slice);
                for (let i = 0; i < framesThis; i++) {
                    const so = i * frameBytes;
                    let v;
                    if (isFloat && bitsPerSample === 64) v = dv.getFloat64(so, true);
                    else if (bitsPerSample === 8) v = (dv.getUint8(so) - 128) / 128;
                    else if (bitsPerSample === 24) {
                        let x = dv.getUint8(so) | (dv.getUint8(so + 1) << 8) | (dv.getUint8(so + 2) << 16);
                        if (x & 0x800000) x -= 0x1000000;
                        v = x / 8388608;
                    } else if (isPcmInt && bitsPerSample === 32) v = dv.getInt32(so, true) / 2147483648;
                    else return null;
                    out[frame + i] = v;
                }
            }
            frame += framesThis;
            pos += framesThis * frameBytes;
            await new Promise((r) => setTimeout(r));
        }
        return { pcm: out, sampleRate };
    };

    const HUGE_PEAK_BUCKET = 1024;
    const HUGE_OPFS_DIR = 'splicer-huge';

    const opfsSupported = () => !!(navigator.storage && navigator.storage.getDirectory);

    const opfsHugeDir = async () => {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle(HUGE_OPFS_DIR, { create: true });
    };

    const importingFiles = new Set();

    const savedDiskFiles = async () => {
        const keep = new Set();
        const dbp = getDb();
        if (!dbp) return keep;
        const db = await dbp;
        const rows = await new Promise((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
        for (const row of rows) for (const s of (row && row.sources) || []) if (s && s.kind === 'disk') keep.add(s.file);
        return keep;
    };

    const sweepDiskFiles = async () => {
        if (!opfsSupported()) return;
        try {
            const keep = await savedDiskFiles();
            for (const name of SM.diskFiles(project)) keep.add(name);
            for (const name of importingFiles) keep.add(name);
            const dir = await opfsHugeDir();
            const names = [];
            for await (const name of dir.keys()) names.push(name);
            for (const name of names) {
                if (keep.has(name)) continue;
                await dir.removeEntry(name).catch(() => { });
                diskFiles.delete(name);
            }
        } catch (_) { }
    };

    const missingDiskFiles = async (p) => {
        const missing = new Set();
        if (!opfsSupported()) return missing;
        let dir = null;
        try { dir = await opfsHugeDir(); } catch (_) { }
        for (const name of SM.diskFiles(p)) {
            try { await dir.getFileHandle(name); } catch (_) { missing.add(name); }
        }
        return missing;
    };

    const dropMissingDisk = async (p) => {
        const missing = await missingDiskFiles(p);
        if (!missing.size) return 0;
        const gone = (c) => {
            const s = p.sources.get(c.sourceId);
            return SM.isDisk(s) && missing.has(s.file);
        };
        let n = 0;
        for (const t of p.tracks) {
            const before = t.clips.length;
            t.clips = t.clips.filter((c) => !gone(c));
            n += before - t.clips.length;
        }
        for (const [id, s] of [...p.sources]) if (SM.isDisk(s) && missing.has(s.file)) p.sources.delete(id);
        return n;
    };

    const linearResampler = (inRate, outRate) => {
        const step = inRate / outRate;
        let t = 0, base = 0, last = 0;
        return (x) => {
            const end = base + x.length;
            const out = new Float32Array(Math.ceil(x.length / step) + 2);
            let n = 0;
            while (t + 1 < end) {
                const i = Math.floor(t);
                const f = t - i;
                const s0 = i < base ? last : x[i - base];
                const s1 = x[i + 1 - base];
                out[n++] = s0 + (s1 - s0) * f;
                t += step;
            }
            last = x[x.length - 1];
            base = end;
            return out.subarray(0, n);
        };
    };

    const decodeMonoChunk = (slice, framesThis, channels, frameBytes, isFloat, isPcmInt, bitsPerSample) => {
        const mono = new Float32Array(framesThis);
        if (isFloat && bitsPerSample === 32) {
            const f32 = new Float32Array(slice);
            if (channels === 1) mono.set(f32.subarray(0, framesThis));
            else for (let i = 0; i < framesThis; i++) mono[i] = f32[i * channels];
        } else if (isPcmInt && bitsPerSample === 16) {
            const i16 = new Int16Array(slice);
            for (let i = 0; i < framesThis; i++) mono[i] = i16[i * channels] / 32768;
        } else {
            const dv = new DataView(slice);
            for (let i = 0; i < framesThis; i++) {
                const so = i * frameBytes;
                let v;
                if (isFloat && bitsPerSample === 64) v = dv.getFloat64(so, true);
                else if (bitsPerSample === 8) v = (dv.getUint8(so) - 128) / 128;
                else if (bitsPerSample === 24) {
                    let x = dv.getUint8(so) | (dv.getUint8(so + 1) << 8) | (dv.getUint8(so + 2) << 16);
                    if (x & 0x800000) x -= 0x1000000;
                    v = x / 8388608;
                } else if (isPcmInt && bitsPerSample === 32) v = dv.getInt32(so, true) / 2147483648;
                else v = 0;
                mono[i] = v;
            }
        }
        return mono;
    };

    const wavLayout = (file, info) => {
        if (!info) return { error: 'Could not read this WAV for large-file loading. Re-export it as 16-bit PCM WAV.' };
        const { audioFormat, channels, sampleRate, bitsPerSample } = info.fmt;
        const isFloat = audioFormat === 3, isPcmInt = audioFormat === 1;
        if ((!isFloat && !isPcmInt) || !channels || !sampleRate || !bitsPerSample) {
            return { error: 'This WAV format is not supported for large-file loading. Re-export it as 16-bit PCM WAV.' };
        }
        const frameBytes = (bitsPerSample >> 3) * channels;
        if (frameBytes <= 0) return { error: 'This WAV format is not supported for large-file loading. Re-export it as 16-bit PCM WAV.' };
        const dataSize = Math.min(info.dataSize || (file.size - info.dataOffset), file.size - info.dataOffset);
        const numFrames = Math.floor(dataSize / frameBytes);
        if (numFrames <= 0) return { error: 'This file has no audio data.' };
        return { channels, sampleRate, bitsPerSample, isFloat, isPcmInt, frameBytes, numFrames, dataOffset: info.dataOffset };
    };

    const streamWavToDisk = async (file, L, progressLabel, outRate = project.sampleRate) => {
        let fh, writable;
        try {
            const dir = await opfsHugeDir();
            fh = await dir.getFileHandle('src-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.f32', { create: true });
            importingFiles.add(fh.name);
            writable = await fh.createWritable();
        } catch (e) {
            if (fh) importingFiles.delete(fh.name);
            throw new Error('Could not open device storage for the large file.');
        }
        const { channels, sampleRate, bitsPerSample, isFloat, isPcmInt, frameBytes, numFrames } = L;
        const sourceName = fh.name;
        const resample = sampleRate !== outRate ? linearResampler(sampleRate, outRate) : null;
        const peakList = [];
        let lo = 1, hi = -1, inBucket = 0, written = 0;

        const CHUNK_FRAMES = 1 << 20;
        let frame = 0, pos = L.dataOffset;
        try {
            while (frame < numFrames) {
                const framesThis = Math.min(CHUNK_FRAMES, numFrames - frame);
                const slice = await file.slice(pos, pos + framesThis * frameBytes).arrayBuffer();
                let mono = decodeMonoChunk(slice, framesThis, channels, frameBytes, isFloat, isPcmInt, bitsPerSample);
                if (resample) mono = resample(mono);
                await writable.write(new Uint8Array(mono.buffer, mono.byteOffset, mono.length * 4));
                for (let i = 0; i < mono.length; i++) {
                    const v = mono[i];
                    if (v < lo) lo = v;
                    if (v > hi) hi = v;
                    if (++inBucket === HUGE_PEAK_BUCKET) {
                        peakList.push(lo, hi);
                        lo = 1; hi = -1; inBucket = 0;
                    }
                }
                written += mono.length;
                frame += framesThis;
                pos += framesThis * frameBytes;
                persistStatus(progressLabel + Math.round((frame / numFrames) * 100) + '%');
                await new Promise((r) => setTimeout(r));
            }
            if (inBucket) peakList.push(lo, hi);
            await writable.close();
        } catch (e) {
            try { await writable.close(); } catch (_) { }
            importingFiles.delete(sourceName);
            sweepDiskFiles();
            throw new Error('Failed while loading the large file.');
        }
        return { file: sourceName, length: written, peaks: Float32Array.from(peakList), bucket: HUGE_PEAK_BUCKET };
    };

    const loadHugeWav = async (file) => {
        const L = wavLayout(file, await readWavStructure(file));
        if (L.error) {
            persistStatus(L.error);
            return;
        }
        let disk;
        try {
            disk = await streamWavToDisk(file, L, 'Loading large file... ');
        } catch (e) {
            persistStatus(e.message || String(e));
            return;
        }
        const sourceName = disk.file;
        const written = disk.length;
        const outRate = project.sampleRate;
        editHistory.push(project, `add ${file.name || 'large file'}`);
        const sid = SM.addDiskSource(project, disk, file.name || 'File');
        importingFiles.delete(sourceName);
        let trackId = editor ? editor.targetTrackId('voice') : null;
        if (!trackId || !SM.findTrack(project, trackId)) trackId = (project.tracks[0] || SM.addTrack(project, 'voice')).id;
        const clip = SM.appendClip(project, trackId, sid, { label: file.name || 'File' });
        projectChanged();
        if (editor && clip) editor.selectClip(clip.id);
        const mins = written / outRate / 60;
        const fxMin = (MACRO_MEM_FRAMES / outRate / 60).toFixed(1);
        persistStatus('Loaded ' + (file.size / 1048576).toFixed(0) + ' MB (' + mins.toFixed(1) + ' min) from device storage. Editing, playback and export work at any length; effects work on clips, tracks and selections up to ' + fxMin + ' min.', true);
    };

    const PROJECT_APP = 'eas-tools-splicer';
    const PROJECT_FILE_FORMAT = 1;

    const exportProjectFile = async (name) => {
        const live = SM.referencedSourceIds(project);
        if (!live.size) {
            spokenStatus('Add some audio before exporting the project file.', false);
            return false;
        }
        persistStatus('Packing the project...');
        const sr = project.sampleRate;
        const sources = [];
        const entries = [];
        for (const id of live) {
            const s = project.sources.get(id);
            if (!s) continue;
            const file = `sources/${id}.wav`;
            const length = SM.srcLength(s);
            const body = SM.isDisk(s) ? await diskFile(s.file) : new Uint8Array(s.pcm.buffer, s.pcm.byteOffset, s.pcm.byteLength);
            entries.push({ name: file, blob: new Blob([SW.wavHeader(length, sr, 1, 'float32'), body]) });
            sources.push({ id, label: s.label || '', meta: s.meta || null, file, length });
        }
        const snap = SM.snapshot(project);
        const doc = { app: PROJECT_APP, format: PROJECT_FILE_FORMAT, version: 3, sampleRate: sr, tracks: snap.tracks, markers: snap.markers, master: snap.master, sources };
        entries.unshift({ name: 'project.json', blob: new Blob([JSON.stringify(doc)], { type: 'application/json' }) });
        let zip;
        try {
            zip = await SZ.buildZip(entries, { onProgress: (n, total) => persistStatus('Packing the project... ' + Math.round((n / Math.max(1, total)) * 100) + '%') });
        } catch (err) {
            spokenStatus(err.message || String(err), false);
            return false;
        }
        const base = String(name || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'splicer-project';
        await saveFile(base + '.zip', zip, 'application/zip');
        spokenStatus(`Project file exported: ${sources.length} source${sources.length === 1 ? '' : 's'}, ${(zip.size / 1048576).toFixed(1)} MB.`, true);
        return true;
    };

    const importProjectFile = async (file) => {
        const files = await SZ.readZip(file);
        const pj = files.get('project.json');
        if (!pj) throw new Error('this zip is not an EAS Tools Splicer project (it has no project.json)');
        let doc;
        try { doc = JSON.parse(await (await SZ.entryBlob(pj)).text()); } catch (_) { doc = null; }
        if (!doc || doc.app !== PROJECT_APP || doc.version !== 3) throw new Error('this zip is not an EAS Tools Splicer project');
        if (doc.format > PROJECT_FILE_FORMAT) throw new Error('this project file was made by a newer version of EAS Tools');
        const sr = Number(doc.sampleRate) > 0 ? Number(doc.sampleRate) : 44100;
        const diskThreshold = Number(window.EAS_SPLICER_DISK_BYTES) || MAX_LOAD_FILE_BYTES;
        const made = [];
        const sources = [];
        try {
            for (const s of doc.sources || []) {
                const entry = files.get(s.file);
                if (!entry) throw new Error(`the project file is missing ${s.file}`);
                const blob = await SZ.entryBlob(entry);
                const crc = await SZ.crc32Blob(blob, (n, total) => persistStatus(`Checking ${s.label || s.file}... ${Math.round((n / Math.max(1, total)) * 100)}%`));
                if (crc !== entry.crc) throw new Error(`${s.file} is damaged (its checksum does not match)`);
                const L = wavLayout(blob, await readWavStructure(blob));
                if (L.error) throw new Error(`${s.file}: ${L.error}`);
                if (blob.size > diskThreshold && opfsSupported()) {
                    const disk = await streamWavToDisk(blob, L, `Loading ${s.label || s.file}... `, sr);
                    made.push(disk.file);
                    sources.push({ id: s.id, kind: 'disk', label: s.label || '', meta: s.meta || null, file: disk.file, length: disk.length, bucket: disk.bucket, peaks: disk.peaks.buffer });
                    continue;
                }
                const ab = await blob.slice(L.dataOffset, L.dataOffset + L.numFrames * L.frameBytes).arrayBuffer();
                let pcm = decodeMonoChunk(ab, L.numFrames, L.channels, L.frameBytes, L.isFloat, L.isPcmInt, L.bitsPerSample);
                if (L.sampleRate !== sr) pcm = resamplePcm(pcm, L.sampleRate, sr);
                sources.push({ id: s.id, label: s.label || '', meta: s.meta || null, pcm: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) });
            }
        } catch (err) {
            for (const n of made) importingFiles.delete(n);
            if (made.length) sweepDiskFiles();
            throw err;
        }
        const p = SM.deserialize({ version: 3, sampleRate: sr, tracks: doc.tracks, markers: doc.markers, master: doc.master, sources });
        if (!p.tracks.length) SM.addTrack(p, 'voice');
        if (recorder) await stopRecording();
        if (playingSource || pausedPlayback) stopPlayback();
        project = p;
        for (const n of made) importingFiles.delete(n);
        if (project.master) applyMasterToControls(project.master);
        else project.master = captureMaster();
        playheadTime = 0;
        projectChanged();
        let clips = 0;
        for (const t of project.tracks) clips += t.clips.length;
        return { tracks: project.tracks.length, clips };
    };

    const handleFile = async (file) => {
        if (!file) return;
        const name = file.name || '';
        const isWav = /\.wav$/i.test(name) || file.type === 'audio/wav' || file.type === 'audio/x-wav';
        const diskThreshold = Number(window.EAS_SPLICER_DISK_BYTES) || MAX_LOAD_FILE_BYTES;
        if (file.size > diskThreshold) {
            if (isWav && opfsSupported()) {
                await loadHugeWav(file);
                return;
            }
            persistStatus(`This ${(file.size / 1048576).toFixed(0)} MB file is too large to load on this device.${isWav ? ' (Device storage is unavailable.)' : ' Convert it to 16-bit PCM WAV first.'}`);
            return;
        }
        if (isWav) {
            let res = null;
            try { res = await loadWavMonoFloat32(file); } catch (e) { res = null; }
            if (res && res.tooLarge) return;
            if (res && res.pcm) {
                addSegment(res.pcm, res.sampleRate, name || 'File', '', true);
                return;
            }
        }
        if (file.size > DECODE_FILE_LIMIT) {
            const mb = (file.size / 1048576).toFixed(0);
            persistStatus(isWav
                ? `This WAV (${mb} MB) isn't standard PCM the streaming loader can read, and it's too large to decode in memory here. Re-export it as 16-bit PCM WAV, or use a shorter clip.`
                : `This ${mb} MB file is too large to decode in memory on this device. Convert it to 16-bit PCM WAV (which streams in), or use a shorter clip.`);
            return;
        }
        try {
            const ab = await file.arrayBuffer();
            const ctxAudio = getAudioCtx();
            const decoded = await ctxAudio.decodeAudioData(ab);
            const pcm = new Float32Array(decoded.getChannelData(0));
            addSegment(pcm, decoded.sampleRate, name || 'File', '', true);
        } catch (e) {
            persistStatus('Could not decode this audio file.');
        }
    };

    const piperReportStatus = (message) => {
        if (ttsStatus) ttsStatus.textContent = message;
    };
    const ensurePiper = () => ensurePiperLoaded({ reportStatus: piperReportStatus });

    const nanoTts = createNanoTtsEngine({
        reportStatus: (message, level = "LOG") => {
            if (!ttsStatus || !message) return;
            ttsStatus.textContent = level === "ERROR" ? `NanoTTS error: ${message}` : message;
        },
        decodeBlob: async (blob) => {
            const ctxAudio = getAudioCtx();
            const buffer = await blob.arrayBuffer();
            const decoded = await ctxAudio.decodeAudioData(buffer);
            const channel = decoded.getChannelData(0);
            const pcm = new Float32Array(channel.length);
            pcm.set(channel);
            return { pcm, sampleRate: decoded.sampleRate };
        },
    });

    const wasmVoiceProgress = (progress) => {
        if (!progress) {
            setMacroProgress(1);
            return;
        }
        const mb = (n) => (n / 1048576).toFixed(1);
        const frac = progress.total ? Math.min(0.999, progress.loaded / progress.total) : 0;
        setMacroProgress(frac, progress.total
            ? `Downloading ${progress.label} (${mb(progress.loaded)} / ${mb(progress.total)} MB)`
            : `Downloading ${progress.label}...`);
    };

    const synthTts = async (text, voice) => {
        const mode = (voice || 'wasm').toLowerCase();
        if (mode === 'nanotts') {
            return nanoTts.synth(text);
        }
        const spfyVoice = parseSpfyVoiceId(mode);
        if (spfyVoice !== null) {
            return getSpfyEngine().synth(text, { reportStatus: piperReportStatus, onProgress: wasmVoiceProgress, voice: spfyVoice });
        }
        if (mode === 'acuvoice') {
            return getAcuEngine().synth(text, { reportStatus: piperReportStatus, onProgress: wasmVoiceProgress });
        }
        const espeakVoice = parseEspeakVoiceId(mode);
        if (espeakVoice !== null) {
            return getEspeakEngine().synth(text, {
                reportStatus: piperReportStatus,
                onProgress: wasmVoiceProgress,
                voice: espeakVoice,
                rate: espeakRateFromSlider(document.getElementById('ttsRate2')?.value || '0'),
                pitch: espeakPitchFromSlider(document.getElementById('ttsPitch2')?.value || '0'),
            });
        }
        const target = state.sampleRate || 44100;
        const pcm = await getPiperPcm(text, target, { ensureLoaded: ensurePiper, reportStatus: piperReportStatus });
        if (!pcm) throw new Error('TTS service unavailable');
        return { pcm, sampleRate: target };
    };

    const getVoiceList = async () => {
        if (!voiceSelect || voiceListLoaded) return;

        await populateSpfyVoiceList({
            selectElement: voiceSelect,
            reportError: () => {
                if (ttsStatus) ttsStatus.textContent = "Failed to load the Speechify voice list.";
            },
        });

        const ok = await populateRemoteVoiceList({
            selectElement: voiceSelect,
            voiceBackendMap,
            reportError: () => {
                if (ttsStatus) ttsStatus.textContent = "Failed to load external voices; WASM only.";
            },
        });
        if (!ok) return;

        voiceListLoaded = true;

        if (window.EASBridge) {
            window.EASBridge.on('splicer:nativeVoicesData', (data) => {
                const voices = data?.voices;
                if (!Array.isArray(voices) || !voiceSelect) return;
                for (const v of voices) {
                    const option = document.createElement("option");
                    option.value = v.id;
                    option.textContent = v.label;
                    voiceSelect.appendChild(option);
                }
            });
            window.EASBridge.send('splicer:requestNativeVoices', {});
        }
    };

    const checkZCZCIsValid = (header) => {
        const zczcPattern = window.EASREGEX;
        return zczcPattern.test(header.trim());
    };

    const bitcrushSpeechifyPcm = async (pcm, sampleRate) => {
        const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;

        if (!(pcm instanceof Float32Array) || pcm.length === 0) {
            return { pcm, sampleRate: sr };
        }

        const fallbackExciter = () => {
            const workSr = sr / 2 < 5000 ? 44100 : sr;
            const src = workSr === sr ? pcm : resamplePcmSinc(pcm, sr, workSr);
            const nyquist = workSr / 2;

            const out = new Float32Array(src.length);
            const drive = 3.16;
            const driven = new Float32Array(src.length);
            for (let i = 0; i < src.length; i++) {
                driven[i] = Math.tanh(src[i] * drive);
            }

            const freq = Math.min(4000, nyquist * 0.8);
            const w0 = 2 * Math.PI * freq / workSr;
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

            for (let i = 0; i < src.length; i++) {
                const x0 = driven[i];
                const y0 = b0 * x0 + b1 * s1x1 + b2 * s1x2 - a1 * s1y1 - a2 * s1y2;
                s1x2 = s1x1; s1x1 = x0;
                s1y2 = s1y1; s1y1 = y0;

                const y1 = b0 * y0 + b1 * s2x1 + b2 * s2x2 - a1 * s2y1 - a2 * s2y2;
                s2x2 = s2x1; s2x1 = y0;
                s2y2 = s2y1; s2y1 = y1;

                out[i] = src[i] + y1 * hfGain;
                const abs = out[i] < 0 ? -out[i] : out[i];
                if (abs > peak) peak = abs;
            }

            if (peak > 0.9441) {
                const g = 0.9441 / peak;
                for (let i = 0; i < out.length; i++) out[i] *= g;
            }

            return { pcm: out, sampleRate: workSr };
        };

        if (typeof window.SOXModule !== "function") {
            return fallbackExciter();
        }

        const input16 = new Int16Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) {
            let s = pcm[i];
            if (s > 1) s = 1;
            else if (s < -1) s = -1;
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
            const needsUpsample = sr < 21000;
            const workRate = needsUpsample ? 44100 : sr;
            let workData = inputRaw;

            if (needsUpsample) {
                const upRaw = await runSox([
                    "-t", "raw", "-r", String(sr), "-L",
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

            return { pcm: result, sampleRate: workRate };
        } catch {
            return fallbackExciter();
        }
    };

    const requestRemoteTtsAudio = async ({ text, voiceId, overrideTZ }) => {
        const result = await fetchRemoteTtsAudio({
            text,
            voice: voiceId,
            overrideTZ,
            backend: resolveVoiceBackend(voiceBackendMap, voiceId),
            prosody: readTtsProsodyControls("2"),
        });

        if (shouldBitcrushSpeechifyCheckbox?.checked === true && /Speechify/i.test(voiceId || "")) {
            const crushed = await bitcrushSpeechifyPcm(result.pcm, result.sampleRate);
            return { pcm: crushed.pcm, sampleRate: crushed.sampleRate };
        }

        return result;
    };

    const bindEvents = () => {
        fileInput?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
            setButtonDisabledState(false);
        });

        loadFileBtn?.addEventListener('click', () => { fileInput?.click(); });
        exportBtn?.addEventListener('click', exportWav);
        if (exportMacroBtn && !sendMenu) {
            sendMenu = createSendMenu({
                label: 'Send to…',
                title: 'Open the mix in another tool',
                items: [
                    { tool: 'decoder', label: 'Decoder (check that the mix decodes)', what: 'Mix', payload: sendMixToDecoder },
                ],
            });
            sendMenu.setDisabled(exportBtn ? exportBtn.disabled : true);
            exportMacroBtn.insertAdjacentElement('afterend', sendMenu.element);
        }
        clearBtn?.addEventListener('click', async () => {
            stopPlayback();
            state.pcm = new Float32Array(0);
            project = SM.createProject(44100);
            SM.addTrack(project, 'voice');
            project.master = captureMaster();
            editHistory.clear();
            if (editor) editor.resetView();
            playheadTime = 0;
            state.selection = { start: 0, end: 0 };
            rebuildTimeline();
            invalidateMacroWaveformCache(true);
            macroRenderBlobCache = null;
            drawWaveform();
            await clearCache();
            sweepDiskFiles();
            setButtonDisabledState(true);
            const intervalId = setInterval(() => persistStatus('Project cleared.', true), 5);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            clearInterval(intervalId);
        });

        silenceBtn?.addEventListener('click', addSilence);

        voiceSelect?.addEventListener('change', () => {
            const selectedVoice = (voiceSelect?.value || 'wasm').trim();
            const overrideTZElements = document.getElementsByClassName('splicerOverrideTZ');
            const tzRow = document.getElementById('spliceTZRow');
            if (tzRow) tzRow.hidden = selectedVoice !== 'EMNet';
            if (selectedVoice !== 'EMNet') {
                Array.from(overrideTZElements).forEach(el => el.style.display = 'none');
            } else {
                Array.from(overrideTZElements).forEach(el => el.style.display = 'inline-block');
            }
        });

        voiceSelect?.dispatchEvent(new Event('change'));

        ttsClearButton?.addEventListener('click', () => {
            const editor = window.splicerEditor;
            if (editor) {
                editor.execCommand('selectAll');
                editor.replaceSelection('');
                editor.focus();
            } else if (ttsInput) {
                ttsInput.value = '';
                ttsInput.focus();
            }
            if (ttsStatus) ttsStatus.textContent = '';
        });

        ttsButton?.addEventListener('click', async () => {
            const text = (ttsInput?.value || '').trim();
            const selectedVoiceValue = (voiceSelect?.value || 'wasm').trim();
            const normalizedVoice = selectedVoiceValue.toLowerCase();
            const tz = (overrideTzSelect?.value || 'UTC').trim();
            if (!text) {
                if (ttsStatus) ttsStatus.textContent = 'Enter text to synthesize.';
                return;
            }
            if (normalizedVoice === 'emnet' && !checkZCZCIsValid(text)) {
                if (ttsStatus) ttsStatus.textContent = 'EMNet requires a valid SAME header string.';
                return;
            }
            ttsButton.disabled = true;
            if (ttsStatus) ttsStatus.textContent = 'Generating...';
            try {
                if (normalizedVoice === 'wasm' || normalizedVoice === 'nanotts' || parseSpfyVoiceId(normalizedVoice) !== null || normalizedVoice === 'acuvoice' || parseEspeakVoiceId(normalizedVoice) !== null) {
                    const valid = await validateMarkupAndText(voiceBackendMap, selectedVoiceValue, text);
                    if (!valid) {
                        if (ttsStatus) ttsStatus.textContent = 'Text contains invalid phonemes or markup for this backend.';
                        return;
                    }
                    let { pcm, sampleRate } = await synthTts(text, normalizedVoice);
                    if (parseSpfyVoiceId(normalizedVoice) !== null && shouldBitcrushSpeechifyCheckbox?.checked === true) {
                        const crushed = await bitcrushSpeechifyPcm(pcm, sampleRate);
                        pcm = crushed.pcm;
                        sampleRate = crushed.sampleRate;
                    }
                    addSegment(pcm, sampleRate, 'TTS', text);
                    if (ttsStatus) ttsStatus.textContent = `Added ${(pcm.length / (sampleRate || state.sampleRate)).toFixed(2)}s of audio.`;
                    setButtonDisabledState(false);
                    drawWaveform();
                } else if (normalizedVoice.startsWith('ios-native:') && window.EASBridge) {
                    if (ttsStatus) ttsStatus.textContent = 'Generating iOS native TTS...';
                    const voiceId = selectedVoiceValue.slice('ios-native:'.length);
                    const result = await new Promise((resolve) => {
                        window.EASBridge.on('encoder:nativeTTSResult', (r) => resolve(r));
                        window.EASBridge.send('encoder:nativeTTS', {
                            text: text,
                            voiceId: voiceId,
                            rate: 0.5,
                            pitch: 1.0,
                        });
                    });
                    if (result.error) {
                        throw new Error(result.error);
                    }
                    if (result.base64) {
                        const binary = atob(result.base64);
                        const bytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                        const buffer = await audioCtx.decodeAudioData(bytes.buffer);
                        const pcm = buffer.getChannelData(0);
                        addSegment(pcm, buffer.sampleRate, 'TTS', text);
                        if (ttsStatus) ttsStatus.textContent = `Added ${(pcm.length / buffer.sampleRate).toFixed(2)}s of iOS TTS audio.`;
                        setButtonDisabledState(false);
                        drawWaveform();
                    } else {
                        throw new Error('No audio returned from native TTS');
                    }
                } else {
                    const valid = await validateMarkupAndText(voiceBackendMap, selectedVoiceValue, text);
                    if (!valid) {
                        if (ttsStatus) ttsStatus.textContent = 'Text contains invalid phonemes or markup for this backend.';
                        return;
                    }
                    const result = await requestRemoteTtsAudio({ text, voiceId: selectedVoiceValue, overrideTZ: tz });
                    if (result?.pcm?.length) {
                        addSegment(result.pcm, result.sampleRate, 'TTS', text);
                        if (ttsStatus) ttsStatus.textContent = `Added ${(result.pcm.length / (result.sampleRate || state.sampleRate)).toFixed(2)}s of audio.`;
                        setButtonDisabledState(false);
                        drawWaveform();
                    } else {
                        if (ttsStatus) ttsStatus.textContent = 'No audio received.';
                    }
                }
            } catch (err) {
                console.error(err);
                if (ttsStatus) ttsStatus.textContent = 'TTS failed. Reason: "' + err.message + '"';
            } finally {
                ttsButton.disabled = false;
            }
        });
    };

    const setButtonDisabledState = (disabled) => {
        exportBtn.disabled = disabled;
        clearBtn.disabled = disabled;
        if (sendMenu) sendMenu.setDisabled(disabled);
        if (previewMacroBtn) previewMacroBtn.disabled = disabled;
        if (exportMacroBtn) exportMacroBtn.disabled = disabled;
    };

    const restoreFromCache = async () => {
        const payload = await loadProject();
        const restored = projectFromPayload(payload);
        const lost = restored ? await dropMissingDisk(restored) : 0;
        if (lost) setTimeout(() => persistStatus(`${lost} clip${lost === 1 ? '' : 's'} from large files were removed because the files are no longer in device storage.`, false), 1100);
        if (!restored || !restored.tracks.some((t) => t.clips.length)) {
            if (restored && restored.tracks.length) {
                project = restored;
                syncControlsFromMaster();
                rebuildTimeline();
            } else if (!project.master) {
                project.master = captureMaster();
            }
            setButtonDisabledState(true);
            persistStatus('No cached project found yet.');
            drawWaveform();
            return;
        }
        voiceSelect.value = payload.ttsVoiceSelection || PIPER_VOICE;
        ttsInput.value = payload.ttsText || '';
        spliceSilenceInput.value = payload.spliceSilenceInput ?? 0.5;
        if (restored.master) {
            window.splicerEditor.setValue(payload.ttsText || '');
            project = restored;
            state.sampleRate = project.sampleRate;
            editHistory.clear();
            applyMasterToControls(project.master);
            rebuildTimeline();
            setButtonDisabledState(false);
            persistStatus('Project restored from cache.');
            return;
        }
        if (macroStrengthInput) macroStrengthInput.value = String(chainItemMix(payload.macroLevel));
        if (macroVolumeInput) macroVolumeInput.value = String(chainItemGainDb(payload.macroLevel));
        spliceLoudnessInput.value = payload.spliceLoudnessInput ?? 0;
        enableStaticNoiseCheckbox.checked = payload.staticEnabled || false;
        syncStaticNoiseUi();
        staticNoiseLevelInput.value = payload.staticOptions?.level || 0.14;
        staticNoiseFadeDepthInput.value = payload.staticOptions?.fadeDepth || 0.45;
        staticNoiseFadeRateInput.value = payload.staticOptions?.fadeRateHz || 0.6;
        enable60HzHumCheckbox.checked = payload.humEnabled || false;
        sync60HzHumUi();
        humLevelInput.value = payload.humOptions?.level || 0.01;
        if (enableBitcrushCheckbox) {
            enableBitcrushCheckbox.checked = payload.bitcrushEnabled || false;
            syncBitcrushUi();
            if (bitcrushBitsInput) bitcrushBitsInput.value = payload.bitcrushOptions?.bits || 8;
            if (bitcrushDownsampleInput) bitcrushDownsampleInput.value = payload.bitcrushOptions?.downsample || 1;
        }
        if (enableVmifyCheckbox) {
            enableVmifyCheckbox.checked = payload.vmifyEnabled || false;
            syncVmifyUi();
            if (vmifyIntensityInput) vmifyIntensityInput.value = payload.vmifyOptions?.intensity || 1;
        }
        setMasterMacro(payload.macroSelection || 'FLAT');
        syncMacroLevelUi();
        window.splicerEditor.setValue(payload.ttsText || '');
        project = restored;
        state.sampleRate = project.sampleRate;
        editHistory.clear();
        project.master = captureMaster();
        rebuildTimeline();
        setButtonDisabledState(false);
        const intervalId3 = setInterval(() => persistStatus('Project restored from cache.'), 5);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        clearInterval(intervalId3);
    };

    function getSelectedMacroId() {
        const raw = macroSelect && macroSelect.value ? macroSelect.value : 'FLAT';
        if (raw.startsWith('AUD:')) return raw;
        if (raw === 'ENDEC') return 'DIGITAL_ENDEC';
        return raw.toUpperCase();
    }

    const LAST_AUD_MACRO_KEY = 'splicer.lastAudMacro';
    function rememberAudMacro(value) {
        try {
            if (typeof value === 'string' && value.startsWith('AUD:')) localStorage.setItem(LAST_AUD_MACRO_KEY, value);
            else localStorage.removeItem(LAST_AUD_MACRO_KEY);
        } catch (e) { /* ignore */ }
    }
    function restoreAudMacroSelection() {
        if (!macroSelect) return;
        if (project.master) {
            if (pendingMasterMacro) setMasterMacro(pendingMasterMacro);
            return;
        }
        let want;
        try { want = localStorage.getItem(LAST_AUD_MACRO_KEY); } catch (e) { return; }
        if (!want || !want.startsWith('AUD:')) return;
        let found = false;
        for (const opt of macroSelect.options) { if (opt.value === want) { found = true; break; } }
        if (!found) return;
        if (macroSelect.value === want) return;
        macroSelect.value = want;
        macroSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function isMacroCancelError(err) {
        return !!err && err.name === 'AbortError' && /Macro processing cancelled/.test(String(err.message));
    }

    function isMacroAssetError(err) {
        return !!err && (err.name === 'AssetError' || err.name === 'AssetMissing');
    }

    function reportErrorStatus(message, err) {
        if (isMacroCancelError(err)) {
            if (typeof persistStatus === 'function') persistStatus('Macro processing cancelled.', true);
            return;
        }
        if (isMacroAssetError(err)) {
            if (typeof persistStatus === 'function') persistStatus(err.message, false);
            return;
        }
        if (typeof persistStatus === 'function') {
            spokenStatus(message, false);
        } else {
            console.error(message, err || '');
        }
    }

    let soxMacroDefs = {};
    let soxMacrosLoaded = false;
    function populateMacroSelect() {
        if (!macroSelect) return;

        const ids = Object.keys(soxMacroDefs);
        if (!ids.length) return;

        const previous = macroSelect.value;
        const customGroup = macroSelect.querySelector('optgroup[data-custom]');

        while (macroSelect.firstChild) {
            macroSelect.removeChild(macroSelect.firstChild);
        }

        const preferred = ['FLAT'];
        const added = new Set();

        function addOption(id, parent) {
            const def = soxMacroDefs[id] || {};
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent =
                def.label ||
                id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            (parent || macroSelect).appendChild(opt);
            added.add(id);
        }

        preferred.forEach((id) => {
            if (soxMacroDefs[id] && !added.has(id)) {
                addOption(id, macroSelect);
            }
        });

        const legacyGroup = document.createElement('optgroup');
        legacyGroup.label = 'Legacy SoX macros';
        legacyGroup.setAttribute('data-sox', '1');

        ids
            .filter((id) => !added.has(id))
            .sort()
            .forEach((id) => addOption(id, legacyGroup));

        if (legacyGroup.children.length) {
            macroSelect.appendChild(legacyGroup);
        }

        if (previous && soxMacroDefs[previous]) {
            macroSelect.value = previous;
        } else if (soxMacroDefs.FLAT) {
            macroSelect.value = 'FLAT';
        } else {
            macroSelect.selectedIndex = 0;
        }

        addAudacityMacrosToSelect();
        if (customGroup) macroSelect.insertBefore(customGroup, macroSelect.querySelector('optgroup[data-sox]'));
        updateChainOption();
        if (previous) macroSelect.value = previous;
    }

    const macroNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    function addAudacityMacrosToSelect() {
        if (!macroSelect || !window.AudacityMacroEngine) return;
        const list = window.AudacityMacroEngine.listMacros();
        if (!list.length) return;
        let grp = macroSelect.querySelector('optgroup[data-aud]');
        const fresh = !grp;
        if (fresh) {
            grp = document.createElement('optgroup');
            grp.label = 'Audacity VST macros';
            grp.setAttribute('data-aud', '1');
        }
        const opts = Array.from(grp.children);
        const have = new Set(opts.map((o) => o.value));
        list.forEach(({ id, name }) => {
            if (have.has(id)) return;
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name;
            opts.push(opt);
        });
        if (!fresh && opts.length === grp.children.length) return;
        const keep = macroSelect.value;
        opts.sort((a, b) => macroNameCollator.compare(a.textContent, b.textContent));
        grp.append(...opts);
        if (fresh) {
            const after = macroSelect.querySelector('optgroup[data-custom]') || macroSelect.querySelector('optgroup[data-sox]');
            macroSelect.insertBefore(grp, after);
        }
        if (keep && macroSelect.value !== keep) macroSelect.value = keep;
        restoreAudMacroSelection();
    }

    function setupMacroCombo() {
        if (!macroSelect || macroSelect.dataset.comboReady === '1') return;
        macroSelect.dataset.comboReady = '1';
        macroSelect.classList.add('splice-macro-native-hidden');
        macroSelect.setAttribute('tabindex', '-1');
        macroSelect.setAttribute('aria-hidden', 'true');

        const listId = 'splice-macro-combo-list';
        const combo = document.createElement('div');
        combo.className = 'splice-macro-combo';
        combo.setAttribute('data-splice-macro-combo', '');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'splice-macro-combo__btn';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'Apply macro');
        btn.id = 'spliceMacroComboBtn';
        const comboLabel = panel.querySelector('label[for="spliceMacros"]');
        if (comboLabel) comboLabel.htmlFor = btn.id;

        const labelSpan = document.createElement('span');
        labelSpan.className = 'splice-macro-combo__label';
        const arrowSpan = document.createElement('span');
        arrowSpan.className = 'splice-macro-combo__arrow';
        arrowSpan.setAttribute('aria-hidden', 'true');
        arrowSpan.textContent = '▾';
        btn.appendChild(labelSpan);
        btn.appendChild(arrowSpan);
        macroComboBtn = btn;
        btn.addEventListener('pointerdown', ensureAudacityMacros, { once: true });

        const pop = document.createElement('div');
        pop.className = 'splice-macro-combo__pop';
        pop.hidden = true;

        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'splice-macro-combo__search';
        search.setAttribute('placeholder', 'Search macros...');
        search.setAttribute('aria-label', 'Search macros');
        search.setAttribute('aria-controls', listId);
        search.setAttribute('aria-expanded', 'false');
        search.setAttribute('aria-autocomplete', 'list');
        search.setAttribute('role', 'combobox');
        search.setAttribute('autocomplete', 'off');
        search.setAttribute('spellcheck', 'false');

        const list = document.createElement('ul');
        list.className = 'splice-macro-combo__list';
        list.id = listId;
        list.setAttribute('role', 'listbox');

        pop.appendChild(search);
        pop.appendChild(list);
        combo.appendChild(btn);
        combo.appendChild(pop);
        macroSelect.parentNode.insertBefore(combo, macroSelect.nextSibling);

        let isOpen = false;
        let activeId = null;
        let optionEls = [];

        const selectedText = () => {
            const opt = macroSelect.options[macroSelect.selectedIndex];
            return opt ? (opt.textContent || '') : '';
        };

        const syncLabel = () => {
            labelSpan.textContent = selectedText() || 'Select macro';
        };

        const scrollActiveIntoView = (li) => {
            const lr = list.getBoundingClientRect();
            const ir = li.getBoundingClientRect();
            if (ir.top < lr.top) list.scrollTop -= (lr.top - ir.top);
            else if (ir.bottom > lr.bottom) list.scrollTop += (ir.bottom - lr.bottom);
        };

        const setActive = (id) => {
            activeId = id;
            let activeLi = null;
            optionEls.forEach((li) => {
                const on = li.id === id;
                li.classList.toggle('is-active', on);
                if (on) activeLi = li;
            });
            if (activeLi) {
                search.setAttribute('aria-activedescendant', id);
                scrollActiveIntoView(activeLi);
            } else {
                search.removeAttribute('aria-activedescendant');
            }
        };

        const buildList = () => {
            list.textContent = '';
            optionEls = [];
            const filter = search.value.trim().toLowerCase();
            let counter = 0;
            const makeOpt = (optionEl) => {
                const text = optionEl.textContent || '';
                if (filter && text.toLowerCase().indexOf(filter) === -1) return null;
                const li = document.createElement('li');
                li.className = 'splice-macro-combo__opt';
                li.setAttribute('role', 'option');
                li.dataset.value = optionEl.value;
                li.id = listId + '-opt-' + (counter++);
                li.textContent = text;
                const isSel = optionEl.value === macroSelect.value;
                li.setAttribute('aria-selected', isSel ? 'true' : 'false');
                if (isSel) li.classList.add('is-selected');
                return li;
            };
            for (const child of macroSelect.children) {
                if (child.tagName === 'OPTGROUP') {
                    const groupLis = [];
                    for (const o of child.children) {
                        if (o.tagName !== 'OPTION') continue;
                        const li = makeOpt(o);
                        if (li) groupLis.push(li);
                    }
                    if (groupLis.length) {
                        const head = document.createElement('li');
                        head.className = 'splice-macro-combo__group';
                        head.setAttribute('role', 'presentation');
                        head.textContent = child.label || '';
                        list.appendChild(head);
                        groupLis.forEach((li) => {
                            list.appendChild(li);
                            optionEls.push(li);
                        });
                    }
                } else if (child.tagName === 'OPTION') {
                    const li = makeOpt(child);
                    if (li) {
                        list.appendChild(li);
                        optionEls.push(li);
                    }
                }
            }
            if (!optionEls.length) {
                const empty = document.createElement('li');
                empty.className = 'splice-macro-combo__empty';
                empty.setAttribute('role', 'presentation');
                empty.textContent = 'No macros match.';
                list.appendChild(empty);
                setActive(null);
                return;
            }
            const selected = optionEls.find((li) => li.getAttribute('aria-selected') === 'true');
            setActive(selected ? selected.id : optionEls[0].id);
        };

        const positionPop = () => {
            const r = btn.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const width = Math.min(Math.max(r.width, 280), vw - 16);
            let left = r.left;
            if (left + width > vw - 8) left = Math.max(8, vw - 8 - width);
            pop.style.width = width + 'px';
            pop.style.left = left + 'px';
            const spaceBelow = vh - r.bottom;
            const spaceAbove = r.top;
            const useBelow = spaceBelow >= spaceAbove || spaceBelow > 300;
            const maxH = Math.max(160, Math.min(440, (useBelow ? spaceBelow : spaceAbove) - 12));
            pop.style.maxHeight = maxH + 'px';
            if (useBelow) {
                pop.style.top = (r.bottom + 4) + 'px';
                pop.style.bottom = 'auto';
            } else {
                pop.style.top = 'auto';
                pop.style.bottom = (vh - r.top + 4) + 'px';
            }
        };

        const onReposition = () => {
            if (isOpen) positionPop();
        };

        const onDocPointer = (e) => {
            if (!combo.contains(e.target)) close();
        };

        const open = () => {
            if (isOpen) return;
            isOpen = true;
            search.value = '';
            buildList();
            pop.hidden = false;
            positionPop();
            btn.setAttribute('aria-expanded', 'true');
            search.setAttribute('aria-expanded', 'true');
            document.addEventListener('mousedown', onDocPointer, true);
            window.addEventListener('resize', onReposition);
            window.addEventListener('scroll', onReposition, true);
            search.focus();
        };

        function close() {
            if (!isOpen) return;
            isOpen = false;
            pop.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
            search.setAttribute('aria-expanded', 'false');
            search.removeAttribute('aria-activedescendant');
            document.removeEventListener('mousedown', onDocPointer, true);
            window.removeEventListener('resize', onReposition);
            window.removeEventListener('scroll', onReposition, true);
        }

        const pick = (value) => {
            if (macroSelect.value !== value) {
                macroSelect.value = value;
                macroSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
            syncLabel();
            close();
            btn.focus();
        };

        const moveActive = (dir) => {
            if (!optionEls.length) return;
            let idx = optionEls.findIndex((li) => li.id === activeId);
            if (idx === -1) idx = dir > 0 ? -1 : 0;
            idx += dir;
            if (idx < 0) idx = optionEls.length - 1;
            if (idx >= optionEls.length) idx = 0;
            setActive(optionEls[idx].id);
        };

        btn.addEventListener('click', () => {
            if (isOpen) close();
            else open();
        });
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                open();
            }
        });

        list.addEventListener('click', (e) => {
            const li = e.target.closest('.splice-macro-combo__opt');
            if (!li || typeof li.dataset.value === 'undefined') return;
            e.preventDefault();
            pick(li.dataset.value);
        });
        list.addEventListener('mousemove', (e) => {
            const li = e.target.closest('.splice-macro-combo__opt');
            if (li && li.id && li.id !== activeId) setActive(li.id);
        });

        search.addEventListener('input', () => {
            buildList();
        });
        search.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveActive(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveActive(-1);
            } else if (e.key === 'Home') {
                e.preventDefault();
                if (optionEls.length) setActive(optionEls[0].id);
            } else if (e.key === 'End') {
                e.preventDefault();
                if (optionEls.length) setActive(optionEls[optionEls.length - 1].id);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const li = activeId ? document.getElementById(activeId) : null;
                if (li && typeof li.dataset.value !== 'undefined') pick(li.dataset.value);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
                btn.focus();
            } else if (e.key === 'Tab') {
                close();
            }
        });

        macroSelect.addEventListener('change', () => {
            syncLabel();
            if (isOpen) buildList();
        });

        const mo = new MutationObserver(() => {
            syncLabel();
            if (isOpen) buildList();
        });
        mo.observe(macroSelect, { childList: true, subtree: true });

        syncLabel();
    }

    const MAX_MACRO_UPLOAD_BYTES = 1024 * 1024;

    function addCustomMacroOption(file) {
        if (!macroSelect) return;
        const id = 'AUD:' + file;
        for (const opt of macroSelect.querySelectorAll('option')) {
            if (opt.value === id) return;
        }
        let grp = macroSelect.querySelector('optgroup[data-custom]');
        if (!grp) {
            grp = document.createElement('optgroup');
            grp.label = 'Custom macros (this session)';
            grp.setAttribute('data-custom', '1');
            macroSelect.insertBefore(grp, macroSelect.querySelector('optgroup[data-sox]'));
        }
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = file.replace(/\.txt$/i, '');
        grp.appendChild(opt);
    }

    async function handleMacroUpload(fileObj) {
        if (!fileObj) return;
        if (!window.AudacityMacroEngine || !window.AudacityMacroEngine.registerCustomMacro) {
            persistStatus('Macro engine unavailable; cannot load custom macros.', false);
            return;
        }
        if (fileObj.size > MAX_MACRO_UPLOAD_BYTES) {
            persistStatus('Macro file "' + fileObj.name + '" is too large (limit 1 MB).', false);
            return;
        }
        let text;
        try {
            text = await fileObj.text();
        } catch (err) {
            reportErrorStatus('Could not read macro file "' + fileObj.name + '".', err);
            return;
        }
        let steps;
        try {
            steps = await window.AudacityMacroEngine.expandMacroSteps(text);
        } catch (err) {
            reportErrorStatus('Could not parse macro file "' + fileObj.name + '".', err);
            return;
        }
        if (!steps.length) {
            persistStatus('"' + fileObj.name + '" contains no runnable macro commands.', false);
            return;
        }
        const file = window.AudacityMacroEngine.registerCustomMacro(fileObj.name, text);
        addCustomMacroOption(file);
        const id = 'AUD:' + file;
        if (macroSelect && macroSelect.value !== id) {
            macroSelect.value = id;
            macroSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await saveCustomMacroToDb(file, text);
        persistStatus('Custom macro "' + file.replace(/\.txt$/i, '') + '" loaded (' + steps.length + ' step' + (steps.length === 1 ? '' : 's') + '), selected, and saved for future sessions.');
    }

    function isCustomMacroSelected() {
        if (!macroSelect) return false;
        const grp = macroSelect.querySelector('optgroup[data-custom]');
        if (!grp) return false;
        for (const o of grp.children) {
            if (o.value === macroSelect.value) return true;
        }
        return false;
    }

    function updateRemoveMacroState() {
        if (macroRemoveBtn) macroRemoveBtn.disabled = !isCustomMacroSelected();
    }

    async function removeSelectedCustomMacro() {
        if (!isCustomMacroSelected()) return;
        const id = macroSelect.value;
        const file = id.slice(4);
        if (window.AudacityMacroEngine?.unregisterCustomMacro) {
            window.AudacityMacroEngine.unregisterCustomMacro(file);
        }
        const grp = macroSelect.querySelector('optgroup[data-custom]');
        if (grp) {
            for (const o of [...grp.children]) {
                if (o.value === id) o.remove();
            }
            if (!grp.children.length) grp.remove();
        }
        await deleteCustomMacroFromDb(file);
        const beforeLen = macroChain.length;
        macroChain = macroChain.filter((it) => it.id !== id);
        if (macroChain.length !== beforeLen) onChainMutated();
        macroSelect.value = 'FLAT';
        if (macroSelect.value !== 'FLAT' && macroSelect.options.length) macroSelect.selectedIndex = 0;
        macroSelect.dispatchEvent(new Event('change', { bubbles: true }));
        persistStatus('Custom macro "' + file.replace(/\.txt$/i, '') + '" removed.');
    }

    async function restoreCustomMacros() {
        if (!window.AudacityMacroEngine || !window.AudacityMacroEngine.registerCustomMacro) return;
        const rows = await loadCustomMacrosFromDb();
        if (rows.length) {
            rows.sort((a, b) => (a?.savedAt || 0) - (b?.savedAt || 0));
            let restored = 0;
            for (const row of rows) {
                if (!row || typeof row.text !== 'string' || !row.file) continue;
                const file = window.AudacityMacroEngine.registerCustomMacro(row.file, row.text);
                addCustomMacroOption(file);
                restored++;
            }
            if (restored) {
                persistStatus('Restored ' + restored + ' custom macro' + (restored === 1 ? '' : 's') + '.');
                restoreAudMacroSelection();
            }
        }
        updateRemoveMacroState();
    }

    let macroChain = [];
    const MAX_CHAIN_ITEMS = 10;
    const MAX_CHAIN_STEPS = 250;
    const CHAIN_STORAGE_KEY = 'splicer.macroChain';

    const CHAIN_BUILTIN_EFFECTS = [
        { cmd: 'Amplify', params: 'Ratio="0.70794578"' },
        { cmd: 'Normalize', params: 'PeakLevel="-1"' },
        { cmd: 'LoudnessNormalization', params: 'NormalizeTo="1" RMSLevel="-20" DualMono="1"' },
        { cmd: 'Compressor', params: 'Threshold="-12" Ratio="2" AttackTime="0.2" ReleaseTime="1" NoiseFloor="-40" Normalize="1" UsePeak="0"' },
        { cmd: 'Limiter', params: 'type="SoftLimit" thresh="-6" hold="10" makeup="No" gain-L="0" gain-R="0"' },
        { cmd: 'NoiseGate', params: 'threshold="-48" level-reduction="-12" attack="250" gate-freq="0" low-cut="None"' },
        { cmd: 'PopMute', params: 'thresh="-6" floor="-24" look="10" rel="10"' },
        { cmd: 'High-passFilter', params: 'frequency="200" rolloff="dB12"' },
        { cmd: 'Low-passFilter', params: 'frequency="3000" rolloff="dB12"' },
        { cmd: 'BassAndTreble', params: 'Bass="10" Treble="0" Gain="0" Link_Sliders="0"' },
        { cmd: 'ParametricEq', params: 'freq="1000" width="5" gain="-6"' },
        { cmd: 'NotchFilter', params: 'frequency="60" q="1"' },
        { cmd: 'MultibandEq', params: 'bands="10" band="3" gain="6"' },
        { cmd: 'ChebyshevTypeIFilter', params: 'fType="Lowpass" order="4" fc="3000" ripple="0.05"' },
        { cmd: 'CombFilter', params: 'f="440" decay="0.025" norm-level="0.95"' },
        { cmd: 'Distortion', params: 'Type="Leveller" Threshold_dB="-10.457575" Noise_Floor="-70" Parameter_1="84" Parameter_2="14" Repeats="3" DC_Block="0"' },
        { cmd: 'Clipper', params: 'tube="Yes"' },
        { cmd: 'TapeSaturationLimiter', params: 'thres="-3" ratio="2" hfhz="4500" hfgain="-5" makeup="Off"' },
        { cmd: 'HarmonicEnhancer', params: '' },
        { cmd: 'NoiseThing', params: '' },
        { cmd: 'Echo', params: 'Delay="1" Decay="0.5"' },
        { cmd: 'Delay', params: 'delay-type="Regular" delay="0.3" dgain="-6" number="5" shift="0"' },
        { cmd: 'Phaser', params: 'Stages="2" DryWet="128" Freq="0.4" Phase="0" Depth="100" Feedback="0" Gain="-6"' },
        { cmd: 'Tremolo', params: 'wave="Sine" lfo="4" wet="40" phase="0"' },
        { cmd: 'Flanger(linear)', params: '' },
        { cmd: 'RandomAmplitudeModulation', params: 'maxspeed="0.5" factor="80"' },
        { cmd: 'RandomPitchModulation', params: 'depth="0.1" maxspeed="0.5" factor="80" maxdepth="0.5"' },
        { cmd: 'ChangeSpeed', params: 'Percentage="10"' },
        { cmd: 'StudioFadeOut', params: '' },
        { cmd: 'FadeIn', params: '' },
        { cmd: 'FadeOut', params: '' },
        { cmd: 'Reverse', params: '' },
        { cmd: 'Invert', params: '' },
    ];

    const CHAIN_MIX_MIN = SR.MIX_MIN;
    const CHAIN_MIX_MAX = SR.MIX_MAX;
    const CHAIN_GAIN_MIN_DB = SR.GAIN_MIN_DB;
    const CHAIN_GAIN_MAX_DB = SR.GAIN_MAX_DB;
    const chainItemMix = SR.itemMix;
    const chainItemGainDb = SR.itemGainDb;
    const clampChainNumber = SR.clampNumber;

    const macroStrengthInput = panel.querySelector('[data-splice-macro-strength]');
    const macroVolumeInput = panel.querySelector('[data-splice-macro-volume]');
    const getMacroLevel = () => ({
        mix: chainItemMix({ mix: macroStrengthInput ? macroStrengthInput.value : '' }),
        gainDb: chainItemGainDb({ gainDb: macroVolumeInput ? macroVolumeInput.value : '' }),
    });
    const macroLevelSig = () => {
        const level = getMacroLevel();
        return level.mix + '/' + level.gainDb;
    };

    const chainSig = () => SR.chainSig(macroChain);

    function persistMacroChain() {
        try {
            localStorage.setItem(CHAIN_STORAGE_KEY, JSON.stringify(macroChain.map((it) => ({
                id: it.id,
                label: it.label,
                steps: it.steps,
                params: it.params || '',
                mix: chainItemMix(it),
                gainDb: chainItemGainDb(it),
            }))));
        } catch (e) { }
    }

    const applyChainItemLevel = (dry, drySr, wet, wetSr, item) => SR.applyLevel(dry, drySr, wet, wetSr, item, resamplePcmSinc);

    function updateChainOption() {
        if (!macroSelect) return;
        let opt = macroSelect.querySelector('option[data-chain]');
        if (!macroChain.length) {
            if (opt) {
                const wasSelected = macroSelect.value === 'CHAIN';
                opt.remove();
                if (wasSelected) {
                    macroSelect.value = 'FLAT';
                    if (macroSelect.value !== 'FLAT' && macroSelect.options.length) macroSelect.selectedIndex = 0;
                    macroSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            return;
        }
        if (!opt) {
            opt = document.createElement('option');
            opt.value = 'CHAIN';
            opt.setAttribute('data-chain', '1');
            const first = macroSelect.firstElementChild;
            if (first && first.tagName === 'OPTION') {
                macroSelect.insertBefore(opt, first.nextSibling);
            } else {
                macroSelect.insertBefore(opt, macroSelect.firstChild);
            }
        }
        opt.textContent = 'Macro Chain (' + macroChain.length + ' macro' + (macroChain.length === 1 ? '' : 's') + ')';
    }

    function onChainMutated() {
        persistMacroChain();
        updateChainOption();
        commitMaster('edit macro chain');
        if (macroSelect && macroSelect.value === 'CHAIN') {
            invalidateMacroPreview();
            scheduleMacroWaveformUpdate();
        }
    }

    function restoreMacroChain() {
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(CHAIN_STORAGE_KEY) || 'null');
        } catch (e) {
            saved = null;
        }
        if (Array.isArray(saved)) {
            macroChain = saved
                .filter((it) => it && typeof it.id === 'string' && it.id && it.id !== 'CHAIN' && it.id !== 'FLAT')
                .slice(0, MAX_CHAIN_ITEMS)
                .map((it) => ({
                    id: it.id,
                    label: (typeof it.label === 'string' && it.label) ? it.label : it.id,
                    steps: Number.isFinite(it.steps) && it.steps > 0 ? it.steps : 1,
                    params: typeof it.params === 'string' ? it.params : '',
                    mix: chainItemMix(it),
                    gainDb: chainItemGainDb(it),
                }));
        }
        updateChainOption();
    }

    async function chainStepsForId(id) {
        if (!id.startsWith('AUD:')) return 1;
        if (!window.AudacityMacroEngine || !window.AudacityMacroEngine.expandMacroSteps) return 1;
        try {
            const text = await window.AudacityMacroEngine.fetchMacroText(id.slice(4));
            const steps = await window.AudacityMacroEngine.expandMacroSteps(text);
            return Math.max(1, steps.length);
        } catch (e) {
            return 1;
        }
    }


    async function decodeWavBlobDirect(blob) {
        try {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            let pos = 12, fmt = 1, ch = 1, sr = 44100, bits = 16, doff = 0, dlen = 0;
            while (pos + 8 <= bytes.length) {
                const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
                const sz = dv.getUint32(pos + 4, true);
                if (id === 'fmt ') {
                    fmt = dv.getUint16(pos + 8, true);
                    ch = dv.getUint16(pos + 10, true);
                    sr = dv.getUint32(pos + 12, true);
                    bits = dv.getUint16(pos + 22, true);
                } else if (id === 'data') {
                    doff = pos + 8;
                    dlen = sz;
                }
                pos += 8 + sz + (sz & 1);
            }
            const bytesPer = bits >> 3;
            if (!doff || !ch || !bytesPer) return decodeWavBlobToFloat32(blob);
            const frames = Math.floor(Math.min(dlen, bytes.length - doff) / (ch * bytesPer));
            const out = new Float32Array(frames);
            for (let i = 0; i < frames; i++) {
                let acc = 0;
                for (let c = 0; c < ch; c++) {
                    const o = doff + (i * ch + c) * bytesPer;
                    let v = 0;
                    if (bits === 16) v = dv.getInt16(o, true) / 32768;
                    else if (bits === 24) { const x = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16); v = ((x << 8) >> 8) / 8388608; }
                    else if (bits === 32 && fmt === 3) v = dv.getFloat32(o, true);
                    else if (bits === 32) v = dv.getInt32(o, true) / 2147483648;
                    else if (bits === 8) v = (bytes[o] - 128) / 128;
                    acc += v;
                }
                out[i] = acc / ch;
            }
            return { pcm: out, sampleRate: sr };
        } catch (err) {
            return decodeWavBlobToFloat32(blob);
        }
    }

    async function runChainItem(item, pcm, sr, stageProgress, signal) {
        if (item.id.startsWith('AUD:') || item.id.startsWith('CMD:')) {
            if (!window.AudacityMacroEngine) {
                throw new Error('Audacity macro engine unavailable for "' + item.label + '".');
            }
            const opts = { onProgress: stageProgress, signal };
            return item.id.startsWith('AUD:')
                ? await window.AudacityMacroEngine.applyMacroFile(pcm, sr, item.id.slice(4), opts)
                : await window.AudacityMacroEngine.applyMacroText(pcm, sr, item.id.slice(4) + ':' + (item.params || ''), opts);
        }
        const blob = await renderMacroWithSox(pcm, sr, item.id, 0);
        if (!blob) throw new Error('SoX macro "' + item.label + '" failed to render.');
        const dec = await decodeWavBlobDirect(blob);
        if (!dec || !dec.pcm || !dec.pcm.length) throw new Error('SoX macro "' + item.label + '" returned no audio.');
        if (item.id === 'NOISY_DX_RECORDING') {
            return { pcm: addStaticNoiseToPcm(dec.pcm, dec.sampleRate, { level: 0.14, fadeDepth: 0.45, fadeRateHz: 0.6 }), sampleRate: dec.sampleRate };
        }
        return dec;
    }

    function renderEffectChain(pcm, sampleRate, items, onProgress, signal) {
        const cancelSeq = macroCancelSeq;
        return SR.renderChain(pcm, sampleRate, items, {
            runItem: (item, p, sr, stageProgress) => runChainItem(item, p, sr, stageProgress, signal),
            resample: resamplePcmSinc,
            onProgress,
            isCancelled: () => cancelSeq !== macroCancelSeq || !!(signal && signal.aborted),
            cancelError: macroCancelError,
        });
    }

    function applyMacroChainToPcm(pcm, sampleRate, onProgress, signal) {
        return renderEffectChain(pcm, sampleRate, macroChain, onProgress, signal);
    }

    function renderSelectedMacroPcm(pcm, sampleRate, macroId, onProgress) {
        return runExclusive((signal) => renderSelectedMacroPcmNow(pcm, sampleRate, macroId, onProgress, signal));
    }

    async function renderSelectedMacroPcmNow(pcm, sampleRate, macroId, onProgress, signal) {
        const id = macroId || 'FLAT';
        const cancelSeq = macroCancelSeq;
        const cancelled = () => cancelSeq !== macroCancelSeq || !!(signal && signal.aborted);
        const fxPcm = applyExportFxToPcm(pcm, sampleRate, id);
        let out = null;
        if (id === 'CHAIN') {
            out = await applyMacroChainToPcm(fxPcm, sampleRate, onProgress, signal);
        } else if (id.startsWith('AUD:')) {
            if (!window.AudacityMacroEngine) {
                throw new Error('Audacity macro engine unavailable for "' + id.slice(4) + '".');
            }
            out = await window.AudacityMacroEngine.applyMacroFile(fxPcm, sampleRate, id.slice(4), { onProgress, signal });
        } else {
            const blob = await renderMacroWithSox(fxPcm, sampleRate, id, 0);
            out = blob ? await decodeWavBlobDirect(blob) : null;
        }
        if (cancelled()) throw macroCancelError();
        if (!out || !out.pcm || !out.pcm.length) {
            return { pcm: fxPcm, sampleRate, macroApplied: false };
        }
        return {
            pcm: applyChainItemLevel(fxPcm, sampleRate, out.pcm, out.sampleRate, getMacroLevel()),
            sampleRate: out.sampleRate,
            macroApplied: true,
        };
    }

    const macroRenderDoneLabel = (macroId, preview) => {
        if (macroId === 'CHAIN') return preview ? 'Macro preview ready!' : 'Macro chain render complete';
        if (macroId.startsWith('AUD:')) return preview ? 'Macro preview ready!' : 'Macro render complete';
        return null;
    };

    function setupChainEditor() {
        const openBtn = panel.querySelector('[data-splice-chain-editor-btn]');
        if (!openBtn || !macroSelect) return;

        const backdrop = document.createElement('div');
        backdrop.className = 'splice-chain-backdrop';
        backdrop.hidden = true;

        const modal = document.createElement('div');
        modal.className = 'splice-chain-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Macro chain editor');

        const title = document.createElement('h3');
        title.textContent = 'Macro Chain Editor';

        const intro = document.createElement('p');
        intro.className = 'splice-chain-intro';
        const limitsText = 'Limits: ' + MAX_CHAIN_ITEMS + ' macros or ' + MAX_CHAIN_STEPS + ' total effect steps, whichever comes first. Strength blends each macro with the audio going into it (100% is the full effect), and Volume raises or lowers what that macro puts out.';

        const masterTarget = {
            title: 'Macro Chain Editor',
            label: 'Macro chain editor',
            intro: 'Build an ordered chain of macros and effects, applied top to bottom in one pass. ' + limitsText + ' The Macro Strength and Volume boxes under Apply Macro work the same way on the whole chain or on a single macro.',
            listLabel: 'Chain (applied top to bottom)',
            get items() { return macroChain; },
            set items(v) { macroChain = v; },
            mutated: () => onChainMutated(),
            useText: 'Use Chain',
            clearText: 'Clear Chain',
            use: () => {
                if (!macroChain.length) {
                    chainEditorStatus('Chain is empty - add at least one macro first.');
                    return;
                }
                updateChainOption();
                if (macroSelect.value !== 'CHAIN') {
                    macroSelect.value = 'CHAIN';
                    macroSelect.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                    invalidateMacroPreview();
                    scheduleMacroWaveformUpdate();
                }
                closeChainEditor();
                persistStatus('Macro chain selected (' + macroChain.length + ' macro' + (macroChain.length === 1 ? '' : 's') + ').');
            },
        };
        let target = masterTarget;
        const itemsSteps = () => target.items.reduce((a, it) => a + (it.steps || 1), 0);

        const cols = document.createElement('div');
        cols.className = 'splice-chain-cols';

        const availCol = document.createElement('div');
        availCol.className = 'splice-chain-col';
        const availLabel = document.createElement('label');
        availLabel.textContent = 'Available macros and effects';
        availLabel.setAttribute('for', 'splice-chain-search');
        const availSearch = document.createElement('input');
        availSearch.type = 'search';
        availSearch.id = 'splice-chain-search';
        availSearch.className = 'splice-chain-search';
        availSearch.placeholder = 'Filter...';
        const availList = document.createElement('ul');
        availList.className = 'splice-chain-avail-list';
        availList.setAttribute('aria-label', 'Available macros; use the Add button on an entry to append it to the chain');
        availCol.appendChild(availLabel);
        availCol.appendChild(availSearch);
        availCol.appendChild(availList);

        const chainCol = document.createElement('div');
        chainCol.className = 'splice-chain-col';
        const chainLabel = document.createElement('span');
        chainLabel.className = 'splice-chain-col-label';
        chainLabel.id = 'splice-chain-list-label';
        chainLabel.textContent = 'Chain (applied top to bottom)';
        const chainCount = document.createElement('span');
        chainCount.className = 'splice-chain-count';
        const chainListEl = document.createElement('ol');
        chainListEl.className = 'splice-chain-list';
        chainListEl.setAttribute('aria-labelledby', 'splice-chain-list-label');
        chainCol.appendChild(chainLabel);
        chainCol.appendChild(chainCount);
        chainCol.appendChild(chainListEl);

        cols.appendChild(availCol);
        cols.appendChild(chainCol);

        const actions = document.createElement('div');
        actions.className = 'splice-chain-actions';
        const statusSpan = document.createElement('span');
        statusSpan.className = 'splice-chain-status';
        statusSpan.setAttribute('aria-live', 'polite');
        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.textContent = 'Use Chain';
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear Chain';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = 'Close';
        actions.appendChild(statusSpan);
        actions.appendChild(useBtn);
        actions.appendChild(clearBtn);
        actions.appendChild(closeBtn);

        modal.appendChild(title);
        modal.appendChild(intro);
        modal.appendChild(cols);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        const chainEditorStatus = (msg) => {
            statusSpan.textContent = msg || '';
        };

        const collectAvailable = () => {
            const rows = [];
            const walk = (node, group) => {
                for (const child of node.children) {
                    if (child.tagName === 'OPTGROUP') {
                        walk(child, child.label || '');
                    } else if (child.tagName === 'OPTION') {
                        const value = child.value;
                        if (!value || value === 'FLAT' || value === 'CHAIN') continue;
                        const id = value.startsWith('AUD:') ? value : (value === 'ENDEC' ? 'DIGITAL_ENDEC' : value.toUpperCase());
                        rows.push({ id, label: child.textContent || value, group, params: '' });
                    }
                }
            };
            walk(macroSelect, '');
            for (const fx of CHAIN_BUILTIN_EFFECTS) {
                rows.push({ id: 'CMD:' + fx.cmd, label: fx.cmd, group: 'Audacity built-in effects', params: fx.params });
            }
            return rows;
        };

        const renderChainList = () => {
            chainListEl.textContent = '';
            chainCount.textContent = target.items.length
                ? target.items.length + '/' + MAX_CHAIN_ITEMS + ' macros, ' + itemsSteps() + '/' + MAX_CHAIN_STEPS + ' steps'
                : 'Empty - use Add on a macro or effect in the list of available ones.';
            target.items.forEach((item, index) => {
                const li = document.createElement('li');
                li.className = 'splice-chain-item';
                li.draggable = true;
                li.dataset.index = String(index);

                const name = document.createElement('span');
                name.className = 'splice-chain-item-name';
                name.textContent = (index + 1) + '. ' + item.label + ' (' + (item.steps || 1) + ' step' + ((item.steps || 1) === 1 ? '' : 's') + ')';

                let paramsInput = null;
                if (item.id.startsWith('CMD:')) {
                    paramsInput = document.createElement('input');
                    paramsInput.type = 'text';
                    paramsInput.className = 'splice-chain-item-params';
                    paramsInput.value = item.params || '';
                    paramsInput.placeholder = 'Key="Value" parameters';
                    paramsInput.setAttribute('aria-label', 'Parameters for ' + item.label);
                    paramsInput.addEventListener('change', () => {
                        item.params = paramsInput.value;
                        target.mutated('edit effect');
                        chainEditorStatus('Updated parameters for "' + item.label + '".');
                    });
                    paramsInput.addEventListener('pointerdown', () => { li.draggable = false; });
                    paramsInput.addEventListener('blur', () => { li.draggable = true; });
                }

                const level = document.createElement('span');
                level.className = 'splice-chain-item-level';
                const addLevelInput = (labelText, spokenText, key, min, max, read, describe) => {
                    const label = document.createElement('label');
                    label.className = 'splice-chain-item-level-label';
                    label.textContent = labelText + ' ';
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.className = 'splice-chain-item-number';
                    input.min = String(min);
                    input.max = String(max);
                    input.step = '1';
                    input.value = String(read(item));
                    input.dataset.chainLevel = key;
                    input.setAttribute('aria-label', spokenText + ' for "' + item.label + '"');
                    input.addEventListener('change', () => {
                        item[key] = clampChainNumber(input.value, min, max, read({}));
                        input.value = String(item[key]);
                        target.mutated('edit effect');
                        chainEditorStatus('Set "' + item.label + '" ' + describe(item[key]) + '.');
                    });
                    input.addEventListener('pointerdown', () => { li.draggable = false; });
                    input.addEventListener('blur', () => { li.draggable = true; });
                    label.appendChild(input);
                    level.appendChild(label);
                };
                addLevelInput('Strength %', 'Strength in percent', 'mix', CHAIN_MIX_MIN, CHAIN_MIX_MAX, chainItemMix,
                    (v) => 'strength to ' + v + '%');
                addLevelInput('Volume dB', 'Volume in decibels', 'gainDb', CHAIN_GAIN_MIN_DB, CHAIN_GAIN_MAX_DB, chainItemGainDb,
                    (v) => 'volume to ' + (v > 0 ? '+' : '') + v + ' dB');

                const controls = document.createElement('span');
                controls.className = 'splice-chain-item-controls';
                const upBtn = document.createElement('button');
                upBtn.type = 'button';
                upBtn.textContent = '↑';
                upBtn.setAttribute('aria-label', 'Move "' + item.label + '" up');
                upBtn.disabled = index === 0;
                upBtn.addEventListener('click', () => moveChainItem(index, index - 1));
                const downBtn = document.createElement('button');
                downBtn.type = 'button';
                downBtn.textContent = '↓';
                downBtn.setAttribute('aria-label', 'Move "' + item.label + '" down');
                downBtn.disabled = index === target.items.length - 1;
                downBtn.addEventListener('click', () => moveChainItem(index, index + 1));
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.textContent = '✕';
                delBtn.setAttribute('aria-label', 'Remove "' + item.label + '" from chain');
                delBtn.addEventListener('click', () => removeChainItem(index));
                controls.appendChild(upBtn);
                controls.appendChild(downBtn);
                controls.appendChild(delBtn);

                li.appendChild(name);
                if (paramsInput) li.appendChild(paramsInput);
                li.appendChild(controls);
                li.appendChild(level);

                li.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', 'C|' + index);
                    e.dataTransfer.effectAllowed = 'move';
                });

                chainListEl.appendChild(li);
            });
        };

        const renderAvailList = () => {
            availList.textContent = '';
            const filter = availSearch.value.trim().toLowerCase();
            let lastGroup = null;
            for (const row of collectAvailable()) {
                if (filter && row.label.toLowerCase().indexOf(filter) === -1) continue;
                if (row.group !== lastGroup && row.group) {
                    const head = document.createElement('li');
                    head.className = 'splice-chain-group';
                    head.textContent = row.group;
                    availList.appendChild(head);
                }
                lastGroup = row.group;
                const li = document.createElement('li');
                li.className = 'splice-chain-avail-item';
                li.draggable = true;

                const name = document.createElement('span');
                name.className = 'splice-chain-item-name';
                name.textContent = row.label;

                const addBtn = document.createElement('button');
                addBtn.type = 'button';
                addBtn.textContent = 'Add';
                addBtn.setAttribute('aria-label', 'Add "' + row.label + '" to chain');
                addBtn.addEventListener('click', () => { addChainItem(row.id, row.label, target.items.length, row.params); });

                li.appendChild(name);
                li.appendChild(addBtn);
                li.addEventListener('dblclick', () => { addChainItem(row.id, row.label, target.items.length, row.params); });
                li.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ t: 'A', id: row.id, label: row.label, params: row.params }));
                    e.dataTransfer.effectAllowed = 'copy';
                });
                availList.appendChild(li);
            }
            if (!availList.children.length) {
                const empty = document.createElement('li');
                empty.className = 'splice-chain-group';
                empty.textContent = 'No macros match.';
                availList.appendChild(empty);
            }
        };

        async function addChainItem(id, label, at, params) {
            if (target.items.length >= MAX_CHAIN_ITEMS) {
                chainEditorStatus('Chain is full (max ' + MAX_CHAIN_ITEMS + ' macros).');
                return;
            }
            const steps = await chainStepsForId(id);
            const total = itemsSteps();
            if (total + steps > MAX_CHAIN_STEPS) {
                chainEditorStatus('Adding "' + label + '" would exceed the budget of ' + MAX_CHAIN_STEPS + ' effect steps (chain has ' + total + ', this adds ' + steps + ').');
                return;
            }
            const index = Math.max(0, Math.min(target.items.length, at));
            target.items.splice(index, 0, { id, label, steps, params: params || '', mix: CHAIN_MIX_MAX, gainDb: 0 });
            target.mutated('add effect');
            renderChainList();
            chainEditorStatus('Added "' + label + '".');
        }

        function moveChainItem(from, to) {
            const items = target.items;
            if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return;
            const [item] = items.splice(from, 1);
            items.splice(to, 0, item);
            target.mutated('reorder effects');
            renderChainList();
        }

        function removeChainItem(index) {
            if (index < 0 || index >= target.items.length) return;
            const [item] = target.items.splice(index, 1);
            target.mutated('remove effect');
            renderChainList();
            chainEditorStatus('Removed "' + item.label + '".');
        }

        const getDropIndex = (e) => {
            const lis = [...chainListEl.querySelectorAll('li[data-index]')];
            for (const li of lis) {
                const r = li.getBoundingClientRect();
                if (e.clientY < r.top + r.height / 2) return parseInt(li.dataset.index, 10);
            }
            return target.items.length;
        };

        const clearDropMarkers = () => {
            for (const li of chainListEl.querySelectorAll('.splice-chain-drop-before')) {
                li.classList.remove('splice-chain-drop-before');
            }
            chainListEl.classList.remove('splice-chain-drop-end');
        };

        chainListEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            clearDropMarkers();
            const idx = getDropIndex(e);
            const target = chainListEl.querySelector('li[data-index="' + idx + '"]');
            if (target) target.classList.add('splice-chain-drop-before');
            else chainListEl.classList.add('splice-chain-drop-end');
        });
        chainListEl.addEventListener('dragleave', (e) => {
            if (!chainListEl.contains(e.relatedTarget)) clearDropMarkers();
        });
        chainListEl.addEventListener('drop', (e) => {
            e.preventDefault();
            clearDropMarkers();
            const raw = e.dataTransfer.getData('text/plain') || '';
            const idx = getDropIndex(e);
            let data = null;
            try {
                data = JSON.parse(raw);
            } catch (err) {
                data = null;
            }
            if (data && data.t === 'A' && typeof data.id === 'string') {
                addChainItem(data.id, data.label || data.id, idx, data.params || '');
            } else if (data === null && raw.startsWith('C|')) {
                const from = parseInt(raw.slice(2), 10);
                if (Number.isFinite(from)) {
                    let to = idx;
                    if (from < to) to--;
                    moveChainItem(from, Math.max(0, Math.min(target.items.length - 1, to)));
                }
            }
        });

        let lastFocus = null;
        const openChainEditor = (next = masterTarget) => {
            target = next;
            lastFocus = document.activeElement;
            title.textContent = target.title;
            modal.setAttribute('aria-label', target.label);
            intro.textContent = target.intro;
            chainLabel.textContent = target.listLabel;
            useBtn.textContent = target.useText;
            clearBtn.textContent = target.clearText;
            closeBtn.hidden = target !== masterTarget;
            availSearch.value = '';
            renderAvailList();
            renderChainList();
            chainEditorStatus('');
            backdrop.hidden = false;
            availSearch.focus();
        };
        function closeChainEditor() {
            backdrop.hidden = true;
            target = masterTarget;
            if (lastFocus && lastFocus.isConnected && typeof lastFocus.focus === 'function') lastFocus.focus();
            else if (editor) editor.focusGrid();
        }

        const fxTarget = (kind, id) => {
            const find = () => (kind === 'clip' ? (SM.findClip(project, id) || {}).clip : SM.findTrack(project, id));
            const obj = find();
            if (!obj) return null;
            const name = kind === 'clip' ? (obj.label || project.sources.get(obj.sourceId)?.label || 'clip') : obj.name;
            const t = {
                title: (kind === 'clip' ? 'Clip Effects: ' : 'Track Effects: ') + name,
                label: (kind === 'clip' ? 'Effects on clip ' : 'Effects on track ') + name,
                intro: (kind === 'clip'
                    ? 'These effects run on this clip only, top to bottom, and render in the background. Effects that change the length, such as Change Speed or Repeat, make the clip longer or shorter on the timeline. '
                    : 'These effects run on everything this track plays, after each clip\'s own effects, top to bottom, and render in the background. ') + limitsText,
                listLabel: 'Effects (applied top to bottom)',
                items: SM.cloneFx(obj.effects),
                mutated: (label) => {
                    const cur = find();
                    if (!cur) return;
                    const next = t.items.map(SR.cleanItem);
                    if (SM.sameJson(cur.effects.map(SR.cleanItem), next)) return;
                    editHistory.push(project, (kind === 'clip' ? 'clip ' : 'track ') + (label || 'effects'));
                    find().effects = next;
                    projectChanged();
                },
                reload: () => {
                    const cur = find();
                    if (!cur) return false;
                    if (SM.sameJson(cur.effects.map(SR.cleanItem), t.items.map(SR.cleanItem))) return 'same';
                    t.items = SM.cloneFx(cur.effects);
                    return true;
                },
                useText: 'Done',
                clearText: 'Remove All',
                use: () => closeChainEditor(),
            };
            return t;
        };

        openEffectsEditorFn = (kind, id) => {
            const t = fxTarget(kind, id);
            if (t) openChainEditor(t);
        };
        refreshEffectsEditorFn = () => {
            if (backdrop.hidden || !target.reload) return;
            const r = target.reload();
            if (!r) closeChainEditor();
            else if (r !== 'same') renderChainList();
        };

        openBtn.addEventListener('click', () => openChainEditor(masterTarget));
        closeBtn.addEventListener('click', closeChainEditor);
        backdrop.addEventListener('mousedown', (e) => {
            if (e.target === backdrop) closeChainEditor();
        });
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeChainEditor();
                return;
            }
            if (e.key !== 'Tab') return;
            const stops = [...modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
                .filter((n) => !n.disabled && n.getClientRects().length > 0);
            if (!stops.length) return;
            const first = stops[0];
            const last = stops[stops.length - 1];
            if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        });
        availSearch.addEventListener('input', renderAvailList);

        clearBtn.addEventListener('click', () => {
            target.items = [];
            target.mutated('remove all effects');
            renderChainList();
            chainEditorStatus(target === masterTarget ? 'Chain cleared.' : 'All effects removed.');
        });

        useBtn.addEventListener('click', () => target.use());
    }

    function setupMacroUpload() {
        if (!macroUploadBtn || !macroUploadInput) return;
        macroUploadBtn.addEventListener('click', () => macroUploadInput.click());
        macroUploadInput.addEventListener('change', () => {
            const f = macroUploadInput.files && macroUploadInput.files[0];
            macroUploadInput.value = '';
            if (f) handleMacroUpload(f);
        });
        if (macroRemoveBtn) {
            macroRemoveBtn.addEventListener('click', () => { removeSelectedCustomMacro(); });
        }
        if (macroSelect) {
            macroSelect.addEventListener('change', updateRemoveMacroState);
        }
        updateRemoveMacroState();
    }

    let audacityListStarted = false;
    function ensureAudacityMacroList() {
        if (audacityListStarted || !window.AudacityMacroEngine || !window.AudacityMacroEngine.loadMacroList) return;
        audacityListStarted = true;
        window.AudacityMacroEngine.loadMacroList()
            .then(() => addAudacityMacrosToSelect())
            .catch((e) => console.warn('[Splicer] Audacity macro list unavailable:', e));
    }

    let audacityMacrosStarted = false;
    function ensureAudacityMacros() {
        if (audacityMacrosStarted || !window.AudacityMacroEngine) return;
        audacityMacrosStarted = true;
        window.AudacityMacroEngine.ready()
            .then(() => addAudacityMacrosToSelect())
            .catch((e) => console.warn('[Splicer] Audacity macro engine unavailable:', e));
    }

    async function loadSoxMacroDefs() {
        try {
            const resp = await fetch('assets/splicer-sox-macros.json', { cache: 'no-store' });
            if (!resp.ok) {
                reportErrorStatus(`SoX macro JSON load failed (status ${resp.status}).`);
                return;
            }
            const json = await resp.json();
            soxMacroDefs = json || {};
            soxMacrosLoaded = true;
            const count = Object.keys(soxMacroDefs).length;
            if (count) {
                persistStatus(`Loaded ${count} SoX macros.`, true);
                populateMacroSelect();
                if (shouldUseMacroWaveform()) {
                    scheduleMacroWaveformUpdate(true);
                }
            } else {
                reportErrorStatus('SoX macro JSON is empty.');
            }
        } catch (err) {
            reportErrorStatus(`Failed to load SoX macros JSON: ${err}`, err);
        }
    }


    function float32ToSoxRaw(pcm) {
        const out = new Int16Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) {
            let s = pcm[i];
            s = Math.max(-1, Math.min(1, s));
            out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        return new Uint8Array(out.buffer);
    }

    function addStaticNoiseToPcm(pcm, sampleRate, options) {
        const out = new Float32Array(pcm.length);

        const noiseLevel = options && typeof options.level === 'number'
            ? options.level
            : 0.12;
        const fadeDepth = options && typeof options.fadeDepth === 'number'
            ? options.fadeDepth
            : 0.4;
        const fadeRateHz = options && typeof options.fadeRateHz === 'number'
            ? options.fadeRateHz
            : 0.7;

        const twoPi = 2 * Math.PI;
        const sr = sampleRate || 44100;

        for (let i = 0; i < pcm.length; i++) {
            const s = pcm[i];
            const t = i / sr;

            const fade = 1 - fadeDepth * (0.5 * (1 + Math.sin(twoPi * fadeRateHz * t)));

            const noise = (Math.random() * 2 - 1) * noiseLevel * fade;

            let v = s + noise;
            if (v > 1) v = 1;
            else if (v < -1) v = -1;

            out[i] = v;
        }

        return out;
    }

    function bitcrushPcm(pcm, sampleRate, options) {
        if (!(pcm instanceof Float32Array) || pcm.length === 0) {
            return pcm;
        }

        const bitsRaw = options && Number.isFinite(options.bits) ? options.bits : 8;
        const bits = Math.max(1, Math.min(16, Math.round(bitsRaw)));

        const factorRaw = options && Number.isFinite(options.downsampleFactor) ? options.downsampleFactor : 1;
        const factor = Math.max(1, Math.min(64, Math.round(factorRaw)));

        if (bits >= 16 && factor <= 1) {
            return pcm;
        }

        const out = new Float32Array(pcm.length);
        const levels = Math.pow(2, bits - 1);
        let held = 0;

        for (let i = 0; i < pcm.length; i++) {
            if (i % factor === 0) {
                let q = Math.round(pcm[i] * levels) / levels;
                if (q > 1) q = 1;
                else if (q < -1) q = -1;
                held = q;
            }
            out[i] = held;
        }

        return out;
    }

    function add60HzHumToPcm(pcm, sampleRate, level = 0.01) {
        const out = new Float32Array(pcm.length);
        const twoPi = 2 * Math.PI;
        const sr = sampleRate || 44100;

        for (let i = 0; i < pcm.length; i++) {
            const s = pcm[i];
            const t = i / sr;

            const hum = Math.sin(twoPi * 60 * t) * level;

            let v = s + hum;
            if (v > 1) v = 1;
            else if (v < -1) v = -1;

            out[i] = v;
        }

        return out;
    }

    function applyExportFxToPcm(pcm, sampleRate, macroId) {
        const id = (macroId || 'FLAT').toUpperCase();
        let workingPcm = pcm;

        const enableVmifyEl = document.getElementById('enable-vmify');
        const enableVmify = enableVmifyEl ? enableVmifyEl.checked === true : false;

        if (enableVmify) {
            const vmifyIntensityEl = document.getElementById('vmify-intensity');
            const vmifyIntensity = vmifyIntensityEl ? parseFloat(vmifyIntensityEl.value) : 1;

            workingPcm = vmifyPcm(workingPcm, sampleRate, {
                intensity: Number.isFinite(vmifyIntensity) ? vmifyIntensity : 1
            });
        }

        const enableBitcrushEl = document.getElementById('enable-bitcrush');
        const enableBitcrush = enableBitcrushEl ? enableBitcrushEl.checked === true : false;

        if (enableBitcrush) {
            const bitsInput = document.getElementById('bitcrush-bits');
            const bits = bitsInput ? parseFloat(bitsInput.value) : 8;

            const downsampleInput = document.getElementById('bitcrush-downsample');
            const downsampleFactor = downsampleInput ? parseFloat(downsampleInput.value) : 1;

            workingPcm = bitcrushPcm(workingPcm, sampleRate, {
                bits: bits,
                downsampleFactor: downsampleFactor
            });
        }

        const enableStaticNoiseEl = document.getElementById('enable-static-noise');
        const enableStaticNoise = enableStaticNoiseEl ? enableStaticNoiseEl.checked === true : false;

        if (enableStaticNoise && id !== 'NOISY_DX_RECORDING') {
            const noiseLevelInput = document.getElementById('static-noise-level');
            const noiseLevel = noiseLevelInput ? parseFloat(noiseLevelInput.value) : 0.01;

            const fadeDepthInput = document.getElementById('static-noise-fade-depth');
            const fadeDepth = fadeDepthInput ? parseFloat(fadeDepthInput.value) : 0.0;

            const fadeRateInput = document.getElementById('static-noise-fade-rate');
            const fadeRateHz = fadeRateInput ? parseFloat(fadeRateInput.value) : 0.0;

            workingPcm = addStaticNoiseToPcm(workingPcm, sampleRate, {
                level: noiseLevel,
                fadeDepth: fadeDepth,
                fadeRateHz: fadeRateHz
            });
        }

        else if (id === 'NOISY_DX_RECORDING') {
            workingPcm = addStaticNoiseToPcm(workingPcm, sampleRate, {
                level: 0.14,
                fadeDepth: 0.45,
                fadeRateHz: 0.6
            });
        }

        if (enable60HzHum) {
            const humLevelInput = document.getElementById('hum-level');
            const humLevel = humLevelInput ? parseFloat(humLevelInput.value) : 0.01;

            workingPcm = add60HzHumToPcm(workingPcm, sampleRate, humLevel);
        }

        return workingPcm;
    }

    async function renderMacroWithSox(pcm, sampleRate, macroId, loudnessDbfs = getExportLoudnessDbfs()) {
        const id = (macroId || 'FLAT').toUpperCase();

        if (!soxMacrosLoaded || !soxMacroDefs[id]) {
            return null;
        }

        if (typeof window.SOXModule !== 'function') {
            reportErrorStatus('SoX engine is not available (SOXModule missing).');
            return null;
        }

        const macro = soxMacroDefs[id];
        if (!Array.isArray(macro.effects) || !macro.effects.length) {
            return null;
        }
        const effects = macro.effects.slice();
        const loudnessArgs = buildSoxLoudnessArgs(loudnessDbfs);
        if (loudnessArgs.length) effects.push(...loudnessArgs);

        const raw = float32ToSoxRaw(pcm);

        const moduleConfig = {
            arguments: [
                '-r', String(sampleRate),
                '-L', '-e', 'signed-integer', '-b', '16', '-c', '1',
                'in.raw',
                'out.wav',
                ...effects,
            ],
            preRun(mod) {
                (mod || moduleConfig).FS.writeFile('in.raw', raw);
            },
            postRun() { },
        };

        try {
            const maybePromise = window.SOXModule(moduleConfig);
            let modInstance = moduleConfig;

            if (maybePromise && typeof maybePromise.then === 'function') {
                modInstance = await maybePromise;
            } else if (maybePromise && maybePromise.FS) {
                modInstance = maybePromise;
            }

            const fs = modInstance.FS || moduleConfig.FS;
            if (!fs) {
                reportErrorStatus('SoX FS not available after module run.');
                return null;
            }

            const output = fs.readFile('out.wav', { encoding: 'binary' });
            return new Blob([output], { type: 'audio/wav' });
        } catch (err) {
            reportErrorStatus(`SoX render failed for macro \`${id}\`: ${err}`, err);
            return null;
        }
    }

    function encodeWavFromPcm(pcm, sampleRate, format = 'pcm16') {
        return SE.encodeAll(Array.isArray(pcm) ? pcm : [pcm], sampleRate, format,
            { bitrate: SE.bitrateOf(format, outputPrefs.bitrates[SE.formatOf(format)]), resample: resamplePcmSinc });
    }

    const perChannel = async (chans, fn) => {
        const out = [];
        for (let i = 0; i < chans.length; i++) {
            const same = chans.indexOf(chans[i]);
            out.push(same < i ? out[same] : await fn(chans[i]));
        }
        return out;
    };

    async function renderMacroToWavFromPcm(pcm, sampleRate, macroId, format = 'pcm16') {
        const chans = Array.isArray(pcm) ? pcm : [pcm];
        if (!chans[0] || !chans[0].length) {
            reportErrorStatus('FX: cannot render macro – empty PCM data.');
            throw new Error('renderMacroToWavFromPcm: empty PCM data');
        }

        const id = macroId || 'FLAT';
        const exportGain = getExportGain();
        const finish = (raws, rate) => {
            const limited = finishChans(raws, rate, exportGainFactor());
            lastMacroOver = limited ? limited.over : SL.peakRatio(raws, exportGainFactor());
            lastMacroLimited = !!limited;
            return encodeWavFromPcm(limited ? limited.chans : raws.map((r) => clonePcmWithGain(r, exportGain)), rate, format);
        };

        let outs = null;
        let outRate = sampleRate;
        try {
            outs = await perChannel(chans, async (c) => {
                const processed = await trackMacroJob(() => renderSelectedMacroPcm(c, sampleRate, id, macroProgressCb));
                outRate = processed.sampleRate;
                return processed.pcm;
            });
            const doneLabel = macroRenderDoneLabel(id, false);
            if (doneLabel) setMacroProgress(1, doneLabel);
        } catch (err) {
            setMacroProgress(1, '');
            if (isMacroCancelError(err)) {
                cancelStatus('Macro processing cancelled.');
                throw err;
            }
            if (isMacroAssetError(err)) {
                persistStatus(err.message, false);
                throw err;
            }
            const what = id === 'CHAIN' ? 'Macro chain' : (id.startsWith('AUD:') ? `Audacity macro '${id.slice(4)}'` : `Macro '${id}'`);
            reportErrorStatus(what + ' failed; exporting dry.', err);
            return finish(chans.map((c) => applyExportFxToPcm(c, sampleRate, id)), sampleRate);
        }
        return finish(outs, outRate);
    }

    let lastMacroOver = 1;
    let lastMacroLimited = false;

    window.EASSplicerFX = window.EASSplicerFX || {};
    window.EASSplicerFX.renderMacroToWavFromPcm = renderMacroToWavFromPcm;

    const getMacroRenderKey = (macroId) => {
        const staticEnabled = enableStaticNoiseCheckbox?.checked === true;
        const humEnabled = enable60HzHumCheckbox?.checked === true;
        const bitcrushEnabled = enableBitcrushCheckbox?.checked === true;
        const vmifyEnabled = enableVmifyCheckbox?.checked === true;
        return [
            (macroId || 'FLAT').toUpperCase(),
            state.sampleRate,
            getExportLoudnessDbfs(),
            staticEnabled ? '1' : '0',
            staticEnabled ? (staticNoiseLevelInput?.value ?? '') : '',
            staticEnabled ? (staticNoiseFadeDepthInput?.value ?? '') : '',
            staticEnabled ? (staticNoiseFadeRateInput?.value ?? '') : '',
            humEnabled ? '1' : '0',
            humEnabled ? (humLevelInput?.value ?? '') : '',
            bitcrushEnabled ? '1' : '0',
            bitcrushEnabled ? (bitcrushBitsInput?.value ?? '') : '',
            bitcrushEnabled ? (bitcrushDownsampleInput?.value ?? '') : '',
            vmifyEnabled ? '1' : '0',
            vmifyEnabled ? (vmifyIntensityInput?.value ?? '') : '',
            (macroId || '').toUpperCase() === 'CHAIN' ? chainSig() : '',
            macroLevelSig(),
        ].join('|');
    };

    const getMacroOutputSignature = (macroId) => {
        const staticEnabled = enableStaticNoiseCheckbox?.checked === true;
        const humEnabled = enable60HzHumCheckbox?.checked === true;
        const bitcrushEnabled = enableBitcrushCheckbox?.checked === true;
        const vmifyEnabled = enableVmifyCheckbox?.checked === true;
        return [
            (macroId || 'FLAT').toUpperCase(),
            state.sampleRate,
            state.pcm.length,
            staticEnabled ? '1' : '0',
            staticEnabled ? (staticNoiseLevelInput?.value ?? '') : '',
            staticEnabled ? (staticNoiseFadeDepthInput?.value ?? '') : '',
            staticEnabled ? (staticNoiseFadeRateInput?.value ?? '') : '',
            humEnabled ? '1' : '0',
            humEnabled ? (humLevelInput?.value ?? '') : '',
            bitcrushEnabled ? '1' : '0',
            bitcrushEnabled ? (bitcrushBitsInput?.value ?? '') : '',
            bitcrushEnabled ? (bitcrushDownsampleInput?.value ?? '') : '',
            vmifyEnabled ? '1' : '0',
            vmifyEnabled ? (vmifyIntensityInput?.value ?? '') : '',
            (macroId || '').toUpperCase() === 'CHAIN' ? chainSig() : '',
            macroLevelSig(),
        ].join('|');
    };

    const getSegmentPcmRefs = () => [state.pcm];

    const sameSegmentPcmRefs = (a, b) => {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    };

    const renderMacroBlobCached = async (macroId, format = 'pcm16') => {
        if (macroWaveformDebounce && macroWaveformPendingKey && macroWaveformPendingKey === getMacroWaveformKey()) {
            clearTimeout(macroWaveformDebounce);
            macroWaveformDebounce = null;
            generateMacroWaveformForKey(macroWaveformPendingKey);
        }
        const pending = macroWaveformJob;
        if (pending && macroWaveformPendingKey && macroWaveformPendingKey === getMacroWaveformKey()) {
            const cancelSeq = macroCancelSeq;
            await (pending.settled || pending).catch(() => null);
            if (cancelSeq !== macroCancelSeq) throw macroCancelError();
        }
        const key = getMacroRenderKey(macroId) + '|' + SE.formatOf(format) + ':' + SE.bitrateOf(format, outputPrefs.bitrates[SE.formatOf(format)]) + '|' + outputSig();
        const segRefs = getSegmentPcmRefs();
        if (macroRenderBlobCache
            && macroRenderBlobCache.key === key
            && sameSegmentPcmRefs(macroRenderBlobCache.segRefs, segRefs)) {
            lastMacroOver = macroRenderBlobCache.over;
            lastMacroLimited = macroRenderBlobCache.limited;
            return macroRenderBlobCache.blob;
        }
        if (macroWaveformPcm && macroWaveformPcm.length && !stereoPanned()
            && macroWaveformOutputSig && macroWaveformOutputSig === getMacroOutputSignature(macroId)) {
            const limited = finishChans([macroWaveformPcm], macroWaveformSampleRate, exportGainFactor());
            const reused = limited ? limited.chans[0] : clonePcmWithGain(macroWaveformPcm, getExportGain());
            lastMacroOver = limited ? limited.over : SL.peakRatio([macroWaveformPcm], exportGainFactor());
            lastMacroLimited = !!limited;
            const reusedBlob = await encodeWavFromPcm(outStereo() ? [reused, reused] : [reused], macroWaveformSampleRate, format);
            if (reusedBlob) {
                macroRenderBlobCache = { key, blob: reusedBlob, segRefs, over: lastMacroOver, limited: lastMacroLimited };
                return reusedBlob;
            }
        }
        const blob = await renderMacroToWavFromPcm(outputChannels(), state.sampleRate, macroId, format);
        if (blob) {
            macroRenderBlobCache = { key, blob, segRefs, over: lastMacroOver, limited: lastMacroLimited };
        }
        return blob;
    };

    async function previewCurrentMacro() {
        if (!state.disk && (typeof state === 'undefined' || !state.pcm || !state.pcm.length)) {
            reportErrorStatus('No PCM data available to preview.');
            return;
        }

        if (previewMacroBtn) {
            previewMacroBtnWasDisabled = previewMacroBtn.disabled;
            setPreviewMacroButtonState('Rendering macro...', true);
        }

        const macroId = getSelectedMacroId();
        console.log('[Splicer] previewCurrentMacro macroId =', macroId);

        let previewOffsetSec = 0;
        try {
            let blob;
            if (state.disk) {
                const psr = state.sampleRate || 44100;
                const a = Math.floor(state.selection.start * psr);
                const b = Math.floor((state.selection.end > state.selection.start ? state.selection.end : duration()) * psr);
                if (b <= a) { resetPreviewMacroButton(); return; }
                if (b - a > MACRO_MEM_FRAMES) {
                    const capMin = (MACRO_MEM_FRAMES / psr / 60).toFixed(1);
                    persistStatus('Select ' + capMin + ' min or less to preview a macro on a large file (Export applies supported effects to the whole file).', false);
                    resetPreviewMacroButton();
                    return;
                }
                previewOffsetSec = a / psr;
                const pcm = await materializeTimelineRange(a, b);
                if (!pcm) { resetPreviewMacroButton(); return; }
                blob = await renderMacroToWavFromPcm(pcm, psr, macroId);
            } else {
                if (fxJobs.size || fxMissing()) await ensureFxReady();
                blob = await renderMacroBlobCached(macroId);
            }

            if (playingSource) {
                stopPlayback();
            }

            clearMacroPreviewInterval();
            const playbackInterval = setInterval(updatePlaybackMarker, 1);

            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            let urlCleaned = false;
            const cleanupUrl = () => {
                if (urlCleaned) return;
                urlCleaned = true;
                URL.revokeObjectURL(url);
            };
            macroPreviewPlayback = { audio, cleanup: cleanupUrl, paused: false, macroId, offset: previewOffsetSec };

            audio.stop = () => {
                try {
                    audio.pause();
                } catch (err) {
                    reportErrorStatus(`Failed to pause macro preview audio: ${err}`);
                }
                try {
                    audio.currentTime = 0;
                } catch (err) {
                    reportErrorStatus(`Failed to reset macro preview audio position: ${err}`);
                }
                cleanupUrl();
            };

            const finalizePlayback = () => {
                cleanupUrl();
                if (macroPreviewPlayback?.audio === audio) {
                    clearMacroPreviewInterval();
                    macroPreviewPlayback = null;
                }
                if (playingSource === audio) {
                    playingSource = null;
                    playingMode = null;
                    pausedPlayback = null;
                    playSpan = 0;
                    playStartOffset = 0;
                    clearInterval(playbackInterval);
                    drawWaveform();
                    syncPlayButtons();
                    resetPreviewMacroButton();
                }
            };

            audio.addEventListener('ended', finalizePlayback);
            audio.addEventListener('error', (event) => {
                reportErrorStatus(
                    `Macro preview audio error: ${event?.error || event}`,
                    event?.error || event
                );
                finalizePlayback();
            });

            playingSource = audio;
            playingMode = 'macro-preview';
            pausedPlayback = null;
            setPreviewMacroButtonState('Pause Preview', false);

            const ctxAudio = audioCtx || getAudioCtx();
            if (ctxAudio && ctxAudio.state === 'suspended' && typeof ctxAudio.resume === 'function') {
                try {
                    await ctxAudio.resume();
                } catch (err) {
                    reportErrorStatus(`Failed to resume audio context for macro preview: ${err}`);
                }
            }

            const startOffset = state.disk ? 0 : clamp(playheadTime, 0, Math.max(0, duration()));
            const seekAudioToStart = () => {
                if (startOffset <= 0) return;
                try {
                    const dur = (Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : null;
                    const target = dur !== null ? Math.min(startOffset, Math.max(0, dur - 0.01)) : startOffset;
                    if (target > 0 && Math.abs((audio.currentTime || 0) - target) > 0.001) {
                        audio.currentTime = target;
                    }
                } catch (err) {
                    reportErrorStatus(`Failed to seek macro preview to needle position: ${err}`, err);
                }
            };

            const ensureSpanFromAudio = () => {
                if (Number.isFinite(audio.duration) && audio.duration > 0) {
                    playSpan = Math.max(0.001, audio.duration);
                }
            };
            playSpan = Math.max(0.001, duration());
            ensureSpanFromAudio();
            audio.addEventListener('loadedmetadata', ensureSpanFromAudio, { once: true });

            playStartOffset = startOffset;
            playStartedAt = ctxAudio ? ctxAudio.currentTime : 0;
            syncPlayButtons();

            const startMacroPlayback = () => {
                const playPromise = audio.play();
                if (playPromise?.catch) {
                    playPromise.catch((err) => {
                        const interruptedByPause =
                            err?.name === 'AbortError' ||
                            (typeof err?.message === 'string' &&
                                err.message.includes('The play() request was interrupted by a call to pause'));
                        if (interruptedByPause) return;
                        finalizePlayback();
                        reportErrorStatus(`previewCurrentMacro playback failed: ${err}`, err);
                    });
                }
            };

            if (startOffset > 0 && !(Number.isFinite(audio.duration) && audio.duration > 0)) {
                audio.addEventListener('loadedmetadata', () => {
                    seekAudioToStart();
                    startMacroPlayback();
                }, { once: true });
            } else {
                seekAudioToStart();
                startMacroPlayback();
            }
        } catch (err) {
            clearMacroPreviewInterval();
            macroPreviewPlayback = null;
            const playbackInterval = null;
            resetPreviewMacroButton();
            reportErrorStatus(`previewCurrentMacro failed: ${err}`, err);
        }
    }

    const exportExtrasActive = () => {
        const ids = ['enable-vmify', 'enable-bitcrush', 'enable-static-noise'];
        for (const id of ids) { const el = document.getElementById(id); if (el && el.checked === true) return true; }
        return false;
    };

    const macroIsStreamable = (text) => {
        let any = false;
        for (const raw of String(text).split(/\r?\n/)) {
            const line = raw.trim(); if (!line) continue;
            const ci = line.indexOf(':'); if (ci < 0) continue;
            const cmd = line.slice(0, ci).trim();
            if (cmd === 'Message') continue;
            if (cmd.startsWith('Macro_')) return false;
            if (!MACRO_CHUNK_SAFE.has(cmd)) return false;
            any = true;
        }
        return any;
    };

    async function streamExportMacroDisk(macroId, sr, totalFrames) {
        if (!macroId || !window.AudacityMacroEngine) return false;
        if (exportExtrasActive()) return false;
        let text;
        let streamName;
        try {
            if (macroId === 'CHAIN') {
                if (!macroChain.length || macroChain.some((it) => !it.id.startsWith('AUD:') && !it.id.startsWith('CMD:'))) return false;
                if (macroChain.some((it) => chainItemMix(it) !== CHAIN_MIX_MAX)) return false;
                text = macroChain.map((it) => {
                    const line = it.id.startsWith('AUD:')
                        ? 'Macro_' + it.id.slice(4).replace(/\.txt$/i, '') + ':'
                        : it.id.slice(4) + ':' + (it.params || '');
                    const gainDb = chainItemGainDb(it);
                    return gainDb === 0 ? line : line + '\nAmplify:Ratio="' + Math.pow(10, gainDb / 20) + '"';
                }).join('\n');
                streamName = 'Macro Chain';
            } else if (macroId.startsWith('AUD:')) {
                text = await window.AudacityMacroEngine.fetchMacroText(macroId.slice(4));
                streamName = macroId.slice(4);
            } else {
                return false;
            }
            const level = getMacroLevel();
            if (level.mix !== CHAIN_MIX_MAX) return false;
            if (level.gainDb !== 0) text += '\nAmplify:Ratio="' + Math.pow(10, level.gainDb / 20) + '"';
            if (window.AudacityMacroEngine.expandMacroFlat) {
                text = await window.AudacityMacroEngine.expandMacroFlat(text);
            }
        }
        catch (e) { return false; }
        if (!macroIsStreamable(text)) return false;

        const fmt = outFormat();
        const info = outInfo();
        let outFh, writable;
        try {
            const dir = await opfsHugeDir();
            outFh = await dir.getFileHandle('export.' + info.ext, { create: true });
            writable = await outFh.createWritable();
        } catch (e) { persistStatus('Could not open device storage for export.', false); return true; }

        const nch = outStereo() ? 2 : 1;
        const gain = exportGainFactor();
        const lim = limitOn() ? SL.createLimiter({ sampleRate: sr }) : null;
        let over = 1;
        const W = MACRO_STREAM_W;
        const WIN = STREAM_WIN_FRAMES;
        const name = streamName;
        const cancelSeq = macroCancelSeq;
        macroJobsActive++;
        syncMacroCancelBtn();
        let out = null;
        try {
            out = await SE.createWriter(fmt, { sampleRate: sr, channels: nch, frames: totalFrames, bitrate: outBitrate(), sink: writable });
            for (let start = 0; start < totalFrames; start += WIN) {
                if (cancelSeq !== macroCancelSeq) throw macroCancelError();
                const end = Math.min(totalFrames, start + WIN);
                const wa = Math.max(0, start - W);
                const wb = Math.min(totalFrames, end + W);
                let wins;
                try { wins = await mixRangeChannels(wa, wb); }
                catch (e) { wins = null; persistStatus('Not enough memory to apply this effect. Trim to a shorter selection.', false); }
                if (!wins) { await out.cancel(); try { await writable.close(); } catch (_) {} return true; }
                const outs = await perChannel(wins, async (win) => {
                    const processed = await runExclusive((signal) => window.AudacityMacroEngine.applyMacroText(win, sr, text, { signal }));
                    const p = processed && processed.pcm;
                    return p && p.length === win.length ? p : null;
                });
                if (outs.some((p) => !p)) {
                    await out.cancel();
                    try { await writable.close(); } catch (_) {}
                    persistStatus('This macro changes length and cannot stream; trim to a smaller clip.', false);
                    return true;
                }
                const off = start - wa, n = end - start;
                if (lim) {
                    await out.write(lim.process(outs, off, n, gain), 0, n, 1);
                } else {
                    over = Math.max(over, SL.peakRatio(outs.map((o) => o.subarray(off, off + n)), gain));
                    await out.write(outs, off, n, gain);
                }
                persistStatus('Applying "' + name + '" to whole file... ' + Math.round((end / totalFrames) * 100) + '%');
                await new Promise((rr) => setTimeout(rr));
            }
            await out.finish();
        } catch (e) {
            if (out) await out.cancel();
            try { await writable.close(); } catch (_) {}
            if (isMacroCancelError(e)) cancelStatus('Macro processing cancelled.');
            else reportErrorStatus('Streaming macro export failed for "' + name + '".', e);
            return true;
        } finally {
            macroJobsActive = Math.max(0, macroJobsActive - 1);
            syncMacroCancelBtn();
        }

        let outFile;
        try { outFile = await outFh.getFile(); } catch (e) { spokenStatus('Export failed while reading back.', false); return true; }
        try {
            await saveFile(outFileName('splice'), outFile, info.mime);
            spokenStatus(`${info.name} exported with "${name}"!` + overNote(lim ? lim.over : over, !!lim, fmt), true);
        } catch (e) {
            spokenStatus('Export save failed: ' + e + '.', false);
        }
        return true;
    }

    async function exportWavWithMacroDisk() {
        const macroId = getSelectedMacroId();
        const sr = state.sampleRate || 44100;
        const totalFrames = Math.floor(duration() * sr);
        if (totalFrames <= 0) return;
        if (totalFrames <= MACRO_MEM_FRAMES) {
            try {
                persistStatus('Rendering macro...');
                let chans;
                try { chans = await mixRangeChannels(0, totalFrames); }
                catch (e) { persistStatus('Not enough memory to apply this effect. Trim to a shorter selection.', false); return; }
                if (!chans) return;
                const blob = await renderMacroToWavFromPcm(chans, sr, macroId, outFormat());
                persistStatus(`Exporting ${outInfo().name}...`);
                await saveFile(outFileName('splice'), blob, outInfo().mime);
                const doneMsg = `${outInfo().name} exported!` + overNote(lastMacroOver, lastMacroLimited, outFormat());
                spokenStatus(doneMsg, true);
                const iv = setInterval(() => persistStatus(doneMsg, true), 5);
                await new Promise((resolve) => setTimeout(resolve, 1000));
                clearInterval(iv);
            } catch (err) {
                reportErrorStatus(`FX: export with macro failed for '${macroId}'.`, err);
            }
            return;
        }
        if (await streamExportMacroDisk(macroId, sr, totalFrames)) return;
        const capMin = (MACRO_MEM_FRAMES / sr / 60).toFixed(1);
        const curMin = (totalFrames / sr / 60).toFixed(1);
        persistStatus(`This macro needs the audio in memory (about ${curMin} min selected). Trim to ${capMin} min or less, then apply it.`, false);
    }

    async function exportWavWithCurrentMacro() {
        if (state.disk) {
            await exportWavWithMacroDisk();
            return;
        }
        if (typeof state === 'undefined' || !state.pcm || !state.pcm.length) {
            reportErrorStatus('FX: no PCM data available to export.');
            return;
        }

        const macroId = getSelectedMacroId();
        console.log('[Splicer] exportWavWithCurrentMacro macroId =', macroId);

        try {
            if (fxJobs.size || fxMissing()) {
                persistStatus('Finishing clip and track effects before export...');
                await ensureFxReady();
            }
            const blob = await renderMacroBlobCached(macroId, outFormat());

            let label = macroId;
            if (macroSelect && macroSelect.selectedIndex >= 0) {
                label = macroSelect.options[macroSelect.selectedIndex].text || macroId;
            }
            const safeLabel = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-');
            persistStatus(`Preparing Macro ${outInfo().name} for download...`, true);
            await saveFile(outFileName(`splice-${safeLabel}`), blob, outInfo().mime);
            const doneMsg = `Macro ${outInfo().name} exported!` + overNote(lastMacroOver, lastMacroLimited, outFormat());
            spokenStatus(doneMsg, true);
            const intervalId5 = setInterval(() => persistStatus(doneMsg, true), 5);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            clearInterval(intervalId5);
        } catch (err) {
            reportErrorStatus(
                `FX: exportWavWithCurrentMacro failed for macro '${macroId}'.`,
                err
            );
        }
    }

    const noisyMacroId = 'NOISY_DX_RECORDING';
    let staticNoisePreference = enableStaticNoiseCheckbox?.checked === true;
    const syncStaticNoiseUi = () => {
        if (!enableStaticNoiseCheckbox || !staticNoiseOptions) return false;
        const enabled = enableStaticNoiseCheckbox.checked === true;
        if (!enableStaticNoiseCheckbox.disabled) {
            staticNoisePreference = enabled;
        }
        staticNoiseOptions.hidden = !enabled;
        return enabled;
    };

    const sync60HzHumUi = () => {
        if (!enable60HzHumCheckbox || !humOptions) return false;
        const enabled = enable60HzHumCheckbox.checked === true;
        if (!enable60HzHumCheckbox.disabled) {
            enable60HzHum = enabled;
        }
        humOptions.hidden = !enabled;
        return enabled;
    };

    const syncBitcrushUi = () => {
        if (!enableBitcrushCheckbox || !bitcrushOptions) return false;
        const enabled = enableBitcrushCheckbox.checked === true;
        bitcrushOptions.hidden = !enabled;
        return enabled;
    };

    const syncVmifyUi = () => {
        if (!enableVmifyCheckbox || !vmifyOptions) return false;
        const enabled = enableVmifyCheckbox.checked === true;
        vmifyOptions.hidden = !enabled;
        return enabled;
    };

    if (macroSelect) {
        macroSelect.addEventListener('change', () => {
            const macroValue = document.getElementById('spliceMacros').value;
            macroWaveformCancelledKey = null;
            rememberAudMacro(macroValue);
            if (macroValue === noisyMacroId) {
                enableStaticNoiseCheckbox.checked = true;
                enableStaticNoiseCheckbox.disabled = true;
                staticNoiseOptions.hidden = true;
            } else {
                enableStaticNoiseCheckbox.disabled = false;
                enableStaticNoiseCheckbox.checked = staticNoisePreference;
                staticNoiseOptions.hidden = !staticNoisePreference;
            }

            invalidateMacroPreview();
            scheduleMacroWaveformUpdate();
        });
    }

    function syncMacroLevelUi() {
        const levelDiv = panel.querySelector('[data-splice-macro-level]');
        if (levelDiv) levelDiv.hidden = getSelectedMacroId() === 'FLAT';
    }

    if (macroSelect) {
        macroSelect.addEventListener('change', syncMacroLevelUi);
        new MutationObserver(syncMacroLevelUi).observe(macroSelect, { childList: true, subtree: true });
        syncMacroLevelUi();
    }

    [
        [macroStrengthInput, (v) => chainItemMix({ mix: v })],
        [macroVolumeInput, (v) => chainItemGainDb({ gainDb: v })],
    ].forEach(([input, normalize]) => {
        if (!input) return;
        input.addEventListener('change', () => {
            input.value = String(normalize(input.value));
            invalidateMacroPreview();
            scheduleMacroWaveformUpdate();
        });
    });

    if (previewMacroBtn) {
        previewMacroBtn.addEventListener('click', async () => {
            const currentMacroId = getSelectedMacroId();
            const mismatch = macroPreviewPlayback?.macroId && macroPreviewPlayback.macroId !== currentMacroId;
            if (mismatch) {
                invalidateMacroPreview();
            }
            if (playingSource && playingMode === 'macro-preview') {
                pauseMacroPreview();
                return;
            }
            if (macroPreviewPlayback?.audio && (macroPreviewPlayback.audio.paused || macroPreviewPlayback.paused)) {
                const resumed = await resumeMacroPreview();
                if (resumed) return;
            }
            previewCurrentMacro();
        });
    }

    if (exportMacroBtn) {
        exportMacroBtn.addEventListener('click', () => {
            exportWavWithCurrentMacro();
        });
    }

    if (enableStaticNoiseCheckbox) {
        syncStaticNoiseUi();
        enableStaticNoiseCheckbox.addEventListener('change', () => {
            syncStaticNoiseUi();
            invalidateMacroPreview();
            scheduleMacroWaveformUpdate();
        });
    }

    if (enable60HzHumCheckbox) {
        sync60HzHumUi();
        enable60HzHumCheckbox.addEventListener('change', () => {
            sync60HzHumUi();
            invalidateMacroPreview();
            scheduleMacroWaveformUpdate();
        });
    }

    if (enableBitcrushCheckbox) {
        syncBitcrushUi();
        enableBitcrushCheckbox.addEventListener('change', () => {
            syncBitcrushUi();
            invalidateMacroPreview();
            scheduleMacroWaveformUpdate();
        });
    }

    if (enableVmifyCheckbox) {
        syncVmifyUi();
        enableVmifyCheckbox.addEventListener('change', () => {
            syncVmifyUi();
            invalidateMacroPreview();
            scheduleMacroWaveformUpdate();
        });
    }

    if (vmifyIntensityInput) {
        const handleVmifyParamChange = () => {
            const intensity = parseFloat(vmifyIntensityInput.value);

            if (Number.isNaN(intensity) || intensity < 0 || intensity > 3) {
                vmifyIntensityInput.value = '1';
            }

            invalidateMacroPreview();
            scheduleMacroWaveformUpdate();
        };

        vmifyIntensityInput.addEventListener('change', handleVmifyParamChange);
    }

    if (bitcrushBitsInput && bitcrushDownsampleInput) {
        const handleBitcrushParamChange = () => {
            const bits = parseFloat(bitcrushBitsInput.value);
            const downsample = parseFloat(bitcrushDownsampleInput.value);

            if (Number.isNaN(bits) || bits < 1 || bits > 16) {
                bitcrushBitsInput.value = '8';
            }

            if (Number.isNaN(downsample) || downsample < 1 || downsample > 64) {
                bitcrushDownsampleInput.value = '1';
            }

            invalidateMacroPreview();
            scheduleMacroWaveformUpdate();
        };

        bitcrushBitsInput.addEventListener('change', handleBitcrushParamChange);
        bitcrushDownsampleInput.addEventListener('change', handleBitcrushParamChange);
    }

    if (staticNoiseLevelInput && staticNoiseFadeDepthInput && staticNoiseFadeRateInput) {
        const handleStaticNoiseParamChange = () => {
            const level = parseFloat(staticNoiseLevelInput.value);
            const fadeDepth = parseFloat(staticNoiseFadeDepthInput.value);
            const fadeRate = parseFloat(staticNoiseFadeRateInput.value);

            if (Number.isNaN(level) || level < 0 || level > 1) {
                staticNoiseLevelInput.value = '0.14';
            }

            if (Number.isNaN(fadeDepth) || fadeDepth < 0 || fadeDepth > 1) {
                staticNoiseFadeDepthInput.value = '0.45';
            }

            if (Number.isNaN(fadeRate) || fadeRate < 0) {
                staticNoiseFadeRateInput.value = '0.6';
            }

            invalidateMacroPreview();
            scheduleMacroWaveformUpdate();
        };

        staticNoiseLevelInput.addEventListener('change', handleStaticNoiseParamChange);
        staticNoiseFadeDepthInput.addEventListener('change', handleStaticNoiseParamChange);
        staticNoiseFadeRateInput.addEventListener('change', handleStaticNoiseParamChange);
    }

    if (spliceLoudnessInput) {
        const applyLoudnessInput = () => {
            let val = parseFloat(spliceLoudnessInput.value);
            if (!Number.isFinite(val)) val = LOUDNESS_DBFS_DEFAULT;
            if (val < LOUDNESS_DBFS_MIN) val = LOUDNESS_DBFS_MIN;
            else if (val > LOUDNESS_DBFS_MAX) val = LOUDNESS_DBFS_MAX;
            spliceLoudnessInput.value = val.toFixed(1);
            drawWaveform();
            invalidateMacroPreview();
        };

        let loudnessInputTimeoutId;
        const debounceLoudnessInput = (immediate = false) => {
            if (loudnessInputTimeoutId) {
                clearTimeout(loudnessInputTimeoutId);
                loudnessInputTimeoutId = null;
            }

            if (immediate) {
                applyLoudnessInput();
                return;
            }

            loudnessInputTimeoutId = setTimeout(applyLoudnessInput, 3000);
        };

        spliceLoudnessInput.addEventListener('change', () => debounceLoudnessInput(true));
        spliceLoudnessInput.addEventListener('input', () => debounceLoudnessInput());
    }

    bindSliderNumberPair({ sliderId: "ttsRate2", numberId: "ttsRate2Number", resetId: "ttsRateReset2" });
    bindSliderNumberPair({ sliderId: "ttsPitch2", numberId: "ttsPitch2Number", resetId: "ttsPitchReset2" });
    bindSliderNumberPair({ sliderId: "ttsVolume2", numberId: "ttsVolume2Number", resetId: "ttsVolume2Reset" });

    voiceSelect.addEventListener('change', () => {
        const voiceBackend = resolveVoiceBackend(voiceBackendMap, voiceSelect.value);
        const ttsControls = document.getElementById('ttsRatePitchControls2');

        if (/Speechify/i.test(voiceSelect.value) || parseSpfyVoiceId(voiceSelect.value) !== null) {
            shouldBitcrushSpeechifyDiv.hidden = false;
        } else {
            shouldBitcrushSpeechifyDiv.hidden = true;
        }

        const supportsProsody = backendSupportsProsody(voiceBackend);

        if (supportsProsody || parseEspeakVoiceId(voiceSelect.value) !== null) {
            ttsControls.hidden = false;
        } else {
            ttsControls.hidden = true;
        }

        const ttsVolumeRow = document.getElementById('ttsVolume2Row');
        const ttsVolumeNote = document.getElementById('ttsVolume2Note');
        if (ttsVolumeRow) ttsVolumeRow.hidden = !supportsProsody;
        if (ttsVolumeNote) ttsVolumeNote.hidden = !supportsProsody || backendSupportsVolumeBoost(voiceBackend);
    });

    const changeEvent = new Event('change');

    voiceSelect?.dispatchEvent(changeEvent);
    enableStaticNoiseCheckbox?.dispatchEvent(changeEvent);
    staticNoiseLevelInput?.dispatchEvent(changeEvent);
    staticNoiseFadeDepthInput?.dispatchEvent(changeEvent);
    staticNoiseFadeRateInput?.dispatchEvent(changeEvent);
    enableBitcrushCheckbox?.dispatchEvent(changeEvent);
    enableVmifyCheckbox?.dispatchEvent(changeEvent);
    spliceLoudnessInput?.dispatchEvent(changeEvent);

    function captureMaster() {
        return {
            macroId: pendingMasterMacro || (macroSelect && macroSelect.value) || 'FLAT',
            chain: macroChain.map(SR.cleanItem),
            level: getMacroLevel(),
            loudness: spliceLoudnessInput ? spliceLoudnessInput.value : String(LOUDNESS_DBFS_DEFAULT),
            vmify: { on: enableVmifyCheckbox?.checked === true, intensity: vmifyIntensityInput?.value ?? '1' },
            bitcrush: { on: enableBitcrushCheckbox?.checked === true, bits: bitcrushBitsInput?.value ?? '8', downsample: bitcrushDownsampleInput?.value ?? '1' },
            static: { on: staticNoisePreference === true, level: staticNoiseLevelInput?.value ?? '0.14', fadeDepth: staticNoiseFadeDepthInput?.value ?? '0.45', fadeRateHz: staticNoiseFadeRateInput?.value ?? '0.6' },
            hum: { on: enable60HzHum === true, level: humLevelInput?.value ?? '0.01' },
        };
    }

    function setMasterMacro(id) {
        if (!macroSelect) return;
        if (![...macroSelect.options].some((o) => o.value === id)) {
            pendingMasterMacro = id;
            return;
        }
        pendingMasterMacro = null;
        const was = applyingMaster;
        applyingMaster = true;
        try {
            macroSelect.value = id;
            macroSelect.dispatchEvent(new Event('change', { bubbles: true }));
        } finally {
            applyingMaster = was;
        }
    }

    function applyMasterToControls(m) {
        if (!m) return;
        applyingMaster = true;
        try {
            macroChain = (m.chain || []).filter((it) => it && typeof it.id === 'string' && it.id).slice(0, MAX_CHAIN_ITEMS).map(SR.cleanItem);
            persistMacroChain();
            updateChainOption();
            if (macroStrengthInput) macroStrengthInput.value = String(chainItemMix(m.level));
            if (macroVolumeInput) macroVolumeInput.value = String(chainItemGainDb(m.level));
            if (spliceLoudnessInput && m.loudness !== undefined && m.loudness !== null) spliceLoudnessInput.value = m.loudness;
            const setFx = (box, on, fields) => {
                if (box) box.checked = !!on;
                for (const [input, value] of fields) if (input && value !== undefined && value !== null) input.value = value;
            };
            setFx(enableVmifyCheckbox, m.vmify?.on, [[vmifyIntensityInput, m.vmify?.intensity]]);
            setFx(enableBitcrushCheckbox, m.bitcrush?.on, [[bitcrushBitsInput, m.bitcrush?.bits], [bitcrushDownsampleInput, m.bitcrush?.downsample]]);
            setFx(enable60HzHumCheckbox, m.hum?.on, [[humLevelInput, m.hum?.level]]);
            setFx(null, false, [[staticNoiseLevelInput, m.static?.level], [staticNoiseFadeDepthInput, m.static?.fadeDepth], [staticNoiseFadeRateInput, m.static?.fadeRateHz]]);
            staticNoisePreference = m.static?.on === true;
            if (enableStaticNoiseCheckbox) {
                enableStaticNoiseCheckbox.disabled = false;
                enableStaticNoiseCheckbox.checked = staticNoisePreference;
            }
            syncStaticNoiseUi();
            sync60HzHumUi();
            syncBitcrushUi();
            syncVmifyUi();
            setMasterMacro(m.macroId || 'FLAT');
            syncMacroLevelUi();
            invalidateMacroPreview();
            scheduleMacroWaveformUpdate();
        } finally {
            applyingMaster = false;
        }
        if (editor) editor.refreshMaster();
    }

    function commitMaster(label = 'change master effects') {
        if (applyingMaster) return;
        const m = captureMaster();
        if (!project.master) {
            project.master = m;
        } else if (!SM.sameJson(m, project.master)) {
            editHistory.push(project, label);
            project.master = m;
            scheduleSave();
        }
        if (editor) editor.refreshMaster();
    }

    function syncControlsFromMaster() {
        if (!project.master) {
            project.master = captureMaster();
            return;
        }
        if (!SM.sameJson(captureMaster(), project.master)) applyMasterToControls(project.master);
    }

    const masterControls = [macroSelect, macroStrengthInput, macroVolumeInput, spliceLoudnessInput,
        enableVmifyCheckbox, vmifyIntensityInput, enableBitcrushCheckbox, bitcrushBitsInput, bitcrushDownsampleInput,
        enableStaticNoiseCheckbox, staticNoiseLevelInput, staticNoiseFadeDepthInput, staticNoiseFadeRateInput,
        enable60HzHumCheckbox, humLevelInput];
    for (const input of masterControls) {
        if (!input) continue;
        input.addEventListener('change', (e) => {
            if (applyingMaster) return;
            if (e.target === macroSelect) pendingMasterMacro = null;
            commitMaster();
        });
    }
    if (macroSelect) {
        new MutationObserver(() => {
            if (pendingMasterMacro && [...macroSelect.options].some((o) => o.value === pendingMasterMacro)) setMasterMacro(pendingMasterMacro);
        }).observe(macroSelect, { childList: true, subtree: true });
    }

    const macroLabelFor = (id) => {
        if (!id || id === 'FLAT') return '';
        if (id === 'CHAIN') return 'Macro chain (' + macroChain.length + ')';
        const opt = macroSelect ? [...macroSelect.options].find((o) => o.value === id) : null;
        return opt ? opt.textContent.trim() : id.replace(/^AUD:/, '').replace(/\.txt$/i, '');
    };

    const masterParts = (m) => {
        const parts = [];
        const macro = macroLabelFor(m.macroId);
        if (macro) {
            const mix = chainItemMix(m.level), gainDb = chainItemGainDb(m.level);
            parts.push(macro + (mix !== CHAIN_MIX_MAX ? ' at ' + mix + '%' : '') + (gainDb ? ' ' + (gainDb > 0 ? '+' : '') + gainDb + ' dB' : ''));
        }
        if (m.vmify?.on) parts.push('VM effect');
        if (m.bitcrush?.on) parts.push('Bitcrush');
        if (m.static?.on && m.macroId !== noisyMacroId) parts.push('Static');
        if (m.hum?.on) parts.push('60 Hz hum');
        return parts;
    };

    const masterInfo = () => {
        const m = project.master || captureMaster();
        const parts = masterParts(m);
        const lvl = parseFloat(m.loudness);
        const levelDb = Number.isFinite(lvl) ? lvl : 0;
        const pending = !!macroWaveformPendingKey;
        const ready = !!(macroWaveformPcm && macroWaveformActiveKey && shouldUseMacroWaveform() && macroWaveformActiveKey === getMacroWaveformKey());
        return {
            effects: parts,
            levelDb,
            active: parts.length > 0,
            state: !parts.length ? 'none' : (state.disk ? 'large' : (ready ? 'ready' : (pending || macroRenderActiveCount > 0 ? 'rendering' : 'dry'))),
            bypass: masterBypass,
        };
    };

    const focusMasterControls = () => {
        const target = macroComboBtn || macroSelect;
        if (!target) return;
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.focus({ preventScroll: true });
    };

    const editorMount = document.createElement('div');
    editorMount.className = 'sp-mount';
    const spliceDock = panel.querySelector('.splice-dock');
    if (spliceDock) spliceDock.before(editorMount);
    else panel.appendChild(editorMount);
    let restoreDone = false;
    const TONE_CODES = { 0: 'wat', 1: 'nwr', 2: 'pelmorex', 3: 'buzzer', 5: 'nwr-wat', 6: 'wat-nwr' };
    const ALERT_ROLES = [['header', 'Header'], ['attn', 'Attention'], ['voice', 'Message'], ['eom', 'EOM'], ['free', 'Pre/Post']];

    const genForPart = (role, info) => {
        const base = { mode: info.mode, clip: !!info.clip, emulate: !!info.emulate };
        if (role === 'header') return { kind: 'same-header', header: info.header, ...base };
        if (role === 'attn') return TONE_CODES[info.tone] ? { kind: 'attention', tone: TONE_CODES[info.tone], seconds: info.tlen, ...base } : null;
        if (role === 'eom') return { kind: 'eom', ...base };
        if (role === 'voice' && info.announcementType === 'tts' && info.text) return { kind: 'tts', text: info.text, voice: info.voice };
        return null;
    };

    const ROLE_ORDER = { header: 0, attn: 1, voice: 2, eom: 3, bed: 4, free: 5 };
    const roleTrack = (role, name) => {
        const found = project.tracks.find((t) => t.role === role);
        if (found) return found;
        const after = project.tracks.findIndex((t) => (ROLE_ORDER[t.role] ?? 9) > (ROLE_ORDER[role] ?? 9));
        return SM.addTrack(project, role, name, after < 0 ? project.tracks.length : after);
    };

    const exactSpan = async (gen, src, a, b) => {
        if (!gen || gen.kind === 'tts' || project.sampleRate !== SG.GEN_RATE) return null;
        const rendered = await SG.renderGenerator(gen).catch(() => null);
        if (!rendered || !rendered.length) return null;
        let lead = 0;
        while (lead < rendered.length && rendered[lead] === 0) lead++;
        let first = a;
        while (first < b && src[first] === 0) first++;
        const start = first - lead;
        if (start < a || start + rendered.length > b) return null;
        for (let i = 0; i < rendered.length; i++) if (rendered[i] !== src[start + i]) return null;
        return [start, start + rendered.length];
    };

    const importAlert = async ({ pcm, sampleRate, parts, info }) => {
        const sr = project.sampleRate;
        const src = sampleRate === sr ? pcm : resamplePcmSinc(pcm, sampleRate, sr);
        const scale = sr / sampleRate;
        const spans = [];
        for (const [role, name] of ALERT_ROLES) {
            for (const part of parts.filter((x) => x.role === role)) {
                let a = Math.round(part.from * scale), b = Math.min(src.length, Math.round(part.to * scale));
                const gen = genForPart(role, info);
                const exact = await exactSpan(gen, src, a, b);
                if (exact) {
                    [a, b] = exact;
                } else {
                    while (a < b && src[a] === 0) a++;
                    while (b > a && src[b - 1] === 0) b--;
                }
                if (b > a) spans.push({ role, name, a, b, gen });
            }
        }
        const base = SM.projectLength(project) ? SM.projectLength(project) + sr : 0;
        editHistory.push(project, 'open alert from the Encoder');
        let made = 0;
        for (const { role, name, a, b, gen } of spans) {
            const label = role === 'free' ? 'Pre/post audio' : name;
            const sid = SM.addSource(project, src.slice(a, b), label);
            SM.placeClip(project, roleTrack(role, name).id, SM.makeClip(sid, base + a, b - a, { label, ...(gen ? { gen } : {}) }));
            made++;
        }
        projectChanged();
        persistStatus(`Opened the alert from the Encoder: ${made} part${made === 1 ? '' : 's'} on their own tracks.`, true);
        if (editor) editor.announce(`Opened the alert from the Encoder with ${made} parts. Each part is on its own track.`);
    };

    const receiveHandoff = async (payload) => {
        if (payload.alert) {
            await importAlert(payload.alert).catch((err) => reportErrorStatus('Could not open the alert from the Encoder.', err));
        }
        if (payload.audio) {
            await handleFile(payload.audio);
            setButtonDisabledState(!hasAudio());
        }
        if (typeof payload.text === 'string') {
            if (window.splicerEditor) window.splicerEditor.setValue(payload.text);
            else if (ttsInput) ttsInput.value = payload.text;
            persistStatus('Loaded TTS text from another tool.', true);
        }
    };

    const renderGen = async (gen) => {
        if (gen.kind === 'tts') {
            const out = await synthTts(gen.text, gen.voice);
            if (!out || !out.pcm || !out.pcm.length) throw new Error('the voice returned no audio');
            return out.sampleRate === project.sampleRate ? out.pcm : resamplePcm(out.pcm, out.sampleRate, project.sampleRate);
        }
        const pcm = await SG.renderGenerator(gen);
        return project.sampleRate === SG.GEN_RATE ? pcm : resamplePcmSinc(pcm, SG.GEN_RATE, project.sampleRate);
    };

    const regenerateClip = async (clipId, nextGen) => {
        const f = SM.findClip(project, clipId);
        if (!f || !(nextGen || f.clip.gen)) return false;
        const gen = nextGen || f.clip.gen;
        persistStatus(`Generating ${SG.GEN_LABELS[gen.kind] || 'audio'}...`);
        let pcm;
        try {
            pcm = await renderGen(gen);
        } catch (err) {
            reportErrorStatus(`Could not generate ${SG.GEN_LABELS[gen.kind] || 'audio'}: ${err.message || err}`, err);
            return false;
        }
        if (!SM.findClip(project, clipId)) return false;
        editHistory.push(project, nextGen ? 'edit generator' : 'regenerate');
        const sid = SM.addSource(project, pcm, f.clip.label || SG.GEN_LABELS[gen.kind]);
        const c = SM.replaceClipAudio(project, clipId, sid, pcm.length);
        c.gen = { ...gen };
        projectChanged();
        persistStatus(`${SG.GEN_LABELS[gen.kind] || 'Clip'} regenerated.`, true);
        return true;
    };

    const createAlert = async () => {
        const v = await openAlertDialog();
        if (!v) return;
        const sr = project.sampleRate;
        const ms = (x) => Math.round(sr * (x / 1000));
        const gaps = SG.partGapsMs(v.mode);
        const base = { mode: v.mode, clip: v.clip, emulate: v.emulate };
        const plan = [];
        if (v.tone !== 'pelmorex') plan.push(['header', 'Header', { kind: 'same-header', header: v.header, ...base }, 0]);
        if (v.tone !== 'none') plan.push(['attn', 'Attention', { kind: 'attention', tone: v.tone, seconds: v.seconds, ...base }, gaps.headersToAttention]);
        if (v.text) plan.push(['voice', 'Message', { kind: 'tts', text: v.text, voice: (voiceSelect && voiceSelect.value) || 'wasm' }, gaps.attentionToMessage]);
        if (v.eom) plan.push(['eom', 'EOM', { kind: 'eom', ...base }, gaps.messageToEom]);
        if (!plan.length) return;
        persistStatus('Generating the alert...');
        const rendered = [];
        for (const [role, name, gen, gapBefore] of plan) {
            try {
                rendered.push({ role, name, gen, gapBefore, pcm: await renderGen(gen) });
            } catch (err) {
                reportErrorStatus(`Could not generate the ${name.toLowerCase()}: ${err.message || err}`, err);
                return;
            }
        }
        const start = SM.projectLength(project) ? SM.projectLength(project) + sr : 0;
        editHistory.push(project, 'new alert');
        let cursor = start;
        rendered.forEach((r, i) => {
            if (i) cursor += ms(r.gapBefore);
            const sid = SM.addSource(project, r.pcm, r.name);
            SM.placeClip(project, roleTrack(r.role, r.name).id, SM.makeClip(sid, cursor, r.pcm.length, { label: r.name, gen: r.gen }));
            cursor += r.pcm.length;
        });
        if (v.bed) {
            const gen = { kind: 'noise-bed', seconds: (cursor - start) / sr, levelDb: v.bedDb, seed: (Date.now() >>> 0) || 1 };
            const pcm = await renderGen(gen);
            const sid = SM.addSource(project, pcm, 'Noise bed');
            SM.placeClip(project, roleTrack('bed', 'Noise Bed').id, SM.makeClip(sid, start, pcm.length, { label: 'Noise bed', gen }));
        }
        projectChanged();
        persistStatus(`Created an alert with ${rendered.length + (v.bed ? 1 : 0)} parts.`, true);
        if (editor) editor.announce(`Created an alert: ${rendered.map((r) => r.name).join(', ')}${v.bed ? ', noise bed' : ''}. Each part is on its own track.`);
    };

    const spaceAlert = () => {
        const headerClip = project.tracks.filter((t) => t.role === 'header').flatMap((t) => t.clips).find((c) => c.gen && c.gen.mode);
        const g = SG.partGapsMs(headerClip ? headerClip.gen.mode : 'DEFAULT');
        const sr = project.sampleRate;
        const ms = (x) => Math.round(sr * (x / 1000));
        const hasRole = (r) => project.tracks.some((t) => t.role === r && t.clips.length);
        if (!['header', 'attn', 'voice', 'eom'].some(hasRole)) {
            persistStatus('Add header, attention, message or EOM clips first.', false);
            return 0;
        }
        const gaps = {
            attn: ms(g.headersToAttention),
            voice: hasRole('attn') ? ms(g.attentionToMessage) : ms(g.headersToAttention + g.attentionToMessage),
            eom: ms(g.messageToEom),
        };
        editHistory.push(project, 'space alert');
        const moved = SM.layoutAlert(project, gaps);
        if (!moved) {
            editHistory.drop();
            return 0;
        }
        projectChanged();
        return moved;
    };

    const ROLE_GEN = { header: 'same-header', attn: 'attention', eom: 'eom' };

    const generateOnTrack = async (trackId) => {
        const t = SM.findTrack(project, trackId);
        const kind = t ? ROLE_GEN[t.role] : null;
        if (!kind) return false;
        const v = await openAlertDialog({ only: kind, adding: true, initial: { tone: 'wat' } });
        if (!v) return false;
        const base = { mode: v.mode, clip: v.clip, emulate: v.emulate };
        const gen = kind === 'same-header' ? { kind, header: v.header, ...base }
            : (kind === 'attention' ? { kind, tone: v.tone, seconds: v.seconds, ...base } : { kind, ...base });
        const label = SG.GEN_LABELS[kind];
        let pcm;
        try {
            pcm = await renderGen(gen);
        } catch (err) {
            reportErrorStatus(`Could not generate the ${label.toLowerCase()}: ${err.message || err}`, err);
            return false;
        }
        if (!SM.findTrack(project, trackId)) return false;
        editHistory.push(project, `generate ${label.toLowerCase()}`);
        const sid = SM.addSource(project, pcm, label);
        const at = Math.round(getNeedleTime() * project.sampleRate);
        const clip = SM.placeClip(project, trackId, SM.makeClip(sid, at, pcm.length, { label, gen }));
        projectChanged();
        if (editor && clip) editor.selectClip(clip.id);
        return true;
    };

    let recorder = null;
    let recWorklet = null;
    let recCount = 0;

    const recordingFailed = (err) => {
        const name = err && err.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was blocked. Allow the microphone for this site or app, then try again.';
        if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found.';
        if (name === 'NotReadableError') return 'The microphone is in use by another app.';
        return `Could not start recording: ${(err && err.message) || err}`;
    };

    const startRecording = async () => {
        if (recorder) return false;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            spokenStatus('This browser does not offer microphone recording here.', false);
            return false;
        }
        if (playingSource || pausedPlayback) stopPlayback();
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        } catch (err) {
            spokenStatus(recordingFailed(err), false);
            return false;
        }
        const ctx = getAudioCtx();
        if (ctx.state === 'suspended') await ctx.resume();
        const rec = {
            stream, chunks: [], frames: 0, rate: ctx.sampleRate, live: true, done: null,
            at: Math.round(getNeedleTime() * project.sampleRate), started: performance.now(),
            src: ctx.createMediaStreamSource(stream), node: null, mute: ctx.createGain(), timer: null,
        };
        const maxFrames = (IN_APP_WEBVIEW ? 600 : 3600) * rec.rate;
        const take = (data) => {
            if (data === 'done') { if (rec.done) rec.done(); return; }
            if (!rec.live && !rec.done) return;
            rec.chunks.push(data);
            rec.frames += data.length;
            if (rec.live && rec.frames >= maxFrames) stopRecording();
        };
        try {
            if (!ctx.audioWorklet || typeof AudioWorkletNode !== 'function') throw new Error('no AudioWorklet');
            if (!recWorklet) recWorklet = ctx.audioWorklet.addModule(new URL('./splicer/rec-worklet.js', import.meta.url).href);
            await recWorklet;
            rec.node = new AudioWorkletNode(ctx, 'splicer-rec-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
            rec.node.port.onmessage = (e) => take(e.data);
        } catch (_) {
            recWorklet = null;
            rec.node = ctx.createScriptProcessor(4096, 1, 1);
            rec.node.onaudioprocess = (e) => take(new Float32Array(e.inputBuffer.getChannelData(0)));
        }
        rec.mute.gain.value = 0;
        rec.src.connect(rec.node);
        rec.node.connect(rec.mute);
        rec.mute.connect(ctx.destination);
        recorder = rec;
        if (editor) editor.setRecording(true, 0);
        rec.timer = setInterval(() => { if (editor) editor.setRecording(true, (performance.now() - rec.started) / 1000); }, 250);
        persistStatus('Recording from the microphone...');
        if (editor) editor.announce('Recording. Press R or Stop Recording to finish.');
        return true;
    };

    const stopRecording = async () => {
        const rec = recorder;
        if (!rec) return false;
        recorder = null;
        rec.live = false;
        clearInterval(rec.timer);
        if (rec.node.port) {
            await new Promise((resolve) => {
                rec.done = resolve;
                setTimeout(resolve, 400);
                rec.node.port.postMessage('stop');
            });
        }
        rec.done = null;
        for (const n of [rec.src, rec.node, rec.mute]) {
            try { n.disconnect(); } catch (_) {}
        }
        rec.stream.getTracks().forEach((t) => t.stop());
        if (editor) editor.setRecording(false, 0);
        if (!rec.frames) {
            spokenStatus('Nothing was recorded.', false);
            return false;
        }
        let pcm = new Float32Array(rec.frames);
        let o = 0;
        for (const c of rec.chunks) { pcm.set(c, o); o += c.length; }
        if (rec.rate !== project.sampleRate) pcm = resamplePcmSinc(pcm, rec.rate, project.sampleRate);
        editHistory.push(project, 'record');
        let trackId = editor ? editor.targetTrackId('voice') : null;
        if (!trackId || !SM.findTrack(project, trackId)) trackId = (project.tracks.find((x) => x.role === 'voice') || SM.addTrack(project, 'voice')).id;
        const label = `Recording ${++recCount}`;
        const sid = SM.addSource(project, pcm, label);
        const clip = SM.placeClip(project, trackId, SM.makeClip(sid, rec.at, pcm.length, { label }));
        projectChanged();
        const t = SM.findTrack(project, trackId);
        const msg = `Recorded ${(pcm.length / project.sampleRate).toFixed(2)} seconds onto ${t ? t.name : 'the track'}.`;
        persistStatus(msg, true);
        if (editor && clip) {
            editor.selectClip(clip.id);
            editor.announce(msg);
        }
        return true;
    };

    const toggleRecording = () => (recorder ? stopRecording() : startRecording())
        .catch((err) => reportErrorStatus('Recording failed.', err));

    const editGenerator = async (clipId) => {
        const f = SM.findClip(project, clipId);
        if (!f || !f.clip.gen || f.clip.gen.kind === 'tts' || f.clip.gen.kind === 'noise-bed') return false;
        const g = f.clip.gen;
        const v = await openAlertDialog({ only: g.kind, initial: { ...g } });
        if (!v) return false;
        const next = { ...g, mode: v.mode, clip: v.clip, emulate: v.emulate };
        if (g.kind === 'same-header') next.header = v.header;
        if (g.kind === 'attention') Object.assign(next, { tone: v.tone, seconds: v.seconds });
        return regenerateClip(clipId, next);
    };

    editor = createEditor({
        mount: editorMount,
        slots: {
            projects: panel.querySelector('.splice-projects-slot'),
            help: panel.querySelector('.splice-help-slot'),
        },
        getProject: () => project,
        history: editHistory,
        changed: () => projectChanged(),
        play: async (mode) => {
            if (mode !== 'selection' && !pausedPlayback && getNeedleTime() >= duration() - 0.005) playheadTime = 0;
            if (mode === 'selection') await playSelection();
            else await playWholeFile();
            syncPlayButtons();
        },
        pause: () => {
            pausePlayback();
            if (pausedPlayback && Number.isFinite(pausedPlayback.resumeFrom)) playheadTime = clamp(pausedPlayback.resumeFrom, 0, duration());
            syncPlayButtons();
        },
        stop: () => stopPlayback(),
        isPlaying: () => !!playingSource && playSpan > 0,
        playMode: () => playingMode,
        needleSeconds: () => getNeedleTime(),
        setPlayheadSeconds: (t) => {
            if (playingSource) stopPlayback();
            pausedPlayback = null;
            playheadTime = clamp(t, 0, duration());
        },
        outputPreview: () => {
            const out = masterBypass ? { pcm: state.pcm, sampleRate: state.sampleRate } : getWaveformRenderData();
            if (!out.pcm || !out.pcm.length) return null;
            return { pcm: out.pcm, sampleRate: out.sampleRate, gain: getExportGain() };
        },
        master: () => masterInfo(),
        setMasterBypass: (v) => {
            masterBypass = !!v;
            if (playingSource && !macroPreviewPlayback) {
                const mode = playingMode;
                pausePlayback();
                (mode === 'selection' ? playSelection() : playWholeFile()).catch((e) => persistStatus(`Playback failed: ${e.message || e}`, false));
            }
        },
        openMasterEffects: () => focusMasterControls(),
        describeGen: (gen) => SG.describeGenerator(gen),
        regenerate: (clipId) => regenerateClip(clipId),
        editGenerator: (clipId) => editGenerator(clipId),
        spaceAlert: () => spaceAlert(),
        canGenerate: (role) => !!ROLE_GEN[role],
        toggleRecord: () => toggleRecording(),
        isRecording: () => !!recorder,
        generateOnTrack: (trackId) => generateOnTrack(trackId).catch((err) => reportErrorStatus('Could not generate the clip.', err)),
        newAlert: () => createAlert().catch((err) => reportErrorStatus('Could not create the alert.', err)),
        setMasterGain: (v) => {
            if (!spliceLoudnessInput) return;
            spliceLoudnessInput.value = String(v);
            spliceLoudnessInput.dispatchEvent(new Event('change', { bubbles: true }));
        },
        editEffects: (kind, id) => {
            if (openEffectsEditorFn) openEffectsEditorFn(kind, id);
        },
        clipAudio: (c) => SM.clipAudio(project, c, fxPeek),
        fxState: (kind, x) => {
            if (!SM.hasFx(x)) return 'none';
            const key = kind === 'clip' ? clipFxKey(x) : trackFxKey(x);
            if (fxStore().has(key)) return 'ready';
            if (fxFailed.has(key)) return 'failed';
            return 'rendering';
        },
        fxLabel: (items) => (items || []).filter((e) => e && !e.bypass).map((e) => e.label || e.id).join(', '),
        status: (msg, ok = true) => persistStatus(msg, ok),
        onSelectionChange: (a, b) => {
            state.selection = { start: a, end: b };
        },
        projects: {
            list: () => listNamedProjects(),
            save: (name) => saveProject(NAMED_PREFIX + name),
            open: async (name) => {
                const payload = await loadProject(NAMED_PREFIX + name);
                const p = projectFromPayload(payload);
                if (!p) throw new Error('saved project is empty or unreadable');
                const lost = await dropMissingDisk(p);
                project = p;
                if (lost) persistStatus(`${lost} clip${lost === 1 ? '' : 's'} from large files were removed because the files are no longer in device storage.`, false);
                if (!project.tracks.length) SM.addTrack(project, 'voice');
                if (project.master) applyMasterToControls(project.master);
                else project.master = captureMaster();
                playheadTime = 0;
                projectChanged();
            },
            remove: (name) => deleteNamedProject(name),
            exportFile: (name) => exportProjectFile(name),
            importFile: (file) => importProjectFile(file),
        },
    });
    syncEditorMode();

    setupMacroCombo();
    setupMacroUpload();
    setupChainEditor();
    await loadSoxMacroDefs();
    await restoreCustomMacros();
    restoreMacroChain();
    ensureAudacityMacroList();
    bindEvents();
    drawWaveform();
    restoreFromCache().then(() => {
        restoreDone = true;
        sweepDiskFiles();
        receive('splicer', receiveHandoff);
    });
    await getVoiceList();
})();
