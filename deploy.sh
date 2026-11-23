#!/usr/bin/env bash
# 部署个人博客到远程服务器沙盒
# 用法:
#   ./deploy.sh                     # 使用下方默认连接信息部署
#   ./deploy.sh --package-only      # 只打包，打印产物路径（不连服务器，用于自检）
#   SSH_HOST=x SSH_PORT=27005 SSH_USER=root REMOTE_DIR=/opt/personal-blog APP_PORT=3000 ./deploy.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH_HOST="${SSH_HOST:-sg-sgp12.tryaltare.ai}"
SSH_PORT="${SSH_PORT:-27005}"
SSH_USER="${SSH_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/personal-blog}"
APP_PORT="${APP_PORT:-3000}"
PACKAGE_ONLY="${1:-}"

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy] 失败:\033[0m %s\n' "$*" >&2; exit 1; }

# 1) 把 WAL 里的数据合并进主库，保证上传的数据库是完整一致的
log "检查点 SQLite（合并 WAL）……"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$PROJECT_DIR/data/blog.db" "PRAGMA wal_checkpoint(TRUNCATE);" || die "SQLite checkpoint 失败"
else
  log "警告：本机没有 sqlite3，将连 blog.db / -wal / -shm 一起打包"
fi

# 2) 打包源码（排除开发残留、依赖、日志；数据库单独处理）
TMP_DIR="$(mktemp -d)"
PKG="$TMP_DIR/personal-blog.tar.gz"
trap 'rm -rf "$TMP_DIR"' EXIT

log "打包源码 → $PKG"
tar -czf "$PKG" \
  --exclude='.DS_Store' \
  --exclude='node_modules' \
  --exclude='server.log' \
  --exclude='deploy.sh' \
  -C "$PROJECT_DIR" .

if ! command -v sqlite3 >/dev/null 2>&1; then
  # 无 sqlite3 时把 WAL/shm 一起带上，交给服务器上的 better-sqlite3 回放
  tar -czf "$PKG" -C "$PROJECT_DIR" data/blog.db-wal data/blog.db-shm 2>/dev/null || true
fi

if [ "$PACKAGE_ONLY" = "--package-only" ]; then
  KEEP_DIR="$(mktemp -d)"
  KEEP="$KEEP_DIR/personal-blog.tar.gz"
  cp "$PKG" "$KEEP"
  log "仅打包模式完成。产物：$KEEP"
  tar -tzf "$KEEP" | sed 's/^/  /'
  exit 0
fi

# 3) 连通性预检（失败快速报错，不浪费时间上传）
log "检测 SSH 连通性 ($SSH_USER@$SSH_HOST:$SSH_PORT)…"
SSH="ssh -p $SSH_PORT -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 $SSH_USER@$SSH_HOST"
$SSH 'echo OK' >/dev/null 2>&1 || die "无法连接 $SSH_HOST:$SSH_PORT，请检查沙盒网络 / sshd / 端口"

# 4) 上传并解压
log "上传代码包……"
scp -P "$SSH_PORT" -o StrictHostKeyChecking=accept-new "$PKG" "$SSH_USER@$SSH_HOST:/tmp/personal-blog.tar.gz" \
  || die "上传失败"

log "部署到远端 $REMOTE_DIR ……"
$SSH "export REMOTE_DIR='$REMOTE_DIR' APP_PORT='$APP_PORT'; bash -s" <<'REMOTE'
set -euo pipefail
mkdir -p "$REMOTE_DIR"
tar -xzf /tmp/personal-blog.tar.gz -C "$REMOTE_DIR"
rm -f /tmp/personal-blog.tar.gz
cd "$REMOTE_DIR"

echo "[remote] 检查 Node 环境……"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[remote] 未找到 Node，尝试安装（Debian/Ubuntu）……"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq nodejs npm
fi
node -v && npm -v

echo "[remote] 安装依赖……"
if ! npm ci --omit=dev 2>/dev/null; then
  echo "[remote] npm ci 失败（可能是原生模块编译缺工具链），安装编译工具后重试……"
  apt-get update -qq
  apt-get install -y -qq build-essential python3
  npm ci --omit=dev
fi

echo "[remote] 启动服务（端口 ${APP_PORT:-3000}）……"
if command -v pm2 >/dev/null 2>&1; then
  PORT="$APP_PORT" pm2 restart personal-blog --update-env 2>/dev/null \
    || PORT="$APP_PORT" pm2 start server.js --name personal-blog
elif [ -d /run/systemd/system ]; then
  cat > /etc/systemd/system/personal-blog.service <<EOF
[Unit]
Description=Personal Blog
After=network.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
Environment=PORT=$APP_PORT
ExecStart=$(command -v node) $REMOTE_DIR/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now personal-blog
else
  pkill -f 'node.*server.js' 2>/dev/null || true
  PORT="$APP_PORT" nohup node server.js > server.log 2>&1 &
fi
REMOTE

# 5) 健康检查
log "健康检查……"
$SSH "for i in 1 2 3 4 5; do curl -fsS http://127.0.0.1:$APP_PORT/ >/dev/null 2>&1 && echo UP && exit 0; sleep 1; done; echo DOWN; exit 1" \
  || die "服务未能在远端 $APP_PORT 端口启动，请登录服务器查看日志"

log "✅ 部署完成！"
log "访问：http://$SSH_HOST:$APP_PORT/"
log "后台：http://$SSH_HOST:$APP_PORT/admin （默认 admin / admin123，请尽快修改密码）"
