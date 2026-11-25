# agent-skills

給 AI coding agent（Claude Code、Codex 等）用的通用 skill。每個資料夾是一個 skill：`SKILL.md` 是說明與步驟，`reference/` 是可直接複製的參考實作。

| Skill | 用途 |
|---|---|
| [stale-version-reload](stale-version-reload/SKILL.md) | Next.js 新版部署後強制使用者重新整理：版本輪詢、處理中不打斷、擋舊頁面寫入、換頁版本錯位保護 |

## 安裝

### Claude Code

個人層級（所有專案都看得到）：

```bash
git clone https://github.com/Eden-Sun/agent-skills.git ~/agent-skills
mkdir -p ~/.claude/skills
ln -s ~/agent-skills/stale-version-reload ~/.claude/skills/stale-version-reload
```

只給某個專案用（隨 repo 一起給團隊）：

```bash
mkdir -p .claude/skills
cp -R ~/agent-skills/stale-version-reload .claude/skills/
```

裝好後在 session 裡說「幫這個專案加上新版強制重新整理」，或直接 `/stale-version-reload`。

### 其他 agent（Codex 等）

放到 `~/.agents/skills/` 或專案的 `.agents/skills/`，或在 `AGENTS.md` 加一行：

```md
- 新版部署後強制重新整理：照 https://github.com/Eden-Sun/agent-skills/blob/main/stale-version-reload/SKILL.md
```

### 不用 agent

`SKILL.md` 本身就是導入文件，照第 4 節步驟做，`reference/` 的檔案直接複製。

## 更新

```bash
git -C ~/agent-skills pull --ff-only
```

用 symlink 安裝的會直接拿到新版；用複製的要重新複製。

## 授權

MIT
