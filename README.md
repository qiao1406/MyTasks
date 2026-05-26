# TaskFlow (SQLite 多设备版)

## 1. 启动服务

```bash
cd /Users/wentao/Desktop/MyTasks
node server.mjs
```

启动后会监听：
- `http://0.0.0.0:8787`

数据库文件：
- `/Users/wentao/Desktop/MyTasks/data/taskflow.db`

## 2. 在浏览器访问

本机访问：
- `http://localhost:8787`

同一局域网其他设备访问（手机/平板/另一台电脑）：
- `http://你的电脑局域网IP:8787`

例如你的电脑 IP 是 `192.168.1.10`，则访问 `http://192.168.1.10:8787`。

## 3. 说明

- 不要再使用 `file:///.../index.html` 打开。
- 所有任务会通过 `/api/state` 读写 SQLite。
- 只要连接的是同一台运行服务的电脑，就能看到同一份任务数据。
