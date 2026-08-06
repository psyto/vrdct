use anchor_lang::prelude::*;

#[error_code]
pub enum VrdctError {
    #[msg("unknown claim_type — register the surface first")]
    UnknownClaimType,
    #[msg("unknown verdict flag")]
    UnknownFlag,
    #[msg("calendar version not pinned in this program")]
    UnsupportedCalendar,
    #[msg("timestamp lies outside the pinned calendar's validity range")]
    CalendarOutOfRange,
    #[msg("market is not in the required state")]
    WrongState,
    #[msg("the challenge window has closed")]
    ChallengeWindowClosed,
    #[msg("the challenge window is still open")]
    ChallengeWindowOpen,
    #[msg("challenge window is outside the program's safe bounds")]
    ChallengeWindowOutOfBounds,
    #[msg("the challenged market has not reached its settlement deadline")]
    SettlementDeadlineOpen,
    #[msg("a challenge must assert a different verdict than the resolver")]
    ChallengeMustDiffer,
    #[msg("the challenge bond must at least match the resolver's bond")]
    ChallengeBondTooSmall,
    #[msg("bond must be non-zero")]
    ZeroBond,
    #[msg("chunk is malformed for this claim_type")]
    MalformedChunk,
    #[msg("chunk is not the canonical size — the hash chain is order- and size-sensitive")]
    NonCanonicalChunk,
    #[msg("records must be fed in non-decreasing timestamp order")]
    RecordsOutOfOrder,
    #[msg("more records fed than the market committed to")]
    TooManyRecords,
    #[msg("not every committed record has been re-executed yet")]
    IncompleteFeed,
    #[msg("the re-executed input digest does not match the committed inputs_hash")]
    InputsHashMismatch,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("n_records must be non-zero")]
    NoRecords,
    #[msg("market definition does not bind the requested PDA")]
    MarketDefinitionMismatch,
    #[msg("feed account is not owned by this market and feeder")]
    FeedMismatch,
    #[msg("source descriptor kind is unknown")]
    UnknownSourceKind,
    #[msg("CMLS markets must name a Solana account-signature source")]
    CmlsSourceRequired,
    #[msg("unsourced solvency markets must use an empty source descriptor")]
    SolvencyMustBeUnsourced,
    #[msg("source account cannot be the default pubkey")]
    SourceAccountRequired,
    #[msg("source window must have from_ts strictly before to_ts")]
    InvalidSourceWindow,
}
