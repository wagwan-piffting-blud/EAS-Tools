const inbox = new Map();
const receivers = new Map();
let menuSeq = 0;

function tabButton(tool) {
    return document.getElementById('tab-' + tool);
}

export function toolName(tool) {
    const tab = tabButton(tool);
    return (tab && tab.textContent.trim()) || tool;
}

export function canSendTo(tool) {
    return !!tabButton(tool);
}

export function announce(message) {
    const el = document.getElementById('alert-announcer');
    if (!el || !message) return;
    el.textContent = '';
    requestAnimationFrame(() => {
        el.textContent = message;
    });
}

function deliver(tool) {
    const handler = receivers.get(tool);
    if (!handler || !inbox.has(tool)) return;
    const { payload, note } = inbox.get(tool);
    inbox.delete(tool);
    Promise.resolve()
        .then(() => handler(payload))
        .then(() => announce(note))
        .catch((err) => {
            console.error('[handoff] ' + tool + ' could not receive the payload', err);
            announce('Could not send to ' + toolName(tool) + '.');
        });
}

export function sendTo(tool, payload, { what = 'Result' } = {}) {
    const tab = tabButton(tool);
    if (!tab || !payload) return false;
    inbox.set(tool, { payload, note: what + ' sent to ' + toolName(tool) + '.' });
    if (tab.getAttribute('aria-selected') !== 'true') {
        tab.click();
    }
    deliver(tool);
    return true;
}

export function receive(tool, handler) {
    receivers.set(tool, handler);
    deliver(tool);
}

export function audioFile(data, name, type = 'audio/wav') {
    if (!data) return null;
    if (typeof File === 'function' && data instanceof File) return data;
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    return new File([blob], name, { type: blob.type || type });
}

export function createSendMenu({ doc = document, label = 'Send to…', title = '', items = [] } = {}) {
    const id = 'eas-send-menu-' + (++menuSeq);
    const wrap = doc.createElement('div');
    wrap.className = 'send-menu';

    const button = doc.createElement('button');
    button.type = 'button';
    button.id = id + '-button';
    button.className = 'send-menu__button';
    button.textContent = label;
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', id);
    if (title) button.title = title;

    const list = doc.createElement('ul');
    list.id = id;
    list.className = 'send-menu__list';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-labelledby', button.id);
    list.hidden = true;

    wrap.append(button, list);

    let entries = [];

    const onOutside = (event) => {
        if (!wrap.contains(event.target)) close(false);
    };

    function close(restoreFocus) {
        if (list.hidden) return;
        list.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        doc.removeEventListener('pointerdown', onOutside, true);
        if (restoreFocus) button.focus();
    }

    function focusEntry(index) {
        if (!entries.length) return;
        const n = entries.length;
        entries[((index % n) + n) % n].focus();
    }

    async function run(item) {
        let payload = null;
        try {
            payload = await item.payload();
        } catch (err) {
            console.error('[handoff] could not prepare the payload for ' + item.tool, err);
            announce((err && err.message) || ('Could not prepare the result for ' + toolName(item.tool) + '.'));
            return;
        }
        if (payload) sendTo(item.tool, payload, { what: item.what || 'Result' });
    }

    function build() {
        list.replaceChildren();
        entries = items.filter((item) => canSendTo(item.tool)).map((item) => {
            const li = doc.createElement('li');
            li.setAttribute('role', 'none');
            const entry = doc.createElement('button');
            entry.type = 'button';
            entry.className = 'send-menu__item';
            entry.setAttribute('role', 'menuitem');
            entry.tabIndex = -1;
            entry.textContent = item.label || toolName(item.tool);
            const reason = typeof item.unavailable === 'function' ? item.unavailable() : '';
            if (reason) {
                entry.setAttribute('aria-disabled', 'true');
                const note = doc.createElement('span');
                note.className = 'send-menu__reason';
                note.textContent = ' (' + reason + ')';
                entry.append(note);
            }
            entry.addEventListener('click', () => {
                if (entry.getAttribute('aria-disabled') === 'true') {
                    announce(reason);
                    return;
                }
                close(false);
                run(item);
            });
            li.append(entry);
            list.append(li);
            return entry;
        });
    }

    function open(focusIndex) {
        build();
        if (!entries.length) return;
        list.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        doc.addEventListener('pointerdown', onOutside, true);
        focusEntry(focusIndex);
    }

    button.addEventListener('click', () => {
        if (list.hidden) open(0);
        else close(true);
    });

    button.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            open(0);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            open(-1);
        }
    });

    list.addEventListener('keydown', (event) => {
        const index = entries.indexOf(doc.activeElement);
        switch (event.key) {
            case 'ArrowDown':
                focusEntry(index + 1);
                break;
            case 'ArrowUp':
                focusEntry(index - 1);
                break;
            case 'Home':
                focusEntry(0);
                break;
            case 'End':
                focusEntry(-1);
                break;
            case 'Escape':
                close(true);
                break;
            case 'Tab':
                close(false);
                return;
            default:
                return;
        }
        event.preventDefault();
    });

    wrap.hidden = !items.some((item) => canSendTo(item.tool));

    return {
        element: wrap,
        button,
        close: () => close(false),
        setDisabled(disabled) {
            button.disabled = !!disabled;
            if (disabled) close(false);
        },
        setVisible(visible) {
            wrap.hidden = !visible || !items.some((item) => canSendTo(item.tool));
            if (wrap.hidden) close(false);
        },
    };
}

if (typeof window !== 'undefined') {
    window.EASHandoff = { sendTo, receive, createSendMenu, canSendTo, toolName, announce, audioFile };
}
