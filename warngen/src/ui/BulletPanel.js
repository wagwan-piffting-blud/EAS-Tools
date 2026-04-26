

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenBulletPanel = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {

    function cleanTitleText(s) {
        return s.replace(/[\*|]/g, "").replace(/\s+/g, " ").trim();
    }

    function build(container, bulletConfig, opts) {
        opts = opts || {};
        var action           = opts.action || "NEW";
        var initialOverrides = opts.initialOverrides || [];
        var onChange         = opts.onChange || function () {};

        var bullets = (bulletConfig.actions || {})[action] || [];

        container.innerHTML = "";
        container.className = (container.className || "") + " bullet-panel";

        var selected = {};
        var groupSelection = {};

        bullets.forEach(function (b) {
            if (b.type === "title" || !b.name) return;
            if (b.default) {
                if (b.group) {
                    if (groupSelection[b.group]) {
                        delete selected[groupSelection[b.group]];
                    }
                    groupSelection[b.group] = b.name;
                }
                selected[b.name] = true;
            }
        });
        initialOverrides.forEach(function (name) {
            var b = bullets.find(function (x) { return x.name === name; });
            if (!b) return;
            if (b.group) {

                if (groupSelection[b.group]) delete selected[groupSelection[b.group]];
                groupSelection[b.group] = name;
            }
            selected[name] = true;
        });

        var inputsByName = {};

        bullets.forEach(function (b, idx) {
            if (b.type === "title") {
                var clean = cleanTitleText(b.text);
                if (clean.length === 0) {

                    var spacer = document.createElement("div");
                    spacer.className = "bullet-spacer";
                    container.appendChild(spacer);
                } else {
                    var h = document.createElement("div");
                    h.className = "bullet-section";
                    h.textContent = clean;
                    container.appendChild(h);
                }
                return;
            }
            if (!b.name) return;

            var label = document.createElement("label");
            label.className = "bullet-option";
            if (b.group) label.setAttribute("data-group", b.group);

            var input = document.createElement("input");
            input.type = b.group ? "radio" : "checkbox";

            input.name = b.group ? ("__" + action + "_" + b.group) : ("__" + action + "_" + b.name);
            input.value = b.name;
            input.checked = !!selected[b.name];

            var textSpan = document.createElement("span");
            textSpan.textContent = b.text;

            label.appendChild(input);
            label.appendChild(textSpan);
            container.appendChild(label);
            inputsByName[b.name] = input;

            input.addEventListener("change", function () {
                if (b.group) {

                    var prev = groupSelection[b.group];
                    if (prev && prev !== b.name) {
                        delete selected[prev];
                    }
                    selected[b.name] = true;
                    groupSelection[b.group] = b.name;
                } else {
                    if (input.checked) selected[b.name] = true;
                    else               delete selected[b.name];
                }
                onChange(getSelectedNames());
            });
        });

        function getSelectedNames() {
            return Object.keys(selected).filter(function (k) { return selected[k]; });
        }

        function setSelected(names) {

            selected = {};
            groupSelection = {};
            names.forEach(function (n) {
                var b = bullets.find(function (x) { return x.name === n; });
                if (!b) return;
                selected[n] = true;
                if (b.group) groupSelection[b.group] = n;
            });
            Object.keys(inputsByName).forEach(function (n) {
                inputsByName[n].checked = !!selected[n];
            });
            onChange(getSelectedNames());
        }

        function destroy() {
            container.innerHTML = "";
        }

        setTimeout(function () { onChange(getSelectedNames()); }, 0);

        return {
            getSelectedNames: getSelectedNames,
            setSelected:      setSelected,
            destroy:          destroy
        };
    }

    return {
        build:           build,
        cleanTitleText:  cleanTitleText
    };
}));
