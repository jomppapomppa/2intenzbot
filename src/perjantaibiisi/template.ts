export const SHARED_CSS = `
    * {
        box-sizing: border-box;
    }

    :root {
        --bg-color: #0f172a;
        --card-bg: rgba(30, 41, 59, 0.7);
        --accent-color: #38bdf8;
        --text-color: #f1f5f9;
        --text-muted: #94a3b8;
    }

    body {
        font-family: 'Inter', sans-serif;
        background-color: var(--bg-color);
        color: var(--text-color);
        margin: 0;
        padding: 4rem 2rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        min-height: 100vh;
    }

    .container {
        max-width: 800px;
        width: 100%;
    }

    header {
        text-align: center;
        margin-bottom: 2rem;
    }

    h1 {
        font-size: 2.5rem;
        margin: 0 0 1rem;
        background: linear-gradient(to right, #38bdf8, #818cf8);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-weight: 800;
    }
    h2 {
        margin: 0 0 1rem;
    }

    p {
        margin: 1rem 0;
    }

    .user-greeting {
        color: var(--text-muted);
        font-size: 1.1rem;
    }

    .song-card {
        background: var(--card-bg);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 20px;
        transition: transform 0.2s;
    }

    .song-info h3 {
        margin: 0 0 8px 0;
        font-size: 1.25rem;
        color: var(--accent-color);
    }

    .proposer {
        font-size: 0.85rem;
        color: var(--text-muted);
        margin-bottom: 12px;
    }

    .video-container {
        border-radius: 12px;
        overflow: hidden;
        aspect-ratio: 16/9;
        width: 100%;
    }

    .video-container iframe {
        width: 100%;
        height: 100%;
        display: block;
    }

    .voting-section {
        margin-top: 40px;
        padding: 30px;
        background: var(--card-bg);
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .vote-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .song-title-mini {
        font-size: 0.9rem;
        font-weight: 600;
        max-width: 60%;
    }

    .btn-group {
        display: flex;
        gap: 6px;
    }

    .vote-btn {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: var(--text-color);
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.85rem;
        transition: all 0.2s;
        min-width: 44px;
        text-align: center;
    }

    .vote-btn:hover:not(:disabled) {
        background: rgba(56, 189, 248, 0.2);
        border-color: var(--accent-color);
    }

    .vote-btn.selected {
        background: var(--accent-color);
        border-color: var(--accent-color);
        color: #000;
    }

    #submit-votes {
        display: block;
        width: 100%;
        padding: 14px;
        margin-top: 24px;
        background: var(--accent-color);
        border: none;
        border-radius: 8px;
        color: #000;
        font-weight: 800;
        font-size: 1rem;
        cursor: pointer;
        transition: opacity 0.2s;
    }

    #submit-votes:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .status-msg {
        text-align: center;
        margin-top: 16px;
        font-size: 0.9rem;
        min-height: 1.5rem;
    }

    /* Archive specific styles */
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
    .week-link { display: block; background: var(--card-bg); padding: 20px; border-radius: 12px; border: 1px solid transparent; transition: all 0.2s; text-decoration: none; color: inherit; }
    .week-link:hover { border-color: var(--accent-color); transform: translateY(-2px); }
    .back-link { margin-bottom: 20px; display: block; font-size: 0.9rem; color: var(--accent-color); text-decoration: none; }
    .score-badge { float: right; font-weight: 800; color: var(--accent-color); font-size: 0.9rem; }

    .summary-section { margin-bottom: 40px; overflow-x: auto; }
    .summary-table { width: 100%; border-collapse: collapse; background: var(--card-bg); border-radius: 8px; overflow: hidden; font-size: 0.85rem; }
    .summary-table th, .summary-table td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .summary-table th { background: rgba(255,255,255,0.05); color: var(--text-muted); font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; }
    .summary-table tr:last-child td { border-bottom: none; }
    .summary-table td:first-child { font-weight: 600; color: var(--text-color); width: 40%; }
    .summary-table td.voter-cell { text-align: center; }
    .summary-table td.total-cell { font-weight: 800; color: var(--accent-color); text-align: right; }
    .summary-table th.voter-head { text-align: center; }
    .summary-table th.total-head { text-align: right; }
`;

export const BASE_TEMPLATE = (title: string, content: string, extraHead: string = "") => `
<!DOCTYPE html>
<html lang="fi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    <title>${title} | Perjantaibiisi</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        ${SHARED_CSS}
    </style>
    ${extraHead}
</head>
<body>
    <div class="container">
        ${content}
    </div>
</body>
</html>
`;
