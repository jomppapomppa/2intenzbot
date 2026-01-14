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
