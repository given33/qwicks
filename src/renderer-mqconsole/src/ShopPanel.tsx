// src/renderer-mqconsole/src/ShopPanel.tsx
import { useState } from 'react';
import { MQ_ITEMS, type MqMainCategory, type MqSubCategory } from '@shared/mqpet-catalog';
import type { MqPetSave } from '@shared/mqpet-state';

const SUBS: Record<MqMainCategory, MqSubCategory[]> = {
  Feeding: ['Food', 'Daily', 'Medicine'],
  Function: ['Toy', 'Stats'],
  DressUp: ['Background', 'Props'],
};
const MAIN_LABEL: Record<MqMainCategory, string> = { Feeding: '喂养', Function: '功能', DressUp: '装扮' };
type Bridge = { buy: (id: string) => Promise<unknown> };
function getBridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { mqpet?: Bridge }).mqpet ?? null : null;
}

export function ShopPanel({ save }: { save: MqPetSave }): React.ReactElement {
  const [main, setMain] = useState<MqMainCategory>('Feeding');
  const [sub, setSub] = useState<MqSubCategory>('Food');
  const [page, setPage] = useState(0);
  const PER = 8;
  const items = MQ_ITEMS.filter((it) => it.main === main && it.sub === sub);
  const maxPage = Math.max(0, Math.ceil(items.length / PER) - 1);
  const pageItems = items.slice(page * PER, page * PER + PER);
  const gold = Math.floor(save.state.gold);
  const lvl = save.state.level;
  return (
    <div style={{ padding: 12 }}>
      <div style={{ marginBottom: 8 }}>元宝: {gold}</div>
      <div style={{ marginBottom: 8 }}>
        {(['Feeding', 'Function', 'DressUp'] as MqMainCategory[]).map((m) => (
          <button key={m} onClick={() => { setMain(m); setSub(SUBS[m][0]); setPage(0); }}
            style={{ marginRight: 4, background: main === m ? '#ffe082' : 'transparent',
                     border: '1px solid #f9a825', padding: '2px 8px', cursor: 'pointer' }}>
            {MAIN_LABEL[m]}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, fontSize: 11 }}>
        {pageItems.map((it) => {
          const locked = lvl < it.unlockLevel;
          const afford = gold >= it.price && !locked;
          return (
            <button key={it.id} disabled={!afford}
              onClick={() => { void getBridge()?.buy(it.id); }}
              style={{ background: '#fff', border: '1px solid #f9a825', padding: 4, textAlign: 'center',
                       opacity: afford ? 1 : 0.5, cursor: afford ? 'pointer' : 'not-allowed' }}>
              <div>{it.name}</div>
              <div style={{ color: gold >= it.price ? '#8B4513' : 'red' }}>{it.price}</div>
              <div style={{ color: locked ? 'red' : 'green' }}>{locked ? `需${it.unlockLevel}级` : `${it.unlockLevel}级`}</div>
            </button>
          );
        })}
        {pageItems.length === 0 && <div style={{ gridColumn: 'span 4', textAlign: 'center', color: '#999' }}>此分类下无商品</div>}
      </div>
      <div style={{ marginTop: 8, textAlign: 'center' }}>
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={{ cursor: page === 0 ? 'default' : 'pointer' }}>上一页</button>
        <span style={{ margin: '0 8px' }}>{page + 1}/{maxPage + 1}</span>
        <button disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)} style={{ cursor: page >= maxPage ? 'default' : 'pointer' }}>下一页</button>
      </div>
    </div>
  );
}
