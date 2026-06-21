# QWicks Aliyun Auto Update

当前自动更新链路:

1. 本地提交代码并 push 到 `main`
2. GitHub Actions 在 Windows 环境自动打包
3. Actions 把 `latest.yml`、`latest.json`、安装包和 blockmap 上传到阿里云服务器
4. 客户端从 `http://8.138.40.16/qwicks/channels/stable/latest/` 检查更新

服务器需要把 `/var/www/qwicks` 作为静态目录对外暴露到 `/qwicks`。
如果使用 Nginx,核心配置类似:

```nginx
location /qwicks/ {
  alias /var/www/qwicks/;
  autoindex off;
}
```

GitHub 仓库需要配置 Secrets:

- `ALIYUN_SSH_USER`: 服务器 SSH 用户名
- `ALIYUN_SSH_KEY`: 对应的私钥
- `ALIYUN_SSH_HOST`: 可选,默认 `8.138.40.16`
- `ALIYUN_SSH_PORT`: 可选,默认 `22`

GitHub 仓库可选配置 Variables:

- `QWICKS_UPDATE_BASE_URL`: 有域名后改成 `https://update.haoyongai.xyz/qwicks`
- `QWICKS_SERVER_DEPLOY_PATH`: 默认 `/var/www/qwicks`

有域名后,先把域名解析到 `8.138.40.16`,再把 `QWICKS_UPDATE_BASE_URL`
改成域名地址,重新运行一次 Actions 发布新版本即可。
