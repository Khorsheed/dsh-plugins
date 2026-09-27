#!/bin/sh
# 3080（prod `web` profile）的 agent preset 名册同步：git 正本 → $DSH_HOME/.agent-presets。
#
# 名册是无版本控制的部署资产，dsh-agent-presets 每次 list 都重读它（无缓存），
# 所以漂移（本地补挂、pack 更新后的 staleness）无声无息——2026-09-17 的 dev
# preset 本地补挂三行就是这么来的。本脚本把 3080 名册里 prod 拥有的 preset
# 与 git 正本对齐：
#
#   dsh-writing  正本 = profiles/web/presets/dsh-writing/（3080 写作部署私有，
#                本仓是它的唯一家；preset.yml 展示层也在正本里）
#   dsh-eval     组合正本 = profiles/web-eval/presets/eval/agent.cordis.yml
#                （web-eval pack 的 eval preset 是唯一事实源；preset.yml 展示层
#                归部署本地——3080 有自己的多模式排序，缺失时才补一份默认）
#
# dev 不在此列：它归 dev pack 的 install.sh/update.sh 管（会整体覆盖）。
# 覆盖前备份到 $PRESET_ROOT/.backup-<epoch>/；幂等，重复跑无副作用。
set -eu

DSH_HOME="${DSH_HOME:-$HOME/.dsh-official}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$SRC/.." && pwd)"
PRESET_ROOT="$DSH_HOME/.agent-presets"
BACKUP="$PRESET_ROOT/.backup-$(date +%s)"

copy_into() { # $1=源目录或文件(单文件时 $3 是文件名) $2=目标目录 $3=可选文件名
  src="$1"; dest="$2"; file="${3:-}"
  mkdir -p "$dest"
  if [ -n "$file" ]; then
    if [ -f "$dest/$file" ] && cmp -s "$src" "$dest/$file"; then
      echo "sync-presets: $dest/$file already in sync"
      return
    fi
    mkdir -p "$BACKUP/$(basename "$dest")"
    [ -e "$dest/$file" ] && cp "$dest/$file" "$BACKUP/$(basename "$dest")/$file"
    cp "$src" "$dest/$file"
    echo "sync-presets: updated $dest/$file (backup in $BACKUP/$(basename "$dest"))"
  else
    if [ -d "$dest" ] && diff -qr "$src" "$dest" >/dev/null 2>&1; then
      echo "sync-presets: $dest already in sync"
      return
    fi
    [ -d "$dest" ] && { mkdir -p "$BACKUP"; cp -R "$dest" "$BACKUP/"; }
    rm -rf "$dest"
    cp -R "$src" "$dest"
    echo "sync-presets: replaced $dest (backup in $BACKUP)"
  fi
}

# dsh-writing：整目录以本仓为正本。
copy_into "$SRC/presets/dsh-writing" "$PRESET_ROOT/dsh-writing"

# dsh-eval：组合文件跟随 web-eval 配方；preset.yml 缺失才补默认。
copy_into "$REPO/web-eval/presets/eval/agent.cordis.yml" "$PRESET_ROOT/dsh-eval" "agent.cordis.yml"
if [ ! -f "$PRESET_ROOT/dsh-eval/preset.yml" ]; then
  cat > "$PRESET_ROOT/dsh-eval/preset.yml" <<'EOF'
name: 评测模式
description: 评测场景的规划与分析 Agent：读题库、起草 plan 与 condition、读 bundle 写分析初稿；不挂 Bash，不挂容器控制。（组合文件跟随 web-eval pack 的 eval preset；此展示层归部署本地）
order: 20
EOF
  echo "sync-presets: wrote default $PRESET_ROOT/dsh-eval/preset.yml"
fi

echo "sync-presets: done — roster $PRESET_ROOT (re-read on every list; no restart needed)"
