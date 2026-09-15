CREATE TABLE IF NOT EXISTS playtimes (
    username TEXT NOT NULL,
    game_name TEXT NOT NULL,
    start_time TIMESTAMP NOT NULL,
    last_seen TIMESTAMP NOT NULL,
    total_minutes INTEGER DEFAULT 1,
    week INTEGER NOT NULL,
    year INTEGER NOT NULL,
    PRIMARY KEY (username, game_name, week, year, start_time)
);

CREATE TABLE IF NOT EXISTS pb_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    proposer_name TEXT NOT NULL,
    proposer_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    week INTEGER NOT NULL,
    year INTEGER NOT NULL,
    is_next_week BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS pb_votes (
    song_id INTEGER NOT NULL,
    voter_id TEXT NOT NULL,
    voter_name TEXT NOT NULL,
    score INTEGER NOT NULL,
    week INTEGER NOT NULL,
    year INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (song_id, voter_id)
);

CREATE TABLE IF NOT EXISTS liiga_matches (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    home TEXT NOT NULL,
    away TEXT NOT NULL,
    home_goals INTEGER DEFAULT 0,
    away_goals INTEGER DEFAULT 0,
    home_goals_60 INTEGER DEFAULT 0,
    away_goals_60 INTEGER DEFAULT 0,
    bet_result TEXT,
    game_time INTEGER DEFAULT 0,
    status TEXT,
    start_time TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS liiga_bets (
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    prediction TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, game_id, date)
);

