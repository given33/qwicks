# Export QQPet Unity WebGL For QWicks

QWicks now has an internal Unity QQPet engine host. The Unity project itself is not committed to the app repo because the source archive and WebGL output are too large. Build the WebGL player from the user's Unity project and point QWicks at the output directory.

## Source Project

- Unity project: `C:/Users/given/Desktop/QQpet_extracted/ExportedProject`
- Original archive: `C:/Users/given/Downloads/QQpet2.zip`
- Unity editor version found in `ProjectSettings/ProjectVersion.txt`: `2022.3.53f1c1`

## Required Output Layout

The exported directory must contain one Unity loader under `Build/` and the matching `.framework.js`, `.wasm`, and `.data` files with the same stem. `QQPet` is preferred, so the ideal layout is:

```text
Build/QQPet.loader.js
Build/QQPet.framework.js
Build/QQPet.wasm
Build/QQPet.data
```

QWicks also accepts alternate Unity stems such as `Build/QQPetWebGL.loader.js` as long as `Build/` contains only one `.loader.js` file and the paired files use the same stem.

`StreamingAssets/` is optional but should be copied next to `Build/` if Unity creates it.

## Recommended Target

`npm run mqpet:export-unity-webgl` now defaults to the QWicks user data location that the app automatically scans:

```text
%APPDATA%/QWicks/mqpet/unity-webgl
```

Use an explicit override when you want the WebGL build somewhere else:

```powershell
$env:QWICKS_MQPET_UNITY_WEBGL_DIR="D:\QWicksData\mqpet\unity-webgl"
```

The Electron preload asks the main process for the resolved build path through `mqpet:get-unity-build`. If the build is incomplete, QWicks keeps the current React/SWF MQPet renderer as a fallback instead of showing a blank pet window.

## QWicks Bridge Patch

Before exporting WebGL, sync the QWicks bridge into the Unity project:

```powershell
node .\tools\mqpet-source\sync-unity-webgl-bridge.mjs "C:\Users\given\Desktop\QQpet_extracted\ExportedProject"
node .\tools\mqpet-source\sync-unity-webgl-build-script.mjs "C:\Users\given\Desktop\QQpet_extracted\ExportedProject"
node .\tools\mqpet-source\patch-transparent-window-webgl.mjs "C:\Users\given\Desktop\QQpet_extracted\ExportedProject\Assets\Scripts\Assembly-CSharp\TransparentWindow.cs"
```

This adds:

```text
Assets/Plugins/WebGL/QwicksMqpetBridge.jslib
Assets/Scripts/Assembly-CSharp/QwicksMqpetWebGLBridge.cs
Assets/Editor/QwicksMqpetWebGLBuild.cs
```

and patches `TransparentWindow.cs` so WebGL reports the current pet hit box and dragging state to Electron while keeping Windows native transparent-window code out of WebGL builds. Electron remains responsible for desktop transparency, mouse passthrough, right-click menu, and hover menu.

## Batchmode Export

After the bridge and build script are synced, export WebGL from Unity Hub or run batchmode with Unity 2022.3.53f1c1:

```powershell
& "C:\Program Files\Unity\Hub\Editor\2022.3.53f1c1\Editor\Unity.exe" `
  -batchmode `
  -quit `
  -projectPath "C:\Users\given\Desktop\QQpet_extracted\ExportedProject" `
  -executeMethod QwicksMqpetWebGLBuild.Build `
  -logFile "%APPDATA%\QWicks\mqpet\unity-webgl\unity-build.log"
```

This machine did not have the Unity Editor executable available during QWicks integration work, so the final export must be run on a machine with that exact Unity version installed.

## Verify

```powershell
npm run mqpet:check-unity-webgl -- "D:\QWicksData\mqpet\unity-webgl"
```

The command must print:

```text
QQPet Unity WebGL build is ready: <path>
```
