import {
  addEvent,
  addTask,
  applySharedState,
  completeTask,
  createInitialState,
  deleteEvent,
  deleteTask,
  editEvent,
  editTask,
  participantList,
  rooms,
  selectParticipant,
  sendChat,
  setRoom,
  toggleVoice,
} from './app-state.js';
import {
  addRemotePlayer,
  getPlayerState,
  highlightParticipant,
  initMetaverse,
  moveRemotePlayer,
  removeRemotePlayer,
  setAvatarModelIdx,
  setVoiceActive,
  startAvatarLoad,
  teleportToRoom,
} from './metaverse3d.js';
import { broadcastChat, broadcastEmote, broadcastMove, broadcastSharedState, getMyId, initRealtime, isConfigured, joinSession, leaveSession, listenEmotes, listenSharedState } from './realtime.js';

let state = createInitialState();
let activeModal = null;
let modalMode = 'list';
let editingId = null;
let chatOpen = false;
let remoteCount = 0;
let myName = '自分';
const onlinePlayers = {};
let myPlayerId = null;

const app = document.querySelector('#app');

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  app.innerHTML = `
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark">♥</span>
        <div>
          <strong>ひこばえメタバースワールド</strong>
          <small>就労・ひきこもり支援プラットフォーム</small>
        </div>
      </div>
      <div class="header-stat">
        <span>現在の時間</span>
        <strong id="hdr-time">--:--</strong>
        <small id="hdr-date">読み込み中...</small>
      </div>
      <div class="header-stat people">
        <span>フロアにいる人</span>
        <strong id="hdr-count">-- <small>人</small></strong>
      </div>
      <button class="header-button">フロア設定</button>
    </header>

    <aside class="sidebar" id="sidebar"></aside>

    <main class="stage-wrap">
      <section class="metaverse" id="metaverse-host"></section>
      <div class="chat-panel" id="chat-panel">
        <div class="chat-panel-header">
          <span id="chat-room-label">チャット</span>
          <button id="chat-close-btn">×</button>
        </div>
        <div class="chat-messages" id="chat-messages"></div>
      </div>
      <footer class="control-dock" id="control-dock"></footer>
    </main>

    <aside class="inspector" id="inspector"></aside>

    <div id="modal-overlay" class="modal-overlay hidden">
      <div class="modal-panel">
        <div class="modal-header">
          <h2 id="modal-title"></h2>
          <button class="modal-close" id="modal-close">×</button>
        </div>
        <div class="modal-body" id="modal-body"></div>
      </div>
    </div>

    <div id="join-overlay" class="join-overlay">
      <div class="join-card">
        <div class="join-icon">🏢</div>
        <h2>サポートメタバースへようこそ</h2>
        <p>お名前を入力してアバターを選んでください。</p>
        <input id="join-name" class="join-name-input" type="text"
          placeholder="お名前（例: たくや）" maxlength="20" autocomplete="off">
        <div class="join-label">アバターを選択</div>
        <div class="avatar-model-btns" id="avatar-model-btns">
          <button class="avatar-model-btn selected" data-model="0">
            <img src="./assets/thumb0.png" alt="ブルースーツ">
            <span>ブルースーツ</span>
          </button>
          <button class="avatar-model-btn" data-model="1">
            <img src="./assets/thumb1.png" alt="エレガンス">
            <span>エレガンス</span>
          </button>
          <button class="avatar-model-btn" data-model="2">
            <img src="./assets/thumb2.png" alt="グリーンパーカー">
            <span>グリーンパーカー</span>
          </button>
          <button class="avatar-model-btn" data-model="3">
            <img src="./assets/thumb3.png" alt="ゴールデン">
            <span>ゴールデン</span>
          </button>
          <button class="avatar-model-btn" data-model="4">
            <img src="./assets/thumb4.png" alt="ノワール">
            <span>ノワール</span>
          </button>
          <button class="avatar-model-btn" data-model="5">
            <img src="./assets/thumb5.png" alt="ブルーサークル">
            <span>ブルーサークル</span>
          </button>
        </div>
        <button id="join-btn" class="join-btn">入室する →</button>
        <p class="join-status ${isConfigured ? 'online' : 'offline'}">
          ${isConfigured ? '🟢 マルチプレイヤーモード' : '⚪ シングルプレイヤーモード（Firebase未設定）'}
        </p>
      </div>
    </div>
  `;

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  document.getElementById('chat-close-btn').addEventListener('click', () => {
    chatOpen = false;
    document.getElementById('chat-panel').classList.remove('open');
    updateControlDock();
  });

  // Realtime multiplayer
  initRealtime({
    onJoin: (id, data) => {
      onlinePlayers[id] = { name: data.name, avatarIdx: data.avatarIdx, room: data.room };
      addRemotePlayer(id, data);
      remoteCount++;
      updateOnlineCount();
      updateInspector();
    },
    onMove: (id, data) => {
      if (onlinePlayers[id]) onlinePlayers[id].room = data.room;
      moveRemotePlayer(id, data);
    },
    onLeave: (id) => {
      delete onlinePlayers[id];
      removeRemotePlayer(id);
      remoteCount = Math.max(0, remoteCount - 1);
      updateOnlineCount();
      updateInspector();
    },
    onCountChange: updateOnlineCount,
    onChatMessage: (roomId, author, body) => {
      state = sendChat(state, roomId, body, author);
      if (chatOpen) renderChatMessages();
    },
  });
  listenEmotes((emoji, author) => floatReactionCenter(emoji, author));
  listenSharedState((tasks, events) => {
    state = applySharedState(state, tasks, events);
    updateSidebar();
    updateInspector();
    if (activeModal) renderModalBody();
  });

  bindJoinOverlay();

  const host = document.getElementById('metaverse-host');
  initMetaverse(
    host,
    (participantId) => {
      state = selectParticipant(state, participantId);
      highlightParticipant(participantId);
      updateInspector();
      updateSidebar();
    },
    (roomId) => {
      const next = setRoom(state, roomId);
      if (next !== state) {
        state = next;
        updateSidebar();
        updateControlDock();
      }
    }
  );

  updateSidebar();
  updateInspector();
  updateControlDock();
  startClock();
}

// ── Join overlay ──────────────────────────────────────────────────────────────

const AVATAR_PALETTE = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899'];
let joinModelIdx = 0;

function bindJoinOverlay() {
  const modelBox = document.getElementById('avatar-model-btns');
  modelBox.querySelectorAll('.avatar-model-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modelBox.querySelectorAll('.avatar-model-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      joinModelIdx = parseInt(btn.dataset.model);
    });
  });

  const doJoin = () => {
    const name = (document.getElementById('join-name').value.trim()) || '参加者';
    myName = name;
    setAvatarModelIdx(joinModelIdx);
    startAvatarLoad();
    if (isConfigured) {
      joinSession(name, 0, joinModelIdx);
      myPlayerId = getMyId();
      setInterval(() => {
        const pos = getPlayerState();
        if (pos) broadcastMove(pos.x, pos.z, state.activeRoom, pos.yaw);
      }, 100);
    } else {
      myPlayerId = 'local-' + Date.now();
    }
    onlinePlayers[myPlayerId] = { name, avatarIdx: 0, room: state.activeRoom };
    state = selectParticipant(state, myPlayerId);
    updateInspector();
    const ov = document.getElementById('join-overlay');
    ov.classList.add('fade-out');
    setTimeout(() => ov.remove(), 380);
    updateOnlineCount();
  };

  document.getElementById('join-btn').addEventListener('click', doJoin);
  document.getElementById('join-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') doJoin();
  });
}

function updateOnlineCount() {
  const el = document.getElementById('hdr-count');
  if (el) el.innerHTML = `${remoteCount + 1} <small>人</small>`;
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function startClock() {
  const DOW = ['日','月','火','水','木','金','土'];
  function tick() {
    const now = new Date();
    const t = document.getElementById('hdr-time');
    const d = document.getElementById('hdr-date');
    if (t) t.textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    if (d) d.textContent = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日（${DOW[now.getDay()]}）`;
  }
  tick();
  setInterval(tick, 1000);
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function updateSidebar() {
  document.getElementById('sidebar').innerHTML = sidebarHTML();
  bindSidebarEvents();
}

function sidebarHTML() {
  const progress = state.roomProgress;
  return `
    <h2 class="nav-title">ルーム</h2>
    <nav class="room-nav">
      ${rooms.map(r => {
        const rp = progress[r.id] ?? { completed: 0, total: 0 };
        return `
        <button class="room-button ${state.activeRoom === r.id ? 'active' : ''}" data-room="${r.id}">
          <span>${roomIcon(r.id)}</span>
          <div>
            <strong>${r.label}</strong>
            <small>${roomDesc(r.id)}</small>
          </div>
          <em>${rp.completed}/${rp.total}</em>
        </button>`;
      }).join('')}
    </nav>
    <h2 class="nav-title">サポートメニュー</h2>
    <nav class="support-menu">
      ${[
        ['タスクボード',       'みんなのタスクを確認', 'tasks'],
        ['イベントカレンダー', '予定・イベントを確認', 'calendar'],
        ['資料ライブラリ',     '支援資料・教材一覧',   'library'],
      ].map(([title, sub, modal]) => `
        <button data-modal="${modal}">
          <span>${title[0]}</span>
          <div><strong>${title}</strong><small>${sub}</small></div>
          <span class="menu-arrow">›</span>
        </button>
      `).join('')}
    </nav>
    <button class="map-button">エリアマップ</button>
  `;
}

function bindSidebarEvents() {
  document.querySelectorAll('[data-room]').forEach(btn => {
    btn.addEventListener('click', () => {
      state = setRoom(state, btn.dataset.room);
      teleportToRoom(btn.dataset.room);
      updateSidebar();
      updateControlDock();
      if (chatOpen) renderChatMessages();
    });
  });
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.modal));
  });
}

// ── Inspector ─────────────────────────────────────────────────────────────────

function updateInspector() {
  document.getElementById('inspector').innerHTML = inspectorHTML();
  bindInspectorEvents();
}

function inspectorHTML() {
  const onlineList = Object.entries(onlinePlayers).map(([id, d]) => ({ id, ...d }));
  const selected   = onlinePlayers[state.selectedParticipantId];
  const allTasks  = state.tasks;
  const openCount = allTasks.filter(t => t.status !== 'done').length;

  return `
    <section class="profile-card">
      <h2>オンライン中 ${onlineList.length}人</h2>
      <div class="participant-tabs">
        ${onlineList.length === 0
          ? '<p class="empty-note" style="font-size:12px;padding:8px 0">まだ誰もいません</p>'
          : onlineList.map(p => `
            <button class="ptab ${p.id === state.selectedParticipantId ? 'active' : ''}"
              data-ptab="${p.id}" title="${p.name}"
              style="background:${AVATAR_PALETTE[(p.avatarIdx ?? 0) % AVATAR_PALETTE.length]}22;
                     border-color:${AVATAR_PALETTE[(p.avatarIdx ?? 0) % AVATAR_PALETTE.length]}"
            >${p.name.at(0)}</button>
          `).join('')
        }
      </div>
      ${selected ? `
        <div class="participant-card">
          <div class="profile-avatar"
            style="background:${AVATAR_PALETTE[(selected.avatarIdx ?? 0) % AVATAR_PALETTE.length]};color:#fff">
            ${selected.name.at(0)}
          </div>
          <div>
            <strong>${selected.name} さん</strong>
            <small>現在地: ${rooms.find(r => r.id === selected.room)?.label ?? 'ロビー'}</small>
            ${selected.id === myPlayerId ? '<small style="color:var(--green)">（自分）</small>' : ''}
          </div>
        </div>
      ` : ''}
    </section>

    <section class="panel task-panel">
      <div class="panel-heading">
        <h3>タスク（${openCount}件進行中）</h3>
        <button data-modal="tasks" class="link-btn">管理する</button>
      </div>
      <div class="task-list">
        ${allTasks.length === 0
          ? '<p class="empty-note">タスクなし</p>'
          : allTasks.slice(0, 6).map(task => `
            <button class="task-row ${task.status}" data-task="${task.id}" data-owner="${task.participantId}"
              ${task.status === 'done' ? 'disabled' : ''}>
              <span class="check-box"></span>
              <strong>${task.title}</strong>
              <small>${dispName(task.participantId)} · ${fmtDate(task.deadline)}</small>
              <em>${task.status === 'done' ? '完了' : '進行中'}</em>
            </button>
          `).join('')
        }
      </div>
    </section>

    <section class="quick-menu">
      <button>ヘルプ</button><button>設定</button><button id="leave-btn">退室する</button>
    </section>
  `;
}

function bindInspectorEvents() {
  document.querySelectorAll('[data-ptab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state = selectParticipant(state, btn.dataset.ptab);
      updateInspector();
    });
  });

  document.querySelectorAll('[data-task]').forEach(btn => {
    btn.addEventListener('click', () => {
      state = completeTask(state, btn.dataset.owner, btn.dataset.task);
      syncShared();
      updateInspector();
      updateSidebar();
    });
  });

  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.modal));
  });

  document.getElementById('leave-btn')?.addEventListener('click', () => {
    if (confirm('退室しますか？')) { leaveSession(); location.reload(); }
  });
}

// ── Control Dock ──────────────────────────────────────────────────────────────

function updateControlDock() {
  document.getElementById('control-dock').innerHTML = controlDockHTML();
  bindControlEvents();
}

function controlDockHTML() {
  const selectedRoom = rooms.find(r => r.id === state.activeRoom);
  const msgCount     = (state.chatMessages[state.activeRoom] ?? []).length;
  return `
    <section class="voice-dock">
      <button class="${state.voiceEnabled ? 'on' : ''}" data-action="voice">
        <strong>マイク</strong><small>${state.voiceEnabled ? 'ON' : 'OFF'}</small>
      </button>
      <button class="on"><strong>スピーカー</strong><small>ON</small></button>
      <button><strong>カメラ</strong><small>OFF</small></button>
      <button><strong>画面共有</strong><small>待機</small></button>
    </section>
    <section class="chat-dock">
      <button class="chat-hist-btn ${chatOpen ? 'on' : ''}" data-action="chat-toggle">
        💬${msgCount > 0 ? `<span class="chat-badge">${msgCount}</span>` : ''}
      </button>
      <input id="chat-quick-input" placeholder="${selectedRoom.label}へメッセージ..."
        autocomplete="off">
      <button data-action="chat-send">送信</button>
    </section>
    <section class="reaction-dock">
      <button data-reaction="🙋">🙋<small>手を挙げる</small></button>
      <button data-reaction="👏">👏<small>拍手</small></button>
      <button data-reaction="👍">👍<small>いいね</small></button>
      <button data-reaction="🙏">🙏<small>ありがとう</small></button>
    </section>
  `;
}

function bindControlEvents() {
  document.querySelector('[data-action="voice"]')?.addEventListener('click', () => {
    state = toggleVoice(state);
    setVoiceActive(state.voiceEnabled);
    updateControlDock();
  });

  document.querySelector('[data-action="chat-toggle"]')?.addEventListener('click', () => {
    chatOpen = !chatOpen;
    const panel = document.getElementById('chat-panel');
    panel.classList.toggle('open', chatOpen);
    if (chatOpen) {
      const activeRoom = rooms.find(r => r.id === state.activeRoom);
      document.getElementById('chat-room-label').textContent =
        `${activeRoom.label} のチャット`;
      renderChatMessages();
    }
    updateControlDock();
  });

  const chatInput = document.getElementById('chat-quick-input');
  function doSend() {
    if (!chatInput?.value.trim()) return;
    const body = chatInput.value;
    state = sendChat(state, state.activeRoom, body, myName);
    broadcastChat(state.activeRoom, myName, body);
    chatInput.value = '';
    if (chatOpen) renderChatMessages();
    updateControlDock();
  }
  document.querySelector('[data-action="chat-send"]')?.addEventListener('click', doSend);
  chatInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });

  document.querySelectorAll('[data-reaction]').forEach(btn => {
    btn.addEventListener('click', () => {
      floatReaction(btn.dataset.reaction, btn);
      broadcastEmote(btn.dataset.reaction, myName);
    });
  });
}

// ── Chat Panel ────────────────────────────────────────────────────────────────

function renderChatMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const msgs = state.chatMessages[state.activeRoom] ?? [];
  if (msgs.length === 0) {
    container.innerHTML = '<p class="chat-empty">まだメッセージはありません</p>';
  } else {
    container.innerHTML = msgs.map(m => {
      const isMe = m.author === myName;
      return `
        <div class="chat-bubble ${isMe ? 'mine' : 'theirs'}">
          ${!isMe ? `<span class="bubble-author">${m.author}</span>` : ''}
          <p class="bubble-body">${m.body}</p>
          <span class="bubble-time">${m.time}</span>
        </div>
      `;
    }).join('');
  }
  container.scrollTop = container.scrollHeight;
}

// ── Reactions ─────────────────────────────────────────────────────────────────

function floatReaction(emoji, sourceEl) {
  const el = document.createElement('div');
  el.className = 'reaction-float';
  el.textContent = emoji;
  const rect = sourceEl.getBoundingClientRect();
  el.style.left = `${rect.left + rect.width / 2 - 20}px`;
  el.style.top  = `${rect.top}px`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function floatReactionCenter(emoji, author) {
  const el = document.createElement('div');
  el.className = 'reaction-float reaction-float--remote';
  el.textContent = emoji;
  const offset = (Math.random() - 0.5) * 160;
  el.style.left = `${window.innerWidth / 2 + offset - 20}px`;
  el.style.top  = `${window.innerHeight * 0.6}px`;
  if (author) {
    const label = document.createElement('span');
    label.className = 'reaction-label';
    label.textContent = author;
    el.appendChild(label);
  }
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// ── Modal ─────────────────────────────────────────────────────────────────────

const MODAL_LABELS = {
  tasks:    'タスクボード',
  news:     'おしらせ',
  calendar: 'イベントカレンダー',
  library:  '資料ライブラリ',
};

function openModal(type) {
  activeModal = type;
  modalMode   = 'list';
  editingId   = null;
  document.getElementById('modal-title').textContent = MODAL_LABELS[type] ?? type;
  document.getElementById('modal-overlay').classList.remove('hidden');
  renderModalBody();
}

function renderModalBody() {
  const body = document.getElementById('modal-body');
  if (!body) return;
  switch (activeModal) {
    case 'tasks':
      body.innerHTML = modalMode === 'list' ? taskListHTML() : taskFormHTML(); break;
    case 'calendar':
      body.innerHTML = modalMode === 'list' ? calendarListHTML() : eventFormHTML(); break;
    case 'news':
      body.innerHTML = newsHTML(); break;
    case 'library':
      body.innerHTML = libraryHTML(); break;
  }
  bindModalEvents(body);
}

function bindModalEvents(body) {
  // ── Task list ──
  body.querySelectorAll('[data-complete-task]').forEach(btn => {
    btn.addEventListener('click', () => {
      state = completeTask(state, btn.dataset.owner, btn.dataset.completeTask);
      syncShared(); updateInspector(); renderModalBody();
    });
  });
  body.querySelectorAll('[data-edit-task]').forEach(btn => {
    btn.addEventListener('click', () => {
      modalMode = 'edit'; editingId = btn.dataset.editTask; renderModalBody();
    });
  });
  body.querySelectorAll('[data-delete-task]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('このタスクを削除しますか？')) return;
      state = deleteTask(state, btn.dataset.deleteTask);
      syncShared(); updateInspector(); renderModalBody();
    });
  });
  body.querySelector('#add-task-btn')?.addEventListener('click', () => {
    modalMode = 'add'; editingId = null; renderModalBody();
  });

  // ── Task form ──
  body.querySelector('#task-form-submit')?.addEventListener('click', () => {
    const title = document.getElementById('tf-title').value.trim();
    if (!title) { alert('タイトルを入力してください'); return; }
    const data = {
      title,
      participantId: document.getElementById('tf-participant').value,
      room:          document.getElementById('tf-room').value,
      deadline:      document.getElementById('tf-deadline').value,
      status:        document.getElementById('tf-status')?.value ?? 'todo',
    };
    state = modalMode === 'add' ? addTask(state, data) : editTask(state, editingId, data);
    syncShared(); modalMode = 'list'; editingId = null;
    updateInspector(); updateSidebar(); renderModalBody();
  });
  body.querySelector('#task-form-cancel')?.addEventListener('click', () => {
    modalMode = 'list'; editingId = null; renderModalBody();
  });

  // ── Event list ──
  body.querySelectorAll('[data-edit-event]').forEach(btn => {
    btn.addEventListener('click', () => {
      modalMode = 'edit'; editingId = btn.dataset.editEvent; renderModalBody();
    });
  });
  body.querySelectorAll('[data-delete-event]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('このイベントを削除しますか？')) return;
      state = deleteEvent(state, btn.dataset.deleteEvent);
      syncShared(); renderModalBody();
    });
  });
  body.querySelector('#add-event-btn')?.addEventListener('click', () => {
    modalMode = 'add'; editingId = null; renderModalBody();
  });

  // ── Event form ──
  body.querySelector('#evt-form-submit')?.addEventListener('click', () => {
    const title = document.getElementById('ef-title').value.trim();
    if (!title) { alert('タイトルを入力してください'); return; }
    const data = {
      title,
      date:          document.getElementById('ef-date').value,
      room:          document.getElementById('ef-room').value,
      type:          document.getElementById('ef-type').value,
      participantId: document.getElementById('ef-participant').value || null,
    };
    state = modalMode === 'add' ? addEvent(state, data) : editEvent(state, editingId, data);
    syncShared(); modalMode = 'list'; editingId = null; renderModalBody();
  });
  body.querySelector('#evt-form-cancel')?.addEventListener('click', () => {
    modalMode = 'list'; editingId = null; renderModalBody();
  });
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  activeModal = null; modalMode = 'list'; editingId = null;
}

// ── Modal: Task board ─────────────────────────────────────────────────────────

function taskListHTML() {
  const byRoom = {};
  rooms.forEach(r => { byRoom[r.id] = { label: r.label, tasks: [] }; });
  state.tasks.forEach(t => { if (byRoom[t.room]) byRoom[t.room].tasks.push(t); });

  return `
    <div class="crud-toolbar">
      <button id="add-task-btn" class="btn-primary">+ タスクを追加</button>
    </div>
    ${Object.entries(byRoom).map(([, { label, tasks }]) => `
      <section class="modal-section">
        <h3>${label}</h3>
        ${tasks.length === 0
          ? '<p class="empty-note">タスクなし</p>'
          : tasks.map(t => `
            <div class="task-crud-row ${t.status}">
              <button class="check-btn ${t.status === 'done' ? 'checked' : ''}"
                data-complete-task="${t.id}" data-owner="${t.participantId}"
                ${t.status === 'done' ? 'disabled' : ''}>
                <span class="check-box"></span>
              </button>
              <div class="task-content">
                <strong>${t.title}</strong>
                <small>${dispName(t.participantId)} · 期限: ${fmtDate(t.deadline)}</small>
              </div>
              <em class="task-status-badge ${t.status}">${t.status === 'done' ? '完了' : '進行中'}</em>
              <div class="task-actions">
                <button class="btn-icon" data-edit-task="${t.id}" title="編集">✏️</button>
                <button class="btn-icon btn-danger-icon" data-delete-task="${t.id}" title="削除">🗑️</button>
              </div>
            </div>
          `).join('')
        }
      </section>
    `).join('')}
  `;
}

function taskFormHTML() {
  const t     = editingId ? state.tasks.find(x => x.id === editingId) : null;
  const today = new Date().toISOString().split('T')[0];
  return `
    <div class="crud-form">
      <h3>${t ? 'タスクを編集' : 'タスクを追加'}</h3>
      <div class="form-field">
        <label for="tf-title">タイトル</label>
        <input id="tf-title" type="text" placeholder="タスク内容を入力"
          value="${esc(t?.title ?? '')}">
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="tf-participant">担当者</label>
          <select id="tf-participant">
            <option value="team" ${!t || t.participantId === 'team' ? 'selected' : ''}>チーム全体</option>
            ${Object.entries(onlinePlayers).map(([id, d]) => `
              <option value="${id}" ${t?.participantId === id ? 'selected' : ''}>${d.name}</option>
            `).join('')}
          </select>
        </div>
        <div class="form-field">
          <label for="tf-room">ルーム</label>
          <select id="tf-room">
            ${rooms.map(r => `
              <option value="${r.id}" ${t?.room === r.id ? 'selected' : ''}>${r.label}</option>
            `).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="tf-deadline">期限</label>
          <input id="tf-deadline" type="date" value="${t?.deadline ?? today}">
        </div>
        ${t ? `
        <div class="form-field">
          <label for="tf-status">ステータス</label>
          <select id="tf-status">
            <option value="todo" ${t.status !== 'done' ? 'selected' : ''}>進行中</option>
            <option value="done" ${t.status === 'done' ? 'selected' : ''}>完了</option>
          </select>
        </div>` : ''}
      </div>
      <div class="form-actions">
        <button id="task-form-cancel" class="btn-secondary">キャンセル</button>
        <button id="task-form-submit" class="btn-primary">保存する</button>
      </div>
    </div>
  `;
}

// ── Modal: Calendar ───────────────────────────────────────────────────────────

function calendarListHTML() {
  const sorted = [...state.events].sort((a, b) => a.date.localeCompare(b.date));
  return `
    <div class="crud-toolbar">
      <button id="add-event-btn" class="btn-primary">+ イベントを追加</button>
    </div>
    <div class="calendar-events">
      ${sorted.map(ev => `
        <div class="cal-event cal-${ev.type}">
          <span class="cal-date">${fmtDateTime(ev.date)}</span>
          <strong>${ev.title}</strong>
          <em>${rooms.find(r => r.id === ev.room)?.label ?? ev.room}</em>
          <div class="event-actions">
            <button class="btn-icon" data-edit-event="${ev.id}" title="編集">✏️</button>
            <button class="btn-icon btn-danger-icon" data-delete-event="${ev.id}" title="削除">🗑️</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function eventFormHTML() {
  const ev  = editingId ? state.events.find(x => x.id === editingId) : null;
  const now = new Date().toISOString().slice(0, 16);
  return `
    <div class="crud-form">
      <h3>${ev ? 'イベントを編集' : 'イベントを追加'}</h3>
      <div class="form-field">
        <label for="ef-title">タイトル</label>
        <input id="ef-title" type="text" placeholder="イベント名を入力"
          value="${esc(ev?.title ?? '')}">
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="ef-date">日時</label>
          <input id="ef-date" type="datetime-local"
            value="${ev?.date ? ev.date.slice(0, 16) : now}">
        </div>
        <div class="form-field">
          <label for="ef-type">種別</label>
          <select id="ef-type">
            <option value="event"   ${!ev || ev.type === 'event'   ? 'selected' : ''}>イベント</option>
            <option value="meeting" ${ev?.type === 'meeting' ? 'selected' : ''}>会議・ふりかえり</option>
            <option value="consult" ${ev?.type === 'consult' ? 'selected' : ''}>個別面談</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="ef-room">ルーム</label>
          <select id="ef-room">
            ${rooms.map(r => `
              <option value="${r.id}" ${ev?.room === r.id ? 'selected' : ''}>${r.label}</option>
            `).join('')}
          </select>
        </div>
        <div class="form-field">
          <label for="ef-participant">参加者（任意）</label>
          <select id="ef-participant">
            <option value="">なし</option>
            ${Object.entries(onlinePlayers).map(([id, d]) => `
              <option value="${id}" ${ev?.participantId === id ? 'selected' : ''}>${d.name}</option>
            `).join('')}
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button id="evt-form-cancel" class="btn-secondary">キャンセル</button>
        <button id="evt-form-submit" class="btn-primary">保存する</button>
      </div>
    </div>
  `;
}

// ── Modal: News & Library ─────────────────────────────────────────────────────

function newsHTML() {
  return `
    <div class="news-list">
      <article class="news-item">
        <time>5/19</time>
        <h4>5月の活動スケジュールを更新しました</h4>
        <p>5月20日〜31日のメタバース開室日程を更新しました。カレンダーをご確認ください。</p>
      </article>
      <article class="news-item">
        <time>5/15</time>
        <h4>「デジタルスキル入門講座」参加者募集</h4>
        <p>6月開催のオンライン講座。定員10名。希望者はスタッフまで。</p>
      </article>
      <article class="news-item">
        <time>5/10</time>
        <h4>相談室の予約方法が変わりました</h4>
        <p>個別面談の予約はカレンダーからご自身で登録できるようになりました。</p>
      </article>
      <article class="news-item">
        <time>4/30</time>
        <h4>ゴールデンウィーク期間の開室について</h4>
        <p>5/3〜5/5は休室です。5/6（月）より通常開室となります。</p>
      </article>
    </div>
  `;
}

function libraryHTML() {
  const items = [
    { cat: '就労準備',  type: '動画',  title: '報連相の基本',              dur: '15分', level: '入門' },
    { cat: '就労準備',  type: '動画',  title: 'ビジネスメールの書き方',    dur: '20分', level: '入門' },
    { cat: 'デジタル',  type: '教材',  title: 'Canva入門ガイド',           dur: '—',   level: '初級' },
    { cat: 'デジタル',  type: '教材',  title: 'Notion使い方マニュアル',    dur: '—',   level: '初級' },
    { cat: 'セルフケア', type: '読物', title: '毎日の体調記録のコツ',       dur: '5分',  level: '全員' },
    { cat: '面談準備',  type: '資料',  title: '目標設定シート（テンプレ）', dur: '—',   level: '全員' },
  ];
  return `
    <div class="library-grid">
      ${items.map(it => `
        <div class="lib-card">
          <span class="lib-type">${it.type}</span>
          <strong>${it.title}</strong>
          <div class="lib-meta">
            <em>${it.cat}</em>
            <small>${it.level} · ${it.dur}</small>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function roomIcon(id) {
  return { lobby: '⌂', learning: '▣', workshop: '●', consultation: '☁' }[id] ?? '○';
}

function roomDesc(id) {
  return {
    lobby:        'みんなが集まる交流の場',
    learning:     '学習・進学をサポート',
    workshop:     '作業・スキル習得の場',
    consultation: '個別相談・面談はこちら',
  }[id] ?? '';
}

function roomCount(id) {
  return { lobby: 6, learning: 4, workshop: 3, consultation: 2 }[id] ?? 0;
}

function dispName(id) {
  return onlinePlayers[id]?.name
      ?? participantList.find(p => p.id === id)?.name
      ?? (id === 'team' ? 'チーム' : id);
}

function syncShared() {
  broadcastSharedState(state.tasks, state.events);
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('ja', { month: 'numeric', day: 'numeric' });
  } catch { return dateStr; }
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('ja', {
      year: 'numeric', month: 'numeric', day: 'numeric',
      weekday: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return dateStr; }
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
