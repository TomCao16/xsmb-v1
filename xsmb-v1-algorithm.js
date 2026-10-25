
/*
 * XSMB V1 - SQUARE GRID POSITIONAL TRANSFER
 * Version 8.0.0
 *
 * QUY TẮC:
 * 1. Ngày N xác định mẫu vị trí.
 * 2. Chỉ sinh mẫu ở DB-G1, G2, G3, G5 và G5-G6.
 * 3. Chỉ ghép các ô kết quả liền kề theo lưới.
 * 4. Giữa hai ô liền kề: ghép chữ số cùng vị trí
 *    hoặc lệch một vị trí trái/phải.
 * 5. Gộp cặp đảo chiều khi đếm vị trí.
 * 6. Chọn Top 15 nhóm có nhiều tọa độ hợp lệ nhất trên N.
 * 7. Chuyển nguyên tọa độ đã chọn sang N-1.
 * 8. Đối chiếu cặp tạo trên N-1 với đuôi 2 số
 *    của đủ 27 kết quả DB-G7 ngày N.
 * 9. Chỉ trả các nhóm khớp thực tế.
 * 10. Không dùng G4, G7 để sinh mẫu.
 */

(function (root) {
  "use strict";

  const VERSION = "XSMB V1 SQUARE GRID POSITIONAL TRANSFER 8.0.0";
  const TOP_GROUPS = 15;

  const PRIZE_ORDER = [
    "DB", "G1", "G2", "G3",
    "G4", "G5", "G6", "G7"
  ];

  const EXPECTED_COUNTS = {
    DB: 1,
    G1: 1,
    G2: 2,
    G3: 6,
    G4: 4,
    G5: 6,
    G6: 3,
    G7: 4
  };

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

    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return s;
    }

    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    if (m) {
      return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }

    return null;
  }

  function shiftDate(value, offset) {
    const date = normalizeDate(value);

    if (!date) {
      throw new Error("Ngày không hợp lệ: " + value);
    }

    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);

    return d.toISOString().slice(0, 10);
  }

  function getResultObject(day) {
    if (!day || typeof day !== "object") return null;

    if (day.prizes && typeof day.prizes === "object") {
      return day;
    }

    if (day.result?.prizes) return day.result;
    if (day.data?.prizes) return day.data;

    return day;
  }

  function digitsOnly(value) {
    if (value === null || value === undefined) return null;

    const s = String(value).trim();

    return /^\d+$/.test(s) ? s : null;
  }

  function getPrizeRows(day, requestedPrizes = PRIZE_ORDER) {
    const result = getResultObject(day);
    const prizes = result?.prizes;

    if (!prizes || typeof prizes !== "object") {
      throw new Error(
        "Không có dữ liệu giải ngày " +
        (result?.date || day?.date || "không rõ")
      );
    }

    const rows = [];

    for (const prize of requestedPrizes) {
      const raw = prizes[prize];

      if (raw === undefined || raw === null) continue;

      (Array.isArray(raw) ? raw : [raw]).forEach((value, index) => {
        const number = digitsOnly(value);

        if (number === null) return;

        rows.push({
          date: normalizeDate(result.date || day.date),
          prize,
          prizeName: PRIZE_NAMES[prize],
          resultIndex: index + 1,
          sourceValue: number
        });
      });
    }

    return rows;
  }

  function validateCompleteDay(day, expectedDate) {
    const result = getResultObject(day);

    if (!result?.prizes) {
      throw new Error(`Thiếu dữ liệu giải ngày ${expectedDate}.`);
    }

    const actualDate = normalizeDate(result.date || day?.date);

    if (actualDate && actualDate !== expectedDate) {
      throw new Error(
        `Sai ngày dữ liệu: cần ${expectedDate}, nhận ${actualDate}.`
      );
    }

    const rows = getPrizeRows(day, PRIZE_ORDER);

    for (const prize of PRIZE_ORDER) {
      const count = rows.filter(row => row.prize === prize).length;

      if (count !== EXPECTED_COUNTS[prize]) {
        throw new Error(
          `Dữ liệu ngày ${expectedDate}: ${prize} cần ` +
          `${EXPECTED_COUNTS[prize]} số, nhận ${count}.`
        );
      }
    }

    if (rows.length !== 27) {
      throw new Error(
        `Ngày ${expectedDate} phải có 27 kết quả, nhận ${rows.length}.`
      );
    }

    return rows;
  }

  function canonicalPair(pair) {
    const reverse = pair.split("").reverse().join("");
    return pair <= reverse ? pair : reverse;
  }

  function groupLabel(group) {
    const reverse = group.split("").reverse().join("");
    return group === reverse ? group : `${group}/${reverse}`;
  }

  function getDays(data) {
    if (Array.isArray(data?.history?.days)) {
      return data.history.days;
    }

    if (Array.isArray(data?.days)) {
      return data.days;
    }

    return [];
  }

  function buildDateMap(data) {
    const map = new Map();

    const direct = [
      data?.current,
      data?.currentDay,
      data?.day,
      data?.result,
      data?.data,
      data
    ];

    for (const candidate of direct) {
      const result = getResultObject(candidate);
      const date = normalizeDate(result?.date || candidate?.date);

      if (date && result?.prizes) {
        map.set(date, result);
      }
    }

    for (const day of getDays(data)) {
      const result = getResultObject(day);
      const date = normalizeDate(result?.date || day?.date);

      if (date && result?.prizes) {
        map.set(date, result);
      }
    }

    return map;
  }

  function makeCell(row, rowIndex, columnIndex) {
    return {
      ...row,
      rowIndex,
      columnIndex,
      cellId: `${row.prize}:${row.resultIndex}`
    };
  }

  function makeGrid(day, prize, rowCount, columnCount) {
    const rows = getPrizeRows(day, [prize]);
    const expected = rowCount * columnCount;

    if (rows.length !== expected) {
      throw new Error(
        `${prize} ngày ${rows[0]?.date || "không rõ"}: ` +
        `cần ${expected} số, nhận ${rows.length}.`
      );
    }

    return Array.from({ length: rowCount }, (_, r) =>
      rows
        .slice(r * columnCount, (r + 1) * columnCount)
        .map((row, c) => makeCell(row, r, c))
    );
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

  function endpointKey(pos) {
    return `${pos.cellId}@${pos.digitIndex}`;
  }

  function coordinateKey(a, b) {
    return [endpointKey(a), endpointKey(b)].sort().join("|");
  }

  function addCandidate(left, right, relation, candidates, seen) {
    if (!left || !right) return;

    if (left.digit === undefined || right.digit === undefined) {
      return;
    }

    if (endpointKey(left) === endpointKey(right)) return;

    const key = coordinateKey(left, right);

    // Một cặp tọa độ chỉ được tính một lần.
    if (seen.has(key)) return;
    seen.add(key);

    candidates.push({
      patternId: key,
      relation,
      sourcePair: left.digit + right.digit,
      left,
      right
    });
  }

  /*
   * Ghép chữ số giữa hai ô kết quả liền kề.
   * Chỉ ghép cùng vị trí hoặc lệch một chữ số.
   * Không ghép với ô cách xa.
   */
  function collectBetweenCells(
    firstCell,
    secondCell,
    relation,
    candidates,
    seen
  ) {
    const firstLength = firstCell.sourceValue.length;
    const secondLength = secondCell.sourceValue.length;

    for (let i = 0; i < firstLength; i++) {
      const start = Math.max(0, i - 1);
      const end = Math.min(secondLength - 1, i + 1);

      for (let j = start; j <= end; j++) {
        const left = makeDigitPosition(firstCell, i);
        const right = makeDigitPosition(secondCell, j);

        addCandidate(left, right, relation, candidates, seen);
      }
    }
  }

  /*
   * Sinh mẫu giữa các ô kề nhau trong lưới.
   * Mỗi cặp ô chỉ duyệt một lần:
   * ngang, chéo xuống trái, dọc, chéo xuống phải.
   */
  function collectGridCandidates(grid, prefix, candidates, seen) {
  // Chỉ ghép các ô dọc tương ứng trong vùng đã xác định.
  // Không tự tạo liên kết ngang hoặc chéo cho DB-G1, G3, G5, G5-G6.
  for (let r = 0; r < grid.length - 1; r++) {
    const upperRow = grid[r];
    const lowerRow = grid[r + 1];
    const columnCount = Math.min(
      upperRow.length,
      lowerRow.length
    );

    for (let c = 0; c < columnCount; c++) {
      collectBetweenCells(
        upperRow[c],
        lowerRow[c],
        `${prefix}-vertical`,
        candidates,
        seen
      );
    }
  }
}
  function collectCandidatePatterns(dayN) {
    const candidates = [];
    const seen = new Set();

    // DB-G1: hai ô xếp trên-dưới.
    const db = getPrizeRows(dayN, ["DB"]);
    const g1 = getPrizeRows(dayN, ["G1"]);

    if (db.length !== 1 || g1.length !== 1) {
      throw new Error("DB-G1 không đủ dữ liệu.");
    }

    const dbG1Grid = [
      [makeCell(db[0], 0, 0)],
      [makeCell(g1[0], 1, 0)]
    ];

    collectGridCandidates(
      dbG1Grid,
      "DB-G1",
      candidates,
      seen
    );

    // G2: hai kết quả nằm liền nhau theo hàng ngang.
    const g2 = getPrizeRows(dayN, ["G2"]);

    if (g2.length !== 2) {
      throw new Error("G2 phải có đúng 2 kết quả.");
    }

    collectBetweenCells(
      makeCell(g2[0], 0, 0),
      makeCell(g2[1], 0, 1),
      "G2-horizontal",
      candidates,
      seen
    );

    // G3: 2 hàng x 3 cột, chỉ nối các ô kề nhau.
    const g3Grid = makeGrid(dayN, "G3", 2, 3);

    collectGridCandidates(
      g3Grid,
      "G3",
      candidates,
      seen
    );

    // G5: 2 hàng x 3 cột.
    const g5Grid = makeGrid(dayN, "G5", 2, 3);

    collectGridCandidates(
      g5Grid,
      "G5",
      candidates,
      seen
    );

    // G5-G6: hàng dưới của G5 nằm ngay trên hàng G6.
    const g6Grid = makeGrid(dayN, "G6", 1, 3);

    const g5Bottom = g5Grid[1];

    const g5g6Grid = [
      g5Bottom,
      g6Grid[0].map((cell, columnIndex) =>
        makeCell(
          {
            date: cell.date,
            prize: cell.prize,
            prizeName: cell.prizeName,
            resultIndex: cell.resultIndex,
            sourceValue: cell.sourceValue
          },
          1,
          columnIndex
        )
      )
    ];

    collectGridCandidates(
      g5g6Grid,
      "G5-G6",
      candidates,
      seen
    );

    return candidates;
  }

  /*
   * Đếm vị trí trên ngày N, gộp cặp đảo chiều,
   * sau đó chọn 15 nhóm có nhiều vị trí nhất.
   */
  function extractPositionPatterns(dayN) {
    const candidates = collectCandidatePatterns(dayN);
    const groupMap = new Map();

    for (const candidate of candidates) {
      const group = canonicalPair(candidate.sourcePair);

      if (!groupMap.has(group)) {
        groupMap.set(group, new Map());
      }

      groupMap.get(group).set(candidate.patternId, candidate);
    }

    const rankedGroups = Array.from(groupMap.entries())
  .map(([group, positionMap]) => ({
    group,
    positionCount: positionMap.size,
    occurrences: Array.from(positionMap.values())
  }))
  // Chỉ xét nhóm có ít nhất 4 tọa độ hợp lệ khác nhau trên ngày N.
  .filter(entry => entry.positionCount >= 4)
  .sort((a, b) =>
    b.positionCount - a.positionCount ||
    a.group.localeCompare(b.group)
  );

    const selectedGroups = rankedGroups.slice(0, TOP_GROUPS);
    const patterns = [];

    selectedGroups.forEach((entry, rankIndex) => {
      const directionalCounts = {};

      for (const occurrence of entry.occurrences) {
        directionalCounts[occurrence.sourcePair] =
          (directionalCounts[occurrence.sourcePair] || 0) + 1;
      }

      for (const occurrence of entry.occurrences) {
        patterns.push({
          ...occurrence,
          sourceGroup: entry.group,
          sourceGroupLabel: groupLabel(entry.group),
          sourceGroupPositionCount: entry.positionCount,
          sourcePairPositionCount: entry.positionCount,
          sourcePairDirectionalPositionCounts: {
            ...directionalCounts
          },
          rank: rankIndex + 1
        });
      }
    });

    return patterns;
  }

  function getCellById(day, cellId) {
    const separator = cellId.lastIndexOf(":");
    const prize = cellId.slice(0, separator);
    const resultIndex = Number(cellId.slice(separator + 1));

    const row = getPrizeRows(day, [prize]).find(
      item => item.resultIndex === resultIndex
    );

    return row ? makeCell(row, 0, 0) : null;
  }

  /*
   * Chuyển đúng tọa độ mẫu ngày N sang dữ liệu ngày N-1.
   * Không dò lại vị trí theo giá trị số.
   */
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

      // Nếu số N-1 không có chỉ số chữ số tương ứng, bỏ lượt đó.
      if (leftDigit === undefined || rightDigit === undefined) {
        continue;
      }

      const pair = leftDigit + rightDigit;

      applied.push({
        date: normalizeDate(leftCell.date),
        patternId: pattern.patternId,
        relation: pattern.relation,
        rank: pattern.rank,

        sourcePairOnTargetDay: pattern.sourcePair,
        sourceGroupOnTargetDay: pattern.sourceGroup,
        sourceGroupLabelOnTargetDay: pattern.sourceGroupLabel,
        sourceGroupPositionCount: pattern.sourceGroupPositionCount,

        patternOccurrence: {
          patternId: pattern.patternId,
          relation: pattern.relation,
          sourcePair: pattern.sourcePair,
          left: { ...pattern.left },
          right: { ...pattern.right }
        },

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

  function extractActualTails(dayN, expectedDate) {
    const rows = validateCompleteDay(dayN, expectedDate);

    return rows.map(row => {
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
      data?.targetDate ||
      data?.date
    );

    if (!targetDate) {
      throw new Error("Thiếu ngày mục tiêu hợp lệ.");
    }

    const sourceDate = shiftDate(targetDate, -1);
    const dateMap = buildDateMap(data);

    const dayN = dateMap.get(targetDate);
    const dayPrevious = dateMap.get(sourceDate);

    if (!dayN) {
      throw new Error(`Thiếu dữ liệu ngày mục tiêu N: ${targetDate}.`);
    }

    if (!dayPrevious) {
      throw new Error(`Thiếu dữ liệu ngày nguồn N-1: ${sourceDate}.`);
    }

    validateCompleteDay(dayN, targetDate);
    validateCompleteDay(dayPrevious, sourceDate);

    // 1. Lấy mẫu vị trí trên N và chọn Top 15 nhóm.
    const positionPatterns = extractPositionPatterns(dayN);

    // 2. Áp dụng các tọa độ đã chọn lên N-1.
    const appliedPairs = applyPatternsToPreviousDay(
      positionPatterns,
      dayPrevious
    );

    // 3. Lấy đuôi của đủ 27 kết quả ngày N.
    const actualTails = extractActualTails(dayN, targetDate);
    const actualGroups = new Map();

    for (const tail of actualTails) {
      if (!actualGroups.has(tail.group)) {
        actualGroups.set(tail.group, []);
      }
      actualGroups.get(tail.group).push(tail);
    }

    // Gom cặp được tạo trên N-1 theo nhóm đảo chiều.
    const appliedGroups = new Map();

    for (const item of appliedPairs) {
      if (!appliedGroups.has(item.group)) {
        appliedGroups.set(item.group, []);
      }
      appliedGroups.get(item.group).push(item);
    }

    const results = [];

    for (const [group, occurrences] of appliedGroups.entries()) {
      const matches = actualGroups.get(group) || [];

      // Chỉ trả nhóm có ít nhất một đuôi khớp ngày N.
      if (matches.length === 0) continue;

      const rank = Math.min(
        ...occurrences.map(item => item.rank)
      );

      const selectedSample = positionPatterns.filter(
        item => item.sourceGroup ===
          occurrences[0].sourceGroupOnTargetDay
      );

      results.push({
        group,
        reverse: group.split("").reverse().join(""),
        label: groupLabel(group),
        frequency: occurrences.length,
        rank,
        samplePositionCount: Math.max(
          0,
          ...selectedSample.map(item => item.sourceGroupPositionCount)
        ),
        matched: true,
        matchCount: matches.length,
        sourceOccurrences: occurrences,
        comparisonOccurrences: matches
      });
    }

    // Ưu tiên thứ hạng mẫu trên N; nếu bằng nhau, sắp theo nhóm.
    results.sort((a, b) =>
      a.rank - b.rank ||
      a.group.localeCompare(b.group)
    );

    const detailRows = [];

    for (const result of results) {
      for (const occurrence of result.sourceOccurrences) {
        detailRows.push({
          patternDate: targetDate,
          appliedDate: sourceDate,
          comparisonDate: targetDate,
          rank: occurrence.rank,

          sample: occurrence.sourceGroupLabelOnTargetDay,
          sampleLabel: occurrence.sourceGroupLabelOnTargetDay,
          sourcePairOnTargetDay: occurrence.sourcePairOnTargetDay,
          samplePositionCount: occurrence.sourceGroupPositionCount,

          createdPair: occurrence.pair,
          createdDigits: occurrence.pair,

          createdNumbers: [
            occurrence.left.sourceValue,
            occurrence.right.sourceValue
          ],

          createdNumberText:
            `${occurrence.left.sourceValue} + ${occurrence.right.sourceValue}`,

          sourceOccurrences: [occurrence],
          matched: true,
          matchCount: result.matchCount,
          comparisonOccurrences: result.comparisonOccurrences,

          matchingResults: result.comparisonOccurrences.map(match => ({
            prize: match.prize,
            prizeName: match.prizeName,
            resultIndex: match.resultIndex,
            number: match.sourceValue,
            tail: match.tail
          }))
        });
      }
    }

    return {
      version: VERSION,
      targetDate,
      sourceDate,
      compareDate: targetDate,

      topGroupLimit: TOP_GROUPS,
      selectedGroupCount: new Set(
        positionPatterns.map(item => item.sourceGroup)
      ).size,

      patternCount: positionPatterns.length,
      totalAppliedPositions: appliedPairs.length,
      uniqueGroupCount: appliedGroups.size,
      matchedGroupCount: results.length,

      results,
      detailRows,

      // Tương thích với giao diện cũ.
      top10: results,
      top15: results,

      sourcePrizeOrder: [
        "DB-G1", "G2", "G3", "G5", "G5-G6"
      ],

      comparisonPrizeOrder: PRIZE_ORDER.slice(),

      actualTails,
      positionPatterns,
      appliedPairs,

      notes: [
        "Ngày N dùng để xác định và xếp hạng mẫu vị trí.",
        "Chọn tối đa 15 nhóm có nhiều tọa độ ghép hợp lệ nhất.",
        "Các ô phải liền kề theo lưới; không nối ô cách nhau.",
        "G2 chỉ ghép hai ô kết quả liền nhau theo hàng ngang.",
        "G4 và G7 không được dùng để sinh mẫu.",
        "Tọa độ được chuyển nguyên vẹn từ N sang N-1.",
        "Cặp đảo chiều được gộp khi hiển thị.",
        "Chỉ trả nhóm có đuôi khớp kết quả thực tế ngày N.",
        "Dữ liệu đối chiếu phải có đủ 27 kết quả DB-G7."
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
