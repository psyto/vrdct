//! Campana, on-chain. A byte-for-byte port of `core/campana.mjs`: US-equities market status as a
//! PURE function of (unix timestamp, holiday calendar). No clock read, no float, no tz library —
//! so a validator re-executes exactly what an offline `node verify.mjs` re-executes.
//!
//! Parity contract with the JS core (any divergence here is a consensus bug):
//!   • civil-date math must agree with `Date.UTC` / `getUTC*` over the supported range
//!   • ET offset: EDT (-4) from 2nd Sun Mar 02:00 to 1st Sun Nov 02:00, else EST (-5)
//!   • a HALF_DAY session is NOT `OPEN` — the JS classifier counts it on the CLOSED side

/// The pinned calendar version — the only trusted datum. Mirrors `CALENDAR_2026.version` (2026_01).
pub const CAL_2026_VERSION: u32 = 202601;

/// NYSE 2026 full closures, as `y*10000 + m*100 + d`. Mirrors `CALENDAR_2026.holidays`.
const HOLIDAYS_2026: [u32; 10] = [
    20260101, 20260119, 20260216, 20260403, 20260525, 20260619, 20260703, 20260907, 20261126,
    20261225,
];
/// NYSE 2026 early closes (13:00 ET). Mirrors `CALENDAR_2026.halfDays`.
const HALF_DAYS_2026: [u32; 2] = [20261127, 20261224];

const REG_OPEN_MIN: i64 = 9 * 60 + 30;
const REG_CLOSE_MIN: i64 = 16 * 60;

/// Days since the unix epoch for a civil date (Howard Hinnant's algorithm; exact, integer-only).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Inverse of `days_from_civil`.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Day-of-month of the `n`-th Sunday. Mirrors `nthSundayOfMonth`.
fn nth_sunday_of_month(y: i64, month: i64, n: i64) -> i64 {
    let first_dow = (days_from_civil(y, month, 1) + 4).rem_euclid(7); // 0 = Sunday
    1 + (7 - first_dow) % 7 + (n - 1) * 7
}

/// US Eastern offset in hours. Mirrors `etOffsetHours`.
pub fn et_offset_hours(ts: i64) -> i64 {
    let y = civil_from_days(ts.div_euclid(86400)).0;
    let dst_start = days_from_civil(y, 3, nth_sunday_of_month(y, 3, 2)) * 86400 + 7 * 3600;
    let dst_end = days_from_civil(y, 11, nth_sunday_of_month(y, 11, 1)) * 86400 + 6 * 3600;
    if ts >= dst_start && ts < dst_end {
        -4
    } else {
        -5
    }
}

/// ET wall-clock parts of a timestamp. Mirrors `etParts`.
struct EtParts {
    ymd: u32,
    wday: i64,
    minutes: i64,
}
fn et_parts(ts: i64) -> EtParts {
    let wall = ts + et_offset_hours(ts) * 3600;
    let days = wall.div_euclid(86400);
    let secs = wall.rem_euclid(86400);
    let (y, m, d) = civil_from_days(days);
    EtParts {
        ymd: (y * 10000 + m * 100 + d) as u32,
        wday: (days + 4).rem_euclid(7),
        minutes: secs / 60,
    }
}

/// Is this instant inside a REGULAR (`STATUS.OPEN`) US-equities session?
///
/// Deliberately excludes half-days: `marketStatus` returns `HALF_DAY` there and the JS classifier
/// (`st.status === STATUS.OPEN ? open++ : closed++`) counts it on the CLOSED side. Mirrored exactly.
pub fn is_regular_open(ts: i64) -> bool {
    let p = et_parts(ts);
    if p.wday == 0 || p.wday == 6 {
        return false; // weekend
    }
    if HOLIDAYS_2026.contains(&p.ymd) || HALF_DAYS_2026.contains(&p.ymd) {
        return false;
    }
    p.minutes >= REG_OPEN_MIN && p.minutes < REG_CLOSE_MIN
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_roundtrip() {
        for z in -20000..20000 {
            let (y, m, d) = civil_from_days(z);
            assert_eq!(days_from_civil(y, m, d), z);
        }
    }

    #[test]
    fn dst_boundaries_2026() {
        // 2026: DST starts Sun Mar 8, ends Sun Nov 1.
        assert_eq!(nth_sunday_of_month(2026, 3, 2), 8);
        assert_eq!(nth_sunday_of_month(2026, 11, 1), 1);
        let dst_start = days_from_civil(2026, 3, 8) * 86400 + 7 * 3600;
        assert_eq!(et_offset_hours(dst_start - 1), -5);
        assert_eq!(et_offset_hours(dst_start), -4);
    }

    #[test]
    fn session_windows() {
        // Mon 2026-08-03 13:30Z == 09:30 ET (EDT) -> open; 20:00Z == 16:00 ET -> closed.
        let day = days_from_civil(2026, 8, 3) * 86400;
        assert!(!is_regular_open(day + 13 * 3600 + 29 * 60));
        assert!(is_regular_open(day + 13 * 3600 + 30 * 60));
        assert!(is_regular_open(day + 19 * 3600 + 59 * 60));
        assert!(!is_regular_open(day + 20 * 3600));
        // Sat 2026-08-01 mid-session-hours -> weekend, closed.
        let sat = days_from_civil(2026, 8, 1) * 86400;
        assert!(!is_regular_open(sat + 15 * 3600));
        // Independence Day observed 2026-07-03 -> holiday, closed.
        let hol = days_from_civil(2026, 7, 3) * 86400;
        assert!(!is_regular_open(hol + 15 * 3600));
    }
}
