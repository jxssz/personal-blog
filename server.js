// 极简个人博客入口：路由 + 后台管理
const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const marked = require('marked');
const multer = require('multer');
const fs = require('fs');
const db = require('./db');
const SqliteStore = require('./session-store');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
// session 密钥固化到数据库：重启服务后旧登录态依然有效
let sessionSecret = getSetting('session_secret');
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(16).toString('hex');
  setSetting('session_secret', sessionSecret);
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new SqliteStore(),
  cookie: { maxAge: 7 * 24 * 3600 * 1000 }
}));

// ---------- 上传（图片 / 视频） ----------
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const ALLOWED = /\.(jpe?g|png|gif|webp|avif|svg|bmp|mp4|webm|ogg|ogv|mov|m4v)$/i;
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function (req, file, cb) {
      cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname).toLowerCase());
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 },  // 单文件最大 200MB
  fileFilter: function (req, file, cb) {
    if (ALLOWED.test(file.originalname)) return cb(null, true);
    cb(new Error('仅支持图片（jpg/png/gif/webp/avif/svg）和视频（mp4/webm/ogg/mov）'));
  }
});

app.post('/admin/upload', checkLogin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' });
  const isVideo = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(req.file.filename);
  res.json({ url: '/uploads/' + req.file.filename, type: isVideo ? 'video' : 'image' });
});

// 上传错误友好提示（类型不符 / 超过大小限制）
app.use((err, req, res, next) => {
  if (req.path === '/admin/upload' && err) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? '文件超过 200MB 限制' : (err.message || '上传失败');
    return res.status(400).json({ error: msg });
  }
  next(err);
});

// ---------- 工具函数 ----------

const renderMarkdown = (md) => {
  let html = marked.parse(md || '', { breaks: true });

  // 视频：![视频](x.mp4) 或 [视频](x.mp4) → Plyr 播放器
  html = html.replace(/<img src="([^"]*\.(?:mp4|webm|ogg|ogv|mov|m4v)[^"]*)"[^>]*>/gi,
    '<video class="plyr-video" controls preload="metadata" playsinline src="$1"></video>');
  html = html.replace(/<a href="([^"]*\.(?:mp4|webm|ogg|ogv|mov|m4v)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    '<video class="plyr-video" controls preload="metadata" playsinline src="$1"></video>');

  // 图片 → PhotoSwipe 灯箱
  html = html.replace(/<img src="([^"]+)"([^>]*)>/gi, function (img, src, attrs) {
    var alt = /alt="([^"]*)"/i.exec(attrs);
    return '<a class="pswp-item" href="' + src + '" data-pswp-width="1600" data-pswp-height="1200"><img src="' + src + '" alt="' + (alt ? esc(alt[1]) : '') + '" loading="lazy"></a>';
  });

  // :::gallery 块 → Swiper 轮播（只在文章内，不是单独相册页）
  html = html.replace(/<p>:::gallery<\/p>\s*([\s\S]*?)\s*<p>:::<\/p>/gi, function (whole, inner) {
    var slides = [];
    inner.replace(/<a class="pswp-item"[^>]*><img src="([^"]+)" alt="([^"]*)"[^>]*><\/a>/gi, function (match, src, alt) {
      slides.push('<div class="swiper-slide"><a class="pswp-item" href="' + src + '" data-pswp-width="1600" data-pswp-height="1200"><img src="' + src + '" alt="' + alt + '" loading="lazy"></a></div>');
      return match;
    });
    if (!slides.length) return whole;
    return '<div class="swiper gallery-swiper"><div class="swiper-wrapper">' + slides.join('') + '</div><div class="swiper-pagination"></div><div class="swiper-button-prev"></div><div class="swiper-button-next"></div></div>';
  });

  return html;
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
app.locals.esc = esc;

function getSetting(key, def) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : def;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function checkLogin(req, res, next) {
  if (req.session && req.session.admin) {
    res.locals.adminNav = true; // 后台导航仅在登录后显示
    return next();
  }
  res.redirect('/admin/login');
}

function formatDate(d) {
  return (d || '').slice(0, 10);
}

// Hero 特效白名单
function validEffect(value) {
  var allowed = ['none', 'particles', 'waves', 'net', 'globe', 'three', 'lottie'];
  return allowed.indexOf(value) !== -1 ? value : 'particles';
}

// 解析标签输入：按逗号/顿号/空格拆分，去重、去空
function parseTags(str) {
  const seen = {};
  return String(str || '').split(/[,，、;；\s]+/)
    .map(function (t) { return t.trim().slice(0, 30); })
    .filter(function (t) { return t && !seen[t] && (seen[t] = true); })
    .slice(0, 10)
    .join(',');
}

// 统计已发布文章的标签（按出现次数降序）
function allTags() {
  const count = {};
  db.prepare('SELECT tags FROM posts WHERE published = 1').all().forEach(function (row) {
    (row.tags || '').split(',').forEach(function (t) {
      if (t) count[t] = (count[t] || 0) + 1;
    });
  });
  return Object.keys(count).map(function (name) {
    return { name: name, count: count[name] };
  }).sort(function (a, b) { return b.count - a.count; });
}

// 首次运行：初始化管理员账号（默认 admin / admin123，登录后请立即修改）
if (!getSetting('password_salt')) {
  const salt = crypto.randomBytes(8).toString('hex');
  setSetting('password_salt', salt);
  setSetting('password_hash', hashPassword('admin123', salt));
  console.log('[初始化] 后台默认账号：admin / admin123，请登录后尽快在后台修改密码');
}

// ---------- 前台路由 ----------

// 文章清单
app.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = 10;
  const total = db.prepare('SELECT COUNT(*) AS c FROM posts WHERE published = 1').get().c;
  const posts = db.prepare(
    'SELECT id, title, summary, tags, created_at FROM posts WHERE published = 1 ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'
  ).all(size, (page - 1) * size);
  res.render('index', {
    posts,
    page,
    totalPages: Math.max(1, Math.ceil(total / size)),
    tagList: allTags(),
    tagName: null,
    nav: 'home'
  });
});

// 标签筛选
app.get('/tag/:name', (req, res) => {
  const tagName = String(req.params.name || '').slice(0, 30);
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = 10;
  const like = '%,' + tagName + ',%';
  const total = db.prepare(
    "SELECT COUNT(*) AS c FROM posts WHERE published = 1 AND (',' || tags || ',') LIKE ?"
  ).get(like).c;
  const posts = db.prepare(
    "SELECT id, title, summary, tags, created_at FROM posts WHERE published = 1 AND (',' || tags || ',') LIKE ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
  ).all(like, size, (page - 1) * size);
  res.render('index', {
    posts,
    page,
    totalPages: Math.max(1, Math.ceil(total / size)),
    tagList: allTags(),
    tagName,
    nav: 'posts'
  });
});

// 文章列表（Lambda /posts，与首页同一列表，不跳转）
app.get('/posts', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = 10;
  const total = db.prepare('SELECT COUNT(*) AS c FROM posts WHERE published = 1').get().c;
  const posts = db.prepare(
    'SELECT id, title, summary, tags, created_at FROM posts WHERE published = 1 ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'
  ).all(size, (page - 1) * size);
  res.render('index', {
    posts,
    page,
    totalPages: Math.max(1, Math.ceil(total / size)),
    tagList: allTags(),
    tagName: null,
    nav: 'posts'
  });
});

// 标签列表（Lambda /tags）
app.get('/tags', (req, res) => {
  res.render('tags', { tagList: allTags(), nav: 'tags' });
});

// RSS（Lambda 用 /index.xml，保留 /rss 兼容）
app.get(['/rss', '/index.xml'], (req, res) => {
  const base = req.protocol + '://' + req.get('host');
  const posts = db.prepare('SELECT id, title, summary, created_at FROM posts WHERE published = 1 ORDER BY created_at DESC LIMIT 20').all();
  const items = posts.map(p => `<item><title>${esc(p.title)}</title><link>${base}/post/${p.id}</link><description>${esc(p.summary || '')}</description><pubDate>${new Date(p.created_at).toUTCString()}</pubDate></item>`).join('');
  res.type('application/rss+xml').send(`<?xml version="1.0"?><rss version="2.0"><channel><title>我的博客</title><link>${base}/</link><description>个人博客</description>${items}</channel></rss>`);
});

// 关于页
app.get('/about', (req, res) => {
  res.render('about', { about: getSetting('about', '这里可以写一段关于你的介绍。可在后台"设置"中修改。') });
});

// 文章详情 + 留言
app.get('/post/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND published = 1').get(req.params.id);
  if (!post) return res.status(404).send('文章不存在');
  const comments = db.prepare(
    'SELECT id, name, content, created_at FROM comments WHERE post_id = ? AND approved = 1 ORDER BY created_at DESC'
  ).all(post.id);
  res.render('post', {
    post: { ...post, html: renderMarkdown(post.content) },
    comments: comments.map(c => ({ ...c, date: formatDate(c.created_at) })),
    latestPosts: db.prepare('SELECT id, title FROM posts WHERE published = 1 ORDER BY created_at DESC, id DESC LIMIT 5').all(),
    nav: 'posts',
    formatDate
  });
});

// 提交留言（需后台审核后才展示）
app.post('/post/:id/comment', (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND published = 1').get(req.params.id);
  if (!post) return res.status(404).send('文章不存在');
  const name = (req.body.name || '').trim().slice(0, 50) || '匿名';
  const content = (req.body.content || '').trim().slice(0, 1000);
  if (!content) return res.status(400).send('留言内容不能为空');
  db.prepare('INSERT INTO comments (post_id, name, content) VALUES (?, ?, ?)').run(post.id, name, content);
  res.redirect('/post/' + post.id + '#comments');
});

// ---------- 后台路由 ----------

// 后台公共数据：当前路径 + 待审核留言数（导航栏使用）
app.use('/admin', (req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.pendingCount = db.prepare('SELECT COUNT(*) AS c FROM comments WHERE approved = 0').get().c;
  next();
});

app.get('/admin/login', (req, res) => {
  res.render('admin/login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const salt = getSetting('password_salt', '');
  const hash = hashPassword(req.body.password || '', salt);
  if (req.body.username === 'admin' && hash === getSetting('password_hash', '')) {
    req.session.admin = true;
    return res.redirect('/admin');
  }
  res.render('admin/login', { error: '用户名或密码错误' });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// 后台首页：全部文章列表
app.get('/admin', checkLogin, (req, res) => {
  const posts = db.prepare('SELECT id, title, tags, published, created_at FROM posts ORDER BY created_at DESC, id DESC').all();
  const pending = db.prepare('SELECT COUNT(*) AS c FROM comments WHERE approved = 0').get().c;
  res.render('admin/posts', { posts, pending, formatDate });
});

// 新建文章
app.get('/admin/post/new', checkLogin, (req, res) => {
  res.render('admin/edit', { post: null });
});

app.post('/admin/post/new', checkLogin, (req, res) => {
  const title = (req.body.title || '').trim().slice(0, 200);
  if (!title) return res.status(400).send('标题不能为空');
  db.prepare(
    'INSERT INTO posts (title, content, summary, published, tags, cover, hero_effect, hero_lottie) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(title, req.body.content || '', (req.body.summary || '').trim().slice(0, 300), req.body.published === '1' ? 1 : 0,
    parseTags(req.body.tags), req.body.cover || '', validEffect(req.body.hero_effect), req.body.hero_lottie || '');
  res.redirect('/admin');
});

// 编辑文章
app.get('/admin/post/:id/edit', checkLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).send('文章不存在');
  res.render('admin/edit', { post });
});

app.post('/admin/post/:id/edit', checkLogin, (req, res) => {
  const title = (req.body.title || '').trim().slice(0, 200);
  if (!title) return res.status(400).send('标题不能为空');
  db.prepare(
    "UPDATE posts SET title = ?, content = ?, summary = ?, published = ?, tags = ?, cover = ?, hero_effect = ?, hero_lottie = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
  ).run(title, req.body.content || '', (req.body.summary || '').trim().slice(0, 300), req.body.published === '1' ? 1 : 0,
    parseTags(req.body.tags), req.body.cover || '', validEffect(req.body.hero_effect), req.body.hero_lottie || '', req.params.id);
  res.redirect('/admin');
});

// 删除文章（连同其留言）
app.post('/admin/post/:id/delete', checkLogin, (req, res) => {
  db.prepare('DELETE FROM comments WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

// 留言管理
app.get('/admin/comments', checkLogin, (req, res) => {
  const comments = db.prepare(
    'SELECT c.*, p.title AS post_title FROM comments c LEFT JOIN posts p ON p.id = c.post_id ORDER BY c.approved ASC, c.created_at DESC'
  ).all();
  res.render('admin/comments', { comments, formatDate });
});

// 审核通过 / 取消通过
app.post('/admin/comment/:id/approve', checkLogin, (req, res) => {
  const c = db.prepare('SELECT approved FROM comments WHERE id = ?').get(req.params.id);
  if (c) db.prepare('UPDATE comments SET approved = ? WHERE id = ?').run(c.approved ? 0 : 1, req.params.id);
  res.redirect('/admin/comments');
});

app.post('/admin/comment/:id/delete', checkLogin, (req, res) => {
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.redirect('/admin/comments');
});

// 设置：修改密码 / 关于页内容
app.get('/admin/settings', checkLogin, (req, res) => {
  res.render('admin/settings', { about: getSetting('about', ''), places: getSetting('places', ''), saved: req.query.saved === '1', error: null });
});

app.post('/admin/settings', checkLogin, (req, res) => {
  setSetting('about', req.body.about || '');
  const pwd = (req.body.new_password || '').trim();
  if (pwd) {
    const oldHash = hashPassword(req.body.old_password || '', getSetting('password_salt', ''));
    if (oldHash !== getSetting('password_hash', '')) {
      return res.render('admin/settings', { about: req.body.about || '', places: req.body.places || '', saved: false, error: '原密码错误，其他设置已保存' });
    }
    setSetting('password_hash', hashPassword(pwd, getSetting('password_salt', '')));
  }
  res.redirect('/admin/settings?saved=1');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`个人博客已启动：http://localhost:${PORT}（后台：http://localhost:${PORT}/admin）`);
});
