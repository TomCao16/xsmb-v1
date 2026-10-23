
/*
 * XSMB V1 - POSITIONAL TRANSFER MATCHER
 * Version 7.2.1
 *
 * QUY TẮC BẮT BUỘC:
 * 1. Ngày N: xác định mẫu từ tọa độ chữ số thực tế.
 * 2. Chỉ nhận cặp có thứ tự có >= 4 cạnh tọa độ khác nhau trên N.
 * 3. Ngày N-1: áp dụng nguyên tọa độ của mẫu ngày N để tạo cặp mới.
 * 4. Ngày N: đối chiếu cặp mới với đuôi 2 số của đủ 27 kết quả DB-G7.
 * 5. Chỉ trả các nhóm có kết quả khớp.
 * 6. Gộp cặp đảo chiều khi hiển thị, giữ nguyên mọi lượt và tọa độ.
 * 7. Không xếp hạng theo tần suất; không cắt Top 10/Top 15.
 *
 * Vùng xét:
 * - DB-G1
 * - G3: lưới 2 hàng x 3 cột
 * - G5: lưới 2 hàng x 3 cột
 * - G5-G6: hàng G5 gần G6 nhất kết hợp với G6
 * - G2, G4, G7: chữ số liền nhau trong từng kết quả
 *
 * Trong lưới: xét chữ số liền nhau trong từng số và các vị trí
 * tương ứng/ngang lệch 1 giữa các ô liền kề ngang, dọc, chéo.
 * Không nối các ô không kề nhau.
 *
 * API tương thích:
 * XSMBAlgorithm.analyze(data, { targetDate: "YYYY-MM-DD" })
 */

(function (root) {
  "use strict";

  const VERSION = "XSMB V1 POSITIONAL TRANSFER MATCHER 7.2.1";
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
      countByPrize[prize] = rows.filter(row => row.prize === prize).length;

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

  function canonicalPair(pair) {
    const reverse = pair.split("").reverse().join("");
    return pair <= reverse ? pair : reverse;
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
   * Khóa cạnh không phụ thuộc chiều duyệt để một cạnh tọa độ
   * thực tế không bị đếm lặp khi các vùng có phần giao nhau.
   *
   * Chiều của cặp số vẫn được lưu riêng trong sourcePair.
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
   * Ghép chữ số liền nhau bên trong một kết quả.
   * Thứ tự cặp luôn từ trái sang phải.
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
   * Ghép hai ô kết quả liền kề trong lưới.
   *
   * Mỗi chữ số của ô trước được ghép với các chữ số có chỉ số
   * tương ứng, lệch trái một hoặc lệch phải một ở ô kế bên.
   *
   * Ví dụ: chỉ số 2 có thể ghép với chỉ số 1, 2 hoặc 3.
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
      for (let j = Math.max(0, i - 1); j <= Math.min(secondLength - 1, i + 1); j++) {
        const left = makeDigitPosition(firstCell, i);
        const right = makeDigitPosition(secondCell, j);

        addCandidate(left, right, relation, candidates, seen);
      }
    }
  }

  /*
   * Duyệt lưới kết quả:
   * - Cặp chữ số liền nhau bên trong mỗi số.
   * - Hai ô liền ngang.
   * - Hai ô liền dọc.
   * - Hai ô liền chéo.
   *
   * Chỉ xét các ô liền kề; không nối ô cách nhau.
   */
  function collectGridCandidates(grid, relationPrefix, candidates, seen) {
    const rowCount = grid.length;

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const cell = grid[r][c];

        collectWithinSingleResult(
          cell,
          candidates,
          seen
        );

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

    // DB-G1: DB ở hàng trên, G1 ở hàng dưới.
    const db = getPrizeRows(dayN, ["DB"]);
    const g1 = getPrizeRows(dayN, ["G1"]);

    if (db.length !== 1 || g1.length !== 1) {
      throw new Error("DB-G1 không đủ dữ liệu để tạo vùng vị trí.");
    }

    const dbGrid = [
      [makeCell(db[0], 0, 0)],
      [makeCell(g1[0], 1, 0)]
    ];

    collectGridCandidates(
      dbGrid,
      "DB-G1",
      candidates,
      seen
    );

    // G3: sáu kết quả xếp thành lưới 2 hàng x 3 cột.
    const g3 = makeGrid(dayN, "G3", 2, 3);

    collectGridCandidates(
      g3,
      "G3",
      candidates,
      seen
    );

    // G5: sáu kết quả xếp thành lưới 2 hàng x 3 cột.
    const g5 = makeGrid(dayN, "G5", 2, 3);

    collectGridCandidates(
      g5,
      "G5",
      candidates,
      seen
    );

    // G5-G6: hàng G5 gần G6 nhất kết hợp với hàng G6.
    const g6 = makeGrid(dayN, "G6", 1, 3);
    const g5Bottom = g5[1].map((cell, columnIndex) =>
      makeCell(
        {
          date: cell.date,
          prize: cell.prize,
          prizeName: cell.prizeName,
          resultIndex: cell.resultIndex,
          sourceValue: cell.sourceValue
        },
        0,
        columnIndex
      )
    );

    const g5g6Grid = [
      g5Bottom,
      g6[0].map((cell, columnIndex) =>
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

    // G2, G4, G7: chỉ ghép chữ số liền nhau trong từng kết quả.
    for (const row of getPrizeRows(dayN, ["G2", "G4", "G7"])) {
      collectWithinSingleResult(row, candidates, seen);
    }

    return candidates;
  }

  /*
   * Ngưỡng >= 4 áp dụng cho từng cặp có thứ tự trên ngày N.
   * Mỗi patternId đại diện cho một cạnh tọa độ thực tế duy nhất.
   */
  function extractPositionPatterns(dayN) {
    const candidates = collectCandidatePatterns(dayN);
    const byPair = new Map();

    for (const candidate of candidates) {
      if (!byPair.has(candidate.sourcePair)) {
        byPair.set(candidate.sourcePair, new Map());
      }

      byPair.get(candidate.sourcePair).set(
        candidate.patternId,
        candidate
      );
    }

    const patterns = [];

    for (const [sourcePair, positionMap] of byPair) {
      const occurrences = Array.from(positionMap.values());

      if (occurrences.length < MIN_POSITION_COUNT) {
        continue;
      }

      const sourcePairPositionCount = occurrences.length;

      for (const occurrence of occurrences) {
        patterns.push({
          ...occurrence,
          sourceGroup: canonicalPair(sourcePair),
          sourcePairPositionCount,
          minimumRequiredPositions: MIN_POSITION_COUNT
        });
      }
    }

    return patterns;
  }

  /*
   * Tìm đúng kết quả tương ứng theo giải và thứ tự kết quả.
   * Ví dụ G5 kết quả thứ 4 trên ngày N vẫn ánh xạ vào G5
   * kết quả thứ 4 trên ngày N-1, không tìm theo giá trị số.
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

      if (!leftCell || !rightCell) {
        continue;
      }

      const leftDigit = leftCell.sourceValue[pattern.left.digitIndex];
      const rightDigit = rightCell.sourceValue[pattern.right.digitIndex];

      // Không thay tọa độ bằng cách tìm chữ số tương tự.
      // Nếu vị trí không tồn tại ở N-1 thì bỏ lượt đó.
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
        date: normalizeDate(leftCell.date),
        patternId: pattern.patternId,
        transferKey: coordinateKey(left, right),
        relation: pattern.relation,

        sourcePairOnTargetDay: pattern.sourcePair,
        sourcePairPositionCount: pattern.sourcePairPositionCount,

        // Tọa độ gốc dùng để nhận diện mẫu trên ngày N.
        patternOccurrence: {
          patternId: pattern.patternId,
          relation: pattern.relation,
          sourcePair: pattern.sourcePair,
          left: { ...pattern.left },
          right: { ...pattern.right }
        },

        // Cặp được tạo bằng dữ liệu ngày N-1.
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

  /*
   * Lấy đuôi 2 số của đủ 27 kết quả DB-G7 trên ngày N.
   * Số có một chữ số được chuẩn hóa thành 0x.
   */
  function extractActualTails(dayN) {
    const rows = validateCompleteDay(
      dayN,
      normalizeDate(getResultObject(dayN)?.date || dayN?.date)
    );

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
      throw new Error(
        `Thiếu dữ liệu ngày mục tiêu N: ${targetDate}.`
      );
    }

    if (!dayPrevious) {
      throw new Error(
        `Thiếu dữ liệu ngày nguồn N-1: ${sourceDate}.`
      );
    }

    // Bảo đảm ngày N có đủ dữ liệu thực tế để xác định mẫu
    // và làm dữ liệu đối chiếu.
    validateCompleteDay(dayN, targetDate);

    // Bảo đảm ngày N-1 đủ dữ liệu để chuyển tọa độ.
    validateCompleteDay(dayPrevious, sourceDate);

    // BƯỚC 1: Chỉ ngày N được dùng để xác định mẫu vị trí.
    const positionPatterns = extractPositionPatterns(dayN);

    // BƯỚC 2: Chuyển nguyên tọa độ mẫu sang ngày N-1.
    const appliedPairs = applyPatternsToPreviousDay(
      positionPatterns,
      dayPrevious
    );

    // BƯỚC 3: Đối chiếu với đuôi thực tế DB-G7 ngày N.
    const actualTails = extractActualTails(dayN);
    const actualGroups = new Map();

    for (const tail of actualTails) {
      if (!actualGroups.has(tail.group)) {
        actualGroups.set(tail.group, []);
      }

      actualGroups.get(tail.group).push(tail);
    }

    // Gom tất cả lượt tạo cặp theo cặp đảo chiều chuẩn hóa.
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
          occurrences: []
        });
      }

      grouped.get(item.group).occurrences.push(item);
    }

    const results = [];

    for (const record of grouped.values()) {
      const matches = actualGroups.get(record.group) || [];

      // Chỉ giữ cặp có ít nhất một kết quả thực tế khớp.
      if (matches.length === 0) {
        continue;
      }

      const sourcePairPositionCounts = {};

      for (const pattern of positionPatterns) {
        if (canonicalPair(pattern.sourcePair) !== record.group) {
          continue;
        }

        sourcePairPositionCounts[pattern.sourcePair] =
          pattern.sourcePairPositionCount;
      }

      results.push({
        group: record.group,
        reverse: record.reverse,
        label: record.label,

        // Số lượt tạo cặp trên ngày N-1 trong nhóm hiển thị.
        frequency: record.occurrences.length,

        // Số tọa độ nguồn cho từng cặp có thứ tự trên ngày N.
        sourcePairPositionCounts,

        // Mọi lượt tạo cặp đều được bảo toàn.
        sourceOccurrences: record.occurrences,

        matched: true,

        // Số kết quả DB-G7 ngày N xác nhận nhóm này.
        matchCount: matches.length,
        comparisonOccurrences: matches
      });
    }

    // Không xếp hạng theo tần suất.
    // Sắp xếp theo nhãn để đầu ra ổn định, dễ kiểm tra.
    results.sort((a, b) => a.group.localeCompare(b.group));

    const allSourceGroups = new Set(
      appliedPairs.map(item => item.group)
    );

    return {
      version: VERSION,

      targetDate,
      sourceDate,
      compareDate: targetDate,

      minimumPatternPositions: MIN_POSITION_COUNT,

      // Tổng số tọa độ mẫu được áp dụng.
      patternCount: positionPatterns.length,

      qualifyingSourcePairCount: new Set(
        positionPatterns.map(item => item.sourcePair)
      ).size,

      // Tổng lượt tạo cặp trên ngày N-1, trước đối chiếu.
      totalAppliedPositions: appliedPairs.length,

      // Số nhóm khác nhau được tạo ra trước đối chiếu.
      uniqueGroupCount: allSourceGroups.size,

      // Số nhóm còn lại sau khi đối chiếu thực tế.
      matchedGroupCount: results.length,

      // Toàn bộ nhóm khớp, không cắt Top 10/Top 15.
      results,

      // Trường tương thích với một số giao diện cũ.
      // Đây là toàn bộ kết quả, không phải danh sách Top 10/15.
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

      actualTails,
      positionPatterns,
      appliedPairs,

      notes: [
        "Ngày N xác định mẫu vị trí từ kết quả thực tế.",
        "Chỉ giữ cặp có thứ tự với ít nhất 4 cạnh tọa độ khác nhau trên ngày N.",
        "Chuyển nguyên tọa độ sang ngày N-1 để tạo cặp.",
        "Không tìm lại tọa độ theo giá trị chữ số.",
        "Đối chiếu với đuôi 2 số của đủ 27 kết quả DB-G7 ngày N.",
        "Dữ liệu thiếu hoặc không đủ 27 kết quả sẽ báo lỗi.",
        "Gộp cặp đảo chiều khi hiển thị nhưng giữ nguyên từng lượt tạo cặp.",
        "sourcePairPositionCounts lưu số tọa độ theo từng cặp có thứ tự.",
        "frequency đếm lượt tạo cặp trên ngày N-1.",
        "matchCount đếm kết quả thực tế xác nhận trên ngày N.",
        "sourceOccurrences và comparisonOccurrences là hai danh sách khác nhau.",
        "Không xếp hạng theo tần suất và không giới hạn Top 10/Top 15."
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
