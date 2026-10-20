
/*
 * XSMB V1 - POSITIONAL TRANSFER MATCHER
 * Version 5.0.0
 *
 * Quy trình:
 * 1. Ngày N xác định các cụm ô và vị trí chữ số tạo cặp.
 * 2. Áp dụng đúng các vị trí đó lên ngày N-1.
 * 3. Đối chiếu cặp tạo từ ngày N-1 với đuôi 2 số của DB-G7 ngày N.
 * 4. Loại cặp không xuất hiện trong kết quả thực tế.
 * 5. Đếm theo số vị trí ghép, không xếp hạng Top 10/15.
 *
 * Bố cục giả định:
 * G3: 2 hàng x 3 cột.
 * G5: 2 hàng x 3 cột.
 * G6: 1 hàng x 3 cột.
 *
 * Các số trong mảng prizes phải giữ đúng thứ tự ô trên bảng nguồn.
 */
(function (root) {
  "use strict";

  const VERSION = "XSMB V1 POSITIONAL TRANSFER MATCHER 5.0.0";

  const PRIZE_ORDER = [
    "DB", "G1", "G2", "G3", "G4", "G5", "G6", "G7"
  ];

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

    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return s;

    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }

    return null;
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

      const values = Array.isArray(raw) ? raw : [raw];

      values.forEach((value, index) => {
        const digits = digitsOnly(value);

        if (!digits) return;

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

    if (Array.isArray(data?.days)) {
      return data.days;
    }

    return [];
  }

  function buildDateMap(data) {
    const map = new Map();

    // Kết quả ngày được chọn có thể nằm trực tiếp trong data.
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

    // Kết quả lịch sử từ Worker.
    for (const day of getDays(data)) {
      const result = getResultObject(day);
      const date = normalizeDate(result?.date || day?.date);

      if (date && result?.prizes) {
        map.set(date, day);
      }
    }

    return map;
  }

  /*
   * Xây dựng lưới theo thứ tự mảng:
   *
   * G3/G5:
   *   [0] [1] [2]
   *   [3] [4] [5]
   *
   * G6:
   *   [0] [1] [2]
   */
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
        selected.slice(r * columnCount, (r + 1) * columnCount)
      );
    }

    return grid;
  }

  function makeCell(row, rowIndex, columnIndex) {
    return {
      date: row.date,
      prize: row.prize,
      prizeName: row.prizeName,
      resultIndex: row.resultIndex,
      sourceValue: row.sourceValue,
      rowIndex,
      columnIndex
    };
  }

  function makeSourceGrids(day) {
    const g3 = makeGrid(day, "G3", 2, 3);
    const g5 = makeGrid(day, "G5", 2, 3);
    const g6 = makeGrid(day, "G6", 1, 3);

    return {
      G3: g3.map((row, r) =>
        row.map((cell, c) => makeCell(cell, r, c))
      ),
      G5: g5.map((row, r) =>
        row.map((cell, c) => makeCell(cell, r, c))
      ),
      G6: g6.map((row, r) =>
        row.map((cell, c) => makeCell(cell, r, c))
      )
    };
  }

  function makeCellId(cell) {
    return `${cell.prize}:${cell.resultIndex}`;
  }

  /*
   * Tạo cụm ô đủ điều kiện.
   *
   * G3: mỗi cụm gồm hai cột liền kề trong lưới 2x3.
   * G5: mỗi cụm gồm hai ô trên/dưới cùng cột.
   * G5-G6: ghép hai ô G5 cùng cột với ô G6 tương ứng.
   *
   * Từng cụm có ID riêng để truy lại vị trí tạo cặp.
   */
  function buildClusters(grids) {
    const clusters = [];

    // G3: hai cột liền kề, mỗi cột có hai ô.
    for (let c = 0; c < 2; c++) {
      clusters.push({
        id: `G3_COLUMNS_${c + 1}_${c + 2}`,
        cells: [
          grids.G3[0][c],
          grids.G3[1][c],
          grids.G3[0][c + 1],
          grids.G3[1][c + 1]
        ]
      });
    }

    // G5: cặp ô trên/dưới cùng cột.
    for (let c = 0; c < 3; c++) {
      clusters.push({
        id: `G5_COLUMN_${c + 1}`,
        cells: [
          grids.G5[0][c],
          grids.G5[1][c]
        ]
      });
    }

    // G5-G6: hai ô G5 và ô G6 cùng cột.
    for (let c = 0; c < 3; c++) {
      clusters.push({
        id: `G5_G6_COLUMN_${c + 1}`,
        cells: [
          grids.G5[0][c],
          grids.G5[1][c],
          grids.G6[0][c]
        ]
      });
    }

    return clusters;
  }

  /*
   * Tìm tất cả vị trí của một chữ số trong cụm.
   * Mỗi vị trí lưu rõ giải, ô và chỉ số chữ số.
   * digitIndex là chỉ số bắt đầu từ 0 trong chuỗi số.
   */
  function collectDigitPositions(cluster) {
    const positions = [];

    for (const cell of cluster.cells) {
      for (
        let digitIndex = 0;
        digitIndex < cell.sourceValue.length;
        digitIndex++
      ) {
        positions.push({
          clusterId: cluster.id,
          cellId: makeCellId(cell),
          prize: cell.prize,
          prizeName: cell.prizeName,
          resultIndex: cell.resultIndex,
          rowIndex: cell.rowIndex,
          columnIndex: cell.columnIndex,
          sourceValue: cell.sourceValue,
          digitIndex,
          digitPosition: digitIndex + 1,
          digit: cell.sourceValue[digitIndex]
        });
      }
    }

    return positions;
  }

  /*
   * Ngày N xác định cặp chữ số và tọa độ của từng vị trí.
   * Mỗi tổ hợp hai vị trí chữ số khác nhau trong một cụm
   * tạo thành một mẫu để áp dụng lên ngày N-1.
   */
  function extractPositionPatterns(dayN) {
    const grids = makeSourceGrids(dayN);
    const clusters = buildClusters(grids);
    const patterns = [];
    const seen = new Set();

    for (const cluster of clusters) {
      const positions = collectDigitPositions(cluster);

      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const left = positions[i];
          const right = positions[j];

          const sameCell = left.cellId === right.cellId;

          // Hai chữ số phải là hai vị trí khác nhau.
          if (
            sameCell &&
            left.digitIndex === right.digitIndex
          ) {
            continue;
          }

          // Chỉ lấy một mẫu cho mỗi cặp tọa độ trong mỗi cụm.
          const coordinates = [
            `${left.cellId}@${left.digitIndex}`,
            `${right.cellId}@${right.digitIndex}`
          ].sort();

          const uniqueKey =
            `${cluster.id}|${coordinates[0]}|${coordinates[1]}`;

          if (seen.has(uniqueKey)) continue;
          seen.add(uniqueKey);

          patterns.push({
            patternId: uniqueKey,
            clusterId: cluster.id,
            sourcePair: left.digit + right.digit,
            sourceGroup: canonicalPair(left.digit + right.digit),
            left,
            right
          });
        }
      }
    }

    return patterns;
  }

  function getCellById(grids, cellId) {
    const [prize, indexText] = cellId.split(":");
    const resultIndex = Number(indexText);

    const grid = grids[prize];
    if (!grid) return null;

    for (const row of grid) {
      for (const cell of row) {
        if (cell.resultIndex === resultIndex) {
          return cell;
        }
      }
    }

    return null;
  }

  /*
   * Áp dụng các tọa độ đã xác định trên ngày N
   * lên số liệu ngày N-1.
   */
  function applyPatternsToPreviousDay(patterns, dayPrevious) {
    const grids = makeSourceGrids(dayPrevious);
    const applied = [];

    for (const pattern of patterns) {
      const leftCell = getCellById(grids, pattern.left.cellId);
      const rightCell = getCellById(grids, pattern.right.cellId);

      if (!leftCell || !rightCell) continue;

      const leftDigit = leftCell.sourceValue[pattern.left.digitIndex];
      const rightDigit = rightCell.sourceValue[pattern.right.digitIndex];

      if (leftDigit === undefined || rightDigit === undefined) {
        continue;
      }

      const pair = leftDigit + rightDigit;

      applied.push({
        date: leftCell.date,
        patternId: pattern.patternId,
        clusterId: pattern.clusterId,
        pair,
        group: canonicalPair(pair),

        left: {
          prize: leftCell.prize,
          prizeName: leftCell.prizeName,
          resultIndex: leftCell.resultIndex,
          rowIndex: leftCell.rowIndex,
          columnIndex: leftCell.columnIndex,
          sourceValue: leftCell.sourceValue,
          digitIndex: pattern.left.digitIndex,
          digitPosition: pattern.left.digitIndex + 1,
          digit: leftDigit
        },

        right: {
          prize: rightCell.prize,
          prizeName: rightCell.prizeName,
          resultIndex: rightCell.resultIndex,
          rowIndex: rightCell.rowIndex,
          columnIndex: rightCell.columnIndex,
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
        "Cần dữ liệu ngày N để xác định các vị trí ghép và đối chiếu."
      );
    }

    if (!dayPrevious) {
      throw new Error(
        `Thiếu kết quả ngày trước ${previousDate} để áp dụng các vị trí ghép.`
      );
    }

    // Ngày N chỉ xác định vị trí ghép.
    const patterns = extractPositionPatterns(dayN);

    // Áp dụng đúng tọa độ lên ngày N-1.
    const appliedPairs = applyPatternsToPreviousDay(
      patterns,
      dayPrevious
    );

    // Đối chiếu với đuôi 2 số của tất cả giải DB-G7 ngày N.
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
          label: item.group === reverse
            ? item.group
            : `${item.group}/${reverse}`,
          occurrences: [],
          firstOrder: grouped.size
        });
      }

      grouped.get(item.group).occurrences.push(item);
    }

    // Không xếp hạng theo tần suất.
    // Giữ thứ tự nhóm xuất hiện lần đầu trong danh sách vị trí.
    const results = [];

    for (const record of grouped.values()) {
      const matches = actualGroups.get(record.group) || [];

      // Cặp không có trong kết quả thực tế ngày N thì loại.
      if (matches.length === 0) continue;

      results.push({
        rank: results.length + 1,
        group: record.group,
        reverse: record.reverse,
        label: record.label,

        // Số vị trí tạo cặp, không phải tần suất lô tô.
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
      sourceDate: targetDate,
      compareDate: previousDate,

      patternCount: patterns.length,
      totalAppliedPositions: appliedPairs.length,
      uniqueGroupCount: grouped.size,
      matchedGroupCount: results.length,

      // Kết quả chính: tất cả nhóm cặp khớp, không cắt Top 10/15.
      results,

      // Tên trường tương thích với giao diện cũ.
      // Đây không phải danh sách Top 10 theo tần suất.
      top10: results,
      top15: results,

      sourcePrizeOrder: ["G3", "G5", "G6"],
      comparisonPrizeOrder: PRIZE_ORDER.slice(),

      actualTails,
      positionPatterns: patterns,
      appliedPairs,

      notes: [
        "Ngày N xác định cụm ô và tọa độ chữ số ghép.",
        "Ngày N-1 nhận đúng các tọa độ đã xác định từ ngày N.",
        "Đối chiếu dùng đuôi hai chữ số của DB đến G7 ngày N.",
        "Cặp đảo chiều được gộp khi trình bày.",
        "Cặp không xuất hiện trong kết quả thực tế bị loại.",
        "Không chọn Top 10 hoặc Top 15 theo tần suất.",
        "positionCount là số vị trí tạo cặp.",
        "Bố cục lưới phải khớp thứ tự số Worker trả về."
      ]
    };
  }

  root.XSMBAlgorithm = {
    version: VERSION,
    prizeOrder: ["G3", "G5", "G6"],
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
