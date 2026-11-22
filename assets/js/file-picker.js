import { FILE_TYPES, acceptFor, fileKind, fileMatchesKind } from './file-types.js';

const ENHANCED = new WeakMap();
const EMPTY_TEXT = 'No file chosen';

function describeFiles(input) {
    const files = input.files ? [...input.files] : [];
    if (!files.length) {
        return EMPTY_TEXT;
    }
    return files.length === 1 ? files[0].name : `${files.length} files`;
}

function assignFiles(input, files) {
    if (typeof DataTransfer !== 'function') {
        return false;
    }
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

function acceptDrops(target, input, kind) {
    const wanted = (event) => event.dataTransfer && [...event.dataTransfer.types].includes('Files');
    target.addEventListener('dragover', (event) => {
        if (!wanted(event) || input.disabled) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        target.classList.add('file-picker-drop');
    });
    target.addEventListener('dragleave', () => target.classList.remove('file-picker-drop'));
    target.addEventListener('drop', (event) => {
        target.classList.remove('file-picker-drop');
        if (!wanted(event) || input.disabled) {
            return;
        }
        event.preventDefault();
        const files = [...event.dataTransfer.files].filter((file) => fileMatchesKind(file, kind));
        if (!files.length) {
            target.dispatchEvent(new CustomEvent('file-picker:rejected', { bubbles: true, detail: { kind, label: FILE_TYPES[kind].label } }));
            return;
        }
        assignFiles(input, input.multiple ? files : files.slice(0, 1));
    });
}

export function refreshFilePicker(input) {
    const state = ENHANCED.get(input);
    if (state && state.name) {
        state.name.textContent = describeFiles(input);
        state.name.classList.toggle('file-picker-empty', !(input.files && input.files.length));
    }
}

export function enhanceFilePicker(input, { kind = input && input.dataset.filePicker, triggers = [], buttonText = null } = {}) {
    if (!input || ENHANCED.has(input)) {
        return ENHANCED.get(input) || null;
    }
    const resolved = fileKind(kind);
    if (resolved !== 'any') {
        input.accept = acceptFor(resolved);
    }
    input.dataset.filePicker = resolved;
    const buttons = [...(triggers || [])].filter(Boolean);
    if (buttons.length) {
        buttons.forEach((button) => {
            button.classList.add('file-picker-button');
            acceptDrops(button, input, resolved);
        });
        input.dataset.filePickerButtons = String(buttons.length);
        const state = { input, button: buttons[0], name: null, wrapper: null };
        ENHANCED.set(input, state);
        return state;
    }
    const wrapper = document.createElement('span');
    wrapper.className = 'file-picker';
    input.classList.forEach((name) => wrapper.classList.add(name));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-picker-button';
    button.textContent = buttonText || input.dataset.filePickerText || (input.multiple ? 'Choose files…' : 'Choose file…');
    const name = document.createElement('span');
    name.className = 'file-picker-name file-picker-empty';
    name.setAttribute('aria-live', 'polite');
    name.textContent = describeFiles(input);
    const labels = input.labels ? [...input.labels] : [];
    if (labels.length) {
        const ids = labels.map((label) => {
            if (!label.id) {
                label.id = `${input.id || 'file'}-label`;
            }
            return label.id;
        });
        button.setAttribute('aria-labelledby', ids.join(' '));
        labels.forEach((label) => label.addEventListener('click', (event) => {
            if (wrapper.contains(event.target)) {
                return;
            }
            event.preventDefault();
            button.click();
        }));
    }
    input.parentNode.insertBefore(wrapper, input);
    wrapper.append(button, name, input);
    input.classList.add('file-picker-input');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    button.addEventListener('click', () => {
        if (!input.disabled) {
            input.click();
        }
    });
    input.addEventListener('change', () => refreshFilePicker(input));
    acceptDrops(wrapper, input, resolved);
    const state = { input, button, name, wrapper };
    ENHANCED.set(input, state);
    refreshFilePicker(input);
    return state;
}

export function enhanceFilePickers(root = document) {
    const inputs = root.matches && root.matches('input[type="file"][data-file-picker]')
        ? [root]
        : [...root.querySelectorAll('input[type="file"][data-file-picker]')];
    return inputs.map((input) => {
        const selector = input.dataset.filePickerTrigger;
        const triggers = selector ? [...document.querySelectorAll(selector)] : [];
        return enhanceFilePicker(input, { triggers });
    });
}

export function clearFilePicker(input) {
    input.value = '';
    refreshFilePicker(input);
}

function watchForPickers() {
    enhanceFilePickers(document);
    if (typeof MutationObserver !== 'function' || !document.body) {
        return;
    }
    new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType === 1 && (node.matches('input[type="file"][data-file-picker]') || node.querySelector('input[type="file"][data-file-picker]'))) {
                    enhanceFilePickers(node);
                }
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watchForPickers, { once: true });
    } else {
        watchForPickers();
    }
}
