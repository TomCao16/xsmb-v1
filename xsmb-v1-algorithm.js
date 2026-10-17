
/*
 * XSMB V1 - ALGORITHM MODULE
 * Version: 1.0.0
 *
 * Input:
 *   JSON từ Worker /history?date=YYYY-MM-DD
 *
 * Expected shape:
 *   {
 *     "history": {
 *       "days": [
 *         {
 *           "result": {
 *             "date": "2026-10-16",
 *             "complete": true,
 *             "prizes": {
 *               "DB": ["..."],
 *               "G1": ["..."],
 *               "G2": ["...", "..."],
 *               "G3": ["...", "...", "...", "...", "...", "..."],
 *               "G4": ["...", "...", "...", "..."],
 *               "G5": ["...", "...", "...", "...", "...", "..."],
 *               "G6": ["...", "...", "..."],
 *               "G7": ["...", "...", "...", "..."]
 *             },
 *             "loto": ["01", "23", "..."],
 *             "loto_count": 27,
 *             "validation": {
 *               "expected_total": 27,
 *               "actual_total": 27,
 *               "all_prizes_valid": true
 *             }
 *           }
 *         }
 *       ]
 *     }
 *   }
 *
 * Output:
 *   XSMBAlgorithm.analyze(data)
 *
 * This module does not fetch URLs or change the Worker.
 * It only analyzes data supplied to it.
 */

(function (root) {
  "use strict";

  const VERSION = "XSMB V1 ALGORITHM 1.0.0";

  const PRIZE_KEYS = [
    "DB", "G1", "G2", "G3",
    "G4", "G5", "G6", "G7"
  ];

  const EXPECTED_PRIZE_COUNTS = {
    DB: 1,
    G1: 1,
    G2: 2,
    G3: 6,
    G4: 4,
    G5: 6,
    G6: 3,
    G7: 4
  };

  const EXPECTED_TOTAL = 27;

  // --------------------------------------------------
  // 1. Tiện ích ngày tháng
  // --------------------------------------------------

  function isValidDateString(date) {
    if (typeof date !== "string") return false;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return false;
    }

    const d = new Date(date + "T00:00:00Z");

    return (
      !Number.isNaN(d.getTime()) &&
      d.toISOString().slice(0, 10) === date
    );
  }

  function addDays(date, amount) {
    if (!isValidDateString(date)) return null;

    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + amount);

    return d.toISOString().slice(0, 10);
  }

  function dayDifference(dateA, dateB) {
    if (
      !isValidDateString(dateA) ||
      !isValidDateString(dateB)
    ) {
      return null;
    }

    const a = Date.parse(dateA + "T00:00:00Z");
    const b = Date.parse(dateB + "T00:00:00Z");

    return Math.round((b - a) / 86400000);
  }

  // --------------------------------------------------
  // 2. Chuẩn hóa dữ liệu
  // --------------------------------------------------

  function getResultObject(day) {
    if (!day || typeof day !== "object") return null;

    if (
      day.result &&
      typeof day.result === "object" &&
      !Array.isArray(day.result)
    ) {
      return day.result;
    }

    return day;
  }

  function normalizePrizeValues(value) {
    if (Array.isArray(value)) {
      return value.map(normalizeNumberValue);
    }

    if (
      typeof value === "string" ||
      typeof value === "number"
    ) {
      return [normalizeNumberValue(value)];
    }

    return [];
  }

  function normalizeNumberValue(value) {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "number") {
      if (!Number.isInteger(value) || value < 0) {
        return null;
      }

      // Lưu ý: số dạng number không thể giữ số 0 đầu.
      return String(value);
    }

    if (typeof value === "string") {
      const cleaned = value.trim();

      if (!/^\d+$/.test(cleaned)) {
        return null;
      }

      return cleaned;
    }

    if (typeof value === "object") {
      const possibleValues = [
        value.number,
        value.value,
        value.result,
        value.prize
      ];

      for (const item of possibleValues) {
        if (
          typeof item === "string" ||
          typeof item === "number"
        ) {
          return normalizeNumberValue(item);
        }
      }
    }

    return null;
  }

  function normalizeLotoValue(value) {
    const normalized = normalizeNumberValue(value);

    if (normalized === null) return null;

    if (!/^\d{1,2}$/.test(normalized)) {
      return null;
    }

    return normalized.padStart(2, "0");
  }

  function getPrizeValues(result, prizeKey) {
    if (!result || !result.prizes) return [];

    return normalizePrizeValues(result.prizes[prizeKey]);
  }

  function getAllPrizeRecords(result) {
    const records = [];

    for (const prize of PRIZE_KEYS) {
      const values = getPrizeValues(result, prize);

      values.forEach((value, resultIndex) => {
        records.push({
          prize,
          resultIndex,
          value
        });
      });
    }

    return records;
  }

  function getLotoValues(result) {
    if (!result || !Array.isArray(result.loto)) {
      return [];
    }

    return result.loto.map(normalizeLotoValue);
  }

  // --------------------------------------------------
  // 3. Kiểm tra tính hợp lệ của một ngày
  // --------------------------------------------------

  function validateDay(day) {
    const result = getResultObject(day);
    const errors = [];
    const warnings = [];

    if (!result) {
      return {
        valid: false,
        date: null,
        errors: ["Không tìm thấy object kết quả."],
        warnings: []
      };
    }

    const date = result.date || day.date || null;

    if (!isValidDateString(date)) {
      errors.push("Ngày không hợp lệ hoặc không đúng YYYY-MM-DD.");
    }

    if (result.complete !== true) {
      errors.push("Kết quả chưa được xác nhận complete=true.");
    }

    if (
      !result.prizes ||
      typeof result.prizes !== "object"
    ) {
      errors.push("Thiếu object prizes.");
    }

    const prizeRecords = getAllPrizeRecords(result);

    for (const prize of PRIZE_KEYS) {
      const values = getPrizeValues(result, prize);
      const expected = EXPECTED_PRIZE_COUNTS[prize];

      if (values.length !== expected) {
        errors.push(
          prize + ": cần " + expected +
          " kết quả, hiện có " + values.length + "."
        );
      }

      values.forEach((value, index) => {
        if (
          value === null ||
          !/^\d{2,5}$/.test(value)
        ) {
          errors.push(
            prize + "[" + index +
            "] không phải chuỗi số hợp lệ từ 2 đến 5 chữ số."
          );
        }
      });
    }

    if (prizeRecords.length !== EXPECTED_TOTAL) {
      errors.push(
        "Tổng số kết quả giải là " +
        prizeRecords.length + ", không phải 27."
      );
    }

    if (
      result.validation &&
      result.validation.all_prizes_valid === false
    ) {
      errors.push("Worker báo all_prizes_valid=false.");
    }

    if (
      result.validation &&
      Number.isFinite(result.validation.expected_total) &&
      result.validation.expected_total !== EXPECTED_TOTAL
    ) {
      errors.push("validation.expected_total không bằng 27.");
    }

    if (
      result.validation &&
      Number.isFinite(result.validation.actual_total) &&
      result.validation.actual_total !== EXPECTED_TOTAL
    ) {
      errors.push("validation.actual_total không bằng 27.");
    }

    const loto = getLotoValues(result);

    if (!Array.isArray(result.loto)) {
      errors.push("Thiếu mảng loto.");
    }

    if (loto.length !== EXPECTED_TOTAL) {
      errors.push(
        "Lô tô có " + loto.length +
        " lượt, không phải 27."
      );
    }

    if (
      result.loto_count !== undefined &&
      Number(result.loto_count) !== EXPECTED_TOTAL
    ) {
      errors.push("loto_count không bằng 27.");
    }

    loto.forEach((value, index) => {
      if (value === null) {
        errors.push(
          "Lô tô tại vị trí " + index +
          " không phải số 1–2 chữ số hợp lệ."
        );
      }
    });

    // Kiểm tra lô tô có khớp với 2 số cuối của 27 giải không.
    // So sánh dạng multiset, không chỉ so sánh số lượng.
    const expectedLoto = prizeRecords
      .filter(record => record.value !== null)
      .map(record => record.value.slice(-2).padStart(2, "0"));

    if (
      expectedLoto.length === EXPECTED_TOTAL &&
      loto.length === EXPECTED_TOTAL &&
      loto.every(value => value !== null)
    ) {
      const expectedSorted = expectedLoto.slice().sort();
      const actualSorted = loto.slice().sort();

      const same = expectedSorted.every(
        (value, index) => value === actualSorted[index]
      );

      if (!same) {
        errors.push(
          "Mảng loto không trùng khớp với 2 số cuối của các giải."
        );
      }
    }

    if (
      result.validation &&
      result.validation.all_prizes_valid === undefined
    ) {
      warnings.push(
        "Worker không cung cấp validation.all_prizes_valid."
      );
    }

    return {
      valid: errors.length === 0,
      date,
      errors,
      warnings,
      prizeCount: prizeRecords.length,
      lotoCount: loto.length
    };
  }

  // --------------------------------------------------
  // 4. Tách cặp 2 chữ số liền nhau từ TẤT CẢ giải
  // --------------------------------------------------

  function extractPairs(day) {
    const result = getResultObject(day);

    if (!result) return [];

    const date = result.date || day.date || null;
    const records = getAllPrizeRecords(result);
    const pairs = [];

    for (const record of records) {
      const value = record.value;

      if (
        typeof value !== "string" ||
        !/^\d{2,5}$/.test(value)
      ) {
        continue;
      }

      // position=0 là cặp từ chữ số đầu tiên.
      // Ví dụ chuỗi "12345" tạo:
      // vị trí 0 -> "12"
      // vị trí 1 -> "23"
      // vị trí 2 -> "34"
      // vị trí 3 -> "45"
      for (let position = 0; position < value.length - 1; position++) {
        const pair = value.slice(position, position + 2);

        pairs.push({
          date,
          prize: record.prize,
          resultIndex: record.resultIndex,
          sourceValue: value,
          position,
          pair,
          ruleKey: record.prize + "|" + position
        });
      }
    }

    return pairs;
  }

  // --------------------------------------------------
  // 5. Đối chiếu với lô tô ngày kế tiếp
  // --------------------------------------------------

  function reversePair(pair) {
    return pair[1] + pair[0];
  }

  function pairMatchesLoto(pair, lotoSet) {
    if (
      typeof pair !== "string" ||
      !/^\d{2}$/.test(pair)
    ) {
      return false;
    }

    const reversed = reversePair(pair);

    // Một cặp nguồn chỉ trả về true/false một lần,
    // kể cả khi cả cặp thuận và đảo cùng xuất hiện.
    return lotoSet.has(pair) || lotoSet.has(reversed);
  }

  // --------------------------------------------------
  // 6. Tiện ích thống kê
  // --------------------------------------------------

  function roundNumber(value, digits) {
    const factor = Math.pow(10, digits || 2);
    return Math.round(value * factor) / factor;
  }

  function percentage(numerator, denominator) {
    if (!denominator) return 0;

    return roundNumber(
      (numerator / denominator) * 100,
      2
    );
  }

  function createRuleStats(ruleKey) {
    const parts = ruleKey.split("|");

    return {
      ruleKey,
      prize: parts[0],
      position: Number(parts[1]),
      checks: 0,
      hits: 0,
      testedDates: new Set(),
      hitDates: new Set()
    };
  }

  // --------------------------------------------------
  // 7. Phân tích lịch sử theo từng ngày liên tiếp
  // --------------------------------------------------

  function analyze(data, options) {
    const settings = options || {};
    const warnings = [];
    const errors = [];

    const rawDays =
      data &&
      data.history &&
      Array.isArray(data.history.days)
        ? data.history.days
        : data && Array.isArray(data.days)
          ? data.days
          : null;

    if (!rawDays) {
      return {
        version: VERSION,
        success: false,
        errors: [
          "Không tìm thấy history.days hoặc days trong JSON đầu vào."
        ],
        warnings: [],
        validation: [],
        transitions: [],
        ranking: [],
        rules: [],
        latestDate: null,
        targetDate: null
      };
    }

    // Chuẩn hóa và sắp xếp theo ngày tăng dần.
    const normalizedDays = rawDays
      .map(day => ({
        raw: day,
        result: getResultObject(day)
      }))
      .filter(item => item.result)
      .map(item => ({
        raw: item.raw,
        result: item.result,
        date: item.result.date || item.raw.date || null
      }))
      .sort((a, b) => {
        return String(a.date).localeCompare(String(b.date));
      });

    if (normalizedDays.length === 0) {
      return {
        version: VERSION,
        success: false,
        errors: ["Không có ngày kết quả nào để phân tích."],
        warnings: [],
        validation: [],
        transitions: [],
        ranking: [],
        rules: [],
        latestDate: null,
        targetDate: null
      };
    }

    // Loại ngày trùng, ghi nhận cảnh báo.
    const uniqueDays = [];
    const seenDates = new Set();

    for (const day of normalizedDays) {
      if (seenDates.has(day.date)) {
        warnings.push(
          "Ngày " + day.date +
          " xuất hiện nhiều lần; chỉ dùng bản ghi đầu tiên sau sắp xếp."
        );
        continue;
      }

      seenDates.add(day.date);
      uniqueDays.push(day);
    }

    const validation = uniqueDays.map(day => {
      const check = validateDay(day.raw);

      return {
        date: day.date,
        valid: check.valid,
        errors: check.errors,
        warnings: check.warnings,
        prizeCount: check.prizeCount,
        lotoCount: check.lotoCount
      };
    });

    const validationByDate = new Map(
      validation.map(item => [item.date, item])
    );

    for (const item of validation) {
      if (!item.valid) {
        warnings.push(
          "Ngày " + item.date +
          " không hợp lệ: " + item.errors.join(" ")
        );
      }
    }

    // Phát hiện khoảng trống giữa các ngày.
    for (let i = 1; i < uniqueDays.length; i++) {
      const previous = uniqueDays[i - 1].date;
      const current = uniqueDays[i].date;
      const difference = dayDifference(previous, current);

      if (difference !== 1) {
        warnings.push(
          "Khoảng trống ngày: " + previous + " -> " + current +
          " (cách nhau " + difference + " ngày). " +
          "Không đối chiếu xuyên qua khoảng trống này."
        );
      }
    }

    const latestDay = uniqueDays[uniqueDays.length - 1];
    const latestDate = latestDay.date;
    const latestValidation = validationByDate.get(latestDate);

    const defaultTargetDate = isValidDateString(latestDate)
      ? addDays(latestDate, 1)
      : null;

    const targetDate = settings.targetDate || defaultTargetDate;

    if (
      targetDate &&
      !isValidDateString(targetDate)
    ) {
      errors.push("options.targetDate không hợp lệ.");
    }

    if (
      targetDate &&
      defaultTargetDate &&
      targetDate !== defaultTargetDate
    ) {
      warnings.push(
        "Ngày mục tiêu " + targetDate +
        " không phải ngày ngay sau ngày dữ liệu mới nhất " +
        latestDate + ". Xếp hạng vẫn dựa trên dữ liệu lịch sử " +
        "đã kiểm tra, không khẳng định dự báo cho ngày này."
      );
    }

    const rulesMap = new Map();
    const transitions = [];

    // Chỉ so sánh ngày nguồn với ngày kế tiếp liền kề.
    for (let i = 0; i < uniqueDays.length - 1; i++) {
      const sourceDay = uniqueDays[i];
      const targetDay = uniqueDays[i + 1];

      const expectedNextDate = addDays(sourceDay.date, 1);

      if (targetDay.date !== expectedNextDate) {
        continue;
      }

      const sourceCheck = validationByDate.get(sourceDay.date);
      const targetCheck = validationByDate.get(targetDay.date);

      if (
        !sourceCheck ||
        !sourceCheck.valid ||
        !targetCheck ||
        !targetCheck.valid
      ) {
        transitions.push({
          sourceDate: sourceDay.date,
          targetDate: targetDay.date,
          status: "SKIPPED_INVALID_DATA",
          reason: "Ngày nguồn hoặc ngày đích không vượt qua kiểm tra."
        });
        continue;
      }

      const sourcePairs = extractPairs(sourceDay.raw);
      const targetLoto = getLotoValues(targetDay.result);
      const targetLotoSet = new Set(targetLoto);

      let transitionHits = 0;

      for (const pairRecord of sourcePairs) {
        if (!rulesMap.has(pairRecord.ruleKey)) {
          rulesMap.set(
            pairRecord.ruleKey,
            createRuleStats(pairRecord.ruleKey)
          );
        }

        const stats = rulesMap.get(pairRecord.ruleKey);

        stats.checks += 1;
        stats.testedDates.add(sourceDay.date);

        const hit = pairMatchesLoto(
          pairRecord.pair,
          targetLotoSet
        );

        if (hit) {
          stats.hits += 1;
          stats.hitDates.add(sourceDay.date);
          transitionHits += 1;
        }
      }

      transitions.push({
        sourceDate: sourceDay.date,
        targetDate: targetDay.date,
        status: "CHECKED",
        sourcePairCount: sourcePairs.length,
        targetLotoCount: targetLoto.length,
        matchedOccurrences: transitionHits
      });
    }

    // ------------------------------------------------
    // 8. Tạo bảng hiệu quả theo giải + vị trí cặp
    // ------------------------------------------------

    const rules = Array.from(rulesMap.values()).map(stats => {
      const testedDays = stats.testedDates.size;
      const hitDays = stats.hitDates.size;
      const occurrenceRate = percentage(
        stats.hits,
        stats.checks
      );
      const dayHitRate = percentage(
        hitDays,
        testedDays
      );

      // Điểm xếp hạng tham khảo, không phải xác suất trúng.
      const rankingScore = roundNumber(
        dayHitRate * 0.7 + occurrenceRate * 0.3,
        2
      );

      return {
        ruleKey: stats.ruleKey,
        prize: stats.prize,
        position: stats.position,
        checks: stats.checks,
        hits: stats.hits,
        testedDays,
        hitDays,
        occurrenceRate,
        dayHitRate,
        rankingScore
      };
    });

    rules.sort((a, b) =>
      b.rankingScore - a.rankingScore ||
      b.dayHitRate - a.dayHitRate ||
      b.occurrenceRate - a.occurrenceRate ||
      b.checks - a.checks ||
      a.prize.localeCompare(b.prize) ||
      a.position - b.position
    );

    // ------------------------------------------------
    // 9. Xếp hạng cặp ứng viên từ ngày nguồn mới nhất
    // ------------------------------------------------

    let candidates = [];
    const latestIsValid = Boolean(
      latestValidation && latestValidation.valid
    );

    if (!latestIsValid) {
      warnings.push(
        "Ngày mới nhất " + latestDate +
        " không hợp lệ. Không tạo danh sách ứng viên từ ngày này."
      );
    } else {
      const latestPairs = extractPairs(latestDay.raw);
      const ruleLookup = new Map(
        rules.map(rule => [rule.ruleKey, rule])
      );
      const candidateMap = new Map();

      for (const pairRecord of latestPairs) {
        if (!candidateMap.has(pairRecord.pair)) {
          candidateMap.set(pairRecord.pair, {
            number: pairRecord.pair,
            occurrences: 0,
            sources: [],
            sourceRules: new Set()
          });
        }

        const candidate = candidateMap.get(pairRecord.pair);
        const rule = ruleLookup.get(pairRecord.ruleKey);

        candidate.occurrences += 1;
        candidate.sources.push({
          prize: pairRecord.prize,
          resultIndex: pairRecord.resultIndex,
          sourceValue: pairRecord.sourceValue,
          position: pairRecord.position,
          pair: pairRecord.pair,
          ruleKey: pairRecord.ruleKey,
          historicalChecks: rule ? rule.checks : 0,
          historicalHits: rule ? rule.hits : 0,
          historicalTestedDays: rule ? rule.testedDays : 0,
          historicalHitDays: rule ? rule.hitDays : 0,
          historicalOccurrenceRate: rule ? rule.occurrenceRate : 0,
          historicalDayHitRate: rule ? rule.dayHitRate : 0,
          historicalRankingScore: rule ? rule.rankingScore : 0
        });

        candidate.sourceRules.add(pairRecord.ruleKey);
      }

      candidates = Array.from(candidateMap.values()).map(item => {
        const ruleScores = item.sources.map(source =>
          source.historicalRankingScore
        );

        const bestScore = ruleScores.length
          ? Math.max(...ruleScores)
          : 0;

        const averageScore = ruleScores.length
          ? roundNumber(
              ruleScores.reduce((sum, score) => sum + score, 0) /
                ruleScores.length,
              2
            )
          : 0;

        const bestDayHitRate = item.sources.length
          ? Math.max(
              ...item.sources.map(source =>
                source.historicalDayHitRate
              )
            )
          : 0;

        const bestOccurrenceRate = item.sources.length
          ? Math.max(
              ...item.sources.map(source =>
                source.historicalOccurrenceRate
              )
            )
          : 0;

        return {
          number: item.number,
          occurrencesInLatestDay: item.occurrences,
          distinctSourceRules: item.sourceRules.size,
          bestHistoricalRankingScore: bestScore,
          averageHistoricalRankingScore: averageScore,
          bestHistoricalDayHitRate: bestDayHitRate,
          bestHistoricalOccurrenceRate: bestOccurrenceRate,
          historicalEvidenceAvailable: item.sources.some(
            source => source.historicalChecks > 0
          ),
          sources: item.sources
        };
      });

      candidates.sort((a, b) =>
        b.bestHistoricalRankingScore -
          a.bestHistoricalRankingScore ||
        b.bestHistoricalDayHitRate -
          a.bestHistoricalDayHitRate ||
        b.bestHistoricalOccurrenceRate -
          a.bestHistoricalOccurrenceRate ||
        b.distinctSourceRules - a.distinctSourceRules ||
        b.occurrencesInLatestDay - a.occurrencesInLatestDay ||
        a.number.localeCompare(b.number)
      );

      candidates.forEach((candidate, index) => {
        candidate.rank = index + 1;
      });
    }

    // ------------------------------------------------
    // 10. Kết quả trả về
    // ------------------------------------------------

    const validDayCount = validation.filter(
      item => item.valid
    ).length;

    const checkedTransitionCount = transitions.filter(
      item => item.status === "CHECKED"
    ).length;

    const skippedTransitionCount = transitions.filter(
      item => item.status !== "CHECKED"
    ).length;

    return {
      version: VERSION,
      success: errors.length === 0,
      summary: {
        inputDays: uniqueDays.length,
        validDays: validDayCount,
        invalidDays: uniqueDays.length - validDayCount,
        checkedTransitions: checkedTransitionCount,
        skippedTransitions: skippedTransitionCount,
        ruleCount: rules.length,
        candidateCount: candidates.length
      },
      latestDate,
      targetDate,
      targetDateIsNextDay:
        Boolean(defaultTargetDate && targetDate === defaultTargetDate),
      predictionStatus:
        latestIsValid && rules.length > 0
          ? "HISTORICAL_RANKING_ONLY"
          : "INSUFFICIENT_VALID_DATA",
      notes: [
        "Cặp đảo chiều được tính khớp nếu xuất hiện trong lô tô ngày đích.",
        "Mỗi lần xuất hiện của cặp nguồn chỉ được tính khớp tối đa một lần.",
        "Tỷ lệ lịch sử không phải xác suất chắc chắn cho ngày tiếp theo.",
        "Chỉ so sánh giữa hai ngày lịch liên tiếp và cả hai ngày phải hợp lệ.",
        "Điểm xếp hạng dùng 70% tỷ lệ ngày có khớp và 30% tỷ lệ lượt khớp."
      ],
      errors,
      warnings,
      validation,
      transitions,
      rules,
      ranking: candidates
    };
  }

  // --------------------------------------------------
  // 11. Xuất module cho trình duyệt hoặc Node.js
  // --------------------------------------------------

  const API = {
    version: VERSION,
    prizeKeys: PRIZE_KEYS.slice(),
    expectedPrizeCounts: { ...EXPECTED_PRIZE_COUNTS },
    validateDay,
    extractPairs,
    analyze
  };

  root.XSMBAlgorithm = API;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
