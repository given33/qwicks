#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QWICKS_MQPET_JS_LIB = `mergeInto(LibraryManager.library, {
  QwicksMqpet_ReportBBox: function (x, y, width, height) {
    if (typeof window === 'undefined' || !window.qwicksMqpetUnityBridge) return;
    window.qwicksMqpetUnityBridge.reportBBox({ x: x, y: y, width: width, height: height });
  },

  QwicksMqpet_SetDragging: function (dragging) {
    if (typeof window === 'undefined' || !window.qwicksMqpetUnityBridge) return;
    window.qwicksMqpetUnityBridge.setDragging(!!dragging);
  },

  QwicksMqpet_OpenMenu: function (panelPtr) {
    if (typeof window === 'undefined' || !window.qwicksMqpetUnityBridge) return;
    var panel = panelPtr ? UTF8ToString(panelPtr) : '';
    window.qwicksMqpetUnityBridge.openMenu(panel || undefined);
  },

  QwicksMqpet_ReportPetState: function (jsonPtr) {
    if (typeof window === 'undefined' || !window.qwicksMqpetUnityBridge) return;
    var json = jsonPtr ? UTF8ToString(jsonPtr) : '';
    if (window.qwicksMqpetUnityBridge.reportPetState) {
      window.qwicksMqpetUnityBridge.reportPetState(json || "{}");
    }
  },

  QwicksMqpet_Log: function (messagePtr) {
    if (typeof window === 'undefined' || !window.qwicksMqpetUnityBridge) return;
    var message = messagePtr ? UTF8ToString(messagePtr) : '';
    if (window.qwicksMqpetUnityBridge.log) window.qwicksMqpetUnityBridge.log(message);
  }
});
`;

export const QWICKS_MQPET_CS_BRIDGE = `using System.Runtime.InteropServices;
using UnityEngine;

public sealed class QwicksMqpetWebGLBridge : MonoBehaviour
{
    public static QwicksMqpetWebGLBridge Instance { get; private set; }

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern void QwicksMqpet_ReportBBox(float x, float y, float width, float height);

    [DllImport("__Internal")]
    private static extern void QwicksMqpet_SetDragging(int dragging);

    [DllImport("__Internal")]
    private static extern void QwicksMqpet_OpenMenu(string panel);

    [DllImport("__Internal")]
    private static extern void QwicksMqpet_ReportPetState(string json);

    [DllImport("__Internal")]
    private static extern void QwicksMqpet_Log(string message);
#endif

    private void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }

        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    public void ReportBBox(Rect rect)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        QwicksMqpet_ReportBBox(rect.x, rect.y, rect.width, rect.height);
#endif
    }

    public void SetDragging(bool dragging)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        QwicksMqpet_SetDragging(dragging ? 1 : 0);
#endif
    }

    public void OpenMenu(string panel)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        QwicksMqpet_OpenMenu(panel ?? string.Empty);
#endif
    }

    public void Log(string message)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        QwicksMqpet_Log(message ?? string.Empty);
#endif
    }

    [System.Serializable]
    private sealed class QwicksPetSaveSnapshot
    {
        public QwicksPetStateSnapshot state;
    }

    [System.Serializable]
    private sealed class QwicksPetStateSnapshot
    {
        public int level;
        public float growth;
        public float gold;
        public float hunger;
        public float cleanliness;
        public float health;
        public float mood;
        public float stamina;
        public float intelligence;
        public float stressResistance;
        public float charm;
        public string activity;
        public int workTimer;
        public int workTarget;
        public int interactionCount;
    }

    public void ReportPetState()
    {
        if (PetDataManager.Instance == null) return;

        QwicksPetSaveSnapshot save = new QwicksPetSaveSnapshot
        {
            state = CreateStateSnapshot(PetDataManager.Instance)
        };

#if UNITY_WEBGL && !UNITY_EDITOR
        QwicksMqpet_ReportPetState(JsonUtility.ToJson(save));
#endif
    }

    private static QwicksPetStateSnapshot CreateStateSnapshot(PetDataManager pet)
    {
        return new QwicksPetStateSnapshot
        {
            level = pet.currentLevel,
            growth = pet.growthValue,
            gold = pet.gold,
            hunger = pet.hunger,
            cleanliness = pet.cleanliness,
            health = pet.health,
            mood = pet.mood,
            stamina = pet.stamina,
            intelligence = pet.intelligence,
            stressResistance = pet.stressResistance,
            charm = pet.charm,
            activity = pet.currentActivity.ToString(),
            workTimer = GetPrivateInt(pet, "currentActionTimer"),
            workTarget = GetPrivateInt(pet, "targetActionDuration"),
            interactionCount = pet.currentInteractionCount
        };
    }

    public void HandleQwicksPetState(string json)
    {
        if (string.IsNullOrEmpty(json) || PetDataManager.Instance == null) return;

        QwicksPetSaveSnapshot snapshot;
        try
        {
            snapshot = JsonUtility.FromJson<QwicksPetSaveSnapshot>(json);
        }
        catch (System.Exception ex)
        {
            Debug.LogWarning("QWicks QQPet failed to parse pet state: " + ex.Message);
            return;
        }

        if (snapshot == null || snapshot.state == null) return;

        PetDataManager.Instance.currentLevel = Mathf.Max(1, snapshot.state.level);
        PetDataManager.Instance.growthValue = Mathf.Max(0f, snapshot.state.growth);
        PetDataManager.Instance.gold = snapshot.state.gold;
        PetDataManager.Instance.hunger = snapshot.state.hunger;
        PetDataManager.Instance.cleanliness = snapshot.state.cleanliness;
        PetDataManager.Instance.health = snapshot.state.health;
        PetDataManager.Instance.mood = snapshot.state.mood;
        PetDataManager.Instance.stamina = snapshot.state.stamina;
        PetDataManager.Instance.intelligence = snapshot.state.intelligence;
        PetDataManager.Instance.stressResistance = snapshot.state.stressResistance;
        PetDataManager.Instance.charm = snapshot.state.charm;
        PetDataManager.Instance.currentInteractionCount = snapshot.state.interactionCount;
        PetDataManager.Instance.currentActivity = ParseActivity(snapshot.state.activity);
        SetPrivateInt(PetDataManager.Instance, "currentActionTimer", snapshot.state.workTimer);
        SetPrivateInt(PetDataManager.Instance, "targetActionDuration", snapshot.state.workTarget);
    }

    private static void SetPrivateInt(PetDataManager target, string fieldName, int value)
    {
        System.Reflection.FieldInfo field = typeof(PetDataManager).GetField(
            fieldName,
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        if (field != null) field.SetValue(target, Mathf.Max(0, value));
    }

    private static int GetPrivateInt(PetDataManager target, string fieldName)
    {
        System.Reflection.FieldInfo field = typeof(PetDataManager).GetField(
            fieldName,
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        if (field == null) return 0;
        object value = field.GetValue(target);
        return value is int intValue ? Mathf.Max(0, intValue) : 0;
    }

    private static PetDataManager.PetActivity ParseActivity(string activity)
    {
        switch ((activity ?? string.Empty).Trim().ToLowerInvariant())
        {
            case "working":
                return PetDataManager.PetActivity.Working;
            case "learning":
                return PetDataManager.PetActivity.Learning;
            case "playing":
                return PetDataManager.PetActivity.Playing;
            default:
                return PetDataManager.PetActivity.Idle;
        }
    }

    public void HandleQwicksMenuAction(string action)
    {
        string normalized = (action ?? string.Empty).Trim().ToLowerInvariant();
        PetInteractFinal petInteract = FindObjectOfType<PetInteractFinal>();

        switch (normalized)
        {
            case "feed":
                if (petInteract != null)
                {
                    petInteract.OnClick_Feed();
                }
                else if (InventoryManager.Instance != null)
                {
                    InventoryManager.Instance.OpenBag(0);
                }
                break;
            case "clean":
                if (petInteract != null)
                {
                    petInteract.OnClick_Clean();
                }
                else if (InventoryManager.Instance != null)
                {
                    InventoryManager.Instance.OpenBag(1);
                }
                break;
            case "heal":
            case "medical":
                if (petInteract != null)
                {
                    petInteract.OnClick_Medical();
                }
                else if (InventoryManager.Instance != null)
                {
                    InventoryManager.Instance.OpenBag(2);
                }
                break;
            case "bag":
                if (InventoryManager.Instance != null)
                {
                    InventoryManager.Instance.OpenBag(0);
                }
                break;
            case "shop":
                if (ShopManager.Instance != null)
                {
                    ShopManager.Instance.OpenShop();
                }
                break;
            case "work":
                if (petInteract != null)
                {
                    petInteract.OnClick_Work();
                }
                else if (PetDataManager.Instance != null)
                {
                    PetDataManager.Instance.StartWorking();
                }
                break;
            case "learn":
                if (petInteract != null)
                {
                    petInteract.OnClick_Learn();
                }
                else if (PetDataManager.Instance != null)
                {
                    PetDataManager.Instance.StartLearning();
                }
                break;
            case "map":
                if (petInteract != null)
                {
                    petInteract.OnClick_Map();
                }
                break;
            case "status":
                if (petInteract != null)
                {
                    petInteract.OnClick_Status();
                }
                break;
            default:
                Debug.LogWarning($"QWicks QQPet received unsupported menu action: {action}");
                break;
        }

        ReportPetState();
    }

    public static QwicksMqpetWebGLBridge Ensure()
    {
        if (Instance != null) return Instance;
        GameObject go = new GameObject("QwicksMqpetWebGLBridge");
        return go.AddComponent<QwicksMqpetWebGLBridge>();
    }
}
`;

export function syncUnityWebGLBridge(projectRoot) {
  const root = resolve(projectRoot);
  const jslibPath = join(root, 'Assets', 'Plugins', 'WebGL', 'QwicksMqpetBridge.jslib');
  const csPath = join(root, 'Assets', 'Scripts', 'Assembly-CSharp', 'QwicksMqpetWebGLBridge.cs');

  mkdirSync(join(root, 'Assets', 'Plugins', 'WebGL'), { recursive: true });
  mkdirSync(join(root, 'Assets', 'Scripts', 'Assembly-CSharp'), { recursive: true });
  writeFileSync(jslibPath, QWICKS_MQPET_JS_LIB, 'utf8');
  writeFileSync(csPath, QWICKS_MQPET_CS_BRIDGE, 'utf8');
  return { jslibPath, csPath };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const projectRoot = process.argv[2] || 'C:/Users/given/Desktop/QQpet_extracted/ExportedProject';
  const result = syncUnityWebGLBridge(projectRoot);
  console.log(`Wrote ${result.jslibPath}`);
  console.log(`Wrote ${result.csPath}`);
}
