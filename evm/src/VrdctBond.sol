// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {VrdctReexec} from "./VrdctReexec.sol";

/// The EVM custody/state-machine twin of `vrdct-bond`. Markets are addressed by the complete
/// definition hash; feeds are owned by `(definitionHash, feeder)`, so one feeder cannot mutate
/// another's re-execution attempt. There is intentionally no `rentPayer` or `closeMarket`: EVM has
/// no account-rent refund to return, while settled state remains an auditable settlement record.
contract VrdctBond {
    uint8 public constant STATE_OPEN = 0;
    uint8 public constant STATE_CHALLENGED = 1;
    uint8 public constant STATE_SETTLED = 2;
    uint8 public constant SOURCE_UNSOURCED = 0;
    uint8 public constant SOURCE_SOLANA_ACCOUNT_SIGNATURES = 1;
    uint64 public constant MIN_CHALLENGE_WINDOW_SECS = 1 hours;
    uint64 public constant MAX_CHALLENGE_WINDOW_SECS = 7 days;
    uint64 public constant SETTLEMENT_WINDOW_SECS = 1 days;
    uint16 public constant CUT_BPS = 1_000;

    error WrongState();
    error UnknownFlag();
    error ZeroBond();
    error NoRecords();
    error DefinitionMismatch();
    error ChallengeWindowOutOfBounds();
    error ChallengeWindowClosed();
    error ChallengeWindowOpen();
    error ChallengeMustDiffer();
    error ChallengeBondTooSmall();
    error SettlementDeadlineOpen();
    error InvalidSource();
    error SourceAccountRequired();
    error InvalidSourceWindow();
    error UnsupportedCalendar();
    error FeedExists();
    error FeedMissing();
    error FeedMismatch();
    error MalformedChunk();
    error NonCanonicalChunk();
    error TooManyRecords();
    error IncompleteFeed();
    error InputsHashMismatch();
    error ValueMismatch();
    error TransferFailed();
    error Reentrant();

    struct Source {
        uint8 kind;
        bytes32 account;
        int64 fromTs;
        int64 toTs;
    }

    struct Market {
        bytes32 definitionHash;
        bytes32 marketId;
        uint8 claimType;
        uint32 calendarVersion;
        uint32 nRecords;
        bytes32 inputsHash;
        Source source;
        uint8 yesWhen;
        address resolver;
        uint8 resolverFlag;
        uint256 resolverBond;
        address challenger;
        uint8 challengerFlag;
        uint256 challengeBond;
        uint64 openedTs;
        uint64 challengeUntil;
        uint64 settleBy;
        uint64 settledTs;
        uint8 state;
        uint8 settledFlag;
        uint8 resolved;
        bool byReexecution;
        bool exists;
    }

    struct Feed {
        bytes32 digest;
        uint32 count;
        VrdctReexec.Fold fold;
        bool exists;
    }

    mapping(bytes32 => Market) private markets;
    mapping(bytes32 => mapping(address => Feed)) private feeds;
    mapping(address => uint256) public pendingWithdrawals;
    bool private withdrawing;

    event MarketOpened(
        bytes32 indexed market,
        address indexed resolver,
        uint8 claimType,
        uint8 assertedFlag,
        uint256 bond,
        uint32 nRecords,
        bytes32 inputsHash
    );
    event MarketChallenged(
        bytes32 indexed market, address indexed challenger, uint8 assertedFlag, uint256 bond
    );
    event MarketSettled(
        bytes32 indexed market,
        uint8 settledFlag,
        uint8 resolved,
        address winner,
        uint256 payout,
        uint256 crankerReward,
        bool byReexecution
    );
    event Withdrawal(address indexed account, uint256 amount);

    modifier nonReentrant() {
        if (withdrawing) revert Reentrant();
        withdrawing = true;
        _;
        withdrawing = false;
    }

    function openMarket(
        bytes32 definitionHash,
        bytes32 marketId,
        uint8 claimType,
        uint32 calendarVersion,
        uint32 nRecords,
        bytes32 inputsHash,
        Source calldata source,
        uint8 yesWhen,
        uint8 assertedFlag,
        uint256 bond,
        uint64 challengeWindowSecs
    ) external payable {
        if (markets[definitionHash].exists) revert WrongState();
        if (assertedFlag > 4) revert UnknownFlag();
        if (bond == 0) revert ZeroBond();
        if (nRecords == 0) revert NoRecords();
        if (msg.value != bond) revert ValueMismatch();
        if (
            challengeWindowSecs < MIN_CHALLENGE_WINDOW_SECS
                || challengeWindowSecs > MAX_CHALLENGE_WINDOW_SECS
        ) revert ChallengeWindowOutOfBounds();
        _validateSource(claimType, source);
        if (claimType == 1 && calendarVersion != 202601) revert UnsupportedCalendar();
        bytes32 actual = VrdctReexec.marketDefinitionHash(
            marketId,
            claimType,
            calendarVersion,
            nRecords,
            inputsHash,
            source.kind,
            source.account,
            source.fromTs,
            source.toTs,
            yesWhen,
            uint64(bond),
            int64(challengeWindowSecs)
        );
        if (definitionHash != actual) revert DefinitionMismatch();
        uint64 nowTs = uint64(block.timestamp);
        markets[definitionHash] = Market(
            definitionHash,
            marketId,
            claimType,
            calendarVersion,
            nRecords,
            inputsHash,
            source,
            yesWhen,
            msg.sender,
            assertedFlag,
            bond,
            address(0),
            0,
            0,
            nowTs,
            nowTs + challengeWindowSecs,
            nowTs + challengeWindowSecs + SETTLEMENT_WINDOW_SECS,
            0,
            STATE_OPEN,
            0,
            0,
            false,
            true
        );
        emit MarketOpened(
            definitionHash, msg.sender, claimType, assertedFlag, bond, nRecords, inputsHash
        );
    }

    function challenge(bytes32 definitionHash, uint8 assertedFlag, uint256 bond) external payable {
        Market storage m = _market(definitionHash);
        if (m.state != STATE_OPEN) revert WrongState();
        if (block.timestamp > m.challengeUntil) revert ChallengeWindowClosed();
        if (assertedFlag > 4) revert UnknownFlag();
        if (assertedFlag == m.resolverFlag) revert ChallengeMustDiffer();
        if (bond < m.resolverBond) revert ChallengeBondTooSmall();
        if (msg.value != bond) revert ValueMismatch();
        m.challenger = msg.sender;
        m.challengerFlag = assertedFlag;
        m.challengeBond = bond;
        m.state = STATE_CHALLENGED;
        emit MarketChallenged(definitionHash, msg.sender, assertedFlag, bond);
    }

    function openFeed(bytes32 definitionHash) external {
        Market storage m = _market(definitionHash);
        if (m.state == STATE_SETTLED) revert WrongState();
        Feed storage f = feeds[definitionHash][msg.sender];
        if (f.exists) revert FeedExists();
        f.digest = VrdctReexec.headerDigest(m.claimType, m.calendarVersion, m.nRecords);
        f.exists = true;
    }

    function feed(bytes32 definitionHash, bytes calldata chunk) external {
        Market storage m = _market(definitionHash);
        if (m.state == STATE_SETTLED) revert WrongState();
        Feed storage f = feeds[definitionHash][msg.sender];
        if (!f.exists) revert FeedMissing();
        uint256 size = VrdctReexec.recordSize(m.claimType);
        if (chunk.length == 0 || chunk.length % size != 0) revert MalformedChunk();
        uint32 fed = uint32(chunk.length / size);
        uint32 remaining = m.nRecords - f.count;
        if (remaining == 0) revert TooManyRecords();
        if (fed != (remaining < 200 ? remaining : 200)) revert NonCanonicalChunk();
        f.fold = VrdctReexec.foldChunk(m.claimType, f.fold, chunk);
        f.count = f.fold.count;
        f.digest = sha256(bytes.concat(f.digest, chunk));
    }

    function closeFeed(bytes32 definitionHash) external {
        if (!feeds[definitionHash][msg.sender].exists) revert FeedMissing();
        delete feeds[definitionHash][msg.sender];
    }

    /// Effects are recorded before the only ETH interaction. Pull payments stop a winner/rewardee
    /// from bricking settlement by reverting, and `withdraw` is separately reentrancy guarded.
    function settle(bytes32 definitionHash, address feeder) external {
        Market storage m = _market(definitionHash);
        if (m.state != STATE_CHALLENGED) revert WrongState();
        Feed storage f = feeds[definitionHash][feeder];
        if (!f.exists) revert FeedMissing();
        if (f.count != m.nRecords || f.fold.count != m.nRecords) revert IncompleteFeed();
        if (f.digest != m.inputsHash) revert InputsHashMismatch();
        uint8 truth = VrdctReexec.verdict(m.claimType, f.fold);
        uint256 pot = m.resolverBond + m.challengeBond;
        address winner;
        uint256 reward;
        if (m.resolverFlag == truth) {
            winner = m.resolver;
            reward = _cut(m.challengeBond);
        } else if (m.challengerFlag == truth) {
            winner = m.challenger;
            reward = _cut(m.resolverBond);
        } else {
            winner = feeder;
            reward = _cut(pot);
        }
        uint256 payout = pot - reward;
        m.state = STATE_SETTLED;
        m.settledFlag = truth;
        m.resolved = uint8((m.yesWhen >> truth) & 1);
        m.byReexecution = true;
        m.settledTs = uint64(block.timestamp);
        pendingWithdrawals[winner] += payout;
        pendingWithdrawals[feeder] += reward;
        emit MarketSettled(definitionHash, truth, m.resolved, winner, payout, reward, true);
    }

    function expireChallenged(bytes32 definitionHash) external {
        Market storage m = _market(definitionHash);
        if (m.state != STATE_CHALLENGED) revert WrongState();
        if (block.timestamp <= m.settleBy) revert SettlementDeadlineOpen();
        uint256 pot = m.resolverBond + m.challengeBond;
        m.state = STATE_SETTLED;
        m.settledFlag = m.challengerFlag;
        m.resolved = uint8((m.yesWhen >> m.challengerFlag) & 1);
        m.settledTs = uint64(block.timestamp);
        pendingWithdrawals[m.challenger] += pot;
        emit MarketSettled(definitionHash, m.settledFlag, m.resolved, m.challenger, pot, 0, false);
    }

    function claimUncontested(bytes32 definitionHash) external {
        Market storage m = _market(definitionHash);
        if (m.state != STATE_OPEN) revert WrongState();
        if (block.timestamp <= m.challengeUntil) revert ChallengeWindowOpen();
        m.state = STATE_SETTLED;
        m.settledFlag = m.resolverFlag;
        m.resolved = uint8((m.yesWhen >> m.resolverFlag) & 1);
        m.settledTs = uint64(block.timestamp);
        pendingWithdrawals[m.resolver] += m.resolverBond;
        emit MarketSettled(
            definitionHash, m.settledFlag, m.resolved, m.resolver, m.resolverBond, 0, false
        );
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert TransferFailed();
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawal(msg.sender, amount);
    }

    function getMarket(bytes32 definitionHash) external view returns (Market memory) {
        return _market(definitionHash);
    }

    function getFeed(bytes32 definitionHash, address feeder) external view returns (Feed memory) {
        return feeds[definitionHash][feeder];
    }

    function _market(bytes32 h) private view returns (Market storage m) {
        m = markets[h];
        if (!m.exists) revert WrongState();
    }

    function _cut(uint256 amount) private pure returns (uint256) {
        return amount / 10;
    }

    function _validateSource(uint8 claimType, Source calldata s) private pure {
        if (s.kind > SOURCE_SOLANA_ACCOUNT_SIGNATURES) revert InvalidSource();
        if (claimType == 1) {
            if (s.kind != SOURCE_SOLANA_ACCOUNT_SIGNATURES) revert InvalidSource();
            if (s.account == bytes32(0)) revert SourceAccountRequired();
            if (s.fromTs >= s.toTs) revert InvalidSourceWindow();
        } else if (
            claimType == 2
                && (s.kind != 0 || s.account != bytes32(0) || s.fromTs != 0 || s.toTs != 0)
        ) {
            revert InvalidSource();
        }
    }
}
