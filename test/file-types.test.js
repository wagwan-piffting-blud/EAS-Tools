import { describe, expect, it } from 'vitest';
import {
    FILE_TYPES, acceptFor, fileExtension, fileKind, fileMatchesKind, isAnimatedImageFile, nativeFileTypes,
} from '../assets/js/file-types.js';

describe('shared file types', () => {
    it('builds one accept list per kind, falling back to any file', () => {
        expect(acceptFor('audio').split(',')).toEqual(expect.arrayContaining(['audio/*', 'video/*', '.wav', '.mp4', '.mov', '.opus']));
        expect(acceptFor('video')).toContain('.gif');
        expect(acceptFor('font')).toBe('font/ttf,font/otf,font/sfnt,application/x-font-ttf,application/x-font-otf,.ttf,.otf');
        expect(acceptFor('nope')).toBe('');
        expect(fileKind('json')).toBe('json');
        expect(fileKind('toString')).toBe('any');
    });

    it('matches dropped files by extension or MIME type', () => {
        expect(fileExtension('clip.final.MP4')).toBe('mp4');
        expect(fileExtension('README')).toBe('');
        expect(fileExtension(null)).toBe('');
        expect(fileMatchesKind({ name: 'alert.mkv', type: '' }, 'audio')).toBe(true);
        expect(fileMatchesKind({ name: 'blob', type: 'audio/x-aiff' }, 'audio')).toBe(true);
        expect(fileMatchesKind({ name: 'blob', type: 'application/zip' }, 'zip')).toBe(true);
        expect(fileMatchesKind({ name: 'notes.txt', type: 'text/plain' }, 'audio')).toBe(false);
        expect(fileMatchesKind({ name: 'blob', type: '' }, 'image')).toBe(false);
        expect(fileMatchesKind(null, 'image')).toBe(false);
        expect(fileMatchesKind({ name: 'radar', type: '' }, 'any')).toBe(true);
        expect(fileMatchesKind(null, 'any')).toBe(false);
    });

    it('spots animated GIFs and describes every kind for the apps', () => {
        expect(isAnimatedImageFile({ name: 'loop.GIF', type: '' })).toBe(true);
        expect(isAnimatedImageFile({ name: 'x', type: 'image/gif' })).toBe(true);
        expect(isAnimatedImageFile({ name: 'x.mp4', type: 'video/mp4' })).toBe(false);
        expect(isAnimatedImageFile(null)).toBe(false);
        const native = nativeFileTypes();
        expect(Object.keys(native)).toEqual(Object.keys(FILE_TYPES));
        expect(native.audio.mimeTypes).toEqual(['audio/*', 'video/*']);
        native.audio.extensions.push('zzz');
        expect(FILE_TYPES.audio.extensions).not.toContain('zzz');
    });
});
