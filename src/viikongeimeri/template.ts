export const SHARED_CSS = `
    :root {
        --bg: #0f1115;
        --card-bg: #1a1d23;
        --text: #e1e4e8;
        --text-dim: #9ba1a6;
        --accent: #3498db;
        --winner: #00ff00;
    }
    * { box-sizing: border-box; }
    body {
        font-family: 'Inter', sans-serif;
        background-color: var(--bg);
        color: var(--text);
        margin: 0;
        line-height: 1.6;
    }
    .container { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
    h1, h2, h3 { margin-top: 0; font-weight: 800; }
    h1 { font-size: 2.5rem; letter-spacing: -1px; margin-bottom: 30px; }
    a { color: var(--accent); text-decoration: none; transition: opacity 0.2s; }
    a:hover { opacity: 0.8; }
    
    .card {
        background: var(--card-bg);
        border-radius: 12px;
        padding: 30px;
        margin-bottom: 30px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; }
    .week-link {
        display: block;
        background: var(--card-bg);
        padding: 20px;
        border-radius: 8px;
        border: 1px solid transparent;
        transition: all 0.2s;
    }
    .week-link:hover { border-color: var(--accent); transform: translateY(-2px); }
    .week-link span { color: var(--text-dim); font-size: 0.9rem; }
    
    .leaderboard { margin-top: 20px; }
    .player-entry {
        padding: 20px 0;
        border-bottom: 1px solid #2d333b;
    }
    .player-entry:last-child { border-bottom: none; }
    
    .player-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
    }
    .player-info { display: flex; align-items: center; gap: 10px; }
    .rank { width: 30px; font-weight: 800; color: var(--text-dim); }
    .player-name { font-weight: 600; font-size: 1.1rem; }
    .player-time { font-family: monospace; color: var(--accent); font-weight: 600; font-size: 1.1rem; }
    .winner .player-name { color: var(--winner); }
    
    .games-list { 
        list-style: none;
        padding: 0;
        margin: 0 0 0 40px;
        font-size: 0.85rem; 
        color: var(--text-dim);
    }
    .games-list li { margin-bottom: 4px; }
    .games-list li::before { content: "•"; margin-right: 8px; color: var(--accent); }
    
    .session-info { font-size: 0.8rem; font-style: italic; color: var(--text-dim); margin-top: 6px; padding-left: 40px; }
    
    .chart-container { position: relative; height: 300px; width: 100%; margin-bottom: 40px; }
    
    nav { margin-bottom: 40px; font-size: 0.9rem; }
    .back-link { display: inline-flex; align-items: center; gap: 8px; }
`;

export const BASE_HTML = (title: string, content: string, extraHead: string = "") => `
<!DOCTYPE html>
<html lang="fi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    <title>\${title} | Viikon Geimeri</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        \${SHARED_CSS}
    </style>
    \${extraHead}
</head>
<body>
    <div class="container">
        \${content}
    </div>
</body>
</html>
`;
