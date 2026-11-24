import { CODEX_ENTRIES } from '../core/codex-data';
import type { AudioAPI, GameId, GameMeta } from '../core/game-interface';
import type { SaveStore } from '../core/save-store';
import { attachArwesFrame } from './arwes-frames';
import { UI_ICONS } from './icons';

export function buildCodexModal(
  metas: GameMeta[],
  save: SaveStore,
  audio: AudioAPI,
  onClose: () => void,
  initialFilter: GameId | 'all' = 'all',
  highlightId?: string
): HTMLElement {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', '航天科普档案馆');

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      audio.playClick();
      onClose();
    }
  });

  const panel = document.createElement('div');
  panel.className = 'modal-panel';

  const header = document.createElement('div');
  header.className = 'modal-header';
  header.innerHTML = `
    <div class="modal-title-group">
      <h2>航天科普档案馆 · ORBITAL CODEX</h2>
      <p>共 24 条空间站核心科学原理档案 · 已收录 <span class="mono-num" data-codex-count>${save.getUnlockedCodexCount()}/${CODEX_ENTRIES.length}</span></p>
    </div>
  `;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
  closeBtn.setAttribute('aria-label', '关闭科普档案');
  closeBtn.innerHTML = `<span class="ui-svg-icon">${UI_ICONS.close}</span>`;
  closeBtn.addEventListener('click', () => {
    audio.playClick();
    onClose();
  });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'modal-body';

  let currentFilter: GameId | 'all' = initialFilter;
  const tabsWrap = document.createElement('div');
  tabsWrap.className = 'codex-tabs';

  const grid = document.createElement('div');
  grid.className = 'codex-grid';

  const renderCards = () => {
    const countSpan = header.querySelector('[data-codex-count]');
    if (countSpan) countSpan.textContent = `${save.getUnlockedCodexCount()}/${CODEX_ENTRIES.length}`;

    grid.innerHTML = '';
    const list =
      currentFilter === 'all'
        ? CODEX_ENTRIES
        : CODEX_ENTRIES.filter((entry) => entry.gameId === currentFilter);

    for (const entry of list) {
      const unlocked = save.isCodexUnlocked(entry.id);
      const card = document.createElement('article');
      card.className = `codex-card${unlocked ? ' is-unlocked' : ''}`;
      card.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
      if (highlightId && entry.id === highlightId) {
        card.style.filter = 'drop-shadow(0 0 14px rgba(0,216,255,0.5))';
      }

      if (unlocked) {
        card.innerHTML = `
          <div class="codex-card-head">
            <span class="codex-card-title">${entry.title}</span>
            <span class="codex-card-badge">${entry.category}</span>
          </div>
          <div class="codex-card-param">${entry.realParam}</div>
          <div class="codex-diagram">${entry.diagramSvg}</div>
          <p class="codex-summary">${entry.summary}</p>
          <div class="codex-link-box"><strong>游戏机制映射：</strong>${entry.inGameLink}</div>
        `;
      } else {
        card.innerHTML = `
          <div class="codex-card-head">
            <span class="codex-card-title">${entry.title}</span>
            <span class="codex-card-badge" style="color:var(--text-muted)">待解锁</span>
          </div>
          <div class="codex-diagram" style="opacity:0.42;filter:grayscale(0.6)">${entry.diagramSvg}</div>
          <p class="codex-summary">游玩对应舱段任务即可自动解锁完整参数与原理对照，或点击下方直接提前查阅。</p>
        `;
        const unlockBtn = document.createElement('button');
        unlockBtn.type = 'button';
        unlockBtn.className = 'btn-secondary';
        unlockBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
        unlockBtn.style.alignSelf = 'flex-start';
        unlockBtn.textContent = '提前解锁阅读';
        unlockBtn.addEventListener('click', () => {
          audio.playSwitch();
          save.unlockCodex(entry.id);
          renderCards();
        });
        card.appendChild(unlockBtn);
      }
      grid.appendChild(card);
    }
  };

  const renderTabs = () => {
    tabsWrap.innerHTML = '';
    const allTab = document.createElement('button');
    allTab.type = 'button';
    allTab.className = `codex-tab${currentFilter === 'all' ? ' is-active' : ''}`;
    allTab.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    allTab.textContent = `全部 (24)`;
    allTab.addEventListener('click', () => {
      audio.playClick();
      currentFilter = 'all';
      renderTabs();
      renderCards();
    });
    tabsWrap.appendChild(allTab);

    for (const m of metas) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = `codex-tab${currentFilter === m.id ? ' is-active' : ''}`;
      t.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
      t.textContent = `${m.number} ${m.shortTitle}`;
      t.addEventListener('click', () => {
        audio.playClick();
        currentFilter = m.id;
        renderTabs();
        renderCards();
      });
      tabsWrap.appendChild(t);
    }
  };

  renderTabs();
  renderCards();

  body.appendChild(tabsWrap);
  body.appendChild(grid);
  panel.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn-primary';
  doneBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
  doneBtn.textContent = '返回轨道任务 (Esc)';
  doneBtn.addEventListener('click', () => {
    audio.playClick();
    onClose();
  });
  footer.appendChild(doneBtn);
  panel.appendChild(footer);

  attachArwesFrame(panel, 'kranox', { strokeWidth: 1.6, squareSize: 16 });
  backdrop.appendChild(panel);
  return backdrop;
}
