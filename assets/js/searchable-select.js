(function (root) {
    'use strict';

    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    const indexDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    let instanceCounter = 0;

    function enhance(select, options) {
        if (!select || select.tagName !== 'SELECT') return null;
        if (select.__searchableSelect) return select.__searchableSelect;

        const opts = Object.assign({
            placeholder: 'Search...',
            emptyText: 'No matches.',
            noSelectionText: 'Select...',
            searchLabel: null,
            matchValue: false,
            className: ''
        }, options || {});

        const uid = 'ss-' + (select.id || 'select') + '-' + (++instanceCounter);
        const listId = uid + '-list';
        const labelSpanId = uid + '-value';

        const combo = document.createElement('div');
        combo.className = 'ss-combo' + (opts.className ? ' ' + opts.className : '');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ss-combo__btn';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'ss-combo__label';
        labelSpan.id = labelSpanId;
        const arrowSpan = document.createElement('span');
        arrowSpan.className = 'ss-combo__arrow';
        arrowSpan.setAttribute('aria-hidden', 'true');
        arrowSpan.textContent = '▾';
        btn.appendChild(labelSpan);
        btn.appendChild(arrowSpan);

        const pop = document.createElement('div');
        pop.className = 'ss-combo__pop';
        pop.hidden = true;

        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'ss-combo__search';
        search.setAttribute('placeholder', opts.placeholder);
        search.setAttribute('aria-controls', listId);
        search.setAttribute('aria-expanded', 'false');
        search.setAttribute('aria-autocomplete', 'list');
        search.setAttribute('role', 'combobox');
        search.setAttribute('autocomplete', 'off');
        search.setAttribute('spellcheck', 'false');

        const list = document.createElement('ul');
        list.className = 'ss-combo__list';
        list.id = listId;
        list.setAttribute('role', 'listbox');

        const status = document.createElement('span');
        status.className = 'ss-combo__status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        pop.appendChild(search);
        pop.appendChild(list);
        pop.appendChild(status);
        combo.appendChild(btn);
        combo.appendChild(pop);

        const nativeLabel = select.id ? document.querySelector('label[for="' + CSS.escape(select.id) + '"]') : null;
        let labelText = select.getAttribute('aria-label') || '';
        if (nativeLabel) {
            if (!nativeLabel.id) nativeLabel.id = uid + '-label';
            btn.setAttribute('aria-labelledby', nativeLabel.id + ' ' + labelSpanId);
            list.setAttribute('aria-labelledby', nativeLabel.id);
            labelText = labelText || nativeLabel.textContent.replace(/\s+/g, ' ').replace(/:\s*$/, '').trim();
            nativeLabel.addEventListener('click', (e) => {
                e.preventDefault();
                btn.focus();
            });
        } else if (labelText) {
            btn.setAttribute('aria-label', labelText);
            list.setAttribute('aria-label', labelText);
        }
        search.setAttribute('aria-label', opts.searchLabel || (labelText ? 'Search ' + labelText : opts.placeholder));

        select.classList.add('ss-native-hidden');
        select.setAttribute('tabindex', '-1');
        select.setAttribute('aria-hidden', 'true');
        select.parentNode.insertBefore(combo, select.nextSibling);

        let isOpen = false;
        let activeId = null;
        let optionEls = [];

        const selectedText = () => {
            const opt = select.options[select.selectedIndex];
            return opt ? (opt.textContent || '').trim() : '';
        };

        const syncLabel = () => {
            labelSpan.textContent = selectedText() || opts.noSelectionText;
            btn.disabled = select.disabled;
            combo.hidden = select.hidden;
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

        const scoreOf = (optionEl, terms) => {
            if (!terms.length) return 0;
            let hay = (optionEl.textContent || '').toLowerCase();
            if (opts.matchValue) hay += ' ' + String(optionEl.value || '').toLowerCase();
            const group = optionEl.parentNode && optionEl.parentNode.tagName === 'OPTGROUP' ? optionEl.parentNode.label : '';
            if (group) hay += ' ' + group.toLowerCase();
            const words = hay.split(/[^a-z0-9]+/).filter(Boolean);
            let score = 0;
            for (const t of terms) {
                if (hay.indexOf(t) === -1) return -1;
                if (words.indexOf(t) !== -1) continue;
                score += words.some((w) => w.indexOf(t) === 0) ? 1 : 2;
            }
            return score;
        };

        const byScore = (a, b) => a._ssScore - b._ssScore || a._ssOrder - b._ssOrder;

        const buildList = () => {
            list.textContent = '';
            optionEls = [];
            const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
            let counter = 0;
            const makeOpt = (optionEl) => {
                if (optionEl.hidden) return null;
                const score = scoreOf(optionEl, terms);
                if (score < 0) return null;
                const li = document.createElement('li');
                li._ssScore = score;
                li._ssOrder = counter;
                li.className = 'ss-combo__opt';
                li.setAttribute('role', 'option');
                li.dataset.value = optionEl.value;
                li.id = listId + '-opt-' + (counter++);
                li.textContent = (optionEl.textContent || '').trim();
                if (optionEl.disabled) {
                    li.setAttribute('aria-disabled', 'true');
                    li.classList.add('is-disabled');
                }
                const isSel = optionEl.selected;
                li.setAttribute('aria-selected', isSel ? 'true' : 'false');
                if (isSel) li.classList.add('is-selected');
                return li;
            };
            for (const child of select.children) {
                if (child.tagName === 'OPTGROUP') {
                    const groupLis = [];
                    for (const o of child.children) {
                        if (o.tagName !== 'OPTION') continue;
                        const li = makeOpt(o);
                        if (li) groupLis.push(li);
                    }
                    if (terms.length) groupLis.sort(byScore);
                    if (groupLis.length) {
                        const group = document.createElement('li');
                        group.className = 'ss-combo__group';
                        group.setAttribute('role', 'group');
                        group.setAttribute('aria-label', child.label || '');
                        const head = document.createElement('span');
                        head.className = 'ss-combo__group-label';
                        head.setAttribute('aria-hidden', 'true');
                        head.textContent = child.label || '';
                        const sub = document.createElement('ul');
                        sub.className = 'ss-combo__sublist';
                        sub.setAttribute('role', 'presentation');
                        group.appendChild(head);
                        group.appendChild(sub);
                        groupLis.forEach((li) => {
                            sub.appendChild(li);
                            optionEls.push(li);
                        });
                        list.appendChild(group);
                    }
                } else if (child.tagName === 'OPTION') {
                    const li = makeOpt(child);
                    if (li) {
                        list.appendChild(li);
                        optionEls.push(li);
                    }
                }
            }
            if (terms.length && !select.querySelector('optgroup') && optionEls.length > 1) {
                optionEls.sort(byScore);
                optionEls.forEach((li) => list.appendChild(li));
            }
            if (!optionEls.length) {
                const empty = document.createElement('li');
                empty.className = 'ss-combo__empty';
                empty.setAttribute('role', 'presentation');
                empty.textContent = opts.emptyText;
                list.appendChild(empty);
                status.textContent = opts.emptyText;
                setActive(null);
                return;
            }
            status.textContent = terms.length ? (optionEls.length + (optionEls.length === 1 ? ' result' : ' results')) : '';
            const selected = optionEls.find((li) => li.getAttribute('aria-selected') === 'true');
            setActive(selected && !terms.length ? selected.id : optionEls[0].id);
        };

        const positionPop = () => {
            const r = btn.getBoundingClientRect();
            const vw = document.documentElement.clientWidth || window.innerWidth;
            const vh = document.documentElement.clientHeight || window.innerHeight;
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

        const onReposition = (e) => {
            if (!isOpen) return;
            if (e && e.type === 'scroll' && pop.contains(e.target)) return;
            positionPop();
        };

        const onDocPointer = (e) => {
            if (!combo.contains(e.target)) close();
        };

        const syncSearchLabel = () => {
            if (opts.searchLabel || !nativeLabel || select.getAttribute('aria-label')) return;
            const current = nativeLabel.textContent.replace(/\s+/g, ' ').replace(/:\s*$/, '').trim();
            if (current) search.setAttribute('aria-label', 'Search ' + current);
        };

        const open = () => {
            if (isOpen || select.disabled) return;
            isOpen = true;
            syncSearchLabel();
            search.value = '';
            buildList();
            pop.hidden = false;
            positionPop();
            btn.setAttribute('aria-expanded', 'true');
            search.setAttribute('aria-expanded', 'true');
            document.addEventListener('mousedown', onDocPointer, true);
            document.addEventListener('touchstart', onDocPointer, true);
            window.addEventListener('resize', onReposition);
            window.addEventListener('scroll', onReposition, true);
            search.focus();
        };

        function close() {
            if (!isOpen) return;
            isOpen = false;
            pop.hidden = true;
            status.textContent = '';
            btn.setAttribute('aria-expanded', 'false');
            search.setAttribute('aria-expanded', 'false');
            search.removeAttribute('aria-activedescendant');
            document.removeEventListener('mousedown', onDocPointer, true);
            document.removeEventListener('touchstart', onDocPointer, true);
            window.removeEventListener('resize', onReposition);
            window.removeEventListener('scroll', onReposition, true);
        }

        const pick = (value) => {
            if (select.value !== value) {
                select.value = value;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            syncLabel();
            close();
            btn.focus();
        };

        const pickLi = (li) => {
            if (!li || typeof li.dataset.value === 'undefined' || li.getAttribute('aria-disabled') === 'true') return;
            pick(li.dataset.value);
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
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                open();
                search.value = e.key;
                buildList();
            }
        });

        list.addEventListener('click', (e) => {
            const li = e.target.closest('.ss-combo__opt');
            if (!li) return;
            e.preventDefault();
            pickLi(li);
        });
        list.addEventListener('mousemove', (e) => {
            const li = e.target.closest('.ss-combo__opt');
            if (li && li.id && li.id !== activeId) setActive(li.id);
        });

        search.addEventListener('input', buildList);
        search.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveActive(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveActive(-1);
            } else if (e.key === 'Home' && e.ctrlKey) {
                e.preventDefault();
                if (optionEls.length) setActive(optionEls[0].id);
            } else if (e.key === 'End' && e.ctrlKey) {
                e.preventDefault();
                if (optionEls.length) setActive(optionEls[optionEls.length - 1].id);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                pickLi(activeId ? document.getElementById(activeId) : null);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
                btn.focus();
            } else if (e.key === 'Tab') {
                close();
            }
        });

        const refresh = () => {
            syncLabel();
            if (isOpen) buildList();
        };

        select.addEventListener('change', refresh);
        const mo = new MutationObserver(refresh);
        mo.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });

        Object.defineProperty(select, 'value', {
            configurable: true,
            get() {
                return valueDescriptor.get.call(this);
            },
            set(v) {
                valueDescriptor.set.call(this, v);
                syncLabel();
            }
        });
        Object.defineProperty(select, 'selectedIndex', {
            configurable: true,
            get() {
                return indexDescriptor.get.call(this);
            },
            set(v) {
                indexDescriptor.set.call(this, v);
                syncLabel();
            }
        });

        syncLabel();

        const api = {
            select,
            element: combo,
            button: btn,
            open,
            close,
            refresh,
            focus() {
                btn.focus();
            }
        };
        select.__searchableSelect = api;
        return api;
    }

    root.EASSearchableSelect = { enhance };
})(typeof window !== 'undefined' ? window : this);
