# 数据同步工作流（服务器 -> 本地）

目标：每次本地开发前，把服务器上的最新数据库拉到本地，确保测试数据一致。

## 1. 一键拉取命令

在本地项目根目录执行：

```bash
REMOTE_HOST=14.103.37.105 REMOTE_USER=ubuntu ./scripts/pull_prod_db.sh
```

如果你用的是非默认 SSH 私钥：

```bash
REMOTE_HOST=14.103.37.105 REMOTE_USER=ubuntu SSH_KEY=~/.ssh/your_key ./scripts/pull_prod_db.sh
```

## 2. 脚本做了什么

- 在服务器上用 `sqlite3 .backup` 生成一致性备份
- 把备份下载到本地：`data/taskflow.db`
- 自动删除服务器临时备份文件
- 自动做本地旧库备份：`data/backups/`
- 自动做 `PRAGMA integrity_check`

## 3. 开发建议流程

1. 先执行一次拉库脚本
2. 本地启动服务开发测试
3. 完成功能后提交代码（不提交数据库文件）

## 4. 注意事项

- 不要直接在服务器上改表结构后再本地开发，建议用迁移脚本管理
- 若拉库失败，优先检查：
  - SSH 连接是否可用
  - 服务器是否安装 `sqlite3`
  - 服务器数据库路径是否正确（默认 `/opt/mytask/data/taskflow.db`）
