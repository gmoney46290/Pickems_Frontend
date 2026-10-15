export type League = 'nfl' | 'cfb';

export interface Player {
  id: string;
  name: string;
  emoji: string;
  color: string;
  user_id: string | null;
  is_admin: boolean;
  sort: number;
}

export interface Team {
  id: string;
  league: League;
  espn_id: string;
  abbr: string;
  short_name: string;
  name: string;
  logo: string | null;
  color: string | null;
  alt_color: string | null;
  legacy_code: string | null;
}

export interface Week {
  id: number;
  season: number;
  number: number;
  label: string | null;
  nfl_week: number | null;
  cfb_week: number | null;
  status: 'draft' | 'open' | 'final';
  score_picks: number;
  dd_per_league: number;
  locks_at: string | null;
  ruleset: 'classic' | 'boxes';
}

export interface Phase {
  id: number;
  season: number;
  name: string;
  emoji: string;
  sort: number;
}

export interface Game {
  id: number;
  week_id: number;
  league: League;
  espn_event_id: string | null;
  away_team_id: string;
  home_team_id: string;
  neutral: boolean;
  kickoff: string;
  home_spread: number;
  market_spread: number | null;
  market_total: number | null;
  away_rank: number | null;
  home_rank: number | null;
  away_record: string | null;
  home_record: string | null;
  broadcast: string | null;
  away_score: number | null;
  home_score: number | null;
  status: 'scheduled' | 'in' | 'final' | 'canceled';
  status_detail: string | null;
  possession: string | null;
  situation: string | null;
  sort: number;
}

export interface Pick {
  id: number;
  game_id: number;
  player_id: string;
  pick_team_id: string | null;
  is_dd: boolean;
  score_away: number | null;
  score_home: number | null;
}

export type BoxItem = 'extra_dd' | 'landmine' | 'teaser' | 'lone_wolf' | 'taser' | 'dice' | 'super_dawg';

export interface Box {
  id: number;
  week_id: number;
  player_id: string;
  item: BoxItem;
  source: 'weekly' | 'score_hit' | 'gift';
  source_pick_id: number | null;
  opened_at: string | null;
  used_at: string | null;
  target_game_id: number | null;
  target_player_id: string | null;
  target_team_id: string | null;
  dice_roll: number | null;
}
