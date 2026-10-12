# `.agents/notes` 规则

本目录记录设计与实现取舍的原因；系统当前行为写入 `docs/`。

## 不变量

- 状态由目录位置决定：`proposed/` 待评审、`implemented/` 已落地、`rejected/` 已否决、`archived/` 被取代。
- 文件名为 `YYYY-MM-DD-<kebab-slug>.md`，日期取决定日期。
- 禁止创建 `INDEX.md`、`README.md` 或其他要求每篇笔记都更新的总索引。
- `implemented/` 笔记只记录已发生的事实，并随其对应实现更新。
- `archived/` 永久冻结；被取代的已发生决定不得删除或改写结论。
- 实现代码与笔记同批提交；受决定约束的代码入口用一行注释回指笔记。
- 四格写法、非平凡判定与验收清单见 `decision-notes` 技能；本文件不复制写作方法。
