//! The JS-generated calendar-status corpus is shared with Solidity. It deliberately sweeps every
//! 2026 session edge and every calendar exception, where the smaller re-execution fixture is sparse.

use super::campana::is_session_open;

const VECTORS: &str = include_str!("../../../../tests/calendar-vectors.txt");

#[test]
fn js_generated_calendar_vectors_match_rust_campana() {
    let mut vectors = 0usize;
    for (line_no, line) in VECTORS.lines().enumerate() {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<_> = line.split('|').collect();
        assert_eq!(fields.len(), 2, "invalid calendar vector at line {}", line_no + 1);
        let timestamp = fields[0].parse::<i64>().expect("fixture contains a unix timestamp");
        let expected = match fields[1] {
            "0" => false,
            "1" => true,
            _ => panic!("fixture contains a boolean at line {}", line_no + 1),
        };
        assert_eq!(is_session_open(timestamp), expected, "calendar mismatch at {timestamp}");
        vectors += 1;
    }
    assert_eq!(vectors, 2212, "calendar fixture coverage changed unexpectedly");
}
