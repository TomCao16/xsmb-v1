
/*
 * XSMB V1 - POSITIONAL TRANSFER MATCHER
 * Version 7.0.0
 *
 * Quy tắc:
 * 1. Ngày N xác định cặp chữ số và tọa độ hợp lệ.
 * 2. Cặp phải xuất hiện tại ít nhất 4 tọa độ khác nhau.
 * 3. Ưu tiên cặp có nhiều tọa độ hợp lệ hơn.
 * 4. Áp dụng tọa độ lên ngày N-1 để tạo cặp.
 * 5. Đối chiếu cặp tạo ra với đuôi 2 số của DB-G7 ngày N.
 * 6. Gộp cặp đảo chiều khi hiển thị, giữ toàn bộ lần tạo cặp.
 * 7. Không cắt Top 10/15.
 *
 * Ô đặc biệt:
 * DB-G1: một ô gồm hai số.
 * G3: ba ô, mỗi ô gồm hai số G3 theo cột.
 * G5: ba ô, mỗi ô gồm hai số G5 theo cột.
 * G5-G6: ba ô, mỗi ô gồm số G5 hàng dưới và số G6 tương ứng.
 * Trong mỗi ô, ghép chữ số liền kề ngang, dọc, chéo.
 * Không ghép giữa hai ô khác nhau.
 */

(function (root) {
  "use strict";

  const VERSION = "XSMB V1 POSITIONAL TRANSFER MATCHER 7.0.0";
  const MIN_POSITION_COUNT = 4;
  const PRIZE_ORDER = ["DB", "G1", "G2", "G3", "G4", "G5", "G6", "G7"];

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
    if (!normalized) throw new Error("Ngày không hợp lệ: " + date);

    const d = new Date(normalized + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + amount);
    return d.toISOString().slice(0, 10);
  }

  function getResultObject(day) {
    if (!day || typeof day !== "object") return null;
    if (day.prizes && typeof day.prizes === "object") return day;

    if (day.result && typeof day.result === "object" && day.result.prizes) {
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
    const direct = [
      data?.current,
      data?.currentDay,
      data?.day,
      data?.result,
      data
    ];

    for (const candidate of direct) {
      const result = getResultObject(candidate);
      const date = normalizeDate(result?.date || candidate?.date);
      if (date && result?.prizes) map.set(date, candidate);
    }

    for (const day of getDays(data)) {
      const result = getResultObject(day);
      const date = normalizeDate(result?.date || day?.date);
      if (date && result?.prizes) map.set(date, day);
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

  function coordinateKey(a, b) {
    const x = `${a.cellId}@${a.digitIndex}`;
    const y = `${b.cellId}@${b.digitIndex}`;
    return x <= y ? `${x}|${y}` : `${y}|${x}`;
  }

  /*
   * Một ô gồm hai kết quả đặt thành hai hàng chữ số.
   * Chỉ nối các vị trí cách nhau tối đa một hàng và một cột.
   * Các vị trí được duyệt một lần, tránh đếm trùng tọa độ.
   */
  function collectBoxCandidates(topCell, bottomCell, relation, candidates, seen) {
    const top = topCell.sourceValue;
    const bottom = bottomCell.sourceValue;

    const rows = [top, bottom];
    const cells = [topCell, bottomCell];

    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        for (let dr = 0; dr <= 1; dr++) {
          const nr = r + dr;
          if (nr >= 2) continue;

          for (let dc = -1; dc <= 1; dc++) {
            // Cùng hàng chỉ lấy chữ số bên phải.
            if (dr === 0 && dc !== 1) continue;
            if (dr === 1 && dc === -1 && c - 1 < 0) continue;

            const nc = c + dc;
            if (nc < 0 || nc >= rows[nr].length) continue;

            const left = makeDigitPosition(cells[r], c);
            const right = makeDigitPosition(cells[nr], nc);
            const key = `${relation}|${coordinateKey(left, right)}`;

            if (seen.has(key)) continue;
            seen.add(key);

            candidates.push({
              patternId: key,
              relation,
              sourcePair: left.digit + right.digit,
              left,
              right
            });
          }
        }
      }
    }
  }

  function collectWithinSingleResult(row, candidates, seen) {
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

  function collectCandidatePatterns(dayN) {
    const candidates = [];
    const seen = new Set();

    // DB-G1: ô hai hàng, mỗi hàng là một kết quả.
    const db = getPrizeRows(dayN, ["DB"]);
    const g1 = getPrizeRows(dayN, ["G1"]);

    if (db.length && g1.length) {
      collectBoxCandidates(
        makeCell(db[0], 0, 0),
        makeCell(g1[0], 1, 0),
        "DB-G1-box",
        candidates,
        seen
      );
    }

    // G3: 3 ô dọc, mỗi ô gồm một số ở hàng trên và một số ở hàng dưới.
    const g3 = makeGrid(dayN, "G3", 2, 3);

    for (let c = 0; c < 3; c++) {
      collectBoxCandidates(
        g3[0][c],
        g3[1][c],
        `G3-box-${c + 1}`,
        candidates,
        seen
      );
    }

    // G5: 3 ô dọc.
    const g5 = makeGrid(dayN, "G5", 2, 3);

    for (let c = 0; c < 3; c++) {
      collectBoxCandidates(
        g5[0][c],
        g5[1][c],
        `G5-box-${c + 1}`,
        candidates,
        seen
      );
    }

    // G5-G6: chỉ hàng G5 gần G6; không nhảy lên hàng G5 trên.
    const g6 = makeGrid(dayN, "G6", 1, 3);

    for (let c = 0; c < 3; c++) {
      collectBoxCandidates(
        g5[1][c],
        g6[0][c],
        `G5-G6-box-${c + 1}`,
        candidates,
        seen
      );
    }

    // G2, G4, G7: chỉ ghép chữ số liền nhau trong từng kết quả.
    const ordinaryRows = getPrizeRows(dayN, ["G2", "G4", "G7"]);

    for (const row of ordinaryRows) {
      collectWithinSingleResult(row, candidates, seen);
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
    const parts = cellId.split(":");
    const prize = parts[0];
    const resultIndex = Number(parts[1]);

    const row = getPrizeRows(day, [prize]).find(
      item => item.resultIndex === resultIndex
    );

    return row ? makeCell(row) : null;
  }

  function applyPatternsToPreviousDay(patterns, dayPrevious) {
    const applied = [];

    for (const pattern of patterns) {
      const leftCell = getCellById(dayPrevious, pattern.left.cellId);
      const rightCell = getCellById(dayPrevious, pattern.right.cellId);

      if (!leftCell || !rightCell) continue;

      const leftDigit = leftCell.sourceValue[pattern.left.digitIndex];
      const rightDigit = rightCell.sourceValue[pattern.right.digitIndex];

      if (leftDigit === undefined || rightDigit === undefined) continue;

      const pair = leftDigit + rightDigit;

      applied.push({
        date: leftCell.date,
        patternId: pattern.patternId,
        relation: pattern.relation,
        sourcePairOnTargetDay: pattern.sourcePair,
        sourcePairPositionCount: pattern.sourcePairPositionCount,
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
      options.targetDate || data?.requested_date || data?.date
    );

    if (!targetDate) throw new Error("Thiếu ngày mục tiêu hợp lệ.");

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
    const appliedPairs = applyPatternsToPreviousDay(patterns, dayPrevious);
    const actualTails = extractActualTails(dayN);
    const actualGroups = new Map();

    for (const tail of actualTails) {
      if (!actualGroups.has(tail.group)) actualGroups.set(tail.group, []);
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

    const results = [];

    for (const record of grouped.values()) {
      const matches = actualGroups.get(record.group) || [];
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
      top10: results,
      top15: results,
      sourcePrizeOrder: ["DB-G1", "G3", "G5", "G5-G6", "G2", "G4", "G7"],
      comparisonPrizeOrder: PRIZE_ORDER.slice(),
      actualTails,
      positionPatterns: patterns,
      appliedPairs,
      notes: [
        "Ngày N xác định mẫu; mỗi cặp phải có ít nhất 4 tọa độ hợp lệ khác nhau.",
        "Áp dụng nguyên tọa độ lên ngày N-1 để tạo cặp mới.",
        "Đối chiếu đuôi hai chữ số của tất cả giải DB-G7 ngày N.",
        "Các ô DB-G1, G3, G5 và G5-G6 được xử lý độc lập.",
        "G6 chỉ ghép với hàng G5 gần nhất, không ghép lên hàng G5 phía trên.",
        "Các giải G2, G4, G7 chỉ ghép chữ số liền nhau trong từng kết quả.",
        "Cặp đảo chiều được gộp khi hiển thị; mọi lần tạo cặp vẫn được giữ.",
        "Không cắt danh sách kết quả theo Top 10/15."
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
