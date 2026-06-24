# 视频生成 (Video Generation)

当用户希望「生成视频」「做一段视频」「文生视频」「短视频」或用 `/video` 命令时，使用本技能。

## 何时使用
- 用户要根据文字描述生成视频片段。
- 用户希望基于已有图片生成视频（图生视频，用首帧/尾帧引导）。

## 如何调用
调用 `generate_video` 工具。视频生成是异步轮询的，耗时较长，调用后耐心等待结果。

## 参数
| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | 是 | 视频生成描述：画面内容、镜头运动、氛围等。 |
| `duration` | integer | 否 | 时长（秒），范围 1–30。不填用设置里的默认值。 |
| `resolution` | string | 否 | 分辨率：`768P` 或 `1080P`。不填用设置默认值。 |
| `first_frame_image_path` | string | 否 | 工作区内图片（png/jpeg/webp）的相对路径，作为首帧引导图生视频。 |
| `last_frame_image_path` | string | 否 | 工作区内图片的相对路径，作为尾帧引导。 |

## 调用示例
文生视频：
```
generate_video(prompt: "镜头缓缓推进，晨光穿过森林，薄雾缭绕，电影质感", duration: 5, resolution: "1080P")
```
图生视频（用工作区里的首帧图）：
```
generate_video(prompt: "画面中的人物缓缓转头微笑", first_frame_image_path: "assets/character.png", duration: 4)
```

## 输出处理
- 生成的视频保存到工作区的 `.deepseekgui-videos/` 目录，并作为生成文件返回。
- 在回复里告知用户视频已生成，并可引用文件路径。

## 失败处理
- 若提示「provider 未配置 / missing baseUrl / apiKey / model」：告诉用户前往「设置 → 媒体能力 → 视频生成」配置后重试。
- 首尾帧图片格式/路径无效：检查路径是否为工作区相对路径、格式是否为 png/jpeg/webp。
- 生成耗时较长：提示用户视频生成需排队轮询，请耐心等待。
- 网络/超时错误：简要说明并建议重试。
