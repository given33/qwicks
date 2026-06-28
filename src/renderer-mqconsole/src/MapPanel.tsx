const MAP_NODES = [
  { name: '国王', role: '地图 NPC', anim: '国王' },
  { name: '杰无双', role: '任务 NPC', anim: '杰无双' },
  { name: '科洛', role: '学习 NPC', anim: '科洛' },
  { name: '多多', role: '日常 NPC', anim: '多多' },
  { name: '九尾妖狐', role: '活动 NPC', anim: '九尾妖狐' },
  { name: '花小妹', role: '商店 NPC', anim: '花小妹' },
];

export function MapPanel(): React.ReactElement {
  return (
    <div style={{ padding: 12, fontSize: 13, color: '#5a3a10' }}>
      <div style={{ fontWeight: 'bold', marginBottom: 8 }}>QQPet 地图</div>
      <div style={{ marginBottom: 10 }}>
        源工程里地图入口已接到菜单，当前可复用的地图角色动画如下，后续打工、学习小游戏可以挂到这些节点。
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {MAP_NODES.map((node) => (
          <div
            key={node.name}
            style={{
              border: '1px solid #d59a3a',
              background: 'rgba(255,255,255,0.76)',
              padding: 8,
              minHeight: 58,
            }}
          >
            <div style={{ fontWeight: 'bold' }}>{node.name}</div>
            <div>{node.role}</div>
            <div style={{ fontSize: 11, color: '#8b6a24' }}>anim: {node.anim}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
