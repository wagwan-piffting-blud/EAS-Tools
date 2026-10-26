const VOICES = [
    ['wasm', '[WASM] WebAssembly (local) Voice (takes longer time depending on text length)', 'selected'],
    ['nanotts', '[NanoTTS] WebAssembly (local) Voice #2 (faster, but less natural)'],
    ['', '[Speechify] Loading voice list...', 'data-spfy-voice-slot disabled'],
    ['acuvoice', '[AcuVoice] WebAssembly (local) AcuVoice - Roger (~160 MB one-time download)'],
    ['espeak:en-us', '[eSpeak] eSpeak NG (local) - English (US) (~1.3 MB one-time download)'],
    ['espeak:en-us+m3', '[eSpeak] eSpeak NG (local) - English (US), Male 3'],
    ['espeak:en-us+f2', '[eSpeak] eSpeak NG (local) - English (US), Female 2'],
    ['espeak:en-us+whisper', '[eSpeak] eSpeak NG (local) - English (US), Whisper'],
    ['espeak:en-us+croak', '[eSpeak] eSpeak NG (local) - English (US), Croak'],
    ['espeak:en-us+klatt', '[eSpeak] eSpeak NG (local) - English (US), Klatt formant'],
    ['espeak:en', '[eSpeak] eSpeak NG (local) - English (UK)'],
    ['espeak:es-419', '[eSpeak] eSpeak NG (local) - Spanish (Latin America)'],
    ['espeak:fr', '[eSpeak] eSpeak NG (local) - French'],
];

const ZONES = [
    ['UTC', 'UTC'],
    ['AST', 'AST (Atlantic Standard Time)'],
    ['EST', 'EST (Eastern Standard Time)'],
    ['EDT', 'EDT (Eastern Daylight Time)'],
    ['CST', 'CST (Central Standard Time)'],
    ['CDT', 'CDT (Central Daylight Time)'],
    ['MST', 'MST (Mountain Standard Time)'],
    ['MDT', 'MDT (Mountain Daylight Time)'],
    ['PST', 'PST (Pacific Standard Time)'],
    ['PDT', 'PDT (Pacific Daylight Time)'],
    ['AKST', 'AKST (Alaska Standard Time)'],
    ['AKDT', 'AKDT (Alaska Daylight Time)'],
    ['HST', 'HST (Hawaii-Aleutian Standard Time)'],
    ['HDT', 'HDT (Hawaii-Aleutian Daylight Time)'],
    ['SST', 'SST (Samoa Standard Time)'],
    ['CHST', 'CHST (Chamorro Standard Time)'],
];

const FILE_TYPES = 'audio/*,.wav,.wave,.x-wav,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,.caf,.3gp,.mp4,audio/mp4,audio/x-m4a';

const slider = (id, label, spoken, numberId, resetId, extra = '', tail = '') => `
                    <div class="splice-slider"${extra}>
                        <label for="${id}">${label}</label>
                        <input type="range" id="${id}" name="${id}" min="-10" max="10" value="0" step="1">
                        <label for="${numberId}" class="visually-hidden">${spoken}, minus ten to ten</label>
                        <input type="number" class="slider-number" id="${numberId}" name="${numberId}" min="-10" max="10" value="0" step="1">
                        <button type="button" id="${resetId}">Reset</button>${tail}
                    </div>`;

const VOLUME_NOTE = `
                    <p id="ttsVolume2Note" class="inline-note" hidden>Balabolka voices can only be made quieter than normal, so positive volume has no effect on them. VoiceText voices can go up to five times normal.</p>`;

const check = (id, label, data) => `
                <div class="splice-check"><input type="checkbox" id="${id}" ${data}><label for="${id}">${label}</label></div>`;

const num = (id, label, data, min, max, step, value) => `
                    <span class="splice-pair"><label for="${id}">${label}</label><input type="number" id="${id}" ${data} min="${min}" max="${max}" step="${step}" value="${value}"></span>`;

const TEMPLATE = `
<div class="splice-dock">
    <section class="splice-card splice-card-add" aria-labelledby="spliceAddTitle">
        <div class="splice-card-head">
            <h3 class="splice-card-title" id="spliceAddTitle">Add audio</h3>
            <div class="splice-quick" role="group" aria-label="Add a file or silence">
                <input id="spliceFile" type="file" accept="${FILE_TYPES}" data-splice-file hidden>
                <button type="button" data-splice-load title="Add an audio file to the timeline">Load File…</button>
                <span class="splice-pair">
                    <label for="spliceSilence">Silence (s)</label>
                    <input id="spliceSilence" type="number" step="0.1" min="0.1" value="0.2" data-splice-silence>
                    <button type="button" data-splice-add-silence>Add Silence</button>
                </span>
            </div>
        </div>
        <div class="splice-statuses">
            <span data-splice-file-status class="status-line"></span>
            <span data-splice-silence-status class="status-line"></span>
        </div>
        <div id="spliceTTSGenerator" class="splice-tts" role="group" aria-labelledby="spliceTtsLabel">
            <label for="ttsText2" class="splice-sub" id="spliceTtsLabel">Text to speech</label>
            <textarea id="ttsText2" class="ttsText" placeholder="Type the message to speak..."></textarea>
            <div class="splice-tts-go">
                <label for="ttsVoice2">Voice</label>
                <select id="ttsVoice2" name="ttsVoice2">${VOICES.map(([v, t, a]) => `<option value="${v}"${a ? ' ' + a : ''}>${t}</option>`).join('')}</select>
                <button type="button" data-splice-tts-generate class="splice-go">Generate &amp; Append</button>
            </div>
            <div id="ttsRatePitchControls2" class="splice-sliders">${slider('ttsRate2', 'Speed', 'Speech speed value', 'ttsRate2Number', 'ttsRateReset2')}${slider('ttsPitch2', 'Pitch', 'Speech pitch value', 'ttsPitch2Number', 'ttsPitchReset2')}${slider('ttsVolume2', 'Volume', 'Speech volume value', 'ttsVolume2Number', 'ttsVolume2Reset', ' id="ttsVolume2Row"')}${VOLUME_NOTE}
            </div>
            <div id="shouldBitcrushSpeechifyContainer2" class="splice-check" hidden><input type="checkbox" id="shouldBitcrushSpeechify2" name="shouldBitcrushSpeechify2"><label for="shouldBitcrushSpeechify2">"VM-sounding" Speechify output</label></div>
            <div id="spliceTZRow" class="splice-field" hidden>
                <label for="useSplicerOverrideTZ" class="splicerOverrideTZ">Time zone (EMNet only)</label>
                <select id="useSplicerOverrideTZ" name="useSplicerOverrideTZ" class="splicerOverrideTZ">${ZONES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
            </div>
            <span data-splice-tts-status class="status-line"></span>
        </div>
    </section>
    <section class="splice-card splice-card-fx" aria-labelledby="spliceFxTitle">
        <h3 class="splice-card-title" id="spliceFxTitle">Master effects</h3>
        <div class="splice-card-body splice-fx-body">
        <div class="splice-fx-main">
            <div class="splice-field splice-field-grow">
                <label for="spliceMacros" id="spliceMacrosLabel">Macro</label>
                <select id="spliceMacros" data-splice-macro-select></select>
            </div>
            <div id="spliceMacroLevel" class="splice-line" data-splice-macro-level hidden>${num('spliceMacroStrength', 'Macro Strength (%)', 'data-splice-macro-strength title="0 to 100; lower blends in more of the unprocessed audio"', 0, 100, 1, 100)}${num('spliceMacroVolume', 'Macro Volume (dB)', 'data-splice-macro-volume title="-24 to +12 dB"', -24, 12, 1, 0)}
            </div>
            <div class="splice-buttons">
                <button type="button" data-splice-chain-editor-btn title="Build a chain of macros and effects">Chain Editor…</button>
                <button type="button" disabled data-splice-preview-macro>Preview Macro</button>
                <button type="button" data-splice-macro-upload-btn title="Add an Audacity macro (.txt) to the list">Upload Macro…</button>
                <button type="button" disabled data-splice-macro-remove-btn title="Remove the selected uploaded macro">Remove Macro</button>
                <input id="spliceMacroUpload" type="file" accept=".txt,text/plain" data-splice-macro-upload hidden>
            </div>
            <div class="splice-line" hidden>
                <label for="spliceLoudness">Loudness (dB)</label>
                <input id="spliceLoudness" type="number" step="0.1" min="-60" max="12" value="0" data-splice-loudness>
            </div>
        </div>
        <fieldset class="splice-lofi">
            <legend>Lo-fi</legend>
            <div class="splice-checks">${check('enable-static-noise', 'Static noise', 'data-splice-enable-static-noise')}${check('enable-60hz-hum', '60 Hz hum', 'data-splice-enable-60hz-hum')}${check('enable-bitcrush', 'Bitcrush / alias', 'data-splice-enable-bitcrush')}${check('enable-vmify', '"VM-sounding"', 'data-splice-enable-vmify')}
            </div>
            <div id="staticNoiseOptions" class="splice-opts" hidden>${num('static-noise-level', 'Static level (0-1)', 'data-splice-static-noise-level', 0, 1, 0.01, 0.14)}${num('static-noise-fade-depth', 'Fade depth (0-1)', 'data-splice-static-noise-fade-depth', 0, 1, 0.01, 0.45)}${num('static-noise-fade-rate', 'Fade rate (Hz, 0 = off)', 'data-splice-static-noise-fade-rate', 0, 1, 0.01, 0.6)}
            </div>
            <div id="humOptions" class="splice-opts" hidden>${num('hum-level', 'Hum level (0-1)', 'data-splice-hum-level', 0, 1, 0.01, 0.01)}
            </div>
            <div id="bitcrushOptions" class="splice-opts" hidden>${num('bitcrush-bits', 'Bit depth (1-16)', 'data-splice-bitcrush-bits', 1, 16, 1, 8)}${num('bitcrush-downsample', 'Downsample (1 = off)', 'data-splice-bitcrush-downsample', 1, 64, 1, 1)}
            </div>
            <div id="vmifyOptions" class="splice-opts" hidden>${num('vmify-intensity', '"VM-sounding" intensity (0-3)', 'data-splice-vmify-intensity', 0, 3, 0.01, 1)}
            </div>
        </fieldset>
        </div>
    </section>
    <section class="splice-card splice-card-out" aria-labelledby="spliceOutTitle">
        <h3 class="splice-card-title" id="spliceOutTitle">Export</h3>
        <div class="splice-card-body splice-out-body">
        <div class="splice-output" role="group" aria-label="Export format">
            <div class="splice-field">
                <label for="spliceOutFormat">Format</label>
                <select id="spliceOutFormat"></select>
            </div>
            <div class="splice-field" id="spliceOutBitrateRow" hidden>
                <label for="spliceOutBitrate">Bitrate</label>
                <select id="spliceOutBitrate"></select>
            </div>
            <div class="splice-field">
                <label for="spliceOutChannels">Channels</label>
                <select id="spliceOutChannels"><option value="1">Mono</option><option value="2">Stereo (uses track pan)</option></select>
            </div>
            <div class="splice-check"><input type="checkbox" id="spliceOutLimit"><label for="spliceOutLimit" title="Limit peaks over 0 dB in playback and export">Prevent clipping</label></div>
        </div>
        <div class="splice-out-actions">
        <div class="splice-action-grid">
            <button type="button" disabled data-splice-export>Export WAV</button>
            <button type="button" disabled data-splice-export-macro>Export WAV with Macro</button>
        </div>
        <div class="splice-proj-line">
            <div class="splice-projects-slot"></div>
            <button type="button" disabled data-splice-clear class="splice-clear">Clear Project</button>
        </div>
        </div>
        </div>
    </section>
    <div class="splice-help-slot"></div>
</div>
<div class="splice-storage">Status: <span data-splice-persist>Waiting...</span></div>`;

export function buildPanel(panel) {
    if (!panel || panel.querySelector('.splice-dock')) return;
    const heading = panel.querySelector('.section-heading');
    panel.replaceChildren();
    if (heading) panel.append(heading);
    panel.classList.add('splice-panel');
    const tpl = document.createElement('template');
    tpl.innerHTML = TEMPLATE;
    panel.append(tpl.content);
}
