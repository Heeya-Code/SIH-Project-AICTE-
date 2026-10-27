export type Recent = { id: number; ref: string; title: string };
const key = (uid: number) => `af_recent_${uid}`;
export const getRecent = (uid: number): Recent[] => { try { return JSON.parse(localStorage.getItem(key(uid)) ?? '[]'); } catch { return []; } };
export function trackRecent(uid: number, r: Recent) { try { localStorage.setItem(key(uid), JSON.stringify([r, ...getRecent(uid).filter(x => x.id !== r.id)].slice(0, 6))); } catch { /* storage unavailable */ } }
