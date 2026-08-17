// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;
import {VrdctBond} from "../src/VrdctBond.sol";
import {VrdctReexec} from "../src/VrdctReexec.sol";

interface VmBond {
    function deal(address, uint256) external;
    function prank(address) external;
    function warp(uint256) external;
}

contract VrdctBondTest {
    VmBond constant vm = VmBond(address(uint160(uint256(keccak256("hevm cheat code")))));
    VrdctBond bond;
    address resolver = address(0xA11CE);
    address challenger = address(0xB0B);
    address feeder = address(0xFEE);
    address other = address(0xBAD);
    bytes constant RECORD =
        hex"00000000000000000000000000000000000000000000000000000000000000000100000000";
    event GasMeasurement(bytes32 indexed op, uint256 gasUsed);

    function setUp() public {
        bond = new VrdctBond();
        vm.deal(resolver, 100 ether);
        vm.deal(challenger, 100 ether);
        vm.deal(feeder, 100 ether);
        vm.deal(other, 100 ether);
        vm.warp(1_800_000_000);
    }

    function _definition(uint256 amount) internal pure returns (bytes32 h) {
        VrdctBond.Source memory s = VrdctBond.Source(0, bytes32(0), 0, 0);
        bytes32 input = VrdctReexec.hashChain(2, 202601, 1, RECORD);
        h = VrdctReexec.marketDefinitionHash(
            bytes32(uint256(1)),
            2,
            202601,
            1,
            input,
            s.kind,
            s.account,
            s.fromTs,
            s.toTs,
            2,
            uint64(amount),
            3600
        );
    }

    function _open(uint256 amount) internal returns (bytes32 h) {
        h = _definition(amount);
        VrdctBond.Source memory s = VrdctBond.Source(0, bytes32(0), 0, 0);
        bytes32 input = VrdctReexec.hashChain(2, 202601, 1, RECORD);
        vm.prank(resolver);
        bond.openMarket{value: amount}(
            h, bytes32(uint256(1)), 2, 202601, 1, input, s, 2, 1, amount, 3600
        );
    }

    function _challenge(bytes32 h, uint256 amount) internal {
        vm.prank(challenger);
        bond.challenge{value: amount}(h, 3, amount);
    }

    function _ok(bool value) internal pure {
        if (!value) revert("assert");
    }

    function testReexecutionSettlementCreditsWinnerAndFeeder() public {
        bytes32 h = _open(1 ether);
        _challenge(h, 1 ether);
        vm.prank(feeder);
        bond.openFeed(h);
        vm.prank(feeder);
        bond.feed(h, RECORD);
        uint256 g = gasleft();
        bond.settle(h, feeder);
        emit GasMeasurement("settle", g - gasleft());
        _ok(bond.pendingWithdrawals(resolver) == 1.9 ether);
        _ok(bond.pendingWithdrawals(feeder) == 0.1 ether);
        _ok(bond.getMarket(h).byReexecution);
    }

    function testMismatchedDigestCannotSettle() public {
        bytes32 h = _open(1 ether);
        _challenge(h, 1 ether);
        vm.prank(feeder);
        bond.openFeed(h);
        bytes memory forged = RECORD;
        forged[0] = 0x02;
        vm.prank(feeder);
        bond.feed(h, forged);
        (bool ok,) = address(bond).call(abi.encodeCall(bond.settle, (h, feeder)));
        _ok(!ok);
    }

    function testIncompleteFeedCannotSettle() public {
        bytes32 h = _open(1 ether);
        _challenge(h, 1 ether);
        vm.prank(feeder);
        bond.openFeed(h);
        (bool ok,) = address(bond).call(abi.encodeCall(bond.settle, (h, feeder)));
        _ok(!ok);
    }

    function testBondAboveU64IsRejectedBeforeCustody() public {
        uint256 huge = uint256(type(uint64).max) + 1;
        bytes32 h = _definition(huge); // Same preimage as 1 wei under the canonical u64 format.
        VrdctBond.Source memory s = VrdctBond.Source(0, bytes32(0), 0, 0);
        bytes32 input = VrdctReexec.hashChain(2, 202601, 1, RECORD);
        vm.prank(resolver);
        (bool ok,) = address(bond).call{value: huge}(
            abi.encodeCall(
                bond.openMarket, (h, bytes32(uint256(1)), 2, 202601, 1, input, s, 2, 1, huge, 3600)
            )
        );
        _ok(!ok);
    }

    function testSecondFeederCannotMutateFirstFeed() public {
        bytes32 h = _open(1 ether);
        _challenge(h, 1 ether);
        vm.prank(feeder);
        bond.openFeed(h);
        vm.prank(other);
        bond.openFeed(h);
        vm.prank(feeder);
        bond.feed(h, RECORD);
        _ok(bond.getFeed(h, feeder).count == 1);
        _ok(bond.getFeed(h, other).count == 0);
    }

    function testChallengeAfterWindowFailsAndUncontestedCreditsResolver() public {
        bytes32 h = _open(1 ether);
        vm.warp(block.timestamp + 3601);
        vm.prank(challenger);
        (bool ok,) =
            address(bond).call{value: 1 ether}(abi.encodeCall(bond.challenge, (h, 3, 1 ether)));
        _ok(!ok);
        bond.claimUncontested(h);
        _ok(bond.pendingWithdrawals(resolver) == 1 ether);
    }

    function testExpireChallengedCreditsFullPot() public {
        bytes32 h = _open(1 ether);
        _challenge(h, 1 ether);
        vm.warp(block.timestamp + 3600 + 86401);
        bond.expireChallenged(h);
        _ok(bond.pendingWithdrawals(challenger) == 2 ether);
    }

    function testExactChunkRuleRejectsShortCmlsChunk() public {
        VrdctBond.Source memory s = VrdctBond.Source(1, bytes32(uint256(1)), 1, 2);
        bytes memory bytes200 = new bytes(800);
        for (uint256 i; i < 200; i++) {
            uint32 ts = 1_785_600_000 + uint32(i * 60);
            bytes200[4 * i] = bytes1(uint8(ts));
            bytes200[4 * i + 1] = bytes1(uint8(ts >> 8));
            bytes200[4 * i + 2] = bytes1(uint8(ts >> 16));
            bytes200[4 * i + 3] = bytes1(uint8(ts >> 24));
        }
        bytes32 input = VrdctReexec.hashChain(1, 202601, 200, bytes200);
        bytes32 h = VrdctReexec.marketDefinitionHash(
            bytes32(uint256(2)),
            1,
            202601,
            200,
            input,
            s.kind,
            s.account,
            s.fromTs,
            s.toTs,
            2,
            1 ether,
            3600
        );
        vm.prank(resolver);
        bond.openMarket{value: 1 ether}(
            h, bytes32(uint256(2)), 1, 202601, 200, input, s, 2, 3, 1 ether, 3600
        );
        vm.prank(challenger);
        bond.challenge{value: 1 ether}(h, 1, 1 ether);
        vm.prank(feeder);
        bond.openFeed(h);
        bytes memory short = new bytes(4);
        vm.prank(feeder);
        (bool ok,) = address(bond).call(abi.encodeCall(bond.feed, (h, short)));
        _ok(!ok);
        // The succeeding canonical 200-record chunk is the measured slice-2 admission bound.
        vm.prank(feeder);
        bond.feed(h, bytes200);
        bond.settle(h, feeder);
    }
}
