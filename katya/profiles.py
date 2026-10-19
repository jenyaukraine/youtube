"""Browser identity profiles: popular desktop user agents with matching viewports.

Each new tab gets a random profile so tabs do not look identical. The list is
intentionally limited to current mainstream desktop browsers; it is refreshed
by hand when new major versions ship.
"""
from __future__ import annotations

import secrets
from typing import Dict, List, Optional

# Weighted roughly by real-world desktop market share (Chrome on Windows first).
PROFILES: List[Dict] = [
    # Chrome / Windows 10-11
    {"name": "Chrome 142 Windows", "weight": 22, "platform": "Win32",
     "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
     "viewport": {"width": 1920, "height": 1080}, "device_scale_factor": 1},
    {"name": "Chrome 141 Windows", "weight": 14, "platform": "Win32",
     "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
     "viewport": {"width": 1536, "height": 864}, "device_scale_factor": 1.25},
    {"name": "Chrome 140 Windows", "weight": 8, "platform": "Win32",
     "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
     "viewport": {"width": 1366, "height": 768}, "device_scale_factor": 1},
    # Edge / Windows
    {"name": "Edge 142 Windows", "weight": 9, "platform": "Win32",
     "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
     "viewport": {"width": 1920, "height": 1080}, "device_scale_factor": 1},
    {"name": "Edge 141 Windows", "weight": 5, "platform": "Win32",
     "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
     "viewport": {"width": 1680, "height": 1050}, "device_scale_factor": 1},
    # Chrome / macOS
    {"name": "Chrome 142 macOS", "weight": 10, "platform": "MacIntel",
     "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
     "viewport": {"width": 1440, "height": 900}, "device_scale_factor": 2},
    {"name": "Chrome 141 macOS", "weight": 5, "platform": "MacIntel",
     "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
     "viewport": {"width": 1728, "height": 1117}, "device_scale_factor": 2},
    # Safari / macOS
    {"name": "Safari 18 macOS", "weight": 7, "platform": "MacIntel",
     "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
     "viewport": {"width": 1512, "height": 982}, "device_scale_factor": 2},
    # Firefox
    {"name": "Firefox 145 Windows", "weight": 6, "platform": "Win32",
     "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0",
     "viewport": {"width": 1920, "height": 1080}, "device_scale_factor": 1},
    {"name": "Firefox 144 Linux", "weight": 2, "platform": "Linux x86_64",
     "user_agent": "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
     "viewport": {"width": 1920, "height": 1080}, "device_scale_factor": 1},
    # Chrome / Linux
    {"name": "Chrome 142 Linux", "weight": 4, "platform": "Linux x86_64",
     "user_agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
     "viewport": {"width": 1920, "height": 1080}, "device_scale_factor": 1},
]

LOCALES = ["ru-RU", "en-US", "en-GB", "de-DE", "uk-UA", "pl-PL"]


def random_profile() -> Dict:
    """Pick a profile weighted by popularity."""
    total = sum(p["weight"] for p in PROFILES)
    roll = secrets.randbelow(total)
    for profile in PROFILES:
        roll -= profile["weight"]
        if roll < 0:
            return profile
    return PROFILES[0]


def find_profile(name: str) -> Optional[Dict]:
    for profile in PROFILES:
        if profile["name"].lower() == name.lower():
            return profile
    return None


def context_options(profile: Dict) -> Dict:
    """Playwright new_context() keyword arguments for a profile."""
    return {
        "user_agent": profile["user_agent"],
        "viewport": dict(profile["viewport"]),
        "device_scale_factor": profile.get("device_scale_factor", 1),
        "is_mobile": False,
        "has_touch": False,
    }
