
/*
 * XSMB V1 - POSITIONAL TRANSFER MATCHER
 * Version 6.0.0
 *
 * Quy tắc:
 * 1. Ngày N xác định các cặp chữ số và tọa độ ghép hợp lệ.
 * 2. Chỉ giữ mẫu có cùng cặp có mặt tại ít nhất 4 cặp tọa độ khác nhau.
 * 3. Ưu tiên mẫu có nhiều tọa độ hợp lệ hơn; dùng toàn bộ tọa độ của mẫu.
 * 4. Áp dụng nguyên tọa độ đó lên ngày N-1 để tạo cặp mới.
 * 5. Đối chiếu cặp mới với đuôi 2 số của mọi giải DB-G7 ngày N.
 * 6. Chỉ giữ cặp khớp; gộp cặp đảo chiều khi trình bày, không mất occurrence.
 * 7. Không tự tạo số và không cắt Top 10/15 theo tần suất.
 *
 * Bố cục dữ liệu theo thứ tự mảng Worker trả về:
 * G3/G5: 2 hàng x 3 cột; G6: 1 hàng x 3 cột.
 */
(function (root) {
  "use strict";

  const VERSION = "XSMB V1 POSITIONAL TRANSFER MATCHER 6.0.0";
  const MIN_POSITION_COUNT = 4;
  const PRIZE_ORDER = ["DB", "G1", "G2", "G3", "G4", "G5", "G6", "G7"];
  const STRUCTURED_PRIZES = ["G3", "G5", "G6"];
  const PRIZE_NAMES = {
    DB: "Đặc biệt",
    G1: "Giải nhất",
    G2: "Giải nhì",
    G3: "Giải ba",
    G4: "Giải tư",
    G5: "Giải năm",
    G6: "Giải sáu",
    G7: "Giải bảy"
  };

  function normalizeDate(value) {
    if (!value) return null;
    const s = String(value).trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    return m
      ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
      : null;
  }

  function shiftDate(date, amount) {
    const normalized = normalizeDate(date);

    if (!normalized) {
      throw new Error("Ngày không hợp lệ: " + date);
    }

    const d = new Date(normalized + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + amount);

    return d.toISOString().slice(0, 10);
  }

  function getResultObject(day) {
    if (!day || typeof day !== "object") return null;

    if (day.prizes && typeof day.prizes === "object") {
      return day;
    }

    if (
      day.result &&
      typeof day.result === "object" &&
      day.result.prizes
    ) {
      return day.result;
    }

    return day;
  }

  function digitsOnly(value) {
    if (value === null || value === undefined) return null;

    const s = String(value).trim();

    return /^\d+$/.test(s) ? s : null;
  }

  function getPrizeRows(day, requestedPrizes = PRIZE_ORDER) {
    const result = getResultObject(day);
    const prizes = result && result.prizes;

    if (!prizes || typeof prizes !== "object") {
      throw new Error(
        "Thiếu dữ liệu giải cho ngày " +
        (result?.date || day?.date || "không rõ")
      );
    }

    const rows = [];

    for (const prize of requestedPrizes) {
      const raw = prizes[prize];

      if (raw === undefined || raw === null) continue;

      (Array.isArray(raw) ? raw : [raw]).forEach((value, index) => {
        const digits = digitsOnly(value);

        if (digits === null) return;

        rows.push({
          date: normalizeDate(result.date || day.date),
          prize,
          prizeName: PRIZE_NAMES[prize] || prize,
          resultIndex: index + 1,
          sourceValue: digits
        });
      });
    }

    return rows;
  }

  function canonicalPair(pair) {
    const reverse = pair.split("").reverse().join("");

    return pair <= reverse ? pair : reverse;
  }

  function getDays(data) {
    if (data?.history && Array.isArray(data.history.days)) {
      return data.history.days;
    }

    if (Array.isArray(data?.days)) return data.days;

    return [];
  }

  function buildDateMap(data) {
    const map = new Map();

    const directCandidates = [
      data?.current,
      data?.currentDay,
      data?.day,
      data?.result,
      data
    ];

    for (const candidate of directCandidates) {
      const result = getResultObject(candidate);
      const date = normalizeDate(result?.date || candidate?.date);

      if (date && result?.prizes) {
        map.set(date, candidate);
      }
    }

    for (const day of getDays(data)) {
      const result = getResultObject(day);
      const date = normalizeDate(result?.date || day?.date);

      if (date && result?.prizes) {
        map.set(date, day);
      }
    }

    return map;
  }

  function makeCell(row, rowIndex = 0, columnIndex = 0) {
    return {
      date: row.date,
      prize: row.prize,
      prizeName: row.prizeName,
      resultIndex: row.resultIndex,
      sourceValue: row.sourceValue,
      rowIndex,
      columnIndex,
      cellId: `${row.prize}:${row.resultIndex}`
    };
  }

  function makeGrid(day, prize, rowCount, columnCount) {
    const rows = getPrizeRows(day, [prize]);
    const expected = rowCount * columnCount;

    if (rows.length < expected) {
      throw new Error(
        `${prize} ngày ${rows[0]?.date || "không rõ"}: ` +
        `cần ${expected} số, nhận ${rows.length}.`
      );
    }

    const selected = rows.slice(0, expected);
    const grid = [];

    for (let r = 0; r < rowCount; r++) {
      grid.push(
        selected
          .slice(r * columnCount, (r + 1) * columnCount)
          .map((row, c) => makeCell(row, r, c))
      );
    }

    return grid;
  }

  function makeSourceGrids(day) {
    return {
      G3: makeGrid(day, "G3", 2, 3),
      G5: makeGrid(day, "G5", 2, 3),
      G6: makeGrid(day, "G6", 1, 3)
    };
  }

  function coordinateKey(a, b) {
    const one = `${a.cellId}@${a.digitIndex}`;
    const two = `${b.cellId}@${b.digitIndex}`;

    return one <= two ? `${one}|${two}` : `${two}|${one}`;
  }

  function addEdge(edges, leftCell, rightCell, relation) {
    if (
      !leftCell ||
      !rightCell ||
      leftCell.cellId === rightCell.cellId
    ) {
      return;
    }

    const key = [leftCell.cellId, rightCell.cellId].sort().join("|");

    if (!edges.some(edge => edge.key === key)) {
      edges.push({
        key,
        leftCell,
        rightCell,
        relation
      });
    }
  }

  function getStructuredEdges(grids) {
    const edges = [];

    for (const prize of ["G3", "G5"]) {
      const grid = grids[prize];

      // Các ô kề nhau theo hàng hoặc theo cột.
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          if (c + 1 < grid[r].length) {
            addEdge(
              edges,
              grid[r][c],
              grid[r][c + 1],
              "horizontal-adjacent"
            );
          }

          if (r + 1 < grid.length) {
            addEdge(
              edges,
              grid[r][c],
              grid[r + 1][c],
              "vertical-adjacent"
            );
          }
        }
      }
    }

    const g6 = grids.G6[0];

    for (let c = 0; c + 1 < g6.length; c++) {
      addEdge(
        edges,
        g6[c],
        g6[c + 1],
        "horizontal-adjacent"
      );
    }

    // Quan hệ G5-G6 cùng cột.
    for (let c = 0; c < 3; c++) {
      addEdge(
        edges,
        grids.G5[0][c],
        g6[c],
        "G5-G6-same-column"
      );

      addEdge(
        edges,
        grids.G5[1][c],
        g6[c],
        "G5-G6-same-column"
      );
    }

    return edges;
  }

  function makeDigitPosition(cell, digitIndex) {
    return {
      cellId: cell.cellId,
      prize: cell.prize,
      prizeName: cell.prizeName,
      resultIndex: cell.resultIndex,
      rowIndex: cell.rowIndex,
      columnIndex: cell.columnIndex,
      sourceValue: cell.sourceValue,
      digitIndex,
      digitPosition: digitIndex + 1,
      digit: cell.sourceValue[digitIndex]
    };
  }

  function collectCandidatePatterns(dayN) {
    const candidates = [];
    const seen = new Set();

    // G3/G5/G6: lấy vị trí chữ số trong các ô kề nhau theo lưới.
    const grids = makeSourceGrids(dayN);

    for (const edge of getStructuredEdges(grids)) {
      for (
        let leftIndex = 0;
        leftIndex < edge.leftCell.sourceValue.length;
        leftIndex++
      ) {
        for (
          let rightIndex = 0;
          rightIndex < edge.rightCell.sourceValue.length;
          rightIndex++
        ) {
          const left = makeDigitPosition(edge.leftCell, leftIndex);
          const right = makeDigitPosition(edge.rightCell, rightIndex);

          const key =
            `${edge.relation}|${coordinateKey(left, right)}`;

          if (seen.has(key)) continue;

          seen.add(key);

          candidates.push({
            patternId: key,
            relation: edge.relation,
            sourcePair: left.digit + right.digit,
            left,
            right
          });
        }
      }
    }

    // Các giải còn lại: chữ số liền kề trong từng kết quả.
    const nonStructuredRows = getPrizeRows(
      dayN,
      PRIZE_ORDER.filter(
        prize => !STRUCTURED_PRIZES.includes(prize)
      )
    );

    for (const row of nonStructuredRows) {
      const cell = makeCell(row);

      for (let i = 0; i + 1 < cell.sourceValue.length; i++) {
        const left = makeDigitPosition(cell, i);
        const right = makeDigitPosition(cell, i + 1);

        const key = `adjacent-digits|${coordinateKey(left, right)}`;

        if (seen.has(key)) continue;

        seen.add(key);

        candidates.push({
          patternId: key,
          relation: "adjacent-digits-in-result",
          sourcePair: left.digit + right.digit,
          left,
          right
        });
      }
    }

    return candidates;
  }

  function extractPositionPatterns(dayN) {
    const candidates = collectCandidatePatterns(dayN);
    const byPair = new Map();

    for (const candidate of candidates) {
      if (!byPair.has(candidate.sourcePair)) {
        byPair.set(candidate.sourcePair, []);
      }

      byPair.get(candidate.sourcePair).push(candidate);
    }

    const eligible = [];

    for (const [sourcePair, occurrences] of byPair.entries()) {
      const unique = new Map();

      for (const occurrence of occurrences) {
        unique.set(occurrence.patternId, occurrence);
      }

      if (unique.size < MIN_POSITION_COUNT) continue;

      eligible.push({
        sourcePair,
        occurrences: Array.from(unique.values()),
        positionCount: unique.size
      });
    }

    // Ưu tiên số vị trí hợp lệ giảm dần.
    eligible.sort(
      (a, b) =>
        b.positionCount - a.positionCount ||
        a.sourcePair.localeCompare(b.sourcePair)
    );

    const patterns = [];

    for (const group of eligible) {
      for (const occurrence of group.occurrences) {
        patterns.push({
          ...occurrence,
          sourceGroup: canonicalPair(group.sourcePair),
          sourcePairPositionCount: group.positionCount,
          minimumRequiredPositions: MIN_POSITION_COUNT
        });
      }
    }

    return patterns;
  }

  function getCellById(day, cellId) {
    const [prize, indexText] = cellId.split(":");
    const resultIndex = Number(indexText);

    const row = getPrizeRows(day, [prize]).find(
      item => item.resultIndex === resultIndex
    );

    return row ? makeCell(row) : null;
  }

  function applyPatternsToPreviousDay(patterns, dayPrevious) {
    const applied = [];

    for (const pattern of patterns) {
      const leftCell = getCellById(
        dayPrevious,
        pattern.left.cellId
      );

      const rightCell = getCellById(
        dayPrevious,
        pattern.right.cellId
      );

      if (!leftCell || !rightCell) continue;

      const leftDigit =
        leftCell.sourceValue[pattern.left.digitIndex];

      const rightDigit =
        rightCell.sourceValue[pattern.right.digitIndex];

      if (
        leftDigit === undefined ||
        rightDigit === undefined
      ) {
        continue;
      }

      const pair = leftDigit + rightDigit;

      applied.push({
        date: leftCell.date,
        patternId: pattern.patternId,
        relation: pattern.relation,
        sourcePairOnTargetDay: pattern.sourcePair,
        sourcePairPositionCount: pattern.sourcePairPositionCount,
        clusterId: pattern.relation,
        pair,
        group: canonicalPair(pair),

        left: {
          prize: leftCell.prize,
          prizeName: leftCell.prizeName,
          resultIndex: leftCell.resultIndex,
          rowIndex: pattern.left.rowIndex,
          columnIndex: pattern.left.columnIndex,
          sourceValue: leftCell.sourceValue,
          digitIndex: pattern.left.digitIndex,
          digitPosition: pattern.left.digitIndex + 1,
          digit: leftDigit
        },

        right: {
          prize: rightCell.prize,
          prizeName: rightCell.prizeName,
          resultIndex: rightCell.resultIndex,
          rowIndex: pattern.right.rowIndex,
          columnIndex: pattern.right.columnIndex,
          sourceValue: rightCell.sourceValue,
          digitIndex: pattern.right.digitIndex,
          digitPosition: pattern.right.digitIndex + 1,
          digit: rightDigit
        }
      });
    }

    return applied;
  }

  function extractActualTails(dayN) {
    return getPrizeRows(dayN, PRIZE_ORDER).map(row => {
      const tail = row.sourceValue.slice(-2).padStart(2, "0");

      return {
        date: row.date,
        prize: row.prize,
        prizeName: row.prizeName,
        resultIndex: row.resultIndex,
        sourceValue: row.sourceValue,
        tail,
        group: canonicalPair(tail)
      };
    });
  }

  function analyze(data, options = {}) {
    const targetDate = normalizeDate(
      options.targetDate ||
      data?.requested_date ||
      data?.date
    );

    if (!targetDate) {
      throw new Error("Thiếu ngày mục tiêu hợp lệ.");
    }

    const previousDate = shiftDate(targetDate, -1);
    const byDate = buildDateMap(data);
    const dayN = byDate.get(targetDate);
    const dayPrevious = byDate.get(previousDate);

    if (!dayN) {
      throw new Error(
        `Thiếu kết quả ngày mục tiêu ${targetDate}. ` +
        "Cần dữ liệu ngày N để xác định mẫu và đối chiếu."
      );
    }

    if (!dayPrevious) {
      throw new Error(
        `Thiếu kết quả ngày nguồn ${previousDate} để áp dụng tọa độ.`
      );
    }

    const patterns = extractPositionPatterns(dayN);

    const appliedPairs = applyPatternsToPreviousDay(
      patterns,
      dayPrevious
    );

    const actualTails = extractActualTails(dayN);
    const actualGroups = new Map();

    for (const tail of actualTails) {
      if (!actualGroups.has(tail.group)) {
        actualGroups.set(tail.group, []);
      }

      actualGroups.get(tail.group).push(tail);
    }

    const grouped = new Map();

    for (const item of appliedPairs) {
      if (!grouped.has(item.group)) {
        const reverse = item.group.split("").reverse().join("");

        grouped.set(item.group, {
          group: item.group,
          reverse,
          label:
            item.group === reverse
              ? item.group
              : `${item.group}/${reverse}`,
          occurrences: [],
          firstOrder: grouped.size
        });
      }

      grouped.get(item.group).occurrences.push(item);
    }

    const results = [];

    for (const record of grouped.values()) {
      const matches = actualGroups.get(record.group) || [];

      // Chỉ giữ các cặp xuất hiện ở đuôi hai số ngày N.
      if (!matches.length) continue;

      results.push({
        rank: results.length + 1,
        group: record.group,
        reverse: record.reverse,
        label: record.label,
        frequency: record.occurrences.length,
        positionCount: record.occurrences.length,
        sourceOccurrences: record.occurrences,
        matched: true,
        matchCount: matches.length,
        comparisonOccurrences: matches
      });
    }

    return {
      version: VERSION,
      targetDate,
      sourceDate: previousDate,
      compareDate: targetDate,
      minimumPatternPositions: MIN_POSITION_COUNT,
      patternCount: patterns.length,
      qualifyingSourcePairCount: new Set(
        patterns.map(pattern => pattern.sourcePair)
      ).size,
      totalAppliedPositions: appliedPairs.length,
      uniqueGroupCount: grouped.size,
      matchedGroupCount: results.length,
      results,

      // Tương thích với index.html; không cắt danh sách Top 10/15.
      top10: results,
      top15: results,

      sourcePrizeOrder: STRUCTURED_PRIZES,
      comparisonPrizeOrder: PRIZE_ORDER.slice(),
      actualTails,
      positionPatterns: patterns,
      appliedPairs,

      notes: [
        "Ngày N xác định mẫu vị trí; mỗi cặp phải có ít nhất 4 cặp tọa độ khác nhau.",
        "Ưu tiên theo số tọa độ hợp lệ giảm dần và dùng toàn bộ tọa độ của mẫu.",
        "Tọa độ được áp dụng nguyên vẹn lên ngày N-1 để tạo cặp mới.",
        "Đối chiếu bằng đuôi hai chữ số của tất cả giải DB-G7 ngày N.",
        "Cặp đảo chiều được gộp khi trình bày; từng lần tạo cặp và tọa độ được bảo toàn.",
        "Không cắt Top 10/15 theo tần suất.",
        "G3/G5/G6 dùng quan hệ ô kề nhau theo lưới; các giải khác dùng chữ số liền kề trong từng kết quả.",
        "Lưới G3/G5/G6 yêu cầu đúng thứ tự số Worker trả về."
      ]
    };
  }

  root.XSMBAlgorithm = {
    version: VERSION,
    prizeOrder: PRIZE_ORDER.slice(),
    canonicalPair,
    extractPositionPatterns,
    applyPatternsToPreviousDay,
    extractActualTails,
    analyze
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.XSMBAlgorithm;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
