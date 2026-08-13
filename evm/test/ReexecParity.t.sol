// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {VrdctReexec} from "../src/VrdctReexec.sol";

/// Deliberately tiny Foundry interface: the test's only cheatcode use is reading the committed
/// JS-generated fixtures. Assertions are local so this project has no Solidity-specific dependency.
interface Vm {
    function readFile(string calldata path) external view returns (string memory);
}

contract ReexecHarness {
    function hashChain(
        uint8 claimType,
        uint32 calendarVersion,
        uint32 nRecords,
        bytes calldata records
    ) external pure returns (bytes32) {
        return VrdctReexec.hashChain(claimType, calendarVersion, nRecords, records);
    }

    function reexecute(
        uint8 claimType,
        uint32 calendarVersion,
        uint32 nRecords,
        bytes calldata records
    ) external pure returns (bytes32, uint8) {
        return VrdctReexec.reexecute(claimType, calendarVersion, nRecords, records);
    }

    function cmlsVerdict(bytes calldata records) external pure returns (uint8) {
        return VrdctReexec.cmlsVerdict(records);
    }

    function solvencyVerdict(bytes calldata record) external pure returns (uint8) {
        return VrdctReexec.solvencyVerdict(record);
    }

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
    ) external pure returns (bytes32) {
        return VrdctReexec.marketDefinitionHash(
            marketId,
            claimType,
            calendarVersion,
            nRecords,
            inputsHash,
            sourceKind,
            sourceAccount,
            fromTs,
            toTs,
            yesWhen,
            bond,
            challengeWindowSecs
        );
    }
}

contract ReexecParityTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    ReexecHarness private harness;

    event GasMeasurement(
        bytes32 indexed subject, uint256 records, uint256 gasUsed, uint256 gasPerRecord
    );

    function setUp() public {
        harness = new ReexecHarness();
    }

    /// This consumes the committed fixture also consumed by JS and Rust. It never generates vectors.
    function testParityVectors() public {
        bytes memory file = bytes(vm.readFile("../onchain/tests/parity-vectors.txt"));
        uint256 rows;
        uint256 start;
        for (uint256 end; end <= file.length; ++end) {
            if (end != file.length && file[end] != "\n") continue;
            if (end > start && file[start] != "#") {
                bytes memory line = _slice(file, start, end - start);
                bytes memory kind = _field(line, 0);
                uint8 claimType;
                if (_eq(kind, "CMLS")) claimType = 1;
                else if (_eq(kind, "SOLVENCY")) claimType = 2;
                else revert("unknown fixture kind");

                uint8 expectedFlag = uint8(_parseUint(_field(line, 2)));
                bytes memory records = _hex(_field(line, 3));
                bytes32 expectedDigest = _bytes32(_hex(_field(line, 4)));
                uint32 nRecords = uint32(records.length / (claimType == 1 ? 4 : 37));
                (bytes32 digest, uint8 flag) =
                    harness.reexecute(claimType, 202601, nRecords, records);
                _eqBytes32(digest, expectedDigest);
                _eqUint(flag, expectedFlag);
                ++rows;
            }
            start = end + 1;
        }
        _eqUint(rows, 162);
    }

    /// This is the separate market-key fixture generated from `core/encode.mjs` and checked in Rust.
    function testMarketDefinitionVectors() public {
        bytes memory file = bytes(vm.readFile("../onchain/tests/market-definition-vectors.txt"));
        uint256 rows;
        uint256 start;
        for (uint256 end; end <= file.length; ++end) {
            if (end != file.length && file[end] != "\n") continue;
            if (end > start && file[start] != "#") {
                bytes memory line = _slice(file, start, end - start);
                bytes32 actual = harness.marketDefinitionHash(
                    _bytes32(_hex(_field(line, 1))),
                    uint8(_parseUint(_field(line, 2))),
                    uint32(_parseUint(_field(line, 3))),
                    uint32(_parseUint(_field(line, 4))),
                    _bytes32(_hex(_field(line, 5))),
                    uint8(_parseUint(_field(line, 6))),
                    _bytes32(_hex(_field(line, 7))),
                    int64(int256(_parseUint(_field(line, 8)))),
                    int64(int256(_parseUint(_field(line, 9)))),
                    uint8(_parseUint(_field(line, 10))),
                    uint64(_parseUint(_field(line, 11))),
                    int64(int256(_parseUint(_field(line, 12))))
                );
                _eqBytes32(actual, _bytes32(_hex(_field(line, 13))));
                ++rows;
            }
            start = end + 1;
        }
        _eqUint(rows, 2);
    }

    /// Emits measured gas. CMLS uses the committed corpus's 201-record, two-chunk row; solvency has one.
    function testGasMeasurements() public {
        bytes memory cmls = _parityRecords("multi-chunk-201");
        _eqUint(cmls.length / 4, 201);
        uint256 beforeGas = gasleft();
        harness.hashChain(1, 202601, 201, cmls);
        _measure("hash-chain-cmls", 201, beforeGas - gasleft());

        beforeGas = gasleft();
        harness.cmlsVerdict(_slice(cmls, 0, 200 * 4));
        _measure("cmls-fold-verdict", 200, beforeGas - gasleft());

        bytes memory solvency =
            hex"00000000000000000000000000000000000000000000000000000000000000000100000000";
        beforeGas = gasleft();
        harness.hashChain(2, 202601, 1, solvency);
        _measure("hash-chain-solvency", 1, beforeGas - gasleft());

        beforeGas = gasleft();
        harness.solvencyVerdict(solvency);
        _measure("solvency-fold-verdict", 1, beforeGas - gasleft());
    }

    function _measure(bytes32 subject, uint256 records, uint256 gasUsed) private {
        emit GasMeasurement(subject, records, gasUsed, gasUsed / records);
    }

    function _parityRecords(bytes memory label) private view returns (bytes memory) {
        bytes memory file = bytes(vm.readFile("../onchain/tests/parity-vectors.txt"));
        uint256 start;
        for (uint256 end; end <= file.length; ++end) {
            if (end != file.length && file[end] != "\n") continue;
            if (end > start && file[start] != "#") {
                bytes memory line = _slice(file, start, end - start);
                if (_eq(_field(line, 1), label)) return _hex(_field(line, 3));
            }
            start = end + 1;
        }
        revert("missing parity label");
    }

    function _field(bytes memory line, uint256 wanted) private pure returns (bytes memory) {
        uint256 field;
        uint256 start;
        for (uint256 end; end <= line.length; ++end) {
            if (end != line.length && line[end] != "|") continue;
            if (field == wanted) return _slice(line, start, end - start);
            ++field;
            start = end + 1;
        }
        revert("missing fixture field");
    }

    function _parseUint(bytes memory value) private pure returns (uint256 out) {
        for (uint256 i; i < value.length; ++i) {
            uint8 digit = uint8(value[i]);
            if (digit < 48 || digit > 57) revert("invalid decimal");
            out = out * 10 + digit - 48;
        }
    }

    function _hex(bytes memory value) private pure returns (bytes memory out) {
        if (value.length % 2 != 0) revert("odd hex");
        out = new bytes(value.length / 2);
        for (uint256 i; i < out.length; ++i) {
            out[i] = bytes1((_nibble(value[i * 2]) << 4) | _nibble(value[i * 2 + 1]));
        }
    }

    function _nibble(bytes1 character) private pure returns (uint8) {
        uint8 c = uint8(character);
        if (c >= 48 && c <= 57) return c - 48;
        if (c >= 97 && c <= 102) return c - 87;
        if (c >= 65 && c <= 70) return c - 55;
        revert("invalid hex");
    }

    function _bytes32(bytes memory value) private pure returns (bytes32 out) {
        if (value.length != 32) revert("not bytes32");
        assembly ("memory-safe") {
            out := mload(add(value, 32))
        }
    }

    function _slice(bytes memory value, uint256 start, uint256 length)
        private
        pure
        returns (bytes memory out)
    {
        out = new bytes(length);
        for (uint256 i; i < length; ++i) {
            out[i] = value[start + i];
        }
    }

    function _eq(bytes memory a, bytes memory b) private pure returns (bool) {
        return keccak256(a) == keccak256(b);
    }

    function _eqUint(uint256 actual, uint256 expected) private pure {
        if (actual != expected) revert("assert uint");
    }

    function _eqBytes32(bytes32 actual, bytes32 expected) private pure {
        if (actual != expected) revert("assert bytes32");
    }
}
