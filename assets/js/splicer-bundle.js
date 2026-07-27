import { saveFile, CODEMIRROR_DARK_THEME_NAME, CODEMIRROR_LIGHT_THEME_NAME, USES_DARK_THEME, PIPER_DEFAULT_VOICE_ID as PIPER_VOICE, resamplePcm, vmifyPcm, validateMarkupAndText, createNanoTtsEngine, createTtsTextEditor, ensurePiperLoaded, getPiperPcm, populateRemoteVoiceList, getSpfyEngine, getAcuEngine } from './common-functions.js';

(async function () {
    let splicerTextEditor = null;

    function initSplicerTextEditor() {
        if (splicerTextEditor || !window.CodeMirror) return splicerTextEditor;

        const splicerEditor = createTtsTextEditor({
            textareaId: 'ttsText2',
            ariaLabel: 'Text to convert to speech',
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
    const canvas = document.getElementById('spliceWaveform');
    if (!panel || !canvas) return;

    const ctx = canvas.getContext('2d');
    const fileInput = panel.querySelector('[data-splice-file]');
    const ttsInput = panel.querySelector('#ttsText2') || panel.querySelector('.ttsText');
    const ttsButton = panel.querySelector('[data-splice-tts-generate]') || panel.querySelector('#spliceTTSGenerator button');
    const ttsStatus = panel.querySelector('[data-splice-tts-status]') || panel.querySelector('#spliceTTSGenerator [data-splice-tts-status]');
    const voiceSelect = panel.querySelector('#ttsVoice2');
    const overrideTzSelect = panel.querySelector('#useSplicerOverrideTZ');
    const silenceInput = panel.querySelector('[data-splice-silence]');
    const silenceStatus = panel.querySelector('[data-splice-silence-status]');
    const silenceBtn = panel.querySelector('[data-splice-add-silence]');
    const splitSelectionBtn = panel.querySelector('[data-splice-split-selection]');
    const joinAllBtn = panel.querySelector('[data-splice-join-all]');
    const playBtn = panel.querySelector('[data-splice-play]');
    const playAllBtn = panel.querySelector('[data-splice-playAll]');
    const stopBtn = panel.querySelector('[data-splice-stop]');
    const trimBtn = panel.querySelector('[data-splice-trim]');
    const deleteBtn = panel.querySelector('[data-splice-delete]');
    const splitBtn = panel.querySelector('[data-splice-split]');
    const exportBtn = panel.querySelector('[data-splice-export]');
    const clearBtn = panel.querySelector('[data-splice-clear]');
    const persistLabel = panel.querySelector('[data-splice-persist]');
    const segmentsList = panel.querySelector('[data-splice-segments]');
    const selStartLabel = panel.querySelector('[data-selection-start]');
    const selEndLabel = panel.querySelector('[data-selection-end]');
    const selLenLabel = panel.querySelector('[data-selection-length]');
    const loadFileBtn = panel.querySelector('[data-splice-load]');
    const macroSelect = panel.querySelector('[data-splice-macro-select]');
    const previewMacroBtn = panel.querySelector('[data-splice-preview-macro]');
    const exportMacroBtn = panel.querySelector('[data-splice-export-macro]');
    const spliceLoudnessInput = panel.querySelector('[data-splice-loudness]');
    const spliceSilenceInput = panel.querySelector('[data-splice-silence]');
    const previewMacroBtnDefaultText = previewMacroBtn && previewMacroBtn.textContent
        ? previewMacroBtn.textContent.trim() || 'Play Macro Preview'
        : 'Play Macro Preview';
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

    canvas.style.touchAction = 'none';

    const DB_NAME = 'eas-splicer';
    const STORE = 'projects';
    const CACHE_KEY = 'current';
    const voiceBackendMap = {};
    let enable60HzHum = enable60HzHumCheckbox?.checked === true;
    let currentSegmentId = null;
    const segmentPlayButtons = new Map();
    let pendingSegmentPlay = null;
    let macroPreviewPlayback = null;
    let macroPreviewMarkerInterval = null;
    let macroRenderBlobCache = null;
    let macroWaveformPcm = null;
    let macroWaveformSampleRate = 0;
    let macroWaveformActiveKey = null;
    let macroWaveformOutputSig = null;
    let macroWaveformPendingKey = null;
    let macroWaveformJobSeq = 0;
    let macroWaveformDebounce = null;
    let macroComboBtn = null;
    let macroRenderActiveCount = 0;

    const state = {
        sampleRate: 44100,
        segments: [],
        pcm: new Float32Array(0),
        selection: { start: 0, end: 0 },
        viewStart: 0,
        viewEnd: 0,
        minViewSpan: 0.05,
    };

    let audioCtx = null;
    let playingSource = null;
    let playingMode = null;
    let playStartOffset = 0;
    let playSpan = 0;
    let playStartedAt = 0;
    let pausedPlayback = null;
    let playheadTime = 0;
    let dragMode = null;
    let touchSelectionId = null;
    let pinchState = null;
    let touchPan = null;
    let touchPlayhead = null;
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

    const applyGainToAudioBuffer = (buffer, pcm, gain = getExportGain()) => {
        if (!buffer || !pcm) return;
        const channelData = buffer.getChannelData(0);
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
            state.pcm.length,
            state.sampleRate,
        ];
        return parts.join('|');
    };

    const cancelMacroWaveformComputation = () => {
        macroWaveformJobSeq += 1;
        macroWaveformPendingKey = null;
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

        (async () => {
            try {
                let processed = null;
                try {
                    const fxPcm = applyExportFxToPcm(pcmRef, sr, macroId);
                    if (macroId.startsWith('AUD:') && window.AudacityMacroEngine) {
                        const out = await window.AudacityMacroEngine.applyMacroFile(fxPcm, sr, macroId.slice(4), { onProgress: macroProgressCb });
                        setMacroProgress(1, 'Macro preview ready!');
                        processed = { pcm: out.pcm, sampleRate: out.sampleRate };
                    } else {
                        const blob = await renderMacroWithSox(fxPcm, sr, macroId, 0);
                        if (blob) {
                            processed = await decodeWavBlobToFloat32(blob);
                        } else if (fxPcm !== pcmRef) {
                            processed = { pcm: fxPcm, sampleRate: sr };
                        }
                    }
                } catch (err) {
                    console.error('Macro waveform render failed', err);
                }

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
                    macroWaveformOutputSig = macroId.startsWith('AUD:') ? getMacroOutputSignature(macroId) : null;
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
        persistLabel.style.color = ok ? '#7ae37a' : '#f48383';
    };

    let macroProgressUI = null;
    let macroProgressPct = -1;
    const ensureMacroProgress = () => {
        if (macroProgressUI || !persistLabel || !persistLabel.parentNode) return macroProgressUI;
        const wrap = document.createElement('div');
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
        macroProgressUI = { wrap, bar };
        return macroProgressUI;
    };
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

    const syncSegmentPlayButtons = (activeId = null) => {
        currentSegmentId = activeId;
        segmentPlayButtons.forEach((btn, segId) => {
            if (!btn || !btn.isConnected) return;
            btn.textContent = segId === currentSegmentId ? 'Pause Section' : 'Play Section';
        });
    };

    const syncPlayButtons = () => {
        if (playBtn) {
            const playingSelection = playingSource && playingMode === 'selection';
            playBtn.textContent = playingSelection ? 'Pause Selection' : 'Play Selection';
        }
        if (playAllBtn) {
            const playingAll = playingSource && playingMode === 'all';
            playAllBtn.textContent = playingAll ? 'Pause All' : 'Play All';
        }
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
        setPreviewMacroButtonState('Resume Macro Preview', false);
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
        setPreviewMacroButtonState('Pause Macro Preview', false);
        try {
            await audio.play();
        } catch (err) {
            reportErrorStatus(`Failed to resume macro preview audio playback: ${err}`, err);
            macroPreviewPlayback.paused = true;
            clearMacroPreviewInterval();
            setPreviewMacroButtonState('Resume Macro Preview', false);
            return false;
        }
        return true;
    };

    const cancelPendingSegmentPlayback = () => {
        if (!pendingSegmentPlay) return;
        pendingSegmentPlay.cancelled = true;
        pendingSegmentPlay = null;
    };

    const getDb = () => {
        if (!window.indexedDB) {
            persistStatus('IndexedDB unavailable; caching disabled.', false);
            return null;
        }
        if (!cacheDbPromise) {
            cacheDbPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => req.result.createObjectStore(STORE);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        return cacheDbPromise;
    };

    const saveProject = async () => {
        const dbp = getDb();
        if (!dbp) return;
        try {
            const db = await dbp;
            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                const payload = {
                    sampleRate: state.sampleRate,
                    savedAt: Date.now(),
                    segments: state.segments.map((s) => ({
                        id: s.id,
                        label: s.label,
                        pcm: s.pcm.buffer.slice(0),
                        sourceText: s.sourceText || '',
                    })),
                    ttsVoiceSelection: voiceSelect ? voiceSelect.value : null,
                    ttsText: ttsInput ? ttsInput.value : null,
                    spliceLoudnessInput: spliceLoudnessInput ? parseFloat(spliceLoudnessInput.value) : 0,
                    spliceSilenceInput: spliceSilenceInput ? parseFloat(spliceSilenceInput.value) : 0.5,
                    macroSelection: macroSelect ? macroSelect.value : null,
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
                tx.objectStore(STORE).put(payload, CACHE_KEY);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
            persistStatus(`Saved locally @ ${new Date().toLocaleTimeString()}.`);
        } catch (err) {
            console.error('Failed to save splicer project!', err);
            persistStatus('Local save failed.', false);
        }
    };

    const loadProject = async () => {
        const dbp = getDb();
        if (!dbp) return null;
        try {
            const db = await dbp;
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).get(CACHE_KEY);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.error('Failed to load splicer project!', err);
            persistStatus('Local load failed.', false);
            return null;
        }
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

    const getAudioCtx = () => {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioCtx;
    };

    const duration = () => (state.pcm.length ? state.pcm.length / state.sampleRate : 0);

    const updateSelectionLabels = () => {
        const d = duration();
        const start = clamp(state.selection.start, 0, d);
        const end = clamp(state.selection.end, 0, d);
        selStartLabel.textContent = `${start.toFixed(2)}s`;
        selEndLabel.textContent = `${end.toFixed(2)}s`;
        selLenLabel.textContent = `${Math.floor((end - start) / 60)}m ${((end - start) % 60).toFixed(0)}s, ${Math.round((end - start) * state.sampleRate).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} samples`;
    };

    const setSelection = (start, end) => {
        const d = duration();
        start = clamp(start, 0, d);
        end = clamp(end, 0, d);
        if (end < start) [start, end] = [end, start];
        state.selection = { start, end };
        updateSelectionLabels();
        drawWaveform();
    };

    const syncViewWindow = () => {
        const d = duration();
        if (d <= 0) {
            state.viewStart = 0;
            state.viewEnd = 0;
            return;
        }
        let span = state.viewEnd - state.viewStart;
        if (!Number.isFinite(span) || span <= 0) span = d;
        span = clamp(span, state.minViewSpan, d);
        let start = clamp(state.viewStart, 0, Math.max(0, d - state.minViewSpan));
        let end = start + span;
        if (end > d) {
            end = d;
            start = clamp(end - span, 0, d);
        }
        state.viewStart = start;
        state.viewEnd = end;
    };

    const resetViewWindow = () => {
        state.viewStart = 0;
        state.viewEnd = duration();
        syncViewWindow();
    };

    const panViewTo = (center) => {
        syncViewWindow();
        const span = Math.max(state.viewEnd - state.viewStart, state.minViewSpan);
        const d = duration();
        let start = clamp(center - span / 2, 0, Math.max(0, d - span));
        let end = start + span;
        if (end > d) {
            end = d;
            start = Math.max(0, d - span);
        }
        state.viewStart = start;
        state.viewEnd = end;
        drawWaveform();
    };

    const rebuildTimeline = ({ preserveMacroWaveform = false } = {}) => {
        const keepMacroWaveform = preserveMacroWaveform
            && macroWaveformActiveKey
            && macroWaveformActiveKey === getMacroWaveformKey();
        if (!keepMacroWaveform) {
            invalidateMacroWaveformCache(true);
        }
        const total = state.segments.reduce((sum, seg) => sum + seg.pcm.length, 0);
        if (state.segments.length === 1) {
            state.pcm = state.segments[0].pcm;
        } else {
            state.pcm = new Float32Array(total);
            let offset = 0;
            state.segments.forEach((seg) => {
                state.pcm.set(seg.pcm, offset);
                offset += seg.pcm.length;
            });
        }
        if (duration() > 0) {
            setSelection(0, duration());
        } else {
            setSelection(0, 0);
        }
        syncViewWindow();
        updateSegmentsList();
        drawWaveform();
        saveProject();
        if (!keepMacroWaveform && shouldUseMacroWaveform()) {
            scheduleMacroWaveformUpdate();
        }
    };

    const formatSegmentLabel = (seg, idx) => {
        const durMins = Math.floor(seg.pcm.length / state.sampleRate / 60);
        const durSecs = Math.floor((seg.pcm.length / state.sampleRate) % 60);
        const base = `${idx + 1}. ${seg.label || 'Segment'}`;
        const text = (seg.sourceText || '').trim();
        const textPart = text ? ` — "${text.length > 48 ? `${text.slice(0, 48)}...` : text}"` : '';
        return `${base}${textPart} — ${durMins}m ${durSecs}s (${seg.pcm.length.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} samples)`;
    };

    const moveSegment = (from, to) => {
        if (from === to || from < 0 || to < 0 || from >= state.segments.length || to >= state.segments.length) return;
        const [item] = state.segments.splice(from, 1);
        state.segments.splice(to, 0, item);
        rebuildTimeline();
    };

    const playSegment = async (seg) => {
        if (!seg?.pcm?.length) return false;
        cancelPendingSegmentPlayback();
        if (playingSource) stopPlayback();

        const pendingState = { cancelled: false, segId: seg.id };
        pendingSegmentPlay = pendingState;
        const clearPendingState = () => {
            if (pendingSegmentPlay === pendingState) pendingSegmentPlay = null;
        };

        const ctxAudio = getAudioCtx();
        if (ctxAudio.state === 'suspended') {
            try {
                await ctxAudio.resume();
            } catch (err) {
                persistStatus('Failed to resume audio context!', false);
            }
        }

        if (pendingState.cancelled) {
            clearPendingState();
            return false;
        }

        const buffer = ctxAudio.createBuffer(1, seg.pcm.length, state.sampleRate);
        buffer.copyToChannel(seg.pcm, 0);

        const resumeInfo = pausedPlayback && pausedPlayback.mode === 'segment' && pausedPlayback.segId === seg.id ? pausedPlayback : null;
        const sr = Math.max(1, state.sampleRate || 44100);
        const segDuration = seg.pcm.length / sr;
        let samplesBefore = 0;
        for (let i = 0; i < state.segments.length; i++) {
            const current = state.segments[i];
            if (current.id === seg.id) break;
            samplesBefore += current.pcm.length;
        }
        const segmentStartTime = samplesBefore / sr;
        let startOffset = 0;
        let len = Math.max(0.001, segDuration);
        if (resumeInfo) {
            const resumeFromAbs = clamp(resumeInfo.resumeFrom ?? segmentStartTime, segmentStartTime, segmentStartTime + segDuration);
            const resumeEndAbs = clamp(resumeInfo.end ?? (segmentStartTime + segDuration), resumeFromAbs, segmentStartTime + segDuration);
            startOffset = resumeFromAbs - segmentStartTime;
            len = Math.max(0.001, resumeEndAbs - resumeFromAbs);
        }

        if (pendingState.cancelled) {
            clearPendingState();
            return false;
        }

        const source = ctxAudio.createBufferSource();
        source.buffer = buffer;
        source.connect(ctxAudio.destination);

        if (pendingState.cancelled) {
            try { source.disconnect(); } catch (err) { persistStatus(err, false); }
            clearPendingState();
            return false;
        }

        source.start(0, startOffset, len);
        playingSource = source;
        clearPendingState();

        const playbackInterval = setInterval(updatePlaybackMarker, 1);

        playingMode = 'segment';
        playStartOffset = segmentStartTime + startOffset;
        playSpan = len;
        playStartedAt = ctxAudio.currentTime;
        pausedPlayback = null;

        source.onended = () => {
            if (playingSource !== source) return;
            playingSource = null;
            playingMode = null;
            pausedPlayback = null;
            playSpan = 0;
            playStartOffset = 0;
            syncSegmentPlayButtons(null);
            clearInterval(playbackInterval);
            drawWaveform();
        };
        return true;
    };

    const pauseSegment = async (seg) => {
        if (!playingSource) {
            if (pendingSegmentPlay && pendingSegmentPlay.segId === seg?.id) {
                cancelPendingSegmentPlayback();
            }
            return;
        }
        const ctxAudio = audioCtx || getAudioCtx();
        if (ctxAudio.state === 'suspended') await ctxAudio.resume();

        const elapsed = Math.max(0, ctxAudio.currentTime - playStartedAt);
        const resumeAbs = Math.min(playStartOffset + elapsed, playStartOffset + playSpan);
        pausedPlayback = {
            mode: 'segment',
            segId: seg?.id ?? null,
            resumeFrom: resumeAbs,
            end: playStartOffset + playSpan,
        };

        try {
            playingSource.onended = null;
            playingSource.stop();
        } catch (err) {
            persistStatus(err, false);
        }

        playingSource = null;
        playingMode = null;
    };

    const updateSegmentsList = () => {
        segmentsList.innerHTML = '';
        segmentPlayButtons.clear();
        if (!state.segments.length) {
            const li = document.createElement('li');
            li.textContent = 'No segments yet. Load audio or generate TTS to start.';
            li.style.opacity = '0.8';
            segmentsList.appendChild(li);
            return;
        }
        state.segments.forEach((seg, idx) => {
            const li = document.createElement('li');
            li.draggable = true;
            li.dataset.index = idx.toString();
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.border = '1px solid #1e1e1e';
            li.style.padding = '8px';
            li.style.borderRadius = '6px';
            li.style.background = '#0c0c0c';

            const label = document.createElement('div');
            label.textContent = formatSegmentLabel(seg, idx);
            label.style.flex = '1';
            label.style.marginRight = '24px';

            const playSectionBtn = document.createElement('button');
            playSectionBtn.type = 'button';
            playSectionBtn.textContent = 'Play Section';
            playSectionBtn.disabled = !seg.pcm.length;
            segmentPlayButtons.set(seg.id, playSectionBtn);
            if (currentSegmentId === seg.id && playingMode === 'segment' && playingSource) {
                playSectionBtn.textContent = 'Pause Section';
            }
            playSectionBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const isActiveSegment = Boolean(playingSource) && playingMode === 'segment' && currentSegmentId === seg.id;
                if (isActiveSegment) {
                    syncSegmentPlayButtons(null);
                    try {
                        await pauseSegment(seg);
                    } catch (err) {
                        persistStatus(`Failed to pause segment: ${err}.`, false);
                        syncSegmentPlayButtons(seg.id);
                    }
                    return;
                }
                try {
                    const started = await playSegment(seg);
                    if (started) {
                        syncSegmentPlayButtons(seg.id);
                    }
                } catch (err) {
                    persistStatus(`Failed to play segment: ${err}.`, false);
                    syncSegmentPlayButtons(null);
                }
            });

            const renameSectionBtn = document.createElement('button');
            renameSectionBtn.type = 'button';
            renameSectionBtn.textContent = 'Rename Section';
            renameSectionBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const newName = prompt('Enter new name for the segment:', seg.label);
                if (newName) {
                    seg.label = newName;
                    updateSegmentsList();
                }
            });

            const moveUpBtn = document.createElement('button');
            moveUpBtn.type = 'button';
            moveUpBtn.textContent = 'Move Up';
            moveUpBtn.disabled = idx === 0;
            moveUpBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (idx > 0) moveSegment(idx, idx - 1);
            });

            const moveDownBtn = document.createElement('button');
            moveDownBtn.type = 'button';
            moveDownBtn.textContent = 'Move Down';
            moveDownBtn.disabled = idx === state.segments.length - 1;
            moveDownBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (idx < state.segments.length - 1) moveSegment(idx, idx + 1);
            });

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.textContent = 'Remove';
            removeBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                state.segments = state.segments.filter((s) => s.id !== seg.id);
                rebuildTimeline();
            });

            const controls = document.createElement('div');
            controls.style.display = 'flex';
            controls.style.gap = '6px';
            controls.appendChild(playSectionBtn);
            controls.appendChild(renameSectionBtn);
            controls.appendChild(moveUpBtn);
            controls.appendChild(moveDownBtn);
            controls.appendChild(removeBtn);

            li.addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', idx.toString());
            });

            li.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                li.style.borderColor = '#3aa0ff';
            });

            li.addEventListener('dragleave', () => {
                li.style.borderColor = '#1e1e1e';
            });

            li.addEventListener('drop', (e) => {
                e.preventDefault();
                li.style.borderColor = '#1e1e1e';
                const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                const to = parseInt(li.dataset.index, 10);
                moveSegment(from, to);
            });

            li.appendChild(label);
            li.appendChild(controls);
            segmentsList.appendChild(li);
        });
    };

    const addSegment = (pcm, sampleRate, label, sourceText = '', adopt = false) => {
        if (!pcm || !pcm.length) return;
        if (!state.sampleRate) state.sampleRate = sampleRate || 44100;
        let finalPcm = pcm;
        if (sampleRate && sampleRate !== state.sampleRate) {
            finalPcm = resamplePcm(pcm, sampleRate, state.sampleRate);
            adopt = true;
        }
        state.segments.push({
            id: `seg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            label: label || 'Segment',
            pcm: adopt ? finalPcm : new Float32Array(finalPcm),
            sourceText,
        });
        rebuildTimeline();
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
        resetViewWindow();
        drawWaveform();
    };

    const splitAtSelection = () => {
        if (!state.pcm.length) return;
        const sr = state.sampleRate;
        const startIdx = Math.floor(state.selection.start * sr);
        const endIdx = Math.floor(state.selection.end * sr);

        const clampIdx = (idx) => Math.min(Math.max(idx, 0), state.pcm.length);
        const a = clampIdx(startIdx);
        const b = clampIdx(endIdx);

        if (a === b) {
            persistStatus('Select a region inside the audio to split.', false);
            return;
        }

        const low = Math.min(a, b);
        const high = Math.max(a, b);

        const left = state.pcm.slice(0, low);
        const mid = state.pcm.slice(low, high);
        const right = state.pcm.slice(high);

        const segments = [];
        if (left.length) segments.push({ id: `seg-${Date.now()}-l`, label: 'Part 1', pcm: left, sourceText: '' });
        if (mid.length) segments.push({ id: `seg-${Date.now()}-m`, label: 'Split', pcm: mid, sourceText: 'Split selection' });
        if (right.length) segments.push({ id: `seg-${Date.now()}-r`, label: 'Part 2', pcm: right, sourceText: '' });

        if (!segments.length) {
            persistStatus('Nothing to split.', false);
            return;
        }

        state.segments = segments;
        rebuildTimeline();
        persistStatus('Split created separate segments.');
    };

    const joinAllSegments = () => {
        if (!state.segments.length) return;
        const total = state.segments.reduce((sum, seg) => sum + seg.pcm.length, 0);
        const joined = new Float32Array(total);
        let offset = 0;
        const texts = [];
        state.segments.forEach((seg) => {
            joined.set(seg.pcm, offset);
            offset += seg.pcm.length;
            if (seg.sourceText) texts.push(seg.sourceText);
        });
        const textJoined = texts.join(' | ');
        state.segments = [{
            id: `seg-${Date.now()}-joined`,
            label: 'Joined',
            pcm: joined,
            sourceText: textJoined,
        }];
        rebuildTimeline();
        persistStatus('All segments joined into one.');
    };

    const drawWaveform = () => {
        const waveformData = getWaveformRenderData();
        const waveformPcm = waveformData.pcm || new Float32Array(0);
        const waveformSampleRate = waveformData.sampleRate || state.sampleRate || 44100;
        const w = canvas.width;
        const h = canvas.height;
        const userLightMode = !USES_DARK_THEME;
        ctx.fillStyle = userLightMode ? '#ffffff' : '#0b0b0b';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#222';
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        if (!waveformPcm.length) {
            ctx.fillStyle = '#888';
            ctx.font = '14px monospace';
            ctx.fillText('Upload an existing audio file or generate TTS to begin editing.', 12, h / 2);
            return;
        }

        syncViewWindow();
        const d = duration();
        const viewSpan = Math.max(state.viewEnd - state.viewStart, state.minViewSpan);
        const startSample = Math.floor(state.viewStart * waveformSampleRate);
        const visibleSamples = Math.max(1, Math.floor(viewSpan * waveformSampleRate));
        const step = Math.max(1, Math.floor(visibleSamples / w));
        const waveformGain = getExportGain();
        const applyWaveformGain = Math.abs(waveformGain - 1) > EXPORT_GAIN_TOLERANCE;
        ctx.strokeStyle = '#3aa0ff';
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
            const start = startSample + x * step;
            const end = Math.min(waveformPcm.length, start + step);
            let min = 1, max = -1;
            for (let i = start; i < end; i++) {
                let v = waveformPcm[i];
                if (applyWaveformGain) {
                    v *= waveformGain;
                    if (v > 1) v = 1;
                    else if (v < -1) v = -1;
                }
                if (v < min) min = v;
                if (v > max) max = v;
            }
            const y1 = h / 2 - max * (h / 2);
            const y2 = h / 2 - min * (h / 2);
            ctx.moveTo(x + 0.5, y1);
            ctx.lineTo(x + 0.5, y2);
        }
        ctx.stroke();

        const selStartX = ((state.selection.start - state.viewStart) / viewSpan) * w || 0;
        const selEndX = ((state.selection.end - state.viewStart) / viewSpan) * w || 0;
        const selWidth = Math.max(2, selEndX - selStartX);
        ctx.fillStyle = 'rgba(90, 180, 255, 0.15)';
        ctx.fillRect(selStartX, 0, selWidth, h);
        ctx.strokeStyle = 'rgba(90, 180, 255, 0.7)';
        ctx.strokeRect(selStartX + 0.5, 0.5, selWidth - 1, h - 1);

        drawPlayhead();
    };

    const getMacroPreviewAbsoluteTime = () => {
        if (playingMode !== 'macro-preview') return null;
        const macroAudio = macroPreviewPlayback?.audio
            || (typeof playingSource?.currentTime === 'number' ? playingSource : null);
        if (macroAudio && typeof macroAudio.currentTime === 'number' && Number.isFinite(macroAudio.currentTime)) {
            return Math.max(0, macroAudio.currentTime);
        }
        return null;
    };

    const PLAYHEAD_HANDLE_ZONE_PX = 22;
    const PLAYHEAD_GRAB_PX = 10;
    const PLAYHEAD_TOUCH_ZONE_PX = 48;
    const PLAYHEAD_TOUCH_GRAB_PX = 30;
    const POINTER_IS_COARSE = (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) || ((navigator.maxTouchPoints || 0) > 0);

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

    const drawPlayhead = () => {
        const d = duration();
        if (d <= 0) return;
        const viewStart = state.viewStart ?? 0;
        const viewEnd = state.viewEnd ?? d;
        const viewSpan = Math.max(0.001, viewEnd - viewStart);
        const t = getNeedleTime();
        if (t < viewStart || t > viewEnd) return;
        const isPlaying = !!playingSource && playSpan > 0;
        const xr = Math.round(((t - viewStart) / viewSpan) * canvas.width);
        const lineW = POINTER_IS_COARSE ? 6 : 2;
        const hw = POINTER_IS_COARSE ? 34 : 7;
        const hh = POINTER_IS_COARSE ? 26 : 13;
        ctx.save();
        ctx.fillStyle = isPlaying ? 'rgba(255, 60, 60, 0.95)' : '#ff9800';
        ctx.fillRect(xr - Math.floor(lineW / 2), 0, lineW, canvas.height);
        ctx.beginPath();
        ctx.moveTo(xr - hw, 0);
        ctx.lineTo(xr + hw, 0);
        ctx.lineTo(xr, hh);
        ctx.closePath();
        ctx.fill();
        if (POINTER_IS_COARSE) {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.restore();
    };

    const setPlayhead = (t) => {
        playheadTime = clamp(t, 0, duration());
        drawWaveform();
    };

    const isOnPlayheadHandle = (xCss, yCss, rectWidth, zonePx = PLAYHEAD_HANDLE_ZONE_PX, grabPx = PLAYHEAD_GRAB_PX) => {
        if (yCss > zonePx) return false;
        const viewStart = state.viewStart ?? 0;
        const viewEnd = state.viewEnd ?? duration();
        const viewSpan = Math.max(0.001, viewEnd - viewStart);
        const t = getNeedleTime();
        if (t < viewStart || t > viewEnd) return false;
        const needleXCss = ((t - viewStart) / viewSpan) * rectWidth;
        return Math.abs(xCss - needleXCss) <= grabPx;
    };

    const updatePlaybackMarker = () => {
        if (!playingSource || playSpan <= 0) return;
        drawWaveform();
    };


    const stopPlayback = ({ preserveMacroPreview = false } = {}) => {
        cancelPendingSegmentPlayback();
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
        syncSegmentPlayButtons(null);
        syncPlayButtons();
        rebuildTimeline({ preserveMacroWaveform: true });
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
        const macroId = (typeof getSelectedMacroId === 'function' ? getSelectedMacroId() : 'FLAT') || 'FLAT';
        return applyExportFxToPcm(state.pcm, state.sampleRate, macroId);
    };

    const playSelection = async () => {
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
        const len = Math.max(0.001, endPos - start);
        if (start >= duration() || len <= 0) return;
        if (playingSource) stopPlayback();
        const ctxAudio = getAudioCtx();
        if (ctxAudio.state === 'suspended') await ctxAudio.resume();
        const buffer = ctxAudio.createBuffer(1, state.pcm.length, state.sampleRate);
        const playbackGain = getExportGain();
        applyGainToAudioBuffer(buffer, getPlaybackPcm(), playbackGain);
        const source = ctxAudio.createBufferSource();
        source.buffer = buffer;
        source.connect(ctxAudio.destination);
        source.start(0, start, len);
        playingSource = source;
        playingMode = 'selection';
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
    };

    const playWholeFile = async () => {
        if (!state.pcm.length) return;
        const resumeInfo = pausedPlayback && pausedPlayback.mode === 'all' ? pausedPlayback : null;
        const start = resumeInfo ? resumeInfo.resumeFrom : clamp(playheadTime, 0, duration());
        const endPos = duration();
        const len = Math.max(0.001, endPos - start);
        if (start >= endPos || len <= 0) return;
        if (playingSource) stopPlayback();
        const ctxAudio = getAudioCtx();
        if (ctxAudio.state === 'suspended') await ctxAudio.resume();
        const buffer = ctxAudio.createBuffer(1, state.pcm.length, state.sampleRate);
        const playbackGain = getExportGain();
        applyGainToAudioBuffer(buffer, getPlaybackPcm(), playbackGain);
        const source = ctxAudio.createBufferSource();
        source.buffer = buffer;
        source.connect(ctxAudio.destination);
        source.start(0, start, len);
        playingSource = source;
        playingMode = 'all';
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
    };

    const deleteSelection = () => {
        if (!state.pcm.length) return;
        const sr = state.sampleRate;
        const startIdx = Math.floor(state.selection.start * sr);
        const endIdx = Math.floor(state.selection.end * sr);
        if (endIdx <= startIdx) return;
        const left = state.pcm.slice(0, startIdx);
        const right = state.pcm.slice(endIdx);
        state.segments = [];
        if (left.length) state.segments.push({ id: 'seg-left', label: 'Left', pcm: left });
        if (right.length) state.segments.push({ id: 'seg-right', label: 'Right', pcm: right });
        rebuildTimeline();
    };

    const trimToSelection = () => {
        if (!state.pcm.length) return;
        const sr = state.sampleRate;
        const startIdx = Math.floor(state.selection.start * sr);
        const endIdx = Math.floor(state.selection.end * sr);
        if (endIdx <= startIdx) return;
        const chunk = state.pcm.slice(startIdx, endIdx);
        state.segments = [{ id: 'seg-trim', label: 'Trimmed', pcm: chunk }];
        rebuildTimeline();
    };

    const saveSelectionAsSegment = () => {
        if (!state.pcm.length) return;
        const sr = state.sampleRate;
        const startIdx = Math.floor(state.selection.start * sr);
        const endIdx = Math.floor(state.selection.end * sr);
        if (endIdx <= startIdx) return;
        const chunk = state.pcm.slice(startIdx, endIdx);
        addSegment(chunk, sr, 'Selection');
    };

    const pcmToWav = (pcm, sampleRate) => {
        const exportGain = getExportGain();
        const applyGain = Math.abs(exportGain - 1) > EXPORT_GAIN_TOLERANCE;
        const buffer = new ArrayBuffer(44 + pcm.length * 2);
        const view = new DataView(buffer);
        const writeString = (offset, str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + pcm.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, pcm.length * 2, true);
        let offset = 44;
        for (let i = 0; i < pcm.length; i++, offset += 2) {
            let s = pcm[i];
            if (applyGain) s *= exportGain;
            if (s > 1) s = 1;
            else if (s < -1) s = -1;
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        return new Blob([buffer], { type: 'audio/wav' });
    };

    const exportWav = async () => {
        if (!state.pcm.length) return;
        const blob = pcmToWav(state.pcm, state.sampleRate);
        persistStatus('Exporting WAV...');
        await saveFile('splice.wav', blob, 'audio/wav');
        const intervalId2 = setInterval(() => persistStatus('WAV exported!', true), 5);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        clearInterval(intervalId2);
    };

    const IN_APP_WEBVIEW = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '')
        || (/Macintosh/.test(navigator.userAgent || '') && (navigator.maxTouchPoints || 0) > 1);
    const MAX_PCM_BYTES = (IN_APP_WEBVIEW ? 384 : 1400) * 1024 * 1024;
    const MAX_LOAD_FILE_BYTES = (IN_APP_WEBVIEW ? 384 : 2048) * 1024 * 1024;
    const DECODE_FILE_LIMIT = (IN_APP_WEBVIEW ? 48 : 400) * 1024 * 1024;

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

    const handleFile = async (file) => {
        if (!file) return;
        const name = file.name || '';
        const isWav = /\.wav$/i.test(name) || file.type === 'audio/wav' || file.type === 'audio/x-wav';
        if (file.size > MAX_LOAD_FILE_BYTES) {
            persistStatus(`This ${(file.size / 1048576).toFixed(0)} MB file is too large to load on this device. Try a shorter clip or a lower sample rate.`);
            return;
        }
        if (isWav) {
            let res = null;
            try { res = await loadWavMonoFloat32(file); } catch (e) { res = null; }
            if (res && res.tooLarge) return;
            if (res && res.pcm) {
                addSegment(res.pcm, res.sampleRate, name || 'File', '', true);
                resetViewWindow();
                drawWaveform();
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
            resetViewWindow();
            drawWaveform();
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
        if (mode === 'spfy') {
            return getSpfyEngine().synth(text, { reportStatus: piperReportStatus, onProgress: wasmVoiceProgress });
        }
        if (mode === 'acuvoice') {
            return getAcuEngine().synth(text, { reportStatus: piperReportStatus, onProgress: wasmVoiceProgress });
        }
        const target = state.sampleRate || 44100;
        const pcm = await getPiperPcm(text, target, { ensureLoaded: ensurePiper, reportStatus: piperReportStatus });
        if (!pcm) throw new Error('TTS service unavailable');
        return { pcm, sampleRate: target };
    };

    const getVoiceList = async () => {
        if (!voiceSelect || voiceListLoaded) return;

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

    const getAudioFromPage = async (response) => {
        const decoder = new TextDecoder("utf-8");
        const responseText = decoder.decode(response);
        const audioMatch = responseText.match(/id="downloadlink"><a href="(.*)" download/i);
        const jsonMatch = responseText.match(/<span id="jsonErrorMsg">(.*)</i);

        if (jsonMatch && jsonMatch[1]) {
            const cleanMatch = jsonMatch[1].replace(/.*Exact error: (.*)/, "$1");
            const errorMsg = cleanMatch !== '' ? cleanMatch : jsonMatch[1];
            throw new Error(errorMsg);
        }

        if (audioMatch && audioMatch[1]) {
            const audioSrc = audioMatch[1];
            const audioResponse = await fetch("https://wagspuzzle.space/tools/eas-tts/" + audioSrc);
            const audioArrayBuffer = await audioResponse.arrayBuffer();
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            try {
                return await audioContext.decodeAudioData(audioArrayBuffer);
            } finally {
                audioContext.close().catch(() => { });
            }
        }

        return null;
    };

    const bitcrushSpeechifyPcm = async (pcm, sampleRate) => {
        if (!(pcm instanceof Float32Array) || pcm.length === 0) {
            return pcm;
        }

        const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;

        const fallbackExciter = () => {
            const nyquist = sr / 2;
            if (nyquist < 5000) return pcm;

            const out = new Float32Array(pcm.length);
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

            return result;
        } catch {
            return fallbackExciter();
        }
    };

    const fetchRemoteTtsAudio = ({ text, voiceId, overrideTZ }) => {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const url = "https://wagspuzzle.space/tools/eas-tts/index.php?handler=toolkit";

            const ttsRate = document.getElementById("ttsRate2")?.value || "0";
            const ttsPitch = document.getElementById("ttsPitch2")?.value || "0";
            const voiceBackend = voiceBackendMap[Object.keys(voiceBackendMap).find(backend => voiceBackendMap[backend].includes(voiceId))] ? Object.keys(voiceBackendMap).find(backend => voiceBackendMap[backend].includes(voiceId)) : "Unknown";

            let oldTtsText = text;

            if (voiceBackend.toLowerCase().includes("bal") && (ttsRate !== "0" || ttsPitch !== "0")) {
                if (ttsRate !== "0") {
                    text = `<rate absspeed="${ttsRate}">${text}</rate>`;
                }
                if (ttsPitch !== "0") {
                    text = `<pitch absmiddle="${ttsPitch}">${text}</pitch>`;
                }
            }

            else if (voiceBackend.toLowerCase().includes("vt") && (ttsRate !== "0" || ttsPitch !== "0")) {
                const vtValue = (value) => {
                    const parsed = Number(value);
                    if (!Number.isFinite(parsed)) { return 100; }
                    const scaled = Math.round((parsed * 10) + 100);
                    return Math.min(200, Math.max(0, scaled));
                };
                if (ttsRate !== "0") {
                    text = `<vtml_speed value="${vtValue(ttsRate)}">${text}</vtml_speed>`;
                }
                if (ttsPitch !== "0") {
                    text = `<vtml_pitch value="${vtValue(ttsPitch)}">${text}</vtml_pitch>`;
                }
            }

            const params = new URLSearchParams();

            params.append("text", voiceId === "EMNet" ? text : text);
            params.append("voice", voiceId);
            params.append("useOverrideTZ", overrideTZ ?? "UTC");

            xhr.open("POST", url, true);
            xhr.responseType = "arraybuffer";
            xhr.setRequestHeader("Accept", "*/*");
            xhr.setRequestHeader("User-Agent", "EAS-Tools/wagwan-piffting-blud.github.io");
            xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");

            const toArrayBuffer = (payload) => {
                if (payload instanceof ArrayBuffer) return Promise.resolve(payload);
                if (payload instanceof Blob) return payload.arrayBuffer();
                if (typeof payload === "string") {
                    const withoutPrefix = payload.replace(/^data:audio\/[\w.+-]+;base64,/, "");
                    const candidate = withoutPrefix.replace(/\s/g, "");
                    return new Promise((resolvePayload, rejectPayload) => {
                        try {
                            const binary = atob(candidate);
                            const buffer = new ArrayBuffer(binary.length);
                            const bytes = new Uint8Array(buffer);
                            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                            resolvePayload(buffer);
                        } catch {
                            try {
                                const buffer = new ArrayBuffer(withoutPrefix.length);
                                const bytes = new Uint8Array(buffer);
                                for (let i = 0; i < withoutPrefix.length; i++) {
                                    bytes[i] = withoutPrefix.charCodeAt(i) & 0xff;
                                }
                                resolvePayload(buffer);
                            } catch (err) {
                                rejectPayload(err);
                            }
                        }
                    });
                }
                return Promise.reject(new TypeError("Unsupported payload type"));
            };

            xhr.onload = function () {
                const contentType = xhr.getResponseHeader("Content-Type") || "";
                const finishWithError = (err) => reject(err || new Error("TTS fetch failed"));

                if (xhr.status >= 200 && xhr.status < 300 && contentType.startsWith("audio/wav")) {
                    window.updateTTSRequestsCounter();
                    const rawPayload = xhr.response ?? xhr.responseText;
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

                            const sourcePcm = buffer.getChannelData(0);
                            const shouldBitcrushSpeechify = shouldBitcrushSpeechifyCheckbox?.checked === true && /Speechify/i.test(voiceId || "");
                            const pcm = shouldBitcrushSpeechify
                                ? await bitcrushSpeechifyPcm(sourcePcm, buffer.sampleRate)
                                : sourcePcm;

                            resolve({ pcm, sampleRate: buffer.sampleRate });
                        }).catch((error) => {
                            if (typeof audioContext.close === "function") {
                                audioContext.close().catch(() => { });
                            }
                            finishWithError(error);
                        });
                    }).catch(finishWithError);
                } else if (contentType.startsWith("application/json")) {
                    try {
                        const decoder = new TextDecoder("utf-8");
                        const responseJSON = JSON.parse(decoder.decode(xhr.response));
                        finishWithError(new Error(responseJSON.error || "TTS JSON error"));
                    } catch (error) {
                        finishWithError(error);
                    }
                } else {
                    try {
                        getAudioFromPage(xhr.response).then(async (buffer) => {
                            if (buffer) {
                                const sourcePcm = buffer.getChannelData(0);
                                const shouldBitcrushSpeechify = shouldBitcrushSpeechifyCheckbox?.checked === true && /Speechify/i.test(voiceId || "");
                                const pcm = shouldBitcrushSpeechify
                                    ? await bitcrushSpeechifyPcm(sourcePcm, buffer.sampleRate)
                                    : sourcePcm;
                                resolve({ pcm, sampleRate: buffer.sampleRate });
                            } else {
                                finishWithError(new Error("No audio found in response"));
                            }
                        }).catch(finishWithError);
                    } catch (error) {
                        finishWithError(error);
                    }
                }
            };

            xhr.onerror = function () {
                reject(new Error(`Network error: ${xhr.status} ${xhr.statusText}`));
            };

            xhr.send(params.toString());

            text = oldTtsText ?? text;
        });
    };

    const bindEvents = () => {
        canvas.addEventListener('mousedown', (event) => {
            if (!state.pcm.length) return;
            const rect = canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            syncViewWindow();
            const viewSpan = state.viewEnd - state.viewStart;
            const t = clamp(state.viewStart + (x / rect.width) * viewSpan, 0, duration());
            const panState = {
                startX: event.clientX,
                viewStart: state.viewStart,
                viewEnd: state.viewEnd,
            };
            if (!event.shiftKey && isOnPlayheadHandle(x, y, rect.width)) {
                dragMode = 'playhead';
                if (playingSource) stopPlayback();
                setPlayhead(t);
            } else if (event.shiftKey) {
                dragMode = 'pan';
            } else {
                const distStart = Math.abs(t - state.selection.start);
                const distEnd = Math.abs(t - state.selection.end);
                dragMode = distStart < distEnd ? 'start' : 'end';
                setSelection(dragMode === 'start' ? t : state.selection.start, dragMode === 'end' ? t : state.selection.end);
            }

            const move = (e) => {
                const nx = e.clientX - rect.left;
                if (dragMode === 'playhead') {
                    setPlayhead(clamp(state.viewStart + (nx / rect.width) * viewSpan, 0, duration()));
                } else if (dragMode === 'pan') {
                    const deltaPixels = e.clientX - panState.startX;
                    const deltaTime = (deltaPixels / rect.width) * (panState.viewEnd - panState.viewStart);
                    let newStart = panState.viewStart - deltaTime;
                    let newEnd = panState.viewEnd - deltaTime;
                    const d = duration();
                    if (newStart < 0) {
                        newStart = 0;
                        newEnd = newStart + (panState.viewEnd - panState.viewStart);
                    }
                    if (newEnd > d) {
                        newEnd = d;
                        newStart = clamp(newEnd - (panState.viewEnd - panState.viewStart), 0, d);
                    }
                    state.viewStart = newStart;
                    state.viewEnd = newEnd;
                    drawWaveform();
                } else {
                    const nt = clamp(state.viewStart + (nx / rect.width) * viewSpan, 0, duration());
                    if (dragMode === 'start') setSelection(nt, state.selection.end);
                    else setSelection(state.selection.start, nt);
                }
            };
            const up = () => {
                dragMode = null;
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });

        canvas.addEventListener('mousemove', (event) => {
            if (dragMode || !state.pcm.length) return;
            const rect = canvas.getBoundingClientRect();
            const overHandle = isOnPlayheadHandle(event.clientX - rect.left, event.clientY - rect.top, rect.width);
            canvas.style.cursor = overHandle ? 'ew-resize' : '';
        });

        canvas.addEventListener('wheel', (event) => {
            if (!state.pcm.length) return;
            event.preventDefault();
            syncViewWindow();
            const rect = canvas.getBoundingClientRect();
            const xRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            const center = state.viewStart + (state.viewEnd - state.viewStart) * xRatio;
            const factor = event.deltaY < 0 ? 0.8 : 1.25;
            const newSpan = clamp((state.viewEnd - state.viewStart) * factor, state.minViewSpan, duration());
            let newStart = center - newSpan * xRatio;
            let newEnd = newStart + newSpan;
            const d = duration();
            if (newStart < 0) {
                newStart = 0;
                newEnd = newSpan;
            }
            if (newEnd > d) {
                newEnd = d;
                newStart = Math.max(0, d - newSpan);
            }
            state.viewStart = newStart;
            state.viewEnd = newEnd;
            drawWaveform();
        }, { passive: false });

        const getTouchById = (touches, id) => {
            for (let i = 0; i < touches.length; i++) if (touches[i].identifier === id) return touches[i];
            return null;
        };

        const TAP_MAX_MOVE = 8;
        const TAP_MAX_MS = 300;

        canvas.addEventListener('touchstart', (event) => {
            if (event.cancelable) event.preventDefault();
            if (!state.pcm.length) return;
            syncViewWindow();
            const rect = canvas.getBoundingClientRect();

            if (event.touches.length === 1) {
                const t = event.touches[0];
                const xCss = t.clientX - rect.left;
                const yCss = t.clientY - rect.top;
                if (isOnPlayheadHandle(xCss, yCss, rect.width, PLAYHEAD_TOUCH_ZONE_PX, PLAYHEAD_TOUCH_GRAB_PX)) {
                    touchPlayhead = { id: t.identifier };
                    touchPan = null;
                    pinchState = null;
                    touchSelectionId = null;
                    dragMode = null;
                    if (playingSource) stopPlayback();
                    const span = state.viewEnd - state.viewStart;
                    setPlayhead(clamp(state.viewStart + (xCss / rect.width) * span, 0, duration()));
                } else {
                    touchPan = {
                        id: t.identifier,
                        startX: t.clientX,
                        startY: t.clientY,
                        startViewStart: state.viewStart,
                        startViewEnd: state.viewEnd,
                        moved: false,
                        startTime: Date.now(),
                    };
                    pinchState = null;
                    touchSelectionId = null;
                    touchPlayhead = null;
                    dragMode = null;
                }
            } else if (event.touches.length === 2) {
                const a = event.touches[0];
                const b = event.touches[1];
                const midX = (a.clientX + b.clientX) / 2;
                const midY = (a.clientY + b.clientY) / 2;
                const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                pinchState = {
                    initialDist: Math.max(1, dist),
                    initialViewStart: state.viewStart,
                    initialViewEnd: state.viewEnd,
                    midX,
                    midY,
                };
                touchPan = null;
                touchSelectionId = null;
                touchPlayhead = null;
                dragMode = null;
            } else {
                pinchState = null;
                touchPan = null;
                touchSelectionId = null;
                touchPlayhead = null;
                dragMode = null;
            }
        }, { passive: false });

        canvas.addEventListener('touchmove', (event) => {
            if (event.cancelable) event.preventDefault();
            if (!state.pcm.length) return;
            const rect = canvas.getBoundingClientRect();

            if (event.touches.length === 1 && touchPlayhead && getTouchById(event.touches, touchPlayhead.id)) {
                const t = getTouchById(event.touches, touchPlayhead.id);
                const span = state.viewEnd - state.viewStart;
                setPlayhead(clamp(state.viewStart + ((t.clientX - rect.left) / rect.width) * span, 0, duration()));
            } else if (event.touches.length === 1 && touchPan && getTouchById(event.touches, touchPan.id)) {
                const t = getTouchById(event.touches, touchPan.id);
                const span = touchPan.startViewEnd - touchPan.startViewStart;
                const deltaPixels = t.clientX - touchPan.startX;
                if (Math.abs(deltaPixels) > TAP_MAX_MOVE) touchPan.moved = true;
                const deltaTime = (deltaPixels / rect.width) * span;
                let newStart = touchPan.startViewStart - deltaTime;
                let newEnd = touchPan.startViewEnd - deltaTime;
                const d = duration();
                if (newStart < 0) {
                    newStart = 0;
                    newEnd = newStart + span;
                }
                if (newEnd > d) {
                    newEnd = d;
                    newStart = Math.max(0, d - span);
                }
                state.viewStart = newStart;
                state.viewEnd = newEnd;
                drawWaveform();
            } else if (event.touches.length === 2) {
                const a = event.touches[0];
                const b = event.touches[1];
                const midX = (a.clientX + b.clientX) / 2;
                const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

                if (!pinchState) {
                    pinchState = {
                        initialDist: Math.max(1, dist),
                        initialViewStart: state.viewStart,
                        initialViewEnd: state.viewEnd,
                        midX,
                        midY: (a.clientY + b.clientY) / 2,
                    };
                }

                const initialDist = pinchState.initialDist;
                const initialViewStart = pinchState.initialViewStart;
                const initialViewEnd = pinchState.initialViewEnd;
                const initialSpan = Math.max(state.minViewSpan, initialViewEnd - initialViewStart);

                const zoomFactor = clamp(initialDist / Math.max(1, dist), 0.2, 5);
                const newSpan = clamp(initialSpan * zoomFactor, state.minViewSpan, duration());

                const centerRatio = clamp((midX - rect.left) / rect.width, 0, 1);
                let newStart = initialViewStart + centerRatio * (initialSpan - newSpan);
                let newEnd = newStart + newSpan;
                const d = duration();
                if (newStart < 0) {
                    newStart = 0;
                    newEnd = newSpan;
                }
                if (newEnd > d) {
                    newEnd = d;
                    newStart = Math.max(0, d - newSpan);
                }
                state.viewStart = newStart;
                state.viewEnd = newEnd;
                drawWaveform();
            }
        }, { passive: false });

        canvas.addEventListener('touchend', (event) => {
            if (!touchPlayhead && touchPan && !touchPan.moved) {
                const elapsed = Date.now() - touchPan.startTime;
                if (elapsed <= TAP_MAX_MS) {
                    const rect = canvas.getBoundingClientRect();
                    const x = touchPan.startX - rect.left;
                    const center = clamp((x / rect.width), 0, 1);
                    const t = clamp(state.viewStart + (state.viewEnd - state.viewStart) * center, 0, duration());
                    const distStart = Math.abs(t - state.selection.start);
                    const distEnd = Math.abs(t - state.selection.end);
                    if (distStart < distEnd) {
                        setSelection(t, state.selection.end);
                    } else {
                        setSelection(state.selection.start, t);
                    }
                }
            }

            if (touchPlayhead && !getTouchById(event.touches, touchPlayhead.id)) {
                touchPlayhead = null;
            }

            if (event.touches.length === 1) {
                const remaining = event.touches[0];
                touchPan = {
                    id: remaining.identifier,
                    startX: remaining.clientX,
                    startY: remaining.clientY,
                    startViewStart: state.viewStart,
                    startViewEnd: state.viewEnd,
                    moved: false,
                    startTime: Date.now(),
                };
                pinchState = null;
                touchPlayhead = null;
            } else {
                touchPan = null;
                pinchState = null;
                touchSelectionId = null;
                dragMode = null;
                touchPlayhead = null;
            }
        }, { passive: false });

        canvas.addEventListener('touchcancel', () => {
            touchPan = null;
            pinchState = null;
            touchSelectionId = null;
            dragMode = null;
            touchPlayhead = null;
        });

        fileInput?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
            setButtonDisabledState(false);
        });

        playBtn?.addEventListener('click', async () => {
            const isSelectionPlaying = playingSource && playingMode === 'selection';
            if (isSelectionPlaying) {
                pausePlayback();
                syncPlayButtons();
                return;
            }
            try {
                await playSelection();
            } catch (err) {
                persistStatus(`Failed to play selection: ${err}.`, false);
            } finally {
                syncPlayButtons();
            }
        });

        playAllBtn?.addEventListener('click', async () => {
            const isPlayingAll = playingSource && playingMode === 'all';
            if (isPlayingAll) {
                pausePlayback();
                syncPlayButtons();
                return;
            }
            try {
                await playWholeFile();
            } catch (err) {
                persistStatus(`Failed to play entire file: ${err}.`, false);
            } finally {
                syncPlayButtons();
            }
        });

        loadFileBtn?.addEventListener('click', () => { fileInput?.click(); });
        stopBtn?.addEventListener('click', stopPlayback);
        trimBtn?.addEventListener('click', trimToSelection);
        deleteBtn?.addEventListener('click', deleteSelection);
        splitBtn?.addEventListener('click', saveSelectionAsSegment);
        exportBtn?.addEventListener('click', exportWav);
        clearBtn?.addEventListener('click', async () => {
            stopPlayback();
            state.segments = [];
            state.pcm = new Float32Array(0);
            playheadTime = 0;
            setSelection(0, 0);
            updateSegmentsList();
            invalidateMacroWaveformCache(true);
            macroRenderBlobCache = null;
            drawWaveform();
            clearCache();
            setButtonDisabledState(true);
            const intervalId = setInterval(() => persistStatus('Project cleared.', true), 5);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            clearInterval(intervalId);
        });

        silenceBtn?.addEventListener('click', addSilence);
        splitSelectionBtn?.addEventListener('click', splitAtSelection);
        joinAllBtn?.addEventListener('click', joinAllSegments);

        voiceSelect?.addEventListener('change', () => {
            const selectedVoice = (voiceSelect?.value || 'wasm').trim();
            const overrideTZElements = document.getElementsByClassName('splicerOverrideTZ');
            if (selectedVoice !== 'EMNet') {
                Array.from(overrideTZElements).forEach(el => el.style.display = 'none');
            } else {
                Array.from(overrideTZElements).forEach(el => el.style.display = 'inline-block');
            }
        });

        voiceSelect?.dispatchEvent(new Event('change'));

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
                if (normalizedVoice === 'wasm' || normalizedVoice === 'nanotts' || normalizedVoice === 'spfy' || normalizedVoice === 'acuvoice') {
                    const valid = await validateMarkupAndText(voiceBackendMap, selectedVoiceValue, text);
                    if (!valid) {
                        if (ttsStatus) ttsStatus.textContent = 'Text contains invalid phonemes or markup for this backend.';
                        return;
                    }
                    const { pcm, sampleRate } = await synthTts(text, normalizedVoice);
                    addSegment(pcm, sampleRate, 'TTS', text);
                    if (ttsStatus) ttsStatus.textContent = `Added ${(pcm.length / (sampleRate || state.sampleRate)).toFixed(2)}s of audio.`;
                    setButtonDisabledState(false);
                    resetViewWindow();
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
                        resetViewWindow();
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
                    const result = await fetchRemoteTtsAudio({ text, voiceId: selectedVoiceValue, overrideTZ: tz });
                    if (result?.pcm?.length) {
                        addSegment(result.pcm, result.sampleRate, 'TTS', text);
                        if (ttsStatus) ttsStatus.textContent = `Added ${(result.pcm.length / (result.sampleRate || state.sampleRate)).toFixed(2)}s of audio.`;
                        setButtonDisabledState(false);
                        resetViewWindow();
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
        playBtn.disabled = disabled;
        playAllBtn.disabled = disabled;
        stopBtn.disabled = disabled;
        splitBtn.disabled = disabled;
        trimBtn.disabled = disabled;
        deleteBtn.disabled = disabled;
        exportBtn.disabled = disabled;
        splitSelectionBtn.disabled = disabled;
        joinAllBtn.disabled = disabled;
        clearBtn.disabled = disabled;
        if (previewMacroBtn) previewMacroBtn.disabled = disabled;
        if (exportMacroBtn) exportMacroBtn.disabled = disabled;
    };

    const restoreFromCache = async () => {
        const payload = await loadProject();
        if (!payload || !payload.segments?.length) {
            setButtonDisabledState(true);
            persistStatus('No cached project found yet.');
            drawWaveform();
            updateSegmentsList();
            return;
        }
        voiceSelect.value = payload.ttsVoiceSelection || PIPER_VOICE;
        ttsInput.value = payload.ttsText || '';
        macroSelect.value = payload.macroSelection || 'FLAT';
        restoreAudMacroSelection();
        spliceSilenceInput.value = payload.spliceSilenceInput ?? 0.5;
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
        window.splicerEditor.setValue(payload.ttsText || '');
        state.sampleRate = payload.sampleRate || state.sampleRate;
        state.segments = payload.segments.map((s) => ({
            id: s.id || `seg-${Math.random().toString(16).slice(2)}`,
            label: s.label,
            pcm: new Float32Array(s.pcm),
            sourceText: s.sourceText || '',
        }));
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

    function reportErrorStatus(message, err) {
        if (typeof persistStatus === 'function') {
            persistStatus(message, false);
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
        if (previous) macroSelect.value = previous;
    }

    function addAudacityMacrosToSelect() {
        if (!macroSelect || !window.AudacityMacroEngine) return;
        if (macroSelect.querySelector('optgroup[data-aud]')) return;
        const list = window.AudacityMacroEngine.listMacros();
        if (!list.length) return;
        const grp = document.createElement('optgroup');
        grp.label = 'Audacity VST macros';
        grp.setAttribute('data-aud', '1');
        list.forEach(({ id, name }) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name;
            grp.appendChild(opt);
        });
        macroSelect.appendChild(grp);
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

    function encodeWavFromPcm(pcm, sampleRate) {
        const buffer = new ArrayBuffer(44 + pcm.length * 2);
        const view = new DataView(buffer);

        function writeString(offset, str) {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        }

        const length = pcm.length;

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, length * 2, true);

        let offset = 44;
        for (let i = 0; i < length; i++, offset += 2) {
            let s = pcm[i];
            s = Math.max(-1, Math.min(1, s));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    async function renderMacroToWavFromPcm(pcm, sampleRate, macroId) {
        if (!pcm || !pcm.length) {
            reportErrorStatus('FX: cannot render macro – empty PCM data.');
            throw new Error('renderMacroToWavFromPcm: empty PCM data');
        }

        const id = macroId || 'FLAT';
        const loudnessDbfs = getExportLoudnessDbfs();

        const fxPcm = applyExportFxToPcm(pcm, sampleRate, id);

        const exportGain = Math.pow(10, loudnessDbfs / 20);
        const pcmForExport = clonePcmWithGain(fxPcm, exportGain);

        if (id.startsWith('AUD:') && window.AudacityMacroEngine) {
            try {
                const processed = await window.AudacityMacroEngine.applyMacroFile(
                    fxPcm, sampleRate, id.slice(4), { onProgress: macroProgressCb });
                setMacroProgress(1, 'Macro render complete');
                return encodeWavFromPcm(clonePcmWithGain(processed.pcm, exportGain), processed.sampleRate);
            } catch (err) {
                setMacroProgress(1, '');
                reportErrorStatus(`Audacity macro '${id.slice(4)}' failed; exporting dry.`, err);
                return encodeWavFromPcm(pcmForExport, sampleRate);
            }
        }

        try {
            const soxBlob = await renderMacroWithSox(fxPcm, sampleRate, id, loudnessDbfs);
            if (soxBlob) {
                return soxBlob;
            }
        } catch (err) { /* ignore */ }

        return encodeWavFromPcm(pcmForExport, sampleRate);
    }

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
        ].join('|');
    };

    const getSegmentPcmRefs = () => state.segments.map((seg) => seg.pcm);

    const sameSegmentPcmRefs = (a, b) => {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    };

    const renderMacroBlobCached = async (macroId) => {
        const key = getMacroRenderKey(macroId);
        const segRefs = getSegmentPcmRefs();
        if (macroRenderBlobCache
            && macroRenderBlobCache.key === key
            && sameSegmentPcmRefs(macroRenderBlobCache.segRefs, segRefs)) {
            return macroRenderBlobCache.blob;
        }
        if (macroId.startsWith('AUD:') && macroWaveformPcm && macroWaveformPcm.length
            && macroWaveformOutputSig && macroWaveformOutputSig === getMacroOutputSignature(macroId)) {
            const exportGain = Math.pow(10, getExportLoudnessDbfs() / 20);
            const reusedBlob = encodeWavFromPcm(clonePcmWithGain(macroWaveformPcm, exportGain), macroWaveformSampleRate);
            if (reusedBlob) {
                macroRenderBlobCache = { key, blob: reusedBlob, segRefs };
                return reusedBlob;
            }
        }
        const blob = await renderMacroToWavFromPcm(state.pcm, state.sampleRate, macroId);
        if (blob) {
            macroRenderBlobCache = { key, blob, segRefs };
        }
        return blob;
    };

    async function previewCurrentMacro() {
        if (typeof state === 'undefined' || !state.pcm || !state.pcm.length) {
            reportErrorStatus('No PCM data available to preview.');
            return;
        }

        if (previewMacroBtn) {
            previewMacroBtnWasDisabled = previewMacroBtn.disabled;
            setPreviewMacroButtonState('Rendering macro...', true);
        }

        const macroId = getSelectedMacroId();
        console.log('[Splicer] previewCurrentMacro macroId =', macroId);

        try {
            const blob = await renderMacroBlobCached(macroId);

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
            macroPreviewPlayback = { audio, cleanup: cleanupUrl, paused: false, macroId };

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
            setPreviewMacroButtonState('Pause Macro Preview', false);

            const ctxAudio = audioCtx || getAudioCtx();
            if (ctxAudio && ctxAudio.state === 'suspended' && typeof ctxAudio.resume === 'function') {
                try {
                    await ctxAudio.resume();
                } catch (err) {
                    reportErrorStatus(`Failed to resume audio context for macro preview: ${err}`);
                }
            }

            const startOffset = clamp(playheadTime, 0, Math.max(0, duration()));
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

    async function exportWavWithCurrentMacro() {
        if (typeof state === 'undefined' || !state.pcm || !state.pcm.length) {
            reportErrorStatus('FX: no PCM data available to export.');
            return;
        }

        const macroId = getSelectedMacroId();
        console.log('[Splicer] exportWavWithCurrentMacro macroId =', macroId);

        try {
            const blob = await renderMacroBlobCached(macroId);

            let label = macroId;
            if (macroSelect && macroSelect.selectedIndex >= 0) {
                label = macroSelect.options[macroSelect.selectedIndex].text || macroId;
            }
            const safeLabel = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-');
            persistStatus('Preparing Macro WAV for download...', true);
            await saveFile(`splice-${safeLabel}.wav`, blob, 'audio/wav');
            const intervalId5 = setInterval(() => persistStatus('Macro WAV exported!', true), 5);
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
        staticNoiseOptions.style.display = enabled ? 'block' : 'none';
        return enabled;
    };

    const sync60HzHumUi = () => {
        if (!enable60HzHumCheckbox || !humOptions) return false;
        const enabled = enable60HzHumCheckbox.checked === true;
        if (!enable60HzHumCheckbox.disabled) {
            enable60HzHum = enabled;
        }
        humOptions.style.display = enabled ? 'block' : 'none';
        return enabled;
    };

    const syncBitcrushUi = () => {
        if (!enableBitcrushCheckbox || !bitcrushOptions) return false;
        const enabled = enableBitcrushCheckbox.checked === true;
        bitcrushOptions.style.display = enabled ? 'block' : 'none';
        return enabled;
    };

    const syncVmifyUi = () => {
        if (!enableVmifyCheckbox || !vmifyOptions) return false;
        const enabled = enableVmifyCheckbox.checked === true;
        vmifyOptions.style.display = enabled ? 'block' : 'none';
        return enabled;
    };

    if (macroSelect) {
        macroSelect.addEventListener('change', () => {
            const macroValue = document.getElementById('spliceMacros').value;
            rememberAudMacro(macroValue);
            if (macroValue === noisyMacroId) {
                enableStaticNoiseCheckbox.checked = true;
                enableStaticNoiseCheckbox.disabled = true;
                staticNoiseOptions.style.display = 'none';
            } else {
                enableStaticNoiseCheckbox.disabled = false;
                enableStaticNoiseCheckbox.checked = staticNoisePreference;
                staticNoiseOptions.style.display = staticNoisePreference ? 'block' : 'none';
            }

            invalidateMacroPreview();
            scheduleMacroWaveformUpdate();
        });
    }

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

    const ttsRate = document.getElementById("ttsRate2");
    const ttsRateReset = document.getElementById("ttsRateReset2");
    ttsRateReset.addEventListener("click", function () {
        ttsRate.value = "0";
        ttsRate.dispatchEvent(new Event('change'));
    });
    const ttsPitch = document.getElementById("ttsPitch2");
    const ttsPitchReset = document.getElementById("ttsPitchReset2");
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
            syncTtsSlider(ttsRate, "ttsRateValue2");
        });

        ttsPitch.addEventListener(evtName, function () {
            syncTtsSlider(ttsPitch, "ttsPitchValue2");
        });
    });

    voiceSelect.addEventListener('change', () => {
        const voiceBackend = Object.keys(voiceBackendMap).find(backend => voiceBackendMap[backend].includes(voiceSelect.value));
        const ttsControls = document.getElementById('ttsRatePitchControls2');

        if (/Speechify/i.test(voiceSelect.value)) {
            shouldBitcrushSpeechifyDiv.style.display = 'block';
        } else {
            shouldBitcrushSpeechifyDiv.style.display = 'none';
        }

        if (voiceBackend === 'VT' || voiceBackend === 'BAL') {
            ttsControls.style.display = 'block';
        } else {
            ttsControls.style.display = 'none';
        }
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

    setupMacroCombo();
    await loadSoxMacroDefs();
    bindEvents();
    updateSelectionLabels();
    drawWaveform();
    restoreFromCache();
    await getVoiceList();
})();
