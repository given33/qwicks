import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type PatchModule = {
  patchTransparentWindowForWebGL: (filePath: string) => void;
};

async function loadPatch(): Promise<PatchModule['patchTransparentWindowForWebGL']> {
  const modulePath = new URL('../../tools/mqpet-source/patch-transparent-window-webgl.mjs', import.meta.url).href;
  const module = await import(modulePath) as PatchModule;
  return module.patchTransparentWindowForWebGL;
}

describe('patchTransparentWindowForWebGL', () => {
  it('adds guarded WebGL bridge calls to TransparentWindow without removing standalone code', async () => {
    const patchTransparentWindowForWebGL = await loadPatch();
    const root = mkdtempSync(join(tmpdir(), 'qwicks-transparent-window-'));
    const file = join(root, 'TransparentWindow.cs');
    writeFileSync(file, [
      'using UnityEngine;',
      'public class TransparentWindow : MonoBehaviour',
      '{',
      '\tprivate IntPtr hWnd;',
      '\tprivate void Start()',
      '\t{',
      '\t\thWnd = FindWindow(null, Application.productName);',
      '\t\tStartCoroutine(ManageStartupSequence());',
      '\t}',
      '\tprivate void Update()',
      '\t{',
      '\t\tif (isStartupAnimating)',
      '\t\t{',
      '\t\t\treturn;',
      '\t\t}',
      '\t}',
      '\tprivate void SetClickThrough(bool enabled)',
      '\t{',
      '\t}',
      '}',
      '',
    ].join('\n'));

    try {
      patchTransparentWindowForWebGL(file);
      const patched = readFileSync(file, 'utf8');

      expect(patched).toContain('private QwicksMqpetWebGLBridge qwicksBridge;');
      expect(patched).toContain('qwicksBridge = QwicksMqpetWebGLBridge.Ensure();');
      expect(patched).toContain('ReportCurrentPetBBoxToQwicks();');
      expect(patched).toContain('#if UNITY_WEBGL && !UNITY_EDITOR');
      expect(patched).toContain('qwicksBridge?.SetDragging(isDragging);');
      expect(patched).toContain('qwicksBridge.ReportBBox(new Rect(');
      expect(patched).toContain('hWnd = FindWindow(null, Application.productName);');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('guards native Windows window setup away from Unity WebGL builds', async () => {
    const patchTransparentWindowForWebGL = await loadPatch();
    const root = mkdtempSync(join(tmpdir(), 'qwicks-transparent-window-native-'));
    const file = join(root, 'TransparentWindow.cs');
    writeFileSync(file, [
      'using UnityEngine;',
      'public class TransparentWindow : MonoBehaviour',
      '{',
      '\tprivate IntPtr hWnd;',
      '\tprivate void Start()',
      '\t{',
      '\t\thWnd = FindWindow(null, Application.productName);',
      '\t\tif (hWnd != IntPtr.Zero)',
      '\t\t{',
      '\t\t\tSetWindowLong(hWnd, -16, 2415919104u);',
      '\t\t\tSetClickThrough(enabled: true);',
      '\t\t}',
      '\t\tif (PetDataManager.Instance != null)',
      '\t\t{',
      '\t\t\tPetDataManager.Instance.OnEvolution += TriggerEvolutionSwap;',
      '\t\t}',
      '\t\tStartCoroutine(ManageStartupSequence());',
      '\t}',
      '\tprivate void Update()',
      '\t{',
      '\t\tif (isStartupAnimating)',
      '\t\t{',
      '\t\t\treturn;',
      '\t\t}',
      '\t}',
      '\tprivate void SetClickThrough(bool enabled)',
      '\t{',
      '\t}',
      '}',
      '',
    ].join('\n'));

    try {
      patchTransparentWindowForWebGL(file);
      const patched = readFileSync(file, 'utf8');

      expect(patched).toContain('#if !UNITY_WEBGL || UNITY_EDITOR\n\t\thWnd = FindWindow(null, Application.productName);');
      expect(patched).toContain('\t\tStartCoroutine(ManageStartupSequence());');
      expect(patched).toContain('#endif\n\t\tif (PetDataManager.Instance != null)');
      expect(patched).toContain('PetDataManager.Instance.OnEvolution += TriggerEvolutionSwap;');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('adds a WebGL input path before the native window handle early return', async () => {
    const patchTransparentWindowForWebGL = await loadPatch();
    const root = mkdtempSync(join(tmpdir(), 'qwicks-transparent-window-webgl-input-'));
    const file = join(root, 'TransparentWindow.cs');
    writeFileSync(file, [
      'using UnityEngine;',
      'using UnityEngine.EventSystems;',
      'public class TransparentWindow : MonoBehaviour',
      '{',
      '\tprivate IntPtr hWnd;',
      '\tprivate bool isDragging;',
      '\tprivate bool isWindowMoved;',
      '\tprivate bool isActionPlaying;',
      '\tpublic LayerMask petLayer;',
      '\tpublic bool is2DProject = true;',
      '\tprivate GameObject qqObject;',
      '\tpublic GameObject enterObject;',
      '\tprivate void Start()',
      '\t{',
      '\t\thWnd = FindWindow(null, Application.productName);',
      '\t\tStartCoroutine(ManageStartupSequence());',
      '\t}',
      '\tprivate void Update()',
      '\t{',
      '\t\tif (isStartupAnimating)',
      '\t\t{',
      '\t\t\treturn;',
      '\t\t}',
      '\t\tif (hWnd == IntPtr.Zero || Camera.main == null)',
      '\t\t{',
      '\t\t\treturn;',
      '\t\t}',
      '\t}',
      '\tprivate void PlayRandomInteraction()',
      '\t{',
      '\t}',
      '\tprivate void PlayQuestionAnimation()',
      '\t{',
      '\t}',
      '\tprivate void SetClickThrough(bool enabled)',
      '\t{',
      '\t}',
      '}',
      '',
    ].join('\n'));

    try {
      patchTransparentWindowForWebGL(file);
      const patched = readFileSync(file, 'utf8');

      expect(patched).toContain('#if UNITY_WEBGL && !UNITY_EDITOR\n\t\tHandleWebGLPointerInput();\n\t\treturn;\n#endif\n\t\tif (hWnd == IntPtr.Zero || Camera.main == null)');
      expect(patched).toContain('private Transform webglDragTarget;');
      expect(patched).toContain('private void HandleWebGLPointerInput()');
      expect(patched).toContain('Input.GetMouseButtonDown(0)');
      expect(patched).toContain('EventSystem.current.RaycastAll(pointerEventData, uiHits);');
      expect(patched).toContain('webglDragTarget.position = webglDragStartWorld + delta;');
      expect(patched).toContain('PlayRandomInteraction();');
      expect(patched).toContain('PlayQuestionAnimation();');
      expect(patched).toContain('qwicksBridge?.SetDragging(isDragging);');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('adds required namespaces for the WebGL pointer and UI hit-test path', async () => {
    const patchTransparentWindowForWebGL = await loadPatch();
    const root = mkdtempSync(join(tmpdir(), 'qwicks-transparent-window-usings-'));
    const file = join(root, 'TransparentWindow.cs');
    writeFileSync(file, [
      'using System;',
      'using UnityEngine;',
      'public class TransparentWindow : MonoBehaviour',
      '{',
      '\tprivate IntPtr hWnd;',
      '\tprivate bool isDragging;',
      '\tprivate bool isWindowMoved;',
      '\tprivate bool isActionPlaying;',
      '\tpublic LayerMask petLayer;',
      '\tpublic bool is2DProject = true;',
      '\tprivate GameObject qqObject;',
      '\tpublic GameObject enterObject;',
      '\tprivate void Start()',
      '\t{',
      '\t\thWnd = FindWindow(null, Application.productName);',
      '\t\tStartCoroutine(ManageStartupSequence());',
      '\t}',
      '\tprivate void Update()',
      '\t{',
      '\t\tif (isStartupAnimating)',
      '\t\t{',
      '\t\t\treturn;',
      '\t\t}',
      '\t\tif (hWnd == IntPtr.Zero || Camera.main == null)',
      '\t\t{',
      '\t\t\treturn;',
      '\t\t}',
      '\t}',
      '\tprivate void PlayRandomInteraction()',
      '\t{',
      '\t}',
      '\tprivate void PlayQuestionAnimation()',
      '\t{',
      '\t}',
      '\tprivate void SetClickThrough(bool enabled)',
      '\t{',
      '\t}',
      '}',
      '',
    ].join('\n'));

    try {
      patchTransparentWindowForWebGL(file);
      const patched = readFileSync(file, 'utf8');

      expect(patched).toContain('using System.Collections.Generic;');
      expect(patched).toContain('using UnityEngine.EventSystems;');
      expect(patched.indexOf('using System.Collections.Generic;')).toBeLessThan(patched.indexOf('public class TransparentWindow'));
      expect(patched.indexOf('using UnityEngine.EventSystems;')).toBeLessThan(patched.indexOf('public class TransparentWindow'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('patches real-world CRLF files with spaces around the startup guard', async () => {
    const patchTransparentWindowForWebGL = await loadPatch();
    const root = mkdtempSync(join(tmpdir(), 'qwicks-transparent-window-crlf-'));
    const file = join(root, 'TransparentWindow.cs');
    writeFileSync(file, [
      'using UnityEngine;',
      'public class TransparentWindow : MonoBehaviour',
      '{',
      '    private IntPtr hWnd;',
      '    private void Start()',
      '    {',
      '        hWnd = FindWindow(null, Application.productName);',
      '        StartCoroutine(ManageStartupSequence());',
      '    }',
      '    private void Update()',
      '    {',
      '        if (isStartupAnimating)',
      '        {',
      '            return;',
      '        }',
      '    }',
      '    private void SetClickThrough(bool enabled)',
      '    {',
      '    }',
      '}',
      '',
    ].join('\r\n'));

    try {
      patchTransparentWindowForWebGL(file);
      const patched = readFileSync(file, 'utf8');

      expect(patched).toContain('ReportCurrentPetBBoxToQwicks();');
      expect(patched).toContain('qwicksBridge?.SetDragging(isDragging);');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('normalizes an over-guarded repeated patch without losing evolution subscription', async () => {
    const patchTransparentWindowForWebGL = await loadPatch();
    const root = mkdtempSync(join(tmpdir(), 'qwicks-transparent-window-normalize-'));
    const file = join(root, 'TransparentWindow.cs');
    writeFileSync(file, [
      'using UnityEngine;',
      'public class TransparentWindow : MonoBehaviour',
      '{',
      '\tprivate QwicksMqpetWebGLBridge qwicksBridge;',
      '',
      '\tprivate IntPtr hWnd;',
      '\tprivate void Start()',
      '\t{',
      '\t\tqwicksBridge = QwicksMqpetWebGLBridge.Ensure();',
      '\t\t#if !UNITY_WEBGL || UNITY_EDITOR',
      '\t\tqwicksBridge = QwicksMqpetWebGLBridge.Ensure();',
      '\t\thWnd = FindWindow(null, Application.productName);',
      '\t\tif (hWnd != IntPtr.Zero)',
      '\t\t{',
      '\t\t\tSetWindowLong(hWnd, -16, 2415919104u);',
      '\t\t\tSetClickThrough(enabled: true);',
      '\t\t}',
      '\t\tif (PetDataManager.Instance != null)',
      '\t\t{',
      '\t\t\tPetDataManager.Instance.OnEvolution += TriggerEvolutionSwap;',
      '\t\t}',
      '#endif',
      '\t\tStartCoroutine(ManageStartupSequence());',
      '\t}',
      '\tprivate void Update()',
      '\t{',
      '\t\tReportCurrentPetBBoxToQwicks();',
      '\t\tqwicksBridge?.SetDragging(isDragging);',
      '\t\tReportCurrentPetBBoxToQwicks();',
      '\t\tqwicksBridge?.SetDragging(isDragging);',
      '\t\tif (isStartupAnimating)',
      '\t\t{',
      '\t\t\treturn;',
      '\t\t}',
      '\t}',
      '\tprivate void ReportCurrentPetBBoxToQwicks()',
      '\t{',
      '#if UNITY_WEBGL && !UNITY_EDITOR',
      '\t\tqwicksBridge.ReportBBox(new Rect(0, 0, 1, 1));',
      '#endif',
      '\t}',
      '\tprivate void SetClickThrough(bool enabled)',
      '\t{',
      '\t}',
      '}',
      '',
    ].join('\n'));

    try {
      patchTransparentWindowForWebGL(file);
      const patched = readFileSync(file, 'utf8');

      expect((patched.match(/qwicksBridge = QwicksMqpetWebGLBridge\.Ensure\(\);/g) ?? [])).toHaveLength(1);
      expect((patched.match(/\t\tReportCurrentPetBBoxToQwicks\(\);/g) ?? [])).toHaveLength(1);
      expect((patched.match(/qwicksBridge\?\.SetDragging\(isDragging\);/g) ?? [])).toHaveLength(1);
      expect(patched).toContain('#endif\n\t\tif (PetDataManager.Instance != null)');
      expect(patched).toContain('\t\tStartCoroutine(ManageStartupSequence());');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
