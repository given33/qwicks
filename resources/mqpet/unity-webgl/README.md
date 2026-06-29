# QQPet Unity WebGL Runtime

This directory is the release-bundled QQPet Unity WebGL runtime.

Do not place the Unity source project here. For release builds, export the Unity
project with:

```powershell
npm run mqpet:export-unity-webgl:bundled
```

The final packaged app must include a complete Unity WebGL `Build/` directory
next to this file. End users do not need Unity installed; QWicks loads the
exported WebGL runtime from Electron `resources/mqpet/unity-webgl`.
