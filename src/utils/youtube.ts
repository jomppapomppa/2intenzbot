export interface YouTubeMetadata {
    title: string;
    url: string;
    thumbnailUrl?: string;
}

export function parseYouTubeId(url: string): string | null {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : null;
}

export async function getYouTubeMetadata(url: string): Promise<YouTubeMetadata | null> {
    try {
        const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
        if (!response.ok) return null;

        const data: any = await response.json();
        return {
            title: data.title,
            url: url,
            thumbnailUrl: data.thumbnail_url
        };
    } catch (err) {
        console.error('Error fetching YouTube metadata:', err);
        return null;
    }
}
