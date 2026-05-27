# TaskFlow

## 功能

- 注册/登录/登出
- 会话鉴权（Bearer Token）
- 多用户数据隔离（每个用户独立任务数据）
- 任务/项目功能保持可用

## 启动

```bash
node server.mjs
```

服务地址：
- `http://localhost:8787`

数据库文件：
- `/data/taskflow.db`

## 使用

1. 打开 `http://localhost:8787`
2. 首次可直接注册（用户名 3-32 位字母/数字/下划线，密码 6-128 位）
3. 注册成功会自动登录
4. 不同账号登录后看到各自独立的任务数据

## API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/state`
- `PUT /api/state`
