/**
 * Rivers via flow-accumulation on a heightfield grid.
 * Depression filling + flat resolution so water reaches the ocean.
 */
export function fillDepressions(heights, width, height, seaLevel = 0) {
  const n = width * height;
  const filled = new Float32Array(heights);
  const dx = [1, -1, 0, 0, 1, 1, -1, -1];
  const dy = [0, 0, 1, -1, 1, -1, 1, -1];

  const inQ = new Uint8Array(n);
  const heap = [];
  const push = (e, i) => {
    heap.push([e, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      const t = heap[p]; heap[p] = heap[c]; heap[c] = t;
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (!heap.length) return top;
    heap[0] = last;
    let i = 0;
    for (;;) {
      let l = i * 2 + 1, r = l + 1, s = i;
      if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
      if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
      if (s === i) break;
      const t = heap[i]; heap[i] = heap[s]; heap[s] = t;
      i = s;
    }
    return top;
  };

  for (let i = 0; i < n; i++) {
    if (heights[i] < seaLevel) {
      push(seaLevel, i);
      inQ[i] = 1;
    }
  }
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const i = y * width + x;
      if (!inQ[i]) { push(Math.max(filled[i], seaLevel), i); inQ[i] = 1; }
    }
  }
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      const i = y * width + x;
      if (!inQ[i]) { push(Math.max(filled[i], seaLevel), i); inQ[i] = 1; }
    }
  }

  while (heap.length) {
    const [ce, ci] = pop();
    const x = ci % width;
    const y = (ci / width) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + dx[d];
      const ny = y + dy[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (inQ[ni]) continue;
      inQ[ni] = 1;
      const ne = Math.max(filled[ni], ce);
      filled[ni] = ne;
      push(ne, ni);
    }
  }
  return filled;
}

/**
 * Resolve flats: BFS from lower outlets so every flat cell has a downhill step.
 */
function resolveFlats(filled, heights, width, height, seaLevel) {
  const n = width * height;
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];
  const flowDir = new Int8Array(n);
  flowDir.fill(-1);

  // First pass: steepest descent on filled (strict)
  for (let i = 0; i < n; i++) {
    if (heights[i] < seaLevel) continue;
    const x = i % width;
    const y = (i / width) | 0;
    let best = -1;
    let bestH = filled[i];
    for (let d = 0; d < 8; d++) {
      const nx = x + dx[d];
      const ny = y + dy[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (filled[ni] < bestH - 1e-4) {
        bestH = filled[ni];
        best = d;
      }
    }
    flowDir[i] = best;
  }

  // Gradient on flats: cells with no outlet borrow from neighbors that drain
  let changed = true;
  let iter = 0;
  while (changed && iter++ < 64) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (heights[i] < seaLevel || flowDir[i] >= 0) continue;
      const x = i % width;
      const y = (i / width) | 0;
      // prefer neighbor that already drains, or any lower/equal filled that is ocean
      let best = -1;
      let bestScore = Infinity;
      for (let d = 0; d < 8; d++) {
        const nx = x + dx[d];
        const ny = y + dy[d];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (heights[ni] < seaLevel) {
          best = d; bestScore = -1; break;
        }
        if (flowDir[ni] >= 0 && filled[ni] <= filled[i] + 1e-3) {
          const score = filled[ni];
          if (score < bestScore) { bestScore = score; best = d; }
        }
      }
      if (best >= 0) {
        flowDir[i] = best;
        changed = true;
      }
    }
  }

  // Remaining sinks: force toward any neighbor with lower original height or ocean
  for (let i = 0; i < n; i++) {
    if (heights[i] < seaLevel || flowDir[i] >= 0) continue;
    const x = i % width;
    const y = (i / width) | 0;
    let best = -1;
    let bestH = heights[i];
    for (let d = 0; d < 8; d++) {
      const nx = x + dx[d];
      const ny = y + dy[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (heights[ni] < bestH) { bestH = heights[ni]; best = d; }
    }
    flowDir[i] = best; // may still be -1 for true peak plateaus — rare
  }

  return flowDir;
}

export function computeFlow(heights, width, height, seaLevel = 0) {
  const n = width * height;
  const filled = fillDepressions(heights, width, height, seaLevel);
  const flowDir = resolveFlats(filled, heights, width, height, seaLevel);
  const accum = new Float32Array(n);
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  for (let i = 0; i < n; i++) accum[i] = heights[i] >= seaLevel ? 1 : 0;

  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => filled[b] - filled[a] || heights[b] - heights[a]);

  for (const idx of order) {
    const d = flowDir[idx];
    if (d < 0) continue;
    const x = idx % width;
    const y = (idx / width) | 0;
    const nx = x + dx[d];
    const ny = y + dy[d];
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    accum[ny * width + nx] += accum[idx];
  }

  const lakes = [];
  for (let i = 0; i < n; i++) {
    if (heights[i] < seaLevel) continue;
    if (filled[i] - heights[i] > 20) {
      lakes.push({ i, x: i % width, y: (i / width) | 0, elev: heights[i], fill: filled[i] });
    }
  }

  return { flowDir, accum, lakes, filled };
}

export function extractRiverSegments(heights, flowDir, accum, width, height, threshold, seaLevel = 0) {
  const rivers = [];
  const isRiver = new Uint8Array(width * height);
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  for (let i = 0; i < accum.length; i++) {
    if (heights[i] >= seaLevel && accum[i] >= threshold) isRiver[i] = 1;
  }

  // upstream check helpers
  const hasUpstreamRiver = (i) => {
    const x = i % width;
    const y = (i / width) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x - dx[d]; // neighbor that would flow in dir d to reach i
      const ny = y - dy[d];
      // check all neighbors: if their flow points to i and they are river
      const sx = x + dx[d];
      const sy = y + dy[d];
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const si = sy * width + sx;
      if (!isRiver[si]) continue;
      const fd = flowDir[si];
      if (fd < 0) continue;
      const tx = sx + dx[fd];
      const ty = sy + dy[fd];
      if (tx === x && ty === y) return true;
    }
    return false;
  };

  const visited = new Uint8Array(width * height);
  for (let i = 0; i < accum.length; i++) {
    if (!isRiver[i] || visited[i]) continue;
    // start at headwaters (no upstream river) or any unvisited river cell
    if (hasUpstreamRiver(i)) continue;
    const path = [];
    let cur = i;
    let guard = 0;
    while (cur >= 0 && isRiver[cur] && !visited[cur] && guard++ < width * height) {
      visited[cur] = 1;
      path.push({ x: cur % width, y: (cur / width) | 0, i: cur, accum: accum[cur] });
      const d = flowDir[cur];
      if (d < 0) break;
      const nx = (cur % width) + dx[d];
      const ny = ((cur / width) | 0) + dy[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) break;
      const ni = ny * width + nx;
      if (heights[ni] < seaLevel) {
        path.push({ x: nx, y: ny, i: ni, accum: accum[ni] || 0 });
        break;
      }
      cur = ni;
    }
    if (path.length >= 2) rivers.push(path);
  }

  // Also capture leftover unvisited river cells (loops / mid segments)
  for (let i = 0; i < accum.length; i++) {
    if (!isRiver[i] || visited[i]) continue;
    const path = [];
    let cur = i;
    let guard = 0;
    while (cur >= 0 && isRiver[cur] && guard++ < width * height) {
      if (visited[cur]) {
        path.push({ x: cur % width, y: (cur / width) | 0, i: cur, accum: accum[cur] });
        break;
      }
      visited[cur] = 1;
      path.push({ x: cur % width, y: (cur / width) | 0, i: cur, accum: accum[cur] });
      const d = flowDir[cur];
      if (d < 0) break;
      const nx = (cur % width) + dx[d];
      const ny = ((cur / width) | 0) + dy[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) break;
      cur = ny * width + nx;
    }
    if (path.length >= 2) rivers.push(path);
  }
  return rivers;
}
