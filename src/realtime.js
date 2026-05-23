// ── Firebase Realtime Database — マルチプレイヤー位置同期 ─────────────────────
//
// セットアップ手順:
//  1. https://console.firebase.google.com でプロジェクト作成
//  2. 「Realtime Database」を作成（テストモードで開始）
//  3. プロジェクト設定 → マイアプリ → ウェブアプリ追加 → 設定をコピー
//  4. 下の FIREBASE_CONFIG を書き換えて保存
//
// Database Rules (テスト用):
//   { "rules": { "rooms": { ".read": true, ".write": true } } }
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getDatabase, ref, set, push,
  onChildAdded, onChildChanged, onChildRemoved,
  onDisconnect, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

// ★ここを自分のFirebase設定に書き換えてください★
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyAhJIQRb1lBIPGi1xH-mt3CXWPT_yVPIyg',
  authDomain:        'hikobaemetaverse.firebaseapp.com',
  databaseURL:       'https://hikobaemetaverse-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'hikobaemetaverse',
  storageBucket:     'hikobaemetaverse.firebasestorage.app',
  messagingSenderId: '472135211900',
  appId:             '1:472135211900:web:59760ac258386a83d2a2f9',
};

// 同じFirebaseプロジェクトを複数の用途に使う場合はここを変える
const ROOM_ID = 'unity_support_v1';

// 設定済みかどうか（プレースホルダーのまま = false = シングルプレイモード）
export const isConfigured = !FIREBASE_CONFIG.databaseURL.includes('YOUR_PROJECT');

let db     = null;
let myId   = null;
let myRef  = null;
let _name       = '参加者';
let _avatarIdx  = 0;
let _lastSend   = 0;

export function initRealtime({ onJoin, onMove, onLeave, onCountChange }) {
  if (!isConfigured) return;

  try {
    const app = initializeApp(FIREBASE_CONFIG);
    db = getDatabase(app);

    const pRef = ref(db, `rooms/${ROOM_ID}/players`);

    onChildAdded(pRef, snap => {
      if (snap.key === myId) return;
      onJoin(snap.key, snap.val());
      onCountChange?.();
    });
    onChildChanged(pRef, snap => {
      if (snap.key === myId) return;
      onMove(snap.key, snap.val());
    });
    onChildRemoved(pRef, snap => {
      onLeave(snap.key);
      onCountChange?.();
    });
  } catch (err) {
    console.warn('[realtime] Firebase init failed:', err.message);
  }
}

export function joinSession(name, avatarIdx) {
  if (!db) return;
  _name      = name || '参加者';
  _avatarIdx = avatarIdx ?? 0;

  const pRef = ref(db, `rooms/${ROOM_ID}/players`);
  myId  = push(pRef).key;
  myRef = ref(db, `rooms/${ROOM_ID}/players/${myId}`);

  const data = {
    name: _name, avatarIdx: _avatarIdx,
    room: 'lobby', x: 0, z: 8, yaw: 0,
    ts: serverTimestamp(),
  };
  set(myRef, data);
  onDisconnect(myRef).remove();  // ブラウザを閉じたら自動削除
}

export function broadcastMove(x, z, room, yaw) {
  if (!myRef) return;
  const now = Date.now();
  if (now - _lastSend < 80) return;   // 最大 ~12fps に制限
  _lastSend = now;
  set(myRef, {
    name: _name, avatarIdx: _avatarIdx,
    room, x, z, yaw,
    ts: serverTimestamp(),
  });
}
