import { BUILTIN_TRICKS } from './builtins.js';
import {
  collection, doc, setDoc, deleteDoc, getDoc, onSnapshot,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

function getDb() {
  return window.__firestoreDb || null;
}

export function isConfigured() {
  return !!getDb();
}

function cleanBuiltin(t, i) {
  return {
    name: t.name,
    opening: t.opening,
    side: t.side,
    difficulty: t.difficulty,
    tags: t.tags || [],
    description: t.description || '',
    moves: t.moves.map(m => ({ move: m.move, san: m.san, comment: m.comment || '' })),
    isCustom: false,
    createdAt: i,
    updatedAt: serverTimestamp()
  };
}

/**
 * Subscribe to live updates from Firestore.
 * Returns true if connected, false otherwise.
 * handlers: { onData(list), onError(err) }
 */
export async function connectFirestore(handlers) {
  const db = getDb();
  if (!db) return false;
  try {
    const q = query(collection(db, 'tricks'), orderBy('createdAt', 'asc'));
    const metaRef = doc(db, '_meta', 'initialized');

    onSnapshot(q, snap => {
      if (snap.empty) {
        // First-ever run: seed the shared database with the built-in tricks.
        getDoc(metaRef)
          .then(meta => {
            if (!meta.exists()) {
              const writes = BUILTIN_TRICKS.map((t, i) =>
                setDoc(doc(db, 'tricks', t.id), cleanBuiltin(t, i)));
              writes.push(setDoc(metaRef, { done: true }));
              return Promise.all(writes);
            }
          })
          .catch(err => handlers.onError && handlers.onError(err));
        return;
      }
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      handlers.onData && handlers.onData(list);
    }, err => handlers.onError && handlers.onError(err));

    return true;
  } catch (e) {
    if (handlers.onError) handlers.onError(e);
    return false;
  }
}

export async function saveTrickToCloud(trick) {
  const db = getDb();
  if (!db) return;
  const { id, ...data } = trick;
  await setDoc(doc(db, 'tricks', id), data, { merge: true });
}

export async function deleteTrickFromCloud(id) {
  const db = getDb();
  if (!db) return;
  await deleteDoc(doc(db, 'tricks', id));
}