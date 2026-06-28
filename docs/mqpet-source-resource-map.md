# MQPet 源资源抽取表

抽取日期：2026-06-28

## 结论

源工程里已经有蛋壳、幼年、成熟三阶段规则，但没有三套不同的桌宠形态资源。`level0.unity` 里 `eggPrefab`、`toddlerPrefab`、`maturePrefab` 三个字段全部绑定同一个 `GameObject/QQ.prefab`，所以按源文件真实运行结果，1-9 级、10-29 级、30 级以上都使用同一套 idle、walk、interact 动画。

可直接复用到 QWicks 的结论：

| 阶段 | 等级 | 源文件 prefab | Animator | idle | stand/drag | walk | interact/status | play/bored |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Egg | 1-9 | `GameObject/QQ.prefab` | `AnimatorController/1.controller` | `Pet_Idle` | `Stand` | `Walk_*` 8 向 | `E1..E3`, `F1..F5`, `H1..H4`, `M1..M2` | `Play`, `Play1..Play28` |
| Toddler | 10-29 | 同 Egg | 同 Egg | 同 Egg | 同 Egg | 同 Egg | 同 Egg | 同 Egg |
| Mature | 30+ | 同 Egg | 同 Egg | 同 Egg | 同 Egg | 同 Egg | 同 Egg | 同 Egg |

证据：

| 来源 | 关键内容 |
| --- | --- |
| `C:/Users/given/Desktop/QQpet_extracted/ExportedProject/Assets/Scripts/Assembly-CSharp/PetDataManager.cs` | `CurrentStage`: `<10 Egg`, `<30 Toddler`, `>=30 Mature` |
| `C:/Users/given/Desktop/QQpet_extracted/ExportedProject/Assets/Scripts/Assembly-CSharp/TransparentWindow.cs` | 有 `eggPrefab/toddlerPrefab/maturePrefab` 字段，并在进化时销毁旧对象后实例化当前阶段 prefab |
| `C:/Users/given/Desktop/QQpet_extracted/ExportedProject/Assets/Scenes/level0.unity:518` | `eggPrefab` 指向 `bd3371d4ea96cae4990e9690a7707abd` |
| `C:/Users/given/Desktop/QQpet_extracted/ExportedProject/Assets/Scenes/level0.unity:519` | `toddlerPrefab` 同样指向 `bd3371d4ea96cae4990e9690a7707abd` |
| `C:/Users/given/Desktop/QQpet_extracted/ExportedProject/Assets/Scenes/level0.unity:520` | `maturePrefab` 同样指向 `bd3371d4ea96cae4990e9690a7707abd` |
| `C:/Users/given/Desktop/QQpet_extracted/ExportedProject/Assets/GameObject/QQ.prefab.meta` | `QQ.prefab` 的 guid 就是 `bd3371d4ea96cae4990e9690a7707abd` |
| `C:/Users/given/Desktop/QQpet_extracted/ExportedProject/Assets/GameObject/QQ.prefab:19927` | 主桌宠 Animator 指向 `AnimatorController/1.controller` |

## 资源位置

| 类型 | 源文件位置 | QWicks 现有位置 |
| --- | --- | --- |
| Unity 动画片段 | `C:/Users/given/Desktop/QQpet_extracted/ExportedProject/Assets/AnimationClip/*.anim` | `src/asset/img/mqpet/anims/*.json` |
| Unity Animator | `C:/Users/given/Desktop/QQpet_extracted/ExportedProject/Assets/AnimatorController/*.controller` | `src/shared/mqpet-fsm.ts` 运行时选择动画 |
| Unity prefab/场景绑定 | `C:/Users/given/Desktop/QQpet_extracted/ExportedProject/Assets/GameObject/QQ.prefab`, `Scenes/level0.unity` | Electron MQPet renderer |
| Sprite 帧 | `Texture2D/`, `Sprite/` | `src/asset/img/mqpet/sprites/*.png`, `sprite_manifest.json` |
| 物品/背包数据 | `MonoBehaviour/*.asset` | 可接入 `src/shared/mqpet-catalog.ts` 或新数据表 |

## 主桌宠 Animator

主桌宠控制器是 `AnimatorController/1.controller`，guid 为 `be8cc93b7cfd8ab4886a8e69c2e4cd9c`。

启动入场动画使用 `AnimatorController/1 1.controller`，guid 为 `b6891a6d681780041b53dbf8ca7e005c`：

| 参数 | 值 | 动画 |
| --- | ---: | --- |
| `AnimID` | 0 | `Enter` |
| `AnimID` | 1 | `Enter2` |

主状态和生命周期：

| 行为 | Animator 参数 | 动画 | 备注 |
| --- | --- | --- | --- |
| 待机 | 默认状态 | `Pet_Idle` | loop |
| 拖动/站立 | QWicks 可直接选用 | `Stand` | loop |
| 疑问打断 | `Question` trigger | `Question` | 播完回 `Pet_Idle` |
| 喂食 | `Feed` trigger + `FeedID=0` | `Eat1` | 源脚本随机 |
| 喂食 | `Feed` trigger + `FeedID=1` | `Eat2` | 源脚本随机 |
| 洗澡 | `Clean` trigger + `CleanID=0` | `Clean` | 单段 |
| 升级 | `LevelUp` trigger | `LevelUP` | 播完回 `Pet_Idle` |
| 死亡 | `Die` bool/trigger | `Die` | 自动转 `Bury` |
| 埋葬 | `Die -> Bury` | `Bury` | 无退出 transition |
| 复活 | `Revive` trigger | `Revive` | 播完回 `Pet_Idle` |

## Walk 资源表

所有阶段共用这 8 个方向。

| 方向 | 动画 | fps | 帧数 | loop |
| --- | --- | ---: | ---: | --- |
| 下 | `Walk_Down` | 6 | 6 | yes |
| 上 | `Walk_UP` | 15 | 6 | yes |
| 左 | `Walk_Left` | 15 | 6 | yes |
| 右 | `Walk_Right` | 15 | 6 | yes |
| 左下 | `Walk_LeftDown` | 20 | 7 | yes |
| 右下 | `Walk_RightDown` | 20 | 7 | yes |
| 左上 | `Walk_LeftUP` | 15 | 6 | yes |
| 右上 | `Walk_RightUP` | 15 | 6 | yes |

## Interact/状态反馈表

这是 `AnimatorController/1.controller` 里 `Interact` trigger 真实绑定的表。`level0.unity` 把 `interactionCount` 覆盖成 14，所以运行时只会随机 0-13。

| InteractID | 动画 | 建议语义 | fps | 帧数 | 时长 |
| ---: | --- | --- | ---: | ---: | ---: |
| 0 | `E1` | 清洁/日常反馈 1 | 12 | 118 | 9794ms |
| 1 | `E2` | 清洁/日常反馈 2 | 12 | 115 | 9545ms |
| 2 | `E3` | 清洁/日常反馈 3 | 12 | 54 | 4482ms |
| 3 | `F1` | 饥饿/食物反馈 1 | 12 | 107 | 8881ms |
| 4 | `F2` | 饥饿/食物反馈 2 | 12 | 106 | 8798ms |
| 5 | `F3` | 饥饿/食物反馈 3 | 12 | 219 | 18177ms |
| 6 | `F4` | 饥饿/食物反馈 4 | 12 | 64 | 5312ms |
| 7 | `F5` | 饥饿/食物反馈 5 | 12 | 47 | 3901ms |
| 8 | `H1` | 健康反馈 1 | 12 | 121 | 10043ms |
| 9 | `H2` | 健康反馈 2 | 12 | 118 | 9794ms |
| 10 | `H3` | 健康反馈 3 | 12 | 55 | 4565ms |
| 11 | `H4` | 健康反馈 4 | 12 | 155 | 12865ms |
| 12 | `M1` | 心情反馈 1 | 12 | 119 | 9877ms |
| 13 | `M2` | 心情反馈 2 | 12 | 90 | 7470ms |

QWicks 建议：把这 14 个更适合接到“状态气泡/低状态提醒”里，而不是全部当普通点击互动。当前已有的 `health -> H1`, `cleanliness -> E1`, `hunger -> F1`, `mood -> M1` 是方向正确的。

## Play/Bored 动作表

`AnimatorController/1.controller` 把 `Bored` trigger 接到了 `Play` 系列。`level0.unity` 把 `boredCount` 覆盖成 28，所以源码运行会抽 0-27。

这里有一个源工程配置问题：Controller 里缺 `BoredID=26`，并且有两个 `BoredID=28`，分别指向 `Play26` 和 `Play28`。由于 `boredCount=28` 只会生成 0-27，实际运行时 `Play26` 和 `Play28` 都不可稳定触发。QWicks 如果要做“28 个互动动作不重复轮播”，建议归一化为 `Play1..Play28`，这是体验更完整的映射。

源 Controller literal 表：

| BoredID | 动画 | 备注 |
| ---: | --- | --- |
| 0 | `Play` | 源 Controller 里的无编号 Play |
| 1 | `Play1` |  |
| 2 | `Play2` |  |
| 3 | `Play3` |  |
| 4 | `Play4` |  |
| 5 | `Play5` |  |
| 6 | `Play6` |  |
| 7 | `Play7` |  |
| 8 | `Play8` |  |
| 9 | `Play9` |  |
| 10 | `Play10` |  |
| 11 | `Play11` |  |
| 12 | `Play12` |  |
| 13 | `Play13` |  |
| 14 | `Play14` |  |
| 15 | `Play15` |  |
| 16 | `Play16` |  |
| 17 | `Play17` |  |
| 18 | `Play18` |  |
| 19 | `Play19` |  |
| 20 | `Play20` |  |
| 21 | `Play21` |  |
| 22 | `Play22` |  |
| 23 | `Play23` |  |
| 24 | `Play24` |  |
| 25 | `Play25` |  |
| 26 | 无 transition | 源 Controller 缺失 |
| 27 | `Play27` |  |
| 28 | `Play26` 和 `Play28` | 源 Controller 重复条件，场景默认不会生成 28 |

QWicks 归一化建议表：

| QWicks action id | 动画 |
| ---: | --- |
| 0-27 | `Play1..Play28` |

如果要把源文件里的无编号 `Play` 也接进来，可以作为第 29 个彩蛋动作，或者替换掉 `Play26/Play28` 里不满意的一个。

## 菜单交互抽取

代码默认值来自 `PetInteractFinal.cs`：

| 配置 | 代码默认 | QWicks 建议 |
| --- | ---: | ---: |
| 鼠标靠近显示延迟 | 0.3s | 0.3s |
| 离开隐藏延迟 | 0.5s | 0.5s |
| 企鹅近距离半径 | 60px | 60px |
| 菜单保持半径 | 250px | 250px |

注意：`QQ.prefab` 里覆盖成了 `showDelayTime=1.5`, `hideDelayTime=0.8`, `maxMenuRadius=100`，这个配置明显更容易造成菜单难唤出、很快消失。QWicks 应该用代码默认值和用户确认过的 250px 行为。

菜单按钮绑定：

| 菜单按钮 | 源方法 | 行为 |
| --- | --- | --- |
| Feed | `OnClick_Feed` | `InventoryManager.OpenBag(0)` |
| Clean | `OnClick_Clean` | `InventoryManager.OpenBag(1)` |
| Medical | `OnClick_Medical` | `InventoryManager.OpenBag(2)` |
| Work | `OnClick_Work` | `PetDataManager.StartWorking()` |
| Learn | `OnClick_Learn` | `PetDataManager.StartLearning()` |
| Map | `OnClick_Map` | 打开 `mapPanelUI` |
| Status | `OnClick_Status` | 打开 `statusPanelUI` |

## 背包和医疗

分类枚举：

| MainCategory | 值 |
| --- | ---: |
| Feeding | 0 |
| Function | 1 |
| DressUp | 2 |

| SubCategory | 值 |
| --- | ---: |
| Food | 0 |
| Daily | 1 |
| Medicine | 2 |
| Other | 3 |
| Toy | 4 |
| Stats | 5 |
| Background | 6 |
| Props | 7 |

医疗分类目前源数据只有一个明确药品：

| 物品 | 分类 | 价格 | 解锁 | 效果 |
| --- | --- | ---: | ---: | --- |
| `眼药水` | Medicine | 100 | 1 | `health +5` |

所以 QWicks 医疗菜单应先接背包 Medicine 分类，而不是只打开状态/控制台。后续可以补更多药品，但源文件可抽取出的 Medicine 数据目前只有这一项。

## 打工和学习

源逻辑在 `PetDataManager.cs`。

打工：

| 项 | 规则 |
| --- | --- |
| 默认时长 | 4 个 tick/hour 单位 |
| 开始条件 | 非生病、当前 `Idle`、体力 `>20` |
| 消耗 | 饥饿 2x，清洁 1.5x，心情 1.2x，体力下降 |
| 成长 | 每 tick `growth +1.2` |
| 结束 | 体力归零或达到目标时长 |
| 工资 | `(wage - cost) * hoursWorked` |
| wage | level < 15: 20；level >= 30: 36；其他: 30 |
| cost | level <= 5: 18；level <= 11: 22；其他: 26 |

学习：

| 项 | 规则 |
| --- | --- |
| 默认时长 | 2 个 tick/hour 单位 |
| 开始条件 | 非生病、当前 `Idle` |
| 消耗 | 饥饿 1.5x |
| 成长 | 每 tick `growth +1.5` |
| 智力 | 每 tick `intelligence +1` |
| 惩罚 | 学习中饥饿为 0 时 `health -5` |
| 奖励 | level < 10: 20 金；level < 20: 50 金；level >= 20: 100 金 |

小游戏 UI 可以在这套规则上包一层：开始按钮、倒计时/进度、消耗预估、收益预估、失败原因提示。

## 状态面板

源状态面板字段：

| 字段 | 源显示 |
| --- | --- |
| level/stage | 等级和阶段 |
| activity | Idle/Working/Learning |
| gold | 元宝 |
| health | 健康 |
| mood | 心情 |
| hunger | 饥饿 |
| cleanliness | 清洁 |
| stamina | 体力 |
| intelligence | 智力 |
| stressResistance | 抗压 |
| growth | 经验 |
| charm | 魅力 |

## 状态气泡、音效、提醒节奏

源文件没有抽到独立音频资源，也没有发现 `AudioSource`、`PlayOneShot`、`.wav/.mp3/.ogg` 等可复用音效文件。状态气泡也没有独立脚本或专用资源表，现有源逻辑主要是 `PetStatusUI` 文本面板和 `E/F/H/M` 动画反馈。

QWicks 建议这样补：

| 触发 | 动画 | 气泡文案方向 | 节奏 |
| --- | --- | --- | --- |
| health 低 | `H1..H4` | 生病/难受/需要药品 | 低健康进入冷却提醒 |
| hunger 低 | `F1..F5` | 饿了/想吃东西 | 饥饿低于阈值后间歇提醒 |
| cleanliness 低 | `E1..E3` | 脏了/想洗澡 | 清洁低于阈值后间歇提醒 |
| mood 低 | `M1..M2` | 不开心/想互动 | 心情低于阈值后间歇提醒 |

音效需要 QWicks 自行补一组轻量资源：菜单 hover/click、喂食、洗澡、升级、疑问、死亡/复活、气泡提醒。源包里没有能直接抽取的音频。

## 地图和 NPC 动画

`QQ.prefab` 里还有地图/NPC 用的 Animator，不是三阶段成长形态：

| 控制器 | guid | 说明 |
| --- | --- | --- |
| `国王` | `7eed2126ea98f8a4aa680596b7af582d` | 地图/NPC |
| `杰无双` | `e8c41e6b93565754eabb7e055b2be606` | 地图/NPC |
| `科洛` | `a5ce488ded92e554daf3bb06e43cff5b` | 地图/NPC |
| `多多` | `fecd2a8b33060294eb8590abda793149` | 地图/NPC |
| `九尾妖狐` | `caf32fb13614aa3438e9265d6937b320` | 地图/NPC |
| `花小妹` | `87e59588a10e9804599587cb40b2dc3f` | 地图/NPC |

这些可以做地图玩法或小游戏角色，但不能当作“原版蛋壳/幼年/成熟换形态”的证据。

## 后续接入建议

1. 先把 QWicks 的 stage asset 表显式化，三阶段都绑定同一套源资源，并在代码里保留未来替换点。
2. 普通点击如果要更好玩，继续使用 `Play1..Play28` shuffle-bag；如果要更贴源运行时，则点击用 `E/F/H/M` 14 个，长时间无聊用 `Play` 系列。
3. 状态气泡接 `E/F/H/M`，这是源资源最自然的用途。
4. 医疗菜单接背包 `Medicine` 分类，先显示 `眼药水`，使用后触发健康恢复和合适的反馈动画。
5. 打工/学习先做 UI 和状态进度，核心数值完全按 `PetDataManager.cs`。
6. 如果要真正“像原版一样换形态”，这个源包无法直接提供三套桌宠形态，需要新资源或从别的 QQPet 资源包继续抽。
