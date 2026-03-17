/**
 * Grid Selector — CSS Grid-style area picker for defining panel workspace.
 *
 * Shows the game viewport divided into a grid. User clicks and drags
 * to select cells. Returns the selected area as edges (l, t, r, b).
 */

// Game viewport (Dofus 1.29)
const GAME_W = 860;
const GAME_H = 432; // game area only (no banner)
const BANNER_H = 128;
const TOTAL_H = GAME_H + BANNER_H;

// Grid config
const COLS = 12;
const ROWS = 8;
const CELL_W = GAME_W / COLS;
const CELL_H = GAME_H / ROWS;

export interface GridArea {
  col1: number; row1: number; // start (inclusive)
  col2: number; row2: number; // end (inclusive)
}

export interface GridResult {
  area: GridArea;
  edges: { l: number; t: number; r: number; b: number };
  w: number;
  h: number;
}

export function gridAreaToEdges(area: GridArea): { l: number; t: number; r: number; b: number; w: number; h: number } {
  const l = Math.round(area.col1 * CELL_W);
  const t = Math.round(area.row1 * CELL_H);
  const r = Math.round((area.col2 + 1) * CELL_W);
  const b = Math.round((area.row2 + 1) * CELL_H);
  return { l, t, r, b, w: r - l, h: b - t };
}

/**
 * Show the grid selector overlay. Returns a promise that resolves
 * with the selected area, or null if cancelled.
 */
export function showGridSelector(): Promise<GridResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:10000;
      background:#111; display:flex; flex-direction:column;
      align-items:center; justify-content:center;
      font-family:'Segoe UI',system-ui,sans-serif;
    `;

    // Title
    const title = document.createElement('div');
    title.style.cssText = 'color:#888;font-size:12px;margin-bottom:12px;text-align:center';
    title.innerHTML = 'Sélectionne la zone de travail <span style="color:#555">— clique et glisse sur la grille</span>';
    overlay.appendChild(title);

    // Viewport container (scaled to fit screen)
    const vpWrap = document.createElement('div');
    const maxW = window.innerWidth * 0.8;
    const maxH = window.innerHeight * 0.7;
    const vpScale = Math.min(maxW / GAME_W, maxH / TOTAL_H);
    const scaledW = GAME_W * vpScale;
    const scaledTotalH = TOTAL_H * vpScale;
    const scaledGameH = GAME_H * vpScale;

    vpWrap.style.cssText = `
      position:relative; width:${scaledW}px; height:${scaledTotalH}px;
      border:1px solid #333; border-radius:4px; overflow:hidden;
    `;

    // Game area bg
    const gameArea = document.createElement('div');
    gameArea.style.cssText = `
      position:absolute; top:0; left:0;
      width:${scaledW}px; height:${scaledGameH}px;
      background:#1a1a1a;
    `;
    vpWrap.appendChild(gameArea);

    // Banner area
    const bannerArea = document.createElement('div');
    bannerArea.style.cssText = `
      position:absolute; bottom:0; left:0;
      width:${scaledW}px; height:${BANNER_H * vpScale}px;
      background:#3a3628;
    `;
    const bannerLabel = document.createElement('div');
    bannerLabel.style.cssText = 'color:#555;font-size:10px;padding:4px 8px';
    bannerLabel.textContent = 'Banner';
    bannerArea.appendChild(bannerLabel);
    vpWrap.appendChild(bannerArea);

    // Grid overlay (only on game area)
    const gridEl = document.createElement('div');
    gridEl.style.cssText = `
      position:absolute; top:0; left:0;
      width:${scaledW}px; height:${scaledGameH}px;
      display:grid;
      grid-template-columns:repeat(${COLS}, 1fr);
      grid-template-rows:repeat(${ROWS}, 1fr);
    `;

    // Selection state
    let selecting = false;
    let startCol = 0, startRow = 0;
    let endCol = 0, endRow = 0;
    const cells: HTMLDivElement[] = [];

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = document.createElement('div');
        cell.style.cssText = `
          border:1px solid rgba(255,255,255,0.06);
          transition:background 0.1s;
          cursor:crosshair;
        `;
        cell.dataset.col = String(col);
        cell.dataset.row = String(row);

        cell.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selecting = true;
          startCol = endCol = col;
          startRow = endRow = row;
          updateSelection();
        });

        cell.addEventListener('mouseenter', () => {
          if (!selecting) return;
          endCol = col;
          endRow = row;
          updateSelection();
        });

        cells.push(cell);
        gridEl.appendChild(cell);
      }
    }

    document.addEventListener('mouseup', onMouseUp);

    function onMouseUp() {
      if (!selecting) return;
      selecting = false;
      document.removeEventListener('mouseup', onMouseUp);

      const area = normalizeArea();
      if (area.col1 === area.col2 && area.row1 === area.row2) {
        // Single cell — too small, ignore
        return;
      }

      const edges = gridAreaToEdges(area);
      overlay.remove();
      resolve({ area, edges: { l: edges.l, t: edges.t, r: edges.r, b: edges.b }, w: edges.w, h: edges.h });
    }

    function normalizeArea(): GridArea {
      return {
        col1: Math.min(startCol, endCol),
        row1: Math.min(startRow, endRow),
        col2: Math.max(startCol, endCol),
        row2: Math.max(startRow, endRow),
      };
    }

    function updateSelection() {
      const sel = normalizeArea();
      for (const c of cells) {
        const cc = parseInt(c.dataset.col!);
        const cr = parseInt(c.dataset.row!);
        const inSel = cc >= sel.col1 && cc <= sel.col2 && cr >= sel.row1 && cr <= sel.row2;
        c.style.background = inSel ? 'rgba(0,120,212,0.35)' : 'transparent';
        c.style.borderColor = inSel ? 'rgba(0,120,212,0.6)' : 'rgba(255,255,255,0.06)';
      }
      // Update info
      const e = gridAreaToEdges(sel);
      info.textContent = `${sel.col2 - sel.col1 + 1} x ${sel.row2 - sel.row1 + 1} cells — ${e.w} x ${e.h} px`;
    }

    vpWrap.appendChild(gridEl);

    // Grid labels (column numbers)
    const colLabels = document.createElement('div');
    colLabels.style.cssText = `
      position:absolute; top:-16px; left:0;
      width:${scaledW}px; display:flex;
    `;
    for (let c = 0; c < COLS; c++) {
      const lbl = document.createElement('div');
      lbl.style.cssText = `flex:1;text-align:center;font-size:9px;color:#444`;
      lbl.textContent = String(c + 1);
      colLabels.appendChild(lbl);
    }
    vpWrap.appendChild(colLabels);

    // Row labels
    const rowLabels = document.createElement('div');
    rowLabels.style.cssText = `
      position:absolute; top:0; left:-18px;
      height:${scaledGameH}px; display:flex; flex-direction:column;
    `;
    for (let r = 0; r < ROWS; r++) {
      const lbl = document.createElement('div');
      lbl.style.cssText = `flex:1;display:flex;align-items:center;font-size:9px;color:#444`;
      lbl.textContent = String(r + 1);
      rowLabels.appendChild(lbl);
    }
    vpWrap.appendChild(rowLabels);

    overlay.appendChild(vpWrap);

    // Info + actions
    const bottomBar = document.createElement('div');
    bottomBar.style.cssText = 'display:flex;align-items:center;gap:16px;margin-top:12px';

    const info = document.createElement('div');
    info.style.cssText = 'color:#555;font-size:11px;font-family:monospace';
    info.textContent = 'Sélectionne une zone...';
    bottomBar.appendChild(info);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Annuler';
    cancelBtn.style.cssText = 'background:#333;border:1px solid #444;color:#aaa;padding:6px 16px;border-radius:4px;cursor:pointer;font-size:11px';
    cancelBtn.addEventListener('click', () => {
      document.removeEventListener('mouseup', onMouseUp);
      overlay.remove();
      resolve(null);
    });
    bottomBar.appendChild(cancelBtn);

    overlay.appendChild(bottomBar);

    // Escape to cancel
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('mouseup', onMouseUp);
        overlay.remove();
        resolve(null);
      }
    };
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
  });
}
