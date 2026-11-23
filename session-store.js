// 基于 SQLite 的 express-session 存储：登录态持久化，重启服务不掉线
const db = require('./db');
const Store = require('express-session').Store;

// 会话表（放 db.js 里会导致循环依赖初始化顺序问题，这里直接建）
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
`);

function SqliteStore() {
  Store.call(this);
  // 启动时清理已过期的会话
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
}
SqliteStore.prototype = Object.create(Store.prototype);
SqliteStore.prototype.constructor = SqliteStore;

SqliteStore.prototype.get = function (sid, callback) {
  try {
    const row = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?').get(sid);
    if (!row) return callback();
    if (row.expires < Date.now()) {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      return callback();
    }
    callback(null, JSON.parse(row.sess));
  } catch (err) {
    callback(err);
  }
};

SqliteStore.prototype.set = function (sid, sess, callback) {
  try {
    const maxAge = (sess.cookie && sess.cookie.maxAge) || 24 * 3600 * 1000;
    db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expires) VALUES (?, ?, ?)')
      .run(sid, JSON.stringify(sess), Date.now() + maxAge);
    // 顺带清理过期会话
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    callback();
  } catch (err) {
    callback(err);
  }
};

SqliteStore.prototype.destroy = function (sid, callback) {
  try {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    callback();
  } catch (err) {
    callback(err);
  }
};

SqliteStore.prototype.touch = function (sid, sess, callback) {
  try {
    const maxAge = (sess.cookie && sess.cookie.maxAge) || 24 * 3600 * 1000;
    db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(Date.now() + maxAge, sid);
    callback();
  } catch (err) {
    callback(err);
  }
};

module.exports = SqliteStore;
