#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给博客配 Cloudflare 命名隧道（本地跑，纯标准库）

用法：
    CF_API_TOKEN=xxx python3 deploy/cf_tunnel.py
    或  read -s -p "Token: " T && CF_API_TOKEN="$T" python3 deploy/cf_tunnel.py

做的事：
  1. 自动查 account_id / zone_id（jxihub.cn）
  2. 创建或复用隧道 personal-blog
  3. 写 ingress：blog.jxihub.cn → http://127.0.0.1:3000
  4. 建/更新 DNS CNAME → <tunnel>.cfargotunnel.com（已代理）
  5. ssh 到沙盒写入 .cftoken 并拉起 cloudflared + 守护
  6. 验证 https://blog.jxihub.cn

环境变量（都有默认值）：
  CF_API_TOKEN  必填，权限：Account→Cloudflare Tunnel:Edit、Zone→DNS:Edit（Account 读也行）
  HOSTNAME      默认 blog.jxihub.cn
  ZONE_NAME     默认 jxihub.cn
  TUNNEL_NAME   默认 personal-blog
  PORT          默认 3000
  SSH_TARGET    默认 sg-sgp12
  REMOTE_DIR    默认 /opt/personal-blog
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ.get("CF_API_TOKEN", "").strip()
HOST = os.environ.get("HOSTNAME", "blog.jxihub.cn").strip().lower()
ZONE_NAME = os.environ.get("ZONE_NAME", "jxihub.cn").strip().lower()
NAME = os.environ.get("TUNNEL_NAME", "personal-blog").strip()
PORT = int(os.environ.get("PORT", "3000"))
SSH_TARGET = os.environ.get("SSH_TARGET", "sg-sgp12")
REMOTE_DIR = os.environ.get("REMOTE_DIR", "/opt/personal-blog")


def die(msg):
    print("\033[31m✗ %s\033[0m" % msg)
    sys.exit(1)


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            j = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode() or "{}"
        try:
            j = json.loads(raw)
        except Exception:
            die("HTTP %s %s → %s" % (e.code, path, raw[:300]))
    except Exception as e:
        die("网络错误 %s %s → %s" % (method, path, e))
    if not j.get("success"):
        errs = j.get("errors") or [{"message": "unknown"}]
        die("API 失败 %s %s → %s" % (method, path, json.dumps(errs, ensure_ascii=False)))
    return j.get("result")


def main():
    if not TOKEN:
        die("缺 CF_API_TOKEN")

    # 1) account / zone
    print("→ 查账户与域名")
    accs = call("GET", "/accounts?per_page=50")
    if not accs:
        die("token 看不到任何账户（权限不足）")
    ACC = accs[0]["id"]
    if len(accs) > 1:
        print("  账户:", ", ".join("%s(%s)" % (a["name"], a["id"]) for a in accs))
    print("  account_id =", ACC)

    zones = call("GET", "/zones?name=%s" % ZONE_NAME)
    if not zones:
        die("token 看不到 zone %s（DNS:Edit 权限或域名不在该账户下）" % ZONE_NAME)
    ZONE = zones[0]["id"]
    print("  zone_id    =", ZONE)

    # 2) 隧道
    print("→ 隧道", NAME)
    ts = call("GET", "/accounts/%s/cfd_tunnel?name=%s&is_deleted=false" % (ACC, NAME))
    if ts:
        tid = ts[0]["id"]
        print("  复用", tid)
    else:
        t = call("POST", "/accounts/%s/cfd_tunnel" % ACC,
                 {"name": NAME, "config_src": "cloudflare"})
        tid = t["id"]
        print("  新建", tid)

    # 3) ingress
    call("PUT", "/accounts/%s/cfd_tunnel/%s/configurations" % (ACC, tid),
         {"config": {"ingress": [
             {"hostname": HOST, "service": "http://127.0.0.1:%d" % PORT},
             {"service": "http_status:404"},
         ]}})
    print("→ ingress: %s → http://127.0.0.1:%d" % (HOST, PORT))

    # 4) DNS
    target = "%s.cfargotunnel.com" % tid
    recs = call("GET", "/zones/%s/dns_records?name=%s" % (ZONE, HOST))
    body = {"type": "CNAME", "name": HOST, "content": target, "proxied": True, "ttl": 1}
    if recs:
        call("PUT", "/zones/%s/dns_records/%s" % (ZONE, recs[0]["id"]), body)
        print("→ DNS 更新 %s → %s" % (HOST, target))
    else:
        call("POST", "/zones/%s/dns_records" % ZONE, body)
        print("→ DNS 创建 %s → %s" % (HOST, target))

    # 5) 隧道 token
    r = call("GET", "/accounts/%s/cfd_tunnel/%s/token" % (ACC, tid))
    tok = r.get("token") if isinstance(r, dict) else r
    if not isinstance(tok, str) or len(tok) < 20:
        die("取隧道 token 失败: %s" % str(r)[:200])
    print("→ 已取得隧道 token（%d 字符）" % len(tok))

    # 6) 推到沙盒并常驻
    print("→ 写入沙盒并启动 cloudflared")
    remote = r"""
set -u
cd '%(dir)s' || exit 1
umask 077
cat > .cftoken <<'EOF'
%(tok)s
EOF
chmod 600 .cftoken
pkill -f 'cloudflared tunnel' 2>/dev/null
sleep 2
cat > deploy/tunnel-keepalive.sh <<'EOF'
#!/bin/bash
# cloudflared 守护：挂了 10 秒内重拉（沙盒无 systemd）
APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$APP_DIR/.tunnel-keepalive.pid" ] && kill -0 "$(cat "$APP_DIR/.tunnel-keepalive.pid")" 2>/dev/null && exit 0
echo $$ > "$APP_DIR/.tunnel-keepalive.pid"
while true; do
  if [ -s "$APP_DIR/.cftoken" ] && ! pgrep -f '[c]loudflared tunnel' >/dev/null 2>&1; then
    setsid nohup /usr/local/bin/cloudflared tunnel --no-autoupdate run \
      --token "$(cat "$APP_DIR/.cftoken")" >> /tmp/cf_named.log 2>&1 < /dev/null &
    echo "[tunnel-keepalive $(date '+%%F %%T')] 拉起 cloudflared" >> /tmp/cf_named.log
  fi
  sleep 10
done
EOF
chmod +x deploy/tunnel-keepalive.sh
setsid nohup bash deploy/tunnel-keepalive.sh >/dev/null 2>&1 < /dev/null &
sleep 14
pgrep -f '[c]loudflared tunnel' >/dev/null && echo "  cloudflared 运行中" || { echo "  ✗ cloudflared 未起来"; tail -20 /tmp/cf_named.log; }
""" % {"dir": REMOTE_DIR, "tok": tok}

    p = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
                        SSH_TARGET, remote], capture_output=True, text=True)
    print(p.stdout.strip() or p.stderr.strip())
    if p.returncode != 0:
        die("远程启动失败（rc=%d）" % p.returncode)

    # 7) 验证
    print("→ 等待 DNS 生效并自检 …")
    for i in range(1, 13):
        time.sleep(5)
        c = subprocess.run(["curl", "-s", "-m", "10", "-o", "/dev/null",
                            "-w", "%{http_code}", "https://%s/" % HOST],
                           capture_output=True, text=True).stdout.strip()
        print("  [%2ds] https://%s/ = %s" % (i * 5, HOST, c))
        if c == "200":
            print("\033[32m✅ 完成：https://%s/\033[0m" % HOST)
            return
    die("域名还没通，通常是 DNS 传播中，等 1 分钟再访问 https://%s/" % HOST)


if __name__ == "__main__":
    main()
