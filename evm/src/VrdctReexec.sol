// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// A pure Solidity twin of `onchain/programs/vrdct-bond/src/reexec`.
///
/// `Fold` deliberately carries only the Rust Fold promises that this port implements: a checked
/// record count, CMLS session counters/order/gap state, and the one solvency record's exact u128
/// values and tri-state proof. It has no custody, feed ownership, or settlement-state promise;
/// those belong to task 018 slice 2.
library VrdctReexec {
    uint8 internal constant CT_CMLS = 1;
    uint8 internal constant CT_SOLVENCY = 2;
    uint32 internal constant CHUNK_RECORDS = 200;
    uint32 internal constant CAL_2026_VERSION = 202601;
    uint64 internal constant CAL_2026_VALID_FROM = 1_767_225_600;
    uint64 internal constant CAL_2026_VALID_UNTIL = 1_798_761_600;
    uint64 internal constant LIVE_GAP_SECS = 30 * 60;

    uint8 internal constant FLAG_UNKNOWN = 0;
    uint8 internal constant FLAG_GREEN = 1;
    uint8 internal constant FLAG_YELLOW = 2;
    uint8 internal constant FLAG_RED = 3;
    uint8 internal constant FLAG_STALE = 4;

    error UnknownClaimType();
    error InvalidRecordCount();
    error MalformedChunk();
    error NonCanonicalChunk();
    error CalendarOutOfRange();
    error RecordsOutOfOrder();
    error UnsupportedCalendar();

    struct Fold {
        uint32 count;
        uint32 openN;
        uint32 closedN;
        uint64 maxGap;
        uint64 lastTs;
        uint128 backing;
        uint128 liability;
        uint8 inv2b;
        uint32 staleRecords;
    }

    /// h_0 = sha256([claim_type u8][calendar_version u32 LE][n_records u32 LE]).
    function headerDigest(uint8 claimType, uint32 calendarVersion, uint32 nRecords)
        internal
        pure
        returns (bytes32)
    {
        bytes memory header = new bytes(9);
        header[0] = bytes1(claimType);
        _writeU32LE(header, 1, calendarVersion);
        _writeU32LE(header, 5, nRecords);
        return sha256(header); // SHA-256 precompile (0x02), intentionally not keccak256.
    }

    /// The complete SHA-256 chain; validates the supplied count instead of dropping trailing bytes.
    function hashChain(
        uint8 claimType,
        uint32 calendarVersion,
        uint32 nRecords,
        bytes memory records
    ) internal pure returns (bytes32 digest) {
        uint256 size = recordSize(claimType);
        if (nRecords == 0 || records.length != uint256(nRecords) * size) {
            revert InvalidRecordCount();
        }
        digest = headerDigest(claimType, calendarVersion, nRecords);
        uint256 chunkBytes = uint256(CHUNK_RECORDS) * size;
        for (uint256 offset; offset < records.length; offset += chunkBytes) {
            uint256 length = records.length - offset;
            if (length > chunkBytes) length = chunkBytes;
            digest = sha256(bytes.concat(digest, _slice(records, offset, length)));
        }
    }

    /// Fold one canonical chunk. A chunk above 200 records reverts; it is never shortened.
    function foldChunk(uint8 claimType, Fold memory fold, bytes memory chunk)
        internal
        pure
        returns (Fold memory)
    {
        uint256 size = recordSize(claimType);
        if (chunk.length == 0 || chunk.length % size != 0) revert MalformedChunk();
        if (chunk.length / size > CHUNK_RECORDS) revert NonCanonicalChunk();
        if (claimType == CT_CMLS) return _foldCmls(fold, chunk);
        return _foldSolvency(fold, chunk);
    }

    /// Re-execute exactly all committed records, split at the consensus 200-record boundaries.
    function reexecute(
        uint8 claimType,
        uint32 calendarVersion,
        uint32 nRecords,
        bytes memory records
    ) internal pure returns (bytes32 digest, uint8 flag) {
        if (claimType == CT_CMLS && calendarVersion != CAL_2026_VERSION) {
            revert UnsupportedCalendar();
        }
        digest = hashChain(claimType, calendarVersion, nRecords, records);
        Fold memory fold;
        uint256 size = recordSize(claimType);
        uint256 chunkBytes = uint256(CHUNK_RECORDS) * size;
        for (uint256 offset; offset < records.length; offset += chunkBytes) {
            uint256 length = records.length - offset;
            if (length > chunkBytes) length = chunkBytes;
            fold = foldChunk(claimType, fold, _slice(records, offset, length));
        }
        if (fold.count != nRecords) revert InvalidRecordCount();
        flag = verdict(claimType, fold);
    }

    function cmlsVerdict(bytes memory records) internal pure returns (uint8) {
        Fold memory fold = foldChunk(CT_CMLS, Fold(0, 0, 0, 0, 0, 0, 0, 0, 0), records);
        return verdict(CT_CMLS, fold);
    }

    function solvencyVerdict(bytes memory record) internal pure returns (uint8) {
        Fold memory fold = foldChunk(CT_SOLVENCY, Fold(0, 0, 0, 0, 0, 0, 0, 0, 0), record);
        return verdict(CT_SOLVENCY, fold);
    }

    function verdict(uint8 claimType, Fold memory fold) internal pure returns (uint8) {
        if (claimType == CT_CMLS) {
            if (fold.count == 0) return FLAG_UNKNOWN;
            if (fold.closedN > 0 && fold.maxGap < LIVE_GAP_SECS) return FLAG_RED;
            if (fold.closedN == 0) return FLAG_YELLOW;
            return FLAG_UNKNOWN;
        }
        if (claimType == CT_SOLVENCY) {
            if (fold.count == 0) return FLAG_UNKNOWN;
            if (fold.backing < fold.liability || fold.inv2b == 0) return FLAG_RED;
            if (fold.inv2b == 1 && fold.staleRecords == 0) return FLAG_GREEN;
            return FLAG_STALE;
        }
        revert UnknownClaimType();
    }

    function recordSize(uint8 claimType) internal pure returns (uint256) {
        if (claimType == CT_CMLS) return 4;
        if (claimType == CT_SOLVENCY) return 37;
        revert UnknownClaimType();
    }

    function _foldCmls(Fold memory fold, bytes memory chunk) private pure returns (Fold memory) {
        for (uint256 offset; offset < chunk.length; offset += 4) {
            uint64 ts = _readU32LE(chunk, offset);
            if (ts < CAL_2026_VALID_FROM || ts >= CAL_2026_VALID_UNTIL) {
                revert CalendarOutOfRange();
            }
            if (fold.count > 0) {
                if (ts < fold.lastTs) revert RecordsOutOfOrder();
                uint64 gap = ts - fold.lastTs;
                if (gap > fold.maxGap) fold.maxGap = gap;
            }
            if (isSessionOpen(ts)) fold.openN += 1;
            else fold.closedN += 1;
            fold.lastTs = ts;
            fold.count += 1;
        }
        return fold;
    }

    function _foldSolvency(Fold memory fold, bytes memory chunk)
        private
        pure
        returns (Fold memory)
    {
        if (chunk.length != 37 || fold.count != 0) revert MalformedChunk();
        fold.backing = _readU128LE(chunk, 0);
        fold.liability = _readU128LE(chunk, 16);
        fold.inv2b = uint8(chunk[32]);
        fold.staleRecords = _readU32LE(chunk, 33);
        fold.count = 1;
        return fold;
    }

    /// `market_definition_hash` from `lib.rs`, with every Rust LE integer written explicitly.
    function marketDefinitionHash(
        bytes32 marketId,
        uint8 claimType,
        uint32 calendarVersion,
        uint32 nRecords,
        bytes32 inputsHash,
        uint8 sourceKind,
        bytes32 sourceAccount,
        int64 fromTs,
        int64 toTs,
        uint8 yesWhen,
        uint64 bond,
        int64 challengeWindowSecs
    ) internal pure returns (bytes32) {
        return sha256(
            bytes.concat(
                bytes("vrdct:market:v1"),
                marketId,
                bytes1(claimType),
                _u32LE(calendarVersion),
                _u32LE(nRecords),
                inputsHash,
                bytes1(sourceKind),
                sourceAccount,
                _i64LE(fromTs),
                _i64LE(toTs),
                bytes1(yesWhen),
                _u64LE(bond),
                _i64LE(challengeWindowSecs)
            )
        );
    }

    function isSessionOpen(uint64 ts) internal pure returns (bool) {
        (uint256 ymd, uint256 weekday, uint256 minuteOfDay) = _etParts(ts);
        if (weekday == 0 || weekday == 6 || _isHoliday(ymd)) return false;
        uint256 close = _isHalfDay(ymd) ? 13 * 60 : 16 * 60;
        return minuteOfDay >= 9 * 60 + 30 && minuteOfDay < close;
    }

    function _etParts(uint64 ts)
        private
        pure
        returns (uint256 ymd, uint256 weekday, uint256 minuteOfDay)
    {
        int256 wall = int256(uint256(ts)) + _etOffsetHours(ts) * 3600;
        int256 dayNumber = _floorDiv(wall, 86400);
        int256 secs = _floorMod(wall, 86400);
        (int256 y, int256 m, int256 d) = _civilFromDays(dayNumber);
        ymd = uint256(y * 10000 + m * 100 + d);
        weekday = uint256(_floorMod(dayNumber + 4, 7));
        minuteOfDay = uint256(secs / 60);
    }

    function _etOffsetHours(uint64 ts) private pure returns (int256) {
        (int256 y,,) = _civilFromDays(_floorDiv(int256(uint256(ts)), 86400));
        int256 start = _daysFromCivil(y, 3, _nthSunday(y, 3, 2)) * 86400 + 7 * 3600;
        int256 end = _daysFromCivil(y, 11, _nthSunday(y, 11, 1)) * 86400 + 6 * 3600;
        return int256(uint256(ts)) >= start && int256(uint256(ts)) < end ? -4 : -5;
    }

    function _daysFromCivil(int256 y, int256 m, int256 d) private pure returns (int256) {
        y = m <= 2 ? y - 1 : y;
        int256 era = y >= 0 ? y / 400 : (y - 399) / 400;
        int256 yoe = y - era * 400;
        int256 mp = _floorMod(m + 9, 12);
        int256 doy = (153 * mp + 2) / 5 + d - 1;
        int256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

    function _civilFromDays(int256 z) private pure returns (int256 y, int256 m, int256 d) {
        z += 719468;
        int256 era = z >= 0 ? z / 146097 : (z - 146096) / 146097;
        int256 doe = z - era * 146097;
        int256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        y = yoe + era * 400;
        int256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        int256 mp = (5 * doy + 2) / 153;
        d = doy - (153 * mp + 2) / 5 + 1;
        m = mp < 10 ? mp + 3 : mp - 9;
        y = m <= 2 ? y + 1 : y;
    }

    function _nthSunday(int256 y, int256 month, int256 n) private pure returns (int256) {
        int256 firstDow = _floorMod(_daysFromCivil(y, month, 1) + 4, 7);
        return 1 + _floorMod(7 - firstDow, 7) + (n - 1) * 7;
    }

    function _isHoliday(uint256 ymd) private pure returns (bool) {
        return ymd == 20260101 || ymd == 20260119 || ymd == 20260216 || ymd == 20260403
            || ymd == 20260525 || ymd == 20260619 || ymd == 20260703 || ymd == 20260907
            || ymd == 20261126 || ymd == 20261225;
    }

    function _isHalfDay(uint256 ymd) private pure returns (bool) {
        return ymd == 20261127 || ymd == 20261224;
    }

    function _readU32LE(bytes memory value, uint256 offset) private pure returns (uint32 out) {
        for (uint256 i; i < 4; ++i) {
            out |= uint32(uint256(uint8(value[offset + i])) << (8 * i));
        }
    }

    function _readU128LE(bytes memory value, uint256 offset) private pure returns (uint128 out) {
        for (uint256 i; i < 16; ++i) {
            out |= uint128(uint256(uint8(value[offset + i])) << (8 * i));
        }
    }

    function _writeU32LE(bytes memory value, uint256 offset, uint32 number) private pure {
        for (uint256 i; i < 4; ++i) {
            value[offset + i] = bytes1(uint8(number >> (8 * i)));
        }
    }

    function _u32LE(uint32 number) private pure returns (bytes memory value) {
        value = new bytes(4);
        _writeU32LE(value, 0, number);
    }

    function _u64LE(uint64 number) private pure returns (bytes memory value) {
        value = new bytes(8);
        for (uint256 i; i < 8; ++i) {
            value[i] = bytes1(uint8(number >> (8 * i)));
        }
    }

    function _i64LE(int64 number) private pure returns (bytes memory) {
        return _u64LE(uint64(number));
    }

    function _slice(bytes memory value, uint256 offset, uint256 length)
        private
        pure
        returns (bytes memory out)
    {
        out = new bytes(length);
        for (uint256 i; i < length; ++i) {
            out[i] = value[offset + i];
        }
    }

    function _floorDiv(int256 a, int256 b) private pure returns (int256) {
        return a >= 0 ? a / b : -((-a + b - 1) / b);
    }

    function _floorMod(int256 a, int256 b) private pure returns (int256) {
        return a - _floorDiv(a, b) * b;
    }
}
