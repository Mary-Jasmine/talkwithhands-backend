import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');
const dataDir = path.join(projectRoot, 'backend', 'data');

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const USAGE_LABELS = {
  alphabet: 'Alphabets',
  number: 'Numbers',
  basic_word: 'Basic Words',
  game: 'Sign Games',
  detector: 'Sign Detector',
};

const VALID_CATEGORIES = new Set([
  'alphabet',
  'number',
  'basic_word',
  'game',
  'detector',
]);

let totalSignsCache = null;

function defaultProgress() {
  return {
    learned: {
      alphabet: [],
      number: [],
      basic_word: [],
    },
    games_played: 0,
    seconds_spent: 0,
    streak_days: 0,
    last_active_date: null,
    monthly_events: {},
  };
}

export function normalizeProgress(raw) {
  const progress = defaultProgress();
  if (!raw || typeof raw !== 'object') return progress;

  const learned = raw.learned && typeof raw.learned === 'object' ? raw.learned : {};
  progress.learned.alphabet = uniqueStrings(learned.alphabet);
  progress.learned.number = uniqueStrings(learned.number);
  progress.learned.basic_word = uniqueStrings(learned.basic_word);
  progress.games_played = Math.max(0, Number(raw.games_played || 0));
  progress.seconds_spent = Math.max(0, Number(raw.seconds_spent || 0));
  progress.streak_days = Math.max(0, Number(raw.streak_days || 0));
  progress.last_active_date =
    typeof raw.last_active_date === 'string' && raw.last_active_date
      ? raw.last_active_date
      : null;
  progress.monthly_events = normalizeMonthlyEvents(raw.monthly_events);
  return progress;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeMonthlyEvents(value) {
  if (value instanceof Map) {
    value = Object.fromEntries(value);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const [key, count] of Object.entries(value)) {
    const monthKey = String(key || '').trim();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) continue;
    normalized[monthKey] = Math.max(0, Number(count || 0));
  }
  return normalized;
}

function todayDateString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthBucket(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function updateStreak(progress, now = new Date()) {
  const today = todayDateString(now);
  if (progress.last_active_date === today) {
    return progress;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = todayDateString(yesterday);

  if (!progress.last_active_date) {
    progress.streak_days = 1;
  } else if (progress.last_active_date === yesterdayStr) {
    progress.streak_days = Math.max(1, progress.streak_days + 1);
  } else {
    progress.streak_days = 1;
  }

  progress.last_active_date = today;
  return progress;
}

function incrementMonthlyEvents(progress, now = new Date()) {
  const key = monthBucket(now);
  progress.monthly_events[key] = (progress.monthly_events[key] || 0) + 1;
  return progress;
}

async function loadTotalSigns() {
  if (totalSignsCache != null) return totalSignsCache;

  const counts = await Promise.all([
    readJsonArrayLength(path.join(dataDir, 'alphabet-signs.json'), 26),
    readJsonArrayLength(path.join(dataDir, 'number-signs.json'), 20),
    readJsonArrayLength(path.join(dataDir, 'basic-words.json'), 0),
  ]);

  totalSignsCache = counts[0] + counts[1] + counts[2];
  return totalSignsCache;
}

async function readJsonArrayLength(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : fallback;
  } catch {
    return fallback;
  }
}

function buildUsage(progress) {
  const usage = [
    {
      category: 'alphabet',
      label: USAGE_LABELS.alphabet,
      count: progress.learned.alphabet.length,
    },
    {
      category: 'number',
      label: USAGE_LABELS.number,
      count: progress.learned.number.length,
    },
    {
      category: 'basic_word',
      label: USAGE_LABELS.basic_word,
      count: progress.learned.basic_word.length,
    },
    {
      category: 'game',
      label: USAGE_LABELS.game,
      count: progress.games_played,
    },
  ];

  return usage.filter((item) => item.count > 0);
}

function buildMonthlyActivity(progress, now = new Date()) {
  const points = [];
  for (let offset = 4; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = monthBucket(date);
    points.push({
      month: MONTH_LABELS[date.getMonth()],
      events: progress.monthly_events[key] || 0,
    });
  }
  return points;
}

export async function buildProgressResponse(user, now = new Date()) {
  const progress = normalizeProgress(user.progress);
  const totalSigns = await loadTotalSigns();
  const signsLearned =
    progress.learned.alphabet.length +
    progress.learned.number.length +
    progress.learned.basic_word.length;

  return {
    stats: {
      signs_learned: signsLearned,
      total_signs: totalSigns,
      games_played: progress.games_played,
      seconds_spent: progress.seconds_spent,
      streak_days: progress.streak_days,
    },
    usage: buildUsage(progress),
    monthly_activity: buildMonthlyActivity(progress, now),
    updated_at: user.updatedAt || user.updated_at || new Date().toISOString(),
  };
}

export function recordProgressActivity(user, payload, now = new Date()) {
  const progress = normalizeProgress(user.progress);
  const category = String(payload.category || '').trim();
  const itemKey = String(payload.item_key || payload.itemKey || '').trim();
  const secondsSpent = Math.max(0, Math.min(24 * 60 * 60, Number(payload.seconds_spent || 0)));
  const gameCompleted = Boolean(payload.game_completed);

  if (!VALID_CATEGORIES.has(category)) {
    const error = new Error('Invalid activity category.');
    error.statusCode = 400;
    throw error;
  }

  let activityRecorded = false;

  if (category === 'game') {
    if (gameCompleted) {
      progress.games_played += 1;
      activityRecorded = true;
    }
  } else if (category === 'detector') {
    if (secondsSpent > 0) {
      activityRecorded = true;
    }
  } else if (itemKey) {
    const bucket = progress.learned[category];
    if (bucket && !bucket.includes(itemKey)) {
      bucket.push(itemKey);
      activityRecorded = true;
    }
  }

  if (secondsSpent > 0) {
    progress.seconds_spent += secondsSpent;
    activityRecorded = true;
  }

  if (activityRecorded) {
    updateStreak(progress, now);
    incrementMonthlyEvents(progress, now);
  }

  return progress;
}
