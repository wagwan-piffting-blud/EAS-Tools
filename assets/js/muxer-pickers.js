import { enhanceFilePicker } from './file-picker.js';

function kindFor(input) {
    return /^video\//.test(input.getAttribute('accept') || '') ? 'video' : 'audio';
}

function enhanceAll(root) {
    root.querySelectorAll('input[type="file"]').forEach((input) => enhanceFilePicker(input, { kind: kindFor(input) }));
}

const app = document.getElementById('app');
if (app) {
    enhanceAll(app);
    new MutationObserver(() => enhanceAll(app)).observe(app, { childList: true, subtree: true });
}
