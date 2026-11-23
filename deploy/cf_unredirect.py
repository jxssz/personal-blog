#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""排查并清理把 blog.jxihub.cn 重定向到别处的 Cloudflare 规则

用法：
    CF_API_TOKEN=xxx python3 deploy/cf_unredirect.py
    或  printf 'Token: '; read -s T; echo; CF_API_TOKEN="$T" python3 deploy/cf_unredirect.py

会依次检查并（对命中 HOST 的条目）删除：
  1. Redirect Rules（rulesets: http_request_dynamic_redirect / http_request_redirect）
  2. Page Rules（legacy）
  3. Bulk Redirects（account 级）
只读模式：加 --dry 只打印不删除。

需要的 token 权限：Zone → Config Rules:Edit（Redirect Rules）、Zone → Page Rules:Edit、
Account → Bulk Redirects:Edit —— 少哪个，那一步会跳过并提示。
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ.get("CF_API_TOKEN", "").strip()
HOST = os.environ.get("HOSTNAME", "blog.jxihub.cn").strip().lower()
ZONE_NAME = os.environ.get("ZONE_NAME", "jxihub.cn").strip().lower()
DRY = "--dry" in sys.argv

REDIRECT_PHASES = ("http_request_dynamic_redirect", "http_request_redirect")


def call(method, path, body=None, soft=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            j = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode() or "{}"
        if soft:
            return None
        print("  ✗ HTTP %s %s → %s" % (e.code, path, raw[:260]))
        return None
    except Exception as e:
        if soft:
            return None
        print("  ✗ 网络错误 %s → %s" % (path, e))
        return None
    if not j.get("success"):
        if not soft:
            print("  ✗ API 失败 %s → %s" % (path, json.dumps(j.get("errors"), ensure_ascii=False)[:260]))
        return None
    return j.get("result")


def main():
    if not TOKEN:
        sys.exit("✗ 缺 CF_API_TOKEN")
    accs = call("GET", "/accounts?per_page=50")
    ACC = accs[0]["id"] if accs else None
    zones = call("GET", "/zones?name=%s" % ZONE_NAME)
    if not zones:
        sys.exit("✗ 找不到 zone %s" % ZONE_NAME)
    ZONE = zones[0]["id"]
    print("account=%s zone=%s host=%s  dry=%s\n" % (ACC, ZONE, HOST, DRY))

    hit = 0

    # ---------- 1) Redirect Rules ----------
    print("[1] Redirect Rules")
    sets = call("GET", "/zones/%s/rulesets" % ZONE, soft=True)
    if sets is None:
        print("  跳过（无权限或接口不可用）")
    else:
        for rs in sets:
            if rs.get("phase") not in REDIRECT_PHASES:
                continue
            det = call("GET", "/zones/%s/rulesets/%s" % (ZONE, rs["id"]), soft=True)
            if not det:
                continue
            rules = det.get("rules") or []
            changed = False
            new_rules = []
            print("  %s (%s) 规则数=%d" % (rs.get("name"), rs.get("phase"), len(rules)))
            for r in rules:
                expr = r.get("expression") or ""
                blob = json.dumps(r, ensure_ascii=False)
                # 目标都是跳到 stock.jxihub.cn 的全盘重定向（含单域名写法），整条删掉
                if HOST in expr or ("stock.jxihub.cn" in blob and "redirect" in r.get("action", "")) \
                        or re.search(r'http\.host\s+ne\s+"[^"]+"', expr):
                    print("  ✗ 删除重定向规则：%s" % expr[:200])
                    ap = json.dumps(r.get("action_parameters") or {}, ensure_ascii=False)
                    print("    目标：%s" % ap[:160])
                    changed = True
                    hit += 1
                    continue
                new_rules.append(r)
            if changed:
                if DRY:
                    print("    （dry 模式，未实际写入）")
                elif new_rules:
                    call("PUT", "/zones/%s/rulesets/%s" % (ZONE, rs["id"]),
                         {"rules": new_rules, "name": det.get("name"), "kind": det.get("kind")})
                    print("    → 规则集已更新（剩余 %d 条）" % len(new_rules))
                else:
                    call("DELETE", "/zones/%s/rulesets/%s" % (ZONE, rs["id"]))
                    print("    → 规则已空，删除整个 ruleset")

    # ---------- 1b) Workers 路由 ----------
    print("[1b] Workers 路由（可能由 Worker 做 301）")
    wr = call("GET", "/zones/%s/workers/routes" % ZONE, soft=True)
    if wr is None:
        print("  跳过（无权限或接口不可用）")
    elif not wr:
        print("  无路由")
    else:
        for r in wr:
            print("  - %s → %s" % (r.get("pattern"), r.get("script")))

    # ---------- 2) Page Rules ----------
    print("[2] Page Rules")
    prs = call("GET", "/zones/%s/pagerules" % ZONE, soft=True)
    if prs is None:
        print("  跳过（无权限或接口不可用）")
    else:
        for pr in prs:
            blob = json.dumps(pr, ensure_ascii=False)
            if HOST in blob:
                print("  - %s → %s" % (pr.get("targets"), pr.get("actions")))
                if not DRY:
                    call("DELETE", "/zones/%s/pagerules/%s" % (ZONE, pr["id"]))
                    print("    → 已删除")
                hit += 1
        if not any(HOST in json.dumps(p, ensure_ascii=False) for p in prs):
            print("  无命中")

    # ---------- 3) Bulk Redirects ----------
    if ACC:
        print("[3] Bulk Redirects (account)")
        brs = call("GET", "/accounts/%s/bulk_redirects" % ACC, soft=True)
        if brs is None:
            print("  跳过（无权限或接口不可用）")
        else:
            for br in brs:
                print("  - %s (id=%s)" % (br.get("name"), br.get("id")))
            print("  提示：Bulk Redirect 的条目是列表级，需在面板点开同名 list 删除 blog 那条")

    print("\n命中并处理：%d 条" % hit)

    # ---------- 4) 验证 ----------
    print("[4] 验证 https://%s/" % HOST)
    for i in range(1, 7):
        p = subprocess.run(["curl", "-sS", "-m", "12", "-o", "/dev/null",
                            "-w", "%{http_code} %{redirect_url}", "https://%s/" % HOST],
                           capture_output=True, text=True)
        print("  [%ds] %s" % (i * 5, p.stdout.strip()))
        if p.stdout.startswith("200"):
            print("\n✅ 正常了：https://%s/" % HOST)
            return
        if i < 6:
            import time
            time.sleep(5)
    print("\n仍不是 200。若上面三步都「无命中/跳过」，说明重定向在别处")
    print("（比如 Cloudflare Worker、或者 stock 隧道 ingress 的 catch-all），把这段输出发我。")


if __name__ == "__main__":
    main()
