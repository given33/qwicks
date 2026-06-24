# 图像生成 (Image Generation)

当用户希望你「画一张图」「生成图片」「配图」「文生图」或用 `/image` 命令时，使用本技能。

## 何时使用
- 用户明确要求生成、绘制、配图、制作图片。
- 用户希望基于已有图片做修改或二创（图生图）。

## 如何调用
调用 `generate_image` 工具，它每次恰好生成一张图片；需要多张或多个变体时多次调用。

## 参数
| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | 是 | 对图片的详细描述。越具体越好：主体、风格、构图、光线、色调等。 |
| `aspect_ratio` | string | 否 | 画幅比例，如 `1:1`、`16:9`、`9:16`、`4:3`、`3:2`。 |
| `image_size` | string | 否 | 分辨率档位：`1K`（默认）或 `2K`。 |
| `reference_image_paths` | string[] | 否 | 工作区内图片的相对路径，用于图生图（以图改图）。可传多张。 |

## 调用示例
文生图：
```
generate_image(prompt: "赛博朋克城市夜景，霓虹灯，雨后湿润的街道反射，电影感构图", aspect_ratio: "16:9", image_size: "1K")
```
图生图（基于工作区里的参考图）：
```
generate_image(prompt: "把这张人物改成水彩画风格", reference_image_paths: ["assets/portrait.png"])
```

## 输出处理
- 生成的图片会保存到工作区的 `.deepseekgui-images/` 目录，并以附件预览形式返回。
- 在回复里用 markdown 图片语法引用返回的文件路径，让用户直接看到结果。

## 失败处理
- 若工具返回「provider 未配置 / missing baseUrl / apiKey / model」类错误：告诉用户前往「设置 → 媒体能力 → 图像生成」填写服务商凭证后重试。
- 若提示不支持参考图（`/images/edits` 不支持）：去掉 `reference_image_paths` 后重试纯文生图。
- 其他网络/超时错误：简要说明并建议重试。
