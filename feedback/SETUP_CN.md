# BigaCli 反馈服务

Worker: https://bigacli-feedback.moukeikenn.workers.dev

1. D1 → bigacli-feedback-db → Console：粘贴 schema.sql 全文并执行（不删除已有数据）。
2. Workers & Pages → bigacli-feedback → Edit code：以 worker.mjs 全文替换默认代码，点击 Deploy。
3. 确认生产版本的 D1 绑定名称是 DB，指向 bigacli-feedback-db，最新部署流量为 100%。

查看反馈：登录 Cloudflare，进入 D1 → bigacli-feedback-db → Studio（或 Tables），打开 feedback 表。也可在 Console 执行：

```sql
SELECT created_at, content FROM feedback ORDER BY created_at DESC;
```

时间为 UTC，日本时间加 9 小时。反馈表不通过 Worker 对外提供读取接口；只有获得 Cloudflare 账号权限的人可以查看。

仅提交用户填写的文字，不自动上传对话、附件、账号或日志。单条最多 10000 字符，同一 IP 每小时最多 20 次，数据库只保存每日变化的 IP 哈希，不保存原始 IP。提交失败保留输入，重试相同内容使用相同请求 ID 避免重复。

本地检查：使用 Node.js 24 执行 `node feedback/check.mjs`。该检查只使用内存数据库，不向线上写入。
