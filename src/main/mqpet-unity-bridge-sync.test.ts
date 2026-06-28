import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type SyncModule = {
  syncUnityWebGLBridge: (projectRoot: string) => { jslibPath: string; csPath: string };
};

describe('syncUnityWebGLBridge', () => {
  it('writes the WebGL JS plugin and C# bridge into a Unity project', async () => {
    const modulePath = new URL('../../tools/mqpet-source/sync-unity-webgl-bridge.mjs', import.meta.url).href;
    const { syncUnityWebGLBridge } = await import(modulePath) as SyncModule;
    const projectRoot = join(tmpdir(), `qwicks-mqpet-unity-bridge-${process.pid}-${Date.now()}`);
    mkdirSync(join(projectRoot, 'Assets'), { recursive: true });
    try {
      const result = syncUnityWebGLBridge(projectRoot);

      expect(result.jslibPath).toBe(join(projectRoot, 'Assets', 'Plugins', 'WebGL', 'QwicksMqpetBridge.jslib'));
      expect(result.csPath).toBe(join(projectRoot, 'Assets', 'Scripts', 'Assembly-CSharp', 'QwicksMqpetWebGLBridge.cs'));

      const jslib = readFileSync(result.jslibPath, 'utf8');
      expect(jslib).toContain('QwicksMqpet_ReportBBox');
      expect(jslib).toContain('window.qwicksMqpetUnityBridge.reportBBox');
      expect(jslib).toContain('window.qwicksMqpetUnityBridge.setDragging');
      expect(jslib).toContain('window.qwicksMqpetUnityBridge.openMenu');

      const cs = readFileSync(result.csPath, 'utf8');
      expect(cs).toContain('public sealed class QwicksMqpetWebGLBridge');
      expect(cs).toContain('ReportBBox(Rect rect)');
      expect(cs).toContain('SetDragging(bool dragging)');
      expect(cs).toContain('OpenMenu(string panel)');
      expect(cs).toContain('HandleQwicksMenuAction(string action)');
      expect(cs).toContain('PetInteractFinal petInteract = FindObjectOfType<PetInteractFinal>()');
      expect(cs).toContain('petInteract.OnClick_Feed();');
      expect(cs).toContain('InventoryManager.Instance.OpenBag(2);');
      expect(cs).toContain('PetDataManager.Instance.StartWorking()');
      expect(cs).toContain('PetDataManager.Instance.StartLearning()');
      expect(cs).toContain('ShopManager.Instance.OpenShop();');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
