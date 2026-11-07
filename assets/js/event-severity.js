export const SEVERITY_LEVELS = Object.freeze(['Warning', 'Watch', 'Advisory', 'Statement', 'Information']);

export const EVENT_CODE_SEVERITY = Object.freeze({
    ADM: 'Advisory',
    ADR: 'Advisory',
    BLU: 'Warning',
    MEP: 'Warning',
    NMN: 'Advisory',
    TOM: 'Advisory',
    TXB: 'Advisory',
    TXF: 'Advisory',
    TXO: 'Advisory',
    TXP: 'Advisory'
});

function markedSeverity(value) {
    if (/(Warning|Emergency|Immediate)/i.test(value) && !/Demo/i.test(value)) return 'Warning';
    if (/Watch/i.test(value)) return 'Watch';
    if (/Advisory/i.test(value)) return 'Advisory';
    if (/Statement/i.test(value)) return 'Statement';
    return '';
}

function informationSeverity(value) {
    return /(Information|Test|Demo)/i.test(value) ? 'Information' : '';
}

export function severityFromText(text) {
    const value = String(text || '');
    return markedSeverity(value) || informationSeverity(value);
}

export function severityFromEventCode(eventCode) {
    const code = String(eventCode || '').trim().toUpperCase();
    return Object.hasOwn(EVENT_CODE_SEVERITY, code) ? EVENT_CODE_SEVERITY[code] : '';
}

export function eventSeverity(text, eventCode) {
    const value = String(text || '');
    return markedSeverity(value) || severityFromEventCode(eventCode) || informationSeverity(value);
}

export function screenSeverity(text, eventCode) {
    const level = eventSeverity(text, eventCode);
    if (level === 'Warning') return 'warning';
    if (level === 'Watch') return 'watch';
    return 'advisory';
}
