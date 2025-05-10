-- Create events table
CREATE TABLE events (
    id VARCHAR(36) PRIMARY KEY,
    sport VARCHAR(50) NOT NULL,
    competition VARCHAR(100) NOT NULL,
    start_time DATETIME NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sport (sport),
    INDEX idx_competition (competition),
    INDEX idx_start_time (start_time),
    INDEX idx_status (status)
);

-- Create participants table
CREATE TABLE participants (
    id VARCHAR(36) PRIMARY KEY,
    event_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    INDEX idx_event_id (event_id)
);

-- Create odds table
CREATE TABLE odds (
    id VARCHAR(36) PRIMARY KEY,
    event_id VARCHAR(36) NOT NULL,
    market_type VARCHAR(50) NOT NULL,
    selection VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    INDEX idx_event_id (event_id),
    INDEX idx_timestamp (timestamp)
);

-- Create event summary view
CREATE VIEW event_summary AS
SELECT 
    e.*,
    GROUP_CONCAT(DISTINCT p.name) as participants,
    COUNT(DISTINCT o.id) as odds_count
FROM events e
LEFT JOIN participants p ON e.id = p.event_id
LEFT JOIN odds o ON e.id = o.event_id
GROUP BY e.id;

-- Create latest odds view
CREATE VIEW latest_odds AS
SELECT o.*, e.sport, e.competition
FROM odds o
JOIN events e ON o.event_id = e.id
WHERE o.timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR); 