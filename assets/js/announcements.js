// ignore me... again...
console.log('announcements.js loaded');

document.addEventListener('DOMContentLoaded', () => {
    fetch('https://wagspuzzle.space/tools/eas-tools/barker.php')
        .then(response => response.json())
        .then(data => {
            if (!data || !data.title) return;

            if (data.until && new Date(data.until) < new Date()) return;

            const announcementKey = 'dismissed_announcement_' + (data.id || '');

            if (localStorage.getItem(announcementKey)) return;

            const renderMarkdown = (text) =>
                text.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
                    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

            const toast = document.createElement('div');
            toast.id = 'announcement-toast';
            toast.innerHTML = `
                <button id="announcement-dismiss" aria-label="Dismiss announcement">&times;</button>
                <strong>${renderMarkdown(data.title)}</strong>
                <p>${renderMarkdown(data.description)}</p>
            `;
            document.body.appendChild(toast);

            const updateVisibility = () => {
                const decoderActive = document.querySelector('#decoder-panel.active');
                toast.style.display = decoderActive ? '' : 'none';
            };
            updateVisibility();

            document.getElementById('tab-set')
                .addEventListener('click', () => setTimeout(updateVisibility, 0));
            const navSelect = document.getElementById('nav-select');
            if (navSelect) navSelect.addEventListener('change', () => setTimeout(updateVisibility, 0));

            document.getElementById('announcement-dismiss').addEventListener('click', () => {
                toast.classList.add('announcement-hiding');
                toast.addEventListener('animationend', () => toast.remove());
                localStorage.setItem(announcementKey, '1');
            });
        })
        .catch(error => {
            console.error('Error fetching announcement:', error);
        });
});
