import { describe, expect, it } from 'vitest';
import { renderVotingPage } from './web';

describe('renderVotingPage', () => {
    it('renders vote buttons 1..N without the "-" button', () => {
        const mockSongs = [
            { id: 1, title: 'Song 1', proposer_name: 'User A', created_at: '2026-01-01', url: 'https://youtube.com/watch?v=abc' },
            { id: 2, title: 'Song 2', proposer_name: 'User B', created_at: '2026-01-01', url: 'https://youtube.com/watch?v=def' },
        ];
        const user = { username: 'TestUser', userId: '123' };
        const html = renderVotingPage(mockSongs, user, 'test-token');

        expect(html).not.toContain('data-score="0"');
        expect(html).not.toContain('>-<');
        expect(html).toContain('data-score="1"');
        expect(html).toContain('data-score="2"');
    });
});
