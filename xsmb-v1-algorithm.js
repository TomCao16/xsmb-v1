
/*
 * XSMB V1 - POSITIONAL TRANSFER MATCHER
 * Version 7.2.2
 *
 * QUY TẮC:
 * 1. Ngày N: xác định mẫu từ tọa độ chữ số thực tế.
 * 2. Gộp cặp đảo chiều khi tính ngưỡng vị trí:
 *    02 và 20 thuộc cùng nhóm 02/20.
 * 3. Nhóm cần ít nhất 4 cạnh tọa độ hợp lệ, khác nhau.
 * 4. Ngày N-1: áp dụng nguyên tọa độ mẫu ngày N để tạo cặp.
 * 5. Ngày N: đối chiếu cặp tạo ra với đuôi 2 số của đủ 27 kết quả DB-G7.
 * 6. Chỉ trả các nhóm có kết quả thực tế khớp.
 * 7. Hiển thị rõ cả ngày N và ngày N-1.
 * 8. Giữ nguyên từng chiều cặp, tọa độ, số gốc và số được tạo.
 * 9. Không xếp hạng theo tần suất; không cắt Top 10/Top 15.
 *
 * Vùng xét:
 * - DB-G1
 * - G3: lưới 2 hàng x 3 cột
 * - G5: lưới 2 hàng x 3 cột
 * - G5-G6: hàng G5 gần G6 nhất kết hợp với G6
 * - G2, G4, G7: chữ số liền nhau trong từng kết quả
 *
 * API:
 * XSMBAlgorithm.analyze(data, { targetDate: "YYYY-MM-DD" })
 */

(function (root) {
  "use strict";

  const VERSION = "XSMB V1 POSITIONAL TRANSFER MATCHER 7.2.2";
  const MIN_POSITION_COUNT = 4;

  const PRIZE_ORDER = ["DB", "G1", "G2", "G3", "G4", "G5", "G6", "G7"];

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

    return m
      ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
      : null;
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

    if (day.result?.prizes) {
      return day.result;
    }

    if (day.data?.prizes) {
      return day.data;
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
    const prizes = result?.prizes;

    if (!prizes || typeof prizes !== "object") {
      throw new Error(
        "Không có dữ liệu giải cho ngày " +
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
          prizeName: PRIZE_NAMES[prize] || prize,
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
    const countByPrize = {};

    for (const prize of PRIZE_ORDER) {
      countByPrize[prize] = rows.filter(
        row => row.prize === prize
      ).length;

      if (countByPrize[prize] !== EXPECTED_COUNTS[prize]) {
        throw new Error(
          `Dữ liệu ngày ${expectedDate} chưa đủ: ${prize} cần ` +
          `${EXPECTED_COUNTS[prize]} số, nhận ${countByPrize[prize]}.`
        );
      }
    }

    if (rows.length !== 27) {
      throw new Error(
        `Dữ liệu ngày ${expectedDate} phải có 27 kết quả, nhận ${rows.length}.`
      );
    }

    return rows;
  }

  /*
   * Chuẩn hóa cặp đảo chiều.
   * Ví dụ: 02 -> 02; 20 -> 02; 11 -> 11.
   */
  function canonicalPair(pair) {
    const reverse = pair.split("").reverse().join("");
    return pair <= reverse ? pair : reverse;
  }

  function formatPairGroup(group) {
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

  function makeCell(row, rowIndex = 0, columnIndex = 0) {
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
        `${prize} ngày ${rows[0]?.date || "không rõ"}: cần đúng ` +
        `${expected} số, nhận ${rows.length}.`
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

  /*
   * Khóa cạnh không phụ thuộc chiều duyệt.
   * Một cạnh tọa độ vật lý chỉ được thu thập một lần.
   */
  function coordinateKey(a, b) {
    return [endpointKey(a), endpointKey(b)].sort().join("|");
  }

  function addCandidate(left, right, relation, candidates, seen) {
    if (!left || !right) return;

    if (left.digit === undefined || right.digit === undefined) {
      return;
    }

    if (endpointKey(left) === endpointKey(right)) {
      return;
    }

    const key = coordinateKey(left, right);

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
   * Ghép chữ số liền nhau trong cùng một kết quả.
   * Chiều cặp từ trái sang phải.
   */
  function collectWithinSingleResult(row, candidates, seen) {
    const cell = makeCell(row);

    for (let i = 0; i < cell.sourceValue.length - 1; i++) {
      const left = makeDigitPosition(cell, i);
      const right = makeDigitPosition(cell, i + 1);

      addCandidate(
        left,
        right,
        "adjacent-digits-in-result",
        candidates,
        seen
      );
    }
  }

  /*
   * Ghép hai ô kết quả liền kề.
   * Mỗi vị trí ghép với chỉ số tương ứng, lệch trái 1
   * hoặc lệch phải 1 trong ô bên cạnh.
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
      const minJ = Math.max(0, i - 1);
      const maxJ = Math.min(secondLength - 1, i + 1);

      for (let j = minJ; j <= maxJ; j++) {
        const left = makeDigitPosition(firstCell, i);
        const right = makeDigitPosition(secondCell, j);

        addCandidate(left, right, relation, candidates, seen);
      }
    }
  }

  /*
   * Duyệt lưới:
   * - Chữ số liền nhau trong mỗi số.
   * - Ô liền ngang, dọc và chéo.
   * - Không nối các ô cách nhau.
   */
  function collectGridCandidates(grid, relationPrefix, candidates, seen) {
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const cell = grid[r][c];

        collectWithinSingleResult(cell, candidates, seen);

        const neighbors = [
          [r, c + 1, "horizontal"],
          [r + 1, c - 1, "diagonal-down-left"],
          [r + 1, c, "vertical"],
          [r + 1, c + 1, "diagonal-down-right"]
        ];

        for (const [nr, nc, direction] of neighbors) {
          if (nr < 0 || nr >= grid.length) continue;
          if (nc < 0 || nc >= grid[nr].length) continue;

          collectBetweenCells(
            cell,
            grid[nr][nc],
            `${relationPrefix}-${direction}`,
            candidates,
            seen
          );
        }
      }
    }
  }

  function collectCandidatePatterns(dayN) {
    const candidates = [];
    const seen = new Set();

    // DB-G1: DB hàng trên, G1 hàng dưới.
    const db = getPrizeRows(dayN, ["DB"]);
    const g1 = getPrizeRows(dayN, ["G1"]);

    if (db.length !== 1 || g1.length !== 1) {
      throw new Error("DB-G1 không đủ dữ liệu để tạo vùng vị trí.");
    }

    const dbGrid = [
      [makeCell(db[0], 0, 0)],
      [makeCell(g1[0], 1, 0)]
    ];

    collectGridCandidates(dbGrid, "DB-G1", candidates, seen);

    // G3: 2 hàng x 3 cột.
    const g3 = makeGrid(dayN, "G3", 2, 3);
    collectGridCandidates(g3, "G3", candidates, seen);

    // G5: 2 hàng x 3 cột.
    const g5 = makeGrid(dayN, "G5", 2, 3);
    collectGridCandidates(g5, "G5", candidates, seen);

    // G5-G6: hàng G5 gần G6 nhất với G6.
    const g6 = makeGrid(dayN, "G6", 1, 3);

    const g5Bottom = g5[1].map((cell, columnIndex) =>
      makeCell({
        date: cell.date,
        prize: cell.prize,
        prizeName: cell.prizeName,
        resultIndex: cell.resultIndex,
        sourceValue: cell.sourceValue
      }, 0, columnIndex)
    );

    const g5g6Grid = [
      g5Bottom,
      g6[0].map((cell, columnIndex) =>
        makeCell({
          date: cell.date,
          prize: cell.prize,
          prizeName: cell.prizeName,
          resultIndex: cell.resultIndex,
          sourceValue: cell.sourceValue
        }, 1, columnIndex)
      )
    ];

    collectGridCandidates(g5g6Grid, "G5-G6", candidates, seen);

    // G2, G4, G7: chỉ ghép chữ số liền nhau trong từng kết quả.
    for (const row of getPrizeRows(dayN, ["G2", "G4", "G7"])) {
      collectWithinSingleResult(row, candidates, seen);
    }

    return candidates;
  }

  /*
   * VERSION 7.2.2
   *
   * Tính ngưỡng trên nhóm cặp đảo chiều.
   * Ví dụ:
   *   02 có 2 tọa độ
   *   20 có 2 tọa độ
   *   nhóm 02/20 có 4 tọa độ -> ĐƯỢC GIỮ
   *
   * Mỗi occurrence vẫn giữ sourcePair và tọa độ gốc.
   */
  function extractPositionPatterns(dayN) {
    const candidates = collectCandidatePatterns(dayN);
    const byGroup = new Map();

    for (const candidate of candidates) {
      const groupKey = canonicalPair(candidate.sourcePair);

      if (!byGroup.has(groupKey)) {
        byGroup.set(groupKey, new Map());
      }

      /*
       * Khóa gồm chiều cặp và cạnh tọa độ.
       * Hai chiều 02 và 20 được tính chung ngưỡng,
       * nhưng từng lượt và tọa độ vẫn được bảo toàn.
       */
      const occurrenceKey =
        `${candidate.sourcePair}|${candidate.patternId}`;

      byGroup.get(groupKey).set(occurrenceKey, candidate);
    }

    const eligible = [];

    for (const [groupKey, positionMap] of byGroup) {
      const occurrences = Array.from(positionMap.values());

      // Ngưỡng 4 tính chung cả hai chiều đảo ngược.
      if (occurrences.length < MIN_POSITION_COUNT) {
        continue;
      }

      const directionCounts = {};

      for (const occurrence of occurrences) {
        const pair = occurrence.sourcePair;
        directionCounts[pair] = (directionCounts[pair] || 0) + 1;
      }

      eligible.push({
        groupKey,
        occurrences,
        positionCount: occurrences.length,
        directionCounts
      });
    }

    // Sắp xếp ổn định, không loại nhóm theo Top 10/15.
    eligible.sort((a, b) =>
      b.positionCount - a.positionCount ||
      a.groupKey.localeCompare(b.groupKey)
    );

    const patterns = [];

    for (const group of eligible) {
      for (const occurrence of group.occurrences) {
        patterns.push({
          ...occurrence,

          sourceGroup: group.groupKey,
          sourceGroupLabel: formatPairGroup(group.groupKey),

          // Tổng vị trí của nhóm đảo chiều trên ngày N.
          sourcePairPositionCount: group.positionCount,

          // Số vị trí riêng theo từng chiều.
          sourcePairPositionCounts: {
            ...group.directionCounts
          },

          minimumRequiredPositions: MIN_POSITION_COUNT
        });
      }
    }

    return patterns;
  }

  /*
   * Tìm đúng kết quả tương ứng theo giải và thứ tự.
   * Ví dụ G5 số thứ 4 ngày N ánh xạ sang G5 số thứ 4 ngày N-1.
   */
  function getCellById(day, cellId) {
    const separator = cellId.lastIndexOf(":");
    const prize = cellId.slice(0, separator);
    const resultIndex = Number(cellId.slice(separator + 1));

    const row = getPrizeRows(day, [prize]).find(
      item => item.resultIndex === resultIndex
    );

    if (!row) return null;

    return makeCell(row);
  }

  /*
   * Áp dụng tọa độ mẫu ngày N vào các số ngày N-1.
   * Output ghi rõ:
   * - patternDate: ngày N, nơi xác định mẫu.
   * - appliedDate: ngày N-1, nơi tạo cặp mới.
   */
  function applyPatternsToPreviousDay(
    patterns,
    dayPrevious,
    options = {}
  ) {
    const applied = [];
    const patternDate = normalizeDate(options.patternDate);
    const appliedDate = normalizeDate(options.appliedDate);

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

      const leftDigit = leftCell.sourceValue[pattern.left.digitIndex];
      const rightDigit = rightCell.sourceValue[pattern.right.digitIndex];

      // Không tìm lại chữ số theo giá trị; giữ nguyên chỉ số vị trí.
      if (leftDigit === undefined || rightDigit === undefined) {
        continue;
      }

      const left = makeDigitPosition(
        leftCell,
        pattern.left.digitIndex
      );

      const right = makeDigitPosition(
        rightCell,
        pattern.right.digitIndex
      );

      const pair = leftDigit + rightDigit;

      applied.push({
        patternDate,
        appliedDate,

        // Giữ ngày thực tế trong từng ô dùng để tạo cặp.
        date: normalizeDate(leftCell.date),

        patternId: pattern.patternId,
        transferKey: coordinateKey(left, right),
        relation: pattern.relation,

        sourceGroupOnPatternDate: pattern.sourceGroup,
        sourceGroupLabelOnPatternDate: pattern.sourceGroupLabel,
        sourcePairOnPatternDate: pattern.sourcePair,
        sourcePairPositionCount: pattern.sourcePairPositionCount,
        sourcePairPositionCounts: {
          ...pattern.sourcePairPositionCounts
        },

        // Bằng chứng mẫu gốc trên ngày N.
        patternOccurrence: {
          date: patternDate,
          patternId: pattern.patternId,
          relation: pattern.relation,
          sourcePair: pattern.sourcePair,
          sourceGroup: pattern.sourceGroup,
          sourceGroupLabel: pattern.sourceGroupLabel,

          left: { ...pattern.left },
          right: { ...pattern.right }
        },

        // Cặp thực sự tạo từ các số ngày N-1.
        pair,
        group: canonicalPair(pair),
        groupLabel: formatPairGroup(canonicalPair(pair)),

        left: {
          date: appliedDate || normalizeDate(leftCell.date),
          prize: leftCell.prize,
          prizeName: leftCell.prizeName,
          resultIndex: leftCell.resultIndex,
          sourceValue: leftCell.sourceValue,
          digitIndex: pattern.left.digitIndex,
          digitPosition: pattern.left.digitIndex + 1,
          digit: leftDigit
        },

        right: {
          date: appliedDate || normalizeDate(rightCell.date),
          prize: rightCell.prize,
          prizeName: rightCell.prizeName,
          resultIndex: rightCell.resultIndex,
          sourceValue: rightCell.sourceValue,
          digitIndex: pattern.right.digitIndex,
          digitPosition: pattern.right.digitIndex + 1,
          digit: rightDigit
        }
      });
    }

    return applied;
  }

  /*
   * Lấy đuôi 2 số của đủ 27 kết quả DB-G7 ngày N.
   */
  function extractActualTails(dayN) {
    const actualDate = normalizeDate(
      getResultObject(dayN)?.date || dayN?.date
    );

    const rows = validateCompleteDay(dayN, actualDate);

    return rows.map(row => {
      const tail = row.sourceValue.slice(-2).padStart(2, "0");

      return {
        date: row.date,
        prize: row.prize,
        prizeName: row.prizeName,
        resultIndex: row.resultIndex,
        sourceValue: row.sourceValue,
        tail,
        group: canonicalPair(tail),
        groupLabel: formatPairGroup(canonicalPair(tail))
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

    // Ngày N là ngày mục tiêu; ngày N-1 là ngày trước đó.
    const sourceDate = shiftDate(targetDate, -1);
    const dateMap = buildDateMap(data);

    const dayN = dateMap.get(targetDate);
    const dayPrevious = dateMap.get(sourceDate);

    if (!dayN) {
      throw new Error(
        `Thiếu dữ liệu ngày N dùng để xác định mẫu/đối chiếu: ${targetDate}.`
      );
    }

    if (!dayPrevious) {
      throw new Error(
        `Thiếu dữ liệu ngày N-1 dùng để tạo cặp: ${sourceDate}.`
      );
    }

    // Cả hai ngày phải có đủ 27 kết quả chính xác.
    validateCompleteDay(dayN, targetDate);
    validateCompleteDay(dayPrevious, sourceDate);

    // BƯỚC 1: Ngày N xác định mẫu vị trí.
    const positionPatterns = extractPositionPatterns(dayN);

    // BƯỚC 2: Áp dụng tọa độ đó lên ngày N-1.
    const appliedPairs = applyPatternsToPreviousDay(
      positionPatterns,
      dayPrevious,
      {
        patternDate: targetDate,
        appliedDate: sourceDate
      }
    );

    // BƯỚC 3: Ngày N dùng để đối chiếu kết quả thực tế.
    const actualTails = extractActualTails(dayN);
    const actualGroups = new Map();

    for (const tail of actualTails) {
      if (!actualGroups.has(tail.group)) {
        actualGroups.set(tail.group, []);
      }

      actualGroups.get(tail.group).push(tail);
    }

    // Gom lượt tạo cặp ngày N-1 theo nhóm đảo chiều.
    const grouped = new Map();

    for (const item of appliedPairs) {
      if (!grouped.has(item.group)) {
        grouped.set(item.group, {
          group: item.group,
          reverse: item.group.split("").reverse().join(""),
          label: formatPairGroup(item.group),
          occurrences: []
        });
      }

      grouped.get(item.group).occurrences.push(item);
    }

    const results = [];

    for (const record of grouped.values()) {
      const matches = actualGroups.get(record.group) || [];

      // Chỉ giữ nhóm có đuôi thực tế khớp trên ngày N.
      if (matches.length === 0) continue;

      /*
       * Đếm tọa độ theo từng chiều trên ngày N.
       * Không gán tổng nhóm vào số đếm của từng chiều.
       */
      const sourcePairPositionCounts = {};

      for (const pattern of positionPatterns) {
        if (pattern.sourceGroup !== record.group) continue;

        sourcePairPositionCounts[pattern.sourcePair] =
          (sourcePairPositionCounts[pattern.sourcePair] || 0) + 1;
      }

      const sourceGroupPositionCount = Object.values(
        sourcePairPositionCounts
      ).reduce((sum, count) => sum + count, 0);

      results.push({
        // Hai ngày luôn được hiển thị trong mỗi nhóm kết quả.
        patternDate: targetDate,
        appliedDate: sourceDate,
        comparisonDate: targetDate,

        group: record.group,
        reverse: record.reverse,
        label: record.label,

        // Số lượt tạo cặp trên ngày N-1.
        frequency: record.occurrences.length,

        // Tổng số vị trí mẫu hợp lệ của nhóm đảo chiều trên ngày N.
        sourceGroupPositionCount,

        // Số vị trí riêng của từng chiều trên ngày N.
        sourcePairPositionCounts,

        // Mọi lượt tạo cặp và tọa độ đều được giữ lại.
        sourceOccurrences: record.occurrences,

        matched: true,

        // Kết quả thực tế xác nhận trên ngày N.
        matchCount: matches.length,
        comparisonOccurrences: matches
      });
    }

    // Không xếp hạng theo tần suất; không cắt Top 10/Top 15.
    results.sort((a, b) => a.group.localeCompare(b.group));

    const allSourceGroups = new Set(
      appliedPairs.map(item => item.group)
    );

    const qualifyingSourceGroups = new Set(
      positionPatterns.map(item => item.sourceGroup)
    );

    return {
      version: VERSION,

      // Ngày N: mẫu và đối chiếu.
      targetDate,
      patternDate: targetDate,
      compareDate: targetDate,
      comparisonDate: targetDate,

      // Ngày N-1: áp dụng tọa độ để tạo cặp.
      sourceDate,
      appliedDate: sourceDate,

      minimumPatternPositions: MIN_POSITION_COUNT,

      // Tổng số lượt mẫu tọa độ được giữ lại sau ngưỡng.
      patternCount: positionPatterns.length,

      // Số nhóm cặp đảo chiều đủ ngưỡng trên ngày N.
      qualifyingSourceGroupCount: qualifyingSourceGroups.size,

      // Số chiều cặp riêng biệt đủ điều kiện, nếu giao diện cần.
      qualifyingSourcePairCount: new Set(
        positionPatterns.map(item => item.sourcePair)
      ).size,

      // Tổng lượt tạo cặp trên ngày N-1 trước đối chiếu.
      totalAppliedPositions: appliedPairs.length,

      // Nhóm khác nhau được tạo ra trước đối chiếu.
      uniqueGroupCount: allSourceGroups.size,

      // Nhóm khớp kết quả thực tế ngày N.
      matchedGroupCount: results.length,

      // Toàn bộ nhóm khớp, không giới hạn Top 10/15.
      results,

      // Tương thích giao diện cũ; không phải danh sách Top.
      top10: results,
      top15: results,

      sourcePrizeOrder: [
        "DB-G1",
        "G3",
        "G5",
        "G5-G6",
        "G2",
        "G4",
        "G7"
      ],

      comparisonPrizeOrder: PRIZE_ORDER.slice(),

      // Bằng chứng dữ liệu của hai ngày.
      actualTails,
      positionPatterns,
      appliedPairs,

      notes: [
        "patternDate/targetDate là ngày N: xác định mẫu và đối chiếu thực tế.",
        "appliedDate/sourceDate là ngày N-1: áp dụng tọa độ để tạo cặp.",
        "Ngưỡng 4 tính chung nhóm cặp đảo chiều, ví dụ 02 và 20 thuộc nhóm 02/20.",
        "Các chiều cặp và tọa độ của từng vị trí vẫn được bảo toàn.",
        "Không tìm lại tọa độ theo giá trị chữ số.",
        "Đối chiếu với đuôi 2 số của đủ 27 kết quả DB-G7 ngày N.",
        "Dữ liệu thiếu hoặc không đủ 27 kết quả sẽ báo lỗi.",
        "sourceOccurrences thể hiện các lượt tạo cặp từ ngày N-1 và mẫu tương ứng ngày N.",
        "comparisonOccurrences thể hiện kết quả thực tế ngày N dùng để xác nhận.",
        "Không xếp hạng theo tần suất và không giới hạn Top 10/Top 15."
      ]
    };
  }

  root.XSMBAlgorithm = {
    version: VERSION,
    prizeOrder: PRIZE_ORDER.slice(),
    canonicalPair,
    formatPairGroup,
    extractPositionPatterns,
    applyPatternsToPreviousDay,
    extractActualTails,
    analyze
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.XSMBAlgorithm;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
