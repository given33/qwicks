import { useEffect, useState } from 'react';
import { StatusPanel } from './StatusPanel';
import { InventoryPanel } from './InventoryPanel';
import { ShopPanel } from './ShopPanel';
import { ActivityPanel } from './ActivityPanel';
import { MapPanel } from './MapPanel';
import type { MqPetSave } from '@shared/mqpet-state';
import { defaultSave } from '@shared/mqpet-state';
import type { MqMainCategory, MqSubCategory } from '@shared/mqpet-catalog';
import type { MqpetActivityMode } from '@shared/mqpet-activity';
import {
  normalizeConsolePanelRequest,
  type MqpetConsolePanelRequest,
  type MqpetConsoleTab,
} from '@shared/mqpet-console-panel';
import stateBg from '../../asset/img/mqpet/ui-panels/state.png';
import shopBg from '../../asset/img/mqpet/ui-panels/shop.png';
import bagBg from '../../asset/img/mqpet/ui-panels/bag.png';

type Tab = MqpetConsoleTab;
type Bridge = {
  getState: () => Promise<unknown>;
  onStateChanged: (cb: (s: unknown) => void) => () => void;
  onConsolePanelRequest: (cb: (request: MqpetConsolePanelRequest) => void) => () => void;
  useItem: (id: string) => Promise<unknown>;
  buy: (id: string) => Promise<unknown>;
  toggleConsole: () => Promise<unknown>;
};

function getBridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { mqpet?: Bridge }).mqpet ?? null : null;
}

const BG: Record<Tab, string> = { status: stateBg, inventory: bagBg, shop: shopBg, activity: stateBg, map: stateBg };
const TAB_LABEL: Record<Tab, string> = { status: '状态', inventory: '背包', shop: '商城', activity: '玩法', map: '地图' };

export function ConsoleApp(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('status');
  const [save, setSave] = useState<MqPetSave | null>(null);
  const [inventoryMain, setInventoryMain] = useState<MqMainCategory>('Feeding');
  const [inventorySub, setInventorySub] = useState<MqSubCategory>('Food');
  const [activityMode, setActivityMode] = useState<MqpetActivityMode>('work');

  useEffect(() => {
    const b = getBridge();
    if (!b) {
      setSave(defaultSave());
      return;
    }
    void b.getState().then((s) => setSave(s as MqPetSave));
    const unsubscribeState = b.onStateChanged((s) => setSave(s as MqPetSave));
    const unsubscribePanel = b.onConsolePanelRequest((request) => {
      const panel = normalizeConsolePanelRequest(request);
      setTab(panel.tab);
      if (panel.tab === 'inventory' && panel.main && panel.sub) {
        setInventoryMain(panel.main);
        setInventorySub(panel.sub);
      } else if (panel.tab === 'activity' && panel.mode) {
        setActivityMode(panel.mode);
      }
    });
    return () => {
      unsubscribeState();
      unsubscribePanel();
    };
  }, []);

  return (
    <div style={{ width: 440, height: 540, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <img
        src={BG[tab]}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', paddingTop: 12, gap: 8, position: 'relative' }}>
          {(['status', 'inventory', 'shop', 'activity', 'map'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '4px 14px',
                fontSize: 13,
                cursor: 'pointer',
                background: tab === t ? 'rgba(255,224,130,0.95)' : 'rgba(255,255,255,0.7)',
                border: '2px solid #c98a2b',
                borderRadius: 14,
                color: '#5a3a10',
                fontWeight: tab === t ? 'bold' : 'normal',
              }}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
          <button
            onClick={() => { void getBridge()?.toggleConsole(); }}
            title="关闭"
            style={{
              position: 'absolute',
              right: 10,
              top: 10,
              width: 26,
              height: 26,
              borderRadius: '50%',
              border: '2px solid #c98a2b',
              cursor: 'pointer',
              background: 'rgba(255,255,255,0.9)',
              color: '#c98a2b',
              fontSize: 15,
              fontWeight: 'bold',
              lineHeight: '22px',
              padding: 0,
            }}
          >
            x
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 18px' }}>
          {tab === 'status' && save && <StatusPanel save={save} />}
          {tab === 'inventory' && save && (
            <InventoryPanel save={save} initialMain={inventoryMain} initialSub={inventorySub} />
          )}
          {tab === 'shop' && save && <ShopPanel save={save} />}
          {tab === 'activity' && save && (
            <ActivityPanel save={save} mode={activityMode} onModeChange={setActivityMode} />
          )}
          {tab === 'map' && <MapPanel />}
        </div>
      </div>
    </div>
  );
}
