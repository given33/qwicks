// src/renderer-mqconsole/src/InventoryPanel.tsx
import { useEffect, useState } from 'react';
import { MQ_ITEM_BY_ID, type MqMainCategory, type MqSubCategory } from '@shared/mqpet-catalog';
import type { MqPetSave } from '@shared/mqpet-state';

const SUBS: Record<MqMainCategory, MqSubCategory[]> = {
  Feeding: ['Food', 'Daily', 'Medicine'],
  Function: ['Toy', 'Stats'],
  DressUp: ['Background', 'Props'],
};
const MAIN_LABEL: Record<MqMainCategory, string> = { Feeding: '喂养', Function: '功能', DressUp: '装扮' };
type Bridge = { useItem: (id: string) => Promise<unknown> };
function getBridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { mqpet?: Bridge }).mqpet ?? null : null;
}

export function InventoryPanel({
  save,
  initialMain = 'Feeding',
  initialSub = 'Food',
}: {
  save: MqPetSave;
  initialMain?: MqMainCategory;
  initialSub?: MqSubCategory;
}): React.ReactElement {
  const [main, setMain] = useState<MqMainCategory>(initialMain);
  const [sub, setSub] = useState<MqSubCategory>(initialSub);
  const [page, setPage] = useState(0);
  const PER = 6;

  useEffect(() => {
    setMain(initialMain);
    setSub(initialSub);
    setPage(0);
  }, [initialMain, initialSub]);

  const owned = save.inventory
    .map((i) => ({ ...MQ_ITEM_BY_ID[i.itemId], count: i.count }))
    .filter((it) => it && it.main === main && it.sub === sub);
  const maxPage = Math.max(0, Math.ceil(owned.length / PER) - 1);
  const pageItems = owned.slice(page * PER, page * PER + PER);
  return (
    <div style={{ padding: 12 }}>
      <div style={{ marginBottom: 8 }}>
        {(['Feeding', 'Function', 'DressUp'] as MqMainCategory[]).map((m) => (
          <button key={m} onClick={() => { setMain(m); setSub(SUBS[m][0]); setPage(0); }}
            style={{ marginRight: 4, background: main === m ? '#ffe082' : 'transparent',
                     border: '1px solid #f9a825', padding: '2px 8px', cursor: 'pointer' }}>
            {MAIN_LABEL[m]}
          </button>
        ))}
        {SUBS[main].map((s2) => (
          <button key={s2} onClick={() => { setSub(s2); setPage(0); }}
            style={{ marginRight: 4, marginLeft: 8, background: sub === s2 ? '#fff3c4' : 'transparent',
                     border: '1px solid #fbc02d', padding: '2px 6px', fontSize: 11, cursor: 'pointer' }}>
            {s2}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
        {pageItems.map((it) => (
          <button key={it.id} onClick={() => { void getBridge()?.useItem(it.id); }}
            style={{ background: '#fff', border: '1px solid #f9a825', padding: 4, textAlign: 'center', cursor: 'pointer' }}
            title={`使用 ${it.name}`}>
            <div>{it.name}</div>
            <div style={{ fontSize: 11 }}>x{it.count}</div>
          </button>
        ))}
        {pageItems.length === 0 && <div style={{ gridColumn: 'span 3', textAlign: 'center', color: '#999' }}>此分类下无道具</div>}
      </div>
      <div style={{ marginTop: 8, textAlign: 'center' }}>
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={{ cursor: page === 0 ? 'default' : 'pointer' }}>上一页</button>
        <span style={{ margin: '0 8px' }}>{page + 1}/{maxPage + 1}</span>
        <button disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)} style={{ cursor: page >= maxPage ? 'default' : 'pointer' }}>下一页</button>
      </div>
    </div>
  );
}
