//! The IB fault rules of the on-screen IB snapshot switch (V032), a part of the supervision module kept in its own
//! file like ib_switch.rs, which uses them: why turning the snapshot on is refused (an IB value the backend would
//! refuse), and which IB names are set. The shell checks only the environment it was started with, names and never
//! values; the backend stays the authority (supervise_check.rs holds the environment the backend is given).

use super::check::IB_NAMES;
use std::ffi::OsString;

/// The ports the backend refuses as live trading (services/ib_snapshot.py LIVE_PORTS: TWS 7496, Gateway 4001).
pub const IB_LIVE_PORTS: [u32; 2] = [7496, 4001];
/// The paper account prefix (live_guards.py check_delayed_allowed; IB paper accounts are DU...).
pub const IB_PAPER_PREFIX: &str = "DU";

/// Why turning the IB snapshot on is refused: an IB value is set and the backend (or the paper-only rule) would refuse
/// it. Each says which name is wrong and never what its value is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IbFault {
    /// IB_PORT is set and is not a whole number.
    PortNotNumber,
    /// IB_PORT is set and is outside 1 to 65535.
    PortOutOfRange,
    /// IB_PORT is a live-trading port.
    PortLive,
    /// IB_HOST is set and is not this machine.
    HostNotLocal,
    /// IB_ACCOUNT_ID is set and is not a paper account.
    AccountNotPaper,
}

impl IbFault {
    /// The name in the log (`ib_switch_refused`).
    pub fn code(self) -> &'static str {
        match self {
            Self::PortNotNumber => "port_not_a_number",
            Self::PortOutOfRange => "port_out_of_range",
            Self::PortLive => "port_live",
            Self::HostNotLocal => "host_not_local",
            Self::AccountNotPaper => "account_not_paper",
        }
    }

    /// The line the owner reads: the name and why, never the value.
    pub fn message(self) -> &'static str {
        match self {
            Self::PortNotNumber => "IB_PORT is not a whole number.",
            Self::PortOutOfRange => "IB_PORT is outside 1 to 65535.",
            Self::PortLive => {
                "IB_PORT is a live-trading port (7496 or 4001); use TWS paper 7497 or Gateway paper 4002."
            }
            Self::HostNotLocal => {
                "IB_HOST is not this machine (use localhost or a loopback address)."
            }
            Self::AccountNotPaper => "IB_ACCOUNT_ID is not a paper account (DU...).",
        }
    }
}

/// The value of `name` (matched without regard to case, as Windows names are) in `parent`, the last one when repeated.
fn ib_value(parent: &[(String, String)], name: &str) -> Option<String> {
    parent
        .iter()
        .rev()
        .find(|(n, _)| n == name)
        .map(|(_, v)| v.clone())
}

fn upper_env(parent: impl IntoIterator<Item = (OsString, OsString)>) -> Vec<(String, String)> {
    parent
        .into_iter()
        .map(|(n, v)| {
            let name = n.to_string_lossy().to_uppercase();
            (name, v.to_string_lossy().into_owned())
        })
        .collect()
}

/// The backend's host rule (live_guards.py check_ib_host with no remote flag): a host that is empty or only blanks is
/// refused; `localhost` exactly (case sensitive) passes; otherwise only an IP literal that is loopback passes.
pub fn ib_host_fault(host: &str) -> Option<IbFault> {
    if host.trim().is_empty() {
        return Some(IbFault::HostNotLocal);
    }
    if host == "localhost" {
        return None;
    }
    match host.parse::<std::net::IpAddr>() {
        Ok(ip) if ip.is_loopback() => None,
        _ => Some(IbFault::HostNotLocal),
    }
}

/// The backend's port rule (services/ib_snapshot.py config_from_env): blanks around it are ignored and nothing left
/// means the default (7497); otherwise ASCII digits from 1 to 65535 that are not a live port.
pub fn ib_port_fault(raw: &str) -> Option<IbFault> {
    let port = raw.trim();
    if port.is_empty() {
        return None;
    }
    if !port.bytes().all(|b| b.is_ascii_digit()) {
        return Some(IbFault::PortNotNumber);
    }
    match port.parse::<u32>() {
        Ok(n) if (1..=65_535).contains(&n) => {
            IB_LIVE_PORTS.contains(&n).then_some(IbFault::PortLive)
        }
        _ => Some(IbFault::PortOutOfRange),
    }
}

/// What turning the IB snapshot on would be refused for, as this process's environment has the IB names. A name that
/// is not set is never a fault (the backend has defaults: 127.0.0.1 and 7497, and reads IB_ACCOUNT_ID only to mask
/// it). The backend stays the authority; this check only stops a switch the backend would refuse anyway.
pub fn ib_switch_faults(parent: impl IntoIterator<Item = (OsString, OsString)>) -> Vec<IbFault> {
    let env = upper_env(parent);
    let mut faults = Vec::new();
    if let Some(port) = ib_value(&env, "IB_PORT")
        && let Some(fault) = ib_port_fault(&port)
    {
        faults.push(fault);
    }
    // The backend takes an empty IB_HOST as unset (`env.get("IB_HOST") or DEFAULT_HOST`), and refuses blanks.
    if let Some(host) = ib_value(&env, "IB_HOST").filter(|h| !h.is_empty())
        && let Some(fault) = ib_host_fault(&host)
    {
        faults.push(fault);
    }
    if let Some(account) = ib_value(&env, "IB_ACCOUNT_ID")
        && !account.trim().is_empty()
        && !account.trim().starts_with(IB_PAPER_PREFIX)
    {
        faults.push(IbFault::AccountNotPaper);
    }
    faults
}

/// Which of the four IB names are set (not blank) in this process's environment, in IB_NAMES order: names only.
pub fn ib_names_set(
    parent: impl IntoIterator<Item = (OsString, OsString)>,
) -> Vec<(&'static str, bool)> {
    let env = upper_env(parent);
    IB_NAMES
        .iter()
        .map(|name| {
            let set = ib_value(&env, name).is_some_and(|v| !v.trim().is_empty());
            (*name, set)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn os(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs
            .iter()
            .map(|(n, v)| ((*n).into(), (*v).into()))
            .collect()
    }

    fn faults(pairs: &[(&str, &str)]) -> Vec<IbFault> {
        ib_switch_faults(os(pairs))
    }

    #[test]
    fn the_owners_ib_environment_and_an_empty_one_are_not_refused() {
        let owner = [
            ("IB_PORT", "7497"),
            ("IB_ACCOUNT_ID", "DU1234567"),
            ("IB_BASE_USD_RATE", "0.79"),
            ("PATH", "C:/x"),
        ];
        assert_eq!(faults(&owner), []);
        assert_eq!(faults(&[]), []);
        assert_eq!(
            faults(&[("IB_PORT", ""), ("IB_HOST", ""), ("IB_ACCOUNT_ID", "  ")]),
            []
        );
    }

    #[test]
    fn live_and_malformed_ports_are_refused() {
        for (port, fault) in [
            ("7496", IbFault::PortLive),
            ("4001", IbFault::PortLive),
            (" 4001 ", IbFault::PortLive),
            ("0", IbFault::PortOutOfRange),
            ("70000", IbFault::PortOutOfRange),
            ("99999999999999999999", IbFault::PortOutOfRange),
            ("abc", IbFault::PortNotNumber),
            ("-1", IbFault::PortNotNumber),
            ("75 97", IbFault::PortNotNumber),
            ("  x7497  ", IbFault::PortNotNumber),
        ] {
            assert_eq!(faults(&[("IB_PORT", port)]), [fault], "{port:?}");
        }
        for ok in ["7497", "4002", " 7497 ", "07497", "1", "65535"] {
            assert_eq!(faults(&[("ib_port", ok)]), [], "{ok:?}");
        }
    }

    #[test]
    fn a_live_account_is_refused_and_its_value_never_shown() {
        let refused = faults(&[("IB_ACCOUNT_ID", "U1234567")]);
        assert_eq!(refused, [IbFault::AccountNotPaper]);
        let words = format!("{} {}", refused[0].message(), refused[0].code());
        assert!(
            !words.contains("U1234567") && words.contains("not a paper account (DU...)"),
            "{words}"
        );
    }

    #[test]
    fn a_host_that_is_not_this_machine_is_refused() {
        for bad in [
            "10.0.0.5",
            "LOCALHOST",
            "192.168.1.20",
            "example.com",
            "0.0.0.0",
            "  ",
            "localhost ",
        ] {
            assert_eq!(
                faults(&[("IB_HOST", bad)]),
                [IbFault::HostNotLocal],
                "{bad:?}"
            );
        }
        for ok in ["localhost", "127.0.0.1", "127.5.6.7", "::1"] {
            assert_eq!(faults(&[("IB_HOST", ok)]), [], "{ok:?}");
        }
        let text = IbFault::HostNotLocal.message();
        assert!(!text.contains("10.0.0.5"), "{text}");
    }

    /// The hosts and ports the backend's own tests accept or refuse (backend/tests/test_ib_snapshot.py), as the
    /// backend's config_from_env and check_ib_host judge them: the shell's pre-check gives the same verdicts.
    #[test]
    fn the_verdicts_match_the_backends_own_cases() {
        let hosts: [(&str, bool); 9] = [
            ("localhost", true),
            ("127.0.0.1", true),
            ("::1", true),
            ("192.168.1.20", false),
            ("10.0.0.5", false),
            ("example.com", false),
            ("0.0.0.0", false),
            ("  ", false),
            ("LOCALHOST", false),
        ];
        for (host, accepted) in hosts {
            assert_eq!(ib_host_fault(host).is_none(), accepted, "host {host:?}");
        }
        let ports: [(&str, bool); 10] = [
            ("4002", true),
            ("7497", true),
            ("", true),
            ("7496", false),
            ("4001", false),
            ("abc", false),
            ("0", false),
            ("70000", false),
            ("-1", false),
            ("75 97", false),
        ];
        for (port, accepted) in ports {
            assert_eq!(ib_port_fault(port).is_none(), accepted, "port {port:?}");
        }
    }

    #[test]
    fn every_fault_shows_up_together_and_names_its_variable() {
        let all = faults(&[
            ("IB_PORT", "7496"),
            ("IB_HOST", "10.0.0.5"),
            ("IB_ACCOUNT_ID", "U1"),
        ]);
        assert_eq!(
            all,
            [
                IbFault::PortLive,
                IbFault::HostNotLocal,
                IbFault::AccountNotPaper
            ]
        );
        for fault in all {
            assert!(fault.message().starts_with("IB_"), "{}", fault.message());
        }
    }

    #[test]
    fn the_names_set_are_listed_without_values() {
        let set = ib_names_set(os(&[
            ("ib_port", "7497"),
            ("IB_ACCOUNT_ID", "DU1"),
            ("IB_HOST", " "),
        ]));
        assert_eq!(
            set,
            [
                ("IB_HOST", false),
                ("IB_PORT", true),
                ("IB_ACCOUNT_ID", true),
                ("IB_BASE_USD_RATE", false)
            ]
        );
    }
}
