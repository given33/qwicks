import { useEffect, useState } from 'react';
import { MQ_ITEM_BY_ID, type MqMainCategory, type MqSubCategory } from '@shared/mqpet-catalog';
import type { MqPetSave } from '@shared/mqpet-state';

const SUBS: Record<MqMainCategory, MqSubCategory[]> = {
  Feeding: ['Food', 'Daily', 'Medicine'],
  Function: ['Toy', 'Stats'],
  DressUp: ['Background', 'Props'],
};
const MAIN_LABEL: Record<MqMainCategory, string> = { Feeding: '喂养', Function: '功能', DressUp: '装扮' };
const SUB_LABEL: Partial<Record<MqSubCategory, string>> = {
  Food: '食品',
  Daily: '日用',
  Medicine: '药品',
  Toy: '玩具',
  Stats: '属性',
  Background: '背景',
  Props: '挂件',
};

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
  const perPage = 6;

  useEffect(() => {
    setMain(initialMain);
    setSub(initialSub);
    setPage(0);
  }, [initialMain, initialSub]);

  const owned = save.inventory
    .map((i) => ({ ...MQ_ITEM_BY_ID[i.itemId], count: i.count }))
    .filter((it) => it && it.main === main && it.sub === sub);
  const maxPage = Math.max(0, Math.ceil(owned.length / perPage) - 1);
  const pageItems = owned.slice(page * perPage, page * perPage + perPage);

  return (
    <div style={{ padding: 12, color: '#5a3a10' }}>
      <div style={{ marginBottom: 8 }}>
        {(['Feeding', 'Function', 'DressUp'] as MqMainCategory[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMain(m); setSub(SUBS[m][0]); setPage(0); }}
            style={{
              marginRight: 4,
              background: main === m ? '#ffe082' : 'transparent',
              border: '1px solid #f9a825',
              padding: '2px 8px',
              cursor: 'pointer',
            }}
          >
            {MAIN_LABEL[m]}
          </button>
        ))}
        {SUBS[main].map((nextSub) => (
          <button
            key={nextSub}
            onClick={() => { setSub(nextSub); setPage(0); }}
            style={{
              marginRight: 4,
              marginLeft: 8,
              background: sub === nextSub ? '#fff3c4' : 'transparent',
              border: '1px solid #fbc02d',
              padding: '2px 6px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {SUB_LABEL[nextSub] ?? nextSub}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
        {pageItems.map((it) => (
          <button
            key={it.id}
            onClick={() => { void getBridge()?.useItem(it.id); }}
            style={{ background: '#fff', border: '1px solid #f9a825', padding: 4, textAlign: 'center', cursor: 'pointer' }}
            title={`使用 ${it.name}`}
          >
            <div>{it.name}</div>
            <div style={{ fontSize: 11 }}>x{it.count}</div>
          </button>
        ))}
        {pageItems.length === 0 && (
          <div style={{ gridColumn: 'span 3', textAlign: 'center', color: '#8a7b63', paddingTop: 24 }}>
            这个分类下还没有道具
          </div>
        )}
      </div>
      <div style={{ marginTop: 8, textAlign: 'center' }}>
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={{ cursor: page === 0 ? 'default' : 'pointer' }}>上一页</button>
        <span style={{ margin: '0 8px' }}>{page + 1}/{maxPage + 1}</span>
        <button disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)} style={{ cursor: page >= maxPage ? 'default' : 'pointer' }}>下一页</button>
      </div>
    </div>
  );
}
