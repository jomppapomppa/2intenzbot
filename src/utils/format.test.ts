import { describe, it, expect } from 'vitest';
import { formatDuration, escapeHtml } from './format';

describe('Format Utilities', () => {
    it('formatDuration: handles minutes < 60', () => {
        expect(formatDuration(45)).toBe('45 min');
    });

    it('formatDuration: handles exact hours', () => {
        expect(formatDuration(120)).toBe('2h');
    });

    it('formatDuration: handles hours and minutes', () => {
        expect(formatDuration(135)).toBe('2h 15min');
    });

    it('escapeHtml: escapes special characters', () => {
        expect(escapeHtml('<script>alert("XSS & fun")</script>')).toBe('&lt;script&gt;alert(&quot;XSS &amp; fun&quot;)&lt;/script&gt;');
    });
});
