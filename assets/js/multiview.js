const STORAGE_KEY = 'eas-tools-multiview';
const DEFAULT_PANES = ['warngen', 'splicer', 'encoder', 'crawl'];
const MIN_PANES = 2;
const MAX_PANES = 4;
const WIDE_QUERY = '(min-width: 1024px)';
const DRAG_THRESHOLD = 6;

const panel = document.getElementById('multiview-panel');
const root = document.getElementById('multiview-root');

const tools = Array.from(document.querySelectorAll('#nav-buttons button[data-tool]'))
    .filter((button) => button.dataset.tool !== 'multiview')
    .map((button) => ({ key: button.dataset.tool, name: button.textContent.trim() }));
const toolNames = Object.fromEntries(tools.map((tool) => [tool.key, tool.name]));

const panes = [];
let paneSeq = 0;
let drag = null;
let suppressClickUntil = 0;

function loadLayout() {
    let saved = null;
    try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
        saved = null;
    }
    const pick = (list) => [...new Set((Array.isArray(list) ? list : []).filter((key) => key in toolNames))].slice(0, MAX_PANES);
    const layout = pick(saved);
    return layout.length >= MIN_PANES ? layout : pick(DEFAULT_PANES.concat(tools.map((tool) => tool.key)));
}

function saveLayout() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(panes.map((pane) => pane.tool)));
    } catch {
        return;
    }
}

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key in node && typeof value !== 'string') node[key] = value;
        else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
}

const status = el('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', id: 'mv-status' });
const palette = el('div', { class: 'mv-palette', role: 'group', 'aria-label': 'Tools' });
const addZone = el('div', { class: 'mv-addzone', dataset: { drop: 'add' }, hidden: true }, ['Drop here to add a pane']);
const grid = el('div', { class: 'mv-grid', id: 'mv-grid' });
const narrow = el('p', { class: 'mv-narrow', hidden: true }, ['Multi-View needs a window at least 1024 pixels wide. Widen the window, or turn a tablet sideways.']);

function announce(message) {
    status.textContent = '';
    requestAnimationFrame(() => {
        status.textContent = message;
    });
}

function paneUrl(tool) {
    return 'index.html?tool=' + encodeURIComponent(tool) + '&pane=1';
}

function chipFor(tool) {
    const chip = el('button', { type: 'button', class: 'mv-chip', dataset: { mvTool: tool.key } }, [tool.name]);
    chip.addEventListener('pointerdown', (event) => startDrag(event, { kind: 'tool', tool: tool.key, label: tool.name }));
    chip.addEventListener('click', () => {
        const open = panes.find((pane) => pane.tool === tool.key);
        if (open) {
            open.select.focus();
            flash(open);
            announce(tool.name + ' is already open in pane ' + (panes.indexOf(open) + 1) + '.');
        } else {
            addPane(tool.key);
        }
    });
    return chip;
}

function createPane(tool) {
    const id = 'mv-pane-' + (++paneSeq);
    const grip = el('button', { type: 'button', class: 'mv-pane__grip' }, ['⠿']);
    const select = el('select', { class: 'mv-pane__select', id: id + '-tool' });
    const label = el('label', { class: 'visually-hidden', for: id + '-tool' });
    const left = el('button', { type: 'button', class: 'mv-pane__move', dataset: { move: '-1' } }, ['◀']);
    const right = el('button', { type: 'button', class: 'mv-pane__move', dataset: { move: '1' } }, ['▶']);
    const close = el('button', { type: 'button', class: 'mv-pane__close' }, ['✕']);
    const frame = el('iframe', { class: 'mv-pane__frame', allow: 'microphone; autoplay; clipboard-read; clipboard-write; fullscreen' });
    const bar = el('div', { class: 'mv-pane__bar' }, [grip, label, select, left, right, close]);
    const element = el('section', { class: 'mv-pane', id, dataset: { drop: 'pane' } }, [bar, frame]);
    const pane = { id, tool, element, grip, select, label, left, right, close, frame, ready: false, queue: [] };

    frame.addEventListener('load', () => {
        if (frame.getAttribute('src') === 'about:blank') return;
        pane.ready = true;
        flush(pane);
    });
    grip.addEventListener('pointerdown', (event) => startDrag(event, { kind: 'pane', pane, label: toolNames[pane.tool] }));
    select.addEventListener('change', () => dropTool(select.value, pane));
    left.addEventListener('click', () => movePane(pane, -1));
    right.addEventListener('click', () => movePane(pane, 1));
    close.addEventListener('click', () => removePane(pane));

    setFrameTool(pane, tool);
    grid.appendChild(element);
    return pane;
}

function setFrameTool(pane, tool) {
    pane.tool = tool;
    pane.ready = false;
    pane.frame.title = toolNames[tool] + ' (Multi-View pane)';
    pane.frame.src = paneUrl(tool);
}

function render() {
    grid.dataset.count = String(panes.length);
    const used = new Set(panes.map((pane) => pane.tool));
    panes.forEach((pane, index) => {
        const name = toolNames[pane.tool];
        const position = 'pane ' + (index + 1) + ' of ' + panes.length;
        pane.element.style.order = String(index);
        pane.element.dataset.slot = String(index);
        pane.element.dataset.tool = pane.tool;
        pane.element.setAttribute('aria-label', name + ', ' + position);
        pane.label.textContent = 'Tool in ' + position;
        pane.grip.setAttribute('aria-label', 'Move ' + name + ' (drag onto another pane)');
        pane.grip.title = 'Drag onto another pane to swap places';
        pane.left.setAttribute('aria-label', 'Move ' + name + ' earlier');
        pane.right.setAttribute('aria-label', 'Move ' + name + ' later');
        pane.close.setAttribute('aria-label', 'Close ' + name);
        pane.left.disabled = index === 0;
        pane.right.disabled = index === panes.length - 1;
        pane.close.disabled = panes.length <= MIN_PANES;
        pane.select.replaceChildren(...tools.map((tool) => {
            const option = el('option', { value: tool.key }, [tool.name]);
            option.selected = tool.key === pane.tool;
            if (tool.key !== pane.tool && used.has(tool.key)) option.textContent = tool.name + ' (swap)';
            return option;
        }));
    });
    palette.querySelectorAll('.mv-chip').forEach((chip) => {
        const open = used.has(chip.dataset.mvTool);
        chip.setAttribute('aria-pressed', open ? 'true' : 'false');
        chip.title = open ? 'Open in a pane; drag onto another pane to swap' : (panes.length < MAX_PANES ? 'Click to add a pane, or drag onto a pane to replace it' : 'Drag onto a pane to replace it');
    });
    saveLayout();
}

function addPane(tool, { quiet = false } = {}) {
    if (panes.length >= MAX_PANES) {
        announce('Multi-View holds at most ' + MAX_PANES + ' tools. Close a pane or drag ' + toolNames[tool] + ' onto one to replace it.');
        return null;
    }
    const pane = createPane(tool);
    panes.push(pane);
    render();
    if (!quiet) announce('Opened ' + toolNames[tool] + ' in pane ' + panes.length + '.');
    return pane;
}

function removePane(pane) {
    if (panes.length <= MIN_PANES) {
        announce('Multi-View needs at least ' + MIN_PANES + ' tools.');
        return;
    }
    const index = panes.indexOf(pane);
    panes.splice(index, 1);
    pane.frame.src = 'about:blank';
    pane.element.remove();
    render();
    announce('Closed ' + toolNames[pane.tool] + '.');
    const next = panes[Math.min(index, panes.length - 1)];
    if (next) next.close.focus();
}

function movePane(pane, delta) {
    const from = panes.indexOf(pane);
    const to = from + delta;
    if (to < 0 || to >= panes.length) return;
    swapPanes(pane, panes[to]);
    const button = delta < 0 ? pane.left : pane.right;
    (button.disabled ? pane.grip : button).focus();
}

function swapPanes(a, b) {
    if (a === b) return;
    const i = panes.indexOf(a);
    const j = panes.indexOf(b);
    panes[i] = b;
    panes[j] = a;
    render();
    announce('Moved ' + toolNames[a.tool] + ' to pane ' + (j + 1) + ' and ' + toolNames[b.tool] + ' to pane ' + (i + 1) + '.');
}

function dropTool(tool, pane) {
    if (!(tool in toolNames) || tool === pane.tool) return;
    const other = panes.find((candidate) => candidate.tool === tool);
    if (other) {
        swapPanes(other, pane);
        return;
    }
    const previous = pane.tool;
    setFrameTool(pane, tool);
    render();
    announce('Replaced ' + toolNames[previous] + ' with ' + toolNames[tool] + ' in pane ' + (panes.indexOf(pane) + 1) + '.');
}

function flash(pane) {
    pane.element.classList.remove('is-flash');
    void pane.element.offsetWidth;
    pane.element.classList.add('is-flash');
}

function flush(pane) {
    if (!pane.ready || !pane.frame.contentWindow) return;
    while (pane.queue.length) {
        pane.frame.contentWindow.postMessage({ type: 'eas-multiview:deliver', ...pane.queue.shift() }, location.origin);
    }
}

function dropTargetAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    const target = hit && hit.closest('[data-drop]');
    if (!target || !root.contains(target)) return null;
    if (target.dataset.drop === 'add') return drag.source.kind === 'tool' && !addZone.hidden ? { kind: 'add', element: target } : null;
    const pane = panes.find((candidate) => candidate.element === target);
    return pane ? { kind: 'pane', pane, element: target } : null;
}

function startDrag(event, source) {
    if (event.button !== 0 || drag) return;
    drag = { source, pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: event.currentTarget, active: false, target: null, ghost: null };
    try {
        event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
        return;
    }
}

function setTarget(target) {
    if (drag.target && drag.target.element !== target?.element) drag.target.element.classList.remove('is-drop-target');
    drag.target = target;
    if (target) target.element.classList.add('is-drop-target');
}

function endDrag(commit) {
    if (!drag) return;
    const { active, target, source, ghost, origin, pointerId } = drag;
    if (origin.hasPointerCapture && origin.hasPointerCapture(pointerId)) origin.releasePointerCapture(pointerId);
    if (target) target.element.classList.remove('is-drop-target');
    if (ghost) ghost.remove();
    root.classList.remove('is-dragging');
    addZone.hidden = true;
    drag = null;
    if (!active) return;
    suppressClickUntil = performance.now() + 400;
    if (!commit || !target) return;
    if (target.kind === 'add') addPane(source.tool);
    else if (source.kind === 'tool') dropTool(source.tool, target.pane);
    else swapPanes(source.pane, target.pane);
}

document.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return;
        drag.active = true;
        drag.ghost = el('div', { class: 'mv-ghost', 'aria-hidden': 'true' }, [drag.source.label]);
        document.body.appendChild(drag.ghost);
        root.classList.add('is-dragging');
        addZone.hidden = !(drag.source.kind === 'tool' && panes.length < MAX_PANES && !panes.some((pane) => pane.tool === drag.source.tool));
    }
    drag.ghost.style.transform = 'translate(' + (event.clientX + 14) + 'px, ' + (event.clientY + 14) + 'px)';
    setTarget(dropTargetAt(event.clientX, event.clientY));
});
document.addEventListener('pointerup', (event) => {
    if (drag && event.pointerId === drag.pointerId) endDrag(true);
});
document.addEventListener('pointercancel', (event) => {
    if (drag && event.pointerId === drag.pointerId) endDrag(false);
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag && drag.active) {
        event.preventDefault();
        endDrag(false);
    }
});
root.addEventListener('click', (event) => {
    if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
    }
}, true);

window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.type !== 'eas-multiview:handoff' || !(data.tool in toolNames)) return;
    const source = panes.find((pane) => pane.frame.contentWindow === event.source);
    if (!source) return;
    let target = panes.find((pane) => pane.tool === data.tool);
    if (!target && panes.length < MAX_PANES) {
        target = addPane(data.tool, { quiet: true });
    } else if (!target) {
        target = source;
        setFrameTool(source, data.tool);
        render();
    }
    target.queue.push({ tool: data.tool, payload: data.payload, what: data.what || 'Result' });
    flush(target);
    flash(target);
    announce((data.what || 'Result') + ' sent to ' + toolNames[data.tool] + ' in pane ' + (panes.indexOf(target) + 1) + '.');
});

window.addEventListener('eas:tool-deactivate', (event) => {
    if (event.detail?.tool !== 'multiview') return;
    panes.forEach((pane) => {
        try {
            pane.frame.contentDocument?.querySelectorAll('audio, video').forEach((media) => media.pause());
        } catch {
            return;
        }
    });
});

const wide = window.matchMedia(WIDE_QUERY);
const applyWidth = () => {
    narrow.hidden = wide.matches;
    grid.hidden = !wide.matches;
    palette.hidden = !wide.matches;
    if (wide.matches && !panes.length) {
        loadLayout().forEach((tool) => panes.push(createPane(tool)));
        render();
    }
};
wide.addEventListener('change', applyWidth);

tools.forEach((tool) => palette.appendChild(chipFor(tool)));
root.replaceChildren(
    el('div', { class: 'mv-bar' }, [
        el('h2', { class: 'section-heading mv-title' }, ['Multi-View']),
        el('p', { class: 'mv-hint' }, ['Drag a tool onto a pane to put it there, or drag a pane by its ⠿ handle to swap places. 2 to 4 tools.']),
        palette,
        addZone,
    ]),
    grid,
    narrow,
    status,
);
applyWidth();
panel.dataset.ready = 'true';
