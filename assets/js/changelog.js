(function () {
    const container = document.getElementById('changelog-content');
    if (!container) {
        return;
    }

    function showError(message) {
        container.innerHTML =
            '<p><strong>Could not load the change log.</strong></p>' +
            '<p>' + message + '</p>' +
            '<p>You can read it directly on ' +
            '<a href="https://github.com/wagwan-piffting-blud/eas-tools/blob/main/CHANGES.md" target="_blank" rel="noopener">GitHub</a>.</p>';
    }

    function normalizeDateHeadings(markdown) {
        return markdown.replace(/^(\d{4}-\d{2}-\d{2}):\s*$/gm, '## $1');
    }

    fetch('CHANGES.md', { cache: 'no-cache' })
        .then(function (response) {
            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ' ' + response.statusText);
            }
            return response.text();
        })
        .then(function (markdown) {
            if (typeof marked === 'undefined') {
                showError('The markdown parser failed to load.');
                return;
            }
            marked.setOptions({ gfm: true, breaks: false });
            const html = marked.parse(normalizeDateHeadings(markdown));
            container.innerHTML = html;
        })
        .catch(function (err) {
            showError(err && err.message ? err.message : String(err));
        });
})();
