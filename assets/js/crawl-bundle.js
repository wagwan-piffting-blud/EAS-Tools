import { saveFile, CODEMIRROR_DARK_THEME_NAME, CODEMIRROR_LIGHT_THEME_NAME, USES_DARK_THEME } from './common-functions.js';
import { E2T, allEndecModes, resourcesReady } from '../E2T/EAS2Text-NG.js';

async function initCrawlEditor() {
    let crawlTextEditor = null;

    function initCrawlTextEditor() {
        if (crawlTextEditor || !window.CodeMirror) return crawlTextEditor;

        const crawlTextArea = document.getElementById('crawlText');
        if (!crawlTextArea) return null;

        const crawlEditor = CodeMirror.fromTextArea(crawlTextArea, {
            lineNumbers: true,
            mode: 'text/xml',
            matchBrackets: true,
            theme: USES_DARK_THEME ? CODEMIRROR_DARK_THEME_NAME : CODEMIRROR_LIGHT_THEME_NAME,
            lineWrapping: true,
        });

        crawlEditor.getInputField().setAttribute('aria-label', 'Text to display in the scrolling crawl');
        crawlEditor.setSize('27vw', '15rem');

        const crawlWrapper = crawlEditor.getWrapperElement();
        crawlWrapper.classList.add('ttsText', 'ttsText--editor', 'crawl-text');

        crawlEditor.on('change', () => {
            crawlEditor.save();
        });

        crawlTextEditor = crawlEditor;
        return crawlEditor;
    }

    window.crawlEditor = initCrawlTextEditor();
    window.crawlEditor.refresh();
}

(function () {
    const MOBILE_CANVAS_MEDIA_QUERY = '(max-width: 1079px)';
    const MOBILE_CANVAS_WIDTH_RATIO = 0.9;
    const MOBILE_CANVAS_HEIGHT_RATIO = 0.3;
    const mobileCanvasMediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(MOBILE_CANVAS_MEDIA_QUERY)
        : null;

    function isMobileCanvasViewport() {
        return Boolean(mobileCanvasMediaQuery && mobileCanvasMediaQuery.matches);
    }

    function getMobileCanvasLimits() {
        const docElement = typeof document !== 'undefined' ? document.documentElement : null;
        const viewportWidth = Math.max(0, window.innerWidth || 0, docElement ? docElement.clientWidth : 0);
        const viewportHeight = Math.max(0, window.innerHeight || 0, docElement ? docElement.clientHeight : 0);

        return {
            width: Math.max(1, Math.round(viewportWidth * MOBILE_CANVAS_WIDTH_RATIO)),
            height: Math.max(1, Math.round(viewportHeight * MOBILE_CANVAS_HEIGHT_RATIO))
        };
    }

    function calculateResponsiveCanvasSize(width, height) {
        if (!isMobileCanvasViewport()) {
            return null;
        }
        const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
        const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;
        if (!safeWidth || !safeHeight) {
            return null;
        }

        const { width: maxWidth, height: maxHeight } = getMobileCanvasLimits();
        if (!maxWidth || !maxHeight) {
            return null;
        }

        const widthScale = maxWidth / safeWidth;
        const heightScale = maxHeight / safeHeight;
        const scale = Math.min(1, widthScale, heightScale);
        if (!Number.isFinite(scale) || scale <= 0) {
            return null;
        }

        return {
            width: Math.max(1, Math.round(safeWidth * scale)),
            height: Math.max(1, Math.round(safeHeight * scale))
        };
    }

    function applyCanvasDisplaySize(canvas, width, height) {
        if (!canvas || !Number.isFinite(width) || !Number.isFinite(height)) {
            return;
        }
        const responsiveSize = calculateResponsiveCanvasSize(width, height);
        if (responsiveSize) {
            canvas.style.width = `${responsiveSize.width}px`;
            canvas.style.height = `${responsiveSize.height}px`;
            canvas.classList.add('crawl-canvas--responsive');
            return;
        }
        canvas.style.removeProperty('width');
        canvas.style.removeProperty('height');
        canvas.classList.remove('crawl-canvas--responsive');
    }

    const TARGET_FRAME_MS = 1000 / 60;
    const TARGET_FRAMES_PER_SECOND = 1000 / TARGET_FRAME_MS;
    const PREMADE_BACKGROUND_LAYOUTS = Object.freeze({
        'assets/screens/xfinity.png': { topLeft: { x: 0, y: 475 } },
        'assets/screens/directv.jpg': { topLeft: { x: 0, y: 1200 } },
        'easyplus': { topLeft: { x: 0, y: 175 } },
        'easyplus_gray': { topLeft: { x: 0, y: 720 } },
        'easyplus_gray_2plus': { topLeft: { x: 0, y: 820 } },
        'dasdec': { topLeft: { x: 9999, y: 9999 } }
    });
    const DASDEC_RENDER_DIMENSIONS = Object.freeze({ width: 640, height: 480 });
    const ALLOWED_CRAWL_BACKGROUND_MODES = new Set(['solid', 'transparent', 'image', 'premade']);

    function normalizeCrawlBackgroundMode(value) {
        return ALLOWED_CRAWL_BACKGROUND_MODES.has(value) ? value : 'solid';
    }

    const fontLoader = async () => {
        const fontDir = './assets/fonts/';
        const fontsToLoad = [
            { family: 'Arial', file: 'arial.ttf', description: 'a default Windows font' },
            { family: 'Verdana', file: 'verdana.ttf', description: 'a default Windows font' },
            { family: 'Helvetica', file: 'helvetica.ttf', description: 'a default Windows font' },
            { family: 'Times New Roman', file: 'times.ttf', description: 'a default Windows font' },
            { family: 'Courier New', file: 'couriernew.ttf', description: 'a default Windows font' },
            { family: 'Georgia', file: 'georgia.ttf', description: 'a default Windows font' },
            { family: 'Trebuchet MS', file: 'trebuchetms.ttf', description: 'a default Windows font' },
            { family: 'Impact', file: 'impact.ttf', description: 'a default Windows font' },
            { family: 'Comic Sans MS', file: 'comic.ttf', description: 'a default Windows font' },
            { family: 'STV5730A', file: 'stv5730a.ttf', description: 'mod of "VCR EAS"/EASyPLUS font' },
            { family: 'Geneva Blue', file: 'GenevaBlueBold.ttf', description: 'alternative small-caps Texscan font' },
            { family: 'Akzidenz', file: 'Akzidenz.ttf', description: 'sans-serif font used on Verizon crawls' },
            { family: 'Helvetica Narrow', file: 'helvn.ttf', description: 'narrower version of Helvetica' },
            { family: 'Swiss721', file: 'Swiss721.ttf', description: 'modern sans-serif font used on VDS crawls' },
            { family: 'UPD6465', file: 'UPD6465.ttf', description: 'font from the UPD6465 chipset' },
            { family: 'VCREAS_4.5', file: 'VCREAS_4.5.ttf', description: 'serif font used on EASyPLUS screens/crawls' },
            { family: 'PJF CharGen', file: 'pjf-chargen.ttf', description: 'PajamaFrix\'s font based on the Ross MC1 chargen' },
            { family: 'Luxi Mono', file: 'luximb.ttf', description: 'monospace font used on DASDECs' },
            { family: 'Bitstream Vera Sans', file: 'VeraBd.ttf', description: 'sans-serif font' },
            { family: 'Texscan', file: 'texscan.ttf', description: 'older style of sans-serif crawl font' },
            { family: 'Arial Bold', file: 'arialbd.ttf', description: 'sans-serif font used on Bevelled scrolls' },
            { family: 'User-Upload', file: 'user-upload.ttf', description: 'upload your own font to use!' }
        ];

        const fontSelect = document.getElementById('crawlFontFamily');
        if (!fontSelect) return;

        await Promise.all(
            fontsToLoad.map(({ family, file, description }) => {
                if (family === 'User-Upload') {
                    fontSelect.appendChild(new Option(`${family} (${description})`, family));
                    return Promise.resolve();
                }
                else {
                    const font = new FontFace(family, `url(${fontDir}${file})`);
                    return font.load().then((loaded) => {
                        document.fonts.add(loaded);
                        fontSelect.appendChild(new Option(`${family} (${description})`, family));
                    });
                }
            })
        );

        const previousValue = fontSelect.value;
        const sortedOptions = Array.from(fontSelect.options).sort((a, b) =>
            a.text.localeCompare(b.text, undefined, { sensitivity: 'base' })
        );
        const frag = document.createDocumentFragment();
        sortedOptions.forEach((option) => frag.appendChild(option));
        fontSelect.replaceChildren(frag);

        if (previousValue && sortedOptions.some((option) => option.value === previousValue)) {
            fontSelect.value = previousValue;
        } else if (fontSelect.selectedIndex === -1 && fontSelect.options.length) {
            fontSelect.selectedIndex = 0;
        }
    };

    const fontLoaderPromise = fontLoader().catch((err) => {
        console.error('Failed to load fonts', err);
    });

    async function ensureFontsReady() {
        try {
            await fontLoaderPromise;
        } catch (err) { /* ignore */ }
    }

    const USER_UPLOAD_FONT_FAMILY = 'User-Upload';
    let uploadedCrawlFontFace = null;
    let uploadedCrawlFontObjectUrl = null;
    let uploadedCrawlFontSignature = '';

    function buildUploadedFontSignature(file) {
        if (!file) {
            return '';
        }
        return `${file.name}|${file.size}|${file.lastModified}`;
    }

    function sanitizeUploadedFontName(fileName) {
        const baseName = typeof fileName === 'string' ? fileName.replace(/\.[^.]+$/, '') : '';
        const trimmed = baseName.trim();
        if (!trimmed) {
            return USER_UPLOAD_FONT_FAMILY;
        }
        const cleaned = trimmed.replace(/[^a-zA-Z0-9 _-]/g, ' ').replace(/\s+/g, ' ').trim();
        return cleaned || USER_UPLOAD_FONT_FAMILY;
    }

    async function loadAndRenderUserUploadedCrawlFont(file) {
        if (!file) {
            throw new Error('No custom font file selected.');
        }

        const signature = buildUploadedFontSignature(file);
        if (uploadedCrawlFontFace && uploadedCrawlFontSignature === signature) {
            return uploadedCrawlFontFace.family || USER_UPLOAD_FONT_FAMILY;
        }

        if (uploadedCrawlFontFace) {
            document.fonts.delete(uploadedCrawlFontFace);
            uploadedCrawlFontFace = null;
        }
        if (uploadedCrawlFontObjectUrl) {
            URL.revokeObjectURL(uploadedCrawlFontObjectUrl);
            uploadedCrawlFontObjectUrl = null;
        }

        const family = sanitizeUploadedFontName(file.name);
        uploadedCrawlFontObjectUrl = URL.createObjectURL(file);
        const fontFace = new FontFace(family, `url(${uploadedCrawlFontObjectUrl})`);
        uploadedCrawlFontFace = await fontFace.load();
        document.fonts.add(uploadedCrawlFontFace);
        uploadedCrawlFontSignature = signature;
        return uploadedCrawlFontFace.family || family;
    }

    async function resolveCrawlFontFamily(selectedFontFamily) {
        if (selectedFontFamily !== USER_UPLOAD_FONT_FAMILY) {
            return selectedFontFamily;
        }
        const customFontInput = document.getElementById('crawlCustomFontFile');
        const file = customFontInput && customFontInput.files ? customFontInput.files[0] : null;
        return loadAndRenderUserUploadedCrawlFont(file);
    }

    window.EAS2TextModulePromise = window.EAS2TextModulePromise || new Promise((resolve) => {
        window.addEventListener('EAS2TextModuleReady', (event) => resolve(event.detail), { once: true });
    });

    const clearButton = document.getElementById('clr-crawl');
    const localStorageKey = 'eas-tools-crawl-settings';

    if (clearButton) {
        clearButton.addEventListener('click', () => resetStatus());
    }

    function zero_pad_int(num, totalLength) {
        return num.toString().padStart(totalLength, '0');
    }

    var statuselem = document.getElementById("status-crawl");

    function addStatus(stat, type = "LOG") {
        var new_status = document.createElement("div");
        var d = new Date();
        new_status.innerHTML = zero_pad_int(d.getHours().toString() % 12 || 12, 2) + ":" + zero_pad_int(d.getMinutes().toString(), 2) + ":" + zero_pad_int(d.getSeconds().toString(), 2) + " " + (d.getHours() >= 12 ? "PM" : "AM") + " [" + type + "]: " + stat;
        statuselem.appendChild(new_status);
        clearButton.style.display = "inline-block";
    }

    function resetStatus() {
        statuselem.innerHTML = "";
        clearButton.disabled = true;
    }

    const DEFAULT_VDS_BASE_DELAY = 10;

    function createVdsExportState(ctx, lines) {
        const normalizedLines = Array.isArray(lines) ? lines : [];
        const charMetrics = [];
        const lineWidths = [];

        normalizedLines.forEach((line) => {
            const metrics = [];
            const characters = Array.from(line);
            let cursor = 0;

            characters.forEach((char) => {
                const glyph = char === '' ? ' ' : char;
                const width = ctx.measureText(glyph).width;
                metrics.push({
                    char,
                    offset: cursor,
                    width,
                    state: 'pre',
                    framesRemaining: 0
                });
                cursor += width;
            });

            charMetrics.push(metrics);
            lineWidths.push(cursor);
        });

        const maxLineWidth = lineWidths.reduce((maxWidth, width) => Math.max(maxWidth, width), 0);

        return {
            lines: normalizedLines.slice(),
            charMetrics,
            lineWidths,
            maxLineWidth
        };
    }

    function resetVdsExportState(state) {
        if (!state) return;
        state.charMetrics.forEach((metrics) => {
            metrics.forEach((metric) => {
                metric.state = 'pre';
                metric.framesRemaining = 0;
            });
        });
    }

    function updateVdsExportState(state, offsetX, viewportWidth, frameDelay, viewportInset = 0) {
        if (!state) return;
        const inset = Number.isFinite(viewportInset) ? viewportInset : 0;
        const safeWidth = Math.max(0, Number(viewportWidth) || 0);
        const viewportLeft = inset;
        const viewportRight = inset + safeWidth;

        state.charMetrics.forEach((metrics, lineIdx) => {
            const width = state.lineWidths[lineIdx] || 0;
            const lineLeft = offsetX - width / 2;

            metrics.forEach((metric) => {
                const charLeft = lineLeft + metric.offset;
                const charRight = charLeft + metric.width;

                switch (metric.state) {
                    case 'pre':
                        if (charLeft <= viewportRight) {
                            metric.state = 'delayIn';
                            metric.framesRemaining = frameDelay;
                        }
                        break;
                    case 'delayIn':
                        if (charRight < viewportLeft) {
                            metric.state = 'done';
                            metric.framesRemaining = 0;
                        } else if (metric.framesRemaining > 0) {
                            metric.framesRemaining--;
                        } else {
                            metric.state = 'visible';
                        }
                        break;
                    case 'visible':
                        if (charLeft <= viewportLeft) {
                            metric.state = 'delayOut';
                            metric.framesRemaining = frameDelay;
                        }
                        break;
                    case 'delayOut':
                        if (metric.framesRemaining > 0) {
                            metric.framesRemaining--;
                        } else {
                            metric.state = 'done';
                        }
                        break;
                    default:
                        break;
                }
            });
        });
    }

    function drawVdsExportFrame(ctx, state, offsetX, centerY, fontSize, renderText) {
        if (!state) return;
        const lineHeight = fontSize + 10;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const drawChar = (typeof renderText === 'function')
            ? renderText
            : (text, x, y) => ctx.fillText(text, x, y);

        state.charMetrics.forEach((metrics, lineIdx) => {
            const verticalOffset = lineIdx - (state.lines.length - 1) / 2;
            const y = centerY + verticalOffset * lineHeight;
            const width = state.lineWidths[lineIdx] || 0;
            const lineLeft = offsetX - width / 2;

            metrics.forEach((metric) => {
                if (metric.state !== 'visible') return;
                drawChar(metric.char, lineLeft + metric.offset, y);
            });
        });
    }

    function createTextRenderer(ctx, outlineColor, outlineWidth) {
        const parsedWidth = Number(outlineWidth);
        const hasOutline = Boolean(outlineColor) && Number.isFinite(parsedWidth) && parsedWidth > 0;

        if (!hasOutline) {
            return (text, x, y) => {
                if (text === undefined || text === null) return;
                const stringText = typeof text === 'string' ? text : String(text);
                if (!stringText) return;
                ctx.fillText(stringText, x, y);
            };
        }

        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = parsedWidth;

        return (text, x, y) => {
            if (text === undefined || text === null) return;
            const stringText = typeof text === 'string' ? text : String(text);
            if (!stringText) return;
            ctx.strokeText(stringText, x, y);
            ctx.fillText(stringText, x, y);
        };
    }

    // Source - https://stackoverflow.com/a/64656254
    // Posted by Fennec, modified by community. See post 'Timeline' for change history
    // Retrieved 2025-11-11, License - CC BY-SA 4.0
    function getSupportedMimeTypes(media, types, codecs) {
        const isSupported = MediaRecorder.isTypeSupported;
        const supported = [];
        types.forEach((type) => {
            const mimeType = `${media}/${type}`;
            codecs.forEach((codec) => [
                `${mimeType};codecs=${codec}`,
                `${mimeType};codecs=${codec.toUpperCase()}`,
            ].forEach(variation => {
                if (isSupported(variation))
                    supported.push(variation);
            }));
            if (isSupported(mimeType))
                supported.push(mimeType);
        });
        return supported;
    };

    function clearContextFully(ctx, width, height) {
        if (!ctx) {
            return;
        }
        const canvas = ctx.canvas;
        const fallbackWidth = canvas && Number.isFinite(canvas.width) && canvas.width > 0 ? canvas.width : 0;
        const fallbackHeight = canvas && Number.isFinite(canvas.height) && canvas.height > 0 ? canvas.height : 0;
        const targetWidth = Number.isFinite(width) && width > 0 ? width : fallbackWidth;
        const targetHeight = Number.isFinite(height) && height > 0 ? height : fallbackHeight;
        if (!targetWidth || !targetHeight) {
            return;
        }
        ctx.save();
        if (typeof ctx.resetTransform === 'function') {
            ctx.resetTransform();
        } else {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        const previousComposite = ctx.globalCompositeOperation;
        const previousFill = ctx.fillStyle;
        ctx.globalCompositeOperation = 'copy';
        ctx.fillStyle = 'rgba(0, 0, 0, 0)';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.globalCompositeOperation = previousComposite;
        ctx.fillStyle = previousFill;
        ctx.restore();
    }

    function drawGeneratorBackground(ctx, generator, width, height) {
        if (!ctx || !generator) {
            return;
        }
        const fallbackWidth = ctx.canvas && Number.isFinite(ctx.canvas.width) && ctx.canvas.width > 0
            ? ctx.canvas.width
            : 0;
        const fallbackHeight = ctx.canvas && Number.isFinite(ctx.canvas.height) && ctx.canvas.height > 0
            ? ctx.canvas.height
            : 0;
        const safeWidth = Number.isFinite(width) && width > 0 ? width : fallbackWidth;
        const safeHeight = Number.isFinite(height) && height > 0 ? height : fallbackHeight;
        const clearWidth = safeWidth || fallbackWidth;
        const clearHeight = safeHeight || fallbackHeight;
        const clearCanvas = () => clearContextFully(ctx, clearWidth, clearHeight);
        if (!safeWidth || !safeHeight) {
            clearCanvas();
            return;
        }
        const video = generator.bgVideo;
        const image = generator.bgImage;
        if (video) {
            const haveCurrentData = typeof HTMLMediaElement !== 'undefined'
                ? HTMLMediaElement.HAVE_CURRENT_DATA
                : 2;
            if (video.readyState >= haveCurrentData) {
                ctx.drawImage(video, 0, 0, safeWidth, safeHeight);
                return;
            }
        }
        if (image) {
            ctx.drawImage(image, 0, 0, safeWidth, safeHeight);
            return;
        }
        if (generator._transparentBg) {
            clearCanvas();
            return;
        }
        const fill = generator.bgColor || '#000000';
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, safeWidth, safeHeight);
    }

    function getGeneratorSpeedPerSecond(generator) {
        if (!generator) {
            return 0;
        }
        const cached = generator._speedPerSecond;
        if (Number.isFinite(cached)) {
            return cached;
        }
        const raw = Number(generator.speed);
        return Number.isFinite(raw) ? raw * TARGET_FRAMES_PER_SECOND : 0;
    }

    function getDasdecRotationState() {
        const state = window.__dasdecRotationState;
        return state && typeof state === 'object' ? state : null;
    }

    function stopDasdecRotationState() {
        const state = getDasdecRotationState();
        if (state && typeof state.stop === 'function') {
            state.stop();
        }
        window.__dasdecRotationState = null;
    }

    function pauseDasdecRotationState() {
        const state = getDasdecRotationState();
        if (state && typeof state.pause === 'function') {
            state.pause();
        }
    }

    function resumeDasdecRotationState() {
        const state = getDasdecRotationState();
        if (state && typeof state.resume === 'function') {
            state.resume();
        }
    }

    function stepDasdecRotationState(step) {
        const state = getDasdecRotationState();
        if (state && typeof state.step === 'function') {
            state.step(step);
            return true;
        }
        return false;
    }

    function setProgressBarValue(progressBar, ratio) {
        if (!progressBar) {
            return;
        }
        const normalized = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
        progressBar.value = normalized;
        progressBar.setAttribute('value', normalized);
    }

    const PROGRESS_MINIMUM_STEP = 0.0005;
    const PROGRESS_RATIO_EPSILON = 1e-6;

    function resolveProgressStepRatio(increment) {
        const numeric = Number(increment);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return 0.01;
        }
        const normalized = numeric <= 1 ? numeric : numeric / 100;
        return Math.min(1, Math.max(PROGRESS_MINIMUM_STEP, normalized));
    }

    function resolveProgressFractionDigits(stepRatio) {
        const percentStep = stepRatio * 100;
        if (percentStep >= 1) {
            return 0;
        }
        const digits = Math.ceil(Math.abs(Math.log10(percentStep)));
        return Math.max(1, Math.min(3, digits));
    }

    function formatProgressPercent(ratio, fractionDigits) {
        if (ratio <= 0) {
            return '0%';
        }
        if (ratio >= 1 - PROGRESS_RATIO_EPSILON) {
            return '100%';
        }
        const percent = ratio * 100;
        if (!Number.isFinite(fractionDigits) || fractionDigits <= 0) {
            return `${Math.round(percent)}%`;
        }
        return `${percent.toFixed(fractionDigits)}%`;
    }

    function createExportProgressReporter(label, increment = 0.001) {
        const step = resolveProgressStepRatio(increment);
        const fractionDigits = resolveProgressFractionDigits(step);

        const progressBar = document.getElementById('crawlExportProgress');
        const progressDiv = document.getElementById('crawlExportProgressDiv');
        const progressLabel = document.getElementById('crawlExportProgressLabel');
        const labelDiv = document.querySelector('label[for="crawlExportProgress"]');

        if (!(progressBar && progressDiv && progressLabel)) {
            return () => { };
        }

        if (labelDiv && typeof label === 'string') {
            const span = labelDiv.querySelector('#crawlExportProgressLabel');
            if (span) {
                labelDiv.firstChild && (labelDiv.firstChild.textContent = `${label}: `);
            } else {
                labelDiv.textContent = label;
            }
        }

        setProgressBarValue(progressBar, 0);
        progressDiv.style.display = 'block';
        progressLabel.textContent = '0%';

        let nextThreshold = step;
        return (value) => {
            const raw = Number(value);
            if (!Number.isFinite(raw)) return;

            const ratio = raw <= 1 ? raw : raw / 100;
            const clampedRatio = Math.max(0, Math.min(1, ratio));

            setProgressBarValue(progressBar, clampedRatio);
            if (clampedRatio + PROGRESS_RATIO_EPSILON >= nextThreshold || clampedRatio >= 1 - PROGRESS_RATIO_EPSILON) {
                progressLabel.textContent = formatProgressPercent(clampedRatio, fractionDigits);
                nextThreshold = Math.min(1, clampedRatio + step);
            }
        };
    }

    const crawlExportController = (() => {
        const progressDiv = document.getElementById('crawlExportProgressDiv');
        const progressBar = document.getElementById('crawlExportProgress');
        const progressLabel = document.getElementById('crawlExportProgressLabel');
        const cancelButton = document.getElementById('cancelCrawlExport');
        let activeToken = null;

        const hideProgress = () => {
            if (progressDiv) {
                progressDiv.style.display = 'none';
            }
            setProgressBarValue(progressBar, 0);
            if (progressLabel) {
                progressLabel.textContent = '0%';
            }
        };

        if (cancelButton) {
            cancelButton.disabled = true;
            cancelButton.addEventListener('click', () => {
                if (activeToken && typeof activeToken.cancel === 'function') {
                    activeToken.cancel();
                }
            });
        }
        hideProgress();

        return {
            createToken(onCancel) {
                const token = {
                    cancelled: false,
                    cancel() {
                        if (this.cancelled) {
                            return;
                        }
                        this.cancelled = true;
                        if (cancelButton && activeToken === token) {
                            cancelButton.disabled = true;
                        }
                        if (typeof onCancel === 'function') {
                            try {
                                onCancel();
                            } catch (error) {
                                console.error('Error cancelling crawl export:', error);
                            }
                        }
                    }
                };
                activeToken = token;
                if (cancelButton) {
                    cancelButton.disabled = typeof onCancel !== 'function';
                }
                return token;
            },
            clear(token) {
                if (token && token !== activeToken) {
                    return;
                }
                activeToken = null;
                if (cancelButton) {
                    cancelButton.disabled = true;
                }
                hideProgress();
            },
            isCancelled(token) {
                return Boolean(token && token.cancelled);
            }
        };
    })();

    function exportAsGIF(canvas, filename) {
        if (!window.crawlGenerator) {
            alert('Please start the crawl before exporting.');
            return;
        }

        addStatus('Exporting crawl as GIF... Please wait.');
        const startTime = performance.now();
        const generator = window.crawlGenerator;

        const isNative = Boolean(window.Capacitor?.isNativePlatform?.());

        const NATIVE_MAX_W = 1280;
        const NATIVE_MAX_H = 720;

        function chooseGifDimensions(srcW, srcH) {
            if (!isNative) return { w: srcW, h: srcH };

            const scale = Math.min(1, NATIVE_MAX_W / srcW, NATIVE_MAX_H / srcH);
            return { w: Math.max(1, Math.round(srcW * scale)), h: Math.max(1, Math.round(srcH * scale)) };
        }

        function createNoopProgress() { return () => { }; }

        function safeCreateProgress(label, increment = 0.001) {
            const reporter = createExportProgressReporter(label, increment);
            return (typeof reporter === 'function') ? reporter : createNoopProgress();
        }

        function setProgressLabelPrefix(label) {
            const labelEl = document.querySelector('label[for="crawlExportProgress"]');
            const pctSpan = document.getElementById('crawlExportProgressLabel');
            if (!labelEl || !pctSpan || typeof label !== 'string') return;

            const nodes = Array.from(labelEl.childNodes);
            const firstTextNode = nodes.find(n => n.nodeType === Node.TEXT_NODE);
            if (firstTextNode) {
                firstTextNode.textContent = `${label}: `;
            } else {
                labelEl.insertBefore(document.createTextNode(`${label}: `), pctSpan);
            }
        }

        async function yieldToUI() {
            await new Promise(requestAnimationFrame);
        }

        let tearDownCaptureCanvas = () => { };
        const captureCanvas = document.createElement('canvas');

        const dims = chooseGifDimensions(canvas.width, canvas.height);
        captureCanvas.width = dims.w;
        captureCanvas.height = dims.h;

        captureCanvas.style.position = 'fixed';
        captureCanvas.style.pointerEvents = 'none';
        captureCanvas.style.opacity = '0';
        captureCanvas.style.left = '-10000px';
        captureCanvas.style.top = '-10000px';
        document.body.appendChild(captureCanvas);

        tearDownCaptureCanvas = () => {
            if (captureCanvas && captureCanvas.parentNode) {
                captureCanvas.parentNode.removeChild(captureCanvas);
            }
        };

        const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });

        const text = generator.text || '';
        const fontSize = Number(generator.fontSize) || 24;
        const textColor = generator.textColor || '#FFFFFF';
        const lines = text.split('\n');
        const useVdsMode = Boolean(generator.vdsMode);
        const fontStyle = generator.fontStyle || 'normal';
        const fontFamily = generator.fontFamily || 'Arial';
        const sanitizedFontFamily = /[^a-zA-Z0-9_-]/.test(fontFamily)
            ? `"${fontFamily.replace(/(["\\])/g, '\\$1')}"`
            : fontFamily;

        const scaleX = captureCanvas.width / canvas.width;
        const scaleY = captureCanvas.height / canvas.height;
        const scale = Math.min(scaleX, scaleY);
        const scaledFontSize = Math.max(8, Math.round(fontSize * scale));
        const font = `${fontStyle} ${scaledFontSize}px ${sanitizedFontFamily}`;
        const lineHeight = scaledFontSize + Math.round(10 * scale);

        captureCtx.font = font;
        captureCtx.textAlign = useVdsMode ? 'left' : 'center';
        captureCtx.textBaseline = 'middle';
        captureCtx.lineJoin = generator.outlineJoin || 'round';

        const kerningPercent = Number(generator.kerningPercent) || 0;
        if (kerningPercent) {
            const kerningPx = (kerningPercent / 100) * scaledFontSize;
            captureCtx.letterSpacing = `${kerningPx}px`;
        }

        const outlineWidth = Number(generator.outlineWidth);
        const scaledOutlineWidth = Number.isFinite(outlineWidth) ? Math.max(1, Math.round(outlineWidth * scale)) : undefined;
        const renderText = createTextRenderer(captureCtx, generator.outlineColor, scaledOutlineWidth);

        const vdsState = useVdsMode ? createVdsExportState(captureCtx, lines) : null;

        const maxLineWidth = lines.reduce((maxWidth, line) => {
            const width = captureCtx.measureText(line).width;
            return width > maxWidth ? width : maxWidth;
        }, 0);

        const translation = (typeof generator._computeTopLeftTranslation === 'function')
            ? generator._computeTopLeftTranslation(maxLineWidth, lines.length)
            : { x: 0, y: 0 };

        const translationX = Number.isFinite(translation.x) ? translation.x * scaleX : 0;
        const translationY = Number.isFinite(translation.y) ? translation.y * scaleY : 0;

        const bounds = (typeof generator._computeCrawlBounds === 'function')
            ? generator._computeCrawlBounds(maxLineWidth)
            : null;

        const insetRaw = bounds ? bounds.inset : 0;
        const inset = Math.max(0, Math.round(insetRaw * scaleX));

        const halfLineWidth = maxLineWidth / 2;
        const startOffsetFallback = canvas.width + halfLineWidth;
        const endOffsetFallback = -halfLineWidth;
        const startOffset = bounds && Number.isFinite(bounds.start) ? bounds.start : startOffsetFallback;
        const endOffset = bounds && Number.isFinite(bounds.end) ? bounds.end : endOffsetFallback;

        const adjustedStartOffset = (startOffset - (Number.isFinite(translation.x) ? translation.x : 0)) * scaleX;
        const adjustedEndOffset = (endOffset - (Number.isFinite(translation.x) ? translation.x : 0)) * scaleX;
        const travelDistance = adjustedStartOffset - adjustedEndOffset || captureCanvas.width;

        const recordedMsPerFrame = Number(generator.msPerFrame);
        const fallbackMsPerFrame = TARGET_FRAME_MS;
        const targetMsPerFrame = (Number.isFinite(recordedMsPerFrame) && recordedMsPerFrame > 0)
            ? recordedMsPerFrame
            : fallbackMsPerFrame;

        const MIN_GIF_DELAY = 20;
        const frameDelay = Math.max(MIN_GIF_DELAY, Math.round(targetMsPerFrame));

        const speedPerSecond = getGeneratorSpeedPerSecond(generator);
        const pxPerSecond = Math.max(0.5, Math.abs(speedPerSecond));
        const pxPerFrameMagnitude = (pxPerSecond * (frameDelay / 1000)) * scaleX;
        const pxPerFrameSigned = speedPerSecond >= 0 ? pxPerFrameMagnitude : -pxPerFrameMagnitude;

        const defaultVdsDelay = (Number.isFinite(generator.vdsBaseDelayFrames) && generator.vdsBaseDelayFrames > 0)
            ? generator.vdsBaseDelayFrames
            : DEFAULT_VDS_BASE_DELAY;

        const vdsDelay = useVdsMode && typeof generator.getEffectiveVdsDelay === 'function'
            ? generator.getEffectiveVdsDelay(pxPerFrameMagnitude)
            : defaultVdsDelay;

        let framesNeeded = Math.max(1, Math.ceil(travelDistance / Math.max(pxPerFrameMagnitude, 0.01)));

        const rawRepetitionInput = (typeof generator.crawlRepetitions !== 'undefined')
            ? Number(generator.crawlRepetitions)
            : Number(generator.repetitions);

        const repetitions = Math.max(1, Math.min(10, Math.round(rawRepetitionInput || 0)));
        const gifRepeat = repetitions <= 1 ? -1 : repetitions - 1;

        const gifWorkers = isNative ? 1 : 5;

        const gif = new GIF({
            workers: gifWorkers,
            quality: 4,
            repeat: gifRepeat
        });

        let userCancelledGifExport = false;
        const gifCancelToken = crawlExportController.createToken(() => {
            userCancelledGifExport = true;
            if (gif && typeof gif.abort === 'function') {
                gif.abort();
            } else {
                crawlExportController.clear(gifCancelToken);
                addStatus('GIF export canceled.', 'WARN');
            }
        });

        const clipWidth = captureCanvas.width - inset * 2;
        const shouldClip = inset > 0 && clipWidth > 0;

        const restartDelayMs = Number(generator.crawlRestartDelay);
        const restartDelayFrames = (Number.isFinite(restartDelayMs) && restartDelayMs > 0)
            ? Math.max(1, Math.round(restartDelayMs / frameDelay))
            : 0;

        const framesPerCycle = framesNeeded + restartDelayFrames;
        let totalFrames = framesPerCycle * repetitions;

        const dasdecBackground = window.__dasdecBackground;
        const dasdecPages = dasdecBackground && Array.isArray(dasdecBackground.pages) ? dasdecBackground.pages : null;
        const dasdecRotationDelay = dasdecBackground && Number.isFinite(dasdecBackground.rotationDelayMs)
            ? dasdecBackground.rotationDelayMs
            : null;

        const dasdecRepetitionOverride = dasdecBackground && Number.isFinite(dasdecBackground.repetitions)
            ? Math.max(1, Math.min(10, Math.round(dasdecBackground.repetitions)))
            : repetitions;

        const dasdecTotalDisplays = (dasdecPages && dasdecPages.length && dasdecRotationDelay)
            ? Math.max(1, Number(dasdecBackground.totalDisplays) || (dasdecRepetitionOverride * dasdecPages.length))
            : 0;

        const dasdecFramesPerPage = dasdecRotationDelay
            ? Math.max(1, Math.round(dasdecRotationDelay / frameDelay))
            : null;

        const getDasdecPageForFrame = (dasdecPages && dasdecFramesPerPage)
            ? (frameIndex) => {
                const displayIndex = Math.min(
                    dasdecTotalDisplays - 1,
                    Math.floor(frameIndex / dasdecFramesPerPage)
                );
                return dasdecPages[displayIndex % dasdecPages.length];
            }
            : null;

        if (getDasdecPageForFrame) {
            totalFrames = dasdecTotalDisplays * dasdecFramesPerPage;
        }

        const captureProgressPortion = 0.5;
        const reportCaptureProgress = safeCreateProgress('GIF export');
        const reportSaveProgress = safeCreateProgress('GIF save');

        let showTime = localStorage["showTime"];

        const clearFrame = (frameIndex = 0) => {
            captureCtx.save();
            captureCtx.setTransform(1, 0, 0, 1, 0, 0);
            captureCtx.globalAlpha = 1;
            captureCtx.globalCompositeOperation = 'copy';

            let drewCustomBackground = false;
            if (getDasdecPageForFrame) {
                const dasdecPage = getDasdecPageForFrame(frameIndex);
                if (dasdecPage) {
                    captureCtx.drawImage(dasdecPage, 0, 0, captureCanvas.width, captureCanvas.height);
                    drewCustomBackground = true;
                }
            }
            if (!drewCustomBackground) {
                drawGeneratorBackground(captureCtx, generator, captureCanvas.width, captureCanvas.height);
            }

            captureCtx.restore();
            captureCtx.globalCompositeOperation = 'source-over';
        };

        const drawFrame = (offsetX, frameIndex) => {
            clearFrame(frameIndex);
            captureCtx.fillStyle = textColor;
            captureCtx.font = font;

            const translatedOffsetX = offsetX + translationX;
            const centerY = captureCanvas.height / 2 + translationY;

            if (shouldClip) {
                captureCtx.save();
                captureCtx.beginPath();
                captureCtx.rect(inset, 0, clipWidth, captureCanvas.height);
                captureCtx.clip();
            }

            if (useVdsMode) {
                updateVdsExportState(
                    vdsState,
                    translatedOffsetX,
                    Math.max(0, captureCanvas.width - inset * 2),
                    vdsDelay,
                    inset
                );
                drawVdsExportFrame(
                    captureCtx,
                    vdsState,
                    translatedOffsetX,
                    centerY,
                    scaledFontSize,
                    renderText
                );
            } else {
                lines.forEach((line, index) => {
                    const verticalOffset = index - (lines.length - 1) / 2;
                    const y = centerY + verticalOffset * lineHeight;
                    renderText(line, translatedOffsetX, y);
                });
            }

            if (shouldClip) {
                captureCtx.restore();
            }
        };

        resetVdsExportState(vdsState);
        let offsetX = adjustedStartOffset;
        let delayFramesRemaining = 0;

        setProgressLabelPrefix('GIF export');
        reportCaptureProgress(0);

        (async () => {
            try {
                for (let i = 0; i < totalFrames; i++) {
                    if (userCancelledGifExport || crawlExportController.isCancelled(gifCancelToken)) {
                        throw new Error('CANCELLED');
                    }

                    drawFrame(offsetX, i);

                    gif.addFrame(captureCanvas, { delay: frameDelay, copy: true });

                    reportCaptureProgress(((i + 1) / totalFrames) * captureProgressPortion);

                    if (isNative && (i % 10 === 0)) {
                        await yieldToUI();
                    }

                    if (delayFramesRemaining > 0) {
                        delayFramesRemaining--;
                        if (delayFramesRemaining === 0) {
                            offsetX = adjustedStartOffset;
                            resetVdsExportState(vdsState);
                        }
                        continue;
                    }

                    offsetX -= pxPerFrameSigned;

                    if ((pxPerFrameSigned >= 0 && offsetX < adjustedEndOffset) ||
                        (pxPerFrameSigned < 0 && offsetX > adjustedEndOffset)) {
                        if (restartDelayFrames > 0) {
                            offsetX = adjustedEndOffset;
                            delayFramesRemaining = restartDelayFrames;
                        } else {
                            offsetX = adjustedStartOffset;
                            resetVdsExportState(vdsState);
                        }
                    }
                }

                gif.on('progress', function (progress) {
                    const clampedProgress = Math.max(0, Math.min(0.999, progress));
                    const remainingPortion = 1 - captureProgressPortion;
                    reportCaptureProgress(captureProgressPortion + clampedProgress * remainingPortion);
                });

                gif.on('abort', function () {
                    const wasUserCancelled = userCancelledGifExport || crawlExportController.isCancelled(gifCancelToken);
                    crawlExportController.clear(gifCancelToken);
                    tearDownCaptureCanvas();
                    try { gif.frames.length = 0; gif.imageParts.length = 0; } catch(_) {}
                    addStatus(
                        wasUserCancelled ? 'GIF export canceled.' : 'GIF export aborted unexpectedly.',
                        wasUserCancelled ? 'WARN' : 'ERROR'
                    );
                });

                gif.on('finished', async function (blob) {
                    try {
                        const wasCancelled = crawlExportController.isCancelled(gifCancelToken);
                        if (wasCancelled) {
                            crawlExportController.clear(gifCancelToken);
                            tearDownCaptureCanvas();
                            return;
                        }

                        setProgressLabelPrefix('GIF save');
                        reportSaveProgress(0);

                        await saveFile(filename, blob, 'image/gif', {
                            onProgress: (ratio) => reportSaveProgress(ratio),
                            isCancelled: () => crawlExportController.isCancelled(gifCancelToken),
                        });

                        crawlExportController.clear(gifCancelToken);
                        reportSaveProgress(1);

                        addStatus(
                            'Crawl exported successfully!' +
                            (showTime ? ` (Took: ${((performance.now() - startTime) / 1000).toFixed(2)} seconds)` : ''),
                            'SUCCESS'
                        );
                    } catch (e) {
                        const cancelled = String(e?.message || e).includes('CANCELLED') ||
                            crawlExportController.isCancelled(gifCancelToken);

                        crawlExportController.clear(gifCancelToken);

                        if (cancelled) {
                            addStatus('GIF export canceled during save.', 'WARN');
                        } else {
                            console.error('GIF save failed:', e);
                            addStatus(`GIF save failed: ${e?.message || e}`, 'ERROR');
                        }
                    } finally {
                        tearDownCaptureCanvas();
                        try { gif.frames.length = 0; gif.imageParts.length = 0; } catch(_) {}
                    }
                });

                gif.render();
            } catch (e) {
                const cancelled = String(e?.message || e).includes('CANCELLED') ||
                    userCancelledGifExport ||
                    crawlExportController.isCancelled(gifCancelToken);

                crawlExportController.clear(gifCancelToken);
                tearDownCaptureCanvas();

                if (cancelled) {
                    addStatus('GIF export canceled.', 'WARN');
                } else {
                    console.error('GIF export failed:', e);
                    addStatus(`GIF export failed: ${e?.message || e}`, 'ERROR');
                }
            }
        })();
    }

    async function exportAsWebM(canvas, filename) {
        if (!window.crawlGenerator) {
            alert('Please start the crawl before exporting.');
            return;
        }

        addStatus('Exporting crawl as video... Please wait.');
        const startTime = performance.now();

        const generator = window.crawlGenerator;
        let tearDownCaptureCanvas = () => { };
        const captureCanvas = document.createElement('canvas');
        captureCanvas.width = canvas.width;
        captureCanvas.height = canvas.height;
        captureCanvas.style.position = 'fixed';
        captureCanvas.style.pointerEvents = 'none';
        captureCanvas.style.opacity = '0';
        captureCanvas.style.left = '-10000px';
        captureCanvas.style.top = '-10000px';
        document.body.appendChild(captureCanvas);
        tearDownCaptureCanvas = () => {
            if (captureCanvas && captureCanvas.parentNode) {
                captureCanvas.parentNode.removeChild(captureCanvas);
            }
        };
        const captureCtx = captureCanvas.getContext('2d');

        const text = generator.text || '';
        const fontSize = Number(generator.fontSize) || 24;
        const textColor = generator.textColor || '#FFFFFF';
        const lines = text.split('\n');
        const useVdsMode = Boolean(generator.vdsMode);
        const fontStyle = generator.fontStyle || 'normal';
        const fontFamily = generator.fontFamily || 'Arial';
        const sanitizedFontFamily = /[^a-zA-Z0-9_-]/.test(fontFamily)
            ? `"${fontFamily.replace(/(["\\])/g, '\\$1')}"`
            : fontFamily;
        const font = `${fontStyle} ${fontSize}px ${sanitizedFontFamily}`;
        const lineHeight = fontSize + 10;

        captureCtx.font = font;
        captureCtx.textAlign = useVdsMode ? 'left' : 'center';
        captureCtx.textBaseline = 'middle';
        captureCtx.lineJoin = generator.outlineJoin || 'round';

        const kerningPercent = Number(generator.kerningPercent) || 0;
        if (kerningPercent) {
            const kerningPx = (kerningPercent / 100) * fontSize;
            captureCtx.letterSpacing = `${kerningPx}px`;
        }

        const renderText = createTextRenderer(captureCtx, generator.outlineColor, generator.outlineWidth);
        const vdsState = useVdsMode ? createVdsExportState(captureCtx, lines) : null;

        const maxLineWidth = lines.reduce((maxWidth, line) => {
            const width = captureCtx.measureText(line).width;
            return width > maxWidth ? width : maxWidth;
        }, 0);
        const translation = (typeof generator._computeTopLeftTranslation === 'function')
            ? generator._computeTopLeftTranslation(maxLineWidth, lines.length)
            : { x: 0, y: 0 };
        const translationX = Number.isFinite(translation.x) ? translation.x : 0;
        const translationY = Number.isFinite(translation.y) ? translation.y : 0;

        const bounds = typeof generator._computeCrawlBounds === 'function'
            ? generator._computeCrawlBounds(maxLineWidth)
            : null;
        const inset = bounds ? bounds.inset : 0;
        const halfLineWidth = maxLineWidth / 2;
        const startOffsetFallback = canvas.width + halfLineWidth;
        const endOffsetFallback = -halfLineWidth;
        const startOffset = bounds && Number.isFinite(bounds.start) ? bounds.start : startOffsetFallback;
        const endOffset = bounds && Number.isFinite(bounds.end) ? bounds.end : endOffsetFallback;
        const adjustedStartOffset = startOffset - translationX;
        const adjustedEndOffset = endOffset - translationX;
        const travelDistance = adjustedStartOffset - adjustedEndOffset || canvas.width;

        const recordedMsPerFrame = Number(generator.msPerFrame);
        const fallbackMsPerFrame = TARGET_FRAME_MS;
        const targetMsPerFrame = (Number.isFinite(recordedMsPerFrame) && recordedMsPerFrame > 0)
            ? recordedMsPerFrame
            : fallbackMsPerFrame;
        const MAX_CAPTURE_FPS = 60;
        const captureFrameDelay = 1000 / MAX_CAPTURE_FPS;
        const frameDelay = Math.max(1, Math.max(targetMsPerFrame, captureFrameDelay));
        const speedPerSecond = getGeneratorSpeedPerSecond(generator);
        const pxPerSecond = Math.max(0.5, Math.abs(speedPerSecond));
        const pxPerFrameMagnitude = pxPerSecond * (frameDelay / 1000);
        const pxPerFrameSigned = speedPerSecond >= 0 ? pxPerFrameMagnitude : -pxPerFrameMagnitude;
        const defaultVdsDelay = (Number.isFinite(generator.vdsBaseDelayFrames) && generator.vdsBaseDelayFrames > 0)
            ? generator.vdsBaseDelayFrames
            : DEFAULT_VDS_BASE_DELAY;
        const vdsDelay = useVdsMode && typeof generator.getEffectiveVdsDelay === 'function'
            ? generator.getEffectiveVdsDelay(pxPerFrameMagnitude)
            : defaultVdsDelay;
        let framesNeeded = Math.max(1, Math.ceil(travelDistance / Math.max(pxPerFrameMagnitude, 0.01)));
        const restartDelayMs = Number(generator.crawlRestartDelay);
        const restartDelayFrames = (Number.isFinite(restartDelayMs) && restartDelayMs > 0)
            ? Math.max(1, Math.round(restartDelayMs / frameDelay))
            : 0;
        const rawRepetitionInput = (typeof generator.crawlRepetitions !== 'undefined')
            ? Number(generator.crawlRepetitions)
            : Number(generator.repetitions);
        const repetitions = Math.max(1, Math.min(10, Math.round(rawRepetitionInput || 0)));
        const framesPerCycle = framesNeeded + restartDelayFrames;
        let totalFrames = framesPerCycle * repetitions;
        const dasdecBackground = window.__dasdecBackground;
        const dasdecPages = dasdecBackground && Array.isArray(dasdecBackground.pages) ? dasdecBackground.pages : null;
        const dasdecRotationDelay = dasdecBackground && Number.isFinite(dasdecBackground.rotationDelayMs)
            ? dasdecBackground.rotationDelayMs
            : null;
        const dasdecRepetitionOverride = dasdecBackground && Number.isFinite(dasdecBackground.repetitions)
            ? Math.max(1, Math.min(10, Math.round(dasdecBackground.repetitions)))
            : repetitions;
        const dasdecTotalDisplays = dasdecPages && dasdecPages.length && dasdecRotationDelay
            ? Math.max(1, Number(dasdecBackground.totalDisplays) || (dasdecRepetitionOverride * dasdecPages.length))
            : 0;
        const dasdecFramesPerPage = dasdecRotationDelay
            ? Math.max(1, Math.round(dasdecRotationDelay / frameDelay))
            : null;
        const getDasdecPageForFrame = dasdecPages && dasdecFramesPerPage
            ? (frameIndex) => {
                const displayIndex = Math.min(
                    dasdecTotalDisplays - 1,
                    Math.floor(frameIndex / dasdecFramesPerPage)
                );
                return dasdecPages[displayIndex % dasdecPages.length];
            }
            : null;
        if (getDasdecPageForFrame) {
            totalFrames = dasdecTotalDisplays * dasdecFramesPerPage;
        }

        const clipWidth = captureCanvas.width - inset * 2;
        const shouldClip = inset > 0 && clipWidth > 0;
        let delayFramesRemaining = 0;
        let reportProgress = createExportProgressReporter('WebM export');
        const encodeProgressPortion = Math.min(0.1, 1 / Math.max(1, totalFrames));
        const captureProgressPortion = Math.max(0, 1 - encodeProgressPortion);

        let showTime = localStorage["showTime"];
        const isTransparentBackground = Boolean(
            generator._transparentBg ||
            (typeof generator._isTransparentColor === 'function' && generator._isTransparentColor(generator.bgColor))
        );
        const hasGeneratorMedia = Boolean(generator.bgVideo || generator.bgImage);
        const shouldDrawGeneratorBackground = !isTransparentBackground || hasGeneratorMedia;
        const wantsTransparentOutput = isTransparentBackground && !hasGeneratorMedia && !getDasdecPageForFrame;

        const clearFrameOpaque = (frameIndex = 0) => {
            captureCtx.save();
            captureCtx.setTransform(1, 0, 0, 1, 0, 0);
            captureCtx.globalAlpha = 1;
            captureCtx.globalCompositeOperation = 'source-over';
            captureCtx.fillStyle = '#000000';
            captureCtx.fillRect(0, 0, captureCanvas.width, captureCanvas.height);
            let drewCustomBackground = false;
            if (getDasdecPageForFrame) {
                const dasdecPage = getDasdecPageForFrame(frameIndex);
                if (dasdecPage) {
                    captureCtx.drawImage(dasdecPage, 0, 0, captureCanvas.width, captureCanvas.height);
                    drewCustomBackground = true;
                }
            }
            if (!drewCustomBackground && shouldDrawGeneratorBackground) {
                drawGeneratorBackground(captureCtx, generator, captureCanvas.width, captureCanvas.height);
            }
            captureCtx.restore();
            captureCtx.globalCompositeOperation = 'source-over';
        };

        const clearFrameTransparent = (frameIndex = 0) => {
            captureCtx.save();
            captureCtx.setTransform(1, 0, 0, 1, 0, 0);
            captureCtx.globalAlpha = 1;
            captureCtx.globalCompositeOperation = 'copy';
            captureCtx.fillStyle = 'rgba(0, 0, 0, 0)';
            captureCtx.fillRect(0, 0, captureCanvas.width, captureCanvas.height);
            let drewCustomBackground = false;
            if (getDasdecPageForFrame) {
                const dasdecPage = getDasdecPageForFrame(frameIndex);
                if (dasdecPage) {
                    captureCtx.drawImage(dasdecPage, 0, 0, captureCanvas.width, captureCanvas.height);
                    drewCustomBackground = true;
                }
            }
            if (!drewCustomBackground && shouldDrawGeneratorBackground) {
                drawGeneratorBackground(captureCtx, generator, captureCanvas.width, captureCanvas.height);
            }
            captureCtx.restore();
            captureCtx.globalCompositeOperation = 'source-over';
        };

        const drawFrameWithClear = (offsetX, frameIndex, clearFn) => {
            clearFn(frameIndex);
            captureCtx.fillStyle = textColor;
            captureCtx.font = font;

            const translatedOffsetX = offsetX + translationX;
            const centerY = captureCanvas.height / 2 + translationY;

            if (shouldClip) {
                captureCtx.save();
                captureCtx.beginPath();
                captureCtx.rect(inset, 0, clipWidth, captureCanvas.height);
                captureCtx.clip();
            }

            if (useVdsMode) {
                updateVdsExportState(
                    vdsState,
                    translatedOffsetX,
                    Math.max(0, captureCanvas.width - inset * 2),
                    vdsDelay,
                    inset
                );
                drawVdsExportFrame(
                    captureCtx,
                    vdsState,
                    translatedOffsetX,
                    centerY,
                    fontSize,
                    renderText
                );
            } else {
                lines.forEach((line, index) => {
                    const verticalOffset = index - (lines.length - 1) / 2;
                    const y = centerY + verticalOffset * lineHeight;
                    renderText(line, translatedOffsetX, y);
                });
            }

            if (shouldClip) {
                captureCtx.restore();
            }
        };

        const drawFrame = (offsetX, frameIndex) => drawFrameWithClear(offsetX, frameIndex, clearFrameOpaque);
        const drawFrameTransparent = (offsetX, frameIndex) => drawFrameWithClear(offsetX, frameIndex, clearFrameTransparent);

        const captureFps = Math.max(1, Math.min(120, Math.round(1000 / frameDelay)));
        const estimatedBitrate = Math.floor(captureCanvas.width * captureCanvas.height * captureFps * 0.3);
        const videoBitsPerSecond = Math.max(2_000_000, Math.min(25_000_000, estimatedBitrate));
        const normalizedQuality = Math.max(0, Math.min(1, (videoBitsPerSecond - 2_000_000) / 23_000_000));
        const MIN_CAPTURE_QUALITY = 0.6;
        const MAX_CAPTURE_QUALITY = 0.95;
        const captureQuality = Math.max(
            MIN_CAPTURE_QUALITY,
            Math.min(MAX_CAPTURE_QUALITY, MIN_CAPTURE_QUALITY + normalizedQuality * (MAX_CAPTURE_QUALITY - MIN_CAPTURE_QUALITY))
        );
        const downloadName = (typeof filename === 'string' && filename.toLowerCase().endsWith('.webm'))
            ? filename.slice(0, -5)
            : filename || 'crawl';
        const canUseWebCodecs = wantsTransparentOutput
            && typeof VideoEncoder === 'function'
            && typeof VideoFrame === 'function';
        const canUseMediaRecorder = wantsTransparentOutput &&
            typeof MediaRecorder === 'function' &&
            typeof captureCanvas.captureStream === 'function';

        const getWebCodecsConfig = async () => {
            if (!canUseWebCodecs || typeof VideoEncoder.isConfigSupported !== 'function') {
                return null;
            }
            const baseConfig = {
                codec: 'vp09.00.10.08',
                width: captureCanvas.width,
                height: captureCanvas.height,
                bitrate: videoBitsPerSecond,
                framerate: captureFps,
                alpha: 'keep',
                hardwareAcceleration: 'prefer-hardware'
            };
            try {
                const support = await VideoEncoder.isConfigSupported(baseConfig);
                if (support && support.supported) {
                    const resolved = support.config || baseConfig;
                    if (resolved.alpha && resolved.alpha !== 'keep') {
                        return null;
                    }
                    resolved.alpha = 'keep';
                    return resolved;
                }
            } catch (error) { /* ignore */ }
            return null;
        };

        const createWebMMuxer = (options) => {
            const codec = options && options.codec ? options.codec : 'vp09.00.10.08';
            const codecId = codec.startsWith('vp08') ? 'V_VP8' : 'V_VP9';
            const codecName = codecId === 'V_VP8' ? 'VP8' : 'VP9';
            const trackNumberByte = 0x81;
            const maxClusterDurationMs = 5000;
            const chunks = [];
            const encodeString = (value) => {
                const str = String(value || '');
                const bytes = new Uint8Array(str.length);
                for (let i = 0; i < str.length; i++) {
                    bytes[i] = str.charCodeAt(i) & 0xff;
                }
                return bytes;
            };
            const encodeUint = (value) => {
                let val = Math.max(0, Math.floor(Number(value) || 0));
                const bytes = [];
                do {
                    bytes.unshift(val & 0xff);
                    val = Math.floor(val / 256);
                } while (val > 0);
                return new Uint8Array(bytes);
            };
            const encodeId = (id) => {
                let val = Number(id);
                const bytes = [];
                while (val > 0) {
                    bytes.unshift(val & 0xff);
                    val = Math.floor(val / 256);
                }
                return new Uint8Array(bytes.length ? bytes : [0]);
            };
            const encodeVint = (value) => {
                const val = Math.max(0, Math.floor(Number(value) || 0));
                if (val < 0x7f) {
                    return new Uint8Array([0x80 | val]);
                }
                if (val < 0x3fff) {
                    return new Uint8Array([0x40 | (val >> 8), val & 0xff]);
                }
                if (val < 0x1fffff) {
                    return new Uint8Array([0x20 | (val >> 16), (val >> 8) & 0xff, val & 0xff]);
                }
                if (val < 0x0fffffff) {
                    return new Uint8Array([0x10 | (val >> 24), (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff]);
                }
                return new Uint8Array([
                    0x08 | ((val / 4294967296) & 0x07),
                    (val >> 24) & 0xff,
                    (val >> 16) & 0xff,
                    (val >> 8) & 0xff,
                    val & 0xff
                ]);
            };
            const concatBuffers = (buffers) => {
                const total = buffers.reduce((sum, buf) => sum + buf.length, 0);
                const out = new Uint8Array(total);
                let offset = 0;
                buffers.forEach((buf) => {
                    out.set(buf, offset);
                    offset += buf.length;
                });
                return out;
            };
            const makeElement = (id, data) => {
                let payload;
                if (Array.isArray(data)) {
                    payload = concatBuffers(data);
                } else if (data instanceof Uint8Array) {
                    payload = data;
                } else if (typeof data === 'string') {
                    payload = encodeString(data);
                } else if (typeof data === 'number') {
                    payload = encodeUint(data);
                } else {
                    payload = new Uint8Array();
                }
                return concatBuffers([encodeId(id), encodeVint(payload.length), payload]);
            };
            const makeSimpleBlock = (timecode, isKeyframe, frameData) => {
                const payload = new Uint8Array(4 + frameData.length);
                payload[0] = trackNumberByte;
                payload[1] = (timecode >> 8) & 0xff;
                payload[2] = timecode & 0xff;
                payload[3] = isKeyframe ? 0x80 : 0x00;
                payload.set(frameData, 4);
                return makeElement(0xa3, payload);
            };

            const ebmlHeader = makeElement(0x1a45dfa3, [
                makeElement(0x4286, 1),
                makeElement(0x42f7, 1),
                makeElement(0x42f2, 4),
                makeElement(0x42f3, 8),
                makeElement(0x4282, 'webm'),
                makeElement(0x4287, 2),
                makeElement(0x4285, 2)
            ]);

            const segmentHeader = concatBuffers([encodeId(0x18538067), new Uint8Array([0xff])]);
            const info = makeElement(0x1549a966, [
                makeElement(0x2ad7b1, 1000000),
                makeElement(0x4d80, 'eas-tools'),
                makeElement(0x5741, 'eas-tools')
            ]);
            const videoElements = [
                makeElement(0xb0, captureCanvas.width),
                makeElement(0xba, captureCanvas.height),
                makeElement(0x53c0, 1)
            ];
            const trackEntry = makeElement(0xae, [
                makeElement(0xd7, 1),
                makeElement(0x73c5, 1),
                makeElement(0x9c, 0),
                makeElement(0x22b59c, 'und'),
                makeElement(0x86, codecId),
                makeElement(0x258688, codecName),
                makeElement(0x83, 1),
                makeElement(0xe0, videoElements)
            ]);
            const tracks = makeElement(0x1654ae6b, [trackEntry]);

            chunks.push(ebmlHeader, segmentHeader, info, tracks);

            let clusterStartMs = null;
            let clusterBlocks = [];

            const flushCluster = () => {
                if (!clusterBlocks.length || clusterStartMs === null) {
                    return;
                }
                const clusterTimecode = makeElement(0xe7, clusterStartMs);
                const clusterData = concatBuffers([clusterTimecode, ...clusterBlocks]);
                const cluster = makeElement(0x1f43b675, clusterData);
                chunks.push(cluster);
                clusterBlocks = [];
                clusterStartMs = null;
            };

            return {
                addChunk(chunk, fallbackDurationMs) {
                    const timestampMs = Math.round((chunk.timestamp || 0) / 1000);
                    const durationMs = chunk.duration
                        ? Math.round(chunk.duration / 1000)
                        : Math.max(1, Math.round(Number(fallbackDurationMs) || 1));
                    if (clusterStartMs === null) {
                        clusterStartMs = timestampMs;
                    }
                    let timecode = timestampMs - clusterStartMs;
                    if (timecode < 0 || timecode > 32767 || timecode >= maxClusterDurationMs) {
                        flushCluster();
                        clusterStartMs = timestampMs;
                        timecode = 0;
                    }
                    const frameData = new Uint8Array(chunk.byteLength);
                    chunk.copyTo(frameData);
                    clusterBlocks.push(makeSimpleBlock(timecode, chunk.type === 'key', frameData));
                    if (timecode + durationMs >= maxClusterDurationMs) {
                        flushCluster();
                    }
                },
                finalize() {
                    flushCluster();
                    return new Blob(chunks, { type: 'video/webm' });
                }
            };
        };

        const exportWithWebCodecs = async (forcedConfig) => {
            if (!canUseWebCodecs) {
                return false;
            }
            const config = forcedConfig || await getWebCodecsConfig();
            if (!config) {
                return false;
            }
            let captureCancelled = false;
            const webmCancelToken = crawlExportController.createToken(() => {
                captureCancelled = true;
            });
            let encoder;
            let encodeError = null;
            try {
                const muxer = createWebMMuxer({ codec: config.codec });
                encoder = new VideoEncoder({
                    output: (chunk) => {
                        muxer.addChunk(chunk, frameDelay);
                    },
                    error: (error) => {
                        encodeError = error;
                    }
                });
                encoder.configure(config);

                resetVdsExportState(vdsState);
                let offsetX = adjustedStartOffset;
                let delayFramesRemaining = 0;
                const keyframeInterval = Math.max(1, Math.round(captureFps));
                const FRAMES_PER_YIELD = Math.max(10, Math.round(240 / Math.max(1, captureFps)));
                const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

                reportProgress(0);

                for (let i = 0; i < totalFrames; i++) {
                    if (captureCancelled || crawlExportController.isCancelled(webmCancelToken)) {
                        captureCancelled = true;
                        break;
                    }
                    drawFrameTransparent(offsetX, i);
                    const timestampUs = Math.round(i * frameDelay * 1000);
                    const frame = new VideoFrame(captureCanvas, { timestamp: timestampUs, alpha: 'keep' });
                    encoder.encode(frame, { keyFrame: i % keyframeInterval === 0 });
                    frame.close();
                    reportProgress((i + 1) / totalFrames);
                    if (encodeError) {
                        throw encodeError;
                    }

                    if (delayFramesRemaining > 0) {
                        delayFramesRemaining--;
                        if (delayFramesRemaining === 0) {
                            offsetX = adjustedStartOffset;
                            resetVdsExportState(vdsState);
                        }
                    } else {
                        offsetX -= pxPerFrameSigned;
                        if ((pxPerFrameSigned >= 0 && offsetX < adjustedEndOffset) ||
                            (pxPerFrameSigned < 0 && offsetX > adjustedEndOffset)) {
                            if (restartDelayFrames > 0) {
                                offsetX = adjustedEndOffset;
                                delayFramesRemaining = restartDelayFrames;
                            } else {
                                offsetX = adjustedStartOffset;
                                resetVdsExportState(vdsState);
                            }
                        }
                    }

                    if ((i + 1) % FRAMES_PER_YIELD === 0) {
                        await yieldToBrowser();
                        if (captureCancelled || crawlExportController.isCancelled(webmCancelToken)) {
                            captureCancelled = true;
                            break;
                        }
                    }
                }

                if (captureCancelled || crawlExportController.isCancelled(webmCancelToken)) {
                    crawlExportController.clear(webmCancelToken);
                    addStatus('WebM export canceled.', 'WARN');
                    return true;
                }

                await encoder.flush();
                if (encodeError) {
                    throw encodeError;
                }

                const exportedBlob = muxer.finalize();
                if (!exportedBlob) {
                    crawlExportController.clear(webmCancelToken);
                    addStatus('No frames recorded for WebM export.', 'WARN');
                    return true;
                }

                reportProgress = createExportProgressReporter('WebM save');
                reportProgress(0);

                await saveFile(filename || `${downloadName}.webm`, exportedBlob, 'video/webm', {
                    onProgress: (ratio) => reportProgress(ratio),
                    isCancelled: () => crawlExportController.isCancelled(webmCancelToken),
                });

                crawlExportController.clear(webmCancelToken);
                reportProgress(1);
                addStatus(
                    'Crawl exported successfully!' +
                    (showTime ? ` (Took: ${((performance.now() - startTime) / 1000).toFixed(2)} seconds)` : ''),
                    'SUCCESS'
                );
                return true;
            } catch (error) {
                const cancelled = captureCancelled || crawlExportController.isCancelled(webmCancelToken);
                crawlExportController.clear(webmCancelToken);
                if (cancelled) {
                    addStatus('WebM export canceled.', 'WARN');
                } else {
                    console.error('WebCodecs WebM export failed:', error);
                    addStatus(`WebM export failed: ${error?.message || error}`, 'ERROR');
                }
                return true;
            } finally {
                try {
                    if (encoder && encoder.state !== 'closed') {
                        encoder.close();
                    }
                } catch (cleanupError) { /* ignore */ }
                tearDownCaptureCanvas();
            }
        };

        const exportWithMediaRecorder = async () => {
            let recorder;
            let stream;
            const chunks = [];
            let captureCancelled = false;
            let stopped = false;
            const webmCancelToken = crawlExportController.createToken(() => {
                captureCancelled = true;
                if (recorder && recorder.state === 'recording') {
                    try {
                        recorder.stop();
                    } catch (stopError) { /* ignore */ }
                }
            });

            try {
                let supportedTypes = (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function')
                    ? getSupportedMimeTypes('video', ['webm'], ['vp9', 'vp8'])
                    : [];
                if (!supportedTypes.length && typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
                    supportedTypes = getSupportedMimeTypes('video', ['mp4'], ['avc1', 'h264']);
                }

                stream = captureCanvas.captureStream(captureFps);

                const mimeTypesToTry = supportedTypes.length
                    ? [supportedTypes[0]]
                    : ['video/mp4', undefined];
                let recorderCreated = false;
                for (const tryMime of mimeTypesToTry) {
                    try {
                        const opts = {};
                        if (tryMime) opts.mimeType = tryMime;
                        if (Number.isFinite(videoBitsPerSecond)) opts.videoBitsPerSecond = videoBitsPerSecond;
                        recorder = new MediaRecorder(stream, opts);
                        recorderCreated = true;
                        break;
                    } catch (e) { /* ignore */ }
                }
                if (!recorderCreated) {
                    throw new Error('Could not create MediaRecorder with any supported format');
                }

                recorder.ondataavailable = (event) => {
                    if (event.data && event.data.size) {
                        chunks.push(event.data);
                    }
                };

                const recorderStopped = new Promise((resolve) => {
                    recorder.onstop = () => {
                        stopped = true;
                        resolve();
                    };
                    recorder.onerror = () => {
                        stopped = true;
                        resolve();
                    };
                });

                recorder.start();

                resetVdsExportState(vdsState);
                let offsetX = adjustedStartOffset;
                let delayFramesRemaining = 0;
                const captureStartTime = performance.now();
                reportProgress(0);

                for (let i = 0; i < totalFrames; i++) {
                    if (captureCancelled || crawlExportController.isCancelled(webmCancelToken)) {
                        captureCancelled = true;
                        break;
                    }

                    drawFrameTransparent(offsetX, i);
                    reportProgress((i + 1) / totalFrames);

                    if (delayFramesRemaining > 0) {
                        delayFramesRemaining--;
                        if (delayFramesRemaining === 0) {
                            offsetX = adjustedStartOffset;
                            resetVdsExportState(vdsState);
                        }
                    } else {
                        offsetX -= pxPerFrameSigned;
                        if ((pxPerFrameSigned >= 0 && offsetX < adjustedEndOffset) ||
                            (pxPerFrameSigned < 0 && offsetX > adjustedEndOffset)) {
                            if (restartDelayFrames > 0) {
                                offsetX = adjustedEndOffset;
                                delayFramesRemaining = restartDelayFrames;
                            } else {
                                offsetX = adjustedStartOffset;
                                resetVdsExportState(vdsState);
                            }
                        }
                    }

                    const targetTime = captureStartTime + (i + 1) * frameDelay;
                    const waitTime = Math.max(0, targetTime - performance.now());
                    if (waitTime > 0) {
                        await new Promise((resolve) => setTimeout(resolve, waitTime));
                    }
                }

                if (recorder.state === 'recording') {
                    recorder.stop();
                }

                await recorderStopped;

                if (captureCancelled || crawlExportController.isCancelled(webmCancelToken)) {
                    crawlExportController.clear(webmCancelToken);
                    addStatus('WebM export canceled.', 'WARN');
                    return true;
                }

                let mimeType = recorder.mimeType || (supportedTypes[0] || '');
                if (!mimeType) {
                    const isApple = /Apple|Safari/i.test(navigator.userAgent) && !/Chrome|CriOS/i.test(navigator.userAgent);
                    mimeType = isApple ? 'video/mp4' : 'video/webm';
                }
                const isMp4 = mimeType.includes('mp4');
                const exportedBlob = chunks.length ? new Blob(chunks, { type: mimeType }) : null;

                if (!exportedBlob) {
                    crawlExportController.clear(webmCancelToken);
                    addStatus('No frames recorded for video export.', 'WARN');
                    return true;
                }

                reportProgress = createExportProgressReporter('Video save');
                reportProgress(0);

                const ext = isMp4 ? '.mp4' : '.webm';
                await saveFile(filename || `${downloadName}${ext}`, exportedBlob, mimeType, {
                    onProgress: (ratio) => reportProgress(ratio),
                    isCancelled: () => crawlExportController.isCancelled(webmCancelToken),
                });

                crawlExportController.clear(webmCancelToken);
                reportProgress(1);
                addStatus(
                    'Crawl exported successfully!' +
                    (showTime ? ` (Took: ${((performance.now() - startTime) / 1000).toFixed(2)} seconds)` : ''),
                    'SUCCESS'
                );
                return true;
            } catch (error) {
                if (captureCancelled || crawlExportController.isCancelled(webmCancelToken)) {
                    crawlExportController.clear(webmCancelToken);
                    addStatus('WebM export canceled.', 'WARN');
                    return true;
                }
                console.error('MediaRecorder export failed:', error);
                crawlExportController.clear(webmCancelToken);
                addStatus(`Video export failed: ${error?.message || error}`, 'ERROR');
                return true;
            } finally {
                if (!stopped && recorder && recorder.state === 'recording') {
                    try {
                        recorder.stop();
                    } catch (stopError) { /* ignore */ }
                }
                if (stream && typeof stream.getTracks === 'function') {
                    stream.getTracks().forEach((track) => track.stop());
                }
                tearDownCaptureCanvas();
            }
        };

        if (wantsTransparentOutput) {
            const config = await getWebCodecsConfig();
            if (!config) {
                tearDownCaptureCanvas();
                addStatus('Transparent WebM export requires WebCodecs with VP9 alpha support in this browser.', 'ERROR');
                return;
            }
            const handled = await exportWithWebCodecs(config);
            if (handled) {
                return;
            }
            tearDownCaptureCanvas();
            addStatus('Transparent WebM export failed: WebCodecs encoder unavailable.', 'ERROR');
            return;
        }

        if (typeof MediaRecorder === 'function' && typeof captureCanvas.captureStream === 'function') {
            const handled = await exportWithMediaRecorder();
            if (handled) {
                return;
            }
        }

        if (typeof CCapture !== 'function') {
            addStatus('Video export unavailable: no supported recording method found.', 'ERROR');
            tearDownCaptureCanvas();
            return;
        }

        const canvasCaptureLib = (window.CanvasCaptureLib && window.CanvasCaptureLib.CanvasCapture)
            || window.CanvasCapture;
        const cleanupAndFail = (message) => {
            if (typeof tearDownCaptureCanvas === 'function') {
                tearDownCaptureCanvas();
            }
            addStatus(message, 'ERROR');
        };
        if (!canvasCaptureLib || typeof canvasCaptureLib.init !== 'function') {
            cleanupAndFail('WebM export unavailable: missing CanvasCapture.');
            return;
        }

        try {
            if (typeof canvasCaptureLib.dispose === 'function') {
                canvasCaptureLib.dispose();
            }
        } catch (disposeError) {
            console.warn('CanvasCapture dispose failed:', disposeError);
        }

        try {
            canvasCaptureLib.init(captureCanvas, {
                showRecDot: false,
                showAlerts: false,
                showDialogs: false,
                verbose: false
            });
        } catch (initError) {
            console.error('Failed to initialize CanvasCapture:', initError);
            cleanupAndFail('Failed to initialize WebM capture.');
            return;
        }

        let captureCancelled = false;
        const webmCancelToken = crawlExportController.createToken(() => {
            captureCancelled = true;
        });

        let exportedBlob = null;
        let exportedFilename = `${downloadName || 'crawl'}.webm`;
        let captureError = null;
        let exportProgress = 0;
        let exportProgressTimer = null;
        let totalExportSteps = totalFrames;
        let currentCaptureProgress = 0;
        const applyProgress = () => {
            const capturePortion = (totalFrames > 0 ? currentCaptureProgress / totalFrames : 1) * captureProgressPortion;
            const exportPortion = exportProgress * (1 - captureProgressPortion);
            reportProgress(Math.min(0.99, capturePortion + exportPortion));
        };
        const applyExportProgress = (value) => {
            const nextValue = Math.max(exportProgress, Math.min(0.999, value));
            if (nextValue <= exportProgress) {
                return;
            }
            exportProgress = nextValue;
            applyProgress();
        };
        const startExportProgressSmoothing = () => {
            if (exportProgressTimer || captureCancelled) {
                return;
            }
            exportProgressTimer = setInterval(() => {
                if (captureCancelled) {
                    clearInterval(exportProgressTimer);
                    exportProgressTimer = null;
                    return;
                }
                if (exportProgress >= 0.99) {
                    return;
                }
                applyExportProgress(Math.min(0.99, exportProgress + 0.01));
            }, 250);
        };
        const clearExportProgressSmoothing = () => {
            if (exportProgressTimer) {
                clearInterval(exportProgressTimer);
                exportProgressTimer = null;
            }
        };

        let captureHandle;
        try {
            captureHandle = canvasCaptureLib.beginVideoRecord({
                format: canvasCaptureLib.WEBM || 'webm',
                name: downloadName || 'crawl',
                fps: captureFps,
                quality: captureQuality,
                onExportProgress: (progress) => {
                    applyExportProgress(progress);
                },
                onExport: (blob, filenameHint) => {
                    if (captureCancelled) {
                        return;
                    }
                    exportedBlob = blob;
                    exportedFilename = filenameHint || `${downloadName || 'crawl'}.webm`;
                },
                onError: (error) => {
                    captureError = error;
                    console.error('CanvasCapture export error:', error);
                }
            });
        } catch (beginError) {
            console.error('Failed to start CanvasCapture recording:', beginError);
            crawlExportController.clear(webmCancelToken);
            cleanupAndFail('Failed to start WebM recording.');
            canvasCaptureLib.dispose();
            return;
        }

        if (!captureHandle) {
            crawlExportController.clear(webmCancelToken);
            cleanupAndFail('Failed to start WebM recording.');
            canvasCaptureLib.dispose();
            return;
        }

        resetVdsExportState(vdsState);
        let offsetX = adjustedStartOffset;
        const FRAMES_PER_YIELD = Math.max(5, Math.round(180 / Math.max(1, captureFps)));
        const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));
        for (let i = 0; i < totalFrames; i++) {
            if (captureCancelled || crawlExportController.isCancelled(webmCancelToken)) {
                captureCancelled = true;
                break;
            }
            drawFrame(offsetX, i);
            try {
                canvasCaptureLib.recordFrame(captureHandle);
            } catch (recordError) {
                console.error('Failed to record frame:', recordError);
                captureError = recordError;
                captureCancelled = true;
                break;
            }
            currentCaptureProgress = i + 1;
            applyProgress();

            if (delayFramesRemaining > 0) {
                delayFramesRemaining--;
                if (delayFramesRemaining === 0) {
                    offsetX = adjustedStartOffset;
                    resetVdsExportState(vdsState);
                }
                continue;
            }

            offsetX -= pxPerFrameSigned;
            if ((pxPerFrameSigned >= 0 && offsetX < adjustedEndOffset) || (pxPerFrameSigned < 0 && offsetX > adjustedEndOffset)) {
                if (restartDelayFrames > 0) {
                    offsetX = adjustedEndOffset;
                    delayFramesRemaining = restartDelayFrames;
                } else {
                    offsetX = adjustedStartOffset;
                    resetVdsExportState(vdsState);
                }
            }

            if ((i + 1) % FRAMES_PER_YIELD === 0) {
                await yieldToBrowser();
                if (captureCancelled || crawlExportController.isCancelled(webmCancelToken)) {
                    captureCancelled = true;
                    break;
                }
            }
        }
        currentCaptureProgress = totalFrames;
        applyProgress();

        try {
            startExportProgressSmoothing();
            await canvasCaptureLib.stopRecord(captureHandle);
        } catch (stopError) {
            if (!captureCancelled) {
                captureError = captureError || stopError;
                console.error('CanvasCapture stop error:', stopError);
            }
        } finally {
            clearExportProgressSmoothing();
            if (!captureError && !captureCancelled) {
                applyExportProgress(1);
            }
            try {
                canvasCaptureLib.dispose();
            } catch (cleanupError) {
                console.warn('CanvasCapture cleanup failed:', cleanupError);
            }
            tearDownCaptureCanvas();
        }

        if (captureCancelled || crawlExportController.isCancelled(webmCancelToken)) {
            crawlExportController.clear(webmCancelToken);
            addStatus('WebM export canceled.', 'WARN');
            return;
        }

        if (captureError) {
            crawlExportController.clear(webmCancelToken);
            cleanupAndFail('Failed to export crawl as WebM.');
            return;
        }

        if (!exportedBlob) {
            crawlExportController.clear(webmCancelToken);
            addStatus('No frames recorded for WebM export.', 'WARN');
            return;
        }

        reportProgress = createExportProgressReporter('WebM save');

        reportProgress(0);

        try {
            await saveFile(filename || exportedFilename, exportedBlob, 'video/webm', {
                onProgress: (ratio) => reportProgress(ratio),
                isCancelled: () => crawlExportController.isCancelled(webmCancelToken),
            });

            crawlExportController.clear(webmCancelToken);
            reportProgress(1);
            addStatus(
                'Crawl exported successfully!' +
                (showTime ? ` (Took: ${((performance.now() - startTime) / 1000).toFixed(2)} seconds)` : ''),
                'SUCCESS'
            );
        } catch (e) {
            const cancelled = String(e?.message || e).includes('CANCELLED') ||
                crawlExportController.isCancelled(webmCancelToken);

            crawlExportController.clear(webmCancelToken);

            if (cancelled) {
                addStatus('WebM export canceled during save.', 'WARN');
            } else {
                console.error('WebM save failed:', e);
                addStatus(`WebM save failed: ${e?.message || e}`, 'ERROR');
            }
        }
    }

    class TextCrawlGenerator {
        constructor(container) {
            this.container = container;
            this.canvas = document.createElement('canvas');
            this.ctx = this.canvas.getContext('2d');
            this.canvas.style.display = 'block';
            this.container.appendChild(this.canvas);
            this.text = "Hello from Wags!";
            this.speed = 2;
            this._speedPerSecond = this._computeSpeedPerSecond(this.speed);
            this.fontSize = 24;
            this.textColor = "#FFFFFF";
            this.bgColor = "#000000";
            this._transparentBg = false;
            this.isAnimating = false;
            this.offsetX = this.canvas.width;
            this.offsetY = this.canvas.height;
            this.startFromRightInitialized = false;
            this.msPerFrame = 1000 / 30;
            this.lastTimestamp = null;
            this.vdsMode = false;
            this.vdsBaseDelayFrames = DEFAULT_VDS_BASE_DELAY;
            this.vdsReferenceSpeed = Math.max(0.01, Math.abs(this.speed) || 2);
            this.vdsState = null;
            this.fontFamily = 'Arial';
            this.fontStyle = 'normal';
            this.outlineColor = null;
            this.outlineWidth = 0;
            this.outlineJoin = 'round';
            this.bgImage = null;
            this.bgVideo = null;
            this.explicitWidth = null;
            this.explicitHeight = null;
            this.crawlInset = 0;
            this.crawlRestartDelay = 1000;
            this._restartDelayRemaining = 0;
            this._topLeftOffsetX = 0;
            this._topLeftOffsetY = 0;
            this._topLeftActive = false;
            this.repetitions = 0;
            this.crawlRepetitions = 0;
            this.kerningPercent = 0;
            this._frameHistory = [];
            this._frameHistoryLimit = 15;
            this._responsiveViewportHandler = null;

            this._attachResponsiveViewportListener();
            window.addEventListener('resize', () => this.resizeCanvas());
            this.resizeCanvas();
        }

        getNextFrame() {
            if (!this.ctx || !this.canvas) {
                return null;
            }

            const deltaMs = Number.isFinite(this.msPerFrame) && this.msPerFrame > 0
                ? this.msPerFrame
                : TARGET_FRAME_MS;
            this._renderFrame({ deltaMs, advance: true });
            return this.canvas;
        }

        getPrevFrame() {
            if (!this.ctx || !this.canvas) {
                return null;
            }

            const snapshot = this._frameHistory.pop();
            if (snapshot) {
                this._restoreFrameState(snapshot);
            }
            this._renderFrame({ advance: false });
            return this.canvas;
        }

        resizeCanvas() {
            const width = Number.isFinite(this.explicitWidth) ? this.explicitWidth : this.container.clientWidth;
            const height = Number.isFinite(this.explicitHeight) ? this.explicitHeight : this.container.clientHeight;
            this._applyCanvasSize(width, height);
        }

        adjustSize(width, height) {
            const normalizedWidth = this._normalizeExplicitDimension(width);
            const normalizedHeight = this._normalizeExplicitDimension(height);
            this.explicitWidth = normalizedWidth;
            this.explicitHeight = normalizedHeight;
            const targetWidth = Number.isFinite(normalizedWidth) ? normalizedWidth : this.container.clientWidth;
            const targetHeight = Number.isFinite(normalizedHeight) ? normalizedHeight : this.container.clientHeight;
            this._applyCanvasSize(targetWidth, targetHeight);
        }

        _applyCanvasSize(width, height) {
            if (!this.canvas) {
                return;
            }
            const safeWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : 1;
            const safeHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : 1;
            const sizeChanged = this.canvas.width !== safeWidth || this.canvas.height !== safeHeight;
            if (sizeChanged) {
                this.canvas.width = safeWidth;
                this.canvas.height = safeHeight;
                this.offsetX = this.canvas.width / 2;
                this.offsetY = this.canvas.height / 2;
                this.startFromRightInitialized = false;
                this._invalidateVdsState();
                this._resetFrameHistory();
            }
            this._syncCanvasDisplaySize();
        }

        _normalizeExplicitDimension(value) {
            const parsed = Number(value);
            return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
        }

        _resolveCrawlInset() {
            const inset = Number.isFinite(this.crawlInset) ? this.crawlInset : 0;
            const halfWidth = Number.isFinite(this.canvas.width) ? this.canvas.width / 2 : 0;
            return Math.max(0, Math.min(halfWidth, inset));
        }

        _getEffectiveInset(rawInset) {
            const width = Number.isFinite(this.canvas.width) ? this.canvas.width : 0;
            const baseInset = Number.isFinite(rawInset) ? Math.max(0, rawInset) : this._resolveCrawlInset();
            if (!width || baseInset <= 0) {
                return 0;
            }
            return baseInset * 2 < width ? baseInset : 0;
        }

        _computeCrawlBounds(maxLineWidth) {
            const canvasWidth = Number.isFinite(this.canvas.width) ? this.canvas.width : 0;
            const textWidth = Math.max(0, Number(maxLineWidth) || 0);
            const halfTextWidth = textWidth / 2;
            const inset = this._getEffectiveInset();
            return {
                start: canvasWidth + halfTextWidth,
                end: -halfTextWidth,
                inset,
                textWidth
            };
        }

        _computeTopLeftTranslation(blockWidth, lineCount) {
            if (!this._topLeftActive) {
                return { x: 0, y: 0 };
            }
            const parseValue = (value) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : 0;
            };
            const safeWidth = Math.max(0, Number(blockWidth) || 0);
            const safeLineCount = Math.max(1, Number(lineCount) || 1);
            const lineHeight = this.fontSize + 10;
            const blockHeight = safeLineCount * lineHeight;
            const canvasWidth = Number.isFinite(this.canvas.width) ? this.canvas.width : 0;
            const canvasHeight = Number.isFinite(this.canvas.height) ? this.canvas.height : 0;
            const defaultLeft = canvasWidth / 2 - safeWidth / 2;
            const defaultTop = canvasHeight / 2 - blockHeight / 2;
            const targetX = parseValue(this._topLeftOffsetX);
            const targetY = parseValue(this._topLeftOffsetY);
            const deltaX = Number.isFinite(targetX) ? targetX - defaultLeft : -defaultLeft;
            const deltaY = Number.isFinite(targetY) ? targetY - defaultTop : -defaultTop;
            return {
                x: Number.isFinite(deltaX) ? deltaX : 0,
                y: Number.isFinite(deltaY) ? deltaY : 0
            };
        }

        _runWithTopLeftTranslation(translation, drawFn) {
            if (typeof drawFn !== 'function') {
                return;
            }
            const shiftX = translation && Number.isFinite(translation.x) ? translation.x : 0;
            const shiftY = translation && Number.isFinite(translation.y) ? translation.y : 0;
            if (shiftX === 0 && shiftY === 0) {
                drawFn();
                return;
            }
            const originalX = this.offsetX;
            const originalY = this.offsetY;
            this.offsetX = originalX + shiftX;
            this.offsetY = originalY + shiftY;
            try {
                drawFn();
            } finally {
                this.offsetX = originalX;
                this.offsetY = originalY;
            }
        }

        _applyCrawlClip(ctx, insetOverride) {
            const inset = Number.isFinite(insetOverride) ? insetOverride : this._getEffectiveInset();
            const width = this.canvas.width;
            const height = this.canvas.height;
            if (!ctx || typeof ctx.save !== 'function' || inset <= 0) {
                return () => { };
            }
            const clipWidth = width - inset * 2;
            if (clipWidth <= 0) {
                return () => { };
            }
            ctx.save();
            ctx.beginPath();
            ctx.rect(inset, 0, clipWidth, height);
            ctx.clip();
            return () => ctx.restore();
        }

        _updateFrameTiming(timestamp) {
            let delta = this.msPerFrame;
            if (typeof timestamp === 'number') {
                if (this.lastTimestamp !== null) {
                    const frameDelta = timestamp - this.lastTimestamp;
                    if (frameDelta > 0) {
                        const smoothing = 0.1;
                        this.msPerFrame = (1 - smoothing) * this.msPerFrame + smoothing * frameDelta;
                        delta = frameDelta;
                    }
                }
                this.lastTimestamp = timestamp;
            }
            return delta > 0 ? delta : this.msPerFrame;
        }

        _computeSpeedPerSecond(value) {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed * TARGET_FRAMES_PER_SECOND : 0;
        }

        _getFrameSpeedStep(deltaMs) {
            const perSecond = Number.isFinite(this._speedPerSecond)
                ? this._speedPerSecond
                : this._computeSpeedPerSecond(this.speed);
            if (!perSecond) {
                return 0;
            }
            const safeDelta = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : this.msPerFrame;
            return perSecond * (safeDelta / 1000);
        }

        _handleRestartDelay(deltaMs, endThreshold, startOffset, resetCallback) {
            const resolvedDelay = Number.isFinite(this.crawlRestartDelay) ? this.crawlRestartDelay : 0;
            const safeDelta = Number.isFinite(deltaMs) ? deltaMs : this.msPerFrame;

            if (this.offsetX < endThreshold) {
                if (this._restartDelayRemaining <= 0) {
                    this._restartDelayRemaining = resolvedDelay;
                    this.offsetX = endThreshold;
                    return;
                }

                this.offsetX = endThreshold;
                if (this._restartDelayRemaining > 0 && safeDelta > 0) {
                    this._restartDelayRemaining = Math.max(0, this._restartDelayRemaining - safeDelta);
                }

                if (this._restartDelayRemaining === 0) {
                    this.offsetX = startOffset;
                    if (typeof resetCallback === 'function') {
                        resetCallback();
                    }
                }
                return;
            }

            this._restartDelayRemaining = 0;
        }

        _resetFrameHistory() {
            if (Array.isArray(this._frameHistory)) {
                this._frameHistory.length = 0;
            } else {
                this._frameHistory = [];
            }
        }

        _attachResponsiveViewportListener() {
            if (!mobileCanvasMediaQuery) {
                return;
            }
            this._responsiveViewportHandler = () => this._syncCanvasDisplaySize();
            const handler = this._responsiveViewportHandler;
            if (typeof mobileCanvasMediaQuery.addEventListener === 'function') {
                mobileCanvasMediaQuery.addEventListener('change', handler);
            } else if (typeof mobileCanvasMediaQuery.addListener === 'function') {
                mobileCanvasMediaQuery.addListener(handler);
            }
        }

        _detachResponsiveViewportListener() {
            if (!mobileCanvasMediaQuery || !this._responsiveViewportHandler) {
                return;
            }
            const handler = this._responsiveViewportHandler;
            if (typeof mobileCanvasMediaQuery.removeEventListener === 'function') {
                mobileCanvasMediaQuery.removeEventListener('change', handler);
            } else if (typeof mobileCanvasMediaQuery.removeListener === 'function') {
                mobileCanvasMediaQuery.removeListener(handler);
            }
            this._responsiveViewportHandler = null;
        }

        _syncCanvasDisplaySize() {
            if (!this.canvas) {
                return;
            }
            applyCanvasDisplaySize(this.canvas, this.canvas.width, this.canvas.height);
        }

        _cloneVdsState(state) {
            if (!state) {
                return null;
            }
            const cloneMetrics = state.charMetrics.map((metrics) => metrics.map((metric) => ({
                char: metric.char,
                offset: metric.offset,
                width: metric.width,
                state: metric.state,
                framesRemaining: metric.framesRemaining
            })));
            return {
                key: state.key,
                lines: state.lines.slice(),
                charMetrics: cloneMetrics,
                lineWidths: state.lineWidths.slice(),
                maxLineWidth: state.maxLineWidth
            };
        }

        _captureFrameState() {
            return {
                offsetX: this.offsetX,
                restartDelayRemaining: this._restartDelayRemaining,
                startFromRightInitialized: this.startFromRightInitialized,
                vdsState: this.vdsMode ? this._cloneVdsState(this.vdsState) : null
            };
        }

        _recordFrameSnapshot() {
            if (!Array.isArray(this._frameHistory)) {
                this._frameHistory = [];
            }
            this._frameHistory.push(this._captureFrameState());
            const limit = Number.isFinite(this._frameHistoryLimit) && this._frameHistoryLimit > 0
                ? Math.floor(this._frameHistoryLimit)
                : 0;
            if (limit > 0 && this._frameHistory.length > limit) {
                this._frameHistory.splice(0, this._frameHistory.length - limit);
            }
        }

        _restoreFrameState(snapshot) {
            if (!snapshot) {
                return;
            }
            if (Number.isFinite(snapshot.offsetX)) {
                this.offsetX = snapshot.offsetX;
            }
            if (Number.isFinite(snapshot.restartDelayRemaining)) {
                this._restartDelayRemaining = snapshot.restartDelayRemaining;
            }
            if (typeof snapshot.startFromRightInitialized === 'boolean') {
                this.startFromRightInitialized = snapshot.startFromRightInitialized;
            }
            if (snapshot.vdsState) {
                this.vdsState = this._cloneVdsState(snapshot.vdsState);
            }
        }

        _renderFrame(options = {}) {
            if (!this.ctx || !this.canvas) {
                return;
            }

            const { advance = true } = options;
            const deltaMs = Number.isFinite(options.deltaMs) && options.deltaMs > 0
                ? options.deltaMs
                : this.msPerFrame;

            this._clearBackground();
            this.ctx.fillStyle = this.textColor;
            this.ctx.font = `${this.fontStyle || 'normal'} ${this.fontSize}px "${this.fontFamily || 'Arial'}"`;
            this.ctx.textBaseline = 'middle';
            this.ctx.lineJoin = this.outlineJoin;

            const lines = (this.text || '').split('\n');

            if (this.vdsMode) {
                this.ctx.textAlign = 'left';
                const renderText = createTextRenderer(this.ctx, this.outlineColor, this.outlineWidth);
                const state = this._ensureVdsState(lines);
                const maxLineWidth = state.maxLineWidth || 0;
                const translation = this._computeTopLeftTranslation(maxLineWidth, lines.length);
                const translationX = Number.isFinite(translation.x) ? translation.x : 0;
                const bounds = this._computeCrawlBounds(maxLineWidth);
                const { start: startOffset, end: endOffset, inset } = bounds;
                const adjustedStartOffset = startOffset - translationX;
                const adjustedEndOffset = endOffset - translationX;
                const releaseClip = this._applyCrawlClip(this.ctx, inset);

                if (!this.startFromRightInitialized || !Number.isFinite(this.offsetX)) {
                    this.offsetX = adjustedStartOffset;
                    this.startFromRightInitialized = true;
                    this._restartDelayRemaining = 0;
                    this._resetVdsCharacters(state);
                    this._resetFrameHistory();
                }

                if (advance) {
                    this._recordFrameSnapshot();
                }

                const effectiveDelay = this.getEffectiveVdsDelay();
                this._runWithTopLeftTranslation(translation, () => {
                    if (advance) {
                        this._updateVdsCharacters(state, effectiveDelay);
                    }
                    this._drawVdsLines(state, renderText);
                });
                releaseClip();

                if (!advance) {
                    return;
                }

                const frameStep = this._getFrameSpeedStep(deltaMs);
                if (frameStep) {
                    this.offsetX -= frameStep;
                }

                this._handleRestartDelay(deltaMs, adjustedEndOffset, adjustedStartOffset, () => {
                    this._resetVdsCharacters(state);
                });

                return;
            }

            this.ctx.textAlign = 'center';
            const renderText = createTextRenderer(this.ctx, this.outlineColor, this.outlineWidth);
            const maxLineWidth = lines.reduce((maxWidth, line) => {
                const width = this.ctx.measureText(line).width;
                return width > maxWidth ? width : maxWidth;
            }, 0);
            const translation = this._computeTopLeftTranslation(maxLineWidth, lines.length);
            const translationX = Number.isFinite(translation.x) ? translation.x : 0;
            const bounds = this._computeCrawlBounds(maxLineWidth);
            const { start: startOffset, end: endOffset, inset } = bounds;
            const adjustedStartOffset = startOffset - translationX;
            const adjustedEndOffset = endOffset - translationX;
            const releaseClip = this._applyCrawlClip(this.ctx, inset);

            if (!this.startFromRightInitialized || !Number.isFinite(this.offsetX)) {
                this.offsetX = adjustedStartOffset;
                this.startFromRightInitialized = true;
                this._restartDelayRemaining = 0;
                this._resetFrameHistory();
            }

            if (advance) {
                this._recordFrameSnapshot();
            }

            this._runWithTopLeftTranslation(translation, () => {
                lines.forEach((line, index) => {
                    const verticalOffset = index - (lines.length - 1) / 2;
                    const y = this.offsetY + verticalOffset * (this.fontSize + 10);
                    renderText(line, this.offsetX, y);
                });
            });
            releaseClip();

            if (!advance) {
                return;
            }

            const frameStep = this._getFrameSpeedStep(deltaMs);
            if (frameStep) {
                this.offsetX -= frameStep;
            }

            this._handleRestartDelay(deltaMs, adjustedEndOffset, adjustedStartOffset);
        }

        setTopLeftOffsetX(offsetX) {
            this._topLeftOffsetX = offsetX;
            this._topLeftActive = true;
            this._resetFrameHistory();
        }

        setTopLeftOffsetY(offsetY) {
            this._topLeftOffsetY = offsetY;
            this._topLeftActive = true;
            this._resetFrameHistory();
        }

        setRepetitions(count) {
            const parsed = Number(count);
            if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 10) {
                this.repetitions = Math.round(parsed);
                this.crawlRepetitions = this.repetitions;
            }
        }

        setCrawlInset(inset) {
            const parsed = Number(inset);
            if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 500) {
                this.crawlInset = parsed;
                this.startFromRightInitialized = false;
                this._restartDelayRemaining = 0;
                this._invalidateVdsState();
                this._resetFrameHistory();
            }
        }

        setCrawlRestartDelay(delay) {
            const parsed = Number(delay);
            if (Number.isFinite(parsed) && parsed >= 500 && parsed <= 60000) {
                this.crawlRestartDelay = parsed;
                this._restartDelayRemaining = 0;
                this._resetFrameHistory();
            }
        }

        setText(text) {
            this.text = text;
            this.startFromRightInitialized = false;
            this._invalidateVdsState();
            this._resetFrameHistory();
        }

        setFontFamily(fontFamily) {
            this.fontFamily = fontFamily;
        }

        setFontStyle(fontStyle) {
            this.fontStyle = fontStyle;
        }

        setSpeed(speed) {
            const parsed = Number(speed);
            if (Number.isFinite(parsed)) {
                this.speed = parsed;
                this._speedPerSecond = this._computeSpeedPerSecond(parsed);
                this._resetFrameHistory();
            }
        }

        setKerning(kerning) {
            const parsed = Number(kerning);
            if (Number.isFinite(parsed)) {
                this.kerningPercent = parsed;
                const px = (parsed / 100) * this.fontSize;
                this.ctx.letterSpacing = `${px}px`;
                this.startFromRightInitialized = false;
                this._invalidateVdsState();
                this._resetFrameHistory();
            }
        }

        setFontSize(size) {
            const parsed = Number(size);
            if (Number.isFinite(parsed) && parsed > 0) {
                this.fontSize = parsed;
                if (this.kerningPercent) {
                    const px = (this.kerningPercent / 100) * parsed;
                    this.ctx.letterSpacing = `${px}px`;
                }
                this.startFromRightInitialized = false;
                this._invalidateVdsState();
                this._resetFrameHistory();
            }
        }

        setTextColor(color) {
            this.textColor = color;
        }

        setBgColor(color) {
            this.bgColor = color;
            this._transparentBg = this._isTransparentColor(color);
        }

        _isTransparentColor(color) {
            if (typeof color !== 'string') {
                return false;
            }
            const normalized = color.trim().toLowerCase();
            if (normalized === 'transparent') {
                return true;
            }
            if (!normalized.startsWith('rgba(')) {
                return false;
            }
            const channels = normalized.slice(5, -1).split(',');
            if (channels.length < 4) {
                return false;
            }
            const alpha = Number(channels[3]);
            return Number.isFinite(alpha) && alpha <= 0;
        }

        _clearBackground() {
            if (!this.ctx) {
                return;
            }

            const width = this.canvas.width;
            const height = this.canvas.height;
            const video = this.bgVideo;

            if (video && Number.isFinite(width) && Number.isFinite(height)) {
                const haveCurrentData = typeof HTMLMediaElement !== 'undefined'
                    ? HTMLMediaElement.HAVE_CURRENT_DATA
                    : 2;
                if (video.readyState >= haveCurrentData) {
                    this.ctx.drawImage(video, 0, 0, width, height);
                    return;
                }
            }

            if (this.bgImage && Number.isFinite(width) && Number.isFinite(height)) {
                this.ctx.drawImage(this.bgImage, 0, 0, width, height);
                return;
            }

            if (this._transparentBg) {
                clearContextFully(this.ctx, width, height);
                return;
            }
            const fill = this.bgColor || '#000000';
            this.ctx.fillStyle = fill;
            this.ctx.fillRect(0, 0, width, height);
        }

        setBgImage(image) {
            this.bgImage = image;
        }

        setBgVideo(video) {
            this.bgVideo = video;
        }

        setOutlineColor(color) {
            this.outlineColor = color;
        }

        setOutlineWidth(width) {
            const parsed = Number(width);
            if (Number.isFinite(parsed) && parsed >= 0) {
                this.outlineWidth = parsed;
            }
        }

        setOutlineJoin(join) {
            this.outlineJoin = join;
        }

        getCrawlText() {
            return this.text;
        }

        setVDSMode(enabled) {
            const next = Boolean(enabled);
            if (this.vdsMode !== next) {
                this.vdsMode = next;
                this.startFromRightInitialized = false;
                this._invalidateVdsState();
                this._resetFrameHistory();
            }
        }

        _invalidateVdsState() {
            this.vdsState = null;
        }

        _ensureVdsState(lines) {
            const normalizedLines = Array.isArray(lines) ? lines : [];
            const key = normalizedLines.join('\n');

            if (this.vdsState && this.vdsState.key === key) {
                return this.vdsState;
            }

            const lineWidths = [];
            const charMetrics = normalizedLines.map((line) => {
                const metrics = [];
                const characters = Array.from(line);
                let cursor = 0;

                characters.forEach((char) => {
                    const measuredChar = char === '' ? ' ' : char;
                    const width = this.ctx.measureText(measuredChar).width;
                    metrics.push({
                        char,
                        offset: cursor,
                        width,
                        state: 'pre',
                        framesRemaining: 0
                    });
                    cursor += width;
                });

                lineWidths.push(cursor);
                return metrics;
            });

            const maxLineWidth = lineWidths.reduce((maxWidth, width) => Math.max(maxWidth, width), 0);

            this.vdsState = {
                key,
                lines: normalizedLines.slice(),
                charMetrics,
                lineWidths,
                maxLineWidth
            };

            return this.vdsState;
        }

        _resetVdsCharacters(state) {
            state.charMetrics.forEach((metrics) => {
                metrics.forEach((metric) => {
                    metric.state = 'pre';
                    metric.framesRemaining = 0;
                });
            });
        }

        getEffectiveVdsDelay(speedOverride) {
            const referenceSpeed = Math.max(0.01, this.vdsReferenceSpeed);
            const currentSpeed = Math.max(
                0.01,
                Number.isFinite(speedOverride) ? Math.abs(speedOverride) : Math.abs(this.speed) || referenceSpeed
            );
            const scaled = (this.vdsBaseDelayFrames * referenceSpeed) / currentSpeed;
            return Math.max(1, Math.round(scaled));
        }

        _updateVdsCharacters(state, frameDelay) {
            const inset = this._getEffectiveInset();
            const viewportLeft = inset;
            const viewportRight = Math.max(inset, this.canvas.width - inset);

            state.charMetrics.forEach((metrics, lineIdx) => {
                const width = state.lineWidths[lineIdx] || 0;
                const lineLeft = this.offsetX - width / 2;

                metrics.forEach((metric) => {
                    const charLeft = lineLeft + metric.offset;
                    const charRight = charLeft + metric.width;

                    switch (metric.state) {
                        case 'pre':
                            if (charLeft <= viewportRight) {
                                metric.state = 'delayIn';
                                metric.framesRemaining = frameDelay;
                            }
                            break;
                        case 'delayIn':
                            if (charRight < viewportLeft) {
                                metric.state = 'done';
                                metric.framesRemaining = 0;
                            } else if (metric.framesRemaining > 0) {
                                metric.framesRemaining--;
                            } else {
                                metric.state = 'visible';
                            }
                            break;
                        case 'visible':
                            if (charLeft <= viewportLeft) {
                                metric.state = 'delayOut';
                                metric.framesRemaining = frameDelay;
                            }
                            break;
                        case 'delayOut':
                            if (metric.framesRemaining > 0) {
                                metric.framesRemaining--;
                            } else {
                                metric.state = 'done';
                            }
                            break;
                        default:
                            break;
                    }
                });
            });
        }

        _drawVdsLines(state, renderText) {
            const lineHeight = this.fontSize + 10;
            const totalLines = state.lines.length;
            const drawChar = (typeof renderText === 'function')
                ? renderText
                : (text, x, y) => this.ctx.fillText(text, x, y);

            for (let lineIdx = 0; lineIdx < totalLines; lineIdx++) {
                const verticalOffset = lineIdx - (totalLines - 1) / 2;
                const y = this.offsetY + verticalOffset * lineHeight;
                const metrics = state.charMetrics[lineIdx];
                const width = state.lineWidths[lineIdx] || 0;
                const lineLeft = this.offsetX - width / 2;

                for (let charIdx = 0; charIdx < metrics.length; charIdx++) {
                    const metric = metrics[charIdx];
                    if (metric.state !== 'visible') continue;
                    drawChar(metric.char, lineLeft + metric.offset, y);
                }
            }
        }

        _updateButtons(disabled) {
            const pauseCrawlButton = document.getElementById('pauseCrawl');
            const stopCrawlButton = document.getElementById('stopCrawl');
            const exportAsGIFButton = document.getElementById('exportCrawlGIF');
            const exportAsVideoButton = document.getElementById('exportCrawlVideo');
            const copyCrawlTextButton = document.getElementById('copyCrawlText');
            const destroyInstanceButton = document.getElementById('destroyCrawl');
            const nextFrameButton = document.getElementById('nextFrame');
            const prevFrameButton = document.getElementById('prevFrame');

            pauseCrawlButton.disabled = disabled;
            stopCrawlButton.disabled = disabled;
            exportAsGIFButton.disabled = disabled;
            exportAsVideoButton.disabled = disabled;
            copyCrawlTextButton.disabled = disabled;
            destroyInstanceButton.disabled = disabled;
            nextFrameButton.disabled = disabled;
            prevFrameButton.disabled = disabled;
        }

        start() {
            if (!this.isAnimating) {
                this.isAnimating = true;
                this.startFromRightInitialized = false;
                this.lastTimestamp = null;
                this._restartDelayRemaining = 0;
                this._resetFrameHistory();
                requestAnimationFrame((timestamp) => this.animate(timestamp));
            }
        }

        stop() {
            const lines = (this.text || '').split('\n');
            this.isAnimating = false;
            this.lastTimestamp = null;

            this.ctx.font = `${this.fontStyle || 'normal'} ${this.fontSize}px "${this.fontFamily || 'Arial'}"`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            const maxLineWidth = lines.reduce((maxWidth, line) => {
                const width = this.ctx.measureText(line).width;
                return width > maxWidth ? width : maxWidth;
            }, 0);

            const bounds = this._computeCrawlBounds(maxLineWidth);
            this.offsetX = Number.isFinite(bounds.start) ? bounds.start : this.canvas.width / 2;
            this.offsetY = this.canvas.height / 2;
            this.startFromRightInitialized = false;
            this._restartDelayRemaining = 0;
            this._resetFrameHistory();

            this._clearBackground();
            this.ctx.fillStyle = this.textColor;
            this.ctx.lineJoin = this.outlineJoin;
            const renderText = createTextRenderer(this.ctx, this.outlineColor, this.outlineWidth);
            const releaseClip = this._applyCrawlClip(this.ctx, bounds.inset);

            const translation = this._computeTopLeftTranslation(maxLineWidth, lines.length);
            this._runWithTopLeftTranslation(translation, () => {
                lines.forEach((line, index) => {
                    const verticalOffset = index - (lines.length - 1) / 2;
                    const y = this.offsetY + verticalOffset * (this.fontSize + 10);
                    renderText(line, this.offsetX, y);
                });
            });
            releaseClip();
        }

        pause() {
            this.isAnimating = false;
            this.lastTimestamp = null;
            this._restartDelayRemaining = 0;
        }

        unpause() {
            if (!this.isAnimating) {
                this.isAnimating = true;
                this.lastTimestamp = null;
                requestAnimationFrame((timestamp) => this.animate(timestamp));
            }
        }

        destroy() {
            this.isAnimating = false;
            this.lastTimestamp = null;
            this._restartDelayRemaining = 0;
            this._detachResponsiveViewportListener();
            this.container.removeChild(this.canvas);
            this.canvas = null;
            this.ctx = null;
            this._updateButtons(true);
        }

        animate(timestamp) {
            if (!this.isAnimating) return;

            const deltaMs = this._updateFrameTiming(timestamp);
            this._renderFrame({ deltaMs, advance: true });
            requestAnimationFrame((nextTimestamp) => this.animate(nextTimestamp));
        }
    }

    async function header_to_readable(rawHeader, tzLocal, tzName, endecMode) {
        const regex = window.EASREGEX;

        if (!regex.test(rawHeader.trim())) return null;

        if (tzLocal && tzName == '') {
            const eas = E2T(rawHeader, endecMode, false, tzLocal);
            return eas;
        }

        else {
            const eas = E2T(rawHeader, endecMode, false, tzName);
            return eas;
        }
    }

    function getRequestedCrawlDimensions() {
        const widthInput = document.getElementById('crawlWidth');
        const heightInput = document.getElementById('crawlHeight');
        const width = widthInput ? Math.round(Number(widthInput.value) / 2) * 2 : null;
        const height = heightInput ? Math.round(Number(heightInput.value) / 2) * 2 : null;
        widthInput.value = String(width);
        heightInput.value = String(height);
        return { width, height };
    }

    function applyCrawlSizeToGenerator(generator = window.crawlGenerator) {
        if (!generator) return;
        const { width, height } = getRequestedCrawlDimensions();
        generator.adjustSize(width, height);
    }

    function getFileFromInput(inputId) {
        const input = document.getElementById(inputId);
        if (!input || !input.files || !input.files[0]) {
            return null;
        }
        return input.files[0];
    }

    async function loadImageFromInput(inputId) {
        const file = getFileFromInput(inputId);
        if (!file) return null;
        return new Promise((resolve) => {
            const objectUrl = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(null);
            };
            img.src = objectUrl;
        });
    }

    function parseBackgroundSelectionValue(value) {
        if (typeof value !== 'string') {
            return null;
        }
        const colonIndex = value.indexOf(':');
        if (colonIndex <= 0) {
            return null;
        }
        const type = value.slice(0, colonIndex).trim();
        const source = value.slice(colonIndex + 1).trim();
        if (!source) {
            return null;
        }
        return { type, source };
    }

    function setNumericInputValue(id, value, options = {}) {
        const input = document.getElementById(id);
        if (!input || !Number.isFinite(value)) {
            return false;
        }
        const { allowZero = false } = options;
        const normalized = Math.round(value);
        if (!allowZero && normalized <= 0) {
            return false;
        }
        if (allowZero && normalized < 0) {
            return false;
        }
        const nextValue = String(normalized);
        if (input.value === nextValue) {
            return false;
        }
        input.value = nextValue;
        return true;
    }

    function getPremadeTopLeft(path) {
        const layout = PREMADE_BACKGROUND_LAYOUTS[path];
        const x = layout && layout.topLeft && Number(layout.topLeft.x);
        const y = layout && layout.topLeft && Number(layout.topLeft.y);
        return {
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0
        };
    }

    async function loadImageFromSource(src) {
        if (!src) return null;
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    async function loadMediaElementFromSource(type, source) {
        if (type === 'image') {
            return loadImageFromSource(source);
        }
        return null;
    }

    function updateCrawlControlsFromAsset(meta = {}, options = {}) {
        const generator = options.generator || window.crawlGenerator;
        const { width, height, inset, topLeft } = meta;
        let sizeAvailable = false;

        if (Number.isFinite(width) && width > 0) {
            setNumericInputValue('crawlWidth', width, { allowZero: false });
            sizeAvailable = true;
        }

        if (Number.isFinite(height) && height > 0) {
            setNumericInputValue('crawlHeight', height, { allowZero: false });
            sizeAvailable = true;
        }

        if (sizeAvailable) {
            applyCrawlSizeToGenerator(generator);
        }

        if (Number.isFinite(inset)) {
            setNumericInputValue('crawlInset', inset, { allowZero: true });
            if (generator) {
                generator.setCrawlInset(inset);
            }
        }

        if (topLeft && typeof topLeft === 'object') {
            if (Number.isFinite(topLeft.x)) {
                setNumericInputValue('crawlTopLeftPixelX', topLeft.x, { allowZero: true });
                if (generator) {
                    generator.setTopLeftOffsetX(topLeft.x);
                }
            }
            if (Number.isFinite(topLeft.y)) {
                setNumericInputValue('crawlTopLeftPixelY', topLeft.y, { allowZero: true });
                if (generator) {
                    generator.setTopLeftOffsetY(topLeft.y);
                }
            }
        }

        return sizeAvailable;
    }

    let premadeSizingRequestToken = 0;
    async function requestPremadeBackgroundSizing() {
        const premadeSelect = document.getElementById('crawlBackgroundPremadeSelect');
        if (!premadeSelect) return;
        const descriptor = parseBackgroundSelectionValue(premadeSelect.value);
        if (!descriptor) return;
        const requestId = ++premadeSizingRequestToken;
        let initialTopLeft;
        if (descriptor.source === 'easyplus_gray') {
            const eventCodeInput = document.getElementById('easyplusEventCode');
            const eventCode = eventCodeInput ? eventCodeInput.value : '';
            if (eventCode) {
                const usesTwoPlusLayout = await determineEasyplusMode2UsesTwoPlusLayout(eventCode);
                if (requestId !== premadeSizingRequestToken) {
                    return;
                }
                const layoutKey = usesTwoPlusLayout ? `${descriptor.source}_2plus` : descriptor.source;
                initialTopLeft = getPremadeTopLeft(layoutKey);
            } else {
                initialTopLeft = getPremadeTopLeft(descriptor.source);
            }
        } else {
            initialTopLeft = getPremadeTopLeft(descriptor.source);
        }

        if (descriptor.source === 'dasdec') {
            updateCrawlControlsFromAsset({
                width: DASDEC_RENDER_DIMENSIONS.width,
                height: DASDEC_RENDER_DIMENSIONS.height,
                topLeft: initialTopLeft
            });
            return;
        }

        updateCrawlControlsFromAsset({ topLeft: initialTopLeft });
        const media = await loadMediaElementFromSource(descriptor.type, descriptor.source);
        if (!media || requestId !== premadeSizingRequestToken) {
            return;
        }
        const modeSelect = document.getElementById('crawlBackgroundMode');
        if (!modeSelect || modeSelect.value !== 'premade') {
            return;
        }
        const width = media.naturalWidth;
        const height = media.naturalHeight;
        const topLeft = getPremadeTopLeft(descriptor.source);
        updateCrawlControlsFromAsset({ width, height, topLeft });
    }

    function mapEasyplusOriginatorToFullName(originator) {
        const originatorMap = window.entryPoints || {};
        const regex = /^(A|An|The) /gi;
        const regex2 = /rity$/gi;
        const source = (originator && originatorMap[originator]) ? originatorMap[originator] : originator;
        if (typeof source !== 'string') {
            return '';
        }
        return source.replace(regex, "").replace(regex2, "rities");
    }

    function mapEasyplusEventCodeToFullName(eventCode) {
        const eventCodeMap = window.events || {};
        const regex = /^national emergency/gi;
        const source = (eventCode && eventCodeMap[eventCode]) ? eventCodeMap[eventCode] : eventCode;
        if (typeof source !== 'string') {
            return '';
        }
        return source.replace(regex, "Emergency");
    }

    function splitTextIntoLines(text, maxWidth, ctx) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        words.forEach(word => {
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        });

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines;
    }

    let easyplusMode2MeasureContext = null;

    function getEasyplusMode2MeasureContext() {
        if (easyplusMode2MeasureContext && easyplusMode2MeasureContext.canvas) {
            return easyplusMode2MeasureContext;
        }
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        easyplusMode2MeasureContext = canvas.getContext('2d');
        return easyplusMode2MeasureContext;
    }

    async function determineEasyplusMode2UsesTwoPlusLayout(eventCodeInput) {
        await ensureFontsReady();
        const ctx = getEasyplusMode2MeasureContext();
        if (!ctx) {
            return false;
        }
        const fontSize = 84;
        const fontStyle = 'normal';
        const fontFamily = 'VCREAS_4.5';
        const sanitizedFontFamily = /[^a-zA-Z0-9_-]/.test(fontFamily)
            ? `"${fontFamily.replace(/(["\\])/g, '\\$1')}"`
            : fontFamily;
        const font = `${fontStyle} ${fontSize}px ${sanitizedFontFamily}`;
        await document.fonts.load(font);
        ctx.font = font;
        const normalizedInput = typeof eventCodeInput === 'string' ? eventCodeInput.trim() : '';
        const eventCode = mapEasyplusEventCodeToFullName(normalizedInput);
        if (!eventCode) {
            return false;
        }
        const lines = splitTextIntoLines(eventCode.trim(), ctx.canvas.width / 2 + 150, ctx);
        return lines.length > 1;
    }

    async function generateEasyPlusBackgroundImage(mode, originatorInput, eventCodeInput) {
        const originator = mapEasyplusOriginatorToFullName(originatorInput ? originatorInput.trim() : '').replace(/A Primary/gi, 'Primary');
        const eventCodeInputText = eventCodeInput ? eventCodeInput.trim() : '';
        const eventCode = mapEasyplusEventCodeToFullName(eventCodeInputText);
        const modeConfigs = {
            mode1: {
                background: '#000000',
                textColor: '#ababab',
                rendererFactory: null,
                offsets: { headline: -173, originator: -70, issued: -3, linesStart: 60 },
                lineSpacing: 120,
                markTwoPlusLines: false
            },
            mode2: {
                background: '#ababab',
                textColor: '#ffffff',
                rendererFactory: (ctx) => createTextRenderer(ctx, '#000000', 5),
                offsets: { headline: -173, originator: -100, issued: -30, linesStart: 40 },
                lineSpacing: 120,
                markTwoPlusLines: true
            }
        };
        const normalizedMode = (() => {
            if (mode === 2 || mode === '2') return 'mode2';
            if (typeof mode === 'string') {
                const lower = mode.toLowerCase();
                if (lower.includes('gray') || lower === 'mode2') {
                    return 'mode2';
                }
            }
            return 'mode1';
        })();
        const config = modeConfigs[normalizedMode] || modeConfigs.mode1;

        await ensureFontsReady();
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = config.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = config.textColor;

        const fontSize = 84;
        const fontStyle = 'normal';
        const fontFamily = 'VCREAS_4.5';
        const sanitizedFontFamily = /[^a-zA-Z0-9_-]/.test(fontFamily)
            ? `"${fontFamily.replace(/(["\\])/g, '\\$1')}"`
            : fontFamily;
        const font = `${fontStyle} ${fontSize}px ${sanitizedFontFamily}`;

        await document.fonts.load(font);

        ctx.font = font;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        const renderText = config.rendererFactory
            ? config.rendererFactory(ctx)
            : (text, x, y) => {
                if (text === undefined || text === null) return;
                const stringText = typeof text === 'string' ? text : String(text);
                if (!stringText) return;
                ctx.fillText(stringText, x, y);
            };

        const aOrAn = /^[AEIOU]/i.test(eventCode) ? ' an ' : ' a ';
        const offsetScale = fontSize / 36;
        const centerY = canvas.height / 2;
        const headlineText = eventCodeInputText.toUpperCase() === 'EAN' || eventCodeInputText.toUpperCase() === 'EAT'
            ? 'NATIONAL ALERT'
            : 'EMERGENCY ALERT SYSTEM';

        renderText(headlineText, canvas.width / 2, centerY + config.offsets.headline * offsetScale);
        renderText(originator.trim(), canvas.width / 2, centerY + config.offsets.originator * offsetScale);
        renderText(('Issued' + aOrAn).trim(), canvas.width / 2, centerY + config.offsets.issued * offsetScale);

        const eventCodeLines = splitTextIntoLines(eventCode.trim(), canvas.width / 2 + 150, ctx);
        eventCodeLines.forEach((line, index) => {
            renderText(line, canvas.width / 2, centerY + config.offsets.linesStart * offsetScale + index * config.lineSpacing);
        });

        const img = new Image();
        img.width = canvas.width;
        img.height = canvas.height;
        img.src = canvas.toDataURL('image/png');
        if (config.markTwoPlusLines) {
            img.isTwoPlusLines = eventCodeLines.length > 1;
        }
        return img;
    }

    function formatDasdecPages(rawText) {
        const maxLineLength = 35;
        const maxLinesPerPage = 14;

        const lines = rawText.replace(/; /g, ';\n').split('\n');
        const formattedLines = [];

        lines.forEach((line) => {
            const words = line.split(' ');
            let currentLine = '';

            words.forEach((word) => {
                if ((currentLine.length + word.length + 1) <= maxLineLength) {
                    currentLine += (currentLine ? ' ' : '') + word;
                } else {
                    formattedLines.push(currentLine);
                    currentLine = word;
                }
            });

            if (currentLine) {
                formattedLines.push(currentLine);
            }
        });

        const pages = [];
        const totalPages = Math.ceil(formattedLines.length / (maxLinesPerPage - 1));

        for (let i = 0; i < formattedLines.length; i += (maxLinesPerPage - 1)) {
            const pageContent = formattedLines.slice(i, i + (maxLinesPerPage - 1));
            while (pageContent.length < (maxLinesPerPage - 1)) {
                pageContent.push('');
            }
            pageContent.push(`${pages.length + 1}/${totalPages}`);
            pages.push(pageContent);
        }

        return pages;
    }

    async function formatDasdec(rawHeader, e2tMode) {
        let fullText = '';

        if (e2tMode === true) {
            const overrideTzInput = document.getElementById('crawlUseOverrideTZ');
            const timezoneOverride = overrideTzInput && overrideTzInput.value ? overrideTzInput.value : null;
            const formatted = E2T(rawHeader, 'DAS2PLUS', false, timezoneOverride);
            const formattedText = typeof formatted === 'string' ? formatted : String(formatted ?? '');
            const normalized = formattedText.replace(/\s+/g, ' ').trim();
            const dasdecMatch = normalized.match(/^(.*?)\s+has issued\s+(.*?)\s+for the following counties or areas:\s*([\s\S]*?)\s+at\s+(\d{1,2}:\d{2}\s*[AP]M)\s+on\s+([A-Za-z]{3}\s+\d{1,2},\s+\d{4})\s+Effective until\s+(\d{1,2}:\d{2}\s*[AP]M)(?:\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4})?\.\s*Message from\s+([^.\n]+)\.?$/i);

            if (dasdecMatch) {
                const originator = (dasdecMatch[1] || '').trim().toUpperCase();
                const rawEvent = (dasdecMatch[2] || '').trim().replace(/^(?:A|AN)\s+/i, '');
                const event = rawEvent.toUpperCase();
                const article = /^[AEIOU]/.test(event) ? 'AN' : 'A';
                const fips = (dasdecMatch[3] || '').trim().replace(/\s*;\s*/g, '; ').replace(/\s+/g, ' ');
                const startTime = (dasdecMatch[4] || '').trim().toUpperCase();
                const date = (dasdecMatch[5] || '').trim().toUpperCase();
                const endTime = (dasdecMatch[6] || '').trim().toUpperCase();
                const sender = (dasdecMatch[7] || '').trim().toUpperCase();

                fullText = `${originator}\nhas issued ${article} ${event}\nfor the following counties or areas:\n${fips}\nat ${startTime}\non ${date}\nEffective until ${endTime}.\nMessage from ${sender}.`;
            } else {
                fullText = formattedText;
            }
        }

        else {
            fullText = rawHeader;
        }

        const pages = formatDasdecPages(fullText);
        return pages;
    }

    async function generateDasdecScreenImage(headerText) {
        const canvas = document.createElement('canvas');
        canvas.width = DASDEC_RENDER_DIMENSIONS.width;
        canvas.height = DASDEC_RENDER_DIMENSIONS.height;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#2e3251';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#7a2f4c';
        const verticalScale = canvas.height / 480;
        ctx.lineWidth = Math.max(1, Math.round(10 * verticalScale));
        ctx.strokeRect(0, 0, canvas.width, canvas.height);

        const fontSize = Math.max(8, Math.round(28 * verticalScale));
        const fontStyle = 'normal';
        const fontFamily = 'Luxi Mono';
        const sanitizedFontFamily = /[^a-zA-Z0-9_-]/.test(fontFamily)
            ? `"${fontFamily.replace(/(["\\])/g, '\\$1')}"`
            : fontFamily;
        const font = `${fontStyle} ${fontSize}px ${sanitizedFontFamily}`;

        await ensureFontsReady();
        await document.fonts.load(font);

        ctx.font = font;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        const lines = headerText.flat();
        const lineHeight = fontSize + Math.max(1, Math.round(4 * verticalScale));
        let y = Math.max(0, Math.round(10 * verticalScale));

        const centerX = canvas.width / 2;
        lines.forEach((line) => {
            const textY = y + lineHeight / 2;
            ctx.fillText(line, centerX, textY);
            y += lineHeight;
        });

        const img = new Image();
        img.src = canvas.toDataURL('image/png');
        return img;
    }

    async function loadCrawlBackgroundAssets(mode) {
        if (mode !== 'premade') {
            stopDasdecRotationState();
            window.__dasdecBackground = null;
        }
        if (mode === 'image') {
            const image = await loadImageFromInput('crawlBackgroundImageFile');
            return {
                image,
                width: image ? image.naturalWidth : null,
                height: image ? image.naturalHeight : null
            };
        }

        if (mode === 'premade') {
            window.__dasdecBackground = null;
            const premadeSelect = document.getElementById('crawlBackgroundPremadeSelect');

            if (premadeSelect) {
                const descriptor = parseBackgroundSelectionValue(premadeSelect.value);
                if (descriptor) {
                    if (descriptor.source !== 'dasdec') {
                        stopDasdecRotationState();
                    }

                    if (descriptor.source !== 'easyplus' && descriptor.source !== 'easyplus_gray') {
                        const easyplusSettings = document.getElementById('easyplusSettings');
                        if (easyplusSettings) {
                            easyplusSettings.style.display = 'none';
                        }
                    }

                    if (descriptor && descriptor.type === 'image') {
                        const media = await loadMediaElementFromSource(descriptor.type, descriptor.source);
                        if (media) {
                            const topLeft = getPremadeTopLeft(descriptor.source);
                            return {
                                image: media,
                                width: media ? media.naturalWidth : null,
                                height: media ? media.naturalHeight : null,
                                topLeft,
                                source: descriptor.source
                            };
                        }
                    }

                    else if (descriptor.source === 'easyplus_gray') {
                        const originator = document.getElementById('easyplusOriginator').value;
                        const eventCode = document.getElementById('easyplusEventCode').value;
                        const [media, usesTwoPlusLayout] = await Promise.all([
                            generateEasyPlusBackgroundImage('mode2', originator, eventCode),
                            determineEasyplusMode2UsesTwoPlusLayout(eventCode)
                        ]);
                        if (media) {
                            const layoutKey = usesTwoPlusLayout ? `${descriptor.source}_2plus` : descriptor.source;
                            const topLeft = getPremadeTopLeft(layoutKey);
                            const width = media.naturalWidth || media.width || 1920;
                            const height = media.naturalHeight || media.height || 1080;
                            return {
                                image: media,
                                width,
                                height,
                                topLeft,
                                source: descriptor.source
                            };
                        }
                    }

                    else if (descriptor.source === 'easyplus') {
                        const easyplusSettings = document.getElementById('easyplusSettings');
                        easyplusSettings.style.display = 'block';
                        const originator = document.getElementById('easyplusOriginator').value;
                        const eventCode = document.getElementById('easyplusEventCode').value;
                        const media = await generateEasyPlusBackgroundImage('mode1', originator, eventCode);
                        if (media) {
                            const topLeft = getPremadeTopLeft(descriptor.source);
                            const width = media.naturalWidth || media.width || 1920;
                            const height = media.naturalHeight || media.height || 1080;
                            return {
                                image: media,
                                width,
                                height,
                                topLeft,
                                source: descriptor.source
                            };
                        }
                    }

                    else if (descriptor.source === 'dasdec') {
                        stopDasdecRotationState();
                        window.__dasdecBackground = null;
                        const rawHeader = document.getElementById('crawlMode').value === "header" ? document.getElementById('crawlRawHeader').value : document.getElementById('crawlText').value;
                        let pages = await formatDasdec(rawHeader, document.getElementById('crawlMode').value === "header" ? true : false);
                        pages = Array.isArray(pages) ? pages : [];

                        const renderedPages = (await Promise.all(pages.map((page) => generateDasdecScreenImage(page)))).filter(Boolean);

                        if (renderedPages.length) {
                            const rotationDelayMs = 4000;
                            const repetitionsEl = document.getElementById('crawlRepetitions');
                            const rawRepetitionInput = repetitionsEl ? Number(repetitionsEl.value) : 1;
                            const repetitions = Math.max(1, Math.min(10, Math.round(rawRepetitionInput || 1)));
                            const totalDisplays = repetitions * renderedPages.length;
                            const baseMedia = renderedPages[0];
                            const baseWidth = baseMedia
                                ? (baseMedia.naturalWidth || baseMedia.width || DASDEC_RENDER_DIMENSIONS.width)
                                : DASDEC_RENDER_DIMENSIONS.width;
                            const baseHeight = baseMedia
                                ? (baseMedia.naturalHeight || baseMedia.height || DASDEC_RENDER_DIMENSIONS.height)
                                : DASDEC_RENDER_DIMENSIONS.height;
                            const rotatingImage = new Image();
                            const waitForImageLoad = (image) => new Promise((resolve) => {
                                if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
                                    resolve();
                                    return;
                                }
                                image.addEventListener('load', resolve, { once: true });
                                image.addEventListener('error', resolve, { once: true });
                            });
                            rotatingImage.src = baseMedia.src;
                            await waitForImageLoad(rotatingImage);

                            const dasdecBackgroundMeta = {
                                pages: renderedPages,
                                rotationDelayMs,
                                repetitions,
                                totalDisplays,
                                width: baseWidth,
                                height: baseHeight
                            };
                            window.__dasdecBackground = dasdecBackgroundMeta;

                            const rotationState = {
                                timer: null,
                                delay: rotationDelayMs,
                                pages: renderedPages,
                                image: rotatingImage,
                                index: 0,
                                paused: false,
                                destroyed: false,
                                stop() {
                                    this.destroyed = true;
                                    this.paused = true;
                                    if (this.timer) {
                                        clearTimeout(this.timer);
                                        this.timer = null;
                                    }
                                },
                                pause() {
                                    if (this.paused) {
                                        return;
                                    }
                                    this.paused = true;
                                    if (this.timer) {
                                        clearTimeout(this.timer);
                                        this.timer = null;
                                    }
                                },
                                resume() {
                                    if (this.destroyed) {
                                        return;
                                    }
                                    const wasPaused = this.paused;
                                    this.paused = false;
                                    if (wasPaused || !this.timer) {
                                        this._scheduleNext();
                                    }
                                },
                                step(stepDelta) {
                                    if (!Array.isArray(this.pages) || !this.pages.length) {
                                        return;
                                    }
                                    const len = this.pages.length;
                                    if (len === 1) {
                                        this.index = 0;
                                        this.image.src = this.pages[0].src;
                                        return;
                                    }
                                    const delta = Number(stepDelta);
                                    if (!Number.isFinite(delta)) {
                                        return;
                                    }
                                    const normalized = ((Math.trunc(delta) % len) + len) % len;
                                    if (normalized === 0) {
                                        this._restartTimer();
                                        return;
                                    }
                                    this.index = (this.index + normalized) % len;
                                    this.image.src = this.pages[this.index].src;
                                    this._restartTimer();
                                },
                                _restartTimer() {
                                    if (this.timer) {
                                        clearTimeout(this.timer);
                                        this.timer = null;
                                    }
                                    this._scheduleNext();
                                },
                                _scheduleNext() {
                                    if (this.destroyed || this.paused || !Array.isArray(this.pages) || this.pages.length <= 1) {
                                        return;
                                    }
                                    this.timer = setTimeout(() => {
                                        if (this.destroyed || this.paused) {
                                            this.timer = null;
                                            return;
                                        }
                                        this.index = (this.index + 1) % this.pages.length;
                                        this.image.src = this.pages[this.index].src;
                                        this._scheduleNext();
                                    }, this.delay);
                                }
                            };

                            window.__dasdecRotationState = rotationState;
                            rotationState.resume();
                            const topLeft = getPremadeTopLeft(descriptor.source);
                            return {
                                image: rotatingImage,
                                width: baseWidth,
                                height: baseHeight,
                                topLeft,
                                source: descriptor.source
                            };
                        }
                        window.__dasdecBackground = null;
                    }
                }
            }
        }

        return { image: null, width: null, height: null };
    }

    function applyBackgroundToGenerator(generator, mode, assets) {
        if (!generator) return;
        const resolvedAssets = assets || {};
        generator.setBgImage(null);
        generator.setBgVideo(null);

        if (resolvedAssets.image && (mode === 'image' || mode === 'premade')) {
            generator.setBgImage(resolvedAssets.image);
        }
    }

    let crawlPaused = false;

    function setPauseButtonState(paused) {
        crawlPaused = Boolean(paused);
        const pauseButton = document.getElementById('pauseCrawl');
        if (pauseButton) {
            pauseButton.innerText = crawlPaused ? 'Unpause Crawl' : 'Pause Crawl';
        }
    }

    function handleFrameStep(step) {
        if (Number(step) >= 0) {
            stepDasdecRotationState(1);
            if (window.crawlGenerator) {
                window.crawlGenerator.getNextFrame();
            }
        } else {
            stepDasdecRotationState(-1);
            if (window.crawlGenerator) {
                window.crawlGenerator.getPrevFrame();
            }
        }
    }

    document.getElementById('startCrawl').addEventListener('click', async () => {
        const crawlDisplay = document.getElementById('crawlDisplay');
        const text = document.getElementById('crawlText').value;
        const rawHeader = document.getElementById('crawlRawHeader').value;
        const speed = document.getElementById('crawlSpeed').value;
        const fontSize = document.getElementById('crawlFontSize').value;
        const textColor = document.getElementById('crawlTextColor').value;
        let bgColor = document.getElementById('crawlBgColor').value;
        const crawlMode = document.getElementById('crawlMode').value;
        const useLocalTZ = document.getElementById('crawlUseLocalTZ').checked;
        const useOverrideTZ = document.getElementById('crawlUseOverrideTZ').value;
        const endecMode = document.getElementById('endecMode').value;
        const useVDSMode = document.getElementById('crawlUseVDSMode').checked;
        const vdsFrameDelay = document.getElementById('vdsFrameDelay').value;
        const parsedVdsDelay = Number(vdsFrameDelay);
        const normalizedVdsDelay = Number.isFinite(parsedVdsDelay) && parsedVdsDelay > 0 ? parsedVdsDelay : DEFAULT_VDS_BASE_DELAY;
        const fontFamily = document.getElementById('crawlFontFamily') ? document.getElementById('crawlFontFamily').value : 'Arial';
        const fontStyle = document.getElementById('crawlFontStyle') ? document.getElementById('crawlFontStyle').value : 'normal';
        const outlineColor = document.getElementById('crawlOutlineColor').value;
        const outlineWidth = document.getElementById('crawlOutlineWidth').value;
        const outlineJoin = document.getElementById('crawlOutlineJoin').value;
        const crawlWidth = document.getElementById('crawlWidth').value;
        const crawlHeight = document.getElementById('crawlHeight').value;
        const crawlInset = document.getElementById('crawlInset').value;
        const crawlRestartDelay = document.getElementById('crawlRestartDelay').value;
        const crawlBackgroundMode = document.getElementById('crawlBackgroundMode').value;
        const crawlBackgroundPremade = document.getElementById('crawlBackgroundPremadeSelect').value;
        const easyplusOriginator = document.getElementById('easyplusOriginator').value;
        const easyplusEventCode = document.getElementById('easyplusEventCode').value;
        let crawlTopLeftOffsetX = document.getElementById('crawlTopLeftPixelX').value;
        let crawlTopLeftOffsetY = document.getElementById('crawlTopLeftPixelY').value;
        const repetitions = document.getElementById('crawlRepetitions').value;
        const crawlKerning = document.getElementById('crawlKerning').value;

        if (crawlBackgroundMode === 'transparent') {
            bgColor = 'transparent';
        }

        let resolvedFontFamily = fontFamily;
        try {
            resolvedFontFamily = await resolveCrawlFontFamily(fontFamily);
        } catch (err) {
            if (fontFamily === USER_UPLOAD_FONT_FAMILY) {
                alert('Please select a valid custom font file (.ttf or .otf) before starting the crawl.');
                return;
            }
        }

        await ensureFontsReady();
        await document.fonts.load(`${fontStyle} ${fontSize}px "${resolvedFontFamily}"`);

        const backgroundAssets = await loadCrawlBackgroundAssets(crawlBackgroundMode);
        const isNewGenerator = !window.crawlGenerator;

        if (isNewGenerator) {
            window.crawlGenerator = new TextCrawlGenerator(crawlDisplay);
        }

        const generator = window.crawlGenerator;
        let appliedAutoSizing = false;
        if (crawlBackgroundMode === 'premade') {
            const autoMeta = {
                width: backgroundAssets.width,
                height: backgroundAssets.height,
                topLeft: backgroundAssets.topLeft
            };
            if (Number.isFinite(backgroundAssets.inset)) {
                autoMeta.inset = backgroundAssets.inset;
            }
            appliedAutoSizing = updateCrawlControlsFromAsset(autoMeta, { generator });
        }

        const topLeftXInput = document.getElementById('crawlTopLeftPixelX');
        const topLeftYInput = document.getElementById('crawlTopLeftPixelY');
        if (topLeftXInput && topLeftXInput.value !== undefined) {
            crawlTopLeftOffsetX = topLeftXInput.value;
        }
        if (topLeftYInput && topLeftYInput.value !== undefined) {
            crawlTopLeftOffsetY = topLeftYInput.value;
        }

        const settings = {
            text,
            speed,
            fontSize,
            textColor,
            bgColor,
            crawlMode,
            rawHeader: rawHeader && crawlMode === 'header' ? rawHeader : '',
            useLocalTZ,
            useOverrideTZ,
            endecMode,
            useVDSMode,
            vdsFrameDelay,
            fontFamily,
            fontStyle,
            outlineColor,
            outlineWidth,
            outlineJoin,
            crawlWidth,
            crawlHeight,
            crawlInset,
            crawlRestartDelay,
            crawlBackgroundMode,
            crawlBackgroundPremade,
            easyplusOriginator,
            easyplusEventCode,
            crawlTopLeftOffsetX,
            crawlTopLeftOffsetY,
            repetitions,
            crawlKerning
        };

        localStorage.setItem(localStorageKey, JSON.stringify(settings));

        if (!appliedAutoSizing) {
            applyCrawlSizeToGenerator(generator);
        }

        applyBackgroundToGenerator(generator, crawlBackgroundMode, backgroundAssets);

        if (rawHeader && crawlMode === 'header') {
            let readable = await header_to_readable(rawHeader, useLocalTZ, useOverrideTZ, endecMode);

            if (readable !== null) {
                generator.setText(readable);
            }
            else {
                alert('Invalid EAS Header Format. Please check your input.');
                return;
            }
        }

        else {
            if (isNewGenerator && (!text || text.trim() === '')) {
                alert('Please enter crawl text or a valid EAS header.');
                return;
            }

            generator.setText(text);
        }

        if (backgroundAssets.image) {
            generator.setBgColor('rgba(0,0,0,0)');
            generator.setTopLeftOffsetX(crawlTopLeftOffsetX);
            generator.setTopLeftOffsetY(crawlTopLeftOffsetY);
        }
        generator.setSpeed(speed);
        generator.setFontSize(fontSize);
        generator.setTextColor(textColor);
        generator.setBgColor(bgColor === 'transparent' ? 'rgba(0,0,0,0)' : bgColor);
        generator.setFontFamily(resolvedFontFamily);
        generator.setFontStyle(fontStyle);
        generator.setOutlineColor(outlineColor);
        generator.setOutlineWidth(outlineWidth);
        generator.setOutlineJoin(outlineJoin);
        generator.setCrawlInset(crawlInset);
        generator.setCrawlRestartDelay(crawlRestartDelay);
        generator.vdsBaseDelayFrames = normalizedVdsDelay;
        generator.setVDSMode(useVDSMode);
        generator.setRepetitions(repetitions);
        generator.setKerning(crawlKerning);
        setPauseButtonState(false);
        resumeDasdecRotationState();
        window.crawlGenerator._updateButtons(false);
        generator.start();
    });

    document.getElementById('stopCrawl').addEventListener('click', () => {
        if (!window.crawlGenerator) return;
        stopDasdecRotationState();
        window.crawlGenerator.stop();
        setPauseButtonState(false);
    });

    document.getElementById('pauseCrawl').addEventListener('click', () => {
        if (!window.crawlGenerator) return;
        const shouldPause = !crawlPaused;
        setPauseButtonState(shouldPause);
        if (shouldPause) {
            window.crawlGenerator.pause();
            pauseDasdecRotationState();
        }
        else {
            window.crawlGenerator.unpause();
            resumeDasdecRotationState();
        }
    });

    const nextFrameButton = document.getElementById('nextFrame');
    if (nextFrameButton) {
        nextFrameButton.addEventListener('click', () => handleFrameStep(1));
    }

    const prevFrameButton = document.getElementById('prevFrame');
    if (prevFrameButton) {
        prevFrameButton.addEventListener('click', () => handleFrameStep(-1));
    }

    document.getElementById('exportCrawlGIF').addEventListener('click', () => {
        if (window.crawlGenerator) {
            exportAsGIF(window.crawlGenerator.canvas, 'text_crawl.gif');
        }
        else {
            alert('Please start the crawl before exporting.');
        }
    });

    document.getElementById('exportCrawlVideo').addEventListener('click', () => {
        if (window.crawlGenerator) {
            exportAsWebM(window.crawlGenerator.canvas, null);
        }
        else {
            alert('Please start the crawl before exporting.');
        }
    });

    document.getElementById('crawlMode').addEventListener('change', (event) => {
        const mode = event.target.value;
        const rawHeaderClassItems = document.getElementsByClassName('crawl-raw-header');
        const crawlTextClassItems = document.getElementsByClassName('crawl-text');

        if (mode === 'header') {
            Array.from(rawHeaderClassItems).forEach((el) => {
                el.style.display = 'inline-block';
            });
            Array.from(crawlTextClassItems).forEach((el) => {
                el.style.display = 'none';
            });
            document.getElementById('E2TOptions').style.display = 'block';
        }

        else {
            Array.from(rawHeaderClassItems).forEach((el) => {
                el.style.display = 'none';
            });
            Array.from(crawlTextClassItems).forEach((el) => {
                el.style.display = 'inline-block';
            });
            document.getElementById('E2TOptions').style.display = 'none';
        }
    });

    document.getElementById('crawlUseLocalTZ').addEventListener('change', (event) => {
        const useLocalTZ = event.target.checked;
        const crawlUseOverrideTZElements = document.getElementsByClassName('crawlOverrideTZ');

        if (useLocalTZ) {
            Array.from(crawlUseOverrideTZElements).forEach((el) => {
                el.style.display = 'none';
            });
        }

        else {
            Array.from(crawlUseOverrideTZElements).forEach((el) => {
                el.style.display = 'inline-block';
            });
        }
    });

    document.getElementById('crawlUseOverrideTZ').addEventListener('change', (event) => {
        const overrideTZ = event.target.value;

        if (overrideTZ != '') {
            document.getElementById('crawlUseLocalTZ').checked = false;
            document.getElementById('crawlUseLocalTZ').disabled = true;

            const crawlUseLocalTZElements = document.getElementsByClassName('localTZ');
            Array.from(crawlUseLocalTZElements).forEach((el) => {
                el.style.display = 'none';
            });

            const crawlUseOverrideTZElements = document.getElementsByClassName('crawlOverrideTZ');
            Array.from(crawlUseOverrideTZElements).forEach((el) => {
                el.style.display = 'inline-block';
            });
        }

        else {
            document.getElementById('crawlUseLocalTZ').disabled = false;

            const crawlUseLocalTZElements = document.getElementsByClassName('localTZ');
            Array.from(crawlUseLocalTZElements).forEach((el) => {
                el.style.display = 'inline-block';
            });
        }
    });

    document.getElementById('copyCrawlText').addEventListener('click', async () => {
        if (!window.crawlGenerator) {
            alert('Please start the crawl before copying text.');
            return;
        }

        const crawlModeSelect = document.getElementById('crawlMode');
        const backgroundModeSelect = document.getElementById('crawlBackgroundMode');
        const premadeSelect = document.getElementById('crawlBackgroundPremadeSelect');
        const usingHeaderMode = crawlModeSelect && crawlModeSelect.value === 'header';
        const usingDasdecBackground = backgroundModeSelect
            && backgroundModeSelect.value === 'premade'
            && premadeSelect
            && premadeSelect.value.includes('dasdec');

        let textToCopy = window.crawlGenerator.getCrawlText() || '';

        if (usingHeaderMode && usingDasdecBackground) {
            const rawHeader = document.getElementById('crawlRawHeader').value;
            if (!rawHeader) {
                alert('Please provide an EAS header before copying DASDEC text.');
                return;
            }
            try {
                const pages = await formatDasdecEAS2Text(rawHeader);
                if (Array.isArray(pages) && pages.length) {
                    const formattedPages = pages.map((page) => {
                        if (Array.isArray(page)) {
                            return page.join('\n').trimEnd();
                        }
                        if (page && typeof page === 'object' && typeof page.flat === 'function') {
                            return page.flat().join('\n').trimEnd();
                        }
                        return String(page || '').trimEnd();
                    });
                    textToCopy = formattedPages.join('\n\n').trim();
                }
            } catch (error) {
                console.error('Failed to format DASDEC text for copying:', error);
                addStatus('Failed to format DASDEC text. Falling back to displayed crawl text.', 'WARN');
            }
        }

        try {
            await navigator.clipboard.writeText(textToCopy);
            addStatus(usingHeaderMode && usingDasdecBackground
                ? 'Formatted DASDEC text copied to clipboard!'
                : 'Crawl text copied to clipboard!');
        } catch (err) {
            alert('Failed to copy text: ' + err);
            addStatus('Failed to copy text: ' + err, 'ERROR');
        }
    });

    document.getElementById('crawlBackgroundMode').addEventListener('change', (event) => {
        const mode = event.target.value;
        const bgColorInput = document.getElementById('crawlBgColor');
        const crawlBackgroundColorDiv = document.getElementById('crawlBackgroundColorDiv');
        const crawlBackgroundImageDiv = document.getElementById('crawlBackgroundImageDiv');
        const crawlBackgroundPremadeDiv = document.getElementById('crawlBackgroundPremadeDiv');
        const crawlGetAndSetDiv = document.getElementById('crawlGetAndSetDiv');
        const showGetSetControls = mode === 'image';

        if (crawlGetAndSetDiv) {
            crawlGetAndSetDiv.style.display = showGetSetControls ? 'block' : 'none';
        }

        crawlBackgroundImageDiv.style.display = 'none';
        crawlBackgroundColorDiv.style.display = 'none';
        if (crawlBackgroundPremadeDiv) {
            crawlBackgroundPremadeDiv.style.display = 'none';
        }

        if (mode === 'image') {
            bgColorInput.disabled = true;
            crawlBackgroundImageDiv.style.display = 'block';
        }

        else if (mode === 'solid') {
            bgColorInput.disabled = false;
            crawlBackgroundColorDiv.style.display = 'block';
        }

        else if (mode === 'premade') {
            bgColorInput.disabled = true;
            if (crawlBackgroundPremadeDiv) {
                crawlBackgroundPremadeDiv.style.display = 'block';
            }
            requestPremadeBackgroundSizing();
        }

        else {
            bgColorInput.disabled = true;
        }
    });

    const destroyInstanceButton = document.getElementById('destroyCrawl');
    if (destroyInstanceButton) {
        destroyInstanceButton.addEventListener('click', () => {
            stopDasdecRotationState();
            if (window.crawlGenerator) {
                window.crawlGenerator.destroy();
                window.crawlGenerator = null;
                setPauseButtonState(false);
                addStatus('Crawl generator instance destroyed.');
                destroyInstanceButton.disabled = true;
            } else {
                addStatus('No crawl generator instance to destroy.', 'WARNING');
            }
        });
    }

    const crawlBackgroundPremadeSelect = document.getElementById('crawlBackgroundPremadeSelect');
    if (crawlBackgroundPremadeSelect) {
        crawlBackgroundPremadeSelect.addEventListener('change', () => {
            const modeSelect = document.getElementById('crawlBackgroundMode');
            if (modeSelect && modeSelect.value === 'premade') {
                requestPremadeBackgroundSizing();
            }
        });
    }

    const crawlGetAndSetButton = document.getElementById('crawlGetAndSetWH');
    if (crawlGetAndSetButton) {
        crawlGetAndSetButton.addEventListener('click', async () => {
            const modeSelect = document.getElementById('crawlBackgroundMode');
            if (!modeSelect) return;
            const mode = modeSelect.value;
            if (mode !== 'image') {
                alert('Select a custom image background before syncing dimensions.');
                return;
            }
            const media = await loadImageFromInput('crawlBackgroundImageFile');
            if (!media) {
                alert('Please choose a background file first.');
                return;
            }
            const width = Math.round(media.naturalWidth / 2) * 2;
            const height = Math.round(media.naturalHeight / 2) * 2;
            if (!width || !height) {
                alert('Unable to determine media dimensions.');
                return;
            }
            updateCrawlControlsFromAsset({ width, height });
        });
    }

    ['crawlWidth', 'crawlHeight'].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        const handler = () => applyCrawlSizeToGenerator();
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
    });

    function setCustomFontUploadVisibility(show) {
        document.querySelectorAll('.customFontUpload').forEach((el) => {
            el.style.display = show ? 'block' : 'none';
        });
    }

    function syncCustomFontUploadVisibility() {
        const fontFamilyInput = document.getElementById('crawlFontFamily');
        if (!fontFamilyInput) {
            return;
        }
        setCustomFontUploadVisibility(fontFamilyInput.value === 'User-Upload');
    }

    const CRAWL_SETTING_PREFIXES = ['crawl', 'easyplus', 'vds'];
    const CRAWL_SETTING_EXPLICIT_IDS = new Set(['endecMode']);
    const CRAWL_SETTING_EXCLUDED_IDS = new Set(['crawlUserPreset']);
    const LEGACY_CRAWL_SETTING_ID_MAP = {
        crawlText: 'text',
        crawlSpeed: 'speed',
        crawlFontSize: 'fontSize',
        crawlTextColor: 'textColor',
        crawlBgColor: 'bgColor',
        crawlMode: 'crawlMode',
        crawlRawHeader: 'rawHeader',
        crawlUseLocalTZ: 'useLocalTZ',
        crawlUseOverrideTZ: 'useOverrideTZ',
        endecMode: 'endecMode',
        crawlUseVDSMode: 'useVDSMode',
        vdsFrameDelay: 'vdsFrameDelay',
        crawlFontFamily: 'fontFamily',
        crawlFontStyle: 'fontStyle',
        crawlOutlineColor: 'outlineColor',
        crawlOutlineWidth: 'outlineWidth',
        crawlOutlineJoin: 'outlineJoin',
        crawlWidth: 'crawlWidth',
        crawlHeight: 'crawlHeight',
        crawlInset: 'crawlInset',
        crawlRestartDelay: 'crawlRestartDelay',
        crawlBackgroundMode: 'crawlBackgroundMode',
        crawlBackgroundPremadeSelect: 'crawlBackgroundPremade',
        easyplusOriginator: 'easyplusOriginator',
        easyplusEventCode: 'easyplusEventCode',
        crawlTopLeftPixelX: 'crawlTopLeftOffsetX',
        crawlTopLeftPixelY: 'crawlTopLeftOffsetY',
        crawlRepetitions: 'repetitions'
    };
    const pendingSelectValueObservers = new WeakMap();

    function shouldPersistCrawlSetting(element) {
        if (!element || !element.id) {
            return false;
        }
        if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) {
            return false;
        }
        if (element.type === 'file' || CRAWL_SETTING_EXCLUDED_IDS.has(element.id)) {
            return false;
        }
        if (CRAWL_SETTING_EXPLICIT_IDS.has(element.id)) {
            return true;
        }
        return CRAWL_SETTING_PREFIXES.some((prefix) => element.id.startsWith(prefix));
    }

    function getPersistedCrawlSettingElements() {
        const panel = document.getElementById('crawl-panel');
        if (!panel) {
            return [];
        }
        const nodes = panel.querySelectorAll('input[id], select[id], textarea[id]');
        return Array.from(nodes).filter(shouldPersistCrawlSetting);
    }

    function clearPendingSelectObserver(element) {
        if (!element) {
            return;
        }
        delete element.dataset.pendingValue;
        const observer = pendingSelectValueObservers.get(element);
        if (observer) {
            observer.disconnect();
            pendingSelectValueObservers.delete(element);
        }
    }

    function stashPendingSelectValue(element, value) {
        if (!element) {
            return;
        }
        element.dataset.pendingValue = value;
        if (pendingSelectValueObservers.has(element)) {
            return;
        }
        const observer = new MutationObserver(() => {
            const pendingValue = element.dataset.pendingValue;
            if (!pendingValue) {
                observer.disconnect();
                pendingSelectValueObservers.delete(element);
                return;
            }
            const optionExists = Array.from(element.options || []).some((option) => option.value === pendingValue);
            if (optionExists) {
                element.value = pendingValue;
                delete element.dataset.pendingValue;
                observer.disconnect();
                pendingSelectValueObservers.delete(element);
            }
        });
        observer.observe(element, { childList: true });
        pendingSelectValueObservers.set(element, observer);
    }

    function applyValueToCrawlElement(element, value) {
        if (!element) {
            return;
        }
        if (element.type === 'checkbox') {
            element.checked = Boolean(value);
            return;
        }
        if (value === undefined || value === null) {
            return;
        }
        if (element.tagName === 'SELECT') {
            const normalizedValue = String(value);
            const options = Array.from(element.options || []);
            if (!options.length || !options.some((option) => option.value === normalizedValue)) {
                stashPendingSelectValue(element, normalizedValue);
                return;
            }
            element.value = normalizedValue;
            clearPendingSelectObserver(element);
            return;
        }
        element.value = value;
    }

    function migrateLegacyCrawlSettings(settings) {
        if (!settings || typeof settings !== 'object') {
            return {};
        }
        const normalized = { ...settings };
        Object.entries(LEGACY_CRAWL_SETTING_ID_MAP).forEach(([domId, legacyKey]) => {
            if (Object.prototype.hasOwnProperty.call(normalized, domId)) {
                return;
            }
            if (Object.prototype.hasOwnProperty.call(normalized, legacyKey)) {
                normalized[domId] = normalized[legacyKey];
            }
        });
        return normalized;
    }

    const savedSettings = localStorage.getItem(localStorageKey);

    const applySettingsToControls = (settings, { showStatus = true } = {}) => {
        const migrated = migrateLegacyCrawlSettings(settings);
        const elements = getPersistedCrawlSettingElements();
        elements.forEach((element) => {
            const id = element.id;
            if (!(id in migrated)) {
                return;
            }
            applyValueToCrawlElement(element, migrated[id]);
        });
        const backgroundModeInput = document.getElementById('crawlBackgroundMode');
        if (backgroundModeInput && migrated.crawlBackgroundMode !== undefined) {
            backgroundModeInput.value = normalizeCrawlBackgroundMode(migrated.crawlBackgroundMode);
        }

        const fontFamilyInput = document.getElementById('crawlFontFamily');
        if (fontFamilyInput && migrated.crawlFontFamily) {
            ensureFontsReady().then(() => {
                const savedFontFamily = String(migrated.crawlFontFamily);
                const optionExists = Array.from(fontFamilyInput.options || []).some((option) => option.value === savedFontFamily);
                const useUserUpload = savedFontFamily === 'User-Upload' || !optionExists;
                applyValueToCrawlElement(fontFamilyInput, useUserUpload ? 'User-Upload' : savedFontFamily);
                setCustomFontUploadVisibility(useUserUpload);
            });
        }

        const refreshSavedCrawlControls = () => {
            const crawlUseLocalTZ = document.getElementById('crawlUseLocalTZ');
            const crawlUseOverrideTZ = document.getElementById('crawlUseOverrideTZ');
            const crawlBackgroundMode = document.getElementById('crawlBackgroundMode');
            const crawlTextSource = document.getElementById('crawlMode');
            if (!crawlUseLocalTZ || !crawlUseOverrideTZ || !crawlBackgroundMode || !crawlTextSource) {
                return;
            }

            ['change'].forEach((eventName) => {
                [crawlUseLocalTZ, crawlUseOverrideTZ, crawlBackgroundMode, crawlTextSource].forEach((element) => {
                    element.dispatchEvent(new Event(eventName, { bubbles: true }));
                });
            });
        };

        const ensurePremadeSizing = () => {
            const modeSelect = document.getElementById('crawlBackgroundMode');
            if (modeSelect && modeSelect.value === 'premade') {
                requestPremadeBackgroundSizing();
            }
        };

        const runSavedControlRefresh = () => {
            refreshSavedCrawlControls();
            ensurePremadeSizing();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', runSavedControlRefresh, { once: true });
        } else {
            runSavedControlRefresh();
        }

        if (showStatus) {
            addStatus('Loaded saved crawl settings!');
        }
    };

    if (savedSettings) {
        applySettingsToControls(JSON.parse(savedSettings));
    }

    const _crawlPreviewCanvas = document.getElementById('crawlPreview');
    const _crawlPreviewCtx = _crawlPreviewCanvas ? _crawlPreviewCanvas.getContext('2d') : null;
    let _crawlPreviewScheduled = false;

    async function updateCrawlPreview() {
        if (!_crawlPreviewCtx) return;

        const canvas = _crawlPreviewCanvas;
        const ctx = _crawlPreviewCtx;

        const text = 'Preview';
        const fontSize = Math.max(1, Number(document.getElementById('crawlFontSize').value) || 24);
        const textColor = document.getElementById('crawlTextColor').value || '#FFFFFF';
        const bgColor = document.getElementById('crawlBgColor').value || '#000000';
        const bgMode = document.getElementById('crawlBackgroundMode').value;
        const fontFamilyRaw = document.getElementById('crawlFontFamily')
            ? document.getElementById('crawlFontFamily').value : 'Arial';
        const fontStyle = document.getElementById('crawlFontStyle')
            ? document.getElementById('crawlFontStyle').value : 'normal';
        const outlineColor = document.getElementById('crawlOutlineColor').value || '';
        const outlineWidth = Number(document.getElementById('crawlOutlineWidth').value) || 0;
        const outlineJoin = document.getElementById('crawlOutlineJoin').value || 'round';
        const kerning = Number(document.getElementById('crawlKerning').value) || 0;

        let fontFamily = fontFamilyRaw;
        if (fontFamilyRaw === USER_UPLOAD_FONT_FAMILY) {
            try {
                fontFamily = await resolveCrawlFontFamily(fontFamilyRaw);
            } catch (_) {
                fontFamily = 'Arial';
            }
        }

        await document.fonts.load(`${fontStyle} ${fontSize}px "${fontFamily}"`);

        if (bgMode === 'transparent') {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        } else {
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        ctx.font = `${fontStyle} ${fontSize}px "${fontFamily}"`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillStyle = textColor;
        ctx.lineJoin = outlineJoin;

        const kerningPx = (kerning / 100) * fontSize;
        ctx.letterSpacing = `${kerningPx}px`;

        const renderText = createTextRenderer(ctx, outlineColor, outlineWidth);
        const lines = (text || '').split('\n');
        const lineHeight = fontSize + 10;
        const totalTextHeight = lines.length * lineHeight;
        const startY = (canvas.height - totalTextHeight) / 2 + lineHeight / 2;

        lines.forEach((line, index) => {
            const y = startY + index * lineHeight;
            renderText(line, canvas.width / 2, y);
        });

        ctx.letterSpacing = '0px';
    }

    function scheduleCrawlPreview() {
        if (_crawlPreviewScheduled) return;
        _crawlPreviewScheduled = true;
        requestAnimationFrame(() => {
            _crawlPreviewScheduled = false;
            updateCrawlPreview();
        });
    }

    const _previewInputIds = [
        'crawlText', 'crawlTextColor', 'crawlFontSize', 'crawlFontFamily',
        'crawlFontStyle', 'crawlOutlineColor', 'crawlOutlineWidth',
        'crawlOutlineJoin', 'crawlBgColor', 'crawlBackgroundMode',
        'crawlKerning', 'crawlCustomFontFile'
    ];

    _previewInputIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', scheduleCrawlPreview);
        el.addEventListener('change', scheduleCrawlPreview);
    });

    ensureFontsReady().then(scheduleCrawlPreview);

    function parseEASHeaderAndUpdateEasyPlusSettings(rawHeader) {
        const regex = window.EASREGEX;
        const match = regex.exec(rawHeader.trim());

        if (!match) {
            return;
        }

        const originatorCode = match[1];
        const eventCode = match[2];

        const originatorInput = document.getElementById('easyplusOriginator');
        const eventCodeInput = document.getElementById('easyplusEventCode');

        if (originatorInput) {
            originatorInput.value = originatorCode;
        }

        if (eventCodeInput) {
            eventCodeInput.value = eventCode;
        }
    }

    const initializeRawHeaderInput = () => {
        const headerInput = document.getElementById('crawlRawHeader');
        if (!headerInput) {
            return false;
        }

        const parseHeader = () => {
            parseEASHeaderAndUpdateEasyPlusSettings(headerInput.value);
        };

        headerInput.addEventListener('blur', parseHeader);

        const originatorSelect = document.getElementById('easyplusOriginator');
        const eventSelect = document.getElementById('easyplusEventCode');

        const attemptInitialParse = () => {
            if (!originatorSelect || !eventSelect) {
                return false;
            }
            if (!originatorSelect.options.length || !eventSelect.options.length) {
                return false;
            }
            parseHeader();
            return true;
        };

        if (!attemptInitialParse()) {
            const targets = [originatorSelect, eventSelect].filter(Boolean);
            if (targets.length) {
                const observer = new MutationObserver(() => {
                    if (attemptInitialParse()) {
                        observer.disconnect();
                    }
                });
                targets.forEach((target) => observer.observe(target, { childList: true }));
            }
        }

        return true;
    };

    function getCurrentSettings() {
        const collected = {};
        getPersistedCrawlSettingElements().forEach((element) => {
            if (!element.id) {
                return;
            }
            if (element.type === 'checkbox') {
                collected[element.id] = element.checked;
            } else {
                collected[element.id] = element.value;
            }
        });
        return collected;
    }

    if (!initializeRawHeaderInput() && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeRawHeaderInput, { once: true });
    }

    const crawlFontFamilyInput = document.getElementById('crawlFontFamily');
    if (crawlFontFamilyInput) {
        crawlFontFamilyInput.addEventListener('change', syncCustomFontUploadVisibility);
        ensureFontsReady().then(syncCustomFontUploadVisibility);
    }

    const endecModeSelect = document.getElementById('endecMode');
    if (endecModeSelect) {
        function populateEndecModes() {
            const currentValue = endecModeSelect.value;
            const modes = allEndecModes().filter((mode) => mode.toLowerCase() !== 'json');
            endecModeSelect.length = 0;
            endecModeSelect.add(new Option('None (Default)', ''));
            for (let i = 0; i < modes.length; i++) {
                const mode = modes[i];
                endecModeSelect.add(new Option(mode, mode));
            }
            endecModeSelect.value = modes.includes(currentValue) ? currentValue : '';
        }
        resourcesReady.then(populateEndecModes).catch(() => populateEndecModes());
    }

    document.getElementById('crawlBackgroundPremadeSelect').addEventListener('change', (event) => {
        const easyplusSettings = document.getElementById('easyplusSettings');
        if (event.target.value.includes('easyplus')) {
            easyplusSettings.style.display = 'block';
        } else {
            easyplusSettings.style.display = 'none';
        }
    });

    document.getElementById('crawlBackgroundPremadeSelect').dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('saveUserPreset').addEventListener('click', () => {
        const presetData = getCurrentSettings();
        const presetNumber = document.getElementById('crawlUserPreset').value;
        if (presetNumber !== null) {
            localStorage.setItem(`crawlPreset_${presetNumber}`, JSON.stringify(presetData));
            alert(`Preset #${presetNumber} saved!`);
        }
    });

    document.getElementById('loadUserPreset').addEventListener('click', () => {
        const presetNumber = document.getElementById('crawlUserPreset').value;
        const presetData = localStorage.getItem(`crawlPreset_${presetNumber}`);
        if (presetData) {
            const settings = JSON.parse(presetData);
            applySettingsToControls(settings, { showStatus: false });
            alert(`Preset #${presetNumber} loaded! Please click "Start Crawl" to apply the preset.`);
        } else {
            alert(`No preset found for #${presetNumber}.`);
        }
    });

    document.getElementById('crawlMode').addEventListener('change', async (event) => {
        if (event.target.value == 'custom' && !window.crawlEditor) {
            await initCrawlEditor();
        }
    });

    if (window.EASBridge) {
        function sendEndecModesToNative() {
            const modes = allEndecModes().filter((mode) => mode.toLowerCase() !== 'json');
            const modeList = [{ value: '', label: 'None (Default)' }];
            modes.forEach(m => modeList.push({ value: m, label: m }));
            window.EASBridge.send('crawl:endecModes', { modes: modeList });
        }
        resourcesReady.then(sendEndecModesToNative).catch(() => sendEndecModesToNative());

        window.EASBridge.on('crawl:convertHeader', async (params) => {
            const rawHeader = params?.header;
            if (!rawHeader) return;
            try {
                const endecMode = params?.endecMode || null;
                const text = await header_to_readable(rawHeader, false, '', endecMode);
                window.EASBridge.send('crawl:headerConverted', { text: text || '' });

                try {
                    const dasdecPages = await formatDasdec(rawHeader, true);
                    if (dasdecPages && dasdecPages.length) {
                        const flatText = dasdecPages.map(page => {
                            return page.slice(0, -1).filter(l => l !== '').join('\n');
                        }).join('\n');
                        window.EASBridge.send('crawl:dasdecFormatted', { text: flatText });
                    }
                } catch (e) { /* DASDEC formatting optional */ }
            } catch (err) {
                console.error('[EASBridge] crawl:convertHeader error:', err);
                window.EASBridge.send('crawl:headerConverted', { text: '' });
            }
        });

        window.EASBridge.on('crawl:export', async (params) => {
            try {
                const format = params?.format || 'gif';

                const el = (id) => document.getElementById(id);
                const setVal = (id, val) => { if (el(id) && val != null) el(id).value = val; };
                const setChk = (id, val) => { if (el(id) && val != null) el(id).checked = val; };

                setVal('crawlText', params.text || '');
                setVal('crawlSpeed', params.speed);
                setVal('crawlFontSize', params.fontSize);
                setVal('crawlTextColor', params.textColor);
                setVal('crawlBgColor', params.bgColor);
                setVal('crawlFontFamily', params.fontFamily);
                setVal('crawlFontStyle', params.fontStyle);
                setVal('crawlWidth', params.width);
                setVal('crawlHeight', params.height);
                setVal('crawlInset', params.inset);
                setVal('crawlOutlineColor', params.outlineColor);
                setVal('crawlOutlineWidth', params.outlineWidth);
                setVal('crawlRestartDelay', params.restartDelay);
                setVal('crawlBackgroundMode', params.bgMode || 'solid');
                setChk('crawlUseVDSMode', params.vdsMode);
                setVal('vdsFrameDelay', params.vdsFrameDelay);
                setVal('crawlMode', 'custom');
                setVal('crawlRepetitions', params.repetitions);

                const startBtn = el('startCrawl');
                if (startBtn) {
                    startBtn.click();
                    await new Promise(r => setTimeout(r, 1500));
                }

                if (!window.crawlGenerator) {
                    window.EASBridge.send('crawl:exportComplete', {});
                    return;
                }

                const bgSrc = params.bgImageURL || (params.bgImageData ? 'data:image/jpeg;base64,' + params.bgImageData : null);
                if (bgSrc && params.bgMode === 'image') {
                    const bgImg = new Image();
                    await new Promise((resolve) => {
                        bgImg.onload = resolve;
                        bgImg.onerror = resolve;
                        bgImg.src = bgSrc;
                    });
                    window.crawlGenerator.setBgImage(bgImg);
                }

                window.crawlGenerator.msPerFrame = 1000 / 60;

                const progressBar = document.getElementById('crawlExportProgress');
                const progressLabel = document.getElementById('crawlExportProgressLabel');
                let progressObserver = null;
                if (progressBar) {
                    progressObserver = new MutationObserver(() => {
                        const val = parseFloat(progressBar.value) || 0;
                        const max = parseFloat(progressBar.max) || 1;
                        window.EASBridge.send('crawl:exportProgress', { progress: val / max });
                    });
                    progressObserver.observe(progressBar, { attributes: true });
                }

                const progressDiv = document.getElementById('crawlExportProgressDiv');
                let doneObserver = null;
                if (progressDiv) {
                    doneObserver = new MutationObserver(() => {
                        if (progressDiv.style.display === 'none' || progressDiv.style.display === '') {
                            window.EASBridge.send('crawl:exportComplete', {});
                            if (progressObserver) progressObserver.disconnect();
                            if (doneObserver) doneObserver.disconnect();
                        }
                    });
                    doneObserver.observe(progressDiv, { attributes: true, attributeFilter: ['style'] });
                }

                if (format === 'gif') {
                    exportAsGIF(window.crawlGenerator.canvas, 'text_crawl.gif');
                } else {
                    exportAsWebM(window.crawlGenerator.canvas, null);
                }
            } catch (err) {
                console.error('[EASBridge] crawl:export error:', err);
                window.EASBridge.send('crawl:exportComplete', {});
            }
        });

        window.EASBridge.on('crawl:cancelExport', () => {
            const btn = document.getElementById('cancelCrawlExport');
            if (btn && !btn.disabled) btn.click();
        });

        window.EASBridge.on('crawl:requestData', () => {
            resourcesReady.then(sendEndecModesToNative).catch(() => sendEndecModesToNative());
        });

        console.log('[EASBridge] Crawl bridge handlers registered');
    }
})();
