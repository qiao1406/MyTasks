# MyTask 服务器部署脚本使用说明

本文说明如何在云服务器上使用以下脚本部署：

- `deploy.sh`（有域名 + HTTPS）
- `deploy_no_domain.sh`（无域名 + 公网 IP + HTTP）

## 1. 前置条件

- 服务器系统：Ubuntu / Debian
- 服务器可联网
- 你有仓库访问权限（SSH Key 或 HTTPS Token）
- 如果用 `deploy.sh`：
  - 已有域名
  - 域名 DNS 已解析到服务器公网 IP

## 2. 上传脚本到服务器

如果仓库已经在服务器上：

```bash
cd /opt/mytask
git pull
chmod +x deploy.sh deploy_no_domain.sh
```

如果脚本在本地电脑：

```bash
scp deploy.sh deploy_no_domain.sh user@<服务器IP>:/home/user/
ssh user@<服务器IP>
chmod +x ~/deploy.sh ~/deploy_no_domain.sh
```

## 3. 有域名版本（deploy.sh）

```bash
REPO_URL='git@github.com:qiao1406/MyTasks.git' \
DOMAIN='your.domain.com' \
EMAIL='you@example.com' \
BRANCH='feat-user-management' \
./deploy.sh
```

说明：

- 自动安装 Node.js / PM2 / Nginx / UFW / Certbot
- 自动反向代理到 `127.0.0.1:8787`
- 自动申请并配置 HTTPS
- 自动安装每天 3:00 SQLite 备份任务（保留 14 天）

## 4. 无域名版本（deploy_no_domain.sh）

```bash
REPO_URL='git@github.com:qiao1406/MyTasks.git' \
BRANCH='feat-user-management' \
./deploy_no_domain.sh
```

说明：

- 通过公网 IP 的 `http://<公网IP>` 访问
- 不配置 HTTPS（因为无域名）
- 同样包含 PM2、Nginx、UFW、自动备份

## 5. 部署后检查

```bash
pm2 status
pm2 logs mytask
sudo nginx -t
curl -I http://127.0.0.1:8787
```

访问：

- 有域名：`https://your.domain.com`
- 无域名：`http://<服务器公网IP>`

## 6. 常见问题

### 6.1 页面无法公网访问

检查：

- 云厂商安全组是否放行 `80`（以及 `443`）
- 服务器防火墙是否放行对应端口：

```bash
sudo ufw status
```

### 6.2 HTTPS 申请失败

检查：

- 域名解析是否生效（A 记录）
- `DOMAIN` 是否写错
- 80 端口是否可从公网访问

### 6.3 代码更新后如何发布

```bash
cd /opt/mytask
git fetch --all
git checkout <分支名>
git pull --ff-only
pm2 restart mytask
```

## 7. 重要路径

- 项目目录（默认）：`/opt/mytask`
- SQLite 数据库：`/opt/mytask/data/taskflow.db`
- 备份目录：`/opt/mytask/data/backups`
- Nginx 配置：`/etc/nginx/sites-available/mytask`
