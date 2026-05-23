export const rooms = [
  { id: 'lobby',        label: 'ロビー',  shortLabel: '参加', description: '今日の状態確認とゆるい交流' },
  { id: 'learning',     label: '学習室',  shortLabel: '学習', description: '就労準備の動画・教材' },
  { id: 'workshop',     label: '作業室',  shortLabel: '訓練', description: '割り当てタスクと共同作業' },
  { id: 'consultation', label: '相談室',  shortLabel: '相談', description: '個別面談と支援メモ' },
];

export const participantList = [
  { id: 'ren',  name: 'たくや', avatarLetter: 'た' },
  { id: 'mika', name: 'まさと', avatarLetter: 'ま' },
  { id: 'sora', name: 'ひろし', avatarLetter: 'ひ' },
];

const STORAGE_KEY = 'sp-mv-v2';

const participants = [
  { id: 'ren',  name: '蓮', avatar: 'た', status: '作業中',   mood: '安定', room: 'workshop',      attendanceMinutes: 42, weeklyStreak: 3, progress: 68, nextAction: '15:30に成果物を一緒に確認' },
  { id: 'mika', name: '美香', avatar: 'ま', status: '見学中',   mood: '低め', room: 'learning',      attendanceMinutes: 16, weeklyStreak: 1, progress: 34, nextAction: '教材後に短い声かけ' },
  { id: 'sora', name: '空',  avatar: 'ひ', status: '相談待ち', mood: '緊張', room: 'consultation',  attendanceMinutes: 9,  weeklyStreak: 2, progress: 22, nextAction: '相談室で5分面談' },
];

const defaultTasks = [
  { id: 'task-ren-1',  participantId: 'ren',  room: 'workshop',     title: 'Canvaで告知画像を1案作る',       status: 'done', deadline: '2025-05-21' },
  { id: 'task-ren-2',  participantId: 'ren',  room: 'workshop',     title: 'Notionに作業手順を3行で記録',     status: 'todo', deadline: '2025-05-22' },
  { id: 'task-mika-1', participantId: 'mika', room: 'learning',     title: '動画「報連相の基本」を視聴',      status: 'todo', deadline: '2025-05-23' },
  { id: 'task-mika-2', participantId: 'mika', room: 'learning',     title: '今日できそうな作業を1つ選ぶ',     status: 'todo', deadline: '2025-05-21' },
  { id: 'task-sora-1', participantId: 'sora', room: 'consultation', title: '体調メモを送る',                  status: 'todo', deadline: '2025-05-21' },
  { id: 'task-team-1', participantId: 'team', room: 'workshop',     title: 'デジタル部の週次ふりかえり',       status: 'done', deadline: '2025-05-20' },
];

const defaultEvents = [
  { id: 'evt-1', date: '2025-05-21T15:00', title: '個別面談 — たくや',             room: 'consultation', type: 'consult', participantId: 'ren'  },
  { id: 'evt-2', date: '2025-05-22T13:00', title: 'Canvaデザイン入門',             room: 'learning',     type: 'event',   participantId: null   },
  { id: 'evt-3', date: '2025-05-24T10:00', title: '週次ふりかえり会',              room: 'lobby',        type: 'meeting', participantId: null   },
  { id: 'evt-4', date: '2025-05-28T15:30', title: '個別面談 — まさと',             room: 'consultation', type: 'consult', participantId: 'mika' },
  { id: 'evt-5', date: '2025-06-01T13:00', title: '新メンバーオリエンテーション',  room: 'lobby',        type: 'event',   participantId: null   },
  { id: 'evt-6', date: '2025-06-05T16:00', title: '月次ふりかえり発表会',          room: 'workshop',     type: 'meeting', participantId: null   },
];

const consultations = {
  ren:  [{ author: '支援者', body: '今日は集中時間が長め。終盤に休憩を提案する。' }],
  mika: [{ author: '本人',   body: '声だけの参加ならできそう。' }],
  sora: [{ author: '支援者', body: '無理に話さず、チャット相談から始める。' }],
};

// ── Storage ───────────────────────────────────────────────────────────────────

function saveStorage(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: state.tasks, events: state.events }));
  } catch { /* quota or private mode */ }
}

function loadStorage() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); }
  catch { return {}; }
}

// ── State factory ─────────────────────────────────────────────────────────────

export function createInitialState() {
  const saved = loadStorage();
  return deriveState({
    activeRoom: 'lobby',
    selectedParticipantId: 'ren',
    voiceEnabled: false,
    playerPosition: { x: 50, y: 56 },
    participants: structuredClone(participants),
    tasks: saved.tasks   ?? structuredClone(defaultTasks),
    events: saved.events ?? structuredClone(defaultEvents),
    consultations: structuredClone(consultations),
    chatMessages: {},
  });
}

// ── Participant ───────────────────────────────────────────────────────────────

export function selectParticipant(state, participantId) {
  if (!state.participants.some(p => p.id === participantId)) return state;
  return deriveState({ ...state, selectedParticipantId: participantId });
}

export function updateParticipantStatus(state, participantId, updates) {
  return deriveState({
    ...state,
    participants: state.participants.map(p => p.id === participantId ? { ...p, ...updates } : p),
  });
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export function addTask(state, taskData) {
  const task = { id: `t-${Date.now()}`, status: 'todo', ...taskData };
  const next = deriveState({ ...state, tasks: [...state.tasks, task] });
  saveStorage(next);
  return next;
}

export function editTask(state, taskId, updates) {
  const next = deriveState({ ...state, tasks: state.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t) });
  saveStorage(next);
  return next;
}

export function deleteTask(state, taskId) {
  const next = deriveState({ ...state, tasks: state.tasks.filter(t => t.id !== taskId) });
  saveStorage(next);
  return next;
}

export function completeTask(state, participantId, taskId) {
  const next = deriveState({
    ...state,
    tasks: state.tasks.map(t => t.id === taskId && t.participantId === participantId ? { ...t, status: 'done' } : t),
  });
  saveStorage(next);
  return next;
}

// ── Events ────────────────────────────────────────────────────────────────────

export function addEvent(state, eventData) {
  const event = { id: `e-${Date.now()}`, ...eventData };
  const next = deriveState({ ...state, events: [...state.events, event] });
  saveStorage(next);
  return next;
}

export function editEvent(state, eventId, updates) {
  const next = deriveState({ ...state, events: state.events.map(e => e.id === eventId ? { ...e, ...updates } : e) });
  saveStorage(next);
  return next;
}

export function deleteEvent(state, eventId) {
  const next = deriveState({ ...state, events: state.events.filter(e => e.id !== eventId) });
  saveStorage(next);
  return next;
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export function sendChat(state, roomId, body, author = '自分') {
  if (!body.trim()) return state;
  const msg = { author, body: body.trim(), time: new Date().toLocaleTimeString('ja', { hour: '2-digit', minute: '2-digit' }) };
  const prev = state.chatMessages[roomId] ?? [];
  return deriveState({ ...state, chatMessages: { ...state.chatMessages, [roomId]: [...prev, msg] } });
}

// ── Room / Voice ──────────────────────────────────────────────────────────────

export function setRoom(state, roomId) {
  if (!rooms.some(r => r.id === roomId)) return state;
  return deriveState({ ...state, activeRoom: roomId });
}

export function toggleVoice(state) {
  return deriveState({ ...state, voiceEnabled: !state.voiceEnabled });
}

// ── Consultation ──────────────────────────────────────────────────────────────

export function addConsultationMessage(state, body) {
  const text = body.trim();
  if (!text) return state;
  const id  = state.selectedParticipantId;
  const cur = state.consultations[id] ?? [];
  return deriveState({ ...state, consultations: { ...state.consultations, [id]: [...cur, { author: '支援者', body: text }] } });
}

// ── Derive ────────────────────────────────────────────────────────────────────

function deriveState(state) {
  return { ...state, supportSummary: buildSupportSummary(state), roomProgress: buildRoomProgress(state.tasks) };
}

function buildSupportSummary(state) {
  const p  = state.participants.find(x => x.id === state.selectedParticipantId);
  const pt = state.tasks.filter(t => t.participantId === p.id);
  return {
    name: p.name, status: p.status, mood: p.mood,
    attendanceMinutes: p.attendanceMinutes, weeklyStreak: p.weeklyStreak, progress: p.progress,
    openTaskCount: pt.filter(t => t.status !== 'done').length,
    nextAction: p.nextAction,
  };
}

function buildRoomProgress(tasks) {
  return rooms.reduce((acc, r) => {
    const rt = tasks.filter(t => t.room === r.id);
    acc[r.id] = { completed: rt.filter(t => t.status === 'done').length, total: rt.length };
    return acc;
  }, {});
}

export function movePlayer(state, delta) {
  const pos = state.playerPosition ?? { x: 50, y: 56 };
  return deriveState({ ...state, playerPosition: { x: clamp(pos.x + delta.x, 8, 92), y: clamp(pos.y + delta.y, 8, 90) } });
}

function clamp(v, mn, mx) { return Math.min(mx, Math.max(mn, v)); }
