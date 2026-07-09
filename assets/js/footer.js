const footer = document.querySelector('footer');

footer.innerHTML = `
<ul class="footer-links">
    <li><p id="faq-link"><a href="faq.html">FAQ</a></p></li>
    <li><p id="donate-link"><a href="donations.html">Donate</a></p></li>
    <li><p id="terms-of-service-link"><a href="terms.html">Terms of Service</a></p></li>
    <li><p id="privacy-policy-link"><a href="privacy.html">Privacy Policy</a></p></li>
    <li><p>Developed by <a href="https://github.com/wagwan-piffting-blud/">wagwan-piffting-blud</a></p></li>
    <li><p>Hosted with <a href="https://www.hetzner.com/">Hetzner</a></p></li>
    <li><p>Last updated: <span id="last-updated"><time datetime=""></time></span> (commit <span id="last-commit-hash"></span>)</p></li>
    <li><p><span id="tts-requests-counter">0/0</span> successful TTS requests served (resets in <span id="tts-requests-reset-time"></span>)</p></li>
    <li><p><a href="tts-docs.html">TTS Documentation</a></p></li>
    <li><p><a href="demos.html">TTS Voice Demos</a></p></li>
    <li><p><a href="credits.html">Credits</a></p></li>
    <li><p><a href="changelog.html">Changelog</a></p></li>
</ul>
<br class="mobileBreak">
<div id="footer-mobile-arrow" style="display: none;"></div>
<p id="footer-mobile-tip" style="display: none;">Swipe for more</p>
`;

const lastUpdated = document.getElementById('last-updated');
const lastCommitHash = document.getElementById('last-commit-hash');
const ttsRequestsCounter = document.getElementById('tts-requests-counter');
const ttsRequestsPerUserLimit = document.getElementById('tts-requests-per-user-limit');
const ttsRequestsResetTime = document.getElementById('tts-requests-reset-time');
const TIME_ZONE = 'America/Chicago';
const timeFormatOptions = {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
};
const zonedFormatter = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: TIME_ZONE }, timeFormatOptions));
const utcFormatter = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: 'UTC' }, timeFormatOptions));
let resetTime = getNextMidnightInTimeZone(new Date());

const TTS_COUNTER_REFRESH_MS = 5 * 60 * 1000;
let uiTickTimer = null;
let counterRefreshTimer = null;

function getNextMidnightInTimeZone(baseDate) {
    const zonedParts = getDateParts(zonedFormatter, baseDate);
    const dayCursor = new Date(Date.UTC(zonedParts.year, zonedParts.month - 1, zonedParts.day, 12, 0, 0));
    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
    const nextYear = dayCursor.getUTCFullYear();
    const nextMonth = dayCursor.getUTCMonth() + 1;
    const nextDay = dayCursor.getUTCDate();
    const isoDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;

    let offsetMinutes = getTimeZoneOffsetMinutes(baseDate);
    let candidate = buildZonedMidnight(isoDate, offsetMinutes);
    let resolvedOffset = getTimeZoneOffsetMinutes(candidate);

    while (resolvedOffset !== offsetMinutes) {
        offsetMinutes = resolvedOffset;
        candidate = buildZonedMidnight(isoDate, offsetMinutes);
        resolvedOffset = getTimeZoneOffsetMinutes(candidate);
    }

    return candidate;
}

function buildZonedMidnight(isoDate, offsetMinutes) {
    return new Date(`${isoDate}T00:00:00${formatOffset(offsetMinutes)}`);
}

function getTimeZoneOffsetMinutes(date) {
    const targetParts = getDateParts(zonedFormatter, date);
    const utcParts = getDateParts(utcFormatter, date);
    const targetEpoch = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day, targetParts.hour, targetParts.minute, targetParts.second);
    const utcEpoch = Date.UTC(utcParts.year, utcParts.month - 1, utcParts.day, utcParts.hour, utcParts.minute, utcParts.second);
    return (utcEpoch - targetEpoch) / 60000;
}

function getDateParts(formatter, date) {
    const parts = formatter.formatToParts(date);
    const result = {};
    for (const part of parts) {
        if (part.type !== 'literal') {
            result[part.type] = Number(part.value);
        }
    }
    return result;
}

function formatOffset(minutes) {
    const sign = minutes > 0 ? '-' : '+';
    const absolute = Math.abs(minutes);
    const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
    const mins = String(absolute % 60).padStart(2, '0');
    return `${sign}${hours}:${mins}`;
}

function updateTTSRequestsResetTime() {
    if (!ttsRequestsResetTime) {
        return;
    }
    const now = new Date();
    const diffMs = Math.max(0, resetTime - now);
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const diffSeconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    ttsRequestsResetTime.textContent = `${diffHours}h ${diffMinutes}m ${diffSeconds}s`;
}

window.updateTTSRequestsCounter = function () {
    fetch('https://wagspuzzle.space/tools/eas-tts/index.php?get_current_request_count=true')
        .then(response => response.json())
        .then(data => {
            if (!ttsRequestsCounter) {
                return;
            }
            ttsRequestsCounter.textContent = data.current_request_count;
            if (!ttsRequestsPerUserLimit) {
                return;
            }
            ttsRequestsPerUserLimit.textContent = data.per_user_request_limit;
        })
        .catch(error => {
            console.error('Error fetching TTS requests count:', error);
        });
}

function uiTick() {
    const now = new Date();
    if (now >= resetTime) {
        resetTime = getNextMidnightInTimeZone(now);
        window.updateTTSRequestsCounter();
    }
    updateTTSRequestsResetTime();
    formatTimestamps(window.commitDate);
}

function startTimers() {
    if (uiTickTimer === null) {
        uiTickTimer = setInterval(uiTick, 1000);
    }
    if (counterRefreshTimer === null) {
        counterRefreshTimer = setInterval(window.updateTTSRequestsCounter, TTS_COUNTER_REFRESH_MS);
    }
}

function stopTimers() {
    if (uiTickTimer !== null) {
        clearInterval(uiTickTimer);
        uiTickTimer = null;
    }
    if (counterRefreshTimer !== null) {
        clearInterval(counterRefreshTimer);
        counterRefreshTimer = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopTimers();
    } else {
        uiTick();
        window.updateTTSRequestsCounter();
        startTimers();
    }
});

function formatTimestamps(commitDate) {
    const timeElements = document.querySelectorAll('time[datetime]');
    timeElements.forEach(timeEl => {
        const datetime = commitDate ? commitDate.toISOString() : timeEl.getAttribute('datetime');
        timeEl.setAttribute('datetime', datetime);

        if (!datetime) {
            return;
        }

        const dateObj = new Date(datetime);
        if (isNaN(dateObj.getTime())) {
            return;
        }

        const now = new Date();
        const diffMs = now - dateObj;
        const diffInSeconds = Math.floor(diffMs / 1000);
        let formatted = '';
        if (diffInSeconds < 60) {
            formatted = `${diffInSeconds}s ago`;
        } else if (diffInSeconds < 3600) {
            const minutes = Math.floor(diffInSeconds / 60);
            const seconds = diffInSeconds % 60;
            formatted = `${minutes}m ${seconds}s ago`;
        } else if (diffInSeconds < 86400) {
            const hours = Math.floor(diffInSeconds / 3600);
            formatted = `${hours} hour${hours === 1 ? '' : 's'} ago`;
        } else if (diffInSeconds < 604800) {
            const days = Math.floor(diffInSeconds / 86400);
            formatted = `${days} day${days === 1 ? '' : 's'} ago`;
        } else if (diffInSeconds < 2592000) {
            const weeks = Math.floor(diffInSeconds / 604800);
            formatted = `${weeks} week${weeks === 1 ? '' : 's'} ago`;
        } else if (diffInSeconds < 31536000) {
            const months = Math.floor(diffInSeconds / 2592000);
            formatted = `${months} month${months === 1 ? '' : 's'} ago`;
        } else {
            const years = Math.floor(diffInSeconds / 31536000);
            formatted = `${years} year${years === 1 ? '' : 's'} ago`;
        }

        timeEl.textContent = formatted;
    });
};

const cachedData = localStorage.getItem('githubCommitData');
if (cachedData) {
    const { commitDate, commitHash, timestamp } = JSON.parse(cachedData);

    lastCommitHash.innerHTML = `<a href="https://github.com/wagwan-piffting-blud/eas-tools/commit/${commitHash}">${commitHash.substring(0, 7)}</a>`;

    if (Date.now() - timestamp > 24 * 60 * 60 * 1000) {
        fetch('https://api.github.com/repos/wagwan-piffting-blud/eas-tools/commits/main')
            .then(response => response.json())
            .then(data => {
                window.commitDate = new Date(data.commit.author.date);
                lastCommitHash.innerHTML = `<a href="https://github.com/wagwan-piffting-blud/eas-tools/commit/${data.sha}">${data.sha.substring(0, 7)}</a>`;

                localStorage.setItem('githubCommitData', JSON.stringify({
                    commitDate: window.commitDate,
                    commitHash: lastCommitHash.textContent,
                    timestamp: Date.now()
                }));
            });
    } else {
        fetch('https://api.github.com/repos/wagwan-piffting-blud/eas-tools/commits/main')
            .then(response => response.json())
            .then(data => {
            window.commitDate = new Date(data.commit.author.date);
            lastCommitHash.innerHTML = `<a href="https://github.com/wagwan-piffting-blud/eas-tools/commit/${data.sha}">${data.sha.substring(0, 7)}</a>`;
            localStorage.setItem('githubCommitData', JSON.stringify({
                commitDate: window.commitDate,
                commitHash: lastCommitHash.textContent,
                timestamp: Date.now()
            }));
        })
        .catch(error => {
            console.error('Error fetching commit data:', error);
        });
    }
} else {
    fetch('https://api.github.com/repos/wagwan-piffting-blud/eas-tools/commits/main')
        .then(response => response.json())
        .then(data => {
        window.commitDate = new Date(data.commit.author.date);
        lastCommitHash.innerHTML = `<a href="https://github.com/wagwan-piffting-blud/eas-tools/commit/${data.sha}">${data.sha.substring(0, 7)}</a>`;
        localStorage.setItem('githubCommitData', JSON.stringify({
            commitDate: window.commitDate,
            commitHash: lastCommitHash.textContent,
            timestamp: Date.now()
        }));
    })
    .catch(error => {
        console.error('Error fetching commit data:', error);
    });
}

updateTTSRequestsResetTime();
window.updateTTSRequestsCounter();
formatTimestamps(window.commitDate);
startTimers();
