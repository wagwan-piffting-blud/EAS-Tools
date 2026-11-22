const AUDIO_EXTENSIONS = [
    'wav', 'wave', 'bwf', 'rf64', 'mp3', 'm4a', 'm4b', 'aac', 'adts', 'flac', 'ogg', 'oga', 'opus', 'weba',
    'aif', 'aiff', 'aifc', 'caf', 'mka',
];
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', '3gp', '3g2', 'ts'];
const ANIMATED_IMAGE_EXTENSIONS = ['gif'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'];

export const FILE_TYPES = Object.freeze({
    audio: Object.freeze({
        label: 'audio or video file',
        mimeTypes: ['audio/*', 'video/*'],
        extensions: [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS],
    }),
    video: Object.freeze({
        label: 'video or animated GIF',
        mimeTypes: ['video/*', 'image/gif'],
        extensions: [...VIDEO_EXTENSIONS, ...ANIMATED_IMAGE_EXTENSIONS],
    }),
    image: Object.freeze({
        label: 'image',
        mimeTypes: ['image/*'],
        extensions: IMAGE_EXTENSIONS,
    }),
    font: Object.freeze({
        label: 'TrueType or OpenType font',
        mimeTypes: ['font/ttf', 'font/otf', 'font/sfnt', 'application/x-font-ttf', 'application/x-font-otf'],
        extensions: ['ttf', 'otf'],
    }),
    json: Object.freeze({
        label: 'JSON file',
        mimeTypes: ['application/json'],
        extensions: ['json'],
    }),
    geo: Object.freeze({
        label: 'GeoJSON or KML file',
        mimeTypes: ['application/json', 'application/geo+json', 'application/vnd.google-earth.kml+xml'],
        extensions: ['geojson', 'json', 'kml'],
    }),
    palette: Object.freeze({
        label: 'color table',
        mimeTypes: ['text/plain'],
        extensions: ['pal', 'txt'],
    }),
    macro: Object.freeze({
        label: 'Audacity macro',
        mimeTypes: ['text/plain'],
        extensions: ['txt'],
    }),
    zip: Object.freeze({
        label: 'project file',
        mimeTypes: ['application/zip', 'application/x-zip-compressed'],
        extensions: ['zip'],
    }),
    any: Object.freeze({
        label: 'file',
        mimeTypes: [],
        extensions: [],
    }),
});

export function fileKind(kind) {
    return Object.prototype.hasOwnProperty.call(FILE_TYPES, kind) ? kind : 'any';
}

export function acceptFor(kind) {
    const type = FILE_TYPES[fileKind(kind)];
    return [...type.mimeTypes, ...type.extensions.map((ext) => `.${ext}`)].join(',');
}

export function fileExtension(name) {
    const match = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
    return match ? match[1].toLowerCase() : '';
}

export function fileMatchesKind(file, kind) {
    const type = FILE_TYPES[fileKind(kind)];
    if (!type.mimeTypes.length && !type.extensions.length) {
        return !!file;
    }
    if (!file) {
        return false;
    }
    if (type.extensions.includes(fileExtension(file.name))) {
        return true;
    }
    const mime = String(file.type || '').toLowerCase();
    return !!mime && type.mimeTypes.some((pattern) => (pattern.endsWith('/*') ? mime.startsWith(pattern.slice(0, -1)) : mime === pattern));
}

export function isAnimatedImageFile(file) {
    return !!file && (String(file.type || '').toLowerCase() === 'image/gif' || ANIMATED_IMAGE_EXTENSIONS.includes(fileExtension(file.name)));
}

export function nativeFileTypes() {
    return Object.fromEntries(Object.entries(FILE_TYPES).map(([kind, type]) => [kind, {
        label: type.label,
        mimeTypes: [...type.mimeTypes],
        extensions: [...type.extensions],
    }]));
}
