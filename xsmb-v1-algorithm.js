
/*
 * XSMB V1 - POSITIONAL TRANSFER MATCHER
 * Version 7.1.0
 *
 * Ngày N: tìm mẫu vị trí và kiểm tra đuôi thực tế.
 * Ngày N-1: áp dụng chính xác tọa độ để tạo cặp.
 * Chỉ mẫu có ít nhất 4 tọa độ khác nhau mới được áp dụng.
 *
 * Ô đặc biệt:
 * DB-G1: một ô.
 * G3: 3 ô dọc.
 * G5: 3 ô dọc.
 * G5-G6: 3 ô, mỗi ô dùng hàng G5 gần G6 nhất.
 *
 * Trong mỗi ô: ngang, dọc, chéo.
 * Không ghép qua ranh giới các ô.
 * G2, G4, G7: ghép chữ số liền nhau trong từng kết quả.
 */

(function (root) {
  "use strict";

  const VERSION = "XSMB V1 POSITIONAL TRANSFER MATCHER 7.1.0";
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

  function shiftDate(value, offset) {
    const date = normalizeDate(value);
    if (!date) throw new Error("Ngày không hợp lệ: " + value);

    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  function getResultObject(day) {
    if (!day || typeof day !== "object") return null;
    if (day.prizes && typeof day.prizes === "object") return day;
    if (day.result?.prizes) return day.result;
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

  function canonicalPair(pair) {
    const reverse = pair.split("").reverse().join("");
    return pair <= reverse ? pair : reverse;
  }

  function getDays(data) {
    if (Array.isArray(data?.history?.days)) return data.history.days;
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
      if (date && result?.prizes) map.set(date, result);
    }

    for (const day of getDays(data)) {
      const result = getResultObject(day);
      const date = normalizeDate(result?.date || day?.date);
      if (date && result?.prizes) map.set(date, result);
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
        `${prize} ngày ${rows[0]?.date || "không rõ"}: ` +
        `cần đúng ${expected} số, nhận ${rows.length}.`
      );
    }

    return Array.from({ length: rowCount }, (_, r) =>
      rows.slice(r * columnCount, (r + 1) * columnCount)
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

  /*
   * Tạo các cặp chữ số liền cạnh trong một ô gồm hai kết quả.
   * Hàng trên và hàng dưới có thể có độ dài khác nhau.
   * Mỗi cạnh tọa độ chỉ được thêm một lần.
   */
  function collectBoxCandidates(topCell, bottomCell, relation, candidates, seen) {
    const cells = [topCell, bottomCell];
    const values = cells.map(cell => cell.sourceValue);

    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < values[r].length; c++) {
        const neighbors = [
          [r, c + 1],       // ngang phải
          [r + 1, c - 1],   // chéo xuống trái
          [r + 1, c],       // dọc xuống
          [r + 1, c + 1]    // chéo xuống phải
        ];

        for (const [nr, nc] of neighbors) {
          if (nr >= 2 || nc < 0 || nc >= values[nr].length) continue;

          const left = makeDigitPosition(cells[r], c);
          const right = makeDigitPosition(cells[nr], nc);
          const key = coordinateKey(left, right);

          // Khử trùng theo tọa độ thực, không chỉ theo tên ô.
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

  function collectWithinSingleResult(row, candidates, seen) {
    const cell = makeCell(row);

    for (let i = 0; i < cell.sourceValue.length - 1; i++) {
      const left = makeDigitPosition(cell, i);
      const right = makeDigitPosition(cell, i + 1);
      const key = coordinateKey(left, right);

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

    // DB-G1: ô chứa DB và G1.
    const db = getPrizeRows(dayN, ["DB"]);
    const g1 = getPrizeRows(dayN, ["G1"]);

    if (db.length !== 1 || g1.length !== 1) {
      throw new Error("DB-G1 không đủ dữ liệu để tạo ô ghép.");
    }

    collectBoxCandidates(
      makeCell(db[0], 0, 0),
      makeCell(g1[0], 1, 0),
      "DB-G1-box",
      candidates,
      seen
    );

    // G3: 3 ô, ghép dọc theo từng cột.
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

    // G5: 3 ô, mỗi ô có hàng G5 trên và hàng G5 dưới.
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

    // G5-G6: chỉ hàng G5 ngay phía trên G6.
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

    // G2, G4, G7: các chữ số liền nhau trong từng kết quả.
    for (const row of getPrizeRows(dayN, ["G2", "G4", "G7"])) {
      collectWithinSingleResult(row, candidates, seen);
    }

    return candidates;
  }

  function extractPositionPatterns(dayN) {
    const candidates = collectCandidatePatterns(dayN);
    const byPair = new Map();

    for (const candidate of candidates) {
      if (!byPair.has(candidate.sourcePair)) {
        byPair.set(candidate.sourcePair, new Map());
      }

      // Một cặp có thể có nhiều tọa độ; mỗi tọa độ chỉ đếm một lần.
      byPair.get(candidate.sourcePair).set(
        candidate.patternId,
        candidate
      );
    }

    const eligible = [];

    for (const [sourcePair, positions] of byPair) {
      const occurrences = Array.from(positions.values());

      if (occurrences.length < MIN_POSITION_COUNT) continue;

      eligible.push({
        sourcePair,
        occurrences,
        positionCount: occurrences.length
      });
    }

    eligible.sort((a, b) =>
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
    const separator = cellId.lastIndexOf(":");
    const prize = cellId.slice(0, separator);
    const resultIndex = Number(cellId.slice(separator + 1));

    const row = getPrizeRows(day, [prize]).find(
      item => item.resultIndex === resultIndex
    );

    if (!row) return null;

    // Giữ nguyên ID giải và chỉ số kết quả để chuyển tọa độ chính xác.
    return makeCell(row);
  }

  function applyPatternsToPreviousDay(patterns, dayPrevious) {
    const applied = [];
    const seen = new Set();

    for (const pattern of patterns) {
      const leftCell = getCellById(dayPrevious, pattern.left.cellId);
      const rightCell = getCellById(dayPrevious, pattern.right.cellId);

      if (!leftCell || !rightCell) continue;

      const leftDigit = leftCell.sourceValue[pattern.left.digitIndex];
      const rightDigit = rightCell.sourceValue[pattern.right.digitIndex];

      // Nếu cấu trúc số ngày N-1 không đủ vị trí tương ứng, bỏ qua.
      if (leftDigit === undefined || rightDigit === undefined) continue;

      const left = makeDigitPosition(leftCell, pattern.left.digitIndex);
      const right = makeDigitPosition(rightCell, pattern.right.digitIndex);
      const transferKey = coordinateKey(left, right);

      if (seen.has(transferKey)) continue;
      seen.add(transferKey);

      const pair = leftDigit + rightDigit;

      applied.push({
        date: normalizeDate(leftCell.date),
        patternId: pattern.patternId,
        transferKey,
        relation: pattern.relation,
        sourcePairOnTargetDay: pattern.sourcePair,
        sourcePairPositionCount: pattern.sourcePairPositionCount,
        pair,
        group: canonicalPair(pair),
        left: {
          prize: leftCell.prize,
          prizeName: leftCell.prizeName,
          resultIndex: leftCell.resultIndex,
          sourceValue: leftCell.sourceValue,
          digitIndex: pattern.left.digitIndex,
          digitPosition: pattern.left.digitIndex + 1,
          digit: leftDigit
        },
        right: {
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

    const sourceDate = shiftDate(targetDate, -1);
    const dateMap = buildDateMap(data);
    const dayN = dateMap.get(targetDate);
    const dayPrevious = dateMap.get(sourceDate);

    if (!dayN) {
      throw new Error(`Thiếu dữ liệu ngày mục tiêu ${targetDate}.`);
    }

    if (!dayPrevious) {
      throw new Error(`Thiếu dữ liệu ngày nguồn ${sourceDate}.`);
    }

    // Mẫu được tìm trên ngày N, không phải ngày N-1.
    const patterns = extractPositionPatterns(dayN);

    // Chuyển nguyên tọa độ sang ngày N-1.
    const appliedPairs = applyPatternsToPreviousDay(patterns, dayPrevious);

    // Kiểm tra đuôi thực tế của tất cả giải ngày N.
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
          maxPatternPositionCount: 0
        });
      }

      const record = grouped.get(item.group);
      record.occurrences.push(item);
      record.maxPatternPositionCount = Math.max(
        record.maxPatternPositionCount,
        item.sourcePairPositionCount
      );
    }

    const results = [];

    for (const record of grouped.values()) {
      const matches = actualGroups.get(record.group) || [];
      if (matches.length === 0) continue;

      results.push({
        group: record.group,
        reverse: record.reverse,
        label: record.label,

        // Số lượt tạo ở ngày nguồn, không phải điều kiện mẫu.
        frequency: record.occurrences.length,
        positionCount: record.occurrences.length,

        // Số vị trí của mẫu ngày mục tiêu đã được dùng.
        maxPatternPositionCount: record.maxPatternPositionCount,

        sourceOccurrences: record.occurrences,
        matched: true,
        matchCount: matches.length,
        comparisonOccurrences: matches
      });
    }

    // Ưu tiên mẫu có nhiều vị trí hợp lệ trên ngày N.
    // Không xếp theo tần suất lô tô và không cắt Top 10/15.
    results.sort((a, b) =>
      b.maxPatternPositionCount - a.maxPatternPositionCount ||
      a.group.localeCompare(b.group)
    );

    results.forEach((item, index) => {
      item.rank = index + 1;
    });

    return {
      version: VERSION,
      targetDate,
      sourceDate,
      compareDate: targetDate,
      minimumPatternPositions: MIN_POSITION_COUNT,
      patternCount: patterns.length,
      qualifyingSourcePairCount: new Set(
        patterns.map(item => item.sourcePair)
      ).size,
      totalAppliedPositions: appliedPairs.length,
      uniqueGroupCount: grouped.size,
      matchedGroupCount: results.length,
      results,

      // Giữ hai trường tương thích với code cũ; không giới hạn kết quả.
      top10: results,
      top15: results,

      sourcePrizeOrder: [
        "DB-G1", "G3", "G5", "G5-G6", "G2", "G4", "G7"
      ],
      comparisonPrizeOrder: PRIZE_ORDER.slice(),
      actualTails,
      positionPatterns: patterns,
      appliedPairs,
      notes: [
        "Mẫu được xác định từ ngày N; áp dụng tọa độ lên ngày N-1.",
        "Mỗi mẫu phải có ít nhất 4 tọa độ khác nhau trên ngày N.",
        "Không tính lặp cùng tọa độ trong một lần chuyển.",
        "DB-G1, từng ô G3, từng ô G5 và từng ô G5-G6 được xử lý riêng.",
        "G6 chỉ ghép với hàng G5 gần nhất ngay phía trên.",
        "G2, G4, G7 chỉ ghép chữ số liền nhau trong từng kết quả.",
        "Chỉ giữ cặp khớp đuôi hai số của giải DB-G7 ngày N.",
        "Gộp cặp đảo chiều khi trình bày nhưng giữ các lượt tạo cặp.",
        "Không giới hạn kết quả ở Top 10 hoặc Top 15."
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
