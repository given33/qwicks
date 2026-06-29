#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function insertOnce(text, marker, insertion) {
  if (text.includes(insertion.trim())) return text;
  const index = text.indexOf(marker);
  if (index < 0) throw new Error(`Patch marker not found: ${marker}`);
  return `${text.slice(0, index)}${insertion}${text.slice(index)}`;
}

function insertBeforeRegexOnce(text, regex, insertion, label) {
  if (text.includes(insertion.trim())) return text;
  const match = regex.exec(text);
  if (!match || match.index === undefined) throw new Error(`Patch marker not found: ${label}`);
  return `${text.slice(0, match.index)}${insertion}${text.slice(match.index)}`;
}

function replaceOnce(text, marker, replacement) {
  if (text.includes(replacement.trim())) return text;
  if (!text.includes(marker)) throw new Error(`Patch marker not found: ${marker}`);
  return text.replace(marker, replacement);
}

function replaceRegexOnce(text, regex, replacement, label) {
  if (text.includes(replacement.trim())) return text;
  if (!regex.test(text)) throw new Error(`Patch marker not found: ${label}`);
  return text.replace(regex, replacement);
}

function ensureUsing(text, namespace) {
  const line = `using ${namespace};`;
  if (text.split(/\r?\n/).some((current) => current.trim() === line)) return text;

  const usingMatches = [...text.matchAll(/^using\s+[^;]+;\r?$/gm)];
  if (usingMatches.length === 0) return `${line}\n${text}`;

  const last = usingMatches[usingMatches.length - 1];
  const insertAt = last.index + last[0].length;
  return `${text.slice(0, insertAt)}\n${line}${text.slice(insertAt)}`;
}

function insertWebGLInputBeforeNativeWindowReturn(text) {
  if (/HandleWebGLPointerInput\(\);\r?\n[ \t]*return;\r?\n#endif\r?\n[ \t]*if \(hWnd == IntPtr\.Zero \|\| Camera\.main == null\)/.test(text)) {
    return text;
  }
  const regex = /^([ \t]*)if \(hWnd == IntPtr\.Zero \|\| Camera\.main == null\)\r?\n\1\{\r?\n[ \t]*return;\r?\n\1\}/m;
  if (!regex.test(text)) return text;
  return text.replace(
    regex,
    '#if UNITY_WEBGL && !UNITY_EDITOR\n$1HandleWebGLPointerInput();\n$1return;\n#endif\n$1if (hWnd == IntPtr.Zero || Camera.main == null)\n$1{\n$1\treturn;\n$1}',
  );
}

function guardNativeWindowSetup(text) {
  const hWndMatch = /^[ \t]*hWnd = FindWindow\(null, Application\.productName\);\r?$/m.exec(text);
  if (!hWndMatch || hWndMatch.index === undefined) throw new Error('Patch marker not found: hWnd = FindWindow(null, Application.productName);');

  if (text.includes('#if !UNITY_WEBGL || UNITY_EDITOR')) {
    const hWndLineStart = hWndMatch.index;
    const existingIf = text.lastIndexOf('#if !UNITY_WEBGL || UNITY_EDITOR', hWndLineStart);
    const existingEndif = text.indexOf('#endif', hWndLineStart);
    if (existingIf < 0 || existingEndif < 0) return text;
    const withoutEndif = `${text.slice(0, existingEndif)}${text.slice(existingEndif + '#endif'.length)}`;
    return guardNativeWindowSetup(`${withoutEndif.slice(0, existingIf)}${withoutEndif.slice(existingIf + '#if !UNITY_WEBGL || UNITY_EDITOR'.length)}`);
  }

  const startIndex = hWndMatch.index;
  const afterFindWindow = startIndex + hWndMatch[0].length;
  const ifMatch = /\r?\n[ \t]*if \(hWnd != IntPtr\.Zero\)\r?\n[ \t]*\{/.exec(text.slice(afterFindWindow));
  if (!ifMatch || ifMatch.index === undefined) {
    return `${text.slice(0, startIndex)}#if !UNITY_WEBGL || UNITY_EDITOR\n${text.slice(startIndex, afterFindWindow)}\n#endif${text.slice(afterFindWindow)}`;
  }
  const blockOpenIndex = afterFindWindow + ifMatch.index + ifMatch[0].lastIndexOf('{');
  let depth = 0;
  for (let index = blockOpenIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const blockEnd = index + 1;
        return `${text.slice(0, startIndex)}#if !UNITY_WEBGL || UNITY_EDITOR\n${text.slice(startIndex, blockEnd)}\n#endif${text.slice(blockEnd)}`;
      }
    }
  }
  throw new Error('Patch marker not found: end of hWnd setup block');
}

function dedupeLine(text, line) {
  let seen = false;
  return text
    .split(/\r?\n/)
    .filter((current) => {
      if (current.trim() !== line) return true;
      if (seen) return false;
      seen = true;
      return true;
    })
    .join('\n');
}

function normalizeRepeatedBridgePatch(text) {
  let next = dedupeLine(text, 'qwicksBridge = QwicksMqpetWebGLBridge.Ensure();');
  next = dedupeLine(next, 'ReportCurrentPetBBoxToQwicks();');
  next = dedupeLine(next, 'qwicksBridge?.SetDragging(isDragging);');
  next = dedupeLine(next, 'private QwicksMqpetWebGLBridge qwicksBridge;');
  next = dedupeLine(next, 'private Transform webglDragTarget;');
  next = dedupeLine(next, 'private Vector3 webglPressScreenPos;');
  next = dedupeLine(next, 'private Vector3 webglDragStartWorld;');
  return next;
}

function removeMethodsByName(text, methodName) {
  let next = text;
  const pattern = new RegExp(`\\r?\\n[ \\t]*private\\s+void\\s+${methodName}\\s*\\(\\)\\s*\\r?\\n[ \\t]*\\{`, 'm');
  while (true) {
    const match = pattern.exec(next);
    if (!match || match.index === undefined) return next;
    const openBraceIndex = match.index + match[0].lastIndexOf('{');
    let depth = 0;
    let endIndex = -1;
    for (let index = openBraceIndex; index < next.length; index += 1) {
      const char = next[index];
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          endIndex = index + 1;
          break;
        }
      }
    }
    if (endIndex < 0) throw new Error(`Patch marker not found: end of ${methodName}`);
    next = `${next.slice(0, match.index)}${next.slice(endIndex)}`;
  }
}

export function patchTransparentWindowForWebGL(filePath) {
  let text = readFileSync(filePath, 'utf8');
  text = normalizeRepeatedBridgePatch(text);
  text = ensureUsing(text, 'System.Collections.Generic');
  text = ensureUsing(text, 'UnityEngine.EventSystems');

  text = insertBeforeRegexOnce(
    text,
    /^[ \t]*private\s+IntPtr\s+hWnd;/m,
    [
      '\tprivate QwicksMqpetWebGLBridge qwicksBridge;',
      '',
      '\tprivate Transform webglDragTarget;',
      '',
      '\tprivate Vector3 webglPressScreenPos;',
      '',
      '\tprivate Vector3 webglDragStartWorld;',
      '',
    ].join('\n'),
    'private IntPtr hWnd;',
  );

  if (!text.includes('qwicksBridge = QwicksMqpetWebGLBridge.Ensure();')) {
    text = replaceRegexOnce(
      text,
      /^([ \t]*)hWnd = FindWindow\(null, Application\.productName\);/m,
      '$1qwicksBridge = QwicksMqpetWebGLBridge.Ensure();\n$1hWnd = FindWindow(null, Application.productName);',
      'hWnd = FindWindow(null, Application.productName);',
    );
  }

  text = guardNativeWindowSetup(text);

  if (!/ReportCurrentPetBBoxToQwicks\(\);\r?\n[ \t]*qwicksBridge\?\.SetDragging\(isDragging\);\r?\n[ \t]*if \(isStartupAnimating\)/.test(text)) {
    text = replaceRegexOnce(
      text,
      /^([ \t]*)if \(isStartupAnimating\)\r?\n\1\{\r?\n[ \t]*return;\r?\n\1\}/m,
      '$1ReportCurrentPetBBoxToQwicks();\n$1qwicksBridge?.SetDragging(isDragging);\n$1if (isStartupAnimating)\n$1{\n$1\treturn;\n$1}',
      'isStartupAnimating guard',
    );
  }

  text = insertWebGLInputBeforeNativeWindowReturn(text);

  const webglInputMethods = `
\tprivate bool IsPointerOverWebGLPet(Vector2 pointer)
\t{
#if UNITY_WEBGL && !UNITY_EDITOR
\t\tif (Camera.main == null)
\t\t{
\t\t\treturn false;
\t\t}
\t\tRay ray = Camera.main.ScreenPointToRay(pointer);
\t\tif (is2DProject)
\t\t{
\t\t\tif (Physics2D.GetRayIntersection(ray, float.PositiveInfinity, petLayer).collider != null)
\t\t\t{
\t\t\t\treturn true;
\t\t\t}
\t\t}
\t\telse if (Physics.Raycast(ray, float.PositiveInfinity, petLayer))
\t\t{
\t\t\treturn true;
\t\t}
\t\tGameObject target = qqObject != null ? qqObject : enterObject;
\t\tif (target == null)
\t\t{
\t\t\treturn false;
\t\t}
\t\tRenderer renderer = target.GetComponentInChildren<Renderer>();
\t\tif (renderer == null)
\t\t{
\t\t\treturn false;
\t\t}
\t\tVector3 min = Camera.main.WorldToScreenPoint(renderer.bounds.min);
\t\tVector3 max = Camera.main.WorldToScreenPoint(renderer.bounds.max);
\t\tRect screenRect = Rect.MinMaxRect(
\t\t\tMathf.Min(min.x, max.x),
\t\t\tMathf.Min(min.y, max.y),
\t\t\tMathf.Max(min.x, max.x),
\t\t\tMathf.Max(min.y, max.y)
\t\t);
\t\treturn screenRect.Contains(pointer);
#else
\t\treturn false;
#endif
\t}

\tprivate bool IsPointerOverWebGLUi(Vector2 pointer)
\t{
#if UNITY_WEBGL && !UNITY_EDITOR
\t\tif (EventSystem.current == null)
\t\t{
\t\t\treturn false;
\t\t}
\t\tPointerEventData pointerEventData = new PointerEventData(EventSystem.current);
\t\tpointerEventData.position = pointer;
\t\tList<RaycastResult> uiHits = new List<RaycastResult>();
\t\tEventSystem.current.RaycastAll(pointerEventData, uiHits);
\t\tforeach (RaycastResult hit in uiHits)
\t\t{
\t\t\tif (hit.gameObject.GetComponent<RectTransform>() != null)
\t\t\t{
\t\t\t\treturn true;
\t\t\t}
\t\t}
\t\treturn false;
#else
\t\treturn false;
#endif
\t}

\tprivate void HandleWebGLPointerInput()
\t{
#if UNITY_WEBGL && !UNITY_EDITOR
\t\tif (Camera.main == null || isDead)
\t\t{
\t\t\tif (isDragging)
\t\t\t{
\t\t\t\tisDragging = false;
\t\t\t\twebglDragTarget = null;
\t\t\t\tqwicksBridge?.SetDragging(false);
\t\t\t}
\t\t\treturn;
\t\t}

\t\tVector2 pointer = Input.mousePosition;
\t\tbool overPet = IsPointerOverWebGLPet(pointer);
\t\tbool overUi = IsPointerOverWebGLUi(pointer);

\t\tif (Input.GetMouseButtonDown(0) && overPet && !overUi && !isDragging)
\t\t{
\t\t\tisDragging = true;
\t\t\tisWindowMoved = false;
\t\t\tcurrentIdleTime = 0f;
\t\t\twebglPressScreenPos = new Vector3(pointer.x, pointer.y, 0f);
\t\t\twebglDragTarget = qqObject != null ? qqObject.transform : (enterObject != null ? enterObject.transform : null);
\t\t\twebglDragStartWorld = webglDragTarget != null ? webglDragTarget.position : Vector3.zero;
\t\t\tqwicksBridge?.SetDragging(true);
\t\t}

\t\tif (isDragging && Input.GetMouseButton(0))
\t\t{
\t\t\tcurrentIdleTime = 0f;
\t\t\tif (Mathf.Abs(pointer.x - webglPressScreenPos.x) > 15f || Mathf.Abs(pointer.y - webglPressScreenPos.y) > 15f)
\t\t\t{
\t\t\t\tisWindowMoved = true;
\t\t\t}
\t\t\tif (webglDragTarget != null)
\t\t\t{
\t\t\t\tfloat depth = Mathf.Max(0.1f, Camera.main.WorldToScreenPoint(webglDragStartWorld).z);
\t\t\t\tVector3 pressWorld = Camera.main.ScreenToWorldPoint(new Vector3(webglPressScreenPos.x, webglPressScreenPos.y, depth));
\t\t\t\tVector3 currentWorld = Camera.main.ScreenToWorldPoint(new Vector3(pointer.x, pointer.y, depth));
\t\t\t\tVector3 delta = currentWorld - pressWorld;
\t\t\t\twebglDragTarget.position = webglDragStartWorld + delta;
\t\t\t}
\t\t\treturn;
\t\t}

\t\tif (isDragging && (Input.GetMouseButtonUp(0) || !Input.GetMouseButton(0)))
\t\t{
\t\t\tbool wasWindowMoved = isWindowMoved;
\t\t\tbool releasedOverPet = overPet;
\t\t\tisDragging = false;
\t\t\twebglDragTarget = null;
\t\t\tqwicksBridge?.SetDragging(false);
\t\t\tif (!wasWindowMoved && releasedOverPet)
\t\t\t{
\t\t\t\tif (!isActionPlaying)
\t\t\t\t{
\t\t\t\t\tPlayRandomInteraction();
\t\t\t\t}
\t\t\t\telse
\t\t\t\t{
\t\t\t\t\tPlayQuestionAnimation();
\t\t\t\t}
\t\t\t}
\t\t}
#endif
\t}

`;

  const method = `
\tprivate void ReportCurrentPetBBoxToQwicks()
\t{
#if UNITY_WEBGL && !UNITY_EDITOR
\t\tif (qwicksBridge == null || Camera.main == null)
\t\t{
\t\t\treturn;
\t\t}
\t\tGameObject target = qqObject != null ? qqObject : enterObject;
\t\tif (target == null)
\t\t{
\t\t\treturn;
\t\t}
\t\tRenderer renderer = target.GetComponentInChildren<Renderer>();
\t\tif (renderer == null)
\t\t{
\t\t\treturn;
\t\t}
\t\tVector3 min = Camera.main.WorldToScreenPoint(renderer.bounds.min);
\t\tVector3 max = Camera.main.WorldToScreenPoint(renderer.bounds.max);
\t\tfloat x = Mathf.Min(min.x, max.x);
\t\tfloat y = Screen.height - Mathf.Max(min.y, max.y);
\t\tfloat width = Mathf.Abs(max.x - min.x);
\t\tfloat height = Mathf.Abs(max.y - min.y);
\t\tqwicksBridge.ReportBBox(new Rect(x, y, width, height));
#endif
\t}

`;

  text = removeMethodsByName(text, 'IsPointerOverWebGLPet');
  text = removeMethodsByName(text, 'IsPointerOverWebGLUi');
  text = removeMethodsByName(text, 'HandleWebGLPointerInput');
  text = removeMethodsByName(text, 'ReportCurrentPetBBoxToQwicks');
  text = insertBeforeRegexOnce(
    text,
    /^[ \t]*private\s+void\s+SetClickThrough\(bool enabled\)/m,
    `${webglInputMethods}${method}`,
    'private void SetClickThrough(bool enabled)',
  );

  text = normalizeRepeatedBridgePatch(text);

  writeFileSync(filePath, text, 'utf8');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const filePath = process.argv[2] || 'C:/Users/given/Desktop/QQpet_extracted/ExportedProject/Assets/Scripts/Assembly-CSharp/TransparentWindow.cs';
  patchTransparentWindowForWebGL(filePath);
  console.log(`Patched ${filePath}`);
}
