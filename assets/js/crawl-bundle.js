import { saveFile, CODEMIRROR_DARK_THEME_NAME, CODEMIRROR_LIGHT_THEME_NAME, USES_DARK_THEME } from './common-functions.js';
import { E2T, allEndecModes, resourcesReady } from '../E2T/EAS2Text-NG.js';
import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, getFirstEncodableVideoCodec } from './mediabunny/mediabunny.min.js';

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
        'dasdec': { topLeft: { x: 9999, y: 9999 } },
        'eas_1cg': { topLeft: { x: 9999, y: 9999 } }
    });

    const DASDEC_RENDER_DIMENSIONS = Object.freeze({ width: 640, height: 480 });
    const EAS_1CG_RENDER_DIMENSIONS = Object.freeze({ width: 640, height: 480 });
    const EAS_1CG_BACKGROUND_COLOR = '#545454';
    const EAS_1CG_TEXT_COLOR = '#FFFFFF';
    const EAS_1CG_OUTLINE_COLOR = '#000000';
    const EAS_1CG_OUTLINE_WIDTH = 2;
    const EAS_1CG_SAFE_AREA_RATIO = 0.1;
    const EAS_1CG_COLUMNS = 31;
    const EAS_1CG_ROWS = 8;
    const EAS_1CG_FONT_FAMILY = 'EAS-1CG Neue';
    const EAS_1CG_HEADER_LINE = '***EMERGENCY DETAILS Page 1***';
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
            { family: 'EAS-1CG Neue', file: 'eas-1cg-neue.otf', description: 'font used on Gorman Redlich EAS-1CG crawls' },
            { family: 'VDSwiss V1', file: 'vdswiss-v1.otf', description: 'sans-serif font used on VDS crawls (made by Gigabyte97)' },
            { family: 'XBOB-4 8x13', file: 'BDF-8x13.ttf', description: 'bitmap font used on XBOB-4 crawls' },
            { family: 'User-Upload', file: 'user-upload.ttf', description: 'upload your own font to use!' }
        ];
        window.crawlFontsToLoad = fontsToLoad;

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

    function createVdsExportState(ctx, lines, scaleX) {
        const normalizedLines = Array.isArray(lines) ? lines : [];
        const charMetrics = [];
        const lineWidths = [];

        normalizedLines.forEach((line) => {
            const metrics = [];
            const characters = Array.from(line);
            let cursor = 0;

            characters.forEach((char) => {
                const glyph = char === '' ? ' ' : char;
                const width = measureScaledWidth(ctx, glyph, scaleX);
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

    const DEFAULT_TEXT_WIDTH_PERCENT = 100;

    const MIN_TEXT_WIDTH_PERCENT = 0;
    const MAX_TEXT_WIDTH_PERCENT = 200;

    // Number(null) and Number('') are both 0, and 0 is now a legal width, so an empty or
    // missing control has to be caught before the numeric coercion or clearing the box
    // would render the crawl invisible.
    function clampTextWidthPercent(percent) {
        if (percent === null || percent === undefined || percent === '') {
            return DEFAULT_TEXT_WIDTH_PERCENT;
        }
        const parsed = Number(percent);
        if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_TEXT_WIDTH_PERCENT;
        return Math.min(MAX_TEXT_WIDTH_PERCENT, Math.max(MIN_TEXT_WIDTH_PERCENT, parsed));
    }

    // A scale of exactly 0 makes the canvas matrix non-invertible, which silently kills
    // every later draw on that context, so the narrowest setting still keeps a sliver.
    function normalizeTextScale(percent) {
        return Math.max(0.001, clampTextWidthPercent(percent) / 100);
    }

    function measureScaledWidth(ctx, text, scaleX) {
        return ctx.measureText(text).width * (Number.isFinite(scaleX) ? scaleX : 1);
    }

    function createTextRenderer(ctx, outlineColor, outlineWidth, scaleX) {
        const parsedWidth = Number(outlineWidth);
        const hasOutline = Boolean(outlineColor) && Number.isFinite(parsedWidth) && parsedWidth > 0;
        const sx = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
        const stretched = sx !== 1;

        if (hasOutline) {
            ctx.strokeStyle = outlineColor;
            ctx.lineWidth = parsedWidth;
        }

        const paint = hasOutline
            ? (stringText, x, y) => { ctx.strokeText(stringText, x, y); ctx.fillText(stringText, x, y); }
            : (stringText, x, y) => { ctx.fillText(stringText, x, y); };

        return (text, x, y) => {
            if (text === undefined || text === null) return;
            const stringText = typeof text === 'string' ? text : String(text);
            if (!stringText) return;
            if (!stretched) { paint(stringText, x, y); return; }
            ctx.save();
            ctx.translate(x, 0);
            ctx.scale(sx, 1);
            paint(stringText, 0, y);
            ctx.restore();
        };
    }

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

    const VIDEO_EXPORT_FPS_OPTIONS = [24, 30, 60];
    const GIF_EXPORT_FPS_OPTIONS = [20, 25, 50];
    const VIDEO_EXPORT_FORMAT_OPTIONS = ['auto', 'mp4', 'webm'];
    const NATIVE_EXPORT_MAX_WIDTH = 1280;
    const NATIVE_EXPORT_MAX_HEIGHT = 720;
    const EXPORT_FRAMES_PER_YIELD = 8;

    function isNativePlatform() {
        return Boolean(window.Capacitor?.isNativePlatform?.());
    }

    function readExportSelect(id, allowed, fallback) {
        const element = document.getElementById(id);
        if (!element) return fallback;
        const raw = element.value;
        const numeric = Number(raw);
        if (allowed.includes(numeric)) return numeric;
        if (allowed.includes(raw)) return raw;
        return fallback;
    }

    function yieldToBrowser() {
        if (globalThis.scheduler && typeof globalThis.scheduler.yield === 'function') {
            return globalThis.scheduler.yield();
        }
        return new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
                channel.port1.close();
                resolve();
            };
            channel.port2.postMessage(null);
        });
    }

    function setExportProgressPrefix(label) {
        const labelEl = document.querySelector('label[for="crawlExportProgress"]');
        const pctSpan = document.getElementById('crawlExportProgressLabel');
        if (!labelEl || !pctSpan || typeof label !== 'string') return;
        const firstTextNode = Array.from(labelEl.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
        if (firstTextNode) {
            firstTextNode.textContent = `${label}: `;
        } else {
            labelEl.insertBefore(document.createTextNode(`${label}: `), pctSpan);
        }
    }

    function formatEtaSeconds(seconds) {
        const total = Math.max(0, Math.round(seconds));
        if (total < 60) return `${total}s`;
        const minutes = Math.floor(total / 60);
        const rest = total % 60;
        if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
        const hours = Math.floor(minutes / 60);
        return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
    }

    function createExportEtaTracker(label, totalFrames) {
        const startedAt = performance.now();
        let lastUpdate = 0;
        return (framesDone) => {
            const now = performance.now();
            if (now - lastUpdate < 1000) return;
            lastUpdate = now;
            const elapsed = (now - startedAt) / 1000;
            if (elapsed < 2 || framesDone <= 0) {
                setExportProgressPrefix(label);
                return;
            }
            const remaining = (totalFrames - framesDone) * (elapsed / framesDone);
            setExportProgressPrefix(`${label} (about ${formatEtaSeconds(remaining)} left)`);
        };
    }

    function resolveWorkerUrl(relativePath) {
        return new URL(relativePath, import.meta.url);
    }

    function toEvenExportDimension(value) {
        const rounded = Math.round(value);
        return Math.max(2, rounded - (rounded % 2));
    }

    function createCrawlFrameSource(generator, sourceCanvas, options = {}) {
        const fps = Number(options.fps) > 0 ? Number(options.fps) : 60;
        const frameDelayMs = 1000 / fps;
        const maxWidth = Number(options.maxWidth) || 0;
        const maxHeight = Number(options.maxHeight) || 0;
        const fitScale = (maxWidth > 0 && maxHeight > 0)
            ? Math.min(1, maxWidth / sourceCanvas.width, maxHeight / sourceCanvas.height)
            : 1;
        const width = toEvenExportDimension(sourceCanvas.width * fitScale);
        const height = toEvenExportDimension(sourceCanvas.height * fitScale);
        const scaleX = width / sourceCanvas.width;
        const scaleY = height / sourceCanvas.height;
        const scale = Math.min(scaleX, scaleY);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.style.position = 'fixed';
        canvas.style.pointerEvents = 'none';
        canvas.style.opacity = '0';
        canvas.style.left = '-10000px';
        canvas.style.top = '-10000px';
        document.body.appendChild(canvas);
        const ctx = options.readPixels
            ? canvas.getContext('2d', { willReadFrequently: true })
            : canvas.getContext('2d');

        const text = generator.text || '';
        const lines = text.split('\n');
        const fontSize = Number(generator.fontSize) || 24;
        const textColor = generator.textColor || '#FFFFFF';
        const useVdsMode = Boolean(generator.vdsMode) && !options.ignoreVds;
        const fontStyle = generator.fontStyle || 'normal';
        const fontFamily = generator.fontFamily || 'Arial';
        const sanitizedFontFamily = /[^a-zA-Z0-9_-]/.test(fontFamily)
            ? `"${fontFamily.replace(/(["\\])/g, '\\$1')}"`
            : fontFamily;
        const scaledFontSize = scale === 1 ? fontSize : Math.max(8, Math.round(fontSize * scale));
        const font = `${fontStyle} ${scaledFontSize}px ${sanitizedFontFamily}`;
        const lineHeight = scaledFontSize + (scale === 1 ? 10 : Math.round(10 * scale));

        ctx.font = font;
        ctx.textAlign = useVdsMode ? 'left' : 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = generator.outlineJoin || 'round';

        const kerningPercent = Number(generator.kerningPercent) || 0;
        if (kerningPercent) {
            ctx.letterSpacing = `${(kerningPercent / 100) * scaledFontSize}px`;
        }

        const outlineWidth = Number(generator.outlineWidth);
        const scaledOutlineWidth = Number.isFinite(outlineWidth)
            ? (scale === 1 ? outlineWidth : Math.max(1, Math.round(outlineWidth * scale)))
            : undefined;
        const textScaleX = normalizeTextScale(generator.textWidthPercent);
        const renderText = createTextRenderer(ctx, generator.outlineColor, scaledOutlineWidth, textScaleX);
        const vdsState = useVdsMode ? createVdsExportState(ctx, lines, textScaleX) : null;

        const maxLineWidth = lines.reduce((maxWidth, line) => {
            const lineWidth = measureScaledWidth(ctx, line, textScaleX);
            return lineWidth > maxWidth ? lineWidth : maxWidth;
        }, 0);
        const translation = (typeof generator._computeTopLeftTranslation === 'function')
            ? generator._computeTopLeftTranslation(maxLineWidth, lines.length)
            : { x: 0, y: 0 };
        const rawTranslationX = Number.isFinite(translation.x) ? translation.x : 0;
        const translationX = rawTranslationX * scaleX;
        const translationY = (Number.isFinite(translation.y) ? translation.y : 0) * scaleY;

        const bounds = (typeof generator._computeCrawlBounds === 'function')
            ? generator._computeCrawlBounds(maxLineWidth)
            : null;
        const inset = Math.max(0, Math.round((bounds ? bounds.inset : 0) * scaleX));
        const halfLineWidth = maxLineWidth / 2;
        const startOffset = bounds && Number.isFinite(bounds.start) ? bounds.start : sourceCanvas.width + halfLineWidth;
        const endOffset = bounds && Number.isFinite(bounds.end) ? bounds.end : -halfLineWidth;
        const adjustedStartOffset = (startOffset - rawTranslationX) * scaleX;
        const adjustedEndOffset = (endOffset - rawTranslationX) * scaleX;
        const travelDistance = adjustedStartOffset - adjustedEndOffset || width;

        const speedPerSecond = getGeneratorSpeedPerSecond(generator);
        const pxPerSecond = Math.max(0.5, Math.abs(speedPerSecond));
        const pxPerFrameMagnitude = (pxPerSecond / fps) * scaleX;
        const pxPerFrameSigned = speedPerSecond >= 0 ? pxPerFrameMagnitude : -pxPerFrameMagnitude;

        const defaultVdsDelay = (Number.isFinite(generator.vdsBaseDelayFrames) && generator.vdsBaseDelayFrames > 0)
            ? generator.vdsBaseDelayFrames
            : DEFAULT_VDS_BASE_DELAY;
        const vdsDelayAt60 = useVdsMode && typeof generator.getEffectiveVdsDelay === 'function'
            ? generator.getEffectiveVdsDelay(pxPerSecond / TARGET_FRAMES_PER_SECOND)
            : defaultVdsDelay;
        const vdsDelay = Math.max(1, Math.round(vdsDelayAt60 * (fps / TARGET_FRAMES_PER_SECOND)));

        const framesNeeded = Math.max(1, Math.ceil(travelDistance / Math.max(pxPerFrameMagnitude, 0.01)));
        const restartDelayMs = Number(generator.crawlRestartDelay);
        const restartDelayFrames = (Number.isFinite(restartDelayMs) && restartDelayMs > 0)
            ? Math.max(1, Math.round(restartDelayMs / frameDelayMs))
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
        const dasdecTotalDisplays = (dasdecPages && dasdecPages.length && dasdecRotationDelay)
            ? Math.max(1, Number(dasdecBackground.totalDisplays) || (dasdecRepetitionOverride * dasdecPages.length))
            : 0;
        const dasdecFramesPerPage = dasdecRotationDelay
            ? Math.max(1, Math.round(dasdecRotationDelay / frameDelayMs))
            : null;
        const getDasdecPageForFrame = (dasdecPages && dasdecFramesPerPage)
            ? (frameIndex) => {
                const displayIndex = Math.min(dasdecTotalDisplays - 1, Math.floor(frameIndex / dasdecFramesPerPage));
                return dasdecPages[displayIndex % dasdecPages.length];
            }
            : null;
        if (getDasdecPageForFrame) {
            totalFrames = dasdecTotalDisplays * dasdecFramesPerPage;
        }

        const isTransparentBackground = Boolean(
            generator._transparentBg ||
            (typeof generator._isTransparentColor === 'function' && generator._isTransparentColor(generator.bgColor))
        );
        const hasGeneratorMedia = Boolean(generator.bgVideo || generator.bgImage);
        const transparentOutput = Boolean(options.transparent) && isTransparentBackground && !hasGeneratorMedia && !getDasdecPageForFrame;
        const shouldDrawGeneratorBackground = !isTransparentBackground || hasGeneratorMedia;

        const clipWidth = width - inset * 2;
        const shouldClip = inset > 0 && clipWidth > 0;

        const clearFrame = (frameIndex) => {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            if (transparentOutput) {
                ctx.globalCompositeOperation = 'copy';
                ctx.fillStyle = 'rgba(0, 0, 0, 0)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillStyle = '#000000';
            }
            ctx.fillRect(0, 0, width, height);
            let drewCustomBackground = false;
            if (getDasdecPageForFrame) {
                const dasdecPage = getDasdecPageForFrame(frameIndex);
                if (dasdecPage) {
                    ctx.drawImage(dasdecPage, 0, 0, width, height);
                    drewCustomBackground = true;
                }
            }
            if (!drewCustomBackground && shouldDrawGeneratorBackground) {
                drawGeneratorBackground(ctx, generator, width, height);
            }
            ctx.restore();
            ctx.globalCompositeOperation = 'source-over';
        };

        let offsetX = adjustedStartOffset;
        let delayFramesRemaining = 0;
        let nextIndex = 0;

        const reset = () => {
            offsetX = adjustedStartOffset;
            delayFramesRemaining = 0;
            nextIndex = 0;
            resetVdsExportState(vdsState);
        };

        const advance = () => {
            if (delayFramesRemaining > 0) {
                delayFramesRemaining--;
                if (delayFramesRemaining === 0) {
                    offsetX = adjustedStartOffset;
                    resetVdsExportState(vdsState);
                }
                return;
            }
            offsetX -= pxPerFrameSigned;
            const passedEnd = (pxPerFrameSigned >= 0 && offsetX < adjustedEndOffset) ||
                (pxPerFrameSigned < 0 && offsetX > adjustedEndOffset);
            if (passedEnd) {
                if (restartDelayFrames > 0) {
                    offsetX = adjustedEndOffset;
                    delayFramesRemaining = restartDelayFrames;
                } else {
                    offsetX = adjustedStartOffset;
                    resetVdsExportState(vdsState);
                }
            }
        };

        const paint = (frameIndex) => {
            clearFrame(frameIndex);
            ctx.fillStyle = textColor;
            ctx.font = font;
            const translatedOffsetX = offsetX + translationX;
            const centerY = height / 2 + translationY;

            if (shouldClip) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(inset, 0, clipWidth, height);
                ctx.clip();
            }
            if (useVdsMode) {
                updateVdsExportState(vdsState, translatedOffsetX, Math.max(0, width - inset * 2), vdsDelay, inset);
                drawVdsExportFrame(ctx, vdsState, translatedOffsetX, centerY, scaledFontSize, renderText);
            } else {
                lines.forEach((line, index) => {
                    const verticalOffset = index - (lines.length - 1) / 2;
                    renderText(line, translatedOffsetX, centerY + verticalOffset * lineHeight);
                });
            }
            if (shouldClip) {
                ctx.restore();
            }
        };

        const drawFrame = (frameIndex) => {
            if (frameIndex !== nextIndex) {
                throw new Error(`Frames must be drawn in order (expected ${nextIndex}, got ${frameIndex})`);
            }
            paint(frameIndex);
            advance();
            nextIndex++;
        };

        const renderAt = (frameIndex) => {
            reset();
            for (let i = 0; i < frameIndex; i++) advance();
            paint(frameIndex);
            reset();
        };

        const destroy = () => {
            if (canvas.parentNode) {
                canvas.parentNode.removeChild(canvas);
            }
        };

        reset();

        return {
            canvas,
            ctx,
            width,
            height,
            fps,
            frameDelayMs,
            totalFrames,
            framesPerCycle,
            repetitions,
            transparentOutput,
            dasdecPageCount: dasdecPages ? dasdecPages.length : 0,
            dasdecFramesPerPage: dasdecFramesPerPage || 0,
            drawFrame,
            renderAt,
            reset,
            destroy
        };
    }

    function createGifWorkerPool(count) {
        const workers = [];
        const pending = new Map();
        let nextId = 1;
        let paletteResolver = null;

        for (let i = 0; i < count; i++) {
            const worker = new Worker(resolveWorkerUrl('./crawl-gif-worker.js'), { type: 'module' });
            worker.busy = 0;
            worker.onmessage = (event) => {
                const msg = event.data || {};
                if (msg.type === 'palette' && paletteResolver) {
                    paletteResolver.resolve(msg);
                    paletteResolver = null;
                    worker.busy--;
                    return;
                }
                const entry = pending.get(msg.id);
                if (!entry) return;
                pending.delete(msg.id);
                worker.busy--;
                if (msg.type === 'fatal') {
                    entry.reject(new Error(msg.error || 'GIF worker failed'));
                } else {
                    entry.resolve(msg);
                }
            };
            worker.onerror = (event) => {
                const error = new Error(event.message || 'GIF worker crashed');
                pending.forEach((entry) => entry.reject(error));
                pending.clear();
                if (paletteResolver) {
                    paletteResolver.reject(error);
                    paletteResolver = null;
                }
            };
            workers.push(worker);
        }

        const pickWorker = () => workers.reduce((best, w) => (w.busy < best.busy ? w : best), workers[0]);

        return {
            size: workers.length,
            buildPalette(buffers, width, height, transparent) {
                const worker = pickWorker();
                worker.busy++;
                return new Promise((resolve, reject) => {
                    paletteResolver = { resolve, reject };
                    worker.postMessage({ type: 'palette', buffers, width, height, transparent }, buffers);
                });
            },
            encodeChunk(payload) {
                const worker = pickWorker();
                const id = nextId++;
                worker.busy++;
                return new Promise((resolve, reject) => {
                    pending.set(id, { resolve, reject });
                    worker.postMessage({ type: 'chunk', id, ...payload }, payload.frames);
                });
            },
            terminate() {
                workers.forEach((w) => { try { w.terminate(); } catch (_) { } });
                pending.clear();
            }
        };
    }

    async function exportAsGIF(canvas, filename) {
        if (!window.crawlGenerator) {
            addStatus('The crawl is still loading. Try the export again in a moment.', 'WARN');
            return;
        }

        addStatus('Exporting crawl as GIF... Please wait.');
        const startTime = performance.now();
        const showTime = localStorage["showTime"];
        const generator = window.crawlGenerator;
        const native = isNativePlatform();
        const fps = readExportSelect('crawlExportGifFps', GIF_EXPORT_FPS_OPTIONS, 50);
        const sourceOptions = {
            fps,
            transparent: true,
            readPixels: true,
            maxWidth: native ? NATIVE_EXPORT_MAX_WIDTH : 0,
            maxHeight: native ? NATIVE_EXPORT_MAX_HEIGHT : 0
        };

        let cancelled = false;
        const token = crawlExportController.createToken(() => { cancelled = true; });
        const isCancelled = () => cancelled || crawlExportController.isCancelled(token);

        const frameSource = createCrawlFrameSource(generator, canvas, sourceOptions);
        const { width, height, totalFrames, transparentOutput } = frameSource;
        const workerCount = native ? 1 : Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
        const pool = createGifWorkerPool(workerCount);
        let paletteSource = null;

        const reportProgress = createExportProgressReporter('GIF export');
        const updateEta = createExportEtaTracker('GIF export', totalFrames);
        reportProgress(0);

        const cleanup = () => {
            pool.terminate();
            frameSource.destroy();
            if (paletteSource) paletteSource.destroy();
        };

        try {
            paletteSource = createCrawlFrameSource(generator, canvas, { ...sourceOptions, ignoreVds: true });
            const sampleIndices = new Set([0, Math.floor(Math.max(1, paletteSource.framesPerCycle) / 2)]);
            for (let page = 0; page < Math.min(4, paletteSource.dasdecPageCount); page++) {
                sampleIndices.add(Math.min(totalFrames - 1, page * paletteSource.dasdecFramesPerPage));
            }
            const sampleBuffers = [];
            sampleIndices.forEach((index) => {
                paletteSource.renderAt(index);
                sampleBuffers.push(paletteSource.ctx.getImageData(0, 0, width, height).data.buffer);
            });
            paletteSource.destroy();
            paletteSource = null;

            const paletteResult = await pool.buildPalette(sampleBuffers, width, height, transparentOutput);
            if (isCancelled()) throw new Error('CANCELLED');
            const palette = paletteResult.palette;
            const format = paletteResult.format;
            let transparentIndex = -1;
            if (transparentOutput) {
                transparentIndex = palette.findIndex((color) => color.length > 3 && color[3] === 0);
            }
            const useTransparency = transparentIndex >= 0;

            const delay = Math.round(1000 / fps);
            const repeat = frameSource.repetitions <= 1 ? -1 : frameSource.repetitions - 1;
            const frameBytes = width * height * 4;
            const memoryBudget = native ? 48 * 1024 * 1024 : 192 * 1024 * 1024;
            const maxInFlightChunks = pool.size * 2;
            const maxInFlightFrames = Math.max(maxInFlightChunks, Math.floor(memoryBudget / frameBytes));
            const chunkSize = Math.max(1, Math.min(16, Math.floor(maxInFlightFrames / maxInFlightChunks)));

            const chunkResults = [];
            const inFlight = new Set();
            let framesDone = 0;
            let workerError = null;

            const waitForSlot = async () => {
                while (inFlight.size >= maxInFlightChunks && !workerError) {
                    await Promise.race(inFlight);
                }
                if (workerError) throw workerError;
            };

            for (let chunkStart = 0, chunkIndex = 0; chunkStart < totalFrames; chunkStart += chunkSize, chunkIndex++) {
                if (isCancelled()) throw new Error('CANCELLED');
                await waitForSlot();
                const frames = [];
                const chunkEnd = Math.min(totalFrames, chunkStart + chunkSize);
                for (let i = chunkStart; i < chunkEnd; i++) {
                    frameSource.drawFrame(i);
                    frames.push(frameSource.ctx.getImageData(0, 0, width, height).data.buffer);
                }
                const slot = chunkIndex;
                const job = pool.encodeChunk({
                    frames,
                    width,
                    height,
                    palette,
                    format,
                    delay,
                    repeat,
                    first: chunkStart === 0,
                    transparent: useTransparency,
                    transparentIndex: useTransparency ? transparentIndex : 0
                }).then((result) => {
                    chunkResults[slot] = new Uint8Array(result.buffer);
                    framesDone += result.frames;
                    reportProgress(framesDone / totalFrames);
                    updateEta(framesDone);
                }).catch((error) => {
                    workerError = workerError || error;
                }).finally(() => {
                    inFlight.delete(job);
                });
                inFlight.add(job);
                await yieldToBrowser();
            }

            await Promise.all(Array.from(inFlight));
            if (workerError) throw workerError;
            if (isCancelled()) throw new Error('CANCELLED');

            const totalBytes = chunkResults.reduce((sum, part) => sum + part.length, 0) + 1;
            const out = new Uint8Array(totalBytes);
            let cursor = 0;
            chunkResults.forEach((part) => {
                out.set(part, cursor);
                cursor += part.length;
            });
            out[cursor] = 0x3B;
            chunkResults.length = 0;
            const blob = new Blob([out], { type: 'image/gif' });

            const reportSaveProgress = createExportProgressReporter('GIF save');
            reportSaveProgress(0);
            await saveFile(filename, blob, 'image/gif', {
                onProgress: (ratio) => reportSaveProgress(ratio),
                isCancelled,
            });
            crawlExportController.clear(token);
            reportSaveProgress(1);
            addStatus(
                'Crawl exported successfully!' +
                (showTime ? ` (Took: ${((performance.now() - startTime) / 1000).toFixed(2)} seconds)` : ''),
                'SUCCESS'
            );
        } catch (error) {
            const wasCancelled = isCancelled() || String(error?.message || error).includes('CANCELLED');
            crawlExportController.clear(token);
            if (wasCancelled) {
                addStatus('GIF export canceled.', 'WARN');
            } else {
                console.error('GIF export failed:', error);
                addStatus(`GIF export failed: ${error?.message || error}`, 'ERROR');
            }
        } finally {
            cleanup();
        }
    }

    function computeVideoBitrate(width, height, fps) {
        const estimated = Math.floor(width * height * fps * 0.3);
        return Math.max(2_000_000, Math.min(25_000_000, estimated));
    }

    async function encodeVideoWithMediabunny(frameSource, { codec, container, bitrate, isCancelled, reportProgress, updateEta }) {
        const { canvas, fps, totalFrames, transparentOutput } = frameSource;
        const format = container === 'mp4'
            ? new Mp4OutputFormat({ fastStart: 'in-memory' })
            : new WebMOutputFormat();
        const output = new Output({ format, target: new BufferTarget() });
        const source = new CanvasSource(canvas, {
            codec,
            bitrate,
            keyFrameInterval: 1,
            alpha: transparentOutput ? 'keep' : 'discard',
            latencyMode: 'quality'
        });
        output.addVideoTrack(source, { frameRate: fps });
        await output.start();

        try {
            for (let i = 0; i < totalFrames; i++) {
                if (isCancelled()) {
                    await output.cancel();
                    return null;
                }
                frameSource.drawFrame(i);
                await source.add(i / fps, 1 / fps);
                reportProgress((i + 1) / totalFrames);
                updateEta(i + 1);
                if ((i + 1) % EXPORT_FRAMES_PER_YIELD === 0) {
                    await yieldToBrowser();
                }
            }
            source.close();
            await output.finalize();
        } catch (error) {
            try { await output.cancel(); } catch (_) { }
            throw error;
        }

        const buffer = output.target.buffer;
        if (!buffer || !buffer.byteLength) {
            return null;
        }
        return new Blob([buffer], { type: container === 'mp4' ? 'video/mp4' : 'video/webm' });
    }

    function encodeVideoWithSoftwareH264(frameSource, { bitrate, isCancelled, reportProgress, updateEta }) {
        const { ctx, width, height, fps, totalFrames } = frameSource;
        const MAX_IN_FLIGHT = 3;

        return new Promise((resolve, reject) => {
            const worker = new Worker(resolveWorkerUrl('./crawl-h264-worker.js'));
            let inFlight = 0;
            let nextFrame = 0;
            let finished = false;
            let finishRequested = false;
            let slotWaiter = null;

            const fail = (error) => {
                if (finished) return;
                finished = true;
                worker.terminate();
                reject(error);
            };

            const requestFinish = () => {
                if (finishRequested || finished) return;
                finishRequested = true;
                worker.postMessage({ type: 'finish' });
            };

            const pump = async () => {
                try {
                    while (nextFrame < totalFrames) {
                        if (isCancelled()) {
                            finished = true;
                            worker.terminate();
                            resolve(null);
                            return;
                        }
                        if (inFlight >= MAX_IN_FLIGHT) {
                            await new Promise((r) => { slotWaiter = r; });
                            continue;
                        }
                        const index = nextFrame++;
                        frameSource.drawFrame(index);
                        const buffer = ctx.getImageData(0, 0, width, height).data.buffer;
                        inFlight++;
                        worker.postMessage({ type: 'frame', index, buffer }, [buffer]);
                        if ((index + 1) % EXPORT_FRAMES_PER_YIELD === 0) {
                            await yieldToBrowser();
                        }
                    }
                    if (inFlight === 0) {
                        requestFinish();
                    }
                } catch (error) {
                    fail(error);
                }
            };

            worker.onerror = (event) => fail(new Error(event.message || 'H.264 worker crashed'));
            worker.onmessage = (event) => {
                const msg = event.data || {};
                if (msg.type === 'ready') {
                    pump();
                } else if (msg.type === 'frameDone') {
                    inFlight--;
                    reportProgress((msg.index + 1) / totalFrames);
                    updateEta(msg.index + 1);
                    if (slotWaiter) {
                        const r = slotWaiter;
                        slotWaiter = null;
                        r();
                    } else if (nextFrame >= totalFrames && inFlight === 0) {
                        requestFinish();
                    }
                } else if (msg.type === 'done') {
                    finished = true;
                    worker.terminate();
                    resolve(new Blob([msg.buffer], { type: 'video/mp4' }));
                } else if (msg.type === 'fatal') {
                    fail(new Error(msg.error || 'H.264 encoder failed'));
                }
            };

            worker.postMessage({
                type: 'init',
                width,
                height,
                fps,
                kbps: Math.round(bitrate / 1000),
                speed: 5
            });
        });
    }

    async function exportAsVideo(canvas) {
        if (!window.crawlGenerator) {
            addStatus('The crawl is still loading. Try the export again in a moment.', 'WARN');
            return;
        }

        addStatus('Exporting crawl as video... Please wait.');
        const startTime = performance.now();
        const showTime = localStorage["showTime"];
        const generator = window.crawlGenerator;
        const native = isNativePlatform();
        const fps = readExportSelect('crawlExportVideoFps', VIDEO_EXPORT_FPS_OPTIONS, 60);
        const requestedFormat = readExportSelect('crawlExportVideoFormat', VIDEO_EXPORT_FORMAT_OPTIONS, 'auto');
        const hasWebCodecs = typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';

        let cancelled = false;
        const token = crawlExportController.createToken(() => { cancelled = true; });
        const isCancelled = () => cancelled || crawlExportController.isCancelled(token);

        const baseOptions = {
            fps,
            transparent: true,
            maxWidth: native ? 1920 : 0,
            maxHeight: native ? 1080 : 0
        };
        let frameSource = createCrawlFrameSource(generator, canvas, baseOptions);

        try {
            const { width, height, transparentOutput } = frameSource;
            const bitrate = computeVideoBitrate(width, height, fps);

            let codec = null;
            if (hasWebCodecs) {
                const candidates = transparentOutput
                    ? ['vp9']
                    : requestedFormat === 'mp4'
                        ? ['avc']
                        : requestedFormat === 'webm'
                            ? ['vp9', 'vp8']
                            : ['avc', 'vp9', 'vp8'];
                try {
                    codec = await getFirstEncodableVideoCodec(candidates, { width, height, bitrate });
                } catch (probeError) {
                    console.warn('Video codec probe failed:', probeError);
                    codec = null;
                }
            }

            if (transparentOutput && !codec) {
                addStatus('Transparent video export requires WebCodecs with VP9 support in this browser.', 'ERROR');
                crawlExportController.clear(token);
                return;
            }
            if (transparentOutput && requestedFormat === 'mp4') {
                addStatus('Transparent backgrounds are exported as WebM (VP9 with alpha); MP4 cannot carry transparency.', 'WARN');
            }

            let container = codec === 'avc' ? 'mp4' : 'webm';
            let blob = null;
            const reportProgress = createExportProgressReporter('Video export');
            const updateEta = createExportEtaTracker('Video export', frameSource.totalFrames);
            reportProgress(0);

            if (codec) {
                blob = await encodeVideoWithMediabunny(frameSource, {
                    codec, container, bitrate, isCancelled, reportProgress, updateEta
                });
            } else {
                if (requestedFormat === 'webm') {
                    addStatus('WebM encoding is not available in this browser; using the software H.264 encoder (MP4) instead.', 'WARN');
                } else {
                    addStatus('This browser lacks WebCodecs; using the software H.264 encoder (slower, MP4 only).', 'WARN');
                }
                container = 'mp4';
                frameSource.destroy();
                frameSource = createCrawlFrameSource(generator, canvas, { ...baseOptions, readPixels: true });
                blob = await encodeVideoWithSoftwareH264(frameSource, {
                    bitrate, isCancelled, reportProgress, updateEta
                });
            }

            if (isCancelled() || !blob) {
                crawlExportController.clear(token);
                addStatus(isCancelled() ? 'Video export canceled.' : 'No frames recorded for video export.', 'WARN');
                return;
            }

            const reportSaveProgress = createExportProgressReporter('Video save');
            reportSaveProgress(0);
            await saveFile(`crawl.${container}`, blob, container === 'mp4' ? 'video/mp4' : 'video/webm', {
                onProgress: (ratio) => reportSaveProgress(ratio),
                isCancelled,
            });
            crawlExportController.clear(token);
            reportSaveProgress(1);
            addStatus(
                'Crawl exported successfully!' +
                (showTime ? ` (Took: ${((performance.now() - startTime) / 1000).toFixed(2)} seconds)` : ''),
                'SUCCESS'
            );
        } catch (error) {
            const wasCancelled = isCancelled() || String(error?.message || error).includes('CANCELLED');
            crawlExportController.clear(token);
            if (wasCancelled) {
                addStatus('Video export canceled.', 'WARN');
            } else {
                console.error('Video export failed:', error);
                addStatus(`Video export failed: ${error?.message || error}`, 'ERROR');
            }
        } finally {
            frameSource.destroy();
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
            this.textWidthPercent = DEFAULT_TEXT_WIDTH_PERCENT;
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
                const renderText = createTextRenderer(this.ctx, this.outlineColor, this.outlineWidth,
                    this._textScaleX());
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
            const frameScaleX = this._textScaleX();
            const renderText = createTextRenderer(this.ctx, this.outlineColor, this.outlineWidth,
                frameScaleX);
            const maxLineWidth = this._maxLineWidth(lines, frameScaleX);
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

        _textScaleX() {
            return normalizeTextScale(this.textWidthPercent);
        }

        /**
         * measureText on a crawl-length string is not cheap, and the widest line only
         * changes when the text, font, spacing or width scale does -- never per frame.
         * The key covers every input, so the cache invalidates itself rather than relying
         * on callers to remember.
         */
        _maxLineWidth(lines, scaleX) {
            const key = this.ctx.font + '|' + this.ctx.letterSpacing + '|' + scaleX + '|' + this.text;
            if (this._lineWidthKey === key && Number.isFinite(this._lineWidthValue)) {
                return this._lineWidthValue;
            }
            let widest = 0;
            for (let i = 0; i < lines.length; i++) {
                const width = measureScaledWidth(this.ctx, lines[i], scaleX);
                if (width > widest) widest = width;
            }
            this._lineWidthKey = key;
            this._lineWidthValue = widest;
            return widest;
        }

        setTextWidth(percent) {
            const parsed = Number(percent);
            if (Number.isFinite(parsed)) {
                this.textWidthPercent = clampTextWidthPercent(parsed);
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
            const vdsScaleX = this._textScaleX();
            const charMetrics = normalizedLines.map((line) => {
                const metrics = [];
                const characters = Array.from(line);
                let cursor = 0;

                characters.forEach((char) => {
                    const measuredChar = char === '' ? ' ' : char;
                    const width = measureScaledWidth(this.ctx, measuredChar, vdsScaleX);
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
            const nextFrameButton = document.getElementById('nextFrame');
            const prevFrameButton = document.getElementById('prevFrame');

            pauseCrawlButton.disabled = disabled;
            stopCrawlButton.disabled = disabled;
            exportAsGIFButton.disabled = disabled;
            exportAsVideoButton.disabled = disabled;
            copyCrawlTextButton.disabled = disabled;
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

            const maxLineWidth = this._maxLineWidth(lines, this._textScaleX());

            const bounds = this._computeCrawlBounds(maxLineWidth);
            this.offsetX = Number.isFinite(bounds.start) ? bounds.start : this.canvas.width / 2;
            this.offsetY = this.canvas.height / 2;
            this.startFromRightInitialized = false;
            this._restartDelayRemaining = 0;
            this._resetFrameHistory();

            this._clearBackground();
            this.ctx.fillStyle = this.textColor;
            this.ctx.lineJoin = this.outlineJoin;
            const renderText = createTextRenderer(this.ctx, this.outlineColor, this.outlineWidth,
                this._textScaleX());
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

    function toEvenDimension(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.round(parsed / 2) * 2 : null;
    }

    function getRequestedCrawlDimensions() {
        const widthInput = document.getElementById('crawlWidth');
        const heightInput = document.getElementById('crawlHeight');
        return {
            width: widthInput ? toEvenDimension(widthInput.value) : null,
            height: heightInput ? toEvenDimension(heightInput.value) : null,
        };
    }

    function commitCrawlDimensionInputs() {
        for (const id of ['crawlWidth', 'crawlHeight']) {
            const input = document.getElementById(id);
            if (!input) continue;
            const even = toEvenDimension(input.value);
            if (even === null) continue;
            const next = String(even);
            if (input.value !== next) input.value = next;
        }
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

    const PREMADE_LOCKABLE_INPUT_IDS = Object.freeze([
        'crawlWidth', 'crawlHeight', 'crawlInset', 'crawlTopLeftPixelX', 'crawlTopLeftPixelY'
    ]);
    const premadeControlledInputIds = new Set();

    function clearPremadeInputLocks() {
        premadeControlledInputIds.clear();
        syncPremadeInputLocks();
    }

    function syncPremadeInputLocks() {
        const modeSelect = document.getElementById('crawlBackgroundMode');
        const premadeActive = !!modeSelect && modeSelect.value === 'premade';
        let lockedAny = false;

        for (const id of PREMADE_LOCKABLE_INPUT_IDS) {
            const input = document.getElementById(id);
            if (!input) continue;
            const locked = premadeActive && premadeControlledInputIds.has(id);
            input.disabled = locked;
            if (locked) {
                input.setAttribute('title', 'Set by the selected pre-made background.');
                lockedAny = true;
            } else {
                input.removeAttribute('title');
            }
        }

        const note = document.getElementById('crawlPremadeLockNote');
        if (note) {
            note.hidden = !lockedAny;
        }
    }

    function updateCrawlControlsFromAsset(meta = {}, options = {}) {
        const generator = options.generator || window.crawlGenerator;
        const { width, height, inset, topLeft } = meta;
        const controlled = options.premade ? premadeControlledInputIds : null;
        let sizeAvailable = false;

        if (Number.isFinite(width) && width > 0) {
            setNumericInputValue('crawlWidth', width, { allowZero: false });
            if (controlled) controlled.add('crawlWidth');
            sizeAvailable = true;
        }

        if (Number.isFinite(height) && height > 0) {
            setNumericInputValue('crawlHeight', height, { allowZero: false });
            if (controlled) controlled.add('crawlHeight');
            sizeAvailable = true;
        }

        if (sizeAvailable) {
            commitCrawlDimensionInputs();
            applyCrawlSizeToGenerator(generator);
        }

        if (Number.isFinite(inset)) {
            setNumericInputValue('crawlInset', inset, { allowZero: true });
            if (controlled) controlled.add('crawlInset');
            if (generator) {
                generator.setCrawlInset(inset);
            }
        }

        if (topLeft && typeof topLeft === 'object') {
            if (Number.isFinite(topLeft.x)) {
                setNumericInputValue('crawlTopLeftPixelX', topLeft.x, { allowZero: true });
                if (controlled) controlled.add('crawlTopLeftPixelX');
                if (generator) {
                    generator.setTopLeftOffsetX(topLeft.x);
                }
            }
            if (Number.isFinite(topLeft.y)) {
                setNumericInputValue('crawlTopLeftPixelY', topLeft.y, { allowZero: true });
                if (controlled) controlled.add('crawlTopLeftPixelY');
                if (generator) {
                    generator.setTopLeftOffsetY(topLeft.y);
                }
            }
        }

        if (controlled) {
            syncPremadeInputLocks();
        }

        return sizeAvailable;
    }

    let premadeSizingRequestToken = 0;
    async function requestPremadeBackgroundSizing() {
        const premadeSelect = document.getElementById('crawlBackgroundPremadeSelect');
        if (!premadeSelect) return;
        const descriptor = parseBackgroundSelectionValue(premadeSelect.value);
        if (!descriptor) {
            clearPremadeInputLocks();
            return;
        }
        clearPremadeInputLocks();
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
            }, { premade: true });
            return;
        }

        if (descriptor.source === 'eas_1cg') {
            updateCrawlControlsFromAsset({
                width: EAS_1CG_RENDER_DIMENSIONS.width,
                height: EAS_1CG_RENDER_DIMENSIONS.height,
                topLeft: initialTopLeft
            }, { premade: true });
            return;
        }

        updateCrawlControlsFromAsset({ topLeft: initialTopLeft }, { premade: true });
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
        updateCrawlControlsFromAsset({ width, height, topLeft }, { premade: true });
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
        const source = (eventCode && eventCodeMap[eventCode]) ? eventCodeMap[eventCode] : eventCode;
        if (typeof source !== 'string') {
            return '';
        }
        return source;
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

    async function formatDasdecEAS2Text(rawHeader) {
        const pages = await formatDasdec(rawHeader, true);
        if (!Array.isArray(pages)) {
            return [];
        }

        return pages
            .map((page) => (Array.isArray(page) ? page.slice(0, -1).filter((line) => line !== '') : []))
            .filter((page) => page.length);
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

    function formatEas1cgLines(rawText) {
        const maxLineLength = EAS_1CG_COLUMNS;
        const sourceLines = String(rawText ?? '').replace(/\r/g, '').split('\n');
        const formattedLines = [];

        sourceLines.forEach((sourceLine) => {
            const words = sourceLine.split(/\s+/).filter(Boolean);
            let currentLine = '';

            words.forEach((word) => {
                let remaining = word;

                while (remaining.length > maxLineLength) {
                    if (currentLine) {
                        formattedLines.push(currentLine);
                        currentLine = '';
                    }
                    formattedLines.push(remaining.slice(0, maxLineLength));
                    remaining = remaining.slice(maxLineLength);
                }

                if (!remaining) {
                    return;
                }

                if (!currentLine) {
                    currentLine = remaining;
                }

                else if ((currentLine.length + remaining.length + 1) <= maxLineLength) {
                    currentLine += ' ' + remaining;
                }

                else {
                    formattedLines.push(currentLine);
                    currentLine = remaining;
                }
            });

            if (currentLine) {
                formattedLines.push(currentLine);
            }
        });

        return formattedLines;
    }

    async function formatEas1cg(rawHeader, e2tMode) {
        let fullText = '';

        if (e2tMode === true) {
            const overrideTzInput = document.getElementById('crawlUseOverrideTZ');
            const timezoneOverride = overrideTzInput && overrideTzInput.value ? overrideTzInput.value : null;
            const formatted = E2T(rawHeader, 'GORMAN', false, timezoneOverride);
            fullText = typeof formatted === 'string' ? formatted : String(formatted ?? '');
        }

        else {
            fullText = rawHeader;
        }

        return [EAS_1CG_HEADER_LINE].concat(formatEas1cgLines(fullText));
    }

    async function generateEas1cgScreenImage(screenLines) {
        const canvas = document.createElement('canvas');
        canvas.width = EAS_1CG_RENDER_DIMENSIONS.width;
        canvas.height = EAS_1CG_RENDER_DIMENSIONS.height;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = EAS_1CG_BACKGROUND_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const safeLeft = canvas.width * EAS_1CG_SAFE_AREA_RATIO;
        const safeTop = canvas.height * EAS_1CG_SAFE_AREA_RATIO;
        const safeWidth = canvas.width - safeLeft * 2;
        const safeHeight = canvas.height - safeTop * 2;

        const lines = (Array.isArray(screenLines) ? screenLines.flat() : [screenLines])
            .map((line) => String(line ?? ''));
        const fitScale = lines.length > EAS_1CG_ROWS ? EAS_1CG_ROWS / lines.length : 1;

        const fontStyle = 'normal';
        const sanitizedFontFamily = /[^a-zA-Z0-9_-]/.test(EAS_1CG_FONT_FAMILY)
            ? `"${EAS_1CG_FONT_FAMILY.replace(/(["\\])/g, '\\$1')}"`
            : EAS_1CG_FONT_FAMILY;

        await ensureFontsReady();

        const probeSize = 100;
        const probeFont = `${fontStyle} ${probeSize}px ${sanitizedFontFamily}`;
        await document.fonts.load(probeFont);
        ctx.font = probeFont;

        const probeWidth = ctx.measureText('M'.repeat(EAS_1CG_COLUMNS)).width;
        const columnFontSize = probeWidth > 0
            ? probeSize * (safeWidth / probeWidth)
            : safeWidth / (EAS_1CG_COLUMNS * 0.625);

        const fontSize = Math.max(6, columnFontSize * fitScale);
        const lineHeight = (safeHeight / EAS_1CG_ROWS) * fitScale;
        const font = `${fontStyle} ${fontSize}px ${sanitizedFontFamily}`;
        await document.fonts.load(font);

        ctx.font = font;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.lineJoin = 'round';
        ctx.fillStyle = EAS_1CG_TEXT_COLOR;

        const renderText = createTextRenderer(ctx, EAS_1CG_OUTLINE_COLOR, EAS_1CG_OUTLINE_WIDTH);

        lines.forEach((line, index) => {
            renderText(line, safeLeft, safeTop + lineHeight * (index + 0.5));
        });

        const img = new Image();
        img.width = canvas.width;
        img.height = canvas.height;
        img.src = canvas.toDataURL('image/png');

        await new Promise((resolve) => {
            if (img.complete && img.naturalWidth > 0) {
                resolve();
                return;
            }
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        });

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

                    else if (descriptor.source === 'eas_1cg') {
                        const crawlModeValue = document.getElementById('crawlMode').value;
                        const rawHeader = crawlModeValue === 'header'
                            ? document.getElementById('crawlRawHeader').value
                            : document.getElementById('crawlText').value;
                        const screenLines = await formatEas1cg(rawHeader, crawlModeValue === 'header');
                        const media = await generateEas1cgScreenImage(screenLines);

                        if (media) {
                            const topLeft = getPremadeTopLeft(descriptor.source);
                            return {
                                image: media,
                                width: media.naturalWidth || media.width || EAS_1CG_RENDER_DIMENSIONS.width,
                                height: media.naturalHeight || media.height || EAS_1CG_RENDER_DIMENSIONS.height,
                                topLeft,
                                source: descriptor.source
                            };
                        }
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

    let crawlPaused = true;

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

    let crawlApplyToken = 0;
    let crawlApplyTimer = null;
    let crawlApplyRunning = null;
    let crawlBootstrapped = false;
    const crawlAssetCache = {
        fontKey: null,
        fontFamily: null,
        backgroundKey: null,
        backgroundAssets: null,
        headerKey: null,
        headerText: null
    };

    function crawlFileToken(inputId) {
        const input = document.getElementById(inputId);
        const file = input && input.files ? input.files[0] : null;
        return file ? `${file.name}:${file.size}:${file.lastModified}` : '';
    }

    function readCrawlControls() {
        const value = (id) => {
            const el = document.getElementById(id);
            return el ? el.value : '';
        };
        const checked = (id) => {
            const el = document.getElementById(id);
            return el ? Boolean(el.checked) : false;
        };
        const crawlBackgroundMode = value('crawlBackgroundMode');
        const crawlMode = value('crawlMode');
        const rawHeader = value('crawlRawHeader');
        return {
            text: value('crawlText'),
            speed: value('crawlSpeed'),
            fontSize: value('crawlFontSize'),
            textColor: value('crawlTextColor'),
            bgColor: crawlBackgroundMode === 'transparent' ? 'transparent' : value('crawlBgColor'),
            crawlMode,
            rawHeader: crawlMode === 'header' ? rawHeader : '',
            useLocalTZ: checked('crawlUseLocalTZ'),
            useOverrideTZ: value('crawlUseOverrideTZ'),
            endecMode: value('endecMode'),
            useVDSMode: checked('crawlUseVDSMode'),
            vdsFrameDelay: value('vdsFrameDelay'),
            fontFamily: value('crawlFontFamily') || 'Arial',
            fontStyle: value('crawlFontStyle') || 'normal',
            outlineColor: value('crawlOutlineColor'),
            outlineWidth: value('crawlOutlineWidth'),
            outlineJoin: value('crawlOutlineJoin'),
            crawlWidth: value('crawlWidth'),
            crawlHeight: value('crawlHeight'),
            crawlInset: value('crawlInset'),
            crawlRestartDelay: value('crawlRestartDelay'),
            crawlBackgroundMode,
            crawlBackgroundPremade: value('crawlBackgroundPremadeSelect'),
            easyplusOriginator: value('easyplusOriginator'),
            easyplusEventCode: value('easyplusEventCode'),
            crawlTopLeftOffsetX: value('crawlTopLeftPixelX'),
            crawlTopLeftOffsetY: value('crawlTopLeftPixelY'),
            repetitions: value('crawlRepetitions'),
            crawlKerning: value('crawlKerning'),
            crawlTextWidth: value('crawlTextWidth')
        };
    }

    async function resolveCrawlFontForApply(controls) {
        const key = `${controls.fontFamily}|${crawlFileToken('crawlCustomFontFile')}`;
        if (crawlAssetCache.fontKey === key && crawlAssetCache.fontFamily) {
            return crawlAssetCache.fontFamily;
        }
        const previousKey = crawlAssetCache.fontKey;
        try {
            const resolved = await resolveCrawlFontFamily(controls.fontFamily);
            crawlAssetCache.fontKey = key;
            crawlAssetCache.fontFamily = resolved;
            return resolved;
        } catch (err) {
            crawlAssetCache.fontKey = key;
            if (controls.fontFamily === USER_UPLOAD_FONT_FAMILY && previousKey !== key) {
                addStatus('Choose a .ttf or .otf file to use the User-Upload font. Keeping the current font until you do.', 'WARN');
            }
            return crawlAssetCache.fontFamily || 'Arial';
        }
    }

    function crawlBackgroundCacheKey(controls) {
        const descriptor = controls.crawlBackgroundMode === 'premade'
            ? parseBackgroundSelectionValue(controls.crawlBackgroundPremade)
            : null;
        const source = descriptor ? descriptor.source : '';
        const usesCrawlText = source === 'dasdec' || source === 'eas_1cg';
        return [
            controls.crawlBackgroundMode,
            controls.crawlBackgroundPremade,
            crawlFileToken('crawlBackgroundImageFile'),
            controls.easyplusOriginator,
            controls.easyplusEventCode,
            usesCrawlText ? `${controls.crawlMode}:${controls.rawHeader}:${controls.text}` : ''
        ].join('|');
    }

    async function loadCrawlBackgroundForApply(controls) {
        const key = crawlBackgroundCacheKey(controls);
        if (crawlAssetCache.backgroundKey === key && crawlAssetCache.backgroundAssets) {
            return crawlAssetCache.backgroundAssets;
        }
        const assets = await loadCrawlBackgroundAssets(controls.crawlBackgroundMode);
        crawlAssetCache.backgroundKey = key;
        crawlAssetCache.backgroundAssets = assets;
        return assets;
    }

    async function resolveCrawlTextForApply(controls) {
        if (controls.crawlMode !== 'header') {
            return controls.text || '';
        }
        if (!controls.rawHeader || !controls.rawHeader.trim()) {
            return null;
        }
        const key = [controls.rawHeader, controls.useLocalTZ, controls.useOverrideTZ, controls.endecMode].join('|');
        if (crawlAssetCache.headerKey === key) {
            return crawlAssetCache.headerText;
        }
        let readable = null;
        try {
            readable = await header_to_readable(controls.rawHeader, controls.useLocalTZ, controls.useOverrideTZ, controls.endecMode);
        } catch (err) {
            readable = null;
        }
        const warn = readable === null && crawlAssetCache.headerKey !== key;
        crawlAssetCache.headerKey = key;
        crawlAssetCache.headerText = readable;
        if (warn) {
            addStatus('That is not a valid EAS header yet, so the crawl text is unchanged.', 'WARN');
        }
        return readable;
    }

    function syncDasdecRepetitions(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) return;
        const repetitions = Math.round(parsed);
        const dasdec = window.__dasdecBackground;
        if (dasdec && Array.isArray(dasdec.pages) && dasdec.pages.length) {
            dasdec.repetitions = repetitions;
            dasdec.totalDisplays = repetitions * dasdec.pages.length;
        }
    }

    function persistCrawlSettings(controls) {
        try {
            localStorage.setItem(localStorageKey, JSON.stringify(controls));
        } catch (err) {
            console.error('Could not save crawl settings:', err);
        }
    }

    async function applyCrawlSettings() {
        const crawlDisplay = document.getElementById('crawlDisplay');
        if (!crawlDisplay) return;

        const token = ++crawlApplyToken;
        const controls = readCrawlControls();

        const resolvedFontFamily = await resolveCrawlFontForApply(controls);
        await ensureFontsReady();
        try {
            await document.fonts.load(`${controls.fontStyle} ${controls.fontSize}px "${resolvedFontFamily}"`);
        } catch (err) { }
        const backgroundAssets = await loadCrawlBackgroundForApply(controls);
        const resolvedText = await resolveCrawlTextForApply(controls);

        if (token !== crawlApplyToken) return;

        const isNewGenerator = !window.crawlGenerator;
        if (isNewGenerator) {
            window.crawlGenerator = new TextCrawlGenerator(crawlDisplay);
        }
        const generator = window.crawlGenerator;

        let appliedAutoSizing = false;
        if (controls.crawlBackgroundMode === 'premade') {
            const autoMeta = {
                width: backgroundAssets.width,
                height: backgroundAssets.height,
                topLeft: backgroundAssets.topLeft
            };
            if (Number.isFinite(backgroundAssets.inset)) {
                autoMeta.inset = backgroundAssets.inset;
            }
            appliedAutoSizing = updateCrawlControlsFromAsset(autoMeta, { generator, premade: true });
        }

        ['crawlTopLeftPixelX', 'crawlTopLeftPixelY', 'crawlInset', 'crawlWidth', 'crawlHeight'].forEach((id) => {
            const input = document.getElementById(id);
            if (!input || input.value === undefined) return;
            if (id === 'crawlTopLeftPixelX') controls.crawlTopLeftOffsetX = input.value;
            else if (id === 'crawlTopLeftPixelY') controls.crawlTopLeftOffsetY = input.value;
            else if (id === 'crawlInset') controls.crawlInset = input.value;
            else if (id === 'crawlWidth') controls.crawlWidth = input.value;
            else controls.crawlHeight = input.value;
        });

        persistCrawlSettings(controls);

        if (!appliedAutoSizing) {
            applyCrawlSizeToGenerator(generator);
        }

        applyBackgroundToGenerator(generator, controls.crawlBackgroundMode, backgroundAssets);

        if (resolvedText !== null) {
            generator.setText(resolvedText);
        }

        if (backgroundAssets.image) {
            generator.setBgColor('rgba(0,0,0,0)');
            generator.setTopLeftOffsetX(controls.crawlTopLeftOffsetX);
            generator.setTopLeftOffsetY(controls.crawlTopLeftOffsetY);
        }

        const parsedVdsDelay = Number(controls.vdsFrameDelay);
        generator.setSpeed(controls.speed);
        generator.setFontSize(controls.fontSize);
        generator.setTextColor(controls.textColor);
        generator.setBgColor(controls.bgColor === 'transparent' ? 'rgba(0,0,0,0)' : controls.bgColor);
        generator.setFontFamily(resolvedFontFamily);
        generator.setFontStyle(controls.fontStyle);
        generator.setOutlineColor(controls.outlineColor);
        generator.setOutlineWidth(controls.outlineWidth);
        generator.setOutlineJoin(controls.outlineJoin);
        generator.setCrawlInset(controls.crawlInset);
        generator.setCrawlRestartDelay(controls.crawlRestartDelay);
        generator.vdsBaseDelayFrames = Number.isFinite(parsedVdsDelay) && parsedVdsDelay > 0
            ? parsedVdsDelay
            : DEFAULT_VDS_BASE_DELAY;
        generator.setVDSMode(controls.useVDSMode);
        generator.setRepetitions(controls.repetitions);
        syncDasdecRepetitions(controls.repetitions);
        generator.setKerning(controls.crawlKerning);
        generator.setTextWidth(controls.crawlTextWidth);

        if (isNewGenerator) {
            generator._updateButtons(false);
            generator.stop();
            setPauseButtonState(true);
            pauseDasdecRotationState();
        } else if (crawlPaused) {
            generator._renderFrame({ advance: false });
        }
    }

    function runCrawlApply() {
        crawlApplyRunning = (crawlApplyRunning || Promise.resolve())
            .catch(() => { })
            .then(() => applyCrawlSettings())
            .catch((err) => {
                console.error('Crawl settings could not be applied:', err);
                addStatus(`Could not apply crawl settings: ${err?.message || err}`, 'ERROR');
            });
        return crawlApplyRunning;
    }

    function scheduleCrawlApply(delay = 200) {
        if (crawlApplyTimer) {
            clearTimeout(crawlApplyTimer);
        }
        crawlApplyTimer = setTimeout(() => {
            crawlApplyTimer = null;
            runCrawlApply();
        }, delay);
    }

    async function flushCrawlApply() {
        if (crawlApplyTimer) {
            clearTimeout(crawlApplyTimer);
            crawlApplyTimer = null;
            runCrawlApply();
        }
        if (crawlApplyRunning) {
            try {
                await crawlApplyRunning;
            } catch (err) { }
        }
    }

    const CRAWL_LIVE_INPUT_IDS = [
        'crawlText', 'crawlRawHeader', 'crawlSpeed', 'crawlFontSize', 'crawlTextColor',
        'crawlBgColor', 'crawlMode', 'crawlUseLocalTZ', 'crawlUseOverrideTZ', 'endecMode',
        'crawlUseVDSMode', 'vdsFrameDelay', 'crawlFontFamily', 'crawlCustomFontFile',
        'crawlFontStyle', 'crawlOutlineColor', 'crawlOutlineWidth', 'crawlOutlineJoin',
        'crawlWidth', 'crawlHeight', 'crawlInset', 'crawlTopLeftPixelX', 'crawlTopLeftPixelY',
        'crawlKerning', 'crawlTextWidth', 'crawlRestartDelay', 'crawlRepetitions',
        'crawlBackgroundMode', 'crawlBackgroundImageFile', 'crawlBackgroundPremadeSelect',
        'easyplusOriginator', 'easyplusEventCode'
    ];

    CRAWL_LIVE_INPUT_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => scheduleCrawlApply());
        el.addEventListener('change', () => scheduleCrawlApply());
    });

    function attachCrawlEditorListener() {
        const editor = window.crawlEditor;
        if (!editor || editor.__liveApplyAttached) return;
        editor.__liveApplyAttached = true;
        editor.on('change', () => {
            editor.save();
            scheduleCrawlApply(300);
        });
    }

    async function bootstrapCrawl() {
        if (crawlBootstrapped) return;
        crawlBootstrapped = true;
        const modeInput = document.getElementById('crawlMode');
        if (!modeInput || modeInput.value !== 'header') {
            try {
                await initCrawlEditor();
            } catch (err) {
                console.error('Could not initialize the crawl text editor:', err);
            }
        }
        attachCrawlEditorListener();
        await runCrawlApply();
    }

    document.getElementById('stopCrawl').addEventListener('click', () => {
        if (!window.crawlGenerator) return;
        pauseDasdecRotationState();
        window.crawlGenerator.stop();
        setPauseButtonState(true);
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

    document.getElementById('exportCrawlGIF').addEventListener('click', async () => {
        await flushCrawlApply();
        if (!window.crawlGenerator) return;
        exportAsGIF(window.crawlGenerator.canvas, 'text_crawl.gif');
    });

    document.getElementById('exportCrawlVideo').addEventListener('click', async () => {
        await flushCrawlApply();
        if (!window.crawlGenerator) return;
        exportAsVideo(window.crawlGenerator.canvas);
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
            addStatus('The crawl is still loading. Try copying again in a moment.', 'WARN');
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
        const usingEas1cgBackground = backgroundModeSelect
            && backgroundModeSelect.value === 'premade'
            && premadeSelect
            && premadeSelect.value.includes('eas_1cg');

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

        else if (usingHeaderMode && usingEas1cgBackground) {
            const rawHeader = document.getElementById('crawlRawHeader').value;
            if (!rawHeader) {
                alert('Please provide an EAS header before copying EAS-1CG text.');
                return;
            }
            try {
                const screenLines = await formatEas1cg(rawHeader, true);
                if (Array.isArray(screenLines) && screenLines.length) {
                    textToCopy = screenLines.join('\n').trim();
                }
            } catch (error) {
                console.error('Failed to format EAS-1CG text for copying:', error);
                addStatus('Failed to format EAS-1CG text. Falling back to displayed crawl text.', 'WARN');
            }
        }

        try {
            await navigator.clipboard.writeText(textToCopy);
            if (usingHeaderMode && usingDasdecBackground) {
                addStatus('Formatted DASDEC text copied to clipboard!');
            }

            else if (usingHeaderMode && usingEas1cgBackground) {
                addStatus('Formatted EAS-1CG text copied to clipboard!');
            }

            else {
                addStatus('Crawl text copied to clipboard!');
            }
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

        if (mode !== 'premade') {
            clearPremadeInputLocks();
        } else {
            syncPremadeInputLocks();
        }
    });

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
        input.addEventListener('input', () => applyCrawlSizeToGenerator());
        input.addEventListener('change', () => {
            commitCrawlDimensionInputs();
            applyCrawlSizeToGenerator();
        });
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
        const textWidthEl = document.getElementById('crawlTextWidth');
        const textScaleX = normalizeTextScale(textWidthEl ? textWidthEl.value : DEFAULT_TEXT_WIDTH_PERCENT);

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

        const renderText = createTextRenderer(ctx, outlineColor, outlineWidth, textScaleX);
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
        'crawlKerning', 'crawlTextWidth', 'crawlCustomFontFile'
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
            scheduleCrawlApply(0);
            alert(`Preset #${presetNumber} loaded!`);
        } else {
            alert(`No preset found for #${presetNumber}.`);
        }
    });

    const CRAWL_PRESET_FILE_TYPE = 'eas-tools-crawl-preset';

    function extractPresetSettings(parsed) {
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        if (parsed.settings && typeof parsed.settings === 'object') {
            return parsed.settings;
        }
        return parsed;
    }

    const exportUserPresetButton = document.getElementById('exportUserPreset');
    if (exportUserPresetButton) {
        exportUserPresetButton.addEventListener('click', async () => {
            const presetNumber = document.getElementById('crawlUserPreset').value;
            const payload = JSON.stringify({
                type: CRAWL_PRESET_FILE_TYPE,
                version: 1,
                preset: presetNumber,
                settings: getCurrentSettings()
            }, null, 2);
            try {
                await saveFile(`eas-crawl-preset-${presetNumber}.json`, payload, 'application/json');
                addStatus(`Exported Preset #${presetNumber} to file.`);
            } catch (err) {
                console.error('[crawl] preset export failed:', err);
                alert('Could not export the preset to a file. Please try again.');
            }
        });
    }

    const importUserPresetButton = document.getElementById('importUserPreset');
    const importUserPresetInput = document.getElementById('importUserPresetFile');
    if (importUserPresetButton && importUserPresetInput) {
        importUserPresetButton.addEventListener('click', () => {
            importUserPresetInput.value = '';
            importUserPresetInput.click();
        });
        importUserPresetInput.addEventListener('change', () => {
            const file = importUserPresetInput.files && importUserPresetInput.files[0];
            if (!file) {
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                let settings = null;
                try {
                    settings = extractPresetSettings(JSON.parse(reader.result));
                } catch (err) {
                    settings = null;
                }
                if (!settings) {
                    alert('That file is not a valid EAS Tools crawl preset.');
                    return;
                }
                applySettingsToControls(settings, { showStatus: false });
                scheduleCrawlApply(0);
                alert('Preset imported!');
            };
            reader.onerror = () => {
                alert('Could not read that file. Please try again.');
            };
            reader.readAsText(file);
        });
    }

    document.getElementById('crawlMode').addEventListener('change', async (event) => {
        if (event.target.value == 'custom' && !window.crawlEditor) {
            await initCrawlEditor();
            attachCrawlEditorListener();
        }
    });

    bootstrapCrawl();

    if (window.EASBridge) {
        const PREMADE_STATIC_SOURCES = new Set(['dasdec', 'eas_1cg']);
        function sendEndecModesToNative() {
            const modes = allEndecModes().filter((mode) => mode.toLowerCase() !== 'json');
            const modeList = [{ value: '', label: 'None (Default)' }];
            modes.forEach(m => modeList.push({ value: m, label: m }));
            window.EASBridge.send('crawl:endecModes', { modes: modeList });
        }
        function sendCrawlFontsToNative() {
            const list = window.crawlFontsToLoad || [];
            const fonts = list
                .filter((f) => f.family !== 'User-Upload')
                .map((f) => ({ value: f.family, label: `${f.family} (${f.description})`, file: f.file }));
            window.EASBridge.send('crawl:fontsData', { fonts: fonts });
        }
        function sendPremadeListToNative() {
            const sel = document.getElementById('crawlBackgroundPremadeSelect');
            if (!sel) return;
            const options = Array.from(sel.options).map((o) => ({ value: o.value, label: o.textContent }));
            window.EASBridge.send('crawl:premadeList', { options: options });
        }
        resourcesReady.then(sendEndecModesToNative).catch(() => sendEndecModesToNative());
        sendCrawlFontsToNative();
        sendPremadeListToNative();

        window.EASBridge.on('crawl:convertHeader', async (params) => {
            const rawHeader = params?.header;
            if (!rawHeader) return;
            try {
                const endecMode = params?.endecMode || null;
                const text = await header_to_readable(rawHeader, false, '', endecMode);
                window.EASBridge.send('crawl:headerConverted', { text: text || '' });

                try {
                    const dasdecPages = await formatDasdecEAS2Text(rawHeader);
                    if (dasdecPages && dasdecPages.length) {
                        const flatText = dasdecPages.map(page => page.join('\n')).join('\n');
                        window.EASBridge.send('crawl:dasdecFormatted', { text: flatText });
                    }
                } catch (e) { /* DASDEC formatting optional */ }
            } catch (err) {
                console.error('[EASBridge] crawl:convertHeader error:', err);
                window.EASBridge.send('crawl:headerConverted', { text: '' });
            }
        });

        window.EASBridge.on('crawl:renderPremade', async (params) => {
            const requestId = Number.isFinite(params?.requestId) ? params.requestId : 0;
            const premade = params?.premade || '';
            const applySizing = params?.applySizing === true;
            try {
                const el = (id) => document.getElementById(id);
                const setVal = (id, val) => { if (el(id) && val != null) el(id).value = val; };
                setVal('crawlBackgroundMode', 'premade');
                setVal('crawlBackgroundPremadeSelect', premade);
                setVal('crawlMode', params?.crawlMode || 'custom');
                setVal('crawlRawHeader', params?.header != null ? params.header : '');
                setVal('crawlText', params?.text != null ? params.text : '');
                setVal('endecMode', params?.endecMode != null ? params.endecMode : '');
                setVal('easyplusOriginator', params?.easyplusOriginator);
                setVal('easyplusEventCode', params?.easyplusEventCode);
                setVal('crawlRepetitions', params?.repetitions);

                const assets = await loadCrawlBackgroundAssets('premade');
                const descriptor = parseBackgroundSelectionValue(premade);
                const source = descriptor ? descriptor.source : '';

                let images = [];
                let rotationDelayMs = 0;
                const dasdec = window.__dasdecBackground;
                if (dasdec && Array.isArray(dasdec.pages) && dasdec.pages.length) {
                    images = dasdec.pages.map((p) => p && p.src).filter(Boolean);
                    rotationDelayMs = Number.isFinite(dasdec.rotationDelayMs) ? dasdec.rotationDelayMs : 4000;
                } else if (assets && assets.image && assets.image.src) {
                    images = [assets.image.src];
                }
                stopDasdecRotationState();

                const topLeft = assets && assets.topLeft ? assets.topLeft : null;
                const tlx = topLeft && Number.isFinite(topLeft.x) && topLeft.x < 9999 ? topLeft.x : 0;
                const tly = topLeft && Number.isFinite(topLeft.y) && topLeft.y < 9999 ? topLeft.y : 0;
                window.EASBridge.send('crawl:premadeImage', {
                    requestId: requestId,
                    premade: premade,
                    source: source,
                    applySizing: applySizing,
                    images: images,
                    rotationDelayMs: rotationDelayMs,
                    width: assets && Number.isFinite(assets.width) ? assets.width : 0,
                    height: assets && Number.isFinite(assets.height) ? assets.height : 0,
                    topLeftX: tlx,
                    topLeftY: tly,
                    scroll: !PREMADE_STATIC_SOURCES.has(source)
                });
            } catch (err) {
                console.error('[EASBridge] crawl:renderPremade error:', err);
                window.EASBridge.send('crawl:premadeImage', { requestId: requestId, premade: premade, images: [], error: true });
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
                setVal('crawlOutlineJoin', params.outlineJoin);
                setVal('crawlKerning', params.kerning);
                setVal('crawlTextWidth', params.textWidth);
                setVal('crawlRestartDelay', params.restartDelay);
                setVal('crawlBackgroundMode', params.bgMode || 'solid');
                setChk('crawlUseVDSMode', params.vdsMode);
                setVal('vdsFrameDelay', params.vdsFrameDelay);
                setVal('crawlMode', 'custom');
                setVal('crawlRepetitions', params.repetitions);
                setVal('crawlExportGifFps', params.gifFps);
                setVal('crawlExportVideoFps', params.videoFps);
                setVal('crawlExportVideoFormat', params.videoFormat);

                scheduleCrawlApply(0);
                await flushCrawlApply();

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
                    const stageLabel = () => {
                        const labelEl = document.querySelector('label[for="crawlExportProgress"]');
                        if (!labelEl) return '';
                        return labelEl.textContent
                            .replace(/\s*\d+%\s*$/, '')
                            .replace(/:\s*$/, '')
                            .trim();
                    };
                    progressObserver = new MutationObserver(() => {
                        const val = parseFloat(progressBar.value) || 0;
                        const max = parseFloat(progressBar.max) || 1;
                        window.EASBridge.send('crawl:exportProgress', { progress: val / max, stage: stageLabel() });
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
                    exportAsVideo(window.crawlGenerator.canvas);
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
            sendCrawlFontsToNative();
            sendPremadeListToNative();
        });

        console.log('[EASBridge] Crawl bridge handlers registered');
    }
})();
