use crate::error::Result;
use crate::model::PlaytimeStats;
use chrono::{Duration, Local, NaiveDate, Utc};
use std::collections::HashMap;
use std::path::PathBuf;

pub struct Playtime {
    path: PathBuf,
    days: HashMap<String, u64>,
}

impl Playtime {
    pub fn open() -> Result<Self> {
        let path = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("AzrealX")
            .join("playtime.json");
        let mut pt = Playtime {
            path,
            days: HashMap::new(),
        };
        if pt.path.exists() {
            if let Ok(raw) = std::fs::read_to_string(&pt.path) {
                if let Ok(map) = serde_json::from_str::<HashMap<String, u64>>(&raw) {
                    pt.days = map;
                }
            }
        }
        Ok(pt)
    }

    pub fn save(&self) -> Result<()> {
        std::fs::create_dir_all(self.path.parent().unwrap_or(std::path::Path::new(".")))?;
        std::fs::write(&self.path, serde_json::to_string_pretty(&self.days)?)?;
        Ok(())
    }

    pub fn add_session(&mut self, seconds: u64) -> Result<()> {
        let day = Local::now().format("%Y-%m-%d").to_string();
        let e = self.days.entry(day).or_insert(0);
        *e += seconds;
        self.save()
    }

    pub fn stats(&self) -> PlaytimeStats {
        let today = Local::now().date_naive();
        let week_start = today - Duration::days(6);
        let mut total = 0u64;
        let mut today_sec = 0u64;
        let mut week_sec = 0u64;
        let mut days_sorted: Vec<(String, u64)> = Vec::new();
        for (day, sec) in &self.days {
            total += sec;
            if let Ok(d) = NaiveDate::parse_from_str(day, "%Y-%m-%d") {
                if d == today {
                    today_sec += sec;
                }
                if d >= week_start && d <= today {
                    week_sec += sec;
                }
            }
        }
        for i in (0..7).rev() {
            let d = today - Duration::days(i);
            let key = d.format("%Y-%m-%d").to_string();
            days_sorted.push((key.clone(), *self.days.get(&key).unwrap_or(&0)));
        }
        PlaytimeStats {
            total_seconds: total,
            today_seconds: today_sec,
            week_seconds: week_sec,
            days: days_sorted,
        }
    }

    pub fn ping(&self) -> u64 {
        self.days.values().sum()
    }
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}