# 音乐生成 (Music Generation)

当用户希望「生成音乐」「作曲」「配乐」「写首歌」「背景音乐/BGM」「纯音乐」或用 `/music` 命令时，使用本技能。

## 何时使用
- 用户要生成一段音乐：纯音乐、带歌词的歌曲、背景配乐等。
- 用户提供歌词希望配成歌，或描述风格希望生成纯音乐。

## 如何调用
调用 `generate_music` 工具。至少提供 `prompt`、`lyrics` 或 `instrumental: true` 之一。

## 参数
| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | 否* | 音乐风格/情绪/编排/生成意图描述。 |
| `lyrics` | string | 否* | 歌词（用于带人声的歌曲）。 |
| `instrumental` | boolean | 否* | 设为 `true` 生成无人声纯音乐。 |
| `lyrics_optimizer` | boolean | 否 | 让服务商自动生成或优化歌词。 |
| `reference_audio_url` | string | 否 | 翻唱/参考音频的公开 URL。 |
| `format` | string | 否 | 音频格式：`mp3`、`wav`、`flac`。 |

\* 三者至少传一个。

## 调用示例
纯音乐：
```
generate_music(prompt: "轻快明朗的尤克里里纯音乐，夏日清新风", instrumental: true, format: "mp3")
```
带歌词的歌：
```
generate_music(prompt: "流行抒情，钢琴伴奏", lyrics: "夜色温柔...\n（歌词）", format: "mp3")
```

## 输出处理
- 生成的音频保存到工作区的 `.deepseekgui-music/` 目录，并作为生成文件返回。
- 在回复里告知用户音乐已生成，并可引用文件路径。

## 失败处理
- 若提示「provider 未配置 / missing baseUrl / apiKey / model」：这是内置技能尚未配置。告诉用户前往「设置 → Skills → 内置技能配置」，展开「音乐生成」填写 API 凭据后重试；或在 providerId 字段选择已配置凭据的服务商。
- 同时传了 `lyrics` 又设 `instrumental: true` 可能冲突：以纯音乐为准或去掉歌词重试。
- 网络/超时错误：简要说明并建议重试。
